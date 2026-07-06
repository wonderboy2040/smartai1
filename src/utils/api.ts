import { PriceData, Position } from '../types';
import { EXACT_TICKER_MAP, guessMarket, API_URL as VITE_API_URL, DEFAULT_USD_INR, isCryptoSymbol } from './constants';
// FIX H10: imports must come before any runtime code per ES module style +
// future bundler strictness. Was previously after `getApiUrl()`.
import { isAnyMarketOpen, isIndiaMarketOpen, isUSMarketOpen } from './telegram';

// Proxy base for backend server API calls (same-origin on Render/Vite proxy,
// or custom via VITE_API_PROXY for cross-origin setups).
const PROXY_BASE = (import.meta.env.VITE_API_PROXY as string) || '';

// Runtime API_URL — tries server config first, then VITE build-time env var
// Used ONLY for Google Apps Script cloud sync, NOT for backend /api/* calls.
// FIX: previously this was async + awaited a fetch('/api/config') on EVERY
// call. That added 1-3s of latency before loadFromCloud could even start.
// Now we fire the config fetch once in the background and cache the result.
// Callers get the VITE_API_URL immediately (synchronous), and if the server
// later returns a different URL, subsequent calls use it.
let _runtimeApiUrl: string | null | undefined = undefined;
let _apiUrlPromise: Promise<string> | null = null;

function getApiUrlSync(): string {
  if (_runtimeApiUrl !== undefined) return _runtimeApiUrl || VITE_API_URL;
  return VITE_API_URL;
}

function getApiUrl(): Promise<string> {
  if (_runtimeApiUrl !== undefined) return Promise.resolve(_runtimeApiUrl || VITE_API_URL);
  if (_apiUrlPromise) return _apiUrlPromise;
  _apiUrlPromise = (async () => {
    try {
      const res = await fetch(`${PROXY_BASE}/api/config`, { signal: AbortSignal.timeout(2000) });
      if (res.ok) {
        const cfg = await res.json();
        if (cfg.apiUrl) { _runtimeApiUrl = cfg.apiUrl; return cfg.apiUrl; }
      }
    } catch { /* server not available */ }
    _runtimeApiUrl = null;
    return VITE_API_URL;
  })();
  return _apiUrlPromise;
}

/**
 * Fetch CoinDCX tickers through the server proxy.
 * CoinDCX's public API does NOT serve Access-Control-Allow-Origin headers,
 * so every direct browser fetch is blocked by CORS. The server's
 * /api/crypto-prices endpoint proxies the call server-side.
 */
