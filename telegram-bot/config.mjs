// ============================================
// DEEP MIND AI TRADING BOT — CONFIGURATION
// Advance Pro v16.0 — 3-Engine Architecture
// Gemini + Claude + Groq (Only FREE Models)
// ============================================

import 'dotenv/config';

// Telegram Credentials (set via environment variables / .env file)
export const TG_TOKEN = process.env.TG_TOKEN || "";
export const TG_CHAT_ID = process.env.TG_CHAT_ID || "";

// Google Apps Script Cloud Sync
export const API_URL = process.env.API_URL || "";

// Tavily Search API (Real-time Web Data)
// NOTE: declared with `let` so setTavilyKey() can update it at runtime (/setkey tavily)
export let TAVILY_API_KEY = process.env.TAVILY_API_KEY || process.env.VITE_TAVILY_API_KEY || "";

// ============================================
// 3-ENGINE AI ARCHITECTURE (FREE-FIRST)
// ============================================
// 1. Gemini — Latest FREE (gemini-2.0-flash) — Google Search grounding
// 2. Claude — Latest (claude-sonnet-4-5 / claude-3-5-haiku) — paid API, optional fallback
// 3. Groq   — Latest FREE (llama-3.3-70b-versatile + groq/compound live web)
// ============================================
const env = process.env;

// ============================================
// SMART KEY DETECTION — Scans ALL env vars for any naming variation
// Works with Render, Vercel, Netlify, Railway, local .env, any provider
// ============================================
console.log('🔍 [DEBUG] Scanning ALL environment variables for AI API keys...');
const allEnvKeys = Object.keys(env);

// Log all matching vars (case-insensitive) to help debug naming issues
const matches = allEnvKeys.filter(k => {
  const u = k.toUpperCase();
  return u.includes('GROQ') || u.includes('GEMINI') || u.includes('CLAUDE') || u.includes('TAVILY');
});
if (matches.length > 0) {
  console.log(`🔍 [DEBUG] Found ${matches.length} matching env var(s): ${matches.join(', ')}`);
} else {
  console.log('🔍 [DEBUG] No GROQ/GEMINI/CLAUDE/TAVILY env vars found — checking process.env directly...');
  // Fallback: dump a few to help debug
  console.log(`🔍 [DEBUG] First 20 env var names: ${allEnvKeys.slice(0, 20).join(', ')}`);
}

// Default to empty (export let so bot.mjs gets live bindings)
export let GROQ_KEY = "";
export let GEMINI_API_KEY = "";
export let CLAUDE_API_KEY = "";

// --- Smart scan: iterate ALL env vars, use any that match ---
for (const k of allEnvKeys) {
  const v = (env[k] || '').toString().trim();
  if (!v || v.length < 5) continue;
  const u = k.toUpperCase();

  // Groq: keys start with gsk_
  if (u.includes('GROQ') && v.startsWith('gsk_') && v.length > 20) {
    if (!GROQ_KEY) { GROQ_KEY = v; console.log(`  → Groq key loaded from env var: ${k}`); }
  }

  // Gemini: 20-200 char alphanumeric (no prefix), or any var named with GEMINI
  if (u.includes('GEMINI') && v.length > 10 && v.length < 300) {
    if (!GEMINI_API_KEY && !v.startsWith('gsk_') && !v.startsWith('sk-ant-') && !v.startsWith('tvly-')) {
      GEMINI_API_KEY = v;
      console.log(`  → Gemini key loaded from env var: ${k}`);
    }
  }

  // Claude: keys start with sk-ant-
  if (u.includes('CLAUDE') && v.startsWith('sk-ant-') && v.length > 20) {
    if (!CLAUDE_API_KEY) { CLAUDE_API_KEY = v; console.log(`  → Claude key loaded from env var: ${k}`); }
  }

  // Tavily: keys start with tvly-
  if (u.includes('TAVILY') && v.startsWith('tvly-') && v.length > 10) {
    if (!TAVILY_API_KEY) { TAVILY_API_KEY = v; console.log(`  → Tavily key loaded from env var: ${k}`); }
  }
}

// --- Explicit name fallbacks (exact names users commonly set) ---
const explicitFallbacks = [
  // Groq
  ['GROQ_KEY', 'GROQ_API_KEY', 'GROQKEY', 'GROQ_KEY'],
  ['GroqKey', 'GroqAPIKey', 'groq_key', 'groq_api_key'],
  // Gemini
  ['GEMINI_API_KEY', 'GEMINI_KEY', 'GEMINIAPIKEY', 'GEMINI_AI_KEY'],
  ['GeminiAPIKey', 'GeminiKey', 'gemini_api_key', 'gemini_key'],
  // Claude
  ['CLAUDE_API_KEY', 'CLAUDE_KEY', 'CLAUDEAPIKEY', 'CLAUDE_AI_KEY'],
  ['ClaudeAPIKey', 'ClaudeKey', 'claude_api_key', 'claude_key'],
  // Tavily
  ['TAVILY_API_KEY', 'TAVILY_KEY', 'TAVILYAPIKEY'],
  ['TavilyApiKey', 'TavilyKey', 'tavily_api_key', 'tavily_key'],
  // Vite prefixed (for frontend build, but also checked for bot)
  ['VITE_GROQ_API_KEY', 'VITE_GEMINI_API_KEY', 'VITE_CLAUDE_API_KEY', 'VITE_TAVILY_API_KEY'],
];

