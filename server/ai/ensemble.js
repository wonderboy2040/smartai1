// ============================================================
// server/ai/ensemble.js — weighted consensus + STRONG gating
// ------------------------------------------------------------
// PURE aggregation: turns N model votes into ONE consensus signal.
// The STRONG grade here is THE execution gate — the order layer
// (coindcxOrders.js) re-checks it server-side before any live order.
//
//   confidence = |weighted score| blended with agreement ratio
//   agreement   = share of voting weight on the winning side
//   grade       = STRONG (≥ minConfidence AND agreement ≥ minAgreement)
//                 ACTION / WATCH / NEUTRAL below that
// ============================================================

export const DEFAULT_GATES = {
  minConfidence: 75,   // ensemble confidence ≥ this → STRONG-eligible
  minAgreement: 0.70,  // ≥ 70% of voting weight on the winning side
};

const clamp = (v, lo = 0, hi = 100) => Math.max(lo, Math.min(hi, v));
const r2 = (v) => Math.round(v * 100) / 100;
const r1 = (v) => Math.round(v * 10) / 10;

/**
 * Aggregate model votes into a consensus.
 *
 * v6.3 RECALIBRATION — the v6.0 formula (|Σ dir·w·conf| / ALL weight)
 * was mathematically starved: 3 abstaining models diluted every board
 * signal ~35% and the model conf scale topped out ~70, so confidence
 * could NEVER reach the 75% STRONG gate — the terminal showed only
 * WATCH/NEUTRAL cards and users saw "no trade signals".
 *
 * New decomposition (each factor is honest and inspectable):
 *   score         = raw / votingWeight  → the weighted-average conviction
 *                                          of the models that DID vote
 *   participation = votingWeight / allWeight → quorum (abstain = weaker
 *                                          committee mandate, not zero)
 *   agreement     = winWeight / votingWeight → side unison of voters
 *
 *   confidence = 100 × score × (0.60 + 0.40·agreement) × (0.70 + 0.30·participation)
 *
 * Calibrated so: a 5/8-model all-aligned bear stack reads ACTION (~66),
 * a full-committee confluence reads STRONG (75+), diluted or split
 * committees stay WATCH/NEUTRAL. Gates are UNCHANGED — only the scale
 * now actually reaches them.
 *
 * @param {{id,name,weight,dir,conf,reasons}[]} votes
 * @param {object} gates { minConfidence, minAgreement }
 */
export function aggregateVotes(votes, gates = DEFAULT_GATES) {
  const valid = (votes || []).filter(v => v && typeof v.dir === 'number' && v.dir !== 0 && (v.conf || 0) > 0 && (v.weight || 0) > 0);
  const votingWeight = valid.reduce((a, v) => a + v.weight, 0);
  const allWeight = (votes || []).filter(v => (v.weight || 0) > 0).reduce((a, v) => a + v.weight, 0);

  if (votingWeight <= 0) {
    return {
      side: 'FLAT', dir: 0, confidence: 0, agreement: 0, participation: 0,
      grade: 'NEUTRAL', participating: 0, totalModels: (votes || []).length,
      summary: 'No model found a tradeable edge',
    };
  }

  const bull = valid.filter(v => v.dir > 0).reduce((a, v) => a + v.weight, 0);
  const bear = valid.filter(v => v.dir < 0).reduce((a, v) => a + v.weight, 0);
  const side = bull >= bear ? 'LONG' : 'SHORT';
  const dir = side === 'LONG' ? 1 : -1;
  const winWeight = Math.max(bull, bear);
  const loseWeight = Math.min(bull, bear);

  // Agreement: winning weight / voting weight (abstaining models don't count against).
  const agreement = winWeight / votingWeight;

  // Score: weighted-average conviction of the VOTING models (opposing
  // votes subtract from the winning side's average).
  const raw = valid.reduce((a, v) => a + v.dir * v.weight * ((v.conf || 0) / 100), 0);
  const score = Math.abs(raw) / votingWeight; // 0..1

  // Quorum: how much of the committee's weight actually showed up.
  const participation = allWeight > 0 ? votingWeight / allWeight : 1;

  const confidence = Math.round(clamp(
    score * 100 * (0.60 + 0.40 * agreement) * (0.70 + 0.30 * participation)
  ));

  let grade;
  if (confidence >= gates.minConfidence && agreement >= gates.minAgreement) grade = 'STRONG';
  else if (confidence >= 55) grade = 'ACTION';
  else if (confidence >= 35) grade = 'WATCH';
  else grade = 'NEUTRAL';

  return {
    side, dir, confidence, agreement: Math.round(agreement * 100) / 100,
    participation: Math.round(participation * 100) / 100,
    grade,
    participating: valid.length,
    totalModels: (votes || []).length,
    bullWeight: r2(bull), bearWeight: r2(bear),
    summary: `${side} ${confidence}% · ${valid.length}/${(votes || []).length} models voting · ${Math.round(agreement * 100)}% agreement · ${Math.round(participation * 100)}% quorum`,
  };
}