async function fetchCoinDcxTickers(): Promise<CoinDcxTicker[] | null> {
  try {
    const res = await fetch(`${PROXY_BASE}/api/crypto-prices?t=${Date.now()}`, {
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) return null;
    const data = await res.json();
    return Array.isArray(data) ? data : null;
  } catch {
    return null;
  }
}
interface CoinDcxTicker {
  market: string;
  last_price: string;
  change_24_hour: string;
  high: string;
  low: string;
  volume: string;
}

interface TvScannerItem {
  s: string;
  d: (string | number | null)[];
}

// ========================================
// SMART CACHE with TTL
// ========================================
interface CacheEntry<T> {
  data: T;
  timestamp: number;
  ttl: number;
}

class SmartCache<T> {
  private store = new Map<string, CacheEntry<T>>();
  private maxSize: number;

  constructor(maxSize: number = 50) {
    this.maxSize = maxSize;
  }

  get(key: string): T | null {
    const entry = this.store.get(key);
    if (!entry) return null;
    if (Date.now() - entry.timestamp > entry.ttl) {
      this.store.delete(key);
      return null;
    }
    return entry.data;
  }

  set(key: string, data: T, ttl: number = 5000): void {
    if (this.store.size >= this.maxSize) {
      const oldestKey = this.store.keys().next().value;
      if (oldestKey) this.store.delete(oldestKey);
    }
    this.store.set(key, { data, timestamp: Date.now(), ttl });
  }

  invalidate(key: string): void {
    this.store.delete(key);
  }
}

const priceCache = new SmartCache<PriceData>(50);
const pendingRequests = new Map<string, Promise<PriceData | null>>();

/**
 * Get market-aware batch interval. WebSocket handles real-time;
 * HTTP batch is supplementary for technical indicators (SMA/MACD/RSI).
 */
export function getBatchInterval(): number {
  return isAnyMarketOpen() ? 8000 : 60000;
}

/**
 * Poll cadence for the dedicated NSE/BSE realtime streamer.
 * Ultra-fast (2s) while the Indian market is open (9:15 AM - 3:30 PM IST) so
 * holdings tick like a live feed, aggressive pre-market warm-up in the 15 min
 * BEFORE open (9:00-9:15 AM IST) to catch the very first tick, relaxed (30s)
 * when closed to save bandwidth. Mirrors getUSPollInterval exactly.
 */
export function getIndiaPollInterval(): number {
  if (isIndiaMarketOpen()) return 2000; // ultra-fast 2s tick while NSE/BSE open
  // Pre-market warm-up so prices render the instant NSE opens at 9:15 AM IST.
  const now = new Date();
  const ist = new Date(now.toLocaleString('en-US', { timeZone: 'Asia/Kolkata' }));
  const day = ist.getDay();
  if (day !== 0 && day !== 6) {
    const mins = ist.getHours() * 60 + ist.getMinutes();
    if (mins >= 540 && mins < 555) return 3000; // 9:00-9:15 AM IST pre-open warm-up
    if (mins >= 525 && mins < 540) return 8000;  // 8:45-9:00 AM IST early warm-up
  }
  return 30000;
}

/**
 * Poll cadence for the dedicated US market realtime streamer.
 * Ultra-fast (3s) while the US market is open (7:00 PM IST / 9:30 AM ET),
 * aggressive pre-market (5s) in the 15-minute window BEFORE open to catch
 * the very first tick, relaxed (30s) when closed.
 */
export function getUSPollInterval(): number {
  if (isUSMarketOpen()) return 2000; // ultra-fast 2s tick while US market open
  // Pre-market warm-up: 15 min before US open (9:15-9:30 AM ET / 6:45-7:00 PM IST).
  // Poll fast so the VERY FIRST trade at 9:30 AM ET (7:00 PM IST) renders instantly.
  const now = new Date();
  const est = new Date(now.toLocaleString('en-US', { timeZone: 'America/New_York' }));
  const day = est.getDay();
  if (day !== 0 && day !== 6) {
    const mins = est.getHours() * 60 + est.getMinutes();
    if (mins >= 555 && mins < 570) return 3000; // 9:15-9:30 AM ET pre-open warm-up
    if (mins >= 540 && mins < 555) return 8000;  // 9:00-9:15 AM ET early warm-up
  }
  return 30000;
}

/**
 * Pick the freshest valid price from a TradingView scanner row.
 * Prefers real-time 'last' when the scanner serves it (zero delay), otherwise
 * falls back to 'close' — which IS the live intraday price during market hours.
 * TradingView's anonymous scanner frequently returns last=null; relying on it
 * alone blanked every price and made the UI fall back to the buy price.
 */
function pickScannerPrice(closeVal: unknown, lastVal: unknown): number {
  const last = parseFloat(String(lastVal ?? ''));
  if (!isNaN(last) && last > 0) return last;
  const close = parseFloat(String(closeVal ?? ''));
  return !isNaN(close) && close > 0 ? close : 0;
}

/**
 * REALTIME NSE / BSE STREAMING (HTTP)
 * ------------------------------------------------------------------
 * TradingView's anonymous WebSocket (`unauthorized_user_token`) only streams
 * US exchanges (NASDAQ / NYSE / AMEX / CBOE) in real-time. NSE / BSE quotes are
 * NOT pushed to unauthorized clients, which is exactly why Indian assets looked
 * "frozen" while US assets ticked live.
 *
 * This dedicated fast poller hits the TradingView India scanner directly and
 * feeds prices through the SAME callback pipeline as the WebSocket, so every
 * NSE / BSE holding (stocks AND ETFs) updates in near-real-time just like the
 * US holdings. ETFs are resolved against EXACT_TICKER_MAP first, then fall back
 * to trying BOTH the NSE and BSE listings so either exchange resolves.
 */
export async function batchFetchIndianPrices(
  positions: Position[],
  onUpdate: (key: string, data: PriceData) => void
): Promise<void> {
  // ---- REAL-TIME NSE / BSE PRICES (the India 15-min-delay fix) ----------
  // Price / change / high / low / volume come from the server's /api/quote
  // proxy (Groww NSE live feed — genuine last-traded price — with Yahoo .NS as
  // fallback). The old path read the TradingView India scanner, whose anonymous
  // feed is delayed. SMA / RSI / MACD indicators are still merged from the
  // TradingView India scanner (computed on daily bars, so delay is irrelevant).
  const cleanToKey: Record<string, string> = {};   // RELIANCE -> IN_RELIANCE.NS
  const tvTickers: string[] = [];                    // for indicator enrichment
  const tvToClean: Record<string, string> = {};      // NSE:RELIANCE -> RELIANCE

  positions.forEach(p => {
    if (!p?.symbol) return;
    const mkt = (p.market || guessMarket(p.symbol)).toUpperCase();
    if (mkt !== 'IN') return;
    const cleanSym = p.symbol.replace('.NS', '').replace('.BO', '').trim().toUpperCase();
    if (isCryptoSymbol(cleanSym)) return; // crypto handled by the CoinDCX poller
    cleanToKey[cleanSym] = `IN_${p.symbol.trim()}`;

    if (EXACT_TICKER_MAP[cleanSym]) {
      const t = EXACT_TICKER_MAP[cleanSym];
      tvTickers.push(t);
      tvToClean[t] = cleanSym;
    } else {
      [`NSE:${cleanSym}`, `BSE:${cleanSym}`].forEach(t => {
        tvTickers.push(t);
        tvToClean[t] = cleanSym;
      });
    }
  });

  // Always include India VIX for the regime / fear-greed widgets.
  cleanToKey['INDIAVIX'] = 'IN_INDIAVIX';
  tvTickers.push('NSE:INDIAVIX');
  tvToClean['NSE:INDIAVIX'] = 'INDIAVIX';

  const cleanSyms = Object.keys(cleanToKey);
  if (cleanSyms.length === 0) return;

  const realtimeReq = (async (): Promise<Record<string, PriceData>> => {
    const out: Record<string, PriceData> = {};
    try {
      const url = `${PROXY_BASE}/api/quote?market=IN&symbols=${encodeURIComponent(cleanSyms.join(','))}&t=${Date.now()}`;
      const res = await fetch(url, { signal: AbortSignal.timeout(6000) });
      if (!res.ok) return out;
      const json = await res.json();
      const quotes = json?.quotes || {};
      Object.keys(quotes).forEach(sym => {
        const q = quotes[sym];
        if (!q || !(q.price > 0)) return;
        out[sym] = {
          price: q.price,
          change: typeof q.change === 'number' ? q.change : 0,
          high: q.high || q.price,
          low: q.low || q.price,
          volume: q.volume || 0,
          time: q.time || Date.now(),
          market: 'IN',
        } as PriceData;
      });
    } catch { /* fall back to TradingView below */ }
    return out;
  })();

  const indicatorReq = (async (): Promise<Record<string, Partial<PriceData> & { tvExchange?: string; tvExactSymbol?: string }>> => {
    const out: Record<string, Partial<PriceData> & { tvExchange?: string; tvExactSymbol?: string }> = {};
    const uniqueTv = [...new Set(tvTickers)];
    if (uniqueTv.length === 0) return out;
    try {
      const res = await fetch(`https://scanner.tradingview.com/india/scan?t=${Date.now()}`, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain;charset=UTF-8' },
        body: JSON.stringify({
          symbols: { tickers: uniqueTv },
          columns: ['name', 'close', 'change', 'high', 'low', 'volume', 'SMA20', 'SMA50', 'RSI', 'MACD.macd', 'last']
        }),
        signal: AbortSignal.timeout(6000)
      });
      if (!res.ok) return out;
      const data = await res.json();
      if (!data?.data) return out;
      (data.data as TvScannerItem[]).forEach(item => {
        if (!item.d) return;
        const clean = tvToClean[item.s];
        if (!clean) return;
        const dv = (idx: number) => item.d![idx] as number | string | undefined;
        const changeVal = parseFloat(item.d[2] as string) || 0;
        if (out[clean]) return; // first exchange that resolves wins
        out[clean] = {
          price: pickScannerPrice(item.d[1], item.d[10]) || undefined,
          change: changeVal,
          high: parseFloat(String(dv(3) ?? '')) || undefined,
          low: parseFloat(String(dv(4) ?? '')) || undefined,
          volume: parseFloat(String(dv(5) ?? '')) || undefined,
          sma20: parseFloat(String(dv(6) ?? '')) || undefined,
          sma50: parseFloat(String(dv(7) ?? '')) || undefined,
          rsi: parseFloat(String(dv(8) ?? '')) || Math.max(10, Math.min(90, 50 + (changeVal * 5))),
          macd: parseFloat(String(dv(9) ?? '')) || undefined,
          tvExchange: item.s.split(':')[0],
          tvExactSymbol: item.s,
        };
      });
    } catch { console.warn('NSE indicator poll failed'); }
    return out;
  })();

  const [realtime, indicators] = await Promise.all([realtimeReq, indicatorReq]);

  cleanSyms.forEach(clean => {
    const key = cleanToKey[clean];
    const rt = realtime[clean];
    const ind = indicators[clean];
    if (!rt && !ind) return;

    // Indian indices (NIFTY, BANKNIFTY etc.) → prefer TV scanner (live index data, more reliable than Yahoo ^NSEI)
    const INDIAN_INDICES = new Set(['NIFTY','BANKNIFTY','SENSEX','INDIAVIX','CNXIT']);
    const useTvPrice = INDIAN_INDICES.has(clean) && !!(ind as any)?.price;
    const price = useTvPrice ? (ind as any).price : (rt?.price ?? (ind as any)?.price);
    if (!price || price <= 0) return;

    const usingRealtime = !useTvPrice && !!rt;
    onUpdate(key, {
      price,
      change: usingRealtime ? (rt!.change ?? 0) : (ind?.change ?? 0),
      high: rt?.high ?? ind?.high ?? price,
      low: rt?.low ?? ind?.low ?? price,
      volume: rt?.volume ?? ind?.volume ?? 0,
      sma20: ind?.sma20,
      sma50: ind?.sma50,
      rsi: ind?.rsi ?? Math.max(10, Math.min(90, 50 + ((rt?.change ?? 0) * 5))),
      macd: ind?.macd,
      time: rt?.time ?? Date.now(),
      market: 'IN',
      tvExchange: ind?.tvExchange,
      tvExactSymbol: ind?.tvExactSymbol,
      isRealtime: usingRealtime,
    } as PriceData);
  });
}

