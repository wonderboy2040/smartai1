// cryptoStream — ultra-fast INR crypto feed (server-side, pushed to SSE)
// ---------------------------------------------------------------
// Layer 1 (anchor): CoinDCX public ticker poll every 2s while SSE clients
//   are connected. When no clients → timer pauses → server idle → Render
//   free tier happy.
// Layer 2 (accelerator, 2026 ultra-fast pass): Binance USDT ticker stream
//   (wss://stream.binance.com) — pushes ~1s updates which are PROJECTED
//   into INR using a live anchor ratio:
//       ratio = coindcx_INR_price / binance_USDT_price   (refreshed every
//               CoinDCX poll — captures USD/INR + India premium exactly)
//       projected_INR = binance_USDT × ratio
//   This gives sub-second crypto ticks that never diverge from the true
//   INR price (the ratio re-anchors every 2s, and projection stops if the
//   anchor goes stale >60s). Binance is geo-blocked on some hosts (HTTP
//   451) — the WS simply fails to open there, a 3-failure circuit breaker
//   disables it for 30 minutes, and CoinDCX polling carries on alone.
//
// 2026 perf audit (H2): ONE shared cached round-trip (fetchCoinDcxTickers,
//   in-flight deduped) serves both the SSE poller and /api/crypto-prices;
//   the parsed by-market Map is reused between polls.
// ---------------------------------------------------------------
import WebSocket from 'ws';
import { setTick } from './liveFeed.js';

const POLL_MS = 2000;             // 2s CoinDCX anchor poll (SSE push)
const UPSTREAM_CACHE_MS = 2000;   // shared fetch cache window
const UPSTREAM_STALE_MS = 30000;  // serve-stale window when upstream errors
const EVICT_GRACE_MS = 90000;     // unsubscribes wait for SSE auto-reconnect

// Binance accelerator tuning
const BINANCE_WS_BASE = 'wss://stream.binance.com:9443/stream?streams=';
const BINANCE_MAX_STREAMS = 20;            // cap the combined stream list
const BINANCE_RECONNECT_MS = 5000;
const BINANCE_FAIL_LIMIT = 3;              // consecutive dead handshakes → breaker
const BINANCE_COOLDOWN_MS = 30 * 60 * 1000;
const BINANCE_RESUB_DEBOUNCE_MS = 2000;    // re-connect after universe changes
const ANCHOR_MAX_AGE_MS = 60 * 1000;       // stop projecting on a stale anchor

const _subscribed = new Set();
const _refcounts = new Map();    // base -> number of interested SSE clients
const _evictTimers = new Map();  // base -> pending eviction timer
let _timer = null;
let _activeClients = 0;

export function cryptoStreamEnabled() { return true; }

// ---------------------------------------------------------------
// Shared upstream fetch — used by the SSE poller AND /api/crypto-prices
// ---------------------------------------------------------------
const _upstream = { inFlight: null, at: 0, tickers: null };
const _byMarket = { src: null, map: null };
let _cryptoFetchImpl = null; // test injection
const _cfetch = (url, opts) => (_cryptoFetchImpl || globalThis.fetch)(url, opts);

export function _setCryptoFetchForTest(fn) { _cryptoFetchImpl = fn; }

export async function fetchCoinDcxTickers() {
  const now = Date.now();
  if (_upstream.tickers && (now - _upstream.at) < UPSTREAM_CACHE_MS) return _upstream.tickers;
  if (_upstream.inFlight) return _upstream.inFlight;
  const p = (async () => {
    try {
      const r = await _cfetch(`https://api.coindcx.com/exchange/ticker?t=${Date.now()}`, {
        signal: AbortSignal.timeout(4000),
      });
      if (!r.ok) throw new Error(`CoinDCX upstream ${r.status}`);
      const tickers = await r.json();
      if (!Array.isArray(tickers)) throw new Error('bad payload');
      _upstream.tickers = tickers;
      _upstream.at = Date.now();
      return tickers;
    } catch (e) {
      // Transient upstream failure: serve the stale cache briefly instead of
      // failing every consumer at once.
      if (_upstream.tickers && (Date.now() - _upstream.at) < UPSTREAM_STALE_MS) {
        return _upstream.tickers;
      }
      throw e;
    }
  })();
  _upstream.inFlight = p;
  try { return await p; } finally { _upstream.inFlight = null; }
}

