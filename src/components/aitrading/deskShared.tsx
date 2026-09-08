// ============================================================
// src/components/aitrading/deskShared.tsx — v6.9 + v6.10
// ------------------------------------------------------------
// Shared building blocks for the two SPLIT desks (IndiaIntradayTab
// + CoinDcxTab): section labels, regime chips, breadth meter,
// board filters, refresh countdown, summary chips, the India
// how-to guide and the v6.10 DESK STATS quick-glance strip.
// Extracted from the old single AI Trading tab so each desk
// stays visually consistent while fully separate.
// ============================================================
import { memo, useEffect, useState } from 'react';
import type { MarketKind, SignalBoard } from './types';

export const REFRESH_MS = 30_000;

export function SectionLabel({ num, title, sub }: { num: string; title: string; sub?: string }) {
  return (
    <div className="flex items-baseline gap-2.5 pt-2">
      <span className="text-[10px] font-black font-mono text-cyan-500/70">{num}</span>
      <span className="text-sm font-black text-slate-100 tracking-wide uppercase">{title}</span>
      {sub && <span className="text-[10px] text-slate-500 hidden sm:inline">— {sub}</span>}
    </div>
  );
}

/** Live regime chips (NIFTY/VIX for India, BTC for crypto desks). */
export function RegimeChips({ board, market }: { board: SignalBoard | null; market: MarketKind }) {
  const regime = board?.regime;
  const chips = market === 'INDIA'
    ? [
        regime?.niftyChange != null ? { label: 'NIFTY', v: `${regime.niftyChange >= 0 ? '+' : ''}${regime.niftyChange.toFixed(2)}%`, bull: regime.niftyChange >= 0 } : null,
        regime?.indiaVix != null ? { label: 'VIX', v: regime.indiaVix.toFixed(1), bull: regime.indiaVix < 15 } : null,
      ].filter(Boolean) as { label: string; v: string; bull: boolean }[]
    : (regime?.btcChange != null ? [{ label: 'BTC 24h', v: `${regime.btcChange >= 0 ? '+' : ''}${regime.btcChange.toFixed(2)}%`, bull: regime.btcChange >= 0 }] : []);
  return (
    <>
      {chips.map(c => (
        <span key={c.label} className="px-2 py-1 rounded-lg bg-black/30 text-[10px] font-mono font-bold">
          <span className="text-slate-500">{c.label} </span>
          <span className={c.bull ? 'text-emerald-400' : 'text-red-400'}>{c.v}</span>
        </span>
      ))}
    </>
  );
}

/** Live bull/bear/flat breadth meter across the scanned universe. */
export const BreadthStrip = memo(function BreadthStrip({ board }: { board: SignalBoard | null }) {
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
});

export type BoardFilter = 'ALL' | 'ACTION' | 'STRONG' | 'LONG' | 'SHORT';

/** v6.10 DESK STATS — the one-glance "desk kaisa hai" strip:
 *  scanned universe · actionable · STRONG · avg confidence · breadth mood.
 *  Five compact stat tiles directly under the command bar so the user
 *  never has to scroll into the board to answer "aaj kuch hai kya?"
 *  Degrades to a slim placeholder while the first board loads. */
