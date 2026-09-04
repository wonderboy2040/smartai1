// ============================================================
// src/components/aitrading/SignalCard.tsx
// ------------------------------------------------------------
// One consensus signal, expanded: confidence gauge, trade plan,
// every model's vote with reasons, AI Council note.
//
// v6.4 —
//   • INDIA: 📋 TRADE SLIP — risk-based position sizing (qty from
//     YOUR ₹ risk budget ÷ stop distance), capital needed, ₹ P&L
//     at T1/T2, order-type guidance (LIMIT band / SL-M trigger /
//     square-off 15:15) and one-tap COPY for the broker terminal.
//     This answers "India me trade kaisa lein" on the card itself.
//   • CRYPTO: order preview (₹ budget → qty → ₹ risk at SL, ₹
//     reward at T2) + risk-auto-fit transparency chip when the
//     structural ATR stop was fitted to the configured cap.
//   • PAPER always available; LIVE only for STRONG + executable
//     crypto signals.
// ============================================================
import { memo, useCallback, useEffect, useState } from 'react';
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

// ---------------- v6.4: INDIA TRADE SLIP ----------------
const RISK_KEY = 'ai-india-risk-inr';
const loadRiskBudget = (): number => {
  try {
    const v = Number(localStorage.getItem(RISK_KEY));
    return Number.isFinite(v) && v >= 50 && v <= 1_000_000 ? v : 500;
  } catch { return 500; }
};

