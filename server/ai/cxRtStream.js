// ============================================================
// server/ai/cxRtStream.js — v10.11 COINDCX DIRECT ULTRA-FAST RT
// ------------------------------------------------------------
// THE BUG (user report, v10.10): the CoinDCX tab's three desks — SPOT,
// GLOBAL FUTURES (USDT perps) and EQUITY SIM (USDC) — showed
// signal-card prices that were minutes old (board cache 90s +
// futures price cache 20s + frontend 30s poll). Stale LTP next to
// a fresh-looking call = "wrong call / wrong signal" experience.
//
// THE v10.10 FIX: a dedicated 2s DIRECT-from-CoinDCX poller that feeds
// liveFeed (and therefore the /api/stream SSE) for the two domains the
// existing streams never covered:
//   FUT_<BASE>   B-<BASE>_USDT perp LTP   (public.coindcx.com
//                /market_data/v3/current_prices/futures/rt)
//   GLOB_<SYM>   B-<SYM>_USDC global equity perp LTP (same feed,
//                USDC margin domain — CoinDCX app parity) with the
//                Finnhub fallback first and Yahoo as the final
//                fallback (10s cadence, never 2s) for names the RT
//                feed doesn't carry.
// SPOT needs nothing new — cryptoStream already publishes INR ticks
// at 2s (CoinDCX anchor) with the ~1s Binance WS accelerator.
//
// THE v10.11 UPGRADE (user plan #1/#3/#5):
//   • WEBSOCKET ACCELERATOR — CoinDCX's documented futures socket
//     (wss://stream.coindcx.com, Socket.IO v2 / Engine.IO 3, channel
//     "B-<PAIR>@prices-futures", event "price-change") pushes ticks
//     EVENT-DRIVEN — no 2s ceiling while it flows. The REST poller
//     becomes the degrade path + the illiquidity floor:
//       WS healthy (attributable ticks < 30s old)  → REST @ 10s floor
//       WS down / unproven / silent-contract       → REST @ 2s (v10.10)
//     The "healthy" proof is an ACTUAL landed tick — a socket that
//     connects but never yields an attributable price-change (docs'
//     sample payload is incomplete, so attribution is best-effort)
//     keeps the full 2s REST cadence: ZERO regression possible.
//   • SOURCE TRANSPARENCY (#1) — every tick carries its source label:
//     'coindcx-fut-rt' / 'coindcx-fut-ws' (USDT perps), 'coindcx-glob-rt'
//     / 'coindcx-glob-ws' (USDC equity perps), 'finnhub-global-rt'
//     (fallback #1), 'yahoo-global-rt' (final fallback), 'global-sim-rt'
//     (SPACEX), 'binance-fut-rt' (CoinDCX-dark fallback). The SSE wire
//     carries it as `source` and the frontend renders the badge.
//
// Behaviour mirrors cryptoStream.js (the proven pattern):
//   • refcounted per-symbol subscriptions, graceful 90s eviction
//   • timer only runs while ≥1 SSE client is connected (Render
//     free-tier friendly — zero upstream cost when nobody watches)
//   • shared single-flight upstream fetches (futures.js /
//     globalFutures.js own the caches; we just ask for ≤1.3s-fresh
//     data, so the stream and the board compute share round-trips)
//   • serve-stale on transient failure: liveFeed keeps the last
//     good tick; the SSE throttle hides sub-400ms jitter.
// ============================================================
import { setTick, getTick } from '../liveFeed.js';
import { fetchFuturesPrices } from './futures.js';
import { fetchGlobalFuturesRt, fetchGlobalQuotes, syntheticPriceAt, GLOBAL_FUTURES_UNIVERSE } from './globalFutures.js';
import { createCxSocketIo } from './cxSocketIo.js';

const POLL_MS = 2000;              // full-speed REST cadence (WS down / unproven)
const REST_HEARTBEAT_MS = 10_000;  // REST floor cadence (WS healthy + writing)
const RT_MAX_AGE_MS = 1300;        // ask the shared caches for ≤1.3s-old rows
const FALLBACK_MS = 10_000;        // Finnhub/Yahoo fallback cadence (rate-polite)
const EVICT_GRACE_MS = 90_000;     // unsubscribes wait for SSE auto-reconnect
// Binance perp fallback (the SAME chain the futures board itself uses when
// CoinDCX RT goes dark — 1:1 USDT domain, zero projection risk). Cached 5s
// so a WAF blip on CoinDCX never stalls the stream longer than one beat.
const BINANCE_FUT_URL = 'https://fapi.binance.com/fapi/v1/ticker/24hr';
const BINANCE_FUT_CACHE_MS = 5_000;
let _bnFut = { at: 0, byBase: null }; // { at, byBase: Map<BASE, row> }

