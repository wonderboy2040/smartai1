// ============================================================
// RiskAnalyticsCard — v13.2 (accuracy plan A4)
// ------------------------------------------------------------
// The SERVER-computed risk layer for the Portfolio tab:
//   • REAL Sharpe + Sortino (downside deviation — the client
//     riskEngine's sortino was sharpe×1.3, a placeholder) per
//     holding AND portfolio-level, on 90d daily closes
//   • Correlation matrix heatmap across holdings (Pearson on
//     aligned daily returns)
//   • Vol-parity rebalance drift engine — concrete "trim A → add
//     B" suggestions, not vibe strings
//   • LTCG/STCG tax-loss-harvest lives in TaxOptimizationSuite
//     (Planner tab) — this card is pure MARKET risk.
// Data: GET /api/ai/portfolio-risk (server cache 1h; Yahoo for
// equities, Binance 1d for crypto; fixed/EPF/bonds honestly
// listed as skipped — no fake series).
// ============================================================
import { memo, useCallback, useEffect, useState } from 'react';
import { apiFetch } from '../../utils/api';

interface HoldingRow {
  label: string; kind: string; market: string;
  valueINR: number; weightPct: number;
  annReturnPct: number; annVolPct: number;
  sharpe: number | null; sortino: number | null;
  maxDrawdownPct: number; points: number;
}
interface RiskPayload {
  ok: boolean; cached?: boolean; reason?: string;
  rfAnnualPct?: number; lookbackDays?: number; generatedAt?: string;
  holdings?: HoldingRow[];
  skipped?: Array<{ label: string; kind: string; reason: string }>;
  portfolio?: { sharpe: number | null; sortino: number | null; annVolPct: number; annReturnPct: number; maxDrawdownPct: number; holdingsCount: number; alignedPoints: number } | null;
  correlation?: { symbols: string[]; matrix: (number | null)[][] };
  rebalance?: { rows: Array<{ label: string; currentPct: number; targetPct: number; driftPct: number; volParityPct: number; equalWeightPct: number }>; suggestions: string[] };
}

const corrColor = (v: number | null) => {
  if (v == null) return 'bg-slate-800/60 text-slate-600';
  if (v >= 0.7) return 'bg-rose-500/30 text-rose-200';
  if (v >= 0.4) return 'bg-amber-500/25 text-amber-200';
  if (v > -0.2) return 'bg-slate-600/30 text-slate-300';
  if (v > -0.6) return 'bg-cyan-500/25 text-cyan-200';
  return 'bg-emerald-500/25 text-emerald-200'; // strong negative = diversification gold
};

const StatTile = ({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone?: string }) => (
  <div className="rounded-xl bg-black/40 border border-white/5 px-3 py-2">
    <div className="text-[9px] font-black uppercase tracking-wider text-slate-500">{label}</div>
    <div className={`text-base font-black font-mono ${tone || 'text-white'}`}>{value}</div>
    {sub && <div className="text-[8px] text-slate-600 font-mono mt-0.5">{sub}</div>}
  </div>
);

