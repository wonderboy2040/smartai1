// ============================================
// ADVANCE PRO TRADING ENGINE — FUTURES & INTRADAY
// Short-term signals: Crypto + US + India
// Uses FuturesTradeSignal from types/index.ts
// ============================================

import { FuturesTradeSignal, PriceData } from '../types';

// ========== TRADING UNIVERSE ==========
export interface TradingAsset {
  sym: string;
  name: string;
  market: 'CRYPTO' | 'US' | 'IN';
  sector: string;
  avgATR: number;   // typical daily ATR %
  maxLev: number;   // max leverage suggestion
}

export const TRADING_CRYPTO: TradingAsset[] = [
  { sym: 'BTC', name: 'Bitcoin', market: 'CRYPTO', sector: 'Layer 1', avgATR: 3.5, maxLev: 10 },
  { sym: 'ETH', name: 'Ethereum', market: 'CRYPTO', sector: 'Layer 1', avgATR: 4.2, maxLev: 10 },
  { sym: 'SOL', name: 'Solana', market: 'CRYPTO', sector: 'Layer 1', avgATR: 6.0, maxLev: 8 },
  { sym: 'BNB', name: 'BNB', market: 'CRYPTO', sector: 'Exchange', avgATR: 3.8, maxLev: 8 },
  { sym: 'XRP', name: 'Ripple', market: 'CRYPTO', sector: 'Payments', avgATR: 5.0, maxLev: 8 },
  { sym: 'DOGE', name: 'Dogecoin', market: 'CRYPTO', sector: 'Meme', avgATR: 7.0, maxLev: 5 },
  { sym: 'AVAX', name: 'Avalanche', market: 'CRYPTO', sector: 'Layer 1', avgATR: 5.5, maxLev: 5 },
  { sym: 'LINK', name: 'Chainlink', market: 'CRYPTO', sector: 'Oracle', avgATR: 5.0, maxLev: 5 },
];

export const TRADING_US: TradingAsset[] = [
  { sym: 'NVDA', name: 'NVIDIA', market: 'US', sector: 'Semis', avgATR: 3.5, maxLev: 5 },
  { sym: 'TSLA', name: 'Tesla', market: 'US', sector: 'EV', avgATR: 4.0, maxLev: 5 },
  { sym: 'AAPL', name: 'Apple', market: 'US', sector: 'Tech', avgATR: 1.8, maxLev: 5 },
  { sym: 'META', name: 'Meta', market: 'US', sector: 'Social', avgATR: 2.8, maxLev: 5 },
  { sym: 'AMD', name: 'AMD', market: 'US', sector: 'Semis', avgATR: 3.5, maxLev: 5 },
  { sym: 'COIN', name: 'Coinbase', market: 'US', sector: 'Crypto', avgATR: 5.0, maxLev: 3 },
  { sym: 'PLTR', name: 'Palantir', market: 'US', sector: 'AI', avgATR: 4.0, maxLev: 3 },
  { sym: 'MSFT', name: 'Microsoft', market: 'US', sector: 'Tech', avgATR: 1.5, maxLev: 5 },
  { sym: 'AMZN', name: 'Amazon', market: 'US', sector: 'E-Com', avgATR: 2.2, maxLev: 5 },
  { sym: 'GOOGL', name: 'Alphabet', market: 'US', sector: 'Tech', avgATR: 2.0, maxLev: 5 },
];

