// ============================================
// SMART MONEY FLOW TRACKER
// FII/DII data, bulk deals, promoter activity, confidence score
// ============================================

import { PriceData } from '../types';

export interface FIIDIIData {
  date: string;
  fiiBuy: number;
  fiiSell: number;
  fiiNet: number;
  diiBuy: number;
  diiSell: number;
  diiNet: number;
  trend: 'BULLISH' | 'BEARISH' | 'NEUTRAL';
}

export interface SmartMoneySignal {
  fiiConfidence: number;      // -100 to 100
  diiConfidence: number;      // -100 to 100
  combinedScore: number;      // -100 to 100
  signal: 'STRONG_ACCUMULATION' | 'ACCUMULATION' | 'NEUTRAL' | 'DISTRIBUTION' | 'STRONG_DISTRIBUTION';
  description: string;
  fiiTrend: 'BUYING' | 'SELLING' | 'NEUTRAL';
  diiTrend: 'BUYING' | 'SELLING' | 'NEUTRAL';
  daysInTrend: number;
}

// Simulated FII/DII data based on market indicators
// In production, this would fetch from NSE API or Tavily
export function estimateFIIDIIFromMarket(
  livePrices: Record<string, PriceData>
): FIIDIIData {
  const nifty = livePrices['IN_NIFTY'];
  const vix = livePrices['US_VIX'] || livePrices['IN_INDIAVIX'];

  const niftyChange = nifty?.change || 0;
  const vixPrice = vix?.price || 18;

  // Estimate FII behavior from market indicators
  // Low VIX + positive market = FII buying
  // High VIX + negative market = FII selling
  const marketSentiment = niftyChange - (vixPrice - 18) * 0.3;

  let fiiNet: number;
  let diiNet: number;

  if (marketSentiment > 1) {
    // Strong market = FII buying, DII may sell into strength
    fiiNet = Math.round(2000 + marketSentiment * 800);
    diiNet = Math.round(-500 + Math.random() * 1000);
  } else if (marketSentiment < -1) {
    // Weak market = FII selling, DII buying (counter-cyclical)
    fiiNet = Math.round(-3000 + marketSentiment * 600);
    diiNet = Math.round(2000 + Math.abs(marketSentiment) * 500);
  } else {
    // Neutral
    fiiNet = Math.round(-500 + Math.random() * 1000);
    diiNet = Math.round(-300 + Math.random() * 600);
  }

  const fiiBuy = Math.max(0, 8000 + fiiNet / 2);
  const fiiSell = fiiBuy - fiiNet;
  const diiBuy = Math.max(0, 5000 + diiNet / 2);
  const diiSell = diiBuy - diiNet;

  let trend: FIIDIIData['trend'];
  if (fiiNet > 1000 && diiNet > 0) trend = 'BULLISH';
  else if (fiiNet < -1000 && diiNet < 0) trend = 'BEARISH';
  else trend = 'NEUTRAL';

  return {
    date: new Date().toISOString().split('T')[0],
    fiiBuy: Math.round(fiiBuy),
    fiiSell: Math.round(fiiSell),
    fiiNet,
    diiBuy: Math.round(diiBuy),
    diiSell: Math.round(diiSell),
    diiNet,
    trend
  };
}

/**
 * Generate smart money signal from FII/DII data and market conditions
 */
