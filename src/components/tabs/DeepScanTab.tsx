import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useApp } from '../../hooks/AppContext';
import { DeepScanStock } from '../../types';
import { fetchDeepScanPrices, runDeepScan, getGroqDeepAnalysis, formatDeepScanTelegram } from '../../utils/deepScanner';
import { sendTelegramAlert } from '../../utils/api';
import { secureStorage } from '../../utils/secureStorage';
import { TradingViewChart } from '../TradingViewChart';
import { useRealTimePrice, snapshotsToCandles } from '../../hooks/useRealTimePrice';

// Score color helper
function sc(v: number): string {
  if (v >= 75) return 'text-emerald-400';
  if (v >= 55) return 'text-cyan-400';
  if (v >= 35) return 'text-amber-400';
  return 'text-red-400';
}
function scBg(v: number): string {
  if (v >= 75) return 'from-emerald-500/20 to-emerald-600/5 border-emerald-500/30';
  if (v >= 55) return 'from-cyan-500/20 to-cyan-600/5 border-cyan-500/30';
  if (v >= 35) return 'from-amber-500/20 to-amber-600/5 border-amber-500/30';
  return 'from-red-500/20 to-red-600/5 border-red-500/30';
}
const signalBadge: Record<string, string> = {
  STRONG_BUY: 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30',
  BUY: 'bg-cyan-500/15 text-cyan-400 border-cyan-500/30',
  HOLD: 'bg-amber-500/15 text-amber-400 border-amber-500/30',
  SELL: 'bg-orange-500/15 text-orange-400 border-orange-500/30',
  STRONG_SELL: 'bg-red-500/15 text-red-400 border-red-500/30',
};

