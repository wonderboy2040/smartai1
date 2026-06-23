import { PriceData } from '../types';
import { API_URL as VITE_API_URL } from './constants';

// ============================================================
// liveStream — browser EventSource client for /api/stream (SSE)
// ------------------------------------------------------------
// Receives server-pushed real-time ticks (AngelOne NSE ws, Finnhub US ws,
// CoinDCX crypto) and feeds them into the SAME price pipeline the pollers use.
// This replaces 2-second polling with instant push. If SSE drops, EventSource
// auto-reconnects, and the existing pollers still run as a safety net.
// ============================================================

let _apiBase: string | null = null;
async function resolveBase(): Promise<string> {
  if (_apiBase !== null) return _apiBase;
  let base = VITE_API_URL || '';
  try {
    const res = await fetch('/api/config', { signal: AbortSignal.timeout(3000) });
    if (res.ok) {
      const cfg = await res.json();
      if (cfg.apiUrl) base = cfg.apiUrl;
    }
  } catch { /* same-origin */ }
  _apiBase = base;
  return base;
}

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
  };
}

export function connectLiveStream(opts: LiveStreamOpts): () => void {
  let es: EventSource | null = null;
  let closed = false;

  (async () => {
    const base = await resolveBase();
    if (closed) return;
    const params = new URLSearchParams();
    if (opts.inSymbols.length) params.set('in', opts.inSymbols.join(','));
    if (opts.usSymbols.length) params.set('us', opts.usSymbols.join(','));
    if (opts.cryptoSymbols.length) params.set('crypto', opts.cryptoSymbols.join(','));
    if (![...params.keys()].length) return;

    try {
      es = new EventSource(`${base}/api/stream?${params.toString()}`);
    } catch {
      return; // EventSource unsupported → pollers keep the app live
    }

    es.addEventListener('snapshot', (e: MessageEvent) => {
      try {
        const map = JSON.parse(e.data) as Record<string, Record<string, unknown>>;
        Object.keys(map).forEach(k => opts.onTick(k, toPriceData(map[k])));
      } catch { /* ignore */ }
    });

    es.addEventListener('tick', (e: MessageEvent) => {
      try {
        const t = JSON.parse(e.data) as Record<string, unknown>;
        if (t.key) opts.onTick(String(t.key), toPriceData(t));
      } catch { /* ignore */ }
    });

    es.addEventListener('status', (e: MessageEvent) => {
      if (!opts.onStatus) return;
      try { opts.onStatus(JSON.parse(e.data)); } catch { /* ignore */ }
    });
    // EventSource reconnects automatically on transient errors.
  })();

  return () => { closed = true; if (es) { try { es.close(); } catch { /* noop */ } } };
}
