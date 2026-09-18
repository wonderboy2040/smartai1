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

export function suggestPositionSize(totalCapital: number, assets: { symbol: string; volatility: number }[]) {
  const totalVol = assets.reduce((sum, a) => sum + a.volatility, 0);
  if (totalVol === 0) return assets.map(a => ({ symbol: a.symbol, suggestedAmount: totalCapital / assets.length }));
  return assets.map(a => {
    const weight = (1 / a.volatility) / (assets.reduce((sum, asset) => sum + (1 / asset.volatility), 0));
    return { symbol: a.symbol, suggestedAmount: totalCapital * weight, weightPct: Math.round(weight * 1000) / 10 };
  });
}

// ============================================================
// v5.0 UNIFIED RISK ANALYZER (merged from the former riskAnalyzer.ts —
// the site previously shipped TWO parallel risk engines computing the
// same VaR/drawdown/concentration math for different tabs). One engine
// now serves MacroTab (VaR trio + stress tests), PortfolioHealthMonitor
// (summary) and the Exact Buy Price panel's Risk tab (full metrics).
// ============================================================

export interface RiskAlert {
  level: 'INFO' | 'WARNING' | 'CRITICAL';
  type: string;
  message: string;
  action: string;
}

export interface RiskMetrics {
  portfolioVaR: { amount: number; percent: number; confidence: number };
  portfolioCVaR: { amount: number; percent: number };
  maxDrawdown: { percent: number; amount: number; fromPrice: number; toPrice: number };
  currentDrawdown: { percent: number; amount: number };
  sharpeRatio: number;
  sortinoRatio: number;
  beta: number;
  volatility: { daily: number; annualized: number };
  concentrationRisk: { topHolding: string; topPct: number; hhi: number; diversified: boolean };
  correlationMatrix: { symbol: string; correlations: Record<string, number> }[];
  alerts: RiskAlert[];
  riskScore: number; // 0-100 (lower = less risk)
  timestamp: number;
}

function changeBasedVaR(
  portfolio: Position[],
  livePrices: Record<string, PriceData>,
  usdInrRate: number,
  confidence: number = 95
): { amount: number; percent: number } {
  let totalValue = 0;
  const returns: number[] = [];

  for (const pos of portfolio) {
    const key = `${pos.market}_${pos.symbol}`;
    const data = livePrices[key];
    const curPrice = data?.price || pos.avgPrice;
    const change = (data?.change || 0) / 100;
    const rate = pos.market === 'IN' ? 1 : usdInrRate;
    totalValue += curPrice * pos.qty * rate;
    returns.push(change);
  }

  if (totalValue === 0 || returns.length === 0) return { amount: 0, percent: 0 };

  // Parametric VaR (assuming normal distribution)
  const mean = returns.reduce((s, r) => s + r, 0) / returns.length;
  const variance = returns.reduce((s, r) => s + Math.pow(r - mean, 2), 0) / returns.length;
  const stdDev = Math.sqrt(variance);

  // Z-score for confidence level
  const zScores: Record<number, number> = { 90: 1.282, 95: 1.645, 99: 2.326 };
  const z = zScores[confidence] || 1.645;

  const varPercent = (mean - z * stdDev) * 100;
  const varAmount = totalValue * Math.abs(varPercent) / 100;

  return {
    amount: Math.round(Math.abs(varAmount)),
    percent: Math.round(Math.abs(varPercent) * 100) / 100
  };
}

