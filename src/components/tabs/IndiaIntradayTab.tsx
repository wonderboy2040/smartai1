// ============================================================
// src/components/tabs/IndiaIntradayTab.tsx — v6.10 INDIA DESK
// ------------------------------------------------------------
// The India half of the old AI Trading tab, now a SELF-CONTAINED
// desk — nothing crypto on this screen:
//   ┌ COMMAND BAR     NIFTY/VIX regime · engine status · refresh
//   ├ NSE CLOCK       live IST session phase + countdown
//   ├ QUICK NAV       sticky section jump chips
//   ├ 📊 DESK STATS   v6.10 one-glance strip (scanned·actionable·
//   │                 STRONG·avg conf·mood)
//   ├ 🏆 TOP 5 PICKS  full-universe composite ranking (44 stocks
//   │                 + NIFTY/BANKNIFTY → ranked 5 best trades)
//   ├ 01 SIGNAL BOARD 10-model consensus cards (Dhan paper/live)
//   ├ 01b MORNING BRIEF · 02 OPTIONS DESK (NSE indices)
//   ├ 02b SWING DESK  multi-day India setups
//   ├ 03 EXECUTION    India positions · Dhan · risk gates
//   └ 04 BACKTEST · 05 ALERTS · 06 MODELS · 07 LEDGER
// ============================================================
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useAITrading } from '../aitrading/useAITrading';
import { SignalCard } from '../aitrading/SignalCard';
import { TopPicksPanel } from '../aitrading/TopPicksPanel';
import { MarketClockStrip } from '../aitrading/MarketClockStrip';
import { QuickNav } from '../aitrading/QuickNav';
import { OptionsDeskPanel } from '../aitrading/OptionsDeskPanel';
import { OrderConsole } from '../aitrading/OrderConsole';
import { ModelRegistry } from '../aitrading/ModelRegistry';
import { BacktestPanel } from '../aitrading/BacktestPanel';
import { AlertsPanel } from '../aitrading/AlertsPanel';
import { MorningBriefPanel, SwingDeskPanel, SignalLedgerPanel, TrustLayerPanel, PerfAnalyticsPanel, SectorMapPanel } from '../aitrading/ProPanels';
import {
  SectionLabel, RegimeChips, BreadthStrip, FilterChips, RefreshCountdown, BoardSummary, DeskStatsStrip,
  filterSignals, countSignals, IndiaHowToTrade, type BoardFilter,
} from '../aitrading/deskShared';
import type { AISignal, DhanStatus } from '../aitrading/types';

const NAV = [
  { id: 'in-top5', label: 'TOP 5', emoji: '🏆' },
  { id: 'in-signals', label: 'SIGNALS', emoji: '📡' },
  { id: 'in-options', label: 'OPTIONS', emoji: '📊' },
  { id: 'in-execute', label: 'EXECUTE', emoji: '⚙️' },
  { id: 'in-swing', label: 'SWING', emoji: '🗂️' },
  { id: 'in-backtest', label: 'BACKTEST', emoji: '🧪' },
  { id: 'in-alerts', label: 'ALERTS', emoji: '🔔' },
  { id: 'in-models', label: 'MODELS', emoji: '🧠' },
  { id: 'in-ledger', label: 'LEDGER', emoji: '🔗' },
];

