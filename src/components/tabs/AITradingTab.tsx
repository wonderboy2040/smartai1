// ============================================================
// src/components/tabs/AITradingTab.tsx — AI TRADING TERMINAL
// ------------------------------------------------------------
// v6.0 — the COMPLETE REWRITE of the old Intraday desk:
//
//   ┌ COMMAND BAR     engine status · market switch · mode/kill
//   ├ 01 SIGNAL BOARD 9-model consensus cards (India + Crypto)
//   ├ 02 OPTIONS DESK NSE indices: chain + PCR/max-pain + strategies
//   ├ 03 EXECUTION     positions · journal · risk gates · LIVE arming
//   └ 04 MODEL BUS     the 9-model registry + AI Council status
//
// Live execution happens ONLY on CoinDCX (user's API+secret) and
// ONLY through the STRONG-signal gauntlet — enforced server-side.
// ============================================================
import { memo, useCallback, useState } from 'react';
import { useAITrading } from '../aitrading/useAITrading';
import { SignalCard } from '../aitrading/SignalCard';
import { OptionsDeskPanel } from '../aitrading/OptionsDeskPanel';
import { OrderConsole } from '../aitrading/OrderConsole';
import { ModelRegistry } from '../aitrading/ModelRegistry';
import type { AISignal, MarketKind, SignalBoard } from '../aitrading/types';

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
        className={`flex-1 sm:flex-none px-4 py-2.5 rounded-xl text-xs font-black transition-all flex items-center gap-2 ${market === 'INDIA' ? 'bg-gradient-to-r from-orange-600 to-amber-600 text-white shadow-lg shadow-orange-500/20' : 'text-slate-400 hover:text-slate-200'}`}>
        🇮🇳 INDIA MARKET
        <span className={`px-1.5 py-0.5 rounded text-[9px] font-mono ${indiaOpen ? 'bg-emerald-500/20 text-emerald-300' : 'bg-slate-600/30 text-slate-400'}`}>
          {indiaOpen ? 'LIVE 09:15-15:30' : 'CLOSED · NSE'}
        </span>
      </button>
      <button onClick={() => onChange('CRYPTO')} role="tab" aria-pressed={market === 'CRYPTO'}
        className={`flex-1 sm:flex-none px-4 py-2.5 rounded-xl text-xs font-black transition-all flex items-center gap-2 ${market === 'CRYPTO' ? 'bg-gradient-to-r from-amber-600 to-yellow-600 text-white shadow-lg shadow-amber-500/20' : 'text-slate-400 hover:text-slate-200'}`}>
        ₿ CRYPTO · CoinDCX
        <span className="px-1.5 py-0.5 rounded text-[9px] font-mono bg-emerald-500/20 text-emerald-300">24/7</span>
      </button>
    </div>
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
      <span className="px-2 py-1 rounded-lg bg-cyan-500/10 text-cyan-300/80 border border-cyan-500/25">{actionable} actionable</span>
    </div>
  );
}

export default memo(function AITradingTab() {
  const { india, crypto, state, positions, entries, loading, busy, refresh, executeSignal, updateConfig, closePos } = useAITrading(true);
  const [market, setMarket] = useState<MarketKind>('INDIA');
  const [toast, setToast] = useState<{ ok: boolean; text: string } | null>(null);

  const board = market === 'INDIA' ? india : crypto;
  const models = board?.models || india?.models || crypto?.models || [];
  const canLive = state?.config?.mode === 'live' && !state?.blocked?.notConnected;

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

  const regime = board?.regime;
  const regimeChips = market === 'CRYPTO'
    ? (regime?.btcChange != null ? [{ label: 'BTC 24h', v: `${regime.btcChange >= 0 ? '+' : ''}${regime.btcChange.toFixed(2)}%`, bull: regime.btcChange >= 0 }] : [])
    : [
      regime?.niftyChange != null ? { label: 'NIFTY', v: `${regime.niftyChange >= 0 ? '+' : ''}${regime.niftyChange.toFixed(2)}%`, bull: regime.niftyChange >= 0 } : null,
      regime?.indiaVix != null ? { label: 'VIX', v: regime.indiaVix.toFixed(1), bull: regime.indiaVix < 15 } : null,
    ].filter(Boolean) as { label: string; v: string; bull: boolean }[];

  return (
    <div className="space-y-4">
      {/* ============ COMMAND BAR ============ */}
      <div className="quantum-panel rounded-2xl p-4 bg-gradient-to-r from-cyan-500/[0.06] via-transparent to-violet-500/[0.06]">
        <div className="flex items-center gap-3 flex-wrap">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <h2 className="text-base font-black gradient-text-cyan tracking-wide">SUPERINTELLIGENCE AI TRADING TERMINAL</h2>
              <span className="quantum-badge">v6.0</span>
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
          {board?.signals.map(s => (
            <SignalCard key={`${s.market}-${s.symbol}`} signal={s} busy={busy} onExecute={onExecute} canLive={canLive} />
          ))}
          {board?.signals?.length === 0 && !loading && (
            <div className="quantum-panel rounded-2xl p-8 col-span-full text-center">
              <div className="text-3xl mb-2">😌</div>
              <div className="text-sm text-slate-400 font-bold">No tradeable consensus right now</div>
              <div className="text-[11px] text-slate-500 mt-1">The ensemble only speaks when models agree — silence is a signal too.</div>
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
    </div>
  );
});