/**
 * Build the full trade plan (entry / SL / targets / R:R) from the
 * consensus + the symbol's live context. ATR-based, engine-style:
 *   SL   = entry ∓ 1.4 × ATR      (crypto: 1.6 × ATR — 24/7 noise)
 *   T1   = entry ± 1.0 × R
 *   T2   = entry ± 2.0 × R
 */
export function buildTradePlan(consensus, ctx, market, opts = {}) {
  const ltp = ctx?.ltp;
  if (!consensus || consensus.dir === 0 || !(ltp > 0)) {
    return null;
  }
  const atr = ctx?.ind?.atr ?? (ctx?.indicators?.atr) ?? null;
  const atrFallback = ltp * (market === 'CRYPTO' ? 0.012 : 0.008);
  const a = atr != null && atr > 0 ? atr : atrFallback;
  const slMult = market === 'CRYPTO' ? 1.6 : 1.4;
  const long = consensus.dir > 0;
  let stopLoss = long ? ltp - slMult * a : ltp + slMult * a;
  // v6.4 — build-time risk cap (optional): when the caller knows the
  // user's maxRiskPct the plan is born INSIDE the cap instead of being
  // rejected downstream (fitPlanToRiskCap is the execute-time twin).
  let riskClamped = false, originalRiskPct = null;
  const cap = Number(opts.maxRiskPct);
  if (Number.isFinite(cap) && cap > 0) {
    const cappedDist = ltp * (cap / 100);
    if (Math.abs(ltp - stopLoss) > cappedDist) {
      originalRiskPct = r2((Math.abs(ltp - stopLoss) / ltp) * 100);
      stopLoss = long ? ltp - cappedDist : ltp + cappedDist;
      riskClamped = true;
    }
  }
  const risk = Math.abs(ltp - stopLoss);
  const target1 = long ? ltp + risk : ltp - risk;
  const target2 = long ? ltp + 2 * risk : ltp - 2 * risk;
  const rr = risk > 0 ? Math.abs(target2 - ltp) / risk : 0;
  return {
    entry: r2(ltp),
    stopLoss: r2(stopLoss),
    target1: r2(target1),
    target2: r2(target2),
    risk: r2(risk),
    riskPct: r2((risk / ltp) * 100),
    rewardRisk: r2(rr),
    atrUsed: r2(a),
    planStyle: atr != null ? 'atr-based' : 'atr-fallback',
    ...(riskClamped ? { riskClamped: true, originalRiskPct } : {}),
  };
}

/**
 * Assemble the final signal object (what the API serves).
 */
export function buildSignal({ symbol, market, ctx, votes, consensus, plan, aiNote }) {
  const changePct = ctx?.changePct ?? null;
  return {
    symbol,
    market,
    side: consensus.side,
    grade: consensus.grade,
    confidence: consensus.confidence,
    agreement: consensus.agreement,
    participation: consensus.participation ?? null,
    participating: consensus.participating,
    totalModels: consensus.totalModels,
    bullWeight: consensus.bullWeight ?? null,
    bearWeight: consensus.bearWeight ?? null,
    ltp: r2(ctx?.ltp ?? null),
    changePct: r1(changePct),
    plan,
    votes: (votes || []).map(v => ({
      id: v.id, name: v.name, role: v.role, weight: v.weight,
      dir: v.dir, conf: v.conf, reasons: v.reasons || [],
    })),
    summary: consensus.summary,
    aiNote: aiNote || null,
    executable: market === 'CRYPTO' && consensus.grade === 'STRONG' && !!plan,
    generatedAt: Date.now(),
  };
}

