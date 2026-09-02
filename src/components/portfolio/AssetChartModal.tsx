// ============================================================
// AssetChartModal — Portfolio TAB per-asset chart (v4.5)
// ------------------------------------------------------------
// Daily-candle chart (6 months) for any live IN/US portfolio row,
// opened via the row's 📈 button. Overlays:
//   • COST basis line (avg price / sync-truth invested ÷ qty)
//   • LIVE price line (ticks with the stream)
// Powered by the existing LiveCandleChart + /api/chart proxy —
// no new server endpoint. Crypto/NAV rows hide the button.
// ============================================================
import { useEffect, useMemo, useState } from 'react';
import { LiveCandleChart, type ChartPriceLine } from '../LiveCandleChart';

export interface AssetChartTarget {
  symbol: string;
  name?: string;
  market: 'IN' | 'US';
  avgPrice: number;   // cost basis per unit (native currency)
  qty: number;
  livePrice?: number; // current live quote (native currency)
  change?: number;    // day change %
}

const INTERVALS = [
  { key: 'D', label: '6M Daily' },
  { key: 'W', label: '2Y Weekly' },
  { key: 'M', label: '5Y Monthly' },
] as const;

export function AssetChartModal({ target, onClose }: {
  target: AssetChartTarget | null; onClose: () => void;
}) {
  const [interval, setIntervalKey] = useState<'D' | 'W' | 'M'>('D');

  // Esc closes (same affordance as the intraday chart modal).
  useEffect(() => {
    if (!target) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [target, onClose]);

  useEffect(() => { if (target) setIntervalKey('D'); }, [target?.symbol]); // eslint-disable-line react-hooks/exhaustive-deps

  const priceLines = useMemo<ChartPriceLine[]>(() => {
    if (!target) return [];
    const lines: ChartPriceLine[] = [];
    if (target.avgPrice > 0) {
      lines.push({ price: target.avgPrice, color: '#f59e0b', title: 'COST', dashed: true });
    }
    const live = target.livePrice ?? 0;
    if (live > 0) {
      lines.push({ price: live, color: '#22d3ee', title: 'LIVE', dashed: false });
    }
    return lines;
  }, [target]);

  if (!target) return null;

  const cur = target.market === 'IN' ? '₹' : '$';
  const live = target.livePrice;
  const cost = target.avgPrice;
  const vs = live != null && cost > 0 ? ((live - cost) / cost) * 100 : null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-6 bg-black/80 backdrop-blur-sm" onClick={onClose}>
      <div
        className="quantum-panel rounded-2xl border border-white/10 w-full max-w-5xl max-h-[92vh] flex flex-col overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between gap-3 px-4 py-3 border-b border-white/10 bg-black/30">
          <div className="flex items-center gap-2.5 flex-wrap min-w-0">
            <span className="text-lg font-black text-white">{target.symbol.replace('.NS', '')}</span>
            {target.name && (
              <span className="text-[10px] text-slate-500 truncate max-w-[240px]" title={target.name}>{target.name}</span>
            )}
            <span className="px-2 py-0.5 rounded-lg text-[9px] font-black font-mono bg-cyan-500/15 text-cyan-300 border border-cyan-500/30">
              {target.market === 'IN' ? '🇮🇳 NSE' : '🦅 US'}
            </span>
            <span className="text-xl font-black font-mono text-cyan-300">
              {cur}{(live ?? cost).toFixed(2)}
            </span>
            {live != null && <span className="text-[9px] font-mono text-cyan-500 animate-pulse">● LIVE</span>}
          </div>
          <button onClick={onClose} className="quantum-btn-ghost px-2.5 py-1.5 rounded-xl text-xs font-black">
            ✕ ESC
          </button>
        </div>

        {/* Cost vs live chips */}
        <div className="flex items-center gap-2 px-4 py-2 border-b border-white/5 text-[10px] font-mono flex-wrap">
          <span className="text-slate-400">Qty <b className="text-slate-200">{target.qty}</b></span>
          <span className="text-slate-400">Cost <b className="text-amber-300">{cur}{cost.toFixed(2)}</b></span>
          {live != null && (
            <span className="text-slate-400">Live <b className="text-cyan-300">{cur}{live.toFixed(2)}</b></span>
          )}
          {vs != null && (
            <span className={`px-2 py-0.5 rounded-md border font-bold ${vs >= 0
              ? 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30'
              : 'bg-red-500/15 text-red-300 border-red-500/30'}`}>
              vs cost {vs >= 0 ? '+' : '−'}{Math.abs(vs).toFixed(2)}%
            </span>
          )}
          <span className="ml-auto flex items-center gap-1">
            {INTERVALS.map(iv => (
              <button
                key={iv.key}
                onClick={() => setIntervalKey(iv.key)}
                className={`px-2 py-0.5 rounded-md text-[9px] font-black font-mono border transition-all ${interval === iv.key
                  ? 'bg-cyan-500/20 text-cyan-300 border-cyan-500/35'
                  : 'bg-white/5 text-slate-500 border-white/10 hover:text-slate-300'}`}
              >
                {iv.label}
              </button>
            ))}
          </span>
        </div>

        {/* Chart */}
        <div className="flex-1 min-h-[320px] p-2">
          <LiveCandleChart
            symbol={target.symbol}
            market={target.market}
            interval={interval}
            livePrice={live}
            height={420}
            priceLines={priceLines}
          />
        </div>

        <div className="px-4 py-1.5 border-t border-white/5 text-[9px] text-slate-600 font-mono">
          Amber dashed = COST basis · cyan = LIVE — Yahoo chart proxy se (6mo/2y/5y OHLC)
        </div>
      </div>
    </div>
  );
}

export default AssetChartModal;
