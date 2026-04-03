import { PriceData } from '../types';

export function MTFMatrix({ data, symbol }: { data?: PriceData, symbol: string }) {
  if (!data) return null;

  const timeframes = [
    { label: '15 Min', rsi: data.rsi15 },
    { label: '1 Hour', rsi: data.rsi60 },
    { label: '4 Hour', rsi: data.rsi240 },
    { label: '1 Day', rsi: data.rsi }
  ];

  const getRsiColor = (rsi?: number) => {
    if (!rsi) return 'text-slate-500';
    if (rsi < 35) return 'text-emerald-400';
    if (rsi > 65) return 'text-red-400';
    return 'text-amber-400';
  };

  const getRsiLabel = (rsi?: number) => {
    if (!rsi) return 'N/A';
    if (rsi < 35) return 'OVERSOLD';
    if (rsi > 65) return 'OVERBOUGHT';
    return 'NEUTRAL';
  };

  return (
    <div className="glass-card rounded-2xl p-5 border-cyan-500/10 animate-fade-in-up">
      <h3 className="text-base font-bold text-white mb-4 flex items-center gap-2">
        <span className="w-7 h-7 rounded-lg bg-blue-500/10 flex items-center justify-center text-sm">🕰️</span>
        MTF Trend Matrix — {symbol.replace('.NS', '')}
        <span className="ml-auto badge bg-blue-500/10 text-blue-400 border border-blue-500/20 text-[10px]">PRO</span>
      </h3>
      <div className="grid grid-cols-4 gap-2">
        {timeframes.map(tf => (
          <div key={tf.label} className="bg-black/30 rounded-xl p-3 border border-white/5 text-center">
            <div className="text-[10px] text-slate-500 font-bold uppercase tracking-wider mb-2">{tf.label}</div>
            <div className={`text-xl font-black font-mono ${getRsiColor(tf.rsi)}`}>
              {tf.rsi ? tf.rsi.toFixed(1) : '--'}
            </div>
            <div className="text-[9px] text-slate-600 mt-1 uppercase tracking-widest">{getRsiLabel(tf.rsi)}</div>
          </div>
        ))}
      </div>
    </div>
  );
}
