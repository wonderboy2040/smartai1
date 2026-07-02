import React, { useMemo, useState } from 'react';
import { Position, PriceData } from '../types';
import { runScreener } from '../utils/screener';

interface ScreenerPanelProps {
  portfolio: Position[];
  livePrices: Record<string, PriceData>;
}

const signalColors: Record<string, string> = {
  STRONG_BUY: 'text-emerald-400 bg-emerald-500/10 border-emerald-500/30',
  BUY: 'text-cyan-400 bg-cyan-500/10 border-cyan-500/30',
  HOLD: 'text-amber-400 bg-amber-500/10 border-amber-500/30',
  AVOID: 'text-red-400 bg-red-500/10 border-red-500/30',
};

function getScoreColor(score: number): string {
  if (score >= 75) return 'text-emerald-400';
  if (score >= 55) return 'text-cyan-400';
  if (score >= 35) return 'text-amber-400';
  return 'text-red-400';
}

export const ScreenerPanel = React.memo(({ portfolio, livePrices }: ScreenerPanelProps) => {
  const [showAll, setShowAll] = useState(false);
  const [filter, setFilter] = useState<'ALL' | 'STRONG_BUY' | 'BUY' | 'HOLD' | 'AVOID'>('ALL');

  const results = useMemo(() => {
    return runScreener(portfolio, livePrices);
  }, [portfolio, livePrices]);

  const filtered = useMemo(() => {
    let list = results;
    if (filter !== 'ALL') list = list.filter(r => r.signal === filter);
    return showAll ? list : list.slice(0, 8);
  }, [results, filter, showAll]);

  const counts = useMemo(() => {
    return {
      STRONG_BUY: results.filter(r => r.signal === 'STRONG_BUY').length,
      BUY: results.filter(r => r.signal === 'BUY').length,
      HOLD: results.filter(r => r.signal === 'HOLD').length,
      AVOID: results.filter(r => r.signal === 'AVOID').length,
    };
  }, [results]);

  if (results.length === 0) return null;

  return (
    <div className="quantum-panel p-4 mb-4">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-h2 text-on-surface">SUPER SCREENER v3</h3>
        <span className="text-[10px] text-slate-500">Q35% + M30% + V25% + S10%</span>
      </div>

      {/* Filter Tabs */}
      <div className="flex gap-1.5 mb-3">
        {(['ALL', 'STRONG_BUY', 'BUY', 'HOLD', 'AVOID'] as const).map(f => {
          const count = f === 'ALL' ? results.length : counts[f];
          if (count === 0 && f !== 'ALL') return null;
          return (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={`quantum-btn-ghost px-3 py-1.5 rounded-lg text-xs ${
                filter === f ? 'bg-cyan-500/20 text-cyan-400 border border-cyan-500/30' : ''
              }`}
            >
              {f === 'ALL' ? 'All' : f.replace('_', ' ')} ({count})
            </button>
          );
        })}
      </div>

      {/* Results Grid */}
      <div className="space-y-1.5">
        {filtered.map(r => (
          <div key={r.symbol} className="flex items-center gap-2 quantum-stat px-3 py-2">
            {/* Symbol + Signal */}
            <div className="w-28">
              <div className="text-xs font-medium text-slate-200 truncate">{r.symbol}</div>
              <div className={`text-[9px] font-bold ${signalColors[r.signal]?.split(' ')[0]}`}>
                {r.signal.replace('_', ' ')}
              </div>
            </div>

            {/* Alpha Score */}
            <div className="w-12 text-center">
              <div className={`text-sm font-bold ${getScoreColor(r.alphaScore)}`}>{r.alphaScore}</div>
              <div className="text-[8px] text-slate-600">ALPHA</div>
            </div>

            {/* Factor Bars */}
            <div className="flex-1 grid grid-cols-4 gap-1">
              <div>
                <div className="flex items-center justify-between text-[8px] mb-0.5">
                  <span className="text-slate-500">Q</span>
                  <span className={getScoreColor(r.qualityScore)}>{r.qualityScore}</span>
                </div>
                <div className="quantum-progress">
                  <div className="quantum-progress-fill bg-purple-500" style={{ width: `${r.qualityScore}%` }} />
                </div>
              </div>
              <div>
                <div className="flex items-center justify-between text-[8px] mb-0.5">
                  <span className="text-slate-500">M</span>
                  <span className={getScoreColor(r.momentumScore)}>{r.momentumScore}</span>
                </div>
                <div className="quantum-progress">
                  <div className="quantum-progress-fill bg-cyan-500" style={{ width: `${r.momentumScore}%` }} />
                </div>
              </div>
              <div>
                <div className="flex items-center justify-between text-[8px] mb-0.5">
                  <span className="text-slate-500">V</span>
                  <span className={getScoreColor(r.valueScore)}>{r.valueScore}</span>
                </div>
                <div className="quantum-progress">
                  <div className="quantum-progress-fill bg-amber-500" style={{ width: `${r.valueScore}%` }} />
                </div>
              </div>
              <div>
                <div className="flex items-center justify-between text-[8px] mb-0.5">
                  <span className="text-slate-500">R</span>
                  <span className={r.riskScore != null ? (r.riskScore > 60 ? 'text-red-400' : r.riskScore > 40 ? 'text-amber-400' : 'text-emerald-400') : 'text-slate-500'}>
                    {r.riskScore ?? '—'}
                  </span>
                </div>
                <div className="quantum-progress">
                  <div className="quantum-progress-fill bg-red-500/70" style={{ width: `${r.riskScore || 0}%` }} />
                </div>
              </div>
            </div>

            {/* Key Metrics */}
            <div className="w-24 text-right">
              {/* FIX M19: hardcoded ₹ for US assets — use market-aware currency. */}
              <div className="text-[10px] text-slate-400">{r.market === 'IN' ? '₹' : '$'}{r.price.toFixed(2)}</div>
              <div className="text-[9px] text-slate-500">RSI:{r.rsi.toFixed(0)} | CAGR:{r.cagr}%</div>
            </div>
          </div>
        ))}
      </div>

      {/* Show More */}
      {results.length > 8 && (
        <button
          onClick={() => setShowAll(!showAll)}
          className="w-full mt-2 text-xs text-cyan-400 hover:text-cyan-300 py-1"
        >
          {showAll ? 'Show Less' : `Show All ${results.length} Assets`}
        </button>
      )}

      {/* Legend */}
      <div className="mt-2 pt-2 border-t border-slate-700/50 flex items-center gap-4 text-[9px] text-slate-500">
        <span><span className="text-purple-400">Q</span> = Quality (CAGR, Drawdown)</span>
        <span><span className="text-cyan-400">M</span> = Momentum (RSI, SMA, Trend, Volume)</span>
        <span><span className="text-amber-400">V</span> = Value (PEG, Discount)</span>
        <span><span className="text-red-400">R</span> = Risk Score</span>
      </div>
    </div>
  );
});

ScreenerPanel.displayName = 'ScreenerPanel';
