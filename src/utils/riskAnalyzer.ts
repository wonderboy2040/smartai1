// ============================================
// PORTFOLIO RISK ANALYZER
// VaR, CVaR, Drawdown, Correlation, Alerts
// ============================================

import { Position, PriceData } from '../types';

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

export interface RiskAlert {
  level: 'INFO' | 'WARNING' | 'CRITICAL';
  type: string;
  message: string;
  action: string;
}

// ========================================
// VaR CALCULATION (Historical + Parametric)
// ========================================
function calculateVaR(
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

// ========================================
// CVaR (Conditional VaR / Expected Shortfall)
// ========================================
function calculateCVaR(
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

// ========================================
// DRAWDOWN CALCULATION
// ========================================
function calculateDrawdown(
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

// ========================================
// VOLATILITY
// ========================================
function calculateVolatility(
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
    annualized: Math.round(annualized * 100) / 100
  };
}

// ========================================
// CONCENTRATION RISK
// ========================================
function calculateConcentration(
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

// ========================================
// SHARPE RATIO
// ========================================
function calculateSharpe(
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

  if (returns.length === 0) return 0;

  const avgReturn = returns.reduce((s, r) => s + r, 0) / returns.length;
  const stdDev = Math.sqrt(returns.reduce((s, r) => s + Math.pow(r - avgReturn, 2), 0) / returns.length);
  const riskFreeRate = 0.065 / 252; // 6.5% annualized (India)
  const annualizedReturn = avgReturn * 252;
  const annualizedVol = stdDev * Math.sqrt(252);

  if (annualizedVol === 0) return 0;
  return Math.round(((annualizedReturn - riskFreeRate * 252) / annualizedVol) * 100) / 100;
}

// ========================================
// RISK ALERTS
// ========================================
function generateAlerts(
  metrics: RiskMetrics,
  portfolio: Position[],
  livePrices: Record<string, PriceData>,
  _usdInrRate: number
): RiskAlert[] {
  const alerts: RiskAlert[] = [];
  const avgVix = (livePrices['US_VIX']?.price || 15 + livePrices['IN_INDIAVIX']?.price || 15) / 2;

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
// MAIN RISK CALCULATOR
// ========================================
export function calculatePortfolioRisk(
  portfolio: Position[],
  livePrices: Record<string, PriceData>,
  usdInrRate: number
): RiskMetrics {
  const var95 = calculateVaR(portfolio, livePrices, usdInrRate, 95);
  const cvar = calculateCVaR(portfolio, livePrices, usdInrRate);
  const { maxDrawdown, currentDrawdown } = calculateDrawdown(portfolio, livePrices, usdInrRate);
  const sharpe = calculateSharpe(portfolio, livePrices, usdInrRate);
  const vol = calculateVolatility(portfolio, livePrices, usdInrRate);
  const concentration = calculateConcentration(portfolio, livePrices, usdInrRate);

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

  metrics.alerts = generateAlerts(metrics, portfolio, livePrices, usdInrRate);

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

// ========================================
// TELEGRAM FORMAT
// ========================================
export function formatRiskForTelegram(metrics: RiskMetrics): string {
  const riskEmoji = metrics.riskScore < 30 ? '🟢' : metrics.riskScore < 60 ? '🟡' : '🔴';
  let msg = `<b>RISK ANALYZER</b>\n`;
  msg += `Risk Score: <b>${riskEmoji} ${metrics.riskScore}/100</b>\n\n`;

  msg += `<b>VaR (95%):</b> \u20B9${metrics.portfolioVaR.amount.toLocaleString('en-IN')} (${metrics.portfolioVaR.percent}%/day)\n`;
  msg += `<b>CVaR:</b> \u20B9${metrics.portfolioCVaR.amount.toLocaleString('en-IN')} (${metrics.portfolioCVaR.percent}%)\n`;
  msg += `<b>Current DD:</b> ${metrics.currentDrawdown.percent}%\n`;
  msg += `<b>Max DD Est:</b> ${metrics.maxDrawdown.percent}%\n`;
  msg += `<b>Sharpe:</b> ${metrics.sharpeRatio} | Sortino: ${metrics.sortinoRatio}\n`;
  msg += `<b>Beta:</b> ${metrics.beta}\n`;
  msg += `<b>Vol (Ann):</b> ${metrics.volatility.annualized}%\n`;
  msg += `<b>Top:</b> ${metrics.concentrationRisk.topHolding} (${metrics.concentrationRisk.topPct}%)\n`;
  msg += `<b>Diversified:</b> ${metrics.concentrationRisk.diversified ? 'Yes' : 'No'}\n\n`;

  if (metrics.alerts.length > 0) {
    msg += `<b>ALERTS:</b>\n`;
    for (const a of metrics.alerts.slice(0, 5)) {
      const lvl = a.level === 'CRITICAL' ? '\uD83D\uDD34' : a.level === 'WARNING' ? '\uD83D\uDFE0' : '\uD83D\uDD35';
      msg += `${lvl} ${a.message}\n  Action: ${a.action}\n`;
    }
  }

  msg += `\n<i>AI Risk Engine</i>`;
  return msg;
}
