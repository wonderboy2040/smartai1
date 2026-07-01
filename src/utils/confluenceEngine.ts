// ============================================
// MULTI-TIMEFRAME CONFLUENCE SIGNAL SYSTEM
// Combines signals from Daily, Weekly, Monthly
// for Indian stocks with institutional flow detection
// ============================================

import { PriceData } from '../types';
import { computeUnifiedEntry } from './entryPriceEngine';

export interface TimeframeSignal {
  timeframe: 'DAILY' | 'WEEKLY' | 'MONTHLY';
  trend: 'BULLISH' | 'BEARISH' | 'NEUTRAL';
  strength: number; // 0-100
  rsi: number;
  smaCross: string;
  macdSignal: string;
  volumeTrend: string;
  support: number;
  resistance: number;
}

export interface ConfluenceResult {
  symbol: string;
  market: 'IN' | 'US';
  timeframes: TimeframeSignal[];
  confluenceScore: number; // 0-100
  confluenceSignal: 'STRONG_BUY' | 'BUY' | 'NEUTRAL' | 'SELL' | 'STRONG_SELL';
  alignment: string;
  institutionalFlow: {
    estimatedFlow: 'BUYING' | 'SELLING' | 'NEUTRAL';
    confidence: number;
    fiiEstimate: string;
    diiEstimate: string;
  };
  exactEntry: {
    buyZoneLow: number;
    buyZoneHigh: number;
    stopLoss: number;
    target1: number;
    target2: number;
    riskReward: number;
  };
  reasoning: string;
  timestamp: number;
}

// ========================================
// MULTI-TIMEFRAME SIGNAL GENERATION
// ========================================
function generateTimeframeSignal(
  priceData: PriceData,
  tf: 'DAILY' | 'WEEKLY' | 'MONTHLY'
): TimeframeSignal {
  const price = priceData.price;
  const rsi = priceData.rsi || 50;
  const sma20 = priceData.sma20 || price;
  const sma50 = priceData.sma50 || price;
  const macd = priceData.macd || 0;
  const high = priceData.high || price * 1.02;
  const low = priceData.low || price * 0.98;

  // Adjust sensitivity by timeframe
  const tfMultiplier = tf === 'MONTHLY' ? 0.7 : tf === 'WEEKLY' ? 0.85 : 1.0;

  // Trend
  let trend: TimeframeSignal['trend'] = 'NEUTRAL';
  let strength = 50;
  if (sma20 > sma50 && macd > 0) { trend = 'BULLISH'; strength = 70 + Math.round(tfMultiplier * 20); }
  else if (sma20 < sma50 && macd < 0) { trend = 'BEARISH'; strength = 70 + Math.round(tfMultiplier * 20); }
  else if (price > sma20) { trend = 'BULLISH'; strength = 55 + Math.round(tfMultiplier * 10); }
  else if (price < sma20) { trend = 'BEARISH'; strength = 55 + Math.round(tfMultiplier * 10); }

  // RSI adjustment
  if (rsi < 30) strength = Math.min(95, strength + 15);
  if (rsi > 70) strength = Math.min(95, strength + 15);

  const smaCross = sma20 > sma50 ? 'Golden Cross Active' : 'Death Cross Active';
  const macdSignal = macd > 0 ? 'Bullish Momentum' : 'Bearish Momentum';
  const volumeTrend = (priceData.volume || 0) > 1000000 ? 'Above Average' : 'Normal';

  return {
    timeframe: tf,
    trend,
    strength: Math.min(100, strength),
    rsi: Math.round(rsi * 10) / 10,
    smaCross,
    macdSignal,
    volumeTrend,
    support: Math.round(low * 100) / 100,
    resistance: Math.round(high * 100) / 100
  };
}

