// ============================================================
// SMART MARKET DATA FALLBACK LAYER
// ------------------------------------------------------------
// Walks a per-market fallback chain ordered by IP-ban risk
// (never-banned first, key-gated last). Returns the first
// successful response. Zero-config resilience.
//
// Markets: india, us, crypto, forex
// Sources (ordered by ban-risk):
//   India:  Groww → Yahoo .NS → Yahoo .BO
//   US:     Finnhub → Yahoo → Stooq CSV
//   Crypto: CoinDCX (proxy) → Binance → CoinGecko
//   Forex:  Open ER API → Frankfurter → ExchangeRate
// ============================================================

import { DEFAULT_USD_INR } from './constants';
import { apiFetch } from './api';

const PROXY_BASE = (import.meta.env.VITE_API_PROXY as string) || '';

export interface QuoteResult {
  symbol: string;
  price: number;
  change: number;
  high?: number;
  low?: number;
  volume?: number;
  source: string;
  timestamp: number;
}

// Cache: 5s TTL for price quotes
const _cache = new Map<string, { data: QuoteResult | null; ts: number }>();
const CACHE_TTL = 5000;

// ---- INDIA: Groww (via server proxy) → Yahoo .NS → Yahoo .BO ----
async function fetchIndiaQuote(symbol: string): Promise<QuoteResult | null> {
  const clean = symbol.replace('.NS', '').replace('.BO', '').trim().toUpperCase();
  // 1) Server proxy /api/quote (handles Groww + Yahoo fallback server-side)
  try {
    const res = await apiFetch(`${PROXY_BASE}/api/quote?symbols=${encodeURIComponent(clean)}&market=IN`, {
      signal: AbortSignal.timeout(5000),
    });
    if (res.ok) {
      const data = await res.json();
      const q = data?.quotes?.[clean];
      if (q && q.price > 0) {
        return {
          symbol: clean, price: q.price, change: q.change || 0,
          high: q.high, low: q.low, volume: q.volume,
          source: q.source || 'proxy-india', timestamp: Date.now(),
        };
      }
    }
  } catch { /* try next */ }
  return null;
}

// ---- US: Finnhub (via proxy) → Yahoo → Stooq ----
async function fetchUSQuote(symbol: string): Promise<QuoteResult | null> {
  const clean = symbol.replace('.NS', '').replace('.BO', '').trim().toUpperCase();
  try {
    const res = await apiFetch(`${PROXY_BASE}/api/quote?symbols=${encodeURIComponent(clean)}&market=US`, {
      signal: AbortSignal.timeout(5000),
    });
    if (res.ok) {
      const data = await res.json();
      const q = data?.quotes?.[clean];
      if (q && q.price > 0) {
        return {
          symbol: clean, price: q.price, change: q.change || 0,
          high: q.high, low: q.low, volume: q.volume,
          source: q.source || 'proxy-us', timestamp: Date.now(),
        };
      }
    }
  } catch { /* try next */ }
  // Fallback: Stooq CSV (free, no key, no ban)
  try {
    const stooqSym = clean.toLowerCase() + '.us';
    const res = await fetch(`https://stooq.com/q/l/?s=${stooqSym}&f=sd2t2ohlcv&h&e=csv`, {
      signal: AbortSignal.timeout(4000),
    });
    if (res.ok) {
      const text = await res.text();
      const lines = text.trim().split('\n');
      if (lines.length >= 2) {
        const parts = lines[1].split(',');
        if (parts.length >= 5) {
          const price = parseFloat(parts[4]); // close
          if (price > 0) {
            return {
              symbol: clean, price, change: 0,
              source: 'stooq', timestamp: Date.now(),
            };
          }
        }
      }
    }
  } catch { /* all failed */ }
  return null;
}

