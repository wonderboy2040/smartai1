// ============================================================
// server/ai/cxRtStream.js — v10.10 COINDCX DIRECT ULTRA-FAST RT
// ------------------------------------------------------------
// THE BUG (user report): the CoinDCX tab's three desks — SPOT,
// GLOBAL FUTURES (USDT perps) and EQUITY SIM (USDC) — showed
// signal-card prices that were minutes old (board cache 90s +
// futures price cache 20s + frontend 30s poll). Stale LTP next to
// a fresh-looking call = "wrong call / wrong signal" experience.
//
// THE FIX: a dedicated 2s DIRECT-from-CoinDCX poller that feeds
// liveFeed (and therefore the /api/stream SSE) for the two
// domains the existing streams never covered:
//   FUT_<BASE>   B-<BASE>_USDT perp LTP   (public.coindcx.com
//                /market_data/v3/current_prices/futures/rt)
//   GLOB_<SYM>   B-<SYM>_USDC global equity perp LTP (same feed,
//                USDC margin domain — CoinDCX app parity) with a
//                polite Yahoo fallback for names the RT feed
//                doesn't carry (10s cadence, never 2s).
// SPOT needs nothing new — cryptoStream already publishes INR
// ticks at 2s (CoinDCX anchor) with the ~1s Binance WS
// accelerator, and /api/stream?crypto= already subscribes to it.
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
import { setTick } from '../liveFeed.js';
import { fetchFuturesPrices } from './futures.js';
import { fetchGlobalFuturesRt, fetchGlobalQuotes, syntheticPriceAt, GLOBAL_FUTURES_UNIVERSE } from './globalFutures.js';

const POLL_MS = 2000;              // the ultra-fast cadence (2s direct CoinDCX)
const RT_MAX_AGE_MS = 1300;        // ask the shared caches for ≤1.3s-old rows
const YAHOO_FALLBACK_MS = 10_000;  // uncovered global names → Yahoo, politely
const EVICT_GRACE_MS = 90_000;     // unsubscribes wait for SSE auto-reconnect
// Binance perp fallback (the SAME chain the futures board itself uses when
// CoinDCX RT goes dark — 1:1 USDT domain, zero projection risk). Cached 5s
// so a WAF blip on CoinDCX never stalls the stream longer than one beat.
const BINANCE_FUT_URL = 'https://fapi.binance.com/fapi/v1/ticker/24hr';
const BINANCE_FUT_CACHE_MS = 5_000;
let _bnFut = { at: 0, byBase: null }; // { at, byBase: Map<BASE, row> }

// ---- per-domain state (same shape as cryptoStream's spot book) ----
const _futSubscribed = new Set();      // BASE (BTC, ETH, …)
const _globSubscribed = new Set();     // SYM (AAPL, NVDA, …)
const _futRefcounts = new Map();
const _globRefcounts = new Map();
const _evictTimers = new Map();        // "FUT:BTC" / "GLOB:AAPL" → timer
let _timer = null;
let _activeClients = 0;
let _globYahooAt = 0;                  // last Yahoo fallback fetch epoch

// test injection
let _nowFn = () => Date.now();
export function _setCxRtNowForTest(fn) { _nowFn = fn || (() => Date.now()); }

// ---------------------------------------------------------------
// Client lifecycle — start/stop the 2s poller with the connection
// count (exactly cryptoClientUp/cryptoClientDown semantics).
// ---------------------------------------------------------------
export function cxRtClientUp() { _activeClients++; _startIfNeeded(); }
export function cxRtClientDown() { _activeClients = Math.max(0, _activeClients - 1); _stopIfIdle(); }

function _startIfNeeded() {
  if (_timer || (_futSubscribed.size === 0 && _globSubscribed.size === 0)) return;
  _pollOnce(); // instant first tick — a fresh page paints live prices NOW
  _timer = setInterval(_pollOnce, POLL_MS);
  if (_timer.unref) _timer.unref();
}

function _stopIfIdle() {
  if (_activeClients > 0 || !_timer) return;
  clearInterval(_timer);
  _timer = null;
}

