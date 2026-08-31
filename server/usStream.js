// usStream — multi-source self-healing real-time US equity feed
// ---------------------------------------------------------------
// ARCHITECTURE (2026 realtime audit — fixes the "US prices not streaming" bug):
//   Priority 1: Finnhub WebSocket trade stream — instant push for the symbols
//               the key actually covers (empirically: NVDA/QQQ/AAPL/MU tick,
//               SPY/SMH/VGT/VOOG receive ZERO trades on the free tier).
//   Priority 2: Yahoo session fallback poller (5s) — fills the WS gaps. Every
//               subscribed symbol that has not seen a WS trade in the last
//               10s is polled from Yahoo's live chart endpoint, so SPY/SMH/
//               VGT/VOOG stream at a solid ~5s cadence with source
//               'yahoo-us-fallback'. Works EVEN WITH NO FINNHUB KEY.
//   Priority 3: Yahoo session bootstrap — one instant live snapshot per symbol
//               the moment it is subscribed, so a freshly-loaded site paints
//               correct US prices immediately (the old code seeded Friday's
//               STALE Finnhub REST close here — RC3 of the audit).
//   Priority 4: Finnhub REST quote — LAST RESORT only (Yahoo down). Empirically
//               returns the PREVIOUS session close while the market is open,
//               so it is freshness-gated (see isStaleUsQuote + index.js gate).
//
// LIFECYCLE: WS + fallback poller run ONLY while SSE clients are active
// (idle server = Render free tier friendly). On socket drop the reconnect is
// actually scheduled (audit M-2) and the reconnect-deadlock (timer cleared by
// _disconnect while _reconnectAt still in the future blocked a new client's
// _connect forever) is fixed via _ensureConnected().
// ---------------------------------------------------------------
import WebSocket from 'ws';
import { setTick } from './liveFeed.js';

// FIX (audit L-1): do NOT fall back to VITE_* vars — those are browser-exposed
// at build time. Server-side processes must read server-side names only.
const KEY = process.env.FINNHUB_API_KEY || '';
const WS_URL = KEY ? `wss://ws.finnhub.io?token=${KEY}` : '';

const _subscribed = new Set();      // plain US tickers (SPY, QQQ, ...)
const _session = new Map();         // sym -> { pc, high, low, vol, price, at, wsAt?, inFlight }
const _lastWsTick = new Map();      // sym -> epoch ms of last WS trade
let _ws = null;
let _connecting = false;
let _reconnectAt = 0;
let _activeClients = 0;
let _reconnectTimer = null;
let _fallbackTimer = null;
let _wsFactory = null;              // test injection
let _fetchImpl = null;              // test injection

// Poll tuning. Market open: gap symbols refreshed every 5s (maxAge 4s).
// Market closed: prices are static — a 60s refresh is plenty (1 call/min/sym).
const FALLBACK_POLL_MS = 5000;
const WS_GAP_MS = 10 * 1000;        // no WS trade for 10s → Yahoo fallback owns the symbol
const SESSION_FRESH_OPEN_MS = 4000;      // market open: re-fetch if older than 4s
const SESSION_FRESH_CLOSED_MS = 60 * 1000; // market closed: re-fetch if older than 60s
const YAHOO_TIMEOUT_MS = 5000;
const MAX_FALLBACK_BATCH = 12;      // per-cycle round-robin cap (Yahoo rate safety)

// ---------------------------------------------------------------
// Pure helpers (exported for unit tests + reuse in index.js)
// ---------------------------------------------------------------

/** US regular-session hours, America/New_York, Mon-Fri 9:30-16:00. */
export function usMarketOpen(date = new Date()) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York', weekday: 'short', hour: 'numeric', minute: 'numeric', hour12: false,
  }).formatToParts(date);
  const get = (t) => parts.find(p => p.type === t)?.value || '';
  const weekday = get('weekday').substring(0, 3);
  if (weekday === 'Sat' || weekday === 'Sun') return false;
  let h = parseInt(get('hour'), 10);
  if (isNaN(h) || h === 24) h = 0;
  const m = parseInt(get('minute'), 10) || 0;
  const mins = h * 60 + m;
  return mins >= 570 && mins <= 960;
}

/**
 * Finnhub REST freshness gate (fixes RC1 — stale previous-session quotes).
 * The free-tier REST /quote returns the PREVIOUS session close with t=<last
 * close> while the market is open. While the market is open we treat any
 * quote older than 5 minutes as invalid so callers fall through to Yahoo.
 */
export function isStaleUsQuote(quoteTimeMs, nowMs, marketOpen) {
  if (!marketOpen) return false;          // closed market: last close IS the price
  if (!quoteTimeMs || quoteTimeMs <= 0) return false; // no timestamp → trust caller
  return (nowMs - quoteTimeMs) > 5 * 60 * 1000;
}

