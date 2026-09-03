// ============================================================
// server/ai/models.js — THE SUPERINTELLIGENCE ENSEMBLE (9 models)
// ------------------------------------------------------------
// Each model is an independent "AI analyst" with its own specialty,
// reading the SAME live context and casting a weighted vote:
//
//   { dir: +1 | 0 | -1, conf: 0-100, reasons: [...] }
//
// MODEL REGISTRY (weights tuned for signal reliability):
//   1. TrendMatrix      1.4  multi-EMA alignment + ADX/DMI + supertrend
//   2. MomentumQuant    1.3  RSI regime + MACD histogram + stochastic
//   3. VolatilityScope  0.9  Bollinger squeeze/expansion + ATR percentile
//   4. VolumeFlow       1.2  rel-volume + OBV slope + MFI + VWAP side
//   5. PatternNeural    1.0  candlestick patterns + 52-week position
//   6. SRMatrix         1.1  pivot / breakout proximity logic
//   7. OptionsFlow      1.0  PCR + max-pain + IV (India indices only)
//   8. MacroRegime      0.8  NIFTY/VIX gate (India) / BTC gate (crypto)
//   9. AICouncil        1.5  LLM verification (Gemini→Groq→Cerebras)
//                           — honest OFFLINE when no AI keys configured
//
// The ensemble aggregator (ensemble.js) turns these votes into ONE
// consensus: side, confidence, agreement and the STRONG grade that
// gates live order execution.
// ============================================================

// helper: clamp + round
const clamp = (v, lo = 0, hi = 100) => Math.max(lo, Math.min(hi, v));
const r1 = (v) => (typeof v === 'number' && Number.isFinite(v) ? Math.round(v * 10) / 10 : null);

function vote(dir, conf, reasons) {
  return { dir, conf: Math.round(clamp(conf)), reasons: reasons.filter(Boolean) };
}

// ------------------------------------------------------------
// 1. TrendMatrix — the trend engine
// ------------------------------------------------------------
function trendMatrix(ctx) {
  const i = ctx.ind || {};
  const pts = [];
  let score = 0, conf = 0;

  // EMA stack alignment (10 > 20 > 50 for uptrend).
  if (i.ema10 != null && i.ema20 != null && i.ema50 != null) {
    if (i.ema10 > i.ema20 && i.ema20 > i.ema50) { score += 2; pts.push('EMA 10>20>50 bullish stack'); }
    else if (i.ema10 < i.ema20 && i.ema20 < i.ema50) { score -= 2; pts.push('EMA 10<20<50 bearish stack'); }
    else { score += i.ema10 > i.ema20 ? 0.5 : -0.5; pts.push('EMA stack mixed'); }
  }
  // Price vs 50-period average.
  if (i.ema50 != null && ctx.ltp) {
    const dist = ((ctx.ltp - i.ema50) / i.ema50) * 100;
    if (Math.abs(dist) < 0.3) pts.push(`at EMA50 (${r1(dist)}%)`);
    else score += dist > 0 ? 0.7 : -0.7;
  }
  // ADX / DMI — trend strength gate.
  const adx = i.adx?.adx;
  if (adx != null) {
    const plus = i.adx?.plusDI ?? 0, minus = i.adx?.minusDI ?? 0;
    const dirn = plus > minus ? 1 : -1;
    if (adx >= 25) { score += 1.2 * dirn; pts.push(`ADX ${r1(adx)} trending, ${dirn > 0 ? '+DI leads' : '-DI leads'}`); }
    else if (adx < 18) { conf -= 12; pts.push(`ADX ${r1(adx)} weak trend`); }
  }
  // Supertrend direction.
  const st = i.supertrend?.direction;
  if (st === 1) { score += 0.8; pts.push('Supertrend bullish'); }
  else if (st === -1) { score -= 0.8; pts.push('Supertrend bearish'); }

  const dir = score > 1.2 ? 1 : score < -1.2 ? -1 : 0;
  conf = clamp(38 + Math.abs(score) * 17 + conf);
  return vote(dir, dir === 0 ? 30 : conf, pts);
}

