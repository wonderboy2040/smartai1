import React, { useMemo } from 'react';
import { Position, PriceData, DipSignal } from '../types';
import { computePortfolioDipSignals, allocateDipBudget } from '../utils/dipEngine';

interface DipIntelligenceProps {
  portfolio: Position[];
  livePrices: Record<string, PriceData>;
  totalBudget: number;
  onBuyAsset?: (symbol: string, amount: number) => void;
}

const depthColors: Record<string, string> = {
  DEEP: 'text-red-400 bg-red-500/10 border-red-500/30',
  MILD: 'text-orange-400 bg-orange-500/10 border-orange-500/30',
  NEUTRAL: 'text-slate-400 bg-slate-500/10 border-slate-500/30',
  ELEVATED: 'text-emerald-400 bg-emerald-500/10 border-emerald-500/30',
};

const depthLabels: Record<string, string> = {
  DEEP: 'DEEP DIP',
  MILD: 'MILD DIP',
  NEUTRAL: 'NEUTRAL',
  ELEVATED: 'ELEVATED',
};

function formatPrice(price: number, market: string): string {
  if (market === 'US') return `$${price.toFixed(2)}`;
  return `₹${price.toFixed(2)}`;
}

export const DipIntelligence = React.memo(({ portfolio, livePrices, totalBudget, onBuyAsset }: DipIntelligenceProps) => {
  const dipSignals = useMemo(() => {
    if (portfolio.length === 0) return [];
    return computePortfolioDipSignals(portfolio, livePrices, totalBudget);
  }, [portfolio, livePrices, totalBudget]);

  const allocations = useMemo(() => {
    if (dipSignals.length === 0) return [];
    return allocateDipBudget(totalBudget, dipSignals, portfolio);
  }, [dipSignals, totalBudget, portfolio]);

  const deepDips = dipSignals.filter(d => d.dipDepth === 'DEEP');
  const mildDips = dipSignals.filter(d => d.dipDepth === 'MILD');

  if (portfolio.length === 0) return null;

  return (
    <div className="quantum-panel p-4 mb-4">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-h2 text-on-surface">BUY-THE-DIP INTELLIGENCE</h3>
        <span className="text-xs text-slate-400">Budget: ₹{totalBudget.toLocaleString('en-IN')}/mo</span>
      </div>

      {/* Deep Dip Alerts */}
      {deepDips.length > 0 && (
        <div className="mb-3">
          <div className="text-xs font-medium text-red-400 mb-2 flex items-center gap-1.5">
            <span className="w-2 h-2 bg-red-400 rounded-full animate-pulse" />
            DEEP DIP ALERTS ({deepDips.length})
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
            {deepDips.map(d => (
              <DipCard key={d.symbol} signal={d} onBuy={onBuyAsset} />
            ))}
          </div>
        </div>
      )}

      {/* Mild Dip Alerts */}
      {mildDips.length > 0 && (
        <div className="mb-3">
          <div className="text-xs font-medium text-orange-400 mb-2">MILD DIPS ({mildDips.length})</div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
            {mildDips.map(d => (
              <DipCard key={d.symbol} signal={d} onBuy={onBuyAsset} />
            ))}
          </div>
        </div>
      )}

      {/* No dips message */}
      {deepDips.length === 0 && mildDips.length === 0 && (
        <div className="text-center py-3 text-slate-500 text-sm">
          No active dip signals — all assets near fair value. Continue regular SIP.
        </div>
      )}

      {/* Dip Budget Allocation */}
      {allocations.length > 0 && (
        <div className="mt-3 border-t border-slate-700/50 pt-3">
          <div className="text-xs font-medium text-slate-400 mb-2">DIP BUDGET ALLOCATION</div>
          <div className="space-y-1.5">
            {allocations.slice(0, 6).map(a => (
              <div key={a.symbol} className="flex items-center gap-2 text-xs">
                <span className="text-slate-300 w-24 truncate">{a.symbol}</span>
                <div className="flex-1 quantum-progress">
                  <div
                    className="quantum-progress-fill bg-gradient-to-r from-blue-500 to-cyan-400"
                    style={{ width: `${Math.min(a.allocationPct, 100)}%` }}
                  />
                </div>
                <span className="text-blue-400 w-16 text-right">₹{a.allocatedAmount.toLocaleString('en-IN')}</span>
                <span className="text-slate-500 w-10 text-right">{a.allocationPct}%</span>
                {a.dipMultiplier > 1 && <span className="text-amber-400 text-[10px]">{a.dipMultiplier}x</span>}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Expandable Dip Ladder for first deep dip */}
      {deepDips.length > 0 && (
        <div className="mt-3 border-t border-slate-700/50 pt-3">
          <div className="text-xs font-medium text-slate-400 mb-2">DIP LADDER — {deepDips[0].symbol}</div>
          <div className="grid grid-cols-5 gap-1 text-[10px]">
            <div className="text-slate-500">Level</div>
            <div className="text-slate-500">Target</div>
            <div className="text-slate-500">Amount</div>
            <div className="text-slate-500">Status</div>
            <div className="text-slate-500">Action</div>
            {deepDips[0].dipLadder.map(level => (
              <React.Fragment key={level.label}>
                <div className="text-slate-300">{level.label}</div>
                <div className="text-slate-300">{formatPrice(level.targetPrice, deepDips[0].market)}</div>
                <div className="text-blue-400">₹{level.suggestedAmount.toLocaleString('en-IN')}</div>
                <div className={level.triggered ? 'text-red-400' : 'text-slate-500'}>
                  {level.triggered ? 'TRIGGERED' : 'Waiting'}
                </div>
                <div>
                  {level.triggered && onBuyAsset && (
                    <button
                      onClick={() => onBuyAsset(deepDips[0].symbol, level.suggestedAmount)}
                      className="text-red-400 hover:text-red-300 font-medium"
                    >
                      BUY
                    </button>
                  )}
                </div>
              </React.Fragment>
            ))}
          </div>
        </div>
      )}
    </div>
  );
});

DipIntelligence.displayName = 'DipIntelligence';

function DipCard({ signal, onBuy }: { signal: DipSignal; onBuy?: (symbol: string, amount: number) => void }) {
  const color = depthColors[signal.dipDepth];
  return (
    <div className={`border rounded-lg p-2.5 ${color}`}>
      <div className="flex items-center justify-between mb-1">
        <span className="font-medium text-sm">{signal.symbol}</span>
        <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${color}`}>
          {depthLabels[signal.dipDepth]}
        </span>
      </div>
      <div className="grid grid-cols-2 gap-x-3 gap-y-0.5 text-[11px]">
        <div>
          <span className="text-slate-500">Price: </span>
          <span className="text-slate-200">{formatPrice(signal.currentPrice, signal.market)}</span>
        </div>
        <div>
          <span className="text-slate-500">RSI: </span>
          <span className={signal.rsi < 30 ? 'text-red-400' : signal.rsi < 40 ? 'text-orange-400' : 'text-slate-200'}>
            {signal.rsi}
          </span>
        </div>
        <div>
          <span className="text-slate-500">SMA20: </span>
          <span className={signal.sma20Distance > 3 ? 'text-red-400' : 'text-slate-200'}>
            {signal.sma20Distance > 0 ? '-' : '+'}{Math.abs(signal.sma20Distance).toFixed(1)}%
          </span>
        </div>
        <div>
          <span className="text-slate-500">SMA50: </span>
          <span className={signal.sma50Distance > 5 ? 'text-red-400' : 'text-slate-200'}>
            {signal.sma50Distance > 0 ? '-' : '+'}{Math.abs(signal.sma50Distance).toFixed(1)}%
          </span>
        </div>
        <div>
          <span className="text-slate-500">Entry: </span>
          <span className="text-cyan-400">{formatPrice(signal.entryTarget, signal.market)}</span>
        </div>
        <div>
          <span className="text-slate-500">Conf: </span>
          <span className="text-amber-400">{signal.confidence}%</span>
        </div>
      </div>
      {onBuy && (signal.dipDepth === 'DEEP' || signal.dipDepth === 'MILD') && (
        <button
          onClick={() => onBuy(signal.symbol, 0)}
          className="mt-1.5 w-full text-center quantum-btn-ghost px-3 py-1.5 rounded-lg text-xs"
        >
          Buy This Dip
        </button>
      )}
    </div>
  );
}
