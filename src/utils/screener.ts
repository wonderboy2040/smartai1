// ============================================
// MULTI-FACTOR STOCK SCREENER
// Quality + Momentum + Value factors, Alpha Score
// ============================================

import { Position, PriceData, ScreenerResult } from '../types';
import { getAssetCagrProxy, ALPHA_ETFS_IN, ALPHA_ETFS_US } from './constants';

/**
 * Calculate Quality Score (0-100)
 * Based on CAGR proxy, max drawdown, consistency
 */
function calcQualityScore(cagr: number, maxDD: number): number {
  let score = 0;

  // CAGR component (0-40 pts)
  if (cagr > 25) score += 40;
  else if (cagr > 20) score += 35;
  else if (cagr > 15) score += 28;
  else if (cagr > 10) score += 18;
  else score += 8;

  // Max drawdown component (0-35 pts) — lower is better
  if (maxDD < 15) score += 35;
  else if (maxDD < 25) score += 28;
  else if (maxDD < 35) score += 20;
  else if (maxDD < 45) score += 12;
  else score += 5;

  // Risk-adjusted return (0-25 pts)
  const riskAdj = maxDD > 0 ? cagr / maxDD : cagr / 20;
  if (riskAdj > 1.5) score += 25;
  else if (riskAdj > 1.0) score += 20;
  else if (riskAdj > 0.7) score += 15;
  else if (riskAdj > 0.4) score += 8;
  else score += 3;

  return Math.min(100, score);
}

/**
 * Calculate Momentum Score (0-100)
 * Based on RSI, SMA crossover, price change
 */
function calcMomentumScore(rsi: number, sma20: number, sma50: number, change: number): number {
  let score = 0;

  // RSI component (0-30 pts)
  if (rsi >= 40 && rsi <= 60) score += 30;      // Sweet spot
  else if (rsi >= 30 && rsi <= 70) score += 22;  // Healthy range
  else if (rsi < 30) score += 15;                 // Oversold (opportunity)
  else score += 8;                                // Overbought (risk)

  // SMA trend (0-35 pts)
  if (sma20 > 0 && sma50 > 0) {
    if (sma20 > sma50 * 1.02) score += 35;       // Strong uptrend
    else if (sma20 > sma50) score += 25;          // Mild uptrend
    else if (sma20 > sma50 * 0.98) score += 12;   // Neutral
    else score += 5;                               // Downtrend
  } else {
    score += 15; // Default if no SMA data
  }

  // Price change component (0-35 pts)
  if (change > 3) score += 35;
  else if (change > 1) score += 28;
  else if (change > 0) score += 20;
  else if (change > -1) score += 12;
  else if (change > -3) score += 6;
  else score += 2;

  return Math.min(100, score);
}

/**
 * Calculate Value Score (0-100)
 * Based on PEG proxy, price vs SMA (discount)
 */
function calcValueScore(price: number, sma50: number, cagr: number, rsi: number): number {
  let score = 0;

  // PEG proxy (0-40 pts) — CAGR as proxy for earnings growth
  const pegProxy = cagr > 0 ? (rsi / cagr) : 2;
  if (pegProxy < 1.0) score += 40;
  else if (pegProxy < 1.5) score += 30;
  else if (pegProxy < 2.0) score += 20;
  else if (pegProxy < 3.0) score += 10;
  else score += 5;

  // Discount to SMA50 (0-35 pts) — buying below SMA = value
  if (sma50 > 0) {
    const discount = ((sma50 - price) / sma50) * 100;
    if (discount > 10) score += 35;       // Deep discount
    else if (discount > 5) score += 28;   // Good discount
    else if (discount > 0) score += 20;   // Mild discount
    else if (discount > -5) score += 12;  // Fair value
    else score += 5;                       // Premium
  } else {
    score += 15;
  }

  // RSI value zone (0-25 pts)
  if (rsi < 35) score += 25;       // Deep value (oversold)
  else if (rsi < 45) score += 20;  // Good value
  else if (rsi < 55) score += 14;  // Fair value
  else if (rsi < 65) score += 8;   // Getting expensive
  else score += 3;                  // Expensive

  return Math.min(100, score);
}

