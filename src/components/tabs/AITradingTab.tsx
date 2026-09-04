// ============================================================
// src/components/tabs/AITradingTab.tsx — AI TRADING TERMINAL
// ------------------------------------------------------------
// v6.3 PRO UPGRADE —
//   ┌ COMMAND BAR      engine status · market switch · mode/kill
//   ├ MARKET BREADTH   live bull/bear/flat meter across the universe
//   ├ 01 SIGNAL BOARD  9-model consensus cards + GRADE/SIDE filters
//   │                  + deep-analysis 🔬 modal + new-signal flash
//   ├ 02 OPTIONS DESK  NSE indices: chain + PCR/max-pain + strategies
//   ├ 03 EXECUTION     positions · journal · risk gates · LIVE arming
//   └ 04 MODEL BUS     the 9-model registry + AI Council status
//
// Live execution happens ONLY on CoinDCX (user's API+secret) and
// ONLY through the STRONG-signal gauntlet — enforced server-side.
// ============================================================
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useAITrading } from '../aitrading/useAITrading';
import { SignalCard } from '../aitrading/SignalCard';
import { OptionsDeskPanel } from '../aitrading/OptionsDeskPanel';
import { OrderConsole } from '../aitrading/OrderConsole';
import { ModelRegistry } from '../aitrading/ModelRegistry';
import type { AISignal, MarketKind, SignalBoard } from '../aitrading/types';

const REFRESH_MS = 30_000;

function SectionLabel({ num, title, sub }: { num: string; title: string; sub?: string }) {
  return (
    <div className="flex items-baseline gap-2.5 pt-2">
      <span className="text-[10px] font-black font-mono text-cyan-500/70">{num}</span>
      <span className="text-sm font-black text-slate-100 tracking-wide uppercase">{title}</span>
      {sub && <span className="text-[10px] text-slate-500 hidden sm:inline">— {sub}</span>}
    </div>
  );
}

function DeskSwitcher({ market, onChange, indiaOpen }: { market: MarketKind; onChange: (m: MarketKind) => void; indiaOpen?: boolean }) {
  return (
    <div className="flex gap-1 quantum-panel p-1 rounded-2xl w-full sm:w-auto" role="tablist" aria-label="Market desk">
      <button onClick={() => onChange('INDIA')} role="tab" aria-pressed={market === 'INDIA'}
        className={`flex-1 sm:flex-none px-4 py-2.5 rounded-xl text-xs font-black transition-colors flex items-center gap-2 ${market === 'INDIA' ? 'bg-gradient-to-r from-orange-600 to-amber-600 text-white shadow-lg shadow-orange-500/20' : 'text-slate-400 hover:text-slate-200'}`}>
        🇮🇳 INDIA MARKET
        <span className={`px-1.5 py-0.5 rounded text-[9px] font-mono ${indiaOpen ? 'bg-emerald-500/20 text-emerald-300' : 'bg-slate-600/30 text-slate-400'}`}>
          {indiaOpen ? 'LIVE 09:15-15:30' : 'CLOSED · NSE'}
        </span>
      </button>
      <button onClick={() => onChange('CRYPTO')} role="tab" aria-pressed={market === 'CRYPTO'}
        className={`flex-1 sm:flex-none px-4 py-2.5 rounded-xl text-xs font-black transition-colors flex items-center gap-2 ${market === 'CRYPTO' ? 'bg-gradient-to-r from-amber-600 to-yellow-600 text-white shadow-lg shadow-amber-500/20' : 'text-slate-400 hover:text-slate-200'}`}>
        ₿ CRYPTO · CoinDCX
        <span className="px-1.5 py-0.5 rounded text-[9px] font-mono bg-emerald-500/20 text-emerald-300">24/7</span>
      </button>
    </div>
  );
}