// ---------------------------------------------------------------
// Subscriptions (refcounted, graceful eviction — the cryptoStream
// M2 pattern: the subscribed set must never grow forever).
// ---------------------------------------------------------------
export function ensureCxRtSubscribed({ fut, glob } = {}) {
  let changed = false;
  for (const s of fut || []) {
    const base = String(s).trim().toUpperCase();
    if (!base) continue;
    _cancelEviction(`FUT:${base}`);
    _futRefcounts.set(base, (_futRefcounts.get(base) || 0) + 1);
    if (!_futSubscribed.has(base)) { _futSubscribed.add(base); changed = true; }
  }
  for (const s of glob || []) {
    const sym = String(s).trim().toUpperCase();
    if (!sym) continue;
    _cancelEviction(`GLOB:${sym}`);
    _globRefcounts.set(sym, (_globRefcounts.get(sym) || 0) + 1);
    if (!_globSubscribed.has(sym)) { _globSubscribed.add(sym); changed = true; }
  }
  // a fresh universe while clients are live → immediate poll so the
  // new symbols get their first tick within ~2s, not POLL_MS + lag.
  if (_activeClients > 0 && changed && !_timer) _startIfNeeded();
}

export function releaseCxRtSubscribed({ fut, glob } = {}) {
  for (const s of fut || []) {
    const base = String(s).trim().toUpperCase();
    if (!base) continue;
    const n = (_futRefcounts.get(base) || 1) - 1;
    if (n > 0) { _futRefcounts.set(base, n); continue; }
    _futRefcounts.delete(base);
    _scheduleEviction('FUT', base, () => { _futSubscribed.delete(base); });
  }
  for (const s of glob || []) {
    const sym = String(s).trim().toUpperCase();
    if (!sym) continue;
    const n = (_globRefcounts.get(sym) || 1) - 1;
    if (n > 0) { _globRefcounts.set(sym, n); continue; }
    _globRefcounts.delete(sym);
    _scheduleEviction('GLOB', sym, () => { _globSubscribed.delete(sym); });
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
// The 2s poll — DIRECT CoinDCX, both perpetual domains in one
// tick so the browser gets a coherent snapshot per beat.
// ---------------------------------------------------------------
async function _pollOnce() {
  if (_activeClients === 0) return;
  const now = _nowFn();
  const jobs = [];
  if (_futSubscribed.size > 0) jobs.push(_pollFutures(now));
  if (_globSubscribed.size > 0) jobs.push(_pollGlobal(now));
  await Promise.allSettled(jobs);
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
    // 2) Yahoo fallback — ONLY names the RT feed doesn't carry, and
    //    only every 10s (Yahoo rate limits don't forgive 2s polls).
    const missing = [..._globSubscribed].filter(s => !covered.has(s));
    if (missing.length > 0) {
      if (now - _globYahooAt >= YAHOO_FALLBACK_MS) {
        _globYahooAt = now;
        const q = await fetchGlobalQuotes({ maxAgeMs: YAHOO_FALLBACK_MS }).catch(() => null);
        if (q) {
          for (const sym of missing) {
            const row = q.get(sym);
            if (!row || !(row.price > 0)) continue;
            // SIM rows (source 'sim') skip here — the dedicated synthetic
            // branch below ticks them at the TRUE 2s cadence with the
            // honest 'global-sim-rt' label (fetchGlobalQuotes would freeze
            // them on its own 10s cache with changePct 0).
            if (row.sim) continue;
            covered.add(sym);
            const chg = Number(row.changePct) || 0;
            setTick(`GLOB_${sym}`, {
              price: row.price,
              change: chg,
              high: row.high > 0 ? row.high : row.price,
              low: row.low > 0 ? row.low : row.price,
              volume: row.volume || 0,
              time: row.ts > 0 ? row.ts : _nowFn(),
              prevClose: chg > -100 ? row.price / (1 + chg / 100) : undefined,
            }, 'yahoo-global-rt');
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
// Test hooks
// ---------------------------------------------------------------
export function _resetCxRtForTest() {
  _futSubscribed.clear(); _globSubscribed.clear();
  _futRefcounts.clear(); _globRefcounts.clear();
  for (const t of _evictTimers.values()) clearTimeout(t);
  _evictTimers.clear();
  if (_timer) { clearInterval(_timer); _timer = null; }
  _activeClients = 0;
  _globYahooAt = 0;
  _bnFut = { at: 0, byBase: null };
  _bnFutFetchImpl = null;
}

export function _cxRtStateForTest() {
  return {
    activeClients: _activeClients,
    timer: !!_timer,
    fut: [..._futSubscribed],
    glob: [..._globSubscribed],
    globYahooAt: _globYahooAt,
  };
}
