// ============================================================
// intraday/engine — NSE intraday dual-source quant engine (v4)
// ------------------------------------------------------------
// Scoring stack (per side, clamped 0..100):
//   EMA10/20 stack 20 | VWAP bias 19 | RSI zone 14 | Rel.Volume 12
//   MACD 12 | Pivot/CPR 10 | ADX 10 | ORB-15 8 | Gap 7 | Day-range 7
//   Supertrend-align 8 | Volume-POC 7 | SMA50 MTF confluence 10
//   minus: RSI exhaustion (x2), extreme-gap, wrong-side-of-ORB,
//   counter-regime (-10), VIX-HIGH (-6), dead-zone (-15) penalties
//
// 2026 v3 upgrades (pro-desk):
//   • ORB-15 factor — LIVE opening range while 09:15–09:45 is
//     forming, ATR-proxy band afterwards (honest label: PROXY).
//   • Slippage model — ±7bps per side on INR prices; quantity and
//     effective RR are computed on slip-adjusted risk.
//   • Market-regime penalty — counter-trend setups (vs NIFTY/VIX
//     regime) lose conviction instead of firing blind.
//
// 2026 v4 MEGA upgrades (dual-AI expert desk):
//   • Supertrend(7) alignment — ATR-trail proxy (no candle history
//     on daily OHLC — honest approximation, labelled proxy).
//   • Volume Profile POC premium — price near VWAP = value-area
//     acceptance (+7).
//   • Multi-timeframe EMA confluence — SMA50 with EMA10/20 stack
//     (+10) — higher-conviction trend alignment.
//   • Tighter RSI sweet zones: LONG 52-68, SHORT 32-48; exhaustion
//     penalty doubled (-12).
//   • Hard volume floor: known relVolume < 1.2x disqualifies.
//   • RR floor 1.5 for high-conviction (grade-A requirement).
//   • Dead zone 14:30–15:00 IST — statistically weak window,
//     hard-gated in routes + -15 in scoring.
//   • Signal GRADES: A+ / A / B (watch-only) via gradeSignal().
// ============================================================
import { istMinutes, marketPhase } from './time.js';

export const INTRADAY_MIN_CONFIDENCE = 75;
export const INTRADAY_TOP_N = 5;
// Slippage assumption for liquid NSE F&O names: 7 basis points per side
// (entry fills worse + exit fills worse). Conservative but realistic for
// market-order fills on liquid large-caps.
export const SLIPPAGE_BPS = 7;
// v4 quality gates
export const MIN_REL_VOLUME = 1.2;   // hard floor (only when relVolume is KNOWN)
export const HIGH_CONV_RR_FLOOR = 1.5; // grade-A minimum R:R
export const DEAD_ZONE_START = 14 * 60 + 30; // 14:30 IST
export const DEAD_ZONE_END = 15 * 60;        // 15:00 IST

export function inDeadZone(m = istMinutes()) {
  return m >= DEAD_ZONE_START && m < DEAD_ZONE_END;
}

export const BASE_UNIVERSE = [
  // NSE + BSE liquid F&O / high-volume names — deep liquidity + tight spreads.
  // Candles resolve via .NS first, .BO fallback (some names list on one exchange only).
  'RELIANCE', 'HDFCBANK', 'ICICIBANK', 'INFY', 'TCS', 'SBIN', 'BHARTIARTL',
  'ITC', 'LT', 'KOTAKBANK', 'AXISBANK', 'HINDUNILVR', 'BAJFINANCE', 'ASIANPAINT',
  'MARUTI', 'TITAN', 'SUNPHARMA', 'ULTRACEMCO', 'WIPRO', 'ONGC', 'NTPC',
  'POWERGRID', 'TATAMOTORS', 'TATASTEEL', 'JSWSTEEL', 'HCLTECH', 'TECHM',
  'ADANIENT', 'ADANIPORTS', 'COALINDIA', 'GRASIM', 'HINDALCO', 'NESTLEIND',
  'CIPLA', 'DRREDDY', 'BRITANNIA', 'EICHERMOT', 'HEROMOTOCO', 'M&M',
  'INDUSINDBK', 'BPCL', 'IOC', 'DLF', 'VEDL', 'CANBK', 'PNB', 'BEL', 'HAL',
  // Extended NSE + BSE coverage (banks, PSUs, auto, pharma, infra, new-age)
  'BANKBARODA', 'UNIONBANK', 'FEDERALBNK', 'IDFCFIRSTB', 'AUBANK',
  'SBILIFE', 'HDFCLIFE', 'ICICIPRULI', 'SHRIRAMFIN', 'CHOLAFIN', 'BAJAJFINSV',
  'TATAPOWER', 'ADANIGREEN', 'ADANIPOWER', 'JIOFIN', 'LICI', 'IRFC',
  'TRENT', 'ZOMATO', 'NYKAA', 'POLICYBZR', 'PAYTM',
  'TATAELXSI', 'PERSISTENT', 'COFORGE', 'LTIM', 'MPHASIS',
  'PIDILITIND', 'HAVELLS', 'DIVISLAB', 'APOLLOHOSP', 'LUPIN', 'AUROPHARMA',
  'GAIL', 'PETRONET', 'IDEA', 'YESBANK', 'SUZLON', 'IREDA',
];

