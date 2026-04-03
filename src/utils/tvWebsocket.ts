import { PriceData } from '../types';
import { guessMarket } from './constants';

let ws: WebSocket | null = null;
let currentSession = '';
let shouldReconnect = true;
const callbacks: Set<(symbol: string, data: Partial<PriceData>) => void> = new Set();
let activeSymbols: Map<string, Set<(symbol: string, data: Partial<PriceData>) => void>> = new Map();
let pingInterval: number;

function generateSession(): string {
  return 'qs_' + Math.random().toString(36).substring(2, 12);
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

function getAllActiveSymbols(): string[] {
  return [...new Set([...activeSymbols.keys()])];
}

export function subscribeToPrices(symbols: string[], onUpdate: (sym: string, data: Partial<PriceData>) => void) {
  callbacks.add(onUpdate);
  
  const formattedSymbols = symbols.map(s => {
    const sym = s.toUpperCase().replace('.NS', '').replace('.BO', '');
    const mkt = guessMarket(s);
    if (mkt === 'IN' || s.includes('.NS') || s.includes('.BO') || s.includes('BEES')) {
      return `NSE:${sym}`;
    }
    return sym.includes(':') ? sym : `NASDAQ:${sym}`;
  });

  formattedSymbols.forEach(s => {
    if (!activeSymbols.has(s)) {
      activeSymbols.set(s, new Set());
    }
    activeSymbols.get(s)!.add(onUpdate);
  });

  shouldReconnect = true;

  if (!ws || ws.readyState === WebSocket.CLOSED) {
    connect();
  } else if (ws.readyState === WebSocket.OPEN) {
    sendMsg('quote_add_symbols', [currentSession, ...formattedSymbols]);
  }

  // Return cleanup function
  return () => {
    callbacks.delete(onUpdate);

    // Remove this callback from all symbols and clean up symbols with no listeners
    const symbolsToRemove: string[] = [];
    activeSymbols.forEach((cbs, sym) => {
      cbs.delete(onUpdate);
      if (cbs.size === 0) {
        symbolsToRemove.push(sym);
      }
    });
    symbolsToRemove.forEach(sym => activeSymbols.delete(sym));

    // If no more callbacks, disconnect completely
    if (callbacks.size === 0) {
      shouldReconnect = false;
      if (ws) {
        ws.close();
        ws = null;
      }
      clearInterval(pingInterval);
      activeSymbols.clear();
    }
  };
}

function buildKeyFromTvSymbol(tvSymbol: string): string {
  // tvSymbol like "NSE:RELIANCE" or "NASDAQ:AAPL"
  const parts = tvSymbol.split(':');
  const exchange = parts[0] || '';
  const rawSym = parts[1] || tvSymbol;
  const isIndian = exchange === 'NSE' || exchange === 'BSE';
  
  // Match the key format used by batchFetchPrices: "IN_SYMBOL.NS" or "US_SYMBOL"
  if (isIndian) {
    // For BEES-type ETFs, don't add .NS suffix
    if (rawSym.includes('BEES') || rawSym === 'INDIAVIX') {
      return `IN_${rawSym}`;
    }
    return `IN_${rawSym}.NS`;
  }
  return `US_${rawSym}`;
}

function connect() {
  if (ws) {
    try { ws.close(); } catch (_e) { /* ignore */ }
  }
  
  if (!shouldReconnect) return;
  
  ws = new WebSocket('wss://data.tradingview.com/socket.io/websocket', ['chat']);
  
  ws.onopen = () => {
    currentSession = generateSession();
    sendMsg('set_auth_token', ['unauthorized_user_token']);
    sendMsg('quote_create_session', [currentSession]);
    sendMsg('quote_set_fields', [
      currentSession,
      'lp',
      'ch',
      'chp',
      'high_price',
      'low_price',
      'volume'
    ]);
    
    const syms = getAllActiveSymbols();
    if (syms.length > 0) {
      sendMsg('quote_add_symbols', [currentSession, ...syms]);
    }

    pingInterval = window.setInterval(() => {
      if (ws?.readyState === WebSocket.OPEN) {
        ws.send(`~m~2~m~~h~2`);
      }
    }, 20000);
  };

  ws.onmessage = (event) => {
    const data = event.data.toString();
    if (data.includes('~m~')) {
      const packets = data.split('~m~').filter((p: string) => p && !p.startsWith('~h~') && !/^\d+$/.test(p));
      packets.forEach((packet: string) => {
        try {
          const parsed = JSON.parse(packet);
          if (parsed.m === 'qsd' && parsed.p && parsed.p[1]) {
            const tvSymbol = parsed.p[1].n || '';
            const payload = parsed.p[1];
            
            if (payload.s === 'ok' && payload.v) {
              const finalKey = buildKeyFromTvSymbol(tvSymbol);
              
              const update: Partial<PriceData> = {};
              if (payload.v.lp !== undefined) update.price = payload.v.lp;
              if (payload.v.chp !== undefined) update.change = payload.v.chp;
              if (payload.v.high_price !== undefined) update.high = payload.v.high_price;
              if (payload.v.low_price !== undefined) update.low = payload.v.low_price;
              if (payload.v.volume !== undefined) update.volume = payload.v.volume;

              if (Object.keys(update).length > 0) {
                callbacks.forEach(cb => cb(finalKey, update));
              }
            }
          }
        } catch (_e) {
          // Ignore parse errors from generic socket messages
        }
      });
    }
  };

  ws.onclose = () => {
    clearInterval(pingInterval);
    if (shouldReconnect && callbacks.size > 0) {
      setTimeout(connect, 3000);
    }
  };

  ws.onerror = () => {
    console.warn('[WS] TradingView WebSocket error, will reconnect...');
  };
}