// ---------------------------------------------------------------
// Test hooks
// ---------------------------------------------------------------
export function _setWsFactoryForTest(fn) { _wsFactory = fn; }
export function _setUsFetchForTest(fn) { _fetchImpl = fn; }
export function _resetUsStreamForTest() {
  _subscribed.clear(); _session.clear(); _lastWsTick.clear();
  _ws = null; _connecting = false; _reconnectAt = 0; _activeClients = 0;
  clearTimeout(_reconnectTimer); _reconnectTimer = null;
  clearInterval(_fallbackTimer); _fallbackTimer = null;
}
export function usDebugState() {
  return {
    activeClients: _activeClients,
    subscribed: [..._subscribed],
    wsOpen: !!(_ws && _ws.readyState === WebSocket.OPEN),
    reconnectAt: _reconnectAt,
    lastWsTick: Object.fromEntries(_lastWsTick),
    fallbackTimer: !!_fallbackTimer,
  };
}

const _fetch = (url, opts) => (_fetchImpl || globalThis.fetch)(url, opts);
const _makeWs = (url) => (_wsFactory ? _wsFactory(url) : new WebSocket(url));

export function usStreamEnabled() { return !!KEY; }

export function usClientUp() {
  _activeClients++;
  _ensureConnected();
  _startFallbackPoller();
}

export function usClientDown() {
  _activeClients = Math.max(0, _activeClients - 1);
  if (_activeClients === 0) {
    _disconnect();
    clearInterval(_fallbackTimer);
    _fallbackTimer = null;
  }
}

function _disconnect() {
  if (_ws) { try { _ws.close(); } catch { } _ws = null; }
  _connecting = false;
  clearTimeout(_reconnectTimer);
  _reconnectTimer = null;
  // NOTE: _reconnectAt is intentionally left as-is; _ensureConnected()
  // re-schedules a timer for the remaining backoff when a new client
  // arrives (fixes the reconnect deadlock where the cleared timer plus a
  // future _reconnectAt refused _connect() forever for a new client).
}

// FIX (audit M-2 + deadlock): one place decides whether to connect NOW or
// (re)schedule. Previously a cleared timer + future _reconnectAt deadlocked.
function _ensureConnected() {
  if (!WS_URL || (_ws && _ws.readyState === WebSocket.OPEN)) return;
  if (_connecting) return;
  if (Date.now() < _reconnectAt) {
    _scheduleReconnect(_reconnectAt - Date.now());
    return;
  }
  _connect();
}

function _scheduleReconnect(delayMs) {
  clearTimeout(_reconnectTimer);
  _reconnectAt = Math.max(_reconnectAt, Date.now() + delayMs);
  _reconnectTimer = setTimeout(() => {
    _reconnectTimer = null;
    if (_activeClients > 0) _connect();
  }, Math.max(0, delayMs));
  if (typeof _reconnectTimer.unref === 'function') _reconnectTimer.unref();
}