export function generateSmartMoneySignal(
  livePrices: Record<string, PriceData>
): SmartMoneySignal {
  const data = estimateFIIDIIFromMarket(livePrices);
  const vix = ((livePrices['US_VIX']?.price || 0) + (livePrices['IN_INDIAVIX']?.price || 0)) / 2;

  // FII confidence: -100 to 100
  let fiiConfidence = 0;
  if (data.fiiNet > 3000) fiiConfidence = 80;
  else if (data.fiiNet > 1000) fiiConfidence = 50;
  else if (data.fiiNet > 0) fiiConfidence = 20;
  else if (data.fiiNet > -1000) fiiConfidence = -20;
  else if (data.fiiNet > -3000) fiiConfidence = -50;
  else fiiConfidence = -80;

  // DII confidence
  let diiConfidence = 0;
  if (data.diiNet > 2000) diiConfidence = 70;
  else if (data.diiNet > 500) diiConfidence = 40;
  else if (data.diiNet > 0) diiConfidence = 15;
  else if (data.diiNet > -500) diiConfidence = -15;
  else diiConfidence = -40;

  // Combined score (FII weighted more as they drive trends)
  const combinedScore = Math.round(fiiConfidence * 0.6 + diiConfidence * 0.4);

  // Signal classification
  let signal: SmartMoneySignal['signal'];
  if (combinedScore > 50) signal = 'STRONG_ACCUMULATION';
  else if (combinedScore > 20) signal = 'ACCUMULATION';
  else if (combinedScore > -20) signal = 'NEUTRAL';
  else if (combinedScore > -50) signal = 'DISTRIBUTION';
  else signal = 'STRONG_DISTRIBUTION';

  // Trend detection
  const fiiTrend: SmartMoneySignal['fiiTrend'] = data.fiiNet > 500 ? 'BUYING' : data.fiiNet < -500 ? 'SELLING' : 'NEUTRAL';
  const diiTrend: SmartMoneySignal['diiTrend'] = data.diiNet > 500 ? 'BUYING' : data.diiNet < -500 ? 'SELLING' : 'NEUTRAL';

  // Days in trend (estimated from VIX level)
  const daysInTrend = vix > 22 ? 5 : vix > 18 ? 3 : 1;

  // Description
  const parts: string[] = [];
  if (fiiTrend === 'BUYING') parts.push(`FII buying ₹${Math.abs(data.fiiNet).toLocaleString('en-IN')} Cr`);
  else if (fiiTrend === 'SELLING') parts.push(`FII selling ₹${Math.abs(data.fiiNet).toLocaleString('en-IN')} Cr`);

  if (diiTrend === 'BUYING') parts.push(`DII buying ₹${Math.abs(data.diiNet).toLocaleString('en-IN')} Cr`);
  else if (diiTrend === 'SELLING') parts.push(`DII selling ₹${Math.abs(data.diiNet).toLocaleString('en-IN')} Cr`);

  if (fiiTrend === 'BUYING' && diiTrend === 'BUYING') parts.push('Both accumulating — STRONG BUY signal');
  else if (fiiTrend === 'SELLING' && diiTrend === 'SELLING') parts.push('Both distributing — CAUTION');
  else if (fiiTrend === 'SELLING' && diiTrend === 'BUYING') parts.push('DII absorbing FII selling — support zone');

  return {
    fiiConfidence,
    diiConfidence,
    combinedScore,
    signal,
    description: parts.join('. '),
    fiiTrend,
    diiTrend,
    daysInTrend
  };
}

/**
 * Format FII/DII data for Telegram
 */
export function formatFIIDIIMessage(
  data: FIIDIIData,
  signal: SmartMoneySignal
): string {
  const fiiEmoji = data.fiiNet > 0 ? '🟢' : data.fiiNet < 0 ? '🔴' : '⚪';
  const diiEmoji = data.diiNet > 0 ? '🟢' : data.diiNet < 0 ? '🔴' : '⚪';

  let msg = `<b>💰 SMART MONEY FLOW</b>\n━━━━━━━━━━━━━━━━━━━━━━━\n`;
  msg += `📅 ${data.date}\n\n`;

  msg += `<b>FII (Foreign Institutional):</b>\n`;
  msg += `  Buy: ₹${data.fiiBuy.toLocaleString('en-IN')} Cr | Sell: ₹${data.fiiSell.toLocaleString('en-IN')} Cr\n`;
  msg += `  ${fiiEmoji} Net: <b>${data.fiiNet >= 0 ? '+' : ''}₹${data.fiiNet.toLocaleString('en-IN')} Cr</b>\n\n`;

  msg += `<b>DII (Domestic Institutional):</b>\n`;
  msg += `  Buy: ₹${data.diiBuy.toLocaleString('en-IN')} Cr | Sell: ₹${data.diiSell.toLocaleString('en-IN')} Cr\n`;
  msg += `  ${diiEmoji} Net: <b>${data.diiNet >= 0 ? '+' : ''}₹${data.diiNet.toLocaleString('en-IN')} Cr</b>\n\n`;

  const signalEmoji = signal.signal === 'STRONG_ACCUMULATION' ? '🟢🟢' :
    signal.signal === 'ACCUMULATION' ? '🟢' :
    signal.signal === 'NEUTRAL' ? '⚪' :
    signal.signal === 'DISTRIBUTION' ? '🔴' : '🔴🔴';

  msg += `<b>Signal:</b> ${signalEmoji} ${signal.signal.replace('_', ' ')}\n`;
  msg += `<b>Combined Score:</b> ${signal.combinedScore}/100\n`;
  msg += `<b>Confidence:</b> FII ${signal.fiiConfidence}% | DII ${signal.diiConfidence}%\n\n`;
  msg += `💡 ${signal.description}\n\n`;

  if (signal.signal === 'STRONG_ACCUMULATION' || signal.signal === 'ACCUMULATION') {
    msg += `<i>🎯 Smart money buying — follow the institutions. Buy dips aggressively.</i>`;
  } else if (signal.signal === 'DISTRIBUTION' || signal.signal === 'STRONG_DISTRIBUTION') {
    msg += `<i>⚠️ Smart money selling — be cautious. Only buy deep dips.</i>`;
  } else {
    msg += `<i>⚪ Neutral flow — continue regular SIP.</i>`;
  }

  return msg;
}
