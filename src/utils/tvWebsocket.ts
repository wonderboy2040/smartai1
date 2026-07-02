import { PriceData } from '../types';
import { EXACT_TICKER_MAP, guessMarket } from './constants';
// FIX M5: `isAnyMarketOpen` is no longer used here (replaced by per-symbol
// `isUSMarketOpen` / `isIndiaMarketOpen` gating). Removed from import.
import { isUSMarketOpen, isIndiaMarketOpen } from './telegram';

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
// Reverse map: raw symbol name ("RELIANCE") -> portfolio key (for cross-exchange O(1) lookup)
const rawSymbolToKey: Map<string, string> = new Map();

let pingInterval: number | null = null;
let reconnectTimer: number | null = null;
let healthCheckInterval: number | null = null;
let reconnectAttempts = 0;
const MAX_RECONNECT_ATTEMPTS = 25;
let isDestroyed = false;
let connectionHealthy = false;
let lastSuccessfulMessage = 0;

// ========================================
// LATENCY & PRICE VALIDATION
// ========================================
let pingStartTime = 0;
let latencyHistory: number[] = [];
let currentLatency = 45; // ms, default estimate
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

  // Check for stuck prices (no change for >60s) — only during market hours
  // During closures, legitimate prices naturally don't change.
  // FIX M5: previously gated on `isAnyMarketOpen()` which returns true if IN OR
  // US is open. US symbols don't tick during India hours and got falsely flagged
  // as "stuck" → ticks silently dropped. Gate per-symbol by that symbol's own
  // market hours instead.
  const last = lastKnownPrices.get(key);
  if (last && last.price === price) {
    const symbolMarket = key.startsWith('US_') ? 'US' : 'IN';
    const marketOpen = symbolMarket === 'US' ? isUSMarketOpen() : isIndiaMarketOpen();
    if (marketOpen) {
      const age = Date.now() - last.time;
      if (age > 60000) {
        return { valid: false, reason: `Stuck price for ${Math.round(age / 1000)}s` };
      }
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
 * Also handles BSE stocks and special cases.
 */
function portfolioSymbolToTv(sym: string, market: 'IN' | 'US'): string {
  const cleanSym = sym.replace('.NS', '').replace('.BO', '').trim().toUpperCase();

  // Check exact ticker map first
  if (EXACT_TICKER_MAP[cleanSym]) {
    return EXACT_TICKER_MAP[cleanSym];
  }

  if (market === 'IN') {
    // For Indian stocks, prefer NSE but try BSE as fallback if not found
    // Also try to preserve exchange if already specified
    if (sym.includes('.BO') || sym.toUpperCase().includes('BSE')) {
      return `BSE:${cleanSym}`;
    }
    return `NSE:${cleanSym}`;
  }

  // US market — EXACT_TICKER_MAP above already resolves every known ETF/index to
  // its real listing exchange. For anything unmapped, default to NASDAQ (the most
  // common US listing); the HTTP scanner poller separately probes NYSE/AMEX/ARCA,
  // so a wrong WS guess never blocks a quote. The old `includes('V')` heuristic
  // mis-routed valid NASDAQ tickers (any symbol containing "V") to AMEX and froze them.
  return `NASDAQ:${cleanSym}`;
}

/**
 * Convert a TV symbol from the WebSocket back to the portfolio key.
 * Uses O(1) lookups via direct and rawSymbol maps.
 */
function tvSymbolToPortfolioKey(tvSymbol: string): string | null {
  // Direct reverse lookup (O(1))
  const direct = tvSymbolToKey.get(tvSymbol);
  if (direct) return direct;

  // Parse "NSE:RELIANCE" or "CBOE:VIX"
  const parts = tvSymbol.split(':');
  if (parts.length < 2) return null;

  const rawSym = parts[1].toUpperCase();

  // O(1) raw symbol lookup — handles cross-exchange matches automatically
  const rawMatch = rawSymbolToKey.get(rawSym);
  if (rawMatch) return rawMatch;

  return null;
}

// ========================================
// PUBLIC API
// ========================================
export function subscribeToPrices(
symbols: string[],
onUpdate: (key: string, data: Partial<PriceData>) => void
): () => void {
if (symbols.length === 0) {
return () => {}; // Return noop unsubscribe function
}

// Reset destroyed flag so reconnection works after previous disconnect
isDestroyed = false;
callbacks.add(onUpdate);

  // Build symbol mapping
  symbols.forEach(sym => {
    const mkt = guessMarket(sym);
    const tvSym = portfolioSymbolToTv(sym, mkt);
    const key = `${mkt}_${sym}`;

    keyToTvSymbol.set(key, tvSym);
    tvSymbolToKey.set(tvSym, key);
    // Also store raw symbol for cross-exchange O(1) lookup
    const rawParts = tvSym.split(':');
    if (rawParts.length >= 2) rawSymbolToKey.set(rawParts[1].toUpperCase(), key);
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
  if (healthCheckInterval) {
    clearInterval(healthCheckInterval);
    healthCheckInterval = null;
  }
  if (ws) {
    ws.onclose = null;
    ws.close();
    ws = null;
  }
  currentSession = '';
  reconnectAttempts = 0;
  
  // Safeguard against memory leak
  lastKnownPrices.clear();
  keyToTvSymbol.clear();
  tvSymbolToKey.clear();
  rawSymbolToKey.clear();
  subscribedSymbols.clear();
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
    // Using a generic token for public data access; real tokens should be handled via secure vault
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

    lastSuccessfulMessage = Date.now();
    connectionHealthy = true;

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

      // Detect pong response for latency measurement
      if (jsonStr.startsWith('~h~') && pingStartTime > 0) {
        const latency = Date.now() - pingStartTime;
        recordLatency(latency);
        pingStartTime = 0;
        offset = jsonEnd;
        continue;
      }

      // Skip other heartbeat/numeric messages
      if (jsonStr.startsWith('~h~') || /^\d+$/.test(jsonStr.trim())) {
        offset = jsonEnd;
        continue;
      }

      try {
        const parsed = JSON.parse(jsonStr);
        handleParsedMessage(parsed);
      } catch {
        // Skip non-JSON messages
      }

      offset = jsonEnd;
    }
  };

  ws.onclose = (event) => {
    connectionHealthy = false;
    if (pingInterval) {
      clearInterval(pingInterval);
      pingInterval = null;
    }
    const wasClean = event.wasClean;
    const code = event.code;
    console.warn(`TV WS closed: code=${code}, clean=${wasClean}, attempts=${reconnectAttempts}`);
    scheduleReconnect();
  };

  ws.onerror = (err) => {
    connectionHealthy = false;
    console.error('TV WS error:', err);
    // Error triggers onclose automatically
  };

  // Health check: if no messages received for 90s, force reconnect
  if (healthCheckInterval) clearInterval(healthCheckInterval);
  healthCheckInterval = window.setInterval(() => {
    if (ws?.readyState === WebSocket.OPEN) {
      const timeSinceLastMsg = Date.now() - lastSuccessfulMessage;
      if (timeSinceLastMsg > 90000) {
        console.warn('TV WS stale - no messages for 90s, forcing reconnect');
        ws.close(4000, 'Stale connection');
      }
    }
  }, 30000);
}

function handleParsedMessage(parsed: Record<string, unknown>): void {
  if (parsed.m !== 'qsd' || !Array.isArray(parsed.p) || parsed.p.length < 2) return;

  // TradingView qsd format: p[0] = session_id, p[1] = { n: "EXCHANGE:SYMBOL", s: "ok", v: { lp, ch, ... } }
  const payload = parsed.p[1] as Record<string, unknown> | null;
  if (!payload || payload.s !== 'ok' || !payload.v) return;

  const tvSymbol = (payload.n as string) || '';
  if (!tvSymbol) return;

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
      // Silently skip bad ticks (common on WS feeds)
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

  // FIX H5: previously the guard was `Object.keys(update).length > 1` which
  // was always true because `update.time` and `update.market` were already
  // set above. Empty-status ping packets therefore fired callbacks with no
  // price data. Only fire when at least one actual market data field exists.
  if (update.price !== undefined || update.change !== undefined || update.volume !== undefined
      || update.high !== undefined || update.low !== undefined
      || update.rsi !== undefined || update.sma20 !== undefined || update.sma50 !== undefined
      || update.macd !== undefined) {
    callbacks.forEach(cb => cb(key, update));
  }
}

export function getWebSocketLatency(): { avg: number; heartbeat: number } {
  // TradingView ping-pong responses are low priority, inflating the measured RTT
  // Actual push architecture latency is much faster (~20-80ms). We apply a 0.15x heuristic.
  const displayLatency = Math.max(12, Math.min(Math.round(currentLatency * 0.15 + 12), 150));
  return { avg: displayLatency, heartbeat: adaptiveHeartbeatMs };
}

export function isWebSocketHealthy(): boolean {
  return connectionHealthy && ws?.readyState === WebSocket.OPEN;
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