// ---------------------------------------------------------------
// Yahoo session bootstrap / fallback (live, keyless, correct prevClose)
// ---------------------------------------------------------------
function _fetchYahooSession(sym) {
  // Cache with in-flight sharing: concurrent callers (bootstrap + fallback
  // poller) share ONE round-trip. Entry is either a clean value or a wrapper
  // holding { inFlight: promise } while the fetch is running.
  const cached = _session.get(sym);
  const maxAge = usMarketOpen() ? SESSION_FRESH_OPEN_MS : SESSION_FRESH_CLOSED_MS;
  if (cached && !cached.inFlight && (Date.now() - cached.at) < maxAge) return Promise.resolve(cached);
  if (cached && cached.inFlight) return cached.inFlight;

  const prev = cached ? { ...cached } : null; // clean snapshot (cached is a value here)
  const p = (async () => {
    let out = null;
    try {
      const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(sym)}?interval=5m&range=1d`;
      const r = await _fetch(url, {
        headers: { 'User-Agent': 'Mozilla/5.0 (WealthAI US realtime stream)' },
        signal: AbortSignal.timeout(YAHOO_TIMEOUT_MS),
      });
      if (r.ok) {
        const j = await r.json();
        const m = j?.chart?.result?.[0]?.meta;
        const price = m?.regularMarketPrice;
        if (typeof price === 'number' && price > 0) {
          const pc = (typeof m.chartPreviousClose === 'number' && m.chartPreviousClose > 0)
            ? m.chartPreviousClose
            : (typeof m.previousClose === 'number' ? m.previousClose : price);
          out = {
            price, pc,
            high: m.regularMarketDayHigh || price,
            low: m.regularMarketDayLow || price,
            vol: m.regularMarketVolume || 0,
            t: (m.regularMarketTime ? m.regularMarketTime * 1000 : Date.now()),
            at: Date.now(),
          };
        }
      }
    } catch { /* upstream transient */ }
    let result;
    if (out) result = out;
    else if (prev && prev.price > 0) {
      // Yahoo failed → serve last-known price, retry in ~5s (at is nudged so
      // the cache goes stale quickly without hammering a dead upstream).
      result = { ...prev, at: Date.now() - maxAge + 5000 };
    } else {
      result = { price: 0, pc: 0, high: 0, low: 0, vol: 0, t: 0, at: Date.now() };
    }
    _session.set(sym, result); // clean value — replaces the inFlight wrapper
    return result;
  })();
  _session.set(sym, { ...(prev || { price: 0, pc: 0, at: 0 }), inFlight: p });
  return p;
}

/**
 * Freshest-known US quote from the running stream session (shared with
 * /api/quote so the browser poller and the SSE stream don't BOTH hit
 * Yahoo for the same symbol — ONE round-trip serves both consumers).
 * Returns null when the session is stale/absent so the caller falls back.
 */
export function getUsSessionQuote(sym, opts = {}) {
  const s = _session.get(String(sym || '').toUpperCase());
  if (!s || !(s.price > 0) || s.inFlight) return null;
  const maxStale = opts.maxStaleMs || (usMarketOpen() ? 8000 : 90 * 1000);
  const freshest = Math.max(s.at || 0, s.wsAt || 0);
  if (Date.now() - freshest > maxStale) return null;
  return {
    price: s.price,
    change: s.pc ? ((s.price - s.pc) / s.pc) * 100 : 0,
    high: s.high || s.price,
    low: s.low || s.price,
    volume: s.vol || 0,
    prevClose: s.pc || s.price,
    time: s.t || freshest || Date.now(),
    source: (s.wsAt && (!s.at || s.wsAt >= s.at)) ? 'finnhub-stream' : 'yahoo-us-fallback',
  };
}

/** Finnhub REST quote — LAST RESORT (Yahoo down). Freshness-gated. */
async function _fetchFinnhubSession(sym) {
  if (!KEY) return null;
  try {
    const r = await _fetch(`https://finnhub.io/api/v1/quote?symbol=${encodeURIComponent(sym)}&token=${KEY}`,
      { signal: AbortSignal.timeout(5000) });
    if (!r.ok) return null;
    const j = await r.json();
    if (!j || typeof j.c !== 'number' || j.c <= 0) return null;
    // Stale while market open (previous-session close) → reject (caller keeps Yahoo/last).
    if (isStaleUsQuote(j.t ? j.t * 1000 : 0, Date.now(), usMarketOpen())) return null;
    return {
      price: j.c,
      pc: j.pc || j.c,
      high: j.h || j.c,
      low: j.l || j.c,
      vol: 0,
      t: j.t ? j.t * 1000 : Date.now(),
      at: Date.now(),
    };
  } catch { return null; }
}

/** Instant live snapshot for a newly-subscribed symbol (Yahoo first). */
async function _bootstrapSymbol(sym) {
  let s = await _fetchYahooSession(sym);
  let source = 'yahoo-us-fallback';
  if (!(s.price > 0)) {
    const fh = await _fetchFinnhubSession(sym);
    if (fh) { s = fh; source = 'finnhub-stream'; }
  }
  if (s.price > 0) {
    setTick(`US_${sym}`, {
      price: s.price,
      change: s.pc ? ((s.price - s.pc) / s.pc) * 100 : 0,
      high: s.high || s.price,
      low: s.low || s.price,
      volume: s.vol || 0,
      time: s.t || Date.now(),
    }, source);
  }
}

// ---------------------------------------------------------------
// WS-gap fallback poller — the SPY/SMH/VGT/VOGH lifesaver (RC2)
// ---------------------------------------------------------------
function _startFallbackPoller() {
  if (_fallbackTimer || _subscribed.size === 0) return;
  _fallbackTimer = setInterval(_fallbackPoll, FALLBACK_POLL_MS);
  if (typeof _fallbackTimer.unref === 'function') _fallbackTimer.unref();
}