// ------------------------------------------------------------
// 2. MomentumQuant — RSI + MACD + stochastic
// ------------------------------------------------------------
function momentumQuant(ctx) {
  const i = ctx.ind || {};
  const pts = [];
  let score = 0, conf = 40;

  const rsi = i.rsi;
  if (rsi != null) {
    if (rsi > 75) { score -= 0.9; pts.push(`RSI ${r1(rsi)} overbought — exhaustion risk`); }
    else if (rsi < 25) { score += 0.9; pts.push(`RSI ${r1(rsi)} oversold — bounce fuel`); }
    else if (rsi > 55) { score += 1.0; pts.push(`RSI ${r1(rsi)} bullish zone`); }
    else if (rsi < 45) { score -= 1.0; pts.push(`RSI ${r1(rsi)} bearish zone`); }
    else pts.push(`RSI ${r1(rsi)} neutral`);
  }
  const m = i.macd;
  if (m && m.hist != null) {
    const h = m.hist / Math.max(1e-9, Math.abs(ctx.ltp || 1)) * 10000; // bps of price
    if (m.hist > 0 && m.histSlope > 0) { score += 1.1; pts.push('MACD histogram positive & rising'); }
    else if (m.hist < 0 && m.histSlope < 0) { score -= 1.1; pts.push('MACD histogram negative & falling'); }
    else if (m.histSlope > 0) { score += 0.4; pts.push('MACD turning up'); }
    else if (m.histSlope < 0) { score -= 0.4; pts.push('MACD turning down'); }
    if (Math.abs(h) > 120) conf -= 8; // extreme extension
  }
  if (i.stochK != null && i.stochD != null) {
    if (i.stochK > 80 && i.stochK < i.stochD) { score -= 0.5; pts.push('Stochastic rolling over from OB'); }
    else if (i.stochK < 20 && i.stochK > i.stochD) { score += 0.5; pts.push('Stochastic crossing up from OS'); }
    else if (i.stochK > i.stochD && i.stochK < 80) { score += 0.4; pts.push('Stoch K>D mid-zone'); }
    else if (i.stochK < i.stochD && i.stochK > 20) { score -= 0.4; pts.push('Stoch K<D mid-zone'); }
  }
  const roc = i.roc;
  if (roc != null) {
    if (roc > 4) { score += 0.4; pts.push(`10-bar ROC +${r1(roc)}%`); }
    else if (roc < -4) { score -= 0.4; pts.push(`10-bar ROC ${r1(roc)}%`); }
  }

  const dir = score > 1.0 ? 1 : score < -1.0 ? -1 : 0;
  return vote(dir, dir === 0 ? 28 : clamp(conf + Math.abs(score) * 15), pts);
}

// ------------------------------------------------------------
// 3. VolatilityScope — BB + ATR regime
// ------------------------------------------------------------
function volatilityScope(ctx) {
  const i = ctx.ind || {};
  const pts = [];
  let score = 0, conf = 35;

  const bb = i.bollinger || (i.bbUpper != null && i.bbLower != null && ctx.ltp ? {
    upper: i.bbUpper, lower: i.bbLower,
    mid: (i.bbUpper + i.bbLower) / 2,
    percentB: (ctx.ltp - i.bbLower) / Math.max(1e-9, i.bbUpper - i.bbLower),
    widthPct: ((i.bbUpper - i.bbLower) / ((i.bbUpper + i.bbLower) / 2)) * 100,
  } : null);

  if (bb && bb.percentB != null) {
    if (bb.percentB > 1) { score -= 0.8; pts.push('Price above upper Bollinger — overextended'); }
    else if (bb.percentB < 0) { score += 0.8; pts.push('Price below lower Bollinger — stretched down'); }
    else if (bb.percentB > 0.7) { score += 0.7; pts.push('%B 0.7+ — riding upper band'); }
    else if (bb.percentB < 0.3) { score -= 0.7; pts.push('%B 0.3- — riding lower band'); }
    else pts.push(`%B ${r1(bb.percentB * 100)}% mid-band`);
    // Squeeze: compressed bands often precede expansion moves — direction-neutral boost.
    if (bb.widthPct != null && bb.widthPct < 2) { conf += 10; pts.push(`BB squeeze (${r1(bb.widthPct)}% width) — breakout pending`); }
    else if (bb.widthPct != null && bb.widthPct > 8) { conf -= 8; pts.push(`BB wide (${r1(bb.widthPct)}%) — chop risk`); }
  }
  const ap = i.atrPct;
  if (ap != null) {
    if (ap > 85) { conf += 6; pts.push(`ATR percentile ${r1(ap)} — volatility expanding`); }
    else if (ap < 15) { conf -= 10; pts.push(`ATR percentile ${r1(ap)} — dead tape`); }
  }

  const dir = score > 0.8 ? 1 : score < -0.8 ? -1 : 0;
  return vote(dir, dir === 0 ? 25 : clamp(conf + Math.abs(score) * 18), pts);
}