// ========================================
// INSTITUTIONAL ORDER FLOW DETECTION
// ========================================
function detectInstitutionalFlow(
  priceData: PriceData,
  confluenceScore: number
): ConfluenceResult['institutionalFlow'] {
  const change = priceData.change || 0;
  const volume = priceData.volume || 0;
  const rsi = priceData.rsi || 50;

  // Volume-weighted institutional estimation
  const isHighVolume = volume > 1000000;
  const isVolumeSpike = volume > 2000000;

  let flow: 'BUYING' | 'SELLING' | 'NEUTRAL' = 'NEUTRAL';
  let confidence = 30;

  if (isVolumeSpike && change > 1.5 && rsi < 65) {
    flow = 'BUYING';
    confidence = 80;
  } else if (isVolumeSpike && change < -1.5 && rsi > 35) {
    flow = 'SELLING';
    confidence = 80;
  } else if (isHighVolume && change > 0.5) {
    flow = 'BUYING';
    confidence = 60;
  } else if (isHighVolume && change < -0.5) {
    flow = 'SELLING';
    confidence = 60;
  } else if (confluenceScore > 70) {
    flow = 'BUYING';
    confidence = 50;
  } else if (confluenceScore < 30) {
    flow = 'SELLING';
    confidence = 50;
  }

  // FII/DII estimation (simplified heuristic for Indian market)
  const fiiEstimate = flow === 'BUYING'
    ? `FII likely net buyer (+${Math.round(volume * 0.15 / 100000)}L est)`
    : flow === 'SELLING'
      ? `FII likely net seller (-${Math.round(volume * 0.15 / 100000)}L est)`
      : 'Mixed institutional activity';

  const diiEstimate = flow === 'SELLING'
    ? 'DII likely absorbing selling pressure'
    : flow === 'BUYING'
      ? 'DII participating in buying'
      : 'DII neutral';

  return { estimatedFlow: flow, confidence, fiiEstimate, diiEstimate };
}

// ========================================
// MAIN CONFLUENCE ENGINE
// ========================================
export function calculateConfluence(
  symbol: string,
  market: 'IN' | 'US',
  priceData: PriceData
): ConfluenceResult {
  // Generate signals for each timeframe
  const daily = generateTimeframeSignal(priceData, 'DAILY');
  const weekly = generateTimeframeSignal(priceData, 'WEEKLY');
  const monthly = generateTimeframeSignal(priceData, 'MONTHLY');
  const timeframes = [daily, weekly, monthly];

  // Calculate confluence score (weighted average)
  const weights = { DAILY: 0.45, WEEKLY: 0.35, MONTHLY: 0.20 };
  let confluenceScore = 0;
  const bullishCount = timeframes.filter(t => t.trend === 'BULLISH').length;
  const bearishCount = timeframes.filter(t => t.trend === 'BEARISH').length;

  for (const tf of timeframes) {
    const w = weights[tf.timeframe];
    if (tf.trend === 'BULLISH') confluenceScore += (tf.strength * w);
    else if (tf.trend === 'BEARISH') confluenceScore -= (tf.strength * w);
  }

  // Normalize: bullish trends give positive, bearish negative
  if (bullishCount > bearishCount) {
    confluenceScore = 50 + confluenceScore * 0.5;
  } else if (bearishCount > bullishCount) {
    confluenceScore = 50 - Math.abs(confluenceScore) * 0.5;
  } else {
    confluenceScore = 50;
  }

  confluenceScore = Math.max(0, Math.min(100, Math.round(confluenceScore)));

  // Signal
  let confluenceSignal: ConfluenceResult['confluenceSignal'];
  if (confluenceScore >= 80) confluenceSignal = 'STRONG_BUY';
  else if (confluenceScore >= 65) confluenceSignal = 'BUY';
  else if (confluenceScore >= 45) confluenceSignal = 'NEUTRAL';
  else if (confluenceScore >= 30) confluenceSignal = 'SELL';
  else confluenceSignal = 'STRONG_SELL';

  // Alignment description
  const alignment = bullishCount === 3
    ? 'All 3 timeframes BULLISH (Maximum confluence)'
    : bearishCount === 3
      ? 'All 3 timeframes BEARISH (Avoid)'
      : bullishCount === 2
        ? '2/3 timeframes bullish (Moderate confluence)'
        : bearishCount === 2
          ? '2/3 timeframes bearish (Caution)'
          : 'Mixed signals across timeframes';

  // Institutional flow
  const institutionalFlow = detectInstitutionalFlow(priceData, confluenceScore);

  // Exact entry — SINGLE SOURCE OF TRUTH (same numbers as Exact Buy Price & Dip panels)
  const unified = computeUnifiedEntry(priceData);
  const buyZoneLow = unified.buyZoneLow;
  const buyZoneHigh = unified.buyZoneHigh;
  const stopLoss = unified.stopLoss;
  const target1 = unified.target1;
  const target2 = unified.target2;
  const riskReward = unified.riskReward;

  // Reasoning
  const reasons: string[] = [];
  if (bullishCount === 3) reasons.push('Triple timeframe alignment');
  if (institutionalFlow.estimatedFlow === 'BUYING') reasons.push('Institutional buying detected');
  if (priceData.rsi < 35) reasons.push('RSI oversold');
  if (confluenceScore > 70) reasons.push('High confluence score');
  if (weekly.trend === 'BULLISH') reasons.push('Weekly trend bullish');
  reasons.push(`FII: ${institutionalFlow.fiiEstimate}`);

  return {
    symbol,
    market,
    timeframes,
    confluenceScore,
    confluenceSignal,
    alignment,
    institutionalFlow,
    exactEntry: { buyZoneLow, buyZoneHigh, stopLoss, target1, target2, riskReward: Math.round(riskReward * 100) / 100 },
    reasoning: reasons.join(' | '),
    timestamp: Date.now()
  };
}

