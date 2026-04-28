/**
 * SMC Pro Engine — Smart Money Concepts Analysis
 * Ported from Pine Script v5 prompts (prompt1-6) to TypeScript
 * Covers: Market Structure, BOS/CHoCH, Liquidity Sweeps, Order Blocks,
 *         FVGs, HTF Bias, AlgoAlpha Trend Filter, Session Detection, Signals
 */

import { PriceData, Position } from '../types';

// ============================================================================
// TYPES
// ============================================================================

export interface SwingPoint {
  price: number;
  bar: number;
  type: 'HIGH' | 'LOW';
}

export interface MarketStructure {
  lastHighType: 'HH' | 'LH' | null;
  lastLowType: 'HL' | 'LL' | null;
  trendBias: 1 | -1 | 0; // 1=bullish, -1=bearish, 0=neutral
  lastPH: number | null;
  lastPL: number | null;
}

export interface OrderBlock {
  top: number;
  bottom: number;
  type: 'BULLISH' | 'BEARISH';
  mitigated: boolean;
}

export interface FairValueGap {
  top: number;
  bottom: number;
  type: 'BULLISH' | 'BEARISH';
  filled: boolean;
}

export interface TrendFilterResult {
  kalmanLine: number;
  kalmanUpper: number;
  kalmanLower: number;
  trendDirection: 1 | -1 | 0;
  ktrendDirection: 1 | -1 | 0;
  trendConfirmed: boolean;
  isRanging: boolean;
  label: 'Bullish' | 'Bearish' | 'Ranging' | 'Neutral';
}

export interface ProTraderLevels {
  entry: number;
  stopLoss: number;
  takeProfit: number;
  riskReward: number;
  riskAmount: number;
  rewardAmount: number;
}

export interface SMCSignal {
  signal: 'STRONG_BUY' | 'BUY' | 'HOLD' | 'SELL' | 'STRONG_SELL';
  confidence: number;
  reasoning: string[];
}

export interface SMCAnalysisResult {
  symbol: string;
  market: 'IN' | 'US';
  price: number;
  change: number;
  // Structure
  structure: MarketStructure;
  hasBOS: boolean;
  bosType: 'BULL' | 'BEAR' | null;
  hasCHoCH: boolean;
  chochType: 'BULL' | 'BEAR' | null;
  // Liquidity
  bullSweep: boolean;
  bearSweep: boolean;
  // Zones
  orderBlocks: OrderBlock[];
  fvgs: FairValueGap[];
  // HTF
  htfBias: 'Bullish' | 'Bearish' | 'Neutral';
  // Trend Filter
  trendFilter: TrendFilterResult;
  // Session
  session: SessionInfo;
  // Pro Levels
  levels: ProTraderLevels;
  // Signal
  signal: SMCSignal;
  // Scores
  smcScore: number;
  confluenceCount: number;
}

export interface SessionInfo {
  name: 'India' | 'USA' | 'Off-Session';
  isKillZone: boolean;
  icon: string;
}

// ============================================================================
// SESSION DETECTION (from promp2.txt)
// ============================================================================

export function getSessionStatus(): SessionInfo {
  const now = new Date();
  const istHour = parseInt(now.toLocaleString('en-US', { hour: '2-digit', hour12: false, timeZone: 'Asia/Kolkata' }));
  const istMin = parseInt(now.toLocaleString('en-US', { minute: '2-digit', timeZone: 'Asia/Kolkata' }));
  const istTime = istHour * 60 + istMin;

  // India session: 9:15 AM – 3:30 PM IST
  if (istTime >= 555 && istTime <= 930) {
    return { name: 'India', isKillZone: true, icon: '🇮🇳' };
  }
  // USA session: 7:00 PM – 1:30 AM IST (next day)
  if (istTime >= 1140 || istTime <= 90) {
    return { name: 'USA', isKillZone: true, icon: '🇺🇸' };
  }
  return { name: 'Off-Session', isKillZone: false, icon: '🌙' };
}

// ============================================================================
// MARKET STRUCTURE (from prompt1.txt)
// ============================================================================

