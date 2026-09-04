// ============================================================
// src/components/aitrading/useAITrading.ts — data hook
// ------------------------------------------------------------
// Polls the /api/ai/* endpoints on a staggered cadence and exposes
// execute / config / kill-switch / close actions with honest
// loading + error states. Signals refresh every 30s (active tab
// only), positions every 45s, options desk on demand per index.
// ============================================================
import { useCallback, useEffect, useRef, useState } from 'react';
import { apiFetch, getProxyBase } from '../../utils/api';
import type { AISignal, OptionsDesk, SignalBoard, TradingState, JournalPosition, JournalEntry, BacktestResult, AlertsStatus, DhanStatus } from './types';

export interface DeepSignalResult {
  ok: boolean;
  signal?: AISignal;
  indicators?: Record<string, unknown>;
  priceSource?: string | null;
  error?: string;
}

export interface ExecuteResult {
  ok: boolean;
  error?: string;
  mode?: string;
  orderId?: string | null;
  filled?: { qty: number; price: number; notionalINR: number; leverage?: number; marginINR?: number };
  position?: JournalPosition;
  /** v6.4: set when the ATR stop was auto-fitted to the risk cap. */
  fitted?: string;
}

/** v6.6: sizing + leverage parameters for a ticket execute. */
export interface ExecuteOpts {
  /** crypto: the MARGIN you commit (₹); india: the capital budget (₹) */
  qtyINR?: number;
  /** crypto only — clamped server-side to config.cryptoLeverage */
  leverage?: number;
}

