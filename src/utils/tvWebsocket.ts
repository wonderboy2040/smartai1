import { PriceData } from '../types';

let ws: WebSocket | null = null;
let currentSession = '';
const callbacks: Set<(symbol: string, data: Partial<PriceData>) => void> = new Set();
let activeSymbols: Set<string> = new Set();
let pingInterval: number;

function generateSession(): string {
  return 'qs_' + Math.random().toString(36).substring(2, 12);
}

function formatMessage(name: string, payload: any[]): string {
  const msg = JSON.stringify({ m: name, p: payload });
  return `~m~${msg.length}~m~${msg}`;
}

function sendMsg(name: string, payload: any[]) {
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(formatMessage(name, payload));
  }
}

export function subscribeToPrices(symbols: string[], onUpdate: (sym: string, data: Partial<PriceData>) => void) {
  callbacks.add(onUpdate);
  const formattedSymbols = symbols.map(s => {
    let sym = s.toUpperCase().replace('.NS', '').replace('.BO', '');
    if (s.includes('.NS') || s.includes('.BO') || s.includes('BEES')) {
      return `NSE:${sym}`;
    }
    return sym.includes(':') ? sym : `NASDAQ:${sym}`;
  });

  formattedSymbols.forEach(s => activeSymbols.add(s));

  if (!ws || ws.readyState === WebSocket.CLOSED) {
    connect();
  } else if (ws.readyState === WebSocket.OPEN) {
    sendMsg('quote_add_symbols', [currentSession, ...formattedSymbols]);
  }

  return () => {
    callbacks.delete(onUpdate);
  };
}

function connect() {
  if (ws) ws.close();
  ws = new WebSocket('wss://data.tradingview.com/socket.io/websocket', ['chat']);
  
  ws.onopen = () => {
    currentSession = generateSession();
    sendMsg('set_auth_token', ['unauthorized_user_token']);
    sendMsg('quote_create_session', [currentSession]);
    sendMsg('quote_set_fields', [
      currentSession,
      'lp', // last price
      'ch', // change
      'chp', // change percent
      'high_price',
      'low_price',
      'volume'
    ]);
    
    if (activeSymbols.size > 0) {
      sendMsg('quote_add_symbols', [currentSession, ...Array.from(activeSymbols)]);
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
            const sym = parsed.p[0]; // e.g., "NSE:RELIANCE"
            const payload = parsed.p[1];
            
            if (payload.s === 'ok' && payload.v) {
              const rawSym = sym.split(':')[1] || sym;
              const isIndian = sym.includes('NSE') || sym.includes('BSE');
              const finalKey = `${isIndian ? 'IN' : 'US'}_${rawSym}${isIndian && !rawSym.includes('BEES') ? '.NS' : ''}`;
              
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
        } catch (e) {
          // Ignore parse errors from generic socket messages
        }
      });
    }
  };

  ws.onclose = () => {
    clearInterval(pingInterval);
    setTimeout(connect, 3000); // Reconnect loop
  };
}
