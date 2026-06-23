// ============================================================
// usStream — Finnhub WebSocket: TICK-BY-TICK real-time US trades
// ------------------------------------------------------------
// Requires FINNHUB_API_KEY. If unset, this module stays dormant and US prices
// continue to come from the Yahoo real-time REST path in index.js.
// Trade ticks give last price only, so previous-close (for % change) is pulled
// from Finnhub's /quote once per symbol and refreshed every 5 min.
// ============================================================
import WebSocket from 'ws';
import { setTick } from './liveFeed.js';

const KEY = process.env.FINNHUB_API_KEY || process.env.VITE_FINNHUB_API_KEY || '';
const WS_URL = KEY ? `wss://ws.finnhub.io?token=${KEY}` : '';

const _subscribed = new Set();      // symbols
const _prevClose = new Map();       // symbol -> { pc, high, low, at }
let _ws = null;
let _connecting = false;
let _reconnectAt = 0;

export function usStreamEnabled() { return !!KEY; }

async function refreshPrevClose(sym) {
  const rec = _prevClose.get(sym);
  if (rec && (Date.now() - rec.at) < 5 * 60 * 1000) return rec;
  try {
    const r = await fetch(`https://finnhub.io/api/v1/quote?symbol=${encodeURIComponent(sym)}&token=${KEY}`,
      { signal: AbortSignal.timeout(5000) });
    const j = await r.json();
    const out = { pc: j?.pc || 0, high: j?.h || 0, low: j?.l || 0, at: Date.now() };
    _prevClose.set(sym, out);
    return out;
  } catch { return rec || { pc: 0, high: 0, low: 0, at: Date.now() }; }
}

function connect() {
  if (!WS_URL || _connecting || (_ws && _ws.readyState === WebSocket.OPEN)) return;
  if (Date.now() < _reconnectAt) return;
  _connecting = true;
  try {
    const ws = new WebSocket(WS_URL);
    _ws = ws;
    ws.on('open', () => {
      _connecting = false;
      for (const s of _subscribed) ws.send(JSON.stringify({ type: 'subscribe', symbol: s }));
    });
    ws.on('message', async (raw) => {
      let msg; try { msg = JSON.parse(raw.toString()); } catch { return; }
      if (msg.type !== 'trade' || !Array.isArray(msg.data)) return;
      // keep only the latest price per symbol in this batch
      const latest = {};
      for (const t of msg.data) latest[t.s] = t;
      for (const sym of Object.keys(latest)) {
        const t = latest[sym];
        const ref = _prevClose.get(sym) || await refreshPrevClose(sym);
        const price = t.p;
        if (!(price > 0)) continue;
        const change = ref.pc ? ((price - ref.pc) / ref.pc) * 100 : 0;
        setTick(`US_${sym}`, {
          price,
          change,
          high: Math.max(ref.high || price, price),
          low: ref.low && ref.low < price ? ref.low : price,
          volume: 0,
          time: t.t || Date.now(),
        }, 'finnhub-stream');
      }
    });
    ws.on('close', () => { _connecting = false; _reconnectAt = Date.now() + 3000; _ws = null; });
    ws.on('error', () => { _connecting = false; try { ws.close(); } catch {} _reconnectAt = Date.now() + 5000; _ws = null; });
  } catch { _connecting = false; _reconnectAt = Date.now() + 5000; }
}

export function ensureUsSubscribed(symbols) {
  if (!usStreamEnabled()) return;
  const fresh = [];
  for (const s of symbols || []) {
    const sym = String(s).replace('.NS', '').replace('.BO', '').trim().toUpperCase();
    if (!sym) continue;
    if (!_subscribed.has(sym)) { _subscribed.add(sym); fresh.push(sym); refreshPrevClose(sym); }
  }
  if (!_ws || _ws.readyState !== WebSocket.OPEN) connect();
  else fresh.forEach(s => _ws.send(JSON.stringify({ type: 'subscribe', symbol: s })));
}