// ------------------------------------------------------------
// 4. VolumeFlow — volume confirms the move
// ------------------------------------------------------------
function volumeFlow(ctx) {
  const i = ctx.ind || {};
  const pts = [];
  let score = 0, conf = 35;

  const rv = i.relVolume;
  if (rv != null) {
    if (rv > 1.5) { conf += 12; pts.push(`Relative volume ${r1(rv)}x — participation`); }
    else if (rv > 1.1) { conf += 5; pts.push(`Relative volume ${r1(rv)}x`); }
    else if (rv < 0.7) { conf -= 12; pts.push(`Relative volume ${r1(rv)}x — thin`); }
  }
  const chg = ctx.changePct || 0;
  if (rv != null && rv > 1.2 && chg > 0.4) { score += 1.2; pts.push('Volume-backed upmove'); }
  else if (rv != null && rv > 1.2 && chg < -0.4) { score -= 1.2; pts.push('Volume-backed downmove'); }
  else if (rv != null && rv < 0.8 && Math.abs(chg) > 1) { score -= Math.sign(chg) * 0.6; pts.push('Move on thin volume — suspect'); }

  const obv = i.obvSlope;
  if (obv != null) {
    if (obv > 0.15) { score += 0.8; pts.push('OBV rising (accumulation)'); }
    else if (obv < -0.15) { score -= 0.8; pts.push('OBV falling (distribution)'); }
  }
  const m = i.mfi;
  if (m != null) {
    if (m > 80) { score -= 0.3; pts.push(`MFI ${r1(m)} overheated`); }
    else if (m < 20) { score += 0.3; pts.push(`MFI ${r1(m)} capitulated`); }
    else if (m > 55) { score += 0.4; pts.push(`MFI ${r1(m)} money inflow`); }
    else if (m < 45) { score -= 0.4; pts.push(`MFI ${r1(m)} money outflow`); }
  }
  if (i.vwap != null && ctx.ltp) {
    const vd = ((ctx.ltp - i.vwap) / i.vwap) * 100;
    if (vd > 0.15 && vd < 2) { score += 0.7; pts.push(`Above VWAP +${r1(vd)}%`); }
    else if (vd < -0.15 && vd > -2) { score -= 0.7; pts.push(`Below VWAP ${r1(vd)}%`); }
    else if (Math.abs(vd) >= 2) { score -= Math.sign(vd) * 0.3; pts.push(`Far from VWAP (${r1(vd)}%) — mean-reversion risk`); }
  }

  const dir = score > 0.9 ? 1 : score < -0.9 ? -1 : 0;
  return vote(dir, dir === 0 ? 25 : clamp(conf + Math.abs(score) * 16), pts);
}

// ------------------------------------------------------------
// 5. PatternNeural — candlestick + 52-week context
// ------------------------------------------------------------
function patternNeural(ctx) {
  const i = ctx.ind || {};
  const pts = [];
  let score = 0, conf = 32;

  const patterns = Array.isArray(i.patterns) ? i.patterns : [];
  for (const p of patterns) {
    if (p.bias === 1) { score += 0.9; pts.push(`${p.name} (bullish)`); }
    else if (p.bias === -1) { score -= 0.9; pts.push(`${p.name} (bearish)`); }
    else pts.push(`${p.name} (indecision)`);
  }
  if (i.high52w != null && i.low52w != null && ctx.ltp) {
    const range = i.high52w - i.low52w;
    const pos = range > 0 ? (ctx.ltp - i.low52w) / range : 0.5;
    if (pos > 0.95) { score += 0.6; conf += 6; pts.push('At 52-week high — breakout zone'); }
    else if (pos > 0.8) { score += 0.3; pts.push(`Near 52w high (${Math.round(pos * 100)}%)`); }
    else if (pos < 0.05) { score -= 0.6; conf += 6; pts.push('At 52-week low — breakdown zone'); }
    else if (pos < 0.2) { score -= 0.3; pts.push(`Near 52w low (${Math.round(pos * 100)}%)`); }
    else pts.push(`52w range position ${Math.round(pos * 100)}%`);
  }
  const rec = i.recommend;
  if (rec != null) {
    // TV's own aggregate recommendation: -1..1 scale.
    if (rec > 0.3) { score += 0.5; pts.push('TV composite rating bullish'); }
    else if (rec < -0.3) { score -= 0.5; pts.push('TV composite rating bearish'); }
  }

  const dir = score > 0.7 ? 1 : score < -0.7 ? -1 : 0;
  return vote(dir, dir === 0 ? 22 : clamp(conf + patterns.length * 8 + Math.abs(score) * 14), pts);
}

