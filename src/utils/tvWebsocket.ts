import { PriceData } from '../types';
import { EXACT_TICKER_MAP, guessMarket } from './constants';

// ========================================
// STATE
// ========================================
let ws: WebSocket | null = null;
let currentSession = '';
const callbacks: Set<(key: string, data: Partial<PriceData>) => void> = new Set();

// Map: portfolio key ("IN_RELIANCE") -> TV symbol ("NSE:RELIANCE")
const keyToTvSymbol: Map<string, string> = new Map();
// Reverse map: TV symbol -> portfolio key
const tvSymbolToKey: Map<string, string> = new Map();

let pingInterval: number | null = null;
let reconnectTimer: number | null = null;
let reconnectAttempts = 0;
const MAX_RECONNECT_ATTEMPTS = 25;
let isDestroyed = false;

// ========================================
// LATENCY & PRICE VALIDATION
// ========================================
let pingStartTime = 0;
let latencyHistory: number[] = [];
let currentLatency = 500; // ms, default estimate
let adaptiveHeartbeatMs = 15000; // default 15s
let subscribedSymbols = new Set<string>();

// Price validation state
const lastKnownPrices: Map<string, { price: number; time: number }> = new Map();

/**
 * Track round-trip latency for adaptive heartbeat tuning
 */
function measureLatency(): void {
  pingStartTime = Date.now();
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(`~m~2~m~~h~${Math.floor(Math.random() * 1000)}`);
    // pong response arrives via onmessage — we detect it there
  }
}

function recordLatency(latency: number): void {
  latencyHistory.push(latency);
  if (latencyHistory.length > 10) latencyHistory = latencyHistory.slice(-10);
  // Exponential moving average
  currentLatency = latencyHistory.reduce((a, b) => a + b, 0) / latencyHistory.length;
  // Adaptive heartbeat: faster on good connections, slower on high latency
  adaptiveHeartbeatMs = Math.max(5000, Math.min(30000, currentLatency * 15));
}

/**
 * Validate incoming price against last known value
 * Rejects outliers (>50% change) and stuck prices (>60s unchanged)
 */
function validatePrice(
  key: string,
  price: number,
  lastPrice?: number
): { valid: boolean; reason?: string } {
  if (price <= 0 || isNaN(price)) {
    return { valid: false, reason: 'Non-positive or NaN price' };
  }

  // Reject extreme outliers
  if (lastPrice && lastPrice > 0) {
    const pctChange = Math.abs(price - lastPrice) / lastPrice;
    if (pctChange > 0.5) {
      return { valid: false, reason: `Extreme jump ${((pctChange) * 100).toFixed(1)}%` };
    }
  }

  // Check for stuck prices (no change for >60s)
  const last = lastKnownPrices.get(key);
  if (last && last.price === price) {
    const age = Date.now() - last.time;
    if (age > 60000) {
      return { valid: false, reason: `Stuck price for ${Math.round(age / 1000)}s` };
    }
  }

  // Update tracking
  lastKnownPrices.set(key, { price, time: Date.now() });
  return { valid: true };
}

// ========================================
// HELPERS
// ========================================
function generateSession(): string {
  return 'ws_' + Math.random().toString(36).substring(2, 14) + Date.now().toString(36);
}

function formatMessage(name: string, payload: unknown[]): string {
  const msg = JSON.stringify({ m: name, p: payload });
  return `~m~${msg.length}~m~${msg}`;
}

function sendMsg(name: string, payload: unknown[]) {
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(formatMessage(name, payload));
  }
}

/**
 * Convert a portfolio symbol + market to a proper TradingView symbol.
 * Uses EXACT_TICKER_MAP for precise matching, falls back to NSE/NASDAQ.
 */
function portfolioSymbolToTv(sym: string, market: 'IN' | 'US'): string {
  const cleanSym = sym.replace('.NS', '').replace('.BO', '').trim();

  // Check exact ticker map first
  if (EXACT_TICKER_MAP[cleanSym]) {
    return EXACT_TICKER_MAP[cleanSym];
  }

  if (market === 'IN') {
    return `NSE:${cleanSym}`;
  }

  // US market — try common exchanges
  return `NASDAQ:${cleanSym}`;
}

/**
 * Convert a TV symbol from the WebSocket back to the portfolio key.
 * This is the critical mapping that was broken before.
 */
