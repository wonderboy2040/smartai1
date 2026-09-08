// ============================================================
// server/ai/optionsDesk.js — INDIA OPTIONS INTELLIGENCE
// ------------------------------------------------------------
// The options half of the AI Trading tab (NSE indices):
//
//   1. CHAIN: tries the REAL NSE option-chain first (cookie
//      bootstrap). Datacenter blocks are common → falls back to a
//      Black-Scholes SYNTHETIC chain built from live spot (Yahoo
//      ^NSEI) + IV anchored to India VIX. Every response labels
//      its source — "nse" (real OI/IV) or "bs-model" (honest model).
//
//   2. ANALYTICS: PCR, max pain, OI walls, IV percentile — fed
//      INTO the ensemble's OptionsFlow model.
//
//   3. STRATEGY BUILDER: converts the ensemble consensus direction
//      into concrete, fully-priced option strategies (spreads /
//      directionals / iron condor) with max P&L, breakevens, net
//      Greeks and lot sizes.
// ============================================================
import { fetchNSEOptionChain, fetchYahooQuotes } from './data.js';
import { bsPrice, bsGreeks, impliedVol, yearsToExpiry, nextWeeklyExpiry, normCdf } from './lib/blackScholes.js';
import { aggregateVotes } from './ensemble.js';

const RISK_FREE = 0.069; // ~RBI repo-ish risk-free for NSE pricing
const STRIKE_STEPS = { NIFTY: 50, BANKNIFTY: 100, FINNIFTY: 50, MIDCPNIFTY: 25, NIFTYNXT50: 100, SENSEX: 100 };
const LOT_SIZES = { NIFTY: 75, BANKNIFTY: 35, FINNIFTY: 65, MIDCPNIFTY: 140, NIFTYNXT50: 25, SENSEX: 20 };
const IV_FLOOR = 0.10, IV_CAP = 0.60;

const r2 = (v) => (Number.isFinite(v) ? Math.round(v * 100) / 100 : null);
const r1 = (v) => (Number.isFinite(v) ? Math.round(v * 10) / 10 : null);

// ---------------- chain analytics (works for BOTH sources) ----------------
export function analyzeChain(chain, spot) {
  if (!chain || !Array.isArray(chain.rows) || chain.rows.length === 0 || !(spot > 0)) return null;
  let callOI = 0, putOI = 0;
  const walls = [];
  for (const r of chain.rows) {
    callOI += r.callOI || 0;
    putOI += r.putOI || 0;
    walls.push({
      strike: r.strike,
      totalOI: (r.callOI || 0) + (r.putOI || 0),
      callOI: r.callOI || 0, putOI: r.putOI || 0,
      callOIChange: r.callOIChange || 0, putOIChange: r.putOIChange || 0,
    });
  }
  const pcr = callOI > 0 ? putOI / callOI : null;

  // Max pain: strike minimizing total writer payout.
  let maxPain = null, minPain = Infinity;
  const strikes = chain.rows.map(r => r.strike);
  for (const k of strikes) {
    let payout = 0;
    for (const r of chain.rows) {
      if (r.strike < k) payout += (k - r.strike) * (r.callOI || 0);
      if (r.strike > k) payout += (r.strike - k) * (r.putOI || 0);
    }
    if (payout < minPain) { minPain = payout; maxPain = k; }
  }

  // IV percentile from the chain's own IVs (ATM ± 3 strikes).
  const near = chain.rows.filter(r => Math.abs(r.strike - spot) / spot < 0.03);
  const ivs = near.flatMap(r => [r.callIV, r.putIV]).filter(v => v != null && v > 0).map(v => v / 100);
  const atmIV = ivs.length ? ivs.reduce((a, b) => a + b, 0) / ivs.length : null;

  // OI skew: which side is adding open interest today.
  let dCall = 0, dPut = 0;
  for (const r of chain.rows) { dCall += r.callOIChange || 0; dPut += r.putOIChange || 0; }
  const oiSkew = (dCall + dPut) > 0 ? (dCall - dPut) / (dCall + dPut) : null;

  // v6.7 GEX / GAMMA FLIP / EXPECTED MOVE (glama Trading-Volatility inspired).
  // All from data we ALREADY fetch (OI + IV + Greeks) — no new source.
  const gex = computeGex(chain, spot, atmIV);
  // v6.11 (glama tv-mcp skew + options flow): OTM put-vs-call IV skew
  // and volume/OI flow — real chains only (synthetic = honest null).
  const skewFlow = computeSkewFlow(chain, spot);

  return { pcr: r2(pcr), maxPain, atmIV: atmIV ? r2(atmIV * 100) : null, ivPercentile: null, oiSkew: r2(oiSkew), callOI, putOI, ...(gex ? { gex } : {}), ...(skewFlow || {}) };
}

