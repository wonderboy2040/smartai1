// ============================================================
// server/ai/sectors.js — SECTOR MAP + CONTEXT CHAIN + F-SCORE (v6.11)
// ------------------------------------------------------------
// Glama-inspired trio:
//   • mukul8896 "market+sector sentiment" → SECTOR MAP: the 45-stock
//     India universe grouped into 10 sectors, each with breadth
//     (% above EMA20), avg momentum, mood label + sector-index
//     overlay from Yahoo (^CNXIT, ^CNXAUTO …).
//   • oneqaz "macro→ETF→symbol context chain" → CONTEXT CHAIN:
//     NIFTY trend + VIX + global proxies (DXY/CRUDE/GOLD) →
//     strongest sectors → top aligned symbols. The top-down lens
//     a discretionary trader runs before picking a chart.
//   • staskh "piotroski_score" → F-SCORE (trend-quality edition):
//     9 price-action checks (EMA stack, RSI health, MACD, ADX,
//     VWAP, relative volume, 52w position …). HONEST LABEL: this
//     is Piotroski-STYLE trend quality — balance-sheet Piotroski
//     (ROA/CFO/leverage) needs fundamentals data jo is host se
//     reachable nahi hai. Score 0-9, grade A/B/C.
//
// Read-only. 5-min cache on the TV batch (same source the signal
// board uses — one scan, many desks).
// ============================================================
import { fetchTVIndiaBatch, INDIA_UNIVERSE, fetchYahooQuotes } from './data.js';

// ---------------- sector mapping (full 45-symbol universe) ----------------
export const SECTOR_MAP = {
  BANKING: ['HDFCBANK', 'ICICIBANK', 'SBIN', 'AXISBANK', 'KOTAKBANK', 'INDUSINDBK'],
  IT: ['INFY', 'TCS', 'WIPRO', 'HCLTECH', 'TECHM'],
  ENERGY: ['RELIANCE', 'ONGC', 'BPCL', 'NTPC', 'POWERGRID', 'COALINDIA'],
  AUTO: ['MARUTI', 'TATAMOTORS', 'EICHERMOT', 'HEROMOTOCO', 'BAJAJ-AUTO'],
  PHARMA: ['SUNPHARMA', 'CIPLA', 'DRREDDY', 'DIVISLAB'],
  FMCG: ['HINDUNILVR', 'ITC', 'NESTLEIND'],
  FINANCIALS: ['BAJFINANCE', 'BAJAJFINSV', 'SBILIFE', 'HDFCLIFE', 'SHRIRAMFIN'],
  METAL: ['TATASTEEL', 'JSWSTEEL', 'HINDALCO'],
  INFRA: ['LT', 'ULTRACEMCO', 'GRASIM', 'ADANIENT', 'ADANIPORTS'],
  CONSUMER: ['BHARTIARTL', 'ASIANPAINT', 'TITAN'],
};
// Yahoo sector-index overlay (absent sectors honestly stay null)
const SECTOR_INDEX = { IT: 'IT', AUTO: 'AUTO', PHARMA: 'PHARMA', FMCG: 'FMCG', METAL: 'METAL', BANKING: 'BANKNIFTY' };

const CACHE_TTL = 5 * 60 * 1000;
let _cache = null, _cacheAt = 0;

// NOTE: TV 'change' and Yahoo 'changePct' are ALREADY in percent —
// round only, NEVER re-multiply (the classic double-scaling bug).
const pct = (v) => Math.round(Number(v) * 10) / 10;

// ---------------- F-Score (trend quality, Piotroski-STYLE) ----------------
/**
 * 9 checks, 1 point each — all from ONE TV snapshot row:
 *   1 price>EMA20        trend above short-term mean
 *   2 EMA20>EMA50        stack in order
 *   3 RSI 45-70          momentum healthy, not exhausted
 *   4 MACD>signal        momentum turning with price
 *   5 ADX>20             a real trend exists
 *   6 changePct>0        today participating green
 *   7 price>VWAP         intraday strength
 *   8 relVolume>1        participation above 10d average
 *   9 52w position>50%   nearer highs than lows
 */