function tvSymbolToPortfolioKey(tvSymbol: string): string | null {
  // Direct reverse lookup
  const direct = tvSymbolToKey.get(tvSymbol);
  if (direct) return direct;

  // Parse "NSE:RELIANCE" or "CBOE:VIX"
  const parts = tvSymbol.split(':');
  if (parts.length < 2) return null;

  const exchange = parts[0].toUpperCase();
  const rawSym = parts[1].toUpperCase();

  // Check all registered keys for a matching raw symbol
  for (const [key, tvSym] of keyToTvSymbol.entries()) {
    const tvParts = tvSym.split(':');
    if (tvParts.length < 2) continue;
    const tvRaw = tvParts[1].toUpperCase();

    // Match on raw symbol (flexible exchange matching)
    if (rawSym === tvRaw) return key;

    // Cross-match: NSE/BSE are both Indian
    if ((exchange === 'NSE' || exchange === 'BSE') &&
        (tvParts[0].toUpperCase() === 'NSE' || tvParts[0].toUpperCase() === 'BSE') &&
        rawSym === tvRaw) return key;

    // Cross-match: US exchanges (NASDAQ/NYSE/AMEX/ARCA)
    const usExchanges = new Set(['NASDAQ', 'NYSE', 'AMEX', 'ARCA']);
    if (usExchanges.has(exchange) && usExchanges.has(tvParts[0].toUpperCase()) && rawSym === tvRaw) return key;
  }

  return null;
}

// ========================================
// PUBLIC API
// ========================================
export function subscribeToPrices(
  symbols: string[],
  onUpdate: (key: string, data: Partial<PriceData>) => void
) {
  callbacks.add(onUpdate);

  // Build symbol mapping
  symbols.forEach(sym => {
    const mkt = guessMarket(sym);
    const tvSym = portfolioSymbolToTv(sym, mkt);
    const key = `${mkt}_${sym}`;

    keyToTvSymbol.set(key, tvSym);
    tvSymbolToKey.set(tvSym, key);
  });

  if (!ws || ws.readyState === WebSocket.CLOSED) {
    reconnectAttempts = 0;
    connect();
  } else if (ws.readyState === WebSocket.OPEN) {
    const tvSymbols = symbols.map(s => {
      const mkt = guessMarket(s);
      return portfolioSymbolToTv(s, mkt);
    });
    // Remove duplicates
    sendMsg('quote_add_symbols', [currentSession, ...new Set(tvSymbols)]);
  }

  return () => {
    callbacks.delete(onUpdate);
  };
}

/**
 * Cleanly disconnect the WebSocket
 */
export function disconnectPrices() {
  isDestroyed = true;
  if (pingInterval) {
    clearInterval(pingInterval);
    pingInterval = null;
  }
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
  if (ws) {
    ws.onclose = null;
    ws.close();
    ws = null;
  }
  currentSession = '';
  reconnectAttempts = 0;
}