/**
 * v6.11 — IV SKEW + VOLUME/OI FLOW (glama tv-mcp "skew" + "options
 * volume/flow"). Real-chain only (synthetic rows carry no volume/OI
 * → honest null, never a made-up number).
 *
 *   skew = avg OTM-put IV − avg OTM-call IV (strikes 2–6% from spot)
 *     positive skew = crash insurance in demand = fear bid
 *     negative/flat = complacency (call chasing)
 *   flow = call volume vs put volume + today's OI-change direction —
 *     who is actually paying premium today.
 */
export function computeSkewFlow(chain, spot) {
  if (!chain || !Array.isArray(chain.rows) || !(spot > 0)) return null;
  const isReal = chain.rows.some(r => (r.callVolume || 0) + (r.putVolume || 0) > 0 || (r.callOI || 0) + (r.putOI || 0) > 0);
  if (!isReal) return null;

  const putIVs = [], callIVs = [];
  let callVol = 0, putVol = 0, dCall = 0, dPut = 0;
  for (const r of chain.rows) {
    callVol += r.callVolume || 0; putVol += r.putVolume || 0;
    dCall += r.callOIChange || 0; dPut += r.putOIChange || 0;
    const dist = Math.abs(r.strike - spot) / spot;
    if (dist >= 0.02 && dist <= 0.06) {
      if (r.strike < spot && r.putIV > 0) putIVs.push(r.putIV);
      if (r.strike > spot && r.callIV > 0) callIVs.push(r.callIV);
    }
  }
  const avg = (a) => a.length ? a.reduce((s, v) => s + v, 0) / a.length : null;
  const putIV = avg(putIVs), callIV = avg(callIVs);
  const skew = (putIV != null && callIV != null) ? Math.round((putIV - callIV) * 10) / 10 : null;
  const volRatio = putVol > 0 ? callVol / putVol : null;
  const oiLean = (dCall + dPut) !== 0 ? (dCall - dPut) / (dCall + dPut) : null;

  const skewRead = skew == null ? 'OTM IVs thin — skew measure nahi hua'
    : skew >= 2.5 ? 'put skew HIGH — hedgers crash-insurance kharid rahe hain (fear bid)'
    : skew >= 0.5 ? 'mild put skew — normal protective demand'
    : skew > -0.5 ? 'flat skew — dono side equally priced (complacency zone)'
    : 'CALL skew — upside chasing (FOMO bid, rallies fade-prone)';
  const flowRead = volRatio == null ? 'volume data nahi'
    : volRatio >= 1.5 ? 'call volume dominates — aggressive upside bets aaj'
    : volRatio <= 0.67 ? 'put volume dominates — protection/downside bets aaj'
    : 'balanced two-way flow';

  return {
    skew: {
      putIV: putIV != null ? r1(putIV) : null,
      callIV: callIV != null ? r1(callIV) : null,
      value: skew,
      read: skewRead,
    },
    flow: {
      callVolume: Math.round(callVol),
      putVolume: Math.round(putVol),
      callPutVolRatio: volRatio != null ? r2(volRatio) : null,
      oiLean: oiLean != null ? r2(oiLean) : null,
      oiLeanRead: oiLean == null ? 'OI change flat'
        : oiLean > 0.15 ? 'calls OI add kar rahe — positioning bullish'
        : oiLean < -0.15 ? 'puts OI add kar rahe — positioning defensive'
        : 'OI changes balanced',
      read: flowRead,
    },
  };
}

/**
 * v6.7 — GAMMA EXPOSURE PROFILE (per-strike, flip, walls, expected move).
 *  GEX_k = gamma_k × OI_k × 100 × spot   (per-share gamma × contracts)
 *  call dealers are typically SHORT gamma / put dealers LONG — the
 *  standard retail approximation nets them: +put GEX − call GEX
 *  (positive net GEX = mean-reversion pin regime; negative = trend /
 *  gamma-flip acceleration regime).
 *  gammaFlip = strike where cumulative net GEX crosses zero.
 *  callWall / putWall = largest absolute strike-level GEX magnets.
 *  expectedMove = ATM straddle price × 0.85 (the classic 1-expiry
 *  expected-move proxy; ~1 SD under lognormal at expiry).
 * Only meaningful with REAL OI — synthetic chains return null
 *  (bs-model rows carry OI 0 → honest skip).
 */
