import { PriceData, Position } from '../types';
import { CORS_PROXIES, EXACT_TICKER_MAP, guessMarket, API_URL, DEFAULT_USD_INR } from './constants';
import { isAnyMarketOpen } from './telegram';

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
 * Get market-aware batch interval. Reduces from 4s during open markets.
 */
export function getBatchInterval(): number {
  return isAnyMarketOpen() ? 2000 : 8000;
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

  // Try TradingView first
  try {
    const tvResult = await tryTradingView(sym, cleanSym, isIndian);
    if (tvResult && tvResult.price > 0) {
      priceCache.set(sym, tvResult, 5000); // Increased to 5s for stability
      return tvResult;
    }
  } catch (e) {}

  // Fallback to Yahoo Finance
  const yahooSymbol = isIndian ? `${cleanSym}.NS` : cleanSym;
  
  for (const proxy of CORS_PROXIES) {
    try {
      const url = `${proxy}${encodeURIComponent(`https://query1.finance.yahoo.com/v8/finance/chart/${yahooSymbol}?interval=1d&range=1d`)}`;
      const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
      
      if (res.ok) {
        const data = await res.json();
        if (data?.chart?.result?.[0]) {
          const meta = data.chart.result[0].meta;
          const priceVal = parseFloat(meta.regularMarketPrice);
          const prevClose = parseFloat(meta.chartPreviousClose || meta.previousClose);
          const changeVal = prevClose ? ((priceVal - prevClose) / prevClose) * 100 : 0;
          
          if (!isNaN(priceVal) && priceVal > 0) {
            const result: PriceData = {
              price: priceVal,
              change: changeVal,
              high: parseFloat(meta.regularMarketDayHigh) || priceVal,
              low: parseFloat(meta.regularMarketDayLow) || priceVal,
              volume: parseFloat(meta.regularMarketVolume) || 0,
              rsi: Math.max(10, Math.min(90, 50 + (changeVal * 5))),
              market: isIndian ? 'IN' : 'US',
              tvExchange: isIndian ? 'NSE' : 'NASDAQ',
              tvExactSymbol: yahooSymbol,
              time: Date.now()
            };
            priceCache.set(sym, result, 5000);
            return result;
          }
        }
      }
    } catch (e) {}
  }

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
        const item = data.data.find((x: any) => x.d && x.d[1] !== null) || data.data[0];
        const priceVal = parseFloat(item.d[1]);
        const changeVal = parseFloat(item.d[2]) || 0;

        if (!isNaN(priceVal) && priceVal > 0) {
          return {
            price: priceVal,
            change: changeVal,
            high: parseFloat(item.d[3]) || priceVal,
            low: parseFloat(item.d[4]) || priceVal,
            volume: parseFloat(item.d[5]) || 0,
            sma20: parseFloat(item.d[6]) || undefined,
            sma50: parseFloat(item.d[7]) || undefined,
            rsi: parseFloat(item.d[8]) || Math.max(10, Math.min(90, 50 + (changeVal * 5))),
            macd: parseFloat(item.d[9]) || undefined,
            market: isIndian ? 'IN' : 'US',
            tvExchange: item.s.split(':')[0],
            tvExactSymbol: item.s,
            time: Date.now()
          };
        }
      }
    }
  } catch (e) {}

  return null;
}

