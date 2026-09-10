// ============================================================
// server/ai/expertPicks.js — v8.0 ADVANCE PRO TRADER ENGINE
// ------------------------------------------------------------
// EXPERT PICKS: the CoinDCX desk's "what do I actually trade RIGHT
// NOW" layer. The 10-model consensus board is honest but abstain-heavy
// (a coin with split factors reads NEUTRAL and nothing shows on the
// Signal Board). This engine scans the WHOLE tradable universe —
// every liquid CoinDCX spot INR pair AND every B-USDT perpetual —
// and returns only the highest-conviction setups:
//
//   • composite EXPERT SCORE (0-100) over 7 transparent factors
//     (trend / momentum / volume / SMC structure / volatility /
//     market regime / R:R quality). 80+ = STRONG EXPERT PICK.
//   • a complete trade BLUEPRINT per pick:
//       - side, entry zone (limit band) + trigger price
//       - ATR/structure stop-loss, T1/T2/T3 partial targets
//       - RECOMMENDED LEVERAGE (liquidation-aware ladder) — spot
//         reads 1×, futures reads maxSaneLeverage capped by score
//       - staged EXIT PLAN (40/40/20 partials + breakeven + trail)
//       - timing window (immediate vs pullback-to-EMA20)
//       - invalidation note + hold horizon
//
// Data sources (each degrades honestly):
//   • universe: LIVE from CoinDCX tickers (spot INR pairs) and the
//     futures prices feed — no stale hardcoded coin list (MATIC-type
//     delistings can't kill the scan). Top-N by 24h volume.
//   • indicators: TradingView scanner crypto/india batch (chunked)
//   • LTF candles: CoinDCX 1h (spot) / futures 1h, Yahoo fallback
//   • regime: buildRegime (BTC for crypto, NIFTY/VIX for India)
//
// Purity: expertScoreFactors() and buildExpertBlueprint() are pure
// (unit-tested). getExpertPicks() is the IO orchestrator (60s cache).
// ============================================================
import {
  INDIA_UNIVERSE, CRYPTO_UNIVERSE, fetchTVIndiaBatch, fetchTVCryptoBatch,
  fetchCoinDcxCandles, isNseOpen,
} from './data.js';
import { futuresPairFor, fetchFuturesPrices, fetchFuturesCandles } from './futures.js';
import { computeIndicatorsFromCandles } from './lib/indicators.js';
import { smcVote } from './lib/smc.js';
import { maxSaneLeverage } from './ensemble.js';
import { pRound as pR, MAX_STOP_FRACTION } from './lib/priceRound.js';
import { buildRegime, fetchYahooIntradayCandles } from './signals.js';

const r2 = (v) => (Number.isFinite(v) ? Math.round(v * 100) / 100 : null);
const r1 = (v) => (Number.isFinite(v) ? Math.round(v * 10) / 10 : null);
const clamp = (v, lo = 0, hi = 100) => Math.max(lo, Math.min(hi, v));
const num = (v) => { const n = Number(v); return Number.isFinite(n) ? n : null; };

// ---------------- engine constants ----------------
export const EXPERT_MIN_STRONG = 80;   // 80+ = STRONG EXPERT PICK
export const EXPERT_MIN_ACTION = 65;   // 65-79 = ACTION (secondary)
export const DEFAULT_UNIVERSE_SIZE = 45;
export const SPOT_LEVERAGE = 1;        // CoinDCX spot INR = no leverage

// Score weights (sum = 1.0) — mirrors a prop desk's checklist.
export const EXPERT_WEIGHTS = {
  trend: 0.25, momentum: 0.20, volume: 0.10, smc: 0.15,
  volatility: 0.10, regime: 0.10, rr: 0.10,
};

// ---------------- universe discovery ----------------
// LIVE universes from CoinDCX — no stale hardcoded lists. A coin that
// was delisted (or a new listing) flows in automatically. Cached 10 min.
// FALLBACK CHAIN (resilience): if the CoinDCX public feed is blocked
// (403 WAF / geo / outage), the engine falls back to Binance's public
// 24h tickers for universe + prices (USDT ≈ USD, converted at live
// USDINR). In production CoinDCX is primary (true INR domain prices);
// in restricted networks Binance keeps the desk ALIVE instead of
// showing an empty board.
const _uniCache = new Map();
async function _cachedUniverse(key, ttlMs, fn) {
  const hit = _uniCache.get(key);
  if (hit && Date.now() - hit.at < ttlMs) return hit.val;
  let val;
  try { val = await fn(); } catch { val = hit ? hit.val : null; } // serve stale on refresh failure
  if (Array.isArray(val) && val.length > 0) _uniCache.set(key, { at: Date.now(), val });
  return Array.isArray(val) && val.length > 0 ? val : (hit ? hit.val : []);
}