export function computeGex(chain, spot, atmIVFallback) {
  if (!chain || !Array.isArray(chain.rows) || !(spot > 0)) return null;
  const expiry = chain.expiry;
  const T = yearsToExpiry(`${expiry}T15:30:00+05:30`);
  if (!(T > 0)) return null;
  const ivDefault = atmIVFallback ? Math.min(IV_CAP, Math.max(IV_FLOOR, atmIVFallback)) : 0.13;
  const hasRealOI = chain.rows.some(r => (r.callOI || 0) + (r.putOI || 0) > 0);
  if (!hasRealOI) return null; // model chain — no honest GEX

  const per = [];
  let cum = 0;
  const sorted = [...chain.rows].sort((a, b) => a.strike - b.strike);
  for (const r of sorted) {
    const callG = bsGreeks(spot, r.strike, T, RISK_FREE, Math.min(IV_CAP, Math.max(IV_FLOOR, (r.callIV || ivDefault * 100) / 100)), 'CE').gamma || 0;
    const putG = bsGreeks(spot, r.strike, T, RISK_FREE, Math.min(IV_CAP, Math.max(IV_FLOOR, (r.putIV || ivDefault * 100) / 100)), 'PE').gamma || 0;
    // dealer-positioning convention: calls short gamma (−), puts long gamma (+)
    const netGex = (putG * (r.putOI || 0) - callG * (r.callOI || 0)) * 100 * spot;
    cum += netGex;
    per.push({ strike: r.strike, netGex: Math.round(netGex), cumGex: Math.round(cum) });
  }

  // gamma flip: first zero-crossing of cumulative GEX (low → high strikes)
  let gammaFlip = null;
  for (let i = 1; i < per.length; i++) {
    if ((per[i - 1].cumGex < 0 && per[i].cumGex >= 0) || (per[i - 1].cumGex > 0 && per[i].cumGex <= 0)) {
      gammaFlip = per[i].strike; break;
    }
  }
  // walls: biggest absolute strike-level GEX on each side
  let callWall = null, putWall = null, maxAbs = 0, minAbs = 0;
  for (const p of per) {
    if (p.netGex < minAbs) { minAbs = p.netGex; callWall = p.strike; } // negative = call-side wall
    if (p.netGex > maxAbs) { maxAbs = p.netGex; putWall = p.strike; }  // positive = put-side wall
  }
  const totalNet = cum;

  // expected move from the ATM straddle (×0.85 empirical haircut)
  const atmRow = sorted.reduce((best, r) => (Math.abs(r.strike - spot) < Math.abs(best.strike - spot) ? r : best), sorted[0]);
  const straddle = (atmRow.callLTP || 0) + (atmRow.putLTP || 0);
  const hasLtp = straddle > 0;
  const emAbs = hasLtp ? straddle * 0.85 : (spot * (ivDefault * Math.sqrt(T)) * 0.85);
  const expectedMove = {
    abs: r2(emAbs),
    pct: r2((emAbs / spot) * 100),
    low: Math.round(spot - emAbs), high: Math.round(spot + emAbs),
    method: hasLtp ? 'atm-straddle×0.85' : 'bs-iv-approx',
  };

  const regimeNote = totalNet > 0
    ? 'Positive net GEX — dealers dampen moves (mean-reversion / pin toward walls)'
    : 'Negative net GEX — dealers hedge WITH the move (trend acceleration zone)';

  return {
    perStrike: per,
    gammaFlip,
    callWall: gammaFlip != null && callWall != null && callWall < gammaFlip ? callWall : callWall,
    putWall,
    totalNetGex: Math.round(totalNet),
    expectedMove,
    regimeNote,
  };
}

// ---------------- synthetic BS chain (the honest fallback) ----------------
export function buildSyntheticChain(symbol, spot, iv, expiryDate, strikeCount = 21) {
  const step = STRIKE_STEPS[symbol] || Math.max(1, Math.round(spot * 0.005));
  const atm = Math.round(spot / step) * step;
  const T = yearsToExpiry(`${expiryDate}T15:30:00+05:30`);
  if (!(T > 0)) return null;
  const rows = [];
  for (let k = -strikeCount; k <= strikeCount; k++) {
    const strike = atm + k * step;
    if (strike <= 0) continue;
    // Smile: wings carry extra vol — a mild, standard curve.
    const m = Math.abs(Math.log(strike / spot));
    const smileIV = Math.min(IV_CAP, Math.max(IV_FLOOR, iv * (1 + 1.6 * m * m * 12)));
    const call = bsPrice(spot, strike, T, RISK_FREE, smileIV, 'CE');
    const put = bsPrice(spot, strike, T, RISK_FREE, smileIV, 'PE');
    rows.push({
      strike, expiry: expiryDate,
      callOI: 0, callOIChange: 0, callIV: r2(smileIV * 100), callLTP: r2(call), callVolume: 0,
      putOI: 0, putOIChange: 0, putIV: r2(smileIV * 100), putLTP: r2(put), putVolume: 0,
    });
  }
  return { symbol, spot: r2(spot), expiry: expiryDate, rows, source: 'bs-model', synthetic: true, atmStrike: atm, fetchedAt: Date.now() };
}

