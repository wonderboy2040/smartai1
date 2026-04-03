import { PriceData } from '../types';
import { formatPrice } from '../utils/constants';

export function DeepFibZones({ data, symbol }: { data?: PriceData, symbol: string }) {
  if (!data || !data.high52w || !data.low52w || data.high52w === data.low52w) return null;

  const h = data.high52w;
  const l = data.low52w;
  const range = h - l;
  
  // Fib retracements measured from bottom to top (0 is high, 1 is low)
  const fib382 = h - (range * 0.382);
  const fib618 = h - (range * 0.618);
  const fib786 = h - (range * 0.786);
  const fib886 = h - (range * 0.886);

  const cur = data.market === 'IN' ? '₹' : '$';

  return (
    <div className="glass-card rounded-2xl p-5 border-purple-500/10 animate-fade-in-up">
      <h3 className="text-base font-bold text-white mb-4 flex items-center gap-2">
        <span className="w-7 h-7 rounded-lg bg-purple-500/10 flex items-center justify-center text-sm">🧬</span>
        Quantum Deep Fib — <span className="text-[10px] text-slate-400 ml-1 mt-1">52W RANGE: {formatPrice(l, cur)} - {formatPrice(h, cur)}</span>
        <span className="ml-auto badge bg-red-500/10 text-red-400 border border-red-500/20 text-[10px]">BLACK SWAN ZONES</span>
      </h3>
      
      <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
        <div className="bg-black/30 rounded-xl p-3 border border-white/5 text-center">
          <div className="text-[10px] text-slate-500 font-bold uppercase tracking-wider mb-2">0.382 Normal Dip</div>
          <div className="text-lg font-black text-white font-mono">{formatPrice(fib382, cur)}</div>
        </div>
        <div className="bg-emerald-900/20 rounded-xl p-3 border border-emerald-500/20 text-center">
          <div className="text-[10px] text-emerald-400 font-bold uppercase tracking-wider mb-2">0.618 Golden Pocket</div>
          <div className="text-lg font-black text-emerald-400 font-mono">{formatPrice(fib618, cur)}</div>
        </div>
        <div className="bg-amber-900/20 rounded-xl p-3 border border-amber-500/20 text-center relative overflow-hidden">
          <div className="absolute top-0 right-0 w-8 h-8 bg-amber-500/20 rounded-bl-full flex items-center justify-center"><span className="text-[8px] absolute top-1 right-1">🐳</span></div>
          <div className="text-[10px] text-amber-400 font-bold uppercase tracking-wider mb-2">0.786 Deep Value</div>
          <div className="text-lg font-black text-amber-400 font-mono">{formatPrice(fib786, cur)}</div>
        </div>
        <div className="bg-red-900/20 rounded-xl p-3 border border-red-500/20 text-center relative overflow-hidden">
          <div className="absolute top-0 right-0 w-8 h-8 bg-red-500/20 rounded-bl-full flex items-center justify-center"><span className="text-[8px] absolute top-1 right-1">🚨</span></div>
          <div className="text-[10px] text-red-400 font-bold uppercase tracking-wider mb-2">0.886 Black Swan</div>
          <div className="text-lg font-black text-red-500 font-mono">{formatPrice(fib886, cur)}</div>
        </div>
      </div>
      <div className="text-center text-[10px] text-slate-500 mt-2 uppercase tracking-widest font-mono">
        These zones represent deep institutional accumulation levels during major crashes.
      </div>
    </div>
  );
}
