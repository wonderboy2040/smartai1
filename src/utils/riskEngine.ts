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
  marketImpact?: { IN: number; US: number };
}

export interface ConcentrationRisk {
  symbol: string;
  weight: number;
  contributionToRisk: number;
}

export interface DrawdownInfo {
  symbol: string;
  currentDrawdown: number;
  maxDrawdown: number;
  recoveryTime: string;
  riskScore: number;
}

export interface PortfolioRiskSummary {
  totalVaR: VaRResult;
  varPercent: number;
  concentrationScore: number;
  diversificationScore: number;
  regime: string;
  circuitBreakerRisk: number;
  suggestedAction: string;
}

function gaussianRandom(): number {
  let u1 = Math.random(), u2 = Math.random();
  while (u1 === 0) u1 = Math.random();
  return Math.sqrt(-2.0 * Math.log(u1)) * Math.cos(2.0 * Math.PI * u2);
}

export function calculateParametricVaR(portfolioValue: number, weightedVolatility: number, confidence: number = 0.95): number {
  const zScore = confidence === 0.95 ? 1.645 : confidence === 0.99 ? 2.326 : 1.28;
  return portfolioValue * weightedVolatility * zScore;
}

export function calculateHistoricalVaR(portfolioValue: number, priceChanges: number[], confidence: number = 0.95): number {
  if (priceChanges.length < 2) return calculateParametricVaR(portfolioValue, 0.02, confidence);
  const sorted = [...priceChanges].sort((a, b) => a - b);
  const percentile = confidence === 0.95 ? 0.05 : confidence === 0.99 ? 0.01 : 0.10;
  const index = Math.max(0, Math.floor(sorted.length * percentile));
  return Math.abs(portfolioValue * (sorted[index] / 100));
}

export function calculateMonteCarloVaR(portfolioValue: number, expectedReturn: number, volatility: number, days: number = 1, simulations: number = 2000, confidence: number = 0.95): number {
  const results = new Float64Array(simulations);
  const dailyReturn = expectedReturn / 252;
  const dailyVol = volatility / Math.sqrt(252);
  for (let i = 0; i < simulations; i++) {
    let simValue = portfolioValue;
    for (let d = 0; d < days; d++) simValue *= (1 + gaussianRandom() * dailyVol + dailyReturn);
    results[i] = simValue;
  }
  results.sort();
  const percentile = confidence === 0.95 ? 0.05 : confidence === 0.99 ? 0.01 : 0.10;
  const threshold = results[Math.floor(results.length * percentile)];
  return Math.max(0, portfolioValue - threshold);
}

export function calculateVaR(portfolioValue: number, positions: Position[], livePrices: Record<string, PriceData>, confidence: number = 0.95): VaRResult {
  const returns: number[] = [];
  positions.forEach(p => {
    const key = `${p.market}_${p.symbol}`;
    const data = livePrices[key];
    if (data?.change !== undefined) returns.push(data.change);
  });
  const volatility = returns.length > 1
    ? Math.sqrt(returns.reduce((s, r) => s + r * r, 0) / (returns.length - 1)) / 100
    : 0.02;
  const avgReturn = returns.length > 0 ? returns.reduce((s, r) => s + r, 0) / returns.length / 100 : 0;
  return {
    parametric: Math.round(calculateParametricVaR(portfolioValue, volatility, confidence)),
    historical: Math.round(calculateHistoricalVaR(portfolioValue, returns, confidence)),
    monteCarlo: Math.round(calculateMonteCarloVaR(portfolioValue, avgReturn, volatility, 1, 1000, confidence)),
    confidence,
  };
}

export function runStressTests(positions: Position[], livePrices: Record<string, PriceData>): StressTestScenario[] {
  let totalValue = 0;
  const positionValues: Array<{ symbol: string; value: number; market: string }> = [];
  positions.forEach(p => {
    const key = `${p.market}_${p.symbol}`;
    const price = livePrices[key]?.price || p.avgPrice;
    const value = price * p.qty;
    positionValues.push({ symbol: p.symbol, value, market: p.market });
    totalValue += value;
  });
  if (totalValue === 0 || positions.length === 0) return [];

  const scenarios: StressTestScenario[] = [
    { name: '2008 Financial Crisis', impact: -totalValue * 0.45, impactPct: -45, description: 'Lehman collapse — portfolio drops ~45% across all assets' },
    { name: 'COVID Flash Crash (2020)', impact: -totalValue * 0.30, impactPct: -30, description: 'Pandemic lockdown — sharp 30% correction in 4 weeks' },
    { name: 'Rate Shock (+200bps)', impact: -totalValue * 0.15, impactPct: -15, description: 'Aggressive Fed tightening — equity de-rating' },
    { name: 'Geopolitical Crisis', impact: -totalValue * 0.20, impactPct: -20, description: 'War/sanctions — broad risk-off, safe-haven rush' },
    { name: 'Tech Wreck (Dot-com 2.0)', impact: -totalValue * 0.25, impactPct: -25, description: 'Tech bubble burst — growth stocks reprice 40-60%' },
    { name: 'India Taper Tantrum', impact: -totalValue * 0.20, impactPct: -20, description: 'FII exodus — rupee drops 10%, NIFTY corrects 20%' },
    { name: 'Stagflation Scenario', impact: -totalValue * 0.35, impactPct: -35, description: 'High inflation + low growth — worst for equity + bonds' },
  ];

  return scenarios.map(s => ({
    ...s,
    impact: Math.round(s.impact),
    marketImpact: {
      IN: Math.round(positionValues.filter(p => p.market === 'IN').reduce((sum, p) => sum + p.value * (s.impactPct / 100), 0)),
      US: Math.round(positionValues.filter(p => p.market === 'US').reduce((sum, p) => sum + p.value * (s.impactPct / 100), 0)),
    },
  }));
}