function IndiaTradeSlip({ signal }: { signal: AISignal }) {
  const plan = signal.plan!;
  const long = signal.side === 'LONG';
  const [budget, setBudget] = useState<number>(loadRiskBudget);
  const [copied, setCopied] = useState(false);
  useEffect(() => { setBudget(loadRiskBudget()); }, []);

  const stopDist = Math.abs(plan.entry - plan.stopLoss);
  const t1Dist = Math.abs(plan.target1 - plan.entry);
  const t2Dist = Math.abs(plan.target2 - plan.entry);
  const qty = stopDist > 0 ? Math.floor(budget / stopDist) : 0;
  const capital = qty * plan.entry;
  const actualRisk = qty * stopDist;
  const profitT1 = qty * t1Dist;
  const profitT2 = qty * t2Dist;
  const bandLo = plan.entry * 0.9985, bandHi = plan.entry * 1.0015;

  const onBudget = (v: string) => {
    const n = Math.max(50, Math.min(1_000_000, Math.round(Number(v) || 0)));
    setBudget(n);
    try { localStorage.setItem(RISK_KEY, String(n)); } catch { /* private mode */ }
  };

  const slipText = [
    `🇮🇳 NSE TRADE SLIP — ${signal.symbol} (${signal.side})`,
    `Signal: ${signal.grade} ${signal.confidence}% conf · ${signal.totalModels}-model ensemble · ${Math.round((signal.agreement || 0) * 100)}% agreement`,
    `── ORDER ──`,
    `${long ? 'BUY' : 'SELL'} ${qty} qty @ ₹${plan.entry.toFixed(2)} (limit band ₹${bandLo.toFixed(2)}–₹${bandHi.toFixed(2)})`,
    `Stop-loss: SL-M trigger ₹${plan.stopLoss.toFixed(2)} (risk ${fmt(actualRisk)} · ${plan.riskPct?.toFixed(2)}%)`,
    `Target 1: ₹${plan.target1.toFixed(2)} → ${profitT1 >= 0 ? '+' : ''}${fmt(profitT1)}`,
    `Target 2: ₹${plan.target2.toFixed(2)} → ${profitT2 >= 0 ? '+' : ''}${fmt(profitT2)}`,
    `Capital needed: ~${fmt(capital)} · risk budget ${fmt(budget)}`,
    `── RULES ──`,
    `• Intraday: square-off by 15:15 IST (bracket/cover order at broker)`,
    `• Entry window 09:30–14:30 — avoid 09:15–09:30 opening chop`,
    `• SL is non-negotiable: trigger hit = exit at market`,
    `• Book 50% at T1, trail rest to T2 / cost-to-cost`,
    `Generated by SmartAI ensemble · verify levels on your broker terminal before placing`,
  ].join('\n');

  const copy = useCallback(() => {
    navigator.clipboard?.writeText(slipText).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    }).catch(() => { /* clipboard blocked */ });
  }, [slipText]);

  const enough = qty >= 1;

  return (
    <div className="mt-2.5 rounded-xl border border-orange-500/25 bg-gradient-to-b from-orange-500/[0.07] to-transparent p-3" aria-label="India trade slip">
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-[10px] font-black text-orange-300 tracking-wider">📋 TRADE SLIP — MANUAL BROKER FLOW (NSE)</span>
        <span className="text-[9px] text-slate-500">sizing = risk ₹ ÷ stop distance</span>
        <label className="ml-auto flex items-center gap-1.5 text-[9px] font-black text-slate-500 tracking-wider">
          RISK / TRADE
          <input
            type="number" min={50} max={1000000} step={50}
            value={budget} onChange={e => onBudget(e.target.value)}
            className="quantum-input px-2 py-1 rounded-lg text-[11px] font-mono font-bold text-orange-200 w-24"
            aria-label="risk per trade in rupees" />
        </label>
      </div>

      {enough ? (
        <>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-1.5 mt-2">
            {[
              { l: 'QTY (risk-sized)', v: `${qty} shares`, c: 'text-orange-300' },
              { l: 'CAPITAL NEEDED', v: fmt(capital), c: 'text-cyan-300' },
              { l: '₹ AT RISK (SL)', v: fmt(actualRisk), c: 'text-red-300' },
              { l: 'PROFIT @ T1', v: `+${fmt(profitT1)}`, c: 'text-emerald-300' },
              { l: 'PROFIT @ T2', v: `+${fmt(profitT2)}`, c: 'text-emerald-400' },
              { l: 'LIMIT BAND', v: `₹${bandLo.toFixed(0)}–${bandHi.toFixed(0)}`, c: 'text-slate-300' },
            ].map(x => (
              <div key={x.l} className="bg-black/30 rounded-lg px-2 py-1.5 text-center">
                <div className="text-[8px] text-slate-500 font-black tracking-wider">{x.l}</div>
                <div className={`text-xs font-mono font-bold ${x.c}`}>{x.v}</div>
              </div>
            ))}
          </div>
          <div className="mt-2 text-[10px] text-slate-400 leading-relaxed bg-black/20 rounded-lg px-2.5 py-2">
            <span className="font-black text-slate-300">Order placement (Zerodha/Upstox/Angel sab par yahi):</span>{' '}
            ① <b>{long ? 'BUY' : 'SELL'} {qty}</b> · LIMIT @ <b>₹{plan.entry.toFixed(2)}</b> (band ₹{bandLo.toFixed(2)}–₹{bandHi.toFixed(2)}) →{' '}
            ② SL-M/bracket trigger <b className="text-red-300">₹{plan.stopLoss.toFixed(2)}</b> →{' '}
            ③ targets <b className="text-emerald-300">₹{plan.target1.toFixed(2)}</b> / <b className="text-emerald-300">₹{plan.target2.toFixed(2)}</b> →{' '}
            ④ intraday square-off <b>15:15 IST</b> tak khud.
          </div>
          <button onClick={copy}
            className={`mt-2 px-3 py-1.5 rounded-lg text-[10px] font-black border transition-colors ${copied
              ? 'bg-emerald-500/15 text-emerald-300 border-emerald-500/40'
              : 'bg-orange-500/10 text-orange-300 border-orange-500/30 hover:bg-orange-500/20'}`}>
            {copied ? '✓ SLIP COPIED — broker terminal me paste karo' : '📋 COPY FULL ORDER SLIP'}
          </button>
        </>
      ) : (
        <div className="mt-2 text-[10px] text-amber-300/90 font-bold bg-amber-500/5 border border-amber-500/20 rounded-lg px-2.5 py-2">
          ⚠️ Risk budget {fmt(budget)} is too small for this stop (₹{stopDist.toFixed(2)}/share) — even 1 share risks more than the budget.
          Either raise RISK/TRADE, pick a tighter-stop signal, or trade this via the Options Desk (smaller ticket).
        </div>
      )}
    </div>
  );
}

