import { ETFInfo } from '../types';

export const SECURE_PIN = "2023";
export const DEFAULT_USD_INR = 83.5;
export const API_URL = import.meta.env.VITE_API_URL || "";
export const TG_TOKEN = import.meta.env.VITE_TG_TOKEN || "";
export const TG_CHAT_ID = import.meta.env.VITE_TG_CHAT_ID || "";

export const TAX_PAIRS: Record<string, string> = {
  'ITBEES.NS': 'TATAIT.NS',
  'QQQM': 'QQQ',
  'SMH': 'SOXX'
};

export const ALPHA_ETFS_IN: ETFInfo[] = [
  { sym: 'JUNIORBEES', name: 'Nippon India ETF Junior BeES', cagr: 18.5, maxDD: 30, cat: 'Next 50', aum: '₹2.5k Cr', vol: 'High', fixedAlloc: 0.15 },
  { sym: 'MOMENTUM50', name: 'Motilal Oswal Nifty 500 Momentum 50', cagr: 22.5, maxDD: 30, cat: 'Smart Beta', aum: '₹3k Cr', vol: 'Moderate', fixedAlloc: 0.38 },
  { sym: 'SMALLCAP', name: 'Nippon India Nifty Smallcap 250', cagr: 26.5, maxDD: 40, cat: 'Growth', aum: '₹1k Cr', vol: 'Moderate', fixedAlloc: 0.27 },
  { sym: 'MID150BEES', name: 'Nippon India Nifty Midcap 150', cagr: 21.0, maxDD: 35, cat: 'Growth', aum: '₹2.8k Cr', vol: 'High', fixedAlloc: 0.20 }
];

export const ALPHA_ETFS_US: ETFInfo[] = [
  { sym: 'SMH', name: 'VanEck Semiconductor', cagr: 28.5, maxDD: 45, cat: 'Tech Alpha', aum: '$15B', vol: 'Extreme', fixedAlloc: 0.45 },
  { sym: 'QQQM', name: 'Invesco NASDAQ 100', cagr: 19.5, maxDD: 34, cat: 'Broad Tech', aum: '$30B', vol: 'High', fixedAlloc: 0.35 },
  { sym: 'VGT', name: 'Vanguard Information Technology ETF', cagr: 21.0, maxDD: 33, cat: 'Tech', aum: '$75B', vol: 'High', fixedAlloc: 0.20 }
];

export const EXACT_TICKER_MAP: Record<string, string> = {
  // US ETFs & Indices
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
  'SPX': 'SP:SPX',
  'NDX': 'NASDAQ:NDX',
  'DJI': 'TVC:DJI',
  'RUT': 'AMEX:RUT',

  // Indian ETFs & Indices (already have NSE: prefix in code, but explicit mapping for accuracy)
  'NIFTY': 'NSE:NIFTY',
  'SENSEX': 'BSE:SENSEX',
  'BANKNIFTY': 'NSE:BANKNIFTY',
  'NIFTY50': 'NSE:NIFTY',
  'NIFTYBANK': 'NSE:BANKNIFTY',
  'INDIAVIX': 'NSE:INDIAVIX',

  // Common Indian ETFs from ALPHA_ETFS_IN
  'JUNIORBEES': 'NSE:JUNIORBEES',
  'MOMENTUM50': 'NSE:MOMENTUM50',
  'SMALLCAP': 'NSE:SMALLCAP',
  'MID150BEES': 'NSE:MID150BEES',

  // Additional US symbols
  'QQQ': 'NASDAQ:QQQ',
  'AAPL': 'NASDAQ:AAPL',
  'MSFT': 'NASDAQ:MSFT',
  'GOOGL': 'NASDAQ:GOOGL',
  'AMZN': 'NASDAQ:AMZN',
  'META': 'NASDAQ:META',
  'NVDA': 'NASDAQ:NVDA',
  'TSLA': 'NASDAQ:TSLA',
  'BTC': 'BITSTAMP:BTCUSD',
  'ETH': 'BITSTAMP:ETHUSD'
};

export const CORS_PROXIES = [
  'https://api.allorigins.win/raw?url=',
  'https://corsproxy.io/?'
];

export function getTodayString(): string {
  const t = new Date();
  let m = t.getMonth() + 1;
  let d = t.getDate();
  return `${t.getFullYear()}-${m < 10 ? '0' + m : m}-${d < 10 ? '0' + d : d}`;
}

export function guessMarket(sym: string): 'IN' | 'US' {
  sym = (sym || '').toUpperCase();
  if (sym.includes('.NS') || sym.includes('.BO')) return 'IN';
  if (sym === 'RELIANCE' || sym === 'NIFTY' || sym === 'SENSEX') return 'IN';
  if (sym.includes('BEES')) return 'IN';
  if (ALPHA_ETFS_IN.some(e => e.sym.replace('.NS', '') === sym)) return 'IN';
  return 'US';
}

export function getAssetCagrProxy(sym: string, mkt: string): number {
  sym = sym.toUpperCase();
  const i = ALPHA_ETFS_IN.find(e => e.sym === sym);
  if (i) return i.cagr;
  const u = ALPHA_ETFS_US.find(e => e.sym === sym);
  if (u) return u.cagr;
  if (sym.includes('XAU') || sym.includes('XAG')) return 8;
  return mkt?.toUpperCase() === 'IN' ? 14 : 12;
}

export function formatCurrency(amount: number, currency: string = '₹'): string {
  if (amount >= 10000000) return `${currency}${(amount / 10000000).toFixed(2)} Cr`;
  if (amount >= 100000) return `${currency}${(amount / 100000).toFixed(2)} L`;
  return `${currency}${amount.toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;
}

export function formatPrice(price: number, currency: string = '₹'): string {
  if (price >= 1000) return `${currency}${price.toLocaleString('en-US', { maximumFractionDigits: 2 })}`;
  return `${currency}${price.toFixed(price < 1 ? 6 : 2)}`;
}