/**
 * REALTIME US MARKET STREAMING (HTTP)
 * ------------------------------------------------------------------
 * Mirror of batchFetchIndianPrices but for US assets (SMH, VGT, SPCX, MU etc.).
 * The TradingView WebSocket *does* push US prices, but the scanner HTTP poller
 * provides richer data (SMA/RSI/MACD) and acts as a reliable secondary channel.
 *
 * PRICE FIELD: requests BOTH 'close' and 'last' and uses pickScannerPrice() —
 * prefers real-time 'last' when TradingView serves it, otherwise falls back to
 * 'close' (the live intraday price during market hours). TradingView's anonymous
 * scanner frequently returns last=null; relying on 'last' alone blanked every
 * price and made the portfolio fall back to the buy price (0% change everywhere).
 *
 * Poll cadence: 3s during US market hours, 5s in pre-market (5 min before open),
 * 30s when closed — controlled by getUSPollInterval().
 */
export async function batchFetchUSPrices(
  positions: Position[],
  onUpdate: (key: string, data: PriceData) => void
): Promise<void> {
  // ---- REAL-TIME US PRICES (the 15-min-delay fix) ----------------------
  // Price / change / high / low / volume come from the server's /api/quote
  // proxy (Finnhub or Yahoo real-time — NOT the 15-min-delayed TradingView
  // scanner). Technical indicators (SMA / RSI / MACD) are computed on daily
  // bars, so a small delay there is irrelevant; we still grab them from the
  // TradingView scanner in parallel and MERGE them onto the real-time price.
  const cleanToKey: Record<string, string> = {};   // SMH -> US_SMH
  const tvTickers: string[] = [];                    // for indicator enrichment
  const tvToClean: Record<string, string> = {};      // NASDAQ:SMH -> SMH

  positions.forEach(p => {
    if (!p?.symbol) return;
    const mkt = (p.market || guessMarket(p.symbol)).toUpperCase();
    if (mkt !== 'US') return;
    const cleanSym = p.symbol.replace('.NS', '').replace('.BO', '').trim().toUpperCase();
    if (isCryptoSymbol(cleanSym)) return; // crypto handled by CoinDCX poller
    cleanToKey[cleanSym] = `US_${p.symbol.trim()}`;

    if (EXACT_TICKER_MAP[cleanSym]) {
      const t = EXACT_TICKER_MAP[cleanSym];
      tvTickers.push(t);
      tvToClean[t] = cleanSym;
    } else {
      [`NASDAQ:${cleanSym}`, `NYSE:${cleanSym}`, `AMEX:${cleanSym}`, `ARCA:${cleanSym}`].forEach(t => {
        tvTickers.push(t);
        tvToClean[t] = cleanSym;
      });
    }
  });

  // Always include US VIX for the regime / fear-greed widgets.
  cleanToKey['VIX'] = 'US_VIX';
  tvTickers.push('CBOE:VIX');
  tvToClean['CBOE:VIX'] = 'VIX';

  const cleanSyms = Object.keys(cleanToKey);
  if (cleanSyms.length === 0) return;

  // Fire both requests in parallel: real-time quotes + delayed-but-fine indicators.
  const realtimeReq = (async (): Promise<Record<string, PriceData>> => {
    const out: Record<string, PriceData> = {};
    try {
      const url = `${PROXY_BASE}/api/quote?market=US&symbols=${encodeURIComponent(cleanSyms.join(','))}&t=${Date.now()}`;
      const res = await fetch(url, { signal: AbortSignal.timeout(6000) });
      if (!res.ok) return out;
      const json = await res.json();
      const quotes = json?.quotes || {};
      Object.keys(quotes).forEach(sym => {
        const q = quotes[sym];
        if (!q || !(q.price > 0)) return;
        out[sym] = {
          price: q.price,
          change: typeof q.change === 'number' ? q.change : 0,
          high: q.high || q.price,
          low: q.low || q.price,
          volume: q.volume || 0,
          time: q.time || Date.now(),
          market: 'US',
        } as PriceData;
      });
    } catch { /* fall back to TradingView below */ }
    return out;
  })();

  const indicatorReq = (async (): Promise<Record<string, Partial<PriceData> & { tvExchange?: string; tvExactSymbol?: string }>> => {
    const out: Record<string, Partial<PriceData> & { tvExchange?: string; tvExactSymbol?: string }> = {};
    const uniqueTv = [...new Set(tvTickers)];
    if (uniqueTv.length === 0) return out;
    try {
      const res = await fetch(`https://scanner.tradingview.com/america/scan?t=${Date.now()}`, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain;charset=UTF-8' },
        body: JSON.stringify({
          symbols: { tickers: uniqueTv },
          columns: ['name', 'close', 'change', 'high', 'low', 'volume', 'SMA20', 'SMA50', 'RSI', 'MACD.macd', 'last']
        }),
        signal: AbortSignal.timeout(6000)
      });
      if (!res.ok) return out;
      const data = await res.json();
      if (!data?.data) return out;
      (data.data as TvScannerItem[]).forEach(item => {
        if (!item.d) return;
        const clean = tvToClean[item.s];
        if (!clean) return;
        const dv = (idx: number) => item.d![idx] as number | string | undefined;
        const changeVal = parseFloat(item.d[2] as string) || 0;
        // First exchange that resolves wins (don't overwrite with a later empty row).
        if (out[clean]) return;
        out[clean] = {
          // delayed fallback price (only used if real-time quote missing)
          price: pickScannerPrice(item.d[1], item.d[10]) || undefined,
          change: changeVal,
          high: parseFloat(String(dv(3) ?? '')) || undefined,
          low: parseFloat(String(dv(4) ?? '')) || undefined,
          volume: parseFloat(String(dv(5) ?? '')) || undefined,
          sma20: parseFloat(String(dv(6) ?? '')) || undefined,
          sma50: parseFloat(String(dv(7) ?? '')) || undefined,
          rsi: parseFloat(String(dv(8) ?? '')) || Math.max(10, Math.min(90, 50 + (changeVal * 5))),
          macd: parseFloat(String(dv(9) ?? '')) || undefined,
          tvExchange: item.s.split(':')[0],
          tvExactSymbol: item.s,
        };
      });
    } catch { console.warn('US indicator poll failed'); }
    return out;
  })();

  const [realtime, indicators] = await Promise.all([realtimeReq, indicatorReq]);

  // Merge: real-time price wins; indicators enrich. Emit one update per holding.
  cleanSyms.forEach(clean => {
    const key = cleanToKey[clean];
    const rt = realtime[clean];
    const ind = indicators[clean];
    if (!rt && !ind) return;

    // Price source priority: real-time quote → delayed scanner close (fallback).
    const price = rt?.price ?? ind?.price;
    if (!price || price <= 0) return;

    const usingRealtime = !!rt;
    onUpdate(key, {
      price,
      change: usingRealtime ? (rt!.change ?? 0) : (ind?.change ?? 0),
      high: rt?.high ?? ind?.high ?? price,
      low: rt?.low ?? ind?.low ?? price,
      volume: rt?.volume ?? ind?.volume ?? 0,
      sma20: ind?.sma20,
      sma50: ind?.sma50,
      rsi: ind?.rsi ?? Math.max(10, Math.min(90, 50 + ((rt?.change ?? 0) * 5))),
      macd: ind?.macd,
      time: rt?.time ?? Date.now(),
      market: 'US',
      tvExchange: ind?.tvExchange,
      tvExactSymbol: ind?.tvExactSymbol,
      isRealtime: usingRealtime,
    } as PriceData);
  });
}

