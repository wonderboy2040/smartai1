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
import type { AISignal, OptionsDesk, SignalBoard, TradingState, JournalPosition, JournalEntry, BacktestResult, AlertsStatus, DhanStatus, SwingBoard, WhaleRadar, LedgerView, MorningBrief, OrderbookView, AgentView, WalletView, FuturesMarketsView, MarketKind, TrustView, PerfView, CorrView, SectorView, IncomeView, NextActionsView, NarrativeView } from './types';

export interface DeepSignalResult {
  ok: boolean;
  signal?: AISignal;
  indicators?: Record<string, unknown>;
  /** v6.11: rule-based regime story (glama explain_ticker). */
  narrative?: NarrativeView | null;
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

export function useAITrading(active: boolean, scope?: { markets?: Array<'INDIA' | 'CRYPTO' | 'FUTURES'> }) {
  // v6.9: market-scoped loading — the India desk only pays for the India
  // board; the CoinDCX desk loads spot + futures. Default = all (legacy).
  const markets = scope?.markets ?? ['INDIA', 'CRYPTO', 'FUTURES'];
  const [india, setIndia] = useState<SignalBoard | null>(null);
  const [crypto, setCrypto] = useState<SignalBoard | null>(null);
  const [futures, setFutures] = useState<SignalBoard | null>(null);
  const [state, setState] = useState<TradingState | null>(null);
  const [positions, setPositions] = useState<JournalPosition[]>([]);
  const [entries, setEntries] = useState<JournalEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const activeRef = useRef(active);
  activeRef.current = active;

  const loadBoards = useCallback(async () => {
    const jobs: Array<Promise<void>> = [];
    if (markets.includes('INDIA')) jobs.push(apiFetch(`${getProxyBase()}/api/ai/signals?market=INDIA&limit=10&t=${Date.now()}`, { signal: AbortSignal.timeout(30000) })
      .then(r => r.ok ? r.json() : null).catch(() => null)
      .then(j => { if (j) setIndia(j); }));
    if (markets.includes('CRYPTO')) jobs.push(apiFetch(`${getProxyBase()}/api/ai/signals?market=CRYPTO&limit=10&t=${Date.now()}`, { signal: AbortSignal.timeout(30000) })
      .then(r => r.ok ? r.json() : null).catch(() => null)
      .then(j => { if (j) setCrypto(j); }));
    if (markets.includes('FUTURES')) jobs.push(apiFetch(`${getProxyBase()}/api/ai/signals?market=FUTURES&limit=10&t=${Date.now()}`, { signal: AbortSignal.timeout(30000) })
      .then(r => r.ok ? r.json() : null).catch(() => null)
      .then(j => { if (j) setFutures(j); }));
    await Promise.allSettled(jobs);
    setLoading(false);
  }, [markets.join(',')]); // eslint-disable-line react-hooks/exhaustive-deps

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

  const executeSignal = useCallback(async (signal: AISignal, mode: 'paper' | 'live' | 'notify', opts?: ExecuteOpts): Promise<ExecuteResult> => {
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
  const fetchDeep = useCallback(async (symbol: string, market: 'INDIA' | 'CRYPTO' | 'FUTURES'): Promise<DeepSignalResult> => {
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
  const executeIndia = useCallback(async (signal: AISignal, mode: 'paper' | 'live' | 'notify', opts?: ExecuteOpts): Promise<ExecuteResult> => {
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

  // v6.8: GLOBAL FUTURES gauntlet execution (CoinDCX USDT perps).
  const executeFutures = useCallback(async (signal: AISignal, mode: 'paper' | 'live' | 'notify', opts?: { qtyINR?: number; marginUSDT?: number; leverage?: number }): Promise<ExecuteResult> => {
    setBusy(true);
    try {
      const r = await apiFetch(`${getProxyBase()}/api/ai/futures/execute`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          symbol: signal.symbol, side: signal.side, mode,
          ...(opts?.qtyINR != null ? { qtyINR: opts.qtyINR } : {}),
          ...(opts?.marginUSDT != null ? { marginUSDT: opts.marginUSDT } : {}),
          ...(opts?.leverage != null ? { leverage: opts.leverage } : {}),
        }),
        signal: AbortSignal.timeout(45000),
      });
      const j = await r.json().catch(() => ({ ok: false, error: 'bad response' }));
      loadPositions(); loadState();
      return j;
    } catch (e) {
      return { ok: false, error: String((e as Error)?.message || e) };
    } finally { setBusy(false); }
  }, [loadPositions, loadState]);

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
    india, crypto, futures, state, positions, entries, loading, busy,
    refresh: loadBoards, executeSignal, updateConfig, killSwitch, closePos, fetchDeep,
    executeIndia, runBacktest, fetchAlertsStatus, saveAlertsConfig, testAlert,
    fetchDhanStatus, dhanConnect, dhanDisconnect, executeFutures,
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

// ---------------- v6.7: swing · whales · ledger · brief · orderbook ----------------
export async function fetchSwingBoard(market: MarketKind): Promise<SwingBoard | null> {
  const m = market === 'INDIA' ? 'INDIA' : 'CRYPTO'; // futures → underlying crypto desk
  try {
    const r = await apiFetch(`${getProxyBase()}/api/ai/swing?market=${m}&t=${Date.now()}`, { signal: AbortSignal.timeout(30000) });
    if (!r.ok) return null;
    return await r.json();
  } catch { return null; }
}

export async function fetchWhales(market: MarketKind): Promise<WhaleRadar | null> {
  const m = market === 'INDIA' ? 'INDIA' : 'CRYPTO'; // futures → underlying crypto desk
  try {
    const r = await apiFetch(`${getProxyBase()}/api/ai/whales?market=${m}&t=${Date.now()}`, { signal: AbortSignal.timeout(30000) });
    if (!r.ok) return null;
    return await r.json();
  } catch { return null; }
}

export async function fetchLedger(limit = 20): Promise<LedgerView | null> {
  try {
    const r = await apiFetch(`${getProxyBase()}/api/ai/ledger?limit=${limit}&t=${Date.now()}`, { signal: AbortSignal.timeout(15000) });
    if (!r.ok) return null;
    return await r.json();
  } catch { return null; }
}

export async function fetchMorningBrief(): Promise<MorningBrief | null> {
  try {
    const r = await apiFetch(`${getProxyBase()}/api/ai/brief?t=${Date.now()}`, { signal: AbortSignal.timeout(45000) });
    if (!r.ok) return null;
    return await r.json();
  } catch { return null; }
}

export async function fetchOrderbook(symbol: string): Promise<OrderbookView | null> {
  try {
    const r = await apiFetch(`${getProxyBase()}/api/ai/orderbook?symbol=${symbol}&t=${Date.now()}`, { signal: AbortSignal.timeout(15000) });
    // 502 with an honest error payload is still a displayable view
    return await r.json().catch(() => null);
  } catch { return null; }
}

// ---------------- v6.8: agent · wallet · futures markets ----------------
export async function fetchAgentStatus(): Promise<AgentView | null> {
  try {
    const r = await apiFetch(`${getProxyBase()}/api/ai/agent?t=${Date.now()}`, { signal: AbortSignal.timeout(45000) });
    if (!r.ok) return null;
    return await r.json();
  } catch { return null; }
}

export async function startAgent(mode: 'paper' | 'live' | 'notify', liveConfirmPhrase?: string): Promise<{ ok: boolean; error?: string }> {
  try {
    const r = await apiFetch(`${getProxyBase()}/api/ai/agent/start`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mode, ...(mode === 'live' && liveConfirmPhrase ? { liveConfirmPhrase } : {}) }),
      signal: AbortSignal.timeout(20000),
    });
    return await r.json().catch(() => ({ ok: false, error: 'bad response' }));
  } catch (e) {
    return { ok: false, error: String((e as Error)?.message || e) };
  }
}

export async function stopAgent(): Promise<{ ok: boolean; error?: string }> {
  try {
    const r = await apiFetch(`${getProxyBase()}/api/ai/agent/stop`, { method: 'POST', signal: AbortSignal.timeout(15000) });
    return await r.json().catch(() => ({ ok: false, error: 'bad response' }));
  } catch (e) {
    return { ok: false, error: String((e as Error)?.message || e) };
  }
}

export async function saveAgentConfig(patch: Record<string, unknown>): Promise<{ ok: boolean; error?: string }> {
  try {
    const r = await apiFetch(`${getProxyBase()}/api/ai/agent/config`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(patch),
      signal: AbortSignal.timeout(15000),
    });
    return await r.json().catch(() => ({ ok: false, error: 'bad response' }));
  } catch (e) {
    return { ok: false, error: String((e as Error)?.message || e) };
  }
}

export async function fetchWallet(): Promise<WalletView | null> {
  try {
    const r = await apiFetch(`${getProxyBase()}/api/ai/wallet?t=${Date.now()}`, { signal: AbortSignal.timeout(20000) });
    // 4xx/5xx with an honest payload is still displayable
    return await r.json().catch(() => null);
  } catch { return null; }
}

export async function fetchFuturesMarkets(): Promise<FuturesMarketsView | null> {
  try {
    const r = await apiFetch(`${getProxyBase()}/api/ai/futures/markets?t=${Date.now()}`, { signal: AbortSignal.timeout(15000) });
    return await r.json().catch(() => null);
  } catch { return null; }
}

// ---------------- v6.11: glama Tier-2/3 fetchers ----------------
export async function fetchTrust(): Promise<TrustView | null> {
  try {
    const r = await apiFetch(`${getProxyBase()}/api/ai/trust?t=${Date.now()}`, { signal: AbortSignal.timeout(10000) });
    if (!r.ok) return null;
    return await r.json();
  } catch { return null; }
}

export async function fetchPerf(): Promise<PerfView | null> {
  try {
    const r = await apiFetch(`${getProxyBase()}/api/ai/perf?t=${Date.now()}`, { signal: AbortSignal.timeout(10000) });
    if (!r.ok) return null;
    return await r.json();
  } catch { return null; }
}

export async function fetchCorrelations(): Promise<CorrView | null> {
  try {
    const r = await apiFetch(`${getProxyBase()}/api/ai/correlations?t=${Date.now()}`, { signal: AbortSignal.timeout(30000) });
    if (!r.ok) return null;
    return await r.json();
  } catch { return null; }
}

export async function fetchSectors(): Promise<SectorView | null> {
  try {
    const r = await apiFetch(`${getProxyBase()}/api/ai/sectors?t=${Date.now()}`, { signal: AbortSignal.timeout(30000) });
    if (!r.ok) return null;
    return await r.json();
  } catch { return null; }
}

export async function fetchIncomeSetups(): Promise<IncomeView | null> {
  try {
    const r = await apiFetch(`${getProxyBase()}/api/ai/income?t=${Date.now()}`, { signal: AbortSignal.timeout(30000) });
    if (!r.ok) return null;
    return await r.json();
  } catch { return null; }
}

export async function fetchNextActions(): Promise<NextActionsView | null> {
  try {
    const r = await apiFetch(`${getProxyBase()}/api/ai/next-actions?t=${Date.now()}`, { signal: AbortSignal.timeout(30000) });
    if (!r.ok) return null;
    return await r.json();
  } catch { return null; }
}
