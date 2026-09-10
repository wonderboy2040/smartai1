// ============================================================
// src/components/aitrading/SignalCard.tsx
// ------------------------------------------------------------
// One consensus signal, expanded: confidence gauge, trade plan,
// every model's vote with reasons, AI Council note.
//
// v6.6 SIMPLE TRADE —
//   • 🚀 TRADE button on every actionable card opens the SIMPLE TRADE
//     TICKET: one screen with everything pre-computed to TAKE the
//     trade — size input, qty, ₹ risk @ SL, ₹ reward @ T2, R:R — and
//     one-click PAPER / LIVE execute. The math MIRRORS the server
//     (qty = budget÷price, leverage notional, liquidation est.) so the
//     preview you see is the position you get.
//   • CRYPTO LEVERAGE: chips 1x..10x (server-clamped ceiling),
//     liquidation estimate + "liquidation fires before your SL"
//     warning with the max-sane-leverage hint, honest ₹-risk scaling.
//   • v6.4 features kept: India manual-broker trade slip, crypto order
//     preview, risk-auto-fit transparency chips.
// ============================================================
import { memo, useCallback, useState } from 'react';
import type { AISignal, Side, SuperIntel } from './types';

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

/** v9 SUPERINTELLIGENCE — the AI SCORE ring (0-100): engine conviction ×
 *  7-factor expert score × AI verdict. 85+ ELITE (gold), 80+ STRONG
 *  (emerald), 65+ ACTION (cyan) — the ring colour IS the tier. */
function SuperIntelRing({ score, tier }: { score: number; tier: string }) {
  const r = 26, c = 2 * Math.PI * r;
  const pct = Math.max(0, Math.min(100, score)) / 100;
  const gold = tier === 'ELITE';
  const strong = tier === 'STRONG';
  const action = tier === 'ACTION';
  const stroke = gold ? '#fbbf24' : strong ? '#34d399' : action ? '#22d3ee' : '#64748b';
  return (
    <div className="relative w-16 h-16 shrink-0" role="img" aria-label={`AI score ${score} ${tier}`}>
      <svg viewBox="0 0 64 64" className="w-16 h-16 -rotate-90">
        <circle cx="32" cy="32" r={r} fill="none" stroke="rgba(148,163,184,0.15)" strokeWidth="6" />
        <circle cx="32" cy="32" r={r} fill="none" stroke={stroke} strokeWidth="6" strokeLinecap="round"
          strokeDasharray={`${c * pct} ${c}`} className="transition-all duration-700"
          style={gold ? { filter: 'drop-shadow(0 0 5px rgba(251,191,36,0.7))' } : undefined} />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className={`text-sm font-black font-mono ${gold ? 'text-amber-300' : strong ? 'text-emerald-300' : action ? 'text-cyan-300' : 'text-slate-400'}`}>{score}</span>
        <span className="text-[8px] text-slate-500 font-bold tracking-wider">AI SCORE</span>
      </div>
    </div>
  );
}

const superTierBadge = (tier: string) => {
  switch (tier) {
    case 'ELITE': return { cls: 'bg-gradient-to-r from-amber-400/25 to-yellow-500/25 text-amber-300 border border-amber-400/50 shadow-[0_0_12px_rgba(251,191,36,0.25)]', label: '🧠 ELITE 85+' };
    case 'STRONG': return { cls: 'bg-emerald-500/15 text-emerald-300 border border-emerald-500/40', label: '🔥 STRONG 80+' };
    case 'ACTION': return { cls: 'bg-cyan-500/15 text-cyan-300 border border-cyan-500/40', label: '⚡ ACTION 65+' };
    case 'WATCH': return { cls: 'bg-amber-500/15 text-amber-300 border border-amber-500/40', label: 'WATCH 50+' };
    default: return { cls: 'bg-slate-500/15 text-slate-400 border border-slate-500/30', label: 'NEUTRAL' };
  }
};

/** v9 SUPERINTELLIGENCE BLUEPRINT STRIP — the complete pro-trader
 *  ticket in one row: entry window (timing), leverage (liquidation-aware
 *  ladder), staged exit plan (40/40/20) and the EXIT CLOCK. This is the
 *  "kab entry · kitna leverage · kab exit" answer on every card. */
