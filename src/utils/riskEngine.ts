// Risk Management Dashboard Engine
// VaR, stress testing, concentration risk, drawdown analysis

import { PriceData, Position } from '../types';
import { getAssetCagrProxy } from './constants';

export interface VaRResult {
  parametric: number;
  historical: number;
  monteCarlo: number;
  confidence: number;
}

export interface StressTestScenario {
  name: string;
  impact: number;
  impactPct: number;
  description: string;
}

export interface ConcentrationRisk {
  symbol: string;
  weight: number;
  contributionToRisk: number;
}

export interface DrawdownInfo {
  currentDrawdown: number;
  maxDrawdown: number;
  recoveryTime: string;
}

/**
 * Calculate Value at Risk using parametric (delta-normal) method
 */
export function calculateParametricVaR(
  portfolioValue: number,
  weightedVolatility: number,
  confidence: number = 0.95
): number {
  const zScore = confidence === 0.95 ? 1.645 : confidence === 0.99 ? 2.326 : 1.28;
  return portfolioValue * weightedVolatility * zScore;
}

/**
 * Historical VaR simulation using price changes
 */
export function calculateHistoricalVaR(
  portfolioValue: number,
  priceChanges: number[],
  confidence: number = 0.95
): number {
  if (priceChanges.length < 2) return calculateParametricVaR(portfolioValue, 0.02, confidence);

  const sorted = [...priceChanges].sort((a, b) => a - b);
  const percentile = confidence === 0.95 ? 0.05 : confidence === 0.99 ? 0.01 : 0.10;
  const index = Math.max(0, Math.floor(sorted.length * percentile));
  const worstReturn = sorted[index];

  return Math.abs(portfolioValue * worstReturn / 100);
}

/**
 * Monte Carlo VaR with simulations
 */
export function calculateMonteCarloVaR(
  portfolioValue: number,
  expectedReturn: number,
  volatility: number,
  days: number = 1,
  simulations: number = 2000,
  confidence: number = 0.95
): number {
  const results = new Float64Array(simulations);
  const dailyReturn = expectedReturn / 252;
  const dailyVol = volatility / Math.sqrt(252);

  for (let i = 0; i < simulations; i++) {
    let simValue = portfolioValue;
    for (let d = 0; d < days; d++) {
      const shock = gaussianRandom() * dailyVol + dailyReturn;
      simValue *= (1 + shock);
    }
    results[i] = simValue;
  }

  results.sort();
  const percentile = confidence === 0.95 ? 0.05 : confidence === 0.99 ? 0.01 : 0.10;
  const threshold = results[Math.floor(results.length * percentile)];

  return Math.max(0, portfolioValue - threshold);
}

function gaussianRandom(): number {
  let u1 = Math.random();
  let u2 = Math.random();
  while (u1 === 0) u1 = Math.random();
  return Math.sqrt(-2.0 * Math.log(u1)) * Math.cos(2.0 * Math.PI * u2);
}

/**
 * Comprehensive VaR calculation (parametric, historical, Monte Carlo)
 */
export function calculateVaR(
  portfolioValue: number,
  positions: Position[],
  livePrices: Record<string, PriceData>,
  confidence: number = 0.95
): VaRResult {
  // Calculate portfolio-level volatility
  const returns: number[] = [];

  positions.forEach(p => {
    const key = `${p.market}_${p.symbol}`;
    const data = livePrices[key];
    if (data?.change !== undefined) returns.push(data.change);
  });

  const volatility = returns.length > 1
    ? Math.sqrt(returns.reduce((s, r) => s + r * r, 0) / (returns.length - 1)) / 100
    : 0.02; // 2% default

  const avgReturn = returns.length > 0
    ? returns.reduce((s, r) => s + r, 0) / returns.length / 100
    : 0;

  const parametric = calculateParametricVaR(portfolioValue, volatility, confidence);
  const montecarlo = calculateMonteCarloVaR(portfolioValue, avgReturn, volatility, 1, 1000, confidence);

  return {
    parametric: Math.round(parametric),
    historical: Math.round(calculateHistoricalVaR(portfolioValue, returns, confidence)),
    monteCarlo: Math.round(montecarlo),
    confidence
  };
}

/**
 * Stress testing scenarios
 */
