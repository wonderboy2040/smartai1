import React, { useMemo } from 'react';
import { PriceData } from '../types';
import { detectMacroRegime } from '../utils/macroRegime';

interface MacroRegimePanelProps {
  livePrices: Record<string, PriceData>;
}

const regimeColors: Record<string, string> = {
  RISK_ON: 'text-emerald-400 bg-emerald-500/10 border-emerald-500/30',
  RISK_OFF: 'text-red-400 bg-red-500/10 border-red-500/30',
  STAGFLATION: 'text-orange-400 bg-orange-500/10 border-orange-500/30',
  GOLDILOCKS: 'text-cyan-400 bg-cyan-500/10 border-cyan-500/30',
};

const regimeIcons: Record<string, string> = {
  RISK_ON: '🟢',
  RISK_OFF: '🔴',
  STAGFLATION: '🟠',
  GOLDILOCKS: '💎',
};

const actionColors: Record<string, string> = {
  OVERWEIGHT: 'text-emerald-400',
  UNDERWEIGHT: 'text-red-400',
  NEUTRAL: 'text-slate-400',
};

export const MacroRegimePanel = React.memo(({ livePrices }: MacroRegimePanelProps) => {
  const regime = useMemo(() => detectMacroRegime(livePrices), [livePrices]);

  // FIX L38: if backend returns an unexpected regime string, the lookup is
  // `undefined` → className interpolates as "undefined". Fall back to NEUTRAL.
  const color = regimeColors[regime.regime] ?? regimeColors.NEUTRAL;
  const icon = regimeIcons[regime.regime] ?? regimeIcons.NEUTRAL;

  return (
    <div className="quantum-panel p-4 mb-4">
      <h3 className="text-sm font-h2 text-on-surface mb-3">MACRO REGIME DETECTOR</h3>

      {/* Regime Badge */}
      <div className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-lg border text-sm font-bold mb-3 ${color}`}>
        <span>{icon}</span>
        <span>{regime.regime.replace('_', ' ')}</span>
        <span className="text-xs font-normal opacity-70">({regime.confidence}%)</span>
      </div>

      {/* Key Metrics */}
      <div className="grid grid-cols-3 gap-3 mb-3">
        <div className="text-center">
          <div className="quantum-label mb-0.5">VIX</div>
          <div className={`text-sm font-mono ${regime.vix > 25 ? 'text-red-400' : regime.vix > 18 ? 'text-amber-400' : 'text-emerald-400'}`}>
            {regime.vix.toFixed(1)}
          </div>
        </div>
        <div className="text-center">
          <div className="quantum-label mb-0.5">Yield Spread</div>
          <div className={`text-sm font-mono ${regime.yieldCurve < 0 ? 'text-red-400' : 'text-emerald-400'}`}>
            {regime.yieldCurve.toFixed(2)}%
          </div>
        </div>
        <div className="text-center">
          <div className="quantum-label mb-0.5">Confidence</div>
          <div className="text-sm font-mono text-amber-400">{regime.confidence}%</div>
        </div>
      </div>

      {/* Description */}
      <p className="text-xs text-slate-400 mb-3 leading-relaxed">{regime.description}</p>

      {/* Portfolio Suggestion */}
      <div className="quantum-stat p-2.5 mb-3">
        <div className="quantum-label mb-1">PORTFOLIO SUGGESTION</div>
        <p className="text-xs text-slate-300">{regime.portfolioSuggestion}</p>
      </div>

      {/* Sector Recommendations */}
      {regime.sectorRecommendation.length > 0 && (
        <div>
          <div className="quantum-label mb-2">SECTOR RECOMMENDATIONS</div>
          <div className="space-y-1.5">
            {regime.sectorRecommendation.map(s => (
              <div key={s.sector} className="flex items-center gap-2 text-xs">
                <span className={`font-bold w-24 ${actionColors[s.action]}`}>{s.action}</span>
                <span className="text-slate-300 flex-1">{s.sector}</span>
                <span className="text-slate-500 text-[10px] truncate max-w-[120px]">{s.reason}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
});

MacroRegimePanel.displayName = 'MacroRegimePanel';
