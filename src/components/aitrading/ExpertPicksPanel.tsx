// ============================================================
// src/components/aitrading/ExpertPicksPanel.tsx — v8.0
// ------------------------------------------------------------
// ADVANCE PRO TRADER ENGINE — EXPERT PICKS (80+ AI SCORE).
// Whole-universe CoinDCX scan (spot INR pairs / B-USDT perpetuals /
// NSE names) served by /api/ai/expert-picks. Each pick carries the
// complete trade blueprint: entry zone, stop-loss, T1/T2/T3 partial
// targets, RECOMMENDED LEVERAGE (liquidation-aware), staged exit
// plan, timing window and invalidation — everything the desk asked
// for: "kab entry, kitna leverage, kab exit".
// ============================================================
import { memo, useCallback, useEffect, useRef, useState } from 'react';
import { apiFetch, getProxyBase } from '../../utils/api';

export interface ExpertFactor { key: string; label: string; value: number; weight: number }
export interface ExpertExitStep { at: number; bookPct: number; action: string }
export interface ExpertBlueprint {
  side: 'LONG' | 'SHORT';
  entry: number;
  entryZone: [number, number];
  stopLoss: number;
  targets: { t1: number; t2: number; t3: number };
  rewardRisk: number;
  slDistPct: number;
  leverage: number;
  maxSaneLeverage: number;
  liquidation: number | null;
  exitPlan: ExpertExitStep[];
  timing: { mode: string; note: string };
  horizon: { label: string; hours: number; note: string };
  invalidation: string;
}
export interface ExpertPick {
  symbol: string;
  market: 'INDIA' | 'CRYPTO' | 'FUTURES';
  side: 'LONG' | 'SHORT';
  score: number;
  grade: 'STRONG' | 'ACTION' | 'WATCH';
  ltp: number;
  changePct: number | null;
  factors: ExpertFactor[];
  smcReasons?: string[];
  priceSource?: string | null;
  plan: ExpertBlueprint | null;
}
export interface ExpertPicksView {
  ok: boolean;
  market: string;
  minScore?: number;
  scanned?: number;
  universeSize?: number;
  priceSource?: string | null;
  picks: ExpertPick[];
  reason?: string;
  generatedAt?: number;
}

function priceFmt(market: string): (n: number | null | undefined) => string {
  return (n) => {
    if (n == null || !Number.isFinite(n)) return '—';
    if (market === 'FUTURES') return `${n >= 100 ? n.toFixed(1) : n >= 1 ? n.toFixed(2) : n.toFixed(4)} USDT`;
    return `₹${n >= 100 ? n.toFixed(1) : n >= 1 ? n.toFixed(2) : n.toFixed(4)}`;
  };
}

const SIDE_STYLE = {
  LONG: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/40',
  SHORT: 'bg-rose-500/15 text-rose-300 border-rose-500/40',
} as const;

function ScoreBadge({ score }: { score: number }) {
  const strong = score >= 80;
  return (
    <div className={`flex flex-col items-center justify-center rounded-xl border px-2.5 py-1.5 min-w-[52px] ${strong
      ? 'bg-gradient-to-br from-emerald-500/25 to-cyan-500/15 border-emerald-400/50 shadow-lg shadow-emerald-500/20'
      : 'bg-amber-500/10 border-amber-500/40'}`}
      title={strong ? '80+ AI SCORE — STRONG EXPERT PICK' : 'ACTION grade pick'}>
      <span className={`text-lg font-black font-mono leading-none ${strong ? 'text-emerald-300' : 'text-amber-300'}`}>{score}</span>
      <span className="text-[7px] font-black tracking-widest text-slate-400 mt-0.5">AI SCORE</span>
    </div>
  );
}

function FactorBar({ label, value, weight }: { label: string; value: number; weight: number }) {
  const pct = Math.max(0, Math.min(100, value));
  const color = pct >= 75 ? 'bg-emerald-400' : pct >= 55 ? 'bg-cyan-400' : pct >= 40 ? 'bg-amber-400' : 'bg-rose-400';
  return (
    <div className="flex items-center gap-2" title={`${label}: ${pct}/100 · weight ${Math.round(weight * 100)}%`}>
      <span className="text-[9px] text-slate-500 w-20 shrink-0 font-bold">{label}</span>
      <div className="flex-1 h-1.5 rounded-full bg-slate-800 overflow-hidden">
        <div className={`h-full rounded-full ${color}`} style={{ width: `${pct}%` }} />
      </div>
      <span className="text-[9px] font-mono font-bold text-slate-400 w-7 text-right">{pct}</span>
    </div>
  );
}

