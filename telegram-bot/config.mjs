// ============================================
// DEEP MIND AI TRADING BOT — CONFIGURATION
// ============================================

import 'dotenv/config';

// Telegram Credentials (set via environment variables / .env file)
export const TG_TOKEN = process.env.TG_TOKEN || "";
export const TG_CHAT_ID = process.env.TG_CHAT_ID || "";

// Google Apps Script Cloud Sync
export const API_URL = process.env.API_URL || "";

// Tavily Search API (Real-time Web Data)
export const TAVILY_API_KEY = process.env.TAVILY_API_KEY || process.env.VITE_TAVILY_API_KEY || "";

// Multi-AI API Keys (Case-insensitive support for user-added env vars)
const env = process.env;

// Debug: Print available env keys
console.log('🔍 [DEBUG] Checking System Environment Variables for AI Keys:');
const foundKeys = Object.keys(env).filter(k => k.toUpperCase().includes('GROQ') || k.toUpperCase().includes('GEMINI') || k.toUpperCase().includes('CLAUDE'));
if (foundKeys.length > 0) {
  console.log(`🔍 [DEBUG] Found these potential key variables: ${foundKeys.join(', ')}`);
} else {
  console.log('🔍 [DEBUG] NO matching environment variables found in process.env!');
}

export let GROQ_KEY = env.GROQ_KEY || env.GroqKey || env.VITE_GROQ_API_KEY || "";
export let GEMINI_API_KEY = env.GEMINI_API_KEY || env.GeminiAPIKEY || env.GEMINI_KEY || env.VITE_GEMINI_API_KEY || "";
export let CLAUDE_API_KEY = env.CLAUDE_API_KEY || env.ClaudeAPIKEY || env.CLAUDE_KEY || env.VITE_CLAUDE_API_KEY || "";
export let NVIDIA_API_KEY = env.NVIDIA_API_KEY || env.NvidiaAPIKEY || env.VITE_NVIDIA_API_KEY || "";

