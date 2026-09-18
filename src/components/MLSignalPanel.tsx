import { useState, useEffect, useCallback, useRef } from 'react';
import { fetchMLPrediction, type MLPrediction } from '../utils/mlApi';

interface Props {
  symbol: string;
  market: string;
  price?: number;
  change?: number;
}

export function MLSignalPanel({ symbol, market, price, change }: Props) {
  const [data, setData] = useState<MLPrediction | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    if (!symbol) return;
    setLoading(true);
    setError('');
    try {
      // FIX H6: previously `price`/`change` were captured at first symbol
      // selection (deps=[symbol,market] only) → ML signal became stale for
      // the entire session on that symbol. Now include them so the panel
      // refetches when the live price ticks past a meaningful threshold.
      // (Heavy refetch is avoided via the throttle below.)
      const pred = await fetchMLPrediction(symbol, market, price, change);
      setData(pred);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [symbol, market, price, change]);

  // FIX H6: refetch on symbol/market change OR when price moves >1% from
  // last fetch — keeps ML signal fresh without hammering the backend on
  // every tick.
  const lastFetchPriceRef = useRef<number | null>(null);
  useEffect(() => {
    if (!symbol) return;
    const curPrice = price ?? 0;
    if (lastFetchPriceRef.current === null) {
      lastFetchPriceRef.current = curPrice;
      load();
      return;
    }
    const last = lastFetchPriceRef.current;
    const moved = last > 0 ? Math.abs(curPrice - last) / last : 0;
    if (moved > 0.01) {  // >1% price move → refetch
      lastFetchPriceRef.current = curPrice;
      load();
    }
  }, [symbol, market, price, load]);

  if (!symbol) return null;

  if (loading && !data) {
    return (
      <div className="quantum-panel rounded-2xl p-4 border-cyan-500/10 animate-pulse">
        <div className="text-xs text-slate-500">Loading ML Signal...</div>
      </div>
    );
  }

  if (error && !data) {
    return null; // Silently fail - ML service may not be running
  }

  if (!data) return null;

  const signalColors: Record<string, { bg: string; text: string; border: string }> = {
    STRONG_BUY: { bg: 'bg-emerald-500/15', text: 'text-emerald-400', border: 'border-emerald-500/30' },
    BUY: { bg: 'bg-cyan-500/15', text: 'text-cyan-400', border: 'border-cyan-500/30' },
    HOLD: { bg: 'bg-amber-500/15', text: 'text-amber-400', border: 'border-amber-500/30' },
    SELL: { bg: 'bg-orange-500/15', text: 'text-orange-400', border: 'border-orange-500/30' },
    STRONG_SELL: { bg: 'bg-red-500/15', text: 'text-red-400', border: 'border-red-500/30' },
    AVOID: { bg: 'bg-red-500/15', text: 'text-red-400', border: 'border-red-500/30' },
  };

  const sc = signalColors[data.signal] || signalColors['HOLD'];
  const cur = market === 'IN' ? '₹' : '$';

  return (
    <div className="quantum-panel rounded-2xl p-4 border-cyan-500/10 animate-fade-in">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <span className="w-6 h-6 rounded-lg bg-cyan-500/10 flex items-center justify-center text-xs">🤖</span>
          <span className="text-xs font-bold text-white">ML Signal Engine</span>
        </div>
        <span className={`${sc.bg} ${sc.text} px-2 py-0.5 rounded-md text-[10px] font-black border ${sc.border}`}>
          {data.signal.replace('_', ' ')}
        </span>
      </div>

      {/* Confidence */}
      <div className="mb-3">
        <div className="flex justify-between text-[10px] mb-1">
          <span className="text-slate-500">ML Confidence</span>
          <span className={`font-bold ${data.confidence >= 70 ? 'text-emerald-400' : data.confidence >= 50 ? 'text-amber-400' : 'text-red-400'}`}>
            {data.confidence}%
          </span>
        </div>
        <div className="w-full bg-slate-800/60 rounded-full h-1.5">
          <div
            className="bg-gradient-to-r from-cyan-500 to-indigo-500 h-full rounded-full transition-all"
            style={{ width: `${data.confidence}%` }}
          />
        </div>
      </div>

      {/* Price Targets */}
      {data.price_targets && Object.keys(data.price_targets).length > 0 && (
        <div className="grid grid-cols-3 gap-2 mb-3">
          {(['P10', 'P50', 'P90'] as const).map(q => {
            const t = data.price_targets![q];
            if (!t) return null;
            return (
              <div key={q} className="bg-black/30 rounded-lg p-2 text-center border border-white/5">
                <div className="text-[8px] text-slate-500 font-bold uppercase">{q}</div>
                <div className={`text-xs font-black font-mono ${q === 'P50' ? 'text-cyan-400' : q === 'P10' ? 'text-red-400' : 'text-emerald-400'}`}>
                  {cur}{t.target_price.toFixed(0)}
                </div>
                <div className="text-[8px] text-slate-600">{t.expected_return >= 0 ? '+' : ''}{t.expected_return}%</div>
              </div>
            );
          })}
        </div>
      )}

      {/* Entry / SL / TP */}
      {data.price_points && (
        <div className="bg-black/30 rounded-xl p-3 border border-white/5">
          <div className="text-[9px] text-slate-500 font-bold uppercase mb-2">Entry / Risk Levels</div>
          <div className="grid grid-cols-4 gap-2 text-center">
            <div>
              <div className="text-[8px] text-slate-600">Entry</div>
              <div className="text-xs font-bold text-cyan-400 font-mono">{cur}{data.price_points.entry}</div>
            </div>
            <div>
              <div className="text-[8px] text-slate-600">Stop Loss</div>
              <div className="text-xs font-bold text-red-400 font-mono">{cur}{data.price_points.stop_loss}</div>
            </div>
            <div>
              <div className="text-[8px] text-slate-600">Target 1</div>
              <div className="text-xs font-bold text-emerald-400 font-mono">{cur}{data.price_points.tp1}</div>
            </div>
            <div>
              <div className="text-[8px] text-slate-600">R:R</div>
              <div className={`text-xs font-bold font-mono ${data.price_points.risk_reward >= 2 ? 'text-emerald-400' : 'text-amber-400'}`}>
                {data.price_points.risk_reward}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Top Features */}
      {data.top_features && data.top_features.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1">
          {data.top_features.map((f, i) => (
            <span key={i} className="px-1.5 py-0.5 bg-purple-500/10 text-purple-400 text-[8px] rounded border border-purple-500/15 font-mono">
              {f.feature}
            </span>
          ))}
        </div>
      )}

      <button onClick={load} disabled={loading} className="mt-2 text-[9px] text-slate-600 hover:text-slate-400 transition-colors">
        {loading ? 'Refreshing...' : 'Refresh ML Signal'}
      </button>
    </div>
  );
}