export const TRADING_IN: TradingAsset[] = [
  { sym: 'RELIANCE', name: 'Reliance', market: 'IN', sector: 'Conglomerate', avgATR: 1.8, maxLev: 5 },
  { sym: 'TATAMOTORS', name: 'Tata Motors', market: 'IN', sector: 'Auto', avgATR: 2.5, maxLev: 5 },
  { sym: 'BAJFINANCE', name: 'Bajaj Finance', market: 'IN', sector: 'NBFC', avgATR: 2.2, maxLev: 5 },
  { sym: 'ADANIENT', name: 'Adani Ent', market: 'IN', sector: 'Conglomerate', avgATR: 3.5, maxLev: 3 },
  { sym: 'SBIN', name: 'SBI', market: 'IN', sector: 'Banking', avgATR: 2.0, maxLev: 5 },
  { sym: 'ICICIBANK', name: 'ICICI Bank', market: 'IN', sector: 'Banking', avgATR: 1.8, maxLev: 5 },
  { sym: 'HDFCBANK', name: 'HDFC Bank', market: 'IN', sector: 'Banking', avgATR: 1.5, maxLev: 5 },
  { sym: 'INFY', name: 'Infosys', market: 'IN', sector: 'IT', avgATR: 1.8, maxLev: 5 },
];

// ========== LIVE DATA FETCH FOR TRADING ==========
export async function fetchTradingPrices(): Promise<Record<string, PriceData>> {
  const results: Record<string, PriceData> = {};
  const columns = ['name', 'close', 'change', 'high', 'low', 'volume', 'SMA20', 'SMA50', 'RSI', 'MACD.macd', 'ATR', 'BB.upper', 'BB.lower'];

  const inTickers = TRADING_IN.map(s => `NSE:${s.sym}`);
  const usTickers = TRADING_US.map(s => {
    const exMap: Record<string, string> = {
      'NVDA': 'NASDAQ', 'TSLA': 'NASDAQ', 'AAPL': 'NASDAQ', 'META': 'NASDAQ',
      'AMD': 'NASDAQ', 'COIN': 'NASDAQ', 'PLTR': 'NASDAQ', 'MSFT': 'NASDAQ',
      'AMZN': 'NASDAQ', 'GOOGL': 'NASDAQ'
    };
    return `${exMap[s.sym] || 'NASDAQ'}:${s.sym}`;
  });
  const cryptoTickers = TRADING_CRYPTO.map(s => `BINANCE:${s.sym}USDT`);

  const scanBatch = async (endpoint: string, tickers: string[], market: 'CRYPTO' | 'US' | 'IN') => {
    try {
      const res = await fetch(`https://scanner.tradingview.com/${endpoint}/scan`, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain;charset=UTF-8' },
        body: JSON.stringify({ symbols: { tickers }, columns }),
        signal: AbortSignal.timeout(8000)
      });
      if (res.ok) {
        const data = await res.json();
        if (data?.data) {
          for (const item of data.data) {
            if (!item.d || item.d[1] === null) continue;
            let sym = item.s.split(':')[1];
            if (market === 'CRYPTO') sym = sym.replace('USDT', '');
            const price = parseFloat(item.d[1]);
            if (isNaN(price) || price <= 0) continue;
            results[`${market}_${sym}`] = {
              price,
              change: parseFloat(item.d[2]) || 0,
              high: parseFloat(item.d[3]) || price,
              low: parseFloat(item.d[4]) || price,
              volume: parseFloat(item.d[5]) || 0,
              sma20: parseFloat(item.d[6]) || undefined,
              sma50: parseFloat(item.d[7]) || undefined,
              rsi: parseFloat(item.d[8]) || 50,
              macd: parseFloat(item.d[9]) || undefined,
              time: Date.now(),
              market: market === 'CRYPTO' ? 'IN' : market,
              tvExchange: item.s.split(':')[0],
              tvExactSymbol: item.s
            };
          }
        }
      }
    } catch (e) { console.warn(`Trading scan ${endpoint} failed:`, e); }
  };

  await Promise.allSettled([
    scanBatch('india', inTickers, 'IN'),
    scanBatch('america', usTickers, 'US'),
    scanBatch('crypto', cryptoTickers, 'CRYPTO'),
  ]);
  return results;
}