const ExpertPickCard = memo(function ExpertPickCard({ pick, market, onDeep }: { pick: ExpertPick; market: string; onDeep?: (symbol: string) => void }) {
  const [open, setOpen] = useState(false);
  const price = priceFmt(market);
  const p = pick.plan;
  const long = pick.side === 'LONG';
  if (!p) return null;
  return (
    <div id={`xp-${pick.market}-${pick.symbol}`} className="quantum-panel rounded-2xl p-4 bg-gradient-to-br from-emerald-500/[0.06] via-transparent to-cyan-500/[0.05]">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-3 flex-wrap">
          <ScoreBadge score={pick.score} />
          <div>
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-base font-black text-white tracking-wide">{pick.symbol}</span>
              <span className={`px-2 py-0.5 rounded-lg text-[10px] font-black border ${SIDE_STYLE[pick.side]}`}>{long ? '▲ LONG' : '▼ SHORT'}</span>
              {market === 'FUTURES' && <span className="px-2 py-0.5 rounded-lg text-[10px] font-black bg-violet-500/15 text-violet-300 border border-violet-500/40">⚡ {p.leverage}× LEV</span>}
              {market === 'CRYPTO' && <span className="px-2 py-0.5 rounded-lg text-[10px] font-black bg-amber-500/10 text-amber-300 border border-amber-500/30">SPOT 1×</span>}
              <span className="px-2 py-0.5 rounded-lg text-[9px] font-black bg-black/30 text-slate-400 border border-slate-700">{p.horizon.label}</span>
            </div>
            <div className="text-[10px] text-slate-500 mt-1 font-mono">
              LTP {price(pick.ltp)}{pick.changePct != null ? ` · 24h ${pick.changePct >= 0 ? '+' : ''}${pick.changePct.toFixed(1)}%` : ''}
              {p.liquidation != null ? ` · liq≈ ${price(p.liquidation)}` : ''}
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <span className={`px-2 py-1 rounded-lg text-[9px] font-black border ${p.timing.mode === 'IMMEDIATE'
            ? 'bg-emerald-500/15 text-emerald-300 border-emerald-500/40'
            : 'bg-amber-500/10 text-amber-300 border-amber-500/30'}`}>
            {p.timing.mode === 'IMMEDIATE' ? '⏱ ABHI ENTRY' : '⏳ PULLBACK WAIT'}
          </span>
          {onDeep && (
            <button onClick={() => onDeep(pick.symbol)} title="Deep analysis kholo"
              className="px-2 py-1 rounded-lg text-[9px] font-black bg-black/30 text-slate-400 border border-slate-700 hover:text-cyan-300 hover:border-cyan-500/40 transition-colors">🔬 DEEP</button>
          )}
          <button onClick={() => setOpen(o => !o)} aria-expanded={open}
            className="px-2 py-1 rounded-lg text-[9px] font-black bg-black/30 text-slate-400 border border-slate-700 hover:text-white hover:border-slate-500 transition-colors">
            {open ? '▲ HIDE PLAN' : '▼ FULL PLAN'}
          </button>
        </div>
      </div>

      {/* levels strip — always visible */}
      <div className="mt-3 grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-1.5">
        {[
          { l: 'ENTRY ZONE', v: `${price(p.entryZone[0])} – ${price(p.entryZone[1])}`, c: 'text-white' },
          { l: 'STOP LOSS', v: price(p.stopLoss), c: 'text-rose-300' },
          { l: 'TARGET 1 (40%)', v: price(p.targets.t1), c: 'text-emerald-300' },
          { l: 'TARGET 2 (40%)', v: price(p.targets.t2), c: 'text-emerald-300' },
          { l: 'TARGET 3 (20%)', v: price(p.targets.t3), c: 'text-emerald-300' },
          { l: 'RISK / R:R', v: `${p.slDistPct.toFixed(1)}% · 1:${p.rewardRisk}`, c: 'text-cyan-300' },
        ].map(x => (
          <div key={x.l} className="rounded-xl bg-black/30 border border-slate-800 px-2.5 py-2">
            <div className="text-[8px] font-black tracking-widest text-slate-600">{x.l}</div>
            <div className={`text-[11px] font-mono font-bold mt-0.5 ${x.c}`}>{x.v}</div>
          </div>
        ))}
      </div>

      {open && (
        <div className="mt-3 space-y-3">
          {/* factor breakdown */}
          <div className="rounded-xl bg-black/20 border border-slate-800 p-3">
            <div className="text-[9px] font-black tracking-widest text-slate-500 mb-2">AI SCORE BREAKDOWN — 7 FACTORS</div>
            <div className="grid sm:grid-cols-2 gap-x-4 gap-y-1.5">
              {(pick.factors || []).map(f => <FactorBar key={f.key} label={f.label} value={f.value} weight={f.weight} />)}
            </div>
          </div>

          {/* exit plan */}
          <div className="rounded-xl bg-black/20 border border-slate-800 p-3">
            <div className="text-[9px] font-black tracking-widest text-slate-500 mb-2">🎯 STAGED EXIT PLAN — kab kitna book karna hai</div>
            <ol className="space-y-1.5">
              {(p.exitPlan || []).map((s, i) => (
                <li key={i} className="flex items-start gap-2">
                  <span className="mt-0.5 w-4 h-4 shrink-0 rounded-md bg-cyan-500/20 text-cyan-300 text-[9px] font-black flex items-center justify-center border border-cyan-500/40">{i + 1}</span>
                  <span className="text-[10px] text-slate-300 font-medium">{s.action}</span>
                </li>
              ))}
            </ol>
          </div>

          {/* timing + horizon + invalidation */}
          <div className="grid sm:grid-cols-3 gap-2">
            <div className="rounded-xl bg-black/20 border border-slate-800 p-3">
              <div className="text-[8px] font-black tracking-widest text-slate-600 mb-1">⏱ TIMING</div>
              <div className="text-[10px] text-slate-300 leading-relaxed">{p.timing.note}</div>
            </div>
            <div className="rounded-xl bg-black/20 border border-slate-800 p-3">
              <div className="text-[8px] font-black tracking-widest text-slate-600 mb-1">📅 HOLD HORIZON</div>
              <div className="text-[10px] text-slate-300 leading-relaxed">{p.horizon.note}</div>
            </div>
            <div className="rounded-xl bg-black/20 border border-rose-900/30 border-slate-800 p-3">
              <div className="text-[8px] font-black tracking-widest text-rose-400/70 mb-1">🚫 INVALIDATION</div>
              <div className="text-[10px] text-slate-300 leading-relaxed">{p.invalidation}</div>
            </div>
          </div>

          {market === 'FUTURES' && (
            <div className="rounded-xl bg-violet-500/[0.06] border border-violet-500/20 p-3">
              <div className="text-[9px] font-black tracking-widest text-violet-300/80 mb-1">⚡ LEVERAGE GUIDANCE</div>
              <div className="text-[10px] text-slate-300 leading-relaxed">
                Recommended <b className="text-violet-300">{p.leverage}×</b> (max sane {p.maxSaneLeverage}× is SL distance pe).
                {p.liquidation != null ? ` Liquidation estimate ${price(p.liquidation)} — SL usse PEHLE hit hoga, yehi design hai (risk-managed).` : ' Isolated margin + sane SL hi use karo.'}
              </div>
            </div>
          )}

          {!!(pick.smcReasons && pick.smcReasons.length) && (
            <div className="rounded-xl bg-black/20 border border-slate-800 p-3">
              <div className="text-[9px] font-black tracking-widest text-slate-500 mb-1">🧠 SMC / SMART MONEY READS</div>
              <ul className="space-y-0.5">
                {pick.smcReasons.slice(0, 4).map((r, i) => <li key={i} className="text-[10px] text-slate-400">• {r}</li>)}
              </ul>
            </div>
          )}
        </div>
      )}
    </div>
  );
});

