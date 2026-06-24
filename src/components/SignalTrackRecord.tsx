import { useState, useEffect } from 'react';
import { fetchMLBacktest, type MLBacktestResult } from '../utils/mlApi';

export function SignalTrackRecord() {
  const [data, setData] = useState<MLBacktestResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    setLoading(true);
    fetchMLBacktest()
      .then(setData)
      .catch(e => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <div className="quantum-panel rounded-2xl p-5 animate-fade-in">
        <div className="flex items-center gap-3">
          <div className="text-2xl animate-spin">⏳</div>
          <div className="text-sm text-slate-400">Loading backtest data...</div>
        </div>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="quantum-panel rounded-2xl p-5 border-cyan-500/10">
        <div className="flex items-center gap-3 mb-3">
          <span className="w-7 h-7 rounded-lg bg-emerald-500/10 flex items-center justify-center text-sm">📋</span>
          <h3 className="text-base font-bold text-white">Signal Track Record</h3>
          <span className="ml-auto badge bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 text-[10px]">PRO</span>
        </div>
        <div className="text-center py-8">
          <div className="text-3xl mb-2">🧪</div>
          <div className="text-sm text-slate-400">{error || 'Train models first to see track record'}</div>
          <div className="text-[10px] text-slate-600 mt-1">Track record abhi generate nahi hua — phale signals train karein</div>
        </div>
      </div>
    );
  }

  const winColor = data.avg_hit_rate >= 60 ? 'text-emerald-400' : data.avg_hit_rate >= 50 ? 'text-amber-400' : 'text-red-400';
  const returnColor = data.total_return_pct >= 0 ? 'text-emerald-400' : 'text-red-400';
  const sharpeColor = data.sharpe_ratio >= 1.5 ? 'text-emerald-400' : data.sharpe_ratio >= 1 ? 'text-amber-400' : 'text-red-400';

  return (
    <div className="quantum-panel rounded-2xl p-5 border-emerald-500/10 animate-fade-in-up">
      <div className="flex items-center gap-3 mb-4">
        <span className="w-7 h-7 rounded-lg bg-emerald-500/10 flex items-center justify-center text-sm">📋</span>
        <h3 className="text-base font-bold text-white">Signal Track Record</h3>
        <span className="ml-auto badge bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 text-[10px]">ML VALIDATED</span>
      </div>

      {/* Key Metrics */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
        <div className="bg-black/30 rounded-xl p-3 text-center border border-white/5">
          <div className="text-[10px] text-slate-500 font-bold uppercase tracking-wider mb-1">Hit Rate</div>
          <div className={`text-xl font-black font-mono ${winColor}`}>{data.avg_hit_rate}%</div>
          <div className="text-[9px] text-slate-600 mt-0.5">per signal</div>
        </div>
        <div className="bg-black/30 rounded-xl p-3 text-center border border-white/5">
          <div className="text-[10px] text-slate-500 font-bold uppercase tracking-wider mb-1">Total Return</div>
          <div className={`text-xl font-black font-mono ${returnColor}`}>{data.total_return_pct >= 0 ? '+' : ''}{data.total_return_pct}%</div>
          <div className="text-[9px] text-slate-600 mt-0.5">{data.total_periods} periods</div>
        </div>
        <div className="bg-black/30 rounded-xl p-3 text-center border border-white/5">
          <div className="text-[10px] text-slate-500 font-bold uppercase tracking-wider mb-1">Sharpe Ratio</div>
          <div className={`text-xl font-black font-mono ${sharpeColor}`}>{data.sharpe_ratio}</div>
          <div className="text-[9px] text-slate-600 mt-0.5">risk-adjusted</div>
        </div>
        <div className="bg-black/30 rounded-xl p-3 text-center border border-white/5">
          <div className="text-[10px] text-slate-500 font-bold uppercase tracking-wider mb-1">Profit Factor</div>
          <div className={`text-xl font-black font-mono ${data.profit_factor >= 1.5 ? 'text-emerald-400' : data.profit_factor >= 1 ? 'text-amber-400' : 'text-red-400'}`}>{data.profit_factor}</div>
          <div className="text-[9px] text-slate-600 mt-0.5">gross P/L ratio</div>
        </div>
      </div>

      {/* Equity Curve Mini */}
      {data.equity_curve && data.equity_curve.length > 0 && (() => {
        const max = Math.max(...data.equity_curve.map(p => p.equity));
        const min = Math.min(...data.equity_curve.map(p => p.equity));
        const range = max - min || 1;
        return (
          <div className="bg-black/30 rounded-xl p-3 border border-white/5">
            <div className="text-[10px] text-slate-500 font-bold uppercase tracking-wider mb-2">Equity Curve</div>
            <div className="flex items-end gap-px h-16">
              {data.equity_curve.map((pt, i) => {
                const h = ((pt.equity - min) / range) * 100;
                return (
                  <div
                    key={i}
                    className={`flex-1 rounded-t-sm transition-all ${pt.return >= 0 ? 'bg-emerald-500/60' : 'bg-red-500/60'}`}
                    style={{ height: `${Math.max(4, h)}%` }}
                    title={`Period ${i + 1}: ${pt.return >= 0 ? '+' : ''}${pt.return}% | Hit: ${pt.hit_rate}%`}
                  />
                );
              })}
            </div>
            <div className="flex justify-between mt-1 text-[9px] text-slate-600">
              <span>Start: ₹1,00,000</span>
              <span>Final: ₹{Math.round(data.equity_curve[data.equity_curve.length - 1]?.equity || 0).toLocaleString('en-IN')}</span>
            </div>
          </div>
        );
      })()}

      {/* Additional stats */}
      <div className="grid grid-cols-3 gap-2 mt-3 text-[10px]">
        <div className="bg-black/20 rounded-lg p-2 text-center">
          <div className="text-slate-500">Avg Return</div>
          <div className="font-bold text-cyan-400 font-mono">{data.avg_return_per_period >= 0 ? '+' : ''}{data.avg_return_per_period}%/period</div>
        </div>
        <div className="bg-black/20 rounded-lg p-2 text-center">
          <div className="text-slate-500">Win Periods</div>
          <div className="font-bold text-emerald-400 font-mono">{data.period_win_rate}%</div>
        </div>
        <div className="bg-black/20 rounded-lg p-2 text-center">
          <div className="text-slate-500">F1 Score</div>
          <div className="font-bold text-purple-400 font-mono">{data.avg_f1_weighted}</div>
        </div>
      </div>
    </div>
  );
}
