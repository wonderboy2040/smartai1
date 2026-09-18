// ============================================================
// src/components/aitrading/ModelPerformancePanel.tsx — v10.6
// ------------------------------------------------------------
// Pro Upgrade #5 — the WALK-FORWARD BACKTEST / CALIBRATION DASHBOARD.
// backtest.py, trust.js (calibration + Brier) and per-model governance
// already compute real accuracy numbers server-side; this is the one
// read-only surface where a trader finally SEES them together:
//
//   • per-model win-rate over rolling 30/90 days (which of the 14
//     models is actually pulling its weight THIS MONTH)
//   • calibration bucket chart — claimed confidence vs realized
//     win-rate (the trust.js output, charted)
//   • the REGIME down-weight indicator (feeds off Pro Upgrade #4):
//     which models the current TRENDING/CHOPPY/HIGH_VOL/LOW_VOL
//     state is tilting down, and whether the tilt is even armed
//
// Collapsible (collapsed by default — never intrudes on the board).
// Data: GET /api/ai/trust (extended v10.6) — already fetched by the
// desk hook's fetchTrust(); no new backend call from this panel.
// ============================================================
import { memo, useCallback, useEffect, useState } from 'react';
import { fetchTrust } from './useAITrading';
import type { ModelPerfRow, RegimeReweightState, TrustView } from './types';

function ModelWinRateBars({ rows, label }: { rows: ModelPerfRow[]; label: string }) {
  if (!rows || rows.length === 0) {
    return <div className="text-[10px] text-slate-600 py-1">No settled trades with model votes in the {label} window yet.</div>;
  }
  return (
    <div className="space-y-1">
      {rows.slice(0, 12).map(r => (
        <div key={r.model} className="flex items-center gap-2 text-[10px] font-mono" title={`${r.name}: ${r.n} attributed settled trades in ${label}`}>
          <span className="text-slate-400 w-28 truncate">{r.name}</span>
          <span className="text-slate-600 w-8 text-right">n={r.n}</span>
          <div className="flex-1 h-2 bg-black/40 rounded overflow-hidden relative">
            <div
              className={`h-full ${(r.hitRate ?? 0) >= 55 ? 'bg-emerald-500/50' : (r.hitRate ?? 0) >= 45 ? 'bg-amber-500/50' : 'bg-red-500/50'}`}
              style={{ width: `${Math.min(100, r.hitRate ?? 0)}%` }}
            />
            <div className="absolute top-0 bottom-0 w-px bg-slate-500" style={{ left: '50%' }} title="50% line" />
          </div>
          <span className={`w-12 text-right font-black ${(r.hitRate ?? 0) >= 55 ? 'text-emerald-300' : (r.hitRate ?? 0) >= 45 ? 'text-amber-300' : 'text-red-300'}`}>
            {r.hitRate != null ? `${r.hitRate}%` : '—'}
          </span>
        </div>
      ))}
    </div>
  );
}

function RegimeTilt({ state, desk }: { state: RegimeReweightState | undefined; desk: string }) {
  if (!state) return null;
  const labelCls = state.label === 'TRENDING' ? 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30'
    : state.label === 'HIGH_VOL' ? 'bg-red-500/15 text-red-300 border-red-500/30'
    : state.label === 'CHOPPY' ? 'bg-amber-500/15 text-amber-300 border-amber-500/30'
    : 'bg-cyan-500/15 text-cyan-300 border-cyan-500/30';
  return (
    <div className="bg-black/20 rounded-xl p-2.5 border border-white/5">
      <div className="flex items-center gap-2 flex-wrap mb-1.5">
        <span className="text-[9px] font-black text-slate-500 tracking-wider">{desk} REGIME</span>
        {state.enabled && state.label ? (
          <span className={`px-1.5 py-0.5 rounded text-[9px] font-black border ${labelCls}`}>{state.label}</span>
        ) : (
          <span className="px-1.5 py-0.5 rounded text-[9px] font-black bg-slate-600/20 text-slate-400 border border-slate-600/30">tilt OFF</span>
        )}
        <span className="text-[8px] text-slate-600 ml-auto">±25% max · weighted-avg path only</span>
      </div>
      {state.enabled && state.label ? (
        <div className="flex flex-wrap gap-1">
          {state.downWeighted.map(m => (
            <span key={m.id} className="px-1.5 py-0.5 rounded text-[9px] font-mono font-bold bg-red-500/10 text-red-300 border border-red-500/20" title={`weight ×${m.mul} under ${state.label}`}>
              {m.name} ↓{m.mul}
            </span>
          ))}
          {state.upWeighted.map(m => (
            <span key={m.id} className="px-1.5 py-0.5 rounded text-[9px] font-mono font-bold bg-emerald-500/10 text-emerald-300 border border-emerald-500/20" title={`weight ×${m.mul} under ${state.label}`}>
              {m.name} ↑{m.mul}
            </span>
          ))}
        </div>
      ) : (
        <div className="text-[9px] text-slate-500 leading-relaxed">{state.note}</div>
      )}
    </div>
  );
}

