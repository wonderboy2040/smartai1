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
import { getSessionToken, getProxyBase } from '../../utils/api';
import type { LiveQuote, MarketRegime, OutcomeEvent } from './types';

// v9.1 FIX: resolve the backend the SAME way apiFetch does (localStorage
// override → env → mirror-host detection) — the raw env-only read could
// point SSE at a different backend than every REST call. And append the
// ?session= token: /api/intraday-stream is NOT a public path, so a bare
// EventSource 401'd cross-origin (Vercel → Render can't send cookies) and
// the Paper Desk live P&L never ticked.
// v10.13 (deep-recheck M3/M5): the base is resolved LIVE inside the effect
// (a runtime backend switch used to leave the stream on the OLD server),
// and a sustained error streak now falls back to a capped manual reconnect
// that RE-READS the session token — an expired token otherwise left the
// browser auto-retrying the same doomed URL every ~3s for the session's
// lifetime while the tab degraded to 60s polling.

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
    let errStreak = 0;
    let manualRetryTimer: ReturnType<typeof setTimeout> | null = null;

    const buildUrl = () => {
      // SECURITY: EventSource cannot send the Bearer header, and httpOnly
      // cookies don't travel cross-origin — requireAuth accepts a
      // ?session=<token> query param for exactly this case (same pattern as
      // utils/liveStream.ts → /api/stream). Re-read FRESH every attempt so
      // a re-login heals the stream instead of looping 401s forever.
      const session = getSessionToken();
      const base = getProxyBase();
      return session
        ? `${base}/api/intraday-stream?session=${encodeURIComponent(session)}`
        : `${base}/api/intraday-stream`;
    };

    const connect = () => {
      if (closed || es) return;
      try {
        es = new EventSource(buildUrl());
      } catch {
        return;
      }
      attach(es);
    };

    const scheduleManualRetry = () => {
      if (closed || manualRetryTimer || es) return;
      const attempt = Math.min(errStreak - 5 + 1, 6);
      manualRetryTimer = setTimeout(() => {
        manualRetryTimer = null;
        connect();
      }, Math.min(60000, 5000 * attempt));
    };

    const attach = (src: EventSource) => {
      src.onopen = () => { if (!closed) { setConnected(true); errStreak = 0; } };

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
        // v10.13: after a SUSTAINED streak (6+ failures, no open), take
        // over with a capped manual backoff + freshly built URL (the
        // browser loop would otherwise retry a dead/expired token URL
        // every ~3s forever).
        if (closed) return;
        setConnected(false);
        errStreak++;
        if (errStreak >= 6) {
          try { src.close(); } catch { /* noop */ }
          if (es === src) es = null;
          scheduleManualRetry();
        }
      };
    };

    connect();

    return () => {
      closed = true;
      if (manualRetryTimer) clearTimeout(manualRetryTimer);
      try { es?.close(); } catch { /* noop */ }
      es = null;
    };
  }, [enabled]);

  return { livePrices, regime, cryptoRegime, outcomes, connected, lastQuoteAt };
}