export function fscoreOf(row) {
  const n = (v) => Number.isFinite(Number(v)) ? Number(v) : null;
  const ltp = n(row?.ltp), ema20 = n(row?.ema20), ema50 = n(row?.ema50);
  const rsi = n(row?.rsi), macd = n(row?.macd), macdSignal = n(row?.macdSignal);
  const adx = n(row?.adx), chg = n(row?.changePct), vwap = n(row?.vwap);
  const relVol = n(row?.relVolume), hi = n(row?.high52w), lo = n(row?.low52w);
  const pos52 = (ltp != null && hi != null && lo != null && hi > lo) ? (ltp - lo) / (hi - lo) : null;

  const checks = [
    { k: 'trend', ok: ltp != null && ema20 != null && ltp > ema20 },
    { k: 'stack', ok: ema20 != null && ema50 != null && ema20 > ema50 },
    { k: 'momo', ok: rsi != null && rsi >= 45 && rsi <= 70 },
    { k: 'macd', ok: macd != null && macdSignal != null && macd > macdSignal },
    { k: 'adx', ok: adx != null && adx > 20 },
    { k: 'green', ok: chg != null && chg > 0 },
    { k: 'vwap', ok: ltp != null && vwap != null && ltp > vwap },
    { k: 'vol', ok: relVol != null && relVol > 1 },
    { k: '52w', ok: pos52 != null && pos52 > 0.5 },
  ];
  const score = checks.filter(c => c.ok).length;
  return {
    score,
    grade: score >= 7 ? 'A' : score >= 5 ? 'B' : 'C',
    checks: checks.map(c => ({ k: c.k, pass: !!c.ok })),
    pos52: pos52 != null ? Math.round(pos52 * 1000) / 10 : null,
    rsi, adx, relVol,
    disclaimer: 'Piotroski-STYLE trend-quality score — price-action based. Balance-sheet Piotroski (ROA/CFO/leverage) is host se unreachable, isliye honestly yeh proxy hai.',
  };
}

