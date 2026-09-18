// ============================================================
// StaticMirrorBanner — "backend API kahan hai?" guard.
// ------------------------------------------------------------
// Vercel/static mirrors serve the frontend WITHOUT the Express
// server: login, portfolio sync, INDMoney/CoinDCX connect — ALL
// /api calls 404 with a body-less "Connect failed (404)"-style
// error. This banner detects that state at runtime and tells the
// user exactly what to do (open the real deployment).
//
// v4.4 FALSE-POSITIVE FIX (user-reported banner on the REAL Render
// deployment while everything worked):
//   1. The single 9s /health probe raced the free-tier COLD BOOT
//      (30-50s) → banner declared the backend dead before it woke.
//   2. Once shown, it NEVER re-probed automatically — only the
//      Retry button cleared it.
// Now: 3 escalating attempts before declaring 'down', ANY
// successful /api round-trip (apiFetch dispatches the throttled
// global 'backend-online' event) instantly hides the banner, and
// while 'down' it keeps re-probing every 30s so a waking backend
// clears it on its own.
// ============================================================
import React, { useCallback, useEffect, useRef, useState } from 'react';

const REAL_APP_URL = 'https://smartai-e954.onrender.com';
const PROBE_ATTEMPTS = [
  { timeout: 9000, backoff: 4000 },   // fast first try
  { timeout: 14000, backoff: 6000 },  // cold boot can be slow
  { timeout: 20000, backoff: 0 },     // final patience
];
const DOWN_REPROBE_MS = 30 * 1000;    // auto re-probe while the banner is up

type ProbeState = 'checking' | 'ok' | 'down';

async function probeBackendOnce(timeoutMs: number): Promise<boolean> {
  // /health is in the server's PUBLIC_PATHS: unauthenticated, cheap,
  // always application/json on a real deployment. A static mirror
  // answers 404 + HTML ("The page could not be found"); a sleeping
  // free-tier backend just takes a few seconds and then answers 200.
  const res = await fetch('/health', {
    signal: AbortSignal.timeout(timeoutMs),
    cache: 'no-store',
    headers: { Accept: 'application/json' },
  });
  if (!res.ok) return false;
  const ct = res.headers.get('content-type') || '';
  if (!ct.includes('json')) return false;
  const body = await res.json().catch(() => null);
  return !!(body && typeof body === 'object' && 'ok' in body);
}

async function probeBackend(): Promise<boolean> {
  // Escalating attempts — a cold free-tier dyno regularly takes >9s on
  // the FIRST hit; the banner must not call it dead before that.
  for (const { timeout, backoff } of PROBE_ATTEMPTS) {
    try {
      if (await probeBackendOnce(timeout)) return true;
    } catch { /* timeout / network — try the next, longer window */ }
    if (backoff > 0) await new Promise(r => setTimeout(r, backoff));
  }
  return false;
}

export const StaticMirrorBanner = React.memo(function StaticMirrorBanner() {
  const [state, setState] = useState<ProbeState>('checking');
  const mountedRef = useRef(true);
  const stateRef = useRef<ProbeState>('checking');
  stateRef.current = state;

  const run = useCallback(async () => {
    setState('checking');
    const ok = await probeBackend();
    if (mountedRef.current) setState(ok ? 'ok' : 'down');
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    void run();

    // REAL-TRAFFIC LIFELINE: apiFetch dispatches 'backend-online' on ANY
    // successful API call (login, config, prices…). If real traffic works,
    // the backend is obviously reachable — no matter what /health said.
    const onOnline = () => { if (mountedRef.current) setState('ok'); };
    window.addEventListener('backend-online', onOnline);

    // AUTO RE-PROBE: while 'down', keep checking every 30s so a waking /
    // redeploying backend clears the banner without user action.
    const retry = window.setInterval(() => {
      if (mountedRef.current && stateRef.current === 'down') void run();
    }, DOWN_REPROBE_MS);

    return () => {
      mountedRef.current = false;
      window.removeEventListener('backend-online', onOnline);
      clearInterval(retry);
    };
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
      <span className="text-[9px] font-normal text-red-300/60">auto re-check 30s</span>
    </div>
  );
});

export default StaticMirrorBanner;
