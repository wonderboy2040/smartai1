// ============================================
// INDIA INTRADAY ADVANCE PRO TRADING EXPERT
// DeepMind AI Quantum — Entry/Exit Price Points
// CoinDCX Futures + NSE Intraday Real-Time
// ============================================

export interface IntradaySignal {
  symbol: string;
  name: string;
  market: 'IN' | 'CRYPTO';
  category: 'NSE_STOCK' | 'COINDCX_FUTURES';
  price: number;
  change: number;
  high: number;
  low: number;
  volume: number;
  rsi: number;
  sma20: number;
  sma50: number;
  macd: number;
  // Intraday Entry/Exit
  entryPrice: number;
  exitPrice: number;
  stopLoss: number;
  riskReward: number;
  // Trend
  trend: 'STRONG_UP' | 'UP' | 'SIDEWAYS' | 'DOWN' | 'STRONG_DOWN';
  trendStrength: number; // 0-100
  // AI Signal
  signal: 'STRONG_BUY' | 'BUY' | 'HOLD' | 'SELL' | 'STRONG_SELL';
  signalScore: number; // 0-100
  confidence: number;
  // Quantum AI
  vwap: number;
  atr: number;
  pivotPoint: number;
  support1: number;
  support2: number;
  resistance1: number;
  resistance2: number;
  // Meta
  aiReasoning: string;
  aiAnalysis?: string;
  timestamp: number;
}

// ========== NSE INTRADAY STOCKS ==========
export const NSE_INTRADAY_STOCKS = [
  { sym: 'RELIANCE', name: 'Reliance Industries', sector: 'Conglomerate' },
  { sym: 'TCS', name: 'Tata Consultancy', sector: 'IT' },
  { sym: 'INFY', name: 'Infosys', sector: 'IT' },
  { sym: 'HDFCBANK', name: 'HDFC Bank', sector: 'Banking' },
  { sym: 'ICICIBANK', name: 'ICICI Bank', sector: 'Banking' },
  { sym: 'BAJFINANCE', name: 'Bajaj Finance', sector: 'NBFC' },
  { sym: 'TATAMOTORS', name: 'Tata Motors', sector: 'Auto' },
  { sym: 'BHARTIARTL', name: 'Bharti Airtel', sector: 'Telecom' },
  { sym: 'LT', name: 'Larsen & Toubro', sector: 'Infra' },
  { sym: 'SBIN', name: 'State Bank India', sector: 'Banking' },
  { sym: 'HCLTECH', name: 'HCL Technologies', sector: 'IT' },
  { sym: 'MARUTI', name: 'Maruti Suzuki', sector: 'Auto' },
  { sym: 'TITAN', name: 'Titan Company', sector: 'Consumer' },
  { sym: 'ADANIENT', name: 'Adani Enterprises', sector: 'Conglomerate' },
  { sym: 'WIPRO', name: 'Wipro', sector: 'IT' },
  { sym: 'TATASTEEL', name: 'Tata Steel', sector: 'Metal' },
  { sym: 'AXISBANK', name: 'Axis Bank', sector: 'Banking' },
  { sym: 'KOTAKBANK', name: 'Kotak Mahindra Bank', sector: 'Banking' },
  { sym: 'SUNPHARMA', name: 'Sun Pharma', sector: 'Pharma' },
  { sym: 'HINDUNILVR', name: 'Hindustan Unilever', sector: 'FMCG' },
];

// ========== COINDCX FUTURES PAIRS ==========
export const COINDCX_FUTURES = [
  { sym: 'BTC', name: 'Bitcoin Futures', pair: 'BTCINR' },
  { sym: 'ETH', name: 'Ethereum Futures', pair: 'ETHINR' },
  { sym: 'SOL', name: 'Solana Futures', pair: 'SOLINR' },
  { sym: 'BNB', name: 'BNB Futures', pair: 'BNBINR' },
  { sym: 'XRP', name: 'XRP Futures', pair: 'XRPINR' },
  { sym: 'DOGE', name: 'Dogecoin Futures', pair: 'DOGEINR' },
  { sym: 'ADA', name: 'Cardano Futures', pair: 'ADAINR' },
  { sym: 'AVAX', name: 'Avalanche Futures', pair: 'AVAXINR' },
  { sym: 'DOT', name: 'Polkadot Futures', pair: 'DOTINR' },
  { sym: 'MATIC', name: 'Polygon Futures', pair: 'MATICINR' },
];

