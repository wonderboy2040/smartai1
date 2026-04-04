// ============================================
// ANALYSIS ENGINE — Signals, Reports, Allocation
// ============================================

import { 
  ALPHA_ETFS_IN, ALPHA_ETFS_US, getAssetCagrProxy, 
  formatCurrency, formatPrice, DEFAULT_INDIA_SIP, DEFAULT_US_SIP 
} from './config.mjs';
import { getISTTime, getMarketStatus, isIndiaMarketOpen, isUSMarketOpen } from './market.mjs';

// ========================================
// ASSET SIGNAL ANALYSIS
// ========================================
export function analyzeAsset(position, priceData) {
  const price = priceData?.price || position.avgPrice;
  const rsi = priceData?.rsi || 50;
  const change = priceData?.change || 0;
  const cagr = getAssetCagrProxy(position.symbol, position.market);

  const sma20 = priceData?.sma20;
  const sma50 = priceData?.sma50;
  const macd = priceData?.macd;

  let isBullishTrend = change > 0.5;
  let isBearishTrend = change < -0.5;

  if (sma20 && sma50) {
    isBullishTrend = sma20 > sma50 || (macd !== undefined && macd > 0);
    isBearishTrend = sma50 > sma20 || (macd !== undefined && macd < 0);
  }

  const low = priceData?.low || price * 0.98;
  const high = priceData?.high || price * 1.02;
  const dayRange = high - low;
  const supportLevel = low - dayRange * 0.382;
  const resistanceLevel = high + dayRange * 0.382;

  let signal = 'HOLD';
  let confidence = 60;
  let reason = 'Neutral range, maintain position';
  let targetPrice = price;

  if (rsi < 30) {
    signal = 'STRONG_BUY'; confidence = 95; targetPrice = supportLevel;
    reason = `RSI ${rsi.toFixed(0)} oversold — institutional accumulation zone.`;
  } else if (rsi < 40) {
    signal = 'BUY'; confidence = 80; targetPrice = low;
    reason = `RSI ${rsi.toFixed(0)} approaching oversold — good entry.`;
    if (isBullishTrend) { reason += ' Bullish momentum building.'; confidence += 5; }
  } else if (rsi > 75) {
    signal = 'STRONG_SELL'; confidence = 90; targetPrice = resistanceLevel;
    reason = `RSI ${rsi.toFixed(0)} overbought — distribution zone.`;
  } else if (rsi > 65) {
    signal = 'SELL'; confidence = 70; targetPrice = high;
    reason = `RSI ${rsi.toFixed(0)} elevated — consider partial booking.`;
    if (isBearishTrend) { reason += ' Bearish momentum detected.'; confidence += 5; }
  } else {
    if (isBullishTrend && rsi < 55) {
      signal = 'BUY'; confidence = 75; targetPrice = sma20 || price * 0.98;
      reason = `Golden Cross / Bullish MACD detected. Accumulate on dips.`;
    } else if (isBearishTrend && rsi > 55) {
      signal = 'SELL'; confidence = 65; targetPrice = sma20 || price * 1.02;
      reason = `Death Cross / Bearish MACD momentum. Book partials.`;
    } else if (change < -3) {
      signal = 'BUY'; confidence = 75; targetPrice = price * 0.98;
      reason = `Sharp dip ${change.toFixed(1)}% — potential reversal.`;
    } else if (change > 3) {
      signal = 'SELL'; confidence = 65; targetPrice = price * 1.02;
      reason = `Strong rally ${change.toFixed(1)}% — book partial profits.`;
    }
  }

  if (cagr > 20 && signal === 'BUY') confidence = Math.min(99, confidence + 10);

  const action = (signal === 'STRONG_BUY' || signal === 'BUY') ? 'BUY' : (signal === 'STRONG_SELL' || signal === 'SELL') ? 'SELL' : 'HOLD';
  const trend = isBullishTrend ? 'up' : isBearishTrend ? 'down' : 'flat';

  return {
    symbol: position.symbol.replace('.NS', ''),
    market: position.market,
    signal, action, trend, rsi, change, price,
    targetPrice, fibLow: supportLevel, fibHigh: resistanceLevel,
    confidence, reason
  };
}