export async function fetchSinglePrice(symbol: string, retryAttempt = 0): Promise<PriceData | null> {
  if (!symbol) return null;

  const sym = symbol.toUpperCase().trim();

  // Check cache first (stale-while-revalidate pattern)
  const cached = priceCache.get(sym);
  if (cached) {
    // Return cached data but fetch fresh in background (SWR)
    const data = { ...cached, time: Date.now() };
    fetchWithStaleCheck(sym, retryAttempt);
    return data;
  }

  // Deduplicate in-flight requests
  if (pendingRequests.has(sym)) {
    return pendingRequests.get(sym)!;
  }

  const promise = fetchWithStaleCheck(sym, retryAttempt);
  pendingRequests.set(sym, promise);
  promise.finally(() => pendingRequests.delete(sym));
  return promise;
}

async function fetchWithStaleCheck(sym: string, retryAttempt: number): Promise<PriceData | null> {
  if (!sym || typeof sym !== 'string') {
    return null;
  }

  const cleanSym = sym.replace('.NS', '').replace('.BO', '');
  const isIndian = sym.includes('.NS') || sym.includes('.BO') || sym.endsWith('BEES') || guessMarket(sym) === 'IN'; // FIX M10: endswith

  // Try CoinDCX first via server proxy (direct INR price — matches user's exchange)
  // NOTE: CoinDCX's API does NOT serve CORS headers, so browser-side fetches
  // are always blocked. We use the server proxy at /api/crypto-prices instead.
  if (isCryptoSymbol(cleanSym)) {
    try {
      const tickers = await fetchCoinDcxTickers();
      if (tickers) {
        // CoinDCX markets: BTCINR, ETHINR, SOLINR, etc.
        const inrTicker = tickers.find((t: any) => t.market === `${cleanSym}INR`);
        if (inrTicker && inrTicker.last_price) {
          const priceVal = parseFloat(inrTicker.last_price);
          const changeVal = parseFloat(inrTicker.change_24_hour) || 0;
          if (!isNaN(priceVal) && priceVal > 0) {
            const result: PriceData = {
              price: priceVal,
              change: changeVal,
              high: parseFloat(inrTicker.high) || priceVal,
              low: parseFloat(inrTicker.low) || priceVal,
              volume: parseFloat(inrTicker.volume) || 0,
              rsi: 50,
              market: 'IN',
              tvExchange: 'COINDCX',
              tvExactSymbol: `${cleanSym}INR`,
              time: Date.now()
            };
            const cacheTTL = 5000; // Crypto is 24/7
            priceCache.set(sym, result, cacheTTL);
            return result;
          }
        }
      }
    } catch (e) { console.warn('CoinDCX fetch failed:', e); }
  }

  // Binance fallback for crypto (USD price — will be converted to INR by WebSocket handler)
  if (isCryptoSymbol(cleanSym)) {
    try {
      const binanceSym = `${cleanSym}USDT`;
      const res = await fetch(`https://api.binance.com/api/v3/ticker/24hr?symbol=${binanceSym}`, {
        signal: AbortSignal.timeout(5000)
      });
      if (res.ok) {
        const data = await res.json();
        const priceVal = parseFloat(data.lastPrice);
        const changeVal = parseFloat(data.priceChangePercent);
        if (!isNaN(priceVal) && priceVal > 0) {
          const result: PriceData = {
            price: priceVal,
            change: changeVal,
            high: parseFloat(data.highPrice) || priceVal,
            low: parseFloat(data.lowPrice) || priceVal,
            volume: parseFloat(data.volume) || 0,
            rsi: 50,
            market: 'IN',
            tvExchange: 'BINANCE',
            tvExactSymbol: binanceSym,
            time: Date.now()
          };
          const cacheTTL = 5000;
          priceCache.set(sym, result, cacheTTL);
          return result;
        }
      }
    } catch (e) { console.warn('Binance fetch failed:', e); }
  }

  // Try TradingView first
  try {
    const tvResult = await tryTradingView(sym, cleanSym, isIndian);
    if (tvResult && tvResult.price > 0) {
      const cacheTTL = isAnyMarketOpen() ? 5000 : 30000;
      priceCache.set(sym, tvResult, cacheTTL);
      return tvResult;
    }
  } catch (e) { console.warn('TradingView fetch failed:', e); }

  // Retry with alternate symbol
  if (retryAttempt < 1 && !sym.includes('.NS') && guessMarket(sym) === 'IN') {
    return fetchSinglePrice(sym + '.NS', retryAttempt + 1);
  }

  return null;
}

async function tryTradingView(_sym: string, cleanSym: string, isIndian: boolean): Promise<PriceData | null> {
  const endpoint = isIndian ? 'india' : 'america';

  let tvTickers: string[];
  if (EXACT_TICKER_MAP[cleanSym]) {
    tvTickers = [EXACT_TICKER_MAP[cleanSym]];
  } else if (isIndian) {
    tvTickers = [`NSE:${cleanSym}`, `BSE:${cleanSym}`];
  } else {
    tvTickers = [`NASDAQ:${cleanSym}`, `NYSE:${cleanSym}`, `AMEX:${cleanSym}`, `ARCA:${cleanSym}`];
  }

  try {
    const res = await fetch(`https://scanner.tradingview.com/${endpoint}/scan?t=${Date.now()}`, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=UTF-8' },
      body: JSON.stringify({
        symbols: { tickers: tvTickers },
        columns: ['name', 'close', 'change', 'high', 'low', 'volume', 'SMA20', 'SMA50', 'RSI', 'MACD.macd', 'last']
      }),
      signal: AbortSignal.timeout(3000)
    });

    if (res.ok) {
      const data = await res.json();
      if (data?.data?.length > 0) {
        const items = data.data as TvScannerItem[];
        const item = items.find(x => x.d && pickScannerPrice(x.d[1], x.d[10]) > 0) || items.find(x => x.d) || items[0];
        if (!item?.d) return null;
        const f = (idx: number) => parseFloat(String(item.d![idx] ?? ''));
        const priceVal = pickScannerPrice(item.d[1], item.d[10]);
        const changeVal = f(2) || 0;

        if (!isNaN(priceVal) && priceVal > 0) {
          return {
            price: priceVal,
            change: changeVal,
            high: f(3) || priceVal,
            low: f(4) || priceVal,
            volume: f(5) || 0,
            sma20: f(6) || undefined,
            sma50: f(7) || undefined,
            rsi: f(8) || Math.max(10, Math.min(90, 50 + (changeVal * 5))),
            macd: f(9) || undefined,
            market: isIndian ? 'IN' : 'US',
            tvExchange: item.s.split(':')[0],
            tvExactSymbol: item.s,
            time: Date.now()
          };
        }
      }
    }
  } catch (e) { console.warn('TradingView single fetch failed:', e); }

  return null;
}

