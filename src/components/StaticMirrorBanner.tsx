// ============================================================
// StaticMirrorBanner — "backend API kahan hai?" guard.
// ------------------------------------------------------------
// Vercel/static mirrors serve the frontend WITHOUT the Express
// server: login, portfolio sync, INDMoney/CoinDCX connect — ALL
// /api calls 404 with a body-less "Connect failed (404)"-style
// error. This banner detects that state at runtime by probing a
// PUBLIC, always-JSON endpoint (/health) and tells the user
// exactly what to do (open the real deployment).
//
// Complements the index.html vercel.app redirect: the redirect
// handles known mirrors; this banner covers everything else
// (any static host, file://, a dead backend, etc).
// ============================================================
import React, { useCallback, useEffect, useRef, useState } from 'react';

const REAL_APP_URL = 'https://smartai-e954.onrender.com';

type ProbeState = 'checking' | 'ok' | 'down';

async function probeBackend(): Promise<boolean> {
  // /health is in the server's PUBLIC_PATHS: unauthenticated, cheap,
  // always application/json on a real deployment. A static mirror
  // answers 404 + HTML ("The page could not be found"); a sleeping
  // free-tier backend just takes a few seconds and then answers 200.
  const res = await fetch('/health', {
    signal: AbortSignal.timeout(9000),
    cache: 'no-store',
    headers: { Accept: 'application/json' },
  });
  if (!res.ok) return false;
  const ct = res.headers.get('content-type') || '';
  if (!ct.includes('json')) return false;
  const body = await res.json().catch(() => null);
  return !!(body && typeof body === 'object' && 'ok' in body);
}

export const StaticMirrorBanner = React.memo(function StaticMirrorBanner() {
  const [state, setState] = useState<ProbeState>('checking');
  const mountedRef = useRef(true);

  const run = useCallback(async () => {
    setState('checking');
    try {
      const ok = await probeBackend();
      if (mountedRef.current) setState(ok ? 'ok' : 'down');
    } catch {
      if (mountedRef.current) setState('down');
    }
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    void run();
    return () => { mountedRef.current = false; };
  }, [run]);

  if (state !== 'down') return null;

  return (
    <div className="fixed top-0 inset-x-0 z-[100] bg-red-950/95 border-b border-red-500/40 backdrop-blur text-red-200 text-[11px] sm:text-xs px-3 py-2 flex flex-wrap items-center justify-center gap-x-3 gap-y-1 font-semibold shadow-lg shadow-red-950/50">
      <span>⚠️ Backend API server not reachable — ye static mirror hai (login / sync / CoinDCX connect sab fail honge).</span>
      <a
        href={REAL_APP_URL}
        target="_blank"
        rel="noreferrer"
        className="underline font-bold text-red-100 hover:text-white"
      >
        Real app yahan kholo ↗
      </a>
      <button
        onClick={() => void run()}
        className="px-2 py-0.5 rounded bg-red-500/20 border border-red-500/40 hover:bg-red-500/40 text-[10px] uppercase tracking-wider transition-colors"
        title="Re-check the backend (a sleeping free-tier server can take ~30s to wake)"
      >
        Retry
      </button>
    </div>
  );
});

export default StaticMirrorBanner;