// ========== PIVOT POINT CALCULATOR ==========
function calcPivots(high: number, low: number, close: number) {
  const pp = (high + low + close) / 3;
  const s1 = 2 * pp - high;
  const s2 = pp - (high - low);
  const r1 = 2 * pp - low;
  const r2 = pp + (high - low);
  return { pp, s1, s2, r1, r2 };
}

// ========== TREND DETECTION ==========
function detectTrend(price: number, sma20: number, sma50: number, rsi: number, macd: number, change: number): { trend: IntradaySignal['trend']; strength: number } {
  let score = 0;
  // Price vs SMA
  if (price > sma20) score += 15; else score -= 15;
  if (price > sma50) score += 10; else score -= 10;
  if (sma20 > sma50) score += 20; else score -= 20;
  // RSI
  if (rsi > 60) score += 15; else if (rsi < 40) score -= 15;
  // MACD
  if (macd > 0) score += 20; else score -= 20;
  // Change
  if (change > 2) score += 20; else if (change > 0.5) score += 10;
  else if (change < -2) score -= 20; else if (change < -0.5) score -= 10;

  const strength = Math.min(100, Math.max(0, 50 + score));
  let trend: IntradaySignal['trend'];
  if (strength >= 80) trend = 'STRONG_UP';
  else if (strength >= 60) trend = 'UP';
  else if (strength >= 40) trend = 'SIDEWAYS';
  else if (strength >= 20) trend = 'DOWN';
  else trend = 'STRONG_DOWN';

  return { trend, strength };
}

// ========== ENTRY/EXIT CALCULATOR ==========
function calcEntryExit(price: number, high: number, low: number, _rsi: number, _sma20: number, atr: number, trend: IntradaySignal['trend']) {
  let entryPrice: number, exitPrice: number, stopLoss: number;

  if (trend === 'STRONG_UP' || trend === 'UP') {
    // Buy setup — entry on pullback
    entryPrice = Math.round((price - atr * 0.3) * 100) / 100;
    exitPrice = Math.round((price + atr * 1.5) * 100) / 100;
    stopLoss = Math.round((price - atr * 1.2) * 100) / 100;
  } else if (trend === 'STRONG_DOWN' || trend === 'DOWN') {
    // Short setup
    entryPrice = Math.round((price + atr * 0.3) * 100) / 100;
    exitPrice = Math.round((price - atr * 1.5) * 100) / 100;
    stopLoss = Math.round((price + atr * 1.2) * 100) / 100;
  } else {
    // Sideways — range trade
    entryPrice = Math.round((low + atr * 0.2) * 100) / 100;
    exitPrice = Math.round((high - atr * 0.2) * 100) / 100;
    stopLoss = Math.round((low - atr * 0.5) * 100) / 100;
  }

  const risk = Math.abs(entryPrice - stopLoss);
  const reward = Math.abs(exitPrice - entryPrice);
  const riskReward = risk > 0 ? Math.round((reward / risk) * 100) / 100 : 0;

  return { entryPrice, exitPrice, stopLoss, riskReward };
}

// ========== SIGNAL SCORING ==========
function calcSignalScore(rsi: number, macd: number, change: number, trendStrength: number, rr: number): { signal: IntradaySignal['signal']; score: number; confidence: number } {
  let s = 0;
  // RSI
  if (rsi >= 30 && rsi <= 45) s += 25; // Oversold bounce
  else if (rsi >= 45 && rsi <= 60) s += 20;
  else if (rsi > 70) s -= 10;
  else if (rsi < 25) s += 15;
  else s += 10;
  // MACD
  if (macd > 0) s += 20; else s += 5;
  // Change
  if (change > 1) s += 15; else if (change > 0) s += 10; else if (change > -1) s += 5;
  // Trend
  s += Math.round(trendStrength * 0.3);
  // R:R
  if (rr >= 2.5) s += 15; else if (rr >= 1.5) s += 10; else s += 3;

  const score = Math.min(100, Math.max(0, s));
  let signal: IntradaySignal['signal'];
  if (score >= 80) signal = 'STRONG_BUY';
  else if (score >= 60) signal = 'BUY';
  else if (score >= 40) signal = 'HOLD';
  else if (score >= 25) signal = 'SELL';
  else signal = 'STRONG_SELL';

  const confidence = Math.min(97, Math.max(75, 80 + Math.round(score * 0.15)));
  return { signal, score, confidence };
}

