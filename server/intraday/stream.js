// ============================================================
// intraday/stream — SSE live-quote push + outcome watcher
// ------------------------------------------------------------
// ONE shared watcher loop (5s cadence, failure-backoff to 30s):
//   symbols = latest scan signals ∪ open tracked signals ∪ open
//   paper trades → Groww batch quotes →
//     1. evaluate tracked-signal outcomes (T1/T2/SL/trail/EOD)
//     2. evaluate paper trades (auto-manage + square-off)
//     3. broadcast fresh quotes + outcome events to SSE clients
//     4. push outcome alerts to Telegram
//
// The watcher runs on its own during NSE hours (09:15–15:40 IST
// grace window) so the track record + Telegram outcome alerts work
// even with ZERO connected browser clients. SSE clients simply
// attach to the broadcast; N clients still cost ONE poller.
// ============================================================
import { istMinutes, getISTParts, istDayKey } from './time.js';
import { evaluateTracked, watcherSymbols as trackedSymbols } from './trackRecord.js';
import { evaluatePaper, paperSymbolsForWatcher } from './paperTrading.js';
import { getMarketRegime } from './regime.js';

const POLL_MS = 5000;
const BACKOFF_MS = 30000;
const FAILURE_STREAK_LIMIT = 3;

let _deps = null;               // { fetchGrowwNseQuote, sendTelegramRaw, escapeHtml, dispatchOutcomeAlert }
let _scanSymbols = new Set();   // latest scan's published signal symbols
let _latestQuotes = { data: {}, ts: 0, day: '' };
let _clients = new Set();       // SSE response writers
let _timer = null;
let _failureStreak = 0;
let _lastRegimePush = 0;

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
  console.log('[intraday-stream] watcher initialised (5s cadence, NSE-hours gated)');
}

export function setScanSymbols(symbols) {
  _scanSymbols = new Set(Array.isArray(symbols) ? symbols.map(s => String(s).toUpperCase()) : []);
}

export function getLatestQuotes() {
  return _latestQuotes;
}

async function _fetchQuotes(symbols) {
  const out = {};
  if (!symbols.length || typeof _deps.fetchGrowwNseQuote !== 'function') return out;
  // ≤24 watcher symbols in ONE parallel round (12→24). The server-side Groww
  // micro-cache de-dupes these against the /api/quote poll flood, so a single
  // round is both faster and cheaper than two sequential batches.
  for (let i = 0; i < symbols.length; i += 24) {
    const batch = symbols.slice(i, i + 24);
    await Promise.allSettled(batch.map(async (sym) => {
      try {
        const q = await _deps.fetchGrowwNseQuote(sym);
        if (q && q.price > 0) out[sym] = { price: q.price, change: q.change ?? 0, ts: Date.now() };
      } catch { /* skip */ }
    }));
  }
  return out;
}

async function _tick() {
  try {
    if (!_inWindow()) return;
    const symbols = [...new Set([
      ..._scanSymbols,
      ...trackedSymbols(),
      ...paperSymbolsForWatcher(),
    ])].slice(0, 24);
    if (symbols.length === 0) return;

    const quotes = await _fetchQuotes(symbols);
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

    // 2026 perf audit (M2): _latestQuotes.data used to accumulate the union of
    // every symbol EVER watched (scans + tracked + paper) for the process
    // lifetime and serialize it wholesale to every new client. Reset at the
    // IST day boundary — a new session starts with a clean, live-only map.
    const today = istDayKey();
    if (_latestQuotes.day !== today) {
      _latestQuotes = { data: {}, ts: 0, day: today };
    }
    _latestQuotes = { data: { ..._latestQuotes.data, ...quotes }, ts: Date.now(), day: today };

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

    // Regime push every 60s.
    if (Date.now() - _lastRegimePush > 60 * 1000) {
      _lastRegimePush = Date.now();
      getMarketRegime(_debug()).then(r => { if (r) _broadcast('regime', r); }).catch(() => { });
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
