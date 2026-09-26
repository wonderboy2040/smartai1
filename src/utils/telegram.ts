import { Position, PriceData } from '../types';
import { ALPHA_ETFS_IN, ALPHA_ETFS_US, getAssetCagrProxy } from './constants';
import { computeUnifiedEntry } from './entryPriceEngine';

// ========================================
// MARKET HOURS CHECK
// ========================================
// FIX M16: previous implementation used `toLocaleString('en-US', ...)` and then
// string-split the result, which is locale-implementation-dependent (weekday
// could come second, include date, or use a different separator in some ICU
// builds). Use `Intl.DateTimeFormat.formatToParts` and read weekday/hour/minute
// explicitly so the parser is robust across Node/V8 versions.
function getTimeInZone(tz: string): { h: number; m: number; day: number } {
  // v5.0 perf: Intl.DateTimeFormat construction costs ~0.1-1ms and this
  // helper fires on EVERY WebSocket price message and EVERY market-status
  // render (tvWebsocket.validatePrice + Dashboard header). Hoist the
  // formatters to module scope and memoize per-tz results for 30s — far
  // finer than any market-open boundary the callers care about.
  const nowMs = Date.now();
  const cached = _tzCache[tz];
  if (cached && nowMs - cached.at < 30_000) return cached.val;
  if (!_tzFormatters[tz]) {
    _tzFormatters[tz] = new Intl.DateTimeFormat('en-US', {
      timeZone: tz, weekday: 'short', hour: '2-digit', minute: '2-digit', hour12: false,
    });
  }
  const parts = _tzFormatters[tz].formatToParts(new Date(nowMs));
  const get = (type: string) => parts.find(p => p.type === type)?.value || '';
  const dayMap: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  const d = new Date(nowMs);
  const day = dayMap[get('weekday').substring(0, 3)] ?? d.getDay();
  // hour can be "24" in some environments for midnight; normalize to 0.
  let h = parseInt(get('hour'), 10);
  if (isNaN(h) || h === 24) h = 0;
  const m = parseInt(get('minute'), 10) || 0;
  const val = { h, m, day };
  _tzCache[tz] = { at: nowMs, val };
  return val;
}
const _tzFormatters: Record<string, Intl.DateTimeFormat> = {};
const _tzCache: Record<string, { at: number; val: { h: number; m: number; day: number } }> = {};

export function isIndiaMarketOpen(): boolean {
  const { h, m, day } = getTimeInZone('Asia/Kolkata');
  if (day === 0 || day === 6) return false;
  const mins = h * 60 + m;
  return mins >= 555 && mins <= 930;
}

