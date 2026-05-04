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

// Clean keys (remove accidentally pasted quotes or spaces)
if (GROQ_KEY) GROQ_KEY = GROQ_KEY.replace(/['"]/g, '').trim();
if (GEMINI_API_KEY) GEMINI_API_KEY = GEMINI_API_KEY.replace(/['"]/g, '').trim();
if (CLAUDE_API_KEY) CLAUDE_API_KEY = CLAUDE_API_KEY.replace(/['"]/g, '').trim();

// Validate API keys at startup
const missingKeys = [];
if (!GROQ_KEY || !GROQ_KEY.startsWith('gsk_')) missingKeys.push('GROQ_KEY');
if (!GEMINI_API_KEY || GEMINI_API_KEY.length < 10) missingKeys.push('GEMINI_API_KEY');
if (!CLAUDE_API_KEY || CLAUDE_API_KEY.length < 10) missingKeys.push('CLAUDE_API_KEY');

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

export function setGroqKey(key) { GROQ_KEY = key; }
export function setGeminiKey(key) { GEMINI_API_KEY = key; }
export function setClaudeKey(key) { CLAUDE_API_KEY = key; }

// Dynamic key validation helpers (called at runtime, not module load)
export function isGroqAvailable() { return !!(GROQ_KEY && GROQ_KEY.startsWith('gsk_')); }
export function isGeminiAvailable() { return !!(GEMINI_API_KEY && GEMINI_API_KEY.length > 10); }
export function isClaudeAvailable() { return !!(CLAUDE_API_KEY && CLAUDE_API_KEY.length > 10); }

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
  { sym: 'MOMENTUM50', name: 'Motilal Oswal Nifty 500 Momentum 50', cagr: 22.5, maxDD: 30, cat: 'Smart Beta', fixedAlloc: 0.38 },
  { sym: 'SMALLCAP', name: 'Nippon India Nifty Smallcap 250', cagr: 26.5, maxDD: 40, cat: 'Growth', fixedAlloc: 0.27 },
  { sym: 'MID150BEES', name: 'Nippon India Nifty Midcap 150', cagr: 21.0, maxDD: 35, cat: 'Growth', fixedAlloc: 0.20 }
];

export const ALPHA_ETFS_US = [
  { sym: 'SMH', name: 'VanEck Semiconductor', cagr: 28.5, maxDD: 45, cat: 'Tech Alpha', fixedAlloc: 0.45 },
  { sym: 'QQQM', name: 'Invesco NASDAQ 100', cagr: 19.5, maxDD: 34, cat: 'Broad Tech', fixedAlloc: 0.35 },
  { sym: 'VGT', name: 'Vanguard Information Technology ETF', cagr: 21.0, maxDD: 33, cat: 'Tech', fixedAlloc: 0.20 }
];

export const EXACT_TICKER_MAP = {
  'SMH': 'NASDAQ:SMH',
  'QQQM': 'NASDAQ:QQQM',
  'VGT': 'AMEX:VGT',
  'AVUV': 'AMEX:AVUV',
  'IWM': 'AMEX:IWM',
  'VEA': 'AMEX:VEA',
  'SPY': 'AMEX:SPY',
  'DIA': 'AMEX:DIA',
  'XLV': 'AMEX:XLV',
  'VIX': 'CBOE:VIX',
  'NIFTY': 'NSE:NIFTY',
  'GIFT_NIFTY': 'NSE:GIFT_NIFTY'
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
