import { useState } from 'react';

export function PositionSizer({ currentPrice, accountSize, market }: { currentPrice: number, accountSize: number, market: 'IN' | 'US' }) {
  const [stopLoss, setStopLoss] = useState<string>('');
  const [riskPercent, setRiskPercent] = useState<number>(1); // Default 1% risk

  const sl = parseFloat(stopLoss);
  const cur = market === 'IN' ? '₹' : '$';

  let shares = 0;
  let maxLoss = (accountSize * riskPercent) / 100;
  
  if (currentPrice > 0 && sl > 0 && sl < currentPrice) {
    const riskPerShare = currentPrice - sl;
    shares = Math.floor(maxLoss / riskPerShare);
  }

  const requiredCapital = shares * currentPrice;

  return (
    <div className="glass-card rounded-2xl p-5 border-emerald-500/10 animate-fade-in-up">
      <h3 className="text-base font-bold text-white mb-4 flex items-center gap-2">
        <span className="w-7 h-7 rounded-lg bg-emerald-500/10 flex items-center justify-center text-sm">⚖️</span>
        Institutional Position Sizer
      </h3>
      
      <div className="grid md:grid-cols-2 gap-4 mb-4">
        <div className="bg-black/20 p-4 rounded-xl border border-white/5">
          <label className="text-slate-500 text-[10px] font-bold uppercase tracking-wider mb-2 block">Stop Loss Price</label>
          <div className="flex items-center gap-2 glass-input px-3 py-2 rounded-lg">
            <span className="text-sm font-bold text-slate-400">{cur}</span>
            <input 
              type="number" 
              value={stopLoss} 
              onChange={e => setStopLoss(e.target.value)}
              placeholder="0.00"
              className="w-full bg-transparent outline-none text-white font-bold"
            />
          </div>
        </div>

        <div className="bg-black/20 p-4 rounded-xl border border-white/5">
          <div className="flex justify-between items-center mb-2">
            <label className="text-slate-500 text-[10px] font-bold uppercase tracking-wider">Account Risk %</label>
            <span className="text-cyan-400 font-bold font-mono text-sm">{riskPercent.toFixed(1)}%</span>
          </div>
          <input 
            type="range" 
            min="0.5" max="5" step="0.5" 
            value={riskPercent}
            onChange={e => setRiskPercent(parseFloat(e.target.value))}
            className="w-full accent-cyan-500"
          />
          <div className="text-[10px] text-slate-500 mt-2">Max allowed loss: <strong className="text-red-400">{cur}{maxLoss.toFixed(2)}</strong></div>
        </div>
      </div>

      <div className="bg-gradient-to-r from-emerald-900/30 to-cyan-900/30 border border-emerald-500/20 rounded-xl p-4 flex items-center justify-between">
        <div>
          <div className="text-[10px] text-emerald-400 font-bold uppercase tracking-wider mb-1">Recommended Quantity</div>
          <div className="text-2xl font-black text-white font-mono">{shares} Shares</div>
        </div>
        <div className="text-right">
          <div className="text-[10px] text-slate-500 font-bold uppercase tracking-wider mb-1">Required Capital</div>
          <div className="text-lg font-bold text-emerald-400 font-mono">{cur}{requiredCapital.toFixed(2)}</div>
        </div>
      </div>
    </div>
  );
}