// Live USD→INR (Yahoo, 1h cache — one rate for the whole scan).
let _usdInr = { at: 0, val: 95 };
export async function fetchUsdInr() {
  if (Date.now() - _usdInr.at < 3600_000) return _usdInr.val;
  try {
    const r = await fetch('https://query1.finance.yahoo.com/v8/finance/chart/USDINR=X?interval=1d&range=1d', {
      headers: { 'User-Agent': 'Mozilla/5.0 (WealthAI expert-picks)' },
      signal: AbortSignal.timeout(8000),
    });
    if (r.ok) {
      const j = await r.json();
      const p = Number(j?.chart?.result?.[0]?.meta?.regularMarketPrice);
      if (p > 50 && p < 200) { _usdInr = { at: Date.now(), val: p }; return p; }
    }
  } catch { /* keep last/95 */ }
  return _usdInr.val;
}

// CoinDCX-listed seed bases (fallback filter). In PRODUCTION the
// universe comes LIVE from the CoinDCX API itself, so this list only
// matters when the CoinDCX feed is unreachable (WAF/geo) and we're on
// the Binance fallback — it keeps tokenized stocks/ETFs (AAPL, EWY,
// SNXX...) out of the desk. New listings flow via the primary feed.
const COINDCX_SEEDS = [
  'BTC', 'ETH', 'BNB', 'SOL', 'XRP', 'DOGE', 'ADA', 'AVAX', 'LINK', 'DOT', 'TRX', 'POL',
  'LTC', 'BCH', 'UNI', 'ATOM', 'ETC', 'FIL', 'APT', 'ARB', 'OP', 'NEAR', 'INJ', 'SUI',
  'SEI', 'TIA', 'ICP', 'HBAR', 'VET', 'ALGO', 'EGLD', 'AXS', 'SAND', 'MANA', 'GALA',
  'CHZ', 'ENJ', 'AAVE', 'COMP', 'MKR', 'SNX', 'CRV', 'LDO', 'SUSHI', '1INCH', 'DYDX',
  'GMX', 'RUNE', 'CAKE', 'KAVA', 'ROSE', 'SKL', 'ANKR', 'CTSI', 'CELO', 'ZIL', 'QTUM',
  'ZEC', 'DASH', 'IOST', 'ICX', 'WAVES', 'KNC', 'BAND', 'OGN', 'STORJ', 'COTI', 'JASMY',
  'AUDIO', 'MASK', 'C98', 'SUPER', 'DAR', 'SHIB', 'PEPE', 'BONK', 'FLOKI', 'BABYDOGE',
  'WIF', 'BOME', 'MEME', 'ORDI', 'SATS', 'RATS', 'MITM', 'MOG', 'POPCAT', 'MEW', 'NFT',
  'MKR', 'GRT', 'The', 'MASK', 'PENGU', 'TRUMP', 'MELANIA', 'VIRTUAL', 'AI16Z', 'BERA',
  'TON', 'KAS', 'JUP', 'PYTH', 'W', 'ETHFI', 'ENA', 'OMNI', 'SAGA', 'STRK', 'ZK', 'ZRO',
  'BLUR', 'APE', 'GAS', 'WLD', 'ARKM', 'AGLD', 'HIGH', 'BADGER', 'PERP', 'RPL', 'SWISE',
  'DPX', 'GNDX', 'MAGIC', 'RDNT', 'JOE', 'PLE', 'SSV', 'FXS', 'GAINS', 'ID', 'UFT',
];
const SEED_SET = new Set(COINDCX_SEEDS);

// Binance 24h tickers (spot or futures) — top USDT bases by turnover,
// intersected with the CoinDCX seed list (fallback path only).
const BINANCE_BLOCKLIST = new Set([
  'XAU', 'XAG', 'CL', 'SPX', 'SOXL', 'SOXS', 'SPCX', 'SKHYNIX', 'SNDK', 'SNDKB',
  'SOPH', 'SNXX', 'KORU', 'AAPL', 'TSLA', 'MSTR', 'GOOG', 'AMZN', 'NVDA', 'COIN',
  'HOOD', 'SPY', 'QQQ', 'BABA', 'GME', 'AMD', 'INTC', 'MSFT', 'META', 'NFLX',
  'ORCL', 'CRCL', 'PLTR', 'USDC', 'FDUSD', 'TUSD', 'EUR', 'GBP', 'JPY',
  'AEUR', 'USD1', 'USDP', 'PAXG', 'WBTC', 'BTCB', 'EWY', 'EWT', 'INDIA', 'USO',
  'BRL', 'TRY', 'ARS', 'JPY', 'COP', 'HKD', 'CNH', 'AED', 'DAI', 'USDE', 'SUSD',
]);
async function _binanceTopBases(fapi, size) {
  const url = fapi ? 'https://fapi.binance.com/fapi/v1/ticker/24hr' : 'https://api.binance.com/api/v3/ticker/24hr';
  const r = await fetch(url, { signal: AbortSignal.timeout(12000) });
  if (!r.ok) throw new Error(`binance ${fapi ? 'futures' : 'spot'} HTTP ${r.status}`);
  const j = await r.json();
  let rows = (Array.isArray(j) ? j : [])
    .filter(x => x && typeof x.symbol === 'string' && x.symbol.endsWith('USDT'))
    .map(x => ({ base: x.symbol.replace(/USDT$/, ''), last: parseFloat(x.lastPrice), quoteVol: parseFloat(x.quoteVolume) }))
    .filter(x => /^[A-Z0-9]{2,10}$/.test(x.base) && !BINANCE_BLOCKLIST.has(x.base) && x.last > 0 && x.quoteVol > 0);
  // Fallback-path guard: only bases CoinDCX actually lists (seed set).
  const seeded = rows.filter(x => SEED_SET.has(x.base));
  if (seeded.length >= 10) rows = seeded; // seeds cover the desk — use them
  // else: keep raw top rows (prod uses the CoinDCX feed anyway)
  rows.sort((a, b) => b.quoteVol - a.quoteVol);
  const out = rows.slice(0, size);
  if (out.length === 0) throw new Error('binance: empty universe');
  return out; // [{base, last, quoteVol}]
}

