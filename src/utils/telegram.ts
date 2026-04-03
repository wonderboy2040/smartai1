import { Position, PriceData } from '../types';
import { ALPHA_ETFS_IN, ALPHA_ETFS_US, getAssetCagrProxy } from './constants';

// ========================================
// MARKET HOURS CHECK
// ========================================
export function isIndiaMarketOpen(): boolean {
  const now = new Date();
  const ist = new Date(now.toLocaleString('en-US', { timeZone: 'Asia/Kolkata' }));
  const day = ist.getDay();
  if (day === 0 || day === 6) return false; // Weekend
  const h = ist.getHours(), m = ist.getMinutes();
  const mins = h * 60 + m;
  return mins >= 555 && mins <= 930; // 9:15 AM - 3:30 PM IST
}

export function isUSMarketOpen(): boolean {
  const now = new Date();
  const est = new Date(now.toLocaleString('en-US', { timeZone: 'America/New_York' }));
  const day = est.getDay();
  if (day === 0 || day === 6) return false;
  const h = est.getHours(), m = est.getMinutes();
  const mins = h * 60 + m;
  return mins >= 570 && mins <= 960; // 9:30 AM - 4:00 PM ET
}

export function isAnyMarketOpen(): boolean {
  return isIndiaMarketOpen() || isUSMarketOpen();
}

export function getMarketStatus(): string {
  const inOpen = isIndiaMarketOpen();
  const usOpen = isUSMarketOpen();
  if (inOpen && usOpen) return '🇮🇳 IN + 🇺🇸 US Markets LIVE';
  if (inOpen) return '🇮🇳 India Market LIVE';
  if (usOpen) return '🇺🇸 US Market LIVE';
  return '💤 Markets Closed';
}

// ========================================
// SIGNAL DETECTION
// ========================================
export interface AssetSignal {
  symbol: string;
  market: string;
  signal: 'STRONG_BUY' | 'BUY' | 'HOLD' | 'SELL' | 'STRONG_SELL';
  action: 'BUY' | 'SELL' | 'HOLD';
  trend: 'up' | 'down' | 'flat';
  rsi: number;
  change: number;
  price: number;
  targetPrice: number;
  fibLow: number;
  fibHigh: number;
  confidence: number;
  reason: string;
  allocPct?: number;
  allocAmount?: number;
}

export function analyzeAsset(
  position: Position,
  priceData: PriceData | undefined
): AssetSignal {
  const price = priceData?.price || position.avgPrice;
  const rsi = priceData?.rsi || 50;
  const change = priceData?.change || 0;
  const cagr = getAssetCagrProxy(position.symbol, position.market);

  // Advanced Technicals
  const sma20 = priceData?.sma20;
  const sma50 = priceData?.sma50;
  const macd = priceData?.macd;
  
  // Trend Determination via SMA Crossover & MACD
  let isBullishTrend = change > 0.5;
  let isBearishTrend = change < -0.5;
  
  if (sma20 && sma50) {
    // Golden Cross / Death Cross proximity
    isBullishTrend = sma20 > sma50 || (macd !== undefined && macd > 0);
    isBearishTrend = sma50 > sma20 || (macd !== undefined && macd < 0);
  }

  // Calculate support/target levels
  const low = priceData?.low || price * 0.98;
  const high = priceData?.high || price * 1.02;
  const dayRange = high - low;
  const supportLevel = low - dayRange * 0.382; // Fibonacci
  const resistanceLevel = high + dayRange * 0.382;

  let signal: AssetSignal['signal'] = 'HOLD';
  let confidence = 60;
  let reason = 'Neutral range, maintain position';
  let targetPrice = price;

  if (rsi < 30) {
    signal = 'STRONG_BUY';
    confidence = 95;
    targetPrice = supportLevel;
    reason = `RSI ${rsi.toFixed(0)} oversold — institutional accumulation zone.`;
  } else if (rsi < 40) {
    signal = 'BUY';
    confidence = 80;
    targetPrice = low;
    reason = `RSI ${rsi.toFixed(0)} approaching oversold — good entry.`;
    if (isBullishTrend) {
      reason += ' Bullish momentum building.';
      confidence += 5;
    }
  } else if (rsi > 75) {
    signal = 'STRONG_SELL';
    confidence = 90;
    targetPrice = resistanceLevel;
    reason = `RSI ${rsi.toFixed(0)} overbought — distribution zone.`;
  } else if (rsi > 65) {
    signal = 'SELL';
    confidence = 70;
    targetPrice = high;
    reason = `RSI ${rsi.toFixed(0)} elevated — consider partial booking.`;
    if (isBearishTrend) {
      reason += ' Bearish momentum detected.';
      confidence += 5;
    }
  } else {
    // SMA & MACD purely trend-following entries in neutral RSI
    if (isBullishTrend && rsi < 55) {
      signal = 'BUY';
      confidence = 75;
      targetPrice = sma20 || price * 0.98;
      reason = `Golden Cross / Bullish MACD detected. Accumulate on dips.`;
    } else if (isBearishTrend && rsi > 55) {
      signal = 'SELL';
      confidence = 65;
      targetPrice = sma20 || price * 1.02;
      reason = `Death Cross / Bearish MACD momentum. Book partials.`;
    } else if (change < -3) {
      signal = 'BUY';
      confidence = 75;
      targetPrice = price * 0.98;
      reason = `Sharp dip ${change.toFixed(1)}% — potential reversal.`;
    } else if (change > 3) {
      signal = 'SELL';
      confidence = 65;
      targetPrice = price * 1.02;
      reason = `Strong rally ${change.toFixed(1)}% — book partial profits.`;
    }
  }

  // CAGR boost for high-growth assets
  if (cagr > 20 && signal === 'BUY') confidence = Math.min(99, confidence + 10);

  // Derive simplified action & trend
  const action: AssetSignal['action'] = (signal === 'STRONG_BUY' || signal === 'BUY') ? 'BUY' : (signal === 'STRONG_SELL' || signal === 'SELL') ? 'SELL' : 'HOLD';
  const trend: AssetSignal['trend'] = isBullishTrend ? 'up' : isBearishTrend ? 'down' : 'flat';

  return {
    symbol: position.symbol.replace('.NS', ''),
    market: position.market,
    signal,
    action,
    trend,
    rsi,
    change,
    price,
    targetPrice,
    fibLow: supportLevel,
    fibHigh: resistanceLevel,
    confidence,
    reason
  };
}

