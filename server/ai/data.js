// ============================================================
// server/ai/data.js — market-data access layer for the AI engine
// ------------------------------------------------------------
// ONE place that knows how to reach every data source. Everything
// downstream (models, ensemble, options desk) consumes normalized
// structures and NEVER touches fetch() directly.
//
//   INDIA equities : TradingView India scanner (1 request, rich
//                    pre-computed indicators — proven in prod)
//   INDIA indices  : Yahoo Finance chart API (^NSEI, ^NSEBANK, …)
//   INDIA options  : NSE option-chain (cookie bootstrap) with a
//                    Black-Scholes synthetic fallback
//   CRYPTO         : CoinDCX public candles + tickers, TV crypto
//                    scanner as the USD-indicator source
//   FX             : Yahoo USDINR=X
//
// Every fetch is timeout-guarded and null-safe: an unreachable
// source degrades that market's signals — it never crashes the API.
// ============================================================
import { computeIndicatorsFromCandles } from './lib/indicators.js';
import { fetchCoinDcxTickers } from '../cryptoStream.js';

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Safari/537.36';

// ---------------- universes ----------------
// Liquid NSE large/mid caps — the AI scanner universe (kept tight
// for scanner latency: 44 symbols = 1 TV request + fast scan).
export const INDIA_UNIVERSE = [
  'RELIANCE', 'HDFCBANK', 'ICICIBANK', 'INFY', 'TCS', 'SBIN', 'BHARTIARTL', 'ITC',
  'LT', 'AXISBANK', 'KOTAKBANK', 'HINDUNILVR', 'BAJFINANCE', 'MARUTI', 'ASIANPAINT',
  'SUNPHARMA', 'TITAN', 'ULTRACEMCO', 'TATAMOTORS', 'TATASTEEL', 'WIPRO', 'ONGC',
  'NTPC', 'POWERGRID', 'ADANIENT', 'ADANIPORTS', 'JSWSTEEL', 'HCLTECH', 'TECHM',
  'INDUSINDBK', 'CIPLA', 'DRREDDY', 'DIVISLAB', 'NESTLEIND', 'BAJAJFINSV', 'SHRIRAMFIN',
  'EICHERMOT', 'HEROMOTOCO', 'BAJAJ-AUTO', 'BPCL', 'COALINDIA', 'GRASIM', 'HINDALCO',
  'SBILIFE', 'HDFCLIFE',
];

export const CRYPTO_UNIVERSE = [
  'BTC', 'ETH', 'BNB', 'SOL', 'XRP', 'DOGE', 'ADA', 'AVAX', 'LINK', 'DOT', 'TRX', 'MATIC',
];

export const INDICES = ['NIFTY', 'BANKNIFTY', 'FINNIFTY'];

// ---------------- TV scanner (INDIA) ----------------
// Two-tier column set: the extended set adds BB/Stoch/52w; if the
// scanner rejects any column, we retry once with the proven set.
const TV_FULL = [
  'close', 'open', 'high', 'low', 'volume', 'change',
  'EMA10', 'EMA20', 'EMA50', 'SMA20', 'SMA50',
  'RSI', 'MACD.macd', 'MACD.signal',
  'ATR', 'VWAP', 'ADX', 'ADX+DI', 'ADX-DI',
  'relative_volume_10d_calc',
  'Pivot.M.Classic.Middle', 'Pivot.M.Classic.S1', 'Pivot.M.Classic.R1',
  'BB.upper', 'BB.lower', 'Stoch.K', 'Stoch.D',
  'price_52_week_high', 'price_52_week_low',
  'Recommend.All',
];
const TV_SAFE = TV_FULL.slice(0, 23); // drop BB/Stoch/52w — the v4-proven set

