import { PriceData } from '../types';
import { isCryptoSymbol } from './constants';

let ws: WebSocket | null = null;
const callbacks: Set<(key: string, data: Partial<PriceData>) => void> = new Set();
let reconnectTimer: number | null = null;
let reconnectAttempts = 0;
const MAX_RECONNECT_ATTEMPTS = 25;
let isDestroyed = false;

// We use USDT pairs as proxies for crypto.
const symbolMap: Map<string, string> = new Map();

export function subscribeToCryptoPrices(
  symbols: string[],
  onUpdate: (key: string, data: Partial<PriceData>) => void
): () => void {
  const cryptoSymbols = symbols.filter(s => isCryptoSymbol(s));
  if (cryptoSymbols.length === 0) return () => {};

  isDestroyed = false;
  callbacks.add(onUpdate);

  if (!ws || ws.readyState === WebSocket.CLOSED) {
    reconnectAttempts = 0;
    connect(cryptoSymbols);
  } else if (ws.readyState === WebSocket.OPEN) {
    subscribeStreams(cryptoSymbols);
  }

  return () => {
    callbacks.delete(onUpdate);
  };
}

export function disconnectCryptoPrices() {
  isDestroyed = true;
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
  if (ws) {
    ws.onclose = null;
    ws.close();
    ws = null;
  }
  reconnectAttempts = 0;
}

function subscribeStreams(symbols: string[]) {
  if (!ws || ws.readyState !== WebSocket.OPEN) return;
  const streams = symbols.map(s => `${s.toLowerCase()}usdt@ticker`);
  
  // Update map
  symbols.forEach(s => {
    symbolMap.set(`${s.toUpperCase()}USDT`, s.toUpperCase());
  });

  ws.send(JSON.stringify({
    method: 'SUBSCRIBE',
    params: streams,
    id: Date.now()
  }));
}

function connect(initialSymbols: string[]) {
  if (isDestroyed) return;
  
  try {
    ws = new WebSocket('wss://stream.binance.com:9443/ws');
  } catch (e) {
    scheduleReconnect(initialSymbols);
    return;
  }

  ws.onopen = () => {
    reconnectAttempts = 0;
    subscribeStreams(initialSymbols);
  };

  ws.onmessage = (event) => {
    try {
      const data = JSON.parse(event.data);
      // Binance ticker format
      if (data.e === '24hrTicker') {
        const binanceSymbol = data.s; // e.g. "BTCUSDT"
        const baseSymbol = symbolMap.get(binanceSymbol);
        
        if (baseSymbol) {
          // Send price via callbacks. Note: The price here is in USD.
          // The UI batcher will multiply it by the INR rate to display natively as INR!
          const update: Partial<PriceData> = {
            price: parseFloat(data.c),
            change: parseFloat(data.P),
            high: parseFloat(data.h),
            low: parseFloat(data.l),
            volume: parseFloat(data.v),
            time: Date.now(),
            market: 'US', // Treating crypto as US market for tracking purposes since it uses USD baseline
          };

          const key = `US_${baseSymbol}`; // e.g. US_BTC
          callbacks.forEach(cb => cb(key, update));
          
          // Also broadcast to IN key in case it's tracked that way
          callbacks.forEach(cb => cb(`IN_${baseSymbol}`, update));
        }
      }
    } catch (err) {
      // Ignore parse errors
    }
  };

  ws.onclose = () => {
    scheduleReconnect(initialSymbols);
  };
}

function scheduleReconnect(symbols: string[]) {
  if (isDestroyed) return;
  if (reconnectAttempts >= MAX_RECONNECT_ATTEMPTS) return;
  reconnectAttempts++;
  const delay = Math.min(30000, 1000 * Math.pow(1.5, reconnectAttempts));
  reconnectTimer = window.setTimeout(() => {
    connect(symbols);
  }, delay);
}