// ========== SCORING ENGINE — OPTIMIZED FOR SHORT-TERM ==========
function calcTechScore(rsi: number, sma20: number, sma50: number, macd: number, price: number): number {
  let s = 0;
  // RSI sweet spot for trading (0-25)
  if (rsi >= 30 && rsi <= 40) s += 25;       // Oversold bounce
  else if (rsi >= 60 && rsi <= 70) s += 22;   // Strong momentum
  else if (rsi >= 40 && rsi <= 60) s += 15;   // Neutral
  else if (rsi < 30) s += 20;                 // Deep oversold
  else s += 8;                                // Overbought
  // MACD (0-25)
  if (macd > 0.5) s += 25;
  else if (macd > 0) s += 18;
  else if (macd > -0.5) s += 10;
  else s += 5;
  // SMA crossover (0-25)
  if (sma20 > 0 && sma50 > 0) {
    const cross = ((sma20 - sma50) / sma50) * 100;
    if (cross > 2) s += 25;
    else if (cross > 0) s += 18;
    else if (cross > -2) s += 10;
    else s += 4;
  } else s += 12;
  // Price vs SMA20 (0-25)
  if (sma20 > 0) {
    const dist = ((price - sma20) / sma20) * 100;
    if (dist > 0 && dist < 3) s += 25;     // Just above — ideal
    else if (dist < 0 && dist > -3) s += 22; // Just below — bounce
    else if (dist > 3) s += 12;
    else s += 8;
  } else s += 12;
  return Math.min(100, s);
}

function calcMomentumScore(change: number, rsi: number, volume: number): number {
  let s = 0;
  // Price change (0-40)
  const absChange = Math.abs(change);
  if (absChange > 5) s += 40;
  else if (absChange > 3) s += 32;
  else if (absChange > 1.5) s += 24;
  else if (absChange > 0.5) s += 16;
  else s += 8;
  // RSI momentum direction (0-30)
  if (rsi > 55 && rsi < 75) s += 30;
  else if (rsi > 40 && rsi <= 55) s += 20;
  else if (rsi < 35) s += 25;  // Reversal momentum
  else s += 10;
  // Volume surge (0-30)
  if (volume > 10_000_000) s += 30;
  else if (volume > 5_000_000) s += 22;
  else if (volume > 1_000_000) s += 15;
  else s += 8;
  return Math.min(100, s);
}

function calcVolatilityScore(high: number, low: number, price: number, avgATR: number): number {
  const atrPct = price > 0 ? ((high - low) / price) * 100 : avgATR;
  let s = 0;
  // Higher volatility = better for trading (0-60)
  if (atrPct > 5) s += 60;
  else if (atrPct > 3) s += 48;
  else if (atrPct > 2) s += 36;
  else if (atrPct > 1) s += 24;
  else s += 12;
  // ATR vs average (0-40)
  if (atrPct > avgATR * 1.3) s += 40;       // Above average volatility
  else if (atrPct > avgATR * 0.8) s += 28;
  else s += 15;
  return Math.min(100, s);
}

function calcSentimentScoreTrading(vixAvg: number, change: number): number {
  let s = 50;
  // For trading: high VIX = MORE opportunity, not less
  if (vixAvg > 25) s += 30;       // Max volatility = max opportunity
  else if (vixAvg > 20) s += 20;
  else if (vixAvg > 15) s += 10;
  else s += 5;                    // Low VIX = less trading opportunity
  if (Math.abs(change) > 3) s += 20;
  else if (Math.abs(change) > 1) s += 10;
  return Math.max(0, Math.min(100, s));
}