function CalibrationChart({ view }: { view: TrustView }) {
  const cal = view.calibration;
  if (!cal?.sufficient || !cal.calibration?.length) {
    return <div className="text-[10px] text-slate-600 py-1">{cal?.note || 'Insufficient settled outcomes for calibration — track record gather hone do.'}</div>;
  }
  return (
    <div className="space-y-1">
      {(cal.calibration || []).map(b => (
        <div key={b.bucket} className="flex items-center gap-2 text-[10px] font-mono">
          <span className="text-slate-500 w-14">{b.bucket}</span>
          <span className="text-slate-600 w-8">n={b.n}</span>
          <div className="flex-1 h-2 bg-black/40 rounded overflow-hidden relative">
            <div className="absolute top-0 bottom-0 w-px bg-slate-500" style={{ left: `${Math.min(98, b.claimed)}%` }} title={`claimed ${b.claimed}%`} />
            <div className={`h-full ${b.winRate != null && b.winRate >= b.claimed ? 'bg-emerald-500/50' : 'bg-amber-500/50'}`} style={{ width: `${Math.min(100, b.winRate ?? 0)}%` }} />
          </div>
          <span className={`w-20 text-right font-black ${b.gap == null ? 'text-slate-600' : b.gap >= 0 ? 'text-emerald-300' : 'text-amber-300'}`}>
            {b.winRate ?? '—'}%{b.gap != null ? ` (${b.gap > 0 ? '+' : ''}${b.gap})` : ''}
          </span>
        </div>
      ))}
      <div className="text-[9px] text-slate-600 pt-0.5">
        claimed (the line) vs realized (the bar) · Brier {cal.brier ?? '—'} — {cal.brierVerdict || ''}
      </div>
    </div>
  );
}

interface Props {
  /** which desk's regime tilt to highlight (kept for the panel contract —
   *  both desks' tilts always render side-by-side in the grid) */
  desk?: 'INDIA' | 'CRYPTO';
}

export const ModelPerformancePanel = memo(function ModelPerformancePanel(_props: Props) {
  const [view, setView] = useState<TrustView | null>(null);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setView(await fetchTrust());
    setLoading(false);
  }, []);

  useEffect(() => { if (open) load(); }, [open, load]);

  const win = view?.windows;

  return (
    <div className="quantum-panel rounded-2xl">
      <button
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center justify-between gap-2 px-4 py-3 text-left"
        aria-expanded={open}
        aria-label="Model performance dashboard"
      >
        <span className="text-xs font-black text-slate-200">🧪 MODEL PERFORMANCE — kaun kitna sahi bol raha hai?</span>
        <span className="flex items-center gap-2">
          <span className="px-1.5 py-0.5 rounded-md text-[9px] font-black bg-violet-500/10 text-violet-300 border border-violet-500/20">v10.6</span>
          <span className="text-slate-500 text-[10px] font-black">{open ? '▲' : '▼'}</span>
        </span>
      </button>

      {open && (
        <div className="px-4 pb-4 space-y-3">
          {/* refresh row */}
          <div className="flex items-center gap-2">
            <button onClick={load} disabled={loading} className="quantum-btn-ghost px-2 py-1 rounded-lg text-[10px] font-bold" aria-label="Refresh model performance">
              <span className={loading ? 'inline-block animate-spin' : ''}>🔄</span> refresh
            </button>
            {win && <span className="text-[9px] text-slate-600">{win.settledTotal} settled outcomes on record</span>}
          </div>

          {/* regime tilt (Upgrade #4 indicator) */}
          <div className="grid gap-2 sm:grid-cols-2">
            <RegimeTilt state={view?.regimeReweight?.INDIA} desk="INDIA" />
            <RegimeTilt state={view?.regimeReweight?.CRYPTO} desk="CRYPTO" />
          </div>

          {/* per-model rolling win-rates */}
          <div className="grid gap-2 sm:grid-cols-2">
            <div className="bg-black/20 rounded-xl p-2.5">
              <div className="text-[9px] font-black text-slate-500 tracking-wider mb-1.5">PER-MODEL WIN-RATE · 30 DAYS</div>
              <ModelWinRateBars rows={win?.d30 || []} label="30-day" />
            </div>
            <div className="bg-black/20 rounded-xl p-2.5">
              <div className="text-[9px] font-black text-slate-500 tracking-wider mb-1.5">PER-MODEL WIN-RATE · 90 DAYS</div>
              <ModelWinRateBars rows={win?.d90 || []} label="90-day" />
            </div>
          </div>

          {/* calibration chart */}
          <div className="bg-black/20 rounded-xl p-2.5">
            <div className="text-[9px] font-black text-slate-500 tracking-wider mb-1.5">CALIBRATION — bola vs hua (claimed vs realized)</div>
            <CalibrationChart view={view || ({} as TrustView)} />
          </div>

          <p className="text-[9px] text-slate-600 leading-relaxed">
            Attribution = a model wins when its recorded vote direction matched the settled outcome. Small n = noise, not edge — 30/90d windows ke liye kam-se-kam 20+ attributed trades chahiye before judging a model. Run the A/B yourself: Backtest panel → <b>strategy=regime_weighted</b> (or <code>python -m models.backtest --strategy regime_weighted</code> in ml-service) — regime tilt tabhi ON karo jab walk-forward bhi bole.
          </p>
        </div>
      )}
    </div>
  );
});
