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
  const vixMultiplier = avgVix > 25 ? 0.6 : avgVix > 20 ? 0.8 : avgVix > 16 ? 1.0 : 1.15;

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

    // === DYNAMIC ALLOCATION ===
    let allocMult = 1.0;
    if (rsi < 30 && hasMACDMomentum) allocMult = 2.0;
    else if (rsi < 35 || (isBull && hasMACDMomentum)) allocMult = 1.5;
    else if (rsi < 45 || isBull) allocMult = 1.2;
    else if (rsi > 75) allocMult = 0.3;
    else if (rsi > 70 && !hasMACDMomentum) allocMult = 0.5;
    allocMult *= vixMultiplier;

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

  let msg = `📊 *WEALTH AI — Deep Analysis*\n`;
  msg += `⏰ ${timeStr} IST\n\n`;

  // Portfolio Summary
  msg += `💼 *Portfolio*\n`;
  msg += `Total: ₹${Math.round(metrics.totalValue).toLocaleString('en-IN')}\n`;
  msg += `P&L: ${metrics.totalPL >= 0 ? '+' : ''}₹${Math.round(metrics.totalPL).toLocaleString('en-IN')} (${metrics.plPct.toFixed(1)}%)\n`;
  msg += `Today: ${metrics.todayPL >= 0 ? '📈+' : '📉'}₹${Math.round(Math.abs(metrics.todayPL)).toLocaleString('en-IN')}\n\n`;

  // Market Fundamentals
  msg += `🌍 *Market Regime: ${regime}*\n`;
  msg += `US VIX: ${usVix.toFixed(1)} | India VIX: ${inVix.toFixed(1)}\n`;
  msg += `USD/INR: ₹${usdInrRate.toFixed(2)}\n\n`;

  // Buy Signals
  if (buySignals.length > 0) {
    msg += `🟢 *BUY SIGNALS*\n`;
    buySignals.forEach(s => {
      const cur = s.market === 'IN' ? '₹' : '$';
      msg += `• ${s.symbol}: ${cur}${s.price.toFixed(2)} | RSI ${s.rsi.toFixed(0)} | Target: ${cur}${s.targetPrice.toFixed(2)}\n`;
      msg += `  _${s.reason}_\n`;
    });
    msg += '\n';
  }

  // Sell Signals
  if (sellSignals.length > 0) {
    msg += `🔴 *SELL/BOOK SIGNALS*\n`;
    sellSignals.forEach(s => {
      const cur = s.market === 'IN' ? '₹' : '$';
      msg += `• ${s.symbol}: ${cur}${s.price.toFixed(2)} | RSI ${s.rsi.toFixed(0)}\n`;
      msg += `  _${s.reason}_\n`;
    });
    msg += '\n';
  }

  // Trend Reversal Detection
  const reversals = signals.filter(s =>
    (s.change < -2 && s.rsi < 40) || (s.change > 2 && s.rsi > 60)
  );
  if (reversals.length > 0) {
    msg += `🔄 *REVERSAL ALERTS*\n`;
    reversals.forEach(s => {
      const dir = s.change < 0 ? '⬇️ Down→Up potential' : '⬆️ Up→Down potential';
      msg += `• ${s.symbol}: ${dir} (${s.change > 0 ? '+' : ''}${s.change.toFixed(1)}%)\n`;
    });
    msg += '\n';
  }

  // Market Direction
  if (avgVix < 15) {
    msg += `📈 *Outlook: Markets likely to RALLY*\nLow VIX = complacency. SIP aggressively.\n`;
  } else if (avgVix > 22) {
    msg += `📉 *Outlook: Markets under PRESSURE*\nHigh VIX = fear. Accumulate quality on dips.\n`;
  } else {
    msg += `➡️ *Outlook: RANGE-BOUND*\nStick to SIP schedule. Wait for clarity.\n`;
  }

  return msg;
}

