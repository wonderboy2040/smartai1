import { useState, useEffect, useCallback, useRef } from 'react';

interface SSEOptions {
  onMessage?: (data: any) => void;
  onError?: (error: Event) => void;
  onOpen?: () => void;
  onClose?: () => void;
}

export function useServerSentEvents(url: string | null, options: SSEOptions = {}) {
  const [status, setStatus] = useState<'idle' | 'connecting' | 'connected' | 'error'>('idle');
  const [data, setData] = useState<any>(null);
  const eventSourceRef = useRef<EventSource | null>(null);
  // Ref for options to avoid identity instability (inline objects change every render).
  const optionsRef = useRef(options);
  optionsRef.current = options;

  const connect = useCallback(() => {
    if (!url) return;

    // Close existing connection
    if (eventSourceRef.current) {
      eventSourceRef.current.close();
    }

    setStatus('connecting');
    console.log('[SSE] Connecting to:', url);

    const eventSource = new EventSource(url);
    eventSourceRef.current = eventSource;

    eventSource.onopen = () => {
      console.log('[SSE] Connected');
      setStatus('connected');
      optionsRef.current.onOpen?.();
    };

    eventSource.onmessage = (event) => {
      try {
        const parsedData = JSON.parse(event.data);
        setData(parsedData);
        optionsRef.current.onMessage?.(parsedData);
      } catch {
        // If not JSON, use raw data
        setData(event.data);
        optionsRef.current.onMessage?.(event.data);
      }
    };

    eventSource.onerror = (error) => {
      console.error('[SSE] Error:', error);
      setStatus('error');
      optionsRef.current.onError?.(error);

      // EventSource will auto-reconnect
    };

    return () => {
      eventSource.close();
      optionsRef.current.onClose?.();
    };
  }, [url]);

  const disconnect = useCallback(() => {
    if (eventSourceRef.current) {
      eventSourceRef.current.close();
      eventSourceRef.current = null;
      setStatus('idle');
      console.log('[SSE] Disconnected');
    }
  }, []);

  useEffect(() => {
    if (url) {
      const cleanup = connect();
      return cleanup;
    }
  }, [url, connect]);

  return {
    status,
    data,
    disconnect,
    reconnect: connect
  };
}

// Streaming AI chat hook
export function useStreamingAI() {
  const [streamedText, setStreamedText] = useState('');
  const [isStreaming, setIsStreaming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);

  const streamChat = useCallback(async (
    messages: Array<{ role: string; content: string }>,
    endpoint: string = '/api/chat/stream'
  ) => {
    // Cancel any existing stream
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }

    abortControllerRef.current = new AbortController();
    setStreamedText('');
    setIsStreaming(true);
    setError(null);

    try {
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ messages }),
        signal: abortControllerRef.current.signal
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      const reader = response.body?.getReader();
      const decoder = new TextDecoder();

      if (!reader) {
        throw new Error('No response body');
      }

      let accumulatedText = '';
      // v10.13 (deep-recheck M1): cross-read LINE BUFFER. TCP/SSE events
      // frequently split mid-line across reader.read() chunks — the old
      // per-chunk split() fed BOTH halves to JSON.parse, which failed silently
      // in the catch, DROPPING the content. Buffer and only process up to the
      // last newline; the remainder carries into the next read.
      let lineBuffer = '';

      while (true) {
        const { done, value } = await reader.read();

        if (done) {
          console.log('[Stream] Complete');
          // flush any trailing line that never got its final newline
          if (lineBuffer.startsWith('data: ')) {
            const data = lineBuffer.slice(6).trim();
            if (data && data !== '[DONE]') {
              try {
                const parsed = JSON.parse(data);
                const content = parsed.content || parsed.choices?.[0]?.delta?.content || '';
                if (content) {
                  accumulatedText += content;
                  setStreamedText(accumulatedText);
                }
              } catch { /* skip invalid JSON */ }
            }
          }
          break;
        }

        // Decode chunk
        const chunk = decoder.decode(value, { stream: true });
        const combined = lineBuffer + chunk;
        const lastNewline = combined.lastIndexOf('\n');
        if (lastNewline === -1) {
          lineBuffer = combined; // incomplete line — wait for more data
          continue;
        }
        lineBuffer = combined.slice(lastNewline + 1);

        // Parse SSE format
        const lines = combined.slice(0, lastNewline + 1).split('\n');
        for (const line of lines) {
          if (line.startsWith('data: ')) {
            const data = line.slice(6).trim();

            if (data === '[DONE]') {
              continue;
            }

            try {
              const parsed = JSON.parse(data);
              const content = parsed.content || parsed.choices?.[0]?.delta?.content || '';

              if (content) {
                accumulatedText += content;
                setStreamedText(accumulatedText);
              }
            } catch (e) {
              // Skip invalid JSON
            }
          }
        }
      }

      setIsStreaming(false);
      return accumulatedText;

    } catch (err: any) {
      if (err.name === 'AbortError') {
        console.log('[Stream] Aborted by user');
      } else {
        console.error('[Stream] Error:', err);
        setError(err.message);
      }
      setIsStreaming(false);
      throw err;
    }
  }, []);

  const stopStreaming = useCallback(() => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }
    setIsStreaming(false);
  }, []);

  return {
    streamedText,
    isStreaming,
    error,
    streamChat,
    stopStreaming
  };
}

// Live updates hook using SSE
export function useLiveUpdates(endpoint: string | null) {
  const [updates, setUpdates] = useState<any[]>([]);

  const { data, status } = useServerSentEvents(endpoint, {
    onMessage: (newData) => {
      // v10.13 (deep-recheck H2): RING BUFFER — the old append-forever array
      // grew unboundedly on a 1-5 msg/sec stream (slow memory leak + each
      // update re-rendered an ever-longer list). Keep the newest 200.
      setUpdates(prev => [...prev, newData].slice(-200));
    }
  });

  const clearUpdates = useCallback(() => {
    setUpdates([]);
  }, []);

  return {
    updates,
    latestUpdate: data,
    status,
    clearUpdates
  };
}
