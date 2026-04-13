import React, { useMemo } from 'react';
import { Position, PriceData } from '../types';
import { TrendingUp, TrendingDown, Activity, Target, Brain, Eye } from 'lucide-react';

interface HeatmapProps {
  portfolio:    Position[];
  livePrices:   Record<string, PriceData>;
  totalValue:   number;
  usdInrRate:   number;
  onSelect:     (symbol: string) => void;
  currentSymbol: string;
}

interface CellData {
  p:           Position;
  rsi:         number;
  change:      number;
  pl:          number;
  weight:      number;
  curPrice:    number;
  sma20:       number | undefined;
  sma50:       number | undefined;
  macd:        number | undefined;
  signal:      string;
  smartMoney:  string;
  conviction:  number;
  entryQuality: string;
}

function getSignalData(rsi: number, change: number, sma20?: number, sma50?: number, macd?: number): { signal: string; smartMoney: string; conviction: number; entryQuality: string } {
  let signal = 'NEUTRAL';
  let smartMoney = 'NO DATA';
  let conviction = 50;
  let entryQuality = 'AVERAGE';

  const smaBullish = sma20 && sma50 ? sma20 > sma50 : false;
  const macdBullish = (macd ?? 0) > 0;

  if (rsi < 30 && smaBullish) {
    signal = 'STRONG BUY';
    smartMoney = 'ACCUMULATING 🐋';
    conviction = 90;
    entryQuality = 'EXCELLENT';
  } else if (rsi < 35) {
    signal = 'BUY';
    smartMoney = 'VALUE BUYING';
    conviction = 75;
    entryQuality = 'GOOD';
  } else if (rsi < 45 && smaBullish) {
    signal = 'ACCUMULATE';
    smartMoney = 'GRADUAL BUILD';
    conviction = 70;
    entryQuality = 'GOOD';
  } else if (rsi > 70 && change > 1) {
    signal = 'STRONG SELL';
    smartMoney = 'DISTRIBUTING 🦈';
    conviction = 90;
    entryQuality = 'EXIT NOW';
  } else if (rsi > 65) {
    signal = 'SELL';
    smartMoney = 'OVERWEIGHTED';
    conviction = 70;
    entryQuality = 'REDUCE';
  } else if (rsi > 55 && !smaBullish) {
    signal = 'WEAK';
    smartMoney = 'SELLING PRESSURE';
    conviction = 60;
    entryQuality = 'AVOID';
  }

  if (Math.abs(change) > 3 && conviction < 80) {
    conviction = Math.min(95, conviction + 10);
  }

  return { signal, smartMoney, conviction, entryQuality };
}

