// ============================================
// DEEP MIND AI TRADING BOT — CONFIGURATION
// Advance Pro v16.0 — Groq Super Intelligence
// ============================================

import 'dotenv/config';
import dns from 'dns';

// Fix for Node.js 18+ native fetch IPv6 timeout issues
dns.setDefaultResultOrder('ipv4first');

// Telegram Credentials (server-side env only — never fall back to VITE_*
// vars, those are browser-exposed at build time and would leak the token).
export const TG_TOKEN = process.env.TG_TOKEN || "";
export const TG_CHAT_ID = process.env.TG_CHAT_ID || "";

// Google Apps Script Cloud Sync
export const API_URL = process.env.API_URL || process.env.VITE_API_URL || "";

// Tavily Search API (Real-time Web Data)
export let TAVILY_API_KEY = process.env.TAVILY_API_KEY || "";

// ============================================
// GROQ SUPER INTELLIGENCE — Single Engine
// ============================================
const env = process.env;

// Load Groq key from explicit env var names only. No env-var scanning.
export let GROQ_KEY = env.GROQ_API_KEY || env.GROQ_KEY || '';

if (GROQ_KEY) GROQ_KEY = GROQ_KEY.replace(/['"]/g, '').trim();

if (!GROQ_KEY || !GROQ_KEY.startsWith('gsk_')) {
  console.warn('[config] GROQ_KEY is missing or invalid. AI chat will not work.');
  console.warn('[config] Get a free key at https://console.groq.com');
}

// Tavily — explicit names only
const tavilyNames = ['TAVILY_API_KEY', 'TAVILY_KEY'];
for (const name of tavilyNames) { if (!TAVILY_API_KEY && env[name]) TAVILY_API_KEY = env[name]; }
if (TAVILY_API_KEY) TAVILY_API_KEY = TAVILY_API_KEY.replace(/['"]/g, '').trim();

// ============================================
// GOOGLE GEMINI
// ============================================
export let GEMINI_KEY = process.env.GEMINI_API_KEY || process.env.GEMINI_KEY || "";
if (GEMINI_KEY) GEMINI_KEY = GEMINI_KEY.replace(/['"]/g, '').trim();
export function setGeminiKey(key) { GEMINI_KEY = key; }
export function isGeminiAvailable() { return !!(GEMINI_KEY && GEMINI_KEY.length > 5); }

// ============================================
// GROQ FALLBACK
// ============================================
export function setGroqKey(key) { GROQ_KEY = key; }
export function setTavilyKey(key) { TAVILY_API_KEY = key; }
export function isGroqAvailable() { return !!(GROQ_KEY && GROQ_KEY.length > 10); }
export function isTavilyAvailable() { return !!(TAVILY_API_KEY && TAVILY_API_KEY.length > 10); }

// ============================================
// ANTHROPIC CLAUDE
// ============================================
export let CLAUDE_KEY = env.ANTHROPIC_API_KEY || env.CLAUDE_API_KEY || env.CLAUDE_KEY || "";
if (CLAUDE_KEY) CLAUDE_KEY = CLAUDE_KEY.replace(/['"]/g, '').trim();
export function setClaudeKey(key) { CLAUDE_KEY = key; }
export function isClaudeAvailable() { return !!(CLAUDE_KEY && CLAUDE_KEY.length > 10); }

// ============================================
// ADDITIONAL LLM PROVIDERS
// ============================================
export let OPENROUTER_KEY = env.OPENROUTER_API_KEY || env.OPENROUTER_KEY || "";
if (OPENROUTER_KEY) OPENROUTER_KEY = OPENROUTER_KEY.replace(/['"]/g, '').trim();
export function isOpenRouterAvailable() { return !!(OPENROUTER_KEY && OPENROUTER_KEY.length > 10); }

export let CEREBRAS_KEY = env.CEREBRAS_API_KEY || env.CEREBRAS_KEY || "";
if (CEREBRAS_KEY) CEREBRAS_KEY = CEREBRAS_KEY.replace(/['"]/g, '').trim();
export function isCerebrasAvailable() { return !!(CEREBRAS_KEY && CEREBRAS_KEY.length > 10); }

export let HF_KEY = env.HF_API_KEY || env.HUGGINGFACE_API_KEY || "";
if (HF_KEY) HF_KEY = HF_KEY.replace(/['"]/g, '').trim();
export function isHFAvailable() { return !!(HF_KEY && HF_KEY.length > 10); }

// Ollama (self-hosted, truly keyless)
export const OLLAMA_URL = env.OLLAMA_URL || 'http://localhost:11434';
export function isOllamaAvailable() { return false; }

// ============================================
// NVIDIA Llama 3.3 70B
// ============================================
export let NVIDIA_KEY = env.NVIDIA_API_KEY || "";
export function isNvidiaAvailable() { return !!NVIDIA_KEY && !NVIDIA_KEY.includes('your-'); }

// Log engine availability at startup — boolean flags only, NEVER key prefixes.
console.log('[config] AI engine availability:');
console.log(`  NVIDIA: ${isNvidiaAvailable() ? 'available' : 'missing (set NVIDIA_API_KEY)'}`);
console.log(`  Gemini: ${isGeminiAvailable() ? 'available' : 'missing (set GEMINI_API_KEY)'}`);
console.log(`  Groq:   ${isGroqAvailable() ? 'available' : 'missing (set GROQ_API_KEY)'}`);
console.log(`  Claude: ${isClaudeAvailable() ? 'available' : 'missing (set ANTHROPIC_API_KEY)'}`);
console.log(`  OpenRouter: ${isOpenRouterAvailable() ? 'available' : 'missing (set OPENROUTER_API_KEY)'}`);
console.log(`  Cerebras: ${isCerebrasAvailable() ? 'available' : 'missing (set CEREBRAS_API_KEY)'}`);
console.log(`  HuggingFace: ${isHFAvailable() ? 'available' : 'missing (set HF_API_KEY)'}`);
console.log(`  Tavily: ${isTavilyAvailable() ? 'available' : 'missing (set TAVILY_API_KEY)'}`);

// SIP Defaults
export const DEFAULT_INDIA_SIP = 10000;
export const DEFAULT_US_SIP = 50;
export const DEFAULT_USD_INR = 85.5;

// ML Service
export const ML_SERVICE_URL = process.env.ML_SERVICE_URL || 'http://localhost:8000';

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
  if (sym.endsWith('BEES')) return 'IN';
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