export function calculateMarketStructure(
  price: number,
  high: number,
  low: number,
  rsi: number,
  sma20: number,
  sma50: number,
  change: number
): MarketStructure {
  // Derive swing classification from available indicators
  const priceAboveSMA20 = price > sma20;
  const priceAboveSMA50 = price > sma50;
  const sma20AboveSMA50 = sma20 > sma50;
  const isBullishMomentum = change > 0 && rsi > 50;
  const isBearishMomentum = change < 0 && rsi < 50;

  let lastHighType: 'HH' | 'LH' | null = null;
  let lastLowType: 'HL' | 'LL' | null = null;
  let trendBias: 1 | -1 | 0 = 0;

  // Determine structure from SMA cross + RSI + price action
  if (priceAboveSMA20 && sma20AboveSMA50 && isBullishMomentum) {
    lastHighType = 'HH';
    lastLowType = 'HL';
    trendBias = 1;
  } else if (!priceAboveSMA20 && !sma20AboveSMA50 && isBearishMomentum) {
    lastHighType = 'LH';
    lastLowType = 'LL';
    trendBias = -1;
  } else if (priceAboveSMA50 && !priceAboveSMA20) {
    // Pullback in uptrend
    lastHighType = 'HH';
    lastLowType = rsi < 45 ? 'LL' : 'HL';
    trendBias = rsi > 45 ? 1 : 0;
  } else if (!priceAboveSMA50 && priceAboveSMA20) {
    // Bounce in downtrend
    lastHighType = rsi > 55 ? 'HH' : 'LH';
    lastLowType = 'LL';
    trendBias = rsi < 55 ? -1 : 0;
  } else {
    // Ranging
    lastHighType = change > 0.5 ? 'HH' : 'LH';
    lastLowType = change < -0.5 ? 'LL' : 'HL';
    trendBias = 0;
  }

  // Estimate swing levels from available data
  const atr = (high - low) || price * 0.015;
  const lastPH = high + atr * 0.1;
  const lastPL = low - atr * 0.1;

  return { lastHighType, lastLowType, trendBias, lastPH, lastPL };
}

// ============================================================================
// BOS & CHoCH DETECTION (from prompt1.txt)
// ============================================================================

export function detectBOSandCHoCH(
  price: number,
  change: number,
  structure: MarketStructure
): { hasBOS: boolean; bosType: 'BULL' | 'BEAR' | null; hasCHoCH: boolean; chochType: 'BULL' | 'BEAR' | null } {
  let hasBOS = false, bosType: 'BULL' | 'BEAR' | null = null;
  let hasCHoCH = false, chochType: 'BULL' | 'BEAR' | null = null;

  if (structure.lastPH && price > structure.lastPH) {
    if (structure.trendBias >= 0) {
      hasBOS = true; bosType = 'BULL';
    } else {
      hasCHoCH = true; chochType = 'BULL';
    }
  }
  if (structure.lastPL && price < structure.lastPL) {
    if (structure.trendBias <= 0) {
      hasBOS = true; bosType = 'BEAR';
    } else {
      hasCHoCH = true; chochType = 'BEAR';
    }
  }

  // Fallback: use strong change as proxy
  if (!hasBOS && !hasCHoCH) {
    if (Math.abs(change) > 2.5) {
      if (change > 0 && structure.trendBias >= 0) { hasBOS = true; bosType = 'BULL'; }
      else if (change > 0 && structure.trendBias < 0) { hasCHoCH = true; chochType = 'BULL'; }
      else if (change < 0 && structure.trendBias <= 0) { hasBOS = true; bosType = 'BEAR'; }
      else if (change < 0 && structure.trendBias > 0) { hasCHoCH = true; chochType = 'BEAR'; }
    }
  }

  return { hasBOS, bosType, hasCHoCH, chochType };
}

// ============================================================================
// LIQUIDITY SWEEPS (from prompt1.txt)
// ============================================================================

export function detectLiquiditySweep(
  high: number,
  low: number,
  close: number,
  lastPH: number | null,
  lastPL: number | null
): { bullSweep: boolean; bearSweep: boolean } {
  const bearSweep = lastPH !== null && high > lastPH && close < lastPH;
  const bullSweep = lastPL !== null && low < lastPL && close > lastPL;
  return { bullSweep, bearSweep };
}

// ============================================================================
// ORDER BLOCKS (from prompt1.txt, prompt4.txt)
// ============================================================================

export function calculateOrderBlocks(
  price: number,
  high: number,
  low: number,
  change: number,
  structure: MarketStructure
): OrderBlock[] {
  const blocks: OrderBlock[] = [];
  const atr = (high - low) || price * 0.015;

  // Bullish OB = zone below price where institutional buying occurred
  if (structure.trendBias >= 0 || change > 1) {
    const obTop = price - atr * 0.5;
    const obBot = price - atr * 1.5;
    blocks.push({
      top: obTop,
      bottom: Math.max(obBot, low - atr * 0.2),
      type: 'BULLISH',
      mitigated: low <= obTop
    });
  }

  // Bearish OB = zone above price where institutional selling occurred
  if (structure.trendBias <= 0 || change < -1) {
    const obBot = price + atr * 0.5;
    const obTop = price + atr * 1.5;
    blocks.push({
      top: Math.min(obTop, high + atr * 0.2),
      bottom: obBot,
      type: 'BEARISH',
      mitigated: high >= obBot
    });
  }

  return blocks.filter(b => !b.mitigated);
}