export async function fetchTVIndiaBatch(symbols) {
  const tickers = [], map = {};
  for (const s of symbols) {
    for (const ex of ['NSE', 'BSE']) {
      const t = `${ex}:${s}`;
      tickers.push(t);
      map[t] = s;
    }
  }
  for (const columns of [TV_FULL, TV_SAFE]) {
    try {
      const res = await fetch(`https://scanner.tradingview.com/india/scan?t=${Date.now()}`, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain;charset=UTF-8' },
        body: JSON.stringify({ symbols: { tickers: [...new Set(tickers)] }, columns }),
        signal: AbortSignal.timeout(12000),
      });
      if (!res.ok) continue;
      const data = await res.json();
      if (!data?.data) continue;
      const out = {};
      for (const item of data.data) {
        if (!item?.d) continue;
        const sym = map[item.s];
        if (!sym || out[sym]) continue;
        const d = item.d;
        const pf = (v) => (typeof v === 'number' && Number.isFinite(v)) ? v : null;
        out[sym] = {
          symbol: sym,
          exchange: item.s.split(':')[0],
          ltp: pf(d[0]), open: pf(d[1]), high: pf(d[2]), low: pf(d[3]),
          volume: pf(d[4]), changePct: pf(d[5]),
          ema10: pf(d[6]), ema20: pf(d[7]), ema50: pf(d[8]),
          sma20: pf(d[9]), sma50: pf(d[10]),
          rsi: pf(d[11]), macd: pf(d[12]), macdSignal: pf(d[13]),
          atr: pf(d[14]), vwap: pf(d[15]),
          adx: pf(d[16]), adxPlus: pf(d[17]), adxMinus: pf(d[18]),
          relVolume: pf(d[19]),
          pivot: { p: pf(d[20]), s1: pf(d[21]), r1: pf(d[22]) },
          bbUpper: columns === TV_FULL ? pf(d[23]) : null,
          bbLower: columns === TV_FULL ? pf(d[24]) : null,
          stochK: columns === TV_FULL ? pf(d[25]) : null,
          stochD: columns === TV_FULL ? pf(d[26]) : null,
          high52w: columns === TV_FULL ? pf(d[27]) : null,
          low52w: columns === TV_FULL ? pf(d[28]) : null,
          recommend: columns === TV_FULL ? pf(d[29]) : pf(d[23]),
        };
      }
      if (Object.keys(out).length > 0) return out;
    } catch { /* try the safe set */ }
  }
  return {};
}

// ---------------- TV scanner (CRYPTO, USD indicators) ----------------
export async function fetchTVCryptoBatch(symbols) {
  const tickers = symbols.map(s => `BINANCE:${s}USDT`);
  const columns = [
    'close', 'change', 'RSI', 'MACD.macd', 'MACD.signal',
    'EMA10', 'EMA20', 'EMA50', 'SMA20', 'SMA50',
    'ATR', 'ADX', 'ADX+DI', 'ADX-DI',
    'BB.upper', 'BB.lower', 'Stoch.K', 'Stoch.D',
    'relative_volume_10d_calc', 'Recommend.All',
  ];
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const res = await fetch(`https://scanner.tradingview.com/crypto/scan?t=${Date.now()}`, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain;charset=UTF-8' },
        body: JSON.stringify({ symbols: { tickers }, columns }),
        signal: AbortSignal.timeout(12000),
      });
      if (!res.ok) continue;
      const data = await res.json();
      if (!data?.data) continue;
      const out = {};
      for (const item of data.data) {
        if (!item?.d) continue;
        const base = String(item.s || '').replace('BINANCE:', '').replace('USDT', '');
        if (!base) continue;
        const d = item.d;
        const pf = (v) => (typeof v === 'number' && Number.isFinite(v)) ? v : null;
        out[base] = {
          symbol: base,
          usdPrice: pf(d[0]), changePct: pf(d[1]),
          rsi: pf(d[2]), macd: pf(d[3]), macdSignal: pf(d[4]),
          ema10: pf(d[5]), ema20: pf(d[6]), ema50: pf(d[7]),
          sma20: pf(d[8]), sma50: pf(d[9]),
          atr: pf(d[10]), adx: pf(d[11]), adxPlus: pf(d[12]), adxMinus: pf(d[13]),
          bbUpper: pf(d[14]), bbLower: pf(d[15]),
          stochK: pf(d[16]), stochD: pf(d[17]),
          relVolume: pf(d[18]), recommend: pf(d[19]),
        };
      }
      if (Object.keys(out).length > 0) return out;
    } catch { /* retry once */ }
  }
  return {};
}

// ---------------- CoinDCX public candles (crypto TA) ----------------
// https://public.coindcx.com/market_data/candles?pair=BTCINR&duration=1h&limit=300
const CANDLE_SOURCES = {
  '1h': { duration: '1h', limit: 300 },   // swing/position TA
  '4h': { duration: '4h', limit: 300 },
  '15m': { duration: '15m', limit: 400 }, // aggressive TA
};