export async function batchFetchPrices(
  positions: Position[],
  onUpdate: (key: string, data: PriceData) => void
): Promise<void> {
  const inTickers: string[] = [];
  const usTickers: string[] = [];
  const tickerToKey: Record<string, string> = {};

  positions.forEach(p => {
    if (!p?.symbol) return;
    const mkt = (p.market || guessMarket(p.symbol)).toUpperCase();
    const key = `${mkt}_${p.symbol.trim()}`;
    const cleanSym = p.symbol.replace('.NS', '').replace('.BO', '').trim();

    if (EXACT_TICKER_MAP[cleanSym]) {
      const t = EXACT_TICKER_MAP[cleanSym];
      if (mkt === 'IN') inTickers.push(t); else usTickers.push(t);
      tickerToKey[t] = key;
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
          data.data.forEach((item: any) => {
            if (!item.d || item.d[1] === null) return;
            
            const priceVal = parseFloat(item.d[1]);
            if (isNaN(priceVal) || priceVal <= 0) return;
            
            const key = tickerToKey[item.s];
            if (!key) return;

            const changeVal = parseFloat(item.d[2]) || 0;
            const mkt = key.split('_')[0];

            onUpdate(key, {
              price: priceVal,
              change: changeVal,
              high: parseFloat(item.d[3]) || priceVal,
              low: parseFloat(item.d[4]) || priceVal,
              volume: parseFloat(item.d[5]) || 0,
              sma20: parseFloat(item.d[6]) || undefined,
              sma50: parseFloat(item.d[7]) || undefined,
              rsi: parseFloat(item.d[8]) || Math.max(10, Math.min(90, 50 + (changeVal * 5))),
              macd: parseFloat(item.d[9]) || undefined,
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

  await Promise.allSettled([
    scanBatch('india', inTickers),
    scanBatch('america', usTickers)
  ]);
}

export async function fetchForexRate(): Promise<number> {
  // Primary: Yahoo Finance (Hyper-accurate real-time & weekend fallback)
  for (const proxy of CORS_PROXIES) {
    try {
      const url = `${proxy}${encodeURIComponent('https://query1.finance.yahoo.com/v8/finance/chart/INR=X?interval=1d&range=1d')}`;
      const res = await fetch(url, {
        signal: AbortSignal.timeout(5000),
        cache: 'no-store'
      });
      if (res.ok) {
        const data = await res.json();
        const price = parseFloat(data?.chart?.result?.[0]?.meta?.regularMarketPrice);
        if (!isNaN(price) && price > 50 && price < 150) return price;
      }
    } catch (e) {
      console.warn(`Forex proxy ${proxy} failed:`, e);
    }
  }

  // Backup 1: AwesomeAPI (Real-time fallback)
  try {
    const res = await fetch(`https://economia.awesomeapi.com.br/json/last/USD-INR?t=${Date.now()}`, {
      signal: AbortSignal.timeout(4000)
    });
    if (res.ok) {
      const data = await res.json();
      if (data?.USDINR?.ask) {
        const price = parseFloat(data.USDINR.ask);
        if (!isNaN(price) && price > 50 && price < 150) return price;
      }
    }
  } catch (e) {}

  // Backup 2: Open ER-API (Daily updates)
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
  } catch (e) {}

  return DEFAULT_USD_INR; // Default fallback
}

export async function syncToCloud(portfolio: Position[], usdInr: number): Promise<boolean> {
  if (!API_URL) return false;

  try {
    const res = await fetch(API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Auth-Token': 'WEALTH_AI_SECURE_SYNC_2026' // Simple auth header for basic security
      },
      body: JSON.stringify({ portfolio, timestamp: Date.now(), usdInr })
    });
    return res.ok;
  } catch (e) {
    try {
      await fetch(`${API_URL}?action=save&data=${encodeURIComponent(JSON.stringify({ portfolio, timestamp: Date.now(), usdInr }))}`, { mode: 'no-cors' });
      return true;
    } catch (e) {
      return false;
    }
  }
}

export async function loadFromCloud(): Promise<Position[] | null> {
  if (!API_URL) return null;
  
  try {
    const res = await fetch(`${API_URL}?action=load&t=${Date.now()}`);
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
  if (!token || !chatId) return false;
  
  try {
    const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text: message, parse_mode: 'HTML' })
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
  if (!API_URL || !key) return false;
  try {
    await fetch(API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Auth-Token': 'WEALTH_AI_SECURE_SYNC_2026'
      },
      body: JSON.stringify({ groqKey: key, action: 'saveKey', timestamp: Date.now() })
    });
    return true;
  } catch (e) {
    return false;
  }
}

export async function loadGroqKeyFromCloud(): Promise<string | null> {
  if (!API_URL) return null;
  try {
    const res = await fetch(`${API_URL}?action=loadKey&t=${Date.now()}`);
    if (!res.ok) return null;
    const text = await res.text();
    const match = text.match(/\{[\s\S]*\}/);
    if (!match) return null;
    const data = JSON.parse(match[0]);
    const key = data.groqKey;
    if (key && typeof key === 'string' && key.length > 10) {
      return key;
    }
  } catch (e) {}
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
        data.data.forEach((item: any) => {
          if (item.d && item.d[1] !== null) {
            intelligence.globalIndices.push({
              name: nameMap[item.s] || item.d[0],
              price: parseFloat(item.d[1]) || 0,
              change: parseFloat(item.d[2]) || 0
            });
            // Extract key levels
            if (item.s === 'NSE:NIFTY') intelligence.keyLevels.nifty = parseFloat(item.d[1]) || 0;
            if (item.s === 'BSE:SENSEX') intelligence.keyLevels.sensex = parseFloat(item.d[1]) || 0;
            if (item.s === 'AMEX:SPY') intelligence.keyLevels.spy = parseFloat(item.d[1]) || 0;
            if (item.s === 'NASDAQ:QQQ') intelligence.keyLevels.qqq = parseFloat(item.d[1]) || 0;
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
        data.data.forEach((item: any) => {
          if (item.d && item.d[2] !== null) {
            intelligence.sectors.push({
              name: sectorNameMap[item.s] || item.d[0],
              change: parseFloat(item.d[2]) || 0
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