export default React.memo(function DeepScanTab() {
  const { usVix, inVix, livePrices } = useApp();
  const [stocks, setStocks] = useState<DeepScanStock[]>([]);
  const [filter, setFilter] = useState<'ALL' | 'IN' | 'US'>('ALL');
  const [isScanning, setIsScanning] = useState(false);
  const [lastScan, setLastScan] = useState<string>('');
  const [expandedStock, setExpandedStock] = useState<string | null>(null);
  const [aiLoading, setAiLoading] = useState(false);
  const [tgSending, setTgSending] = useState(false);
  const scanInterval = useRef<number | null>(null);

  // Stable refs to avoid re-triggering scan on every price tick
  const livePricesRef = useRef(livePrices);
  livePricesRef.current = livePrices;
  const vixRef = useRef({ usVix, inVix });
  vixRef.current = { usVix, inVix };

  const aiCache = useRef<Record<string, string>>({});

  // Run scan — stable callback, doesn't depend on livePrices directly
  const doScan = useCallback(async () => {
    setIsScanning(true);
    try {
      const prices = await fetchDeepScanPrices();
      // Also inject any prices we already have from the main app
      const merged = { ...prices };
      for (const [k, v] of Object.entries(livePricesRef.current)) {
        if (!merged[k] && v.price > 0) merged[k] = v;
      }
      const result = runDeepScan(merged, vixRef.current.usVix, vixRef.current.inVix);

      const resultWithAnalysis = result.map(s =>
        aiCache.current[s.symbol] ? { ...s, aiAnalysis: aiCache.current[s.symbol] } : s
      );
      setStocks(resultWithAnalysis);
      setLastScan(new Date().toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit', second: '2-digit' }));

      setAiLoading(true);
      getGroqDeepAnalysis(result, 5).then(analyses => {
        if (Object.keys(analyses).length > 0) {
          Object.assign(aiCache.current, analyses);
          setStocks(prev => prev.map(s => analyses[s.symbol] ? { ...s, aiAnalysis: analyses[s.symbol] } : s));
        }
      }).catch(() => {}).finally(() => setAiLoading(false));
    } catch (e) { console.warn('Deep scan failed:', e); }
    finally { setIsScanning(false); }
  }, []); // stable — no dependencies, uses refs

  // Auto-scan every 5 min
  useEffect(() => {
    doScan();
    scanInterval.current = window.setInterval(doScan, 300000);
    return () => { if (scanInterval.current) clearInterval(scanInterval.current); };
  }, [doScan]);

  // 24x7 Telegram alerts — every 6 hours
  useEffect(() => {
    let initTimeout: number | undefined;
    let tgInt: number | undefined;
    (async () => {
      const [token, chatId] = await Promise.all([secureStorage.getItemAsync('TG_TOKEN'), secureStorage.getItemAsync('TG_CHAT_ID')]);
      if (!token || !chatId || stocks.length === 0) return;
      const sendAlert = async () => {
        const msg = formatDeepScanTelegram(stocks, 'ALL');
        await sendTelegramAlert(token, chatId, msg);
      };
      initTimeout = window.setTimeout(sendAlert, 120000);
      tgInt = window.setInterval(sendAlert, 7200000);
    })();
    return () => { clearTimeout(initTimeout); if (tgInt) clearInterval(tgInt); };
  }, [stocks]);

  // Manual TG push
  const pushToTelegram = useCallback(async () => {
    setTgSending(true);
    const [token, chatId] = await Promise.all([secureStorage.getItemAsync('TG_TOKEN'), secureStorage.getItemAsync('TG_CHAT_ID')]);
    if (!token || !chatId) { setTgSending(false); return; }
    const msg = formatDeepScanTelegram(stocks, filter === 'ALL' ? 'ALL' : filter);
    await sendTelegramAlert(token, chatId, msg);
    setTgSending(false);
  }, [stocks, filter]);

  // Filtered stocks
  const filtered = useMemo(() => {
    const list = filter === 'ALL' ? stocks : stocks.filter(s => s.market === filter);
    return list.slice(0, 10);
  }, [stocks, filter]);

  const summary = useMemo(() => ({
    total: stocks.length,
    strongBuy: stocks.filter(s => s.signal === 'STRONG_BUY').length,
    buy: stocks.filter(s => s.signal === 'BUY').length,
    avgScore: stocks.length > 0 ? Math.round(stocks.reduce((a, b) => a + b.aiScore, 0) / stocks.length) : 0,
    avgConf: stocks.length > 0 ? Math.round(stocks.reduce((a, b) => a + b.aiConfidence, 0) / stocks.length) : 0,
  }), [stocks]);

  return (
    <div className="space-y-5 animate-fade-in">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-2xl font-black gradient-text-cyan font-display flex items-center gap-2">
            🧠 DEEPMIND ADVANCE PRO SCANNER
          </h2>
          <div className="flex items-center gap-2 mt-1">
            <span className={`w-2 h-2 rounded-full ${isScanning ? 'bg-amber-400 animate-pulse' : 'bg-emerald-400 animate-pulse-dot'}`} />
            <span className="text-[11px] text-slate-500 font-mono">
              {isScanning ? 'SCANNING...' : `Last: ${lastScan || '--'}`}
            </span>
            {aiLoading && <span className="text-[10px] text-cyan-400 animate-pulse">🧠 Groq AI Analyzing...</span>}
          </div>
        </div>
        <div className="flex gap-2">
          <button onClick={doScan} disabled={isScanning} className="quantum-btn-ghost px-4 py-2 rounded-xl text-xs font-bold disabled:opacity-40">
            {isScanning ? '⏳ Scanning...' : '🔄 Re-Scan'}
          </button>
          <button onClick={pushToTelegram} disabled={tgSending} className="quantum-btn-primary px-4 py-2 bg-gradient-to-r from-cyan-600 to-indigo-600 rounded-xl text-xs font-bold text-white disabled:opacity-40">
            {tgSending ? '📤 Sending...' : '📲 Telegram Alert'}
          </button>
        </div>
      </div>

      {/* Market Filter */}
      <div className="flex gap-1 quantum-panel p-1 rounded-xl w-fit">
        {(['ALL', 'IN', 'US'] as const).map(f => (
          <button key={f} onClick={() => setFilter(f)} className={`px-4 py-2 rounded-lg text-xs font-bold transition-all ${filter === f ? 'bg-cyan-500/20 text-cyan-400 border border-cyan-500/20' : 'text-slate-500 hover:text-slate-300'}`}>
            {f === 'ALL' ? '🌍 All Markets' : f === 'IN' ? '🇮🇳 India' : '🇺🇸 USA'}
          </button>
        ))}
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3 animate-fade-in-up">
        <div className="quantum-stat rounded-2xl p-4">
          <div className="text-slate-500 text-[10px] font-bold uppercase tracking-wider">Stocks Scanned</div>
          <div className="text-2xl font-black text-cyan-400 mt-1 font-mono">{summary.total}</div>
        </div>
        <div className="quantum-stat rounded-2xl p-4">
          <div className="text-slate-500 text-[10px] font-bold uppercase tracking-wider">Strong Buy</div>
          <div className="text-2xl font-black text-emerald-400 mt-1 font-mono">{summary.strongBuy}</div>
        </div>
        <div className="quantum-stat rounded-2xl p-4">
          <div className="text-slate-500 text-[10px] font-bold uppercase tracking-wider">Buy Signal</div>
          <div className="text-2xl font-black text-cyan-400 mt-1 font-mono">{summary.buy}</div>
        </div>
        <div className="quantum-stat rounded-2xl p-4">
          <div className="text-slate-500 text-[10px] font-bold uppercase tracking-wider">Avg AI Score</div>
          <div className={`text-2xl font-black mt-1 font-mono ${sc(summary.avgScore)}`}>{summary.avgScore}</div>
        </div>
        <div className="quantum-stat rounded-2xl p-4 col-span-2 md:col-span-1">
          <div className="text-slate-500 text-[10px] font-bold uppercase tracking-wider">AI Confidence</div>
          <div className="text-2xl font-black text-purple-400 mt-1 font-mono">{summary.avgConf}%</div>
        </div>
      </div>

      {/* Top 10 Stock Cards */}
      <div className="space-y-3">
        {filtered.map((s, idx) => (
          <div key={s.symbol} className={`quantum-panel rounded-2xl overflow-hidden border transition-all animate-fade-in-up ${scBg(s.aiScore)}`} style={{ animationDelay: `${idx * 50}ms` }}>
            {/* Main Row */}
            <div className="p-4 cursor-pointer" onClick={() => setExpandedStock(expandedStock === s.symbol ? null : s.symbol)}>
              <div className="flex flex-wrap items-start justify-between gap-3">
                {/* Left: Name + Signal */}
                <div className="flex items-center gap-3 min-w-0">
                  <div className={`w-10 h-10 rounded-xl bg-gradient-to-br ${s.aiScore >= 65 ? 'from-emerald-500/20 to-cyan-500/20' : s.aiScore >= 45 ? 'from-amber-500/20 to-yellow-500/20' : 'from-red-500/20 to-orange-500/20'} flex items-center justify-center text-lg font-black font-mono border border-white/10`}>
                    {idx + 1}
                  </div>
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-bold text-white text-sm">{s.symbol}</span>
                      <span className={`px-2 py-0.5 rounded-md text-[9px] font-bold border ${signalBadge[s.signal]}`}>{s.signal.replace('_', ' ')}</span>
                      <span className="text-[9px] text-slate-600 font-mono">{s.market === 'IN' ? '🇮🇳' : '🇺🇸'} {s.sector}</span>
                    </div>
                    <div className="text-[11px] text-slate-400 truncate">{s.name}</div>
                  </div>
                </div>

                {/* Center: Price + Change */}
                <div className="text-right">
                  <div className={`text-lg font-black font-mono ${s.change >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                    {s.market === 'IN' ? '₹' : '$'}{s.price.toFixed(2)}
                  </div>
                  <div className={`text-xs font-bold ${s.change >= 0 ? 'text-emerald-500' : 'text-red-500'}`}>
                    {s.change >= 0 ? '▲' : '▼'} {s.change.toFixed(2)}%
                  </div>
                </div>

                {/* Right: AI Score Gauge */}
                <div className="text-center">
                  <div className={`text-3xl font-black font-mono ${sc(s.aiScore)}`}>{s.aiScore}</div>
                  <div className="text-[9px] text-slate-600 font-bold uppercase">AI SCORE</div>
                  <div className="w-16 h-1.5 bg-slate-800 rounded-full mt-1 overflow-hidden">
                    <div className={`h-full rounded-full transition-all ${s.aiScore >= 65 ? 'bg-gradient-to-r from-emerald-500 to-cyan-500' : s.aiScore >= 45 ? 'bg-gradient-to-r from-amber-500 to-yellow-500' : 'bg-gradient-to-r from-red-500 to-orange-500'}`} style={{ width: `${s.aiScore}%` }} />
                  </div>
                </div>
              </div>

              {/* Action + Targets Row */}
              <div className="mt-3 flex flex-wrap items-center gap-3">
                <div className="text-xs font-bold">{s.actionHindi}</div>
                <div className="flex flex-wrap gap-2">
                  <span className="px-2 py-1 rounded-lg bg-emerald-500/10 text-emerald-400 text-[10px] font-bold border border-emerald-500/20">
                    1Y Target: {s.market === 'IN' ? '₹' : '$'}{s.target1Y.toFixed(0)} (+{s.return1Y}%)
                  </span>
                  <span className="px-2 py-1 rounded-lg bg-cyan-500/10 text-cyan-400 text-[10px] font-bold border border-cyan-500/20">
                    2Y Target: {s.market === 'IN' ? '₹' : '$'}{s.target2Y.toFixed(0)} (+{s.return2Y}%)
                  </span>
                  {s.accDistPhase && (
                    <span className={`px-2 py-1 rounded-lg text-[10px] font-bold border ${s.accDistPhase === 'ACCUMULATION' ? 'bg-purple-500/15 text-purple-400 border-purple-500/20' : s.accDistPhase === 'DISTRIBUTION' ? 'bg-orange-500/15 text-orange-400 border-orange-500/20' : s.accDistPhase === 'MARKUP' ? 'bg-emerald-500/15 text-emerald-400 border-emerald-500/20' : 'bg-red-500/15 text-red-400 border-red-500/20'}`}>
                      🔄 {s.accDistPhase}
                    </span>
                  )}
                  {s.institutionalQuality && (
                    <span className="px-2 py-1 rounded-lg bg-indigo-500/10 text-indigo-400 text-[10px] font-bold border border-indigo-500/20">
                      🏛️ Institutional: {s.institutionalQuality}%
                    </span>
                  )}
                </div>
              </div>

              {/* Buy/Sell Timing */}
              <div className="mt-2 grid grid-cols-2 gap-2">
                <div className="bg-emerald-500/5 border border-emerald-500/15 rounded-lg p-2">
                  <div className="text-[9px] text-emerald-400/80 font-bold uppercase">📈 Kab Buy Karo</div>
                  <div className="text-[11px] text-emerald-300 font-medium mt-0.5">{s.buyTiming}</div>
                </div>
                <div className="bg-red-500/5 border border-red-500/15 rounded-lg p-2">
                  <div className="text-[9px] text-red-400/80 font-bold uppercase">📉 Kab Sell Karo</div>
                  <div className="text-[11px] text-red-300 font-medium mt-0.5">{s.sellTiming}</div>
                </div>
              </div>
            </div>

            {/* Expanded Detail */}
            {expandedStock === s.symbol && (
              <div className="border-t border-white/5 p-4 bg-black/20 animate-fade-in space-y-3">
                {/* Factor Breakdown */}
                <div className="grid grid-cols-5 gap-2">
                  {[
                    { label: 'Fundamental', score: s.fundamentalScore, color: 'bg-purple-500' },
                    { label: 'Technical', score: s.technicalScore, color: 'bg-cyan-500' },
                    { label: 'Momentum', score: s.momentumScore, color: 'bg-emerald-500' },
                    { label: 'Sentiment', score: s.sentimentScore, color: 'bg-blue-500' },
                    { label: 'Value', score: s.valueScore, color: 'bg-amber-500' },
                  ].map(f => (
                    <div key={f.label}>
                      <div className="flex justify-between text-[9px] mb-1">
                        <span className="text-slate-500">{f.label}</span>
                        <span className={sc(f.score)}>{f.score}</span>
                      </div>
                      <div className="w-full h-1.5 bg-slate-800 rounded-full overflow-hidden">
                        <div className={`h-full ${f.color} rounded-full transition-all`} style={{ width: `${f.score}%` }} />
                      </div>
                    </div>
                  ))}
                </div>

                {/* Technical Indicators */}
                <div className="grid grid-cols-2 md:grid-cols-6 gap-2">
                  <div className="bg-black/30 rounded-lg p-2 text-center">
                    <div className="text-[9px] text-slate-500 font-bold">RSI (14)</div>
                    <div className={`text-sm font-black font-mono ${s.rsi < 35 ? 'text-emerald-400' : s.rsi > 65 ? 'text-red-400' : 'text-cyan-400'}`}>{s.rsi.toFixed(1)}</div>
                  </div>
                  <div className="bg-black/30 rounded-lg p-2 text-center">
                    <div className="text-[9px] text-slate-500 font-bold">ADX Trend</div>
                    <div className={`text-sm font-black font-mono ${s.adx && s.adx >= 25 ? 'text-emerald-400' : 'text-slate-400'}`}>{s.adx || 'N/A'} {s.adx && s.adx >= 25 ? '🔥' : '⏳'}</div>
                  </div>
                  <div className="bg-black/30 rounded-lg p-2 text-center">
                    <div className="text-[9px] text-slate-500 font-bold">Bollinger Bands</div>
                    <div className="text-[10px] font-black font-mono text-cyan-400">
                      {s.market === 'IN' ? '₹' : '$'}{s.bbLower?.toFixed(0) || '--'} - {s.market === 'IN' ? '₹' : '$'}{s.bbUpper?.toFixed(0) || '--'}
                    </div>
                  </div>
                  <div className="bg-black/30 rounded-lg p-2 text-center">
                    <div className="text-[9px] text-slate-500 font-bold">Fib Levels</div>
                    <div className="text-[10px] font-black font-mono text-amber-400">
                      S: {s.fibSupport?.toFixed(0) || '--'} | R: {s.fibResistance?.toFixed(0) || '--'}
                    </div>
                  </div>
                  <div className="bg-black/30 rounded-lg p-2 text-center">
                    <div className="text-[9px] text-slate-500 font-bold">On-Balance Vol</div>
                    <div className={`text-sm font-black font-mono ${s.obv && s.obv >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                      {s.obv ? (s.obv > 1e6 ? `${(s.obv / 1e6).toFixed(1)}M` : `${(s.obv / 1e3).toFixed(0)}K`) : 'N/A'}
                    </div>
                  </div>
                  <div className="bg-black/30 rounded-lg p-2 text-center">
                    <div className="text-[9px] text-slate-500 font-bold">Sector Rank</div>
                    <div className="text-sm font-black font-mono text-indigo-400">#{s.sectorRank || 'N/A'} / 10</div>
                  </div>
                </div>

                {/* Real-Time Chart */}
                <StockMiniChart symbol={s.symbol} market={s.market} price={s.price} sma20={s.sma20} sma50={s.sma50} />

                {/* AI Reasoning */}
                <div className="bg-black/30 rounded-xl p-3 border border-white/5">
                  <div className="text-[10px] text-slate-500 font-bold uppercase mb-1">🤖 AI Reasoning</div>
                  <div className="text-xs text-slate-300">{s.aiReasoning}</div>
                </div>

                {s.aiAnalysis && (
                  <div className="bg-cyan-500/5 rounded-xl p-3 border border-cyan-500/20">
                    <div className="text-[10px] text-cyan-400 font-bold uppercase mb-1">🧠 Groq Deep Analysis</div>
                    <div className="text-xs text-cyan-200 whitespace-pre-line">{s.aiAnalysis}</div>
                  </div>
                )}
              </div>
            )}
          </div>
        ))}
      </div>

      {/* Empty State */}
      {filtered.length === 0 && !isScanning && (
        <div className="quantum-panel rounded-2xl p-12 text-center animate-fade-in">
          <div className="text-4xl mb-3 animate-float">🧠</div>
          <div className="text-slate-400 font-medium">No stocks found</div>
          <div className="text-xs text-slate-600 mt-1">Click Re-Scan to fetch live data</div>
        </div>
      )}

      {/* Legend */}
      <div className="quantum-panel rounded-2xl p-4 animate-fade-in-up">
        <div className="text-[10px] text-slate-500 font-bold uppercase mb-2">🧬 Deep Mind AI Advance Pro Scoring</div>
        <div className="flex flex-wrap gap-3 text-[10px] text-slate-400">
          <span><span className="text-purple-400 font-bold">30%</span> Fundamentals (CAGR, Moat, Drawdown)</span>
          <span><span className="text-cyan-400 font-bold">25%</span> Technicals (RSI, SMA, MACD, BB, ADX)</span>
          <span><span className="text-emerald-400 font-bold">20%</span> Momentum (Change, Volume, OBV)</span>
          <span><span className="text-blue-400 font-bold">15%</span> Sentiment (VIX, Volume Profile)</span>
          <span><span className="text-amber-400 font-bold">10%</span> Value (PEG, Fib Support, Discount)</span>
        </div>
        <div className="flex flex-wrap gap-3 text-[10px] text-slate-400 mt-1">
          <span>🏛️ Institutional Quality Assessment</span>
          <span>🔄 Accumulation & Distribution Phases</span>
          <span>📐 Fibonacci Pivot Analysis</span>
          <span>🔥 ADX Trend Strength Meter</span>
        </div>
        <div className="mt-2 text-[9px] text-slate-600 font-mono">
          Powered by TradingView Scanner + Groq Super Intelligence | Auto-refresh: 5min | Telegram Alerts: 2hr Intervals
        </div>
      </div>
    </div>
  );
});

// ========================================
// Mini Stock Chart — Real-Time Streaming
// ========================================
function StockMiniChart({
  symbol,
  market,
  price,
  sma20,
  sma50,
}: {
  symbol: string;
  market: 'IN' | 'US';
  price: number;
  sma20?: number;
  sma50?: number;
}) {
  const { history, isConnected } = useRealTimePrice(symbol, market, 60);
  const { candles, volumes } = useMemo(() => snapshotsToCandles(history), [history]);

  // Generate static fallback data from current price if no live data yet
  const fallbackCandles = useMemo(() => {
    if (candles.length > 0) return candles;
    const now = Math.floor(Date.now() / 1000);
    return Array.from({ length: 20 }, (_, i) => {
      const t = (now - (19 - i) * 300) as any;
      const variance = price * 0.02 * (Math.random() - 0.5);
      const open = price + variance;
      const close = price + variance * 0.8;
      return { time: t, open, high: Math.max(open, close) + price * 0.005, low: Math.min(open, close) - price * 0.005, close };
    });
  }, [candles, price]);

  const priceLines = useMemo(() => {
    const lines: { price: number; label: string; color: string }[] = [];
    if (sma20) lines.push({ price: sma20, label: 'SMA20', color: '#6366F1' });
    if (sma50) lines.push({ price: sma50, label: 'SMA50', color: '#F59E0B' });
    return lines;
  }, [sma20, sma50]);

  return (
    <div className="bg-black/30 rounded-xl p-3 border border-white/5">
      <div className="flex items-center justify-between mb-2">
        <div className="text-[10px] text-slate-500 font-bold uppercase">📈 Real-Time Chart</div>
        <div className="flex items-center gap-1.5">
          <div className={`w-2 h-2 rounded-full ${isConnected ? 'bg-emerald-400 animate-pulse' : 'bg-slate-600'}`} />
          <span className="text-[9px] text-slate-600">{isConnected ? 'LIVE' : 'Connecting...'}</span>
        </div>
      </div>
      <TradingViewChart
        data={fallbackCandles}
        volume={volumes}
        symbol={symbol}
        height={180}
        priceLines={priceLines}
      />
      <div className="flex gap-3 mt-1.5 text-[9px] text-slate-500">
        <span className="flex items-center gap-1">
          <span className="w-2 h-0.5 bg-indigo-500 rounded" /> SMA20
        </span>
        <span className="flex items-center gap-1">
          <span className="w-2 h-0.5 bg-amber-500 rounded" /> SMA50
        </span>
        <span className="text-slate-600">{history.length} ticks buffered</span>
      </div>
    </div>
  );
}