// ---------------- v6.4: CRYPTO ORDER PREVIEW ----------------
function CryptoOrderPreview({ signal, budgetINR }: { signal: AISignal; budgetINR?: number }) {
  const plan = signal.plan;
  if (!plan || !(plan.entry > 0) || !budgetINR || !(budgetINR >= 100)) return null;
  const stopDist = Math.abs(plan.entry - plan.stopLoss);
  const t2Dist = Math.abs(plan.target2 - plan.entry);
  const qty = budgetINR / plan.entry;
  const riskINR = qty * stopDist;
  const rewardT2 = qty * t2Dist;
  const rr = riskINR > 0 ? rewardT2 / riskINR : 0;
  return (
    <div className="mt-2 flex items-center gap-2 flex-wrap text-[10px] font-mono font-bold" aria-label="order preview">
      <span className="text-slate-500 tracking-wider">ORDER PREVIEW</span>
      <span className="px-1.5 py-0.5 rounded bg-black/30 text-cyan-300">budget {fmt(budgetINR, 0)}</span>
      <span className="px-1.5 py-0.5 rounded bg-black/30 text-slate-300">≈ {qty < 1 ? qty.toFixed(6) : qty.toFixed(4)} units</span>
      <span className="px-1.5 py-0.5 rounded bg-red-500/10 text-red-300">risk @SL −{fmt(riskINR, 0)}</span>
      <span className="px-1.5 py-0.5 rounded bg-emerald-500/10 text-emerald-300">T2 +{fmt(rewardT2, 0)}</span>
      <span className="px-1.5 py-0.5 rounded bg-black/30 text-amber-300">R:R 1:{rr.toFixed(1)}</span>
      <span className="text-slate-600">(budget = Max order ₹ setting)</span>
    </div>
  );
}

interface Props {
  signal: AISignal;
  busy?: boolean;
  onExecute?: (signal: AISignal, mode: 'paper' | 'live') => void;
  onExecuteIndia?: (signal: AISignal, mode: 'paper' | 'live') => void;
  onDeep?: (signal: AISignal) => void;
  canLive?: boolean;
  canLiveIndia?: boolean;
  isNew?: boolean; // v6.3: freshly-appeared actionable signal → flash ring
  /** v6.4: crypto order preview budget (server config maxOrderINR). */
  orderBudgetINR?: number;
  /** v6.4: the risk cap the board plans were built within. */
  riskCapPct?: number;
}