function computeCVaR(
  portfolio: Position[],
  livePrices: Record<string, PriceData>,
  usdInrRate: number
): { amount: number; percent: number } {
  let totalValue = 0;
  const returns: number[] = [];

  for (const pos of portfolio) {
    const key = `${pos.market}_${pos.symbol}`;
    const data = livePrices[key];
    const curPrice = data?.price || pos.avgPrice;
    const change = (data?.change || 0) / 100;
    const rate = pos.market === 'IN' ? 1 : usdInrRate;
    totalValue += curPrice * pos.qty * rate;
    returns.push(change);
  }

  if (totalValue === 0 || returns.length === 0) return { amount: 0, percent: 0 };

  const sorted = [...returns].sort((a, b) => a - b);
  const cutoff = Math.floor(sorted.length * 0.05);
  const tailReturns = sorted.slice(0, cutoff + 1);
  const avgTail = tailReturns.reduce((s, r) => s + r, 0) / (tailReturns.length || 1);

  return {
    amount: Math.round(totalValue * Math.abs(avgTail)),
    percent: Math.round(Math.abs(avgTail) * 10000) / 100
  };
}

function computeDrawdownPct(
  portfolio: Position[],
  livePrices: Record<string, PriceData>,
  usdInrRate: number
): { maxDrawdown: number; currentDrawdown: number } {
  let totalValue = 0;
  let totalInvested = 0;

  for (const pos of portfolio) {
    const key = `${pos.market}_${pos.symbol}`;
    const data = livePrices[key];
    const curPrice = data?.price || pos.avgPrice;
    const rate = pos.market === 'IN' ? 1 : usdInrRate;
    totalValue += curPrice * pos.qty * rate;
    totalInvested += pos.avgPrice * pos.qty * rate;
  }

  if (totalInvested === 0) return { maxDrawdown: 0, currentDrawdown: 0 };

  const currentDD = totalInvested > 0 ? Math.max(0, ((totalInvested - totalValue) / totalInvested) * 100) : 0;
  // Estimate max drawdown from VIX + current DD
  const estimatedMaxDD = Math.max(currentDD, currentDD * 1.5 + 5);

  return {
    maxDrawdown: Math.round(estimatedMaxDD * 100) / 100,
    currentDrawdown: Math.round(currentDD * 100) / 100
  };
}

function computeVolatility(
  portfolio: Position[],
  livePrices: Record<string, PriceData>,
  usdInrRate: number
): { daily: number; annualized: number } {
  let totalValue = 0;
  let weightedVol = 0;

  for (const pos of portfolio) {
    const key = `${pos.market}_${pos.symbol}`;
    const data = livePrices[key];
    const curPrice = data?.price || pos.avgPrice;
    const rate = pos.market === 'IN' ? 1 : usdInrRate;
    const posValue = curPrice * pos.qty * rate;
    totalValue += posValue;
    const atr = (data?.high || curPrice * 1.02) - (data?.low || curPrice * 0.98);
    const dailyVol = curPrice > 0 ? atr / curPrice : 0.02;
    weightedVol += dailyVol * posValue;
  }

  const dailyVol = totalValue > 0 ? weightedVol / totalValue : 0.02;
  const annualized = dailyVol * Math.sqrt(252);

  return {
    daily: Math.round(dailyVol * 10000) / 100,
    annualized: Math.round(annualized * 10000) / 100
  };
}

function computeConcentrationHHI(
  portfolio: Position[],
  livePrices: Record<string, PriceData>,
  usdInrRate: number
): { topHolding: string; topPct: number; hhi: number; diversified: boolean } {
  let totalValue = 0;
  const holdings: { symbol: string; value: number }[] = [];

  for (const pos of portfolio) {
    const key = `${pos.market}_${pos.symbol}`;
    const data = livePrices[key];
    const curPrice = data?.price || pos.avgPrice;
    const rate = pos.market === 'IN' ? 1 : usdInrRate;
    const val = curPrice * pos.qty * rate;
    totalValue += val;
    holdings.push({ symbol: pos.symbol, value: val });
  }

  if (totalValue === 0) return { topHolding: 'N/A', topPct: 0, hhi: 0, diversified: true };

  holdings.sort((a, b) => b.value - a.value);
  const topPct = (holdings[0].value / totalValue) * 100;

  // Herfindahl-Hirschman Index
  const hhi = holdings.reduce((s, h) => s + Math.pow(h.value / totalValue * 100, 2), 0);

  return {
    topHolding: holdings[0].symbol,
    topPct: Math.round(topPct * 10) / 10,
    hhi: Math.round(hhi),
    diversified: hhi < 1500
  };
}