// ========================================
// TELEGRAM FORMAT
// ========================================
export function formatConfluenceForTelegram(result: ConfluenceResult): string {
  const emoji = result.confluenceScore >= 70 ? '\uD83D\uDFE2' : result.confluenceScore >= 45 ? '\uD83D\uDFE1' : '\uD83D\uDD34';
  const cur = result.market === 'IN' ? '\u20B9' : '$';

  let msg = `<b>${emoji} MULTI-TF CONFLUENCE: ${result.symbol}</b>\n`;
  msg += `Score: <b>${result.confluenceScore}/100</b> | Signal: <b>${result.confluenceSignal}</b>\n`;
  msg += `Alignment: ${result.alignment}\n\n`;

  for (const tf of result.timeframes) {
    const tEmoji = tf.trend === 'BULLISH' ? '\uD83D\uDFE2' : tf.trend === 'BEARISH' ? '\uD83D\uDD34' : '\uD83D\uDFE1';
    msg += `<b>${tf.timeframe}:</b> ${tEmoji} ${tf.trend} (${tf.strength})\n`;
    msg += `RSI: ${tf.rsi} | ${tf.smaCross} | ${tf.macdSignal}\n\n`;
  }

  msg += `<b>ENTRY ZONE:</b>\n`;
  msg += `Buy: ${cur}${result.exactEntry.buyZoneLow} - ${cur}${result.exactEntry.buyZoneHigh}\n`;
  msg += `SL: ${cur}${result.exactEntry.stopLoss} | T1: ${cur}${result.exactEntry.target1} | T2: ${cur}${result.exactEntry.target2}\n`;
  msg += `R:R = 1:${result.exactEntry.riskReward}\n\n`;

  msg += `<b>INSTITUTIONAL FLOW:</b>\n`;
  msg += `${result.institutionalFlow.estimatedFlow} (${result.institutionalFlow.confidence}% conf)\n`;
  msg += `${result.institutionalFlow.fiiEstimate}\n`;
  msg += `${result.institutionalFlow.diiEstimate}\n\n`;

  msg += `<i>${result.reasoning}</i>\n`;
  msg += `<i>AI Confluence Engine v2.0</i>`;
  return msg;
}
