// cryptoStream — CoinDCX live INR crypto feed (server-side, pushed to SSE)
// Polls CoinDCX every 2s ONLY while at least one SSE client is connected.
// When no clients → timer pauses → server goes idle → Render free tier happy.
//
// 2026 perf audit (H2): previously this module downloaded + JSON.parsed the
// FULL CoinDCX ticker (~0.5-1MB, every market on the exchange) every 2s while
// /api/crypto-prices independently polled the SAME upstream — double the CPU
// and GC churn on a 0.1-vCPU box. Now ONE shared cached round-trip
// (fetchCoinDcxTickers, in-flight deduped) serves both consumers, and the
// parsed by-market Map is reused between polls.
import { setTick } from './liveFeed.js';

const POLL_MS = 2000; // 2s ultra-fast crypto feed for SSE
const UPSTREAM_CACHE_MS = 2000;  // shared fetch cache window
const UPSTREAM_STALE_MS = 30000; // serve-stale window when upstream errors
const EVICT_GRACE_MS = 90000;    // unsubscribes wait for SSE auto-reconnect

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

export async function fetchCoinDcxTickers() {
  const now = Date.now();
  if (_upstream.tickers && (now - _upstream.at) < UPSTREAM_CACHE_MS) return _upstream.tickers;
  if (_upstream.inFlight) return _upstream.inFlight;
  const p = (async () => {
    try {
      const r = await fetch(`https://api.coindcx.com/exchange/ticker?t=${Date.now()}`, {
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
}

function _stopIfIdle() {
  if (_activeClients > 0 || !_timer) return;
  clearInterval(_timer);
  _timer = null;
}

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
      setTick(`IN_${base}`, {
        price,
        change: parseFloat(t.change_24_hour) || 0,
        high: parseFloat(t.high) || price,
        low: parseFloat(t.low) || price,
        volume: parseFloat(t.volume) || 0,
        time: Date.now(),
      }, 'coindcx-live');
    }
  } catch { /* transient — retry next tick */ }
}

export function ensureCryptoSubscribed(symbols) {
  // 2026 perf audit fix (H2): an EMPTY list no longer falls back to a default
  // 12-crypto set — previously every SSE connection (even crypto-less ones)
  // dragged the full CoinDCX ticker poll along. Real frontend clients always
  // send their crypto watchlist; nothing else needs a default.
  if (!symbols || !symbols.length) return;
  for (const s of symbols) {
    const base = String(s).trim().toUpperCase();
    if (!base) continue;
    // Interested again → cancel any pending eviction.
    if (_evictTimers.has(base)) {
      clearTimeout(_evictTimers.get(base));
      _evictTimers.delete(base);
    }
    _refcounts.set(base, (_refcounts.get(base) || 0) + 1);
    _subscribed.add(base);
  }
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
    }, EVICT_GRACE_MS);
    if (typeof t.unref === 'function') t.unref();
    _evictTimers.set(base, t);
  }
}

// Test hook
export function _resetCryptoStreamForTest() {
  _subscribed.clear(); _refcounts.clear();
  for (const t of _evictTimers.values()) clearTimeout(t);
  _evictTimers.clear();
  if (_timer) { clearInterval(_timer); _timer = null; }
  _activeClients = 0;
  _upstream.inFlight = null; _upstream.at = 0; _upstream.tickers = null;
  _byMarket.src = null; _byMarket.map = null;
}