// ========== MAIN TRADING SCANNER ==========
export function runTradingScan(
  prices: Record<string, PriceData>,
  usVix: number = 15,
  inVix: number = 15
): FuturesTradeSignal[] {
  const results: FuturesTradeSignal[] = [];
  const avgVix = (usVix + inVix) / 2;
  const allAssets = [...TRADING_CRYPTO, ...TRADING_US, ...TRADING_IN];

  for (const asset of allAssets) {
    const key = `${asset.market}_${asset.sym}`;
    const pd = prices[key];
    if (!pd || pd.price <= 0) continue;

    const price = pd.price;
    const change = pd.change || 0;
    const rsi = pd.rsi || 50;
    const sma20 = pd.sma20 || price;
    const sma50 = pd.sma50 || price;
    const macd = pd.macd || 0;
    const volume = pd.volume || 0;
    const high = pd.high || price;
    const low = pd.low || price;
    const atr = (high - low) || price * (asset.avgATR / 100);

    // Multi-factor scoring
    const technicalScore = calcTechScore(rsi, sma20, sma50, macd, price);
    const momentumScore = calcMomentumScore(change, rsi, volume);
    const volatilityScore = calcVolatilityScore(high, low, price, asset.avgATR);
    const sentimentScore = calcSentimentScoreTrading(avgVix, change);

    // Weighted composite: Tech 40% + Mom 30% + Vol 20% + Sent 10%
    const aiScore = Math.round(
      technicalScore * 0.40 +
      momentumScore * 0.30 +
      volatilityScore * 0.20 +
      sentimentScore * 0.10
    );

    // Direction detection
    const bullSignals = [
      rsi < 45 && rsi > 25,
      macd > 0,
      sma20 > sma50,
      change > 0.5,
      price > sma20
    ].filter(Boolean).length;
    const bearSignals = [
      rsi > 65,
      macd < 0,
      sma20 < sma50,
      change < -0.5,
      price < sma20
    ].filter(Boolean).length;

    const isLong = bullSignals >= bearSignals;
    const direction: 'LONG' | 'SHORT' = isLong ? 'LONG' : 'SHORT';

    // Entry/Target/SL using ATR
    const entryPrice = price;
    const slDistance = atr * 1.5;
    const stopLoss = isLong ? price - slDistance : price + slDistance;
    const target1 = isLong ? price + atr * 2 : price - atr * 2;
    const target2 = isLong ? price + atr * 3.5 : price - atr * 3.5;
    const target3 = isLong ? price + atr * 5 : price - atr * 5;

    // Risk-Reward
    const riskPercent = (slDistance / price) * 100;
    const potentialReturn = ((Math.abs(target1 - price)) / price) * 100;
    const riskReward = riskPercent > 0 ? potentialReturn / riskPercent : 1;

    // Only show R:R >= 2.0
    if (riskReward < 2) continue;

    // Conviction
    const conviction = Math.min(99, Math.max(80, Math.round(aiScore * 1.1)));

    // Signal strength
    let signal: FuturesTradeSignal['signal'];
    if (isLong && aiScore >= 70) signal = 'STRONG_LONG';
    else if (isLong) signal = 'LONG';
    else if (!isLong && aiScore >= 70) signal = 'STRONG_SHORT';
    else signal = 'SHORT';

    // Leverage suggestion based on conviction & volatility
    const volFactor = asset.avgATR > 4 ? 0.5 : asset.avgATR > 2.5 ? 0.7 : 1;
    const leverage = Math.min(asset.maxLev, Math.max(2, Math.round(aiScore / 20 * volFactor)));

    // Timeframe
    let timeframe: FuturesTradeSignal['timeframe'] = 'SWING_1_3D';
    if (asset.market === 'CRYPTO' && Math.abs(change) > 3) timeframe = 'INTRADAY';
    else if (aiScore > 75) timeframe = 'INTRADAY';
    else if (aiScore < 50) timeframe = 'SWING_3_7D';

    // Hinglish action
    const actionMap: Record<string, string> = {
      'STRONG_LONG': `🟢 BHAI FULL SEND — ${asset.sym} LONG karo ${leverage}x leverage pe!`,
      'LONG': `🟢 SIP Mode — ${asset.sym} LONG dheere entry karo`,
      'STRONG_SHORT': `🔴 BHAI SHORT KARO — ${asset.sym} girega ${leverage}x pe!`,
      'SHORT': `🔴 HEDGE — ${asset.sym} SHORT light position`,
    };

    // Reasoning
    const reasons: string[] = [];
    if (rsi < 35) reasons.push(`RSI ${rsi.toFixed(0)} OVERSOLD — reversal zone`);
    else if (rsi > 70) reasons.push(`RSI ${rsi.toFixed(0)} OVERBOUGHT — short setup`);
    if (macd > 0 && isLong) reasons.push('MACD bullish crossover');
    if (macd < 0 && !isLong) reasons.push('MACD bearish divergence');
    if (sma20 > sma50 && isLong) reasons.push('Golden cross SMA20>SMA50');
    if (Math.abs(change) > 3) reasons.push(`${Math.abs(change).toFixed(1)}% move — momentum surge`);
    if (volume > 5_000_000) reasons.push('Volume spike detected');

    // BB Width
    const bbWidth = price > 0 ? ((high - low) / price) * 100 : 2;

    results.push({
      symbol: asset.sym,
      name: asset.name,
      market: asset.market,
      sector: asset.sector,
      currentPrice: price,
      entryPrice,
      target1, target2, target3,
      stopLoss,
      direction, leverage, timeframe,
      technicalScore, momentumScore, volatilityScore, sentimentScore,
      aiScore, conviction,
      riskReward: Math.round(riskReward * 10) / 10,
      riskPercent: Math.round(riskPercent * 10) / 10,
      potentialReturn: Math.round(potentialReturn * 10) / 10,
      signal,
      actionHinglish: actionMap[signal] || `${asset.sym} — ${signal}`,
      reasoningHinglish: reasons.slice(0, 3).join(' | ') || 'Multi-factor AI analysis',
      rsi, macd, sma20, sma50,
      atr, bbWidth, volume, change,
    });
  }

  return results.sort((a, b) => b.aiScore - a.aiScore);
}