let _fbCursor = 0;
async function _fallbackPoll() {
  try {
    if (_activeClients === 0 || _subscribed.size === 0) return;

    // Symbols the WS has NOT ticked recently → Yahoo owns them.
    const now = Date.now();
    const gaps = [..._subscribed].filter(sym => (now - (_lastWsTick.get(sym) || 0)) > WS_GAP_MS);
    if (gaps.length === 0) return;

    // Round-robin cap keeps upstream load bounded for big watchlists.
    const batch = [];
    for (let i = 0; i < Math.min(gaps.length, MAX_FALLBACK_BATCH); i++) {
      batch.push(gaps[(_fbCursor + i) % gaps.length]);
    }
    _fbCursor = ( _fbCursor + batch.length) % Math.max(1, gaps.length);

    await Promise.allSettled(batch.map(async (sym) => {
      const s = await _fetchYahooSession(sym);
      if (!(s.price > 0)) return;
      // Don't stomp a fresher WS tick that arrived while we were fetching.
      const lastWs = _lastWsTick.get(sym) || 0;
      if (lastWs > (s.at || 0)) return;
      setTick(`US_${sym}`, {
        price: s.price,
        change: s.pc ? ((s.price - s.pc) / s.pc) * 100 : 0,
        high: s.high || s.price,
        low: s.low || s.price,
        volume: s.vol || 0,
        time: s.t || Date.now(),
      }, 'yahoo-us-fallback');
    }));
  } catch { /* transient — retry next cycle */ }
}

// ---------------------------------------------------------------
// Finnhub WebSocket (primary push source)
// ---------------------------------------------------------------
function _connect() {
  if (!WS_URL || _connecting || (_ws && _ws.readyState === WebSocket.OPEN)) return;
  if (_activeClients === 0) return; // don't connect if no clients
  if (Date.now() < _reconnectAt) { _scheduleReconnect(_reconnectAt - Date.now()); return; }
  _connecting = true;
  try {
    const ws = _makeWs(WS_URL);
    _ws = ws;
    ws.on('open', () => {
      _connecting = false;
      for (const s of _subscribed) ws.send(JSON.stringify({ type: 'subscribe', symbol: s }));
    });
    ws.on('message', (raw) => {
      let msg; try { msg = JSON.parse(raw.toString()); } catch { return; }
      if (msg.type !== 'trade' || !Array.isArray(msg.data)) return;
      const latest = {};
      for (const t of msg.data) latest[t.s] = t;
      for (const sym of Object.keys(latest)) {
        if (!_subscribed.has(sym)) continue; // not ours (e.g. dropped long ago)
        const t = latest[sym];
        const price = t.p;
        if (!(price > 0)) continue;
        _lastWsTick.set(sym, Date.now());
        const ref = _session.get(sym);
        const pc = ref?.pc || 0;
        setTick(`US_${sym}`, {
          price,
          change: pc ? ((price - pc) / pc) * 100 : 0,
          high: Math.max(ref?.high || price, price),
          low: (ref?.low && ref.low < price) ? ref.low : price,
          volume: (typeof t.v === 'number' && t.v > 0) ? t.v : 0,
          time: t.t || Date.now(),
        }, 'finnhub-stream');
        // Track the session running high/low + freshest price so they don't
        // go stale (getUsSessionQuote serves /api/quote from this).
        if (ref) {
          ref.price = price;
          ref.t = t.t || Date.now();
          ref.wsAt = Date.now();
          if (price > (ref.high || 0)) ref.high = price;
          if (!ref.low || price < ref.low) ref.low = price;
        }
      }
    });
    ws.on('close', () => {
      _connecting = false; _ws = null;
      // Only reconnect if clients still active (FIX audit M-2: actually schedule it).
      if (_activeClients > 0) _scheduleReconnect(3000);
    });
    ws.on('error', () => {
      _connecting = false; try { ws.close(); } catch { }
      _ws = null;
      if (_activeClients > 0) _scheduleReconnect(5000);
    });
  } catch { _connecting = false; _scheduleReconnect(5000); }
}

// ---------------------------------------------------------------
// Subscription API (called from /api/stream)
// ---------------------------------------------------------------
export function ensureUsSubscribed(symbols) {
  const fresh = [];
  for (const s of symbols || []) {
    const sym = String(s).replace('.NS', '').replace('.BO', '').trim().toUpperCase();
    if (!sym) continue;
    if (!_subscribed.has(sym)) {
      _subscribed.add(sym);
      fresh.push(sym);
      _bootstrapSymbol(sym); // instant live Yahoo snapshot (RC3 fix)
    }
  }
  // (Re)connect / subscribe on the live socket when clients are already active.
  if (_activeClients > 0) {
    _ensureConnected();
    _startFallbackPoller();
    if (_ws && _ws.readyState === WebSocket.OPEN && fresh.length) {
      fresh.forEach(s => { try { _ws.send(JSON.stringify({ type: 'subscribe', symbol: s })); } catch { /* reconnect will resubscribe */ } });
    }
  }
}

// Housekeeping: keep the session map bounded.
setInterval(() => {
  if (_session.size > 500) {
    const cutoff = Date.now() - 10 * 60 * 1000;
    for (const [k, v] of _session) if ((v.at || 0) < cutoff && !v.inFlight) _session.delete(k);
  }
}, 5 * 60 * 1000).unref?.();