for (const name of explicitFallbacks[0]) { if (!GROQ_KEY && env[name]) GROQ_KEY = env[name]; }
for (const name of explicitFallbacks[1]) { if (!GROQ_KEY && env[name]) GROQ_KEY = env[name]; }
for (const name of explicitFallbacks[2]) { if (!GEMINI_API_KEY && env[name]) GEMINI_API_KEY = env[name]; }
for (const name of explicitFallbacks[3]) { if (!GEMINI_API_KEY && env[name]) GEMINI_API_KEY = env[name]; }
for (const name of explicitFallbacks[4]) { if (!CLAUDE_API_KEY && env[name]) CLAUDE_API_KEY = env[name]; }
for (const name of explicitFallbacks[5]) { if (!CLAUDE_API_KEY && env[name]) CLAUDE_API_KEY = env[name]; }
for (const name of explicitFallbacks[6]) { if (!TAVILY_API_KEY && env[name]) TAVILY_API_KEY = env[name]; }
for (const name of explicitFallbacks[7]) { if (!TAVILY_API_KEY && env[name]) TAVILY_API_KEY = env[name]; }
for (const name of explicitFallbacks[8]) {
  if (!GROQ_KEY && env[name]) GROQ_KEY = env[name];
  if (!GEMINI_API_KEY && env[name] && name.includes('GEMINI')) GEMINI_API_KEY = env[name];
  if (!CLAUDE_API_KEY && env[name] && name.includes('CLAUDE')) CLAUDE_API_KEY = env[name];
  if (!TAVILY_API_KEY && env[name] && name.includes('TAVILY')) TAVILY_API_KEY = env[name];
}

// Clean keys (remove accidentally pasted quotes or spaces)
if (GROQ_KEY) GROQ_KEY = GROQ_KEY.replace(/['"]/g, '').trim();
if (GEMINI_API_KEY) GEMINI_API_KEY = GEMINI_API_KEY.replace(/['"]/g, '').trim();
if (CLAUDE_API_KEY) CLAUDE_API_KEY = CLAUDE_API_KEY.replace(/['"]/g, '').trim();
if (TAVILY_API_KEY) TAVILY_API_KEY = TAVILY_API_KEY.replace(/['"]/g, '').trim();

// Final fallback: if any key looks like a recognized format, find it anywhere
if (!GROQ_KEY) {
  for (const v of Object.values(env)) {
    if (typeof v === 'string' && v.startsWith('gsk_') && v.length > 20) {
      GROQ_KEY = v.replace(/['"]/g, '').trim();
      console.log(`  → Groq key auto-detected from unmatched env var`);
      break;
    }
  }
}
if (!CLAUDE_API_KEY) {
  for (const v of Object.values(env)) {
    if (typeof v === 'string' && v.startsWith('sk-ant-') && v.length > 20) {
      CLAUDE_API_KEY = v.replace(/['"]/g, '').trim();
      console.log(`  → Claude key auto-detected from unmatched env var`);
      break;
    }
  }
}

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
  console.log('✅ All 3 AI API keys validated successfully');
}

// Log individual key status
console.log('🔑 AI Engine Key Status (3-Engine Advance Pro):');
if (GROQ_KEY) console.log(`  ⚡ Groq: ✓ Valid (${GROQ_KEY.substring(0, 8)}...)`);
else console.log('  ⚡ Groq: ✗ Missing');
if (GEMINI_API_KEY && GEMINI_API_KEY.length > 10) console.log(`  🔵 Gemini: ✓ Valid (${GEMINI_API_KEY.substring(0, 8)}...)`);
else console.log('  🔵 Gemini: ✗ Missing');
if (CLAUDE_API_KEY && CLAUDE_API_KEY.length > 10) console.log(`  🟣 Claude: ✓ Valid (${CLAUDE_API_KEY.substring(0, 8)}...)`);
else console.log('  🟣 Claude: ✗ Missing');

export function setGroqKey(key) { GROQ_KEY = key; }
export function setGeminiKey(key) { GEMINI_API_KEY = key; }
export function setClaudeKey(key) { CLAUDE_API_KEY = key; }
export function setTavilyKey(key) { TAVILY_API_KEY = key; }

// Dynamic key validation helpers (called at runtime, not module load)
export function isGroqAvailable() { return !!(GROQ_KEY && GROQ_KEY.length > 10); }
export function isGeminiAvailable() { return !!(GEMINI_API_KEY && GEMINI_API_KEY.length > 10); }
export function isClaudeAvailable() { return !!(CLAUDE_API_KEY && CLAUDE_API_KEY.length > 10); }
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
  { sym: 'SMH', name: 'VanEck Semiconductor', cagr: 28.5, maxDD: 45, cat: 'Tech Alpha', fixedAlloc: 0.40 },
  { sym: 'VGT', name: 'Vanguard Information Technology ETF', cagr: 21.0, maxDD: 33, cat: 'Tech', fixedAlloc: 0.33 },
  { sym: 'SPCX', name: 'SPAC and New Issue ETF', cagr: 15.0, maxDD: 35, cat: 'SPAC/Growth', fixedAlloc: 0.27 }
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
  'SPCX': 'NASDAQ:SPCX',
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