// ------------------------------------------------------------
// 6. SRMatrix — support/resistance + pivots
// ------------------------------------------------------------
function srMatrix(ctx) {
  const i = ctx.ind || {};
  const pts = [];
  let score = 0, conf = 30;

  const piv = i.pivot;
  if (piv && piv.p != null && ctx.ltp) {
    const d = ((ctx.ltp - piv.p) / piv.p) * 100;
    if (d > 0.2) { score += 0.7; pts.push(`Above pivot (${r1(d)}%)`); }
    else if (d < -0.2) { score -= 0.7; pts.push(`Below pivot (${r1(d)}%)`); }
    else pts.push('At daily pivot');
    // Breakout above R1 / breakdown below S1.
    if (piv.r1 != null && ctx.ltp > piv.r1 * 1.001) { score += 0.6; conf += 8; pts.push('Trading above R1 — breakout'); }
    if (piv.s1 != null && ctx.ltp < piv.s1 * 0.999) { score -= 0.6; conf += 8; pts.push('Trading below S1 — breakdown'); }
    // Mean-reversion pull when far from pivot.
    if (Math.abs(d) > 1.8) { score -= Math.sign(d) * 0.4; pts.push('Extended far from pivot'); }
  }
  // Prior-day candle high/low levels (from candles when available).
  const candles = ctx.candles;
  if (Array.isArray(candles) && candles.length >= 2) {
    const prev = candles[candles.length - 2];
    if (ctx.ltp > prev.high) { score += 0.4; pts.push('Above prev-day high'); }
    else if (ctx.ltp < prev.low) { score -= 0.4; pts.push('Below prev-day low'); }
  }

  const dir = score > 0.7 ? 1 : score < -0.7 ? -1 : 0;
  return vote(dir, dir === 0 ? 22 : clamp(conf + Math.abs(score) * 20), pts);
}

// ------------------------------------------------------------
// 7. OptionsFlow — India index options intelligence
// (PCR extremes are CONTRARIAN; OI walls act as magnets/support)
// ------------------------------------------------------------
function optionsFlow(ctx) {
  const o = ctx.options;
  if (!o) return vote(0, 0, ['No option-chain data (stock / crypto) — model abstains']);
  const pts = [];
  let score = 0, conf = 34;

  const pcr = o.pcr;
  if (pcr != null) {
    if (pcr > 1.4) { score += 1.0; conf += 8; pts.push(`PCR ${r1(pcr)} extreme put-heavy — contrarian bullish`); }
    else if (pcr < 0.6) { score -= 1.0; conf += 8; pts.push(`PCR ${r1(pcr)} extreme call-heavy — contrarian bearish`); }
    else pts.push(`PCR ${r1(pcr)} balanced`);
  }
  if (o.maxPain != null && ctx.ltp) {
    const dist = ((o.maxPain - ctx.ltp) / ctx.ltp) * 100;
    if (Math.abs(dist) > 0.4) {
      score += Math.sign(dist) * 0.7; // price tends to gravitate toward max pain
      pts.push(`Max pain ₹${o.maxPain} is ${r1(Math.abs(dist))}% ${dist > 0 ? 'above' : 'below'} spot — gravity ${dist > 0 ? 'up' : 'down'}`);
    } else pts.push('Spot at max pain');
  }
  if (o.ivPercentile != null) {
    if (o.ivPercentile > 80) { conf -= 6; pts.push(`IV percentile ${r1(o.ivPercentile)} — premium-rich, prefer spreads`); }
    else if (o.ivPercentile < 20) { conf += 4; pts.push(`IV percentile ${r1(o.ivPercentile)} — cheap options, longs favoured`); }
  }
  if (o.oiSkew != null) {
    if (o.oiSkew > 0.15) { score += 0.5; pts.push('Call OI building over puts — writers confident upside'); }
    else if (o.oiSkew < -0.15) { score -= 0.5; pts.push('Put OI building over calls — writers defending downside'); }
  }

  const dir = score > 0.7 ? 1 : score < -0.7 ? -1 : 0;
  return vote(dir, dir === 0 ? 25 : clamp(conf + Math.abs(score) * 16), pts);
}

