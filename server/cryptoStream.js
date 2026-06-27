// cryptoStream — CoinDCX live INR crypto feed (server-side, pushed to SSE)
// Polls CoinDCX every 5s ONLY while at least one SSE client is connected.
// When no clients → timer pauses → server goes idle → Render free tier happy.
import { setTick } from './liveFeed.js';

const DEFAULT_CRYPTOS = ['BTC', 'ETH', 'SOL', 'BNB', 'XRP', 'DOGE', 'ADA', 'AVAX', 'DOT', 'MATIC', 'LINK', 'UNI'];
const POLL_MS = 5000; // 5s — sufficient for crypto, saves CPU vs 2s

const _subscribed = new Set();
let _timer = null;
let _activeClients = 0;

export function cryptoStreamEnabled() { return true; }

// Call when an SSE client connects / disconnects
export function cryptoClientUp() { _activeClients++; _startIfNeeded(); }
export function cryptoClientDown() { _activeClients = Math.max(0, _activeClients - 1); _stopIfIdle(); }

function _startIfNeeded() {
  if (_timer || _subscribed.size === 0) return;
  pollOnce();
  _timer = setInterval(pollOnce, POLL_MS);
  if (_timer.unref) _timer.unref();
}

function _stopIfIdle() {
  if (_activeClients > 0 || !_timer) return;
  clearInterval(_timer);
  _timer = null;
}

async function pollOnce() {
  if (_subscribed.size === 0 || _activeClients === 0) return;
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
  // Don't start timer here — only start when a client connects via cryptoClientUp()
}
