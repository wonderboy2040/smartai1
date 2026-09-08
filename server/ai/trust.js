// ============================================================
// server/ai/trust.js — TRUST LAYER v2 (v6.11)
// ------------------------------------------------------------
// Glama-inspired (oneqaz-trading-mcp "Trust Layer"): the ledger
// already proves the track record is untampered (SHA-256 chain,
// v6.7). This module answers the NEXT question — "kitna bharosa
// kare us numbers par?" — with three honest instruments:
//
//   1. CALIBRATION — bucket the settled signals by the confidence
//      the engine CLAIMED (40-50, 50-60, … 80+) and compare with
//      the win-rate that actually happened. A 70% claim that wins
//      68% of the time = well calibrated. 70% claim winning 45%
//      = overconfident → the UI shows it.
//   2. BRIER SCORE — mean squared error between claimed
//      confidence and binary outcome. 0 = perfect, 0.25 = coin.
//      Computed on R>0 wins (direction-only honesty).
//   3. MONTHLY TREND — last 6 calendar months of settled signals:
//      n, win rate, avg R. Accuracy drifting DOWN is a red flag
//      the desk should see before it costs money.
//   4. GOVERNANCE (p-values) — per-model: is this model's vote
//      hit-rate distinguishable from the desk's base rate, or is
//      it noise? One-sided binomial survival function with a
//      normal approximation (honest: labeled approximation).
//      verdicts: SIGNIFICANT / NEEDS DATA / NOISE.
//
// Everything refuses to lie: < 10 settled entries → "insufficient
// data" fields, no invented percentages. Read-only — it never
// writes to the ledger.
// ============================================================
import { __ledgerRaw, modelStats } from './ledger.js';

const MONTHS_BACK = 6;
const MIN_SETTLED = 10;
const BUCKETS = [
  { label: '40-55%', lo: 40, hi: 55 },
  { label: '55-65%', lo: 55, hi: 65 },
  { label: '65-75%', lo: 65, hi: 75 },
  { label: '75-85%', lo: 75, hi: 85 },
  { label: '85%+', lo: 85, hi: 101 },
];

// ---------------- normal CDF (governance p-values) ----------------
/** Abramowitz & Stegun 7.1.26 approximation — plenty for a verdict label. */
function normalCdf(z) {
  const t = 1 / (1 + 0.2316419 * Math.abs(z));
  const poly = t * (0.319381530 + t * (-0.356563782 + t * (1.781477937 + t * (-1.821255978 + t * 1.330274429))));
  const cdf = 1 - (Math.exp(-0.5 * z * z) / Math.sqrt(2 * Math.PI)) * poly;
  return z >= 0 ? cdf : 1 - cdf;
}

/** One-sided binomial p-value: P(X >= wins | n, base) via normal approx. */
function binomPValueAtLeast(wins, n, baseRate) {
  if (!(n > 0) || !(baseRate > 0) || !(baseRate < 1)) return 1;
  const mean = n * baseRate;
  const sd = Math.sqrt(n * baseRate * (1 - baseRate));
  if (sd <= 0) return 1;
  // +0.5 continuity correction
  const z = (wins - 0.5 - mean) / sd;
  return Math.max(0, Math.min(1, 1 - normalCdf(z)));
}

// ---------------- calibration + Brier + monthly ----------------
function settledEntries() {
  const raw = __ledgerRaw();
  return (raw?.entries || []).filter(e => e?.outcome && e.outcome.r != null);
}