// ---- v10.11 CoinDCX futures WebSocket (docs.coindcx.com) ----
const DCX_WS_URL = 'wss://stream.coindcx.com/socket.io/?EIO=3&transport=websocket';
const WS_TICK_FRESH_MS = 30_000;      // a landed tick within 30s proves the WS contract works
const WS_SILENT_KILL_MS = 120_000;    // ns-connected but ZERO attributable ticks → contract mismatch
const WS_FAIL_LIMIT = 3;              // consecutive handshake failures → cooldown
const WS_COOLDOWN_MS = 10 * 60_000;   // then stop hammering the socket for 10 min
const WS_RECONNECT_MS = 3_000;        // base reconnect delay (backoff ×2 → 24s cap)

// ---- per-domain state (same shape as cryptoStream's spot book) ----
const _futSubscribed = new Set();      // BASE (BTC, ETH, …)
const _globSubscribed = new Set();     // SYM (AAPL, NVDA, …)
const _futRefcounts = new Map();
const _globRefcounts = new Map();
const _evictTimers = new Map();        // "FUT:BTC" / "GLOB:AAPL" → timer
let _timer = null;
let _timerMs = 0;                      // current REST interval (2s or 10s floor)
let _activeClients = 0;
let _fallbackAt = 0;                   // last Finnhub/Yahoo fallback fetch epoch

// ---- WS state ----
let _io = null;                        // the cxSocketIo controller
let _wsFactory = null;                 // test injection
let _wsEnabled = true;                 // production ON; _resetCxRtForTest disables (hermetic suites)
let _wsFailStreak = 0;                 // consecutive handshake failures
let _wsDisabledUntil = 0;              // circuit-breaker cooldown
let _wsReconnectTimer = null;
let _wsLastTickAt = 0;                 // last ATTRIBUTABLE WS tick epoch (the proof)
let _wsOpenedAt = 0;                   // ns-connect epoch (silent-contract watchdog)

// test injection
let _nowFn = () => Date.now();
export function _setCxRtNowForTest(fn) { _nowFn = fn || (() => Date.now()); }
export function _setDcxWsFactoryForTest(fn) { _wsFactory = fn; }
export function _setDcxWsEnabledForTest(v) { _wsEnabled = !!v; }

const _num = (v) => { const n = typeof v === 'number' ? v : parseFloat(String(v ?? '')); return Number.isFinite(n) ? n : 0; };

// ---------------------------------------------------------------
// Client lifecycle — start/stop the REST poller + WS with the
// connection count (exactly cryptoClientUp/cryptoClientDown semantics).
// ---------------------------------------------------------------
export function cxRtClientUp() { _activeClients++; _startIfNeeded(); }
export function cxRtClientDown() { _activeClients = Math.max(0, _activeClients - 1); _stopIfIdle(); }

function _startIfNeeded() {
  if (_timer || (_futSubscribed.size === 0 && _globSubscribed.size === 0)) return;
  _pollOnce(); // instant first tick — a fresh page paints live prices NOW
  _timerMs = _restIntervalMs();
  _timer = setInterval(_pollOnce, _timerMs);
  if (_timer.unref) _timer.unref();
  _ensureWs();
}

function _stopIfIdle() {
  if (_activeClients > 0 || !_timer) return;
  clearInterval(_timer);
  _timer = null;
  _closeWs('idle');
}

/** REST cadence: 10s floor while the WS is proven writing ticks
 *  (event-driven freshness + a guaranteed floor for illiquid perp
 *  channels that can go minutes without a price-change event);
 *  full 2s whenever the WS is down / unproven / silent. */
function _restIntervalMs() {
  return _wsHealthy() ? REST_HEARTBEAT_MS : POLL_MS;
}

/** Healthy = ns-connected AND an attributable tick landed recently.
 *  Connection alone proves nothing (the event payload's attribution
 *  shape is best-effort from incomplete docs) — only a LANDED tick
 *  downgrades the REST cadence, so the desks can never regress. */
