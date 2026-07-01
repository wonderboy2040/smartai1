import { Position, PriceData, ScreenerResult } from '../types';
import { getAssetCagrProxy, ALPHA_ETFS_IN, ALPHA_ETFS_US } from './constants';

function calcQualityScore(cagr: number, maxDD: number): number {
  let score = 0;
  if (cagr > 25) score += 40;
  else if (cagr > 20) score += 35;
  else if (cagr > 15) score += 28;
  else if (cagr > 10) score += 18;
  else score += 8;
  if (maxDD < 15) score += 35;
  else if (maxDD < 25) score += 28;
  else if (maxDD < 35) score += 20;
  else if (maxDD < 45) score += 12;
  else score += 5;
  const riskAdj = maxDD > 0 ? cagr / maxDD : cagr / 20;
  if (riskAdj > 1.5) score += 25;
  else if (riskAdj > 1.0) score += 20;
  else if (riskAdj > 0.7) score += 15;
  else if (riskAdj > 0.4) score += 8;
  else score += 3;
  return Math.min(100, score);
}

function calcMomentumScore(rsi: number, sma20: number, sma50: number, change: number, volume: number): number {
  let score = 0;
  if (rsi >= 40 && rsi <= 60) score += 30;
  else if (rsi >= 30 && rsi <= 70) score += 22;
  else if (rsi < 30) score += 15;
  else score += 8;
  if (sma20 > 0 && sma50 > 0) {
    if (sma20 > sma50 * 1.02) score += 35;
    else if (sma20 > sma50) score += 25;
    else if (sma20 > sma50 * 0.98) score += 12;
    else score += 5;
  } else {
    score += 15;
  }
  if (change > 3) score += 35;
  else if (change > 1) score += 28;
  else if (change > 0) score += 20;
  else if (change > -1) score += 12;
  else if (change > -3) score += 6;
  else score += 2;
  if (volume > 1_000_000) score += 8;
  else if (volume > 500_000) score += 4;
  if (rsi < 35 && change > 0) score += 10;
  if (rsi > 65 && change < 0) score -= 5;
  return Math.min(100, Math.max(0, score));
}

function calcValueScore(price: number, sma50: number, cagr: number, rsi: number): number {
  let score = 0;
  const pegProxy = cagr > 0 ? (rsi / cagr) : 2;
  if (pegProxy < 1.0) score += 40;
  else if (pegProxy < 1.5) score += 30;
  else if (pegProxy < 2.0) score += 20;
  else if (pegProxy < 3.0) score += 10;
  else score += 5;
  if (sma50 > 0) {
    const discount = ((sma50 - price) / sma50) * 100;
    if (discount > 10) score += 35;
    else if (discount > 5) score += 28;
    else if (discount > 0) score += 20;
    else if (discount > -5) score += 12;
    else score += 5;
  } else {
    score += 15;
  }
  if (rsi < 35) score += 25;
  else if (rsi < 45) score += 20;
  else if (rsi < 55) score += 14;
  else if (rsi < 65) score += 8;
  else score += 3;
  return Math.min(100, score);
}

function calcRiskScore(momentum: number, drawdown: number, rsi: number): number {
  let risk = 50;
  if (momentum > 80) risk += 10;
  if (rsi > 70) risk += 15;
  if (rsi < 25) risk += 5;
  if (drawdown > 40) risk += 10;
  if (momentum < 30 && drawdown > 30) risk += 15;
  return Math.min(100, Math.max(0, risk));
}