// ============================================================================
// FAIR VALUE GAPS (from prompt1.txt)
// ============================================================================

export function detectFVGs(
  price: number,
  high: number,
  low: number,
  change: number
): FairValueGap[] {
  const gaps: FairValueGap[] = [];
  const atr = (high - low) || price * 0.015;

  // Detect imbalance via strong directional move
  if (Math.abs(change) > 1.5) {
    if (change > 0) {
      // Bullish FVG
      gaps.push({
        top: low,
        bottom: low - atr * 0.6,
        type: 'BULLISH',
        filled: false
      });
    } else {
      // Bearish FVG
      gaps.push({
        top: high + atr * 0.6,
        bottom: high,
        type: 'BEARISH',
        filled: false
      });
    }
  }
  return gaps;
}

// ============================================================================
// HTF BIAS (from promp3.txt)
// ============================================================================

export function calculateHTFBias(
  rsi: number,
  sma20: number,
  sma50: number,
  price: number,
  change: number
): 'Bullish' | 'Bearish' | 'Neutral' {
  let bullPoints = 0, bearPoints = 0;

  if (price > sma20) bullPoints += 1; else bearPoints += 1;
  if (price > sma50) bullPoints += 1; else bearPoints += 1;
  if (sma20 > sma50) bullPoints += 1; else bearPoints += 1;
  if (rsi > 55) bullPoints += 1; else if (rsi < 45) bearPoints += 1;
  if (change > 0.5) bullPoints += 1; else if (change < -0.5) bearPoints += 1;

  if (bullPoints >= 4) return 'Bullish';
  if (bearPoints >= 4) return 'Bearish';
  return 'Neutral';
}

// ============================================================================
// ALGOALPHA TREND FILTER — Kalman + Supertrend (from prompt5.txt, promp6.txt)
// ============================================================================

export function kalmanFilter(
  price: number,
  prevK: number | null,
  alpha: number = 0.01,
  beta: number = 0.1,
  period: number = 77
): number {
  if (prevK === null) return price;
  const v3 = alpha * beta;
  let v2 = 1.0;
  const v4 = v2 / (v2 + v3);
  const k = prevK + v4 * (price - prevK);
  return k;
}

export function calculateTrendFilter(
  price: number,
  high: number,
  low: number,
  rsi: number,
  sma20: number,
  sma50: number,
  change: number,
  volume: number
): TrendFilterResult {
  // Simplified Kalman using exponential smoothing
  const alpha = 0.15;
  const kalmanLine = sma20 * alpha + sma50 * (1 - alpha);

  // Volatility bands
  const atr = (high - low) || price * 0.015;
  const vola = atr * 1.5;
  const dev = 1.2;
  const kalmanUpper = kalmanLine + vola * dev;
  const kalmanLower = kalmanLine - vola * dev;

  // Short-term trend (price vs bands)
  let trendDirection: 1 | -1 | 0 = 0;
  if (price > kalmanUpper) trendDirection = 1;
  else if (price < kalmanLower) trendDirection = -1;

  // Long-term trend (Supertrend proxy via SMA cross + RSI)
  let ktrendDirection: 1 | -1 | 0 = 0;
  if (sma20 > sma50 && rsi > 50) ktrendDirection = 1;
  else if (sma20 < sma50 && rsi < 50) ktrendDirection = -1;

  const product = ktrendDirection * trendDirection;
  const trendConfirmed = product === 1;
  const isRanging = product === -1;

  let label: TrendFilterResult['label'] = 'Neutral';
  if (isRanging) label = 'Ranging';
  else if (trendDirection === 1 && trendConfirmed) label = 'Bullish';
  else if (trendDirection === -1 && trendConfirmed) label = 'Bearish';

  return {
    kalmanLine, kalmanUpper, kalmanLower,
    trendDirection, ktrendDirection,
    trendConfirmed, isRanging, label
  };
}

// ============================================================================
// PRO TRADER LEVELS (from prompt4.txt)
// ============================================================================