function _wsHealthy() {
  return !!_io
    && _io.state().connected
    && (_nowFn() - _wsLastTickAt) < WS_TICK_FRESH_MS;
}

/** Restart the REST interval when the desired cadence flips
 *  (WS healed → slow to 10s floor; WS dropped → back to 2s). */
function _syncRestCadence() {
  if (!_timer) return;
  const want = _restIntervalMs();
  if (want === _timerMs) return;
  clearInterval(_timer);
  _timerMs = want;
  _timer = setInterval(_pollOnce, _timerMs);
  if (_timer.unref) _timer.unref();
}

// ---------------------------------------------------------------
// Subscriptions (refcounted, graceful eviction — the cryptoStream
// M2 pattern: the subscribed set must never grow forever).
// ---------------------------------------------------------------
export function ensureCxRtSubscribed({ fut, glob } = {}) {
  const newFut = [];
  const newGlob = [];
  for (const s of fut || []) {
    const base = String(s).trim().toUpperCase();
    if (!base) continue;
    _cancelEviction(`FUT:${base}`);
    _futRefcounts.set(base, (_futRefcounts.get(base) || 0) + 1);
    if (!_futSubscribed.has(base)) { _futSubscribed.add(base); newFut.push(base); }
  }
  for (const s of glob || []) {
    const sym = String(s).trim().toUpperCase();
    if (!sym) continue;
    _cancelEviction(`GLOB:${sym}`);
    _globRefcounts.set(sym, (_globRefcounts.get(sym) || 0) + 1);
    if (!_globSubscribed.has(sym)) { _globSubscribed.add(sym); newGlob.push(sym); }
  }
  // live socket → join the NEW channels immediately (no reconnect needed)
  if (_io && _io.state().connected) {
    for (const base of newFut) _io.join(_futChannel(base));
    for (const sym of newGlob) _io.join(_globChannel(sym));
  }
  // a fresh universe while clients are live → immediate poll so the
  // new symbols get their first tick within ~2s, not POLL_MS + lag.
  if (_activeClients > 0 && (newFut.length || newGlob.length)) {
    if (!_timer) _startIfNeeded();
    else { _ensureWs(); _pollOnce(); }
  }
}

export function releaseCxRtSubscribed({ fut, glob } = {}) {
  for (const s of fut || []) {
    const base = String(s).trim().toUpperCase();
    if (!base) continue;
    const n = (_futRefcounts.get(base) || 1) - 1;
    if (n > 0) { _futRefcounts.set(base, n); continue; }
    _futRefcounts.delete(base);
    _scheduleEviction('FUT', base, () => { _futSubscribed.delete(base); _leaveChannel(_futChannel(base)); });
  }
  for (const s of glob || []) {
    const sym = String(s).trim().toUpperCase();
    if (!sym) continue;
    const n = (_globRefcounts.get(sym) || 1) - 1;
    if (n > 0) { _globRefcounts.set(sym, n); continue; }
    _globRefcounts.delete(sym);
    _scheduleEviction('GLOB', sym, () => { _globSubscribed.delete(sym); _leaveChannel(_globChannel(sym)); });
  }
}

function _scheduleEviction(domain, sym, fn) {
  const key = `${domain}:${sym}`;
  if (_evictTimers.has(key)) return;
  const t = setTimeout(() => {
    _evictTimers.delete(key);
    // someone re-subscribed meanwhile → keep polling
    if (domain === 'FUT' ? _futRefcounts.has(sym) : _globRefcounts.has(sym)) return;
    fn();
  }, EVICT_GRACE_MS);
  if (typeof t.unref === 'function') t.unref();
  _evictTimers.set(key, t);
}

function _cancelEviction(key) {
  if (_evictTimers.has(key)) {
    clearTimeout(_evictTimers.get(key));
    _evictTimers.delete(key);
  }
}

// ---------------------------------------------------------------
// The REST poll — DIRECT CoinDCX, both perpetual domains in one
// tick so the browser gets a coherent snapshot per beat. This is
// now the degrade path + the illiquidity floor under the WS.
// ---------------------------------------------------------------
async function _pollOnce() {
  if (_activeClients === 0) return;
  const now = _nowFn();
  const jobs = [];
  if (_futSubscribed.size > 0) jobs.push(_pollFutures(now));
  if (_globSubscribed.size > 0) jobs.push(_pollGlobal(now));
  await Promise.allSettled(jobs);
  _wsSilentContractWatchdog(now);
  _syncRestCadence();
  // post-cooldown recovery: a watchdog kill / circuit-breaker arms NO
  // reconnect timer (by design), so the next REST beat retries the WS
  // once the cooldown has expired. Without this, a single silent-contract
  // kill would keep the accelerator off for the whole process lifetime.
  _ensureWs();
}