/** Top liquid CoinDCX SPOT (INR pair) bases by 24h turnover. */
export async function discoverSpotUniverse(size = DEFAULT_UNIVERSE_SIZE) {
  return _cachedUniverse('spot-inr', 10 * 60_000, async () => {
    let bases = [];
    try {
      const { fetchCoinDcxTickers } = await import('../cryptoStream.js');
      const tickers = await fetchCoinDcxTickers();
      const rows = (Array.isArray(tickers) ? tickers : [])
        .filter(t => t && typeof t.market === 'string' && t.market.endsWith('INR'))
        .map(t => ({
          base: t.market.replace('INR', ''),
          inrPrice: parseFloat(t.last_price),
          vol24INR: (parseFloat(t.volume_24_hour) || 0) * (parseFloat(t.last_price) || 0),
        }))
        .filter(x => x.base && x.base.length <= 10 && /^[A-Z0-9]+$/.test(x.base) && x.inrPrice > 0 && x.vol24INR > 0)
        .sort((a, b) => b.vol24INR - a.vol24INR)
        .slice(0, size);
      bases = rows.map(r => r.base);
    } catch { /* CoinDCX blocked → Binance fallback below */ }
    if (bases.length === 0) {
      const bn = await _binanceTopBases(false, size); // spot fallback
      bases = bn.map(x => x.base);
    }
    // Static majors are ALWAYS in (deep books even on quiet days).
    const set = new Set(bases);
    for (const m of CRYPTO_UNIVERSE) if (!set.has(m)) bases.push(m);
    return bases.slice(0, size + CRYPTO_UNIVERSE.length);
  });
}

/** Top liquid CoinDCX GLOBAL FUTURES (B-<base>_USDT) bases by 24h volume. */
export async function discoverFuturesUniverse(size = DEFAULT_UNIVERSE_SIZE) {
  return _cachedUniverse('fut-usdt', 10 * 60_000, async () => {
    let bases = [];
    try {
      const rows = await fetchFuturesPrices();
      bases = (Array.isArray(rows) ? rows : [])
        .filter(x => x && x.base && x.volume > 0 && x.last > 0)
        .sort((a, b) => b.volume - a.volume)
        .slice(0, size)
        .map(x => x.base);
    } catch { /* CoinDCX futures blocked → Binance futures fallback */ }
    if (bases.length === 0) {
      const bn = await _binanceTopBases(true, size);
      bases = bn.map(x => x.base);
    }
    const set = new Set(bases);
    for (const m of CRYPTO_UNIVERSE) if (!set.has(m)) bases.push(m);
    return bases.slice(0, size + CRYPTO_UNIVERSE.length);
  });
}

/** Fallback price map (USDT domain → INR at live rate for spot).
 * v9: exported — the Superintelligence Signal Board reuses the same
 * CoinDCX-primary → Binance-fallback price chain as Expert Picks. */
export async function binancePriceMap(bases, futures) {
  try {
    const rows = await _binanceTopBases(futures, 200);
    const map = new Map();
    for (const r of rows) if (bases.includes(r.base)) map.set(r.base, futures ? r.last : r.last); // USDT domain
    return { map, source: futures ? 'binance-fut-usdt' : 'binance-usdt' };
  } catch { return { map: new Map(), source: null }; }
}

