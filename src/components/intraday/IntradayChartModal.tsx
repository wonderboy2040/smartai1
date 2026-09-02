// ============================================================
// intraday/IntradayChartModal — live 5-min chart with level overlays
// ------------------------------------------------------------
// Full-screen modal: LiveCandleChart (5M interval, IN market) with
// dashed horizontal price lines for Entry / SL / T1 / T2, live LTP
// streaming into the last candle, plus a level legend and the
// execution discipline reminder.
// ============================================================
import { useEffect, useMemo } from 'react';
import { LiveCandleChart, type ChartPriceLine } from '../LiveCandleChart';
import type { IntradaySignal, LiveQuote } from './types';

interface IntradayChartModalProps {
  signal: IntradaySignal | null;
  market?: 'INDIA' | 'CRYPTO';
  live?: LiveQuote;
  onClose: () => void;
}

export function IntradayChartModal({ signal, market, live, onClose }: IntradayChartModalProps) {
  const isCrypto = market === 'CRYPTO' || signal?.market === 'CRYPTO';
  // Esc closes.
  useEffect(() => {
    if (!signal) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [signal, onClose]);

  const priceLines = useMemo<ChartPriceLine[]>(() => {
    if (!signal) return [];
    return [
      { price: signal.entry, color: '#22d3ee', title: 'ENTRY', dashed: false },
      { price: signal.stopLoss, color: '#ef4444', title: 'SL' },
      { price: signal.target1, color: '#34d399', title: 'T1 (1.6R)' },
      { price: signal.target2, color: '#10b981', title: 'T2 (2.6R)' },
    ];
  }, [signal]);

  if (!signal) return null;
  const long = signal.direction === 'LONG';
  const livePrice = live?.price;
  const distToT1 = livePrice != null ? ((signal.target1 - livePrice) / livePrice) * 100 : null;
  const distToSL = livePrice != null ? ((livePrice - signal.stopLoss) / livePrice) * 100 : null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-6 bg-black/80 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="quantum-panel rounded-2xl border border-white/10 w-full max-w-5xl max-h-[92vh] flex flex-col overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between gap-3 px-4 py-3 border-b border-white/10 bg-black/30">
          <div className="flex items-center gap-2.5 flex-wrap min-w-0">
            <span className="text-lg font-black text-white">{signal.symbol}</span>
            <span className={`px-2 py-0.5 rounded-lg text-[10px] font-black font-mono ${long ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/35' : 'bg-red-500/20 text-red-300 border border-red-500/35'}`}>
              {long ? '🟢 LONG' : '🔴 SHORT'}
            </span>
            <span className="text-xl font-black font-mono text-cyan-300">
              ₹{(livePrice ?? signal.ltp).toFixed(2)}
            </span>
            {live && <span className="text-[9px] font-mono text-cyan-500 animate-pulse">● LIVE (5s)</span>}
            <span className="text-[10px] font-mono text-slate-400">
              Conf {signal.confidence}% • RR 1:{signal.rr.toFixed(2)} • ATR ₹{signal.atr.toFixed(1)}
            </span>
          </div>
          <button onClick={onClose} className="quantum-btn-ghost px-3 py-1.5 rounded-xl text-xs font-black">
            ✕ ESC
          </button>
        </div>

        {/* Live distance chips */}
        <div className="flex items-center gap-2 px-4 py-2 border-b border-white/5 text-[10px] font-mono flex-wrap">
          <span className="text-slate-400">Live distance:</span>
          {distToT1 != null && (
            <span className={`px-2 py-0.5 rounded-md border ${Math.abs(distToT1) < 0.3 ? 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30' : 'bg-white/5 text-emerald-400/80 border-white/10'}`}>
              T1 {distToT1 >= 0 ? `${distToT1.toFixed(2)}% below` : `${Math.abs(distToT1).toFixed(2)}% PASSED`}
            </span>
          )}
          {distToSL != null && (
            <span className={`px-2 py-0.5 rounded-md border ${Math.abs(distToSL) < 0.3 ? 'bg-red-500/15 text-red-300 border-red-500/30' : 'bg-white/5 text-red-400/80 border-white/10'}`}>
              SL {distToSL >= 0 ? `${distToSL.toFixed(2)}% above` : `${Math.abs(distToSL).toFixed(2)}% BREACHED`}
            </span>
          )}
          <span className="text-slate-500 ml-auto hidden sm:block">{isCrypto ? '5-min candles • Yahoo BTC-USD feed • levels overlaid (₹ INR)' : '5-min candles • Yahoo NSE feed • levels overlaid'}</span>
        </div>

        {/* Chart */}
        <div className="flex-1 min-h-[380px] p-2">
          <LiveCandleChart
            symbol={signal.symbol}
            market={isCrypto ? 'CRYPTO' : 'IN'}
            interval="5M"
            livePrice={livePrice}
            priceLines={priceLines}
            showTime
            height={460}
          />
        </div>

        {/* Footer: level legend + discipline */}
        <div className="flex items-center justify-between gap-3 px-4 py-2.5 border-t border-white/10 bg-black/30 text-[10px] font-mono flex-wrap">
          <div className="flex items-center gap-3 flex-wrap">
            <span className="text-cyan-300">— ENTRY ₹{signal.entry.toFixed(2)}</span>
            <span className="text-red-400">-- SL ₹{signal.stopLoss.toFixed(2)}</span>
            <span className="text-emerald-400">-- T1 ₹{signal.target1.toFixed(2)}</span>
            <span className="text-emerald-300">-- T2 ₹{signal.target2.toFixed(2)}</span>
          </div>
          <span className="text-slate-500">{isCrypto ? 'T1 hit → book 50%, trail to entry • 24/7 session' : 'T1 hit → book 50%, trail to entry • Sq-off 15:10 IST'}</span>
        </div>
      </div>
    </div>
  );
}