/** Parsed market -> ticker Map, rebuilt only when the upstream array changes. */
function _getByMarket(tickers) {
  if (_byMarket.src !== tickers) {
    const map = new Map();
    for (const t of tickers) map.set(t.market, t);
    _byMarket.src = tickers;
    _byMarket.map = map;
  }
  return _byMarket.map;
}

// Call when an SSE client connects / disconnects
export function cryptoClientUp() { _activeClients++; _startIfNeeded(); }
export function cryptoClientDown() { _activeClients = Math.max(0, _activeClients - 1); _stopIfIdle(); }

function _startIfNeeded() {
  if (_timer || _subscribed.size === 0) return;
  pollOnce();
  _timer = setInterval(pollOnce, POLL_MS);
  if (_timer.unref) _timer.unref();
  _ensureBinanceWs();
}

function _stopIfIdle() {
  if (_activeClients > 0 || !_timer) return;
  clearInterval(_timer);
  _timer = null;
  _closeBinanceWs('idle');
}

// ---------------------------------------------------------------
// Anchor poll (CoinDCX INR — the authoritative price)
// ---------------------------------------------------------------
const _cdcxLast = new Map();  // base -> { price, change, high, low, volume, at }
const _anchorRatio = new Map(); // base -> coindcx_INR / binance_USDT

async function pollOnce() {
  if (_subscribed.size === 0 || _activeClients === 0) return;
  try {
    const tickers = await fetchCoinDcxTickers();
    const byMarket = _getByMarket(tickers);
    for (const base of _subscribed) {
      const t = byMarket.get(`${base}INR`);
      if (!t) continue;
      const price = parseFloat(t.last_price);
      if (!(price > 0)) continue;
      _cdcxLast.set(base, {
        price,
        change: parseFloat(t.change_24_hour) || 0,
        high: parseFloat(t.high) || price,
        low: parseFloat(t.low) || price,
        volume: parseFloat(t.volume) || 0,
        at: Date.now(),
      });
      // Re-anchor the Binance→INR projection ratio.
      const b = _binanceLast.get(base);
      if (b && b.price > 0 && price > 0) _anchorRatio.set(base, price / b.price);
      const chg = parseFloat(t.change_24_hour) || 0;
      setTick(`IN_${base}`, {
        price,
        change: chg,
        high: parseFloat(t.high) || price,
        low: parseFloat(t.low) || price,
        volume: parseFloat(t.volume) || 0,
        time: Date.now(),
        // 24h-ago price (crypto "today" = rolling 24h window)
        prevClose: (chg > -100) ? price / (1 + chg / 100) : undefined,
      }, 'coindcx-live');
    }
  } catch { /* transient — retry next tick */ }
}

// ---------------------------------------------------------------
// Binance USDT ticker accelerator (anchor-ratio INR projection)
// ---------------------------------------------------------------
let _binanceWs = null;
let _binanceStreams = '';          // current stream list (for set-change detect)
let _binanceReconnectTimer = null;
let _binanceResubTimer = null;
let _binanceFailStreak = 0;
let _binanceDisabledUntil = 0;
let _binanceGotData = false;
let _binanceWsFactory = null;      // test injection
const _binanceLast = new Map();    // base -> { price, at } (USDT)

function _binanceTargetStreams() {
  const bases = [..._subscribed].slice(0, BINANCE_MAX_STREAMS);
  return bases.map(b => `${b.toLowerCase()}usdt@ticker`).join('/');
}

function _ensureBinanceWs() {
  if (_activeClients === 0 || _subscribed.size === 0) return;
  if (Date.now() < _binanceDisabledUntil) return;
  const streams = _binanceTargetStreams();
  if (!streams) return;
  if (_binanceWs && _binanceWs.readyState === WebSocket.OPEN && streams === _binanceStreams) return;

  if (_binanceWs || (_binanceWs && _binanceWs.readyState === WebSocket.CONNECTING)) {
    // Universe changed — debounce a swap to a fresh combined stream.
    if (streams !== _binanceStreams) _scheduleBinanceResub();
    return;
  }
  _openBinanceWs(streams);
}

