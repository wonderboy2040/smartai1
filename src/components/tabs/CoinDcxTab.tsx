// ============================================================
// src/components/tabs/CoinDcxTab.tsx — v6.10 COINDCX DESK
// ------------------------------------------------------------
// The CoinDCX half of the old AI Trading tab, now a SELF-CONTAINED
// desk — nothing NSE on this screen:
//   ┌ COMMAND BAR      BTC regime · engine status · refresh
//   ├ DESK SWITCHER    ₿ SPOT (INR pairs)  |  ⚡ GLOBAL FUTURES (USDT perps)
//   ├ QUICK NAV        sticky section jump chips
//   ├ 📊 DESK STATS    v6.10 one-glance strip of the active desk
//   ├ 00 AUTO-AGENT    superintelligence auto entry/exit (3 trades/day)
//   ├ 📱 WALLET        spot + futures + equity — "wallet me kitna hai"
//   ├ 🏆 TOP 5 PICKS   composite ranking of the active desk's universe
//   ├ 01 SIGNAL BOARD  10-model consensus cards · trade tickets
//   ├ 01b MORNING BRIEF · 02b SWING+WHALES+ORDERBOOK
//   ├ 03 EXECUTION     spot+futures positions · leverage · risk gates
//   └ 04 BACKTEST · 05 ALERTS · 06 MODELS · 07 LEDGER
// ============================================================
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useAITrading, fetchWallet } from '../aitrading/useAITrading';
import { SignalCard } from '../aitrading/SignalCard';
import { TopPicksPanel } from '../aitrading/TopPicksPanel';
import { QuickNav } from '../aitrading/QuickNav';
import { OrderConsole } from '../aitrading/OrderConsole';
import { ModelRegistry } from '../aitrading/ModelRegistry';
import { BacktestPanel } from '../aitrading/BacktestPanel';
import { AlertsPanel } from '../aitrading/AlertsPanel';
import { AgentPanel } from '../aitrading/AgentPanel';
import { MorningBriefPanel, SwingDeskPanel, WhaleRadarPanel, SignalLedgerPanel, OrderbookPanel, TrustLayerPanel, PerfAnalyticsPanel, CorrelationPanel } from '../aitrading/ProPanels';
import {
  SectionLabel, RegimeChips, BreadthStrip, FilterChips, RefreshCountdown, BoardSummary, DeskStatsStrip,
  filterSignals, countSignals, type BoardFilter,
} from '../aitrading/deskShared';
import type { AISignal, SignalBoard, WalletView } from '../aitrading/types';

const NAV = [
  { id: 'cx-agent', label: 'AGENT', emoji: '🤖' },
  { id: 'cx-top5', label: 'TOP 5', emoji: '🏆' },
  { id: 'cx-signals', label: 'SIGNALS', emoji: '📡' },
  { id: 'cx-whales', label: 'WHALES', emoji: '🐋' },
  { id: 'cx-execute', label: 'EXECUTE', emoji: '⚙️' },
  { id: 'cx-backtest', label: 'BACKTEST', emoji: '🧪' },
  { id: 'cx-alerts', label: 'ALERTS', emoji: '🔔' },
  { id: 'cx-models', label: 'MODELS', emoji: '🧠' },
  { id: 'cx-ledger', label: 'LEDGER', emoji: '🔗' },
];

/** v6.9: prominent wallet card — spot INR + USDT, futures margin, equity.
 *  The "wallet me kitna hai / kitna bacha hai" answer at the top of the
 *  CoinDCX desk. 60s poll, honest degrade (CF-block / no keys note). */