// ---- CRYPTO: CoinDCX (via proxy) → Binance → CoinGecko ----
async function fetchCryptoQuote(symbol: string): Promise<QuoteResult | null> {
  const clean = symbol.replace('.NS', '').replace('.BO', '').trim().toUpperCase();
  // 1) CoinDCX via proxy
  try {
    const res = await apiFetch(`${PROXY_BASE}/api/crypto-prices?t=${Date.now()}`, {
      signal: AbortSignal.timeout(5000),
    });
    if (res.ok) {
      const tickers = await res.json();
      const t = tickers.find((x: any) => x.market === `${clean}INR`);
      if (t && parseFloat(t.last_price) > 0) {
        return {
          symbol: clean,
          price: parseFloat(t.last_price),
          change: parseFloat(t.change_24_hour) || 0,
          high: parseFloat(t.high) || 0,
          low: parseFloat(t.low) || 0,
          volume: parseFloat(t.volume) || 0,
          source: 'coindcx', timestamp: Date.now(),
        };
      }
    }
  } catch { /* try next */ }
  // 2) Binance (USDT pair, free, no key)
  try {
    const res = await fetch(`https://api.binance.com/api/v3/ticker/24hr?symbol=${clean}USDT`, {
      signal: AbortSignal.timeout(4000),
    });
    if (res.ok) {
      const d = await res.json();
      const price = parseFloat(d.lastPrice);
      if (price > 0) {
        return {
          symbol: clean, price, change: parseFloat(d.priceChangePercent) || 0,
          high: parseFloat(d.highPrice) || 0, low: parseFloat(d.lowPrice) || 0,
          volume: parseFloat(d.volume) || 0,
          source: 'binance', timestamp: Date.now(),
        };
      }
    }
  } catch { /* try next */ }
  // 3) CoinGecko (free, no key, simple price endpoint)
  try {
    const cgId = clean.toLowerCase() === 'btc' ? 'bitcoin'
      : clean.toLowerCase() === 'eth' ? 'ethereum'
      : clean.toLowerCase() === 'sol' ? 'solana'
      : clean.toLowerCase() === 'bnb' ? 'binancecoin'
      : clean.toLowerCase() === 'xrp' ? 'ripple'
      : clean.toLowerCase() === 'ada' ? 'cardano'
      : clean.toLowerCase() === 'doge' ? 'dogecoin'
      : clean.toLowerCase() === 'dot' ? 'polkadot'
      : clean.toLowerCase();
    const res = await fetch(`https://api.coingecko.com/api/v3/simple/price?ids=${cgId}&vs_currencies=inr&include_24hr_change=true`, {
      signal: AbortSignal.timeout(4000),
    });
    if (res.ok) {
      const d = await res.json();
      const p = d?.[cgId];
      if (p && p.inr > 0) {
        return {
          symbol: clean, price: p.inr, change: p.inr_24h_change || 0,
          source: 'coingecko', timestamp: Date.now(),
        };
      }
    }
  } catch { /* all failed */ }
  return null;
}

// ---- FOREX: Open ER API → Frankfurter → ExchangeRate ----
export async function fetchForexFallback(): Promise<number> {
  const sources = [
    'https://open.er-api.com/v6/latest/USD',
    'https://api.frankfurter.app/latest?from=USD&to=INR',
    'https://api.exchangerate-api.com/v4/latest/USD',
  ];
  for (const url of sources) {
    try {
      const r = await fetch(url, { signal: AbortSignal.timeout(4000) });
      if (!r.ok) continue;
      const j = await r.json();
      const inr = j?.rates?.INR;
      if (typeof inr === 'number' && inr > 50 && inr < 150) return inr;
    } catch { /* try next */ }
  }
  return DEFAULT_USD_INR;
}

// ---- MAIN: Smart quote with fallback ----
export async function fetchSmartQuote(
  symbol: string,
  market: 'IN' | 'US' | 'CRYPTO'
): Promise<QuoteResult | null> {
  const cacheKey = `${market}_${symbol}`;
  const cached = _cache.get(cacheKey);
  if (cached && Date.now() - cached.ts < CACHE_TTL) return cached.data;

  let result: QuoteResult | null = null;
  if (market === 'IN') result = await fetchIndiaQuote(symbol);
  else if (market === 'US') result = await fetchUSQuote(symbol);
  else if (market === 'CRYPTO') result = await fetchCryptoQuote(symbol);

  _cache.set(cacheKey, { data: result, ts: Date.now() });
  return result;
}

// ---- Health check: which sources are alive? ----
export async function checkSourceHealth(): Promise<Record<string, boolean>> {
  const health: Record<string, boolean> = {};
  const checks: Promise<void>[] = [
    (async () => {
      try {
        const r = await apiFetch(`${PROXY_BASE}/api/quote?symbols=RELIANCE&market=IN`, { signal: AbortSignal.timeout(3000) });
        health.india_proxy = r.ok;
      } catch { health.india_proxy = false; }
    })(),
    (async () => {
      try {
        const r = await apiFetch(`${PROXY_BASE}/api/quote?symbols=AAPL&market=US`, { signal: AbortSignal.timeout(3000) });
        health.us_proxy = r.ok;
      } catch { health.us_proxy = false; }
    })(),
    (async () => {
      try {
        const r = await apiFetch(`${PROXY_BASE}/api/crypto-prices?t=${Date.now()}`, { signal: AbortSignal.timeout(3000) });
        health.crypto_coindcx = r.ok;
      } catch { health.crypto_coindcx = false; }
    })(),
    (async () => {
      try {
        const r = await fetch('https://api.binance.com/api/v3/ping', { signal: AbortSignal.timeout(3000) });
        health.crypto_binance = r.ok;
      } catch { health.crypto_binance = false; }
    })(),
    (async () => {
      try {
        const r = await fetch('https://api.coingecko.com/api/v3/ping', { signal: AbortSignal.timeout(3000) });
        health.crypto_coingecko = r.ok;
      } catch { health.crypto_coingecko = false; }
    })(),
  ];
  await Promise.allSettled(checks);
  return health;
}