// ========================================
// SMART ALLOCATION RECOMMENDATIONS
// ========================================
export interface AllocationRec {
  symbol: string;
  name: string;
  market: 'IN' | 'US';
  currentPrice: number;
  targetEntry: number;
  discount: number;
  signal: string;
  allocPct: number;
  allocAmount: number;
  rsi: number;
  strength: number;
  stopLoss: number;
  takeProfit: number;
  riskReward: number;
  trendStrength: 'STRONG' | 'MODERATE' | 'WEAK' | 'REVERSAL';
  volumeSignal: string;
  reason: string;
}

export function getSmartAllocations(
  livePrices: Record<string, PriceData>,
  indiaSIP: number = 10000,
  usSIP: number = 200
): AllocationRec[] {
  const recs: AllocationRec[] = [];

  // Global VIX for risk adjustment
  const usVix = livePrices['US_VIX']?.price || 15;
  const inVix = livePrices['IN_INDIAVIX']?.price || 15;
  const avgVix = (usVix + inVix) / 2;

  const processETF = (etf: typeof ALPHA_ETFS_IN[0], market: 'IN' | 'US') => {
    const key = `${market}_${etf.sym}`;
    const altKey = `${market}_${etf.sym}.NS`;
    const data = livePrices[key] || livePrices[altKey];
    const price = data?.price || 0;
    const rsi = data?.rsi || 50;
    const low = data?.low || price * 0.98;
    const high = data?.high || price * 1.02;
    const volume = data?.volume || 0;
    const sma20 = data?.sma20;
    const sma50 = data?.sma50;
    const macd = data?.macd;
    const isBull = sma20 && sma50 ? sma20 > sma50 : false;
    const hasMACDMomentum = macd !== undefined ? macd > 0 : false;

    // === STRENGTH SCORE (0-100) ===
    let strength = 50;
    // RSI contribution (0-30 points)
    if (rsi < 30) strength += 30;
    else if (rsi < 40) strength += 20;
    else if (rsi < 50) strength += 10;
    else if (rsi > 70) strength -= 20;
    else if (rsi > 60) strength -= 10;
    // MACD contribution (0-20 points)
    if (hasMACDMomentum) strength += 15;
    else if (macd !== undefined) strength -= 10;
    // SMA trend (0-20 points)
    if (isBull) strength += 15;
    else if (sma20 && sma50 && sma50 > sma20) strength -= 10;
    // VIX adjustment (-10 to +10)
    if (avgVix < 14) strength += 5;
    else if (avgVix > 22) strength -= 10;
    strength = Math.max(5, Math.min(99, strength));

    // === STOP LOSS & TAKE PROFIT ===
    const atr = (high - low) || price * 0.02;
    const stopLoss = price > 0 ? price - (atr * 1.5) : 0;
    const takeProfit = price > 0 ? price + (atr * 2.5) : 0;
    const riskReward = price > 0 && (price - stopLoss) > 0 ? (takeProfit - price) / (price - stopLoss) : 0;

    // === TREND STRENGTH ===
    let trendStrength: AllocationRec['trendStrength'] = 'WEAK';
    if (isBull && hasMACDMomentum && rsi < 60) trendStrength = 'STRONG';
    else if (isBull || hasMACDMomentum) trendStrength = 'MODERATE';
    else if (rsi < 35 && !isBull) trendStrength = 'REVERSAL';

    // === VOLUME SIGNAL ===
    let volumeSignal = '💤 Low';
    if (volume > 1000000) volumeSignal = '🔥 High Volume';
    else if (volume > 500000) volumeSignal = '📊 Active';
    else if (volume > 100000) volumeSignal = '⚡ Normal';

    // === DYNAMIC ALLOCATION DISABLED (Fixed Allocations based on User Request) ===
    let allocMult = 1.0;

    const targetEntry = rsi < 40 ? low : price * 0.99;
    const discount = price > 0 ? ((price - targetEntry) / price) * 100 : 0;

    // === SIGNAL + REASON ===
    let signal = '🟡 WAIT';
    let reason = 'Neutral zone — wait for dip entry';
    if (rsi < 30 && hasMACDMomentum) { signal = '🟢 STRONG BUY'; reason = `RSI ${rsi.toFixed(0)} oversold + MACD bullish crossover. Institutional accumulation zone.`; }
    else if (rsi < 35 || (isBull && hasMACDMomentum)) { signal = '🟢 BUY NOW'; reason = `${isBull ? 'Golden Cross active' : `RSI ${rsi.toFixed(0)} near oversold`}. ${hasMACDMomentum ? 'MACD momentum positive.' : ''}`; }
    else if (rsi < 45 || isBull) { signal = '🟢 ACCUMULATE'; reason = `Favorable entry zone. ${isBull ? 'SMA20 > SMA50 trend intact.' : `RSI ${rsi.toFixed(0)} approaching value.`}`; }
    else if (rsi > 75) { signal = '🔴 DISTRIBUTE'; reason = `RSI ${rsi.toFixed(0)} extreme overbought. Distribution phase — book 50%+ profits.`; }
    else if (rsi > 70 && !hasMACDMomentum) { signal = '🔴 AVOID'; reason = `RSI ${rsi.toFixed(0)} overbought. MACD losing momentum. Not a good entry.`; }
    else { reason = `RSI ${rsi.toFixed(0)} neutral. ${avgVix > 20 ? 'High VIX — maintain cash buffer.' : 'Wait for breakout or dip.'}`; }

    recs.push({
      symbol: etf.sym, name: etf.name, market, currentPrice: price,
      targetEntry, discount, signal, allocPct: etf.fixedAlloc * allocMult,
      allocAmount: 0, rsi, strength, stopLoss, takeProfit, riskReward,
      trendStrength, volumeSignal, reason
    });
  };

  ALPHA_ETFS_IN.forEach(etf => processETF(etf, 'IN'));
  ALPHA_ETFS_US.forEach(etf => processETF(etf, 'US'));

  // Normalize allocations per market and calculate ₹/$ amounts
  const inRecs = recs.filter(r => r.market === 'IN');
  const usRecs = recs.filter(r => r.market === 'US');
  const inTotal = inRecs.reduce((s, r) => s + r.allocPct, 0) || 1;
  const usTotal = usRecs.reduce((s, r) => s + r.allocPct, 0) || 1;
  inRecs.forEach(r => { r.allocPct = r.allocPct / inTotal; r.allocAmount = Math.round(indiaSIP * r.allocPct); });
  usRecs.forEach(r => { r.allocPct = r.allocPct / usTotal; r.allocAmount = Math.round(usSIP * r.allocPct); });

  return recs;
}