// ---------------- LTF candle loader (chunked, honest) ----------------
// v9: exported — the Superintelligence Signal Board loads LTF candles
// for its FULL dynamic universe through the same honest chain.
export async function loadLtfCandles(base, market) {
  try {
    if (market === 'CRYPTO') {
      const c = await fetchCoinDcxCandles(base, '1h').catch(() => null);
      if (Array.isArray(c) && c.length >= 60) return { candles: c, source: 'coindcx-1h' };
    } else if (market === 'FUTURES') {
      const c = await fetchFuturesCandles(futuresPairFor(base), '60').catch(() => null);
      if (Array.isArray(c) && c.length >= 60) return { candles: c, source: 'coindcx-fut-1h' };
    }
  } catch { /* fall through to Yahoo */ }
  const y = await fetchYahooIntradayCandles(base, market).catch(() => null);
  if (Array.isArray(y) && y.length >= 60) return { candles: y, source: market === 'INDIA' ? 'yahoo-15m' : 'yahoo-1h' };
  return { candles: null, source: null };
}

// ---------------- PURE: expert score factors ----------------
/**
 * Composite EXPERT SCORE for one coin, one implied side.
 * All inputs are plain numbers (TV row + LTF indicator snapshot) —
 * pure & unit-testable. Returns { side, score, factors[], negatives }.
 *
 * The side is decided FIRST (trend+momentum+SMC majority), then every
 * factor is graded FOR that side (a coin in an uptrend with a squeeze
 * scores its breakout readiness, not its short-side risk).
 */
