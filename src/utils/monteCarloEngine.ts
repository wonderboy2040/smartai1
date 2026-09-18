// ============================================================
// MONTE CARLO SIP SIMULATOR
// ------------------------------------------------------------
// Runs N=10,000 randomized simulations of a monthly SIP over a
// multi-year horizon, drawing monthly returns from a normal
// distribution parameterised by annual CAGR + annual volatility.
// Returns the P10 / P50 / P90 distribution + probability that
// the corpus hits a user-defined target.
//
// Why this matters: standard SIP calculators show ONE number
// based on a fixed CAGR. Reality is volatile — the same average
// return can produce wildly different outcomes depending on
// sequence of returns. Monte Carlo exposes the *range* of
// realistic outcomes so users plan for the worst case, not the
// median fantasy.
// ============================================================

export interface MonteCarloInputs {
  monthlySIP: number;
  years: number;
  annualCagrPct: number;        // expected nominal annual return, e.g. 12
  annualVolatilityPct: number;  // annual std-dev of returns, e.g. 18
  stepUpPct?: number;           // optional annual step-up (default 0)
  initialCorpus?: number;       // existing lumpsum (default 0)
  targetCorpus?: number;        // goal — used to compute hit probability
  simulations?: number;         // default 10_000
  seed?: number;                // for reproducibility (default 42)
}

export interface MonteCarloResult {
  p10: number;                  // 10th percentile outcome (worst-case-ish)
  p50: number;                  // median outcome
  p90: number;                  // 90th percentile (best-case-ish)
  p25: number;
  p75: number;
  mean: number;
  stdDev: number;
  min: number;
  max: number;
  hitProbability: number;       // 0..1 — fraction of sims that hit target
  invested: number;             // total contributions (no growth)
  histogram: { bucket: number; count: number }[];  // for chart
  percentileCurve: { year: number; p10: number; p50: number; p90: number }[];
  success: boolean;
}

// Deterministic PRNG (mulberry32) — reproducible across runs.
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Box-Muller transform: uniform → standard normal.
function gaussian(rng: () => number): number {
  let u = 0, v = 0;
  while (u === 0) u = rng();
  while (v === 0) v = rng();
  return Math.sqrt(-2.0 * Math.log(u)) * Math.cos(2.0 * Math.PI * v);
}

// Convert annual CAGR + annual vol → monthly moments.
// r_monthly = (1 + r_annual)^(1/12) - 1
// vol_monthly = vol_annual / sqrt(12)
function monthlyMoments(annualCagrPct: number, annualVolPct: number) {
  const monthlyMean = Math.pow(1 + annualCagrPct / 100, 1 / 12) - 1;
  const monthlyStd = annualVolPct / 100 / Math.sqrt(12);
  return { monthlyMean, monthlyStd };
}

/**
 * Run the Monte Carlo simulation. Deterministic for a given seed (default 42),
 * so the same inputs always produce the same numbers — important for UI
 * stability when sliders jitter.
 */