export async function fetchCoinDcxCandles(base, tf = '1h', opts = {}) {
  const cfg = CANDLE_SOURCES[tf] || CANDLE_SOURCES['1h'];
  const pair = `${base}INR`;
  const urls = [
    `https://public.coindcx.com/market_data/candles?pair=${pair}&duration=${cfg.duration}&limit=${cfg.limit}`,
    `https://api.coindcx.com/market_data/candles?pair=B${pair}_${Date.now()}`, // legacy shape (best-effort)
  ];
  for (const url of urls.slice(0, 1)) {
    try {
      const r = await fetch(url, {
        headers: { 'User-Agent': UA },
        signal: AbortSignal.timeout(8000),
      });
      if (!r.ok) continue;
      const raw = await r.json();
      if (!Array.isArray(raw) || raw.length === 0) continue;
      // CoinDCX returns newest-first: [{ o, h, l, c, v, t }] with t in seconds (or ms on some pairs).
      const candles = raw.map(x => ({
        time: Number(x.t) < 1e12 ? Number(x.t) * 1000 : Number(x.t),
        open: Number(x.o), high: Number(x.h), low: Number(x.l),
        close: Number(x.c), volume: Number(x.v) || 0,
      })).filter(c => Number.isFinite(c.close) && c.close > 0)
        .sort((a, b) => a.time - b.time); // oldest-first for the TA lib
      if (candles.length >= 30) return candles;
    } catch { /* next source */ }
  }
  return null;
}

/** Crypto indicator snapshot: TV USD indicators re-scaled to INR via the live CoinDCX ticker. */
export async function fetchCryptoSnapshot(base) {
  const [tv, tickers] = await Promise.all([
    fetchTVCryptoBatch([base]),
    fetchCoinDcxTickers().catch(() => []),
  ]);
  const tvRow = tv[base];
  const ticker = (Array.isArray(tickers) ? tickers : []).find(t => t?.market === `${base}INR`);
  const inrPrice = ticker ? parseFloat(ticker.last_price) : null;
  if (!tvRow && inrPrice == null) return null;
  const scale = (tvRow?.usdPrice && inrPrice) ? inrPrice / tvRow.usdPrice : 1;
  return {
    symbol: base,
    pair: `${base}INR`,
    ltp: inrPrice ?? (tvRow?.usdPrice ? tvRow.usdPrice * 84 : null),
    changePct: tvRow?.changePct ?? (ticker ? parseFloat(ticker.change_24_hour) || null : null),
    priceSource: inrPrice != null ? 'coindcx' : (tvRow ? 'tv-usd-approx' : null),
    indicators: tvRow ? {
      ...tvRow,
      // Re-scale USD-dimensioned fields into INR so entry/SL/targets
      // are in the currency the user actually trades.
      usdPrice: tvRow.usdPrice,
      atr: tvRow.atr != null ? tvRow.atr * scale : null,
      ema10: tvRow.ema10 != null ? tvRow.ema10 * scale : null,
      ema20: tvRow.ema20 != null ? tvRow.ema20 * scale : null,
      ema50: tvRow.ema50 != null ? tvRow.ema50 * scale : null,
      sma20: tvRow.sma20 != null ? tvRow.sma20 * scale : null,
      sma50: tvRow.sma50 != null ? tvRow.sma50 * scale : null,
      bbUpper: tvRow.bbUpper != null ? tvRow.bbUpper * scale : null,
      bbLower: tvRow.bbLower != null ? tvRow.bbLower * scale : null,
      macd: tvRow.macd != null ? tvRow.macd * scale : null,
      macdSignal: tvRow.macdSignal != null ? tvRow.macdSignal * scale : null,
    } : null,
    candles: await fetchCoinDcxCandles(base, '1h').catch(() => null),
  };
}

// ---------------- Yahoo index quotes (spot + regime) ----------------
const YF_MAP = {
  NIFTY: '^NSEI', BANKNIFTY: '^NSEBANK', FINNIFTY: 'NIFTY_FIN_SERVICE.NS',
  SENSEX: '^BSESN', INDIAVIX: '^INDIAVIX', USDINR: 'USDINR=X', BTC: 'BTC-USD',
};