/**
 * Run multi-factor screener on all available assets
 */
export function runScreener(
  portfolio: Position[],
  livePrices: Record<string, PriceData>
): ScreenerResult[] {
  const results: ScreenerResult[] = [];

  // Screen portfolio assets
  for (const pos of portfolio) {
    const key = `${pos.market}_${pos.symbol}`;
    const pd = livePrices[key];
    const price = pd?.price || pos.avgPrice;
    const rsi = pd?.rsi || 50;
    const sma20 = pd?.sma20 || price;
    const sma50 = pd?.sma50 || price;
    const change = pd?.change || 0;

    const cagr = getAssetCagrProxy(pos.symbol, pos.market);
    const maxDD = getEstimatedMaxDD(pos.symbol, pos.market);

    const qualityScore = calcQualityScore(cagr, maxDD);
    const momentumScore = calcMomentumScore(rsi, sma20, sma50, change);
    const valueScore = calcValueScore(price, sma50, cagr, rsi);

    // Alpha Score: weighted composite (40% quality + 30% momentum + 30% value)
    const alphaScore = Math.round(qualityScore * 0.4 + momentumScore * 0.3 + valueScore * 0.3);

    // Signal from alpha score
    let signal: ScreenerResult['signal'];
    if (alphaScore >= 75) signal = 'STRONG_BUY';
    else if (alphaScore >= 55) signal = 'BUY';
    else if (alphaScore >= 35) signal = 'HOLD';
    else signal = 'AVOID';

    // Reason
    const reasons: string[] = [];
    if (qualityScore > 70) reasons.push('High quality');
    if (momentumScore > 70) reasons.push('Strong momentum');
    if (valueScore > 70) reasons.push('Good value');
    if (rsi < 35) reasons.push('Oversold zone');
    if (sma20 > sma50) reasons.push('Uptrend');
    if (cagr > 20) reasons.push(`${cagr}% CAGR`);

    // Get ETF name
    const etfInfo = [...ALPHA_ETFS_IN, ...ALPHA_ETFS_US].find(e => e.sym === pos.symbol);
    const name = etfInfo?.name || pos.symbol;

    results.push({
      symbol: pos.symbol,
      market: pos.market,
      name,
      price,
      qualityScore,
      cagr,
      maxDrawdown: maxDD,
      momentumScore,
      rsi,
      sma20,
      sma50,
      aboveSma200: sma20 > sma50, // Approximation
      change,
      valueScore,
      pegRatio: cagr > 0 ? +(rsi / cagr).toFixed(2) : 0,
      alphaScore,
      signal,
      reason: reasons.length > 0 ? reasons.join(', ') : 'Neutral factors'
    });
  }

  // Also screen top ETFs not in portfolio
  const portfolioSymbols = new Set(portfolio.map(p => p.symbol));
  const allETFs = [...ALPHA_ETFS_IN, ...ALPHA_ETFS_US];

  for (const etf of allETFs) {
    if (portfolioSymbols.has(etf.sym)) continue;

    const mkt = ALPHA_ETFS_IN.includes(etf) ? 'IN' : 'US';
    const key = `${mkt}_${etf.sym}`;
    const pd = livePrices[key];
    const price = pd?.price || 0;
    if (price === 0) continue;

    const rsi = pd?.rsi || 50;
    const sma20 = pd?.sma20 || price;
    const sma50 = pd?.sma50 || price;
    const change = pd?.change || 0;

    const qualityScore = calcQualityScore(etf.cagr, etf.maxDD);
    const momentumScore = calcMomentumScore(rsi, sma20, sma50, change);
    const valueScore = calcValueScore(price, sma50, etf.cagr, rsi);
    const alphaScore = Math.round(qualityScore * 0.4 + momentumScore * 0.3 + valueScore * 0.3);

    let signal: ScreenerResult['signal'];
    if (alphaScore >= 75) signal = 'STRONG_BUY';
    else if (alphaScore >= 55) signal = 'BUY';
    else if (alphaScore >= 35) signal = 'HOLD';
    else signal = 'AVOID';

    const reasons: string[] = [];
    if (qualityScore > 70) reasons.push('High quality');
    if (momentumScore > 70) reasons.push('Strong momentum');
    if (valueScore > 70) reasons.push('Good value');
    if (rsi < 35) reasons.push('Oversold');
    if (etf.cagr > 20) reasons.push(`${etf.cagr}% CAGR`);

    results.push({
      symbol: etf.sym,
      market: mkt as 'IN' | 'US',
      name: etf.name,
      price,
      qualityScore,
      cagr: etf.cagr,
      maxDrawdown: etf.maxDD,
      momentumScore,
      rsi,
      sma20,
      sma50,
      aboveSma200: sma20 > sma50,
      change,
      valueScore,
      pegRatio: etf.cagr > 0 ? +(rsi / etf.cagr).toFixed(2) : 0,
      alphaScore,
      signal,
      reason: reasons.length > 0 ? reasons.join(', ') : 'Neutral'
    });
  }

  return results.sort((a, b) => b.alphaScore - a.alphaScore);
}