export function runStressTests(
  positions: Position[],
  livePrices: Record<string, PriceData>
): StressTestScenario[] {
  let totalValue = 0;
  const positionValues: Array<{ symbol: string; value: number; market: string }> = [];

  positions.forEach(p => {
    const key = `${p.market}_${p.symbol}`;
    const price = livePrices[key]?.price || p.avgPrice;
    const value = price * p.qty;
    positionValues.push({ symbol: p.symbol, value, market: p.market });
    totalValue += value;
  });

  if (totalValue === 0) return [];

  const scenarios: StressTestScenario[] = [
    {
      name: '2008 Financial Crisis',
      impact: -totalValue * 0.45,
      impactPct: -45,
      description: 'Lehman collapse, portfolio drops ~45%'
    },
    {
      name: 'COVID Crash (2020)',
      impact: -totalValue * 0.30,
      impactPct: -30,
      description: 'Pandemic crash, portfolio drops ~30%'
    },
    {
      name: 'Interest Rate Shock (+2%)',
      impact: -totalValue * 0.15,
      impactPct: -15,
      description: 'Fed raises rates 200bps, equity re-rating'
    },
    {
      name: 'Geopolitical Shock',
      impact: -totalValue * 0.20,
      impactPct: -20,
      description: 'Major geopolitical event, risk-off flight'
    },
    {
      name: 'Tech Sector Selloff',
      impact: -totalValue * 0.18,
      impactPct: -18,
      description: 'Tech-heavy correction similar to dot-com crash'
    },
    {
      name: 'India Market Crisis',
      impact: -totalValue * 0.35,
      impactPct: -35,
      description: 'India-specific crisis (taper tantrum, demonetization)'
    }
  ];

  return scenarios.map(s => ({
    ...s,
    impact: Math.round(s.impact),
    marketImpact: {
      IN: Math.round(positionValues
        .filter(p => p.market === 'IN')
        .reduce((sum, p) => sum + p.value * (s.impactPct / 100), 0)),
      US: Math.round(positionValues
        .filter(p => p.market === 'US')
        .reduce((sum, p) => sum + p.value * (s.impactPct / 100), 0))
    }
  } as StressTestScenario & { marketImpact: { IN: number; US: number } }));
}

/**
 * Concentration risk analysis
 */
export function analyzeConcentrationRisk(
  positions: Position[],
  livePrices: Record<string, PriceData>
): ConcentrationRisk[] {
  let totalValue = 0;

  const values = positions.map(p => {
    const key = `${p.market}_${p.symbol}`;
    const price = livePrices[key]?.price || p.avgPrice;
    const value = price * p.qty;
    totalValue += value;
    return { symbol: p.symbol, value, volatility: getAssetCagrProxy(p.symbol, p.market) / 100 };
  });

  if (totalValue === 0) return [];

  // Calculate each position's contribution to portfolio risk
  return values.map(v => {
    const weight = v.value / totalValue;
    const riskContribution = weight * v.volatility;
    return {
      symbol: v.symbol,
      weight: Math.round(weight * 100),
      contributionToRisk: Math.round(riskContribution * 1000) / 10
    };
  }).sort((a, b) => b.contributionToRisk - a.contributionToRisk);
}

/**
 * Drawdown analysis
 */
export function analyzeDrawdown(
  positions: Position[],
  livePrices: Record<string, PriceData>
): DrawdownInfo[] {
  return positions.map(p => {
    const key = `${p.market}_${p.symbol}`;
    const data = livePrices[key];
    const currentPrice = data?.price || p.avgPrice;
    const high = data?.high || p.avgPrice * 1.05;
    const drawdown = ((currentPrice - high) / high) * 100;

    // Estimate recovery time based on CAGR
    const cagr = getAssetCagrProxy(p.symbol, p.market);
    const recoveryMonths = cagr > 0 ? Math.ceil(Math.abs(drawdown) / (cagr / 12)) : -1;
    const recoveryStr = recoveryMonths > 0
      ? recoveryMonths < 12 ? `${recoveryMonths} months` : `${Math.round(recoveryMonths / 12)} years`
      : 'N/A';

    return {
      symbol: p.symbol,
      currentDrawdown: Math.round(drawdown * 10) / 10,
      maxDrawdown: high ? ((currentPrice - high) / high) * 100 : 0,
      recoveryTime: recoveryStr
    };
  });
}