export function useAITrading(active: boolean) {
  const [india, setIndia] = useState<SignalBoard | null>(null);
  const [crypto, setCrypto] = useState<SignalBoard | null>(null);
  const [state, setState] = useState<TradingState | null>(null);
  const [positions, setPositions] = useState<JournalPosition[]>([]);
  const [entries, setEntries] = useState<JournalEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const activeRef = useRef(active);
  activeRef.current = active;

  const loadBoards = useCallback(async () => {
    const [i, c] = await Promise.allSettled([
      apiFetch(`${getProxyBase()}/api/ai/signals?market=INDIA&limit=10&t=${Date.now()}`, { signal: AbortSignal.timeout(30000) }),
      apiFetch(`${getProxyBase()}/api/ai/signals?market=CRYPTO&limit=10&t=${Date.now()}`, { signal: AbortSignal.timeout(30000) }),
    ]);
    if (i.status === 'fulfilled' && i.value.ok) {
      try { setIndia(await i.value.json()); } catch { /* skip */ }
    }
    if (c.status === 'fulfilled' && c.value.ok) {
      try { setCrypto(await c.value.json()); } catch { /* skip */ }
    }
    setLoading(false);
  }, []);

  const loadState = useCallback(async () => {
    try {
      const r = await apiFetch(`${getProxyBase()}/api/ai/trading/state?t=${Date.now()}`, { signal: AbortSignal.timeout(10000) });
      if (r.ok) setState(await r.json());
    } catch { /* skip */ }
  }, []);

  const loadPositions = useCallback(async () => {
    try {
      const r = await apiFetch(`${getProxyBase()}/api/ai/positions?t=${Date.now()}`, { signal: AbortSignal.timeout(15000) });
      if (r.ok) {
        const j = await r.json();
        setPositions(Array.isArray(j.positions) ? j.positions : []);
        setEntries(Array.isArray(j.entries) ? j.entries : []);
      }
    } catch { /* skip */ }
  }, []);

  // Boot + staggered polling (active tab only — background tabs cost zero).
  useEffect(() => {
    if (!active) return;
    loadBoards();
    loadState();
    loadPositions();
    const b = setInterval(() => { if (activeRef.current && !document.hidden) loadBoards(); }, 30_000);
    const s = setInterval(() => { if (activeRef.current && !document.hidden) loadState(); }, 60_000);
    const p = setInterval(() => { if (activeRef.current && !document.hidden) loadPositions(); }, 45_000);
    return () => { clearInterval(b); clearInterval(s); clearInterval(p); };
  }, [active, loadBoards, loadState, loadPositions]);

  const executeSignal = useCallback(async (signal: AISignal, mode: 'paper' | 'live', opts?: ExecuteOpts): Promise<ExecuteResult> => {
    setBusy(true);
    try {
      const r = await apiFetch(`${getProxyBase()}/api/ai/execute`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          symbol: signal.symbol, side: signal.side, mode,
          ...(opts?.qtyINR != null ? { qtyINR: opts.qtyINR } : {}),
          ...(opts?.leverage != null ? { leverage: opts.leverage } : {}),
        }),
        signal: AbortSignal.timeout(40000),
      });
      const j = await r.json().catch(() => ({ ok: false, error: 'bad response' }));
      loadPositions(); loadState();
      return j;
    } catch (e) {
      return { ok: false, error: String((e as Error)?.message || e) };
    } finally { setBusy(false); }
  }, [loadPositions, loadState]);

  const updateConfig = useCallback(async (patch: Record<string, unknown>): Promise<{ ok: boolean; error?: string }> => {
    setBusy(true);
    try {
      const r = await apiFetch(`${getProxyBase()}/api/ai/trading/config`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patch),
        signal: AbortSignal.timeout(15000),
      });
      const j = await r.json().catch(() => ({ ok: false, error: 'bad response' }));
      if (j.ok) loadState();
      return j;
    } catch (e) {
      return { ok: false, error: String((e as Error)?.message || e) };
    } finally { setBusy(false); }
  }, [loadState]);

  const killSwitch = useCallback(async (enabled: boolean) => updateConfig({ killSwitch: enabled }), [updateConfig]);

  const closePos = useCallback(async (id: string): Promise<{ ok: boolean; error?: string }> => {
    setBusy(true);
    try {
      const r = await apiFetch(`${getProxyBase()}/api/ai/positions/close`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id }),
        signal: AbortSignal.timeout(20000),
      });
      const j = await r.json().catch(() => ({ ok: false, error: 'bad response' }));
      loadPositions(); loadState();
      return j;
    } catch (e) {
      return { ok: false, error: String((e as Error)?.message || e) };
    } finally { setBusy(false); }
  }, [loadPositions, loadState]);

  // v6.3 PRO: deep single-symbol analysis (every model vote, fresh run,
  // AI Council note) — powers the 🔬 button on each signal card.
  const fetchDeep = useCallback(async (symbol: string, market: 'INDIA' | 'CRYPTO'): Promise<DeepSignalResult> => {
    try {
      const r = await apiFetch(`${getProxyBase()}/api/ai/deep/${encodeURIComponent(symbol)}?market=${market}&t=${Date.now()}`, {
        signal: AbortSignal.timeout(40000),
      });
      const j = await r.json().catch(() => ({ ok: false, error: 'bad response' }));
      return j;
    } catch (e) {
      return { ok: false, error: String((e as Error)?.message || e) };
    }
  }, []);

  // v6.5: India gauntlet execution (Dhan paper/live) — same flow shape
  // as the crypto execute so the cards can share one handler.
  const executeIndia = useCallback(async (signal: AISignal, mode: 'paper' | 'live', opts?: ExecuteOpts): Promise<ExecuteResult> => {
    setBusy(true);
    try {
      const r = await apiFetch(`${getProxyBase()}/api/ai/india/execute`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ symbol: signal.symbol, side: signal.side, mode, ...(opts?.qtyINR != null ? { qtyINR: opts.qtyINR } : {}) }),
        signal: AbortSignal.timeout(40000),
      });
      const j = await r.json().catch(() => ({ ok: false, error: 'bad response' }));
      loadPositions(); loadState();
      return j;
    } catch (e) {
      return { ok: false, error: String((e as Error)?.message || e) };
    } finally { setBusy(false); }
  }, [loadPositions, loadState]);

  // v6.5: walk-forward backtest (per desk).
  const runBacktest = useCallback(async (market: 'INDIA' | 'CRYPTO', minGrade = 'ACTION'): Promise<BacktestResult | null> => {
    try {
      const r = await apiFetch(`${getProxyBase()}/api/ai/backtest?market=${market}&minGrade=${minGrade}&t=${Date.now()}`, {
        signal: AbortSignal.timeout(90000),
      });
      if (!r.ok) return null;
      return await r.json();
    } catch { return null; }
  }, []);

  // v6.5: alerts + AI council keys.
  const fetchAlertsStatus = useCallback(async (): Promise<AlertsStatus | null> => {
    try {
      const r = await apiFetch(`${getProxyBase()}/api/ai/alerts/config?t=${Date.now()}`, { signal: AbortSignal.timeout(10000) });
      if (!r.ok) return null;
      return await r.json();
    } catch { return null; }
  }, []);

  const saveAlertsConfig = useCallback(async (patch: Record<string, string | null>): Promise<{ ok: boolean; error?: string; status?: AlertsStatus['status'] }> => {
    setBusy(true);
    try {
      const r = await apiFetch(`${getProxyBase()}/api/ai/alerts/config`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patch),
        signal: AbortSignal.timeout(15000),
      });
      return await r.json().catch(() => ({ ok: false, error: 'bad response' }));
    } catch (e) {
      return { ok: false, error: String((e as Error)?.message || e) };
    } finally { setBusy(false); }
  }, []);

  const testAlert = useCallback(async (): Promise<{ ok: boolean; error?: string }> => {
    setBusy(true);
    try {
      const r = await apiFetch(`${getProxyBase()}/api/ai/alerts/test`, { method: 'POST', signal: AbortSignal.timeout(20000) });
      return await r.json().catch(() => ({ ok: false, error: 'bad response' }));
    } catch (e) {
      return { ok: false, error: String((e as Error)?.message || e) };
    } finally { setBusy(false); }
  }, []);

  // v6.5: Dhan broker connect/status.
  const fetchDhanStatus = useCallback(async (): Promise<DhanStatus | null> => {
    try {
      const r = await apiFetch(`${getProxyBase()}/api/ai/dhan/status?t=${Date.now()}`, { signal: AbortSignal.timeout(15000) });
      if (!r.ok) return null;
      return await r.json();
    } catch { return null; }
  }, []);

  const dhanConnect = useCallback(async (clientId: string, accessToken: string): Promise<{ ok: boolean; error?: string }> => {
    setBusy(true);
    try {
      const r = await apiFetch(`${getProxyBase()}/api/ai/dhan/connect`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ clientId, accessToken }),
        signal: AbortSignal.timeout(45000),
      });
      const j = await r.json().catch(() => ({ ok: false, error: 'bad response' }));
      if (j.ok) loadState();
      return j;
    } catch (e) {
      return { ok: false, error: String((e as Error)?.message || e) };
    } finally { setBusy(false); }
  }, [loadState]);

  const dhanDisconnect = useCallback(async (): Promise<{ ok: boolean; error?: string }> => {
    setBusy(true);
    try {
      const r = await apiFetch(`${getProxyBase()}/api/ai/dhan/disconnect`, { method: 'POST', signal: AbortSignal.timeout(15000) });
      const j = await r.json().catch(() => ({ ok: false, error: 'bad response' }));
      if (j.ok) loadState();
      return j;
    } catch (e) {
      return { ok: false, error: String((e as Error)?.message || e) };
    } finally { setBusy(false); }
  }, [loadState]);

  return {
    india, crypto, state, positions, entries, loading, busy,
    refresh: loadBoards, executeSignal, updateConfig, killSwitch, closePos, fetchDeep,
    executeIndia, runBacktest, fetchAlertsStatus, saveAlertsConfig, testAlert,
    fetchDhanStatus, dhanConnect, dhanDisconnect,
  };
}

// Options desk fetch (per-index, on demand with 60s client cache).
const deskCache = new Map<string, { at: number; data: OptionsDesk }>();
export async function fetchOptionsDesk(symbol: string, force = false): Promise<OptionsDesk | null> {
  const hit = deskCache.get(symbol);
  if (!force && hit && Date.now() - hit.at < 60_000) return hit.data;
  try {
    const r = await apiFetch(`${getProxyBase()}/api/ai/options?symbol=${symbol}&t=${Date.now()}`, { signal: AbortSignal.timeout(30000) });
    if (!r.ok) return hit?.data || null;
    const data = await r.json();
    deskCache.set(symbol, { at: Date.now(), data });
    return data;
  } catch { return hit?.data || null; }
}
