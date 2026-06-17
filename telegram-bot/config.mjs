// ============================================
// DEEP MIND AI TRADING BOT — CONFIGURATION
// Advance Pro v16.0 — Groq Super Intelligence
// ============================================

import 'dotenv/config';

// Telegram Credentials
export const TG_TOKEN = process.env.TG_TOKEN || "";
export const TG_CHAT_ID = process.env.TG_CHAT_ID || "";

// Google Apps Script Cloud Sync
export const API_URL = process.env.API_URL || "";

// Tavily Search API (Real-time Web Data)
export let TAVILY_API_KEY = process.env.TAVILY_API_KEY || process.env.VITE_TAVILY_API_KEY || "";

// ============================================
// GROQ SUPER INTELLIGENCE — Single Engine
// Default model: llama-3.3-70b-versatile (fastest, 128K context, most reliable)
// ============================================
const env = process.env;

console.log('🔍 [DEBUG] Scanning env vars for GROQ API key...');
const allEnvKeys = Object.keys(env);
const groqMatches = allEnvKeys.filter(k => k.toUpperCase().includes('GROQ'));
if (groqMatches.length > 0) {
  console.log(`🔍 [DEBUG] Found GROQ env var(s): ${groqMatches.join(', ')}`);
} else {
  console.log('🔍 [DEBUG] No GROQ env vars found — scanning all env for gsk_ pattern...');
}

export let GROQ_KEY = "";

// Smart scan for Groq key (starts with gsk_)
for (const k of allEnvKeys) {
  const v = (env[k] || '').toString().trim();
  if (!v || v.length < 5) continue;
  if (v.startsWith('gsk_') && v.length > 20) {
    if (!GROQ_KEY) { GROQ_KEY = v; console.log(`  → Groq key loaded from: ${k}`); }
  }
}

// Explicit name fallbacks
const groqNames = [
  'GROQ_KEY', 'GROQ_API_KEY', 'GROQKEY',
  'GroqKey', 'GroqAPIKey', 'groq_key', 'groq_api_key',
  'VITE_GROQ_API_KEY'
];
for (const name of groqNames) {
  if (!GROQ_KEY && env[name]) GROQ_KEY = env[name];
}