// Clean keys (remove accidentally pasted quotes or spaces)
if (GROQ_KEY) GROQ_KEY = GROQ_KEY.replace(/['"]/g, '').trim();
if (GEMINI_API_KEY) GEMINI_API_KEY = GEMINI_API_KEY.replace(/['"]/g, '').trim();
if (CLAUDE_API_KEY) CLAUDE_API_KEY = CLAUDE_API_KEY.replace(/['"]/g, '').trim();
if (NVIDIA_API_KEY) NVIDIA_API_KEY = NVIDIA_API_KEY.replace(/['"]/g, '').trim();

// Validate API keys at startup
const missingKeys = [];
if (!GROQ_KEY || !GROQ_KEY.startsWith('gsk_')) missingKeys.push('GROQ_KEY');
if (!GEMINI_API_KEY || GEMINI_API_KEY.length < 10) missingKeys.push('GEMINI_API_KEY');
if (!CLAUDE_API_KEY || CLAUDE_API_KEY.length < 10) missingKeys.push('CLAUDE_API_KEY');
if (!NVIDIA_API_KEY || !NVIDIA_API_KEY.startsWith('nvapi-')) missingKeys.push('NVIDIA_API_KEY');

if (missingKeys.length > 0) {
  console.warn('⚠️  WARNING: Some AI keys are missing or invalid:');
  console.warn('  ' + missingKeys.join(', '));
  console.warn('  AI responses will use available engines with fallback chain.');
} else {
  console.log('✅ All AI API keys validated successfully');
}

// Log individual key status
console.log('🔑 AI Engine Key Status:');
if (GROQ_KEY) console.log(`  ⚡ Groq: ✓ Valid (${GROQ_KEY.substring(0, 8)}...)`);
else console.log('  ⚡ Groq: ✗ Missing');
if (GEMINI_API_KEY && GEMINI_API_KEY.length > 10) console.log(`  🔵 Gemini: ✓ Valid (${GEMINI_API_KEY.substring(0, 8)}...)`);
else console.log('  🔵 Gemini: ✗ Missing');
if (CLAUDE_API_KEY && CLAUDE_API_KEY.length > 10) console.log(`  🟣 Claude: ✓ Valid (${CLAUDE_API_KEY.substring(0, 8)}...)`);
else console.log('  🟣 Claude: ✗ Missing');
if (NVIDIA_API_KEY && NVIDIA_API_KEY.startsWith('nvapi-')) console.log(`  🧠 Nvidia (DeepSeek V4): ✓ Valid (${NVIDIA_API_KEY.substring(0, 10)}...)`);
else console.log('  🧠 Nvidia: ✗ Missing');

export function setGroqKey(key) { GROQ_KEY = key; }
export function setGeminiKey(key) { GEMINI_API_KEY = key; }
export function setClaudeKey(key) { CLAUDE_API_KEY = key; }
export function setNvidiaKey(key) { NVIDIA_API_KEY = key; }
export function setTavilyKey(key) { TAVILY_API_KEY = key; }

// Dynamic key validation helpers (called at runtime, not module load)
export function isGroqAvailable() { return !!(GROQ_KEY && GROQ_KEY.length > 10); }
export function isGeminiAvailable() { return !!(GEMINI_API_KEY && GEMINI_API_KEY.length > 10); }
export function isClaudeAvailable() { return !!(CLAUDE_API_KEY && CLAUDE_API_KEY.length > 10); }
export function isNvidiaAvailable() { return !!(NVIDIA_API_KEY && NVIDIA_API_KEY.length > 10); }
export function isTavilyAvailable() { return !!(TAVILY_API_KEY && TAVILY_API_KEY.length > 10); }

// SIP Defaults
export const DEFAULT_INDIA_SIP = 10000;
export const DEFAULT_US_SIP = 50;
export const DEFAULT_USD_INR = 85.5;

// CORS Proxies (for Yahoo Finance — server-side we can call directly)
export const CORS_PROXIES = [
  '', // Direct (no proxy needed on server-side)
  'https://api.allorigins.win/raw?url=',
  'https://corsproxy.io/?'
];

// ETF Configurations
export const ALPHA_ETFS_IN = [
  { sym: 'JUNIORBEES', name: 'Nippon India ETF Junior BeES', cagr: 18.5, maxDD: 30, cat: 'Next 50', fixedAlloc: 0.12 },
  { sym: 'MOMENTUM50', name: 'Motilal Oswal Nifty 500 Momentum 50', cagr: 22.5, maxDD: 30, cat: 'Smart Beta', fixedAlloc: 0.40 },
  { sym: 'SMALLCAP', name: 'Nippon India Nifty Smallcap 250', cagr: 26.5, maxDD: 40, cat: 'Growth', fixedAlloc: 0.28 },
  { sym: 'MID150BEES', name: 'Nippon India Nifty Midcap 150', cagr: 21.0, maxDD: 35, cat: 'Growth', fixedAlloc: 0.20 }
];

export const ALPHA_ETFS_US = [
  { sym: 'SMH', name: 'VanEck Semiconductor', cagr: 28.5, maxDD: 45, cat: 'Tech Alpha', fixedAlloc: 0.45 },
  { sym: 'VGT', name: 'Vanguard Information Technology ETF', cagr: 21.0, maxDD: 33, cat: 'Tech', fixedAlloc: 0.33 },
  { sym: 'IWY', name: 'iShares Russell Top 200 Growth ETF', cagr: 18.5, maxDD: 40, cat: 'Large Cap Growth', fixedAlloc: 0.22 }
];

export const EXACT_TICKER_MAP = {
  // US ETFs & Indices
  'SMH': 'NASDAQ:SMH',
  'VGT': 'AMEX:VGT',
  'AVUV': 'AMEX:AVUV',
  'IWM': 'AMEX:IWM',
  'VEA': 'AMEX:VEA',
  'SPY': 'AMEX:SPY',
  'DIA': 'AMEX:DIA',
  'XLV': 'AMEX:XLV',
  'VIX': 'CBOE:VIX',
  'SPX': 'SP:SPX',
  'NDX': 'NASDAQ:NDX',
  'IWY': 'AMEX:IWY',
  'QQQ': 'NASDAQ:QQQ',
  'AAPL': 'NASDAQ:AAPL',
  'MSFT': 'NASDAQ:MSFT',
  'GOOGL': 'NASDAQ:GOOGL',
  'AMZN': 'NASDAQ:AMZN',
  'META': 'NASDAQ:META',
  'NVDA': 'NASDAQ:NVDA',
  'TSLA': 'NASDAQ:TSLA',
  // Indian ETFs & Indices
  'NIFTY': 'NSE:NIFTY',
  'SENSEX': 'BSE:SENSEX',
  'BANKNIFTY': 'NSE:BANKNIFTY',
  'NIFTY50': 'NSE:NIFTY',
  'INDIAVIX': 'NSE:INDIAVIX',
  'GIFT_NIFTY': 'NSE:GIFT_NIFTY',
  'JUNIORBEES': 'NSE:JUNIORBEES',
  'MOMENTUM50': 'NSE:MOMENTUM50',
  'SMALLCAP': 'NSE:SMALLCAP',
  'MID150BEES': 'NSE:MID150BEES',
  // Crypto
  'BTC': 'BINANCE:BTCUSDT',
  'ETH': 'BINANCE:ETHUSDT',
  'SOL': 'BINANCE:SOLUSDT',
  'BNB': 'BINANCE:BNBUSDT',
  'XRP': 'BINANCE:XRPUSDT'
};

// Tax-loss harvesting pairs (similar ETFs to swap into when booking losses)
export const TAX_PAIRS = {
  'ITBEES': 'TATAIT',     // Nifty IT → Tata IT
  'TATAIT': 'ITBEES',     // reverse
  'SMH': 'SOXX',          // Semiconductors → Semiconductor broad
  'SOXX': 'SMH',          // reverse
  'JUNIORBEES': 'NIFTYJR', // Next 50 variants
  'MOMENTUM50': 'NIFTY50', // Momentum → broad market
};

// Crypto symbol detection
export function isCryptoSymbol(sym) {
  const clean = (sym || '').toUpperCase().replace('USDT', '').replace('USD', '').replace('.NS', '').replace('.BO', '');
  return ['BTC', 'ETH', 'SOL', 'BNB', 'XRP', 'DOGE', 'ADA', 'AVAX', 'DOT', 'MATIC', 'LINK', 'UNI', 'BITCOIN', 'ETHEREUM'].includes(clean);
}

// Crypto CAGR proxies
const CRYPTO_CAGR = { 'BTC': 55, 'ETH': 45, 'SOL': 40, 'BNB': 35, 'XRP': 25, 'DOGE': 20, 'ADA': 20, 'AVAX': 30 };

// Helpers
export function guessMarket(sym) {
  sym = (sym || '').toUpperCase();
  if (sym.includes('.NS') || sym.includes('.BO')) return 'IN';
  if (sym === 'RELIANCE' || sym === 'NIFTY' || sym === 'SENSEX') return 'IN';
  if (sym.includes('BEES')) return 'IN';
  if (ALPHA_ETFS_IN.some(e => e.sym === sym.replace('.NS', ''))) return 'IN';
  if (isCryptoSymbol(sym)) return 'IN'; // User buys crypto via CoinDCX in INR
  return 'US';
}

export function getAssetCagrProxy(sym, mkt) {
  sym = (sym || '').toUpperCase().replace('.NS', '').replace('.BO', '');
  // Crypto check first
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
