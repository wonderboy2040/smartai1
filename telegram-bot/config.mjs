// ============================================
// DEEP MIND AI TRADING BOT — CONFIGURATION
// ============================================

import 'dotenv/config';

// Telegram Credentials (set via environment variables / .env file)
export const TG_TOKEN = process.env.TG_TOKEN || "";
export const TG_CHAT_ID = process.env.TG_CHAT_ID || "";

// Google Apps Script Cloud Sync
export const API_URL = process.env.API_URL || "";

// Multi-AI API Keys
export let GROQ_KEY = process.env.GROQ_KEY || "";
// Tavily Search API (Real-time Web Data - Replaces Gemini)
export const TAVILY_API_KEY = process.env.TAVILY_API_KEY || "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";
export const TAVILY_BASE_URL = "https://api.tavily.com/search";
// NVIDIA API Keys (DeepSeek V3 for Analysis)
export const NVIDIA_API_KEY = process.env.NVIDIA_API_KEY || "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";
export const NVIDIA_BASE_URL = process.env.NVIDIA_BASE_URL || "https://integrate.api.nvidia.com/v1";
export const NVIDIA_DEEPSEEK_MODEL = process.env.NVIDIA_DEEPSEEK_MODEL || "deepseek-ai/deepseek-v3.2";
// Legacy keys (fallback)
export let GEMINI_KEY = process.env.GEMINI_KEY || TAVILY_API_KEY; // Tavily replaces Gemini
export let DEEPSEEK_KEY = process.env.DEEPSEEK_KEY || NVIDIA_API_KEY;

// Validate API keys at startup
const missingKeys = [];
if (!TAVILY_API_KEY || !TAVILY_API_KEY.startsWith('tvly-')) missingKeys.push('TAVILY_API_KEY');
if (!NVIDIA_API_KEY || !NVIDIA_API_KEY.startsWith('nvapi-')) missingKeys.push('NVIDIA_API_KEY');
if (!GROQ_KEY || !GROQ_KEY.startsWith('gsk_')) missingKeys.push('GROQ_KEY (optional)');

if (missingKeys.length > 0 && missingKeys[0] !== 'GROQ_KEY (optional)') {
  console.warn('⚠️  WARNING: Some API keys are missing or invalid:');
  console.warn('  ' + missingKeys.join(', '));
  console.warn('Some features may not work properly.');
} else {
  console.log('✅ All required API keys validated successfully');
  if (TAVILY_API_KEY) console.log('  ✓ Tavily Search API configured');
  if (NVIDIA_API_KEY) console.log('  ✓ NVIDIA DeepSeek V3 configured');
  if (GROQ_KEY) console.log('  ✓ Groq Llama-3 configured');
}

export function setGroqKey(key) { GROQ_KEY = key; }
export function setGeminiKey(key) { GEMINI_KEY = key; }
export function setDeepSeekKey(key) { DEEPSEEK_KEY = key; }

// SIP Defaults
export const DEFAULT_INDIA_SIP = 10000;
export const DEFAULT_US_SIP = 50;
export const DEFAULT_USD_INR = 90;

// CORS Proxies (for Yahoo Finance — server-side we can call directly)
export const CORS_PROXIES = [
  '', // Direct (no proxy needed on server-side)
  'https://api.allorigins.win/raw?url=',
  'https://corsproxy.io/?'
];

// ETF Configurations
export const ALPHA_ETFS_IN = [
  { sym: 'JUNIORBEES', name: 'Nippon India ETF Junior BeES', cagr: 18.5, maxDD: 30, cat: 'Next 50', fixedAlloc: 0.15 },
  { sym: 'MOMOMENTUM', name: 'Motilal Oswal Nifty 200 Momentum 30', cagr: 22.5, maxDD: 30, cat: 'Smart Beta', fixedAlloc: 0.38 },
  { sym: 'SMALLCAP', name: 'Nippon India Nifty Smallcap 250', cagr: 26.5, maxDD: 40, cat: 'Growth', fixedAlloc: 0.27 },
  { sym: 'MID150BEES', name: 'Nippon India Nifty Midcap 150', cagr: 21.0, maxDD: 35, cat: 'Growth', fixedAlloc: 0.20 }
];

export const ALPHA_ETFS_US = [
  { sym: 'SMH', name: 'VanEck Semiconductor', cagr: 28.5, maxDD: 45, cat: 'Tech Alpha', fixedAlloc: 0.45 },
  { sym: 'QQQM', name: 'Invesco NASDAQ 100', cagr: 19.5, maxDD: 34, cat: 'Broad Tech', fixedAlloc: 0.35 },
  { sym: 'XLK', name: 'Technology Select Sector SPDR', cagr: 20.5, maxDD: 33, cat: 'Tech', fixedAlloc: 0.20 }
];

export const EXACT_TICKER_MAP = {
  'SMH': 'NASDAQ:SMH',
  'QQQM': 'NASDAQ:QQQM',
  'XLK': 'AMEX:XLK',
  'AVUV': 'AMEX:AVUV',
  'IWM': 'AMEX:IWM',
  'VEA': 'AMEX:VEA',
  'SPY': 'AMEX:SPY',
  'DIA': 'AMEX:DIA',
  'XLV': 'AMEX:XLV',
  'VIX': 'CBOE:VIX'
};

// Helpers
export function guessMarket(sym) {
  sym = (sym || '').toUpperCase();
  if (sym.includes('.NS') || sym.includes('.BO')) return 'IN';
  if (sym === 'RELIANCE' || sym === 'NIFTY' || sym === 'SENSEX') return 'IN';
  if (sym.includes('BEES')) return 'IN';
  if (ALPHA_ETFS_IN.some(e => e.sym === sym.replace('.NS', ''))) return 'IN';
  return 'US';
}

export function getAssetCagrProxy(sym, mkt) {
  sym = sym.toUpperCase();
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