export const DeskStatsStrip = memo(function DeskStatsStrip({ board, deskLabel }: { board: SignalBoard | null; deskLabel: string }) {
  const sigs = board?.signals || [];
  const strong = sigs.filter(s => s.grade === 'STRONG').length;
  const actionable = sigs.filter(s => s.grade === 'ACTION' || s.grade === 'STRONG').length;
  const b = board?.breadth;
  const mood = b ? (b.bull - b.bear) : null;
  const moodTxt = mood == null ? '—' : mood > 25 ? 'RISK-ON' : mood < -25 ? 'RISK-OFF' : 'MIXED';
  const moodCls = mood == null ? 'text-slate-400' : mood > 25 ? 'text-emerald-400' : mood < -25 ? 'text-red-400' : 'text-amber-400';
  const stats: { label: string; value: string; cls?: string; title: string }[] = [
    { label: 'SCANNED', value: board ? `${board.scanned ?? 0}` : '…', title: 'Universe symbols the ensemble scanned' },
    { label: 'SIGNALS', value: `${sigs.length}`, title: 'Rows on the board (any grade)' },
    { label: 'ACTIONABLE', value: `${actionable}`, cls: actionable > 0 ? 'text-cyan-300' : 'text-slate-400', title: 'STRONG + ACTION — tradeable consensus' },
    { label: 'STRONG', value: `${strong}`, cls: strong > 0 ? 'text-emerald-300' : 'text-slate-400', title: 'Full-committee agreement (75%+ conf)' },
    { label: 'AVG CONF', value: b ? `${Math.round(b.avgConf ?? 0)}%` : '—', title: 'Average confidence across the board' },
    { label: 'MOOD', value: moodTxt, cls: moodCls, title: 'Breadth mood (bull − bear)' },
  ];
  return (
    <div className="quantum-panel rounded-2xl px-3.5 py-2.5" aria-label={`${deskLabel} desk stats`}>
      <div className="flex items-center gap-2 mb-2">
        <span className="text-[9px] font-black text-slate-400 tracking-widest">{deskLabel}</span>
        {b && (
          <span className="ml-auto text-[9px] font-mono text-slate-500">
            ▲{b.bull} ▼{b.bear} ·{b.flat}
          </span>
        )}
      </div>
      <div className="grid grid-cols-3 sm:grid-cols-6 gap-2">
        {stats.map(s => (
          <div key={s.label} className="bg-black/25 rounded-xl px-2 py-1.5 text-center" title={s.title}>
            <div className="text-[8px] font-black text-slate-500 tracking-wider">{s.label}</div>
            <div className={`text-sm font-black font-mono ${s.cls ?? 'text-slate-100'}`}>{s.value}</div>
          </div>
        ))}
      </div>
    </div>
  );
});

const FILTERS: { id: BoardFilter; label: string }[] = [
  { id: 'ALL', label: 'ALL' },
  { id: 'ACTION', label: '⚡ ACTIONABLE' },
  { id: 'STRONG', label: '★ STRONG' },
  { id: 'LONG', label: '▲ LONG' },
  { id: 'SHORT', label: '▼ SHORT' },
];