export const RiskAnalyticsCard = memo(function RiskAnalyticsCard() {
  const [data, setData] = useState<RiskPayload | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [open, setOpen] = useState(false);

  const load = useCallback(async () => {
    setBusy(true); setErr(null);
    try {
      const res = await apiFetch('/api/ai/portfolio-risk');
      const r = await res.json().catch(() => null);
      if (r?.ok) { setData(r); }
      else setErr(String(r?.reason || 'risk analytics unavailable'));
    } catch (e) {
      setErr(String((e as Error)?.message || e));
    } finally { setBusy(false); }
  }, []);

  useEffect(() => { if (open && !data && !busy) load(); }, [open, data, busy, load]);

  const p = data?.portfolio ?? null;
  const holdings = data?.holdings ?? [];
  const corr = data?.correlation;
  const reb = data?.rebalance;
  const hasCorr = !!corr && (corr.symbols?.length || 0) >= 2;

  return (
    <div className="quantum-panel rounded-2xl p-4 animate-fade-in-up">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-violet-500/10 flex items-center justify-center text-base">📊</div>
          <div>
            <div className="text-[10px] text-violet-400/80 font-bold uppercase tracking-wider">Risk Analytics — Sharpe · Sortino · Correlation · Rebalance</div>
            <div className="text-[9px] text-slate-500">
              {data?.generatedAt
                ? `90d daily closes · rf ${data.rfAnnualPct}% · ${p ? `${p.holdingsCount} holdings · ${p.alignedPoints} aligned pts` : '—'}${data.cached ? ' · cached 1h' : ''}`
                : 'Server-computed real risk (downside-deviation Sortino, correlation heatmap, vol-parity drift)'}
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {holdings.length > 0 && (
            <button
              onClick={() => setOpen(o => !o)}
              className="text-[9px] font-black px-2.5 py-1.5 rounded-lg border border-violet-500/40 text-violet-300 hover:bg-violet-500/15 font-mono"
            >
              {open ? '▲ COLLAPSE' : '▼ HOLDINGS DETAIL'}
            </button>
          )}
          <button
            onClick={load}
            disabled={busy}
            className="text-[9px] font-black px-2.5 py-1.5 rounded-lg border border-white/10 text-slate-300 hover:bg-white/5 font-mono disabled:opacity-40"
          >
            {busy ? '⟳ COMPUTING…' : '⟳ REFRESH'}
          </button>
        </div>
      </div>

      {err && (
        <div className="mt-3 text-[10px] font-mono text-amber-300/90 rounded-lg border border-amber-500/25 bg-amber-500/5 px-3 py-2">
          ⚠️ {err}
        </div>
      )}

      {/* ---- portfolio-level tiles ---- */}
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-3 mt-3">
        <StatTile label="Portfolio Sharpe" value={p?.sharpe != null ? p.sharpe.toFixed(2) : '—'} sub={`rf ${data?.rfAnnualPct ?? 6.5}% · ann.`} tone={(p?.sharpe ?? 0) >= 1 ? 'text-emerald-300' : (p?.sharpe ?? 0) >= 0 ? 'text-white' : 'text-red-300'} />
        <StatTile label="Sortino (REAL)" value={p?.sortino != null ? p.sortino.toFixed(2) : '—'} sub="downside deviation" tone="text-violet-300" />
        <StatTile label="Ann. Volatility" value={p?.annVolPct != null ? `${p.annVolPct}%` : '—'} sub="portfolio, 90d" tone={((p?.annVolPct ?? 0) > 30) ? 'text-amber-300' : 'text-white'} />
        <StatTile label="Ann. Return" value={p?.annReturnPct != null ? `${p.annReturnPct > 0 ? '+' : ''}${p.annReturnPct}%` : '—'} sub="90d → annualized" tone={(p?.annReturnPct ?? 0) >= 0 ? 'text-emerald-300' : 'text-red-300'} />
        <StatTile label="Max Drawdown" value={p?.maxDrawdownPct != null ? `−${p.maxDrawdownPct}%` : '—'} sub="90d peak-to-trough" tone={((p?.maxDrawdownPct ?? 0) > 20) ? 'text-red-300' : 'text-white'} />
      </div>

      {/* ---- correlation heatmap + rebalance side by side ---- */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mt-3">
        {hasCorr && (
          <div className="rounded-xl bg-black/40 border border-white/5 px-3 py-2.5">
            <div className="text-[9px] font-black uppercase tracking-wider text-slate-400 mb-2">🔗 Correlation Matrix (90d daily returns)</div>
            <div className="overflow-x-auto">
              <table className="text-[9px] font-mono border-separate" style={{ borderSpacing: '2px' }}>
                <thead>
                  <tr>
                    <th className="text-slate-600 w-14" />
                    {corr!.symbols.map(s => <th key={s} className="text-slate-500 font-bold px-1 truncate max-w-[52px]" title={s}>{s.slice(0, 6)}</th>)}
                  </tr>
                </thead>
                <tbody>
                  {corr!.matrix.map((row, i) => (
                    <tr key={corr!.symbols[i]}>
                      <td className="text-slate-500 font-bold truncate max-w-[56px] pr-1" title={corr!.symbols[i]}>{corr!.symbols[i].slice(0, 6)}</td>
                      {row.map((v, j) => (
                        <td key={j} className={`px-1.5 py-1 rounded text-center font-black ${corrColor(v)}`} title={v == null ? 'n/a' : `${corr!.symbols[i]} vs ${corr!.symbols[j]}: r=${v}`}>
                          {v == null ? '—' : v.toFixed(2).replace(/^(-?)0\./, '$1.')}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="text-[8px] text-slate-600 font-mono mt-1.5">r &gt; 0.7 = same bet twice (rose) · r &lt; −0.6 = diversification gold (green)</div>
          </div>
        )}
        {reb && (reb.suggestions?.length || 0) > 0 && (
          <div className="rounded-xl bg-black/40 border border-white/5 px-3 py-2.5">
            <div className="text-[9px] font-black uppercase tracking-wider text-slate-400 mb-2">⚖️ Rebalance Drift (vol-parity × equal-weight blend)</div>
            <div className="space-y-1.5">
              {reb.suggestions.map((s, i) => (
                <div key={i} className="text-[10px] font-mono text-slate-300 leading-relaxed border-l-2 border-violet-500/40 pl-2">→ {s}</div>
              ))}
            </div>
            <div className="text-[8px] text-slate-600 font-mono mt-1.5">Targets: 70% inverse-vol + 30% equal-weight. Drift &gt; 3% hi action-worthy.</div>
          </div>
        )}
      </div>

      {/* ---- per-holding detail ---- */}
      {open && holdings.length > 0 && (
        <div className="mt-3 rounded-xl bg-black/40 border border-white/5 px-3 py-2.5 overflow-x-auto">
          <div className="text-[9px] font-black uppercase tracking-wider text-slate-400 mb-2">📋 Per-Holding Risk (90d)</div>
          <table className="w-full text-[9px] font-mono">
            <thead>
              <tr className="text-slate-600">
                <th className="text-left pb-1">HOLDING</th><th className="text-right pb-1">WT%</th><th className="text-right pb-1">ANN RET</th>
                <th className="text-right pb-1">VOL</th><th className="text-right pb-1">SHARPE</th><th className="text-right pb-1">SORTINO</th>
                <th className="text-right pb-1">MAXDD</th><th className="text-right pb-1">PTS</th>
              </tr>
            </thead>
            <tbody>
              {holdings.map((h, i) => (
                <tr key={`${h.label}-${i}`} className="border-t border-white/5">
                  <td className="py-1 text-slate-300 font-bold truncate max-w-[120px]" title={`${h.label} (${h.kind})`}>{h.label}</td>
                  <td className="text-right text-slate-400">{h.weightPct?.toFixed(1)}</td>
                  <td className={`text-right ${(h.annReturnPct ?? 0) >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>{h.annReturnPct?.toFixed(1)}%</td>
                  <td className="text-right text-slate-400">{h.annVolPct?.toFixed(1)}%</td>
                  <td className={`text-right ${(h.sharpe ?? 0) >= 1 ? 'text-emerald-300' : (h.sharpe ?? 0) >= 0 ? 'text-slate-300' : 'text-red-300'}`}>{h.sharpe?.toFixed(2) ?? '—'}</td>
                  <td className="text-right text-violet-300">{h.sortino?.toFixed(2) ?? '—'}</td>
                  <td className="text-right text-amber-300/90">−{h.maxDrawdownPct?.toFixed(1)}%</td>
                  <td className="text-right text-slate-600">{h.points}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {(data?.skipped?.length || 0) > 0 && (
            <div className="mt-2 text-[8px] font-mono text-slate-600 leading-relaxed">
              Skipped (koi honest daily series nahi): {data!.skipped!.map(s => `${s.label} (${s.reason})`).join(' · ')}
            </div>
          )}
        </div>
      )}
    </div>
  );
});
