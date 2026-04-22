import React, { useState, useEffect } from 'react';
import { Position, PriceData } from '../types';
import { calculateCorrelation, analyzePortfolioCorrelations, calculateMomentumScore } from '../utils/mlPrediction';

interface QuantumPortfolioProps {
  portfolio: Position[];
  livePrices: Record<string, PriceData>;
  usdInrRate: number;
  totalValue: number;
  totalPL: number;
  plPct: number;
  todayPL: number;
}

interface AllocationData {
  symbol: string;
  value: number;
  percentage: number;
  allocation: number;
  diff: number;
  action: 'OVERWEIGHT' | 'UNDERWEIGHT' | 'BALANCED';
}

export function QuantumPortfolio({ portfolio, livePrices, usdInrRate, totalValue, totalPL, plPct, todayPL }: QuantumPortfolioProps) {
  const [allocations, setAllocations] = useState<AllocationData[]>([]);
  const [momentumScores, setMomentumScores] = useState<Record<string, any>>({});

  useEffect(() => {
    if (portfolio.length === 0 || totalValue === 0) return;

    // Calculate current allocations
    const allocData = portfolio.map(p => {
      const key = `${p.market}_${p.symbol}`;
      const data = livePrices[key];
      const curPrice = data?.price || p.avgPrice;
      const cur = p.market === 'IN' ? curPrice : curPrice * usdInrRate;
      const value = cur * p.qty;
      const percentage = (value / totalValue) * 100;
      const targetAlloc = getTargetAllocation(p.symbol);
      const diff = percentage - targetAlloc;
      
      let action: AllocationData['action'] = 'BALANCED';
      if (diff > 5) action = 'OVERWEIGHT';
      else if (diff < -5) action = 'UNDERWEIGHT';

      return {
        symbol: p.symbol,
        value,
        percentage,
        allocation: targetAlloc,
        diff,
        action
      };
    });

    setAllocations(allocData);

    // Calculate momentum scores
    const momScores: Record<string, any> = {};
    portfolio.forEach(p => {
      const key = `${p.market}_${p.symbol}`;
      const data = livePrices[key];
      if (data) {
        const score = calculateMomentumScore(
          data.rsi || 50,
          data.macd,
          data.sma20,
          data.sma50,
          data.price,
          data.change,
          data.volume || 0
        );
        momScores[p.symbol] = score;
      }
    });
    setMomentumScores(momScores);
  }, [portfolio, livePrices, totalValue]);

  const getTargetAllocation = (symbol: string): number => {
    const targets: Record<string, number> = {
      'MOMOMENTUM': 12,
      'SMALLCAP': 15,
      'MID150BEES': 23,
      'JUNIORBEES': 15,
      'SMH': 13,
      'QQQM': 17,
      'XLK': 5
    };
    const clean = symbol.replace('.NS', '').replace('.BO', '');
    return targets[clean] || 10;
  };

  const getActionColor = (action: string) => {
    switch (action) {
      case 'OVERWEIGHT': return 'text-red-400 bg-red-500/10';
      case 'UNDERWEIGHT': return 'text-emerald-400 bg-emerald-500/10';
      default: return 'text-cyan-400 bg-cyan-500/10';
    }
  };

  const getMomentumColor = (score: number) => {
    if (score >= 70) return 'text-emerald-400';
    if (score >= 50) return 'text-cyan-400';
    if (score >= 30) return 'text-amber-400';
    return 'text-red-400';
  };

  return (
    <div className="space-y-6 animate-fade-in">
      {/* Quantum Portfolio Header */}
      <div className="glass-card rounded-2xl p-6 border-cyan-500/20">
        <div className="flex items-center gap-4 mb-4">
          <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-cyan-500/20 to-indigo-500/20 flex items-center justify-center border border-cyan-500/30">
            <span className="text-2xl">⚛️</span>
          </div>
          <div>
            <h2 className="text-xl font-black gradient-text-cyan font-display">
              QUANTUM PORTFOLIO ANALYSIS
            </h2>
            <p className="text-xs text-slate-500 mt-1">Deep Mind AI Powered Analytics</p>
          </div>
        </div>

        {/* Key Metrics Grid */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <div className="bg-slate-900/50 rounded-xl p-4 border border-slate-700/50">
            <div className="text-slate-500 text-[10px] font-bold uppercase tracking-wider">Total Value</div>
            <div className="text-2xl font-black text-white font-mono mt-1">
              ₹{Math.round(totalValue).toLocaleString('en-IN')}
            </div>
          </div>
          <div className="bg-slate-900/50 rounded-xl p-4 border border-slate-700/50">
            <div className="text-slate-500 text-[10px] font-bold uppercase tracking-wider">Total P&L</div>
            <div className={`text-2xl font-black font-mono mt-1 ${totalPL >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
              {totalPL >= 0 ? '+' : ''}{Math.round(totalPL).toLocaleString('en-IN')}
            </div>
            <div className={`text-xs font-bold mt-1 ${plPct >= 0 ? 'text-emerald-500' : 'text-red-500'}`}>
              {plPct >= 0 ? '+' : ''}{plPct.toFixed(2)}%
            </div>
          </div>
          <div className="bg-slate-900/50 rounded-xl p-4 border border-slate-700/50">
            <div className="text-slate-500 text-[10px] font-bold uppercase tracking-wider">Today P&L</div>
            <div className={`text-2xl font-black font-mono mt-1 ${todayPL >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
              {todayPL >= 0 ? '+' : ''}₹{Math.round(todayPL).toLocaleString('en-IN')}
            </div>
          </div>
          <div className="bg-slate-900/50 rounded-xl p-4 border border-slate-700/50">
            <div className="text-slate-500 text-[10px] font-bold uppercase tracking-wider">Positions</div>
            <div className="text-2xl font-black text-cyan-400 font-mono mt-1">
              {portfolio.length}
            </div>
            <div className="text-xs text-slate-500 mt-1">Active Assets</div>
          </div>
        </div>
      </div>

      {/* Allocation Analysis */}
      <div className="glass-card rounded-2xl p-6">
        <h3 className="text-lg font-bold text-white mb-4 flex items-center gap-2">
          <span className="text-xl">🎯</span>
          Allocation Analysis
        </h3>
        <div className="space-y-3">
          {allocations.map((alloc) => (
            <div key={alloc.symbol} className="bg-slate-900/30 rounded-xl p-4 border border-slate-700/30">
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-3">
                  <span className="text-lg font-bold text-white">{alloc.symbol.replace('.NS', '')}</span>
                  <span className={`text-[10px] font-bold px-2 py-0.5 rounded uppercase ${getActionColor(alloc.action)}`}>
                    {alloc.action}
                  </span>
                </div>
                <div className="text-right">
                  <div className="text-sm font-bold text-white">₹{Math.round(alloc.value).toLocaleString('en-IN')}</div>
                  <div className="text-xs text-slate-500">{alloc.percentage.toFixed(1)}% of portfolio</div>
                </div>
              </div>
              <div className="flex items-center gap-4 text-xs">
                <div className="flex-1">
                  <div className="flex justify-between text-slate-500 mb-1">
                    <span>Current: {alloc.percentage.toFixed(1)}%</span>
                    <span>Target: {alloc.allocation}%</span>
                  </div>
                  <div className="w-full bg-slate-800 rounded-full h-2">
                    <div 
                      className={`h-full rounded-full transition-all ${
                        alloc.action === 'OVERWEIGHT' ? 'bg-red-500' : 
                        alloc.action === 'UNDERWEIGHT' ? 'bg-emerald-500' : 'bg-cyan-500'
                      }`}
                      style={{ width: `${Math.min(100, alloc.percentage * 2)}%` }}
                    />
                  </div>
                </div>
                <div className={`text-sm font-bold ${alloc.diff > 0 ? 'text-red-400' : alloc.diff < 0 ? 'text-emerald-400' : 'text-cyan-400'}`}>
                  {alloc.diff > 0 ? '+' : ''}{alloc.diff.toFixed(1)}%
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Momentum Scores */}
      <div className="glass-card rounded-2xl p-6">
        <h3 className="text-lg font-bold text-white mb-4 flex items-center gap-2">
          <span className="text-xl">🚀</span>
          Quantum Momentum Scores
        </h3>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {portfolio.map(p => {
            const score = momentumScores[p.symbol];
            if (!score) return null;
            return (
              <div key={p.symbol} className="bg-slate-900/30 rounded-xl p-4 border border-slate-700/30">
                <div className="flex items-center justify-between mb-3">
                  <span className="font-bold text-white">{p.symbol.replace('.NS', '')}</span>
                  <span className={`text-2xl font-black ${getMomentumColor(score.score)}`}>
                    {score.score}
                  </span>
                </div>
                <div className="space-y-2 text-xs">
                  <div className="flex justify-between">
                    <span className="text-slate-500">RSI Momentum</span>
                    <span className="text-slate-300">{score.factors.rsiMomentum.toFixed(1)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-500">MACD Strength</span>
                    <span className="text-slate-300">{score.factors.macdStrength.toFixed(1)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-500">Trend Alignment</span>
                    <span className="text-slate-300">{score.factors.trendAlignment.toFixed(1)}</span>
                  </div>
                </div>
                <div className={`mt-3 text-xs font-bold text-center py-1.5 rounded ${
                  score.signal === 'STRONG_MOMENTUM' ? 'bg-emerald-500/20 text-emerald-400' :
                  score.signal === 'BUILDING' ? 'bg-cyan-500/20 text-cyan-400' :
                  score.signal === 'FADING' ? 'bg-amber-500/20 text-amber-400' :
                  score.signal === 'REVERSAL' ? 'bg-red-500/20 text-red-400' :
                  'bg-slate-500/20 text-slate-400'
                }`}>
                  {score.signal.replace('_', ' ')}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Quantum AI Recommendations */}
      <div className="glass-card rounded-2xl p-6 border-cyan-500/20">
        <h3 className="text-lg font-bold text-white mb-4 flex items-center gap-2">
          <span className="text-xl">🧠</span>
          Deep Mind AI Recommendations
        </h3>
        <div className="space-y-3">
          {allocations.filter(a => a.action !== 'BALANCED').map(alloc => (
            <div key={alloc.symbol} className="bg-slate-900/50 rounded-xl p-4 border-l-4 border-cyan-500">
              <div className="flex items-start gap-3">
                <span className="text-2xl">{alloc.action === 'OVERWEIGHT' ? '⚠️' : '✅'}</span>
                <div className="flex-1">
                  <div className="font-bold text-white">{alloc.symbol.replace('.NS', '')}</div>
                  <div className="text-sm text-slate-400 mt-1">
                    {alloc.action === 'OVERWEIGHT' 
                      ? `Currently ${alloc.percentage.toFixed(1)}% vs target ${alloc.allocation}%. Consider trimming ${alloc.diff.toFixed(1)}%.`
                      : `Currently ${alloc.percentage.toFixed(1)}% vs target ${alloc.allocation}%. Consider adding ${Math.abs(alloc.diff).toFixed(1)}%.`
                    }
                  </div>
                </div>
              </div>
            </div>
          ))}
          {allocations.every(a => a.action === 'BALANCED') && (
            <div className="text-center py-8 text-slate-500">
              <div className="text-4xl mb-2">✅</div>
              <div className="font-bold">Portfolio Optimally Aligned</div>
              <div className="text-sm mt-1">All positions within target allocation ranges</div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
