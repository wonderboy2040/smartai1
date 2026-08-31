// ============================================================
// intraday/engine — NSE intraday dual-source quant engine
// ------------------------------------------------------------
// Scoring stack (per side, clamped 0..100):
//   EMA10/20 stack 20 | VWAP bias 19 | RSI zone 14 | Rel.Volume 12
//   MACD 12 | Pivot/CPR 10 | ADX 10 | ORB-15 8 | Gap 7 | Day-range 7
//   minus: RSI exhaustion, extreme-gap, wrong-side-of-ORB penalties
//
// 2026 v3 upgrades (pro-desk):
//   • ORB-15 factor — LIVE opening range while 09:15–09:45 is
//     forming, ATR-proxy band afterwards (honest label: PROXY).
//   • Slippage model — ±7bps per side on INR prices; quantity and
//     effective RR are computed on slip-adjusted risk.
//   • Market-regime penalty — counter-trend setups (vs NIFTY/VIX
//     regime) lose conviction instead of firing blind.
// ============================================================
import { istMinutes, marketPhase } from './time.js';

export const INTRADAY_MIN_CONFIDENCE = 75;
export const INTRADAY_TOP_N = 5;
// Slippage assumption for liquid NSE F&O names: 7 basis points per side
// (entry fills worse + exit fills worse). Conservative but realistic for
// market-order fills on liquid large-caps.
export const SLIPPAGE_BPS = 7;

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
  const pivot = tv?.pivotMiddle ?? ltp;
  const pivotS1 = tv?.pivotS1 ?? (ltp * 0.98);
  const pivotR1 = tv?.pivotR1 ?? (ltp * 1.02);

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
    // RSI Sweet Zone — 14pts
    if (dir === 'LONG' ? (rsi >= 50 && rsi <= 72) : (rsi >= 28 && rsi <= 50)) {
      s += 14; reasons.push(`RSI ${Math.round(rsi)} momentum`);
    } else if (dir === 'LONG' ? (rsi >= 44 && rsi < 50) : (rsi > 50 && rsi <= 56)) { s += 8; }
    if (dir === 'LONG' && rsi > 78) s -= 6;
    if (dir === 'SHORT' && rsi < 22) s -= 6;
    // Relative Volume — 12pts
    if (relVolume >= 1.5) { s += 12; reasons.push(`Volume ${relVolume.toFixed(1)}x surge`); }
    else if (relVolume >= 1.1) { s += 8; reasons.push(`Volume ${relVolume.toFixed(1)}x`); }
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
    // ORB-15 — 8pts (breakout side bonus / wrong-side penalty)
    if (dir === 'LONG' ? ltp > orbHigh + 0.05 * atr : ltp < orbLow - 0.05 * atr) {
      s += 8; reasons.push(`ORB-15 ${dir === 'LONG' ? 'breakout' : 'breakdown'}${orbMode === 'PROXY' ? ' (proxy)' : ''}`);
    } else if (dir === 'LONG' ? ltp < orbLow : ltp > orbHigh) { s -= 3; }
    // Gap Analysis — 7pts
    if (dir === 'LONG' ? (gapPct > 0.2 && gapPct < 3.0) : (gapPct < -0.2 && gapPct > -3.0)) {
      s += 7; reasons.push(`Gap ${gapPct > 0 ? '+' : ''}${gapPct.toFixed(1)}%`);
    }
    if (dir === 'LONG' && gapPct > 3.5) s -= 4;
    if (dir === 'SHORT' && gapPct < -3.5) s -= 4;
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
  let counterTrend = false;
  const regime = opts?.regime;
  if (regime && typeof regime === 'object') {
    if (regime.regime === 'BEARISH' && direction === 'LONG') { quantConfidence -= 6; counterTrend = true; }
    if (regime.regime === 'BULLISH' && direction === 'SHORT') { quantConfidence -= 6; counterTrend = true; }
    if (regime.vixLevel === 'HIGH') { quantConfidence -= 3; reasons.push('High-VIX regime caution'); }
    if (counterTrend) reasons.push('Counter-regime (NIFTY filter)');
  }
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
    _rrOk: rr >= 1.25,
    _momentumPct: changePct,
  };
}