/** v6.3: live bull/bear/flat breadth meter across the whole scanned universe. */
function BreadthStrip({ board }: { board: SignalBoard | null }) {
  const b = board?.breadth;
  if (!b) return null;
  const total = Math.max(1, b.bull + b.bear + b.flat);
  const bullPct = (b.bull / total) * 100;
  const bearPct = (b.bear / total) * 100;
  const flatPct = 100 - bullPct - bearPct;
  const mood = bullPct - bearPct;
  const label = mood > 25 ? 'RISK-ON' : mood < -25 ? 'RISK-OFF' : 'MIXED';
  const moodCls = mood > 25 ? 'text-emerald-400' : mood < -25 ? 'text-red-400' : 'text-amber-400';
  return (
    <div className="quantum-panel rounded-2xl px-4 py-3" aria-label="Market breadth">
      <div className="flex items-center gap-3 flex-wrap text-[10px] font-black">
        <span className="text-slate-500 tracking-wider">MARKET BREADTH</span>
        <span className="text-emerald-400 font-mono">▲ {b.bull} BULL</span>
        <span className="text-red-400 font-mono">▼ {b.bear} BEAR</span>
        <span className="text-slate-500 font-mono">· {b.flat} FLAT</span>
        <span className={`ml-auto font-mono ${moodCls}`}>{label} {mood >= 0 ? '+' : ''}{Math.round(mood)}</span>
        <span className="text-slate-600 font-mono">avg conf {b.avgConf}%</span>
      </div>
      <div className="flex h-2 mt-2 rounded-full overflow-hidden bg-black/40" role="img" aria-label={`breadth ${Math.round(bullPct)}% bull`}>
        <div className="bg-emerald-500/80" style={{ width: `${bullPct}%` }} />
        <div className="bg-slate-600/60" style={{ width: `${flatPct}%` }} />
        <div className="bg-red-500/80" style={{ width: `${bearPct}%` }} />
      </div>
    </div>
  );
}

type BoardFilter = 'ALL' | 'ACTION' | 'STRONG' | 'LONG' | 'SHORT';

const FILTERS: { id: BoardFilter; label: string }[] = [
  { id: 'ALL', label: 'ALL' },
  { id: 'ACTION', label: '⚡ ACTIONABLE' },
  { id: 'STRONG', label: '★ STRONG' },
  { id: 'LONG', label: '▲ LONG' },
  { id: 'SHORT', label: '▼ SHORT' },
];

function FilterChips({ filter, onChange, counts }: { filter: BoardFilter; onChange: (f: BoardFilter) => void; counts: Record<BoardFilter, number> }) {
  return (
    <div className="flex gap-1.5 flex-wrap" role="group" aria-label="Signal filters">
      {FILTERS.map(f => (
        <button key={f.id} onClick={() => onChange(f.id)} aria-pressed={filter === f.id}
          className={`px-2.5 py-1 rounded-lg text-[10px] font-black tracking-wide transition-colors border ${filter === f.id
            ? 'bg-cyan-500/15 text-cyan-300 border-cyan-500/40'
            : 'bg-black/20 text-slate-500 border-slate-700/40 hover:text-slate-300'}`}>
          {f.label} <span className="font-mono opacity-70">{counts[f.id] ?? 0}</span>
        </button>
      ))}
    </div>
  );
}

/** v6.3: countdown ring to the next 30s auto-refresh. */
function RefreshCountdown({ board, loading }: { board: SignalBoard | null; loading: boolean }) {
  const [left, setLeft] = useState(REFRESH_MS / 1000);
  useEffect(() => {
    if (!board) return;
    setLeft(REFRESH_MS / 1000);
    const t = setInterval(() => setLeft(v => (v <= 1 ? REFRESH_MS / 1000 : v - 1)), 1000);
    return () => clearInterval(t);
  }, [board?.generatedAt]); // eslint-disable-line react-hooks/exhaustive-deps
  const pct = Math.max(0, Math.min(100, (left / (REFRESH_MS / 1000)) * 100));
  const age = board ? Math.max(0, Math.round((Date.now() - board.generatedAt) / 1000)) : 0;
  return (
    <span className="px-2 py-1 rounded-lg bg-black/30 text-[9px] font-mono font-bold text-slate-500 flex items-center gap-1.5" title="Auto-refresh every 30s">
      {loading ? <span className="inline-block animate-spin">🔄</span> : <span className="relative flex h-2 w-2"><span className="absolute inline-flex h-full w-full rounded-full bg-cyan-400 opacity-60 animate-ping" /><span className="relative inline-flex rounded-full h-2 w-2 bg-cyan-500" /></span>}
      <span className="relative w-8 h-1 rounded-full bg-black/40 overflow-hidden" aria-hidden="true">
        <span className="absolute inset-y-0 left-0 bg-cyan-500/70 rounded-full" style={{ width: `${100 - pct}%` }} />
      </span>
      {left}s · age {age}s
    </span>
  );
}

