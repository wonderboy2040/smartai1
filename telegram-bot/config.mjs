// ============================================
// DEEP MIND AI TRADING BOT — CONFIGURATION
// ============================================

// Telegram Credentials
export const TG_TOKEN = "8561229979:AAH24LmFeRbhoDCAIL6colX-KlogOseI9aY";
export const TG_CHAT_ID = "5488576360";

// Google Apps Script Cloud Sync
export const API_URL = "https://script.google.com/macros/s/AKfycbxITH5b_KKXvhPq3RukOA04d4pVgPrwp4uIiY2BDDMPWZ99oE0Ism2u5FJONR3LUDvhsg/exec";

// Gemini AI (Google — FREE)
export let GROQ_KEY = "";
export function setGroqKey(key) { GROQ_KEY = key; }

// SIP Defaults
export const DEFAULT_INDIA_SIP = 10000;
export const DEFAULT_US_SIP = 200;
export const DEFAULT_USD_INR = 83.5;

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