// ========== FETCH NSE INTRADAY DATA ==========
export async function fetchNseIntradayData(): Promise<IntradaySignal[]> {
  const tickers = NSE_INTRADAY_STOCKS.map(s => `NSE:${s.sym}`);
  const columns = ['name', 'close', 'change', 'high', 'low', 'volume', 'SMA20', 'SMA50', 'RSI', 'MACD.macd'];

  try {
    const res = await fetch('https://scanner.tradingview.com/india/scan', {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=UTF-8' },
      body: JSON.stringify({ symbols: { tickers }, columns }),
      signal: AbortSignal.timeout(8000)
    });
    if (!res.ok) return [];
    const data = await res.json();
    if (!data?.data) return [];

    const results: IntradaySignal[] = [];
    for (const item of data.data) {
      if (!item.d || item.d[1] === null) continue;
      const sym = item.s.split(':')[1];
      const meta = NSE_INTRADAY_STOCKS.find(s => s.sym === sym);
      if (!meta) continue;

      const price = parseFloat(item.d[1]) || 0;
      if (price <= 0) continue;
      const change = parseFloat(item.d[2]) || 0;
      const high = parseFloat(item.d[3]) || price;
      const low = parseFloat(item.d[4]) || price;
      const volume = parseFloat(item.d[5]) || 0;
      const sma20 = parseFloat(item.d[6]) || price;
      const sma50 = parseFloat(item.d[7]) || price;
      const rsi = parseFloat(item.d[8]) || 50;
      const macd = parseFloat(item.d[9]) || 0;

      const atr = (high - low) || price * 0.015;
      const vwap = (high + low + price) / 3;
      const pivots = calcPivots(high, low, price);
      const { trend, strength } = detectTrend(price, sma20, sma50, rsi, macd, change);
      const ee = calcEntryExit(price, high, low, rsi, sma20, atr, trend);
      const sig = calcSignalScore(rsi, macd, change, strength, ee.riskReward);

      // AI Reasoning
      const reasons: string[] = [];
      if (trend === 'STRONG_UP') reasons.push('🔥 Strong Uptrend');
      else if (trend === 'UP') reasons.push('📈 Uptrend Active');
      else if (trend === 'DOWN') reasons.push('📉 Downtrend');
      else if (trend === 'STRONG_DOWN') reasons.push('⚠️ Strong Downtrend');
      else reasons.push('↔️ Sideways Consolidation');
      if (rsi < 35) reasons.push('Oversold Zone — Bounce Expected');
      if (rsi > 70) reasons.push('Overbought — Profit Book Karo');
      if (macd > 0 && sma20 > sma50) reasons.push('Bullish Crossover Active');
      if (ee.riskReward >= 2) reasons.push(`R:R ${ee.riskReward}x — High Reward Setup`);
      reasons.push(`Vol: ${volume > 5e6 ? 'High' : volume > 1e6 ? 'Normal' : 'Low'}`);

      results.push({
        symbol: sym, name: meta.name, market: 'IN',
        category: 'NSE_STOCK', price, change, high, low, volume,
        rsi, sma20, sma50, macd,
        entryPrice: ee.entryPrice, exitPrice: ee.exitPrice,
        stopLoss: ee.stopLoss, riskReward: ee.riskReward,
        trend, trendStrength: strength,
        signal: sig.signal, signalScore: sig.score, confidence: sig.confidence,
        vwap, atr,
        pivotPoint: Math.round(pivots.pp * 100) / 100,
        support1: Math.round(pivots.s1 * 100) / 100,
        support2: Math.round(pivots.s2 * 100) / 100,
        resistance1: Math.round(pivots.r1 * 100) / 100,
        resistance2: Math.round(pivots.r2 * 100) / 100,
        aiReasoning: reasons.slice(0, 4).join(' | '),
        timestamp: Date.now()
      });
    }
    return results.sort((a, b) => b.signalScore - a.signalScore);
  } catch (e) {
    console.warn('NSE intraday fetch failed:', e);
    return [];
  }
}