// ========================================
// UNIFIED DEEP MIND NEURAL INSIDER AI CHAT
// ========================================
export function generateNeuralInsiderResponse(
  query: string,
  portfolio: Position[],
  livePrices: Record<string, PriceData>
): string {
  const q = query.toLowerCase();
  const usVix = livePrices['US_VIX']?.price || 15;
  const inVix = livePrices['IN_INDIAVIX']?.price || 15;
  const avgVix = (usVix + inVix) / 2;

  // Global Market State
  let marketState = 'neutral';
  if (avgVix > 22) marketState = 'bearish';
  else if (avgVix < 16) marketState = 'bullish';

  // Find opportunities
  const signals = portfolio.map(p => {
    const key = `${p.market}_${p.symbol}`;
    return analyzeAsset(p, livePrices[key]);
  });
  
  const strongBuys = signals.filter(s => s.signal === 'STRONG_BUY');
  const strongSells = signals.filter(s => s.signal === 'STRONG_SELL' || s.signal === 'SELL');

  if (q.includes('market') || q.includes('kaisa') || q.includes('condition')) {
    if (marketState === 'bearish') {
      return `📉 **Market Status Deep Scan:**\nBhai, Global VIX laal pe hai (US VIX: ${usVix.toFixed(1)}). Market me volatility aur fear factor bahut high hai. Ye time panic sell ka nahi, balki 'Buy on Dips' strategy lagane ka hai. Strong assets ko dheere dheere accumulate karo. Background neural scan bata raha hai institutional money abhi side-lines pe hai.`;
    } else if (marketState === 'bullish') {
      return `📈 **Market Status Deep Scan:**\nBhai, Market ekdum mast zone me chal raha hai. VIX shant hai (US VIX: ${usVix.toFixed(1)}), liquidity bani hui hai. Ye bullish trend continuation ka signal hai. Lekin FOMO me aake over-allocate mat karna. Sip chalne do bindaas.`;
    } else {
      return `⚖️ **Market Status Deep Scan:**\nMarkets abhi thoda range-bound aur confused hai, dono traf ke moves aane ki probability hai. SIP mode on rakho aur dip aane ka wait karke fresh entries dhundo. (Avg VIX: ${avgVix.toFixed(1)})`;
    }
  }

  if (q.includes('buy') || q.includes('invest') || q.includes('kisme') || q.includes('opportunities')) {
    if (strongBuys.length > 0) {
      const recs = strongBuys.slice(0, 3).map(s => `• ${s.symbol} (RSI: ${s.rsi.toFixed(0)}, Target: ${s.market === 'IN' ? '₹' : '$'}${s.targetPrice.toFixed(2)})\n  ↳ ${s.reason}`).join('\n');
      return `🧠 **AI Insider Accumulation Scans:**\nMera deep neural net continually background me saare assets ko scan kar raha hai. Abhi mujje inme Institutional buying/Golden crosses dikhe hain. Yaha entry best rahegi:\n\n${recs}\n\nStrictly stop-loss or smart allocation follow karo bhai.`;
    }
    return `🤔 **AI Deep Scan:**\nAbhi turant fresh 'Strong Buy' trigger nahi hua hai meri system me. RSI aur MACD oscillators neutralize kar rahe hain. Cash ready rakho, dip aayega tab mai alert dunga!`;
  }

  if (q.includes('sell') || q.includes('profit') || q.includes('exit')) {
    if (strongSells.length > 0) {
      const recs = strongSells.slice(0, 3).map(s => `• ${s.symbol} (RSI: ${s.rsi.toFixed(0)})\n  ↳ ${s.reason}`).join('\n');
      return `🚨 **AI Profit Booking Alerts:**\nYaha algorithms 'Overbought' aur distribution zone detect kar rahe hai. Smart money yaha se nikal raha hai, tum bhi thoda partial profit book kar sakte ho:\n\n${recs}`;
    }
    return `🛡️ **Portfolio Status:**\nAbhi apne portfolio me koi bhi asset extreme overbought condition me nahi hai. Hold tight bhai, apne winners ko run karne do. Agar trail stop-loss hit nai hua tho selling ki zarurat nhi hai.`;
  }

  return `🤖 **Deep Mind AI Neural Insider:**\n\nBhai, main piche background me tumhara dono India aur USA ka market 24x7 analyze kar raha hoon using RSI, MACD aur Volatility indices. Tum mujhse 'market kaisa hai?', 'kisme invest karu?', ya 'kab sell karu?' jese directly questions puch sakte ho. \n\nMeri advance pro trading algorithms exactly bata degi ki institutional money flow kaha ja rha hai.`;
}
