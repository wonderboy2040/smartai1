import React, { useMemo, useState, useEffect } from 'react';
import { Position, PriceData } from '../types';
import { allocateDipBudget, computePortfolioDipSignals } from '../utils/dipEngine';

interface SmartDipSizerProps {
  portfolio: Position[];
  livePrices: Record<string, PriceData>;
  monthlyBudget: number;
  onBudgetChange?: (budget: number) => void;
}

export const SmartDipSizer = React.memo(({ portfolio, livePrices, monthlyBudget, onBudgetChange }: SmartDipSizerProps) => {
  const [budget, setBudget] = useState(monthlyBudget);

  useEffect(() => { setBudget(monthlyBudget); }, [monthlyBudget]);

  const dipSignals = useMemo(() => {
    if (portfolio.length === 0) return [];
    return computePortfolioDipSignals(portfolio, livePrices, budget);
  }, [portfolio, livePrices, budget]);

  const allocations = useMemo(() => {
    if (dipSignals.length === 0) return [];
    return allocateDipBudget(budget, dipSignals, portfolio);
  }, [dipSignals, budget, portfolio]);

  const totalAllocated = allocations.reduce((s, a) => s + a.allocatedAmount, 0);

  if (portfolio.length === 0) return null;

  return (
    <div className="bg-slate-900/60 border border-slate-700/50 rounded-xl p-4 mb-4">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-semibold text-slate-200 tracking-wide">SMART DIP POSITION SIZING</h3>
        <div className="flex items-center gap-2">
          <span className="text-xs text-slate-500">Monthly Budget:</span>
          <input
            type="number"
            value={budget}
            onChange={e => {
              const v = Math.max(0, parseInt(e.target.value) || 0);
              setBudget(v);
              onBudgetChange?.(v);
            }}
            className="w-24 bg-slate-800 border border-slate-700 rounded px-2 py-1 text-xs text-slate-200 text-right"
          />
        </div>
      </div>

      {/* Allocation Table */}
      {allocations.length > 0 ? (
        <div>
          <div className="grid grid-cols-7 gap-1 text-[10px] text-slate-500 mb-1 px-1">
            <div>Asset</div>
            <div className="text-right">Kelly%</div>
            <div className="text-right">InvVol%</div>
            <div className="text-right">Dip Mult</div>
            <div className="text-right">Amount</div>
            <div className="text-right">Share</div>
            <div className="text-right">Signal</div>
          </div>
          <div className="space-y-1">
            {allocations.map(a => {
              const signal = dipSignals.find(d => d.symbol === a.symbol);
              const dipDepth = signal?.dipDepth || 'NEUTRAL';
              const depthColor = dipDepth === 'DEEP' ? 'text-red-400' : dipDepth === 'MILD' ? 'text-orange-400' : 'text-slate-400';
              return (
                <div key={a.symbol} className="grid grid-cols-7 gap-1 text-xs items-center px-1 py-1 rounded hover:bg-slate-800/30">
                  <div className="text-slate-300 font-medium truncate">{a.symbol}</div>
                  <div className="text-right text-cyan-400">{a.kellyPct}%</div>
                  <div className="text-right text-blue-400">{a.invVolPct}%</div>
                  <div className="text-right text-amber-400">{a.dipMultiplier}x</div>
                  <div className="text-right text-emerald-400">₹{a.allocatedAmount.toLocaleString('en-IN')}</div>
                  <div className="text-right text-slate-400">{a.allocationPct}%</div>
                  <div className={`text-right font-medium ${depthColor}`}>{dipDepth}</div>
                </div>
              );
            })}
          </div>

          {/* Total */}
          <div className="flex items-center justify-between mt-2 pt-2 border-t border-slate-700/50 text-xs">
            <span className="text-slate-400">Total Allocated</span>
            <span className="text-emerald-400 font-bold">₹{totalAllocated.toLocaleString('en-IN')}</span>
          </div>

          {/* Kelly Explainer */}
          <div className="mt-3 bg-slate-800/50 rounded-lg p-2.5">
            <div className="text-[10px] text-slate-500 mb-1">SIZING METHODOLOGY</div>
            <p className="text-[11px] text-slate-400 leading-relaxed">
              <span className="text-cyan-400 font-medium">Kelly Criterion</span> — optimal bet size based on win rate and risk/reward.
              <span className="text-blue-400 font-medium"> InvVol</span> — inverse volatility weighting (lower vol = higher allocation).
              <span className="text-amber-400 font-medium"> Dip Mult</span> — deeper dips get larger allocation (pyramid buying).
              Half-Kelly applied for safety.
            </p>
          </div>
        </div>
      ) : (
        <div className="text-center py-4 text-slate-500 text-sm">
          Add assets to portfolio to see smart sizing recommendations.
        </div>
      )}
    </div>
  );
});

SmartDipSizer.displayName = 'SmartDipSizer';