export async function batchFetchPrices(
  positions: Position[],
  onUpdate: (key: string, data: PriceData) => void
): Promise<void> {
  const inCleanSyms: string[] = [];
  const usCleanSyms: string[] = [];
  const cleanToKey: Record<string, string> = {};
  const tvTickers: string[] = [];
  const tvToClean: Record<string, string> = {};
  const cryptoPositions: Position[] = [];

  positions.forEach(p => {
    if (!p?.symbol) return;
    const mkt = (p.market || guessMarket(p.symbol)).toUpperCase();
    const key = `${mkt}_${p.symbol.trim()}`;
    const cleanSym = p.symbol.replace('.NS', '').replace('.BO', '').trim().toUpperCase();

    if (isCryptoSymbol(cleanSym)) {
      cryptoPositions.push(p);
      return;
    }

    if (mkt === 'IN' || mkt === 'US') {
      if (mkt === 'IN') inCleanSyms.push(cleanSym);
      else usCleanSyms.push(cleanSym);
      cleanToKey[cleanSym] = key;

      if (EXACT_TICKER_MAP[cleanSym]) {
        const t = EXACT_TICKER_MAP[cleanSym];
        tvTickers.push(t);
        tvToClean[t] = cleanSym;
      } else if (mkt === 'IN') {
        [`NSE:${cleanSym}`, `BSE:${cleanSym}`].forEach(t => {
          tvTickers.push(t);
          tvToClean[t] = cleanSym;
        });
      } else {
        [`NASDAQ:${cleanSym}`, `NYSE:${cleanSym}`, `AMEX:${cleanSym}`, `ARCA:${cleanSym}`].forEach(t => {
          tvTickers.push(t);
          tvToClean[t] = cleanSym;
        });
      }
    }
  });

  // Add VIX indices
  inCleanSyms.push('INDIAVIX');
  cleanToKey['INDIAVIX'] = 'IN_INDIAVIX';
  tvTickers.push('NSE:INDIAVIX');
  tvToClean['NSE:INDIAVIX'] = 'INDIAVIX';

  usCleanSyms.push('VIX');
  cleanToKey['VIX'] = 'US_VIX';
  tvTickers.push('CBOE:VIX');
  tvToClean['CBOE:VIX'] = 'VIX';

  const allInSyms = [...new Set(inCleanSyms)];
  const allUsSyms = [...new Set(usCleanSyms)];

  // 1) REAL-TIME PRICES from server /api/quote (never delayed — Yahoofinance/Finnhub/Groww)
  const realtimeReq = (async (): Promise<Record<string, PriceData>> => {
    const out: Record<string, PriceData> = {};
    const tasks: Promise<void>[] = [];

    if (allInSyms.length > 0) {
      tasks.push((async () => {
        try {
          const url = `${PROXY_BASE}/api/quote?market=IN&symbols=${encodeURIComponent(allInSyms.join(','))}&t=${Date.now()}`;
          const res = await fetch(url, { signal: AbortSignal.timeout(6000) });
          if (!res.ok) return;
          const json = await res.json();
          const quotes = json?.quotes || {};
          Object.entries(quotes).forEach(([sym, q]: [string, any]) => {
            if (!q || !(q.price > 0)) return;
            out[sym] = {
              price: q.price,
              change: typeof q.change === 'number' ? q.change : 0,
              high: q.high || q.price,
              low: q.low || q.price,
              volume: q.volume || 0,
              time: q.time || Date.now(),
              market: 'IN',
            } as PriceData;
          });
        } catch { /* fallback */ }
      })());
    }

    if (allUsSyms.length > 0) {
      tasks.push((async () => {
        try {
          const url = `${PROXY_BASE}/api/quote?market=US&symbols=${encodeURIComponent(allUsSyms.join(','))}&t=${Date.now()}`;
          const res = await fetch(url, { signal: AbortSignal.timeout(6000) });
          if (!res.ok) return;
          const json = await res.json();
          const quotes = json?.quotes || {};
          Object.entries(quotes).forEach(([sym, q]: [string, any]) => {
            if (!q || !(q.price > 0)) return;
            out[sym] = {
              price: q.price,
              change: typeof q.change === 'number' ? q.change : 0,
              high: q.high || q.price,
              low: q.low || q.price,
              volume: q.volume || 0,
              time: q.time || Date.now(),
              market: 'US',
            } as PriceData;
          });
        } catch { /* fallback */ }
      })());
    }

    await Promise.allSettled(tasks);
    return out;
  })();

  // 2) TECHNICAL INDICATORS from TV scanner (SMA/RSI/MACD — computed on daily bars, delay irrelevant)
  const indicatorReq = (async (): Promise<Record<string, Partial<PriceData> & { tvExchange?: string; tvExactSymbol?: string }>> => {
    const out: Record<string, Partial<PriceData> & { tvExchange?: string; tvExactSymbol?: string }> = {};
    const uniqueTv = [...new Set(tvTickers)];
    if (uniqueTv.length === 0) return out;
    try {
      const res = await fetch(`https://scanner.tradingview.com/global/scan?t=${Date.now()}`, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain;charset=UTF-8' },
        body: JSON.stringify({
          symbols: { tickers: uniqueTv },
          columns: ['name', 'close', 'change', 'high', 'low', 'volume', 'SMA20', 'SMA50', 'RSI', 'MACD.macd', 'last']
        }),
        signal: AbortSignal.timeout(6000)
      });
      if (!res.ok) return out;
      const data = await res.json();
      if (!data?.data) return out;
      (data.data as TvScannerItem[]).forEach(item => {
        if (!item.d) return;
        const clean = tvToClean[item.s];
        if (!clean || out[clean]) return;
        const dv = (idx: number) => item.d![idx] as number | string | undefined;
        const changeVal = parseFloat(item.d[2] as string) || 0;
        out[clean] = {
          // delayed fallback price (only used if real-time quote missing)
          price: pickScannerPrice(item.d[1], item.d[10]) || undefined,
          change: changeVal,
          high: parseFloat(String(dv(3) ?? '')) || undefined,
          low: parseFloat(String(dv(4) ?? '')) || undefined,
          volume: parseFloat(String(dv(5) ?? '')) || undefined,
          sma20: parseFloat(String(dv(6) ?? '')) || undefined,
          sma50: parseFloat(String(dv(7) ?? '')) || undefined,
          rsi: parseFloat(String(dv(8) ?? '')) || Math.max(10, Math.min(90, 50 + (changeVal * 5))),
          macd: parseFloat(String(dv(9) ?? '')) || undefined,
          tvExchange: item.s.split(':')[0],
          tvExactSymbol: item.s,
        };
      });
    } catch { console.warn('TV indicator poll failed'); }
    return out;
  })();

  // 3) CRYPTO from CoinDCX via server proxy
  const cryptoReq = (async (): Promise<void> => {
    if (cryptoPositions.length === 0) return;
    try {
      const tickers = await fetchCoinDcxTickers();
      if (tickers) {
        cryptoPositions.forEach(p => {
          const cleanSym = p.symbol.replace('.NS', '').replace('.BO', '').trim().toUpperCase();
          const inrTicker = (tickers as CoinDcxTicker[]).find(t => t.market === `${cleanSym}INR`);
          if (inrTicker && inrTicker.last_price) {
            const priceVal = parseFloat(inrTicker.last_price);
            const changeVal = parseFloat(inrTicker.change_24_hour) || 0;
            const key = `IN_${p.symbol.trim()}`;
            if (!isNaN(priceVal) && priceVal > 0) {
              onUpdate(key, {
                price: priceVal,
                change: changeVal,
                high: parseFloat(inrTicker.high) || priceVal,
                low: parseFloat(inrTicker.low) || priceVal,
                volume: parseFloat(inrTicker.volume) || 0,
                rsi: 50,
                time: Date.now(),
                market: 'IN',
                tvExchange: 'COINDCX',
                tvExactSymbol: `${cleanSym}INR`,
                isRealtime: true
              });
            }
          }
        });
      }
    } catch { console.warn('CoinDCX batch fetch failed'); }
  })();

  const [realtime, indicators] = await Promise.all([realtimeReq, indicatorReq]);
  await cryptoReq;

  // 4) MERGE: real-time price wins, technical indicators enrich
  const allSyms = [...new Set([...Object.keys(cleanToKey)])];
  allSyms.forEach(sym => {
    const key = cleanToKey[sym];
    if (!key) return;
    const rt = realtime[sym];
    const ind = indicators[sym];
    if (!rt && !ind) return;

    // Indian indices (NIFTY, BANKNIFTY etc.) → prefer TV scanner (live index data, more reliable than Yahoo ^NSEI)
    const INDIAN_INDICES = new Set(['NIFTY','BANKNIFTY','SENSEX','INDIAVIX','CNXIT']);
    const useTvPrice = INDIAN_INDICES.has(sym) && !!(ind as any)?.price;
    const price = useTvPrice ? (ind as any).price : (rt?.price ?? (ind as any)?.price);
    if (!price || price <= 0) return;

    const usingRealtime = !useTvPrice && !!rt;
    onUpdate(key, {
      price,
      change: usingRealtime ? (rt!.change ?? 0) : (ind?.change ?? 0),
      high: rt?.high ?? ind?.high ?? price,
      low: rt?.low ?? ind?.low ?? price,
      volume: rt?.volume ?? ind?.volume ?? 0,
      sma20: ind?.sma20,
      sma50: ind?.sma50,
      rsi: ind?.rsi ?? Math.max(10, Math.min(90, 50 + ((rt?.change ?? 0) * 5))),
      macd: ind?.macd,
      time: rt?.time ?? Date.now(),
      market: key.startsWith('IN_') ? 'IN' : 'US',
      tvExchange: ind?.tvExchange,
      tvExactSymbol: ind?.tvExactSymbol,
      isRealtime: usingRealtime,
    } as PriceData);
  });
}