export function FilterChips({ filter, onChange, counts }: { filter: BoardFilter; onChange: (f: BoardFilter) => void; counts: Record<BoardFilter, number> }) {
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

/** Countdown ring to the next 30s auto-refresh. */
export function RefreshCountdown({ board, loading }: { board: SignalBoard | null; loading: boolean }) {
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

export function BoardSummary({ board }: { board: SignalBoard | null }) {
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

/** Board filter computation shared by both desks. */
export function filterSignals(board: SignalBoard | null, filter: BoardFilter) {
  const sigs = board?.signals || [];
  switch (filter) {
    case 'ACTION': return sigs.filter(s => s.grade === 'ACTION' || s.grade === 'STRONG');
    case 'STRONG': return sigs.filter(s => s.grade === 'STRONG');
    case 'LONG': return sigs.filter(s => s.side === 'LONG' && s.grade !== 'NEUTRAL');
    case 'SHORT': return sigs.filter(s => s.side === 'SHORT' && s.grade !== 'NEUTRAL');
    default: return sigs;
  }
}

export function countSignals(board: SignalBoard | null): Record<BoardFilter, number> {
  const sigs = board?.signals || [];
  return {
    ALL: sigs.length,
    ACTION: sigs.filter(s => s.grade === 'ACTION' || s.grade === 'STRONG').length,
    STRONG: sigs.filter(s => s.grade === 'STRONG').length,
    LONG: sigs.filter(s => s.side === 'LONG' && s.grade !== 'NEUTRAL').length,
    SHORT: sigs.filter(s => s.side === 'SHORT' && s.grade !== 'NEUTRAL').length,
  };
}

/** The "India me trade kaisa lein" answer, on the board itself —
 *  3-step manual broker flow. Collapsible, dismissal remembered. */
const HOWTO_KEY = 'ai-india-howto-dismissed';
export function IndiaHowToTrade() {
  const [open, setOpen] = useState(() => {
    try { return !localStorage.getItem(HOWTO_KEY); } catch { return true; }
  });
  const dismiss = () => {
    setOpen(false);
    try { localStorage.setItem(HOWTO_KEY, '1'); } catch { /* private mode */ }
  };
  if (!open) {
    return (
      <button onClick={() => setOpen(true)}
        className="quantum-btn-ghost px-3 py-1.5 rounded-xl text-[10px] font-black text-orange-300">
        🇮🇳 India trade kaise lein? — 3-step guide
      </button>
    );
  }
  return (
    <div className="quantum-panel rounded-2xl p-4 border border-orange-500/20 bg-gradient-to-r from-orange-500/[0.05] to-transparent">
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-black text-orange-300 tracking-wide">🇮🇳 INDIA DESK — SIGNAL SE TRADE TAK (3 steps)</span>
        <button onClick={dismiss} className="quantum-btn-ghost px-2 py-1 rounded-lg text-[10px] font-black" aria-label="Dismiss guide">✕ Got it</button>
      </div>
      <div className="grid gap-2 md:grid-cols-3 mt-2.5 text-[11px] leading-relaxed">
        <div className="bg-black/25 rounded-xl p-2.5">
          <div className="text-[10px] font-black text-cyan-300 mb-1">① TOP 5 / SIGNAL CHUNO (grade dekho)</div>
          <p className="text-slate-400">
            <b className="text-cyan-300">🏆 TOP 5 PICKS</b> = full 44-stock universe + NIFTY/BANKNIFTY scan ke baad composite rank (conf·agree·R:R·regime).
            <b className="text-cyan-300"> ★ STRONG</b> = full committee agree (75%+ conf) — highest accuracy.
            <b className="text-cyan-300"> ⚡ ACTION</b> (55%+) bhi tradeable hai.
            <span className="text-slate-500"> 9:30–14:30 ke beech entry best hai.</span>
          </p>
        </div>
        <div className="bg-black/25 rounded-xl p-2.5">
          <div className="text-[10px] font-black text-orange-300 mb-1">② 🚀 TRADE TICKET — one-click, sab pre-computed</div>
          <p className="text-slate-400">
            Pick ya card par <b className="text-cyan-300">🚀 TRADE</b> button dabao — <b>budget ₹ daalo, qty + ₹ risk @ SL + ₹ profit @ T2 + R:R sab instant</b>
            calculate ho jaata hai (same math server use karta hai). <b className="text-cyan-300">PAPER EXECUTE</b> one-click practice (watcher SL/TP + trailing + 15:15 square-off manage karega).
            Manual broker chahiye? <b className="text-orange-300">📋 Slip</b> button me risk-sized order slip + COPY for Zerodha/Upstox.
          </p>
        </div>
        <div className="bg-black/25 rounded-xl p-2.5">
          <div className="text-[10px] font-black text-violet-300 mb-1">③ DHAN LIVE ya OPTIONS DESK (small capital)</div>
          <p className="text-slate-400">
            <span className="text-emerald-300"><b>Dhan broker connect</b> karke (Execution Console me) STRONG India signals par direct <b>LIVE execution</b> — entry market order + broker SL-M + 15:15 square-off, sab automated.</span>
            Capital kam hai ya index pe trade karna hai? Neeche <b className="text-violet-300">Options Desk</b>
            me NIFTY/BANKNIFTY ki ready strategies (spread/condor) — legs, max profit/loss, breakeven sab priced.
          </p>
        </div>
      </div>
      <p className="text-[10px] text-slate-500 mt-2">
        Crypto/CoinDCX ab apna alag tab hai (₿ CoinDCX) — wahan wallet + SPOT + GLOBAL FUTURES + Auto-Agent sab ek jagah. Intraday rules: square-off 15:15 IST (LIVE par watcher + broker dono enforce karte hain), opening 15 min avoid karo — LIVE entries 09:30–15:00 tak hi open hoti hain.
      </p>
    </div>
  );
}