// ---------------- assemble the full options desk payload ----------------
export async function getOptionsDesk(symbol = 'NIFTY') {
  const sym = String(symbol || 'NIFTY').toUpperCase();
  const [nse, quotes] = await Promise.all([
    fetchNSEOptionChain(sym).catch(() => null),
    fetchYahooQuotes([sym, 'INDIAVIX']).catch(() => ({})),
  ]);
  const spot = nse?.spot ?? quotes[sym]?.price ?? null;
  const vix = quotes['INDIAVIX']?.price ?? null;

  let chain = null, analytics = null;
  if (nse && spot) {
    // Pick the nearest weekly expiry from NSE's own list. Compare against
    // the IST calendar date (before 05:30 IST the UTC date is yesterday —
    // an already-passed expiry would otherwise still be selectable).
    const today = (() => {
      try { return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date()); }
      catch { return new Date().toISOString().slice(0, 10); }
    })();
    const exp = (nse.expiryDates || []).map(d => String(d))
      .filter(d => d >= today).sort()[0]
      || nextWeeklyExpiry(new Date(), sym === 'NIFTY' ? 2 : 4);
    const rows = nse.rows.filter(r => r.expiry === exp);
    if (rows.length > 5) {
      chain = { symbol: sym, spot: r2(spot), expiry: exp, rows, source: 'nse', fetchedAt: nse.fetchedAt };
      analytics = analyzeChain(chain, spot);
      // IV percentile approximated from ATM IV vs VIX level.
      if (analytics?.atmIV != null && vix) {
        analytics.ivPercentile = r1(Math.max(0, Math.min(100, 50 + (analytics.atmIV - vix) * 6)));
      }
    }
  }
  let syntheticNote = null;
  if (!chain && spot) {
    // BS-synthetic fallback: IV anchored to India VIX (or 13% floor).
    const iv = vix ? Math.min(IV_CAP, Math.max(IV_FLOOR, vix / 100)) : 0.13;
    const expiry = nextWeeklyExpiry(new Date(), sym === 'NIFTY' ? 2 : 4);
    chain = buildSyntheticChain(sym, spot, iv, expiry);
    if (chain) {
      syntheticNote = `NSE chain unreachable from this server — showing a Black-Scholes model chain (IV anchored to India VIX ${vix ? r1(vix) : 'n/a'}). Premiums are model estimates, NOT live quotes; OI/PCR unavailable in model mode.`;
      analytics = null; // honest: no real OI → no PCR/max-pain
    }
  }

  if (!chain) {
    return { ok: false, symbol: sym, reason: 'No spot price or chain data available right now', spot, vix };
  }

  // OptionsFlow model inputs for the ensemble (India index signals).
  const optionsCtx = analytics ? {
    pcr: analytics.pcr, maxPain: analytics.maxPain,
    ivPercentile: analytics.ivPercentile, oiSkew: analytics.oiSkew,
  } : null;

  return {
    ok: true,
    symbol: sym,
    spot: chain.spot,
    spotChangePct: r2(quotes[sym]?.changePct ?? null),
    vix: r1(vix),
    expiry: chain.expiry,
    source: chain.source,
    syntheticNote,
    lotSize: LOT_SIZES[sym] || 1,
    analytics,
    optionsCtx,
    // ATM ± 6 strikes for the UI table.
    rows: chain.rows
      .filter(r => Math.abs(r.strike - (chain.atmStrike ?? Math.round(spot / (STRIKE_STEPS[sym] || 50)) * (STRIKE_STEPS[sym] || 50))) <= (STRIKE_STEPS[sym] || 50) * 6)
      .map(r => ({ ...r, callGreeks: greeksFor(spot, r.strike, chain.expiry, r.callIV, 'CE'), putGreeks: greeksFor(spot, r.strike, chain.expiry, r.putIV, 'PE') })),
    fetchedAt: Date.now(),
  };
}

function greeksFor(spot, strike, expiry, ivPct, type) {
  const T = yearsToExpiry(`${expiry}T15:30:00+05:30`);
  const sigma = ivPct ? Math.max(IV_FLOOR, Math.min(IV_CAP, ivPct / 100)) : 0.13;
  const g = bsGreeks(spot, strike, T, RISK_FREE, sigma, type);
  return {
    delta: r2(g.delta), gamma: r2(g.gamma),
    theta: r2(g.theta), vega: r2(g.vega),
  };
}

// ---------------- strategy builder ----------------
/**
 * v6.7 additions (glama trading_skills-inspired):
 *   • POP — probability of profit at expiry via the lognormal
 *     terminal distribution (Black-Scholes N(d2) of the breakevens).
 *   • payoff — sampled expiry payoff curve (per share) for the UI's
 *     SVG chart: [{ s: spot, pnl }] across ±6% of spot.
 *   • Short Straddle + Short Strangle (premium harvesting when the
 *     ensemble is NEUTRAL / low conviction), and a Long Straddle
 *     (event-style breakout play) when conviction is split but the
 *     IV percentile is LOW (cheap vol + coiled setup).
 */
