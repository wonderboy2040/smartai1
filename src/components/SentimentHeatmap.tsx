import React, { useMemo } from 'react';
import { Position, PriceData } from '../types';

interface HeatmapProps {
  portfolio:    Position[];
  livePrices:   Record<string, PriceData>;
  totalValue:   number;
  usdInrRate:   number;
  onSelect:     (symbol: string) => void;
  currentSymbol: string;
}

interface CellData {
  p:       Position;
  rsi:     number;
  change:  number;
  pl:      number;
  weight:  number;
  curPrice: number;
}

function rsiStyle(rsi: number): { bg: string; border: string; shadow: string; badge: string } {
  if (rsi < 30) return { bg: 'bg-emerald-500/30', border: 'border-emerald-400', shadow: '0 0 18px rgba(16,185,129,0.35)', badge: 'OVERSOLD 🔥' };
  if (rsi < 42) return { bg: 'bg-emerald-500/15', border: 'border-emerald-500/50', shadow: '0 0 12px rgba(16,185,129,0.18)', badge: 'BUY ZONE ✅' };
  if (rsi < 55) return { bg: 'bg-cyan-500/10',    border: 'border-cyan-500/30',    shadow: 'none',                           badge: 'NEUTRAL ↔' };
  if (rsi < 65) return { bg: 'bg-amber-500/15',   border: 'border-amber-500/40',   shadow: '0 0 12px rgba(245,158,11,0.15)', badge: 'CAUTION ⚠️' };
  if (rsi < 75) return { bg: 'bg-orange-500/20',  border: 'border-orange-500/40',  shadow: '0 0 14px rgba(249,115,22,0.2)',  badge: 'OVERBOUGHT' };
  return           { bg: 'bg-red-500/25',     border: 'border-red-500/50',     shadow: '0 0 18px rgba(239,68,68,0.3)',  badge: 'DISTRIBUTE 🔴' };
}

export const SentimentHeatmap = React.memo(({
  portfolio, livePrices, totalValue, usdInrRate, onSelect, currentSymbol
}: HeatmapProps) => {

  const cells: CellData[] = useMemo(() => {
    return portfolio
      .map(p => {
        const key      = `${p.market}_${p.symbol}`;
        const data     = livePrices[key];
        const curPrice = data?.price || p.avgPrice;
        const rsi      = data?.rsi ?? 50;
        const change   = data?.change ?? 0;
        const pl       = (curPrice - p.avgPrice) * p.qty;

        const posSize  = p.avgPrice * p.qty;
        const inv      = posSize / (p.leverage || 1);
        const eqVal    = inv + ((curPrice * p.qty) - posSize);
        const valINR   = p.market === 'IN' ? eqVal : eqVal * usdInrRate;
        const weight   = totalValue > 0 ? (valINR / totalValue) * 100 : 0;

        return { p, rsi, change, pl, weight, curPrice };
      })
      .sort((a, b) => b.weight - a.weight);
  }, [portfolio, livePrices, totalValue, usdInrRate]);

  if (cells.length === 0) {
    return (
      <div className="glass-card rounded-2xl p-8 text-center">
        <div className="text-4xl mb-3">🌊</div>
        <p className="text-slate-500 font-medium">Portfolio empty hai — assets add karo</p>
        <p className="text-slate-700 text-xs mt-1">Heatmap automatically appear ho jayega</p>
      </div>
    );
  }

  // Determine optimal grid
  const count = cells.length;
  const cols  = count <= 4 ? 2 : count <= 9 ? 3 : 4;

  return (
    <div className="glass-card rounded-2xl p-5 animate-fade-in-up">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
        <h2 className="text-base font-bold text-white flex items-center gap-2">
          <span className="w-7 h-7 rounded-lg bg-indigo-500/10 flex items-center justify-center text-sm">🌊</span>
          Quantum Sentiment Heatmap
          <span className="badge bg-indigo-500/10 text-indigo-400 border border-indigo-500/20 text-[10px]">LIVE RSI</span>
        </h2>
        <div className="flex flex-wrap gap-1.5 text-[8px]">
          {[
            { label: '<30 OVERSOLD', c: 'bg-emerald-500/25 text-emerald-300 border-emerald-500/30' },
            { label: '30–42 BUY',   c: 'bg-emerald-500/15 text-emerald-400 border-emerald-500/20' },
            { label: '42–55 NEU',  c: 'bg-cyan-500/15 text-cyan-400 border-cyan-500/20' },
            { label: '55–65 CAU',  c: 'bg-amber-500/15 text-amber-400 border-amber-500/20' },
            { label: '65+ HOT',    c: 'bg-red-500/20 text-red-400 border-red-500/20' },
          ].map(({ label, c }) => (
            <span key={label} className={`px-2 py-0.5 rounded-md border font-bold ${c}`}>{label}</span>
          ))}
        </div>
      </div>

      {/* Grid */}
      <div
        className="grid gap-2"
        style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }}
      >
        {cells.map(({ p, rsi, change, pl, weight, curPrice }) => {
          const style = rsiStyle(rsi);
          const isSelected = currentSymbol === p.symbol;
          const cur = p.market === 'IN' ? '₹' : '$';
          const fastPulse = Math.abs(change) > 2;

          return (
            <button
              key={p.id}
              onClick={() => onSelect(p.symbol)}
              className={`relative rounded-xl p-3 border text-left transition-all hover:scale-[1.03] active:scale-100 ${style.bg} ${style.border} ${fastPulse ? 'heatmap-active' : ''} ${isSelected ? 'ring-2 ring-cyan-400 ring-offset-1 ring-offset-slate-950' : ''}`}
              style={{ boxShadow: isSelected ? style.shadow : undefined }}
            >
              {/* Allocation bar on bottom */}
              <div className="absolute bottom-0 left-0 right-0 h-[3px] rounded-b-xl bg-white/5 overflow-hidden">
                <div
                  className="h-full bg-cyan-500/70 rounded-b-xl transition-all duration-700"
                  style={{ width: `${Math.min(100, weight * 4)}%` }}
                />
              </div>

              {/* Symbol */}
              <div className="font-black text-white text-base leading-none">{p.symbol.replace('.NS', '')}</div>

              {/* RSI badge */}
              <div className="text-[8px] font-bold text-slate-400 mt-0.5 truncate">{style.badge}</div>
              <div className="text-[9px] font-mono text-slate-500">RSI {rsi.toFixed(0)}</div>

              {/* Price change */}
              <div className={`text-[11px] font-bold mt-2 ${change >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                {change >= 0 ? '▲' : '▼'} {Math.abs(change).toFixed(2)}%
              </div>

              {/* P&L */}
              <div className={`text-[9px] font-mono ${pl >= 0 ? 'text-emerald-400/70' : 'text-red-400/70'}`}>
                {pl >= 0 ? '+' : ''}{cur}{Math.abs(pl) > 10000 ? (pl / 1000).toFixed(1) + 'K' : Math.abs(pl).toFixed(0)}
              </div>

              {/* Weight */}
              <div className="text-[8px] text-slate-600 mt-0.5">{weight.toFixed(1)}% wt</div>
            </button>
          );
        })}
      </div>

      {/* Tip */}
      <div className="mt-3 text-[9px] text-slate-600 text-center">
        💡 Cell click karo → Chart + Analysis auto-load hoga
      </div>
    </div>
  );
});