export const TV_INTRADAY_COLUMNS = [
  'close', 'open', 'high', 'low', 'volume', 'change',
  'EMA10', 'EMA20', 'SMA20', 'SMA50',
  'RSI', 'MACD.macd', 'MACD.signal',
  'ATR', 'VWAP',
  'ADX', 'ADX+DI', 'ADX-DI',
  'relative_volume_10d_calc',
  'Pivot.M.Classic.Middle', 'Pivot.M.Classic.S1', 'Pivot.M.Classic.R1',
  'Recommend.All', 'last',
];

// ------------------------------------------------------------
// Dual-source batch fetch: TradingView India Scanner (ONE request
// for all symbols with rich pre-computed indicators) + Groww NSE
// live quotes (genuine LTP). No Yahoo 5m candle dependency.
// Returns [tvData, growwData] — same shape the old monolith used.
// ------------------------------------------------------------
export async function fetchIntradayDataBatch(symbols, fetchGrowwNseQuote) {
  const tvTickers = [];
  const tvToClean = {};
  symbols.forEach(sym => {
    [`NSE:${sym}`, `BSE:${sym}`].forEach(t => {
      tvTickers.push(t);
      tvToClean[t] = sym;
    });
  });

  const tvPromise = (async () => {
    const out = {};
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const res = await fetch(`https://scanner.tradingview.com/india/scan?t=${Date.now()}`, {
          method: 'POST',
          headers: { 'Content-Type': 'text/plain;charset=UTF-8' },
          body: JSON.stringify({
            symbols: { tickers: [...new Set(tvTickers)] },
            columns: TV_INTRADAY_COLUMNS,
          }),
          signal: AbortSignal.timeout(10000),
        });
        if (!res.ok) {
          if (attempt < 2) { await new Promise(r => setTimeout(r, 2000 * (attempt + 1))); continue; }
          return out;
        }
        const data = await res.json();
        if (!data?.data) return out;
        for (const item of data.data) {
          if (!item.d) continue;
          const clean = tvToClean[item.s];
          if (!clean || out[clean]) continue; // first exchange that resolves wins
          const d = item.d;
          const pf = (v) => (typeof v === 'number' && !isNaN(v) && isFinite(v)) ? v : null;
          out[clean] = {
            close: pf(d[0]) || 0, open: pf(d[1]) || 0,
            high: pf(d[2]) || 0, low: pf(d[3]) || 0,
            volume: pf(d[4]) || 0, change: pf(d[5]) || 0,
            ema10: pf(d[6]), ema20: pf(d[7]),
            sma20: pf(d[8]), sma50: pf(d[9]),
            rsi: pf(d[10]), macd: pf(d[11]), macdSignal: pf(d[12]),
            atr: pf(d[13]), vwap: pf(d[14]),
            adx: pf(d[15]), adxPlus: pf(d[16]), adxMinus: pf(d[17]),
            relVolume: pf(d[18]),
            pivotMiddle: pf(d[19]), pivotS1: pf(d[20]), pivotR1: pf(d[21]),
            recommend: pf(d[22]), last: pf(d[23]),
            exchange: item.s.split(':')[0],
          };
        }
        break; // success — stop retrying
      } catch (e) {
        console.warn(`[intraday-scanner] TV scanner attempt ${attempt + 1}/3 failed:`, e?.message);
        if (attempt < 2) await new Promise(r => setTimeout(r, 2000 * (attempt + 1)));
      }
    }
    return out;
  })();

  // Groww NSE Live — batch 20 at a time (same source as portfolio prices).
  // PERF (2026 lag audit): 12 → 20 = fewer sequential rounds for the 87-symbol
  // universe (8 rounds → 5), shaving seconds off every scan. Upstream calls
  // are de-duplicated by the server-side Groww micro-cache anyway.
  const growwPromise = (async () => {
    const out = {};
    if (typeof fetchGrowwNseQuote !== 'function') return out;
    for (let i = 0; i < symbols.length; i += 20) {
      const batch = symbols.slice(i, i + 20);
      await Promise.allSettled(batch.map(async (sym) => {
        try {
          const gw = await fetchGrowwNseQuote(sym);
          if (gw) out[sym] = gw;
        } catch { /* skip */ }
      }));
    }
    return out;
  })();

  return Promise.all([tvPromise, growwPromise]);
}