function popFor({ spot, expiry, atmIV, breakevens, bias, kind }) {
  const T = yearsToExpiry(`${expiry}T15:30:00+05:30`);
  if (!(T > 0) || !(spot > 0) || !atmIV || !Array.isArray(breakevens) || breakevens.length === 0) return null;
  const sigma = Math.min(IV_CAP, Math.max(IV_FLOOR, atmIV / 100));
  // P(S_T > K) = N(d2(K))
  const pAbove = (K) => {
    const d2 = (Math.log(spot / K) + (RISK_FREE - 0.5 * sigma * sigma) * T) / (sigma * Math.sqrt(T));
    return normCdf(d2);
  };
  let p;
  if (kind === 'credit-range' && breakevens.length >= 2) {
    // profit BETWEEN the breakevens: P(low < S_T < high)
    const [lo, hi] = [...breakevens].sort((a, b) => a - b);
    p = pAbove(lo) - pAbove(hi);
  } else if (kind === 'debit') {
    const b = breakevens[0];
    p = bias === 'BULLISH' ? pAbove(b) : 1 - pAbove(b);
  } else { // credit-tail (short straddle-ish): profit below BE1 / above BE2
    const [lo, hi] = [...breakevens].sort((a, b) => a - b);
    p = pAbove(lo) + (1 - pAbove(hi));
  }
  return r1(Math.max(0, Math.min(100, p * 100)));
}

/** Expiry payoff per share at spot s for a leg list. */
function payoffPoint(legs, s) {
  let pnl = 0;
  for (const l of legs) {
    const intrinsic = l.type === 'CE' ? Math.max(0, s - l.strike) : Math.max(0, l.strike - s);
    const signed = l.action === 'BUY' ? intrinsic - l.premium : l.premium - intrinsic;
    pnl += signed;
  }
  return Math.round(pnl * 100) / 100;
}

function attachPnlProfile(strat, { spot, expiry, atmIV }) {
  if (!strat) return strat;
  const legs = strat.legs || [];
  if (!(spot > 0) || legs.length === 0) return strat;
  const lo = spot * 0.94, hi = spot * 1.06;
  const points = [];
  for (let k = 0; k <= 24; k++) {
    const s = Math.round((lo + ((hi - lo) * k) / 24) / 1) ;
    points.push({ s, pnl: payoffPoint(legs, s) });
  }
  strat.payoff = points;
  strat.pop = popFor({ spot, expiry, atmIV, breakevens: strat.breakevens, bias: strat.bias, kind: strat._popKind || 'debit' });
  delete strat._popKind;
  return strat;
}

/**
 * Convert an ensemble direction into CONCRETE priced strategies.
 * Each strategy: legs + maxProfit/maxLoss + breakevens + net Greeks.
 * All values per SHARE (multiply by lotSize for the contract).
 */