// ========================================
// PORTFOLIO METRICS
// ========================================
export function calculateMetrics(portfolio, livePrices, usdInrRate) {
  let totalInvested = 0, totalValue = 0, todayPL = 0;
  let indPL = 0, usPL = 0;

  for (const p of portfolio) {
    const key = `${p.market}_${p.symbol}`;
    const data = livePrices[key];
    const curPrice = data?.price || p.avgPrice;
    const change = data?.change || 0;
    const lev = p.leverage || 1;

    const posSize = p.avgPrice * p.qty;
    const inv = posSize / lev;
    const curVal = curPrice * p.qty;
    const eqVal = inv + (curVal - posSize);

    const invINR = p.market === 'IN' ? inv : inv * usdInrRate;
    const valINR = p.market === 'IN' ? eqVal : eqVal * usdInrRate;

    totalInvested += invINR;
    totalValue += valINR;

    const prevPrice = curPrice / (1 + (change / 100));
    const dayPL = (curPrice - prevPrice) * p.qty;
    const dayPLINR = p.market === 'IN' ? dayPL : dayPL * usdInrRate;
    todayPL += dayPLINR;

    if (p.market === 'IN') indPL += dayPLINR;
    else usPL += dayPLINR;
  }

  const totalPL = totalValue - totalInvested;
  const plPct = totalInvested > 0 ? (totalPL / totalInvested) * 100 : 0;
  const todayPct = (totalValue - todayPL) > 0 ? (todayPL / (totalValue - todayPL)) * 100 : 0;

  return { totalInvested, totalValue, totalPL, plPct, todayPL, todayPct, indPL, usPL };
}

// ========================================
// TELEGRAM REPORT GENERATORS
// ========================================

// /portfolio — Full Portfolio Report
export function generatePortfolioReport(portfolio, livePrices, usdInrRate) {
  const metrics = calculateMetrics(portfolio, livePrices, usdInrRate);
  const timeStr = getISTTime();

  let msg = `💼 <b>WEALTH AI — Portfolio Commander</b>\n`;
  msg += `⏰ <i>${timeStr} IST</i> | ${getMarketStatus()}\n\n`;

  // Summary
  msg += `📊 <b>Portfolio Summary</b>\n`;
  msg += `<code>━━━━━━━━━━━━━━━━━━━━━━━━━</code>\n`;
  msg += `Total Equity:  <b>₹${Math.round(metrics.totalValue).toLocaleString('en-IN')}</b>\n`;
  msg += `Invested:      <b>₹${Math.round(metrics.totalInvested).toLocaleString('en-IN')}</b>\n`;
  msg += `Total P&L:     <b>${metrics.totalPL >= 0 ? '📈 +' : '📉 '}₹${Math.round(Math.abs(metrics.totalPL)).toLocaleString('en-IN')}</b> <i>(${metrics.plPct >= 0 ? '+' : ''}${metrics.plPct.toFixed(2)}%)</i>\n`;
  msg += `Today:         <b>${metrics.todayPL >= 0 ? '🟢 +' : '🔴 '}₹${Math.round(Math.abs(metrics.todayPL)).toLocaleString('en-IN')}</b> <i>(${metrics.todayPct >= 0 ? '+' : ''}${metrics.todayPct.toFixed(2)}%)</i>\n`;
  msg += `USD/INR:       <b>₹${usdInrRate.toFixed(2)}</b>\n\n`;

  // Individual positions
  const inPositions = portfolio.filter(p => p.market === 'IN');
  const usPositions = portfolio.filter(p => p.market === 'US');

  if (inPositions.length > 0) {
    msg += `🇮🇳 <b>India Holdings</b>\n`;
    msg += `<code>━━━━━━━━━━━━━━━━━━━━━━━━━</code>\n`;
    for (const p of inPositions) {
      const key = `IN_${p.symbol}`;
      const data = livePrices[key];
      const curPrice = data?.price || p.avgPrice;
      const change = data?.change || 0;
      const rsi = data?.rsi || 50;
      const pl = (curPrice - p.avgPrice) * p.qty;
      const plPct = p.avgPrice > 0 ? ((curPrice - p.avgPrice) / p.avgPrice) * 100 : 0;
      const cleanSym = p.symbol.replace('.NS', '');
      
      msg += `\n• <b>${cleanSym}</b> × ${p.qty}\n`;
      msg += `  CMP: ₹${curPrice.toFixed(2)} <i>(${change >= 0 ? '+' : ''}${change.toFixed(2)}%)</i>\n`;
      msg += `  Avg: ₹${p.avgPrice.toFixed(2)} | P&L: <b>${pl >= 0 ? '+' : ''}₹${Math.round(pl).toLocaleString('en-IN')}</b> (${plPct >= 0 ? '+' : ''}${plPct.toFixed(1)}%)\n`;
      msg += `  RSI: <b>${rsi.toFixed(0)}</b> ${rsi < 35 ? '🟢 Oversold' : rsi > 65 ? '🔴 Overbought' : '🟡 Neutral'}\n`;
    }
    msg += '\n';
  }

  if (usPositions.length > 0) {
    msg += `🇺🇸 <b>US Holdings</b>\n`;
    msg += `<code>━━━━━━━━━━━━━━━━━━━━━━━━━</code>\n`;
    for (const p of usPositions) {
      const key = `US_${p.symbol}`;
      const data = livePrices[key];
      const curPrice = data?.price || p.avgPrice;
      const change = data?.change || 0;
      const rsi = data?.rsi || 50;
      const pl = (curPrice - p.avgPrice) * p.qty;
      const plINR = pl * usdInrRate;
      const plPct = p.avgPrice > 0 ? ((curPrice - p.avgPrice) / p.avgPrice) * 100 : 0;
      
      msg += `\n• <b>${p.symbol}</b> × ${p.qty}\n`;
      msg += `  CMP: $${curPrice.toFixed(2)} <i>(${change >= 0 ? '+' : ''}${change.toFixed(2)}%)</i>\n`;
      msg += `  Avg: $${p.avgPrice.toFixed(2)} | P&L: <b>${pl >= 0 ? '+' : ''}$${Math.abs(pl).toFixed(2)}</b> (₹${Math.round(Math.abs(plINR)).toLocaleString('en-IN')})\n`;
      msg += `  RSI: <b>${rsi.toFixed(0)}</b> ${rsi < 35 ? '🟢 Oversold' : rsi > 65 ? '🔴 Overbought' : '🟡 Neutral'}\n`;
    }
    msg += '\n';
  }

  msg += `\n💎 <i>Deep Mind AI Pro Trading Terminal</i>`;
  return msg;
}