function computeSharpe(
  portfolio: Position[],
  livePrices: Record<string, PriceData>,
  usdInrRate: number
): number {
  let totalValue = 0;
  const returns: number[] = [];

  for (const pos of portfolio) {
    const key = `${pos.market}_${pos.symbol}`;
    const data = livePrices[key];
    const curPrice = data?.price || pos.avgPrice;
    const rate = pos.market === 'IN' ? 1 : usdInrRate;
    totalValue += curPrice * pos.qty * rate;
    returns.push((data?.change || 0) / 100);
  }

  if (returns.length === 0 || totalValue === 0) return 0;

  const avgReturn = returns.reduce((s, r) => s + r, 0) / returns.length;
  const stdDev = Math.sqrt(returns.reduce((s, r) => s + Math.pow(r - avgReturn, 2), 0) / returns.length);
  const riskFreeRate = 0.065 / 252; // 6.5% annualized (India)
  const annualizedReturn = avgReturn * 252;
  const annualizedVol = stdDev * Math.sqrt(252);

  if (annualizedVol === 0) return 0;
  return Math.round(((annualizedReturn - riskFreeRate * 252) / annualizedVol) * 100) / 100;
}

function computeRiskAlerts(
  metrics: RiskMetrics,
  portfolio: Position[],
  livePrices: Record<string, PriceData>
): RiskAlert[] {
  const alerts: RiskAlert[] = [];
  // FIX C1: Operator precedence bug — `+` binds tighter than `||`, so the
  // original `a || 15 + b || 15` evaluated as `a || (15 + b) || 15`. Use ?? so
  // each VIX falls back to 15 independently, then average.
  const usVix = livePrices['US_VIX']?.price ?? 15;
  const inVix = livePrices['IN_INDIAVIX']?.price ?? 15;
  const avgVix = (usVix + inVix) / 2;

  // VaR alert
  if (metrics.portfolioVaR.percent > 3) {
    alerts.push({ level: 'CRITICAL', type: 'VaR', message: `High daily VaR: ${metrics.portfolioVaR.percent}%`, action: 'Reduce position sizes or hedge' });
  } else if (metrics.portfolioVaR.percent > 2) {
    alerts.push({ level: 'WARNING', type: 'VaR', message: `Elevated VaR: ${metrics.portfolioVaR.percent}%`, action: 'Monitor closely' });
  }

  // Drawdown alert
  if (metrics.currentDrawdown.percent > 15) {
    alerts.push({ level: 'CRITICAL', type: 'Drawdown', message: `Severe drawdown: ${metrics.currentDrawdown.percent}%`, action: 'Consider stop-losses on weakest holdings' });
  } else if (metrics.currentDrawdown.percent > 8) {
    alerts.push({ level: 'WARNING', type: 'Drawdown', message: `Moderate drawdown: ${metrics.currentDrawdown.percent}%`, action: 'Review portfolio health' });
  }

  // Concentration alert
  if (metrics.concentrationRisk.topPct > 40) {
    alerts.push({ level: 'WARNING', type: 'Concentration', message: `${metrics.concentrationRisk.topHolding} is ${metrics.concentrationRisk.topPct}% of portfolio`, action: 'Diversify by trimming overexposed position' });
  }

  // VIX alert
  if (avgVix > 25) {
    alerts.push({ level: 'CRITICAL', type: 'VIX', message: `VIX elevated at ${avgVix.toFixed(1)}`, action: 'Hedge portfolio, reduce leveraged positions' });
  } else if (avgVix > 18) {
    alerts.push({ level: 'WARNING', type: 'VIX', message: `VIX at ${avgVix.toFixed(1)}`, action: 'Stay cautious, maintain cash buffer' });
  }

  // Volatility alert
  if (metrics.volatility.annualized > 30) {
    alerts.push({ level: 'WARNING', type: 'Volatility', message: `High annualized vol: ${metrics.volatility.annualized}%`, action: 'Consider protective puts' });
  }

  // RSI extremes
  for (const pos of portfolio) {
    const key = `${pos.market}_${pos.symbol}`;
    const data = livePrices[key];
    if (data?.rsi && data.rsi > 75) {
      alerts.push({ level: 'WARNING', type: 'RSI', message: `${pos.symbol} RSI at ${data.rsi.toFixed(0)} (overbought)`, action: 'Consider partial profit booking' });
    }
    if (data?.rsi && data.rsi < 25) {
      alerts.push({ level: 'INFO', type: 'RSI', message: `${pos.symbol} RSI at ${data.rsi.toFixed(0)} (oversold)`, action: 'Potential accumulation opportunity' });
    }
  }

  return alerts;
}

