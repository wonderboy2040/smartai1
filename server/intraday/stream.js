// ============================================================
// intraday/stream — SSE live-quote push + outcome watcher
// ------------------------------------------------------------
// ONE shared watcher loop (5s cadence, failure-backoff to 30s):
//   symbols = latest scan signals ∪ open tracked signals ∪ open
//   paper trades → per-market quotes (Groww NSE for INDIA,
//   CoinDCX INR for CRYPTO) →
//     1. evaluate tracked-signal outcomes (T1/T2/SL/trail/EOD)
//     2. evaluate paper trades (auto-manage + square-off)
//     3. broadcast fresh quotes + outcome events to SSE clients
//     4. push outcome alerts to Telegram
//
// 2026-09 multi-market pass: the watcher runs while the NSE window
// is open OR any CRYPTO symbol is in the watch set (24/7 market).
// Regime frames are market-tagged: `regime` (NIFTY/VIX) and
// `crypto-regime` (BTC) — clients render the one they need.
//
// The watcher runs on its own during NSE hours (09:15–15:40 IST
// grace window) so the track record + Telegram outcome alerts work
// even with ZERO connected browser clients. SSE clients simply
// attach to the broadcast; N clients still cost ONE poller.
// ============================================================
import { istMinutes, getISTParts, istDayKey, dayKeyFor } from './time.js';
import { isCryptoSymbolBase } from './engine.js';
import { evaluateTracked, watcherSymbolsByMarket } from './trackRecord.js';
import { evaluatePaper, paperSymbolsByMarket } from './paperTrading.js';
import { getMarketRegime, getCryptoRegime } from './regime.js';

const POLL_MS = 5000;
const BACKOFF_MS = 30000;
const FAILURE_STREAK_LIMIT = 3;
const MAX_WATCH_NSE = 24;
const MAX_WATCH_CRYPTO = 14;

let _deps = null;               // { fetchGrowwNseQuote, fetchCoinDcxTickers, sendTelegramRaw, escapeHtml, dispatchOutcomeAlert }
let _scanSymbols = new Set();   // latest scan's published signal symbols (all markets)
let _scanCrypto = new Set();    // subset of _scanSymbols that are CRYPTO-market symbols
let _latestQuotes = { data: {}, ts: 0, day: '', utcDay: '' };
let _clients = new Set();       // SSE response writers
let _timer = null;
let _failureStreak = 0;
let _lastRegimePush = 0;
let _lastCryptoRegimePush = 0;

function _debug() { return process.env.INTRADAY_DEBUG === '1'; }

// Weekday window: 09:15 → 15:40 IST (grace past close for EOD reconcile).
function _inWindow() {
  if (_debug()) return true;
  const { weekday } = getISTParts();
  if (weekday === 'Sat' || weekday === 'Sun') return false;
  const m = istMinutes();
  return m >= 9 * 60 + 15 && m <= 15 * 60 + 40;
}

export function initIntradayStream(deps) {
  _deps = deps || {};
  if (_timer) return;
  _timer = setInterval(_tick, POLL_MS);
  if (typeof _timer.unref === 'function') _timer.unref();
  console.log('[intraday-stream] watcher initialised (5s cadence, NSE-hours gated + 24/7 CRYPTO)');
}

export function setScanSymbols(symbols, market = 'INDIA') {
  const list = Array.isArray(symbols) ? symbols.map(s => String(s).toUpperCase()) : [];
  _scanSymbols = new Set(list);
  const isCrypto = String(market).toUpperCase() === 'CRYPTO';
  _scanCrypto = new Set(isCrypto ? list : list.filter(s => isCryptoSymbolBase(s)));
}

export function getLatestQuotes() {
  return _latestQuotes;
}