export function buildStrategies(desk, consensus) {
  if (!desk?.ok || !(desk.spot > 0)) return [];
  const { symbol, spot, expiry, lotSize, rows } = desk;
  const step = STRIKE_STEPS[symbol] || 50;
  const atm = Math.round(spot / step) * step;
  const find = (strike) => rows.find(r => r.strike === strike) || null;
  const leg = (action, type, strike) => {
    const row = find(strike);
    const iv = (type === 'CE' ? row?.callIV : row?.putIV) || null;
    const premium = (type === 'CE' ? row?.callLTP : row?.putLTP)
      ?? r2(bsPrice(spot, strike, yearsToExpiry(`${expiry}T15:30:00+05:30`), RISK_FREE, 0.13, type));
    const g = greeksFor(spot, strike, expiry, iv, type);
    return {
      action, type, strike,
      premium: r2(premium),
      iv: iv ? r1(iv) : null,
      delta: g.delta, theta: g.theta,
    };
  };
  const T = yearsToExpiry(`${expiry}T15:30:00+05:30`);
  const out = [];
  // v6.7: POP needs an IV anchor — real chain ATM IV, else the VIX the
  // synthetic chain was priced from (honest model-estimated POP)
  const atmIV = desk?.analytics?.atmIV ?? (desk?.vix != null ? r1(desk.vix) : null);
  const ivPct = desk?.analytics?.ivPercentile ?? null;

  const side = consensus?.side || 'FLAT';
  const conf = consensus?.confidence || 0;
  const grade = consensus?.grade || 'NEUTRAL';

  // --- STRONG LONG: Bull Call Spread (defined-risk directional) ---
  if (side === 'LONG' && (grade === 'STRONG' || grade === 'ACTION')) {
    const l1 = leg('BUY', 'CE', atm);
    const l2 = leg('SELL', 'CE', atm + 2 * step);
    const debit = l1.premium - l2.premium;
    const width = l2.strike - l1.strike;
    out.push({
      id: 'bull-call-spread', name: 'Bull Call Spread', _popKind: 'debit',
      bias: 'BULLISH', conviction: grade,
      rationale: `Ensemble consensus LONG ${conf}% — buy the ATM call, sell 2-strikes OTM to fund it. Defined risk, IV-tolerant.`,
      legs: [l1, l2],
      netDebit: r2(debit),
      maxProfit: r2(Math.max(0, width - debit)),
      maxLoss: r2(debit),
      breakevens: [r2(l1.strike + debit)],
      netDelta: r2(l1.delta - l2.delta), netTheta: r2(l1.theta - l2.theta),
      perLot: { maxProfit: r2(Math.max(0, width - debit) * lotSize), maxLoss: r2(debit * lotSize) },
      exitPlan: `Book at target2 of the index plan or 50% of max profit; hard-stop at 60% of debit. Expiry ${expiry}.`,
    });
    // Momentum kicker for STRONG: naked-ish directional long call.
    if (grade === 'STRONG') {
      const l = leg('BUY', 'CE', atm);
      out.push({
        id: 'long-call', name: 'Long Call (ATM)', _popKind: 'debit',
        bias: 'BULLISH', conviction: 'STRONG',
        rationale: `STRONG consensus ${conf}% with ${Math.round((consensus?.agreement || 0) * 100)}% agreement — full directional exposure via ATM call (only when IV percentile < 60).`,
        legs: [l],
        netDebit: r2(l.premium),
        maxProfit: null, // unlimited
        maxLoss: r2(l.premium),
        breakevens: [r2(atm + l.premium)],
        netDelta: l.delta, netTheta: l.theta,
        perLot: { maxProfit: null, maxLoss: r2(l.premium * lotSize) },
        exitPlan: `Trail at 1.5× debit; stop at 50% premium decay; expiry-day theta burn is severe — square by ${expiry} 14:30.`,
      });
    }
  }

  // --- STRONG SHORT: Bear Put Spread ---
  if (side === 'SHORT' && (grade === 'STRONG' || grade === 'ACTION')) {
    const l1 = leg('BUY', 'PE', atm);
    const l2 = leg('SELL', 'PE', atm - 2 * step);
    const debit = l1.premium - l2.premium;
    const width = l1.strike - l2.strike;
    out.push({
      id: 'bear-put-spread', name: 'Bear Put Spread', _popKind: 'debit',
      bias: 'BEARISH', conviction: grade,
      rationale: `Ensemble consensus SHORT ${conf}% — buy the ATM put, sell 2-strikes ITM to fund it. Defined risk.`,
      legs: [l1, l2],
      netDebit: r2(debit),
      maxProfit: r2(Math.max(0, width - debit)),
      maxLoss: r2(debit),
      breakevens: [r2(l1.strike - debit)],
      netDelta: r2(l1.delta - l2.delta), netTheta: r2(l1.theta - l2.theta),
      perLot: { maxProfit: r2(Math.max(0, width - debit) * lotSize), maxLoss: r2(debit * lotSize) },
      exitPlan: `Book at target2 or 50% max profit; stop at 60% of debit. Expiry ${expiry}.`,
    });
    if (grade === 'STRONG') {
      const l = leg('BUY', 'PE', atm);
      out.push({
        id: 'long-put', name: 'Long Put (ATM)', _popKind: 'debit',
        bias: 'BEARISH', conviction: 'STRONG',
        rationale: `STRONG consensus ${conf}% — full directional downside via ATM put (check IV percentile first).`,
        legs: [l],
        netDebit: r2(l.premium),
        maxProfit: null, // down to zero
        maxLoss: r2(l.premium),
        breakevens: [r2(atm - l.premium)],
        netDelta: l.delta, netTheta: l.theta,
        perLot: { maxProfit: null, maxLoss: r2(l.premium * lotSize) },
        exitPlan: `Trail at 1.5× debit; stop at 50% decay; square by ${expiry} 14:30.`,
      });
    }
  }

  // --- NEUTRAL / low conviction: Iron Condor ---
  if (out.length === 0 || grade === 'NEUTRAL' || grade === 'WATCH') {
    const wings = 4 * step;
    const legs = [
      leg('SELL', 'CE', atm + wings),
      leg('BUY', 'CE', atm + wings + 2 * step),
      leg('SELL', 'PE', atm - wings),
      leg('BUY', 'PE', atm - wings - 2 * step),
    ];
    const credit = legs[0].premium - legs[1].premium + legs[2].premium - legs[3].premium;
    const width = 2 * step;
    out.push({
      id: 'iron-condor', name: 'Iron Condor', _popKind: 'credit-range',
      bias: 'NEUTRAL', conviction: grade,
      rationale: `No STRONG consensus (${conf}%) — harvest theta instead: sell 4-strike OTM wings, buy protection. Works when IV percentile is high.`,
      legs,
      netCredit: r2(credit),
      maxProfit: r2(credit),
      maxLoss: r2(Math.max(0, width - credit)),
      breakevens: [r2(atm + wings + credit), r2(atm - wings - credit)],
      netDelta: r2(legs.reduce((a, l) => a + (l.action === 'SELL' ? -l.delta : l.delta), 0)),
      netTheta: r2(legs.reduce((a, l) => a + (l.action === 'SELL' ? -l.theta : l.theta), 0)),
      perLot: { maxProfit: r2(credit * lotSize), maxLoss: r2(Math.max(0, width - credit) * lotSize) },
      exitPlan: `Book at 50% credit or adjust when spot breaches a short strike. Avoid holding into expiry-day gamma.`,
    });

    // v6.7 — SHORT STRADDLE: premium harvesting when real OI/IV data says
    // the desk is truly neutral AND vol is RICH (IV percentile ≥ 55 — sell
    // expensive vol, not cheap vol). Defined-risk guard: wings appended.
    if ((ivPct == null || ivPct >= 55) && out.every(s => s.id !== 'short-straddle')) {
      const legsS = [
        leg('SELL', 'CE', atm),
        leg('SELL', 'PE', atm),
        leg('BUY', 'CE', atm + 4 * step),
        leg('BUY', 'PE', atm - 4 * step),
      ];
      const creditS = legsS[0].premium + legsS[1].premium - legsS[2].premium - legsS[3].premium;
      if (creditS > 0) {
        out.push({
          id: 'short-straddle', name: 'Iron Fly (Short Straddle + Wings)', _popKind: 'credit-range',
          bias: 'NEUTRAL', conviction: grade,
          rationale: `Neutral ensemble (${conf}%) + rich IV (percentile ${ivPct ?? 'n/a'}) — sell the ATM straddle, buy 4-strike wings to cap the tail. Theta-positive, gamma-risky: size small.`,
          legs: legsS,
          netCredit: r2(creditS),
          maxProfit: r2(creditS),
          maxLoss: r2(Math.max(0, 4 * step - creditS)),
          breakevens: [r2(atm - creditS), r2(atm + creditS)],
          netDelta: r2(legsS.reduce((a, l) => a + (l.action === 'SELL' ? -l.delta : l.delta), 0)),
          netTheta: r2(legsS.reduce((a, l) => a + (l.action === 'SELL' ? -l.theta : l.theta), 0)),
          perLot: { maxProfit: r2(creditS * lotSize), maxLoss: r2(Math.max(0, 4 * step - creditS) * lotSize) },
          exitPlan: `Book 50% credit fast; hard-adjust when |spot − ${atm}| > ${2 * step}. Never hold naked — wings are the seatbelt.`,
        });
      }
    }

    // v6.7 — SHORT STRANGLE (OTM credit, cheaper gamma than the fly):
    // sell 2-strike OTM call + 2-strike OTM put, 5-strike wings.
    if (out.every(s => s.id !== 'short-strangle')) {
      const legsG = [
        leg('SELL', 'CE', atm + 2 * step),
        leg('SELL', 'PE', atm - 2 * step),
        leg('BUY', 'CE', atm + 5 * step),
        leg('BUY', 'PE', atm - 5 * step),
      ];
      const creditG = legsG[0].premium + legsG[1].premium - legsG[2].premium - legsG[3].premium;
      if (creditG > 0) {
        out.push({
          id: 'short-strangle', name: 'Short Strangle (Winged)', _popKind: 'credit-range',
          bias: 'NEUTRAL', conviction: grade,
          rationale: `Neutral ensemble (${conf}%) — sell 2-strike OTM call+put strangle, cap tails with 5-strike wings. Wider profit zone than the Iron Fly, lower credit.`,
          legs: legsG,
          netCredit: r2(creditG),
          maxProfit: r2(creditG),
          maxLoss: r2(Math.max(0, 3 * step - creditG)),
          breakevens: [r2(atm - 2 * step - creditG), r2(atm + 2 * step + creditG)],
          netDelta: r2(legsG.reduce((a, l) => a + (l.action === 'SELL' ? -l.delta : l.delta), 0)),
          netTheta: r2(legsG.reduce((a, l) => a + (l.action === 'SELL' ? -l.theta : l.theta), 0)),
          perLot: { maxProfit: r2(creditG * lotSize), maxLoss: r2(Math.max(0, 3 * step - creditG) * lotSize) },
          exitPlan: `Book 50% credit; roll the tested side when spot breaches a short strike. Wings cap the disaster case.`,
        });
      }
    }
  }

  // v6.7 — LONG STRADDLE (event/breakout play): conviction is SPLIT
  // (WATCH/NEUTRAL) and vol is CHEAP (IV percentile ≤ 40 or unknown
  // with low VIX) — pay for both sides and let the breakout pay for it.
  if ((grade === 'WATCH' || grade === 'NEUTRAL' || side === 'FLAT') && (ivPct == null || ivPct <= 40)) {
    const lc = leg('BUY', 'CE', atm);
    const lp = leg('BUY', 'PE', atm);
    const debit = lc.premium + lp.premium;
    if (debit > 0) {
      out.push({
        id: 'long-straddle', name: 'Long Straddle (ATM)', _popKind: 'debit',
        bias: 'BREAKOUT', conviction: 'WATCH',
        rationale: `Split committee (${conf}%) + cheap vol (IV percentile ${ivPct ?? 'n/a'}) — buy the ATM straddle: any move beyond ±${r1((debit / spot) * 100)}% at expiry pays. Theta bleeds daily — this is a coiled-spring bet, not a hold.`,
        legs: [lc, lp],
        netDebit: r2(debit),
        maxProfit: null,
        maxLoss: r2(debit),
        breakevens: [r2(atm + debit), r2(atm - debit)],
        netDelta: r2(lc.delta + lp.delta), netTheta: r2(lc.theta + lp.theta),
        perLot: { maxProfit: null, maxLoss: r2(debit * lotSize) },
        exitPlan: `Sell into the breakout at +100% premium; stop at 40% decay by day 3. Expiry-day gamma is the friend ONLY if the move comes.`,
      });
    }
  }

  // v6.7 — attach POP + payoff profile to every strategy
  return out.map(s => attachPnlProfile(s, { spot, expiry, atmIV }));
}