async function _pollFutures(_now) {
  const covered = new Set();
  try {
    const rows = await fetchFuturesPrices({ maxAgeMs: RT_MAX_AGE_MS });
    if (Array.isArray(rows)) {
      // one pass — subscribed bases only (the whole RT book is ~100 rows)
      const byBase = new Map(rows.map(r => [r.base, r]));
      for (const base of _futSubscribed) {
        const r = byBase.get(base);
        if (!r || !(r.last > 0)) continue;
        covered.add(base);
        const chg = Number(r.changePct) || 0;
        setTick(`FUT_${base}`, {
          price: r.last,
          change: chg,
          high: r.high > 0 ? r.high : r.last,
          low: r.low > 0 ? r.low : r.last,
          volume: r.volume || 0,
          time: r.ts > 0 ? r.ts : _nowFn(),
          prevClose: chg > -100 ? r.last / (1 + chg / 100) : undefined,
        }, 'coindcx-fut-rt');
      }
    }
  } catch { /* transient upstream failure — fallback below + liveFeed serves the last good tick */ }
  // CoinDCX RT dark (WAF blip / 403 / timeout) → Binance USDT perps, same
  // domain, honestly labeled. The stream never goes silent on one feed.
  const missing = [..._futSubscribed].filter(b => !covered.has(b));
  if (missing.length > 0) {
    const byBase = await _binanceFutBook().catch(() => null);
    if (byBase) {
      for (const base of missing) {
        const r = byBase.get(base);
        if (!r || !(r.last > 0)) continue;
        const chg = Number(r.changePct) || 0;
        setTick(`FUT_${base}`, {
          price: r.last,
          change: chg,
          high: r.high > 0 ? r.high : r.last,
          low: r.low > 0 ? r.low : r.last,
          volume: r.volume || 0,
          time: _nowFn(),
          prevClose: chg > -100 ? r.last / (1 + chg / 100) : undefined,
        }, 'binance-fut-rt');
      }
    }
  }
}

/** Binance USDT-perp 24h ticker book, Map<BASE, row>, 5s cache — the
 *  fallback chain for the FUT domain (mirrors the board's own).
 *  Test-injectable via _setBinanceFutFetchForTest. */
let _bnFutFetchImpl = null;
export function _setBinanceFutFetchForTest(fn) { _bnFutFetchImpl = fn; }
async function _binanceFutBook() {
  const now = _nowFn();
  if (_bnFut.byBase && (now - _bnFut.at) < BINANCE_FUT_CACHE_MS) return _bnFut.byBase;
  const f = _bnFutFetchImpl || globalThis.fetch;
  const r = await f(BINANCE_FUT_URL, {
    headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
    signal: AbortSignal.timeout(6000),
  });
  if (!r.ok) throw new Error(`binance fut HTTP ${r.status}`);
  const j = await r.json();
  if (!Array.isArray(j)) throw new Error('binance fut: bad payload');
  const byBase = new Map();
  for (const x of j) {
    if (!x || typeof x.symbol !== 'string' || !x.symbol.endsWith('USDT')) continue;
    const base = x.symbol.slice(0, -4);
    const last = parseFloat(x.lastPrice);
    if (!base || !(last > 0)) continue;
    byBase.set(base, {
      last,
      changePct: parseFloat(x.priceChangePercent) || 0,
      high: parseFloat(x.highPrice) || 0,
      low: parseFloat(x.lowPrice) || 0,
      volume: parseFloat(x.volume) || 0,
    });
  }
  if (byBase.size === 0) throw new Error('binance fut: empty');
  _bnFut = { at: now, byBase };
  return byBase;
}