// /market — Global Market Report
export function generateMarketReport(livePrices, intelligence) {
  const timeStr = getISTTime();
  const usVix = livePrices['US_VIX']?.price || 15;
  const inVix = livePrices['IN_INDIAVIX']?.price || 15;
  const avgVix = (usVix + inVix) / 2;

  let regime = '🟢 BULLISH';
  if (avgVix > 25) regime = '🔴 BEARISH';
  else if (avgVix > 18) regime = '🟡 VOLATILE';

  let msg = `🌍 <b>WEALTH AI — Global Market Radar</b>\n`;
  msg += `⏰ <i>${timeStr} IST</i> | ${getMarketStatus()}\n\n`;

  // Regime
  msg += `🧭 <b>Market Regime:</b> ${regime}\n`;
  msg += `<code>US VIX: ${usVix.toFixed(1)} | India VIX: ${inVix.toFixed(1)}</code>\n\n`;

  // Global Indices
  if (intelligence?.globalIndices?.length > 0) {
    msg += `📊 <b>Global Indices</b>\n`;
    msg += `<code>━━━━━━━━━━━━━━━━━━━━━━━━━</code>\n`;
    for (const idx of intelligence.globalIndices) {
      const emoji = idx.change > 0.5 ? '🟢' : idx.change < -0.5 ? '🔴' : '⚪';
      msg += `${emoji} <b>${idx.name}:</b> ${idx.price.toFixed(2)} <i>(${idx.change >= 0 ? '+' : ''}${idx.change.toFixed(2)}%)</i>\n`;
    }
    msg += '\n';
  }

  // Sectors
  if (intelligence?.sectors?.length > 0) {
    msg += `🏭 <b>Sector Heat Map</b>\n`;
    msg += `<code>━━━━━━━━━━━━━━━━━━━━━━━━━</code>\n`;
    for (const s of intelligence.sectors) {
      const emoji = s.change > 1 ? '🟢' : s.change < -1 ? '🔴' : '⚪';
      msg += `${emoji} ${s.name}: <b>${s.change >= 0 ? '+' : ''}${s.change.toFixed(2)}%</b>\n`;
    }
    msg += '\n';
  }

  // Fear & Greed
  if (intelligence) {
    const fg = intelligence.fearGreedScore;
    const fgBar = '█'.repeat(Math.round(fg / 10)) + '░'.repeat(10 - Math.round(fg / 10));
    msg += `🧠 <b>Fear & Greed Index</b>\n`;
    msg += `<code>[${fgBar}] ${fg}/100</code>\n`;
    msg += `${fg > 60 ? '🟢 GREED' : fg < 40 ? '🔴 FEAR' : '🟡 NEUTRAL'}\n\n`;
  }

  // Narrative
  if (intelligence?.marketNarrative) {
    msg += `📋 <b>AI Narrative:</b>\n<i>${intelligence.marketNarrative}</i>\n`;
  }

  msg += `\n💎 <i>Deep Mind AI Pro Trading Terminal</i>`;
  return msg;
}