function rsiStyle(rsi: number): { bg: string; border: string; shadow: string; badge: string; color: string } {
  if (rsi < 30) return { bg: 'bg-emerald-500/30', border: 'border-emerald-400', shadow: '0 0 18px rgba(16,185,129,0.35)', badge: 'OVERSOLD', color: 'text-emerald-400' };
  if (rsi < 42) return { bg: 'bg-emerald-500/15', border: 'border-emerald-500/50', shadow: '0 0 12px rgba(16,185,129,0.18)', badge: 'BUY ZONE', color: 'text-emerald-400' };
  if (rsi < 55) return { bg: 'bg-cyan-500/10',    border: 'border-cyan-500/30',    shadow: 'none',                           badge: 'NEUTRAL', color: 'text-cyan-400' };
  if (rsi < 65) return { bg: 'bg-amber-500/15',   border: 'border-amber-500/40',   shadow: '0 0 12px rgba(245,158,11,0.15)', badge: 'CAUTION', color: 'text-amber-400' };
  if (rsi < 75) return { bg: 'bg-orange-500/20',  border: 'border-orange-500/40',  shadow: '0 0 14px rgba(249,115,22,0.2)',  badge: 'OVERBOUGHT', color: 'text-orange-400' };
  return           { bg: 'bg-red-500/25',     border: 'border-red-500/50',     shadow: '0 0 18px rgba(239,68,68,0.3)',  badge: 'DISTRIBUTE', color: 'text-red-400' };
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
        const sma20    = data?.sma20;
        const sma50    = data?.sma50;
        const macd     = data?.macd;

        const { signal, smartMoney, conviction, entryQuality } = getSignalData(rsi, change, sma20, sma50, macd);

        const posSize  = p.avgPrice * p.qty;
        const inv      = posSize / (p.leverage || 1);
        const eqVal    = inv + ((curPrice * p.qty) - posSize);
        const valINR   = p.market === 'IN' ? eqVal : eqVal * usdInrRate;
        const weight   = totalValue > 0 ? (valINR / totalValue) * 100 : 0;

        return { p, rsi, change, pl, weight, curPrice, sma20, sma50, macd, signal, smartMoney, conviction, entryQuality };
      })
      .sort((a, b) => b.conviction - a.conviction);
  }, [portfolio, livePrices, totalValue, usdInrRate]);

  const portfolioScore = useMemo(() => {
    if (cells.length === 0) return 50;
    const avgConviction = cells.reduce((s, c) => s + c.conviction, 0) / cells.length;
    const buySignals = cells.filter(c => c.signal.includes('BUY')).length;
    const sellSignals = cells.filter(c => c.signal.includes('SELL')).length;
    
    let score = avgConviction;
    if (buySignals > sellSignals) score += 5;
    else if (sellSignals > buySignals) score -= 5;
    
    return Math.max(10, Math.min(95, score));
  }, [cells]);

  if (cells.length === 0) {
    return (
      <div className="glass-card rounded-2xl p-8 text-center">
        <div className="text-4xl mb-3">🌊</div>
        <p className="text-slate-500 font-medium">Portfolio empty hai — assets add karo</p>
        <p className="text-slate-700 text-xs mt-1">Heatmap automatically appear ho jayega</p>
      </div>
    );
  }

  const count = cells.length;
  const cols  = count <= 4 ? 2 : count <= 9 ? 3 : 4;

  const scoreColor = portfolioScore > 65 ? 'text-emerald-400' : portfolioScore < 40 ? 'text-red-400' : 'text-amber-400';
  const scoreBg = portfolioScore > 65 ? 'bg-emerald-500/10 border-emerald-500/20' : portfolioScore < 40 ? 'bg-red-500/10 border-red-500/20' : 'bg-amber-500/10 border-amber-500/20';

  return (
    <div className="glass-card rounded-2xl p-5 animate-fade-in-up">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
        <h2 className="text-base font-bold text-white flex items-center gap-2">
          <span className="w-7 h-7 rounded-lg bg-gradient-to-r from-indigo-500 to-purple-500 flex items-center justify-center text-sm">🧠</span>
          Quantum Sentiment Pro
          <span className="badge bg-gradient-to-r from-indigo-500 to-purple-500 text-white border-0 text-[10px]">V2.0</span>
        </h2>
        <div className={`px-3 py-1.5 rounded-xl border ${scoreBg}`}>
          <div className="text-[8px] text-slate-400 font-bold uppercase">Portfolio Score</div>
          <div className={`text-lg font-black ${scoreColor}`}>{portfolioScore.toFixed(0)}/100</div>
        </div>
      </div>

      {/* Legend */}
      <div className="flex flex-wrap gap-1.5 text-[8px] mb-4">
        {[
          { label: '<30 BUY', c: 'bg-emerald-500/25 text-emerald-300 border-emerald-500/30' },
          { label: '30-45 ACCUM', c: 'bg-emerald-500/15 text-emerald-400 border-emerald-500/20' },
          { label: '45-55 NEU', c: 'bg-cyan-500/15 text-cyan-400 border-cyan-500/20' },
          { label: '55-65 CAU', c: 'bg-amber-500/15 text-amber-400 border-amber-500/20' },
          { label: '65+ SELL', c: 'bg-red-500/20 text-red-400 border-red-500/20' },
        ].map(({ label, c }) => (
          <span key={label} className={`px-2 py-0.5 rounded-md border font-bold ${c}`}>{label}</span>
        ))}
      </div>

      {/* Grid */}
      <div className="grid gap-2 mb-4" style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }}>
        {cells.map(({ p, rsi, change, pl, weight, smartMoney, conviction, entryQuality }) => {
          const style = rsiStyle(rsi);
          const isSelected = currentSymbol === p.symbol;
          const cur = p.market === 'IN' ? '₹' : '$';
          const fastPulse = Math.abs(change) > 2;

          const smartMoneyColor = smartMoney.includes('ACCUMULATING') ? 'text-emerald-400' : smartMoney.includes('DISTRIBUTING') ? 'text-red-400' : 'text-slate-400';

          return (
            <button
              key={p.id}
              onClick={() => onSelect(p.symbol)}
              className={`relative rounded-xl p-3 border text-left transition-all hover:scale-[1.03] active:scale-100 ${style.bg} ${style.border} ${fastPulse ? 'heatmap-active' : ''} ${isSelected ? 'ring-2 ring-cyan-400 ring-offset-1 ring-offset-slate-950' : ''}`}
              style={{ boxShadow: isSelected ? style.shadow : undefined }}
            >
              <div className="absolute top-0 right-0 p-1">
                <div className={`text-[8px] font-bold px-1.5 py-0.5 rounded ${conviction > 70 ? 'bg-emerald-500/20 text-emerald-400' : conviction > 50 ? 'bg-amber-500/20 text-amber-400' : 'bg-red-500/20 text-red-400'}`}>
                  {conviction}%
                </div>
              </div>

              <div className="font-black text-white text-base leading-none">{p.symbol.replace('.NS', '')}</div>

              <div className={`text-[8px] font-bold mt-0.5 ${style.color}`}>{style.badge}</div>
              <div className="text-[9px] font-mono text-slate-500">RSI {rsi.toFixed(0)}</div>

              <div className={`text-[11px] font-bold mt-1 ${change >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                {change >= 0 ? '▲' : '▼'} {Math.abs(change).toFixed(2)}%
              </div>

              <div className={`text-[9px] font-mono ${pl >= 0 ? 'text-emerald-400/70' : 'text-red-400/70'}`}>
                {pl >= 0 ? '+' : ''}{cur}{Math.abs(pl) > 10000 ? (pl / 1000).toFixed(1) + 'K' : Math.abs(pl).toFixed(0)}
              </div>

              <div className="flex justify-between items-center mt-1">
                <span className={`text-[8px] ${smartMoneyColor}`}>{smartMoney}</span>
                <span className="text-[8px] text-slate-600">{weight.toFixed(1)}%</span>
              </div>

              <div className={`text-[7px] mt-1 px-1.5 py-0.5 rounded inline-block ${entryQuality === 'EXCELLENT' || entryQuality === 'GOOD' ? 'bg-emerald-500/10 text-emerald-400' : entryQuality === 'AVOID' || entryQuality === 'EXIT NOW' ? 'bg-red-500/10 text-red-400' : 'bg-amber-500/10 text-amber-400'}`}>
                {entryQuality}
              </div>

              <div className="absolute bottom-0 left-0 right-0 h-[2px] rounded-b-xl bg-white/5 overflow-hidden">
                <div className="h-full bg-cyan-500/70 rounded-b-xl" style={{ width: `${Math.min(100, weight * 4)}%` }} />
              </div>
            </button>
          );
        })}
      </div>

      {/* Summary Stats */}
      <div className="grid grid-cols-4 gap-2 mb-3">
        <div className="bg-emerald-500/10 border border-emerald-500/20 rounded-xl p-2 text-center">
          <div className="text-[8px] text-emerald-400 font-bold uppercase">Buy Signals</div>
          <div className="text-lg font-black text-emerald-400">{cells.filter(c => c.signal.includes('BUY') || c.signal.includes('ACCUM')).length}</div>
        </div>
        <div className="bg-red-500/10 border border-red-500/20 rounded-xl p-2 text-center">
          <div className="text-[8px] text-red-400 font-bold uppercase">Sell Signals</div>
          <div className="text-lg font-black text-red-400">{cells.filter(c => c.signal.includes('SELL') || c.signal.includes('DIST')).length}</div>
        </div>
        <div className="bg-cyan-500/10 border border-cyan-500/20 rounded-xl p-2 text-center">
          <div className="text-[8px] text-cyan-400 font-bold uppercase">Smart Money</div>
          <div className="text-lg font-black text-cyan-400">{cells.filter(c => c.smartMoney.includes('🐋') || c.smartMoney.includes('ACCUMULATING')).length}</div>
        </div>
        <div className="bg-amber-500/10 border border-amber-500/20 rounded-xl p-2 text-center">
          <div className="text-[8px] text-amber-400 font-bold uppercase">Neutral</div>
          <div className="text-lg font-black text-amber-400">{cells.filter(c => c.signal === 'NEUTRAL').length}</div>
        </div>
      </div>

      <div className="text-[9px] text-slate-600 text-center">
        💡 Click any asset → Full analysis + ML prediction load hoga
      </div>
    </div>
  );
});