export function expertScoreFactors({ tv, ltf, regime, market, smc = null }) {
  if (!tv && !ltf) return null;
  const ind = { ...(tv || {}), ...(ltf || {}) }; // LTF wins conflicts (fresher)
  const ltp = num(ind.ltp ?? ind.usdPrice) || num(tv?.usdPrice);
  if (!(ltp > 0)) return null;

  // --- side determination (majority of the three structure reads) ---
  const emaStackUp = (num(ind.ema10) ?? ltp) > (num(ind.ema20) ?? ltp) && (num(ind.ema20) ?? ltp) > (num(ind.ema50) ?? ltp);
  const emaStackDown = (num(ind.ema10) ?? ltp) < (num(ind.ema20) ?? ltp) && (num(ind.ema20) ?? ltp) < (num(ind.ema50) ?? ltp);
  // MACD shape guard: TV rows carry macd/macdSignal as NUMBERS, while
  // computeIndicatorsFromCandles returns macd as an OBJECT
  // ({macd, signal, hist}) — the merge would leave momentum reading a
  // NaN object-compare as bearish. Normalise BOTH shapes here.
  const macdObj = ind.macd && typeof ind.macd === 'object' ? ind.macd : null;
  const macdLine = macdObj ? num(macdObj.macd) : num(ind.macd);
  const macdSig = macdObj ? num(macdObj.signal) : num(ind.macdSignal);
  const macdUp = (macdLine ?? macdSig ?? 0) > (macdSig ?? 0);
  const macdHist = (macdLine ?? 0) - (macdSig ?? 0);
  const rsi = num(ind.rsi);

  // --- 1. TREND (0-100) ---
  let trend = 50;
  if (emaStackUp) trend += 30;
  else if (emaStackDown) trend -= 30;
  if (ltp > (num(ind.ema20) ?? ltp)) trend += 12; else trend -= 12;
  const adx = num(ind.adx);
  if (adx != null) trend += adx > 30 ? 18 : adx > 22 ? 10 : adx < 15 ? -10 : 0;
  trend = clamp(trend);

  // --- 2. MOMENTUM (0-100) ---
  let momentum = 50;
  if (rsi != null) {
    if (rsi >= 55 && rsi <= 70) momentum += 22;         // bullish sweet spot
    else if (rsi >= 45 && rsi < 55) momentum += 6;
    else if (rsi > 78) momentum -= 18;                   // overbought
    else if (rsi <= 45 && rsi >= 30) momentum -= 16;    // bearish lean
    else if (rsi < 30) momentum -= 24;                  // capitulation (oversold)
  }
  if (macdUp) momentum += 16; else momentum -= 16;
  if (macdHist > 0) momentum += 6;
  const st = ind.stochastic || {};
  if (num(st.k) != null && num(st.d) != null) {
    if (st.k > st.d && st.k < 80) momentum += 8;
    else if (st.k < st.d && st.k > 20) momentum -= 8;
  }
  momentum = clamp(momentum);

  // --- 3. VOLUME (0-100) ---
  let volume = 50;
  const rv = num(ind.relVolume);
  if (rv != null) {
    if (rv >= 1.8) volume += 34; else if (rv >= 1.3) volume += 22; else if (rv >= 1.05) volume += 8; else if (rv < 0.65) volume -= 18;
  }
  const obvSlope = num(ind.obvSlope);
  if (obvSlope != null) { if (obvSlope > 0.15) volume += 10; else if (obvSlope < -0.15) volume -= 10; }
  const mfi = num(ind.mfi);
  if (mfi != null) { if (mfi > 55 && mfi < 80) volume += 8; else if (mfi < 40) volume -= 8; }
  volume = clamp(volume);

  // --- 4. VOLATILITY (0-100) — is price RIDEABLE, not just volatile ---
  let volatility = 50;
  const bb = ind.bollinger || (num(ind.bbUpper) != null && num(ind.bbLower) != null ? {
    upper: ind.bbUpper, lower: ind.bbLower,
    percentB: (ltp - ind.bbLower) / Math.max(1e-9, ind.bbUpper - ind.bbLower),
    widthPct: ((ind.bbUpper - ind.bbLower) / ((ind.bbUpper + ind.bbLower) / 2)) * 100,
  } : null);
  if (bb && bb.percentB != null) {
    if (bb.percentB > 1) volatility -= 10;             // overextended
    else if (bb.percentB >= 0.72 && bb.percentB <= 1) volatility += 16; // riding band
    else if (bb.percentB <= 0.05) volatility -= 14;    // broken below band
    else if (bb.percentB >= 0.28 && bb.percentB < 0.72) volatility += 2;
    if (bb.widthPct != null) { if (bb.widthPct < 1.2) volatility += 10; else if (bb.widthPct > 9) volatility -= 12; } // squeeze → expansion fuel
  }
  const atr = num(ind.atr);
  const atrPctLtp = atr != null && ltp > 0 ? (atr / ltp) * 100 : null;
  if (atrPctLtp != null) {
    if (atrPctLtp >= 0.4 && atrPctLtp <= 2.5) volatility += 12; // sane crypto movement
    else if (atrPctLtp > 5) volatility -= 16;                   // wild — stops get run
  }
  volatility = clamp(volatility);

  // --- 5. REGIME (0-100) — BTC/NIFTY tailwind for the implied LONG ---
  let regimeScore = 50;
  const isCryptoish = market === 'CRYPTO' || market === 'FUTURES';
  if (isCryptoish) {
    const btc = num(regime?.btcChange);
    const btcTrend = regime?.btcTrend;
    if (btc != null) {
      if (btc > 0.75) regimeScore += 26; else if (btc < -0.75) regimeScore -= 26; else regimeScore += Math.sign(btc) * 6;
    }
    if (btcTrend === 'UP') regimeScore += 12; else if (btcTrend === 'DOWN') regimeScore -= 12;
  } else {
    const nifty = num(regime?.niftyChange);
    if (nifty != null) { if (nifty > 0.35) regimeScore += 22; else if (nifty < -0.35) regimeScore -= 22; }
    const vix = num(regime?.indiaVix);
    if (vix != null) { if (vix > 18) regimeScore -= 8; else if (vix < 12) regimeScore += 6; }
  }
  regimeScore = clamp(regimeScore);

  // --- 6. R:R QUALITY (0-100) — ATR-proportional stop = tradable ---
  let rr = 50;
  if (atrPctLtp != null) {
    if (atrPctLtp >= 0.5 && atrPctLtp <= 2.2) rr += 30;     // 1.6×ATR stop ≈ sane risk
    else if (atrPctLtp < 0.25) rr -= 20;                    // dead — SL too tight, noise stops out
    else if (atrPctLtp > 4) rr -= 24;                       // huge stop eats the R:R
    // v9.2: an ATR wider than 25% of price (micro-tick meme coins, thin
    // Yahoo fallback candles) is a 25%+ STOP — the blueprint's own
    // stop-cap kicks in and the honest R:R grade must scream it.
    if (atrPctLtp > 25) rr -= 35;
  }
  const high52 = num(ind.high52w), low52 = num(ind.low52w);
  if (high52 != null && low52 != null && high52 > low52) {
    const pos = (ltp - low52) / (high52 - low52);
    if (pos > 0.92) rr += 8;                                 // breakout room above
    else if (pos < 0.08) rr -= 6;                            // falling knife
  }
  rr = clamp(rr);

  // --- SIDE: weighted majority of trend/momentum (+smc if provided) ---
  const longLean = (trend - 50) * EXPERT_WEIGHTS.trend + (momentum - 50) * EXPERT_WEIGHTS.momentum;
  const side = longLean >= 0 ? 'LONG' : 'SHORT';

  // SMC factor — injected by the caller via smcVote (candles needed).
  const smv = smc && typeof smc === 'object' ? smc : null;
  const smcScore = smv ? smcAlignedValue(smv, side) : 50;

  // --- invert the side-shaped factors when SHORT (grade the SHORT) ---
  const sideTrend = side === 'LONG' ? trend : 100 - trend;
  const sideMomentum = side === 'LONG' ? momentum : 100 - momentum;
  const sideVolume = side === 'LONG' ? volume : 100 - volume;
  const sideVolatility = side === 'LONG' ? volatility : 100 - volatility;
  const sideRegime = side === 'LONG' ? regimeScore : 100 - regimeScore;

  const sideRr = rr; // R:R quality is side-agnostic (stop width math)

  const score = Math.round(clamp(
    EXPERT_WEIGHTS.trend * sideTrend +
    EXPERT_WEIGHTS.momentum * sideMomentum +
    EXPERT_WEIGHTS.volume * sideVolume +
    EXPERT_WEIGHTS.smc * smcScore +
    EXPERT_WEIGHTS.volatility * sideVolatility +
    EXPERT_WEIGHTS.regime * sideRegime +
    EXPERT_WEIGHTS.rr * sideRr,
  ));

  const factors = [
    { key: 'trend', label: 'Trend Structure', value: Math.round(sideTrend), weight: EXPERT_WEIGHTS.trend },
    { key: 'momentum', label: 'Momentum', value: Math.round(sideMomentum), weight: EXPERT_WEIGHTS.momentum },
    { key: 'volume', label: 'Volume Flow', value: Math.round(sideVolume), weight: EXPERT_WEIGHTS.volume },
    { key: 'smc', label: 'SMC / ICT', value: Math.round(smcScore), weight: EXPERT_WEIGHTS.smc },
    { key: 'volatility', label: 'Volatility Fit', value: Math.round(sideVolatility), weight: EXPERT_WEIGHTS.volatility },
    { key: 'regime', label: 'Market Regime', value: Math.round(sideRegime), weight: EXPERT_WEIGHTS.regime },
    { key: 'rr', label: 'R:R Quality', value: Math.round(sideRr), weight: EXPERT_WEIGHTS.rr },
  ];

  return { side, score, factors, ltp, atr, atrPctLtp, ema20: num(ind.ema20), rsi };
}