async function _pollGlobal(now) {
  try {
    // 1) CoinDCX USDC perp RT — the app-parity direct feed (2s)
    const rt = await fetchGlobalFuturesRt({ maxAgeMs: RT_MAX_AGE_MS }).catch(() => null);
    const covered = new Set();
    if (rt && rt.size > 0) {
      for (const sym of _globSubscribed) {
        const row = rt.get(sym);
        if (!row || !(row.price > 0)) continue;
        covered.add(sym);
        const chg = Number(row.changePct) || 0;
        setTick(`GLOB_${sym}`, {
          price: row.price,
          change: chg,
          high: row.high > 0 ? row.high : row.price,
          low: row.low > 0 ? row.low : row.price,
          volume: row.volume || 0,
          time: row.ts > 0 ? row.ts : now,
          prevClose: chg > -100 ? row.price / (1 + chg / 100) : undefined,
        }, 'coindcx-glob-rt');
      }
    }
    // 2) Finnhub-first / Yahoo-final fallback — ONLY names the RT feed
    //    doesn't carry, and only every 10s (the shared Finnhub key is
    //    rate-limited at 55/min; Yahoo politely tolerates 10s polls).
    const missing = [..._globSubscribed].filter(s => !covered.has(s));
    if (missing.length > 0) {
      if (now - _fallbackAt >= FALLBACK_MS) {
        _fallbackAt = now;
        const q = await fetchGlobalQuotes({ maxAgeMs: FALLBACK_MS }).catch(() => null);
        if (q) {
          for (const sym of missing) {
            const row = q.get(sym);
            if (!row || !(row.price > 0)) continue;
            // SIM rows (source 'sim') skip here — the dedicated synthetic
            // branch below ticks them at the TRUE 2s cadence with the
            // honest 'global-sim-rt' label.
            if (row.sim) continue;
            covered.add(sym);
            const chg = Number(row.changePct) || 0;
            // v10.11 (#1): the honest source label — Finnhub served it or
            // Yahoo did; the frontend badge shows exactly which.
            const src = row.source === 'finnhub' ? 'finnhub-global-rt' : 'yahoo-global-rt';
            setTick(`GLOB_${sym}`, {
              price: row.price,
              change: chg,
              high: row.high > 0 ? row.high : row.price,
              low: row.low > 0 ? row.low : row.price,
              volume: row.volume || 0,
              time: row.ts > 0 ? row.ts : _nowFn(),
              prevClose: chg > -100 ? row.price / (1 + chg / 100) : undefined,
            }, src);
          }
        }
      }
      // 3) SIM names (SPACEX — no public price exists BY DESIGN) — the
      //    deterministic synthetic walk ticks them live at the same 2s
      //    cadence, honestly labeled so the SIM desk never looks frozen.
      const simSet = new Set(GLOBAL_FUTURES_UNIVERSE.filter(u => u.sim).map(u => u.symbol));
      for (const sym of missing) {
        if (covered.has(sym) || !simSet.has(sym)) continue;
        const price = syntheticPriceAt(sym, now);
        if (!(price > 0)) continue;
        const prev = syntheticPriceAt(sym, now - 24 * 3600_000);
        setTick(`GLOB_${sym}`, {
          price,
          change: prev > 0 ? (price / prev - 1) * 100 : 0,
          high: price, low: price, volume: 0,
          time: now,
          prevClose: prev > 0 ? prev : undefined,
        }, 'global-sim-rt');
      }
    }
  } catch { /* transient — retry next beat */ }
}

// ---------------------------------------------------------------
// v10.11 THE WEBSOCKET ACCELERATOR — CoinDCX's documented futures
// socket pushes price-change events per instrument; each ATTRIBUTABLE
// event lands in liveFeed immediately (no 2s REST ceiling). Lifecycle
// mirrors cryptoStream's Binance accelerator: handshake watchdog,
// fail-streak circuit breaker, reconnect backoff, idle-close.
// ---------------------------------------------------------------
const _futChannel = (base) => `B-${base}_USDT@prices-futures`;
const _globChannel = (sym) => `B-${sym}_USDC@prices-futures`;