// ========================================
// CONNECTION
// ========================================
function connect() {
  if (isDestroyed) return;
  if (ws) {
    ws.onclose = null;
    ws.close();
  }

  try {
    ws = new WebSocket('wss://data.tradingview.com/socket.io/websocket', ['protocol-protocol']);
  } catch (e) {
    scheduleReconnect();
    return;
  }

  ws.onopen = () => {
    reconnectAttempts = 0;
    currentSession = generateSession();

    // Auth
    sendMsg('set_auth_token', ['unauthorized_user_token']);

    // Create session
    sendMsg('quote_create_session', [currentSession]);

    // Set fields we want
    sendMsg('quote_set_fields', [
      currentSession,
      'lp',          // last price
      'ch',           // change
      'chp',          // change percent
      'high_price',   // day high
      'low_price',    // day low
      'volume',       // volume
      'open_price',   // open
      'prev_close_price' // previous close
    ]);

    // Subscribe all symbols (with dedup via subscribedSymbols set)
    const allTvSymbols = [...new Set(keyToTvSymbol.values())];
    if (allTvSymbols.length > 0) {
      sendMsg('quote_add_symbols', [currentSession, ...allTvSymbols]);
      allTvSymbols.forEach(s => subscribedSymbols.add(s));
    }

    // Adaptive heartbeat — measures RTT and adjusts interval
    if (pingInterval) clearInterval(pingInterval);
    pingInterval = window.setInterval(() => {
      if (ws?.readyState === WebSocket.OPEN) {
        measureLatency();
      }
    }, adaptiveHeartbeatMs);
  };

  ws.onmessage = (event: MessageEvent) => {
    const data: string = typeof event.data === 'string' ? event.data : '';
    if (!data) return;

    // Parse TradingView wire format: ~m~<length>~m~<json>
    if (!data.includes('~m~')) return;

    let offset = 0;
    while (offset < data.length) {
      const markerStart = data.indexOf('~m~', offset);
      if (markerStart === -1) break;

      const lengthStart = markerStart + 3;
      const markerEnd = data.indexOf('~m~', lengthStart);
      if (markerEnd === -1) break;

      const msgLength = parseInt(data.substring(lengthStart, markerEnd), 10);
      if (isNaN(msgLength) || msgLength <= 0) {
        offset = markerEnd + 3;
        continue;
      }

      const jsonStart = markerEnd + 3;
      const jsonEnd = jsonStart + msgLength;

      if (jsonEnd > data.length) break;

      const jsonStr = data.substring(jsonStart, jsonEnd);

      // Skip heartbeat responses
      if (jsonStr.startsWith('~h~') || /^\d+$/.test(jsonStr.trim())) {
        offset = jsonEnd;
        continue;
      }

      try {
        const parsed = JSON.parse(jsonStr);
        handleParsedMessage(parsed);
      } catch {
        // Detect pong response for latency measurement
        if (data.substring(jsonStart, jsonEnd).includes('~h~') && pingStartTime > 0) {
          const latency = Date.now() - pingStartTime;
          recordLatency(latency);
          pingStartTime = 0;
        }
        // Skip non-JSON messages
      }

      offset = jsonEnd;
    }
  };

  ws.onclose = () => {
    if (pingInterval) {
      clearInterval(pingInterval);
      pingInterval = null;
    }
    scheduleReconnect();
  };

  ws.onerror = () => {
    // Error triggers onclose automatically
  };
}

function handleParsedMessage(parsed: Record<string, unknown>): void {
  if (parsed.m !== 'qsd' || !Array.isArray(parsed.p) || parsed.p.length < 2) return;

  const tvSymbol = parsed.p[0] as string;
  const payload = parsed.p[1] as Record<string, unknown> | null;
  if (!payload || payload.s !== 'ok' || !payload.v) return;

  const v = payload.v as Record<string, number>;

  // Map TV symbol back to portfolio key
  const key = tvSymbolToPortfolioKey(tvSymbol);
  if (!key) return;

  const update: Partial<PriceData> = {};
  const rawPrice = v.lp !== undefined && !isNaN(v.lp) && v.lp > 0 ? v.lp : undefined;

  // Price validation
  if (rawPrice !== undefined) {
    const lastEntry = lastKnownPrices.get(key);
    const lastPrice = lastEntry?.price;
    const validation = validatePrice(key, rawPrice, lastPrice);
    if (!validation.valid) {
      // Log silently — bad ticks are common on WS feeds
      console.debug(`[WS] ${key}: ${validation.reason} (${rawPrice})`);
      return;
    }
    update.price = rawPrice;
  }

  if (v.chp !== undefined && !isNaN(v.chp)) update.change = v.chp;
  else if (v.ch !== undefined && !isNaN(v.ch) && update.price) {
    update.change = (v.ch / update.price) * 100;
  }
  if (v.high_price !== undefined && !isNaN(v.high_price)) update.high = v.high_price;
  if (v.low_price !== undefined && !isNaN(v.low_price)) update.low = v.low_price;
  if (v.volume !== undefined && !isNaN(v.volume)) update.volume = v.volume;

  update.time = Date.now();

  // Derive market from the key
  update.market = key.startsWith('IN_') ? 'IN' : 'US';

  if (Object.keys(update).length > 1) { // more than just 'time'
    callbacks.forEach(cb => cb(key, update));
  }
}

export function getWebSocketLatency(): { avg: number; heartbeat: number } {
  return { avg: Math.round(currentLatency), heartbeat: adaptiveHeartbeatMs };
}

function scheduleReconnect(): void {
  if (isDestroyed) return;
  if (reconnectAttempts >= MAX_RECONNECT_ATTEMPTS) {
    return;
  }
  reconnectAttempts++;

  const delay = Math.min(30000, 1000 * Math.pow(1.8, reconnectAttempts));
  reconnectTimer = window.setTimeout(() => {
    subscribedSymbols.clear(); // Clear subscription state so reconnect resubscribes
    connect();
  }, delay);
}
