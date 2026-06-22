import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useApp } from '../../hooks/AppContext';
import {
  IntradaySignal, runIntradayProScan, getIntradayAiAnalysis,
  formatIntradayTelegram
} from '../../utils/intradayProEngine';
import { sendTelegramAlert } from '../../utils/api';
import { secureStorage } from '../../utils/secureStorage';

// ========== COLOR HELPERS ==========
const trendColors: Record<string, string> = {
  STRONG_UP: 'text-emerald-400', UP: 'text-green-400',
  SIDEWAYS: 'text-amber-400', DOWN: 'text-orange-400', STRONG_DOWN: 'text-red-400'
};
const trendBg: Record<string, string> = {
  STRONG_UP: 'bg-emerald-500/10 border-emerald-500/30',
  UP: 'bg-green-500/10 border-green-500/30',
  SIDEWAYS: 'bg-amber-500/10 border-amber-500/30',
  DOWN: 'bg-orange-500/10 border-orange-500/30',
  STRONG_DOWN: 'bg-red-500/10 border-red-500/30'
};
const trendIcon: Record<string, string> = {
  STRONG_UP: '🚀', UP: '📈', SIDEWAYS: '↔️', DOWN: '📉', STRONG_DOWN: '💀'
};
const signalBadge: Record<string, string> = {
  STRONG_BUY: 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30',
  BUY: 'bg-cyan-500/15 text-cyan-400 border-cyan-500/30',
  HOLD: 'bg-amber-500/15 text-amber-400 border-amber-500/30',
  SELL: 'bg-orange-500/15 text-orange-400 border-orange-500/30',
  STRONG_SELL: 'bg-red-500/15 text-red-400 border-red-500/30',
};
function sc(v: number): string {
  if (v >= 75) return 'text-emerald-400';
  if (v >= 55) return 'text-cyan-400';
  if (v >= 35) return 'text-amber-400';
  return 'text-red-400';
}

type FilterType = 'ALL' | 'NSE_STOCK' | 'COINDCX_FUTURES';

