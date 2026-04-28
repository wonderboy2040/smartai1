import { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { PriceData, Position } from '../types';
import { analyzeAllSMC, getSessionStatus, SMCAnalysisResult } from '../utils/smcEngine';
import { EXACT_TICKER_MAP } from '../utils/constants';

interface SMCProIndicatorProps {
  livePrices: Record<string, PriceData>;
  portfolio: Position[];
}

// Same symbol mapping as Dashboard — uses EXACT_TICKER_MAP + BSE overrides
function toTvSymbol(symbol: string, market: string): string {
  const clean = symbol.replace('.NS', '').replace('.BO', '').toUpperCase();
  if (EXACT_TICKER_MAP[clean]) {
    const BSE_OVERRIDES = ['JUNIORBEES', 'MOMOMENTUM', 'SMALLCAP', 'MID150BEES'];
    if (BSE_OVERRIDES.includes(clean)) return `BSE:${clean}`;
    return EXACT_TICKER_MAP[clean];
  }
  return market === 'IN' ? `NSE:${clean}` : `NASDAQ:${clean}`;
}

export function SMCProIndicator({ livePrices, portfolio }: SMCProIndicatorProps) {
  const [results, setResults] = useState<SMCAnalysisResult[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [selectedAsset, setSelectedAsset] = useState<string | null>(null);
  const [filterSignal, setFilterSignal] = useState<string>('ALL');
  const lastComputeRef = useRef(0);
  const initialRef = useRef(true);
  const chartRef = useRef<HTMLDivElement>(null);
  const chartKeyRef = useRef('');
  const tvWidgetRef = useRef<any>(null);

  useEffect(() => {
    const now = Date.now();
    if (!initialRef.current && now - lastComputeRef.current < 12000) return;
    if (initialRef.current) { setIsLoading(true); initialRef.current = false; }
    const t = setTimeout(() => {
      const positions = portfolio.length > 0 ? portfolio : [
        'IN_NIFTY', 'US_SPY', 'US_QQQ', 'IN_BANKNIFTY', 'US_AAPL', 'US_TSLA'
      ].map(s => {
        const [m, sym] = s.split('_') as ['IN' | 'US', string];
        return { id: s, symbol: sym, market: m, qty: 1, avgPrice: livePrices[s]?.price || 100, leverage: 1, dateAdded: '' };
      });
      const r = analyzeAllSMC(positions, livePrices);
      setResults(r);
      if (!selectedAsset && r.length > 0) setSelectedAsset(r[0].symbol);
      setIsLoading(false);
      lastComputeRef.current = Date.now();
    }, isLoading ? 600 : 100);
    return () => clearTimeout(t);
  }, [livePrices, portfolio]);

  // TradingView chart using tv.js widget constructor (same as Dashboard — works for ALL IN+US symbols)
  const loadChart = useCallback((sym: string, market: string) => {
    const tvSym = toTvSymbol(sym, market);
    if (!chartRef.current || chartKeyRef.current === tvSym) return;
    chartKeyRef.current = tvSym;
    chartRef.current.innerHTML = '';
    tvWidgetRef.current = null;

    const containerId = `smc-tv-${Date.now()}`;
    const container = document.createElement('div');
    container.id = containerId;
    container.style.height = '100%';
    container.style.width = '100%';
    chartRef.current.appendChild(container);

    const initWidget = () => {
      if (!(window as any).TradingView) return;
      try {
        tvWidgetRef.current = new (window as any).TradingView.widget({
          autosize: true, symbol: tvSym, interval: '15',
          timezone: 'Asia/Kolkata', theme: 'dark', style: '1', locale: 'en',
          enable_publishing: false, allow_symbol_change: true,
          studies: ['STD;RSI', 'STD;MACD', 'STD;EMA'],
          container_id: containerId, withdateranges: true, calendar: false,
          hide_side_toolbar: false, details: true, hotlist: true,
          support_host: 'https://www.tradingview.com'
        });
      } catch (e) { console.warn('SMC TV widget error:', e); }
    };

    const tvScript = document.querySelector('script[src="https://s3.tradingview.com/tv.js"]');
    if (!tvScript) {
      const script = document.createElement('script');
      script.src = 'https://s3.tradingview.com/tv.js';
      script.async = true;
      script.onload = () => setTimeout(initWidget, 100);
      document.head.appendChild(script);
    } else if ((window as any).TradingView) {
      setTimeout(initWidget, 50);
    } else {
      tvScript.addEventListener('load', () => setTimeout(initWidget, 100));
    }
  }, []);

  useEffect(() => {
    const sel = results.find(r => r.symbol === selectedAsset);
    if (sel) loadChart(sel.symbol, sel.market);
  }, [selectedAsset, results, loadChart]);

  const session = getSessionStatus();
  const selected = results.find(r => r.symbol === selectedAsset);

  const getSignalColor = (s: string) => {
    if (s === 'STRONG_BUY') return 'text-emerald-400 bg-emerald-500/10 border-emerald-500/30';
    if (s === 'BUY') return 'text-cyan-400 bg-cyan-500/10 border-cyan-500/30';
    if (s === 'SELL') return 'text-orange-400 bg-orange-500/10 border-orange-500/30';
    if (s === 'STRONG_SELL') return 'text-red-400 bg-red-500/10 border-red-500/30';
    return 'text-amber-400 bg-amber-500/10 border-amber-500/30';
  };

  const filtered = useMemo(() => {
    if (filterSignal === 'ALL') return results;
    return results.filter(r => {
      if (filterSignal === 'BUY') return r.signal.signal.includes('BUY');
      if (filterSignal === 'SELL') return r.signal.signal.includes('SELL');
      return r.signal.signal === 'HOLD';
    });
  }, [results, filterSignal]);

  const buyCount = results.filter(r => r.signal.signal.includes('BUY')).length;
  const sellCount = results.filter(r => r.signal.signal.includes('SELL')).length;
  const avgScore = results.length > 0 ? Math.round(results.reduce((s, r) => s + r.smcScore, 0) / results.length) : 0;

  return (
    <div className="space-y-5 animate-fade-in">
      {/* Header */}
      <div className="glass-card rounded-2xl p-5 border border-cyan-500/20" style={{ background: 'linear-gradient(135deg, rgba(6,182,212,0.05) 0%, rgba(99,102,241,0.05) 50%, rgba(168,85,247,0.05) 100%)' }}>
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-cyan-500/20 via-indigo-500/20 to-purple-500/20 flex items-center justify-center border border-cyan-500/30 relative">
              <span className="text-2xl">🏦</span>
              <div className="absolute -top-1 -right-1 w-3 h-3 rounded-full bg-cyan-400 animate-pulse" />
            </div>
            <div>
              <h2 className="text-xl font-black font-display" style={{ background: 'linear-gradient(135deg, #06b6d4, #8b5cf6, #ec4899)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>
                SMC PRO INDICATOR
              </h2>
              <p className="text-[10px] text-slate-500">Smart Money Concepts • Real-Time • All Assets</p>
            </div>
          </div>
          <div className="text-right hidden sm:block">
            <div className="text-xs text-slate-500 uppercase tracking-wider">Session</div>
            <div className="text-sm font-black text-white">{session.icon} {session.name}</div>
            <div className={`text-[10px] font-bold ${session.isKillZone ? 'text-emerald-400' : 'text-slate-600'}`}>
              {session.isKillZone ? '● KILL ZONE ACTIVE' : '○ OFF SESSION'}
            </div>
          </div>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
          <div className="bg-black/30 rounded-xl p-2.5 border border-white/5 text-center">
            <div className="text-[9px] text-slate-500 uppercase">SMC Score</div>
            <div className="text-xl font-black text-cyan-400 font-mono">{avgScore}</div>
          </div>
          <div className="bg-black/30 rounded-xl p-2.5 border border-white/5 text-center">
            <div className="text-[9px] text-slate-500 uppercase">Buy</div>
            <div className="text-xl font-black text-emerald-400 font-mono">{buyCount}</div>
          </div>
          <div className="bg-black/30 rounded-xl p-2.5 border border-white/5 text-center">
            <div className="text-[9px] text-slate-500 uppercase">Sell</div>
            <div className="text-xl font-black text-red-400 font-mono">{sellCount}</div>
          </div>
          <div className="bg-black/30 rounded-xl p-2.5 border border-white/5 text-center">
            <div className="text-[9px] text-slate-500 uppercase">Assets</div>
            <div className="text-xl font-black text-indigo-400 font-mono">{results.length}</div>
          </div>
        </div>
      </div>

      {/* Asset Selector Chips */}
      <div className="flex gap-1.5 overflow-x-auto scrollbar-hide pb-1">
        {results.map(r => {
          const isActive = selectedAsset === r.symbol;
          const sigCol = r.signal.signal.includes('BUY') ? 'border-emerald-500/40 bg-emerald-500/5' : r.signal.signal.includes('SELL') ? 'border-red-500/40 bg-red-500/5' : 'border-slate-700/40';
          return (
            <button key={r.symbol} onClick={() => setSelectedAsset(r.symbol)}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold transition-all whitespace-nowrap border ${isActive ? 'bg-cyan-500/15 border-cyan-500/40 text-cyan-400 shadow-lg shadow-cyan-500/10' : `text-slate-400 hover:text-white ${sigCol}`}`}>
              <span className={`w-2 h-2 rounded-full ${r.signal.signal.includes('BUY') ? 'bg-emerald-400' : r.signal.signal.includes('SELL') ? 'bg-red-400' : 'bg-amber-400'}`} />
              {r.symbol}
              <span className="text-[9px] text-slate-600 font-mono">{r.market}</span>
            </button>
          );
        })}
      </div>

      {/* TradingView Chart + SMC Overlay Panel */}
      {selected && (
        <div className="grid grid-cols-1 lg:grid-cols-4 gap-4">
          {/* Chart — 3/4 width */}
          <div className="lg:col-span-3 glass-card rounded-2xl overflow-hidden border border-cyan-500/20" style={{ height: 520 }}>
            <div ref={chartRef} style={{ height: '100%', width: '100%' }} />
          </div>

          {/* SMC Overlay Panel — 1/4 width */}
          <div className="glass-card rounded-2xl p-4 border border-purple-500/20 space-y-3 overflow-y-auto" style={{ maxHeight: 520 }}>
            <div className="flex items-center justify-between">
              <span className="text-sm font-black text-white">{selected.symbol}</span>
              <span className={`px-2 py-0.5 rounded-full text-[9px] font-black border ${getSignalColor(selected.signal.signal)}`}>
                {selected.signal.signal.replace('_', ' ')}
              </span>
            </div>

            {/* Live Price */}
            <div className="bg-black/30 rounded-xl p-3 border border-white/5 text-center">
              <div className="text-[9px] text-slate-500 uppercase">Live Price</div>
              <div className={`text-2xl font-black font-mono ${selected.change >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                {selected.market === 'IN' ? '₹' : '$'}{selected.price.toFixed(2)}
              </div>
              <div className={`text-xs font-bold ${selected.change >= 0 ? 'text-emerald-500' : 'text-red-500'}`}>
                {selected.change >= 0 ? '+' : ''}{selected.change.toFixed(2)}%
              </div>
            </div>

            {/* Pro Trader Levels */}
            <div className="space-y-1.5">
              <div className="text-[9px] text-slate-500 font-bold uppercase tracking-wider">🎯 Pro Levels</div>
              {[
                { label: 'Entry', value: selected.levels.entry, color: 'text-cyan-400' },
                { label: 'Stop Loss', value: selected.levels.stopLoss, color: 'text-red-400' },
                { label: 'Take Profit', value: selected.levels.takeProfit, color: 'text-emerald-400' },
              ].map(l => (
                <div key={l.label} className="flex justify-between bg-black/20 rounded-lg px-3 py-1.5 border border-white/5">
                  <span className="text-[10px] text-slate-500">{l.label}</span>
                  <span className={`text-xs font-mono font-bold ${l.color}`}>{selected.market === 'IN' ? '₹' : '$'}{l.value.toFixed(2)}</span>
                </div>
              ))}
              <div className="flex justify-between bg-black/20 rounded-lg px-3 py-1.5 border border-cyan-500/15">
                <span className="text-[10px] text-slate-500">R:R Ratio</span>
                <span className="text-xs font-mono font-bold text-cyan-400">{selected.levels.riskReward.toFixed(1)}:1</span>
              </div>
            </div>

            {/* Structure */}
            <div className="space-y-1.5">
              <div className="text-[9px] text-slate-500 font-bold uppercase tracking-wider">📊 Structure</div>
              <div className="grid grid-cols-2 gap-1.5">
                <div className="bg-black/20 rounded-lg p-2 text-center border border-white/5">
                  <div className="text-[8px] text-slate-600">Swing H/L</div>
                  <div className={`text-xs font-black ${selected.structure.trendBias === 1 ? 'text-emerald-400' : 'text-red-400'}`}>
                    {selected.structure.lastHighType}/{selected.structure.lastLowType}
                  </div>
                </div>
                <div className="bg-black/20 rounded-lg p-2 text-center border border-white/5">
                  <div className="text-[8px] text-slate-600">HTF Bias</div>
                  <div className={`text-xs font-black ${selected.htfBias === 'Bullish' ? 'text-emerald-400' : selected.htfBias === 'Bearish' ? 'text-red-400' : 'text-slate-400'}`}>
                    {selected.htfBias}
                  </div>
                </div>
              </div>
            </div>

            {/* SMC Events */}
            <div className="space-y-1">
              <div className="text-[9px] text-slate-500 font-bold uppercase tracking-wider">⚡ Events</div>
              <div className="flex flex-wrap gap-1">
                {selected.hasBOS && <span className="text-[8px] px-1.5 py-0.5 rounded bg-amber-500/10 text-amber-400 border border-amber-500/20 font-bold">BOS {selected.bosType}</span>}
                {selected.hasCHoCH && <span className="text-[8px] px-1.5 py-0.5 rounded bg-purple-500/10 text-purple-400 border border-purple-500/20 font-bold">CHoCH {selected.chochType}</span>}
                {selected.bullSweep && <span className="text-[8px] px-1.5 py-0.5 rounded bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 font-bold">🐂 Bull Sweep</span>}
                {selected.bearSweep && <span className="text-[8px] px-1.5 py-0.5 rounded bg-red-500/10 text-red-400 border border-red-500/20 font-bold">🐻 Bear Sweep</span>}
                <span className="text-[8px] px-1.5 py-0.5 rounded bg-cyan-500/10 text-cyan-400 border border-cyan-500/20">OB: {selected.orderBlocks.length}</span>
                <span className="text-[8px] px-1.5 py-0.5 rounded bg-indigo-500/10 text-indigo-400 border border-indigo-500/20">FVG: {selected.fvgs.length}</span>
              </div>
            </div>

            {/* Confluence */}
            <div>
              <div className="flex justify-between text-[9px] mb-1">
                <span className="text-slate-500 font-bold uppercase">Confluence</span>
                <span className="text-cyan-400 font-bold">{selected.confluenceCount}/8</span>
              </div>
              <div className="flex gap-0.5">
                {Array.from({ length: 8 }).map((_, i) => (
                  <div key={i} className={`h-1.5 flex-1 rounded-full ${i < selected.confluenceCount
                    ? selected.confluenceCount >= 6 ? 'bg-emerald-500' : selected.confluenceCount >= 4 ? 'bg-cyan-500' : 'bg-amber-500'
                    : 'bg-slate-800'}`} />
                ))}
              </div>
            </div>

            {/* Score */}
            <div className="bg-black/30 rounded-xl p-3 border border-cyan-500/15 text-center">
              <div className="text-[9px] text-slate-500 uppercase">SMC Score</div>
              <div className="text-3xl font-black text-cyan-400 font-mono">{selected.smcScore}</div>
              <div className="text-[9px] text-slate-600">Confidence: {selected.signal.confidence}%</div>
            </div>
          </div>
        </div>
      )}

      {/* Filter + Asset Cards */}
      <div className="flex gap-2 glass-card p-1.5 rounded-xl">
        {['ALL', 'BUY', 'SELL', 'HOLD'].map(f => (
          <button key={f} onClick={() => setFilterSignal(f)}
            className={`px-4 py-2 rounded-lg text-xs font-bold transition-all ${filterSignal === f
              ? f === 'BUY' ? 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/30'
                : f === 'SELL' ? 'bg-red-500/15 text-red-400 border border-red-500/30'
                  : f === 'HOLD' ? 'bg-amber-500/15 text-amber-400 border border-amber-500/30'
                    : 'bg-cyan-500/15 text-cyan-400 border border-cyan-500/30'
              : 'text-slate-500 hover:text-white hover:bg-white/5'}`}>
            {f === 'ALL' ? `ALL (${results.length})` : f === 'BUY' ? `🟢 BUY (${buyCount})` : f === 'SELL' ? `🔴 SELL (${sellCount})` : `🟡 HOLD (${results.length - buyCount - sellCount})`}
          </button>
        ))}
      </div>

      {/* Cards Grid */}
      {isLoading ? (
        <div className="glass-card rounded-2xl p-16 text-center">
          <div className="text-6xl mb-4 animate-spin">🏦</div>
          <div className="text-cyan-400 font-bold text-lg">SMC PRO ENGINE ANALYZING...</div>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
          {filtered.map(r => {
            const cur = r.market === 'IN' ? '₹' : '$';
            const isSelected = selectedAsset === r.symbol;
            return (
              <div key={r.symbol} onClick={() => { setSelectedAsset(r.symbol); window.scrollTo({ top: 200, behavior: 'smooth' }); }}
                className={`glass-card rounded-xl p-4 border cursor-pointer transition-all hover:scale-[1.01] ${isSelected ? 'border-cyan-500/40 bg-cyan-500/5 shadow-lg shadow-cyan-500/10' : r.signal.signal.includes('BUY') ? 'border-emerald-500/20 hover:border-emerald-500/40' : r.signal.signal.includes('SELL') ? 'border-red-500/20 hover:border-red-500/40' : 'border-slate-700/30 hover:border-slate-500/40'}`}>
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-2">
                    <div className={`w-8 h-8 rounded-lg flex items-center justify-center text-sm font-black border ${r.signal.signal.includes('BUY') ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-400' : r.signal.signal.includes('SELL') ? 'bg-red-500/10 border-red-500/30 text-red-400' : 'bg-slate-800 border-slate-600 text-slate-300'}`}>
                      {r.smcScore}
                    </div>
                    <div>
                      <div className="font-black text-white text-sm">{r.symbol} <span className="text-[9px] text-slate-600">{r.market}</span></div>
                      <div className="text-[10px] text-slate-500">{cur}{r.price.toFixed(2)} <span className={r.change >= 0 ? 'text-emerald-400' : 'text-red-400'}>{r.change >= 0 ? '+' : ''}{r.change.toFixed(2)}%</span></div>
                    </div>
                  </div>
                  <span className={`px-2 py-0.5 rounded-full text-[9px] font-black border ${getSignalColor(r.signal.signal)}`}>
                    {r.signal.signal.replace('_', ' ')}
                  </span>
                </div>
                <div className="flex items-center gap-1.5 text-[9px]">
                  <span className="text-red-400 font-mono">SL:{cur}{r.levels.stopLoss.toFixed(0)}</span>
                  <span className="text-slate-700">|</span>
                  <span className="text-emerald-400 font-mono">TP:{cur}{r.levels.takeProfit.toFixed(0)}</span>
                  <span className="text-slate-700">|</span>
                  <span className="text-cyan-400">R:R {r.levels.riskReward.toFixed(1)}</span>
                  {r.hasBOS && <span className="px-1 py-0.5 rounded bg-amber-500/10 text-amber-400 border border-amber-500/15">BOS</span>}
                  {r.hasCHoCH && <span className="px-1 py-0.5 rounded bg-purple-500/10 text-purple-400 border border-purple-500/15">CHoCH</span>}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Disclaimer */}
      <div className="glass-card rounded-2xl p-4 border-amber-500/20">
        <div className="flex items-start gap-3">
          <span className="text-xl">⚠️</span>
          <div className="text-xs text-slate-400">
            <span className="font-bold text-amber-400">SMC Pro Disclaimer: </span>
            Smart Money Concepts based institutional analysis. Always DYOR — ye financial advice nahi hai.
          </div>
        </div>
      </div>
    </div>
  );
}
