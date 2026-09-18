// ============================================================
// PortfolioInsights — Portfolio TAB intelligence panel (v4.5)
// ------------------------------------------------------------
// Live portfolio X-ray, all computed client-side from the SAME
// GroupedAsset rows the assets table renders (sync-truth P&L —
// assetPnl.ts), so every number matches the table exactly:
//   • Today's biggest winners / losers (₹ impact)
//   • All-time best / worst performers (P&L %)
//   • Diversification health — HHI + top-1/top-3 concentration,
//     pro-advisor Hinglish note
//   • Market split bar (India / USA / Crypto)
// Zero server calls — re-renders on every live tick snapshot.
// ============================================================
import { memo, useMemo } from 'react';
import { computePortfolioInsights, type InsightAsset } from '../../utils/portfolioInsights';

export interface InsightsPanelAsset {
  label: string;
  group: 'india' | 'usa' | 'crypto';
  pl: number;
  plPct: number;
  todayPL: number;
  valINR: number;
}

const GROUP_META = {
  india: { flag: '🇮🇳', cls: 'text-orange-400', bar: 'bg-orange-500' },
  usa: { flag: '🦅', cls: 'text-blue-400', bar: 'bg-blue-500' },
  crypto: { flag: '🪙', cls: 'text-purple-400', bar: 'bg-purple-500' },
} as const;

function ImpactRow({ a, field }: { a: InsightAsset; field: 'todayPL' | 'plPct' }) {
  const native = field === 'todayPL' ? a.todayPL : a.plPct;
  const up = native >= 0;
  const shown = field === 'todayPL'
    ? `${native >= 0 ? '+' : '−'}${Math.abs(native).toFixed(0)}`
    : `${native >= 0 ? '+' : '−'}${Math.abs(native).toFixed(1)}%`;
  const meta = GROUP_META[a.group];
  return (
    <div className="flex items-center justify-between gap-2 text-[10px] py-0.5">
      <span className="flex items-center gap-1.5 min-w-0">
        <span>{meta.flag}</span>
        <span className="text-slate-300 font-mono font-bold truncate">{a.label}</span>
      </span>
      <span className={`font-mono font-black shrink-0 ${up ? 'text-emerald-400' : 'text-red-400'}`}>{shown}</span>
    </div>
  );
}

function MiniList({ title, titleCls, rows, field }: {
  title: string; titleCls: string; rows: InsightAsset[]; field: 'todayPL' | 'plPct';
}) {
  return (
    <div className="rounded-xl bg-black/40 border border-white/5 px-3 py-2">
      <div className={`text-[9px] font-black uppercase tracking-wider mb-1 ${titleCls}`}>{title}</div>
      {rows.length > 0 ? rows.map((a, i) => <ImpactRow key={`${a.label}-${i}`} a={a} field={field} />)
        : <div className="text-[9px] text-slate-600 font-mono py-1">—</div>}
    </div>
  );
}

export const PortfolioInsights = memo(function PortfolioInsights({ assets, totalValueINR }: {
  assets: InsightsPanelAsset[]; totalValueINR: number;
}) {
  const result = useMemo(
    () => computePortfolioInsights(assets, totalValueINR),
    [assets, totalValueINR],
  );

  if (assets.length === 0) return null;

  const { health, marketSplit, top3Weight, diversificationScore, topWeight, markets } = result;
  const splitEntries = (['india', 'usa', 'crypto'] as const)
    .map(g => ({ g, pct: marketSplit[g] }))
    .filter(e => e.pct > 0.4);

  return (
    <div className="quantum-panel rounded-2xl p-4 animate-fade-in-up">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-cyan-500/10 flex items-center justify-center text-base">🧠</div>
          <div>
            <div className="text-[10px] text-cyan-400/80 font-bold uppercase tracking-wider">Portfolio Insights — Live X-Ray</div>
            <div className="text-[9px] text-slate-500">Table ke SAME sync-truth numbers se — daily + all-time + risk</div>
          </div>
        </div>
        <span className={`text-[9px] font-black px-2 py-1 rounded-lg border font-mono ${health.cls}`} title={health.note}>
          {health.grade}
        </span>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mt-3">
        <MiniList title="🚀 Today's Winners" titleCls="text-emerald-400" rows={result.todayWinners} field="todayPL" />
        <MiniList title="🩸 Today's Losers" titleCls="text-red-400" rows={result.todayLosers} field="todayPL" />
        <MiniList title="🏆 Best (All-Time)" titleCls="text-emerald-300" rows={result.bestPerformers} field="plPct" />
        <MiniList title="⚠️ Worst (All-Time)" titleCls="text-red-300" rows={result.worstPerformers} field="plPct" />
      </div>

      {/* Diversification + market split */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mt-3">
        <div className="rounded-xl bg-black/40 border border-white/5 px-3 py-2.5">
          <div className="flex items-center justify-between">
            <span className="text-[9px] font-black uppercase tracking-wider text-slate-400">Diversification</span>
            <span className="text-sm font-black font-mono text-white">
              {diversificationScore}<span className="text-[9px] text-slate-500">/100</span>
            </span>
          </div>
          <div className="mt-1.5 h-1.5 rounded-full bg-slate-800 overflow-hidden">
            <div
              className={`h-full rounded-full transition-all duration-700 ${diversificationScore >= 70 ? 'bg-emerald-400' : diversificationScore >= 45 ? 'bg-cyan-400' : diversificationScore >= 25 ? 'bg-amber-400' : 'bg-red-400'}`}
              style={{ width: `${Math.max(3, diversificationScore)}%` }}
            />
          </div>
          <div className="flex items-center justify-between text-[9px] text-slate-500 font-mono mt-1.5">
            <span>Top-1: <b className="text-slate-300">{topWeight.toFixed(1)}%</b></span>
            <span>Top-3: <b className="text-slate-300">{top3Weight.toFixed(1)}%</b></span>
            <span>Markets: <b className="text-slate-300">{markets}/3</b></span>
          </div>
          <p className="text-[9px] text-slate-500 font-mono mt-1.5 leading-relaxed" title={health.note}>
            {health.note}
          </p>
        </div>

        <div className="rounded-xl bg-black/40 border border-white/5 px-3 py-2.5">
          <span className="text-[9px] font-black uppercase tracking-wider text-slate-400">Market Split</span>
          <div className="flex h-2.5 rounded-full overflow-hidden mt-2 bg-slate-800">
            {splitEntries.map(e => (
              <div
                key={e.g}
                className={GROUP_META[e.g].bar}
                style={{ width: `${e.pct}%` }}
                title={`${e.g}: ${e.pct.toFixed(1)}%`}
              />
            ))}
          </div>
          <div className="flex items-center gap-3 flex-wrap mt-2">
            {splitEntries.map(e => (
              <span key={e.g} className="flex items-center gap-1 text-[10px] font-mono font-bold">
                <span>{GROUP_META[e.g].flag}</span>
                <span className={GROUP_META[e.g].cls}>{e.pct.toFixed(1)}%</span>
              </span>
            ))}
          </div>
          <p className="text-[9px] text-slate-500 font-mono mt-1.5">
            INR-home bias: {marketSplit.india > 70 ? 'heavy India tilt — US/crypto thoda add karke FX diversify karein' : marketSplit.india < 30 ? 'India exposure kam — home-market opportunities miss ho rahe hain' : 'balanced spread hai'}
          </p>
        </div>
      </div>
    </div>
  );
});

export default PortfolioInsights;