export function calculateProLevels(
  price: number,
  high: number,
  low: number,
  structure: MarketStructure,
  trendFilter: TrendFilterResult,
  rrRatio: number = 2.0
): ProTraderLevels {
  const atr = (high - low) || price * 0.015;
  const atrBuffer = 0.2;

  let entry = price;
  let stopLoss: number;
  let takeProfit: number;

  if (structure.trendBias >= 0) {
    // Long setup
    const slBase = (structure.lastPL || (price - atr * 2)) - atr * atrBuffer;
    stopLoss = trendFilter.kalmanLower > 0
      ? Math.min(slBase, trendFilter.kalmanLower)
      : slBase;
    const risk = Math.max(price - stopLoss, atr * 0.5);
    takeProfit = price + risk * rrRatio;
  } else {
    // Short setup
    const slBase = (structure.lastPH || (price + atr * 2)) + atr * atrBuffer;
    stopLoss = trendFilter.kalmanUpper > 0
      ? Math.max(slBase, trendFilter.kalmanUpper)
      : slBase;
    const risk = Math.max(stopLoss - price, atr * 0.5);
    takeProfit = price - risk * rrRatio;
  }

  const riskAmount = Math.abs(price - stopLoss);
  const rewardAmount = Math.abs(takeProfit - price);
  const riskReward = riskAmount > 0 ? rewardAmount / riskAmount : 0;

  return { entry, stopLoss, takeProfit, riskReward, riskAmount, rewardAmount };
}

// ============================================================================
// SIGNAL GENERATION (from prompt4.txt, prompt5.txt)
// ============================================================================

export function generateSMCSignal(
  structure: MarketStructure,
  hasBOS: boolean,
  hasCHoCH: boolean,
  bullSweep: boolean,
  bearSweep: boolean,
  orderBlocks: OrderBlock[],
  fvgs: FairValueGap[],
  htfBias: string,
  trendFilter: TrendFilterResult,
  session: SessionInfo,
  rsi: number,
  change: number
): SMCSignal {
  const reasoning: string[] = [];
  let bullScore = 0, bearScore = 0;

  // Structure bias
  if (structure.trendBias === 1) { bullScore += 15; reasoning.push(`Structure: ${structure.lastHighType}/${structure.lastLowType} (Bullish)`); }
  else if (structure.trendBias === -1) { bearScore += 15; reasoning.push(`Structure: ${structure.lastHighType}/${structure.lastLowType} (Bearish)`); }
  else { reasoning.push('Structure: Ranging'); }

  // BOS/CHoCH
  if (hasBOS) { const pts = 20; structure.trendBias >= 0 ? bullScore += pts : bearScore += pts; reasoning.push('Break of Structure detected'); }
  if (hasCHoCH) { const pts = 25; change > 0 ? bullScore += pts : bearScore += pts; reasoning.push('Change of Character — reversal signal'); }

  // Sweeps
  if (bullSweep) { bullScore += 15; reasoning.push('Bullish liquidity sweep — smart money reversal'); }
  if (bearSweep) { bearScore += 15; reasoning.push('Bearish liquidity sweep — institutional trap'); }

  // Order Blocks
  const bullOBs = orderBlocks.filter(ob => ob.type === 'BULLISH').length;
  const bearOBs = orderBlocks.filter(ob => ob.type === 'BEARISH').length;
  if (bullOBs > 0) { bullScore += 10; reasoning.push(`${bullOBs} active bullish OB zone(s)`); }
  if (bearOBs > 0) { bearScore += 10; reasoning.push(`${bearOBs} active bearish OB zone(s)`); }

  // FVGs
  if (fvgs.some(f => f.type === 'BULLISH')) { bullScore += 8; reasoning.push('Bullish FVG imbalance present'); }
  if (fvgs.some(f => f.type === 'BEARISH')) { bearScore += 8; reasoning.push('Bearish FVG imbalance present'); }

  // HTF Bias
  if (htfBias === 'Bullish') { bullScore += 15; reasoning.push('HTF Bias: Bullish — aligned with higher TF'); }
  else if (htfBias === 'Bearish') { bearScore += 15; reasoning.push('HTF Bias: Bearish — aligned with higher TF'); }

  // Trend Filter
  if (trendFilter.trendConfirmed) {
    if (trendFilter.trendDirection === 1) { bullScore += 12; reasoning.push('AlgoAlpha: Bullish trend confirmed (Kalman + Supertrend)'); }
    else if (trendFilter.trendDirection === -1) { bearScore += 12; reasoning.push('AlgoAlpha: Bearish trend confirmed'); }
  }
  if (trendFilter.isRanging) { bullScore -= 10; bearScore -= 10; reasoning.push('⚠️ Trend Filter: RANGING — reduced confidence'); }

  // RSI extremes
  if (rsi < 30) { bullScore += 10; reasoning.push(`RSI oversold at ${rsi.toFixed(0)} — reversal zone`); }
  else if (rsi > 70) { bearScore += 10; reasoning.push(`RSI overbought at ${rsi.toFixed(0)} — distribution zone`); }

  // Session bonus
  if (session.isKillZone) { bullScore += 3; bearScore += 3; reasoning.push(`${session.icon} ${session.name} session active — high liquidity`); }

  // Determine signal
  const netScore = bullScore - bearScore;
  const totalConfluence = bullScore + bearScore;
  const confidence = Math.min(98, Math.max(20, 50 + Math.abs(netScore)));

  let signal: SMCSignal['signal'] = 'HOLD';
  if (netScore >= 40) signal = 'STRONG_BUY';
  else if (netScore >= 20) signal = 'BUY';
  else if (netScore <= -40) signal = 'STRONG_SELL';
  else if (netScore <= -20) signal = 'SELL';

  return { signal, confidence, reasoning };
}