export function runScreener(portfolio: Position[], livePrices: Record<string, PriceData>): ScreenerResult[] {
  const results: ScreenerResult[] = [];
  for (const pos of portfolio) {
    const key = `${pos.market}_${pos.symbol}`;
    const pd = livePrices[key];
    const price = pd?.price || pos.avgPrice;
    const rsi = pd?.rsi || 50;
    const sma20 = pd?.sma20 || price;
    const sma50 = pd?.sma50 || price;
    const change = pd?.change || 0;
    const volume = pd?.volume || 0;
    const cagr = getAssetCagrProxy(pos.symbol, pos.market);
    const maxDD = getEstimatedMaxDD(pos.symbol, pos.market);
    const qualityScore = calcQualityScore(cagr, maxDD);
    const momentumScore = calcMomentumScore(rsi, sma20, sma50, change, volume);
    const valueScore = calcValueScore(price, sma50, cagr, rsi);
    const riskScore = calcRiskScore(momentumScore, maxDD, rsi);
    const alphaScore = Math.min(100, Math.round(qualityScore * 0.35 + momentumScore * 0.30 + valueScore * 0.25 + (100 - riskScore) * 0.10));
    let signal: ScreenerResult['signal'];
    if (alphaScore >= 75) signal = 'STRONG_BUY';
    else if (alphaScore >= 55) signal = 'BUY';
    else if (alphaScore >= 35) signal = 'HOLD';
    else signal = 'AVOID';
    const reasons: string[] = [];
    if (qualityScore > 70) reasons.push('High quality');
    if (momentumScore > 75) reasons.push('Strong momentum');
    if (momentumScore < 30) reasons.push('Weak momentum');
    if (valueScore > 70) reasons.push('Good value');
    if (riskScore > 60) reasons.push('⚠️ High risk');
    if (rsi < 35) reasons.push('Oversold');
    if (rsi > 70) reasons.push('Overbought');
    if (sma20 > sma50) reasons.push('Uptrend');
    else if (sma20 < sma50) reasons.push('Downtrend');
    if (cagr > 20) reasons.push(`${cagr}% CAGR`);
    const etfInfo = [...ALPHA_ETFS_IN, ...ALPHA_ETFS_US].find(e => e.sym === pos.symbol);
    const name = etfInfo?.name || pos.symbol;
    results.push({
      symbol: pos.symbol, market: pos.market, name, price,
      qualityScore, cagr, maxDrawdown: maxDD,
      momentumScore, rsi, sma20, sma50,
      aboveSma50: sma20 > sma50, change, volume,
      valueScore, riskScore,
      pegRatio: cagr > 0 ? +(rsi / cagr).toFixed(2) : 0,
      alphaScore, signal,
      reason: reasons.length > 0 ? reasons.join(', ') : 'Neutral',
    });
  }
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
    const volume = pd?.volume || 0;
    const qualityScore = calcQualityScore(etf.cagr, etf.maxDD);
    const momentumScore = calcMomentumScore(rsi, sma20, sma50, change, volume);
    const valueScore = calcValueScore(price, sma50, etf.cagr, rsi);
    const riskScore = calcRiskScore(momentumScore, etf.maxDD, rsi);
    const alphaScore = Math.min(100, Math.round(qualityScore * 0.35 + momentumScore * 0.30 + valueScore * 0.25 + (100 - riskScore) * 0.10));
    let signal: ScreenerResult['signal'];
    if (alphaScore >= 75) signal = 'STRONG_BUY';
    else if (alphaScore >= 55) signal = 'BUY';
    else if (alphaScore >= 35) signal = 'HOLD';
    else signal = 'AVOID';
    const reasons: string[] = [];
    if (qualityScore > 70) reasons.push('High quality');
    if (momentumScore > 70) reasons.push('Strong momentum');
    if (valueScore > 70) reasons.push('Good value');
    if (riskScore > 60) reasons.push('⚠️ High risk');
    if (rsi < 35) reasons.push('Oversold');
    if (etf.cagr > 20) reasons.push(`${etf.cagr}% CAGR`);
    results.push({
      symbol: etf.sym, market: mkt as 'IN' | 'US', name: etf.name, price,
      qualityScore, cagr: etf.cagr, maxDrawdown: etf.maxDD,
      momentumScore, rsi, sma20, sma50,
      aboveSma50: sma20 > sma50, change, volume,
      valueScore, riskScore,
      pegRatio: etf.cagr > 0 ? +(rsi / etf.cagr).toFixed(2) : 0,
      alphaScore, signal,
      reason: reasons.length > 0 ? reasons.join(', ') : 'Neutral',
    });
  }
  return results.sort((a, b) => b.alphaScore - a.alphaScore);
}

function getEstimatedMaxDD(symbol: string, _market: 'IN' | 'US'): number {
  const etf = [...ALPHA_ETFS_IN, ...ALPHA_ETFS_US].find(e => e.sym === symbol);
  if (etf) return etf.maxDD;
  const cryptoSyms = ['BTC', 'ETH', 'SOL', 'BNB', 'XRP', 'DOGE', 'ADA', 'AVAX', 'DOT'];
  if (cryptoSyms.includes(symbol.toUpperCase())) return 60;
  return 30;
}

export function formatScreenerMessage(results: ScreenerResult[]): string {
  let msg = `<b>📊 SUPER SCREENER v3.0</b>\n━━━━━━━━━━━━━━━━━━━━━━━\n`;
  msg += `<i>Quality (35%) + Momentum (30%) + Value (25%) + Safety (10%)</i>\n\n`;
  const strongBuys = results.filter(r => r.signal === 'STRONG_BUY');
  const buys = results.filter(r => r.signal === 'BUY');
  if (strongBuys.length > 0) {
    msg += `<b>🟢 STRONG BUY (Alpha 75+):</b>\n`;
    strongBuys.forEach(r => {
      msg += `• <b>${r.symbol}</b> — Score: ${r.alphaScore} | Q:${r.qualityScore} M:${r.momentumScore} V:${r.valueScore} R:${r.riskScore}\n`;
      msg += `  ₹${r.price.toFixed(2)} | RSI: ${r.rsi.toFixed(0)} | CAGR: ${r.cagr}%\n`;
      msg += `  ${r.reason}\n\n`;
    });
  }
  if (buys.length > 0) {
    msg += `<b>🔵 BUY (Alpha 55+):</b>\n`;
    buys.slice(0, 5).forEach(r => {
      msg += `• <b>${r.symbol}</b> — Score: ${r.alphaScore} | Q:${r.qualityScore} M:${r.momentumScore}\n`;
      msg += `  ₹${r.price.toFixed(2)} | RSI: ${r.rsi.toFixed(0)}\n\n`;
    });
  }
  const avoids = results.filter(r => r.signal === 'AVOID');
  if (avoids.length > 0) {
    msg += `<b>🔴 AVOID:</b>\n`;
    avoids.forEach(r => { msg += `• ${r.symbol} — Score: ${r.alphaScore} | ${r.reason}\n`; });
  }
  return msg;
}