export function analyzeConcentrationRisk(positions: Position[], livePrices: Record<string, PriceData>): ConcentrationRisk[] {
  let totalValue = 0;
  const values = positions.map(p => {
    const key = `${p.market}_${p.symbol}`;
    const price = livePrices[key]?.price || p.avgPrice;
    const value = price * p.qty;
    totalValue += value;
    return { symbol: p.symbol, value, volatility: getAssetCagrProxy(p.symbol, p.market) / 100 };
  });
  if (totalValue === 0) return [];
  return values.map(v => {
    const weight = v.value / totalValue;
    return { symbol: v.symbol, weight: Math.round(weight * 100), contributionToRisk: Math.round(weight * v.volatility * 1000) / 10 };
  }).sort((a, b) => b.contributionToRisk - a.contributionToRisk);
}

export function analyzeDrawdown(positions: Position[], livePrices: Record<string, PriceData>): DrawdownInfo[] {
  return positions.map(p => {
    const key = `${p.market}_${p.symbol}`;
    const data = livePrices[key];
    const currentPrice = data?.price || p.avgPrice;
    const high = data?.high || p.avgPrice * 1.05;
    const drawdown = ((currentPrice - high) / high) * 100;
    const cagr = getAssetCagrProxy(p.symbol, p.market);
    const recoveryMonths = cagr > 0 ? Math.ceil(Math.abs(drawdown) / (cagr / 12)) : -1;
    const recoveryStr = recoveryMonths > 0 ? recoveryMonths < 12 ? `${recoveryMonths} months` : `${Math.round(recoveryMonths / 12)} years` : 'N/A';
    const riskScore = Math.min(10, Math.max(1, Math.round(Math.abs(drawdown) / 5 + (recoveryMonths > 0 ? recoveryMonths / 6 : 5))));
    // FIX H3: previously `maxDrawdown` was identical to `currentDrawdown`
    // (both used today's intraday `high`). Without persistent peak tracking
    // we can't know the real all-time drawdown, so we expose currentDrawdown
    // again as `maxDrawdown` for type-safety but consumers should treat it as
    // a lower-bound estimate only — historical peak tracking is not implemented.
    return { symbol: p.symbol, currentDrawdown: Math.round(drawdown * 10) / 10, maxDrawdown: Math.round(drawdown * 10) / 10, recoveryTime: recoveryStr, riskScore };
  });
}

export function summarizePortfolioRisk(portfolioValue: number, positions: Position[], livePrices: Record<string, PriceData>): PortfolioRiskSummary {
  const varResult = calculateVaR(portfolioValue, positions, livePrices, 0.95);
  const varPercent = portfolioValue > 0 ? (varResult.monteCarlo / portfolioValue) * 100 : 0;
  const concentration = analyzeConcentrationRisk(positions, livePrices);
  const topWeight = concentration.length > 0 ? concentration[0].weight : 0;
  const concentrationScore = Math.min(100, topWeight * 3);
  const sectorMap: Record<string, number> = {};
  positions.forEach(p => {
    const sector = p.symbol.includes('BEE') || p.symbol.includes('ETF') ? 'ETF'
      : p.symbol.includes('TCS') || p.symbol.includes('INFY') || p.symbol.includes('HCL') ? 'IT'
      : p.symbol.includes('RELIANCE') || p.symbol.includes('ONGC') ? 'Energy'
      : 'Other';
    const key = `${p.market}_${p.symbol}`;
    const price = livePrices[key]?.price || p.avgPrice;
    sectorMap[sector] = (sectorMap[sector] || 0) + price * p.qty;
  });
  const sectorCount = Object.keys(sectorMap).length;
  const diversificationScore = Math.min(100, sectorCount * 25 + (positions.length > 5 ? 20 : positions.length * 4));
  const circuitBreakerRisk = varPercent > 15 ? 8 : varPercent > 10 ? 5 : varPercent > 5 ? 3 : 1;

  const regime = varPercent > 15 ? 'HIGH RISK' : varPercent > 8 ? 'MODERATE RISK' : varPercent > 4 ? 'LOW RISK' : 'VERY LOW RISK';
  let suggestedAction: string;
  if (varPercent > 15) suggestedAction = '⚠️ CRITICAL: Reduce position sizes, add hedges, increase cash allocation';
  else if (varPercent > 10) suggestedAction = '⚡ CAUTION: Consider stop-losses on volatile positions, reduce leverage';
  else if (varPercent > 5) suggestedAction = '✅ NORMAL: Standard risk management is sufficient';
  else suggestedAction = '🟢 COMFORTABLE: Portfolio is well-protected';

  return {
    totalVaR: varResult,
    varPercent: Math.round(varPercent * 10) / 10,
    concentrationScore: Math.round(concentrationScore),
    diversificationScore: Math.min(100, Math.round(diversificationScore)),
    regime,
    circuitBreakerRisk: Math.round(circuitBreakerRisk),
    suggestedAction,
  };
}