// /signals — Buy/Sell Signals
export function generateSignalsReport(portfolio, livePrices) {
  const timeStr = getISTTime();
  const signals = portfolio.map(p => {
    const key = `${p.market}_${p.symbol}`;
    return analyzeAsset(p, livePrices[key]);
  });

  const buySignals = signals.filter(s => s.signal === 'STRONG_BUY' || s.signal === 'BUY');
  const sellSignals = signals.filter(s => s.signal === 'STRONG_SELL' || s.signal === 'SELL');
  const holdSignals = signals.filter(s => s.signal === 'HOLD');

  let msg = `🎯 <b>WEALTH AI — Signal Scanner</b>\n`;
  msg += `⏰ <i>${timeStr} IST</i>\n\n`;

  if (buySignals.length > 0) {
    msg += `🟢 <b>BUY / ACCUMULATE SIGNALS</b>\n`;
    msg += `<code>━━━━━━━━━━━━━━━━━━━━━━━━━</code>\n`;
    for (const s of buySignals) {
      const cur = s.market === 'IN' ? '₹' : '$';
      const emoji = s.signal === 'STRONG_BUY' ? '🟢🟢' : '🟢';
      msg += `\n${emoji} <b>${s.symbol}</b> — ${s.signal.replace('_', ' ')}\n`;
      msg += `  Price: ${cur}${s.price.toFixed(2)} | RSI: <b>${s.rsi.toFixed(0)}</b>\n`;
      msg += `  Target: ${cur}${s.targetPrice.toFixed(2)}\n`;
      msg += `  Confidence: <b>${s.confidence}%</b>\n`;
      msg += `  <i>${s.reason}</i>\n`;
    }
    msg += '\n';
  }

  if (sellSignals.length > 0) {
    msg += `🔴 <b>SELL / DISTRIBUTE SIGNALS</b>\n`;
    msg += `<code>━━━━━━━━━━━━━━━━━━━━━━━━━</code>\n`;
    for (const s of sellSignals) {
      const cur = s.market === 'IN' ? '₹' : '$';
      const emoji = s.signal === 'STRONG_SELL' ? '🔴🔴' : '🔴';
      msg += `\n${emoji} <b>${s.symbol}</b> — ${s.signal.replace('_', ' ')}\n`;
      msg += `  Price: ${cur}${s.price.toFixed(2)} | RSI: <b>${s.rsi.toFixed(0)}</b>\n`;
      msg += `  <i>${s.reason}</i>\n`;
    }
    msg += '\n';
  }

  if (holdSignals.length > 0) {
    msg += `🟡 <b>HOLD / NEUTRAL</b>\n`;
    msg += `<code>━━━━━━━━━━━━━━━━━━━━━━━━━</code>\n`;
    for (const s of holdSignals) {
      msg += `⚪ <b>${s.symbol}</b>: RSI ${s.rsi.toFixed(0)} | ${s.change >= 0 ? '+' : ''}${s.change.toFixed(1)}% | <i>${s.reason}</i>\n`;
    }
    msg += '\n';
  }

  if (buySignals.length === 0 && sellSignals.length === 0) {
    msg += `⚪ <b>All Clear</b>\nKoi strong signal nahi hai abhi. Sab neutral zone me hain.\nSIP chalne do, dip aaye toh mai alert dunga.\n`;
  }

  msg += `\n💎 <i>Deep Mind AI Pro Trading Terminal</i>`;
  return msg;
}