const WalletCard = memo(function WalletCard() {
  const [w, setW] = useState<WalletView | null>(null);
  useEffect(() => {
    let alive = true;
    const load = () => { fetchWallet().then(x => { if (alive) setW(x); }).catch(() => {}); };
    load();
    const t = setInterval(() => { if (!alive) return; if (!document.hidden) load(); }, 60_000);
    return () => { alive = false; clearInterval(t); };
  }, []);
  const inr = w?.spot?.inr as { free?: number; locked?: number } | undefined;
  const usdt = w?.spot?.usdt as { free?: number; locked?: number } | undefined;
  const fut = w?.futures?.usdt as { free?: number; locked?: number; crossUserMargin?: number | null } | undefined;
  const err = w?.spot?.error || w?.futures?.error;
  return (
    <div className="quantum-panel rounded-2xl p-4 bg-gradient-to-br from-amber-500/[0.06] via-transparent to-violet-500/[0.05] border border-amber-500/15" aria-label="CoinDCX wallet">
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-xs font-black tracking-wider text-amber-300">📱 COINDCX WALLET</span>
        {w && (
          <span className={`px-2 py-0.5 rounded-lg text-[9px] font-black border ${w.connected
            ? 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30'
            : 'bg-slate-600/20 text-slate-400 border-slate-600/30'}`}>
            {w.connected ? 'LIVE · API CONNECTED' : 'PAPER (API keys nahi mili — Portfolio tab se connect karo)'}
          </span>
        )}
        {!w && <span className="text-[10px] text-slate-500">loading…</span>}
        {w?.usdInr != null && <span className="ml-auto text-[10px] font-mono font-bold text-slate-500">USD/₹ {w.usdInr}</span>}
      </div>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-2 mt-3">
        <div className="bg-black/25 rounded-xl p-2.5 text-center">
          <div className="text-[9px] font-black text-slate-500 tracking-wider">SPOT INR (free)</div>
          <div className="text-sm font-black font-mono text-emerald-300">{inr?.free != null ? `₹${inr.free.toLocaleString('en-IN', { maximumFractionDigits: 0 })}` : '—'}</div>
          {inr?.locked != null && inr.locked > 0 && <div className="text-[9px] font-mono text-slate-500">locked ₹{Math.round(inr.locked).toLocaleString('en-IN')}</div>}
        </div>
        <div className="bg-black/25 rounded-xl p-2.5 text-center">
          <div className="text-[9px] font-black text-slate-500 tracking-wider">SPOT USDT (free)</div>
          <div className="text-sm font-black font-mono text-cyan-300">{usdt?.free != null ? `${usdt.free.toLocaleString('en-US', { maximumFractionDigits: 2 })}` : '—'}</div>
        </div>
        <div className="bg-black/25 rounded-xl p-2.5 text-center">
          <div className="text-[9px] font-black text-slate-500 tracking-wider">FUTURES MARGIN (USDT)</div>
          <div className="text-sm font-black font-mono text-violet-300">{fut?.free != null ? `${fut.free.toLocaleString('en-US', { maximumFractionDigits: 2 })}` : '—'}</div>
          {fut?.crossUserMargin != null && fut.crossUserMargin > 0 && <div className="text-[9px] font-mono text-amber-400/80">cross {fut.crossUserMargin.toFixed(2)}</div>}
        </div>
        <div className="bg-black/25 rounded-xl p-2.5 text-center">
          <div className="text-[9px] font-black text-slate-500 tracking-wider">TOTAL EQUITY (₹)</div>
          <div className="text-sm font-black font-mono text-amber-200">{w?.equityINR != null ? `₹${Math.round(w.equityINR).toLocaleString('en-IN')}` : '—'}</div>
          <div className="text-[9px] text-slate-600">spot + futures @ live USD/₹</div>
        </div>
      </div>
      {err && <div className="text-[9px] text-amber-500/80 mt-1.5 font-mono">⚠ {err}</div>}
    </div>
  );
});

