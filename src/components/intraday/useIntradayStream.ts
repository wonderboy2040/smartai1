// ============================================================
// intraday/useIntradayStream — SSE live-quote/outcome stream hook
// ------------------------------------------------------------
// Connects to the public GET /api/intraday-stream SSE endpoint
// (server pushes every ~5s during NSE hours, 24/7 while crypto
// symbols are in the watch set):
//   event: quotes        → { SYMBOL: { price, change, ts } }
//   event: outcome       → { type, symbol, price, pnl, ... }
//   event: regime        → NIFTY/VIX regime (India market)
//   event: crypto-regime → BTC regime (crypto market)
//   event: status        → watcher heartbeat (keepalive)
// Auto-reconnects (native EventSource). Falls back silently when
// the stream is unavailable — the tab still works via 60s polling.
// ============================================================
import { useEffect, useRef, useState } from 'react';
import type { LiveQuote, MarketRegime, OutcomeEvent } from './types';

const PROXY_BASE = (import.meta.env.VITE_API_PROXY as string) || '';

export interface StreamState {
  livePrices: Record<string, LiveQuote>;
  regime: MarketRegime | null;
  cryptoRegime: MarketRegime | null;
  outcomes: OutcomeEvent[];
  connected: boolean;
  lastQuoteAt: number;
}

export function useIntradayStream(enabled: boolean, onOutcome?: (ev: OutcomeEvent) => void): StreamState {
  const [livePrices, setLivePrices] = useState<Record<string, LiveQuote>>({});
  const [regime, setRegime] = useState<MarketRegime | null>(null);
  const [cryptoRegime, setCryptoRegime] = useState<MarketRegime | null>(null);
  const [outcomes, setOutcomes] = useState<OutcomeEvent[]>([]);
  const [connected, setConnected] = useState(false);
  const [lastQuoteAt, setLastQuoteAt] = useState(0);
  const outcomeCbRef = useRef(onOutcome);
  outcomeCbRef.current = onOutcome;

  useEffect(() => {
    if (!enabled) {
      setConnected(false);
      return;
    }
    let es: EventSource | null = null;
    let closed = false;

    try {
      es = new EventSource(`${PROXY_BASE}/api/intraday-stream`);
    } catch {
      return;
    }
    const src = es;

    src.onopen = () => { if (!closed) setConnected(true); };

    src.addEventListener('quotes', (e) => {
      if (closed) return;
      try {
        const data = JSON.parse((e as MessageEvent).data) as Record<string, LiveQuote>;
        setLivePrices(prev => ({ ...prev, ...data }));
        setLastQuoteAt(Date.now());
      } catch { /* malformed frame */ }
    });

    src.addEventListener('regime', (e) => {
      if (closed) return;
      try {
        setRegime(JSON.parse((e as MessageEvent).data) as MarketRegime);
      } catch { /* malformed frame */ }
    });

    src.addEventListener('crypto-regime', (e) => {
      if (closed) return;
      try {
        setCryptoRegime(JSON.parse((e as MessageEvent).data) as MarketRegime);
      } catch { /* malformed frame */ }
    });

    src.addEventListener('outcome', (e) => {
      if (closed) return;
      try {
        const ev = JSON.parse((e as MessageEvent).data) as OutcomeEvent;
        setOutcomes(prev => [ev, ...prev].slice(0, 30));
        outcomeCbRef.current?.(ev);
      } catch { /* malformed frame */ }
    });

    src.addEventListener('status', () => { if (!closed) setConnected(true); });

    src.onerror = () => {
      // EventSource auto-reconnects; just reflect the drop in the UI.
      if (!closed) setConnected(false);
    };

    return () => {
      closed = true;
      setConnected(false);
      try { src.close(); } catch { /* noop */ }
    };
  }, [enabled]);

  return { livePrices, regime, cryptoRegime, outcomes, connected, lastQuoteAt };
}