/**
 * Get estimated max drawdown for an asset
 */
function getEstimatedMaxDD(symbol: string, _market: 'IN' | 'US'): number {
  const etf = [...ALPHA_ETFS_IN, ...ALPHA_ETFS_US].find(e => e.sym === symbol);
  if (etf) return etf.maxDD;

  // Crypto has higher drawdowns
  const cryptoSyms = ['BTC', 'ETH', 'SOL', 'BNB', 'XRP', 'DOGE', 'ADA', 'AVAX', 'DOT'];
  if (cryptoSyms.includes(symbol.toUpperCase())) return 60;

  // Default
  return 30;
}

/**
 * Format screener results for Telegram
 */
export function formatScreenerMessage(results: ScreenerResult[]): string {
  let msg = `<b>📊 MULTI-FACTOR SCREENER</b>\n━━━━━━━━━━━━━━━━━━━━━━━\n`;
  msg += `<i>Quality (40%) + Momentum (30%) + Value (30%)</i>\n\n`;

  // Top picks
  const strongBuys = results.filter(r => r.signal === 'STRONG_BUY');
  const buys = results.filter(r => r.signal === 'BUY');

  if (strongBuys.length > 0) {
    msg += `<b>🟢 STRONG BUY (Alpha 75+):</b>\n`;
    strongBuys.forEach(r => {
      msg += `• <b>${r.symbol}</b> — Score: ${r.alphaScore} | Q:${r.qualityScore} M:${r.momentumScore} V:${r.valueScore}\n`;
      msg += `  ₹${r.price.toFixed(2)} | RSI: ${r.rsi.toFixed(0)} | CAGR: ${r.cagr}%\n`;
      msg += `  ${r.reason}\n\n`;
    });
  }

  if (buys.length > 0) {
    msg += `<b>🔵 BUY (Alpha 55+):</b>\n`;
    buys.slice(0, 5).forEach(r => {
      msg += `• <b>${r.symbol}</b> — Score: ${r.alphaScore} | Q:${r.qualityScore} M:${r.momentumScore} V:${r.valueScore}\n`;
      msg += `  ₹${r.price.toFixed(2)} | RSI: ${r.rsi.toFixed(0)}\n\n`;
    });
  }

  // Avoids
  const avoids = results.filter(r => r.signal === 'AVOID');
  if (avoids.length > 0) {
    msg += `<b>🔴 AVOID:</b>\n`;
    avoids.forEach(r => {
      msg += `• ${r.symbol} — Score: ${r.alphaScore} | ${r.reason}\n`;
    });
  }

  return msg;
}
