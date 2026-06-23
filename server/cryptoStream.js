// ============================================================
// cryptoStream — CoinDCX live INR crypto feed (server-side, pushed to SSE)
// ------------------------------------------------------------
// Binance's websocket is geo-blocked (HTTP 451) from most cloud datacenters,
// and USD→INR conversion would mismatch the INR prices Indian users actually
// see. CoinDCX's public ticker IS reachable server-side and is INR-native, so
// we poll it fast (2s) and push every holding into the central live feed as
// IN_<symbol>. The /api/stream SSE then pushes these to the browser in real
// time — unified with the NSE/US streams.
// ============================================================
import { setTick } from './liveFeed.js';

const DEFAULT_CRYPTOS = ['BTC', 'ETH', 'SOL', 'BNB', 'XRP', 'DOGE', 'ADA', 'AVAX', 'DOT', 'MATIC', 'LINK', 'UNI'];
const POLL_MS = 2000;

const _subscribed = new Set();
let _timer = null;

export function cryptoStreamEnabled() { return true; }

async function pollOnce() {
  if (_subscribed.size === 0) return;
  try {
    const r = await fetch(`https://api.coindcx.com/exchange/ticker?t=${Date.now()}`, {
      signal: AbortSignal.timeout(4000),
    });
    if (!r.ok) return;
    const tickers = await r.json();
    if (!Array.isArray(tickers)) return;
    const byMarket = new Map();
    for (const t of tickers) byMarket.set(t.market, t);
    for (const base of _subscribed) {
      const t = byMarket.get(`${base}INR`);
      if (!t) continue;
      const price = parseFloat(t.last_price);
      if (!(price > 0)) continue;
      setTick(`IN_${base}`, {
        price,
        change: parseFloat(t.change_24_hour) || 0,
        high: parseFloat(t.high) || price,
        low: parseFloat(t.low) || price,
        volume: parseFloat(t.volume) || 0,
        time: Date.now(),
      }, 'coindcx-live');
    }
  } catch { /* transient — retry next tick */ }
}

export function ensureCryptoSubscribed(symbols) {
  const list = (symbols && symbols.length) ? symbols : DEFAULT_CRYPTOS;
  for (const s of list) {
    const base = String(s).trim().toUpperCase();
    if (base) _subscribed.add(base);
  }
  if (!_timer) {
    pollOnce();
    _timer = setInterval(pollOnce, POLL_MS);
    if (_timer.unref) _timer.unref();
  }
}