// Adaptive price precision — DOGE @ ₹15.40 needs different decimals
// than BTC @ ₹64,00,000. Never let rounding crush a low-price coin's
// levels to all-zero lookalikes (0.08 / 0.08 / 0.08).
// v9.2: moved to server/ai/lib/priceRound.js (shared with the plan
// engine + order layers); re-exported here for the existing tests/API.
export { pricePrecision } from './lib/priceRound.js';

// smcVote returns {dir, conf, reasons} — extract conf when aligned.
function smcAlignedValue(smv, side) {
  if (!smv) return 50;
  const agree = smv.dir === (side === 'LONG' ? 1 : -1);
  return Math.round(clamp(agree ? 50 + (smv.conf || 0) / 2 : 50 - 15));
}

// ---------------- PURE: the trade blueprint ----------------
/**
 * Build the complete EXPERT PICK blueprint — everything the ticket
 * needs: entry zone, SL, T1/T2/T3, leverage ladder, staged exit plan,
 * timing window, invalidation. Pure math on plain inputs.
 */
export function buildExpertBlueprint({ side, ltp, atr, score, market, ema20 = null, maxLeverageCap = 10, atrPctLtp = null }) {
  if (!(ltp > 0)) return null;
  const long = String(side || 'LONG').toUpperCase() !== 'SHORT';
  const a = (atr != null && atr > 0) ? atr : ltp * 0.012; // 1.2% fallback ATR
  const sgn = long ? 1 : -1;

  // Entry zone: a limit band straddling price (pullback-friendly).
  // v9.2: floor the low edge at 50% of price — an absurd ATR could push
  // it negative on micro-tick coins.
  const zoneLo = Math.max(long ? ltp - 0.35 * a : ltp - 0.10 * a, ltp * 0.5);
  const zoneHi = long ? ltp + 0.10 * a : ltp + 0.35 * a;
  const entry = ltp;

  // Stop: 1.6×ATR (crypto noise), never tighter than 0.9×ATR.
  // v9.2 STOP-DISTANCE CAP: an ATR wider than the price itself (JUP-class
  // micro ticks: ATR 283% of price) put SHORT targets NEGATIVE and LONG
  // stops negative. A stop beyond 30% of price is untradeable fiction —
  // cap it so every level (incl. the 3R runner) stays positive.
  const slDist = Math.min(Math.max(1.6 * a, ltp * 0.004), ltp * MAX_STOP_FRACTION);
  const stopLoss = long ? entry - slDist : entry + slDist;
  const t1 = entry + sgn * 1.0 * slDist;
  const t2 = entry + sgn * 2.0 * slDist;
  const t3 = entry + sgn * 3.0 * slDist;
  const slDistPct = r2((slDist / entry) * 100);
  // --- leverage ladder (liquidation-aware) ---
  const sane = maxSaneLeverage(slDistPct, maxLeverageCap);
  let leverage = market === 'FUTURES'
    ? Math.min(sane, score >= 88 ? 6 : score >= 80 ? 5 : 3)
    : market === 'CRYPTO'
      ? SPOT_LEVERAGE // spot INR = cash-and-carry, no margin
      : 1;            // India equities = MIS at broker, plan 1× honestly
  leverage = Math.max(1, leverage);
  const liquidation = leverage > 1 ? r2(long ? entry * (1 - 0.95 / leverage) : entry * (1 + 0.95 / leverage)) : null;

  // --- timing window ---
  const emaDist = ema20 != null && ema20 > 0 ? Math.abs(ltp - ema20) / a : 0;
  const timing = emaDist <= 0.5
    ? { mode: 'IMMEDIATE', note: `Price EMA20 ke ${emaDist.toFixed(1)}×ATR par hai — abhi entry le sakte ho` }
    : { mode: 'PULLBACK', note: `EMA20 (${pR(ema20)}) se ${emaDist.toFixed(1)}×ATR door hai — pullback zone me limit laga do (${pR(zoneLo)}–${pR(zoneHi)})` };

  // --- staged exit plan (prop-desk partials) ---
  const exitPlan = [
    { at: pR(t1), bookPct: 40, action: `T1 ${pR(t1)} — 40% book karo + SL ko entry (${pR(entry)}) pe breakeven kar do` },
    { at: pR(t2), bookPct: 40, action: `T2 ${pR(t2)} — 40% book karo + bacha 20% trail pe daal do (peak − 1×risk)` },
    { at: pR(t3), bookPct: 20, action: `T3 ${pR(t3)} — runner 20% trail karo ya poora exit` },
  ];

  // --- hold horizon from volatility ---
  const horizon = atrPctLtp != null && atrPctLtp > 2.2
    ? { label: 'INTRADAY', hours: 8, note: 'Volatility high — intraday manage karo, overnight risk mat lo' }
    : { label: 'SWING', hours: 72, note: 'Volatility sane — 1-3 din ka swing hold kar sakte ho' };

  return {
    side: long ? 'LONG' : 'SHORT',
    entry: pR(entry),
    entryZone: [pR(zoneLo), pR(zoneHi)],
    stopLoss: pR(stopLoss),
    targets: { t1: pR(t1), t2: pR(t2), t3: pR(t3) },
    rewardRisk: 2,
    slDistPct,
    leverage,
    maxSaneLeverage: sane,
    liquidation: liquidation != null ? pR(liquidation) : null,
    exitPlan,
    timing,
    horizon,
    invalidation: `SL ${pR(stopLoss)} break ho jaye YA BTC regime flip — pick cancel. Koi averaging mat karo.`,
  };
}