// ---------------- convenience: options-context for ensemble ----------------
export async function getOptionsContext(symbol = 'NIFTY') {
  const desk = await getOptionsDesk(symbol);
  return { desk, ctx: desk?.ok ? desk.optionsCtx : null };
}

/**
 * v6.11 — INCOME SETUP RANKER (glama tv-mcp "rank_income_setups"):
 * run the strategy builder on all three NSE indices, keep ONLY the
 * credit-harvest setups (Iron Condor / Iron Fly / Winged Strangle),
 * rank by risk-adjusted expected credit:
 *
 *   score = POP × (credit / spot × 100)
 *
 * i.e. expected credit-capture per rupee of underlying exposure.
 * Honesty: synthetic desks (bs-model) still rank but carry their
 * source tag; a desk that fails to load is skipped, never faked.
 */
export async function rankIncomeSetups() {
  const symbols = ['NIFTY', 'BANKNIFTY', 'FINNIFTY'];
  const INCOME_IDS = new Set(['iron-condor', 'short-straddle', 'short-strangle']);
  const desks = await Promise.all(symbols.map(s => getOptionsDesk(s).catch(() => null)));
  const loaded = desks.filter(d => d?.ok);
  const rows = [];
  for (const desk of loaded) {
    // income ranking wants the NEUTRAL harvest view — call the builder
    // with a flat consensus so directional spreads don't pollute it
    const strategies = buildStrategies(desk, { side: 'FLAT', confidence: 0, grade: 'NEUTRAL', agreement: 0 });
    for (const s of strategies) {
      // NOTE: attachPnlProfile deletes _popKind — income = credit-range ids
      if (!INCOME_IDS.has(s.id)) continue;
      const credit = Number(s.netCredit ?? s.maxProfit);
      const pop = Number(s.pop);
      if (!(credit > 0)) continue;
      const creditPct = r2((credit / desk.spot) * 100);
      const score = (pop != null && Number.isFinite(pop))
        ? Math.round(pop * creditPct * 10) / 10
        : null;
      rows.push({
        symbol: desk.symbol,
        name: s.name,
        id: s.id,
        credit: r2(credit),
        creditPct,
        pop: pop ?? null,
        maxLoss: s.maxLoss,
        riskReward: s.maxLoss > 0 ? r2(credit / s.maxLoss) : null,
        score,
        breakevens: s.breakevens,
        source: desk.source,
        expiry: desk.expiry,
        exitPlan: s.exitPlan,
      });
    }
  }
  rows.sort((a, b) => (b.score ?? -1) - (a.score ?? -1));
  return {
    ok: true,
    asOf: Date.now(),
    count: rows.length,
    desksLoaded: loaded.length,
    top: rows.slice(0, 6),
    methodology: 'score = POP × credit%-of-spot (expected credit capture). Credit-only setups; directional spreads ranked alag se Options Desk me.',
    note: loaded.length === 0
      ? 'koi options desk load nahi hui — thodi der baad retry karo'
      : rows.some(r => r.source === 'bs-model')
        ? '⚠️ model-chain (bs-model) desks — premiums estimates hain, live quotes nahi (NSE is host se unreachable).'
        : 'sab desks live NSE chain par.',
  };
}

export { STRIKE_STEPS, LOT_SIZES, RISK_FREE };