export default memo(function CoinDcxTab() {
  // v6.9: CoinDCX-scoped loading — spot + futures boards only.
  const t = useAITrading(true, { markets: ['CRYPTO', 'FUTURES'] });
  const { crypto, futures, state, positions, entries, loading, busy, refresh, executeSignal, executeFutures, updateConfig, closePos, fetchDeep } = t;
  const { runBacktest, fetchAlertsStatus, saveAlertsConfig, testAlert } = t;
  const [desk, setDesk] = useState<'CRYPTO' | 'FUTURES'>('CRYPTO');
  const [toast, setToast] = useState<{ ok: boolean; text: string } | null>(null);
  const [filter, setFilter] = useState<BoardFilter>('ALL');
  const [deep, setDeep] = useState<{ loading: boolean; signal?: AISignal; indicators?: Record<string, unknown>; narrative?: import('../aitrading/types').NarrativeView | null; error?: string } | null>(null);

  const board: SignalBoard | null = desk === 'FUTURES' ? futures : crypto;
  const models = board?.models || crypto?.models || futures?.models || [];
  const canLive = state?.config?.mode === 'live' && !state?.blocked?.notConnected;

  // Track which ACTIONABLE symbols were NOT in the previous board → flash them.
  const prevTopRef = useRef<Set<string>>(new Set());
  const newSymbols = useMemo(() => {
    const actionable = (board?.signals || []).filter(s => s.grade === 'ACTION' || s.grade === 'STRONG');
    const now = new Set(actionable.map(s => s.symbol));
    const fresh = actionable.filter(s => !prevTopRef.current.has(s.symbol)).map(s => s.symbol);
    if (board?.generatedAt) queueMicrotask(() => { prevTopRef.current = now; });
    return new Set(fresh);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [board?.generatedAt, desk]);

  const notify = useCallback((ok: boolean, text: string) => {
    setToast({ ok, text });
    setTimeout(() => setToast(null), 6000);
  }, []);

  const onExecute = useCallback(async (signal: AISignal, mode: 'paper' | 'live' | 'notify', opts?: { qtyINR?: number; leverage?: number }) => {
    const r = await executeSignal(signal, mode, opts);
    if (r.ok) {
      const levTag = r.filled?.leverage ? ` · ${r.filled.leverage}x margin (₹${Math.round(r.filled.marginINR ?? 0)})` : '';
      notify(true, mode === 'live'
        ? `✅ LIVE order placed — ${signal.symbol} ${signal.side} · qty ${r.filled?.qty} @ ₹${r.filled?.price}${levTag}${r.fitted ? ` · ⚙️ ${r.fitted}` : ''}`
        : `🧪 Paper trade opened — ${signal.symbol} ${signal.side} · qty ${r.filled?.qty} @ ₹${r.filled?.price}${levTag}${r.fitted ? ` · ⚙️ ${r.fitted}` : ''}`);
    } else {
      notify(false, `⛔ ${r.error || 'execution failed'}`);
    }
  }, [executeSignal, notify]);

  // v6.8: GLOBAL FUTURES gauntlet (USDT perpetuals) — same handler shape.
  const onExecuteFutures = useCallback(async (signal: AISignal, mode: 'paper' | 'live' | 'notify', opts?: { qtyINR?: number; marginUSDT?: number; leverage?: number }) => {
    const r = await executeFutures(signal, mode, opts);
    if (r.ok) {
      const levTag = r.filled?.leverage ? ` · ${r.filled.leverage}x · margin ${Math.round((r.filled as { marginUSDT?: number }).marginUSDT ?? 0)} USDT` : '';
      notify(true, mode === 'live'
        ? `✅ FUTURES LIVE order placed — ${signal.symbol} ${signal.side} · ${r.filled?.qty} @ ${r.filled?.price}${levTag}${r.fitted ? ` · ⚙️ ${r.fitted}` : ''}`
        : `🧪 Futures paper trade opened — ${signal.symbol} ${signal.side} · ${r.filled?.qty} @ ${r.filled?.price}${levTag}${r.fitted ? ` · ⚙️ ${r.fitted}` : ''}`);
    } else {
      notify(false, `⛔ ${r.error || 'execution failed'}`);
    }
  }, [executeFutures, notify]);

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
      {/* ============ COMMAND BAR (CoinDCX-branded) ============ */}
      <div className="quantum-panel rounded-2xl p-4 bg-gradient-to-r from-amber-500/[0.07] via-transparent to-violet-500/[0.06] border border-amber-500/15">
        <div className="flex items-center gap-3 flex-wrap">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <h2 className="text-base font-black tracking-wide bg-gradient-to-r from-amber-300 to-yellow-200 bg-clip-text text-transparent">₿ COINDCX DESK</h2>
              <span className="quantum-badge">v6.10</span>
            </div>
            <p className="text-[10px] text-slate-500 mt-0.5">
              SPOT (INR) + ⚡ GLOBAL FUTURES (USDT perps) · wallet · leverage · auto-agent
              {canLive && <span className="text-red-400 font-black"> · LIVE EXECUTION ARMED</span>}
              <span className="text-amber-400/80 font-bold"> · India/NSE alag tab me (🇮🇳 India)</span>
            </p>
          </div>
          <div className="ml-auto flex items-center gap-2 flex-wrap">
            <RegimeChips board={board} market="CRYPTO" />
            <RefreshCountdown board={board} loading={loading} />
            <button onClick={refresh} disabled={loading}
              className="quantum-btn-ghost px-3 py-2 rounded-xl text-xs font-bold disabled:opacity-50">
              <span className={loading ? 'inline-block animate-spin' : ''}>🔄</span>
            </button>
          </div>
        </div>
        <div className="mt-3">
          {/* Desk switcher: SPOT vs GLOBAL FUTURES (dono CoinDCX ke hain —
              isliye ye tab ke ANDAR hai; India alag top-level tab hai). */}
          <div className="flex gap-1 quantum-panel p-1 rounded-2xl w-full sm:w-auto" role="tablist" aria-label="CoinDCX desk">
            <button onClick={() => setDesk('CRYPTO')} role="tab" aria-pressed={desk === 'CRYPTO'}
              className={`flex-1 sm:flex-none px-4 py-2.5 rounded-xl text-xs font-black transition-colors flex items-center gap-2 ${desk === 'CRYPTO' ? 'bg-gradient-to-r from-amber-600 to-yellow-600 text-white shadow-lg shadow-amber-500/20' : 'text-slate-400 hover:text-slate-200'}`}>
              ₿ SPOT
              <span className="px-1.5 py-0.5 rounded text-[9px] font-mono bg-emerald-500/20 text-emerald-300">INR · 24/7</span>
            </button>
            <button onClick={() => setDesk('FUTURES')} role="tab" aria-pressed={desk === 'FUTURES'}
              className={`flex-1 sm:flex-none px-4 py-2.5 rounded-xl text-xs font-black transition-colors flex items-center gap-2 ${desk === 'FUTURES' ? 'bg-gradient-to-r from-violet-600 to-fuchsia-600 text-white shadow-lg shadow-violet-500/20' : 'text-slate-400 hover:text-slate-200'}`}>
              ⚡ GLOBAL FUTURES
              <span className="px-1.5 py-0.5 rounded text-[9px] font-mono bg-violet-500/20 text-violet-300">USDT · 24/7</span>
            </button>
          </div>
        </div>
      </div>

      {/* ============ STICKY QUICK NAV (v6.9) ============ */}
      <QuickNav items={NAV} />

      {/* ============ 📊 DESK STATS (v6.10 — active desk one-glance) ============ */}
      <DeskStatsStrip board={board} deskLabel={desk === 'FUTURES' ? '⚡ FUTURES DESK SNAPSHOT' : '₿ SPOT DESK SNAPSHOT'} />

      {/* ============ 00 · SUPERINTELLIGENCE AUTO-AGENT ============ */}
      <div id="cx-agent">
        <SectionLabel num="00" title="Superintelligence Auto-Agent" sub="wallet-fetch · auto entry/exit · daily 3 trades · SL-based sizing — CoinDCX spot + futures, sab gauntlet-gated" />
        <div className="mt-2.5">
          <AgentPanel notify={notify} />
        </div>
      </div>

      {/* ============ 📱 WALLET (v6.9 — "wallet me kitna hai") ============ */}
      <WalletCard />

      {/* toast */}
      {toast && (
        <div className={`quantum-panel rounded-xl px-4 py-2.5 text-xs font-bold border ${toast.ok ? 'border-emerald-500/40 text-emerald-300' : 'border-red-500/40 text-red-300'}`}
          role="status" aria-live="polite">
          {toast.text}
        </div>
      )}

      {/* ============ 🏆 TOP 5 PICKS (v6.9) ============ */}
      <div id="cx-top5">
        <TopPicksPanel picks={board?.topFive} market={desk} deskLabel={desk === 'FUTURES' ? '⚡ COINDCX GLOBAL FUTURES · USDT' : '₿ COINDCX SPOT · INR'} scanned={board?.scanned} loading={loading} onDeep={onDeep} />
      </div>

      {/* ============ MARKET BREADTH ============ */}
      <BreadthStrip board={board} />

      {/* ============ 01 · SIGNAL BOARD ============ */}
      <div id="cx-signals">
        <div className="flex items-end justify-between flex-wrap gap-2">
          <SectionLabel num="01" title="Signal Board" sub={desk === 'FUTURES' ? 'CoinDCX GLOBAL FUTURES (USDT perpetuals, RT prices) → 10-model consensus' : 'CoinDCX crypto majors → 10-model consensus (SMC/ICT included)'} />
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
              <div className="text-sm text-slate-400 font-medium">Ensemble scanning {desk === 'FUTURES' ? 'the futures universe' : 'crypto majors'}…</div>
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
            <SignalCard key={`${s.market}-${s.symbol}`} signal={s} busy={busy}
              onExecute={desk === 'CRYPTO' ? onExecute : undefined}
              onExecuteFutures={desk === 'FUTURES' ? onExecuteFutures : undefined}
              onDeep={onDeep}
              canLive={canLive} isNew={newSymbols.has(s.symbol)}
              orderBudgetINR={state?.config?.maxOrderINR} riskCapPct={board?.riskCap ?? state?.config?.maxRiskPct ?? 5}
              maxLeverage={state?.config?.cryptoLeverage ?? 1} />
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
      <div id="cx-brief">
        <SectionLabel num="01b" title="Morning Brief" sub="ek nazar me poora desk — market · top signals · open book · guards · ledger" />
        <div className="mt-2.5">
          <MorningBriefPanel />
        </div>
      </div>

      {/* ============ 02b · SWING DESK + WHALE RADAR + ORDERBOOK ============ */}
      <div id="cx-whales">
        <SectionLabel num="02b" title="Swing Desk + Whale Radar + Orderbook" sub="multi-day crypto setups · volume-spike footprints · live book imbalance" />
        <div className="mt-2.5 grid gap-3 xl:grid-cols-2">
          <SwingDeskPanel market="CRYPTO" />
          <div className="space-y-3">
            <WhaleRadarPanel market="CRYPTO" />
            <OrderbookPanel />
          </div>
        </div>
      </div>

      {/* ============ 02c · CROSS-ASSET CORRELATIONS (v6.11) ============ */}
      <div id="cx-corr">
        <SectionLabel num="02c" title="Cross-Asset Correlations" sub="60d returns — NIFTY + sectors + GOLD/CRUDE/DXY/USVIX + BTC/ETH · BTC↔NIFTY risk link · hidden concentration visible" />
        <div className="mt-2.5">
          <CorrelationPanel />
        </div>
      </div>

      {/* ============ 03 · EXECUTION CONSOLE (CoinDCX venue) ============ */}
      <div id="cx-execute">
        <SectionLabel num="03" title="Execution Console" sub="CoinDCX spot + futures positions · leverage · native TP/SL · trailing · risk-gated · audited" />
        <div className="mt-2.5">
          <OrderConsole
            state={state} positions={positions} entries={entries} busy={busy} venue="COINDCX"
            onClose={onClose} onSaveConfig={onSaveConfig}
            dhan={null} onDhanConnect={async () => ({ ok: false, error: 'India desk me jao (🇮🇳 India tab)' })} onDhanDisconnect={async () => ({ ok: false, error: 'n/a' })} onDhanRefresh={() => {}}
          />
        </div>
      </div>

      {/* ============ 04 · BACKTEST LAB (crypto) ============ */}
      <div id="cx-backtest">
        <SectionLabel num="04" title="Backtest Lab" sub="the SAME 10-model ensemble replayed on crypto history — win rate · avg R · equity curve · learned gates" />
        <div className="mt-2.5">
          <BacktestPanel market="CRYPTO" runBacktest={runBacktest} />
        </div>
      </div>

      {/* ============ 05 · ALERTS & AI KEYS ============ */}
      <div id="cx-alerts">
        <SectionLabel num="05" title="Alerts & AI Keys" sub="Telegram pings on STRONG signals · AI Council keys — app se hi, Render env ki zaroorat nahi" />
        <div className="mt-2.5">
          <AlertsPanel fetchAlertsStatus={fetchAlertsStatus} saveAlertsConfig={saveAlertsConfig} testAlert={testAlert} busy={busy} notify={notify} />
        </div>
      </div>

      {/* ============ 06 · MODEL REGISTRY ============ */}
      <div id="cx-models">
        <SectionLabel num="06" title="Model Registry" sub="the superintelligence bus — every analyst, weight & status" />
        <div className="mt-2.5">
          <ModelRegistry models={models} />
        </div>
      </div>

      {/* ============ 07 · SIGNAL LEDGER ============ */}
      <div id="cx-ledger">
        <SectionLabel num="07" title="Signal Ledger" sub="SHA-256 hash chain — har executed signal provable, koi edit possible nahi (dono desks)" />
        <div className="mt-2.5">
          <SignalLedgerPanel />
        </div>
      </div>

      {/* ============ 07b · TRUST LAYER + PERFORMANCE (v6.11) ============ */}
      <div id="cx-trust">
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
              <h3 className="text-sm font-black text-amber-300 tracking-wide">🔬 DEEP ENSEMBLE ANALYSIS</h3>
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
                <SignalCard signal={deep.signal} onExecute={onExecute} onExecuteFutures={onExecuteFutures} canLive={canLive} busy={busy}
                  orderBudgetINR={state?.config?.maxOrderINR} riskCapPct={board?.riskCap ?? state?.config?.maxRiskPct ?? 5}
                  maxLeverage={state?.config?.cryptoLeverage ?? 1} />
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
