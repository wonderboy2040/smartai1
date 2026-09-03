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
import { bsPrice, bsGreeks, impliedVol, yearsToExpiry, nextWeeklyExpiry } from './lib/blackScholes.js';
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

  return { pcr: r2(pcr), maxPain, atmIV: atmIV ? r2(atmIV * 100) : null, ivPercentile: null, oiSkew: r2(oiSkew), callOI, putOI };
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
    // Pick the nearest weekly expiry from NSE's own list.
    const today = new Date().toISOString().slice(0, 10);
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
      id: 'bull-call-spread', name: 'Bull Call Spread',
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
        id: 'long-call', name: 'Long Call (ATM)',
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
      id: 'bear-put-spread', name: 'Bear Put Spread',
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
        id: 'long-put', name: 'Long Put (ATM)',
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
      id: 'iron-condor', name: 'Iron Condor',
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
  }

  return out;
}

// ---------------- convenience: options-context for ensemble ----------------
export async function getOptionsContext(symbol = 'NIFTY') {
  const desk = await getOptionsDesk(symbol);
  return { desk, ctx: desk?.ok ? desk.optionsCtx : null };
}

export { STRIKE_STEPS, LOT_SIZES, RISK_FREE };