// ========== GEMINI 3.5 FLASH — TRADE ANALYSIS ==========
export async function getGeminiTradeAnalysis(
  signals: FuturesTradeSignal[],
  top: number = 5
): Promise<Record<string, string>> {
  const apiKey = import.meta.env.VITE_GEMINI_API_KEY || '';
  if (!apiKey || apiKey.length < 10) return {};

  const topSignals = signals.slice(0, top);
  const summary = topSignals.map((s, i) =>
    `${i + 1}. ${s.symbol} (${s.market}) ${s.direction} — $${s.currentPrice.toFixed(2)} | AI: ${s.aiScore} | RSI: ${s.rsi.toFixed(0)} | MACD: ${s.macd.toFixed(2)} | R:R ${s.riskReward}:1 | Entry: $${s.entryPrice.toFixed(2)} | SL: $${s.stopLoss.toFixed(2)} | T1: $${s.target1.toFixed(2)} | T2: $${s.target2.toFixed(2)} | Lev: ${s.leverage}x | ${s.reasoningHinglish}`
  ).join('\n');

  const prompt = `You are QUANTUM TRADE AI — an elite SHORT-TERM futures/intraday trader at Citadel and Jane Street. Analyze these trade setups for DAILY PROFIT.

RULES:
1. Each trade analysis in 3-4 lines MAX. Use Pro Trader Hinglish.
2. Give: Conviction (1-10), Key Catalyst, Entry Zone, Exact SL, 3 Targets, Risk.
3. Be SPECIFIC with price levels. Focus on R:R 2:1+ setups.
4. Use SMC, Order Flow, Wyckoff, Fibonacci for analysis.
5. Today: ${new Date().toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata' })}.
6. End with emoji: 🟢 LONG / 🔴 SHORT / 🟡 SKIP`;

  try {
    const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash:generateContent?key=${apiKey}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [
          { role: 'user', parts: [{ text: prompt }] },
          { role: 'model', parts: [{ text: 'QUANTUM TRADE AI active. Ready for institutional-grade trade analysis.' }] },
          { role: 'user', parts: [{ text: `Analyze:\n${summary}\n\nFormat: **SYMBOL**: analysis` }] }
        ],
        generationConfig: { temperature: 0.7, maxOutputTokens: 3000, topP: 0.95 },
        safetySettings: [
          { category: 'HARM_CATEGORY_HARASSMENT', threshold: 'BLOCK_ONLY_HIGH' },
          { category: 'HARM_CATEGORY_HATE_SPEECH', threshold: 'BLOCK_ONLY_HIGH' },
          { category: 'HARM_CATEGORY_SEXUALLY_EXPLICIT', threshold: 'BLOCK_ONLY_HIGH' },
          { category: 'HARM_CATEGORY_DANGEROUS_CONTENT', threshold: 'BLOCK_ONLY_HIGH' }
        ]
      }),
      signal: AbortSignal.timeout(25000)
    });
    if (!res.ok) return {};
    const data = await res.json();
    const text = data.candidates?.[0]?.content?.parts?.[0]?.text || '';
    const analyses: Record<string, string> = {};
    for (const sig of topSignals) {
      const regex = new RegExp(`\\*\\*${sig.symbol}\\*\\*[:\\s]*([\\s\\S]*?)(?=\\*\\*[A-Z]|$)`, 'i');
      const match = text.match(regex);
      if (match) analyses[sig.symbol] = match[1].trim();
    }
    if (Object.keys(analyses).length === 0 && text.length > 10) {
      analyses[topSignals[0].symbol] = text.substring(0, 500);
    }
    return analyses;
  } catch (e) {
    console.warn('Gemini trade analysis failed:', e);
    return {};
  }
}

