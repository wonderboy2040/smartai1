import { getAssetCagrProxy } from '../utils/constants';
import { CorrelationScanner } from './CorrelationScanner';

export function MacroTab(props: any) {
  const {
    avgVix, sentiment, usVix, inVix, portfolio, livePrices
  } = props;

  return (
    <div className="space-y-5 animate-fade-in">
      <h2 className="text-2xl font-black gradient-text-cyan font-display">
        🌍 Risk Radar
      </h2>

      {/* Correlation Scanner Integration */}
      <CorrelationScanner portfolio={portfolio} livePrices={livePrices} />

      <div className="glass-card rounded-2xl p-5 animate-fade-in-up">
        <h3 className="text-base font-bold text-white mb-4 flex items-center gap-2">
          <span className="w-7 h-7 rounded-lg bg-cyan-500/10 flex items-center justify-center text-sm">⚙️</span>
          Risk Diagnostics
        </h3>
        <div className="grid md:grid-cols-2 gap-3">
          <div className="bg-black/20 p-4 rounded-xl">
            <div className="text-[10px] text-slate-500 font-bold uppercase tracking-wider mb-2">Global VIX</div>
            <div className={`text-xl font-black ${avgVix > 22 ? 'text-red-400' : avgVix > 16 ? 'text-amber-400' : 'text-emerald-400'}`}>
              {avgVix > 22 ? 'BEARISH' : avgVix > 16 ? 'VOLATILE' : 'BULLISH'}
            </div>
            <div className="text-[10px] text-slate-500 mt-2 font-mono">
              US: <strong className="text-slate-300">{usVix.toFixed(1)}</strong> | IN: <strong className="text-slate-300">{inVix.toFixed(1)}</strong>
            </div>
          </div>
          <div className="bg-black/20 p-4 rounded-xl">
            <div className="text-[10px] text-slate-500 font-bold uppercase tracking-wider mb-2">Risk Assessment</div>
            <div className={`text-lg font-bold ${sentiment.color}`}>{sentiment.text}</div>
          </div>
        </div>
      </div>

      <div className="glass-card rounded-2xl p-5 animate-fade-in-up delay-100">
        <h3 className="text-base font-bold text-white mb-4 flex items-center gap-2">
          <span className="w-7 h-7 rounded-lg bg-teal-500/10 flex items-center justify-center text-sm">🤖</span>
          Asset Analysis
        </h3>
        <div className="grid md:grid-cols-2 gap-3">
          {portfolio.map((p: any) => {
            const key = `${p.market}_${p.symbol}`;
            const data = livePrices[key];
            const rsi = data?.rsi || 50;
            const cgr = getAssetCagrProxy(p.symbol, p.market);
            
            const colorMap: Record<string, { border: string; bg: string; text: string }> = {
              red:     { border: 'border-red-500/20',     bg: 'bg-red-500/5',     text: 'text-red-400' },
              emerald: { border: 'border-emerald-500/20', bg: 'bg-emerald-500/5', text: 'text-emerald-400' },
              amber:   { border: 'border-amber-500/20',   bg: 'bg-amber-500/5',   text: 'text-amber-400' },
              blue:    { border: 'border-blue-500/20',    bg: 'bg-blue-500/5',    text: 'text-blue-400' },
            };

            let tag = '🔵 FAIR VALUE', colorKey = 'blue';
            if (cgr <= 10) { tag = '🔴 ROTATE'; colorKey = 'red'; }
            else if (rsi < 45) { tag = '🟢 VALUE'; colorKey = 'emerald'; }
            else if (rsi > 70) { tag = '🟠 HOT'; colorKey = 'amber'; }
            const c = colorMap[colorKey];
            
            return (
              <div key={p.id} className={`bg-black/20 p-4 rounded-xl border ${c.border}`}>
                <div className="flex justify-between items-start mb-2">
                  <div className="font-bold text-white">{p.symbol.replace('.NS', '')}</div>
                  <span className={`${c.bg} ${c.text} px-2 py-1 rounded-md text-[10px] font-bold border ${c.border}`}>{tag}</span>
                </div>
                <div className="text-[10px] text-slate-500 font-mono">
                  RSI: <span className="text-slate-300">{rsi.toFixed(1)}</span> | CAGR: <span className="text-slate-300">{cgr}%</span>
                </div>
              </div>
            );
          })}
          {portfolio.length === 0 && (
            <div className="col-span-2 text-center text-slate-600 py-8 border border-dashed border-white/10 rounded-xl animate-fade-in">
              <div className="text-3xl mb-2">🤖</div>
              <p className="font-medium">No assets to analyze</p>
              <p className="text-xs text-slate-700 mt-1">Add portfolio holdings first</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