export default memo(function IndiaIntradayTab() {
  // v6.9: India-scoped loading — the India desk never pays for the
  // crypto/futures boards.
  const t = useAITrading(true, { markets: ['INDIA'] });
  const { india, state, positions, entries, loading, busy, refresh, executeIndia, updateConfig, closePos, fetchDeep } = t;
  const { runBacktest, fetchAlertsStatus, saveAlertsConfig, testAlert, fetchDhanStatus, dhanConnect, dhanDisconnect } = t;
  const [toast, setToast] = useState<{ ok: boolean; text: string } | null>(null);
  const [filter, setFilter] = useState<BoardFilter>('ALL');
  const [deep, setDeep] = useState<{ loading: boolean; signal?: AISignal; indicators?: Record<string, unknown>; narrative?: import('../aitrading/types').NarrativeView | null; error?: string } | null>(null);
  const [dhan, setDhan] = useState<DhanStatus | null>(null);

  const board = india;
  const models = board?.models || [];
  const canLiveIndia = state?.config?.indiaMode === 'live' && !!dhan?.connected;

  // Dhan status boot-load (light: profile ping only when connected)
  useEffect(() => {
    let alive = true;
    fetchDhanStatus().then(s => { if (alive && s) setDhan(s); }).catch(() => {});
    return () => { alive = false; };
  }, [fetchDhanStatus]);
  const refreshDhan = useCallback(() => {
    fetchDhanStatus().then(s => { if (s) setDhan(s); }).catch(() => {});
  }, [fetchDhanStatus]);

  // Track which ACTIONABLE symbols were NOT in the previous board → flash them.
  const prevTopRef = useRef<Set<string>>(new Set());
  const newSymbols = useMemo(() => {
    const actionable = (board?.signals || []).filter(s => s.grade === 'ACTION' || s.grade === 'STRONG');
    const now = new Set(actionable.map(s => s.symbol));
    const fresh = actionable.filter(s => !prevTopRef.current.has(s.symbol)).map(s => s.symbol);
    if (board?.generatedAt) queueMicrotask(() => { prevTopRef.current = now; });
    return new Set(fresh);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [board?.generatedAt]);

  const notify = useCallback((ok: boolean, text: string) => {
    setToast({ ok, text });
    setTimeout(() => setToast(null), 6000);
  }, []);

  const onExecuteIndia = useCallback(async (signal: AISignal, mode: 'paper' | 'live' | 'notify', opts?: { qtyINR?: number; leverage?: number }) => {
    const r = await executeIndia(signal, mode, opts);
    if (r.ok) {
      notify(true, mode === 'live'
        ? `✅ Dhan LIVE order placed — ${signal.symbol} ${signal.side} · ${r.filled?.qty} shares @ ₹${r.filled?.price} · broker SL-M armed · 15:15 square-off${r.fitted ? ` · ⚙️ ${r.fitted}` : ''}`
        : `🧪 India paper trade opened — ${signal.symbol} ${signal.side} · ${r.filled?.qty} shares @ ₹${r.filled?.price} (watcher SL/TP + trailing)${r.fitted ? ` · ⚙️ ${r.fitted}` : ''}`);
    } else {
      notify(false, `⛔ ${r.error || 'execution failed'}`);
    }
  }, [executeIndia, notify]);

  const onSaveConfig = useCallback(async (patch: Record<string, unknown>) => {
    const r = await updateConfig(patch);
    if (!r.ok) notify(false, `⛔ ${r.error}`);
    else if (patch.killSwitch) notify(true, '☠️ Kill switch ON — auto disabled, mode → paper, open orders cancelled');
    else if (patch.indiaMode === 'live') notify(true, '🔴 India LIVE armed — Dhan par ab STRONG India signals REAL orders de sakte hain');
    else if (patch.indiaMode === 'paper') notify(true, '🧪 India paper mode — orders simulated');
    return r;
  }, [updateConfig, notify]);

  const onClose = useCallback(async (id: string) => {
    const r = await closePos(id);
    notify(r.ok, r.ok ? '✅ Position closed' : `⛔ ${r.error}`);
  }, [closePos, notify]);

  const onDeep = useCallback(async (signal: AISignal) => {
    setDeep({ loading: true });
    const r = await fetchDeep(signal.symbol, signal.market);
    if (r.ok && r.signal) setDeep({ loading: false, signal: r.signal, indicators: r.indicators, narrative: r.narrative });
    else setDeep({ loading: false, error: r.error || 'deep analysis unavailable' });
  }, [fetchDeep]);

  const counts = useMemo(() => countSignals(board), [board]);
  const visibleSignals = useMemo(() => filterSignals(board, filter), [board, filter]);

  return (
    <div className="space-y-4">
      {/* ============ COMMAND BAR (India-branded) ============ */}
      <div className="quantum-panel rounded-2xl p-4 bg-gradient-to-r from-orange-500/[0.08] via-transparent to-amber-500/[0.05] border border-orange-500/15">
        <div className="flex items-center gap-3 flex-wrap">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <h2 className="text-base font-black tracking-wide bg-gradient-to-r from-orange-300 to-amber-200 bg-clip-text text-transparent">🇮🇳 INDIA INTRADAY DESK</h2>
              <span className="quantum-badge">v6.10</span>
            </div>
            <p className="text-[10px] text-slate-500 mt-0.5">
              NSE 44 stocks + NIFTY/BANKNIFTY → 10-model consensus · TOP-5 composite rank · options desk · Dhan gauntlet
              {canLiveIndia && <span className="text-red-400 font-black"> · INDIA LIVE ARMED (Dhan)</span>}
              <span className="text-orange-400/80 font-bold"> · crypto alag tab me (₿ CoinDCX)</span>
            </p>
          </div>
          <div className="ml-auto flex items-center gap-2 flex-wrap">
            <RegimeChips board={board} market="INDIA" />
            <RefreshCountdown board={board} loading={loading} />
            <button onClick={refresh} disabled={loading}
              className="quantum-btn-ghost px-3 py-2 rounded-xl text-xs font-bold disabled:opacity-50">
              <span className={loading ? 'inline-block animate-spin' : ''}>🔄</span>
            </button>
          </div>
        </div>
      </div>

      {/* ============ NSE SESSION CLOCK (v6.9) ============ */}
      <MarketClockStrip marketOpen={board?.marketOpen} />

      {/* ============ STICKY QUICK NAV (v6.9) ============ */}
      <QuickNav items={NAV} />

      {/* ============ 📊 DESK STATS (v6.10 one-glance) ============ */}
      <DeskStatsStrip board={board} deskLabel="🇮🇳 INDIA DESK SNAPSHOT" />

      {/* toast */}
      {toast && (
        <div className={`quantum-panel rounded-xl px-4 py-2.5 text-xs font-bold border ${toast.ok ? 'border-emerald-500/40 text-emerald-300' : 'border-red-500/40 text-red-300'}`}
          role="status" aria-live="polite">
          {toast.text}
        </div>
      )}

      {/* ============ 🏆 TOP 5 PICKS (v6.9) ============ */}
      <div id="in-top5">
        <TopPicksPanel picks={board?.topFive} market="INDIA" deskLabel="🇮🇳 NSE · INDIA" scanned={board?.scanned} loading={loading} onDeep={onDeep} />
      </div>

      {/* ============ MARKET BREADTH ============ */}
      <BreadthStrip board={board} />

      {/* ============ India how-to-trade guide ============ */}
      <IndiaHowToTrade />

      {/* ============ 01 · SIGNAL BOARD ============ */}
      <div id="in-signals">
        <div className="flex items-end justify-between flex-wrap gap-2">
          <SectionLabel num="01" title="Signal Board" sub="NSE equities + indices (TV live scanner) → 10-model consensus (SMC/ICT included)" />
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
              <div className="text-sm text-slate-400 font-medium">Ensemble scanning the NSE universe (44 stocks + indices)…</div>
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
            <SignalCard key={`INDIA-${s.symbol}`} signal={s} busy={busy} onExecuteIndia={onExecuteIndia} onDeep={onDeep}
              canLiveIndia={canLiveIndia} isNew={newSymbols.has(s.symbol)}
              orderBudgetINR={state?.config?.maxOrderINR} riskCapPct={board?.riskCap ?? state?.config?.maxRiskPct ?? 5}
              indiaBudgetINR={state?.config?.indiaMaxOrderINR ?? 5000} />
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

      {/* ============ 01b · MORNING BRIEF ============ */}
      <div id="in-brief">
        <SectionLabel num="01b" title="Morning Brief" sub="ek nazar me poora desk — market · top signals · open book · guards · ledger · next-actions" />
        <div className="mt-2.5">
          <MorningBriefPanel />
        </div>
      </div>

      {/* ============ 01c · SECTOR MAP + CONTEXT CHAIN + F-SCORE (v6.11) ============ */}
      <div id="in-sectors">
        <SectionLabel num="01c" title="Sector Map + Context Chain" sub="macro→sector→symbol top-down lens · 45 stocks 10 sectors me · F-Score trend-quality board (Piotroski-style)" />
        <div className="mt-2.5">
          <SectorMapPanel />
        </div>
      </div>

      {/* ============ 02 · OPTIONS DESK ============ */}
      <div id="in-options">
        <SectionLabel num="02" title="Options Desk" sub="NSE indices — live chain / BS model · PCR · max pain · GEX + gamma flip · strategies with POP" />
        <div className="mt-2.5">
          <OptionsDeskPanel />
        </div>
      </div>

      {/* ============ 02b · SWING DESK (India) ============ */}
      <div id="in-swing">
        <SectionLabel num="02b" title="Swing Desk" sub="multi-day India setups (analysis only) — 3–8 din horizon · 1.8×ATR stop · 2R/3R targets" />
        <div className="mt-2.5">
          <SwingDeskPanel market="INDIA" />
        </div>
      </div>

      {/* ============ 03 · EXECUTION CONSOLE (India venue) ============ */}
      <div id="in-execute">
        <SectionLabel num="03" title="Execution Console" sub="India positions + Dhan gauntlet — STRONG signals only · trailing SL · 15:15 square-off · audited" />
        <div className="mt-2.5">
          <OrderConsole
            state={state} positions={positions} entries={entries} busy={busy} venue="INDIA"
            onClose={onClose} onSaveConfig={onSaveConfig}
            dhan={dhan} onDhanConnect={async (id, tok) => { const r = await dhanConnect(id, tok); refreshDhan(); return r; }}
            onDhanDisconnect={async () => { const r = await dhanDisconnect(); refreshDhan(); return r; }}
            onDhanRefresh={refreshDhan}
          />
        </div>
      </div>

      {/* ============ 04 · BACKTEST LAB (India) ============ */}
      <div id="in-backtest">
        <SectionLabel num="04" title="Backtest Lab" sub="the SAME 10-model ensemble replayed on India history — win rate · avg R · equity curve · learned gates" />
        <div className="mt-2.5">
          <BacktestPanel market="INDIA" runBacktest={runBacktest} />
        </div>
      </div>

      {/* ============ 05 · ALERTS & AI KEYS ============ */}
      <div id="in-alerts">
        <SectionLabel num="05" title="Alerts & AI Keys" sub="Telegram pings on STRONG signals · AI Council keys — app se hi, Render env ki zaroorat nahi" />
        <div className="mt-2.5">
          <AlertsPanel fetchAlertsStatus={fetchAlertsStatus} saveAlertsConfig={saveAlertsConfig} testAlert={testAlert} busy={busy} notify={notify} />
        </div>
      </div>

      {/* ============ 06 · MODEL REGISTRY ============ */}
      <div id="in-models">
        <SectionLabel num="06" title="Model Registry" sub="the superintelligence bus — every analyst, weight & status" />
        <div className="mt-2.5">
          <ModelRegistry models={models} />
        </div>
      </div>

      {/* ============ 07 · SIGNAL LEDGER ============ */}
      <div id="in-ledger">
        <SectionLabel num="07" title="Signal Ledger" sub="SHA-256 hash chain — har executed signal provable, koi edit possible nahi (dono desks)" />
        <div className="mt-2.5">
          <SignalLedgerPanel />
        </div>
      </div>

      {/* ============ 07b · TRUST LAYER + PERFORMANCE (v6.11) ============ */}
      <div id="in-trust">
        <SectionLabel num="07b" title="Trust Layer + Performance Lab" sub="engine ki confidence kitni sahi hai — calibration · Brier · monthly trend · model p-values · MDD/Sharpe/Sortino" />
        <div className="mt-2.5 grid gap-3 lg:grid-cols-2">
          <TrustLayerPanel />
          <PerfAnalyticsPanel />
        </div>
      </div>

      {/* ============ DEEP ANALYSIS MODAL ============ */}
      {deep && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm" role="dialog" aria-modal="true" aria-label="Deep analysis"
          onClick={() => setDeep(null)}>
          <div className="quantum-panel rounded-2xl p-5 max-w-2xl w-full max-h-[85vh] overflow-y-auto animate-scale-in" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-black text-orange-300 tracking-wide">🔬 DEEP ENSEMBLE ANALYSIS</h3>
              <button onClick={() => setDeep(null)} className="quantum-btn-ghost px-2.5 py-1 rounded-lg text-xs font-black" aria-label="Close">✕</button>
            </div>
            {deep.loading && (
              <div className="py-12 text-center">
                <div className="text-4xl mb-3 animate-float">🧠</div>
                <div className="text-xs text-slate-400">Running a fresh 10-model ensemble on {deep.signal?.symbol ?? 'the symbol'}…</div>
              </div>
            )}
            {!deep.loading && deep.error && (
              <div className="py-8 text-center text-xs text-red-400 font-bold">⛔ {deep.error}</div>
            )}
            {!deep.loading && deep.signal && (
              <>
                <SignalCard signal={deep.signal} onExecuteIndia={onExecuteIndia} canLiveIndia={canLiveIndia} busy={busy}
                  orderBudgetINR={state?.config?.maxOrderINR} riskCapPct={board?.riskCap ?? state?.config?.maxRiskPct ?? 5}
                  indiaBudgetINR={state?.config?.indiaMaxOrderINR ?? 5000} />
                {deep.narrative && (
                  <div className="mt-3 bg-cyan-500/[0.05] border border-cyan-500/15 rounded-xl p-3" aria-label="regime narrative">
                    <div className="text-[10px] font-black text-cyan-300 tracking-wider mb-1.5">📖 EXPLAIN TICKER — {deep.narrative.title}</div>
                    <ul className="space-y-1">
                      {(deep.narrative.story || []).slice(0, 6).map((s, i) => (
                        <li key={i} className="text-[10px] text-slate-300 leading-relaxed">• {s}</li>
                      ))}
                    </ul>
                    <div className="text-[10px] text-amber-300/90 mt-1.5 font-bold">⚠️ {deep.narrative.watch}</div>
                  </div>
                )}
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