// ============================================================================
// MASTER ANALYSIS — Runs everything for ONE asset
// ============================================================================

export function analyzeSMC(position: Position, priceData: PriceData | undefined): SMCAnalysisResult {
  const price = priceData?.price || position.avgPrice;
  const change = priceData?.change || 0;
  const high = priceData?.high || price * 1.01;
  const low = priceData?.low || price * 0.99;
  const rsi = priceData?.rsi || 50;
  const sma20 = priceData?.sma20 || price;
  const sma50 = priceData?.sma50 || price;
  const volume = priceData?.volume || 0;

  // 1. Market Structure
  const structure = calculateMarketStructure(price, high, low, rsi, sma20, sma50, change);

  // 2. BOS / CHoCH
  const { hasBOS, bosType, hasCHoCH, chochType } = detectBOSandCHoCH(price, change, structure);

  // 3. Liquidity Sweeps
  const { bullSweep, bearSweep } = detectLiquiditySweep(high, low, price, structure.lastPH, structure.lastPL);

  // 4. Order Blocks
  const orderBlocks = calculateOrderBlocks(price, high, low, change, structure);

  // 5. FVGs
  const fvgs = detectFVGs(price, high, low, change);

  // 6. HTF Bias
  const htfBias = calculateHTFBias(rsi, sma20, sma50, price, change);

  // 7. Trend Filter
  const trendFilter = calculateTrendFilter(price, high, low, rsi, sma20, sma50, change, volume);

  // 8. Session
  const session = getSessionStatus();

  // 9. Pro Levels
  const levels = calculateProLevels(price, high, low, structure, trendFilter);

  // 10. Signal
  const signal = generateSMCSignal(
    structure, hasBOS, hasCHoCH, bullSweep, bearSweep,
    orderBlocks, fvgs, htfBias, trendFilter, session, rsi, change
  );

  // SMC Score (0-100)
  const confluenceCount = [
    hasBOS, hasCHoCH, bullSweep || bearSweep,
    orderBlocks.length > 0, fvgs.length > 0,
    htfBias !== 'Neutral', trendFilter.trendConfirmed, session.isKillZone
  ].filter(Boolean).length;

  const smcScore = Math.min(100, Math.round(
    signal.confidence * 0.5 +
    confluenceCount * 8 +
    (trendFilter.trendConfirmed ? 10 : 0) +
    (htfBias !== 'Neutral' ? 5 : 0)
  ));

  return {
    symbol: position.symbol.replace('.NS', ''),
    market: position.market,
    price, change,
    structure, hasBOS, bosType, hasCHoCH, chochType,
    bullSweep, bearSweep,
    orderBlocks, fvgs,
    htfBias, trendFilter, session,
    levels, signal,
    smcScore, confluenceCount
  };
}

// ============================================================================
// BATCH ANALYSIS — Runs for ALL portfolio assets
// ============================================================================

export function analyzeAllSMC(
  portfolio: Position[],
  livePrices: Record<string, PriceData>
): SMCAnalysisResult[] {
  return portfolio.map(pos => {
    const key = `${pos.market}_${pos.symbol}`;
    return analyzeSMC(pos, livePrices[key]);
  }).sort((a, b) => b.smcScore - a.smcScore);
}