// /allocation — Smart SIP Allocation
export function generateAllocationReport(livePrices, usdInrRate) {
  const timeStr = getISTTime();
  const usVix = livePrices['US_VIX']?.price || 15;
  const inVix = livePrices['IN_INDIAVIX']?.price || 15;
  const avgVix = (usVix + inVix) / 2;

  let msg = `📈 <b>WEALTH AI — Smart SIP Allocation</b>\n`;
  msg += `⏰ <i>${timeStr} IST</i>\n\n`;

  const processETF = (etf, market) => {
    const key = `${market}_${etf.sym}`;
    const altKey = `${market}_${etf.sym}.NS`;
    const data = livePrices[key] || livePrices[altKey];
    const price = data?.price || 0;
    const rsi = data?.rsi || 50;
    const sma20 = data?.sma20;
    const sma50 = data?.sma50;
    const macd = data?.macd;
    const isBull = sma20 && sma50 ? sma20 > sma50 : false;
    const hasMACDMomentum = macd !== undefined ? macd > 0 : false;

    let signal = '🟡 WAIT';
    if (rsi < 30 && hasMACDMomentum) signal = '🟢🟢 STRONG BUY';
    else if (rsi < 35 || (isBull && hasMACDMomentum)) signal = '🟢 BUY NOW';
    else if (rsi < 45 || isBull) signal = '🟢 ACCUMULATE';
    else if (rsi > 75) signal = '🔴 DISTRIBUTE';
    else if (rsi > 70 && !hasMACDMomentum) signal = '🔴 AVOID';

    return { sym: etf.sym, name: etf.name, market, price, rsi, signal, alloc: etf.fixedAlloc };
  };

  const inRecs = ALPHA_ETFS_IN.map(e => processETF(e, 'IN'));
  const usRecs = ALPHA_ETFS_US.map(e => processETF(e, 'US'));

  // Normalize allocations
  const inTotal = inRecs.reduce((s, r) => s + r.alloc, 0) || 1;
  const usTotal = usRecs.reduce((s, r) => s + r.alloc, 0) || 1;
  inRecs.forEach(r => { r.allocPct = r.alloc / inTotal; r.allocAmount = Math.round(DEFAULT_INDIA_SIP * r.allocPct); });
  usRecs.forEach(r => { r.allocPct = r.alloc / usTotal; r.allocAmount = Math.round(DEFAULT_US_SIP * r.allocPct); });

  msg += `🇮🇳 <b>India SIP Matrix (₹${DEFAULT_INDIA_SIP.toLocaleString()}/mo)</b>\n`;
  msg += `<code>━━━━━━━━━━━━━━━━━━━━━━━━━</code>\n`;
  for (const r of inRecs) {
    msg += `\n${r.signal}\n`;
    msg += `<b>${r.sym}</b> — ${r.name}\n`;
    msg += `CMP: ₹${r.price.toFixed(2)} | RSI: <b>${r.rsi.toFixed(0)}</b>\n`;
    msg += `Allocation: <b>₹${r.allocAmount.toLocaleString()} (${(r.allocPct * 100).toFixed(0)}%)</b>\n`;
  }

  msg += `\n\n🇺🇸 <b>US SIP Matrix ($${DEFAULT_US_SIP}/mo)</b>\n`;
  msg += `<code>━━━━━━━━━━━━━━━━━━━━━━━━━</code>\n`;
  for (const r of usRecs) {
    msg += `\n${r.signal}\n`;
    msg += `<b>${r.sym}</b> — ${r.name}\n`;
    msg += `CMP: $${r.price.toFixed(2)} | RSI: <b>${r.rsi.toFixed(0)}</b>\n`;
    msg += `Allocation: <b>$${r.allocAmount} (${(r.allocPct * 100).toFixed(0)}%)</b>\n`;
  }

  msg += `\n\n🧠 <b>VIX Risk Context:</b> ${avgVix > 22 ? '🔴 High Fear — conservative allocation' : avgVix < 15 ? '🟢 Low Risk — full deployment' : '🟡 Normal — standard allocation'}\n`;
  msg += `\n💎 <i>Deep Mind AI Pro Trading Terminal</i>`;
  return msg;
}

