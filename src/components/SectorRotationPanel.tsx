import React, { useMemo } from 'react';
import { Position, PriceData } from '../types';
import { calculateSectorMomentum, analyzePortfolioSectorExposure } from '../utils/macroRegime';

interface SectorRotationPanelProps {
  portfolio: Position[];
  livePrices: Record<string, PriceData>;
  sectorData: { name: string; change: number }[];
}

const trendColors: Record<string, string> = {
  LEADING: 'text-emerald-400 bg-emerald-500/10',
  IMPROVING: 'text-cyan-400 bg-cyan-500/10',
  LAGGING: 'text-red-400 bg-red-500/10',
  WEAKENING: 'text-orange-400 bg-orange-500/10',
};

const trendIcons: Record<string, string> = {
  LEADING: '🟢',
  IMPROVING: '🔵',
  LAGGING: '🔴',
  WEAKENING: '🟠',
};

function getScoreColor(score: number): string {
  if (score > 65) return 'text-emerald-400';
  if (score > 50) return 'text-cyan-400';
  if (score > 35) return 'text-amber-400';
  return 'text-red-400';
}

export const SectorRotationPanel = React.memo(({ portfolio, livePrices, sectorData }: SectorRotationPanelProps) => {
  // Get benchmark change (NIFTY or SPY)
  const benchmarkChange = livePrices['NSE:NIFTY']?.change || livePrices['AMEX:SPY']?.change || 0;

  const sectorMomentum = useMemo(() => {
    if (sectorData.length === 0) return [];
    return calculateSectorMomentum(sectorData, benchmarkChange);
  }, [sectorData, benchmarkChange]);

  const exposure = useMemo(() => {
    if (portfolio.length === 0 || sectorMomentum.length === 0) return null;
    return analyzePortfolioSectorExposure(portfolio, livePrices, sectorMomentum);
  }, [portfolio, livePrices, sectorMomentum]);

  if (sectorData.length === 0) return null;

  return (
    <div className="quantum-panel p-4 mb-4">
      <h3 className="text-sm font-h2 text-on-surface mb-3">SECTOR ROTATION INTELLIGENCE</h3>

      {/* Sector Heatmap */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mb-4">
        {sectorMomentum.map(s => (
          <div key={s.name} className={`rounded-lg p-2 border border-slate-700/30 ${trendColors[s.trend]}`}>
            <div className="flex items-center justify-between mb-1">
              <span className="text-xs font-medium text-slate-200 truncate">{s.name}</span>
              <span className="text-[10px]">{trendIcons[s.trend]}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className={`text-sm font-mono ${s.change >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                {s.change >= 0 ? '+' : ''}{s.change.toFixed(2)}%
              </span>
              <span className={`text-xs font-bold ${getScoreColor(s.compositeScore)}`}>
                {s.compositeScore}
              </span>
            </div>
            <div className="text-[9px] text-slate-500 mt-0.5">{s.trend}</div>
          </div>
        ))}
      </div>

      {/* Portfolio Exposure */}
      {exposure && exposure.recommendations.length > 0 && (
        <div className="border-t border-slate-700/50 pt-3">
          <div className="text-xs font-medium text-slate-400 mb-2">YOUR PORTFOLIO EXPOSURE</div>
          <div className="space-y-1.5">
            {exposure.recommendations.map(r => (
              <div key={r.sector} className="flex items-center gap-2 text-xs">
                <span className="text-slate-300 w-28 truncate">{r.sector}</span>
                <div className="flex-1 quantum-progress">
                  <div
                    className={`quantum-progress-fill ${r.momentum > 50 ? 'bg-emerald-500' : r.momentum > 35 ? 'bg-amber-500' : 'bg-red-500'}`}
                    style={{ width: `${Math.min(r.currentPct, 100)}%` }}
                  />
                </div>
                <span className="text-slate-400 w-10 text-right">{r.currentPct}%</span>
                <span className={`text-[10px] w-8 text-right ${getScoreColor(r.momentum)}`}>{r.momentum}</span>
              </div>
            ))}
          </div>

          {/* Key Insight */}
          {exposure.recommendations.length > 0 && exposure.recommendations[0].currentPct > 30 && (
            <div className="mt-2 quantum-stat p-2">
              <p className="text-[11px] text-slate-400">
                <span className="text-amber-400 font-medium">Insight: </span>
                Your {exposure.recommendations[0].currentPct}% in {exposure.recommendations[0].sector} — {exposure.recommendations[0].action}
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  );
});

SectorRotationPanel.displayName = 'SectorRotationPanel';
