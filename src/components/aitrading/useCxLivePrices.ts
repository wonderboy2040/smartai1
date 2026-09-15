// ============================================================
// src/components/aitrading/useCxLivePrices.ts — v10.10
// ------------------------------------------------------------
// THE BUG: the CoinDCX tab's three desks (SPOT / GLOBAL FUTURES /
// EQUITY SIM USDC) rendered `signal.ltp` — a snapshot baked at
// board-generation time (server board cache 60-90s + upstream
// price caches up to 20s + frontend 30s poll). A "fresh" signal
// card could sit next to a price that was minutes old → wrong
// calls, wrong entries, wrong P&L intuition ("wrong signal show
// ho raha hai").
//
// THE FIX: one EventSource to /api/stream carrying all THREE
// CoinDCX domains in a single connection:
//   crypto=BTC,ETH,…   SPOT INR   (IN_ keys — 2s CoinDCX anchor
//                                  + ~1s Binance WS accelerator)
//   fut=BTC,SOL,…      USDT perps (FUT_ keys — v10.10 cxRtStream,
//                                  2s DIRECT CoinDCX RT)
//   glob=AAPL,NVDA,…   USDC perps (GLOB_ keys — 2s direct RT,
//                                  Yahoo fallback 10s)
//
// Render hygiene (the reason this is not a naive setState-per-tick):
//   • incoming ticks buffer in a ref; ONE batched flush every 800ms
//     → ≤1.25 renders/sec for the WHOLE desk instead of 10-20/sec
//   • document.hidden → flushes pause (zero background renders);
//     visibilitychange → instant flush so the tab paints live again
//   • EventSource auto-reconnects; status: 'live' | 'connecting' |
//     'down' for the command-bar honesty chip
// ============================================================
import { useCallback, useEffect, useState } from 'react';
import { getProxyBase, getSessionToken } from '../../utils/api';

export interface CxLiveTick {
  price: number;
  change: number;
  high?: number;
  low?: number;
  volume?: number;
  time: number;
}

export type CxLiveStatus = 'connecting' | 'live' | 'down';

const FLUSH_MS = 800;
const MAX_SYMS_PER_DOMAIN = 40; // parseSyms server-cap is 60; stay polite

function cleanList(list: string[] | undefined | null): string[] {
  if (!Array.isArray(list)) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of list) {
    const s = String(raw || '').trim().toUpperCase();
    if (!s || seen.has(s)) continue;
    seen.add(s);
    out.push(s);
    if (out.length >= MAX_SYMS_PER_DOMAIN) break;
  }
  return out;
}

function toTick(t: Record<string, unknown>): CxLiveTick | null {
  const price = Number(t.price);
  if (!(price > 0)) return null;
  return {
    price,
    change: typeof t.change === 'number' ? t.change : 0,
    high: t.high != null ? Number(t.high) : undefined,
    low: t.low != null ? Number(t.low) : undefined,
    volume: t.volume != null ? Number(t.volume) : undefined,
    time: Number(t.time) || Date.now(),
  };
}

export function useCxLivePrices(active: boolean, spot: string[], fut: string[], glob: string[]) {
  const [ticks, setTicks] = useState<Record<string, CxLiveTick>>({});
  const [status, setStatus] = useState<CxLiveStatus>('connecting');
  const [lastAt, setLastAt] = useState(0);

  const spotKey = cleanList(spot).join(',');
  const futKey = cleanList(fut).join(',');
  const globKey = cleanList(glob).join(',');

  useEffect(() => {
    if (!active) return;
    if (!spotKey && !futKey && !globKey) return; // nothing to watch yet

    const params = new URLSearchParams();
    if (spotKey) params.set('crypto', spotKey);
    if (futKey) params.set('fut', futKey);
    if (globKey) params.set('glob', globKey);
    // SECURITY: EventSource can't send headers cross-origin — the server's
    // auth middleware accepts ?session=<token> as the SSE fallback.
    const session = getSessionToken();
    if (session) params.set('session', session);

    let es: EventSource | null = null;
    try {
      es = new EventSource(`${getProxyBase()}/api/stream?${params.toString()}`);
    } catch {
      setStatus('down');
      return;
    }
    const src = es;

    // ---- buffered ingestion (the render-storm guard) ----
    const buffer = new Map<string, CxLiveTick>();
    let dirty = false;
    const flush = () => {
      if (!dirty || document.hidden) return; // background tab → zero renders
      dirty = false;
      const incoming = new Map(buffer);
      setTicks(prev => {
        const next = { ...prev };
        for (const [k, v] of incoming) next[k] = v;
        return next;
      });
      setLastAt(Date.now());
    };
    const flushTimer = setInterval(flush, FLUSH_MS);
    const onVis = () => { if (!document.hidden) flush(); };
    document.addEventListener('visibilitychange', onVis);

    const ingest = (key: string, raw: Record<string, unknown>) => {
      const t = toTick(raw);
      if (!t) return;
      buffer.set(key, t);
      dirty = true;
    };

    src.onopen = () => setStatus('live');
    src.onerror = () => setStatus('down');
    src.addEventListener('snapshot', (e: MessageEvent) => {
      try {
        const map = JSON.parse(e.data) as Record<string, Record<string, unknown>>;
        for (const [k, v] of Object.entries(map)) ingest(k, v);
        flush(); // first paint — don't wait the 800ms
      } catch { /* malformed frame */ }
    });
    src.addEventListener('tick', (e: MessageEvent) => {
      try {
        const t = JSON.parse(e.data) as Record<string, unknown>;
        if (t && typeof t.key === 'string') ingest(t.key, t as Record<string, unknown>);
      } catch { /* malformed frame */ }
    });

    return () => {
      clearInterval(flushTimer);
      document.removeEventListener('visibilitychange', onVis);
      try { src.close(); } catch { /* noop */ }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, spotKey, futKey, globKey]);

  /** Live tick lookup for a signal: market → key namespace. */
  const forSignal = useCallback((market: string, symbol: string): CxLiveTick | null => {
    const sym = String(symbol || '').trim().toUpperCase();
    if (!sym) return null;
    const key = market === 'FUTURES' ? `FUT_${sym}` : market === 'GLOBALFUTURES' ? `GLOB_${sym}` : `IN_${sym}`;
    return ticks[key] || null;
  }, [ticks]);

  return { ticks, status, lastAt, forSignal };
}