interface Props {
  active: boolean;
  market: 'INDIA' | 'CRYPTO' | 'FUTURES';
  /** minimum expert score to display (default 80 = STRONG only) */
  minScore?: number;
  onDeep?: (symbol: string) => void;
}

export const ExpertPicksPanel = memo(function ExpertPicksPanel({ active, market, minScore = 80, onDeep }: Props) {
  const [view, setView] = useState<ExpertPicksView | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState(false);
  const activeRef = useRef(active);
  activeRef.current = active;

  const load = useCallback(async () => {
    try {
      const r = await apiFetch(`${getProxyBase()}/api/ai/expert-picks?market=${market}&minScore=${minScore}&limit=12&t=${Date.now()}`, { signal: AbortSignal.timeout(45000) });
      if (!r.ok) throw new Error(String(r.status));
      const j = await r.json();
      setView(j);
      setErr(false);
    } catch { setErr(true); }
    finally { setLoading(false); }
  }, [market, minScore]);

  useEffect(() => {
    if (!active) return;
    load();
    const t = setInterval(() => { if (activeRef.current && !document.hidden) load(); }, 60_000);
    return () => clearInterval(t);
  }, [active, load]);

  const picks = (view?.picks || []).filter(p => p.plan);
  const deskLabel = market === 'FUTURES' ? '⚡ COINDCX GLOBAL FUTURES · USDT PERPS' : market === 'CRYPTO' ? '₿ COINDCX SPOT · INR PAIRS' : '🇮🇳 NSE INDIA DESK';

  return (
    <div className="quantum-panel rounded-2xl p-4 bg-gradient-to-br from-emerald-500/[0.07] via-transparent to-cyan-500/[0.05] border-emerald-500/20">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div className="flex items-center gap-2">
          <span className="text-sm font-black tracking-wide gradient-text-cyan">🧠 EXPERT PICKS — 80+ AI SCORE</span>
          <span className="px-2 py-0.5 rounded-md bg-emerald-500/15 text-emerald-300 text-[9px] font-black border border-emerald-500/30">{deskLabel}</span>
        </div>
        <span className="text-[10px] text-slate-500 font-mono">
          {view?.scanned != null ? `${view.scanned}/${view.universeSize ?? '?'} coins scanned${view.priceSource ? ` · ${view.priceSource}` : ''} · 60s refresh` : 'Advance Pro Trader Engine'}
        </span>
      </div>

      {loading && (
        <div className="py-10 text-center">
          <div className="text-4xl mb-3 animate-float">🧠</div>
          <div className="text-xs text-slate-400">Advance Pro Trader Engine poora universe scan kar raha hai — entry · leverage · exit blueprint ban raha hai…</div>
        </div>
      )}

      {!loading && err && !view?.ok && (
        <div className="py-8 text-center">
          <div className="text-3xl mb-2">📡</div>
          <div className="text-xs text-red-400 font-bold">{view?.reason || 'Expert engine unavailable — data feed unreachable'}</div>
          <div className="text-[10px] text-slate-500 mt-1">60s me auto-retry hoga</div>
        </div>
      )}

      {!loading && (!err || view?.ok) && view && !view.ok && (
        <div className="py-8 text-center">
          <div className="text-3xl mb-2">📡</div>
          <div className="text-xs text-red-400 font-bold">{view.reason || 'Scan failed'}</div>
        </div>
      )}

      {!loading && view?.ok && picks.length === 0 && (
        <div className="py-8 text-center">
          <div className="text-3xl mb-2">😌</div>
          <div className="text-xs text-slate-400 font-bold">Abhi koi 80+ score setup nahi</div>
          <div className="text-[10px] text-slate-500 mt-1">Engine {view.scanned ?? 0} coins scan kar chuka hai — patience hi edge hai. 60s me rescan.</div>
        </div>
      )}

      <div className="mt-3 space-y-2.5">
        {picks.map(p => <ExpertPickCard key={`${p.market}-${p.symbol}`} pick={p} market={market} onDeep={onDeep} />)}
      </div>

      {picks.length > 0 && (
        <div className="mt-2.5 text-[9px] text-slate-600 leading-relaxed">
          Expert picks composite AI score hain (trend · momentum · volume · SMC · volatility · regime · R:R) — investment advice nahi. Levels live prices se derive hote hain; CoinDCX pe execute se pehle verify karo.
        </div>
      )}
    </div>
  );
});