export async function fetchForexRate(): Promise<number> {
  // Primary: server-side proxy (cached, no CORS issues, fastest)
  try {
    const res = await fetch(`${PROXY_BASE}/api/forex?t=${Date.now()}`, {
      signal: AbortSignal.timeout(4000)
    });
    if (res.ok) {
      const data = await res.json();
      if (data?.usdInr) {
        const price = parseFloat(data.usdInr);
        if (!isNaN(price) && price > 50 && price < 150) return price;
      }
    }
  } catch { /* fall through to direct APIs */ }

  // Fallback 1: Open ER-API (CORS-friendly)
  try {
    const res = await fetch(`https://open.er-api.com/v6/latest/USD?t=${Date.now()}`, {
      signal: AbortSignal.timeout(4000)
    });
    if (res.ok) {
      const data = await res.json();
      if (data?.rates?.INR) {
        const price = parseFloat(data.rates.INR);
        if (!isNaN(price) && price > 50 && price < 150) return price;
      }
    }
  } catch (e) { console.warn('Open ER-API forex fetch failed:', e); }

  // Fallback 2: Frankfurter API (free, CORS-friendly, no key)
  try {
    const res = await fetch(`https://api.frankfurter.app/latest?from=USD&to=INR&t=${Date.now()}`, {
      signal: AbortSignal.timeout(4000)
    });
    if (res.ok) {
      const data = await res.json();
      if (data?.rates?.INR) {
        const price = parseFloat(data.rates.INR);
        if (!isNaN(price) && price > 50 && price < 150) return price;
      }
    }
  } catch (e) { console.warn('Frankfurter forex fallback failed:', e); }

  // Fallback 3: ExchangeRate-API free tier
  try {
    const res = await fetch(`https://api.exchangerate-api.com/v4/latest/USD?t=${Date.now()}`, {
      signal: AbortSignal.timeout(4000)
    });
    if (res.ok) {
      const data = await res.json();
      if (data?.rates?.INR) {
        const price = parseFloat(data.rates.INR);
        if (!isNaN(price) && price > 50 && price < 150) return price;
      }
    }
  } catch (e) { console.warn('ExchangeRate-API fallback failed:', e); }

  return DEFAULT_USD_INR; // Default fallback
}

export async function syncToCloud(portfolio: Position[], usdInr: number): Promise<boolean> {
  let apiUrl = getApiUrlSync();
  if (!apiUrl) apiUrl = await getApiUrl();
  if (!apiUrl) return false;
  if (!portfolio || portfolio.length === 0) {
    console.warn('☁️ Cloud Sync: Blocking sync because portfolio is empty to prevent accidental deletion.');
    return false;
  }

  // FIX: Backward-compatible auth token. Previously we refused the default
  // 'WEALTH_AI_SYNC' token which broke cloud sync for users who hadn't set
  // a custom VITE_API_TOKEN. Now: use VITE_API_TOKEN if set, else fall back
  // to 'WEALTH_AI_SYNC' (matching the Code.gs default). Users who want
  // stronger security can set a custom token in BOTH .env and Code.gs.
  const authToken = import.meta.env.VITE_API_TOKEN || 'WEALTH_AI_SYNC';

  try {
    const res = await fetch(apiUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      redirect: 'follow',
      body: JSON.stringify({ action: 'update', authToken, portfolio, timestamp: Date.now(), usdInr })
    });
    return res.ok;
  } catch (e) {
    // Last-resort fire-and-forget fallback (Apps Script doGet handles action=update).
    try {
      await fetch(`${apiUrl}?action=update&authToken=${encodeURIComponent(authToken)}&data=${encodeURIComponent(JSON.stringify({ portfolio, timestamp: Date.now(), usdInr }))}`, { mode: 'no-cors' });
      return true;
    } catch (e2) {
      return false;
    }
  }
}