// ------------------------------------------------------------
// Watch-set assembly: symbol → market classification. Legacy rows
// (persisted before the market field existed) fall back to the
// crypto-base heuristic so BTC rows are never routed to Groww.
// ------------------------------------------------------------
function _watchSet() {
  const symMarket = new Map();
  const mark = (sym, isCrypto) => {
    if (!sym) return;
    const s = String(sym).toUpperCase();
    if (!symMarket.has(s)) symMarket.set(s, isCrypto ? 'CRYPTO' : 'INDIA');
  };
  _scanSymbols.forEach(s => mark(s, _scanCrypto.has(s)));
  const tracked = watcherSymbolsByMarket();
  tracked.india.forEach(s => mark(s, false));
  tracked.crypto.forEach(s => mark(s, true));
  const paper = paperSymbolsByMarket();
  paper.india.forEach(s => mark(s, false));
  paper.crypto.forEach(s => mark(s, true));
  return symMarket;
}

async function _fetchQuotes(symMarket) {
  const out = {};
  const india = [];
  const crypto = [];
  for (const [sym, mkt] of symMarket.entries()) {
    (mkt === 'CRYPTO' ? crypto : india).push(sym);
  }

  // INDIA: Groww NSE quotes (≤24 watcher symbols in ONE parallel round —
  // the server-side Groww micro-cache de-dupes these against the
  // /api/quote poll flood).
  if (india.length && typeof _deps.fetchGrowwNseQuote === 'function') {
    for (let i = 0; i < Math.min(india.length, MAX_WATCH_NSE); i += 24) {
      const batch = india.slice(i, i + 24);
      await Promise.allSettled(batch.map(async (sym) => {
        try {
          const q = await _deps.fetchGrowwNseQuote(sym);
          if (q && q.price > 0) out[sym] = { price: q.price, change: q.change ?? 0, ts: Date.now() };
        } catch { /* skip */ }
      }));
    }
  }

  // CRYPTO: CoinDCX INR quotes — ONE shared 2s-cached ticker round-trip
  // (same cache the live /api/crypto-prices + SSE price stream use).
  if (crypto.length && typeof _deps.fetchCoinDcxTickers === 'function') {
    try {
      const tickers = await _deps.fetchCoinDcxTickers();
      const byMkt = new Map();
      for (const t of tickers) byMkt.set(t.market, t);
      for (const sym of crypto.slice(0, MAX_WATCH_CRYPTO)) {
        const t = byMkt.get(`${sym}INR`);
        const price = parseFloat(t?.last_price);
        if (price > 0) {
          out[sym] = { price, change: parseFloat(t.change_24_hour) || 0, ts: Date.now() };
        }
      }
    } catch { /* CoinDCX transient */ }
  }
  return out;
}