function _scheduleBinanceResub() {
  if (_binanceResubTimer) return;
  _binanceResubTimer = setTimeout(() => {
    _binanceResubTimer = null;
    if (_activeClients === 0) return;
    const streams = _binanceTargetStreams();
    if (!streams || streams === _binanceStreams) return;
    _closeBinanceWs('resub');
    _openBinanceWs(streams);
  }, BINANCE_RESUB_DEBOUNCE_MS);
  if (typeof _binanceResubTimer.unref === 'function') _binanceResubTimer.unref();
}

function _openBinanceWs(streams) {
  try {
    const ws = _binanceWsFactory
      ? _binanceWsFactory(BINANCE_WS_BASE + streams)
      : new WebSocket(BINANCE_WS_BASE + streams);
    _binanceWs = ws;
    _binanceStreams = streams;
    _binanceGotData = false;
    const connectTimeout = setTimeout(() => {
      // Handshake never completed — treat as a failure (geo-block case).
      if (_binanceWs === ws && ws.readyState !== WebSocket.OPEN) {
        try { ws.terminate ? ws.terminate() : ws.close(); } catch { /* noop */ }
      }
    }, 8000);
    if (typeof connectTimeout.unref === 'function') connectTimeout.unref();

    ws.on('open', () => {
      if (_binanceWs !== ws) return;
      clearTimeout(connectTimeout);
    });
    ws.on('message', (raw) => {
      if (_binanceWs !== ws) return;
      _binanceGotData = true;
      _binanceFailStreak = 0;
      let msg; try { msg = JSON.parse(raw.toString()); } catch { return; }
      const d = msg?.data;
      const stream = String(msg?.stream || '');
      if (!d || !stream) return;
      const base = stream.split('usdt@')[0]?.toUpperCase();
      const usdt = parseFloat(d.c);
      if (!base || !(usdt > 0)) return;
      _binanceLast.set(base, { price: usdt, at: Date.now() });
      _projectTick(base, usdt);
    });
    ws.on('close', () => {
      clearTimeout(connectTimeout);
      if (_binanceWs !== ws) return; // stale handler from a replaced socket
      _binanceWs = null;
      _binanceStreams = '';
      _registerBinanceFailure(!_binanceGotData);
      if (_activeClients > 0) _scheduleBinanceReconnect();
    });
    ws.on('error', () => {
      if (_binanceWs !== ws) return;
      _registerBinanceFailure(!_binanceGotData);
      try { ws.close(); } catch { /* noop */ }
    });
  } catch {
    _registerBinanceFailure(true);
  }
}

function _registerBinanceFailure(handshakeFailed) {
  if (!handshakeFailed) return; // a live socket that dropped ≠ geo-block
  _binanceFailStreak++;
  if (_binanceFailStreak >= BINANCE_FAIL_LIMIT) {
    _binanceDisabledUntil = Date.now() + BINANCE_COOLDOWN_MS;
    _binanceFailStreak = 0;
  }
}

function _scheduleBinanceReconnect() {
  if (_binanceReconnectTimer || Date.now() < _binanceDisabledUntil) return;
  _binanceReconnectTimer = setTimeout(() => {
    _binanceReconnectTimer = null;
    if (_activeClients > 0) _ensureBinanceWs();
  }, BINANCE_RECONNECT_MS);
  if (typeof _binanceReconnectTimer.unref === 'function') _binanceReconnectTimer.unref();
}

function _closeBinanceWs(reason) {
  if (_reasonLog) _reasonLog('binance-ws closed: ' + reason);
  if (_binanceReconnectTimer) { clearTimeout(_binanceReconnectTimer); _binanceReconnectTimer = null; }
  if (_binanceResubTimer) { clearTimeout(_binanceResubTimer); _binanceResubTimer = null; }
  if (_binanceWs) {
    try { _binanceWs.removeAllListeners(); _binanceWs.close(); } catch { /* noop */ }
    _binanceWs = null;
  }
  _binanceStreams = '';
}