// ------------------------------------------------------------
// 8. MacroRegime — the market gate
// ------------------------------------------------------------
function macroRegime(ctx) {
  const reg = ctx.regime || {};
  const pts = [];
  let score = 0, conf = 30;

  if (ctx.market === 'CRYPTO') {
    const btc = reg.btcChange;
    if (btc != null) {
      if (btc > 1.5) { score += 1.0; pts.push(`BTC +${r1(btc)}% — risk-on regime for alts`); }
      else if (btc < -1.5) { score -= 1.0; pts.push(`BTC ${r1(btc)}% — risk-off, alts bleed`); }
      else pts.push(`BTC ${r1(btc)}% flat — neutral regime`);
    }
  } else {
    const nifty = reg.niftyChange, vix = reg.indiaVix;
    if (nifty != null) {
      if (nifty > 0.5) { score += 0.8; pts.push(`NIFTY +${r1(nifty)}% — broad risk-on`); }
      else if (nifty < -0.5) { score -= 0.8; pts.push(`NIFTY ${r1(nifty)}% — broad risk-off`); }
    }
    if (vix != null) {
      if (vix > 20) { conf -= 10; pts.push(`India VIX ${r1(vix)} elevated — size down`); }
      else if (vix < 11) { conf += 5; pts.push(`India VIX ${r1(vix)} calm`); }
    }
  }
  const dir = score > 0.6 ? 1 : score < -0.6 ? -1 : 0;
  return vote(dir, dir === 0 ? 25 : clamp(conf + Math.abs(score) * 18), pts);
}

// ------------------------------------------------------------
// 9. AICouncil — LLM verification (chain: Gemini → Groq → Cerebras)
//    Vote shape set by routes layer after the LLM responds.
// ------------------------------------------------------------
export function aiCouncilVoteFromVerdict(verdict) {
  if (!verdict) return null;
  const v = String(verdict.verdict || '').toUpperCase();
  const conf = clamp(Number(verdict.confidence) || 0);
  if (v === 'LONG') return vote(1, Math.max(55, conf), [verdict.note, verdict.analysis].filter(Boolean).slice(0, 2));
  if (v === 'SHORT') return vote(-1, Math.max(55, conf), [verdict.note, verdict.analysis].filter(Boolean).slice(0, 2));
  if (v === 'AVOID') return vote(0, Math.max(50, conf), [verdict.note || 'AI Council says avoid'].filter(Boolean));
  return null;
}

// ------------------------------------------------------------
// REGISTRY (the "Superintelligence MCP model bus")
// ------------------------------------------------------------
export const MODELS = [
  { id: 'trend', name: 'TrendMatrix', role: 'Multi-EMA stack + ADX/DMI + Supertrend', weight: 1.4, fn: trendMatrix },
  { id: 'momentum', name: 'MomentumQuant', role: 'RSI regime + MACD histogram + Stochastic', weight: 1.3, fn: momentumQuant },
  { id: 'volatility', name: 'VolatilityScope', role: 'Bollinger squeeze/expansion + ATR percentile', weight: 0.9, fn: volatilityScope },
  { id: 'volume', name: 'VolumeFlow', role: 'Rel-volume + OBV + MFI + VWAP side', weight: 1.2, fn: volumeFlow },
  { id: 'pattern', name: 'PatternNeural', role: 'Candlestick patterns + 52-week position', weight: 1.0, fn: patternNeural },
  { id: 'sr', name: 'SRMatrix', role: 'Pivot levels + breakout / breakdown', weight: 1.1, fn: srMatrix },
  { id: 'options', name: 'OptionsFlow', role: 'PCR + max pain + IV percentile (contrarian)', weight: 1.0, fn: optionsFlow },
  { id: 'regime', name: 'MacroRegime', role: 'NIFTY/VIX gate (India) · BTC gate (crypto)', weight: 0.8, fn: macroRegime },
  { id: 'aicouncil', name: 'AI Council (LLM)', role: 'Gemini → Groq → Cerebras verification chain', weight: 1.5, fn: null },
];

export function runQuantModels(ctx) {
  return MODELS.filter(m => m.fn)
    .map(m => {
      try {
        const v = m.fn(ctx);
        return { id: m.id, name: m.name, weight: m.weight, role: m.role, ...v };
      } catch (e) {
        return { id: m.id, name: m.name, weight: m.weight, role: m.role, dir: 0, conf: 0, reasons: [`model error: ${e?.message || 'unknown'}`] };
      }
    });
}
