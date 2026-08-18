import { useEffect, useRef, useState, useCallback } from 'react';

type MessageHandler = (data: any) => void;
type ConnectionStatus = 'connecting' | 'connected' | 'disconnected' | 'error';

interface UseWebSocketOptions {
  url: string;
  onMessage?: MessageHandler;
  onConnect?: () => void;
  onDisconnect?: () => void;
  onError?: (error: Event) => void;
  reconnectDelay?: number;
  maxReconnectAttempts?: number;
  heartbeatInterval?: number;
}

export function useWebSocket(options: UseWebSocketOptions) {
  const {
    url,
    onMessage,
    onConnect,
    onDisconnect,
    onError,
    reconnectDelay = 3000,
    maxReconnectAttempts = 5,
    heartbeatInterval = 30000
  } = options;

  const [status, setStatus] = useState<ConnectionStatus>('disconnected');
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectAttemptsRef = useRef(0);
  const reconnectTimerRef = useRef<NodeJS.Timeout | null>(null);
  const heartbeatTimerRef = useRef<NodeJS.Timeout | null>(null);

  const cleanup = useCallback(() => {
    if (reconnectTimerRef.current) {
      clearTimeout(reconnectTimerRef.current);
      reconnectTimerRef.current = null;
    }
    if (heartbeatTimerRef.current) {
      clearInterval(heartbeatTimerRef.current);
      heartbeatTimerRef.current = null;
    }
  }, []);

  const startHeartbeat = useCallback(() => {
    cleanup();
    heartbeatTimerRef.current = setInterval(() => {
      if (wsRef.current?.readyState === WebSocket.OPEN) {
        wsRef.current.send(JSON.stringify({ type: 'ping' }));
      }
    }, heartbeatInterval);
  }, [heartbeatInterval, cleanup]);

  const connect = useCallback(() => {
    cleanup();

    if (wsRef.current?.readyState === WebSocket.OPEN) {
      return;
    }

    setStatus('connecting');
    console.log('[WebSocket] Connecting to:', url);

    try {
      const ws = new WebSocket(url);
      wsRef.current = ws;

      ws.onopen = () => {
        console.log('[WebSocket] Connected');
        setStatus('connected');
        reconnectAttemptsRef.current = 0;
        startHeartbeat();
        onConnect?.();
      };

      ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);

          // Ignore pong messages
          if (data.type === 'pong') return;

          onMessage?.(data);
        } catch (error) {
          console.error('[WebSocket] Message parse error:', error);
        }
      };

      ws.onerror = (error) => {
        console.error('[WebSocket] Error:', error);
        setStatus('error');
        onError?.(error);
      };

      ws.onclose = (event) => {
        console.log('[WebSocket] Disconnected:', event.code, event.reason);
        setStatus('disconnected');
        cleanup();
        onDisconnect?.();

        // Attempt reconnection
        if (reconnectAttemptsRef.current < maxReconnectAttempts) {
          reconnectAttemptsRef.current++;
          const delay = reconnectDelay * reconnectAttemptsRef.current;

          console.log(
            `[WebSocket] Reconnecting in ${delay}ms (attempt ${reconnectAttemptsRef.current}/${maxReconnectAttempts})`
          );

          reconnectTimerRef.current = setTimeout(() => {
            connect();
          }, delay);
        } else {
          console.error('[WebSocket] Max reconnection attempts reached');
        }
      };
    } catch (error) {
      console.error('[WebSocket] Connection error:', error);
      setStatus('error');
    }
  }, [url, onMessage, onConnect, onDisconnect, onError, reconnectDelay, maxReconnectAttempts, startHeartbeat, cleanup]);

  const disconnect = useCallback(() => {
    cleanup();
    reconnectAttemptsRef.current = maxReconnectAttempts; // Prevent reconnection

    if (wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
    }

    setStatus('disconnected');
  }, [cleanup, maxReconnectAttempts]);

  const send = useCallback((data: any) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      const message = typeof data === 'string' ? data : JSON.stringify(data);
      wsRef.current.send(message);
      return true;
    }
    console.warn('[WebSocket] Cannot send - not connected');
    return false;
  }, []);

  useEffect(() => {
    connect();

    return () => {
      disconnect();
    };
  }, []);

  return {
    status,
    send,
    connect,
    disconnect,
    isConnected: status === 'connected'
  };
}