// ========== FETCH COINDCX FUTURES DATA ==========
export async function fetchCoinDcxFutures(): Promise<IntradaySignal[]> {
  try {
    const res = await fetch(`https://api.coindcx.com/exchange/ticker?t=${Date.now()}`, {
      signal: AbortSignal.timeout(6000)
    });
    if (!res.ok) return [];
    const tickers = await res.json();

    const results: IntradaySignal[] = [];
    for (const meta of COINDCX_FUTURES) {
      const t = tickers.find((tk: any) => tk.market === meta.pair);
      if (!t || !t.last_price) continue;

      const price = parseFloat(t.last_price) || 0;
      if (price <= 0) continue;
      const change = parseFloat(t.change_24_hour) || 0;
      const high = parseFloat(t.high) || price;
      const low = parseFloat(t.low) || price;
      const volume = parseFloat(t.volume) || 0;

      const atr = (high - low) || price * 0.02;
      const sma20 = price * (1 + (change > 0 ? -0.01 : 0.01));
      const sma50 = price * (1 + (change > 0 ? -0.02 : 0.02));
      const rsi = Math.max(15, Math.min(85, 50 + change * 3));
      const macd = change > 0 ? atr * 0.3 : -atr * 0.3;
      const vwap = (high + low + price) / 3;
      const pivots = calcPivots(high, low, price);
      const { trend, strength } = detectTrend(price, sma20, sma50, rsi, macd, change);
      const ee = calcEntryExit(price, high, low, rsi, sma20, atr, trend);
      const sig = calcSignalScore(rsi, macd, change, strength, ee.riskReward);

      const reasons: string[] = [];
      if (trend === 'STRONG_UP' || trend === 'UP') reasons.push('🟢 Bullish Momentum');
      else if (trend === 'DOWN' || trend === 'STRONG_DOWN') reasons.push('🔴 Bearish Pressure');
      else reasons.push('🟡 Range Bound');
      if (Math.abs(change) > 3) reasons.push('⚡ High Volatility');
      reasons.push(`24h Vol: ₹${(volume * price / 1e7).toFixed(1)}Cr`);
      if (ee.riskReward >= 2) reasons.push(`R:R ${ee.riskReward}x Setup`);

      results.push({
        symbol: meta.sym, name: meta.name, market: 'CRYPTO',
        category: 'COINDCX_FUTURES', price, change, high, low, volume,
        rsi, sma20, sma50, macd,
        entryPrice: ee.entryPrice, exitPrice: ee.exitPrice,
        stopLoss: ee.stopLoss, riskReward: ee.riskReward,
        trend, trendStrength: strength,
        signal: sig.signal, signalScore: sig.score, confidence: sig.confidence,
        vwap, atr,
        pivotPoint: Math.round(pivots.pp * 100) / 100,
        support1: Math.round(pivots.s1 * 100) / 100,
        support2: Math.round(pivots.s2 * 100) / 100,
        resistance1: Math.round(pivots.r1 * 100) / 100,
        resistance2: Math.round(pivots.r2 * 100) / 100,
        aiReasoning: reasons.slice(0, 4).join(' | '),
        timestamp: Date.now()
      });
    }
    return results.sort((a, b) => b.signalScore - a.signalScore);
  } catch (e) {
    console.warn('CoinDCX futures fetch failed:', e);
    return [];
  }
}

// ========== COMBINED SCANNER ==========
export async function runIntradayProScan(): Promise<IntradaySignal[]> {
  const [nse, crypto] = await Promise.allSettled([
    fetchNseIntradayData(),
    fetchCoinDcxFutures()
  ]);
  const nseData = nse.status === 'fulfilled' ? nse.value : [];
  const cryptoData = crypto.status === 'fulfilled' ? crypto.value : [];
  return [...nseData, ...cryptoData].sort((a, b) => b.signalScore - a.signalScore);
}

