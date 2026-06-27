// usStream — Finnhub WebSocket: real-time US trades
// WebSocket connects ONLY when SSE clients are active.
// Disconnects when last client leaves → server goes idle on Render free tier.
import WebSocket from 'ws';
import { setTick } from './liveFeed.js';

const KEY = process.env.FINNHUB_API_KEY || process.env.VITE_FINNHUB_API_KEY || '';
const WS_URL = KEY ? `wss://ws.finnhub.io?token=${KEY}` : '';

const _subscribed = new Set();
const _prevClose = new Map();
let _ws = null;
let _connecting = false;
let _reconnectAt = 0;
let _activeClients = 0;

export function usStreamEnabled() { return !!KEY; }

export function usClientUp() {
  _activeClients++;
  if (_subscribed.size > 0) _connect();
}

export function usClientDown() {
  _activeClients = Math.max(0, _activeClients - 1);
  if (_activeClients === 0) _disconnect();
}

function _disconnect() {
  if (_ws) { try { _ws.close(); } catch { } _ws = null; }
  _connecting = false;
}

async function refreshPrevClose(sym) {
  const rec = _prevClose.get(sym);
  if (rec && (Date.now() - rec.at) < 5 * 60 * 1000) return rec;
  try {
    const r = await fetch(`https://finnhub.io/api/v1/quote?symbol=${encodeURIComponent(sym)}&token=${KEY}`,
      { signal: AbortSignal.timeout(5000) });
    const j = await r.json();
    const out = { pc: j?.pc || 0, high: j?.h || 0, low: j?.l || 0, at: Date.now() };
    _prevClose.set(sym, out);
    const c = j?.c;
    if (typeof c === 'number' && c > 0) {
      const change = typeof j.dp === 'number' ? j.dp : (out.pc ? ((c - out.pc) / out.pc) * 100 : 0);
      setTick(`US_${sym}`, {
        price: c, change,
        high: out.high || c, low: out.low || c,
        volume: 0, time: (j.t ? j.t * 1000 : Date.now()),
      }, 'finnhub-stream');
    }
    return out;
  } catch { return rec || { pc: 0, high: 0, low: 0, at: Date.now() }; }
}

function _connect() {
  if (!WS_URL || _connecting || (_ws && _ws.readyState === WebSocket.OPEN)) return;
  if (_activeClients === 0) return; // don't connect if no clients
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
      const latest = {};
      for (const t of msg.data) latest[t.s] = t;
      for (const sym of Object.keys(latest)) {
        const t = latest[sym];
        const ref = _prevClose.get(sym) || await refreshPrevClose(sym);
        const price = t.p;
        if (!(price > 0)) continue;
        const change = ref.pc ? ((price - ref.pc) / ref.pc) * 100 : 0;
        setTick(`US_${sym}`, {
          price, change,
          high: Math.max(ref.high || price, price),
          low: ref.low && ref.low < price ? ref.low : price,
          volume: 0, time: t.t || Date.now(),
        }, 'finnhub-stream');
      }
    });
    ws.on('close', () => {
      _connecting = false; _ws = null;
      // Only reconnect if clients still active
      if (_activeClients > 0) _reconnectAt = Date.now() + 3000;
    });
    ws.on('error', () => {
      _connecting = false; try { ws.close(); } catch { }
      _ws = null;
      if (_activeClients > 0) _reconnectAt = Date.now() + 5000;
    });
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
  // Connect only if clients are already active
  if (_activeClients > 0) {
    if (!_ws || _ws.readyState !== WebSocket.OPEN) _connect();
    else fresh.forEach(s => _ws.send(JSON.stringify({ type: 'subscribe', symbol: s })));
  }
}