/** Project a Binance USDT tick into INR using the live anchor ratio. */
function _projectTick(base, usdt) {
  if (!_subscribed.has(base)) return;
  const ratio = _anchorRatio.get(base);
  const anchor = _cdcxLast.get(base);
  if (!(ratio > 0) || !anchor) return;                 // no anchor yet — CoinDCX poll owns the symbol
  if (Date.now() - anchor.at > ANCHOR_MAX_AGE_MS) return; // stale anchor — stop projecting
  const price = usdt * ratio;
  if (!(price > 0)) return;
  const deltaPct = anchor.price > 0 ? (price / anchor.price - 1) * 100 : 0;
  const chg = (anchor.change || 0) + deltaPct;
  setTick(`IN_${base}`, {
    price,
    change: chg,
    high: Math.max(anchor.high || price, price),
    low: Math.min(anchor.low || price, price),
    volume: anchor.volume || 0,
    time: Date.now(),
    prevClose: (chg > -100) ? price / (1 + chg / 100) : undefined,
  }, 'binance-crypto-ws');
}

let _reasonLog = null; // test injection / debug

export function ensureCryptoSubscribed(symbols) {
  // 2026 perf audit fix (H2): an EMPTY list no longer falls back to a default
  // 12-crypto set — previously every SSE connection (even crypto-less ones)
  // dragged the full CoinDCX ticker poll along. Real frontend clients always
  // send their crypto watchlist; nothing else needs a default.
  if (!symbols || !symbols.length) return;
  let universeChanged = false;
  for (const s of symbols) {
    const base = String(s).trim().toUpperCase();
    if (!base) continue;
    // Interested again → cancel any pending eviction.
    if (_evictTimers.has(base)) {
      clearTimeout(_evictTimers.get(base));
      _evictTimers.delete(base);
    }
    _refcounts.set(base, (_refcounts.get(base) || 0) + 1);
    if (!_subscribed.has(base)) { _subscribed.add(base); universeChanged = true; }
  }
  if (_activeClients > 0 && (universeChanged || _binanceWs)) _ensureBinanceWs();
  // Don't start timer here — only start when a client connects via cryptoClientUp()
}

/**
 * Refcount release (2026 perf audit M2): when the LAST SSE client that wanted
 * a symbol disconnects we don't unsubscribe instantly (EventSource reconnects
 * within ~3s on blips) — we evict after a grace period. Without this, the
 * subscribed set grew forever: every symbol ever watched kept being polled
 * for the process lifetime.
 */
export function releaseCryptoSubscribed(symbols) {
  for (const s of symbols || []) {
    const base = String(s).trim().toUpperCase();
    if (!base) continue;
    const n = (_refcounts.get(base) || 1) - 1;
    if (n > 0) { _refcounts.set(base, n); continue; }
    _refcounts.delete(base);
    if (_evictTimers.has(base)) continue;
    const t = setTimeout(() => {
      _evictTimers.delete(base);
      if (_refcounts.has(base)) return; // someone re-subscribed meanwhile
      _subscribed.delete(base);
      _cdcxLast.delete(base);
      _anchorRatio.delete(base);
      _binanceLast.delete(base);
    }, EVICT_GRACE_MS);
    if (typeof t.unref === 'function') t.unref();
    _evictTimers.set(base, t);
  }
}

// ---------------------------------------------------------------
// Test hooks
// ---------------------------------------------------------------
export function _setBinanceWsFactoryForTest(fn) { _binanceWsFactory = fn; }
export function _setBinanceDebugLogForTest(fn) { _reasonLog = fn; }
export function _resetCryptoStreamForTest() {
  _subscribed.clear(); _refcounts.clear();
  for (const t of _evictTimers.values()) clearTimeout(t);
  _evictTimers.clear();
  if (_timer) { clearInterval(_timer); _timer = null; }
  _activeClients = 0;
  _upstream.inFlight = null; _upstream.at = 0; _upstream.tickers = null;
  _byMarket.src = null; _byMarket.map = null;
  _closeBinanceWs('test-reset');
  _cdcxLast.clear(); _anchorRatio.clear(); _binanceLast.clear();
  _binanceFailStreak = 0; _binanceDisabledUntil = 0; _binanceGotData = false;
  _cryptoFetchImpl = null;
}
