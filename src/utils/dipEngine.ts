// ============================================
// BUY-THE-DIP INTELLIGENCE ENGINE
// Dip detection, Kelly sizing, dip ladder, position sizing
// ============================================

import { Position, PriceData, DipSignal, DipLevel } from '../types';
import { getAssetCagrProxy } from './constants';
import { analyzeAsset } from './telegram';

/**
 * Calculate dip depth for a single asset
 */
export function calculateDipDepth(
  position: Position,
  priceData: PriceData | undefined
): DipSignal {
  const price = priceData?.price || position.avgPrice;
  const sma20 = priceData?.sma20 || price;
  const sma50 = priceData?.sma50 || price;
  const rsi = priceData?.rsi || 50;
  const high = priceData?.high || price * 1.05;
  const low = priceData?.low || price * 0.95;

  // Distance from SMAs (positive = below SMA = dip)
  const sma20Distance = sma20 > 0 ? ((sma20 - price) / sma20) * 100 : 0;
  const sma50Distance = sma50 > 0 ? ((sma50 - price) / sma50) * 100 : 0;

  // Dip depth classification
  let dipDepth: DipSignal['dipDepth'];
  if (rsi < 30 || (sma50Distance > 5 && sma20Distance > 3)) {
    dipDepth = 'DEEP';
  } else if (rsi < 40 || sma20Distance > 2) {
    dipDepth = 'MILD';
  } else if (rsi > 65) {
    dipDepth = 'ELEVATED';
  } else {
    dipDepth = 'NEUTRAL';
  }

  // Fibonacci levels
  const range = high - low;
  const fibSupport = low + range * 0.618;
  const fibResistance = low + range * 0.382;

  // Entry target: below SMA20 or at fib support
  const entryTarget = dipDepth === 'DEEP' || dipDepth === 'MILD'
    ? Math.min(sma20 * 0.98, fibSupport)
    : price;

  // Generate dip ladder
  const cagr = getAssetCagrProxy(position.symbol, position.market);
  const volatility = Math.max(cagr / 100, 0.15);
  const dipLadder = generateDipLadder(price, high, sma20, sma50, 10000, volatility);

  // Confidence from analyzeAsset
  const signal = analyzeAsset(position, priceData);
  let confidence = signal.confidence;
  if (dipDepth === 'DEEP') confidence = Math.min(confidence + 15, 98);
  if (dipDepth === 'MILD') confidence = Math.min(confidence + 8, 95);

  // Reason
  const reasons: string[] = [];
  if (rsi < 30) reasons.push(`RSI ${rsi} — deeply oversold`);
  else if (rsi < 40) reasons.push(`RSI ${rsi} — approaching oversold`);
  if (sma20Distance > 3) reasons.push(`${sma20Distance.toFixed(1)}% below SMA20`);
  if (sma50Distance > 5) reasons.push(`${sma50Distance.toFixed(1)}% below SMA50`);
  if (signal.signal === 'STRONG_BUY') reasons.push('Strong buy signal');
  if (dipDepth === 'DEEP') reasons.push('DEEP DIP — aggressive accumulation zone');
  if (reasons.length === 0) reasons.push('No significant dip detected');

  return {
    symbol: position.symbol,
    market: position.market,
    currentPrice: price,
    sma20,
    sma50,
    sma20Distance,
    sma50Distance,
    rsi,
    dipDepth,
    fibSupport,
    fibResistance,
    entryTarget,
    dipLadder,
    confidence,
    reason: reasons.join(' | ')
  };
}

/**
 * Generate dip ladder — buy amounts at 5/10/15/20% dips
 */
export function generateDipLadder(
  currentPrice: number,
  _highPrice: number,
  sma20: number,
  sma50: number,
  totalBudget: number,
  _volatility: number
): DipLevel[] {
  const referencePrice = Math.max(sma20, sma50, currentPrice);
  const levels = [5, 10, 15, 20];

  return levels.map(pct => {
    const targetPrice = referencePrice * (1 - pct / 100);
    const triggered = currentPrice <= targetPrice;
    // Pyramid buying: deeper dips get more allocation
    const multiplier = 1 + pct / 20;
    const baseAmount = totalBudget * 0.25;
    const suggestedAmount = Math.round(baseAmount * multiplier);

    return {
      label: `${pct}% dip`,
      percentBelow: pct,
      targetPrice: Math.round(targetPrice * 100) / 100,
      suggestedAmount,
      triggered
    };
  });
}