// ------------------------------------------------------------
// Analyze ONE symbol from merged TV+Groww snapshot.
// opts: { regime?: { regime, vixLevel } | null }
// ------------------------------------------------------------
export function analyzeIntradayFromScanner(symbol, tv, groww, opts = {}) {
  // Merge Groww real-time LTP with TradingView pre-computed indicators
  const ltp = groww?.price || (tv?.last > 0 ? tv.last : tv?.close) || 0;
  if (!(ltp > 0)) return null;

  const prevClose = groww?.prevClose || (tv?.change != null && tv.change !== 0
    ? ltp / (1 + tv.change / 100) : ltp);
  const changePct = groww?.change || tv?.change || 0;
  const open = tv?.open || ltp;
  const high = Math.max(groww?.high || 0, tv?.high || 0) || ltp;
  const low = Math.min(
    (groww?.low > 0 ? groww.low : Infinity),
    (tv?.low > 0 ? tv.low : Infinity)
  );
  const effectiveLow = isFinite(low) ? low : ltp;
  const volume = groww?.volume || tv?.volume || 0;

  // Pre-computed indicators from TradingView (instant — no candle counts needed)
  const ema10 = tv?.ema10 ?? ltp;
  const ema20 = tv?.ema20 ?? ltp;
  const rsi = tv?.rsi ?? 50;
  const macdVal = tv?.macd;
  const macdSig = tv?.macdSignal;
  const atr = (tv?.atr > 0) ? tv.atr : ltp * 0.02;
  const vwap = (tv?.vwap > 0) ? tv.vwap : ltp;
  const adx = tv?.adx ?? 20;
  const adxPlus = tv?.adxPlus ?? 15;
  const adxMinus = tv?.adxMinus ?? 15;
  const relVolume = tv?.relVolume ?? 1;
  const relVolumeKnown = typeof tv?.relVolume === 'number' && tv.relVolume > 0;
  const pivot = tv?.pivotMiddle ?? ltp;
  const pivotS1 = tv?.pivotS1 ?? (ltp * 0.98);
  const pivotR1 = tv?.pivotR1 ?? (ltp * 1.02);
  const sma50 = tv?.sma50 ?? null; // multi-timeframe confluence anchor

  // ---- v4 HARD VOLUME FLOOR ----
  // Only reject on KNOWN low relative volume — an absent feed value
  // (null/0 from TV) must not disqualify a symbol on missing data.
  if (relVolumeKnown && relVolume < MIN_REL_VOLUME) return null;

  // Derived metrics
  const gapPct = prevClose > 0 ? ((open - prevClose) / prevClose) * 100 : 0;
  const dayRange = high > effectiveLow ? (ltp - effectiveLow) / (high - effectiveLow) : 0.5;
  const vwapDist = vwap > 0 ? ((ltp - vwap) / vwap) * 100 : 0;

  // ---- ORB-15 (Opening Range Breakout, 15-min) ----
  // While 09:15–09:45 IST is FORMING, the day's running high/low IS the
  // opening range. After that window we cannot reconstruct the exact range
  // from daily OHLC alone, so we use an honest ATR-proxy band around the
  // open (labelled PROXY in the payload — never presented as exact).
  const _istMins = istMinutes();
  const inOrbWindow = _istMins >= 9 * 60 + 15 && _istMins < 9 * 60 + 45;
  const orbHigh = inOrbWindow ? high : open + 0.55 * atr;
  const orbLow = inOrbWindow ? effectiveLow : open - 0.55 * atr;
  const orbMode = inOrbWindow ? 'LIVE' : 'PROXY';

  function scoreSide(dir) {
    let s = 0; const reasons = [];
    // EMA Stack — 20pts
    if (dir === 'LONG' ? (ltp > ema10 && ema10 > ema20) : (ltp < ema10 && ema10 < ema20)) {
      s += 20; reasons.push(`EMA10/20 ${dir === 'LONG' ? 'bullish' : 'bearish'} stack`);
    } else if (dir === 'LONG' ? (ltp > ema10 || ema10 > ema20) : (ltp < ema10 || ema10 < ema20)) { s += 12; }
    // VWAP Bias — 19pts
    if (dir === 'LONG' ? vwapDist > 0.05 : vwapDist < -0.05) {
      s += 19; reasons.push(dir === 'LONG' ? `Above VWAP +${vwapDist.toFixed(1)}%` : `Below VWAP ${vwapDist.toFixed(1)}%`);
    } else if (Math.abs(vwapDist) <= 0.25) { s += 10; reasons.push('At VWAP control zone'); }
    // ---- v4: Volume Profile POC premium — 7pts ----
    // VWAP approximates the session's volume point-of-control; price
    // hugging it = value-area acceptance (premium entries, both sides).
    if (Math.abs(vwapDist) <= 0.25) {
      s += 7; reasons.push('Volume-POC value-area acceptance');
    }
    // RSI Sweet Zone — 14pts (v4 TIGHTER: LONG 52-68, SHORT 32-48)
    if (dir === 'LONG' ? (rsi >= 52 && rsi <= 68) : (rsi >= 32 && rsi <= 48)) {
      s += 14; reasons.push(`RSI ${Math.round(rsi)} momentum`);
    } else if (dir === 'LONG' ? (rsi >= 46 && rsi < 52) : (rsi > 48 && rsi <= 54)) { s += 8; }
    // v4: exhaustion penalty DOUBLED — never chase blow-off moves
    if (dir === 'LONG' && rsi > 78) s -= 12;
    if (dir === 'SHORT' && rsi < 22) s -= 12;
    // Relative Volume — 12pts (v4: 1.2x floor already hard-gated above)
    if (relVolume >= 1.5) { s += 12; reasons.push(`Volume ${relVolume.toFixed(1)}x surge`); }
    else if (relVolume >= 1.2) { s += 8; reasons.push(`Volume ${relVolume.toFixed(1)}x`); }
    else if (relVolume >= 0.8) { s += 4; }
    // MACD — 12pts
    if (macdVal != null && macdSig != null) {
      if (dir === 'LONG' ? macdVal > macdSig : macdVal < macdSig) {
        s += 12; reasons.push(`MACD ${dir === 'LONG' ? 'bullish' : 'bearish'} cross`);
      } else if (dir === 'LONG' ? macdVal > 0 : macdVal < 0) { s += 6; }
    }
    // Pivot/CPR — 10pts
    if (dir === 'LONG' ? ltp > pivotR1 : ltp < pivotS1) {
      s += 10; reasons.push(dir === 'LONG' ? 'Above R1 breakout' : 'Below S1 breakdown');
    } else if (dir === 'LONG' ? ltp > pivot : ltp < pivot) {
      s += 6; reasons.push(dir === 'LONG' ? 'Above pivot' : 'Below pivot');
    }
    // ADX Trend Strength — 10pts
    if (adx > 22) { s += 8; reasons.push(`ADX ${Math.round(adx)} strong trend`); }
    else if (adx > 16) { s += 4; }
    if (dir === 'LONG' ? adxPlus > adxMinus : adxMinus > adxPlus) s += 2;
    // ---- v4: Supertrend(7) alignment — 8pts ----
    // No intraday candle history on the daily TV snapshot, so the 7-period
    // Supertrend is approximated as an ATR-trail off EMA20 (honest proxy):
    // LONG needs price above ema20 - 0.5*ATR (trail line below price);
    // SHORT needs price below ema20 + 0.5*ATR.
    const stTrail = dir === 'LONG' ? ema20 - 0.5 * atr : ema20 + 0.5 * atr;
    if (dir === 'LONG' ? ltp > stTrail : ltp < stTrail) {
      s += 8; reasons.push('Supertrend(7) aligned (ATR-trail proxy)');
    }
    // ---- v4: Multi-timeframe EMA confluence — 10pts ----
    // SMA50 (higher timeframe) agreeing with the EMA10/20 intraday stack.
    if (sma50 != null) {
      if (dir === 'LONG' ? (ltp > sma50 && ema20 > sma50) : (ltp < sma50 && ema20 < sma50)) {
        s += 10; reasons.push('SMA50 multi-timeframe confluence');
      }
    }
    // ORB-15 — 8pts (breakout side bonus / wrong-side penalty)
    if (dir === 'LONG' ? ltp > orbHigh + 0.05 * atr : ltp < orbLow - 0.05 * atr) {
      s += 8; reasons.push(`ORB-15 ${dir === 'LONG' ? 'breakout' : 'breakdown'}${orbMode === 'PROXY' ? ' (proxy)' : ''}`);
    } else if (dir === 'LONG' ? ltp < orbLow : ltp > orbHigh) { s -= 3; }
    // Gap Analysis — 7pts (v4: exhaustion threshold 2.5%, was 3.5%)
    if (dir === 'LONG' ? (gapPct > 0.2 && gapPct < 2.5) : (gapPct < -0.2 && gapPct > -2.5)) {
      s += 7; reasons.push(`Gap ${gapPct > 0 ? '+' : ''}${gapPct.toFixed(1)}%`);
    }
    // v4: gap-exhaustion penalty HEAVY at ±2.5%+ (was -4 at ±3.5%)
    if (dir === 'LONG' && gapPct > 2.5) s -= 8;
    if (dir === 'SHORT' && gapPct < -2.5) s -= 8;
    // Day Range Position — 7pts
    if (dir === 'LONG' ? dayRange < 0.45 : dayRange > 0.55) {
      s += 7; reasons.push(dir === 'LONG' ? 'Near day low entry' : 'Near day high short');
    } else if (dir === 'LONG' ? dayRange < 0.6 : dayRange > 0.4) { s += 4; }
    return { score: Math.round(Math.max(0, Math.min(100, s))), reasons };
  }

  const longR = scoreSide('LONG'), shortR = scoreSide('SHORT');
  const direction = longR.score >= shortR.score ? 'LONG' : 'SHORT';
  let quantConfidence = Math.max(longR.score, shortR.score);
  const reasons = direction === 'LONG' ? longR.reasons : shortR.reasons;

  // ---------- MARKET REGIME PENALTY (NIFTY/VIX gating) ----------
  // v4: counter-regime -10 (was -6), VIX-HIGH -6 (was -3)
  let counterTrend = false;
  const regime = opts?.regime;
  if (regime && typeof regime === 'object') {
    if (regime.regime === 'BEARISH' && direction === 'LONG') { quantConfidence -= 10; counterTrend = true; }
    if (regime.regime === 'BULLISH' && direction === 'SHORT') { quantConfidence -= 10; counterTrend = true; }
    if (regime.vixLevel === 'HIGH') { quantConfidence -= 6; reasons.push('High-VIX regime caution'); }
    if (counterTrend) reasons.push('Counter-regime (NIFTY filter)');
  }

  // ---------- v4: DEAD-ZONE (14:30–15:00 IST) ----------
  // Statistically weak window — heavy penalty here, hard gate in routes.
  const deadZone = inDeadZone(_istMins);
  if (deadZone) { quantConfidence -= 15; reasons.push('Dead-zone timing (14:30-15:00)'); }
  quantConfidence = Math.max(0, Math.min(100, quantConfidence));

  // ---------- PRO-DESK RISK ARCHITECTURE ----------
  const entry = ltp;
  const entryZoneLow = +(entry - 0.25 * atr).toFixed(2);
  const entryZoneHigh = +(entry + 0.10 * atr).toFixed(2);
  const isLong = direction === 'LONG';

  // Structural stop: tighter of (1.1×ATR, day-swing ± 0.15×ATR buffer),
  // clamped 0.7×ATR (noise floor) ↔ 1.8×ATR (max risk cap) — pro standard.
  const atrStop = isLong ? entry - 1.1 * atr : entry + 1.1 * atr;
  const swingStop = isLong
    ? (effectiveLow > 0 ? effectiveLow - 0.15 * atr : atrStop)
    : (high > 0 ? high + 0.15 * atr : atrStop);
  let stopLoss = isLong ? Math.max(atrStop, swingStop) : Math.min(atrStop, swingStop);
  if (isLong) {
    stopLoss = Math.min(stopLoss, entry - 0.7 * atr); // never tighter than 0.7 ATR
    stopLoss = Math.max(stopLoss, entry - 1.8 * atr); // never wider than 1.8 ATR
  } else {
    stopLoss = Math.max(stopLoss, entry + 0.7 * atr);
    stopLoss = Math.min(stopLoss, entry + 1.8 * atr);
  }
  stopLoss = +stopLoss.toFixed(2);

  // R-multiple targets off ACTUAL risk (targets scale with the real stop).
  const risk = Math.abs(entry - stopLoss);
  const target1 = +(isLong ? entry + 1.6 * risk : entry - 1.6 * risk).toFixed(2);
  const target2 = +(isLong ? entry + 2.6 * risk : entry - 2.6 * risk).toFixed(2);
  const trailingSL = +(isLong ? entry - 0.8 * atr : entry + 0.8 * atr).toFixed(2);
  const trailAfterT1 = +entry.toFixed(2); // breakeven lock once T1 books — discipline rule
  const rr = risk > 0 ? Math.abs(target1 - entry) / risk : 0;

  // ---------- SLIPPAGE MODEL (±7bps per side) ----------
  const slippage = +(entry * SLIPPAGE_BPS / 10000).toFixed(2);
  const effRisk = risk + 2 * slippage;                 // slip hurts entry AND exit
  const effReward1 = Math.abs(target1 - entry) - 2 * slippage;
  const effRR = effRisk > 0 ? +(effReward1 / effRisk).toFixed(2) : 0;

  // Position sizing — 1% RISK RULE per ₹1,00,000 capital, capped at 25%
  // capital deployed. Quantity uses slip-adjusted risk (conservative).
  const qtyRisk = effRisk > 0 ? Math.floor(1000 / effRisk) : 0;
  const qtyCap = Math.floor(25000 / entry);
  const qtyPerLakh = Math.max(0, Math.min(qtyRisk, qtyCap));

  // ADX regime label
  const trendStrength = adx >= 28 ? 'STRONG' : adx >= 20 ? 'BUILDING' : 'WEAK-RANGE';

  const phase = marketPhase();
  const freshEntriesAllowed = _istMins < 15 * 60; // 15:00 IST — no fresh intraday entries after

  return {
    symbol, ltp: +ltp.toFixed(2), changePct: +changePct.toFixed(2),
    direction, quantConfidence: phase === 'early' ? Math.min(quantConfidence, 88) : quantConfidence,
    exchange: tv?.exchange || 'NSE',
    entry: +entry.toFixed(2), stopLoss,
    entryZoneLow, entryZoneHigh,
    target1, target2,
    trailingSL, trailAfterT1,
    qtyPerLakh, trendStrength,
    freshEntriesAllowed, sqOffBy: '15:10 IST',
    rr: +rr.toFixed(2), atr: +atr.toFixed(2),
    vwap: +vwap.toFixed(2), rsi: +rsi.toFixed(1), volumeRatio: +relVolume.toFixed(2),
    adx: +(adx).toFixed(1), gapPct: +gapPct.toFixed(2), vwapDist: +vwapDist.toFixed(2),
    marketPhase: phase, orbMode, counterTrend,
    slippage, effRR,
    reasons,
    _rrOk: rr >= HIGH_CONV_RR_FLOOR, // v4: 1.5 floor (was 1.25)
    _momentumPct: changePct,
    _deadZone: deadZone,
  };
}