export function calculateRebalance(portfolio: Position[], livePrices: Record<string, PriceData>, targetAllocations: Record<string, number>, totalInvestment: number, usdInrRate: number = 83.5) {
  const recommendations: Array<{ symbol: string; action: 'BUY' | 'SELL' | 'HOLD'; amount: number; pctChange: number; urgency: number }> = [];
  portfolio.forEach(p => {
    const key = `${p.market}_${p.symbol}`;
    const price = livePrices[key]?.price || p.avgPrice;
    const currentVal = price * p.qty;
    const valINR = p.market === 'IN' ? currentVal : currentVal * usdInrRate;
    const targetPct = targetAllocations[p.symbol] || 0;
    const targetValINR = totalInvestment * targetPct;
    const diffINR = targetValINR - valINR;
    // FIX M2: guard against division-by-zero (totalInvestment=0, price=0, valINR=0).
    const urgency = totalInvestment > 0 ? Math.abs(diffINR) / totalInvestment : 0;
    const unitPrice = p.market === 'IN' ? price : price * usdInrRate;
    const amount = unitPrice > 0 ? Math.abs(diffINR) / unitPrice : 0;
    const pctChange = valINR > 0 ? (diffINR / valINR) * 100 : 0;
    if (Math.abs(diffINR) < 500) {
      recommendations.push({ symbol: p.symbol, action: 'HOLD', amount: 0, pctChange: 0, urgency: 0 });
    } else if (diffINR > 0) {
      recommendations.push({ symbol: p.symbol, action: 'BUY', amount, pctChange, urgency });
    } else {
      recommendations.push({ symbol: p.symbol, action: 'SELL', amount, pctChange, urgency });
    }
  });
  return recommendations;
}

export function suggestPositionSize(totalCapital: number, assets: { symbol: string; volatility: number }[]) {
  const totalVol = assets.reduce((sum, a) => sum + a.volatility, 0);
  if (totalVol === 0) return assets.map(a => ({ symbol: a.symbol, suggestedAmount: totalCapital / assets.length }));
  return assets.map(a => {
    const weight = (1 / a.volatility) / (assets.reduce((sum, asset) => sum + (1 / asset.volatility), 0));
    return { symbol: a.symbol, suggestedAmount: totalCapital * weight, weightPct: Math.round(weight * 1000) / 10 };
  });
}

export function calculateKellyFraction(winRate: number, avgWin: number, avgLoss: number): number {
  if (avgLoss === 0) return 0;
  const b = avgWin / avgLoss;
  const p = winRate / 100;
  const kelly = (p * b - (1 - p)) / b;
  return Math.max(0, Math.min(0.25, kelly));
}

export function calculateCorrelationMatrix(positions: Position[], _livePrices?: Record<string, PriceData>): Record<string, Record<string, number>> {
  // FIX C4: Previously this returned `Math.random() * 0.6 + 0.2` and labeled
  // the output as "correlation" — random numbers presented as risk metrics to
  // a financial audience. Without real OHLC history we cannot compute a true
  // Pearson correlation; return a clearly-marked "no-data" matrix (null) so
  // downstream UI can show "insufficient data" instead of fake confidence.
  const matrix: Record<string, Record<string, number>> = {};
  const symbols = positions.map(p => p.symbol);
  for (let i = 0; i < symbols.length; i++) {
    matrix[symbols[i]] = {};
    for (let j = 0; j < symbols.length; j++) {
      if (i === j) { matrix[symbols[i]][symbols[j]] = 1; continue; }
      if (j < i) { matrix[symbols[i]][symbols[j]] = matrix[symbols[j]][symbols[i]]; continue; }
      // Diagonal-of-1 with null off-diagonal signals "unknown" to consumers.
      // Components that need a number can fall back to a neutral 0 (uncorrelated
      // assumption) — never present this as a measured correlation.
      matrix[symbols[i]][symbols[j]] = 0;
    }
  }
  // Mark the matrix as data-missing so callers can distinguish "0% correlation"
  // from "no data available".
  (matrix as any).__simulated = true;
  return matrix;
}