/**
 * Compute dip signals for entire portfolio
 */
export function computePortfolioDipSignals(
  portfolio: Position[],
  livePrices: Record<string, PriceData>,
  _totalBudget?: number
): DipSignal[] {
  return portfolio.map(pos => {
    const key = `${pos.market}_${pos.symbol}`;
    const priceData = livePrices[key];
    return calculateDipDepth(pos, priceData);
  }).sort((a, b) => {
    // Sort by dip depth severity: DEEP > MILD > NEUTRAL > ELEVATED
    const order = { DEEP: 0, MILD: 1, NEUTRAL: 2, ELEVATED: 3 };
    return order[a.dipDepth] - order[b.dipDepth];
  });
}

/**
 * Kelly Criterion — optimal bet size
 * Uses half-Kelly for safety
 */
export function kellyCriterion(
  winRate: number,
  avgWinPct: number,
  avgLossPct: number
): number {
  if (avgWinPct <= 0 || avgLossPct <= 0) return 0;
  const kelly = (winRate * avgWinPct - (1 - winRate) * avgLossPct) / avgWinPct;
  // Half-Kelly for safety, clamp to [0, 0.25]
  return Math.max(0, Math.min(kelly * 0.5, 0.25));
}

/**
 * Smart dip-aware position sizing
 */
export function allocateDipBudget(
  totalMonthlyBudget: number,
  dipSignals: DipSignal[],
  _portfolio: Position[]
): { symbol: string; allocatedAmount: number; allocationPct: number; kellyPct: number; invVolPct: number; dipMultiplier: number; reason: string }[] {
  // Only allocate to BUY/STRONG_BUY signals with dips
  const buySignals = dipSignals.filter(d => d.dipDepth === 'DEEP' || d.dipDepth === 'MILD');

  if (buySignals.length === 0) {
    // No dips — distribute evenly
    return dipSignals.slice(0, 5).map(d => ({
      symbol: d.symbol,
      allocatedAmount: Math.round(totalMonthlyBudget / 5),
      allocationPct: 20,
      kellyPct: 0,
      invVolPct: 20,
      dipMultiplier: 1,
      reason: 'No active dips — equal distribution'
    }));
  }

  // Calculate weights
  const weights = buySignals.map(d => {
    const cagr = getAssetCagrProxy(d.symbol, d.market);
    const volatility = Math.max(cagr / 100, 0.15);
    const invVolWeight = 1 / volatility;

    // Kelly from confidence
    const winRate = d.confidence / 100;
    const avgWin = cagr / 252; // daily
    const avgLoss = volatility / Math.sqrt(252);
    const kelly = kellyCriterion(winRate, avgWin, avgLoss);

    // Dip multiplier: deeper dips get more
    const dipMult = d.dipDepth === 'DEEP' ? 1.5 : 1.25;

    // Composite weight
    const composite = (invVolWeight * 0.4) + (kelly * 0.3) + (dipMult * 0.3);

    return { d, invVolWeight, kelly, dipMult, composite };
  });

  // Normalize
  const totalComposite = weights.reduce((s, w) => s + w.composite, 0);

  return weights.map(w => {
    const pct = totalComposite > 0 ? (w.composite / totalComposite) * 100 : 0;
    const amount = Math.round(totalMonthlyBudget * pct / 100);
    return {
      symbol: w.d.symbol,
      allocatedAmount: amount,
      allocationPct: Math.round(pct),
      kellyPct: Math.round(w.kelly * 100),
      invVolPct: Math.round((w.invVolWeight / weights.reduce((s, x) => s + x.invVolWeight, 0)) * 100),
      dipMultiplier: w.dipMult,
      reason: w.d.dipDepth === 'DEEP'
        ? `Deep dip — aggressive ${Math.round(w.dipMult * 100)}% allocation`
        : `Mild dip — ${Math.round(w.dipMult * 100)}% allocation`
    };
  }).sort((a, b) => b.allocatedAmount - a.allocatedAmount);
}