export function runMonteCarloSIP(inputs: MonteCarloInputs): MonteCarloResult {
  const {
    monthlySIP,
    years,
    annualCagrPct,
    annualVolatilityPct,
    stepUpPct = 0,
    initialCorpus = 0,
    targetCorpus = 0,
    simulations = 10_000,
    seed = 42,
  } = inputs;

  // Cap simulations to keep UI snappy on slow devices.
  const N = Math.max(100, Math.min(50_000, Math.floor(simulations)));
  const totalMonths = Math.max(1, Math.floor(years * 12));
  const { monthlyMean, monthlyStd } = monthlyMoments(annualCagrPct, annualVolatilityPct);
  const stepUpFactor = 1 + stepUpPct / 100;

  // Total invested (no growth) — includes step-up.
  let invested = initialCorpus;
  let currentSip = monthlySIP;
  for (let m = 0; m < totalMonths; m++) {
    if (m > 0 && m % 12 === 0) currentSip *= stepUpFactor;
    invested += currentSip;
  }

  const rng = mulberry32(seed);
  const outcomes = new Float64Array(N);

  // Track year-end percentile curves (size = years+1 including year 0).
  const yearBuckets: number[][] = Array.from({ length: years + 1 }, () => []);
  // Sample only 1/4 of sims into the curve to keep memory bounded.
  const curveSampleStride = Math.max(1, Math.floor(N / 2000));

  for (let s = 0; s < N; s++) {
    let fv = initialCorpus;
    let sip = monthlySIP;
    let yearIdx = 0;
    yearBuckets[0].push(fv);

    for (let m = 0; m < totalMonths; m++) {
      if (m > 0 && m % 12 === 0) {
        sip *= stepUpFactor;
        yearIdx++;
        if (s % curveSampleStride === 0) yearBuckets[yearIdx].push(fv);
      }
      // Random monthly return ~ N(mean, std^2)
      const r = monthlyMean + monthlyStd * gaussian(rng);
      fv = (fv + sip) * (1 + r);
      // Guard against runaway negative (extreme tail sim going bankrupt).
      if (fv < 0) fv = 0;
    }
    outcomes[s] = fv;
  }

  // Sort for percentile extraction.
  const sorted = Array.from(outcomes).sort((a, b) => a - b);
  const pct = (p: number) => sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))];

  const p10 = pct(10);
  const p25 = pct(25);
  const p50 = pct(50);
  const p75 = pct(75);
  const p90 = pct(90);
  const min = sorted[0];
  const max = sorted[sorted.length - 1];

  let sum = 0;
  for (const v of outcomes) sum += v;
  const mean = sum / N;

  let variance = 0;
  for (const v of outcomes) variance += (v - mean) * (v - mean);
  const stdDev = Math.sqrt(variance / N);

  // Hit probability — fraction of sims that reached targetCorpus.
  let hits = 0;
  if (targetCorpus > 0) {
    for (const v of outcomes) if (v >= targetCorpus) hits++;
  }
  const hitProbability = targetCorpus > 0 ? hits / N : 1;

  // Histogram: 20 buckets between min and max (log-spaced if all positive).
  const BUCKETS = 20;
  const histogram: { bucket: number; count: number }[] = [];
  const allPositive = min >= 0;
  const lo = min;
  const hi = max;
  if (hi > lo) {
    const bucketSize = allPositive
      ? 0  // we'll use log bins below
      : (hi - lo) / BUCKETS;
    if (allPositive && lo > 0) {
      // Log-spaced buckets — better for skewed wealth distributions.
      const logLo = Math.log10(Math.max(1, lo));
      const logHi = Math.log10(Math.max(2, hi));
      const logStep = (logHi - logLo) / BUCKETS;
      const counts = new Array(BUCKETS).fill(0);
      for (const v of outcomes) {
        const b = Math.min(BUCKETS - 1, Math.max(0, Math.floor((Math.log10(Math.max(1, v)) - logLo) / logStep)));
        counts[b]++;
      }
      for (let i = 0; i < BUCKETS; i++) {
        histogram.push({ bucket: Math.round(Math.pow(10, logLo + i * logStep)), count: counts[i] });
      }
    } else {
      const counts = new Array(BUCKETS).fill(0);
      for (const v of outcomes) {
        const b = Math.min(BUCKETS - 1, Math.max(0, Math.floor((v - lo) / bucketSize)));
        counts[b]++;
      }
      for (let i = 0; i < BUCKETS; i++) {
        histogram.push({ bucket: Math.round(lo + i * bucketSize), count: counts[i] });
      }
    }
  }

  // Year-end percentile curve — sampled subset for chart.
  const percentileCurve: { year: number; p10: number; p50: number; p90: number }[] = [];
  for (let y = 0; y <= years; y++) {
    const bucket = yearBuckets[y];
    if (bucket.length === 0) continue;
    const sb = [...bucket].sort((a, b) => a - b);
    const bp = (p: number) => sb[Math.min(sb.length - 1, Math.floor((p / 100) * sb.length))];
    percentileCurve.push({ year: y, p10: bp(10), p50: bp(50), p90: bp(90) });
  }

  return {
    p10, p25, p50, p75, p90,
    mean, stdDev, min, max,
    hitProbability,
    invested,
    histogram,
    percentileCurve,
    success: true,
  };
}

// Volatility presets per asset-class mix — used by UI defaults.
export const VOLATILITY_PRESETS = {
  conservative: 10,    // 80% debt / 20% equity
  balanced: 14,        // 50/50
  growth: 18,          // 70% equity / 30% debt
  aggressive: 22,      // 90% equity / 10% gold
  ultra_aggressive: 28, // 100% small-cap / crypto
  crypto: 65,          // BTC/ETH only
} as const;

export type VolatilityPreset = keyof typeof VOLATILITY_PRESETS;

// Convenience: build a friendly summary string for UI display.
export function summarizeMonteCarlo(r: MonteCarloResult, targetCorpus: number): string {
  const fmt = (n: number) => `₹${(n / 100000).toFixed(1)}L`;
  const hitPct = (r.hitProbability * 100).toFixed(0);
  const targetLine = targetCorpus > 0 ? ` • Hit target: ${hitPct}% probability` : '';
  return `Worst 10%: ${fmt(r.p10)} • Median: ${fmt(r.p50)} • Best 10%: ${fmt(r.p90)}${targetLine}`;
}