/**
 * THE EXECUTION GATE — used by the order layer (and tests).
 * A LIVE order may ONLY pass when ALL conditions hold:
 *   1. fresh ensemble run (age ≤ maxAgeMs)
 *   2. market matches the execution venue (crypto=CoinDCX,
 *      India=Dhan — v6.5 made the venue a parameter)
 *   3. side matches the requested side
 *   4. grade STRONG: confidence ≥ gates.minConfidence
 *      AND agreement ≥ gates.minAgreement
 *   5. plan exists with a sane risk (≤ maxRiskPct)
 *   6. AI Council (when online) did NOT veto (its vote is already
 *      inside the ensemble — a veto drops agreement/confidence).
 * PAPER mode (practice money) uses requireStrong:false with a
 * longer freshness window — the gauntlet is for REAL money.
 */
export function evaluateExecutionGate(signal, { side, gates = DEFAULT_GATES, maxAgeMs = 90_000, maxRiskPct = 5, requireStrong = true, venue = 'CRYPTO' } = {}) {
  if (!signal) return { ok: false, reason: 'no signal' };
  if (Date.now() - (signal.generatedAt || 0) > maxAgeMs) return { ok: false, reason: `signal stale (age > ${Math.round(maxAgeMs / 1000)}s) — re-run ensemble` };
  const wantVenue = String(venue).toUpperCase();
  if (String(signal.market || 'CRYPTO').toUpperCase() !== wantVenue) {
    return { ok: false, reason: `signal is for the ${signal.market} market — this gate guards ${wantVenue} execution` };
  }
  const wantSide = String(side || signal.side).toUpperCase();
  if (signal.side !== wantSide) return { ok: false, reason: `signal side is ${signal.side}, requested ${wantSide}` };
  if (signal.side === 'FLAT' || !signal.plan) return { ok: false, reason: 'no tradeable side/plan in the current consensus' };
  if (requireStrong) {
    if (signal.grade !== 'STRONG') return { ok: false, reason: `grade ${signal.grade} — live orders need STRONG (${gates.minConfidence}% conf + ${Math.round(gates.minAgreement * 100)}% agreement)` };
    if ((signal.confidence ?? 0) < gates.minConfidence) return { ok: false, reason: `confidence ${signal.confidence}% < ${gates.minConfidence}% gate` };
    if ((signal.agreement ?? 0) < gates.minAgreement) return { ok: false, reason: `agreement ${Math.round((signal.agreement || 0) * 100)}% < ${Math.round(gates.minAgreement * 100)}% gate` };
  }
  const riskPct = signal.plan.riskPct ?? 0;
  if (!(riskPct > 0)) return { ok: false, reason: 'no risk plan' };
  if (riskPct > maxRiskPct) return { ok: false, reason: `plan risk ${riskPct}% > ${maxRiskPct}% max` };
  return { ok: true, reason: requireStrong
    ? `STRONG ${signal.side} · ${signal.confidence}% conf · ${Math.round(signal.agreement * 100)}% agreement`
    : `PAPER ${signal.side} · ${signal.confidence}% conf (practice — STRONG gate applies to LIVE only)` };
}

/**
 * v6.5 — TRAILING STOP-LOSS MATH (shared by the crypto + India watchers).
 *
 * A prop desk doesn't let a winner round-trip back to the initial stop.
 * The ratchet (all LONG flipped for SHORT):
 *   • track peakPrice since entry (highest high for LONG)
 *   • initial risk R = |entry − original SL| (stored at open)
 *   • once profit ≥ armR × R   → SL ≥ entry (breakeven floor)
 *   • beyond that, trail       → SL = peak − offsetR × R
 *   • RATCHET-ONLY: a new SL may only TIGHTEN (LONG: > current; SHORT: < current)
 *   • never trail past the live price (that close is this tick's SL job)
 *
 * Pure + exported for tests. Returns { sl, peak, stage } or null when
 * nothing should move yet (or inputs are unusable).
 */