function BoardSummary({ board }: { board: SignalBoard | null }) {
  if (!board) return null;
  const strong = (board.signals || []).filter(s => s.grade === 'STRONG').length;
  const actionable = (board.signals || []).filter(s => s.grade === 'ACTION' || s.grade === 'STRONG').length;
  return (
    <div className="flex items-center gap-2 flex-wrap text-[10px] font-bold">
      <span className="px-2 py-1 rounded-lg bg-black/30 text-slate-400 font-mono">{board.scanned || 0} scanned</span>
      <span className="px-2 py-1 rounded-lg bg-black/30 text-slate-400 font-mono">{(board.signals || []).length} signals</span>
      <span className={`px-2 py-1 rounded-lg border ${strong > 0 ? 'bg-emerald-500/15 text-emerald-300 border-emerald-500/40 animate-pulse' : 'bg-slate-600/20 text-slate-400 border-slate-600/30'}`}>★ {strong} STRONG</span>
      <span className={`px-2 py-1 rounded-lg border ${actionable > 0 ? 'bg-cyan-500/15 text-cyan-300 border-cyan-500/40' : 'bg-slate-600/20 text-slate-400 border-slate-600/30'}`}>⚡ {actionable} actionable</span>
    </div>
  );
}

export default memo(function AITradingTab() {
  const { india, crypto, state, positions, entries, loading, busy, refresh, executeSignal, updateConfig, closePos, fetchDeep } = useAITrading(true);
  const [market, setMarket] = useState<MarketKind>('INDIA');
  const [toast, setToast] = useState<{ ok: boolean; text: string } | null>(null);
  const [filter, setFilter] = useState<BoardFilter>('ALL');
  const [deep, setDeep] = useState<{ loading: boolean; signal?: AISignal; indicators?: Record<string, unknown>; error?: string } | null>(null);

  const board = market === 'INDIA' ? india : crypto;
  const models = board?.models || india?.models || crypto?.models || [];
  const canLive = state?.config?.mode === 'live' && !state?.blocked?.notConnected;

  // Track which ACTIONABLE symbols were NOT in the previous board → flash them.
  const prevTopRef = useRef<Set<string>>(new Set());
  const newSymbols = useMemo(() => {
    const actionable = (board?.signals || []).filter(s => s.grade === 'ACTION' || s.grade === 'STRONG');
    const now = new Set(actionable.map(s => s.symbol));
    const fresh = actionable.filter(s => !prevTopRef.current.has(s.symbol)).map(s => s.symbol);
    if (board?.generatedAt) {
      // commit AFTER computing (effect-free pattern: ref updated on next render)
      queueMicrotask(() => { prevTopRef.current = now; });
    }
    return new Set(fresh);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [board?.generatedAt, market]);

  const notify = useCallback((ok: boolean, text: string) => {
    setToast({ ok, text });
    setTimeout(() => setToast(null), 6000);
  }, []);

  const onExecute = useCallback(async (signal: AISignal, mode: 'paper' | 'live') => {
    const r = await executeSignal(signal, mode);
    if (r.ok) {
      notify(true, mode === 'live'
        ? `✅ LIVE order placed — ${signal.symbol} ${signal.side} · qty ${r.filled?.qty} @ ₹${r.filled?.price}`
        : `🧪 Paper trade opened — ${signal.symbol} ${signal.side} · qty ${r.filled?.qty} @ ₹${r.filled?.price}`);
    } else {
      notify(false, `⛔ ${r.error || 'execution failed'}`);
    }
  }, [executeSignal, notify]);

  const onSaveConfig = useCallback(async (patch: Record<string, unknown>) => {
    const r = await updateConfig(patch);
    if (!r.ok) notify(false, `⛔ ${r.error}`);
    else if (patch.killSwitch) notify(true, '☠️ Kill switch ON — auto disabled, mode → paper, open orders cancelled');
    else if (patch.mode === 'live') notify(true, '🔴 LIVE mode armed — REAL CoinDCX orders now possible on STRONG signals');
    else if (patch.mode === 'paper') notify(true, '🧪 Paper mode — orders simulated');
    return r;
  }, [updateConfig, notify]);

  const onClose = useCallback(async (id: string) => {
    const r = await closePos(id);
    notify(r.ok, r.ok ? '✅ Position closed' : `⛔ ${r.error}`);
  }, [closePos, notify]);

  // v6.3: 🔬 deep analysis — fresh single-symbol ensemble run in a modal.
  const onDeep = useCallback(async (signal: AISignal) => {
    setDeep({ loading: true });
    const r = await fetchDeep(signal.symbol, signal.market);
    if (r.ok && r.signal) setDeep({ loading: false, signal: r.signal, indicators: r.indicators });
    else setDeep({ loading: false, error: r.error || 'deep analysis unavailable' });
  }, [fetchDeep]);

  const regime = board?.regime;
  const regimeChips = market === 'CRYPTO'
    ? (regime?.btcChange != null ? [{ label: 'BTC 24h', v: `${regime.btcChange >= 0 ? '+' : ''}${regime.btcChange.toFixed(2)}%`, bull: regime.btcChange >= 0 }] : [])
    : [
      regime?.niftyChange != null ? { label: 'NIFTY', v: `${regime.niftyChange >= 0 ? '+' : ''}${regime.niftyChange.toFixed(2)}%`, bull: regime.niftyChange >= 0 } : null,
      regime?.indiaVix != null ? { label: 'VIX', v: regime.indiaVix.toFixed(1), bull: regime.indiaVix < 15 } : null,
    ].filter(Boolean) as { label: string; v: string; bull: boolean }[];

  const counts = useMemo(() => {
    const sigs = board?.signals || [];
    return {
      ALL: sigs.length,
      ACTION: sigs.filter(s => s.grade === 'ACTION' || s.grade === 'STRONG').length,
      STRONG: sigs.filter(s => s.grade === 'STRONG').length,
      LONG: sigs.filter(s => s.side === 'LONG' && s.grade !== 'NEUTRAL').length,
      SHORT: sigs.filter(s => s.side === 'SHORT' && s.grade !== 'NEUTRAL').length,
    } as Record<BoardFilter, number>;
  }, [board]);

  const visibleSignals = useMemo(() => {
    const sigs = board?.signals || [];
    switch (filter) {
      case 'ACTION': return sigs.filter(s => s.grade === 'ACTION' || s.grade === 'STRONG');
      case 'STRONG': return sigs.filter(s => s.grade === 'STRONG');
      case 'LONG': return sigs.filter(s => s.side === 'LONG' && s.grade !== 'NEUTRAL');
      case 'SHORT': return sigs.filter(s => s.side === 'SHORT' && s.grade !== 'NEUTRAL');
      default: return sigs;
    }
  }, [board, filter]);

  return (
    <div className="space-y-4">
      {/* ============ COMMAND BAR ============ */}
      <div className="quantum-panel rounded-2xl p-4 bg-gradient-to-r from-cyan-500/[0.06] via-transparent to-violet-500/[0.06]">
        <div className="flex items-center gap-3 flex-wrap">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <h2 className="text-base font-black gradient-text-cyan tracking-wide">SUPERINTELLIGENCE AI TRADING TERMINAL</h2>
              <span className="quantum-badge">v6.3</span>
            </div>
            <p className="text-[10px] text-slate-500 mt-0.5">
              9-model ensemble consensus · MCP model bus · {models.filter(m => m.online).length}/{models.length || 9} models online
              {canLive && <span className="text-red-400 font-black"> · LIVE EXECUTION ARMED</span>}
            </p>
          </div>
          <div className="ml-auto flex items-center gap-2 flex-wrap">
            {regimeChips.map(c => (
              <span key={c.label} className="px-2 py-1 rounded-lg bg-black/30 text-[10px] font-mono font-bold">
                <span className="text-slate-500">{c.label} </span>
                <span className={c.bull ? 'text-emerald-400' : 'text-red-400'}>{c.v}</span>
              </span>
            ))}
            <RefreshCountdown board={board} loading={loading} />
            <button onClick={refresh} disabled={loading}
              className="quantum-btn-ghost px-3 py-2 rounded-xl text-xs font-bold disabled:opacity-50">
              <span className={loading ? 'inline-block animate-spin' : ''}>🔄</span>
            </button>
          </div>
        </div>
        <div className="mt-3">
          <DeskSwitcher market={market} onChange={setMarket} indiaOpen={india?.marketOpen} />
        </div>
      </div>

      {/* ============ MARKET BREADTH (v6.3) ============ */}
      <BreadthStrip board={board} />

      {/* toast */}
      {toast && (
        <div className={`quantum-panel rounded-xl px-4 py-2.5 text-xs font-bold border ${toast.ok ? 'border-emerald-500/40 text-emerald-300' : 'border-red-500/40 text-red-300'}`}
          role="status" aria-live="polite">
          {toast.text}
        </div>
      )}

      {/* ============ 01 · SIGNAL BOARD ============ */}
      <div>
        <div className="flex items-end justify-between flex-wrap gap-2">
          <SectionLabel num="01" title="Signal Board" sub={`${market === 'INDIA' ? 'NSE equities + indices (TV live scanner)' : 'CoinDCX crypto majors'} → 9-model consensus`} />
          <BoardSummary board={board} />
        </div>
        <div className="mt-2.5 flex items-center justify-between flex-wrap gap-2">
          <FilterChips filter={filter} onChange={setFilter} counts={counts} />
          <span className="text-[10px] text-slate-600 font-mono">grades: STRONG ≥75% conf + 70% agree · ACTION ≥55 · WATCH ≥35</span>
        </div>
        <div className="grid gap-3 mt-2.5 xl:grid-cols-2">
          {loading && (!board || board.signals.length === 0) && (
            <div className="quantum-panel rounded-2xl p-10 text-center col-span-full">
              <div className="text-4xl mb-3 animate-float">🧠</div>
              <div className="text-sm text-slate-400 font-medium">Ensemble scanning {market === 'INDIA' ? 'NSE universe' : 'crypto majors'}…</div>
            </div>
          )}
          {board && !board.ok && (
            <div className="quantum-panel rounded-2xl p-6 col-span-full text-center">
              <div className="text-3xl mb-2">📡</div>
              <div className="text-sm text-red-400 font-bold">{board.reason || 'Data unavailable'}</div>
              <div className="text-[11px] text-slate-500 mt-1">Will auto-retry every 30s</div>
            </div>
          )}
          {visibleSignals.map(s => (
            <SignalCard key={`${s.market}-${s.symbol}`} signal={s} busy={busy} onExecute={onExecute} onDeep={onDeep} canLive={canLive} isNew={newSymbols.has(s.symbol)} />
          ))}
          {board?.signals?.length === 0 && !loading && (
            <div className="quantum-panel rounded-2xl p-8 col-span-full text-center">
              <div className="text-3xl mb-2">😌</div>
              <div className="text-sm text-slate-400 font-bold">No tradeable consensus right now</div>
              <div className="text-[11px] text-slate-500 mt-1">The ensemble only speaks when models agree — silence is a signal too.</div>
            </div>
          )}
          {board?.ok && board.signals.length > 0 && visibleSignals.length === 0 && (
            <div className="quantum-panel rounded-2xl p-6 col-span-full text-center">
              <div className="text-2xl mb-1">🔍</div>
              <div className="text-xs text-slate-400 font-bold">No signals match this filter right now</div>
              <div className="text-[10px] text-slate-500 mt-1">Try ALL — the board re-ranks every 30s.</div>
            </div>
          )}
        </div>
      </div>

      {/* ============ 02 · OPTIONS DESK (India) ============ */}
      {market === 'INDIA' && (
        <div>
          <SectionLabel num="02" title="Options Desk" sub="NSE indices — live chain / BS model · PCR · max pain · Greeks · ensemble strategies" />
          <div className="mt-2.5">
            <OptionsDeskPanel />
          </div>
        </div>
      )}

      {/* ============ 03 · EXECUTION CONSOLE ============ */}
      <div>
        <SectionLabel num={market === 'INDIA' ? '03' : '02'} title="Execution Console" sub="CoinDCX order gauntlet — STRONG signals only · risk-gated · audited" />
        <div className="mt-2.5">
          <OrderConsole
            state={state} positions={positions} entries={entries} busy={busy}
            onClose={onClose} onSaveConfig={onSaveConfig}
          />
        </div>
      </div>

      {/* ============ 04 · MODEL REGISTRY ============ */}
      <div>
        <SectionLabel num={market === 'INDIA' ? '04' : '03'} title="Model Registry" sub="the superintelligence bus — every analyst, weight & status" />
        <div className="mt-2.5">
          <ModelRegistry models={models} />
        </div>
      </div>

      {/* ============ DEEP ANALYSIS MODAL (v6.3) ============ */}
      {deep && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm" role="dialog" aria-modal="true" aria-label="Deep analysis"
          onClick={() => setDeep(null)}>
          <div className="quantum-panel rounded-2xl p-5 max-w-2xl w-full max-h-[85vh] overflow-y-auto animate-scale-in" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-black text-cyan-300 tracking-wide">🔬 DEEP ENSEMBLE ANALYSIS</h3>
              <button onClick={() => setDeep(null)} className="quantum-btn-ghost px-2.5 py-1 rounded-lg text-xs font-black" aria-label="Close">✕</button>
            </div>
            {deep.loading && (
              <div className="py-12 text-center">
                <div className="text-4xl mb-3 animate-float">🧠</div>
                <div className="text-xs text-slate-400">Running a fresh 9-model ensemble on {deep.signal?.symbol ?? 'the symbol'}…</div>
              </div>
            )}
            {!deep.loading && deep.error && (
              <div className="py-8 text-center text-xs text-red-400 font-bold">⛔ {deep.error}</div>
            )}
            {!deep.loading && deep.signal && (
              <>
                <SignalCard signal={deep.signal} onExecute={onExecute} canLive={canLive} busy={busy} />
                {deep.indicators && (
                  <div className="mt-3 bg-black/25 rounded-xl p-3">
                    <div className="text-[10px] font-black text-slate-500 tracking-wider mb-2">LIVE INDICATOR SNAPSHOT</div>
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-1.5 text-[10px] font-mono">
                      {['rsi', 'adx', 'atr', 'vwap'].map(k => {
                        const v = (deep.indicators as Record<string, unknown>)[k];
                        const val = v == null ? '—' : typeof v === 'object' ? String((v as Record<string, unknown>).adx ?? '—') : Number(v).toFixed(2);
                        return <div key={k} className="flex justify-between bg-black/30 rounded px-2 py-1"><span className="text-slate-500 uppercase">{k}</span><span className="text-slate-200">{val}</span></div>;
                      })}
                    </div>
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
});