async function _tick() {
  try {
    const symMarket = _watchSet();
    const hasCrypto = [...symMarket.values()].includes('CRYPTO');
    // Run while the NSE window is open OR any crypto symbol is watched (24/7).
    if (!_inWindow() && !hasCrypto) return;
    if (symMarket.size === 0) return;

    const quotes = await _fetchQuotes(symMarket);
    const got = Object.keys(quotes).length;
    if (got === 0) {
      _failureStreak++;
      if (_failureStreak >= FAILURE_STREAK_LIMIT) {
        // Back off: clear the timer and retry slowly until success.
        clearInterval(_timer);
        _timer = setInterval(_tick, BACKOFF_MS);
        if (typeof _timer.unref === 'function') _timer.unref();
      }
      return;
    }
    if (_failureStreak >= FAILURE_STREAK_LIMIT) {
      // Recovered — restore fast cadence.
      clearInterval(_timer);
      _timer = setInterval(_tick, POLL_MS);
      if (typeof _timer.unref === 'function') _timer.unref();
    }
    _failureStreak = 0;

    // 2026 perf audit (M2): reset at the IST day boundary (NSE session) AND
    // the UTC day boundary (crypto session) — each market starts its own
    // session with a clean, live-only map.
    const today = istDayKey();
    const utcDay = dayKeyFor('CRYPTO');
    if (_latestQuotes.day !== today || _latestQuotes.utcDay !== utcDay) {
      _latestQuotes = { data: {}, ts: 0, day: today, utcDay };
    }
    _latestQuotes = { data: { ..._latestQuotes.data, ...quotes }, ts: Date.now(), day: today, utcDay };

    // Outcome evaluation (tracked signals + paper trades).
    const events = [];
    try { evaluateTracked(quotes, events); } catch (e) { console.warn('[intraday-stream] track eval:', e?.message); }
    try { evaluatePaper(quotes, events); } catch (e) { console.warn('[intraday-stream] paper eval:', e?.message); }

    _broadcast('quotes', quotes);
    for (const ev of events) {
      _broadcast('outcome', ev);
      if (typeof _deps.dispatchOutcomeAlert === 'function') {
        _deps.dispatchOutcomeAlert(ev, {
          sendTelegramRaw: _deps.sendTelegramRaw,
          escapeHtml: _deps.escapeHtml,
        }).catch(() => { });
      }
    }

    // Regime pushes every 60s — NIFTY (India) + BTC (crypto), tagged.
    if (Date.now() - _lastRegimePush > 60 * 1000) {
      _lastRegimePush = Date.now();
      getMarketRegime(_debug()).then(r => { if (r) _broadcast('regime', r); }).catch(() => { });
    }
    if (Date.now() - _lastCryptoRegimePush > 60 * 1000) {
      _lastCryptoRegimePush = Date.now();
      getCryptoRegime(_debug()).then(r => { if (r) _broadcast('crypto-regime', r); }).catch(() => { });
    }
  } catch (e) {
    console.warn('[intraday-stream] tick error:', e?.message);
  }
}

function _broadcast(event, data) {
  const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const write of _clients) {
    try { write(payload); } catch { /* client gone */ }
  }
}

// ------------------------------------------------------------
// SSE endpoint handler — attach to express: app.get('/api/intraday-stream', intradayStreamHandler)
// ------------------------------------------------------------
export function intradayStreamHandler(req, res) {
  res.set({
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-store, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  if (res.flushHeaders) res.flushHeaders();
  res.write('retry: 3000\n\n');

  const write = (payload) => {
    // 2026 perf audit (H1): backpressure guard — a stalled client (phone
    // sleep / zero-window TCP) makes Node buffer every SSE write forever.
    // Kill the connection once the socket buffer exceeds 128KB; the browser
    // EventSource auto-reconnects when it wakes.
    try {
      const ok = res.write(payload);
      if (ok || !res.socket || res.socket.writableLength <= 128 * 1024) return true;
      try { _clients.delete(write); res.destroy(); } catch { /* noop */ }
      return false;
    } catch {
      return false;
    }
  };
  _clients.add(write);

  // Initial snapshot so a fresh client paints instantly.
  try {
    if (_latestQuotes.ts > 0) write(`event: quotes\ndata: ${JSON.stringify(_latestQuotes.data)}\n\n`);
    write(`event: status\ndata: ${JSON.stringify({ watcher: _inWindow() ? 'live' : 'idle', clients: _clients.size, ts: Date.now() })}\n\n`);
    getMarketRegime(_debug()).then(r => { if (r) write(`event: regime\ndata: ${JSON.stringify(r)}\n\n`); }).catch(() => { });
    getCryptoRegime(_debug()).then(r => { if (r) write(`event: crypto-regime\ndata: ${JSON.stringify(r)}\n\n`); }).catch(() => { });
  } catch { /* client gone */ }

  const keepalive = setInterval(() => {
    try {
      write(`event: status\ndata: ${JSON.stringify({ watcher: _inWindow() ? 'live' : 'idle', clients: _clients.size, ts: Date.now() })}\n\n`);
    } catch { /* noop */ }
  }, 15000);
  if (typeof keepalive.unref === 'function') keepalive.unref();

  req.on('close', () => {
    clearInterval(keepalive);
    _clients.delete(write);
    try { res.end(); } catch { /* noop */ }
  });
}