export function computeTrailSl(opts) {
  if (!opts || typeof opts !== 'object') return null;
  const { side, entryPrice, peakPrice, currentSl, initialRisk, price, armR = 1.0, offsetR = 1.0 } = opts;
  const long = String(side).toUpperCase() !== 'SHORT';
  const entry = Number(entryPrice), peak = Number(peakPrice), risk = Number(initialRisk), ltp = Number(price);
  if (!(entry > 0) || !(peak > 0) || !(risk > 0) || !(ltp > 0)) return null;
  const arm = Number.isFinite(Number(armR)) && armR > 0 ? armR : 1.0;
  const off = Number.isFinite(Number(offsetR)) && offsetR > 0 ? offsetR : 1.0;
  const profit = long ? peak - entry : entry - peak;
  if (profit < arm * risk) return null; // not armed yet — initial SL stands
  let candidate;
  let stage;
  if (profit < (arm + 0.5 * off) * risk) {
    // stage 1: lock breakeven (entry) — the psychological lock
    candidate = entry;
    stage = 'breakeven';
  } else {
    // stage 2: trail the peak at offsetR × R behind
    candidate = long ? peak - off * risk : peak + off * risk;
    stage = 'trail';
  }
  // breakeven floor for stage 2 as well (never below entry once armed)
  candidate = long ? Math.max(candidate, entry) : Math.min(candidate, entry);
  // ratchet: only tighten
  const cur = Number(currentSl);
  if (Number.isFinite(cur) && cur > 0) {
    if (long && candidate <= cur) return null;
    if (!long && candidate >= cur) return null;
  }
  // never cross the live price (that's a stop HIT, not a trail move)
  if (long && candidate >= ltp) return null;
  if (!long && candidate <= ltp) return null;
  return { sl: Math.round(candidate * 100) / 100, peak, stage };
}

/**
 * v6.4 — RISK AUTO-FIT (the execute-time twin of buildTradePlan's cap).
 *
 * The user bug: a STRONG crypto signal whose structural ATR stop reads
 * 5.04% vs the 5% cap used to hard-REJECT even the PAPER button
 * ("Signal gate: plan risk 5.04% > 5% max"). A 0.04% overshoot is not
 * a risk problem — conflating stop WIDTH with money AT RISK was. A
 * prop desk fits the stop to the cap and re-derives targets; it does
 * not bounce the trade.
 *
 *   SL  → entry ∓ cap% (tightened to the configured ceiling)
 *   T1  → entry ± 1× fitted risk · T2 → entry ± 2× fitted risk
 *   plan.riskClamped = true + originalRiskPct (honest audit trail)
 *
 * PAPER always fits (practice money must never dead-end on stop
 * width). LIVE callers decide their own tolerance BEFORE calling this
 * (executeSignal only fits mild overshoot ≤ 1.5× cap for live — a
 * wildly-wide ATR stop clamped tight is noise-suicide and honestly
 * belongs in a REJECT).
 *
 * @returns {{ signal, note: string|null }} note is set when a fit happened
 */
export function fitPlanToRiskCap(signal, maxRiskPct = 5) {
  const plan = signal?.plan;
  const ltp = Number(signal?.ltp);
  const riskPct = Number(plan?.riskPct);
  if (!plan || !Number.isFinite(riskPct) || !(riskPct > 0) || !(ltp > 0)
    || !Number.isFinite(Number(maxRiskPct)) || !(maxRiskPct > 0)) {
    return { signal, note: null };
  }
  if (riskPct <= maxRiskPct) return { signal, note: null };
  const long = signal.side !== 'SHORT';
  const capDist = ltp * (maxRiskPct / 100);
  const stopLoss = long ? ltp - capDist : ltp + capDist;
  const target1 = long ? ltp + capDist : ltp - capDist;
  const target2 = long ? ltp + 2 * capDist : ltp - 2 * capDist;
  const fitted = {
    ...plan,
    stopLoss: r2(stopLoss),
    target1: r2(target1),
    target2: r2(target2),
    risk: r2(capDist),
    riskPct: r2(maxRiskPct),
    rewardRisk: 2,
    riskClamped: true,
    originalRiskPct: r2(riskPct),
    planStyle: `${plan.planStyle || 'atr'}→risk-fitted`,
  };
  return {
    signal: { ...signal, plan: fitted },
    note: `risk auto-fitted ${r2(riskPct)}% → ${r2(maxRiskPct)}% cap (SL tightened, targets re-derived)`,
  };
}