export async function loadFromCloud(): Promise<Position[] | null> {
  // FIX: Use synchronous URL if available (cached from previous call or
  // VITE_API_URL build-time env). Only await getApiUrl() if we don't have
  // a URL yet. This saves 1-3s on every loadFromCloud call.
  let apiUrl = getApiUrlSync();
  if (!apiUrl) {
    apiUrl = await getApiUrl();
  }
  if (!apiUrl) return null;

  // FIX: Backward-compatible auth token (same as syncToCloud).
  const authToken = import.meta.env.VITE_API_TOKEN || 'WEALTH_AI_SYNC';

  try {
    const res = await fetch(`${apiUrl}?action=load&authToken=${encodeURIComponent(authToken)}&t=${Date.now()}`, {
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return null;

    const text = await res.text();
    let data;
    try {
      data = JSON.parse(text);
    } catch {
      const extracted = extractBalancedJSON(text);
      if (!extracted) return null;
      try { data = JSON.parse(extracted); } catch { return null; }
    }
    if (typeof data === 'string') {
      try { data = JSON.parse(data); } catch { return null; }
    }

    if (data && data.portfolio && Array.isArray(data.portfolio)) {
      const valid = data.portfolio.filter((p: any) =>
        p && typeof p.symbol === 'string' && p.symbol.length > 0 &&
        typeof p.qty === 'number' && p.qty > 0 &&
        typeof p.avgPrice === 'number' && p.avgPrice > 0
      );
      if (valid.length === 0 && data.portfolio.length > 0) {
        console.warn(`☁️ Cloud Sync: ${data.portfolio.length} positions loaded but 0 passed validation — data may be corrupted`);
        return null;
      }
      if (valid.length < data.portfolio.length) {
        console.warn(`☁️ Cloud Sync: ${data.portfolio.length - valid.length} positions failed validation and were filtered out`);
      }
      return valid as Position[];
    }
  } catch (e) {
    console.warn('Cloud load failed:', e);
  }

  return null;
}

/**
 * Extract the first complete top-level JSON object from a string that
 * may contain trailing/leading junk (HTML, debug logs, etc.). Uses a
 * balanced-brace scanner — correctly handles nested `{}` and `[]`.
 */
function extractBalancedJSON(text: string): string | null {
  const start = text.indexOf('{');
  if (start < 0) return null;

  let depth = 0;
  let inString = false;
  let escape = false;

  for (let i = start; i < text.length; i++) {
    const c = text[i];

    if (escape) {
      escape = false;
      continue;
    }

    if (c === '\\') {
      escape = true;
      continue;
    }

    if (c === '"') {
      inString = !inString;
      continue;
    }

    if (inString) continue;

    if (c === '{') depth++;
    else if (c === '}') {
      depth--;
      if (depth === 0) {
        return text.substring(start, i + 1);
      }
    }
  }

  // Unbalanced — return what we have
  return null;
}

export async function sendTelegramAlert(token: string, chatId: string, message: string): Promise<boolean> {
  // 1) Try direct send if browser has local token + chatId
  if (token && chatId) {
    try {
      const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat_id: chatId, text: message, parse_mode: 'HTML' })
      });
      if (res.ok) return true;
    } catch (e) {
      // fall through to server proxy
    }
  }
  // 2) Fallback to server proxy (uses bot's TG_TOKEN/TG_CHAT_ID env) so the
  //    website can still notify even without local config. Fixes "No Telegram Config".
  return sendTelegramViaServer(message, chatId || undefined);
}

// Server-side Telegram proxy fallback — uses the bot's configured token/chat.
// FIX C11: server now ignores client-supplied chatId to prevent abuse, so we
// no longer forward it.
export async function sendTelegramViaServer(message: string, _chatId?: string): Promise<boolean> {
  const proxyBase = (import.meta.env.VITE_API_PROXY as string) || '';
  try {
    const res = await fetch(`${proxyBase}/api/telegram`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message }),
      signal: AbortSignal.timeout(10000),
    });
    return res.ok;
  } catch (e) {
    return false;
  }
}

// ========================================
// GROQ API KEY — CLOUD SYNC (FREE)
// ========================================
export async function syncGroqKeyToCloud(key: string): Promise<boolean> {
  let apiUrl = getApiUrlSync();
  if (!apiUrl) apiUrl = await getApiUrl();
  if (!apiUrl || !key) return false;
  const authToken = import.meta.env.VITE_API_TOKEN || 'WEALTH_AI_SYNC';
  try {
    // Same CORS-"simple" request rule as syncToCloud (see note there) so the
    // Apps Script doPost actually receives the payload.
    await fetch(apiUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      redirect: 'follow',
      body: JSON.stringify({ groqKey: key, action: 'saveKey', authToken, timestamp: Date.now() })
    });
    return true;
  } catch (e) {
    return false;
  }
}

export async function loadGroqKeyFromCloud(): Promise<string | null> {
  let apiUrl = getApiUrlSync();
  if (!apiUrl) apiUrl = await getApiUrl();
  if (!apiUrl) return null;
  const authToken = import.meta.env.VITE_API_TOKEN || 'WEALTH_AI_SYNC';
  try {
    const res = await fetch(`${apiUrl}?action=loadKey&authToken=${encodeURIComponent(authToken)}&t=${Date.now()}`);
    if (!res.ok) return null;
    const text = await res.text();
    let data;
    try { data = JSON.parse(text); }
    catch {
      const extracted = extractBalancedJSON(text);
      if (!extracted) return null;
      try { data = JSON.parse(extracted); } catch { return null; }
    }
    const key = data?.groqKey;
    if (key && typeof key === 'string' && key.length > 10) {
      return key;
    }
  } catch (e) { console.warn('Groq key cloud load failed:', e); }
  return null;
}

// ========================================
// MARKET INTELLIGENCE — LIVE GLOBAL DATA
// ========================================
export interface MarketIntelligence {
  globalIndices: { name: string; price: number; change: number }[];
  sectors: { name: string; change: number }[];
  fearGreedScore: number;
  marketNarrative: string;
  keyLevels: { nifty: number; sensex: number; spy: number; qqq: number };
  timestamp: number;
}

