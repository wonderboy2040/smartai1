// ============================================================
// intraday/regime — NIFTY + INDIA VIX market-regime filter
// ------------------------------------------------------------
// Gates the scanner against the broad market: counter-trend setups
// (LONG while NIFTY is bearish / SHORT while NIFTY is bullish)
// lose conviction instead of firing blind. VIX level flags
// volatile regimes. Data source: TradingView India Scanner —
// ONE extra request, cached 60s, fully degradable (no data ⇒
// no penalty, never blocks the scan).
// ============================================================
import { istMinutes } from './time.js';

let _regimeCache = { data: null, ts: 0 };
const REGIME_CACHE_MS = 60 * 1000;

const REGIME_TV_COLUMNS = ['close', 'change', 'VWAP', 'EMA20', 'RSI'];

async function fetchRegimeFromTV() {
  const res = await fetch(`https://scanner.tradingview.com/india/scan?t=${Date.now()}`, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain;charset=UTF-8' },
    body: JSON.stringify({
      symbols: { tickers: ['NSE:NIFTY', 'NSE:INDIAVIX'] },
      columns: REGIME_TV_COLUMNS,
    }),
    signal: AbortSignal.timeout(8000),
  });
  if (!res.ok) return null;
  const data = await res.json();
  const out = {};
  for (const item of data?.data || []) {
    if (!item.d) continue;
    const pf = (v) => (typeof v === 'number' && !isNaN(v) && isFinite(v)) ? v : null;
    out[item.s] = { close: pf(item.d[0]), change: pf(item.d[1]), vwap: pf(item.d[2]), ema20: pf(item.d[3]), rsi: pf(item.d[4]) };
  }
  return out;
}

/**
 * Returns { regime, vix, vixLevel, niftyChange, niftyVwapDist, asOf } | null.
 *  regime:   'BULLISH' | 'BEARISH' | 'NEUTRAL'
 *  vixLevel: 'LOW' (<13) | 'ELEVATED' (13–16) | 'HIGH' (>16)
 */
export async function getMarketRegime(debug = false) {
  if (!debug && _regimeCache.data && Date.now() - _regimeCache.ts < REGIME_CACHE_MS) {
    return _regimeCache.data;
  }
  try {
    const raw = await fetchRegimeFromTV();
    const nifty = raw?.['NSE:NIFTY'];
    const vixRow = raw?.['NSE:INDIAVIX'];
    if (!nifty || !(nifty.close > 0)) return _regimeCache.data || null;

    const niftyChange = nifty.change ?? 0;
    const niftyVwapDist = nifty.vwap > 0 ? ((nifty.close - nifty.vwap) / nifty.vwap) * 100 : 0;
    const aboveEma = nifty.ema20 != null ? nifty.close > nifty.ema20 : null;

    let regime = 'NEUTRAL';
    if (niftyVwapDist > 0.15 && niftyChange > 0.1 && aboveEma !== false) regime = 'BULLISH';
    else if (niftyVwapDist < -0.15 && niftyChange < -0.1 && aboveEma !== true) regime = 'BEARISH';
    else if (Math.abs(niftyChange) > 0.35 && niftyVwapDist > 0.2) regime = 'BULLISH';
    else if (Math.abs(niftyChange) > 0.35 && niftyVwapDist < -0.2) regime = 'BEARISH';

    const vix = vixRow?.close ?? null;
    const vixLevel = vix == null ? null : vix > 16 ? 'HIGH' : vix >= 13 ? 'ELEVATED' : 'LOW';

    const data = {
      regime, vix, vixLevel,
      niftyChange: +niftyChange.toFixed(2),
      niftyVwapDist: +niftyVwapDist.toFixed(2),
      niftyRsi: nifty.rsi != null ? Math.round(nifty.rsi) : null,
      asOf: new Date().toISOString(),
    };
    _regimeCache = { data, ts: Date.now() };
    return data;
  } catch {
    return _regimeCache.data || null;
  }
}

// True when fresh entries should be blocked globally (15:00 IST onward).
export function freshEntriesAllowedNow() {
  return istMinutes() < 15 * 60;
}