// ========================================
// DEEP TELEGRAM ANALYSIS
// ========================================
export function generateDeepAnalysis(
  portfolio: Position[],
  livePrices: Record<string, PriceData>,
  usdInrRate: number,
  metrics: { totalValue: number; totalPL: number; plPct: number; todayPL: number; todayPct: number }
): string {
  const now = new Date();
  const timeStr = now.toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit' });
  const usVix = livePrices['US_VIX']?.price || 15;
  const inVix = livePrices['IN_INDIAVIX']?.price || 15;
  const avgVix = (usVix + inVix) / 2;

  // Market regime
  let regime = '🟢 BULLISH';
  if (avgVix > 25) regime = '🔴 BEARISH';
  else if (avgVix > 18) regime = '🟡 VOLATILE';

  // Asset signals
  const signals = portfolio.map(p => {
    const key = `${p.market}_${p.symbol}`;
    return analyzeAsset(p, livePrices[key]);
  });

  const buySignals = signals.filter(s => s.signal === 'STRONG_BUY' || s.signal === 'BUY');
  const sellSignals = signals.filter(s => s.signal === 'STRONG_SELL' || s.signal === 'SELL');

  let msg = `📊 <b>WEALTH AI — Pro Radar</b>\n`;
  msg += `⏰ <i>${timeStr} IST</i>\n\n`;

  // Portfolio Summary
  msg += `💼 <b>Portfolio Sandbox</b>\n`;
  msg += `Current Equity: <b>₹${Math.round(metrics.totalValue).toLocaleString('en-IN')}</b>\n`;
  msg += `Total Return: <b>${metrics.totalPL >= 0 ? '+' : ''}₹${Math.round(metrics.totalPL).toLocaleString('en-IN')}</b> <i>(${metrics.plPct.toFixed(2)}%)</i>\n`;
  msg += `Today's Action: <b>${metrics.todayPL >= 0 ? '📈 +' : '📉 '}₹${Math.round(Math.abs(metrics.todayPL)).toLocaleString('en-IN')}</b>\n\n`;

  // Market Fundamentals
  msg += `🌍 <b>Global Market Engine</b>\n`;
  msg += `Regime: <b>${regime}</b>\n`;
  msg += `<code>US VIX: ${usVix.toFixed(1)} | India VIX: ${inVix.toFixed(1)}</code>\n`;
  msg += `<code>USD/INR: ₹${usdInrRate.toFixed(2)}</code> <i>(Live FOREX)</i>\n\n`;

  // Buy Signals
  if (buySignals.length > 0) {
    msg += `🟢 <b>STRONG BUY / ACCUMULATE</b>\n`;
    buySignals.forEach(s => {
      const cur = s.market === 'IN' ? '₹' : '$';
      msg += `• <b>${s.symbol}</b>: ${cur}${s.price.toFixed(2)} | RSI <b>${s.rsi.toFixed(0)}</b>\n`;
      msg += `  <i>${s.reason}</i>\n`;
      if (s.allocAmount) msg += `  <code>↳ Target SIP: ${cur}${s.allocAmount.toLocaleString()}</code>\n`;
    });
    msg += '\n';
  }

  // Sell Signals
  if (sellSignals.length > 0) {
    msg += `🔴 <b>DISTRIBUTE / SELL</b>\n`;
    sellSignals.forEach(s => {
      const cur = s.market === 'IN' ? '₹' : '$';
      msg += `• <b>${s.symbol}</b>: ${cur}${s.price.toFixed(2)} | RSI <b>${s.rsi.toFixed(0)}</b>\n`;
      msg += `  <i>${s.reason}</i>\n`;
    });
    msg += '\n';
  }

  // Trend Reversal Detection
  const reversals = signals.filter(s =>
    (s.change < -2 && s.rsi < 40) || (s.change > 2 && s.rsi > 60)
  );
  if (reversals.length > 0) {
    msg += `🔄 <b>REVERSAL SCANS ACTIVE</b>\n`;
    reversals.forEach(s => {
      const dir = s.change < 0 ? '⬇️ Bottoming Potential' : '⬆️ Topping Potential';
      msg += `• <b>${s.symbol}</b>: ${dir} (<b>${s.change > 0 ? '+' : ''}${s.change.toFixed(1)}%</b>)\n`;
    });
    msg += '\n';
  }

  // Market Direction
  if (avgVix < 15) {
    msg += `📈 <b>Quantum Outlook: RALLY MODE 🚀</b>\nLow Volatility = Complacency zone. Continue automated SIP routing.\n`;
  } else if (avgVix > 22) {
    msg += `📉 <b>Quantum Outlook: HIGH PRESSURE ⚠️</b>\nFear dominating. Wait for RSI to bottom out below 30. Hoard Capital.\n`;
  } else {
    msg += `➡️ <b>Quantum Outlook: CHOPPY RANGE</b>\nStick to absolute strict SIP schedules. No extra deployment recommended.\n`;
  }

  return msg;
}