// ---------------- orchestrator ----------------
const _picksCache = new Map(); // market → { at, payload }
const PICKS_TTL = 60_000;

/**
 * Scan the whole tradable universe and return STRONG expert picks
 * (default minScore = 80) with full trade blueprints.
 */
export async function getExpertPicks(market, opts = {}) {
  const mkt = String(market || 'CRYPTO').toUpperCase() === 'FUTURES' ? 'FUTURES'
    : String(market || 'CRYPTO').toUpperCase() === 'INDIA' ? 'INDIA' : 'CRYPTO';
  const minScore = Math.max(1, Math.min(99, Number(opts.minScore) || EXPERT_MIN_STRONG));
  const limit = Math.max(1, Math.min(15, Number(opts.limit) || 12));

  const cacheKey = `${mkt}:${minScore}:${limit}`;
  const hit = _picksCache.get(cacheKey);
  if (hit && Date.now() - hit.at < PICKS_TTL && !opts.noCache) return hit.payload;

  const regime = await buildRegime(mkt).catch(() => ({}));

  // ---- universe + price discovery (CoinDCX primary → Binance fallback) ----
  let universe = [], tv = {}, priceMap = new Map(), priceSource = null;
  if (mkt === 'CRYPTO') {
    const [uni] = await Promise.all([discoverSpotUniverse().catch(() => [])]);
    universe = uni;
    try {
      const { fetchCoinDcxTickers } = await import('../cryptoStream.js');
      const tickers = await fetchCoinDcxTickers();
      priceMap = new Map((Array.isArray(tickers) ? tickers : [])
        .filter(t => t && typeof t.market === 'string' && t.market.endsWith('INR'))
        .map(t => [t.market.replace('INR', ''), parseFloat(t.last_price)]));
      if (priceMap.size > 0) priceSource = 'coindcx-inr';
    } catch { /* 403 → Binance */ }
    if (priceMap.size === 0) {
      const { map, source } = await binancePriceMap(universe, false); // USDT → INR
      if (map.size > 0) {
        const fx = await fetchUsdInr();
        for (const [b, usd] of map) priceMap.set(b, usd * fx); // spot INR domain
        priceSource = `${source}-x-inr`;
      }
    }
  } else if (mkt === 'FUTURES') {
    const [uni] = await Promise.all([discoverFuturesUniverse().catch(() => [])]);
    universe = uni;
    try {
      const futRows = await fetchFuturesPrices();
      priceMap = new Map((Array.isArray(futRows) ? futRows : []).map(x => [x.base, x.last]));
      if (priceMap.size > 0) priceSource = 'coindcx-fut-usdt';
    } catch { /* 403 → Binance futures */ }
    if (priceMap.size === 0) {
      const { map, source } = await binancePriceMap(universe, true);
      if (map.size > 0) {
        priceMap = map; // USDT domain already
        priceSource = source;
      }
    }
  } else {
    universe = [...INDIA_UNIVERSE];
  }
  if (universe.length === 0) {
    return { ok: false, market: mkt, reason: 'universe discovery failed (CoinDCX + Binance both unreachable)', picks: [], scanned: 0, generatedAt: Date.now() };
  }

  // TV scanner in chunks of 40 (crypto) — India batch is already one call.
  const tvChunks = [];
  if (mkt === 'INDIA') {
    tv = await fetchTVIndiaBatch(universe).catch(() => ({}));
  } else {
    for (let i = 0; i < universe.length; i += 40) tvChunks.push(universe.slice(i, i + 40));
    const outs = await Promise.allSettled(tvChunks.map(ch => fetchTVCryptoBatch(ch)));
    for (const o of outs) if (o.status === 'fulfilled' && o.value) tv = { ...tv, ...o.value };
  }

  // ---- per-coin scoring (LTF candles in bounded parallel batches) ----
  const picks = [];
  let scanned = 0;
  const BATCH = 12;
  for (let i = 0; i < universe.length; i += BATCH) {
    const batch = universe.slice(i, i + BATCH);
    const results = await Promise.allSettled(batch.map(async (base) => {
      const row = tv[base];
      const ltpPrice = mkt === 'CRYPTO' ? (priceMap.get(base) ?? (row?.usdPrice ? row.usdPrice * await fetchUsdInr() : null))
        : mkt === 'FUTURES' ? (priceMap.get(base) ?? row?.usdPrice ?? null)
        : row?.ltp ?? null;
      if (!(ltpPrice > 0)) return null;
      const { candles } = await loadLtfCandles(base, mkt).catch(() => ({ candles: null }));
      const ltfInd = candles ? computeIndicatorsFromCandles(candles) : null;
      // SMC factor from candles (side-aware conf already).
      let smv = null, smcReasons = [];
      if (candles && ltfInd) {
        const sv = smcVote(candles);
        if (sv && sv.dir !== 0 && (sv.conf || 0) > 0) {
          smv = { dir: sv.dir, conf: sv.conf };
          smcReasons = sv.reasons || [];
        }
      }
      const scored = expertScoreFactors({ tv: row, ltf: ltfInd, regime, market: mkt, smc: smv });
      if (!scored) return null;
      const finalScore = scored.score; // already SMC-aware inside factors
      const atr = scored.atr ?? (candles && ltfInd ? ltfInd.atr : null);
      const blueprint = buildExpertBlueprint({
        side: scored.side, ltp: scored.ltp, atr, score: finalScore, market: mkt,
        ema20: scored.ema20 ?? (ltfInd ? ltfInd.ema20 : null),
        maxLeverageCap: 10,
        atrPctLtp: scored.atrPctLtp ?? (ltfInd && scored.ltp > 0 ? (ltfInd.atr / scored.ltp) * 100 : null),
      });
      return {
        symbol: base, market: mkt, side: scored.side, score: finalScore,
        grade: finalScore >= EXPERT_MIN_STRONG ? 'STRONG' : finalScore >= EXPERT_MIN_ACTION ? 'ACTION' : 'WATCH',
        ltp: pR(scored.ltp), changePct: row?.changePct ?? null,
        factors: scored.factors,
        smcReasons,
        priceSource: mkt === 'CRYPTO' ? (priceMap.has(base) ? (priceSource || 'coindcx') : 'tv-approx') : mkt === 'FUTURES' ? (priceMap.has(base) ? (priceSource || 'coindcx-fut') : 'tv-approx') : (row?.ltp ? 'tv-nse' : null),
        candleSource: candles ? (mkt === 'INDIA' ? 'yahoo-15m' : candles.length >= 60 ? 'coindcx/yahoo-1h' : null) : null,
        plan: blueprint,
        generatedAt: Date.now(),
      };
    }));
    for (const rr of results) {
      if (rr.status === 'fulfilled' && rr.value) { picks.push(rr.value); scanned++; }
    }
  }

  const eligible = picks.filter(p => p.score >= minScore && p.plan).sort((a, b) => b.score - a.score).slice(0, limit);
  const payload = {
    ok: true,
    market: mkt,
    minScore,
    scanned,
    universeSize: universe.length,
    priceSource,
    marketOpen: mkt === 'INDIA' ? isNseOpen() : true,
    regime,
    picks: eligible,
    generatedAt: Date.now(),
  };
  _picksCache.set(cacheKey, { at: Date.now(), payload });
  return payload;
}

export function __clearExpertPicksCaches() {
  _picksCache.clear();
  _uniCache.clear();
}