// Live prices WebSocket hook
export function useLivePrices(
  symbols: string[],
  onPriceUpdate: (prices: Record<string, any>) => void
) {
  const wsUrl = `${window.location.protocol === 'https:' ? 'wss:' : 'ws:'}//${window.location.host}/ws/prices`;

  const { status, send, isConnected } = useWebSocket({
    url: wsUrl,
    onMessage: (data) => {
      if (data.type === 'prices') {
        onPriceUpdate(data.prices);
      }
    },
    onConnect: () => {
      // Subscribe to symbols
      send({
        type: 'subscribe',
        symbols
      });
    }
  });

  useEffect(() => {
    if (isConnected) {
      send({
        type: 'subscribe',
        symbols
      });
    }
  }, [symbols, isConnected, send]);

  return {
    status,
    isConnected
  };
}

// WebSocket server implementation (for backend)
export const createWebSocketServer = `
// server/websocket.js
import { WebSocketServer } from 'ws';

export function setupWebSocketServer(server) {
  const wss = new WebSocketServer({ server, path: '/ws/prices' });
  const clients = new Map();

  wss.on('connection', (ws, req) => {
    const clientId = Math.random().toString(36).slice(2);
    clients.set(clientId, { ws, subscriptions: new Set() });

    console.log('[WS] Client connected:', clientId);

    ws.on('message', (message) => {
      try {
        const data = JSON.parse(message.toString());

        switch (data.type) {
          case 'subscribe':
            data.symbols?.forEach(symbol => {
              clients.get(clientId).subscriptions.add(symbol);
            });
            console.log('[WS] Subscribed:', data.symbols);
            break;

          case 'unsubscribe':
            data.symbols?.forEach(symbol => {
              clients.get(clientId).subscriptions.delete(symbol);
            });
            break;

          case 'ping':
            ws.send(JSON.stringify({ type: 'pong' }));
            break;
        }
      } catch (error) {
        console.error('[WS] Message error:', error);
      }
    });

    ws.on('close', () => {
      clients.delete(clientId);
      console.log('[WS] Client disconnected:', clientId);
    });

    ws.on('error', (error) => {
      console.error('[WS] Error:', error);
      clients.delete(clientId);
    });
  });

  // Broadcast prices every 3 seconds
  setInterval(async () => {
    const prices = await fetchLatestPrices();

    clients.forEach((client, clientId) => {
      if (client.ws.readyState === 1) { // OPEN
        const relevantPrices = {};

        client.subscriptions.forEach(symbol => {
          if (prices[symbol]) {
            relevantPrices[symbol] = prices[symbol];
          }
        });

        if (Object.keys(relevantPrices).length > 0) {
          client.ws.send(JSON.stringify({
            type: 'prices',
            prices: relevantPrices
          }));
        }
      }
    });
  }, 3000);

  return wss;
}
`;

// Example usage
export const WebSocketExample = `
// In your component:
import { useLivePrices } from '../hooks/useWebSocket';

function Dashboard() {
  const [prices, setPrices] = useState({});

  const { status, isConnected } = useLivePrices(
    ['RELIANCE', 'TCS', 'INFY'],
    (newPrices) => {
      setPrices(prev => ({ ...prev, ...newPrices }));
    }
  );

  return (
    <div>
      <div>Status: {status}</div>
      {Object.entries(prices).map(([symbol, data]) => (
        <div key={symbol}>
          {symbol}: ₹{data.price} ({data.change}%)
        </div>
      ))}
    </div>
  );
}
`;