export async function fetchYahooQuotes(keys) {
  const out = {};
  await Promise.allSettled(keys.map(async (k) => {
    const yk = YF_MAP[k];
    if (!yk) return;
    try {
      const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(yk)}?interval=1d&range=5d`;
      const r = await fetch(url, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(8000) });
      if (!r.ok) return;
      const j = await r.json();
      const res = j?.chart?.result?.[0];
      const meta = res?.meta;
      if (!meta) return;
      const prev = meta.chartPreviousClose ?? meta.previousClose;
      const price = meta.regularMarketPrice;
      if (!(price > 0)) return;
      out[k] = {
        price,
        changePct: prev > 0 ? ((price - prev) / prev) * 100 : 0,
      };
    } catch { /* skip this key */ }
  }));
  return out;
}

// ---------------- NSE option chain (real, with cookie bootstrap) ----------------
const NSE_HEADERS = {
  'User-Agent': UA,
  'Accept': 'application/json, text/plain, */*',
  'Accept-Language': 'en-US,en;q=0.9',
  'Referer': 'https://www.nseindia.com/option-chain',
};
let _nseCookie = null, _nseCookieAt = 0;
const NSE_COOKIE_TTL = 8 * 60 * 1000;

async function nseBootstrapCookies() {
  if (_nseCookie && Date.now() - _nseCookieAt < NSE_COOKIE_TTL) return _nseCookie;
  try {
    const r = await fetch('https://www.nseindia.com/option-chain', {
      headers: NSE_HEADERS,
      signal: AbortSignal.timeout(8000),
    });
    const raw = r.headers.getSetCookie?.() || [];
    if (raw.length) {
      _nseCookie = raw.map(c => c.split(';')[0]).join('; ');
      _nseCookieAt = Date.now();
    }
    return _nseCookie;
  } catch { return _nseCookie; }
}

/**
 * REAL NSE option chain for an index. Returns null when NSE blocks
 * the request (datacenter IP / Cloudflare) — the options desk then
 * falls back to the clearly-labeled Black-Scholes synthetic chain.
 */
export async function fetchNSEOptionChain(symbol) {
  const sym = String(symbol || 'NIFTY').toUpperCase();
  const path = ['NIFTY', 'BANKNIFTY', 'FINNIFTY', 'MIDCPNIFTY', 'NIFTYNXT50'].includes(sym)
    ? `/api/option-chain-indices?symbol=${encodeURIComponent(sym)}`
    : `/api/option-chain-equities?symbol=${encodeURIComponent(sym)}`;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const cookie = await nseBootstrapCookies();
      if (!cookie && attempt === 0) continue;
      const r = await fetch(`https://www.nseindia.com${path}`, {
        headers: { ...NSE_HEADERS, ...(cookie ? { Cookie: cookie } : {}) },
        signal: AbortSignal.timeout(8000),
      });
      if (!r.ok) continue;
      const j = await r.json();
      const rows = j?.records?.data;
      if (!Array.isArray(rows) || rows.length === 0) continue;
      return {
        symbol: sym,
        spot: Number(j?.records?.underlyingValue) || null,
        expiryDates: j?.records?.expiryDates || [],
        rows: rows.map(x => ({
          strike: Number(x.strikePrice),
          expiry: x.expiryDate,
          callOI: Number(x.CE?.openInterest) || 0,
          callOIChange: Number(x.CE?.changeinOpenInterest) || 0,
          callIV: Number(x.CE?.impliedVolatility) || null,
          callLTP: Number(x.CE?.lastPrice) || 0,
          callVolume: Number(x.CE?.totalTradedVolume) || 0,
          putOI: Number(x.PE?.openInterest) || 0,
          putOIChange: Number(x.PE?.changeinOpenInterest) || 0,
          putIV: Number(x.PE?.impliedVolatility) || null,
          putLTP: Number(x.PE?.lastPrice) || 0,
          putVolume: Number(x.PE?.totalTradedVolume) || 0,
        })),
        source: 'nse',
        fetchedAt: Date.now(),
      };
    } catch { /* retry once more */ }
  }
  return null;
}

// ---------------- time / market-hours (IST) ----------------
export function istNow(now = new Date()) {
  return new Date(now.getTime() + (330 + now.getTimezoneOffset()) * 60000);
}
export function isNseOpen(now = new Date()) {
  const d = istNow(now);
  const day = d.getDay();
  if (day === 0 || day === 6) return false;
  const mins = d.getHours() * 60 + d.getMinutes();
  return mins >= 555 && mins <= 930; // 09:15–15:30
}

// ---------------- test hooks ----------------
export const __testables = { TV_FULL, TV_SAFE, CANDLE_SOURCES };