function _ensureWs() {
  if (!_wsEnabled) return;
  if (_activeClients === 0) return;
  if (_futSubscribed.size === 0 && _globSubscribed.size === 0) return;
  if (_nowFn() < _wsDisabledUntil) return;
  if (_io) return;
  let io;
  try {
    io = createCxSocketIo({
      url: DCX_WS_URL,
      wsFactory: _wsFactory || undefined,
      nowFn: _nowFn,
      onEvent: _onWsEvent,
      onOpen: () => {
        _wsFailStreak = 0;      // handshake made it — normal liveness
        _wsOpenedAt = _nowFn(); // silent-contract watchdog starts HERE
        _syncRestCadence();
      },
      onClose: (wasNs) => {
        // handshake never completed (geo-block / auth reject) → streak;
        // a live ns-connected socket that dropped is NOT a contract
        // failure (WAF blips close healthy sockets all day) — just reconnect.
        if (!wasNs) _registerWsFailure();
        _io = null;
        _wsLastTickAt = 0;      // unproven again → REST back to full 2s NOW
        _syncRestCadence();
        if (_activeClients > 0) _scheduleWsReconnect();
      },
    });
  } catch {
    _registerWsFailure();
    return;
  }
  _io = io;
  io.connect();
  // queue the joins (cxSocketIo holds them until the ns-connect ack)
  for (const base of _futSubscribed) io.join(_futChannel(base));
  for (const sym of _globSubscribed) io.join(_globChannel(sym));
}

function _closeWs(reason) {
  if (_wsReconnectTimer) { clearTimeout(_wsReconnectTimer); _wsReconnectTimer = null; }
  if (_io) {
    try { _io.close(); } catch { /* already dead */ }
    _io = null;
  }
  _wsLastTickAt = 0;
}

function _leaveChannel(ch) {
  if (_io && _io.state().connected) {
    try { _io.leave(ch); } catch { /* socket gone — nothing to leave */ }
  }
}

function _registerWsFailure() {
  _wsFailStreak += 1;
  if (_wsFailStreak >= WS_FAIL_LIMIT) {
    _wsDisabledUntil = _nowFn() + WS_COOLDOWN_MS;
    _wsFailStreak = 0;
  }
}

function _scheduleWsReconnect() {
  if (_wsReconnectTimer || _nowFn() < _wsDisabledUntil) return;
  const delay = Math.min(24_000, WS_RECONNECT_MS * 2 ** Math.min(_wsFailStreak, 3));
  _wsReconnectTimer = setTimeout(() => {
    _wsReconnectTimer = null;
    if (_activeClients > 0) _ensureWs();
  }, delay);
  if (_wsReconnectTimer.unref) _wsReconnectTimer.unref();
}

/** ns-connected for 2 minutes with ZERO attributable ticks → the event
 *  payload's attribution shape differs from our best-effort parse. Kill
 *  the socket + cooldown (10 min); the 2s REST poller owns both desks
 *  meanwhile. This is why a docs mismatch can never freeze prices. */
function _wsSilentContractWatchdog(now) {
  if (!_io || !_io.state().connected) return;
  if (_wsLastTickAt > 0) return;                 // ticks ARE landing — healthy
  if (!_wsOpenedAt || (now - _wsOpenedAt) < WS_SILENT_KILL_MS) return;
  _closeWs('silent-contract');
  _wsDisabledUntil = now + WS_COOLDOWN_MS;       // stop re-probing for 10 min
}

/** One price-change event → liveFeed, IF it can be attributed to a
 *  subscribed instrument. Tolerant to every plausible payload shape
 *  (the docs' own sample for this event is empty — repo discipline:
 *  never trust one key shape):
 *    {channelName:'B-BTC_USDT@prices-futures', data:{…}}
 *    {channelName:'…', p:'…'}          (fields inline)
 *    {pair:'B-BTC_USDT', data:{…}}
 *    {prices:{'B-BTC_USDT':{…}, …}}    (book-style full update)
 *  Price fields: p | ls | price | last_price; change: pc | change | dp;
 *  time: T | ts | btST; high/low/volume: h | l | v. */