export function isUSMarketOpen(): boolean {
  const { h, m, day } = getTimeInZone('America/New_York');
  if (day === 0 || day === 6) return false;
  const mins = h * 60 + m;
  return mins >= 570 && mins <= 960;
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
    // Golden Cross / Death Cross — mutually exclusive conditions
    const smaBullish = sma20 > sma50;
    const smaBearish = sma50 > sma20;
    isBullishTrend = smaBullish && (macd === undefined || macd >= 0);
    isBearishTrend = smaBearish && (macd === undefined || macd <= 0);
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
    targetPrice = resistanceLevel; // Upside target for buy signal
    reason = `RSI ${rsi.toFixed(0)} oversold — institutional accumulation zone.`;
  } else if (rsi < 40) {
    signal = 'BUY';
    confidence = 80;
    targetPrice = high; // Upside target for buy signal
    reason = `RSI ${rsi.toFixed(0)} approaching oversold — good entry.`;
    if (isBullishTrend) {
      reason += ' Bullish momentum building.';
      confidence += 5;
    }
  } else if (rsi > 75) {
    signal = 'STRONG_SELL';
    confidence = 90;
    targetPrice = supportLevel; // Downside target for sell signal
    reason = `RSI ${rsi.toFixed(0)} overbought — distribution zone.`;
  } else if (rsi > 65) {
    signal = 'SELL';
    confidence = 70;
    targetPrice = low; // Downside target for sell signal
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
      targetPrice = resistanceLevel || high || price * 1.02;
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
  usSIP_INR: number = 16000,
  btcSIP: number = 1000,
  ethSIP: number = 500,
  usdInrRate: number = 83.5
): AllocationRec[] {
  const recs: AllocationRec[] = [];
  // FIX HIGH #2: previously `usSIP` was treated as native USD but the UI
  // passes it in INR. Convert to USD here so the per-ETF allocation math
  // produces sane dollar amounts.
  const usSIP_USD = usdInrRate > 0 ? usSIP_INR / usdInrRate : usSIP_INR;

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
    const atr = (high - low) > 0 ? (high - low) : price * 0.02;
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

    // === ENTRY / STOP LOSS / TAKE PROFIT — use canonical unified engine ===
    const unified = price > 0 && data ? computeUnifiedEntry(data) : null;
    const targetEntry = unified ? unified.optimal : (rsi < 40 ? low : price * 0.99);
    const stopLoss    = unified ? unified.stopLoss : (price > 0 ? price - atr * 1.5 : 0);
    const takeProfit  = unified ? unified.target1  : (price > 0 ? price + atr * 2.5 : 0);
    const riskReward  = unified ? unified.riskReward
      : (price > 0 && (price - stopLoss) > 0 ? (takeProfit - price) / (price - stopLoss) : 0);

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

    // === DYNAMIC REAL-TIME MARKET CONDITION ALLOCATION ===
    let allocMult = 1.0;
    if (rsi < 35 || strength >= 70) allocMult = 1.35;
    else if (rsi < 45 || strength >= 60) allocMult = 1.15;
    else if (rsi > 70 || strength <= 35) allocMult = 0.65;
    else if (rsi > 65) allocMult = 0.85;

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
  usRecs.forEach(r => { r.allocPct = r.allocPct / usTotal; r.allocAmount = Math.round(usSIP_USD * r.allocPct); });

  // Add BTC allocation
  const btcData = livePrices['IN_BTC'] || livePrices['US_BTC'];
  const btcPrice = btcData?.price || 0;
  const btcRsi = btcData?.rsi || 50;

  recs.push({
    symbol: 'BTC',
    name: 'Bitcoin',
    market: 'IN',
    currentPrice: btcPrice,
    targetEntry: btcPrice > 0 ? btcPrice * 0.95 : 0,
    discount: 5,
    signal: btcRsi < 40 ? '🟢 STRONG BUY' : btcRsi > 70 ? '🟡 WAIT/HOLD' : '🟢 ACCUMULATE',
    allocPct: 1.0,
    allocAmount: btcSIP,
    rsi: btcRsi,
    strength: btcRsi < 45 ? 85 : 50,
    stopLoss: btcPrice * 0.8,
    takeProfit: btcPrice * 1.5,
    riskReward: 2.5,
    trendStrength: 'STRONG',
    volumeSignal: '🔥 High Volume',
    reason: 'Digital Gold — Dedicated Monthly SIP'
  });

  // Add ETH allocation
  const ethData = livePrices['IN_ETH'] || livePrices['US_ETH'];
  const ethPrice = ethData?.price || 0;
  const ethRsi = ethData?.rsi || 50;

  recs.push({
    symbol: 'ETH',
    name: 'Ethereum',
    market: 'IN',
    currentPrice: ethPrice,
    targetEntry: ethPrice > 0 ? ethPrice * 0.95 : 0,
    discount: 5,
    signal: ethRsi < 40 ? '🟢 STRONG BUY' : ethRsi > 70 ? '🟡 WAIT/HOLD' : '🟢 ACCUMULATE',
    allocPct: 1.0,
    allocAmount: ethSIP,
    rsi: ethRsi,
    strength: ethRsi < 45 ? 85 : 50,
    stopLoss: ethPrice * 0.8,
    takeProfit: ethPrice * 1.5,
    riskReward: 2.5,
    trendStrength: 'STRONG',
    volumeSignal: '🔥 High Volume',
    reason: 'Smart Money ETH — Dedicated Monthly SIP'
  });

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

// ========================================
// UNIFIED DEEP MIND NEURAL INSIDER AI CHAT
// ========================================
// ========================================
// TELEGRAM COMMAND GENERATORS
// ========================================

