import { PriceData, Position } from '../types';
import { CORS_PROXIES, EXACT_TICKER_MAP, guessMarket, API_URL } from './constants';

export async function fetchSinglePrice(symbol: string, retryAttempt = 0): Promise<PriceData | null> {
  if (!symbol) return null;
  
  const sym = symbol.toUpperCase().trim();
  const cleanSym = sym.replace('.NS', '').replace('.BO', '');
  const isIndian = sym.includes('.NS') || sym.includes('.BO') || sym.includes('BEES') || guessMarket(sym) === 'IN';

  // Try TradingView first
  try {
    const tvResult = await tryTradingView(sym, cleanSym, isIndian);
    if (tvResult && tvResult.price > 0) return tvResult;
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
            return {
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
        columns: ['name', 'close', 'change', 'high', 'low', 'volume']
      }),
      signal: AbortSignal.timeout(6000)
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
            rsi: Math.max(10, Math.min(90, 50 + (changeVal * 5))),
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
          columns: ['name', 'close', 'change', 'high', 'low', 'volume']
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
              rsi: Math.max(10, Math.min(90, 50 + (changeVal * 5))),
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
  // Try multiple APIs
  try {
    const res = await fetch(`https://economia.awesomeapi.com.br/json/last/USD-INR?t=${Date.now()}`, {
      signal: AbortSignal.timeout(5000)
    });
    if (res.ok) {
      const data = await res.json();
      if (data?.USDINR?.ask) {
        const price = parseFloat(data.USDINR.ask);
        if (!isNaN(price) && price > 50 && price < 150) return price;
      }
    }
  } catch (e) {}

  // Fallback
  try {
    const res = await fetch(`https://open.er-api.com/v6/latest/USD?t=${Date.now()}`, {
      signal: AbortSignal.timeout(5000)
    });
    if (res.ok) {
      const data = await res.json();
      if (data?.rates?.INR) {
        const price = parseFloat(data.rates.INR);
        if (!isNaN(price) && price > 50 && price < 150) return price;
      }
    }
  } catch (e) {}

  return 83.5; // Default fallback
}

export async function syncToCloud(portfolio: Position[], usdInr: number): Promise<boolean> {
  if (!API_URL) return false;
  
  try {
    const res = await fetch(API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain' },
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
    
    let data = JSON.parse(match[0]);
    if (typeof data === 'string') data = JSON.parse(data);
    
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
      body: JSON.stringify({ chat_id: chatId, text: message, parse_mode: 'Markdown' })
    });
    return res.ok;
  } catch (e) {
    return false;
  }
}