// ========================================
// MAIN UNIFIED RISK CALCULATOR
// (was riskAnalyzer.calculatePortfolioRisk — same API)
// ========================================
export function calculatePortfolioRisk(
  portfolio: Position[],
  livePrices: Record<string, PriceData>,
  usdInrRate: number
): RiskMetrics {
  const var95 = changeBasedVaR(portfolio, livePrices, usdInrRate, 95);
  const cvar = computeCVaR(portfolio, livePrices, usdInrRate);
  const { maxDrawdown, currentDrawdown } = computeDrawdownPct(portfolio, livePrices, usdInrRate);
  const sharpe = computeSharpe(portfolio, livePrices, usdInrRate);
  const vol = computeVolatility(portfolio, livePrices, usdInrRate);
  const concentration = computeConcentrationHHI(portfolio, livePrices, usdInrRate);

  let totalValue = 0;
  for (const pos of portfolio) {
    const key = `${pos.market}_${pos.symbol}`;
    const data = livePrices[key];
    const curPrice = data?.price || pos.avgPrice;
    const rate = pos.market === 'IN' ? 1 : usdInrRate;
    totalValue += curPrice * pos.qty * rate;
  }

  const metrics: RiskMetrics = {
    portfolioVaR: { amount: var95.amount, percent: var95.percent, confidence: 95 },
    portfolioCVaR: { amount: cvar.amount, percent: cvar.percent },
    maxDrawdown: { percent: maxDrawdown, amount: Math.round(totalValue * maxDrawdown / 100), fromPrice: 0, toPrice: 0 },
    currentDrawdown: { percent: currentDrawdown, amount: Math.round(totalValue * currentDrawdown / 100) },
    sharpeRatio: sharpe,
    sortinoRatio: Math.round(sharpe * 1.3 * 100) / 100,
    beta: Math.round((1 + (vol.annualized - 15) / 50) * 100) / 100,
    volatility: vol,
    concentrationRisk: concentration,
    correlationMatrix: [],
    alerts: [],
    riskScore: 0,
    timestamp: Date.now()
  };

  metrics.alerts = computeRiskAlerts(metrics, portfolio, livePrices);

  // Overall risk score (0-100)
  let riskScore = 30;
  if (metrics.portfolioVaR.percent > 3) riskScore += 25;
  else if (metrics.portfolioVaR.percent > 2) riskScore += 15;
  if (metrics.currentDrawdown.percent > 10) riskScore += 20;
  else if (metrics.currentDrawdown.percent > 5) riskScore += 10;
  if (metrics.concentrationRisk.topPct > 40) riskScore += 10;
  if (metrics.volatility.annualized > 30) riskScore += 10;
  if (metrics.alerts.filter(a => a.level === 'CRITICAL').length > 0) riskScore += 15;
  metrics.riskScore = Math.min(100, Math.max(0, riskScore));

  return metrics;
}