export async function fetchMarketIntelligence(): Promise<MarketIntelligence> {
  const intelligence: MarketIntelligence = {
    globalIndices: [],
    sectors: [],
    fearGreedScore: 50,
    marketNarrative: '',
    keyLevels: { nifty: 0, sensex: 0, spy: 0, qqq: 0 },
    timestamp: Date.now()
  };

  // Batch fetch major global indices + sectors via TradingView
  try {
    const indexTickers = [
      'NSE:NIFTY', 'BSE:SENSEX', 'NSE:BANKNIFTY',
      'AMEX:SPY', 'NASDAQ:QQQ', 'AMEX:DIA', 'AMEX:IWM',
      'TVC:DXY', 'COMEX:GC1!', 'NYMEX:CL1!',
      'CBOE:VIX', 'NSE:INDIAVIX'
    ];
    const sectorTickers = [
      'AMEX:XLK', 'AMEX:XLF', 'AMEX:XLE', 'AMEX:XLV', 'AMEX:XLI',
      'NSE:CNXIT', 'NSE:CNXFIN', 'NSE:CNXPHARMA'
    ];

    const [indexRes, sectorRes] = await Promise.allSettled([
      fetch('https://scanner.tradingview.com/global/scan', {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain;charset=UTF-8' },
        body: JSON.stringify({
          symbols: { tickers: indexTickers },
          columns: ['name', 'close', 'change', 'volume', 'SMA20', 'SMA50', 'RSI', 'MACD.macd', 'last']
        }),
        signal: AbortSignal.timeout(6000)
      }),
      fetch('https://scanner.tradingview.com/global/scan', {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain;charset=UTF-8' },
        body: JSON.stringify({
          symbols: { tickers: sectorTickers },
          columns: ['name', 'close', 'change', 'volume', 'SMA20', 'SMA50', 'RSI', 'MACD.macd', 'last']
        }),
        signal: AbortSignal.timeout(6000)
      })
    ]);

    if (indexRes.status === 'fulfilled' && indexRes.value.ok) {
      const data = await indexRes.value.json();
      if (data?.data) {
        const nameMap: Record<string, string> = {
          'NSE:NIFTY': 'NIFTY 50', 'BSE:SENSEX': 'SENSEX', 'NSE:BANKNIFTY': 'BANK NIFTY',
          'AMEX:SPY': 'S&P 500', 'NASDAQ:QQQ': 'NASDAQ 100', 'AMEX:DIA': 'DOW JONES',
          'AMEX:IWM': 'RUSSELL 2000', 'TVC:DXY': 'US DOLLAR', 'COMEX:GC1!': 'GOLD',
          'NYMEX:CL1!': 'CRUDE OIL', 'CBOE:VIX': 'VIX', 'NSE:INDIAVIX': 'INDIA VIX'
        };
        (data.data as TvScannerItem[]).forEach(item => {
          if (!item.d) return;
          const ri = (idx: number) => parseFloat(String(item.d![idx] ?? ''));
          const px = pickScannerPrice(item.d[1], item.d[8]);
          if (px > 0) {
            intelligence.globalIndices.push({
              name: nameMap[item.s] || String(item.d[0] ?? ''),
              price: px,
              change: ri(2) || 0
            });
            if (item.s === 'NSE:NIFTY') intelligence.keyLevels.nifty = px;
            if (item.s === 'BSE:SENSEX') intelligence.keyLevels.sensex = px;
            if (item.s === 'AMEX:SPY') intelligence.keyLevels.spy = px;
            if (item.s === 'NASDAQ:QQQ') intelligence.keyLevels.qqq = px;
          }
        });
      }
    }

    if (sectorRes.status === 'fulfilled' && sectorRes.value.ok) {
      const data = await sectorRes.value.json();
      if (data?.data) {
        const sectorNameMap: Record<string, string> = {
          'AMEX:XLK': 'US Tech', 'AMEX:XLF': 'US Finance', 'AMEX:XLE': 'US Energy',
          'AMEX:XLV': 'US Healthcare', 'AMEX:XLI': 'US Industrial',
          'NSE:CNXIT': 'IN IT', 'NSE:CNXFIN': 'IN Finance', 'NSE:CNXPHARMA': 'IN Pharma'
        };
        (data.data as TvScannerItem[]).forEach(item => {
          if (item.d && item.d[2] !== null) {
            intelligence.sectors.push({
              name: sectorNameMap[item.s] || String(item.d[0] ?? ''),
              change: parseFloat(String(item.d[2] ?? '')) || 0
            });
          }
        });
      }
    }
  } catch (e) {
    console.warn('Market intelligence fetch partial failure');
  }

  // Calculate Fear/Greed from VIX
  const vix = intelligence.globalIndices.find(i => i.name === 'VIX');
  const inVix = intelligence.globalIndices.find(i => i.name === 'INDIA VIX');
  // FIX M1: if both VIX feeds are missing, the old `|| 15` fallback made the
  // dashboard claim "EXTREME GREED — VIX ultra-low at 15" while no VIX was
  // actually available. Only compute a score when at least one VIX is real.
  const vixVal = vix?.price;
  const inVixVal = inVix?.price;
  const realVixCount = (typeof vixVal === 'number' && vixVal > 0 ? 1 : 0) + (typeof inVixVal === 'number' && inVixVal > 0 ? 1 : 0);
  if (realVixCount === 0) {
    intelligence.fearGreedScore = 50; // neutral — no data
    intelligence.marketNarrative = (intelligence.marketNarrative + ' VIX unavailable — Fear/Greed held neutral.').trim();
  } else {
    const sum = (vixVal ?? 0) + (inVixVal ?? 0);
    const avgVix = sum / realVixCount;
    if (avgVix > 30) intelligence.fearGreedScore = 10;
    else if (avgVix > 25) intelligence.fearGreedScore = 20;
    else if (avgVix > 20) intelligence.fearGreedScore = 35;
    else if (avgVix > 16) intelligence.fearGreedScore = 50;
    else if (avgVix > 12) intelligence.fearGreedScore = 70;
    else intelligence.fearGreedScore = 85;
  }

  // Build market narrative
  const bullSectors = intelligence.sectors.filter(s => s.change > 1).map(s => s.name);
  const bearSectors = intelligence.sectors.filter(s => s.change < -1).map(s => s.name);
  const niftyMove = intelligence.globalIndices.find(i => i.name === 'NIFTY 50')?.change || 0;
  const spyMove = intelligence.globalIndices.find(i => i.name === 'S&P 500')?.change || 0;

  // FIX M1 (follow-up): compute avgVix once and reuse, so the narrative
  // logic below still has access to it after the M1 fix above split the
  // VIX-missing branch. When both VIX feeds are missing, narrative will
  // reflect that via the `vixUnavailable` flag instead.
  const vixForNarrative = intelligence.globalIndices.find(i => i.name === 'VIX');
  const inVixForNarrative = intelligence.globalIndices.find(i => i.name === 'INDIA VIX');
  const vixCount = (typeof vixForNarrative?.price === 'number' && vixForNarrative!.price > 0 ? 1 : 0) + (typeof inVixForNarrative?.price === 'number' && inVixForNarrative!.price > 0 ? 1 : 0);
  const avgVix = vixCount > 0 ? ((vixForNarrative?.price ?? 0) + (inVixForNarrative?.price ?? 0)) / vixCount : 0;
  const vixUnavailable = vixCount === 0;

  let narrative = '';
  if (vixUnavailable) narrative = `VIX unavailable —Fear/Greed held neutral. Sector + index signals still active.`;
  else if (avgVix > 25) narrative = `FEAR DOMINANT — VIX at ${avgVix.toFixed(1)}. Institutional hedging active. Cash is king.`;
  else if (avgVix > 18) narrative = `CAUTIOUS — Elevated volatility (VIX ${avgVix.toFixed(1)}). Mixed signals, selective entries only.`;
  else if (avgVix < 13) narrative = `EXTREME GREED — VIX ultra-low at ${avgVix.toFixed(1)}. Complacency high, protect profits.`;
  else narrative = `NEUTRAL-BULLISH — VIX steady at ${avgVix.toFixed(1)}. SIP mode optimal, accumulate quality.`;

  if (niftyMove > 1.5 || spyMove > 1.5) narrative += ` Strong rally underway (NIFTY ${niftyMove > 0 ? '+' : ''}${niftyMove.toFixed(1)}%, SPY ${spyMove > 0 ? '+' : ''}${spyMove.toFixed(1)}%).`;
  else if (niftyMove < -1.5 || spyMove < -1.5) narrative += ` Selloff in progress (NIFTY ${niftyMove.toFixed(1)}%, SPY ${spyMove.toFixed(1)}%). Look for value.`;

  if (bullSectors.length > 0) narrative += ` Sectors leading: ${bullSectors.join(', ')}.`;
  if (bearSectors.length > 0) narrative += ` Sectors lagging: ${bearSectors.join(', ')}.`;

  intelligence.marketNarrative = narrative;

  return intelligence;
}

export function formatMarketIntelligenceForAI(intel: MarketIntelligence): string {
  let ctx = `INTEL: `;
  intel.globalIndices.forEach(i => {
    ctx += `${i.name}:${i.price.toFixed(1)}(${i.change.toFixed(1)}%),`;
  });
  ctx += ` SECTORS: `;
  intel.sectors.forEach(s => {
    ctx += `${s.name}:${s.change.toFixed(1)}%,`;
  });
  ctx += ` F&G:${intel.fearGreedScore}/100 `;
  ctx += `NARRATIVE:${intel.marketNarrative}\n`;

  return ctx;
}
