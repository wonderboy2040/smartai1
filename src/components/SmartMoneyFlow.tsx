import React from 'react';
import { PriceData } from '../types';

interface SmartMoneyFlowProps {
  livePrices: Record<string, PriceData>;
  symbols: string[];
}

interface FlowData {
  symbol: string;
  volumeScore: number;
  priceChange: number;
  flowType: 'INFLOW' | 'OUTFLOW' | 'NEUTRAL';
  strength: 'STRONG' | 'MODERATE' | 'WEAK';
  institutionalScore: number;
  retailScore: number;
  vwap: number;
  accumulationDist: number;
}

export function SmartMoneyFlow({ livePrices, symbols }: SmartMoneyFlowProps) {
  const calculateFlows = (): FlowData[] => {
    return symbols.map(symbol => {
      const key = symbols.find(k => k.includes(symbol)) || `IN_${symbol}`;
      const data = livePrices[key];
      
      const volume = data?.volume || 0;
      const change = data?.change || 0;
      const price = data?.price || 0;
      
      const volumeScore = volume > 5000000 ? 100 : volume > 1000000 ? 75 : volume > 500000 ? 50 : 25;
      const priceChange = change;
      
      let flowType: FlowData['flowType'] = 'NEUTRAL';
      if (priceChange > 1 && volume > 1000000) flowType = 'INFLOW';
      else if (priceChange < -1 && volume > 1000000) flowType = 'OUTFLOW';
      
      const institutionalScore = volume > 2000000 && Math.abs(priceChange) > 2 ? 85 : volume > 500000 ? 60 : 35;
      const retailScore = 100 - institutionalScore;
      
      const vwap = price * (1 + change / 200);
      const accumulationDist = (price - vwap) * volume / 1000000;
      
      let strength: FlowData['strength'] = 'WEAK';
      if (institutionalScore > 75 && Math.abs(priceChange) > 2) strength = 'STRONG';
      else if (institutionalScore > 50) strength = 'MODERATE';
      
      return {
        symbol,
        volumeScore,
        priceChange,
        flowType,
        strength,
        institutionalScore,
        retailScore,
        vwap,
        accumulationDist
      };
    });
  };

  const flows = calculateFlows();

  return (
    <div className="space-y-4 animate-fade-in">
      <div className="glass-card rounded-2xl p-6 border-cyan-500/20">
        <div className="flex items-center gap-4 mb-4">
          <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-cyan-500/20 to-indigo-500/20 flex items-center justify-center border border-cyan-500/30">
            <span className="text-2xl">💰</span>
          </div>
          <div>
            <h2 className="text-xl font-black gradient-text-cyan font-display">
              SMART MONEY FLOW TRACKER
            </h2>
            <p className="text-xs text-slate-500 mt-1">Institutional Volume & Order Flow Analysis</p>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {flows.map(flow => (
            <div key={flow.symbol} className="bg-slate-900/50 rounded-xl p-4 border border-slate-700/50">
              <div className="flex items-center justify-between mb-3">
                <span className="font-bold text-white">{flow.symbol}</span>
                <span className={`text-xs font-bold px-2 py-1 rounded ${
                  flow.flowType === 'INFLOW' ? 'bg-emerald-500/10 text-emerald-400' :
                  flow.flowType === 'OUTFLOW' ? 'bg-red-500/10 text-red-400' :
                  'bg-slate-500/10 text-slate-400'
                }`}>
                  {flow.flowType}
                </span>
              </div>

              <div className="space-y-2 text-sm">
                <div className="flex justify-between">
                  <span className="text-slate-500">Volume Score:</span>
                  <span className={`font-bold ${flow.volumeScore > 75 ? 'text-emerald-400' : 'text-cyan-400'}`}>
                    {flow.volumeScore}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-500">Price Change:</span>
                  <span className={`font-bold ${flow.priceChange >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                    {flow.priceChange >= 0 ? '+' : ''}{flow.priceChange.toFixed(2)}%
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-500">Institutional:</span>
                  <span className="text-indigo-400 font-bold">{flow.institutionalScore}%</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-500">Retail:</span>
                  <span className="text-amber-400 font-bold">{flow.retailScore}%</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-500">VWAP:</span>
                  <span className="text-cyan-400 font-mono">{flow.vwap.toFixed(2)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-500">A/D Line:</span>
                  <span className={flow.accumulationDist > 0 ? 'text-emerald-400' : 'text-red-400'}>
                    {flow.accumulationDist > 0 ? '+' : ''}{flow.accumulationDist.toFixed(2)}M
                  </span>
                </div>
              </div>

              {/* Flow Strength Bar */}
              <div className="mt-3">
                <div className="flex justify-between text-xs text-slate-500 mb-1">
                  <span>Flow Strength</span>
                  <span className={flow.strength === 'STRONG' ? 'text-emerald-400' : 'text-cyan-400'}>
                    {flow.strength}
                  </span>
                </div>
                <div className="w-full bg-slate-800 rounded-full h-2">
                  <div
                    className={`h-full rounded-full transition-all ${
                      flow.flowType === 'INFLOW' ? 'bg-emerald-500' :
                      flow.flowType === 'OUTFLOW' ? 'bg-red-500' :
                      'bg-slate-500'
                    }`}
                    style={{ width: `${flow.institutionalScore}%` }}
                  />
                </div>
              </div>
            </div>
          ))}
        </div>

        {/* Summary */}
        <div className="mt-6 p-4 bg-gradient-to-r from-cyan-500/10 to-indigo-500/10 rounded-xl border border-cyan-500/20">
          <div className="flex items-start gap-3">
            <span className="text-2xl">🧠</span>
            <div>
              <div className="font-bold text-white mb-1">Quantum AI Analysis</div>
              <div className="text-sm text-slate-400">
                {flows.filter(f => f.flowType === 'INFLOW').length} assets showing institutional accumulation.
                {flows.filter(f => f.strength === 'STRONG').length} assets with strong smart money flow.
                Watch for volume spikes on {flows.filter(f => f.flowType === 'INFLOW').map(f => f.symbol).join(', ') || 'N/A'}.
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
