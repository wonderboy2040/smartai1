import { useMemo } from 'react';
import { Position, PriceData } from '../types';

interface Props {
  portfolio: Position[];
  livePrices: Record<string, PriceData>;
}

export function CorrelationHeatmap({ portfolio, livePrices }: Props) {
  const symbols = useMemo(() => {
    return portfolio.slice(0, 10).map(p => p.symbol.replace('.NS', ''));
  }, [portfolio]);

  const changes = useMemo(() => {
    return portfolio.slice(0, 10).map(p => {
      const key = `${p.market}_${p.symbol}`;
      const chg = livePrices[key]?.change;
      return typeof chg === 'number' && !isNaN(chg) ? chg : 0;
    });
  }, [portfolio, livePrices]);

  // Simplified correlation matrix based on sector/market similarity
  const correlationMatrix = useMemo(() => {
    const n = symbols.length;
    if (n === 0) return [];

    // Group by market
    const markets = portfolio.slice(0, 10).map(p => p.market);

    const matrix: number[][] = [];
    for (let i = 0; i < n; i++) {
      const row: number[] = [];
      for (let j = 0; j < n; j++) {
        if (i === j) {
          row.push(1.0);
        } else if (markets[i] === markets[j]) {
          // Same market = moderate positive correlation
          const changeSim = 1 - Math.abs(changes[i] - changes[j]) / 10;
          // FIX L42: clamp to [0, 1] — `0.5 + changeSim*0.3` can go negative
          // (or above 1) for very divergent day-change pairs.
          const v = Math.max(0, Math.min(1, 0.5 + changeSim * 0.3));
          row.push(Math.round(v * 100) / 100);
        } else {
          // Different market = lower correlation
          const changeSim = 1 - Math.abs(changes[i] - changes[j]) / 15;
          const v = Math.max(0, Math.min(1, 0.2 + changeSim * 0.2));
          row.push(Math.round(v * 100) / 100);
        }
      }
      matrix.push(row);
    }
    return matrix;
  }, [symbols, changes, portfolio]);

  if (symbols.length < 2) {
    return null;
  }

  const getColor = (val: number) => {
    if (val >= 0.8) return 'bg-emerald-500/80';
    if (val >= 0.6) return 'bg-emerald-500/50';
    if (val >= 0.4) return 'bg-cyan-500/40';
    if (val >= 0.2) return 'bg-amber-500/40';
    if (val >= 0) return 'bg-amber-500/20';
    return 'bg-red-500/30';
  };

  return (
    <div className="quantum-panel rounded-2xl p-5 border-purple-500/10 animate-fade-in-up">
      <h3 className="text-base font-bold text-white mb-4 flex items-center gap-2">
        <span className="w-7 h-7 rounded-lg bg-purple-500/10 flex items-center justify-center text-sm">🔗</span>
        Correlation Heatmap
        <span className="ml-auto badge bg-purple-500/10 text-purple-400 border border-purple-500/20 text-[10px]">RISK</span>
      </h3>

      <div className="overflow-x-auto">
        <div className="inline-block min-w-full">
          {/* Header */}
          <div className="flex">
            <div className="w-16 flex-shrink-0" />
            {symbols.map(s => (
              <div key={s} className="flex-1 min-w-[40px] text-center">
                <div className="text-[8px] text-slate-500 font-bold truncate px-0.5">{s}</div>
              </div>
            ))}
          </div>

          {/* Matrix */}
          {correlationMatrix.map((row, i) => (
            <div key={symbols[i]} className="flex">
              <div className="w-16 flex-shrink-0 flex items-center">
                <div className="text-[8px] text-slate-400 font-bold truncate pr-1">{symbols[i]}</div>
              </div>
              {row.map((val, j) => (
                <div
                  key={`${symbols[i]}_${symbols[j]}`}
                  className={`flex-1 min-w-[40px] aspect-square flex items-center justify-center ${getColor(val)} border border-white/5 m-px rounded`}
                  title={`${symbols[i]} × ${symbols[j]}: ${val.toFixed(2)}`}
                >
                  <span className="text-[8px] font-bold text-white/80">{val.toFixed(1)}</span>
                </div>
              ))}
            </div>
          ))}
        </div>
      </div>

      {/* Legend */}
      <div className="flex flex-wrap gap-2 mt-3 text-[9px] text-slate-500">
        <span className="flex items-center gap-1"><span className="w-2 h-2 rounded bg-emerald-500/80" /> High (0.8+)</span>
        <span className="flex items-center gap-1"><span className="w-2 h-2 rounded bg-emerald-500/50" /> Medium (0.6-0.8)</span>
        <span className="flex items-center gap-1"><span className="w-2 h-2 rounded bg-cyan-500/40" /> Moderate (0.4-0.6)</span>
        <span className="flex items-center gap-1"><span className="w-2 h-2 rounded bg-amber-500/40" /> Low (0.2-0.4)</span>
      </div>

      <div className="text-[9px] text-slate-600 mt-2">
        High correlation = concentration risk. Diversify across uncorrelated assets.
      </div>
    </div>
  );
}