// /risk — Risk Assessment
export function generateRiskReport(livePrices, portfolio, usdInrRate) {
  const timeStr = getISTTime();
  const usVix = livePrices['US_VIX']?.price || 15;
  const inVix = livePrices['IN_INDIAVIX']?.price || 15;
  const avgVix = (usVix + inVix) / 2;
  const metrics = calculateMetrics(portfolio, livePrices, usdInrRate);

  let riskLevel = '🟢 LOW';
  let riskScore = 25;
  let advice = 'Market stable. Full SIP deployment recommended.';
  
  if (avgVix > 30) { riskLevel = '🔴 EXTREME'; riskScore = 95; advice = 'DANGER ZONE — Paisa hath me rakho. Cash is king.'; }
  else if (avgVix > 25) { riskLevel = '🔴 HIGH'; riskScore = 80; advice = 'Major hedging required. Only essentials me invest karo.'; }
  else if (avgVix > 20) { riskLevel = '🟠 ELEVATED'; riskScore = 60; advice = 'Caution mode. SIP chalne do but extra deployment rokh ke rakho.'; }
  else if (avgVix > 16) { riskLevel = '🟡 MODERATE'; riskScore = 40; advice = 'Normal conditions. Standard SIP optimal hai.'; }
  else if (avgVix > 12) { riskLevel = '🟢 LOW'; riskScore = 25; advice = 'Bull territory. Aggressively accumulate quality assets.'; }
  else { riskLevel = '⚠️ ULTRA LOW'; riskScore = 15; advice = 'Extreme complacency! VIX bahut neeche. Profits protect karo.'; }

  const riskBar = '🟥'.repeat(Math.round(riskScore / 10)) + '🟩'.repeat(10 - Math.round(riskScore / 10));

  let msg = `🛡️ <b>WEALTH AI — Risk Command Center</b>\n`;
  msg += `⏰ <i>${timeStr} IST</i>\n\n`;

  msg += `🎚️ <b>Global Risk Level:</b> ${riskLevel}\n`;
  msg += `<code>[${riskBar}] ${riskScore}/100</code>\n\n`;

  msg += `📊 <b>Volatility Matrix</b>\n`;
  msg += `<code>━━━━━━━━━━━━━━━━━━━━━━━━━</code>\n`;
  msg += `US VIX (CBOE):    <b>${usVix.toFixed(1)}</b> ${usVix > 20 ? '🔴' : '🟢'}\n`;
  msg += `India VIX:        <b>${inVix.toFixed(1)}</b> ${inVix > 20 ? '🔴' : '🟢'}\n`;
  msg += `Average VIX:      <b>${avgVix.toFixed(1)}</b>\n\n`;

  msg += `💼 <b>Portfolio Risk</b>\n`;
  msg += `<code>━━━━━━━━━━━━━━━━━━━━━━━━━</code>\n`;
  msg += `Total Exposure:   ₹${Math.round(metrics.totalValue).toLocaleString('en-IN')}\n`;
  msg += `Today's Move:     ${metrics.todayPL >= 0 ? '📈 +' : '📉 '}₹${Math.round(Math.abs(metrics.todayPL)).toLocaleString('en-IN')} (${metrics.todayPct.toFixed(2)}%)\n`;
  
  // Max drawdown estimate
  const maxDrawdown = metrics.totalValue * (avgVix > 25 ? 0.15 : avgVix > 18 ? 0.10 : 0.05);
  msg += `Max Drawdown Est: <b>₹${Math.round(maxDrawdown).toLocaleString('en-IN')}</b> <i>(${avgVix > 25 ? '15%' : avgVix > 18 ? '10%' : '5%'} worst case)</i>\n\n`;

  msg += `🧠 <b>AI Recommendation:</b>\n<i>${advice}</i>\n`;
  msg += `\n💎 <i>Deep Mind AI Pro Trading Terminal</i>`;
  return msg;
}