export const SignalCard = memo(function SignalCard({ signal, busy, onExecute, onExecuteIndia, onDeep, canLive, canLiveIndia, isNew, orderBudgetINR, riskCapPct }: Props) {
  const [expanded, setExpanded] = useState(false);
  const [slipOpen, setSlipOpen] = useState(false);
  const g = gradeBadge(signal.grade);
  const long = signal.side === 'LONG';
  const actionable = signal.grade === 'STRONG' || signal.grade === 'ACTION';
  const plan = signal.plan;
  const overCap = !!(plan && riskCapPct && plan.riskPct > riskCapPct);

  return (
    <div className={`quantum-panel rounded-2xl p-4 transition-colors hover:border-cyan-500/20 border-l-4 ${long ? 'border-l-emerald-500/60' : 'border-l-red-500/60'}
      ${signal.grade === 'STRONG' ? 'ring-1 ring-emerald-500/40' : ''}
      ${isNew ? 'ring-2 ring-cyan-400/60 animate-pulse' : ''}`}>
      {/* Header row */}
      <div className="flex items-center gap-3 flex-wrap">
        <ConfidenceGauge value={signal.confidence} side={signal.side} />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-base font-black text-white font-mono tracking-wide">{signal.symbol}</span>
            {isNew && <span className="px-1.5 py-0.5 rounded bg-cyan-500/15 text-cyan-300 text-[9px] font-black border border-cyan-500/30">NEW</span>}
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
            {signal.participation != null && (
              <>
                <span className="text-slate-500">·</span>
                <span title="share of committee weight that cast a directional vote">{Math.round(signal.participation * 100)}% quorum</span>
              </>
            )}
          </div>
        </div>
        <div className="flex gap-1.5">
          {signal.market === 'INDIA' && plan && (
            <button onClick={() => setSlipOpen(v => !v)} disabled={!actionable && !slipOpen}
              title={actionable ? 'Risk-sized order slip with entry/SL/targets — copy to your broker terminal' : 'Trade slips are for ACTION/STRONG signals'}
              className={`quantum-btn-ghost px-2.5 py-1.5 rounded-lg text-[11px] font-black ${actionable ? '' : 'opacity-50'}`}
              aria-expanded={slipOpen}>
              {slipOpen ? '▲ Slip' : '📋 Slip'}
            </button>
          )}
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
      {plan && (
        <>
          <div className="grid grid-cols-2 sm:grid-cols-5 gap-1.5 mt-3">
            {[
              { l: 'ENTRY', v: fmt(plan.entry), c: 'text-cyan-300' },
              { l: `STOP ${plan.riskPct != null ? `(${plan.riskPct.toFixed(2)}%)` : ''}`, v: fmt(plan.stopLoss), c: 'text-red-300' },
              { l: 'TARGET 1', v: fmt(plan.target1), c: 'text-emerald-300' },
              { l: 'TARGET 2', v: fmt(plan.target2), c: 'text-emerald-400' },
              { l: 'R:R', v: `1:${plan.rewardRisk}`, c: 'text-amber-300' },
            ].map(x => (
              <div key={x.l} className="bg-black/30 rounded-lg px-2 py-1.5 text-center">
                <div className="text-[8px] text-slate-500 font-black tracking-wider">{x.l}</div>
                <div className={`text-xs font-mono font-bold ${x.c}`}>{x.v}</div>
              </div>
            ))}
          </div>
          {/* v6.4 risk-fit transparency */}
          {plan.riskClamped && (
            <div className="mt-1.5 px-2.5 py-1.5 rounded-lg bg-amber-500/[0.07] border border-amber-500/25 text-[10px] font-bold text-amber-300/90 leading-relaxed">
              ⚙️ Auto-fitted: structural ATR stop was {plan.originalRiskPct?.toFixed(2)}% (over the {riskCapPct ?? 5}% cap) → SL tightened to {plan.riskPct?.toFixed(2)}%, targets re-derived. Execute par SL server-side fir se fit hota hai — koi reject nahi.
            </div>
          )}
          {!plan.riskClamped && overCap && (
            <div className="mt-1.5 px-2.5 py-1.5 rounded-lg bg-amber-500/[0.07] border border-amber-500/25 text-[10px] font-bold text-amber-300/90 leading-relaxed">
              ⚙️ Stop {plan.riskPct?.toFixed(2)}% &gt; {riskCapPct}% cap — PAPER pe click karne par server isse auto-fit kar dega (SL cap pe, targets re-derived). LIVE me mild overshoot hi fit hota hai.
            </div>
          )}
        </>
      )}

      {/* v6.4: India trade slip (manual broker flow) */}
      {signal.market === 'INDIA' && slipOpen && plan && (
        <IndiaTradeSlip signal={signal} />
      )}

      {/* v6.4: crypto order preview */}
      {signal.market === 'CRYPTO' && onExecute && (
        <CryptoOrderPreview signal={signal} budgetINR={orderBudgetINR} />
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

      {/* Execution buttons (crypto — CoinDCX gauntlet) */}
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
              className="px-4 py-2 rounded-xl text-xs font-black bg-gradient-to-r from-emerald-600 to-teal-600 text-white hover:from-emerald-500 hover:to-teal-500 disabled:opacity-40 disabled:cursor-not-allowed transition-colors">
              ⚡ EXECUTE LIVE ₹
            </button>
          )}
          {signal.grade !== 'STRONG' && (
            <span className="text-[10px] text-slate-500 self-center px-1">LIVE execution locked — needs STRONG (75%+ conf, 70%+ agreement)</span>
          )}
        </div>
      )}

      {/* Execution buttons (India — Dhan gauntlet, v6.5) */}
      {signal.market === 'INDIA' && onExecuteIndia && actionable && (
        <div className="mt-3 flex flex-wrap gap-2">
          <button
            onClick={() => onExecuteIndia(signal, 'paper')}
            disabled={busy}
            title="Practice journal position — watcher SL/TP + trailing se manage hota hai"
            className="quantum-btn-primary px-4 py-2 rounded-xl text-xs font-black bg-gradient-to-r from-orange-600 to-amber-600 disabled:opacity-50">
            🧪 PAPER TRADE
          </button>
          {signal.grade === 'STRONG' && (
            <button
              onClick={() => onExecuteIndia(signal, 'live')}
              disabled={busy || !canLiveIndia}
              title={canLiveIndia ? 'REAL Dhan order: market entry + broker SL-M, square-off 15:15 IST (all gates re-verified server-side)' : 'STRONG hai — Dhan connect + India LIVE arm console me karo'}
              className="px-4 py-2 rounded-xl text-xs font-black bg-gradient-to-r from-emerald-600 to-teal-600 text-white hover:from-emerald-500 hover:to-teal-500 disabled:opacity-40 disabled:cursor-not-allowed transition-colors">
              ⚡ EXECUTE LIVE ₹
            </button>
          )}
          {signal.grade !== 'STRONG' && (
            <span className="text-[10px] text-slate-500 self-center px-1">India LIVE = STRONG signals only · PAPER hamesha open</span>
          )}
        </div>
      )}
    </div>
  );
});
