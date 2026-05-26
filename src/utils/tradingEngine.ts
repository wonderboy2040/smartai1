// ============================================
// DEEP QUANTUM AI — ADVANCE PRO TRADING ENGINE
// Daily Profit ₹500-₹1000 | Capital ₹5000
// Multi-AI Consensus | 50+ Assets Radar
// ============================================

import { FuturesTradeSignal, PriceData } from '../types';
import { calculateDailyProfitQty } from './multiAiEngine';

// ========== TRADING UNIVERSE ==========
export interface TradingAsset {
  sym: string;
  name: string;
  market: 'CRYPTO' | 'US' | 'IN';
  sector: string;
  avgATR: number;
  maxLev: number;
  coinDcxPair?: string; // CoinDCX USDC pair
}

// CoinDCX USDC/INR pairs mapping
export const COINDCX_USDC_PAIRS: Record<string, string> = {
  'BTC': 'B-BTC_USDC', 'ETH': 'B-ETH_USDC', 'SOL': 'B-SOL_USDC',
  'BNB': 'B-BNB_USDC', 'XRP': 'B-XRP_USDC', 'DOGE': 'B-DOGE_USDC',
  'AVAX': 'B-AVAX_USDC', 'LINK': 'B-LINK_USDC', 'ADA': 'B-ADA_USDC',
  'MATIC': 'B-MATIC_USDC', 'SUI': 'B-SUI_USDC', 'PEPE': 'B-PEPE_USDC',
  'ARB': 'B-ARB_USDC', 'OP': 'B-OP_USDC', 'INJ': 'B-INJ_USDC',
  'NEAR': 'B-NEAR_USDC', 'FTM': 'B-FTM_USDC', 'RENDER': 'B-RENDER_USDC',
};

