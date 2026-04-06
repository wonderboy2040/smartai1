// Risk Management Engine - VaR, stress testing, concentration risk
import { PriceData, Position } from '../types';
import { getAssetCagrProxy } from './constants';

export interface VaRResult {
  parametric: number;
  historical: number;
  monteCarlo: number;
  confidence: number;
}

export interface StressScenario {
  name: string;
  impactPct: number;
  description: string;
}

export interface ConcentrationRisk {
  symbol: string;
  weight: number;
  contributionToRisk: number;
}

function gaussianRandom(): number {
  let u1 = Math.random(), u2 = Math.random();
  while (u1 === 0) u1 = Math.random();
  return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
}

export function calculateVaR(
  portfolioValue: number,
  positions: Position[],
  livePrices: Record<string, PriceData>,
  confidence: number = 0.95
): VaRResult {
  if (portfolioValue === 0) return { parametric: 0, historical: 0, monteCarlo: 0, confidence };

  const returns: number[] = [];
  positions.forEach(p => {
    const key = `${p.market}_${p.symbol}`;
    const data = livePrices[key];
    if (data?.change !== undefined) returns.push(data.change);
  });

  const volatility = returns.length > 1
    ? Math.sqrt(returns.reduce((s, r) => s + r * r, 0) / (returns.length - 1)) / 100
    : 0.02;

  const avgReturn = returns.length > 0
    ? returns.reduce((s, r) => s + r, 0) / returns.length / 100 : 0;

  const zScore = confidence === 0.95 ? 1.645 : confidence === 0.99 ? 2.326 : 1.28;
  const parametric = portfolioValue * volatility * zScore;

  // Historical VaR
  let historical = portfolioValue * 0.02;
  if (returns.length >= 2) {
    const sorted = [...returns].sort((a, b) => a - b);
    const pct = confidence === 0.95 ? 0.05 : 0.01;
    const worst = sorted[Math.max(0, Math.floor(sorted.length * pct))];
    historical = Math.abs(portfolioValue * worst / 100);
  }

  // Monte Carlo - REDUCED to 500 for UI performance
  let monteCarlo = parametric;
  if (portfolioValue > 0 && volatility > 0.001) {
    const results: number[] = [];
    const sims = 500;
    for (let i = 0; i < sims; i++) {
      let val = portfolioValue;
      const shock = gaussianRandom() * volatility + avgReturn;
      val *= (1 + shock);
      results.push(val);
    }
    results.sort((a, b) => a - b);
    const pct = confidence === 0.95 ? 0.05 : 0.01;
    const threshold = results[Math.floor(results.length * pct)];
    monteCarlo = Math.max(0, portfolioValue - threshold);
  }

  return {
    parametric: Math.round(parametric),
    historical: Math.round(historical),
    monteCarlo: Math.round(monteCarlo),
    confidence
  };
}

export function runStressTests(positions: Position[], livePrices: Record<string, PriceData>): StressScenario[] {
  let totalValue = 0;
  positions.forEach(p => {
    const price = livePrices[`${p.market}_${p.symbol}`]?.price || p.avgPrice;
    totalValue += price * p.qty;
  });
  if (totalValue === 0) return [];

  return [
    { name: '2008 Financial Crisis', impactPct: -45, description: 'Lehman collapse, ~45% drop' },
    { name: 'COVID Crash (2020)', impactPct: -30, description: 'Pandemic crash, ~30% drop' },
    { name: 'Interest Rate Shock (+2%)', impactPct: -15, description: 'Fed hikes 200bps, equity re-rating' },
    { name: 'Geopolitical Shock', impactPct: -20, description: 'Major event, risk-off flight' },
    { name: 'Tech Sector Selloff', impactPct: -18, description: 'Dot-com style tech correction' },
    { name: 'India Market Crisis', impactPct: -35, description: 'Taper tantrum / demonetization' },
  ];
}

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
    return { symbol: p.symbol, value, vol: getAssetCagrProxy(p.symbol, p.market) / 100 };
  });
  if (totalValue === 0) return [];

  return values.map(v => ({
    symbol: v.symbol,
    weight: Math.round(v.value / totalValue * 100),
    contributionToRisk: Math.round((v.value / totalValue) * v.vol * 1000) / 10
  })).sort((a, b) => b.contributionToRisk - a.contributionToRisk);
}
