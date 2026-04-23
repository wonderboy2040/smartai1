import { useState, useEffect } from 'react';
import { Position, PriceData } from '../types';

interface QuantumOptimizerProps {
  portfolio: Position[];
  livePrices: Record<string, PriceData>;
  usdInrRate: number;
  totalValue: number;
}

interface OptimizationResult {
  symbol: string;
  currentAlloc: number;
  optimalAlloc: number;
  action: 'BUY' | 'SELL' | 'HOLD';
  changePercent: number;
  expectedReturn: number;
  riskScore: number;
  sharpeRatio: number;
}

export function QuantumOptimizer({ portfolio, livePrices, usdInrRate: _usdInrRate, totalValue }: QuantumOptimizerProps) {
  const [optimization, setOptimization] = useState<OptimizationResult[]>([]);
  const [showReport, setShowReport] = useState(false);

  useEffect(() => {
    if (portfolio.length === 0 || totalValue === 0) return;

    const results: OptimizationResult[] = portfolio.map(p => {
      const key = `${p.market}_${p.symbol}`;
      const data = livePrices[key];
      const currentPrice = data?.price || p.avgPrice;
      const currentValue = currentPrice * p.qty;
      const currentAlloc = (currentValue / totalValue) * 100;
      
      const cagr = getAssetCAGR(p.symbol);
      const volatility = getAssetVolatility(p.symbol);
      const riskScore = calculateRiskScore(p.symbol, volatility);
      const sharpeRatio = (cagr - 5) / volatility;
      
      let optimalAlloc = 100 / portfolio.length;
      if (cagr > 20 && riskScore < 50) optimalAlloc = 18;
      else if (cagr > 15 && riskScore < 60) optimalAlloc = 15;
      else if (cagr > 10) optimalAlloc = 12;
      else optimalAlloc = 8;

      const changePercent = optimalAlloc - currentAlloc;
      let action: OptimizationResult['action'] = 'HOLD';
      if (changePercent > 3) action = 'BUY';
      else if (changePercent < -3) action = 'SELL';

      return {
        symbol: p.symbol,
        currentAlloc: Math.round(currentAlloc * 100) / 100,
        optimalAlloc: Math.round(optimalAlloc * 100) / 100,
        action,
        changePercent: Math.round(changePercent * 100) / 100,
        expectedReturn: cagr,
        riskScore: Math.round(riskScore * 100) / 100,
        sharpeRatio: Math.round(sharpeRatio * 100) / 100
      };
    });

    setOptimization(results);
  }, [portfolio, livePrices, totalValue]);

  const getAssetCAGR = (symbol: string): number => {
    const cagrs: Record<string, number> = {
      'MOMOMENTUM': 24,
      'SMALLCAP': 18,
      'MID150BEES': 16,
      'JUNIORBEES': 15,
      'SMH': 22,
      'QQQM': 20,
      'XLK': 18
    };
    const clean = symbol.replace('.NS', '').replace('.BO', '');
    return cagrs[clean] || 14;
  };

  const getAssetVolatility = (symbol: string): number => {
    const vols: Record<string, number> = {
      'MOMOMENTUM': 28,
      'SMALLCAP': 32,
      'MID150BEES': 24,
      'JUNIORBEES': 26,
      'SMH': 35,
      'QQQM': 22,
      'XLK': 20
    };
    const clean = symbol.replace('.NS', '').replace('.BO', '');
    return vols[clean] || 25;
  };

  const calculateRiskScore = (symbol: string, volatility: number): number => {
    const key = `${symbol.includes('.') ? '' : 'IN_'}${symbol}`;
    const data = livePrices[key];
    const rsi = data?.rsi || 50;
    const change = data?.change || 0;
    
    let riskScore = volatility * 1.5;
    if (rsi > 70) riskScore += 15;
    else if (rsi < 30) riskScore -= 10;
    if (Math.abs(change) > 3) riskScore += 10;
    
    return Math.max(0, Math.min(100, riskScore));
  };

  const getActionColor = (action: string) => {
    if (action === 'BUY') return 'text-emerald-400 bg-emerald-500/10';
    if (action === 'SELL') return 'text-red-400 bg-red-500/10';
    return 'text-cyan-400 bg-cyan-500/10';
  };

  return (
    <div className="space-y-4 animate-fade-in">
      <div className="glass-card rounded-2xl p-6 border-cyan-500/20">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-4">
            <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-cyan-500/20 to-indigo-500/20 flex items-center justify-center border border-cyan-500/30">
              <span className="text-2xl">⚛️</span>
            </div>
            <div>
              <h2 className="text-xl font-black gradient-text-cyan font-display">
                QUANTUM PORTFOLIO OPTIMIZER
              </h2>
              <p className="text-xs text-slate-500 mt-1">AI-Powered Allocation Optimization</p>
            </div>
          </div>
          <button
            onClick={() => setShowReport(!showReport)}
            className="btn-glass px-4 py-2 rounded-xl text-sm"
          >
            {showReport ? '📊 Hide Report' : '📊 View Report'}
          </button>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {optimization.map(opt => (
            <div key={opt.symbol} className="bg-slate-900/50 rounded-xl p-4 border border-slate-700/50">
              <div className="flex items-center justify-between mb-3">
                <span className="font-bold text-white">{opt.symbol}</span>
                <span className={`text-xs font-bold px-2 py-1 rounded ${getActionColor(opt.action)}`}>
                  {opt.action}
                </span>
              </div>

              <div className="space-y-2 text-sm">
                <div className="flex justify-between">
                  <span className="text-slate-500">Current Alloc:</span>
                  <span className="text-white font-bold">{opt.currentAlloc}%</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-500">Optimal Alloc:</span>
                  <span className="text-cyan-400 font-bold">{opt.optimalAlloc}%</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-500">Change:</span>
                  <span className={opt.changePercent > 0 ? 'text-emerald-400' : 'text-red-400'}>
                    {opt.changePercent > 0 ? '+' : ''}{opt.changePercent}%
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-500">Exp. Return:</span>
                  <span className="text-emerald-400 font-bold">{opt.expectedReturn}%</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-500">Risk Score:</span>
                  <span className={opt.riskScore > 70 ? 'text-red-400' : 'text-cyan-400'}>
                    {opt.riskScore}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-500">Sharpe Ratio:</span>
                  <span className={opt.sharpeRatio > 1 ? 'text-emerald-400' : 'text-amber-400'}>
                    {opt.sharpeRatio.toFixed(2)}
                  </span>
                </div>
              </div>

              {/* Allocation Bar */}
              <div className="mt-3">
                <div className="flex justify-between text-xs text-slate-500 mb-1">
                  <span>Allocation</span>
                </div>
                <div className="w-full bg-slate-800 rounded-full h-2">
                  <div
                    className="h-full rounded-full bg-cyan-500 transition-all"
                    style={{ width: `${Math.min(100, opt.currentAlloc * 2)}%` }}
                  />
                </div>
                <div className="flex justify-between text-[10px] text-slate-600 mt-1">
                  <span>0%</span>
                  <span>50%</span>
                </div>
              </div>
            </div>
          ))}
        </div>

        {/* AI Summary */}
        <div className="mt-6 p-4 bg-gradient-to-r from-cyan-500/10 to-indigo-500/10 rounded-xl border border-cyan-500/20">
          <div className="flex items-start gap-3">
            <span className="text-2xl">🧠</span>
            <div>
              <div className="font-bold text-white mb-1">Quantum Optimization Summary</div>
              <div className="text-sm text-slate-400">
                {optimization.filter(o => o.action === 'BUY').length} positions need accumulation.
                {optimization.filter(o => o.action === 'SELL').length} positions need reduction.
                Expected portfolio return: {Math.round(optimization.reduce((s, o) => s + o.expectedReturn, 0) / optimization.length || 0)}% CAGR.
                Risk-adjusted score: {Math.round(optimization.reduce((s, o) => s + o.sharpeRatio, 0) / optimization.length || 0) * 100 / 100}.
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
