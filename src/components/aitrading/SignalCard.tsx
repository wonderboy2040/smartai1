// ============================================================
// src/components/aitrading/SignalCard.tsx
// ------------------------------------------------------------
// One consensus signal, expanded: confidence gauge, trade plan,
// every model's vote with reasons, AI Council note, and (crypto)
// the gated Execute buttons — PAPER always available, LIVE only
// for STRONG + executable signals.
// ============================================================
import { memo, useState } from 'react';
import type { AISignal, Side } from './types';

const fmt = (n: number | null | undefined, dp = 2): string => {
  if (n == null || !Number.isFinite(n)) return '—';
  if (Math.abs(n) >= 1e7) return `₹${(n / 1e7).toFixed(2)}Cr`;
  if (Math.abs(n) >= 1e5) return `₹${(n / 1e5).toFixed(2)}L`;
  return `₹${n.toLocaleString('en-IN', { maximumFractionDigits: dp })}`;
};

const sideColor = (side: Side | string) =>
  side === 'LONG' ? 'text-emerald-400' : side === 'SHORT' ? 'text-red-400' : 'text-slate-400';

const gradeBadge = (grade: string) => {
  switch (grade) {
    case 'STRONG': return { cls: 'bg-emerald-500/15 text-emerald-300 border border-emerald-500/40', label: '★ STRONG' };
    case 'ACTION': return { cls: 'bg-cyan-500/15 text-cyan-300 border border-cyan-500/40', label: 'ACTION' };
    case 'WATCH': return { cls: 'bg-amber-500/15 text-amber-300 border border-amber-500/40', label: 'WATCH' };
    default: return { cls: 'bg-slate-500/15 text-slate-400 border border-slate-500/30', label: 'NEUTRAL' };
  }
};

function ConfidenceGauge({ value, side }: { value: number; side: string }) {
  const r = 26, c = 2 * Math.PI * r;
  const pct = Math.max(0, Math.min(100, value)) / 100;
  const stroke = side === 'LONG' ? '#34d399' : side === 'SHORT' ? '#f87171' : '#94a3b8';
  return (
    <div className="relative w-16 h-16 shrink-0" role="img" aria-label={`confidence ${value}%`}>
      <svg viewBox="0 0 64 64" className="w-16 h-16 -rotate-90">
        <circle cx="32" cy="32" r={r} fill="none" stroke="rgba(148,163,184,0.15)" strokeWidth="6" />
        <circle cx="32" cy="32" r={r} fill="none" stroke={stroke} strokeWidth="6" strokeLinecap="round"
          strokeDasharray={`${c * pct} ${c}`} className="transition-all duration-700" />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className={`text-sm font-black font-mono ${sideColor(side)}`}>{value}</span>
        <span className="text-[8px] text-slate-500 font-bold tracking-wider">CONF</span>
      </div>
    </div>
  );
}

function VoteChip({ vote }: { vote: AISignal['votes'][number] }) {
  const dir = vote.dir > 0 ? 'BULL' : vote.dir < 0 ? 'BEAR' : 'FLAT';
  const cls = vote.dir > 0
    ? 'bg-emerald-500/10 text-emerald-300 border-emerald-500/25'
    : vote.dir < 0
      ? 'bg-red-500/10 text-red-300 border-red-500/25'
      : 'bg-slate-600/20 text-slate-400 border-slate-600/30';
  return (
    <div className={`px-2 py-1 rounded-lg border text-[10px] font-bold ${cls} flex items-center gap-1.5`} title={vote.role}>
      <span className="font-mono">{vote.name.split(' ')[0]}</span>
      <span className="opacity-60">w{vote.weight}</span>
      <span className="font-mono">{dir === 'FLAT' ? '·' : dir === 'BULL' ? '▲' : '▼'}{vote.conf || '—'}</span>
    </div>
  );
}

interface Props {
  signal: AISignal;
  busy?: boolean;
  onExecute?: (signal: AISignal, mode: 'paper' | 'live') => void;
  onDeep?: (signal: AISignal) => void;
  canLive?: boolean;
}