// ------------------------------------------------------------
// MCP AI verification — MULTI-MODEL CONSENSUS layer.
// deps: { KEYS, OPENAI_COMPAT } (injected from server/index.js)
// ------------------------------------------------------------
export async function aiVerifySignals(candidates, deps) {
  if (!candidates.length) return null;
  const { KEYS, OPENAI_COMPAT } = deps || {};
  const compact = candidates.map(c => ({
    sym: c.symbol, exch: c.exchange || 'NSE', dir: c.direction, q: c.quantConfidence,
    chg: c.changePct, rsi: c.rsi, vr: c.volumeRatio, rr: c.rr,
    vwapDist: c.vwapDist ?? +((((c.ltp - c.vwap) / c.vwap) * 100)).toFixed(2),
    adx: c.adx ?? 20, gap: c.gapPct ?? 0, phase: c.marketPhase || 'full',
    mom: c._momentumPct != null ? +c._momentumPct.toFixed(2) : undefined,
  }));
  const systemPrompt = `You are an elite NSE/BSE intraday trading desk analyst running as an MCP verification tool. You receive pre-scored setups from a quantitative engine (EMA/VWAP/ORB/CPR/ADX/Pivot/volume/momentum/gap factors). Verify each setup strictly. Penalize: RSI exhaustion (>75/<25), poor RR (<1.25), counter-VWAP direction, low relative volume (<1.1x), overextended moves far from VWAP (>1.5%), weak ADX (<18), extreme gap (>3%), counter-regime setups when NIFTY is strongly bearish (LONG) or bullish (SHORT). In early market phase (9:15-9:45 IST), reduce confidence by 5-10 pts as data stabilizes. Boost only high-conviction confluence with strong ADX (>25) and volume surge (>1.5x). Respond with STRICT JSON only, no markdown:\n{"verdicts":{"SYMBOL":{"verdict":"LONG"|"SHORT"|"AVOID","confidence":0-100,"note":"max 15 words"}}}`;
  const userPrompt = `Setups (q = engine confidence, vwapDist % = price vs VWAP):\n${JSON.stringify(compact)}`;

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
        generationConfig: { temperature: 0.2, maxOutputTokens: 2000 },
      }),
      signal: AbortSignal.timeout(12000),
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
        temperature: 0.2, max_completion_tokens: 2000,
      }),
      signal: AbortSignal.timeout(12000),
    });
    if (!r.ok) throw new Error(`${provider} ${r.status}`);
    const j = await r.json();
    const text = j?.choices?.[0]?.message?.content || '';
    return parseVerdicts(text);
  }

  // Parallel consensus across all available engines.
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

  // Merge: majority direction wins; confidence = blend of engine score(s).
  const merged = {};
  for (const c of candidates) {
    const votes = [];
    for (const resp of responses) {
      const v = resp.verdicts[c.symbol];
      if (v && v.verdict && typeof v.confidence === 'number') {
        votes.push({ verdict: String(v.verdict).toUpperCase(), confidence: v.confidence, note: v.note || '', model: resp.model });
      }
    }
    if (votes.length === 0) continue;
    const tradeVotes = votes.filter(v => v.verdict === 'LONG' || v.verdict === 'SHORT');
    if (tradeVotes.length === 0) {
      merged[c.symbol] = { verdict: 'AVOID', confidence: Math.round(votes[0].confidence * 0.5), note: votes[0].note || 'AI avoid', models: votes.map(v => v.model) };
      continue;
    }
    const counts = {};
    for (const v of tradeVotes) counts[v.verdict] = (counts[v.verdict] || 0) + 1;
    const dominant = Object.entries(counts).sort((a, b) => b[1] - a[1])[0][0];
    const agree = tradeVotes.filter(v => v.verdict === dominant);
    const avgConf = agree.reduce((s, v) => s + v.confidence, 0) / agree.length;
    merged[c.symbol] = {
      verdict: dominant,
      confidence: Math.round(avgConf),
      note: agree[0].note,
      models: [...new Set(votes.map(v => v.model))],
      dissent: tradeVotes.length - agree.length, // opposing AI votes
    };
  }
  return { verdicts: merged, models: responses.map(r => r.model) };
}
