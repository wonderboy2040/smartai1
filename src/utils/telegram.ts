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
  priceData: PriceData | undefined,
  usdInrRate: number
): AssetSignal {
  const price = priceData?.price || position.avgPrice;
  const rsi = priceData?.rsi || 50;
  const change = priceData?.change || 0;
  const cagr = getAssetCagrProxy(position.symbol, position.market);

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
    reason = `RSI ${rsi.toFixed(0)} oversold — institutional accumulation zone`;
  } else if (rsi < 40) {
    signal = 'BUY';
    confidence = 80;
    targetPrice = low;
    reason = `RSI ${rsi.toFixed(0)} approaching oversold — good entry`;
  } else if (rsi > 75) {
    signal = 'STRONG_SELL';
    confidence = 90;
    targetPrice = resistanceLevel;
    reason = `RSI ${rsi.toFixed(0)} overbought — distribution zone`;
  } else if (rsi > 65) {
    signal = 'SELL';
    confidence = 70;
    targetPrice = high;
    reason = `RSI ${rsi.toFixed(0)} elevated — consider partial booking`;
  } else {
    // Check trend via change
    if (change < -3) {
      signal = 'BUY';
      confidence = 75;
      targetPrice = price * 0.98;
      reason = `Sharp dip ${change.toFixed(1)}% — potential reversal`;
    } else if (change > 3) {
      signal = 'SELL';
      confidence = 65;
      targetPrice = price * 1.02;
      reason = `Strong rally ${change.toFixed(1)}% — book partial profits`;
    }
  }

  // CAGR boost for high-growth assets
  if (cagr > 20 && signal === 'BUY') confidence = Math.min(99, confidence + 10);

  // Derive simplified action & trend
  const action: AssetSignal['action'] = (signal === 'STRONG_BUY' || signal === 'BUY') ? 'BUY' : (signal === 'STRONG_SELL' || signal === 'SELL') ? 'SELL' : 'HOLD';
  const trend: AssetSignal['trend'] = change > 0.5 ? 'up' : change < -0.5 ? 'down' : 'flat';

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
  rsi: number;
}

export function getSmartAllocations(
  livePrices: Record<string, PriceData>,
  usdInrRate: number,
  indiaBudget: number,
  usBudget: number
): AllocationRec[] {
  const recs: AllocationRec[] = [];

  // India ETFs
  ALPHA_ETFS_IN.forEach(etf => {
    const key = `IN_${etf.sym}`;
    const altKey = `IN_${etf.sym}.NS`;
    const data = livePrices[key] || livePrices[altKey];
    const price = data?.price || 0;
    const rsi = data?.rsi || 50;
    const low = data?.low || price * 0.98;

    // Dynamic allocation: increase weight for oversold assets
    let allocMult = 1.0;
    if (rsi < 35) allocMult = 1.5;
    else if (rsi < 45) allocMult = 1.2;
    else if (rsi > 70) allocMult = 0.5;

    const targetEntry = rsi < 40 ? low : price * 0.99;
    const discount = price > 0 ? ((price - targetEntry) / price) * 100 : 0;

    let signal = '🟡 WAIT';
    if (rsi < 35) signal = '🟢 BUY NOW';
    else if (rsi < 45) signal = '🟢 ACCUMULATE';
    else if (rsi > 70) signal = '🔴 AVOID';

    recs.push({
      symbol: etf.sym,
      name: etf.name,
      market: 'IN',
      currentPrice: price,
      targetEntry,
      discount,
      signal,
      allocPct: etf.fixedAlloc * allocMult,
      rsi
    });
  });

  // US ETFs
  ALPHA_ETFS_US.forEach(etf => {
    const key = `US_${etf.sym}`;
    const data = livePrices[key];
    const price = data?.price || 0;
    const rsi = data?.rsi || 50;
    const low = data?.low || price * 0.98;

    let allocMult = 1.0;
    if (rsi < 35) allocMult = 1.5;
    else if (rsi < 45) allocMult = 1.2;
    else if (rsi > 70) allocMult = 0.5;

    const targetEntry = rsi < 40 ? low : price * 0.99;
    const discount = price > 0 ? ((price - targetEntry) / price) * 100 : 0;

    let signal = '🟡 WAIT';
    if (rsi < 35) signal = '🟢 BUY NOW';
    else if (rsi < 45) signal = '🟢 ACCUMULATE';
    else if (rsi > 70) signal = '🔴 AVOID';

    recs.push({
      symbol: etf.sym,
      name: etf.name,
      market: 'US',
      currentPrice: price,
      targetEntry,
      discount,
      signal,
      allocPct: etf.fixedAlloc * allocMult,
      rsi
    });
  });

  // Normalize allocations per market
  const inRecs = recs.filter(r => r.market === 'IN');
  const usRecs = recs.filter(r => r.market === 'US');
  const inTotal = inRecs.reduce((s, r) => s + r.allocPct, 0) || 1;
  const usTotal = usRecs.reduce((s, r) => s + r.allocPct, 0) || 1;
  inRecs.forEach(r => r.allocPct = r.allocPct / inTotal);
  usRecs.forEach(r => r.allocPct = r.allocPct / usTotal);

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
    return analyzeAsset(p, livePrices[key], usdInrRate);
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