export function trustReport() {
  const settled = settledEntries();
  const base = {
    ok: true,
    settled: settled.length,
    asOf: Date.now(),
  };
  if (settled.length < MIN_SETTLED) {
    return {
      ...base,
      sufficient: false,
      note: `Insufficient data — ${settled.length}/${MIN_SETTLED} settled signals. Track record gather hone do; tab hi calibration meaningful hai (chhoti sample par percentage dhokha de sakti hai).`,
      calibration: [], brier: null, brierVerdict: null, monthly: [],
    };
  }

  // --- calibration buckets ---
  const calibration = BUCKETS.map(b => {
    const rows = settled.filter(e => {
      const c = Number(e.confidence);
      return Number.isFinite(c) && c >= b.lo && c < b.hi;
    });
    const n = rows.length;
    const wins = rows.filter(e => (e.outcome.r ?? 0) > 0).length;
    return {
      bucket: b.label,
      claimed: (b.lo + Math.min(b.hi, 100)) / 2, // bucket midpoint as the claim
      n,
      winRate: n > 0 ? Math.round((wins / n) * 1000) / 10 : null,
      gap: n > 0 ? Math.round((((wins / n) * 100) - (b.lo + Math.min(b.hi, 100)) / 2) * 10) / 10 : null,
    };
  }).filter(b => b.n > 0);

  // --- Brier score (direction-only: win = 1, loss = 0) ---
  let brierSum = 0;
  for (const e of settled) {
    const p = Math.min(1, Math.max(0, (Number(e.confidence) || 50) / 100));
    const y = (e.outcome.r ?? 0) > 0 ? 1 : 0;
    brierSum += (p - y) ** 2;
  }
  const brier = Math.round((brierSum / settled.length) * 10000) / 10000;
  const brierVerdict = brier <= 0.15 ? 'sharp — confidence ko meaningfully trust kar sakte ho'
    : brier <= 0.20 ? 'theek — mild over/under-confidence'
    : brier <= 0.25 ? 'weak — confidence aur outcome ka gap bada hai'
    : 'coin-flip se bhi worse — confidence labels par bharosa mat karo';

  // --- monthly accuracy trend (IST month keys) ---
  const istMonthKey = (ts) => {
    const ist = new Date(ts + (330 + new Date(ts).getTimezoneOffset()) * 60000);
    return `${ist.getFullYear()}-${String(ist.getMonth() + 1).padStart(2, '0')}`;
  };
  const byMonth = new Map();
  for (const e of settled) {
    const k = istMonthKey(e.outcome.ts || e.ts);
    if (!byMonth.has(k)) byMonth.set(k, []);
    byMonth.get(k).push(e);
  }
  const monthly = [...byMonth.entries()]
    .sort((a, b) => (a[0] < b[0] ? -1 : 1))
    .slice(-MONTHS_BACK)
    .map(([month, rows]) => {
      const wins = rows.filter(e => (e.outcome.r ?? 0) > 0).length;
      const avgR = rows.reduce((s, e) => s + (e.outcome.r ?? 0), 0) / rows.length;
      return {
        month,
        n: rows.length,
        winRate: Math.round((wins / rows.length) * 1000) / 10,
        avgR: Math.round(avgR * 100) / 100,
      };
    });
  // drift: last month vs the average of the prior months (needs both sides)
  let drift = null;
  if (monthly.length >= 2) {
    const last = monthly[monthly.length - 1];
    const prior = monthly.slice(0, -1);
    const priorWR = prior.reduce((s, m) => s + m.winRate * m.n, 0) / prior.reduce((s, m) => s + m.n, 0);
    drift = Math.round((last.winRate - priorWR) * 10) / 10;
  }

  return {
    ...base,
    sufficient: true,
    overall: {
      winRate: Math.round((settled.filter(e => (e.outcome.r ?? 0) > 0).length / settled.length) * 1000) / 10,
      avgConfidence: Math.round((settled.reduce((s, e) => s + (Number(e.confidence) || 0), 0) / settled.length) * 10) / 10,
    },
    calibration,
    brier,
    brierVerdict,
    monthly,
    drift,
    note: 'Calibration = claimed confidence vs realized win-rate. Brier = 0 perfect, 0.25 coin. Monthly = direction-only (R>0). Read-only.',
  };
}

// ---------------- governance (per-model p-values) ----------------
export function governance() {
  const settled = settledEntries();
  const baseRate = settled.length > 0
    ? settled.filter(e => (e.outcome.r ?? 0) > 0).length / settled.length
    : 0.5;
  const models = modelStats().map(m => {
    const p = binomPValueAtLeast(m.wins, m.n, baseRate);
    let verdict = 'NEEDS DATA';
    if (m.n >= MIN_SETTLED) verdict = p < 0.05 ? 'SIGNIFICANT' : p < 0.20 ? 'BORDERLINE' : 'NOISE';
    return {
      model: m.model,
      n: m.n,
      hitRate: m.hitRate,
      baseRate: Math.round(baseRate * 1000) / 10,
      pValue: Math.round(p * 1000) / 1000,
      verdict,
      edge: m.hitRate != null ? Math.round((m.hitRate - baseRate * 100) * 10) / 10 : null,
    };
  });
  return {
    ok: true,
    settled: settled.length,
    baseRate: Math.round(baseRate * 1000) / 10,
    method: 'one-sided binomial survival (normal approx, +0.5 continuity) — labelled approximation, verdict-grade only',
    minN: MIN_SETTLED,
    models: models.sort((a, b) => (a.pValue ?? 1) - (b.pValue ?? 1)),
    note: 'p < 0.05 = model ka edge base-rate se alag lagta hai (upward). NEEDS DATA = sample chhota hai — koi conclusion nahi. NOISE = edge base-rate se distinguishable nahi.',
  };
}

// ---------------- test hooks ----------------
export const __testables = { normalCdf, binomPValueAtLeast, BUCKETS, MIN_SETTLED };