// Scheduled Auto Report (market hours)
export function generateAutoReport(portfolio, livePrices, usdInrRate) {
  const metrics = calculateMetrics(portfolio, livePrices, usdInrRate);
  const timeStr = getISTTime();
  const usVix = livePrices['US_VIX']?.price || 15;
  const inVix = livePrices['IN_INDIAVIX']?.price || 15;
  const avgVix = (usVix + inVix) / 2;

  let regime = '🟢 BULLISH';
  if (avgVix > 25) regime = '🔴 BEARISH';
  else if (avgVix > 18) regime = '🟡 VOLATILE';

  // Check for urgent signals
  const signals = portfolio.map(p => {
    const key = `${p.market}_${p.symbol}`;
    return analyzeAsset(p, livePrices[key]);
  });
  const urgentBuys = signals.filter(s => s.signal === 'STRONG_BUY');
  const urgentSells = signals.filter(s => s.signal === 'STRONG_SELL');

  let msg = `📊 <b>WEALTH AI — Auto Scan Report</b>\n`;
  msg += `⏰ <i>${timeStr} IST</i> | ${getMarketStatus()}\n\n`;

  msg += `💼 <b>Portfolio Status</b>\n`;
  msg += `Equity: <b>₹${Math.round(metrics.totalValue).toLocaleString('en-IN')}</b>\n`;
  msg += `P&L: <b>${metrics.totalPL >= 0 ? '+' : ''}₹${Math.round(metrics.totalPL).toLocaleString('en-IN')}</b> (${metrics.plPct.toFixed(2)}%)\n`;
  msg += `Today: <b>${metrics.todayPL >= 0 ? '📈 +' : '📉 '}₹${Math.round(Math.abs(metrics.todayPL)).toLocaleString('en-IN')}</b>\n\n`;

  msg += `🌍 Regime: <b>${regime}</b> | VIX: ${avgVix.toFixed(1)}\n\n`;

  if (urgentBuys.length > 0) {
    msg += `🟢 <b>STRONG BUY ALERT!</b>\n`;
    for (const s of urgentBuys) {
      msg += `• <b>${s.symbol}</b> RSI ${s.rsi.toFixed(0)} — ${s.reason}\n`;
    }
    msg += '\n';
  }

  if (urgentSells.length > 0) {
    msg += `🔴 <b>DISTRIBUTION ALERT!</b>\n`;
    for (const s of urgentSells) {
      msg += `• <b>${s.symbol}</b> RSI ${s.rsi.toFixed(0)} — ${s.reason}\n`;
    }
    msg += '\n';
  }

  if (urgentBuys.length === 0 && urgentSells.length === 0) {
    msg += `✅ <i>All assets stable — no urgent action needed.</i>\n`;
  }

  msg += `\n💎 <i>Automated by Deep Mind AI</i>`;
  return msg;
}

// /forex — Forex Report
export function generateForexReport(usdInrRate) {
  const timeStr = getISTTime();
  let msg = `💱 <b>FOREX — USD/INR Live</b>\n`;
  msg += `⏰ <i>${timeStr} IST</i>\n\n`;
  msg += `🇺🇸 1 USD = 🇮🇳 <b>₹${usdInrRate.toFixed(4)}</b>\n\n`;
  msg += `<b>Quick Conversion:</b>\n`;
  msg += `<code>$10   = ₹${(10 * usdInrRate).toFixed(0)}</code>\n`;
  msg += `<code>$100  = ₹${(100 * usdInrRate).toFixed(0).replace(/\B(?=(\d{3})+(?!\d))/g, ',')}</code>\n`;
  msg += `<code>$500  = ₹${(500 * usdInrRate).toFixed(0).replace(/\B(?=(\d{3})+(?!\d))/g, ',')}</code>\n`;
  msg += `<code>$1000 = ₹${(1000 * usdInrRate).toFixed(0).replace(/\B(?=(\d{3})+(?!\d))/g, ',')}</code>\n`;
  msg += `\n💎 <i>Deep Mind AI Pro Trading Terminal</i>`;
  return msg;
}
