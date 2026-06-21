import { PriceData, Position } from '../types';
import { EXACT_TICKER_MAP, guessMarket, API_URL as VITE_API_URL, DEFAULT_USD_INR, isCryptoSymbol } from './constants';

// Runtime API_URL — tries server config first, then VITE build-time env var
let _runtimeApiUrl: string | null | undefined = undefined;
async function getApiUrl(): Promise<string> {
  if (_runtimeApiUrl !== undefined) return _runtimeApiUrl || VITE_API_URL;
  try {
    const res = await fetch('/api/config', { signal: AbortSignal.timeout(3000) });
    if (res.ok) {
      const cfg = await res.json();
      if (cfg.apiUrl) { _runtimeApiUrl = cfg.apiUrl; return cfg.apiUrl; }
    }
  } catch { /* server not available */ }
  _runtimeApiUrl = null;
  return VITE_API_URL;
}
import { isAnyMarketOpen, isIndiaMarketOpen } from './telegram';
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
 * Fast (3s) while the Indian market is open so holdings tick like a live feed,
 * relaxed (30s) when closed to save bandwidth.
 */
export function getIndiaPollInterval(): number {
  return isIndiaMarketOpen() ? 3000 : 30000;
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
  const inTickers: string[] = [];
  const tickerToKey: Record<string, string> = {};

  positions.forEach(p => {
    if (!p?.symbol) return;
    const mkt = (p.market || guessMarket(p.symbol)).toUpperCase();
    if (mkt !== 'IN') return;
    const cleanSym = p.symbol.replace('.NS', '').replace('.BO', '').trim().toUpperCase();
    if (isCryptoSymbol(cleanSym)) return; // crypto handled by the CoinDCX poller
    const key = `IN_${p.symbol.trim()}`;

    if (EXACT_TICKER_MAP[cleanSym]) {
      const t = EXACT_TICKER_MAP[cleanSym];
      inTickers.push(t);
      tickerToKey[t] = key;
    } else {
      // Try BOTH NSE and BSE so ETFs/stocks listed on either exchange resolve.
      inTickers.push(`NSE:${cleanSym}`, `BSE:${cleanSym}`);
      tickerToKey[`NSE:${cleanSym}`] = key;
      tickerToKey[`BSE:${cleanSym}`] = key;
    }
  });

  // Always include India VIX for the regime / fear-greed widgets.
  inTickers.push('NSE:INDIAVIX');
  tickerToKey['NSE:INDIAVIX'] = 'IN_INDIAVIX';

  const uniqueTickers = [...new Set(inTickers)];
  if (uniqueTickers.length === 0) return;

  try {
    const res = await fetch(`https://scanner.tradingview.com/india/scan?t=${Date.now()}`, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=UTF-8' },
      body: JSON.stringify({
        symbols: { tickers: uniqueTickers },
        columns: ['name', 'close', 'change', 'high', 'low', 'volume', 'SMA20', 'SMA50', 'RSI', 'MACD.macd']
      }),
      signal: AbortSignal.timeout(6000)
    });
    if (!res.ok) return;
    const data = await res.json();
    if (!data?.data) return;

    (data.data as TvScannerItem[]).forEach(item => {
      if (!item.d || item.d[1] === null) return;
      const priceVal = parseFloat(item.d[1] as string);
      if (isNaN(priceVal) || priceVal <= 0) return;
      const key = tickerToKey[item.s];
      if (!key) return;

      const changeVal = parseFloat(item.d[2] as string) || 0;
      const dv = (idx: number) => item.d![idx] as number | string | undefined;
      onUpdate(key, {
        price: priceVal,
        change: changeVal,
        high: parseFloat(String(dv(3) ?? '')) || priceVal,
        low: parseFloat(String(dv(4) ?? '')) || priceVal,
        volume: parseFloat(String(dv(5) ?? '')) || 0,
        sma20: parseFloat(String(dv(6) ?? '')) || undefined,
        sma50: parseFloat(String(dv(7) ?? '')) || undefined,
        rsi: parseFloat(String(dv(8) ?? '')) || Math.max(10, Math.min(90, 50 + (changeVal * 5))),
        macd: parseFloat(String(dv(9) ?? '')) || undefined,
        time: Date.now(),
        market: 'IN',
        tvExchange: item.s.split(':')[0],
        tvExactSymbol: item.s
      });
    });
  } catch (e) {
    console.warn('NSE realtime poll failed');
  }
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
  const isIndian = sym.includes('.NS') || sym.includes('.BO') || sym.includes('BEES') || guessMarket(sym) === 'IN';

  // Try CoinDCX first (direct INR price — matches user's exchange)
  if (isCryptoSymbol(cleanSym)) {
    try {
      const res = await fetch(`https://api.coindcx.com/exchange/ticker`, {
        signal: AbortSignal.timeout(5000)
      });
      if (res.ok) {
        const tickers = await res.json();
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
        columns: ['name', 'close', 'change', 'high', 'low', 'volume', 'SMA20', 'SMA50', 'RSI', 'MACD.macd']
      }),
      signal: AbortSignal.timeout(3000)
    });

    if (res.ok) {
      const data = await res.json();
      if (data?.data?.length > 0) {
        const items = data.data as TvScannerItem[];
        const item = items.find(x => x.d && x.d[1] !== null) || items[0];
        const f = (idx: number) => parseFloat(String(item.d![idx] ?? ''));
        const priceVal = f(1);
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
  const inTickers: string[] = [];
  const usTickers: string[] = [];
  const tickerToKey: Record<string, string> = {};
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

    if (EXACT_TICKER_MAP[cleanSym]) {
      const t = EXACT_TICKER_MAP[cleanSym];
      if (mkt === 'IN') {
        inTickers.push(t);
        tickerToKey[t] = key;
      } else {
        usTickers.push(t);
        tickerToKey[t] = key;
      }
    } else if (mkt === 'IN') {
      inTickers.push(`NSE:${cleanSym}`, `BSE:${cleanSym}`);
      tickerToKey[`NSE:${cleanSym}`] = key;
      tickerToKey[`BSE:${cleanSym}`] = key;
    } else {
      usTickers.push(`NASDAQ:${cleanSym}`, `NYSE:${cleanSym}`, `AMEX:${cleanSym}`);
      tickerToKey[`NASDAQ:${cleanSym}`] = key;
      tickerToKey[`NYSE:${cleanSym}`] = key;
      tickerToKey[`AMEX:${cleanSym}`] = key;
    }
  });

  // Add VIX indices
  inTickers.push('NSE:INDIAVIX');
  tickerToKey['NSE:INDIAVIX'] = 'IN_INDIAVIX';
  usTickers.push('CBOE:VIX');
  tickerToKey['CBOE:VIX'] = 'US_VIX';

  const scanBatch = async (endpoint: string, tickers: string[]) => {
    if (tickers.length === 0) return;

    const uniqueTickers = [...new Set(tickers)];

    try {
      const res = await fetch(`https://scanner.tradingview.com/${endpoint}/scan`, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain;charset=UTF-8' },
        body: JSON.stringify({
          symbols: { tickers: uniqueTickers },
          columns: ['name', 'close', 'change', 'high', 'low', 'volume', 'SMA20', 'SMA50', 'RSI', 'MACD.macd']
        }),
        signal: AbortSignal.timeout(6000)
      });

      if (res.ok) {
        const data = await res.json();
        if (data?.data) {
          (data.data as TvScannerItem[]).forEach(item => {
            if (!item.d || item.d[1] === null) return;

            const priceVal = parseFloat(item.d[1] as string);
            if (isNaN(priceVal) || priceVal <= 0) return;

            const key = tickerToKey[item.s];
            if (!key) return;

            const changeVal = parseFloat(item.d[2] as string) || 0;
            const mkt = key.split('_')[0];

            const dv = (idx: number) => item.d![idx] as number | string | undefined;
            onUpdate(key, {
              price: priceVal,
              change: changeVal,
              high: parseFloat(String(dv(3) ?? '')) || priceVal,
              low: parseFloat(String(dv(4) ?? '')) || priceVal,
              volume: parseFloat(String(dv(5) ?? '')) || 0,
              sma20: parseFloat(String(dv(6) ?? '')) || undefined,
              sma50: parseFloat(String(dv(7) ?? '')) || undefined,
              rsi: parseFloat(String(dv(8) ?? '')) || Math.max(10, Math.min(90, 50 + (changeVal * 5))),
              macd: parseFloat(String(dv(9) ?? '')) || undefined,
              time: Date.now(),
              market: mkt,
              tvExchange: item.s.split(':')[0],
              tvExactSymbol: item.s
            });
          });
        }
      }
    } catch (e) {
      console.warn(`TV Scanner ${endpoint} failed`);
    }
  };

  const fetchCrypto = async () => {
    if (cryptoPositions.length === 0) return;
    try {
      const res = await fetch(`https://api.coindcx.com/exchange/ticker?t=${Date.now()}`, {
        signal: AbortSignal.timeout(5000)
      });
      if (res.ok) {
        const tickers = await res.json();
        cryptoPositions.forEach(p => {
          const cleanSym = p.symbol.replace('.NS', '').replace('.BO', '').trim().toUpperCase();
        const inrTicker = (tickers as CoinDcxTicker[]).find(t => t.market === `${cleanSym}INR`);
          if (inrTicker && inrTicker.last_price) {
            const priceVal = parseFloat(inrTicker.last_price);
            const changeVal = parseFloat(inrTicker.change_24_hour) || 0;
            const mkt = 'IN';
            const key = `${mkt}_${p.symbol.trim()}`;
            if (!isNaN(priceVal) && priceVal > 0) {
              onUpdate(key, {
                price: priceVal,
                change: changeVal,
                high: parseFloat(inrTicker.high) || priceVal,
                low: parseFloat(inrTicker.low) || priceVal,
                volume: parseFloat(inrTicker.volume) || 0,
                rsi: 50,
                time: Date.now(),
                market: mkt,
                tvExchange: 'COINDCX',
                tvExactSymbol: `${cleanSym}INR`
              });
            }
          }
        });
      }
    } catch (e) {
      console.warn('CoinDCX batch fetch failed:', e);
    }
  };

  await Promise.allSettled([
    scanBatch('india', inTickers),
    scanBatch('america', usTickers),
    fetchCrypto()
  ]);
}