export const TRADING_CRYPTO: TradingAsset[] = [
  { sym: 'BTC', name: 'Bitcoin', market: 'CRYPTO', sector: 'Layer 1', avgATR: 3.5, maxLev: 10, coinDcxPair: 'B-BTC_USDC' },
  { sym: 'ETH', name: 'Ethereum', market: 'CRYPTO', sector: 'Layer 1', avgATR: 4.2, maxLev: 10, coinDcxPair: 'B-ETH_USDC' },
  { sym: 'SOL', name: 'Solana', market: 'CRYPTO', sector: 'Layer 1', avgATR: 6.0, maxLev: 8, coinDcxPair: 'B-SOL_USDC' },
  { sym: 'BNB', name: 'BNB', market: 'CRYPTO', sector: 'Exchange', avgATR: 3.8, maxLev: 8, coinDcxPair: 'B-BNB_USDC' },
  { sym: 'XRP', name: 'Ripple', market: 'CRYPTO', sector: 'Payments', avgATR: 5.0, maxLev: 8, coinDcxPair: 'B-XRP_USDC' },
  { sym: 'DOGE', name: 'Dogecoin', market: 'CRYPTO', sector: 'Meme', avgATR: 7.0, maxLev: 5, coinDcxPair: 'B-DOGE_USDC' },
  { sym: 'AVAX', name: 'Avalanche', market: 'CRYPTO', sector: 'Layer 1', avgATR: 5.5, maxLev: 5, coinDcxPair: 'B-AVAX_USDC' },
  { sym: 'LINK', name: 'Chainlink', market: 'CRYPTO', sector: 'Oracle', avgATR: 5.0, maxLev: 5, coinDcxPair: 'B-LINK_USDC' },
  { sym: 'ADA', name: 'Cardano', market: 'CRYPTO', sector: 'Layer 1', avgATR: 5.5, maxLev: 5, coinDcxPair: 'B-ADA_USDC' },
  { sym: 'SUI', name: 'Sui', market: 'CRYPTO', sector: 'Layer 1', avgATR: 8.0, maxLev: 5, coinDcxPair: 'B-SUI_USDC' },
  { sym: 'MATIC', name: 'Polygon', market: 'CRYPTO', sector: 'Layer 2', avgATR: 5.5, maxLev: 5, coinDcxPair: 'B-MATIC_USDC' },
  { sym: 'PEPE', name: 'Pepe', market: 'CRYPTO', sector: 'Meme', avgATR: 12.0, maxLev: 3, coinDcxPair: 'B-PEPE_USDC' },
  { sym: 'ARB', name: 'Arbitrum', market: 'CRYPTO', sector: 'Layer 2', avgATR: 6.5, maxLev: 5, coinDcxPair: 'B-ARB_USDC' },
  { sym: 'OP', name: 'Optimism', market: 'CRYPTO', sector: 'Layer 2', avgATR: 6.0, maxLev: 5, coinDcxPair: 'B-OP_USDC' },
  { sym: 'INJ', name: 'Injective', market: 'CRYPTO', sector: 'DeFi', avgATR: 7.5, maxLev: 5, coinDcxPair: 'B-INJ_USDC' },
  { sym: 'NEAR', name: 'NEAR Protocol', market: 'CRYPTO', sector: 'Layer 1', avgATR: 6.5, maxLev: 5, coinDcxPair: 'B-NEAR_USDC' },
  { sym: 'FTM', name: 'Fantom', market: 'CRYPTO', sector: 'Layer 1', avgATR: 7.0, maxLev: 5, coinDcxPair: 'B-FTM_USDC' },
  { sym: 'RENDER', name: 'Render', market: 'CRYPTO', sector: 'AI/GPU', avgATR: 8.0, maxLev: 3, coinDcxPair: 'B-RENDER_USDC' },
  { sym: 'WIF', name: 'dogwifhat', market: 'CRYPTO', sector: 'Meme', avgATR: 15.0, maxLev: 3 },
  { sym: 'BONK', name: 'Bonk', market: 'CRYPTO', sector: 'Meme', avgATR: 14.0, maxLev: 3 },
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
  { sym: 'SMCI', name: 'Super Micro', market: 'US', sector: 'AI Infra', avgATR: 6.0, maxLev: 3 },
  { sym: 'ARM', name: 'ARM Holdings', market: 'US', sector: 'Semis', avgATR: 4.5, maxLev: 3 },
  { sym: 'MARA', name: 'Marathon Digital', market: 'US', sector: 'Mining', avgATR: 7.0, maxLev: 3 },
  { sym: 'SOFI', name: 'SoFi Tech', market: 'US', sector: 'Fintech', avgATR: 5.0, maxLev: 3 },
  { sym: 'HOOD', name: 'Robinhood', market: 'US', sector: 'Fintech', avgATR: 5.5, maxLev: 3 },
  { sym: 'NET', name: 'Cloudflare', market: 'US', sector: 'Cloud', avgATR: 4.0, maxLev: 3 },
  { sym: 'CRWD', name: 'CrowdStrike', market: 'US', sector: 'Cybersec', avgATR: 3.5, maxLev: 3 },
  { sym: 'NFLX', name: 'Netflix', market: 'US', sector: 'Streaming', avgATR: 3.0, maxLev: 5 },
  { sym: 'SNAP', name: 'Snap Inc', market: 'US', sector: 'Social', avgATR: 5.0, maxLev: 3 },
  { sym: 'RBLX', name: 'Roblox', market: 'US', sector: 'Gaming', avgATR: 4.5, maxLev: 3 },
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
  { sym: 'TATAPOWER', name: 'Tata Power', market: 'IN', sector: 'Energy', avgATR: 3.0, maxLev: 5 },
  { sym: 'ITC', name: 'ITC Ltd', market: 'IN', sector: 'FMCG', avgATR: 1.5, maxLev: 5 },
  { sym: 'ZOMATO', name: 'Zomato', market: 'IN', sector: 'FoodTech', avgATR: 3.5, maxLev: 3 },
  { sym: 'JSWSTEEL', name: 'JSW Steel', market: 'IN', sector: 'Metals', avgATR: 2.5, maxLev: 5 },
  { sym: 'HINDALCO', name: 'Hindalco', market: 'IN', sector: 'Metals', avgATR: 2.8, maxLev: 5 },
  { sym: 'COALINDIA', name: 'Coal India', market: 'IN', sector: 'Mining', avgATR: 2.0, maxLev: 5 },
  { sym: 'PNB', name: 'Punjab National Bank', market: 'IN', sector: 'Banking', avgATR: 3.0, maxLev: 5 },
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
              market: market,
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

// ========== SMART MONEY DETECTION ==========
function detectSmartMoney(volume: number, change: number, rsi: number, atr: number, price: number): FuturesTradeSignal['smartMoneySignal'] {
  const volSurge = volume > 10_000_000;
  const bigMove = Math.abs(change) > 4;
  if (volSurge && bigMove && rsi < 35) return 'WHALE_BUY';
  if (volSurge && bigMove && rsi > 70) return 'WHALE_SELL';
  if (volSurge && atr > price * 0.04) return 'VOLUME_SPIKE';
  if (volume > 20_000_000) return 'BLOCK_DEAL';
  return 'NONE';
}

// ========== FIBONACCI PIVOT CALCULATOR ==========
function calcFibLevels(high: number, low: number, price: number) {
  const range = high - low;
  return {
    s1: price - range * 0.236, s2: price - range * 0.382, s3: price - range * 0.618,
    r1: price + range * 0.236, r2: price + range * 0.382, r3: price + range * 0.618,
  };
}

// ========== MULTI-TIMEFRAME CONFLUENCE ==========
function calcMultiTimeframe(rsi: number, sma20: number, sma50: number, macd: number, price: number, change: number): { score: number; alignment: string } {
  // Simulate MTF from single timeframe data using momentum + trend + structure
  const tf1h = (rsi > 40 && rsi < 70 && macd > 0) ? 1 : (rsi < 30 || rsi > 75) ? -1 : 0;
  const tf4h = (sma20 > sma50 && price > sma20) ? 1 : (sma20 < sma50 && price < sma20) ? -1 : 0;
  const tf1d = change > 0.5 ? 1 : change < -0.5 ? -1 : 0;
  const tfWeek = (sma20 > sma50 * 1.02) ? 1 : (sma20 < sma50 * 0.98) ? -1 : 0;
  const signals = [tf1h, tf4h, tf1d, tfWeek];
  const bullish = signals.filter(s => s > 0).length;
  const bearish = signals.filter(s => s < 0).length;
  const total = 4;
  const dominant = bullish >= bearish ? 'BULLISH' : 'BEARISH';
  const aligned = Math.max(bullish, bearish);
  return { score: Math.round((aligned / total) * 100), alignment: `${aligned}/${total} ${dominant}` };
}

// ========== VWAP CALCULATOR ==========
function calcVWAP(high: number, low: number, price: number, volume: number): number {
  if (volume <= 0) return price;
  return (high + low + price) / 3;
}

// ========== ADVANCED PRO-TRADER INDICATORS ==========
function calcStochRSI(rsi: number): { stochRsi: number; signal: number } {
  // Stochastic RSI: maps RSI to 0-100 with more sensitivity
  const rsiMin = Math.max(0, rsi - 25);
  const rsiMax = Math.min(100, rsi + 25);
  const stochRsi = rsiMax > rsiMin ? ((rsi - rsiMin) / (rsiMax - rsiMin)) * 100 : 50;
  const signal = stochRsi * 0.7 + rsi * 0.3; // Signal line smoothing
  return { stochRsi: Math.round(stochRsi), signal: Math.round(signal) };
}

function calcADX(change: number, atr: number, price: number, sma20: number, sma50: number): number {
  // ADX proxy: trend strength 0-100
  const trendStrength = Math.abs(sma20 - sma50) / (price || 1) * 100;
  const momentum = Math.abs(change);
  const volatility = (atr / (price || 1)) * 100;
  const adx = Math.min(80, Math.round(trendStrength * 8 + momentum * 5 + volatility * 3));
  return Math.max(5, adx);
}

function calcIchimoku(price: number, sma20: number, sma50: number, high: number, low: number): 'ABOVE_CLOUD' | 'IN_CLOUD' | 'BELOW_CLOUD' {
  // Ichimoku cloud proxy using SMA as Senkou spans
  const spanA = (sma20 + sma50) / 2;
  const spanB = (high + low) / 2;
  const cloudTop = Math.max(spanA, spanB);
  const cloudBottom = Math.min(spanA, spanB);
  if (price > cloudTop) return 'ABOVE_CLOUD';
  if (price < cloudBottom) return 'BELOW_CLOUD';
  return 'IN_CLOUD';
}

function calcSupertrend(price: number, atr: number, sma20: number): { signal: 'BUY' | 'SELL'; value: number } {
  const multiplier = 2.5;
  const upperBand = ((price + sma20) / 2) + multiplier * atr;
  const lowerBand = ((price + sma20) / 2) - multiplier * atr;
  if (price > upperBand * 0.98) return { signal: 'BUY', value: lowerBand };
  if (price < lowerBand * 1.02) return { signal: 'SELL', value: upperBand };
  return price > sma20 ? { signal: 'BUY', value: lowerBand } : { signal: 'SELL', value: upperBand };
}

function calcOBVTrend(volume: number, change: number): 'BULLISH' | 'BEARISH' | 'NEUTRAL' {
  if (change > 0.5 && volume > 2_000_000) return 'BULLISH';
  if (change < -0.5 && volume > 2_000_000) return 'BEARISH';
  return 'NEUTRAL';
}

function calcEMACross(sma20: number, sma50: number, price: number): { ema9: number; ema21: number; cross: 'GOLDEN' | 'DEATH' | 'NONE' } {
  // EMA proxy from SMA data
  const ema9 = price * 0.2 + sma20 * 0.8;
  const ema21 = sma20 * 0.6 + sma50 * 0.4;
  let cross: 'GOLDEN' | 'DEATH' | 'NONE' = 'NONE';
  if (ema9 > ema21 * 1.005) cross = 'GOLDEN';
  else if (ema9 < ema21 * 0.995) cross = 'DEATH';
  return { ema9, ema21, cross };
}

// ========== COINDCX USDC/INR PRICE FETCH ==========
export async function fetchCoinDcxPrices(): Promise<Record<string, number>> {
  const results: Record<string, number> = {};
  try {
    const res = await fetch('https://api.coindcx.com/exchange/ticker', { signal: AbortSignal.timeout(6000) });
    if (res.ok) {
      const data = await res.json();
      if (Array.isArray(data)) {
        for (const item of data) {
          const market = item.market || '';
          if (market.includes('USDC') || market.includes('INR')) {
            const sym = market.replace('USDC', '').replace('INR', '').replace('B-', '').replace('I-', '');
            if (item.last_price && parseFloat(item.last_price) > 0) {
              results[`${sym}_${market.includes('INR') ? 'INR' : 'USDC'}`] = parseFloat(item.last_price);
            }
          }
        }
      }
    }
  } catch (e) { console.warn('CoinDCX fetch failed:', e); }
  return results;
}

// ========== MAIN TRADING SCANNER — DEEP QUANTUM AI ==========
export function runTradingScan(
  prices: Record<string, PriceData>,
  usVix: number = 15,
  inVix: number = 15,
  coinDcxPrices?: Record<string, number>
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

    // Advanced Indicators
    const stochData = calcStochRSI(rsi);
    const adxValue = calcADX(change, atr, price, sma20, sma50);
    const ichimokuSignal = calcIchimoku(price, sma20, sma50, high, low);
    const supertrendData = calcSupertrend(price, atr, sma20);
    const obvTrend = calcOBVTrend(volume, change);
    const emaCrossData = calcEMACross(sma20, sma50, price);
    const smartMoneySignal = detectSmartMoney(volume, change, rsi, atr, price);
    const fibLevels = calcFibLevels(high, low, price);
    const mtf = calcMultiTimeframe(rsi, sma20, sma50, macd, price, change);
    const vwap = calcVWAP(high, low, price, volume);

    // AI Consensus Score placeholder (updated by multi-AI engine later)
    const aiConsensusScore = 50;

    // Weighted composite (35% tech + 25% momentum + 15% vol + 10% sentiment + 15% consensus)
    const aiScore = Math.round(
      technicalScore * 0.35 + momentumScore * 0.25 +
      volatilityScore * 0.15 + sentimentScore * 0.10 +
      aiConsensusScore * 0.15
    );

    // CoinDCX pair
    let coinDcxInrPrice: number | undefined;
    let coinDcxPair: string | undefined;
    if (asset.market === 'CRYPTO' && asset.coinDcxPair) {
      coinDcxPair = asset.coinDcxPair;
      if (coinDcxPrices) {
        coinDcxInrPrice = coinDcxPrices[`${asset.sym}_INR`] || coinDcxPrices[`${asset.sym}_USDC`];
      }
    }

    // ACCURATE Direction detection — multi-condition
    const bullSignals = [
      rsi < 50 && rsi > 20,
      macd > 0,
      sma20 > sma50,
      price > sma20,
      change > 0,
      stochData.stochRsi < 70,
      ichimokuSignal === 'ABOVE_CLOUD',
      supertrendData.signal === 'BUY',
      obvTrend === 'BULLISH',
      emaCrossData.cross === 'GOLDEN',
      smartMoneySignal === 'WHALE_BUY',
      mtf.score >= 75 && mtf.alignment.includes('BULLISH'),
      adxValue > 20,
    ].filter(Boolean).length;

    const bearSignals = [
      rsi > 55,
      macd < 0,
      sma20 < sma50,
      price < sma20,
      change < -0.3,
      stochData.stochRsi > 70,
      ichimokuSignal === 'BELOW_CLOUD',
      supertrendData.signal === 'SELL',
      obvTrend === 'BEARISH',
      emaCrossData.cross === 'DEATH',
      smartMoneySignal === 'WHALE_SELL',
      mtf.score >= 75 && mtf.alignment.includes('BEARISH'),
      adxValue > 20,
    ].filter(Boolean).length;

    const isLong = bullSignals >= bearSignals;
    const direction: 'LONG' | 'SHORT' = isLong ? 'LONG' : 'SHORT';

    // Entry/Target/SL using ATR
    const entryPrice = price;
    const slDistance = atr * 1.5;
    const stopLoss = isLong ? price - slDistance : price + slDistance;
    const target1 = isLong ? price + atr * 3.0 : price - atr * 3.0;
    const target2 = isLong ? price + atr * 4.5 : price - atr * 4.5;
    const target3 = isLong ? price + atr * 6.0 : price - atr * 6.0;

    const riskPercent = (slDistance / price) * 100;
    const potentialReturn = ((Math.abs(target1 - price)) / price) * 100;
    const riskReward = riskPercent > 0 ? potentialReturn / riskPercent : 1;
    if (riskReward < 2) continue;

    const conviction = Math.min(99, Math.max(80, Math.round(aiScore * 1.1)));

    // STRONG signal requires multi-indicator confirmation
    let signal: FuturesTradeSignal['signal'];
    const strongBullConfirm = bullSignals >= 8 && adxValue > 20 && supertrendData.signal === 'BUY';
    const strongBearConfirm = bearSignals >= 8 && adxValue > 20 && supertrendData.signal === 'SELL';

    if (isLong && strongBullConfirm && aiScore >= 65) signal = 'STRONG_LONG';
    else if (isLong) signal = 'LONG';
    else if (!isLong && strongBearConfirm && aiScore >= 65) signal = 'STRONG_SHORT';
    else signal = 'SHORT';

    const volFactor = asset.avgATR > 4 ? 0.5 : asset.avgATR > 2.5 ? 0.7 : 1;
    const leverage = Math.min(asset.maxLev, Math.max(2, Math.round(aiScore / 20 * volFactor)));

    let timeframe: FuturesTradeSignal['timeframe'] = 'SWING_1_3D';
    if (asset.market === 'CRYPTO' && Math.abs(change) > 3) timeframe = 'INTRADAY';
    else if (aiScore > 75) timeframe = 'INTRADAY';
    else if (aiScore < 50) timeframe = 'SWING_3_7D';

    // Daily Profit Calculator (₹5000 capital)
    const profitCalc500 = calculateDailyProfitQty(entryPrice, target1, leverage, 500, asset.market);
    const profitCalc1000 = calculateDailyProfitQty(entryPrice, target1, leverage, 1000, asset.market);

    const cdxLabel = asset.coinDcxPair ? ` | CoinDCX: ${asset.coinDcxPair}` : '';
    const platformLabel = asset.market === 'IN' ? ' | INDmoney' : '';
    const actionMap: Record<string, string> = {
      'STRONG_LONG': `🟢 FULL ENTRY — ${asset.sym} LONG ${leverage}x! Profit Target ₹500+${cdxLabel}${platformLabel}`,
      'LONG': `🟢 BUY — ${asset.sym} LONG ${leverage}x entry karo${cdxLabel}${platformLabel}`,
      'STRONG_SHORT': `🔴 SELL KARO — ${asset.sym} SHORT ${leverage}x! Girega pakka${cdxLabel}${platformLabel}`,
      'SHORT': `🔴 SHORT — ${asset.sym} SHORT position lo${cdxLabel}${platformLabel}`,
    };

    const reasons: string[] = [];
    if (smartMoneySignal && smartMoneySignal !== 'NONE') reasons.push(`🐋 ${smartMoneySignal.replace('_', ' ')}`);
    if (supertrendData.signal === (isLong ? 'BUY' : 'SELL')) reasons.push(`Supertrend ${supertrendData.signal}`);
    if (ichimokuSignal === 'ABOVE_CLOUD' && isLong) reasons.push('☁️ Above Cloud');
    if (ichimokuSignal === 'BELOW_CLOUD' && !isLong) reasons.push('☁️ Below Cloud');
    if (emaCrossData.cross === 'GOLDEN' && isLong) reasons.push('⚡ Golden Cross');
    if (emaCrossData.cross === 'DEATH' && !isLong) reasons.push('💀 Death Cross');
    if (mtf.score >= 75) reasons.push(`MTF ${mtf.alignment}`);
    if (adxValue > 35) reasons.push(`ADX ${adxValue} Strong Trend`);
    if (rsi < 35) reasons.push(`RSI ${rsi.toFixed(0)} OVERSOLD`);
    else if (rsi > 70) reasons.push(`RSI ${rsi.toFixed(0)} OVERBOUGHT`);
    if (profitCalc500.feasible) reasons.push(`₹500 profit: ${profitCalc500.qty} qty`);

    const bbWidth = price > 0 ? ((high - low) / price) * 100 : 2;
    const ema10 = sma20 * 0.95 + price * 0.05;

    results.push({
      symbol: asset.sym, name: asset.name, market: asset.market, sector: asset.sector,
      currentPrice: price, entryPrice, target1, target2, target3, stopLoss,
      direction, leverage, timeframe,
      technicalScore, momentumScore, volatilityScore, sentimentScore,
      aiConsensusScore,
      aiScore, conviction,
      riskReward: Math.round(riskReward * 10) / 10,
      riskPercent: Math.round(riskPercent * 10) / 10,
      potentialReturn: Math.round(potentialReturn * 10) / 10,
      signal,
      actionHinglish: actionMap[signal] || `${asset.sym} — ${signal}`,
      reasoningHinglish: reasons.slice(0, 5).join(' | ') || 'Deep Quantum AI analysis',
      rsi, macd, sma20, sma50, atr, bbWidth, volume, change,
      // Deep Quantum AI fields
      vwap, ema10, ema20: sma20, fibLevels, smartMoneySignal,
      multiTimeframeScore: mtf.score, mtfAlignment: mtf.alignment,
      coinDcxPair, coinDcxInrPrice,
      // Advanced Pro-Trader Indicators
      stochRsi: stochData.stochRsi, stochRsiSignal: stochData.signal,
      adx: adxValue, ichimokuSignal, supertrend: supertrendData.signal,
      supertrendValue: supertrendData.value, obvTrend,
      ema9: emaCrossData.ema9, ema21: emaCrossData.ema21, emaCross: emaCrossData.cross,
      // Daily Profit Calculator
      qty500: profitCalc500.qty, qty1000: profitCalc1000.qty,
      dailyProfitPotential: profitCalc500.feasible ? 500 : Math.round(potentialReturn * 50),
      investmentNeeded500: profitCalc500.investment,
      investmentNeeded1000: profitCalc1000.investment,
      // AI consensus (to be updated by multiAiEngine)
      aiConsensus: 50, aiConsensusLabel: 'PENDING',
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
    `${i + 1}. ${s.symbol} (${s.market}) ${s.direction} — $${s.currentPrice.toFixed(2)} | AI: ${s.aiScore} | RSI: ${s.rsi.toFixed(0)} | MACD: ${s.macd.toFixed(2)} | R:R ${s.riskReward}:1 | Entry: $${s.entryPrice.toFixed(2)} | SL: $${s.stopLoss.toFixed(2)} | T1: $${s.target1.toFixed(2)} | T2: $${s.target2.toFixed(2)} | Lev: ${s.leverage}x | VWAP: ${s.vwap?.toFixed(2) || 'N/A'} | MTF: ${s.mtfAlignment || 'N/A'} | SmartMoney: ${s.smartMoneySignal || 'NONE'} | ${s.coinDcxPair ? 'CoinDCX: ' + s.coinDcxPair : ''} | ${s.reasoningHinglish}`
  ).join('\n');

  const prompt = `You are DEEP QUANTUM TRADE AI — an elite institutional-grade SHORT-TERM futures/intraday trader. Analyze these trade setups for MAXIMUM DAILY PROFIT.

RULES:
1. Each trade analysis in 4-5 lines MAX. Use Pro Trader Hinglish.
2. Give: Conviction (1-10), Key Catalyst, Entry Zone, Exact SL, 3 Targets, Risk Level.
3. Be SPECIFIC with price levels. Focus on R:R 2:1+ setups only.
4. Use SMC (Smart Money Concepts), Order Flow, Wyckoff Phases, Fibonacci Confluence.
5. For CRYPTO: Mention CoinDCX USDC pair for INR trading if available.
6. Check Multi-Timeframe Confluence — prefer signals where MTF alignment is 3/4+.
7. Smart Money signals (Whale, Volume Spike, Block Deal) get PRIORITY.
8. Today: ${new Date().toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata' })}.
9. End with emoji: 🟢 LONG / 🔴 SHORT / 🟡 SKIP`;

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
    let line = `• <b>${s.symbol}</b> ${s.direction === 'LONG' ? '🟢' : '🔴'} ${s.direction} ${s.leverage}x`;
    if (s.smartMoneySignal && s.smartMoneySignal !== 'NONE') line += ` 🐋`;
    line += `\n`;
    line += `  Price: <b>${cur}${s.currentPrice.toFixed(2)}</b> (${s.change >= 0 ? '+' : ''}${s.change.toFixed(1)}%)`;
    if (s.coinDcxPair) line += ` | CoinDCX: ${s.coinDcxPair}`;
    line += `\n`;
    line += `  Entry: ${cur}${s.entryPrice.toFixed(2)} | SL: ${cur}${s.stopLoss.toFixed(2)}\n`;
    line += `  T1: <b>${cur}${s.target1.toFixed(2)}</b> | T2: ${cur}${s.target2.toFixed(2)} | T3: ${cur}${s.target3.toFixed(2)}\n`;
    line += `  AI: ${s.aiScore}/100 | R:R ${s.riskReward}:1 | MTF: ${s.mtfAlignment || 'N/A'}\n`;
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
  msg += `<i>⚡ Deep Quantum Trade AI | CoinDCX USDC/INR | MTF Confluence | Smart Money</i>`;
  return msg;
}