// Final fallback: any gsk_ value anywhere
if (!GROQ_KEY) {
  for (const v of Object.values(env)) {
    if (typeof v === 'string' && v.startsWith('gsk_') && v.length > 20) {
      GROQ_KEY = v.replace(/['"]/g, '').trim();
      console.log(`  → Groq key auto-detected from env value`);
      break;
    }
  }
}

// Clean key
if (GROQ_KEY) GROQ_KEY = GROQ_KEY.replace(/['"]/g, '').trim();

// Validate
if (!GROQ_KEY || !GROQ_KEY.startsWith('gsk_')) {
  console.warn('⚠️  GROQ_KEY is missing or invalid. AI chat will not work.');
  console.warn('  Get a free key at https://console.groq.com');
} else {
  console.log(`✅ Groq key valid (${GROQ_KEY.substring(0, 8)}...)`);
}

// Tavily also scan for tvly- pattern
if (!TAVILY_API_KEY) {
  for (const k of allEnvKeys) {
    const v = (env[k] || '').toString().trim();
    if (v.startsWith('tvly-') && v.length > 10) {
      TAVILY_API_KEY = v;
      console.log(`  → Tavily key loaded from: ${k}`);
      break;
    }
  }
}
const tavilyNames = ['TAVILY_API_KEY', 'TAVILY_KEY', 'VITE_TAVILY_API_KEY', 'TavilyApiKey', 'tavily_api_key'];
for (const name of tavilyNames) { if (!TAVILY_API_KEY && env[name]) TAVILY_API_KEY = env[name]; }
if (TAVILY_API_KEY) TAVILY_API_KEY = TAVILY_API_KEY.replace(/['"]/g, '').trim();

export function setGroqKey(key) { GROQ_KEY = key; }
export function setTavilyKey(key) { TAVILY_API_KEY = key; }
export function isGroqAvailable() { return !!(GROQ_KEY && GROQ_KEY.length > 10); }
export function isTavilyAvailable() { return !!(TAVILY_API_KEY && TAVILY_API_KEY.length > 10); }

// SIP Defaults
export const DEFAULT_INDIA_SIP = 10000;
export const DEFAULT_US_SIP = 50;
export const DEFAULT_USD_INR = 85.5;

export const CORS_PROXIES = [''];

// ETF Configurations
export const ALPHA_ETFS_IN = [
  { sym: 'JUNIORBEES', name: 'Nippon India ETF Junior BeES', cagr: 18.5, maxDD: 30, cat: 'Next 50', fixedAlloc: 0.12 },
  { sym: 'MOMENTUM50', name: 'Motilal Oswal Nifty 500 Momentum 50', cagr: 22.5, maxDD: 30, cat: 'Smart Beta', fixedAlloc: 0.40 },
  { sym: 'SMALLCAP', name: 'Nippon India Nifty Smallcap 250', cagr: 26.5, maxDD: 40, cat: 'Growth', fixedAlloc: 0.28 },
  { sym: 'MID150BEES', name: 'Nippon India Nifty Midcap 150', cagr: 21.0, maxDD: 35, cat: 'Growth', fixedAlloc: 0.20 }
];

export const ALPHA_ETFS_US = [
  { sym: 'SMH', name: 'VanEck Semiconductor', cagr: 28.5, maxDD: 45, cat: 'Tech Alpha', fixedAlloc: 0.40 },
  { sym: 'VGT', name: 'Vanguard Information Technology ETF', cagr: 21.0, maxDD: 33, cat: 'Tech', fixedAlloc: 0.33 },
  { sym: 'SPCX', name: 'SPAC and New Issue ETF', cagr: 15.0, maxDD: 35, cat: 'SPAC/Growth', fixedAlloc: 0.27 }
];

export const EXACT_TICKER_MAP = {
  'SMH': 'NASDAQ:SMH', 'VGT': 'AMEX:VGT', 'AVUV': 'AMEX:AVUV', 'IWM': 'AMEX:IWM',
  'VEA': 'AMEX:VEA', 'SPY': 'AMEX:SPY', 'DIA': 'AMEX:DIA', 'XLV': 'AMEX:XLV',
  'VIX': 'CBOE:VIX', 'SPX': 'SP:SPX', 'NDX': 'NASDAQ:NDX', 'IWY': 'AMEX:IWY',
  'SPCX': 'NASDAQ:SPCX', 'QQQ': 'NASDAQ:QQQ',
  'AAPL': 'NASDAQ:AAPL', 'MSFT': 'NASDAQ:MSFT', 'GOOGL': 'NASDAQ:GOOGL',
  'AMZN': 'NASDAQ:AMZN', 'META': 'NASDAQ:META', 'NVDA': 'NASDAQ:NVDA', 'TSLA': 'NASDAQ:TSLA',
  'NIFTY': 'NSE:NIFTY', 'SENSEX': 'BSE:SENSEX', 'BANKNIFTY': 'NSE:BANKNIFTY',
  'NIFTY50': 'NSE:NIFTY', 'INDIAVIX': 'NSE:INDIAVIX', 'GIFT_NIFTY': 'NSE:GIFT_NIFTY',
  'JUNIORBEES': 'NSE:JUNIORBEES', 'MOMENTUM50': 'NSE:MOMENTUM50',
  'SMALLCAP': 'NSE:SMALLCAP', 'MID150BEES': 'NSE:MID150BEES',
  'BTC': 'BINANCE:BTCUSDT', 'ETH': 'BINANCE:ETHUSDT', 'SOL': 'BINANCE:SOLUSDT',
  'BNB': 'BINANCE:BNBUSDT', 'XRP': 'BINANCE:XRPUSDT'
};

export const TAX_PAIRS = {
  'ITBEES': 'TATAIT', 'TATAIT': 'ITBEES', 'SMH': 'SOXX', 'SOXX': 'SMH',
  'JUNIORBEES': 'NIFTYJR', 'MOMENTUM50': 'NIFTY50',
};

export function isCryptoSymbol(sym) {
  const clean = (sym || '').toUpperCase().replace('USDT', '').replace('USD', '').replace('.NS', '').replace('.BO', '');
  return ['BTC', 'ETH', 'SOL', 'BNB', 'XRP', 'DOGE', 'ADA', 'AVAX', 'DOT', 'MATIC', 'LINK', 'UNI', 'BITCOIN', 'ETHEREUM'].includes(clean);
}

const CRYPTO_CAGR = { 'BTC': 55, 'ETH': 45, 'SOL': 40, 'BNB': 35, 'XRP': 25, 'DOGE': 20, 'ADA': 20, 'AVAX': 30 };

export function guessMarket(sym) {
  sym = (sym || '').toUpperCase();
  if (sym.includes('.NS') || sym.includes('.BO')) return 'IN';
  if (sym === 'RELIANCE' || sym === 'NIFTY' || sym === 'SENSEX') return 'IN';
  if (sym.includes('BEES')) return 'IN';
  if (ALPHA_ETFS_IN.some(e => e.sym === sym.replace('.NS', ''))) return 'IN';
  if (isCryptoSymbol(sym)) return 'IN';
  return 'US';
}

export function getAssetCagrProxy(sym, mkt) {
  sym = (sym || '').toUpperCase().replace('.NS', '').replace('.BO', '');
  if (isCryptoSymbol(sym)) return CRYPTO_CAGR[sym] || 30;
  const i = ALPHA_ETFS_IN.find(e => e.sym === sym);
  if (i) return i.cagr;
  const u = ALPHA_ETFS_US.find(e => e.sym === sym);
  if (u) return u.cagr;
  return mkt?.toUpperCase() === 'IN' ? 14 : 12;
}

export function formatCurrency(amount, currency = '₹') {
  if (amount >= 10000000) return `${currency}${(amount / 10000000).toFixed(2)} Cr`;
  if (amount >= 100000) return `${currency}${(amount / 100000).toFixed(2)} L`;
  return `${currency}${amount.toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;
}

export function formatPrice(price, currency = '₹') {
  if (price >= 1000) return `${currency}${price.toLocaleString('en-US', { maximumFractionDigits: 2 })}`;
  return `${currency}${price.toFixed(price < 1 ? 6 : 2)}`;
}
