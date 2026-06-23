// ============================================================
// AngelOne SmartWebSocketV2 — TICK-BY-TICK real-time NSE stream
// ------------------------------------------------------------
// Maintains ONE persistent websocket to AngelOne, subscribes to the tokens
// the app holds, parses the binary QUOTE packets, and keeps the latest tick
// for every token in memory. /api/quote then serves these ticks instantly —
// zero upstream latency, no REST rate limits, millisecond-fresh prices.
//
// Binary QUOTE packet (mode 2, little-endian, 123 bytes):
//   [0]      subscription mode (int8)
//   [1]      exchange type (int8)        1 = NSE CM
//   [2..27)  token (ascii, null-padded)
//   [27..35) sequence number (int64)
//   [35..43) exchange timestamp ms (int64)
//   [43..51) last traded price  (int64, paise → /100)
//   [51..59) last traded qty    (int64)
//   [59..67) avg traded price   (int64, /100)
//   [67..75) volume traded      (int64)
//   [75..83) total buy qty      (float64)
//   [83..91) total sell qty     (float64)
//   [91..99) open  (int64, /100)
//   [99..107) high (int64, /100)
//   [107..115) low (int64, /100)
//   [115..123) close/prevClose (int64, /100)
// ============================================================
import WebSocket from 'ws';
import { getSession, angelOneEnabled } from './angelone.js';
import { setTick as feedSetTick } from './liveFeed.js';

const WS_URL = 'wss://smartapisocket.angelone.in/smart-stream';
const MODE_QUOTE = 2;
const EXCH_NSE_CM = 1;
const PACKET_SIZE = { 1: 51, 2: 123, 3: 379 };

const _ticks = new Map();        // token -> { price, high, low, volume, prevClose, time }
const _tokenSymbol = new Map();  // token -> clean symbol (for liveFeed key IN_<symbol>)
const _subscribed = new Set();   // tokens currently subscribed
let _ws = null;
let _connecting = false;
let _heartbeat = null;
let _reconnectAt = 0;

export function streamEnabled() {
  return angelOneEnabled();
}

export function getTick(token) {
  return _ticks.get(String(token)) || null;
}

function readInt64(buf, off) {
  try { return Number(buf.readBigInt64LE(off)); } catch { return 0; }
}

function parsePacket(buf, start) {
  const mode = buf.readInt8(start);
  const size = PACKET_SIZE[mode];
  if (!size || start + size > buf.length) return null;
  // token: ascii from start+2, null-terminated, max 25 bytes
  let token = '';
  for (let i = start + 2; i < start + 27; i++) {
    const c = buf[i];
    if (c === 0) break;
    token += String.fromCharCode(c);
  }
  token = token.trim();
  if (!token) return { size };
  const tsMs = readInt64(buf, start + 35);
  const ltp = readInt64(buf, start + 43) / 100;
  let high = ltp, low = ltp, volume = 0, prevClose = ltp;
  if (mode === MODE_QUOTE || mode === 3) {
    volume = readInt64(buf, start + 67);
    high = readInt64(buf, start + 99) / 100;
    low = readInt64(buf, start + 107) / 100;
    prevClose = readInt64(buf, start + 115) / 100;
  }
  if (ltp > 0) {
    const tick = {
      price: ltp,
      high: high > 0 ? high : ltp,
      low: low > 0 ? low : ltp,
      volume: volume || 0,
      prevClose: prevClose > 0 ? prevClose : ltp,
      time: tsMs > 0 ? tsMs : Date.now(),
    };
    _ticks.set(token, tick);
    // Push into the central live feed (keyed IN_<symbol>) for the SSE stream.
    const sym = _tokenSymbol.get(token);
    if (sym) {
      feedSetTick(`IN_${sym}`, {
        price: tick.price,
        change: tick.prevClose ? ((tick.price - tick.prevClose) / tick.prevClose) * 100 : 0,
        high: tick.high, low: tick.low, volume: tick.volume, time: tick.time,
      }, 'angelone-stream');
    }
  }
  return { size };
}

function handleBinary(buf) {
  if (!Buffer.isBuffer(buf) || buf.length < 51) return;
  let off = 0;
  while (off + 51 <= buf.length) {
    const res = parsePacket(buf, off);
    if (!res || !res.size) break;
    off += res.size;
  }
}

function sendSubscribe(tokens) {
  if (!_ws || _ws.readyState !== WebSocket.OPEN || tokens.length === 0) return;
  _ws.send(JSON.stringify({
    correlationID: 'wealthai',
    action: 1, // subscribe
    params: { mode: MODE_QUOTE, tokenList: [{ exchangeType: EXCH_NSE_CM, tokens }] },
  }));
}

async function connect() {
  if (_connecting || (_ws && _ws.readyState === WebSocket.OPEN)) return;
  if (Date.now() < _reconnectAt) return;
  _connecting = true;
  try {
    const { jwt, feedToken, apiKey, clientCode } = await getSession();
    if (!jwt || !feedToken) { _connecting = false; return; }
    const ws = new WebSocket(WS_URL, {
      headers: {
        Authorization: jwt,
        'x-api-key': apiKey,
        'x-client-code': clientCode,
        'x-feed-token': feedToken,
      },
    });
    _ws = ws;

    ws.on('open', () => {
      _connecting = false;
      // (re)subscribe everything we track
      if (_subscribed.size > 0) sendSubscribe([..._subscribed]);
      clearInterval(_heartbeat);
      _heartbeat = setInterval(() => {
        try { if (ws.readyState === WebSocket.OPEN) ws.send('ping'); } catch { /* noop */ }
      }, 25000);
    });

    ws.on('message', (data, isBinary) => {
      if (isBinary || Buffer.isBuffer(data)) handleBinary(Buffer.isBuffer(data) ? data : Buffer.from(data));
      // text frames ("pong") are ignored
    });

    ws.on('close', () => {
      _connecting = false;
      clearInterval(_heartbeat);
      _reconnectAt = Date.now() + 3000; // backoff before reconnect
      _ws = null;
    });

    ws.on('error', () => {
      _connecting = false;
      try { ws.close(); } catch { /* noop */ }
      _reconnectAt = Date.now() + 5000;
      _ws = null;
    });
  } catch {
    _connecting = false;
    _reconnectAt = Date.now() + 5000;
  }
}

/**
 * Ensure the websocket is connected and subscribed to these NSE tokens.
 * Accepts an array of { token, symbol } pairs so ticks can be labelled with
 * their clean symbol and pushed into the live feed as IN_<symbol>.
 * Call freely (e.g. on every /api/quote) — it's idempotent and cheap.
 */
export function ensureSubscribed(pairs) {
  if (!streamEnabled()) return;
  const fresh = [];
  for (const p of pairs || []) {
    const tok = String(p.token ?? p);
    if (p.symbol) _tokenSymbol.set(tok, String(p.symbol).toUpperCase());
    if (!_subscribed.has(tok)) { _subscribed.add(tok); fresh.push(tok); }
  }
  if (!_ws || _ws.readyState !== WebSocket.OPEN) {
    connect();
  } else if (fresh.length > 0) {
    sendSubscribe(fresh);
  }
}
