import React, { useMemo } from 'react';
import { PriceData } from '../types';
import { estimateFIIDIIFromMarket, generateSmartMoneySignal } from '../utils/smartMoney';

interface SmartMoneyPanelProps {
  livePrices: Record<string, PriceData>;
}

const signalColors: Record<string, string> = {
  STRONG_ACCUMULATION: 'text-emerald-400 bg-emerald-500/10 border-emerald-500/30',
  ACCUMULATION: 'text-cyan-400 bg-cyan-500/10 border-cyan-500/30',
  NEUTRAL: 'text-slate-400 bg-slate-500/10 border-slate-500/30',
  DISTRIBUTION: 'text-orange-400 bg-orange-500/10 border-orange-500/30',
  STRONG_DISTRIBUTION: 'text-red-400 bg-red-500/10 border-red-500/30',
};

const signalIcons: Record<string, string> = {
  STRONG_ACCUMULATION: '🟢🟢',
  ACCUMULATION: '🟢',
  NEUTRAL: '⚪',
  DISTRIBUTION: '🟠',
  STRONG_DISTRIBUTION: '🔴🔴',
};

function formatCr(n: number): string {
  if (Math.abs(n) >= 10000) return `₹${(n / 10000).toFixed(1)}L Cr`;
  return `₹${n.toLocaleString('en-IN')} Cr`;
}

export const SmartMoneyPanel = React.memo(({ livePrices }: SmartMoneyPanelProps) => {
  const { data, signal } = useMemo(() => {
    const d = estimateFIIDIIFromMarket(livePrices);
    const s = generateSmartMoneySignal(livePrices);
    return { data: d, signal: s };
  }, [livePrices]);

  // FIX L38: fall back to NEUTRAL for unexpected signal strings.
  const color = signalColors[signal.signal] ?? signalColors.NEUTRAL;
  const icon = signalIcons[signal.signal] ?? signalIcons.NEUTRAL;

  return (
    <div className="quantum-panel p-4 mb-4">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-h2 text-on-surface">SMART MONEY FLOW (FII/DII)</h3>
        <span className="quantum-badge">ESTIMATED</span>
      </div>

      {/* Signal Badge */}
      <div className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-lg border text-sm font-bold mb-3 ${color}`}>
        <span>{icon}</span>
        <span>{signal.signal.replace(/_/g, ' ')}</span>
        <span className="text-xs font-normal opacity-70">({signal.combinedScore}/100)</span>
      </div>

      {/* FII/DII Cards */}
      <div className="grid grid-cols-2 gap-3 mb-3">
        {/* FII */}
        <div className="quantum-stat p-3">
          <div className="quantum-label mb-1">FII (Foreign)</div>
          <div className="grid grid-cols-2 gap-1 text-xs mb-1">
            <div>
              <span className="text-slate-500">Buy: </span>
              <span className="text-slate-300">{formatCr(data.fiiBuy)}</span>
            </div>
            <div>
              <span className="text-slate-500">Sell: </span>
              <span className="text-slate-300">{formatCr(data.fiiSell)}</span>
            </div>
          </div>
          <div className={`text-lg font-bold font-mono ${data.fiiNet >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
            {data.fiiNet >= 0 ? '+' : ''}{formatCr(data.fiiNet)}
          </div>
          <div className="text-[10px] text-slate-500 mt-0.5">
            {signal.fiiTrend === 'BUYING' ? '🟢 Accumulating' : signal.fiiTrend === 'SELLING' ? '🔴 Distributing' : '⚪ Neutral'}
          </div>
        </div>

        {/* DII */}
        <div className="quantum-stat p-3">
          <div className="quantum-label mb-1">DII (Domestic)</div>
          <div className="grid grid-cols-2 gap-1 text-xs mb-1">
            <div>
              <span className="text-slate-500">Buy: </span>
              <span className="text-slate-300">{formatCr(data.diiBuy)}</span>
            </div>
            <div>
              <span className="text-slate-500">Sell: </span>
              <span className="text-slate-300">{formatCr(data.diiSell)}</span>
            </div>
          </div>
          <div className={`text-lg font-bold font-mono ${data.diiNet >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
            {data.diiNet >= 0 ? '+' : ''}{formatCr(data.diiNet)}
          </div>
          <div className="text-[10px] text-slate-500 mt-0.5">
            {signal.diiTrend === 'BUYING' ? '🟢 Accumulating' : signal.diiTrend === 'SELLING' ? '🔴 Distributing' : '⚪ Neutral'}
          </div>
        </div>
      </div>

      {/* Confidence Bars */}
      <div className="space-y-2 mb-3">
        <div>
          <div className="flex items-center justify-between text-[10px] mb-0.5">
            <span className="text-slate-500">FII Confidence</span>
            <span className={signal.fiiConfidence > 0 ? 'text-emerald-400' : 'text-red-400'}>{signal.fiiConfidence}%</span>
          </div>
          <div className="quantum-progress">
            <div
              className={`quantum-progress-fill ${signal.fiiConfidence > 0 ? 'bg-emerald-500' : 'bg-red-500'}`}
              style={{ width: `${Math.abs(signal.fiiConfidence)}%` }}
            />
          </div>
        </div>
        <div>
          <div className="flex items-center justify-between text-[10px] mb-0.5">
            <span className="text-slate-500">DII Confidence</span>
            <span className={signal.diiConfidence > 0 ? 'text-emerald-400' : 'text-red-400'}>{signal.diiConfidence}%</span>
          </div>
          <div className="quantum-progress">
            <div
              className={`quantum-progress-fill ${signal.diiConfidence > 0 ? 'bg-emerald-500' : 'bg-red-500'}`}
              style={{ width: `${Math.abs(signal.diiConfidence)}%` }}
            />
          </div>
        </div>
      </div>

      {/* Description */}
      <div className="quantum-stat p-2.5">
        <p className="text-xs text-slate-400 leading-relaxed">{signal.description}</p>
        <p className="text-[10px] text-slate-500 mt-1">
          {signal.signal === 'STRONG_ACCUMULATION' || signal.signal === 'ACCUMULATION'
            ? '🎯 Follow the institutions — buy dips aggressively.'
            : signal.signal === 'DISTRIBUTION' || signal.signal === 'STRONG_DISTRIBUTION'
            ? '⚠️ Smart money exiting — be cautious, buy only deep dips.'
            : '⚪ Neutral flow — continue regular SIP.'}
        </p>
      </div>
    </div>
  );
});

SmartMoneyPanel.displayName = 'SmartMoneyPanel';
