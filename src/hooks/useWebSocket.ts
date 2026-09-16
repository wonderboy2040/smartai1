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
  symbols?: string[];
}

export function useWebSocket(options: UseWebSocketOptions) {
  const {
    url,
    reconnectDelay = 3000,
    maxReconnectAttempts = 5,
    heartbeatInterval = 30000
  } = options;

  const [status, setStatus] = useState<ConnectionStatus>('disconnected');
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectAttemptsRef = useRef(0);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const heartbeatTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // v10.13 (deep-recheck H1): handlers live in a REF, not the connect closure.
  // The old effect ran once with empty deps — onMessage/onConnect/onDisconnect/
  // onError were captured from the FIRST render forever, so any consumer
  // reading current state in a handler silently read stale state for the
  // socket's lifetime. Refs stay fresh on every render.
  const handlersRef = useRef(options);
  handlersRef.current = options;

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

    // v10.13 (M2): CONNECTING also short-circuits — the old OPEN-only guard
    // let a manual connect() racing a pending socket create a SECOND socket
    // (the first kept its handlers → duplicate connections + double delivery).
    if (wsRef.current?.readyState === WebSocket.OPEN
      || wsRef.current?.readyState === WebSocket.CONNECTING) {
      return;
    }
    // v10.13 (H1b): a manual connect() must be able to actually reconnect —
    // the old path never reset the attempts counter (disconnect() set it to
    // max), so a manual retry after a failed server just gave up silently.
    reconnectAttemptsRef.current = 0;

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
        handlersRef.current.onConnect?.();
      };

      ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);

          // Ignore pong messages
          if (data.type === 'pong') return;

          handlersRef.current.onMessage?.(data);
        } catch (error) {
          console.error('[WebSocket] Message parse error:', error);
        }
      };

      ws.onerror = (error) => {
        console.error('[WebSocket] Error:', error);
        setStatus('error');
        handlersRef.current.onError?.(error);
      };

      ws.onclose = (event) => {
        console.log('[WebSocket] Disconnected:', event.code, event.reason);
        setStatus('disconnected');
        cleanup();
        handlersRef.current.onDisconnect?.();

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
  }, [url, reconnectDelay, maxReconnectAttempts, startHeartbeat, cleanup]);

  const disconnect = useCallback(() => {
    cleanup();
    reconnectAttemptsRef.current = maxReconnectAttempts; // Prevent reconnection

    if (wsRef.current) {
      wsRef.current.onclose = null; // deliberate close — no auto-reconnect
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

  // v10.13 (H1c): dep on `url` ONLY — handlers flow through handlersRef, so
  // an inline onMessage no longer re-creates the socket (connection churn)
  // while still being called with fresh closure state.
  useEffect(() => {
    connect();
    return () => {
      disconnect();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [url]);

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

  // v10.13 (H1d): string-key dep — an inline `symbols` array identity changes
  // on EVERY render, which re-fired this effect (subscribe spam) every tick.
  const symbolsKey = symbols.join(',');
  useEffect(() => {
    if (isConnected) {
      send({
        type: 'subscribe',
        symbols
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [symbolsKey, isConnected, send]);

  return {
    status,
    isConnected
  };
}