// ========== GROQ AI ANALYSIS ==========
export async function getIntradayAiAnalysis(signals: IntradaySignal[], top = 5): Promise<Record<string, string>> {
  const topSignals = signals.slice(0, top);
  const summary = topSignals.map((s, i) =>
    `${i + 1}. ${s.symbol} (${s.category}) — ₹${s.price.toFixed(2)} | ${s.change > 0 ? '+' : ''}${s.change.toFixed(2)}% | RSI: ${s.rsi.toFixed(0)} | Signal: ${s.signal} (${s.signalScore}/100) | Trend: ${s.trend} (${s.trendStrength}%) | Entry: ₹${s.entryPrice} | Exit: ₹${s.exitPrice} | SL: ₹${s.stopLoss} | R:R: ${s.riskReward}x | VWAP: ₹${s.vwap.toFixed(2)} | Pivot: ₹${s.pivotPoint} | S1: ₹${s.support1} | R1: ₹${s.resistance1}`
  ).join('\n');

  const systemPrompt = `You are DEEPMIND AI QUANTUM — India's #1 Intraday Trading Expert. 20+ years experience at top prop trading desks. You analyze INTRADAY setups for SAME-DAY profits.

RULES:
1. Analyze each in 3-4 lines MAX. Use Pro Trader Hinglish.
2. Give: Conviction (1-10), EXACT Entry Price, EXACT Exit Price, Stop Loss, Intraday Target.
3. Focus on INTRADAY setups — 15min to 4hr timeframes.
4. Use VWAP, Pivot Points, Support/Resistance for entries.
5. End each with: 🟢 STRONG BUY / 🔵 BUY / 🟡 HOLD / 🔴 AVOID
6. Today: ${new Date().toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata' })}.`;

  const userPrompt = `Analyze these top AI-picked INTRADAY setups. Give separate analysis per stock/crypto:\n\n${summary}\n\nFormat: **SYMBOL**: analysis`;

  try {
    const PROXY_BASE = (import.meta as any).env?.VITE_API_PROXY || '';
    const res = await fetch(`${PROXY_BASE}/api/groq`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'llama-3.3-70b-versatile',
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt }
        ],
        temperature: 0.7, max_tokens: 2500
      }),
      signal: AbortSignal.timeout(20000)
    });
    if (!res.ok) return {};
    const data = await res.json();
    const text = data.choices?.[0]?.message?.content || '';
    if (!text || text.length < 10) return {};

    const analyses: Record<string, string> = {};
    for (const s of topSignals) {
      const regex = new RegExp(`\\*\\*${s.symbol}\\*\\*[:\\s]*([\\s\\S]*?)(?=\\*\\*[A-Z]|$)`, 'i');
      const match = text.match(regex);
      if (match) analyses[s.symbol] = match[1].trim();
    }
    if (Object.keys(analyses).length === 0 && text.length > 10) {
      analyses[topSignals[0].symbol] = text.substring(0, 600);
    }
    return analyses;
  } catch (e) {
    console.warn('Intraday AI analysis failed:', e);
    return {};
  }
}

// ========== TELEGRAM FORMATTER ==========
export function formatIntradayTelegram(signals: IntradaySignal[], category?: 'ALL' | 'NSE_STOCK' | 'COINDCX_FUTURES'): string {
  const filtered = !category || category === 'ALL' ? signals : signals.filter(s => s.category === category);
  const top = filtered.slice(0, 12);
  const time = new Date().toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit' });

  let msg = `⚡ <b>INTRADAY PRO TRADING SIGNALS</b>\n`;
  msg += `🧠 <i>DeepMind AI Quantum Engine</i>\n`;
  msg += `⏰ <i>${time} IST</i>\n━━━━━━━━━━━━━━━━━━━━━━━\n\n`;

  const buys = top.filter(s => s.signal === 'STRONG_BUY' || s.signal === 'BUY');
  const holds = top.filter(s => s.signal === 'HOLD');
  const sells = top.filter(s => s.signal === 'SELL' || s.signal === 'STRONG_SELL');

  const fmt = (s: IntradaySignal) => {
    let l = `• <b>${s.symbol}</b> (${s.category === 'COINDCX_FUTURES' ? '₿ Futures' : '🇮🇳 NSE'})\n`;
    l += `  Price: ₹${s.price.toFixed(2)} | ${s.change > 0 ? '+' : ''}${s.change.toFixed(2)}%\n`;
    l += `  🎯 Entry: <b>₹${s.entryPrice}</b> → Exit: <b>₹${s.exitPrice}</b>\n`;
    l += `  🛑 SL: ₹${s.stopLoss} | R:R: ${s.riskReward}x\n`;
    l += `  📊 Trend: ${s.trend} | Score: ${s.signalScore}/100\n`;
    return l;
  };

  if (buys.length) { msg += `🟢 <b>BUY SIGNALS</b>\n`; buys.forEach(s => { msg += fmt(s) + '\n'; }); }
  if (holds.length) { msg += `🟡 <b>HOLD / WAIT</b>\n`; holds.forEach(s => { msg += fmt(s) + '\n'; }); }
  if (sells.length) { msg += `🔴 <b>SELL / AVOID</b>\n`; sells.forEach(s => { msg += fmt(s) + '\n'; }); }

  msg += `\n━━━━━━━━━━━━━━━━━━━━━━━\n`;
  msg += `<i>🧠 DeepMind AI Quantum | Intraday Pro Expert</i>`;
  return msg;
}