function SuperIntelStrip({ signal, si }: { signal: AISignal; si: SuperIntel }) {
  const bp = si.blueprint;
  if (!bp) return null;
  const isFut = signal.market === 'FUTURES';
  const px = (v: number | null | undefined) =>
    v == null || !Number.isFinite(v) ? '—'
      : isFut ? `${v.toLocaleString('en-US', { maximumFractionDigits: 4 })}`
        : `₹${v.toLocaleString('en-IN', { maximumFractionDigits: Math.abs(v) < 1 ? 6 : 2 })}`;
  const zone = bp.entryZone && bp.entryZone[0] != null && bp.entryZone[1] != null ? `${px(bp.entryZone[0])}–${px(bp.entryZone[1])}` : '—';
  const t = bp.targets;
  return (
    <div className="mt-2.5 rounded-xl border border-cyan-500/15 bg-gradient-to-r from-cyan-500/[0.05] via-transparent to-violet-500/[0.05] p-2.5">
      {/* header: tier badge + drivers */}
      <div className="flex items-center gap-2 flex-wrap">
        <span className={`px-2 py-0.5 rounded-md text-[10px] font-black tracking-wider ${superTierBadge(si.tier).cls}`}>{superTierBadge(si.tier).label}</span>
        {si.drivers.slice(0, 3).map((d, i) => (
          <span key={i} className="text-[9px] text-slate-500 font-semibold" title={d}>· {d}</span>
        ))}
      </div>
      {/* the four pro-trader answers */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-1.5 mt-2">
        <div className="bg-black/30 rounded-lg px-2 py-1.5" title={bp.entryTiming?.note || ''}>
          <div className="text-[8px] text-slate-500 font-black tracking-wider">⏱ ENTRY WINDOW</div>
          <div className={`text-[11px] font-mono font-bold ${bp.entryTiming?.mode === 'IMMEDIATE' ? 'text-emerald-300' : 'text-amber-300'}`}>
            {bp.entryTiming?.mode || '—'} · {zone}
          </div>
        </div>
        <div className="bg-black/30 rounded-lg px-2 py-1.5" title={bp.leverageNote}>
          <div className="text-[8px] text-slate-500 font-black tracking-wider">⚡ LEVERAGE</div>
          <div className="text-[11px] font-mono font-bold text-violet-300">
            {bp.leverage}×{bp.liquidation != null ? ` · liq ${px(bp.liquidation)}` : ''}
          </div>
        </div>
        <div className="bg-black/30 rounded-lg px-2 py-1.5" title={(bp.exitPlan || []).map(e => e.action).join(' · ')}>
          <div className="text-[8px] text-slate-500 font-black tracking-wider">🎯 EXIT PLAN</div>
          <div className="text-[11px] font-mono font-bold text-emerald-300">
            40% {px(t.t1)} · 40% {px(t.t2)} · 20% {px(t.t3)}
          </div>
        </div>
        <div className="bg-black/30 rounded-lg px-2 py-1.5" title={bp.horizon?.note || ''}>
          <div className="text-[8px] text-slate-500 font-black tracking-wider">⏰ EXIT BY</div>
          <div className="text-[11px] font-mono font-bold text-amber-300">
            {bp.exitBy} · {bp.horizon?.label || ''}
          </div>
        </div>
      </div>
      <div className="mt-1.5 text-[9px] text-slate-500 font-semibold leading-relaxed">
        🛑 {bp.invalidation}
      </div>
    </div>
  );
}

/** v6.12 PRO TRADER BRAIN — one honest chips row: quorum, MTF, regime,
 *  extension veto, session gate, stop style. The WHY behind the grade. */
function QualityChips({ quality, voters, total }: { quality: NonNullable<AISignal['quality']>; voters: number | null | undefined; total: number }) {
  const chips: Array<{ label: string; cls: string; title: string }> = [];
  const v = voters ?? 0;
  // quorum
  chips.push(v <= 1
    ? { label: `⚠ QUORUM ${v}/${total}`, cls: 'bg-red-500/10 text-red-300 border-red-500/30', title: `sirf ${v} model vote kar raha hai — single-factor, consensus NAHI` }
    : v === 2
      ? { label: `QUORUM ${v}/${total} weak`, cls: 'bg-amber-500/10 text-amber-300 border-amber-500/30', title: 'sirf 2 models voting — weak quorum' }
      : { label: `QUORUM ${v}/${total}`, cls: 'bg-emerald-500/10 text-emerald-300 border-emerald-500/30', title: `${v} models ne directional vote diya` });
  // MTF
  const mtf = quality.mtf;
  if (mtf?.available) {
    if (mtf.phase === 'ALIGNED') chips.push({ label: `MTF ✓ (${mtf.phase === 'ALIGNED' ? 'HTF+LTF' : mtf.phase})`, cls: 'bg-emerald-500/10 text-emerald-300 border-emerald-500/30', title: 'daily trend + intraday dono align — continuation entry OK' });
    else if (mtf.phase === 'COUNTER_HTF') chips.push({ label: 'MTF ⚠ COUNTER', cls: 'bg-red-500/10 text-red-300 border-red-500/30', title: 'daily trend ke AGAINST — counter-trend, sirf strong reversal pe' });
    else chips.push({ label: `MTF ⚠ ${mtf.phase}`, cls: 'bg-amber-500/10 text-amber-300 border-amber-500/30', title: 'timeframes conflict — timing risk' });
  } else {
    chips.push({ label: 'MTF n/a', cls: 'bg-slate-600/20 text-slate-400 border-slate-600/30', title: 'LTF candles unavailable — MTF check skip (honest)' });
  }
  // regime
  const rg = quality.regime;
  if (rg?.aligned === true) chips.push({ label: 'REGIME ✓', cls: 'bg-emerald-500/10 text-emerald-300 border-emerald-500/30', title: 'market regime trade ke sapt hai' });
  else if (rg?.aligned === false) chips.push({ label: `REGIME ⚠ against${rg.penaltyPct ? ` −${rg.penaltyPct}%` : ''}`, cls: 'bg-red-500/10 text-red-300 border-red-500/30', title: 'BTC/NIFTY regime ke against trade — penalty laga hai' });
  // extension veto
  if (quality.extension?.veto) chips.push({ label: '🚫 EXTENSION VETO', cls: 'bg-red-500/15 text-red-300 border-red-500/40', title: 'move already extended / RSI exhaustion — chase mat karo' });
  else if (quality.extension?.downgrade) chips.push({ label: 'EXT ⚠ extended', cls: 'bg-amber-500/10 text-amber-300 border-amber-500/30', title: 'entry thodi extended hai' });
  // session (India only)
  const ses = quality.session;
  if (ses && !ses.tradeable) chips.push({ label: `⏰ ${ses.phase}`, cls: 'bg-amber-500/10 text-amber-300 border-amber-500/30', title: 'abhi fresh entry ka window nahi (opening noise / square-off / closed)' });
  // structure stop
  if (quality.stopStyle) chips.push({ label: `🔒 ${quality.stopStyle === 'swing-structure' ? 'SWING SL' : 'ATR SL'}`, cls: 'bg-cyan-500/10 text-cyan-300 border-cyan-500/30', title: quality.stopStyle === 'swing-structure' ? 'SL last swing level ke piche — structure-aware, noise pad ke saath' : 'ATR-based stop' });
  return (
    <div className="flex flex-wrap gap-1.5 mt-2">
      {chips.map((c, i) => (
        <span key={i} className={`px-1.5 py-0.5 rounded text-[9px] font-black border tracking-wide ${c.cls}`} title={c.title}>{c.label}</span>
      ))}
      {(quality.reasons || []).length > 0 && (
        <span className="px-1.5 py-0.5 rounded text-[9px] font-black border tracking-wide bg-slate-600/20 text-slate-300 border-slate-600/30" title={(quality.reasons || []).join('\n')}>⋯ {quality.reasons?.length} reasons</span>
      )}
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
  // v7.0.1: free-typing risk input (raw string) — same fix as the trade
  // ticket: the old Math.max(50, …) on every keystroke made the box
  // impossible to clear/edit. Clamp now happens on blur only.
  const [budgetRaw, setBudgetRaw] = useState<string>(String(loadRiskBudget()));
  const [copied, setCopied] = useState(false);
  const budgetNum = Number(budgetRaw);
  const typedOk = budgetRaw.trim() !== '' && Number.isFinite(budgetNum);
  const budget = typedOk ? budgetNum : 0;

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
    setBudgetRaw(v);
    const n = Number(v);
    if (v.trim() !== '' && Number.isFinite(n) && n >= 50 && n <= 1_000_000) {
      try { localStorage.setItem(RISK_KEY, String(Math.round(n))); } catch { /* private mode */ }
    }
  };
  const onBudgetBlur = () => {
    const n = Math.max(50, Math.min(1_000_000, Math.round(Number(budgetRaw) || 0)));
    setBudgetRaw(String(n));
    try { localStorage.setItem(RISK_KEY, String(n)); } catch { /* private mode */ }
  };
  const pickRisk = (n: number) => { setBudgetRaw(String(n)); try { localStorage.setItem(RISK_KEY, String(n)); } catch { /* private mode */ } };

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
            value={budgetRaw} onChange={e => onBudget(e.target.value)} onBlur={onBudgetBlur}
            placeholder="₹"
            className="quantum-input px-2 py-1 rounded-lg text-[11px] font-mono font-bold text-orange-200 w-24"
            aria-label="risk per trade in rupees — apna amount type karo" />
        </label>
      </div>

      {/* v7.0.1 quick-risk chips */}
      <div className="flex items-center gap-1 flex-wrap mt-1.5" role="group" aria-label="quick risk presets">
        <span className="text-[8px] font-black text-slate-600 tracking-wider">QUICK:</span>
        {[200, 500, 1000, 2000].map(a => (
          <button key={a} onClick={() => pickRisk(a)}
            title={`Risk ₹${a.toLocaleString('en-IN')} per trade`}
            className={`px-2 py-0.5 rounded-lg text-[10px] font-black font-mono border transition-colors ${typedOk && budgetNum === a
              ? 'bg-orange-500/25 text-orange-200 border-orange-400/60'
              : 'bg-black/30 text-slate-400 border-slate-600/40 hover:bg-orange-500/10'}`}>
            ₹{a >= 1000 ? `${a / 1000}k` : a}
          </button>
        ))}
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

// ---------------- v6.6: THE SIMPLE TRADE TICKET ----------------
// One screen. Everything pre-computed. One click.
// The math MIRRORS the server execute path so the preview IS the fill:
//   crypto:  qty = (margin ₹ × leverage) / entry
//   futures: qty = (margin USDT × leverage) / entry  (v6.8 — wallet USDT)
//   india:   qty = floor(budget / price)             [whole shares]
type ExecHandler = (signal: AISignal, mode: 'paper' | 'live' | 'notify', opts?: { qtyINR?: number; marginUSDT?: number; leverage?: number }) => Promise<{ ok?: boolean; error?: string; note?: string } | void> | void;

interface TicketProps {
  signal: AISignal;
  busy?: boolean;
  onExecute?: ExecHandler;          // crypto gauntlet
  onExecuteIndia?: ExecHandler;     // india gauntlet
  onExecuteFutures?: ExecHandler;   // global-futures gauntlet (v6.8)
  canLive?: boolean;
  canLiveIndia?: boolean;
  /** v6.6: server config cryptoLeverage (the hard ceiling) */
  maxLeverage?: number;
  /** default margin (crypto) / capital budget (india) from server config */
  defaultBudgetINR?: number;
  /** v7.0.1: server per-order cap (crypto maxOrderINR / india indiaMaxOrderINR)
   *  — the preview stays an honest twin of the fill even when the user
   *  types a bigger amount. Futures are wallet-limited (no cap). */
  serverCapINR?: number;
}

function SimpleTradeTicket({ signal, busy, onExecute, onExecuteIndia, onExecuteFutures, canLive, canLiveIndia, maxLeverage = 1, defaultBudgetINR = 1000, serverCapINR }: TicketProps) {
  const plan = signal.plan!;
  const crypto = signal.market === 'CRYPTO';
  const futures = signal.market === 'FUTURES';
  const leveraged = crypto || futures; // v6.8: futures are natively leveraged
  const india = signal.market === 'INDIA';
  const long = signal.side === 'LONG';
  const cap = Math.max(1, Math.min(10, Math.floor(maxLeverage || 1)));

  // futures ticket works in the WALLET's own unit (USDT margin); the
  // others in ₹. Server re-derives everything — this is a preview twin.
  // v7.0.1 BUDGET BOX FIX: the input is now FREE-TYPING (raw string).
  // The old code clamped to ≥100 on EVERY keystroke — the box could
  // never be cleared or edited freely ("100 clear hi nahi hota").
  // Validation now happens on blur + execute only.
  const lo = futures ? 2 : 100;
  const defaultMargin = Math.max(futures ? 5 : 100, Math.round(defaultBudgetINR));
  const [marginRaw, setMarginRaw] = useState<string>(String(defaultMargin));
  const [lev, setLev] = useState<number>(futures ? 3 : 1);
  const [result, setResult] = useState<{ ok: boolean; text: string; pending?: boolean } | null>(null);
  const approxUsdInr = 84; // display-only conversion (server uses the live rate)

  const marginNum = Number(marginRaw);
  const typedValid = marginRaw.trim() !== '' && Number.isFinite(marginNum);
  // honest twin: server clamps crypto/india orders to the per-order cap
  // (Risk settings) — preview shows the fill you will actually get.
  const orderCap = !futures && serverCapINR && serverCapINR > 0 ? serverCapINR : null;
  const margin = typedValid ? (orderCap != null ? Math.min(marginNum, orderCap) : marginNum) : 0;
  const overCapTyped = typedValid && orderCap != null && marginNum > orderCap;
  const belowMin = typedValid && marginNum < lo;
  const invalid = !typedValid || belowMin;

  const clampMargin = (v: string | number): number => {
    const n = Math.round((Number(v) || 0) * 100) / 100;
    let c = Math.max(lo, Math.min(1_000_000, n));
    if (orderCap != null && c > orderCap) c = Math.min(orderCap, Math.max(lo, orderCap));
    return c;
  };
  const onMargin = (v: string) => { setMarginRaw(v); setResult(null); };
  const onMarginBlur = () => {
    if (!typedValid) { setMarginRaw(String(defaultMargin)); setResult(null); return; }
    const n = clampMargin(marginRaw);
    if (String(n) !== marginRaw.trim()) setMarginRaw(String(n));
  };
  const pickAmount = (n: number) => { setMarginRaw(String(n)); setResult(null); };

  // --- math (mirror of the server execute paths) ---
  const notional = leveraged ? margin * lev : margin;
  const qtyRaw = leveraged ? notional / plan.entry : margin / plan.entry;
  const qty = leveraged ? Math.round(qtyRaw * 1e6) / 1e6 : Math.floor(qtyRaw); // india: whole shares (server)
  const stopDist = Math.abs(plan.entry - plan.stopLoss);
  const t1Dist = Math.abs(plan.target1 - plan.entry);
  const t2Dist = Math.abs(plan.target2 - plan.entry);
  const riskUnits = qty * stopDist;              // USDT (futures) / ₹ (others)
  const rewardT1 = qty * t1Dist;
  const rewardT2 = qty * t2Dist;
  const rr = riskUnits > 0 ? rewardT2 / riskUnits : 0;
  const liquidation = leveraged && lev > 1 ? plan.entry * (long ? 1 - 0.95 / lev : 1 + 0.95 / lev) : null;
  const liqDistPct = liquidation != null ? (Math.abs(plan.entry - liquidation) / plan.entry) * 100 : null;
  const slDistPct = (stopDist / plan.entry) * 100;
  const liqBeforeSl = liqDistPct != null && liqDistPct < slDistPct;
  const maxSane = Math.max(1, Math.min(cap, Math.floor(95 / slDistPct)));
  const effRiskOnMargin = leveraged ? slDistPct * lev : null;

  const pickLev = (l: number) => { setLev(l); setResult(null); };

  const fmtU = (n: number, dp = 0) => futures
    ? `${n.toLocaleString('en-US', { maximumFractionDigits: dp || 2 })} USDT`
    : fmt(n, dp);
  const fmtINRapprox = (n: number) => `₹${Math.round(n * approxUsdInr).toLocaleString('en-IN')}`;

  const exec = async (mode: 'paper' | 'live' | 'notify') => {
    const handler = futures ? onExecuteFutures : crypto ? onExecute : onExecuteIndia;
    if (!handler) return;
    if (invalid) {
      setResult({ ok: false, text: `⚠ Pehle amount daalo — minimum ${futures ? `${lo} USDT margin` : `₹${lo}`}${orderCap != null ? ` (server cap ${futures ? '' : '₹'}${orderCap.toLocaleString('en-IN')})` : ''}. Box khali/clear karke apna amount type karo, blur par apne aap valid ho jayega.` });
      setTimeout(() => setResult(null), 8000);
      return;
    }
    const sendMargin = clampMargin(marginRaw); // final safety clamp (cap incl.)
    const opts = futures
      ? { marginUSDT: sendMargin, ...(lev > 1 ? { leverage: lev } : {}) }
      : crypto
        ? { qtyINR: sendMargin, ...(lev > 1 ? { leverage: lev } : {}) }
        : { qtyINR: sendMargin };
    // v7.0.2 HONEST RESULT: the banner used to claim "position opened"
    // BEFORE the gauntlet answered — a kill-switch / daily-cap / network
    // rejection then showed a green success banner next to the parent's
    // red error toast. Now we await the server verdict.
    setResult({ ok: true, pending: true, text: '⏳ Order request gauntlet ko gaya — server gates (kill switch, caps, wallet) check ho rahe hain…' });
    let r: { ok?: boolean; error?: string; note?: string } | void;
    try { r = await handler(signal, mode, opts); }
    catch { r = { ok: false, error: 'request failed — network error' }; }
    if (r && typeof r === 'object' && r.ok === false) {
      setResult({ ok: false, text: `⛔ ${r.error || 'Gauntlet ne order reject kiya — toast/console me reason dekho'}` });
    } else {
      setResult({ ok: true, text: mode === 'live'
        ? `⚡ LIVE order executed — ${qty < 1 ? qty.toFixed(6) : qty} ${futures ? 'contracts' : crypto ? 'units' : 'shares'} @ ${futures ? `${plan.entry} USDT` : `₹${plan.entry}`}${leveraged && lev > 1 ? ` · ${lev}x` : ''} (console me position confirm karo)`
        : mode === 'notify'
          ? `🔔 NOTIFY-only — gauntlet chala, alert + journal audit likha. Koi order/position NAHI bana.`
          : `🧪 PAPER position khula — ${qty < 1 ? qty.toFixed(6) : qty} ${futures ? 'contracts' : crypto ? 'units' : 'shares'} @ ${futures ? `${plan.entry} USDT` : `₹${plan.entry}`}${leveraged && lev > 1 ? ` · ${lev}x margin` : ''} · watcher SL/TP manage karega` });
    }
    setTimeout(() => setResult(null), 8000);
  };

  const canLiveHere = futures ? canLive : crypto ? canLive : canLiveIndia;

  return (
    <div className={`mt-2.5 rounded-xl border p-3 ${futures
      ? 'border-violet-500/30 bg-gradient-to-b from-violet-500/[0.08] to-transparent'
      : crypto
        ? 'border-cyan-500/30 bg-gradient-to-b from-cyan-500/[0.08] to-transparent'
        : 'border-orange-500/30 bg-gradient-to-b from-orange-500/[0.08] to-transparent'}`} aria-label="simple trade ticket">
      <div className="flex items-center gap-2 flex-wrap">
        <span className={`text-[10px] font-black tracking-wider ${futures ? 'text-violet-300' : crypto ? 'text-cyan-300' : 'text-orange-300'}`}>
          🚀 SIMPLE TRADE TICKET — {signal.symbol} {signal.side}
        </span>
        <span className="text-[9px] text-slate-500">{futures ? 'margin USDT (perp wallet se)' : crypto ? 'margin ₹ (leverage apni lag raha hai)' : 'capital budget ₹'}</span>
      </div>

      {/* size + leverage inputs — v7.0.1 FREE-TYPING budget box */}
      <div className="flex items-center gap-2 flex-wrap mt-2">
        <label className="flex items-center gap-1.5 text-[9px] font-black text-slate-500 tracking-wider">
          {futures ? 'MARGIN USDT' : crypto ? 'MARGIN ₹' : 'BUDGET ₹'}
          <input
            type="number" min={futures ? 2 : 100} max={1000000} step={futures ? 1 : 50}
            value={marginRaw} onChange={e => onMargin(e.target.value)} onBlur={onMarginBlur}
            placeholder={futures ? 'USDT' : '₹'}
            className={`quantum-input px-2 py-1 rounded-lg text-[11px] font-mono font-bold text-white w-28 ${invalid ? 'border-amber-500/50' : ''}`}
            aria-label={futures ? 'margin in USDT — apna amount type karo' : 'budget in rupees — apna amount type karo'} />
          {futures && typedValid && <span className="text-[9px] text-slate-600 font-mono">≈ {fmtINRapprox(margin)}</span>}
          {invalid && <span className="text-[9px] font-black text-amber-400">amount daalo (min {futures ? `${lo} USDT` : `₹${lo}`})</span>}
        </label>
        {/* v7.0.1 quick-amount chips — one-tap sizing, no typing needed */}
        <div className="flex items-center gap-1 flex-wrap" role="group" aria-label="quick amount presets">
          {(futures ? [5, 10, 25, 50, 100] : [500, 1000, 2500, 5000, 10000]).map(a => (
            <button key={a} onClick={() => pickAmount(a)}
              title={`Quick-set ${futures ? `${a} USDT margin` : `₹${a.toLocaleString('en-IN')} budget`}`}
              className={`px-2 py-1 rounded-lg text-[10px] font-black font-mono border transition-colors ${typedValid && Number(marginRaw) === a
                ? 'bg-cyan-500/25 text-cyan-200 border-cyan-400/60'
                : 'bg-black/30 text-slate-400 border-slate-600/40 hover:bg-cyan-500/10'}`}>
              {futures ? `${a}U` : a >= 1000 ? `₹${a / 1000}k` : `₹${a}`}
            </button>
          ))}
          {orderCap != null && (
            <button onClick={() => pickAmount(orderCap)}
              title={`Server per-order cap — Execution Console → Risk settings me badha sakte ho`}
              className="px-2 py-1 rounded-lg text-[10px] font-black font-mono border border-amber-500/40 bg-amber-500/10 text-amber-300 hover:bg-amber-500/20 transition-colors">
              MAX ₹{orderCap.toLocaleString('en-IN')}
            </button>
          )}
        </div>
        {leveraged && (
          <div className="flex items-center gap-1" role="group" aria-label="leverage selector">
            <span className="text-[9px] font-black text-slate-500 tracking-wider">LEVERAGE</span>
            {[1, 2, 3, 5, 10].filter(l => l <= cap).map(l => (
              <button key={l} onClick={() => pickLev(l)} disabled={l > maxSane && l > 1}
                title={l > maxSane && l > 1 ? `${l}x par liquidation SL se pehle fire hogi (max sane ${maxSane}x)` : `${l}x — notional ${futures ? `${(margin * l).toFixed(0)} USDT` : fmt(margin * l, 0)}`}
                className={`px-2 py-1 rounded-lg text-[10px] font-black font-mono border transition-colors disabled:opacity-30 ${lev === l
                  ? 'bg-cyan-500/25 text-cyan-200 border-cyan-400/60'
                  : 'bg-black/30 text-slate-400 border-slate-600/40 hover:bg-cyan-500/10'}`}>
                {l}x
              </button>
            ))}
            {cap < 10 && <span className="text-[9px] text-slate-600">(max {cap}x — Risk settings)</span>}
          </div>
        )}
      </div>

      {/* v7.0.1 honest-cap + validation warnings (below the inputs) */}
      {overCapTyped && (
        <div className="mt-1.5 px-2.5 py-1.5 rounded-lg bg-amber-500/[0.07] border border-amber-500/25 text-[10px] font-bold text-amber-300/90 leading-relaxed">
          ⚠ Tumne {futures ? '' : '₹'}{Math.round(marginNum).toLocaleString('en-IN')} daala, par server per-order cap <b>₹{orderCap!.toLocaleString('en-IN')}</b> hai — order/calculations upar <b>₹{orderCap!.toLocaleString('en-IN')}</b> par hi jayenge (preview wahi dikhata hai).
          Cap badhana hai to Execution Console → Risk settings me <b>"Max order ₹"</b> badhao, ya upar <b>MAX</b> chip dabao.
        </div>
      )}
      {belowMin && typedValid && (
        <div className="mt-1.5 px-2.5 py-1.5 rounded-lg bg-amber-500/[0.07] border border-amber-500/25 text-[10px] font-bold text-amber-300/90 leading-relaxed">
          ⚠ {futures ? `Margin ${marginRaw} USDT` : `Budget ₹${marginRaw}`} minimum {futures ? `${lo} USDT` : `₹${lo}`} se kam hai — execute nahi hoga. Amount badhao (blur par apne aap clamp ho jayega).
        </div>
      )}

      {/* the pre-computed numbers — preview IS the fill */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-1.5 mt-2">
        {[
          { l: 'QTY', v: qty < 1 ? qty.toFixed(6) : String(qty), c: 'text-white' },
          { l: leveraged ? 'NOTIONAL' : 'CAPITAL USED', v: futures ? `${(qty * plan.entry).toLocaleString('en-US', { maximumFractionDigits: 2 })} USDT` : fmt(qty * plan.entry, 0), c: 'text-cyan-300' },
          { l: futures ? 'RISK @ SL' : '₹ RISK @ SL', v: `−${fmtU(riskUnits, 2)}`, c: 'text-red-300' },
          { l: futures ? 'PROFIT @ T2' : '₹ PROFIT @ T2', v: `+${fmtU(rewardT2, 2)}`, c: 'text-emerald-300' },
        ].map(x => (
          <div key={x.l} className="bg-black/30 rounded-lg px-2 py-1.5 text-center">
            <div className="text-[8px] text-slate-500 font-black tracking-wider">{x.l}</div>
            <div className={`text-xs font-mono font-bold ${x.c}`}>{x.v}</div>
          </div>
        ))}
      </div>
      {futures && (
        <div className="text-[9px] text-slate-600 font-mono mt-1">USDT ≈ ₹ conversion display-only (×{approxUsdInr}) — server live USDINR use karta hai</div>
      )}
      <div className="flex items-center gap-3 mt-1.5 text-[10px] font-mono font-bold flex-wrap">
        <span className="text-slate-500">ENTRY <span className="text-cyan-300">{futures ? `${plan.entry.toLocaleString('en-US')} USDT` : `₹${plan.entry.toLocaleString('en-IN')}`}</span></span>
        <span className="text-slate-500">SL <span className="text-red-300">{futures ? plan.stopLoss.toLocaleString('en-US') : `₹${plan.stopLoss.toLocaleString('en-IN')}`}</span> (−{slDistPct.toFixed(2)}%)</span>
        <span className="text-slate-500">T1 <span className="text-emerald-300">+{fmtU(rewardT1, 2)}</span></span>
        <span className="text-slate-500">T2 <span className="text-emerald-300">+{fmtU(rewardT2, 2)}</span></span>
        <span className="text-amber-300">R:R 1:{rr.toFixed(1)}</span>
      </div>

      {/* leverage honesty block */}
      {leveraged && lev > 1 && (
        <div className="mt-2 space-y-1.5">
          <div className="flex gap-2 flex-wrap text-[10px] font-mono font-bold">
            <span className="px-1.5 py-0.5 rounded bg-black/30 text-cyan-300">{lev}x · margin {futures ? `${margin} USDT` : fmt(margin, 0)} → notional {futures ? `${(margin * lev).toFixed(0)} USDT` : fmt(margin * lev, 0)}</span>
            {liquidation != null && <span className="px-1.5 py-0.5 rounded bg-violet-500/10 text-violet-300">≈ LIQUIDATION {futures ? `${liquidation.toLocaleString('en-US', { maximumFractionDigits: 2 })} USDT` : `₹${liquidation.toLocaleString('en-IN', { maximumFractionDigits: 2 })}`} (−{liqDistPct!.toFixed(1)}%)</span>}
            {effRiskOnMargin != null && <span className="px-1.5 py-0.5 rounded bg-amber-500/10 text-amber-300">SL hit = −{effRiskOnMargin.toFixed(0)}% of margin</span>}
          </div>
          {liqBeforeSl ? (
            <div className="px-2.5 py-1.5 rounded-lg bg-red-500/10 border border-red-500/30 text-[10px] font-bold text-red-300 leading-relaxed">
              ⚠️ {lev}x par liquidation (−{liqDistPct!.toFixed(1)}%) tumhare SL (−{slDistPct.toFixed(1)}%) se <b>PEHLE</b> fire hogi — plan ka SL kabhi execute hi nahi hoga.
              LIVE reject hoga; PAPER me server leverage auto-reduce kar dega. Max sane: <b>{maxSane}x</b>.
            </div>
          ) : (
            <div className="px-2.5 py-1.5 rounded-lg bg-black/20 text-[10px] font-bold text-slate-400 leading-relaxed">
              ✅ Liquidation (−{liqDistPct!.toFixed(1)}%) SL (−{slDistPct.toFixed(1)}%) se door hai — SL pehle fire hoga, plan kaam karega.
            </div>
          )}
        </div>
      )}
      {crypto && lev > 1 && (
        <div className="mt-1 text-[9px] text-slate-600 leading-relaxed">
          LIVE mode me {lev}x order CoinDCX MARGIN API (B-pair) se jaata hai — exit watcher <b>margin exit_positions</b> se karega. Liquidation estimate hai (maintenance ~5% buffer) — exact level exchange tiers par depend karta hai.
        </div>
      )}
      {futures && (
        <div className="mt-1 text-[9px] text-slate-600 leading-relaxed">
          ⚡ GLOBAL FUTURES: LIVE order CoinDCX <b>derivatives/futures</b> API se jaata hai (USDT margin, native TP/SL exchange par bhi armed). LIVE par margin kam padne se <b>spot → futures auto-transfer</b> ho jaata hai. Exit watcher + time-exit agent dono guard karte hain.
        </div>
      )}
      {india && qty < 1 && (
        <div className="mt-2 px-2.5 py-1.5 rounded-lg bg-amber-500/5 border border-amber-500/20 text-[10px] font-bold text-amber-300/90">
          ⚠️ Budget ₹{margin} par 1 share bhi nahi aati (₹{plan.entry.toLocaleString('en-IN')}/share) — PAPER me server 1-share practice position bana dega, LIVE honestly reject karega. Budget badhao ya India Max ₹ settings me.
        </div>
      )}

      {/* ONE-CLICK execute — v7.0.1: disabled while the budget box is
          empty/below-min so a half-typed amount can never fire */}
      <div className="mt-3 flex flex-wrap gap-2">
        <button onClick={() => exec('paper')} disabled={busy || invalid}
          className={`quantum-btn-primary px-4 py-2 rounded-xl text-xs font-black disabled:opacity-50 ${futures ? 'bg-gradient-to-r from-violet-600 to-fuchsia-600' : crypto ? 'bg-gradient-to-r from-cyan-600 to-indigo-600' : 'bg-gradient-to-r from-orange-600 to-amber-600'}`}>
          🧪 PAPER EXECUTE{leveraged && lev > 1 ? ` · ${lev}x` : ''}
        </button>
        <button onClick={() => exec('notify')} disabled={busy || invalid}
          title="NOTIFY (v6.11) — poora gauntlet chalega, par output sirf Telegram alert + journal audit hoga. Koi order nahi, koi position nahi."
          className="px-4 py-2 rounded-xl text-xs font-black bg-gradient-to-r from-sky-600 to-blue-600 text-white hover:from-sky-500 hover:to-blue-500 disabled:opacity-50 transition-colors">
          🔔 NOTIFY
        </button>
        {signal.grade === 'STRONG' && (leveraged ? signal.executable : true) && (
          <button onClick={() => exec('live')} disabled={busy || !canLiveHere || invalid}
            title={canLiveHere ? 'REAL order — saare gates server-side re-verify honge' : 'STRONG hai — console me LIVE arm karo (Dhan connect for India)'}
            className="px-4 py-2 rounded-xl text-xs font-black bg-gradient-to-r from-emerald-600 to-teal-600 text-white hover:from-emerald-500 hover:to-teal-500 disabled:opacity-40 disabled:cursor-not-allowed transition-colors">
            ⚡ LIVE EXECUTE{leveraged && lev > 1 ? ` · ${lev}x` : ''}
          </button>
        )}
        {signal.grade !== 'STRONG' && (
          <span className="text-[10px] text-slate-500 self-center px-1">LIVE locked — needs STRONG (75%+ conf, 70%+ agreement)</span>
        )}
      </div>

      {result && (
        <div className={`mt-2 px-2.5 py-2 rounded-lg text-[10px] font-bold leading-relaxed ${result.pending ? 'bg-slate-500/10 border border-slate-500/30 text-slate-300 animate-pulse' : result.ok ? 'bg-emerald-500/10 border border-emerald-500/30 text-emerald-300' : 'bg-red-500/10 border border-red-500/30 text-red-300'}`}>
          {result.text}
        </div>
      )}

      {/* v6.13 — 4-STEP ORDER GUIDE: ① KAB ② LIMIT kaise ③ EXIT kab ④ MANAGE.
          User ka seedha sawaal: "kab lena · limit kaise lagana · kab exit" —
          yeh block wahi jawab deta hai, venue ke hisaab se. */}
      <div className="mt-2 rounded-lg bg-black/25 border border-white/5 px-2.5 py-2.5 space-y-1.5" aria-label="order guide 4 steps">
        <div className="text-[9px] font-black text-cyan-300 tracking-wider">📋 ORDER GUIDE — {futures ? 'COINDCX FUTURES' : crypto ? 'COINDCX SPOT' : 'DHAN / BROKER'} · 4 STEP</div>
        <div className="text-[10px] text-slate-300 leading-relaxed">
          <b className="text-white">① KAB:</b>{' '}
          {india
            ? (signal.quality?.session
              ? (signal.quality.session.tradeable
                ? <>abhi <b className="text-emerald-300">{signal.quality.session.phase}</b> window chal raha hai — entry OK. Best windows: <b>9:30–10:30</b> (MORNING) aur <b>13:30–15:15</b> (AFTERNOON/POWER). <b className="text-red-300">9:15–9:30 opening noise</b> aur <b className="text-red-300">15:15 ke baad entry NAHI</b>.</>
                : <>abhi phase <b className="text-amber-300">{signal.quality.session.phase}</b> hai — fresh entry <b>wait</b> karo. Tradeable window: <b>9:30–10:30</b> ya <b>13:30–15:15</b> (Mon–Fri).</>)
              : <>best windows <b>9:30–10:30</b> (MORNING) ya <b>13:30–15:15</b> (AFTERNOON/POWER); <b className="text-red-300">9:15–9:30 noise me entry nahi</b>, <b className="text-red-300">15:15 ke baad sirf square-off</b>.</>)
            : futures
              ? '24/7 USDT perp market — kabhi bhi. Par weekend/holiday pe liquidity thin hoti hai: size aadha, limit order zaroori.'
              : '24/7 crypto market — kabhi bhi. Weekend pe spread wide — LIMIT order hi lagao, MARKET nahi.'}
        </div>
        <div className="text-[10px] text-slate-300 leading-relaxed">
          <b className="text-white">② LIMIT ORDER kaise lagana hai:</b>{' '}
          {futures
            ? <>CoinDCX app me <b>{signal.symbol}</b> perp kholo → <b>BUY/LIMIT</b> select → price me <b className="text-cyan-300">{plan.entry.toLocaleString('en-US')} USDT</b> → amount <b>{qty < 1 ? qty.toFixed(6) : qty} contracts</b>{leveraged && lev > 1 ? ` · ${lev}x leverage · margin mode` : ''}. </>
            : crypto
              ? <>CoinDCX app me <b>{signal.symbol}</b> pair kholo → <b>{long ? 'BUY' : 'SELL'} / LIMIT</b> → price me <b className="text-cyan-300">₹{plan.entry.toLocaleString('en-IN')}</b> → amount <b>{qty < 1 ? qty.toFixed(6) : qty} {long ? 'buy' : 'sell'}</b>. </>
              : <>broker me <b>{signal.symbol}</b> search karo → <b>{long ? 'BUY' : 'SELL'} · LIMIT</b> select → price me <b className="text-cyan-300">₹{plan.entry.toLocaleString('en-IN')}</b> (band {`₹${(plan.entry * 0.9985).toFixed(2)}–₹${(plan.entry * 1.0015).toFixed(2)}`}) → qty <b>{qty}</b> · product <b>MIS</b>. </>}
          <b className="text-red-300">MARKET order kabhi mat lagao</b> — spread slip entry ka edge kha jaata hai. Fill nahi mile to limit ±0.2% adjust karo, price chase nahi.
        </div>
        <div className="text-[10px] text-slate-300 leading-relaxed">
          <b className="text-white">③ EXIT kab:</b>{' '}
          SL <b className="text-red-300">{futures ? `${plan.stopLoss.toLocaleString('en-US')} USDT` : `₹${plan.stopLoss.toLocaleString('en-IN')}`}</b> (−{slDistPct.toFixed(2)}%) · T1/T2 watcher khud track karega{futures ? ' (trailing + native exchange TP/SL)' : crypto ? ' (trailing SL ON)' : ' (trailing + 15:15 auto square-off)'}.
          {' '}App ke saath broker me bhi SL laga do{india ? ' (SL-M / bracket)' : futures ? ' (stop-market on the perp)' : ' (stop-limit)'} — <b>double guard</b>: app watcher + exchange dono.
        </div>
        <div className="text-[10px] text-slate-300 leading-relaxed">
          <b className="text-white">④ MANAGE:</b> position <b>03 Execution Console</b> me dikhega — P&L live, <b>CLOSE</b> button kabhi bhi. Exit ka rule: SL aaye → nikal jao, andekha mat karo; T2 hit → profit book.
        </div>
      </div>
    </div>
  );
}

interface Props {
  signal: AISignal;
  busy?: boolean;
  onExecute?: (signal: AISignal, mode: 'paper' | 'live' | 'notify', opts?: { qtyINR?: number; leverage?: number }) => Promise<{ ok?: boolean; error?: string; note?: string } | void> | void;
  onExecuteIndia?: (signal: AISignal, mode: 'paper' | 'live' | 'notify', opts?: { qtyINR?: number; leverage?: number }) => Promise<{ ok?: boolean; error?: string; note?: string } | void> | void;
  onExecuteFutures?: (signal: AISignal, mode: 'paper' | 'live' | 'notify', opts?: { qtyINR?: number; marginUSDT?: number; leverage?: number }) => Promise<{ ok?: boolean; error?: string; note?: string } | void> | void;
  onDeep?: (signal: AISignal) => void;
  canLive?: boolean;
  canLiveIndia?: boolean;
  isNew?: boolean; // v6.3: freshly-appeared actionable signal → flash ring
  /** v6.4: crypto order preview budget (server config maxOrderINR). */
  orderBudgetINR?: number;
  /** v6.4: the risk cap the board plans were built within. */
  riskCapPct?: number;
  /** v6.6: crypto leverage ceiling from server config (default 1). */
  maxLeverage?: number;
  /** v6.6: India default capital budget (indiaMaxOrderINR). */
  indiaBudgetINR?: number;
}

export const SignalCard = memo(function SignalCard({ signal, busy, onExecute, onExecuteIndia, onExecuteFutures, onDeep, canLive, canLiveIndia, isNew, orderBudgetINR, riskCapPct, maxLeverage, indiaBudgetINR }: Props) {
  const [expanded, setExpanded] = useState(false);
  const [slipOpen, setSlipOpen] = useState(false);
  const [ticketOpen, setTicketOpen] = useState(false);
  const g = gradeBadge(signal.grade);
  const long = signal.side === 'LONG';
  const actionable = signal.grade === 'STRONG' || signal.grade === 'ACTION';
  const plan = signal.plan;
  const overCap = !!(plan && riskCapPct && plan.riskPct > riskCapPct);
  const si = signal.superIntel ?? null; // v9 SUPERINTELLIGENCE

  return (
    <div id={`sig-${signal.market}-${signal.symbol}`} className={`quantum-panel rounded-2xl p-4 transition-colors hover:border-cyan-500/20 border-l-4 ${long ? 'border-l-emerald-500/60' : 'border-l-red-500/60'} scroll-mt-24
      ${signal.grade === 'STRONG' ? 'ring-1 ring-emerald-500/40' : ''}
      ${(si?.aiScore ?? 0) >= 80 ? 'ring-1 ring-cyan-400/40' : ''}
      ${isNew ? 'ring-2 ring-cyan-400/60 animate-pulse' : ''}`}>
      {/* Header row */}
      <div className="flex items-center gap-3 flex-wrap">
        <ConfidenceGauge value={signal.confidence} side={signal.side} />
        {/* v9: the SUPERINTELLIGENCE AI SCORE ring — the board's ranking
            number (80+ = STRONG, 85+ = ELITE). */}
        {si && <SuperIntelRing score={si.aiScore} tier={si.tier} />}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-base font-black text-white font-mono tracking-wide">{signal.symbol}</span>
            {isNew && <span className="px-1.5 py-0.5 rounded bg-cyan-500/15 text-cyan-300 text-[9px] font-black border border-cyan-500/30">NEW</span>}
            <span className={`text-sm font-black ${sideColor(signal.side)}`}>{long ? '▲ LONG' : '▼ SHORT'}</span>
            <span className={`px-2 py-0.5 rounded-md text-[10px] font-black tracking-wider ${g.cls}`}>{g.label}</span>
            {(signal.market === 'CRYPTO' || signal.market === 'FUTURES') && signal.executable && (
              <span className={`px-1.5 py-0.5 rounded text-[9px] font-bold border ${signal.market === 'FUTURES' ? 'bg-violet-500/15 text-violet-300 border-violet-500/30' : 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30'}`}>⚡ {signal.market === 'FUTURES' ? 'FUTURES-ELIGIBLE' : 'EXECUTION-ELIGIBLE'}</span>
            )}
            {signal.market === 'INDIA' && signal.grade === 'STRONG' && (
              <span className="px-1.5 py-0.5 rounded bg-violet-500/15 text-violet-300 text-[9px] font-bold border border-violet-500/30">🎯 OPTIONS STRATEGY</span>
            )}
          </div>
          <div className="flex items-center gap-3 mt-1 text-xs text-slate-400 flex-wrap">
            <span className="font-mono font-bold text-slate-200">{signal.market === 'FUTURES' ? (signal.ltp != null ? `${signal.ltp.toLocaleString('en-US', { maximumFractionDigits: 4 })} USDT` : '—') : fmt(signal.ltp)}</span>
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
          {(onExecute || onExecuteIndia || onExecuteFutures) && plan && actionable && (
            <button onClick={() => setTicketOpen(v => !v)}
              title="Size, ₹ risk/reward, leverage (crypto) — sab pre-computed, one-click execute"
              className={`px-2.5 py-1.5 rounded-lg text-[11px] font-black border-2 transition-all ${ticketOpen
                ? 'bg-cyan-500/25 text-cyan-200 border-cyan-400/60'
                : 'bg-gradient-to-r from-cyan-600/80 to-indigo-600/80 text-white border-cyan-400/40 hover:from-cyan-500 hover:to-indigo-500'}`}
              aria-expanded={ticketOpen}>
              {ticketOpen ? '▲ Ticket' : '🚀 TRADE'}
            </button>
          )}
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

      {/* v6.12 PRO TRADER BRAIN — quality chips: the honest WHY behind the grade */}
      {signal.quality && <QualityChips quality={signal.quality} voters={signal.voters ?? signal.participating} total={signal.totalModels} />}

      {/* v9 SUPERINTELLIGENCE BLUEPRINT — entry window · leverage ·
          staged exit · exit clock: the complete pro-trader ticket. */}
      {si && <SuperIntelStrip signal={signal} si={si} />}

      {/* Trade plan strip */}
      {plan && (
        <>
          <div className="grid grid-cols-2 sm:grid-cols-5 gap-1.5 mt-3">
            {[
              { l: 'ENTRY', v: signal.market === 'FUTURES' ? `${plan.entry.toLocaleString('en-US')} USDT` : fmt(plan.entry), c: 'text-cyan-300' },
              { l: `STOP ${plan.riskPct != null ? `(${plan.riskPct.toFixed(2)}%)` : ''}`, v: signal.market === 'FUTURES' ? plan.stopLoss.toLocaleString('en-US') : fmt(plan.stopLoss), c: 'text-red-300' },
              { l: 'TARGET 1', v: signal.market === 'FUTURES' ? plan.target1.toLocaleString('en-US') : fmt(plan.target1), c: 'text-emerald-300' },
              { l: 'TARGET 2', v: signal.market === 'FUTURES' ? plan.target2.toLocaleString('en-US') : fmt(plan.target2), c: 'text-emerald-400' },
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

      {/* v6.6: SIMPLE TRADE TICKET (all desks) */}
      {ticketOpen && plan && actionable && (onExecute || onExecuteIndia || onExecuteFutures) && (
        <SimpleTradeTicket
          signal={signal} busy={busy}
          onExecute={onExecute} onExecuteIndia={onExecuteIndia} onExecuteFutures={onExecuteFutures}
          canLive={canLive} canLiveIndia={canLiveIndia}
          maxLeverage={signal.market === 'INDIA' ? 1 : (maxLeverage ?? 1)}
          defaultBudgetINR={signal.market === 'CRYPTO' ? orderBudgetINR : signal.market === 'FUTURES' ? 10 : (indiaBudgetINR ?? 5000)}
          serverCapINR={signal.market === 'CRYPTO' ? (orderBudgetINR ?? 1000) : signal.market === 'FUTURES' ? undefined : (indiaBudgetINR ?? 5000)} />
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
      {signal.market === 'CRYPTO' && onExecute && !ticketOpen && (
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

      {/* Execution buttons (global futures — CoinDCX perps gauntlet, v9.0.2
          one-click PAPER added: futures cards had NO quick paper button, only
          the sized ticket — paper practice should always be one click away) */}
      {signal.market === 'FUTURES' && onExecuteFutures && !ticketOpen && (
        <div className="mt-3 flex flex-wrap gap-2">
          <button
            onClick={() => onExecuteFutures(signal, 'paper')}
            disabled={busy}
            className="quantum-btn-primary px-4 py-2 rounded-xl text-xs font-black bg-gradient-to-r from-violet-600 to-fuchsia-600 disabled:opacity-50">
            🧪 PAPER TRADE
          </button>
          {signal.grade === 'STRONG' && signal.executable && (
            <button
              onClick={() => onExecuteFutures(signal, 'live')}
              disabled={busy || !canLive}
              title={canLive ? 'REAL leveraged CoinDCX futures order (all gates re-verified server-side)' : 'Signal is STRONG — enable LIVE mode in the console to arm execution'}
              className="px-4 py-2 rounded-xl text-xs font-black bg-gradient-to-r from-emerald-600 to-teal-600 text-white hover:from-emerald-500 hover:to-teal-500 disabled:opacity-40 disabled:cursor-not-allowed transition-colors">
              ⚡ EXECUTE LIVE ₮
            </button>
          )}
          {signal.grade !== 'STRONG' && (
            <span className="text-[10px] text-slate-500 self-center px-1">LIVE execution locked — needs STRONG (75%+ conf, 70%+ agreement)</span>
          )}
        </div>
      )}

      {/* Execution buttons (India — Dhan gauntlet, v6.5; v9.0.2: PAPER
          always visible — the old actionable gate hid the paper button on
          WATCH cards and dead-ended India practice entirely) */}
      {signal.market === 'INDIA' && onExecuteIndia && !ticketOpen && (
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
            <span className="text-[10px] text-slate-500 self-center px-1">India LIVE = STRONG signals only · PAPER hamesha open (practice plan @ live price par)</span>
          )}
        </div>
      )}
    </div>
  );
});