export default React.memo(function DeepScanTab() {
  const { } = useApp();
  const [signals, setSignals] = useState<IntradaySignal[]>([]);
  const [filter, setFilter] = useState<FilterType>('ALL');
  const [isScanning, setIsScanning] = useState(false);
  const [lastScan, setLastScan] = useState('');
  const [expanded, setExpanded] = useState<string | null>(null);
  const [aiLoading, setAiLoading] = useState(false);
  const [tgSending, setTgSending] = useState(false);
  const scanInterval = useRef<number | null>(null);
  const aiCache = useRef<Record<string, string>>({});
  const signalsRef = useRef(signals);
  signalsRef.current = signals;

  // ========== SCAN ==========
  const doScan = useCallback(async () => {
    setIsScanning(true);
    try {
      const result = await runIntradayProScan();
      const withAi = result.map(s =>
        aiCache.current[s.symbol] ? { ...s, aiAnalysis: aiCache.current[s.symbol] } : s
      );
      setSignals(withAi);
      setLastScan(new Date().toLocaleTimeString('en-IN', {
        timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit', second: '2-digit'
      }));

      // Background AI analysis
      setAiLoading(true);
      getIntradayAiAnalysis(result, 5).then(analyses => {
        if (Object.keys(analyses).length > 0) {
          Object.assign(aiCache.current, analyses);
          setSignals(prev => prev.map(s =>
            analyses[s.symbol] ? { ...s, aiAnalysis: analyses[s.symbol] } : s
          ));
        }
      }).catch(() => {}).finally(() => setAiLoading(false));
    } catch (e) { console.warn('Intraday scan failed:', e); }
    finally { setIsScanning(false); }
  }, []);

  // Auto-scan every 3 min (intraday needs faster refresh)
  useEffect(() => {
    doScan();
    scanInterval.current = window.setInterval(doScan, 180000);
    return () => { if (scanInterval.current) clearInterval(scanInterval.current); };
  }, [doScan]);

  // Telegram auto-alert every 2 hours
  useEffect(() => {
    let initTimeout: number | undefined;
    let tgInt: number | undefined;
    (async () => {
      const [token, chatId] = await Promise.all([
        secureStorage.getItemAsync('TG_TOKEN'), secureStorage.getItemAsync('TG_CHAT_ID')
      ]);
      if (!token || !chatId) return;
      const sendAlert = async () => {
        const latest = signalsRef.current;
        if (latest.length === 0) return;
        const msg = formatIntradayTelegram(latest, 'ALL');
        await sendTelegramAlert(token, chatId, msg);
      };
      initTimeout = window.setTimeout(sendAlert, 90000);
      tgInt = window.setInterval(sendAlert, 7200000);
    })();
    return () => { clearTimeout(initTimeout); if (tgInt) clearInterval(tgInt); };
  }, []);

  // Manual TG push
  const pushTelegram = useCallback(async () => {
    setTgSending(true);
    try {
      const [token, chatId] = await Promise.all([
        secureStorage.getItemAsync('TG_TOKEN'), secureStorage.getItemAsync('TG_CHAT_ID')
      ]);
      await sendTelegramAlert(token || '', chatId || '',
        formatIntradayTelegram(signals, filter === 'ALL' ? 'ALL' : filter));
    } catch (e) { console.warn('TG push failed:', e); }
    finally { setTgSending(false); }
  }, [signals, filter]);

  // Filtered signals
  const filtered = useMemo(() => {
    const list = filter === 'ALL' ? signals : signals.filter(s => s.category === filter);
    return list.slice(0, 15);
  }, [signals, filter]);

  const summary = useMemo(() => ({
    total: signals.length,
    strongBuy: signals.filter(s => s.signal === 'STRONG_BUY').length,
    buy: signals.filter(s => s.signal === 'BUY').length,
    uptrend: signals.filter(s => s.trend === 'STRONG_UP' || s.trend === 'UP').length,
    downtrend: signals.filter(s => s.trend === 'STRONG_DOWN' || s.trend === 'DOWN').length,
    avgScore: signals.length > 0 ? Math.round(signals.reduce((a, b) => a + b.signalScore, 0) / signals.length) : 0,
  }), [signals]);

  return (
    <div className="space-y-5 animate-fade-in">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-2xl font-black gradient-text-cyan font-display flex items-center gap-2">
            ⚡ INDIA INTRADAY PRO EXPERT
          </h2>
          <div className="text-[11px] text-slate-500 mt-1 font-mono flex items-center gap-2">
            <span className={`w-2 h-2 rounded-full ${isScanning ? 'bg-amber-400 animate-pulse' : 'bg-emerald-400 animate-pulse-dot'}`} />
            {isScanning ? 'SCANNING LIVE...' : `Last: ${lastScan || '--'}`}
            {aiLoading && <span className="text-cyan-400 animate-pulse">🧠 AI Analyzing...</span>}
          </div>
          <div className="text-[10px] text-slate-600 mt-0.5">
            DeepMind AI Quantum • Entry/Exit Points • CoinDCX Futures • NSE Intraday
          </div>
        </div>
        <div className="flex gap-2">
          <button onClick={doScan} disabled={isScanning}
            className="quantum-btn-ghost px-4 py-2 rounded-xl text-xs font-bold disabled:opacity-40">
            {isScanning ? '⏳ Scanning...' : '🔄 Re-Scan'}
          </button>
          <button onClick={pushTelegram} disabled={tgSending}
            className="quantum-btn-primary px-4 py-2 bg-gradient-to-r from-cyan-600 to-indigo-600 rounded-xl text-xs font-bold text-white disabled:opacity-40">
            {tgSending ? '📤 Sending...' : '📲 Telegram'}
          </button>
        </div>
      </div>

      {/* Filter Tabs */}
      <div className="flex gap-1 quantum-panel p-1 rounded-xl w-fit">
        {([
          { key: 'ALL' as FilterType, label: '🌍 All Markets', icon: '' },
          { key: 'NSE_STOCK' as FilterType, label: '🇮🇳 NSE Intraday', icon: '' },
          { key: 'COINDCX_FUTURES' as FilterType, label: '₿ CoinDCX Futures', icon: '' },
        ]).map(f => (
          <button key={f.key} onClick={() => setFilter(f.key)}
            className={`px-4 py-2 rounded-lg text-xs font-bold transition-all ${filter === f.key
              ? 'bg-cyan-500/20 text-cyan-400 border border-cyan-500/20'
              : 'text-slate-500 hover:text-slate-300'}`}>
            {f.label}
          </button>
        ))}
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-2 md:grid-cols-6 gap-3 animate-fade-in-up">
        <div className="quantum-stat rounded-2xl p-4">
          <div className="text-slate-500 text-[10px] font-bold uppercase tracking-wider">Total Scanned</div>
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
          <div className="text-slate-500 text-[10px] font-bold uppercase tracking-wider">📈 Uptrend</div>
          <div className="text-2xl font-black text-emerald-400 mt-1 font-mono">{summary.uptrend}</div>
        </div>
        <div className="quantum-stat rounded-2xl p-4">
          <div className="text-slate-500 text-[10px] font-bold uppercase tracking-wider">📉 Downtrend</div>
          <div className="text-2xl font-black text-red-400 mt-1 font-mono">{summary.downtrend}</div>
        </div>
        <div className="quantum-stat rounded-2xl p-4">
          <div className="text-slate-500 text-[10px] font-bold uppercase tracking-wider">Avg AI Score</div>
          <div className={`text-2xl font-black mt-1 font-mono ${sc(summary.avgScore)}`}>{summary.avgScore}</div>
        </div>
      </div>

      {/* Signal Cards */}
      <div className="space-y-3">
        {filtered.map((s, idx) => (
          <div key={`${s.symbol}-${s.category}`}
            className={`quantum-panel rounded-2xl overflow-hidden border transition-all animate-fade-in-up ${trendBg[s.trend]}`}
            style={{ animationDelay: `${idx * 40}ms` }}>

            {/* Main Row */}
            <div className="p-4 cursor-pointer" onClick={() => setExpanded(expanded === s.symbol ? null : s.symbol)}>
              <div className="flex flex-wrap items-start justify-between gap-3">
                {/* Left */}
                <div className="flex items-center gap-3 min-w-0">
                  <div className={`w-10 h-10 rounded-xl flex items-center justify-center text-lg font-black font-mono border border-white/10 ${
                    s.signalScore >= 65 ? 'bg-emerald-500/20' : s.signalScore >= 40 ? 'bg-amber-500/20' : 'bg-red-500/20'
                  }`}>{idx + 1}</div>
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-bold text-white text-sm">{s.symbol}</span>
                      <span className={`px-2 py-0.5 rounded-md text-[9px] font-bold border ${signalBadge[s.signal]}`}>
                        {s.signal.replace('_', ' ')}
                      </span>
                      <span className={`px-2 py-0.5 rounded-md text-[9px] font-bold border ${trendBg[s.trend]} ${trendColors[s.trend]}`}>
                        {trendIcon[s.trend]} {s.trend.replace('_', ' ')}
                      </span>
                      <span className="text-[9px] text-slate-600 font-mono">
                        {s.category === 'COINDCX_FUTURES' ? '₿ CoinDCX' : '🇮🇳 NSE'}
                      </span>
                    </div>
                    <div className="text-[11px] text-slate-400 truncate">{s.name}</div>
                  </div>
                </div>

                {/* Price */}
                <div className="text-right">
                  <div className={`text-lg font-black font-mono ${s.change >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                    ₹{s.price.toFixed(2)}
                  </div>
                  <div className={`text-xs font-bold ${s.change >= 0 ? 'text-emerald-500' : 'text-red-500'}`}>
                    {s.change >= 0 ? '▲' : '▼'} {s.change.toFixed(2)}%
                  </div>
                </div>

                {/* AI Score */}
                <div className="text-center">
                  <div className={`text-3xl font-black font-mono ${sc(s.signalScore)}`}>{s.signalScore}</div>
                  <div className="text-[9px] text-slate-600 font-bold uppercase">AI SCORE</div>
                  <div className="w-16 h-1.5 bg-slate-800 rounded-full mt-1 overflow-hidden">
                    <div className={`h-full rounded-full transition-all ${
                      s.signalScore >= 65 ? 'bg-gradient-to-r from-emerald-500 to-cyan-500'
                      : s.signalScore >= 40 ? 'bg-gradient-to-r from-amber-500 to-yellow-500'
                      : 'bg-gradient-to-r from-red-500 to-orange-500'
                    }`} style={{ width: `${s.signalScore}%` }} />
                  </div>
                </div>
              </div>

              {/* Entry/Exit Row — MAIN FEATURE */}
              <div className="mt-3 grid grid-cols-2 md:grid-cols-4 gap-2">
                <div className="bg-emerald-500/10 border border-emerald-500/20 rounded-lg p-2.5">
                  <div className="text-[9px] text-emerald-400/80 font-bold uppercase">🎯 ENTRY PRICE</div>
                  <div className="text-base font-black text-emerald-300 font-mono mt-0.5">₹{s.entryPrice.toFixed(2)}</div>
                </div>
                <div className="bg-cyan-500/10 border border-cyan-500/20 rounded-lg p-2.5">
                  <div className="text-[9px] text-cyan-400/80 font-bold uppercase">🏁 EXIT PRICE</div>
                  <div className="text-base font-black text-cyan-300 font-mono mt-0.5">₹{s.exitPrice.toFixed(2)}</div>
                </div>
                <div className="bg-red-500/10 border border-red-500/20 rounded-lg p-2.5">
                  <div className="text-[9px] text-red-400/80 font-bold uppercase">🛑 STOP LOSS</div>
                  <div className="text-base font-black text-red-300 font-mono mt-0.5">₹{s.stopLoss.toFixed(2)}</div>
                </div>
                <div className="bg-purple-500/10 border border-purple-500/20 rounded-lg p-2.5">
                  <div className="text-[9px] text-purple-400/80 font-bold uppercase">⚖️ RISK:REWARD</div>
                  <div className={`text-base font-black font-mono mt-0.5 ${s.riskReward >= 2 ? 'text-emerald-300' : s.riskReward >= 1.5 ? 'text-cyan-300' : 'text-amber-300'}`}>
                    {s.riskReward}x
                  </div>
                </div>
              </div>

              {/* AI Reasoning */}
              <div className="mt-2 text-[11px] text-slate-400">{s.aiReasoning}</div>
            </div>

            {/* Expanded Detail */}
            {expanded === s.symbol && (
              <div className="border-t border-white/5 p-4 bg-black/20 animate-fade-in space-y-3">
                {/* Pivot Points & Levels */}
                <div className="grid grid-cols-2 md:grid-cols-5 gap-2">
                  <div className="bg-black/30 rounded-lg p-2 text-center">
                    <div className="text-[9px] text-slate-500 font-bold">VWAP</div>
                    <div className="text-sm font-black font-mono text-cyan-400">₹{s.vwap.toFixed(2)}</div>
                  </div>
                  <div className="bg-black/30 rounded-lg p-2 text-center">
                    <div className="text-[9px] text-slate-500 font-bold">PIVOT</div>
                    <div className="text-sm font-black font-mono text-indigo-400">₹{s.pivotPoint}</div>
                  </div>
                  <div className="bg-black/30 rounded-lg p-2 text-center">
                    <div className="text-[9px] text-emerald-500 font-bold">SUPPORT 1</div>
                    <div className="text-sm font-black font-mono text-emerald-400">₹{s.support1}</div>
                  </div>
                  <div className="bg-black/30 rounded-lg p-2 text-center">
                    <div className="text-[9px] text-emerald-500 font-bold">SUPPORT 2</div>
                    <div className="text-sm font-black font-mono text-emerald-400">₹{s.support2}</div>
                  </div>
                  <div className="bg-black/30 rounded-lg p-2 text-center">
                    <div className="text-[9px] text-red-500 font-bold">RESIST 1</div>
                    <div className="text-sm font-black font-mono text-red-400">₹{s.resistance1}</div>
                  </div>
                </div>

                {/* Technical Indicators */}
                <div className="grid grid-cols-2 md:grid-cols-6 gap-2">
                  <div className="bg-black/30 rounded-lg p-2 text-center">
                    <div className="text-[9px] text-slate-500 font-bold">RSI (14)</div>
                    <div className={`text-sm font-black font-mono ${s.rsi < 35 ? 'text-emerald-400' : s.rsi > 65 ? 'text-red-400' : 'text-cyan-400'}`}>
                      {s.rsi.toFixed(1)}
                    </div>
                  </div>
                  <div className="bg-black/30 rounded-lg p-2 text-center">
                    <div className="text-[9px] text-slate-500 font-bold">MACD</div>
                    <div className={`text-sm font-black font-mono ${s.macd >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                      {s.macd.toFixed(2)}
                    </div>
                  </div>
                  <div className="bg-black/30 rounded-lg p-2 text-center">
                    <div className="text-[9px] text-slate-500 font-bold">SMA 20</div>
                    <div className="text-sm font-black font-mono text-indigo-400">₹{s.sma20.toFixed(1)}</div>
                  </div>
                  <div className="bg-black/30 rounded-lg p-2 text-center">
                    <div className="text-[9px] text-slate-500 font-bold">SMA 50</div>
                    <div className="text-sm font-black font-mono text-amber-400">₹{s.sma50.toFixed(1)}</div>
                  </div>
                  <div className="bg-black/30 rounded-lg p-2 text-center">
                    <div className="text-[9px] text-slate-500 font-bold">ATR</div>
                    <div className="text-sm font-black font-mono text-cyan-400">₹{s.atr.toFixed(2)}</div>
                  </div>
                  <div className="bg-black/30 rounded-lg p-2 text-center">
                    <div className="text-[9px] text-slate-500 font-bold">TREND STR</div>
                    <div className={`text-sm font-black font-mono ${trendColors[s.trend]}`}>
                      {s.trendStrength}%
                    </div>
                  </div>
                </div>

                {/* Trend Strength Bar */}
                <div className="bg-black/30 rounded-xl p-3 border border-white/5">
                  <div className="flex justify-between items-center mb-1.5">
                    <span className="text-[10px] text-slate-500 font-bold uppercase">📊 Trend Strength Meter</span>
                    <span className={`text-xs font-bold ${trendColors[s.trend]}`}>
                      {trendIcon[s.trend]} {s.trend.replace('_', ' ')} ({s.trendStrength}%)
                    </span>
                  </div>
                  <div className="w-full h-2.5 bg-slate-800 rounded-full overflow-hidden">
                    <div className={`h-full rounded-full transition-all duration-500 ${
                      s.trendStrength >= 70 ? 'bg-gradient-to-r from-emerald-500 to-cyan-400'
                      : s.trendStrength >= 40 ? 'bg-gradient-to-r from-amber-500 to-yellow-400'
                      : 'bg-gradient-to-r from-red-500 to-orange-400'
                    }`} style={{ width: `${s.trendStrength}%` }} />
                  </div>
                  <div className="flex justify-between mt-1 text-[8px] text-slate-600">
                    <span>Strong Down</span><span>Sideways</span><span>Strong Up</span>
                  </div>
                </div>

                {/* Confidence */}
                <div className="bg-black/30 rounded-xl p-3 border border-white/5">
                  <div className="text-[10px] text-slate-500 font-bold uppercase mb-1">🧠 AI Confidence</div>
                  <div className="flex items-center gap-3">
                    <div className="text-2xl font-black text-purple-400 font-mono">{s.confidence}%</div>
                    <div className="flex-1 h-2 bg-slate-800 rounded-full overflow-hidden">
                      <div className="h-full bg-gradient-to-r from-purple-500 to-cyan-400 rounded-full"
                        style={{ width: `${s.confidence}%` }} />
                    </div>
                  </div>
                </div>

                {/* AI Analysis */}
                {s.aiAnalysis && (
                  <div className="bg-cyan-500/5 rounded-xl p-3 border border-cyan-500/20">
                    <div className="text-[10px] text-cyan-400 font-bold uppercase mb-1">🧠 DeepMind AI Quantum Analysis</div>
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
          <div className="text-4xl mb-3 animate-float">⚡</div>
          <div className="text-slate-400 font-medium">No signals found</div>
          <div className="text-xs text-slate-600 mt-1">Click Re-Scan to fetch live intraday data</div>
        </div>
      )}

      {/* Legend */}
      <div className="quantum-panel rounded-2xl p-4 animate-fade-in-up">
        <div className="text-[10px] text-slate-500 font-bold uppercase mb-2">🧬 DeepMind AI Quantum — Intraday Pro Expert</div>
        <div className="flex flex-wrap gap-3 text-[10px] text-slate-400">
          <span>🎯 <span className="text-emerald-400 font-bold">Entry Price</span> — Optimal buy point (VWAP + Pivot)</span>
          <span>🏁 <span className="text-cyan-400 font-bold">Exit Price</span> — Profit target (ATR-based)</span>
          <span>🛑 <span className="text-red-400 font-bold">Stop Loss</span> — Risk management level</span>
          <span>⚖️ <span className="text-purple-400 font-bold">R:R</span> — Risk-to-Reward ratio (2x+ = Strong)</span>
        </div>
        <div className="flex flex-wrap gap-3 text-[10px] text-slate-400 mt-1">
          <span>📊 Trend: RSI + SMA + MACD + Price Action</span>
          <span>🇮🇳 NSE Stocks via TradingView Scanner</span>
          <span>₿ CoinDCX Futures Real-Time API</span>
        </div>
        <div className="mt-2 text-[9px] text-slate-600 font-mono">
          Powered by DeepMind AI Quantum + Groq Intelligence | Auto-refresh: 3min | Telegram: 2hr
        </div>
      </div>
    </div>
  );
});