export const SignalCard = memo(function SignalCard({ signal, busy, onExecute, onDeep, canLive }: Props) {
  const [expanded, setExpanded] = useState(false);
  const g = gradeBadge(signal.grade);
  const long = signal.side === 'LONG';

  return (
    <div className={`quantum-panel rounded-2xl p-4 transition-all hover:border-cyan-500/20 ${signal.grade === 'STRONG' ? 'ring-1 ring-emerald-500/40' : ''}`}>
      {/* Header row */}
      <div className="flex items-center gap-3 flex-wrap">
        <ConfidenceGauge value={signal.confidence} side={signal.side} />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-base font-black text-white font-mono tracking-wide">{signal.symbol}</span>
            <span className={`text-sm font-black ${sideColor(signal.side)}`}>{long ? '▲ LONG' : '▼ SHORT'}</span>
            <span className={`px-2 py-0.5 rounded-md text-[10px] font-black tracking-wider ${g.cls}`}>{g.label}</span>
            {signal.market === 'CRYPTO' && signal.executable && (
              <span className="px-1.5 py-0.5 rounded bg-emerald-500/15 text-emerald-300 text-[9px] font-bold border border-emerald-500/30">⚡ EXECUTION-ELIGIBLE</span>
            )}
            {signal.market === 'INDIA' && signal.grade === 'STRONG' && (
              <span className="px-1.5 py-0.5 rounded bg-violet-500/15 text-violet-300 text-[9px] font-bold border border-violet-500/30">🎯 OPTIONS STRATEGY</span>
            )}
          </div>
          <div className="flex items-center gap-3 mt-1 text-xs text-slate-400 flex-wrap">
            <span className="font-mono font-bold text-slate-200">{fmt(signal.ltp)}</span>
            {signal.changePct != null && (
              <span className={`font-mono font-bold ${(signal.changePct ?? 0) >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                {(signal.changePct ?? 0) >= 0 ? '+' : ''}{signal.changePct?.toFixed(2)}%
              </span>
            )}
            <span className="text-slate-500">·</span>
            <span>{signal.participating}/{signal.totalModels} models</span>
            <span className="text-slate-500">·</span>
            <span>{Math.round((signal.agreement || 0) * 100)}% agree</span>
          </div>
        </div>
        <div className="flex gap-1.5">
          <button onClick={() => setExpanded(v => !v)}
            className="quantum-btn-ghost px-2.5 py-1.5 rounded-lg text-[11px] font-bold"
            aria-expanded={expanded}>
            {expanded ? '▲ Less' : '▼ Models'}
          </button>
          {onDeep && (
            <button onClick={() => onDeep(signal)} className="quantum-btn-ghost px-2.5 py-1.5 rounded-lg text-[11px] font-bold" title="Deep analysis">🔬</button>
          )}
        </div>
      </div>

      {/* Trade plan strip */}
      {signal.plan && (
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-1.5 mt-3">
          {[
            { l: 'ENTRY', v: fmt(signal.plan.entry), c: 'text-cyan-300' },
            { l: 'STOP', v: fmt(signal.plan.stopLoss), c: 'text-red-300' },
            { l: 'TARGET 1', v: fmt(signal.plan.target1), c: 'text-emerald-300' },
            { l: 'TARGET 2', v: fmt(signal.plan.target2), c: 'text-emerald-400' },
            { l: 'R:R', v: `1:${signal.plan.rewardRisk}`, c: 'text-amber-300' },
          ].map(x => (
            <div key={x.l} className="bg-black/30 rounded-lg px-2 py-1.5 text-center">
              <div className="text-[8px] text-slate-500 font-black tracking-wider">{x.l}</div>
              <div className={`text-xs font-mono font-bold ${x.c}`}>{x.v}</div>
            </div>
          ))}
        </div>
      )}

      {/* Model votes */}
      {expanded && (
        <div className="mt-3 space-y-2.5">
          <div className="flex flex-wrap gap-1.5">
            {signal.votes.map(v => <VoteChip key={v.id} vote={v} />)}
          </div>
          <div className="max-h-48 overflow-y-auto space-y-1.5 pr-1">
            {signal.votes.filter(v => v.dir !== 0 || v.reasons.length).map(v => (
              <div key={v.id} className="bg-black/20 rounded-lg px-3 py-2">
                <div className="flex items-center gap-2">
                  <span className="text-[11px] font-bold text-slate-200">{v.name}</span>
                  <span className={`text-[10px] font-black ${sideColor(v.dir > 0 ? 'LONG' : v.dir < 0 ? 'SHORT' : 'FLAT')}`}>
                    {v.dir > 0 ? 'BULL' : v.dir < 0 ? 'BEAR' : 'ABSTAIN'} {v.conf}%
                  </span>
                </div>
                {v.reasons.length > 0 && (
                  <ul className="mt-1 text-[11px] text-slate-400 leading-relaxed">
                    {v.reasons.map((r, i) => <li key={i}>• {r}</li>)}
                  </ul>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* AI Council note */}
      {signal.aiNote && (
        <div className="mt-2.5 bg-gradient-to-r from-violet-500/10 to-transparent rounded-xl px-3 py-2 border border-violet-500/20">
          <div className="flex items-center gap-2 text-[10px] font-black text-violet-300 tracking-wider">
            🧠 AI COUNCIL · {signal.aiNote.model || 'LLM'} — {signal.aiNote.verdict}
          </div>
          {signal.aiNote.analysis && <p className="text-[11px] text-slate-300 mt-1 leading-relaxed">{signal.aiNote.analysis}</p>}
        </div>
      )}

      {/* Execution buttons (crypto only) */}
      {signal.market === 'CRYPTO' && onExecute && (
        <div className="mt-3 flex flex-wrap gap-2">
          <button
            onClick={() => onExecute(signal, 'paper')}
            disabled={busy}
            className="quantum-btn-primary px-4 py-2 rounded-xl text-xs font-black bg-gradient-to-r from-cyan-600 to-indigo-600 disabled:opacity-50">
            🧪 PAPER TRADE
          </button>
          {signal.grade === 'STRONG' && signal.executable && (
            <button
              onClick={() => onExecute(signal, 'live')}
              disabled={busy || !canLive}
              title={canLive ? 'Place a REAL CoinDCX order (all gates re-verified server-side)' : 'Signal is STRONG — enable LIVE mode in the console to arm execution'}
              className="px-4 py-2 rounded-xl text-xs font-black bg-gradient-to-r from-emerald-600 to-teal-600 text-white hover:from-emerald-500 hover:to-teal-500 disabled:opacity-40 disabled:cursor-not-allowed transition-all">
              ⚡ EXECUTE LIVE ₹
            </button>
          )}
          {signal.grade !== 'STRONG' && (
            <span className="text-[10px] text-slate-500 self-center px-1">LIVE execution locked — needs STRONG (75%+ conf, 70%+ agreement)</span>
          )}
        </div>
      )}
    </div>
  );
});