// ---------------- the combined desk ----------------
export async function sectorDesk() {
  if (_cache && Date.now() - _cacheAt < CACHE_TTL) return _cache;

  const [tv, quotes] = await Promise.all([
    fetchTVIndiaBatch(INDIA_UNIVERSE).catch(() => ({})),
    fetchYahooQuotes(['NIFTY', 'INDIAVIX', 'DXY', 'CRUDE', 'GOLD', 'IT', 'AUTO', 'PHARMA', 'FMCG', 'METAL', 'BANKNIFTY']).catch(() => ({})),
  ]);
  const rows = Object.values(tv || {});
  if (rows.length < 10) {
    return {
      ok: false,
      error: 'TV India scanner unreachable — sector map data nahi mila (thodi der baad retry karo)',
      sectors: [], chain: null, fscore: null,
    };
  }

  // ---- sectors ----
  const sectors = Object.entries(SECTOR_MAP).map(([name, syms]) => {
    const list = syms.map(s => tv[s]).filter(Boolean);
    const n = list.length || 1;
    const above = list.filter(r => r.ltp != null && r.ema20 != null && r.ltp > r.ema20).length;
    const avgChg = list.reduce((s, r) => s + (r.changePct ?? 0), 0) / n;
    const avgRsi = list.reduce((s, r) => s + (r.rsi ?? 50), 0) / n;
    const breadth = (above / n) * 100;
    const mood = breadth >= 60 && avgChg > 0 ? 'BULLISH' : breadth <= 40 && avgChg < 0 ? 'BEARISH' : 'NEUTRAL';
    const ranked = [...list].sort((a, b) => (b.changePct ?? 0) - (a.changePct ?? 0));
    return {
      sector: name,
      symbols: n,
      breadth: Math.round(breadth),
      avgChangePct: pct(avgChg),
      avgRsi: Math.round(avgRsi),
      mood,
      indexChangePct: quotes[SECTOR_INDEX[name]]?.changePct != null ? pct(quotes[SECTOR_INDEX[name]].changePct) : null,
      leader: ranked[0] ? { symbol: ranked[0].symbol, changePct: pct(ranked[0].changePct ?? 0) } : null,
      laggard: ranked.length ? { symbol: ranked[ranked.length - 1].symbol, changePct: pct(ranked[ranked.length - 1].changePct ?? 0) } : null,
    };
  }).sort((a, b) => b.avgChangePct - a.avgChangePct);

  // ---- macro → sector → symbol context chain ----
  const nifty = quotes['NIFTY'];
  const vix = quotes['INDIAVIX'];
  const macro = {
    niftyChangePct: nifty?.changePct != null ? pct(nifty.changePct) : null,
    vix: vix?.price ?? null,
    vixRegime: vix?.price == null ? null : vix.price < 12 ? 'CALM' : vix.price < 16 ? 'NORMAL' : vix.price < 20 ? 'ELEVATED' : 'STRESS',
    dollar: quotes['DXY']?.changePct != null ? pct(quotes['DXY'].changePct) : null,
    crude: quotes['CRUDE']?.changePct != null ? pct(quotes['CRUDE'].changePct) : null,
    gold: quotes['GOLD']?.changePct != null ? pct(quotes['GOLD'].changePct) : null,
  };
  const bias = macro.niftyChangePct == null ? 'UNKNOWN'
    : macro.niftyChangePct > 0.4 ? 'RISK-ON'
    : macro.niftyChangePct < -0.4 ? 'RISK-OFF' : 'FLAT';
  const strongest = sectors.filter(s => s.mood !== 'BEARISH').slice(0, 3);
  const chain = {
    macro: { ...macro, bias },
    read: `Macro ${bias}${macro.vixRegime ? ` · VIX ${macro.vixRegime}` : ''} → strongest: ${strongest.slice(0, 2).map(s => s.sector).join(', ') || '—'} → wahan se leaders pick karo, BEARISH sectors me counter-trend long mat lo.`,
    strongest: strongest.map(s => {
      const syms = (SECTOR_MAP[s.sector] || []).map(sym => tv[sym]).filter(Boolean);
      const tops = [...syms].sort((a, b) => (fscoreOf(b).score) - (fscoreOf(a).score)).slice(0, 2)
        .map(r => ({ symbol: r.symbol, changePct: pct(r.changePct ?? 0), fscore: fscoreOf(r).score }));
      return { sector: s.sector, mood: s.mood, breadth: s.breadth, top: tops };
    }),
  };

  // ---- F-Score board (top quality across the universe) ----
  const scored = rows.map(r => ({ symbol: r.symbol, ltp: r.ltp, ...fscoreOf(r) }))
    .sort((a, b) => b.score - a.score);
  const fscore = {
    top: scored.slice(0, 8).map(s => ({
      symbol: s.symbol, ltp: s.ltp, score: s.score, grade: s.grade, rsi: s.rsi, pos52: s.pos52, adx: s.adx,
    })),
    bottom: scored.slice(-3).map(s => ({ symbol: s.symbol, score: s.score, grade: s.grade })),
    distribution: {
      A: scored.filter(s => s.grade === 'A').length,
      B: scored.filter(s => s.grade === 'B').length,
      C: scored.filter(s => s.grade === 'C').length,
    },
    disclaimer: scored[0]?.disclaimer,
  };

  const out = {
    ok: true,
    asOf: Date.now(),
    universe: rows.length,
    sectors,
    chain,
    fscore,
    note: 'Sector map = TV live snapshot (5-min cache). Context chain = top-down lens. F-Score = trend-quality proxy (disclaimer ke saath). Read-only — koi order nahi.',
  };
  _cache = out; _cacheAt = Date.now();
  return out;
}

export const __testables = { SECTOR_MAP, SECTOR_INDEX };