// ========== TELEGRAM TRADE ALERT ==========
export function formatTradingTelegram(signals: FuturesTradeSignal[], market?: 'CRYPTO' | 'US' | 'IN' | 'ALL'): string {
  const filtered = market && market !== 'ALL' ? signals.filter(s => s.market === market) : signals;
  const top = filtered.slice(0, 10);
  const time = new Date().toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit' });

  let msg = `⚡ <b>QUANTUM TRADE SIGNALS</b>\n`;
  msg += `⏰ <i>${time} IST</i> | <code>Daily Profit Mode</code>\n`;
  msg += `━━━━━━━━━━━━━━━━━━━━━━━\n\n`;

  const longs = top.filter(s => s.direction === 'LONG');
  const shorts = top.filter(s => s.direction === 'SHORT');

  const fmt = (s: FuturesTradeSignal) => {
    const cur = s.market === 'IN' ? '₹' : '$';
    let line = `• <b>${s.symbol}</b> ${s.direction === 'LONG' ? '🟢' : '🔴'} ${s.direction} ${s.leverage}x\n`;
    line += `  Price: <b>${cur}${s.currentPrice.toFixed(2)}</b> (${s.change >= 0 ? '+' : ''}${s.change.toFixed(1)}%)\n`;
    line += `  Entry: ${cur}${s.entryPrice.toFixed(2)} | SL: ${cur}${s.stopLoss.toFixed(2)}\n`;
    line += `  T1: <b>${cur}${s.target1.toFixed(2)}</b> | T2: ${cur}${s.target2.toFixed(2)} | T3: ${cur}${s.target3.toFixed(2)}\n`;
    line += `  AI: ${s.aiScore}/100 | R:R ${s.riskReward}:1 | Return: +${s.potentialReturn}%\n`;
    if (s.geminiAnalysis) line += `  🤖 <i>${s.geminiAnalysis.substring(0, 100)}</i>\n`;
    return line;
  };

  if (longs.length > 0) {
    msg += `🟢 <b>LONG SETUPS</b>\n`;
    longs.forEach(s => { msg += fmt(s) + '\n'; });
  }
  if (shorts.length > 0) {
    msg += `🔴 <b>SHORT SETUPS</b>\n`;
    shorts.forEach(s => { msg += fmt(s) + '\n'; });
  }

  msg += `━━━━━━━━━━━━━━━━━━━━━━━\n`;
  msg += `<i>⚡ Quantum Trade AI | Tech 40% + Mom 30% + Vol 20% + Sent 10%</i>`;
  return msg;
}