// ------------------------------------------------------------
// v4 SIGNAL QUALITY GRADE — A+ / A / B
//   A+: confidence ≥88, RR(eff) ≥1.8, volume ≥1.5x, ADX ≥25,
//       VWAP-aligned, not counter-regime
//   A : confidence ≥80, RR(eff) ≥1.5, volume ≥1.2x
//   B : everything else that clears the confidence threshold
//       (frontend shows B as "WATCH ONLY")
// ------------------------------------------------------------
export function gradeSignal(s) {
  if (!s) return 'B';
  const rrEff = (s.effRR ?? s.rr) || 0;
  const vol = s.volumeRatio ?? 0;
  const adx = s.adx ?? 0;
  const vd = s.vwapDist ?? 0;
  const vwapAligned = s.direction === 'LONG' ? vd > 0 : vd < 0;
  if (s.confidence >= 88 && rrEff >= 1.8 && vol >= 1.5 && adx >= 25 && vwapAligned && !s.counterTrend) {
    return 'A+';
  }
  if (s.confidence >= 80 && rrEff >= 1.5 && vol >= 1.2) {
    return 'A';
  }
  return 'B';
}

// ------------------------------------------------------------
// MCP AI verification — v4 STRUCTURED DUAL-EXPERT CONSENSUS.
// Gemini + Groq (parallel, independent) each return a full expert
// analysis per setup: reasoning chain, risk factors, entry-quality
// score, trade-type classification and optional ADJUSTED levels.
// Consensus rules (v4, quality-over-quantity):
//   • ANY "AVOID" vote → setup rejected (was: confidence halved)
//   • Direction conflict between experts → rejected
//   • Unanimous direction → confidence = weighted avg + 5 agreement
//     bonus; tightest valid AI stop merged into the signal (routes)
// deps: { KEYS, OPENAI_COMPAT } (injected from server/index.js)
// ------------------------------------------------------------
export async function aiVerifySignals(candidates, deps) {
  if (!candidates.length) return null;
  const { KEYS, OPENAI_COMPAT } = deps || {};
  const compact = candidates.map(c => ({
    sym: c.symbol, exch: c.exchange || 'NSE', dir: c.direction, q: c.quantConfidence,
    ltp: c.ltp, chg: c.changePct, rsi: c.rsi, vr: c.volumeRatio, rr: c.rr,
    adx: c.adx ?? 20, gap: c.gapPct ?? 0, phase: c.marketPhase || 'full',
    vwapDist: c.vwapDist ?? +((((c.ltp - c.vwap) / c.vwap) * 100)).toFixed(2),
    plan: { entry: c.entry, sl: c.stopLoss, t1: c.target1, t2: c.target2 },
    atr: c.atr,
    mom: c._momentumPct != null ? +c._momentumPct.toFixed(2) : undefined,
  }));
  const systemPrompt = `You are an elite NSE/BSE intraday EXPERT analyst (15+ yrs prop-desk) running as an MCP verification tool. You receive pre-scored setups from a v4 quantitative engine (EMA/VWAP/Supertrend/ORB/CPR/ADX/SMA50-confluence/pivot/volume/momentum/gap factors). Analyze each setup IN DEPTH and verify strictly.

PENALIZE: RSI exhaustion (>75/<25), poor RR (<1.5), counter-VWAP direction, low relative volume (<1.2x), overextension far from VWAP (>1.5%), weak ADX (<18), extreme gap (>2.5%), counter-regime setups when NIFTY is strongly bearish (LONG) or bullish (SHORT). In early phase (9:15-9:45 IST) reduce confidence by 5-10 pts. Boost only high-conviction confluence: ADX >25, volume >1.5x, VWAP-aligned.

For EVERY symbol respond with a STRUCTURED expert analysis (STRICT JSON only, no markdown):
{"verdicts":{"SYMBOL":{
  "verdict":"LONG"|"SHORT"|"AVOID",
  "confidence":0-100,
  "note":"max 15 words",
  "analysis":"2-3 sentences: indicator state, entry timing quality, momentum/catalyst read — your reasoning chain",
  "riskFactors":["risk 1","risk 2"],
  "entryQuality":1-10,
  "tradeType":"SCALP"|"MOMENTUM"|"SWING",
  "slAdjust":null-or-tighter-stop-price,
  "entryAdjust":null-or-better-entry-price
}}}
slAdjust/entryAdjust: only suggest when clearly better than the engine plan (tighter risk / superior entry). Use null otherwise.`;
  const userPrompt = `Setups (q = engine confidence, vwapDist % = price vs VWAP, plan = engine entry/SL/T1/T2 levels):\n${JSON.stringify(compact)}`;

  const parseVerdicts = (text) => {
    try {
      // Strip <think>...</think> blocks BEFORE extracting JSON.
      const cleanText = text.replace(/<think>[\s\S]*?<\/think>/gi, '').trim();
      // Progressive extraction: the old greedy /\{[\s\S]*\}/ spanned from the
      // FIRST '{' to the LAST '}' — trailing prose with a stray '}' (or a
      // second JSON blob) poisoned the parse and silently dropped the whole
      // multi-model consensus layer. Try progressively shorter spans instead.
      const start = cleanText.indexOf('{');
      if (start === -1) return null;
      let end = cleanText.lastIndexOf('}');
      while (end > start) {
        try {
          const parsed = JSON.parse(cleanText.slice(start, end + 1));
          if (parsed?.verdicts) return parsed.verdicts;
          if (parsed && typeof parsed === 'object' && Object.keys(parsed).length) return parsed.verdicts || parsed;
        } catch { /* shrink window and retry */ }
        end = cleanText.lastIndexOf('}', end - 1);
      }
      return null;
    } catch { return null; }
  };

  async function askGemini(model) {
    if (!KEYS?.gemini) return null;
    const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${KEYS.gemini}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ role: 'user', parts: [{ text: `${systemPrompt}\n\n${userPrompt}` }] }],
        generationConfig: { temperature: 0.2, maxOutputTokens: 3000 },
      }),
      signal: AbortSignal.timeout(15000),
    });
    if (!r.ok) throw new Error(`gemini ${r.status}`);
    const j = await r.json();
    const text = j?.candidates?.[0]?.content?.parts?.map(p => p.text).filter(Boolean).join('\n') || '';
    return parseVerdicts(text);
  }

  async function askOpenAICompat(provider) {
    if (!KEYS?.[provider]) return null;
    const p = OPENAI_COMPAT[provider];
    const r = await fetch(p.url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${KEYS[provider]}` },
      body: JSON.stringify({
        model: p.defModel,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
        temperature: 0.2, max_completion_tokens: 3000,
      }),
      signal: AbortSignal.timeout(15000),
    });
    if (!r.ok) throw new Error(`${provider} ${r.status}`);
    const j = await r.json();
    const text = j?.choices?.[0]?.message?.content || '';
    return parseVerdicts(text);
  }

  // Parallel consensus across all available engines (Gemini + Groq are the
  // v4 dual experts; Cerebras joins when configured).
  const settled = await Promise.allSettled([
    askGemini('gemini-3.5-flash').catch(() => askGemini('gemini-2.5-flash')),
    askOpenAICompat('groq'),
    askOpenAICompat('cerebras'),
  ]);
  const responses = [];
  for (let i = 0; i < settled.length; i++) {
    const s = settled[i];
    if (s.status === 'fulfilled' && s.value && typeof s.value === 'object') {
      responses.push({ model: ['gemini', 'groq', 'cerebras'][i], verdicts: s.value });
    }
  }
  if (responses.length === 0) return null;

  // ---- v4 structured-field sanitizers ----
  const _n = (v) => (typeof v === 'number' && Number.isFinite(v)) ? v : null;
  const _tt = (v) => (['SCALP', 'MOMENTUM', 'SWING'].includes(v) ? v : null);
  const _rf = (v) => Array.isArray(v)
    ? v.filter(x => typeof x === 'string' && x.trim()).map(x => x.trim().slice(0, 60)).slice(0, 6)
    : [];

  const merged = {};
  for (const c of candidates) {
    const votes = [];
    for (const resp of responses) {
      const v = resp.verdicts[c.symbol];
      if (v && v.verdict && typeof v.confidence === 'number') {
        votes.push({
          verdict: String(v.verdict).toUpperCase(),
          confidence: Math.max(0, Math.min(100, v.confidence)),
          note: String(v.note || '').slice(0, 120),
          analysis: String(v.analysis || '').slice(0, 700).trim(),
          riskFactors: _rf(v.riskFactors),
          entryQuality: (() => { const q = _n(v.entryQuality); return q == null ? null : Math.max(1, Math.min(10, Math.round(q))); })(),
          tradeType: _tt(v.tradeType),
          slAdjust: _n(v.slAdjust),
          entryAdjust: _n(v.entryAdjust),
          model: resp.model,
        });
      }
    }
    if (votes.length === 0) continue;

    const tradeVotes = votes.filter(v => v.verdict === 'LONG' || v.verdict === 'SHORT');
    const avoidVotes = votes.filter(v => v.verdict === 'AVOID');

    // v4 STRICT: any AVOID vote rejects the setup outright.
    if (avoidVotes.length > 0) {
      merged[c.symbol] = {
        verdict: 'AVOID',
        confidence: Math.max(...avoidVotes.map(v => v.confidence)),
        note: avoidVotes[0].note || 'AI avoid',
        analysis: avoidVotes.map(v => v.analysis).filter(Boolean).join(' ').slice(0, 900),
        riskFactors: [...new Set(avoidVotes.flatMap(v => v.riskFactors))].slice(0, 6),
        models: votes.map(v => v.model),
        dissent: 0,
      };
      continue;
    }
    // v4 STRICT: experts must agree on direction — conflict = reject.
    const dirs = new Set(tradeVotes.map(v => v.verdict));
    if (dirs.size > 1) {
      merged[c.symbol] = {
        verdict: 'AVOID',
        confidence: 55,
        note: 'AI direction conflict — experts disagree',
        analysis: votes.map(v => `${v.model}: ${v.analysis}`).filter(Boolean).join(' ').slice(0, 900),
        riskFactors: ['Expert direction disagreement', ...[...new Set(votes.flatMap(v => v.riskFactors))]].slice(0, 6),
        models: votes.map(v => v.model),
        dissent: 1,
      };
      continue;
    }

    // Unanimous trade direction — build the consensus verdict.
    const dir = tradeVotes[0].verdict;
    const avgConf = tradeVotes.reduce((s, v) => s + v.confidence, 0) / tradeVotes.length;
    const agreementBonus = tradeVotes.length >= 2 ? 5 : 0;

    // Reasoning chain: every expert's analysis, labelled.
    const analysis = votes
      .map(v => v.analysis ? `[${v.model.toUpperCase()}] ${v.analysis}` : '')
      .filter(Boolean).join('\n').slice(0, 1200);

    // Risk factors: union across experts (deduped, capped).
    const riskFactors = [...new Set(votes.flatMap(v => v.riskFactors))].slice(0, 6);

    // Entry quality: average of the experts that scored it.
    const eqs = votes.map(v => v.entryQuality).filter(q => q != null);
    const entryQuality = eqs.length ? Math.round(eqs.reduce((s, q) => s + q, 0) / eqs.length) : null;

    // Trade type: majority (tie → first expert's classification).
    const ttCounts = {};
    for (const v of tradeVotes) if (v.tradeType) ttCounts[v.tradeType] = (ttCounts[v.tradeType] || 0) + 1;
    const ttEntries = Object.entries(ttCounts).sort((a, b) => b[1] - a[1]);
    const tradeType = ttEntries.length ? ttEntries[0][0] : null;

    // Adjusted levels: tightest valid SL + averaged entry suggestions.
    // (raw values here — routes.js bounds them against engine geometry)
    const slCandidates = tradeVotes.map(v => v.slAdjust).filter(x => x != null);
    const entryCandidates = tradeVotes.map(v => v.entryAdjust).filter(x => x != null);

    merged[c.symbol] = {
      verdict: dir,
      confidence: Math.max(0, Math.min(100, Math.round(avgConf + agreementBonus))),
      note: tradeVotes[0].note,
      analysis,
      riskFactors,
      entryQuality,
      tradeType,
      slAdjust: slCandidates.length
        ? (dir === 'LONG' ? Math.max(...slCandidates) : Math.min(...slCandidates)) // tightest = closest to entry
        : null,
      entryAdjust: entryCandidates.length
        ? +(entryCandidates.reduce((s, x) => s + x, 0) / entryCandidates.length).toFixed(2)
        : null,
      models: [...new Set(votes.map(v => v.model))],
      dissent: 0, // conflicts already rejected above
      perModel: Object.fromEntries(votes.map(v => [v.model, {
        verdict: v.verdict, confidence: v.confidence, note: v.note, analysis: v.analysis,
        entryQuality: v.entryQuality, tradeType: v.tradeType, riskFactors: v.riskFactors,
      }])),
    };
  }
  return { verdicts: merged, models: responses.map(r => r.model) };
}