export async function fetchForexRate(): Promise<number> {
  // Primary: Open ER-API — CORS-friendly and reliable from the browser.
  // (AwesomeAPI was removed: it does not send CORS headers, so the browser
  //  always blocked it and it could never succeed client-side.)
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

  return DEFAULT_USD_INR; // Default fallback
}

export async function syncToCloud(portfolio: Position[], usdInr: number): Promise<boolean> {
  const apiUrl = await getApiUrl();
  if (!apiUrl) return false;
  if (!portfolio || portfolio.length === 0) {
    console.warn('☁️ Cloud Sync: Blocking sync because portfolio is empty to prevent accidental deletion.');
    return false;
  }

  const authToken = import.meta.env.VITE_API_TOKEN || 'WEALTH_AI_SYNC';
  try {
    // IMPORTANT: Google Apps Script web apps do NOT respond to CORS preflight
    // (OPTIONS) requests. A custom header (X-Auth-Token) or an application/json
    // body turns this into a "non-simple" request, triggering a preflight that
    // Apps Script rejects -> the POST never reaches the script and the sheet
    // never updates. We send a CORS "simple" request instead:
    //   - Content-Type: text/plain  (no preflight)
    //   - the auth token travels INSIDE the JSON body, not as a header
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
  const apiUrl = await getApiUrl();
  if (!apiUrl) return null;

  try {
    const res = await fetch(`${apiUrl}?action=load&t=${Date.now()}`);
    if (!res.ok) return null;

    const text = await res.text();
    const match = text.match(/\{[\s\S]*\}|\[[\s\S]*\]/);
    if (!match || match[0] === '{}') return null;

    let data;
    try { data = JSON.parse(match[0]); } catch { return null; }
    if (typeof data === 'string') {
      try { data = JSON.parse(data); } catch { return null; }
    }

    if (data.portfolio && Array.isArray(data.portfolio)) {
      return data.portfolio;
    }
  } catch (e) {
    console.warn('Cloud load failed:', e);
  }

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
export async function sendTelegramViaServer(message: string, chatId?: string): Promise<boolean> {
  const proxyBase = (import.meta.env.VITE_API_PROXY as string) || '';
  try {
    const res = await fetch(`${proxyBase}/api/telegram`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(chatId ? { message, chatId } : { message }),
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
  const apiUrl = await getApiUrl();
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
  const apiUrl = await getApiUrl();
  if (!apiUrl) return null;
  try {
    const res = await fetch(`${apiUrl}?action=loadKey&t=${Date.now()}`);
    if (!res.ok) return null;
    const text = await res.text();
    const match = text.match(/\{[\s\S]*\}/);
    if (!match) return null;
    const data = JSON.parse(match[0]);
    const key = data.groqKey;
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
          columns: ['name', 'close', 'change', 'volume', 'SMA20', 'SMA50', 'RSI', 'MACD.macd']
        }),
        signal: AbortSignal.timeout(6000)
      }),
      fetch('https://scanner.tradingview.com/global/scan', {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain;charset=UTF-8' },
        body: JSON.stringify({
          symbols: { tickers: sectorTickers },
          columns: ['name', 'close', 'change', 'volume', 'SMA20', 'SMA50', 'RSI', 'MACD.macd']
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
          const ri = (idx: number) => parseFloat(String(item.d![idx] ?? ''));
          if (item.d && item.d[1] !== null) {
            intelligence.globalIndices.push({
              name: nameMap[item.s] || String(item.d[0] ?? ''),
              price: ri(1) || 0,
              change: ri(2) || 0
            });
            if (item.s === 'NSE:NIFTY') intelligence.keyLevels.nifty = ri(1) || 0;
            if (item.s === 'BSE:SENSEX') intelligence.keyLevels.sensex = ri(1) || 0;
            if (item.s === 'AMEX:SPY') intelligence.keyLevels.spy = ri(1) || 0;
            if (item.s === 'NASDAQ:QQQ') intelligence.keyLevels.qqq = ri(1) || 0;
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
  const avgVix = ((vix?.price || 15) + (inVix?.price || 15)) / 2;
  if (avgVix > 30) intelligence.fearGreedScore = 10;
  else if (avgVix > 25) intelligence.fearGreedScore = 20;
  else if (avgVix > 20) intelligence.fearGreedScore = 35;
  else if (avgVix > 16) intelligence.fearGreedScore = 50;
  else if (avgVix > 12) intelligence.fearGreedScore = 70;
  else intelligence.fearGreedScore = 85;

  // Build market narrative
  const bullSectors = intelligence.sectors.filter(s => s.change > 1).map(s => s.name);
  const bearSectors = intelligence.sectors.filter(s => s.change < -1).map(s => s.name);
  const niftyMove = intelligence.globalIndices.find(i => i.name === 'NIFTY 50')?.change || 0;
  const spyMove = intelligence.globalIndices.find(i => i.name === 'S&P 500')?.change || 0;

  let narrative = '';
  if (avgVix > 25) narrative = `FEAR DOMINANT — VIX at ${avgVix.toFixed(1)}. Institutional hedging active. Cash is king.`;
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
