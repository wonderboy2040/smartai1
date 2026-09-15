import { PriceData } from '../types';
import { getSessionToken, getProxyBase } from './api';

// ============================================================
// liveStream — browser EventSource client for /api/stream (SSE)
// ------------------------------------------------------------
// Receives server-pushed real-time ticks (SSE from server — NSE/Finnhub/CoinDCX)
// and feeds them into the SAME price pipeline the pollers use.
// This replaces 2-second polling with instant push. If SSE drops, EventSource
// auto-reconnects, and the existing pollers still run as a safety net.
//
// v10.13 (deep-recheck H4): the client used to be blind to stream death.
// EventSource auto-reconnects on TRANSIENT errors, but:
//   1. onStatus only fired on server 'status' frames — a dead stream kept
//      the LAST healthy feedStatus in useAppState forever, so the crypto
//      watchdog stayed at 30s cadence and the sync loop kept skipping REST
//      batches while the header still showed every feed LIVE (silent 30s+
//      price degradation wearing a live badge).
//   2. On a FATAL error (401 expired ?session= token, 404, DNS) the browser
//      retries the SAME URL forever on its default interval — a tight
//      reconnect loop for the session's lifetime, with a token that can
//      never succeed again.
// Now: onerror immediately downgrades the feed status ({} = all feeds dark
// → pollers speed up honestly); a streak of failures without an open
// switches to MANUAL capped-backoff reconnects that REBUILD the URL (and
// re-read the session token) on every attempt.
// ============================================================

// Failure-streak thresholds (browser auto-reconnect is allowed to work for
// transient blips; a sustained failure means something is fatally wrong).
const ERR_STREAK_MANUAL = 6;     // ~6 failed reconnect cycles → take over manually
const MANUAL_RETRY_MIN_MS = 5000;
const MANUAL_RETRY_MAX_MS = 60000;

export interface LiveStreamOpts {
  inSymbols: string[];
  usSymbols: string[];
  cryptoSymbols: string[];
  onTick: (serverKey: string, data: Partial<PriceData>) => void;
  onStatus?: (status: Record<string, boolean>) => void;
}

function toPriceData(t: Record<string, unknown>): Partial<PriceData> {
  return {
    price: Number(t.price) || 0,
    change: typeof t.change === 'number' ? (t.change as number) : 0,
    high: t.high != null ? Number(t.high) : undefined,
    low: t.low != null ? Number(t.low) : undefined,
    volume: t.volume != null ? Number(t.volume) : undefined,
    time: Number(t.time) || Date.now(),
    prevClose: t.prevClose != null ? Number(t.prevClose) : undefined,
    // v10.12 (#1): the server labels every liveFeed write on the wire
    // (`source`) — carry it through so the India desk can badge Groww·live
    // vs Yahoo·delayed (and the other desks CoinDCX·RT / Finnhub·RT / …).
    // Unknown/missing stays undefined → LiveSourceBadge's neutral LIVE pill.
    src: typeof t.source === 'string' ? t.source : undefined,
    isRealtime: true,
  };
}

export function connectLiveStream(opts: LiveStreamOpts): () => void {
  let es: EventSource | null = null;
  let closed = false;
  let errStreak = 0;
  let manualRetryTimer: ReturnType<typeof setTimeout> | null = null;

  const buildUrl = (): string => {
    // v10.13: base AND token are resolved FRESH on every (re)connect — the
    // old module-load SSE_BASE froze the backend at bundle load, and the
    // token was baked in once (an expired 30-day token kept being retried).
    const params = new URLSearchParams();
    if (opts.inSymbols.length) params.set('in', opts.inSymbols.join(','));
    if (opts.usSymbols.length) params.set('us', opts.usSymbols.join(','));
    if (opts.cryptoSymbols.length) params.set('crypto', opts.cryptoSymbols.join(','));
    const sessionToken = getSessionToken();
    if (sessionToken) params.set('session', sessionToken);
    return `${getProxyBase()}/api/stream?${params.toString()}`;
  };

  const attach = (source: EventSource) => {
    source.addEventListener('snapshot', (e: MessageEvent) => {
      try {
        const map = JSON.parse(e.data) as Record<string, Record<string, unknown>>;
        Object.keys(map).forEach(k => opts.onTick(k, toPriceData(map[k])));
      } catch { /* ignore */ }
    });

    source.addEventListener('tick', (e: MessageEvent) => {
      try {
        const t = JSON.parse(e.data) as Record<string, unknown>;
        if (t.key) opts.onTick(String(t.key), toPriceData(t));
      } catch { /* ignore */ }
    });

    source.addEventListener('status', (e: MessageEvent) => {
      if (!opts.onStatus) return;
      try { opts.onStatus(JSON.parse(e.data)); } catch { /* ignore */ }
    });

    source.onopen = () => {
      errStreak = 0;
    };

    source.onerror = () => {
      if (closed) return;
      // (1) HONEST DOWNGRADE: the stream is down RIGHT NOW — clear the feed
      // status so pollers stop trusting stale "live" flags. The next
      // successful 'status' frame restores it.
      opts.onStatus?.({});
      errStreak++;
      // (2) TRANSIENT path: EventSource auto-reconnects (readyState
      // CONNECTING) and onopen resets the streak — blips self-heal. A
      // SUSTAINED streak (6+ failures without a single open — network down,
      // 401 expired token, 404, DNS) means the browser's tight default retry
      // loop on the SAME stale URL will never succeed: take over with a
      // capped manual backoff that REBUILDS the URL (fresh base + fresh
      // session token) on every attempt.
      if (errStreak >= ERR_STREAK_MANUAL) {
        try { source.close(); } catch { /* noop */ }
        if (es === source) es = null;
        scheduleManualRetry();
      }
    };
  };

  const scheduleManualRetry = () => {
    if (closed || manualRetryTimer || es) return;
    // Capped exponential-ish backoff, 5s → 60s.
    const attempt = Math.min(errStreak - ERR_STREAK_MANUAL + 1, 6);
    const delay = Math.min(MANUAL_RETRY_MAX_MS, MANUAL_RETRY_MIN_MS * attempt);
    manualRetryTimer = setTimeout(() => {
      manualRetryTimer = null;
      if (closed) return;
      connect();
    }, delay);
  };

  const connect = () => {
    if (closed || es) return;
    // No symbols + no token → nothing to stream (pollers own the app).
    if (!opts.inSymbols.length && !opts.usSymbols.length && !opts.cryptoSymbols.length) return;
    try {
      es = new EventSource(buildUrl());
    } catch {
      return; // EventSource unsupported → pollers keep the app live
    }
    attach(es);
  };

  connect();

  return () => {
    closed = true;
    if (manualRetryTimer) { clearTimeout(manualRetryTimer); manualRetryTimer = null; }
    if (es) { try { es.close(); } catch { /* noop */ } es = null; }
  };
}