function _onWsEvent(name, payload) {
  if (name !== 'price-change') return; // only the documented price channel event
  if (!payload || typeof payload !== 'object') return;

  // book-style full update → many ticks at once
  const book = payload.prices && typeof payload.prices === 'object'
    ? payload.prices
    : (payload.data && typeof payload.data === 'object' && payload.data.prices && typeof payload.data.prices === 'object'
      ? payload.data.prices
      : null);
  if (book) {
    for (const [rawKey, d] of Object.entries(book)) {
      const m = String(rawKey).toUpperCase().match(/^B-([A-Z0-9.]+)_(USDT|USDC)$/);
      if (!m) continue;
      _landWsTick(m[2] === 'USDC' ? 'GLOB' : 'FUT', m[1], d);
    }
    return;
  }

  // single event — attribute via channelName / pair
  const chStr = String(payload.channelName || payload.channel || '').toUpperCase();
  const pairStr = String(payload.pair || payload.instrument || '').toUpperCase();
  const m = chStr.match(/^B-([A-Z0-9.]+)_(USDT|USDC)/) || pairStr.match(/^B-([A-Z0-9.]+)_(USDT|USDC)$/);
  if (!m) return; // unattributable — the REST poller keeps the desks alive
  const row = payload.data && typeof payload.data === 'object' && (payload.data.p != null || payload.data.ls != null || payload.data.price != null)
    ? payload.data
    : payload;
  _landWsTick(m[2] === 'USDC' ? 'GLOB' : 'FUT', m[1], row);
}

function _landWsTick(domain, sym, d) {
  // only subscribed symbols (the socket carries the WHOLE channel stream)
  if (domain === 'FUT' ? !_futSubscribed.has(sym) : !_globSubscribed.has(sym)) return;
  if (!d || typeof d !== 'object') return;
  const price = _num(d.p) || _num(d.ls) || _num(d.price) || _num(d.last_price);
  if (!(price > 0)) return;
  const change = _num(d.pc) || _num(d.change) || _num(d.dp) || 0;
  let time = _num(d.T) || _num(d.ts) || _num(d.btST) || _nowFn();
  // v10.13 (deep-recheck M3): epoch UNIT normalization. The guard below
  // compares this tick against ticks written by the REST pollers (futures.js
  // `j.ts`, globalFutures `j.ts` — CoinDCX serves SECONDS) and the
  // Date.now()-ms fallbacks. A seconds-based WS T against a ms-based last
  // tick made the out-of-order guard reject by LUCK of unit order (and a
  // seconds value stored into liveFeed poisoned frontend freshness).
  // Everything is ms from here on: < 1e12 means seconds.
  if (time > 0 && time < 1e12) time *= 1000;
  const key = `${domain}_${sym}`;
  // out-of-order guard — a late WS frame must never regress a newer tick
  const last = getTick(key);
  if (last && last.time > time + 1500) return;
  _wsLastTickAt = _nowFn(); // the HEALTH PROOF — REST slows to the 10s floor
  setTick(key, {
    price,
    change,
    high: _num(d.h) || price,
    low: _num(d.l) || price,
    volume: _num(d.v) || 0,
    time,
    prevClose: change > -100 ? price / (1 + change / 100) : undefined,
  }, domain === 'FUT' ? 'coindcx-fut-ws' : 'coindcx-glob-ws');
  _syncRestCadence(); // the proof just landed — slow REST to the floor NOW
}

// ---------------------------------------------------------------
// Test hooks
// ---------------------------------------------------------------
export function _resetCxRtForTest() {
  _futSubscribed.clear(); _globSubscribed.clear();
  _futRefcounts.clear(); _globRefcounts.clear();
  for (const t of _evictTimers.values()) clearTimeout(t);
  _evictTimers.clear();
  if (_timer) { clearInterval(_timer); _timer = null; }
  _timerMs = 0;
  _activeClients = 0;
  _fallbackAt = 0;
  _bnFut = { at: 0, byBase: null };
  _bnFutFetchImpl = null;
  _closeWs('test-reset');
  if (_wsReconnectTimer) { clearTimeout(_wsReconnectTimer); _wsReconnectTimer = null; }
  _wsFactory = null;
  _wsEnabled = false; // hermetic default — WS suites opt back in via _setDcxWsEnabledForTest(true)
  _wsFailStreak = 0;
  _wsDisabledUntil = 0;
  _wsLastTickAt = 0;
  _wsOpenedAt = 0;
}

/** Direct poll invocation for the regression suite (the interval itself
 *  stays private). Also runs the silent-contract watchdog + cadence sync. */
export async function _pollOnceForTest() { await _pollOnce(); }

export function _cxRtStateForTest() {
  return {
    activeClients: _activeClients,
    timer: !!_timer,
    restMs: _timerMs,
    ws: _io ? _io.state() : { socket: false, connected: false, channels: [] },
    wsHealthy: _wsHealthy(),
    wsDisabledUntil: _wsDisabledUntil,
    fut: [..._futSubscribed],
    glob: [..._globSubscribed],
    fallbackAt: _fallbackAt,
  };
}
