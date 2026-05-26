import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useApp } from '../../hooks/AppContext';
import { FuturesTradeSignal, ActiveTrade, TradeJournalEntry } from '../../types';
import { fetchTradingPrices, runTradingScan, formatTradingTelegram, fetchCoinDcxPrices } from '../../utils/tradingEngine';
import { runMultiAiAnalysis, AIConsensusResult } from '../../utils/multiAiEngine';
import { sendTelegramAlert } from '../../utils/api';
import { TG_TOKEN, TG_CHAT_ID } from '../../utils/constants';

function sc(v: number): string {
  if (v >= 75) return 'text-emerald-400';
  if (v >= 55) return 'text-cyan-400';
  if (v >= 35) return 'text-amber-400';
  return 'text-red-400';
}

const dirBadge: Record<string, string> = {
  STRONG_LONG: 'trade-badge-strong-long',
  LONG: 'trade-badge-long',
  STRONG_SHORT: 'trade-badge-strong-short',
  SHORT: 'trade-badge-short',
};

export default React.memo(function TradingTab() {
  const { usVix, inVix, livePrices } = useApp();
  const [signals, setSignals] = useState<FuturesTradeSignal[]>([]);
  const [marketFilter, setMarketFilter] = useState<'ALL' | 'CRYPTO' | 'US' | 'IN'>('ALL');
  const [dirFilter, setDirFilter] = useState<'ALL' | 'LONG' | 'SHORT'>('ALL');
  const [sortBy, setSortBy] = useState<'aiScore' | 'riskReward' | 'potentialReturn'>('aiScore');
  const [isScanning, setIsScanning] = useState(false);
  const [lastScan, setLastScan] = useState('');
  const [expandedSignal, setExpandedSignal] = useState<string | null>(null);
  const [aiLoading, setAiLoading] = useState(false);
  const [tgSending, setTgSending] = useState(false);
  const [_aiConsensus, setAiConsensus] = useState<Record<string, AIConsensusResult>>({});
  const [_dailyPnl, _setDailyPnl] = useState(0);

  // Persistent Active Trades & Journal (localStorage)
  const [activeTrades, setActiveTrades] = useState<ActiveTrade[]>(() => {
    try { return JSON.parse(localStorage.getItem('quantum_active_trades') || '[]'); } catch { return []; }
  });
  const [journal, setJournal] = useState<TradeJournalEntry[]>(() => {
    try { return JSON.parse(localStorage.getItem('quantum_trade_journal') || '[]'); } catch { return []; }
  });
  const [_coinDcxPrices, setCoinDcxPrices] = useState<Record<string, number>>({});
  const [riskCapital, setRiskCapital] = useState(5000);
  const [riskPerTrade, setRiskPerTrade] = useState(5);

  // Persist trades
  useEffect(() => { localStorage.setItem('quantum_active_trades', JSON.stringify(activeTrades)); }, [activeTrades]);
  useEffect(() => { localStorage.setItem('quantum_trade_journal', JSON.stringify(journal)); }, [journal]);

  const scanInterval = useRef<number | null>(null);
  const livePricesRef = useRef(livePrices);
  livePricesRef.current = livePrices;
  const vixRef = useRef({ usVix, inVix });
  vixRef.current = { usVix, inVix };
  const aiCache = useRef<Record<string, AIConsensusResult>>({});

  const doScan = useCallback(async () => {
    setIsScanning(true);
    try {
      const [prices, cdxPrices] = await Promise.all([fetchTradingPrices(), fetchCoinDcxPrices()]);
      setCoinDcxPrices(cdxPrices);
      for (const [k, v] of Object.entries(livePricesRef.current)) {
        if (!prices[k] && v.price > 0) prices[k] = v;
      }
      const result = runTradingScan(prices, vixRef.current.usVix, vixRef.current.inVix, cdxPrices);
      // Apply cached AI consensus
      const withAi = result.map(s => {
        const cached = aiCache.current[s.symbol];
        if (cached) return { ...s, groqAnalysis: cached.groqAnalysis, geminiAnalysis: cached.geminiAnalysis, claudeAnalysis: cached.claudeAnalysis, aiConsensus: cached.consensus, aiConsensusLabel: cached.consensusLabel as any };
        return s;
      });
      setSignals(withAi);
      setLastScan(new Date().toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit', second: '2-digit' }));
      // Run Multi-AI Analysis (Groq + Gemini + Claude) in background
      setAiLoading(true);
      runMultiAiAnalysis(result).then(consensusResults => {
        if (Object.keys(consensusResults).length > 0) {
          Object.assign(aiCache.current, consensusResults);
          setAiConsensus(consensusResults);
          setSignals(prev => prev.map(s => {
            const c = consensusResults[s.symbol];
            if (!c) return s;
            return { ...s, groqAnalysis: c.groqAnalysis, geminiAnalysis: c.geminiAnalysis, claudeAnalysis: c.claudeAnalysis, aiConsensus: c.consensus, aiConsensusLabel: c.consensusLabel as any };
          }));
        }
      }).catch(() => {}).finally(() => setAiLoading(false));
    } catch (e) { console.warn('Trading scan failed:', e); }
    finally { setIsScanning(false); }
  }, []);

  useEffect(() => {
    doScan();
    scanInterval.current = window.setInterval(doScan, 60000); // 60s Deep Quantum
    return () => { if (scanInterval.current) clearInterval(scanInterval.current); };
  }, [doScan]);

  const pushToTelegram = useCallback(async () => {
    setTgSending(true);
    const msg = formatTradingTelegram(signals, marketFilter === 'ALL' ? 'ALL' : marketFilter as any);
    await sendTelegramAlert(TG_TOKEN, TG_CHAT_ID, msg);
    setTgSending(false);
  }, [signals, marketFilter]);

  const filtered = useMemo(() => {
    let list = signals;
    if (marketFilter !== 'ALL') list = list.filter(s => s.market === marketFilter);
    if (dirFilter !== 'ALL') list = list.filter(s => s.direction === dirFilter);
    list = [...list].sort((a, b) => {
      if (sortBy === 'riskReward') return b.riskReward - a.riskReward;
      if (sortBy === 'potentialReturn') return b.potentialReturn - a.potentialReturn;
      return b.aiScore - a.aiScore;
    });
    return list.slice(0, 15);
  }, [signals, marketFilter, dirFilter, sortBy]);

  const summary = useMemo(() => ({
    total: signals.length,
    longs: signals.filter(s => s.direction === 'LONG').length,
    shorts: signals.filter(s => s.direction === 'SHORT').length,
    avgRR: signals.length > 0 ? (signals.reduce((a, b) => a + b.riskReward, 0) / signals.length).toFixed(1) : '0',
    avgScore: signals.length > 0 ? Math.round(signals.reduce((a, b) => a + b.aiScore, 0) / signals.length) : 0,
    whaleAlerts: signals.filter(s => s.smartMoneySignal && s.smartMoneySignal !== 'NONE').length,
    avgMTF: signals.length > 0 ? Math.round(signals.reduce((a, b) => a + (b.multiTimeframeScore || 0), 0) / signals.length) : 0,
  }), [signals]);

  // Helper: add signal as active trade
  const addActiveTrade = useCallback((s: FuturesTradeSignal) => {
    const trade: ActiveTrade = {
      id: Date.now().toString(), symbol: s.symbol, market: s.market,
      direction: s.direction, leverage: s.leverage, entryPrice: s.currentPrice,
      quantity: Math.round((riskCapital * riskPerTrade / 100) / (Math.abs(s.currentPrice - s.stopLoss) * s.leverage)),
      stopLoss: s.stopLoss, target1: s.target1, target2: s.target2,
      entryTime: Date.now(), platform: s.market === 'CRYPTO' ? 'COINDCX' : s.market === 'IN' ? 'INDMONEY' : 'OTHER',
      pair: s.coinDcxPair || undefined,
    };
    setActiveTrades(prev => [trade, ...prev].slice(0, 20));
  }, [riskCapital, riskPerTrade]);

  // Helper: close trade -> journal
  const closeTrade = useCallback((trade: ActiveTrade, exitPrice: number) => {
    const pnl = trade.direction === 'LONG' ? (exitPrice - trade.entryPrice) * trade.quantity : (trade.entryPrice - exitPrice) * trade.quantity;
    const pnlPct = ((exitPrice - trade.entryPrice) / trade.entryPrice) * 100 * (trade.direction === 'LONG' ? 1 : -1);
    const entry: TradeJournalEntry = {
      id: trade.id, symbol: trade.symbol, market: trade.market,
      direction: trade.direction, leverage: trade.leverage,
      entryPrice: trade.entryPrice, exitPrice, quantity: trade.quantity,
      pnl, pnlPercent: Math.round(pnlPct * 10) / 10,
      riskReward: Math.abs(pnlPct) / ((Math.abs(trade.entryPrice - trade.stopLoss) / trade.entryPrice) * 100) || 0,
      result: pnl > 0 ? 'WIN' : pnl < 0 ? 'LOSS' : 'BREAKEVEN',
      entryTime: trade.entryTime, exitTime: Date.now(),
      platform: trade.platform, pair: trade.pair,
    };
    setJournal(prev => [entry, ...prev].slice(0, 50));
    setActiveTrades(prev => prev.filter(t => t.id !== trade.id));
  }, []);

  // Journal stats
  const journalStats = useMemo(() => {
    if (journal.length === 0) return { wins: 0, losses: 0, winRate: 0, avgRR: 0, totalPnl: 0 };
    const wins = journal.filter(j => j.result === 'WIN').length;
    return {
      wins, losses: journal.filter(j => j.result === 'LOSS').length,
      winRate: Math.round((wins / journal.length) * 100),
      avgRR: Math.round(journal.reduce((a, b) => a + b.riskReward, 0) / journal.length * 10) / 10,
      totalPnl: Math.round(journal.reduce((a, b) => a + b.pnl, 0)),
    };
  }, [journal]);

  return (
    <div className="space-y-5 animate-fade-in">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-2xl font-black gradient-text-pro font-display flex items-center gap-2">
            ⚡ DEEP QUANTUM TRADING TERMINAL
          </h2>
          <div className="flex items-center gap-2 mt-1">
            <span className={`w-2 h-2 rounded-full ${isScanning ? 'bg-amber-400 animate-pulse' : 'bg-emerald-400 animate-pulse-dot'}`} />
            <span className="text-[11px] text-slate-500 font-mono">
              {isScanning ? 'SCANNING MARKETS...' : `Last: ${lastScan || '--'}`}
            </span>
            <span className="quantum-badge">DAILY PROFIT</span>
            <span className="quantum-badge" style={{background:'linear-gradient(135deg,rgba(168,85,247,0.2),rgba(59,130,246,0.2))',borderColor:'rgba(168,85,247,0.3)'}}>GROQ + GEMINI + CLAUDE</span>
            {aiLoading && <span className="text-[10px] text-purple-400 animate-pulse">🧠 Multi-AI Analyzing...</span>}
          </div>
        </div>
        <div className="flex gap-2">
          <button onClick={doScan} disabled={isScanning} className="quantum-btn-ghost px-4 py-2 rounded-xl text-xs font-bold disabled:opacity-40">
            {isScanning ? '⏳ Scanning...' : '🔄 Re-Scan'}
          </button>
          <button onClick={pushToTelegram} disabled={tgSending} className="quantum-btn-primary px-4 py-2 bg-gradient-to-r from-orange-600 to-red-600 rounded-xl text-xs font-bold text-white disabled:opacity-40">
            {tgSending ? '📤 Sending...' : '📲 Trade Alert'}
          </button>
        </div>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-3">
        <div className="flex gap-0.5 quantum-panel p-1 rounded-xl">
          {(['ALL', 'CRYPTO', 'US', 'IN'] as const).map(f => (
            <button key={f} onClick={() => setMarketFilter(f)} className={`px-3 py-1.5 rounded-lg text-[11px] font-bold transition-all ${marketFilter === f ? 'bg-cyan-500/20 text-cyan-400 border border-cyan-500/20' : 'text-slate-500 hover:text-slate-300'}`}>
              {f === 'ALL' ? '🌍 All' : f === 'CRYPTO' ? '₿ Crypto' : f === 'IN' ? '🇮🇳 India' : '🇺🇸 USA'}
            </button>
          ))}
        </div>
        <div className="flex gap-0.5 quantum-panel p-1 rounded-xl">
          {(['ALL', 'LONG', 'SHORT'] as const).map(f => (
            <button key={f} onClick={() => setDirFilter(f)} className={`px-3 py-1.5 rounded-lg text-[11px] font-bold transition-all ${dirFilter === f ? (f === 'LONG' ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/20' : f === 'SHORT' ? 'bg-red-500/20 text-red-400 border border-red-500/20' : 'bg-cyan-500/20 text-cyan-400 border border-cyan-500/20') : 'text-slate-500 hover:text-slate-300'}`}>
              {f === 'ALL' ? '↕️ All' : f === 'LONG' ? '🟢 Long' : '🔴 Short'}
            </button>
          ))}
        </div>
        <div className="flex gap-0.5 quantum-panel p-1 rounded-xl">
          {([{ k: 'aiScore', l: '🧠 AI Score' }, { k: 'riskReward', l: '⚖️ R:R' }, { k: 'potentialReturn', l: '💰 Return' }] as const).map(f => (
            <button key={f.k} onClick={() => setSortBy(f.k as any)} className={`px-3 py-1.5 rounded-lg text-[11px] font-bold transition-all ${sortBy === f.k ? 'bg-purple-500/20 text-purple-400 border border-purple-500/20' : 'text-slate-500 hover:text-slate-300'}`}>
              {f.l}
            </button>
          ))}
        </div>
      </div>

      {/* Summary */}
      <div className="grid grid-cols-2 sm:grid-cols-4 md:grid-cols-7 gap-3 animate-fade-in-up">
        <div className="quantum-stat rounded-2xl p-3">
          <div className="text-slate-500 text-[10px] font-bold uppercase tracking-wider">Signals</div>
          <div className="text-2xl font-black text-cyan-400 mt-1 font-mono">{summary.total}</div>
        </div>
        <div className="quantum-stat rounded-2xl p-3">
          <div className="text-slate-500 text-[10px] font-bold uppercase tracking-wider">🟢 Long</div>
          <div className="text-2xl font-black text-emerald-400 mt-1 font-mono">{summary.longs}</div>
        </div>
        <div className="quantum-stat rounded-2xl p-3">
          <div className="text-slate-500 text-[10px] font-bold uppercase tracking-wider">🔴 Short</div>
          <div className="text-2xl font-black text-red-400 mt-1 font-mono">{summary.shorts}</div>
        </div>
        <div className="quantum-stat rounded-2xl p-3">
          <div className="text-slate-500 text-[10px] font-bold uppercase tracking-wider">Avg R:R</div>
          <div className="text-2xl font-black text-amber-400 mt-1 font-mono">{summary.avgRR}:1</div>
        </div>
        <div className="quantum-stat rounded-2xl p-3">
          <div className={`text-slate-500 text-[10px] font-bold uppercase tracking-wider`}>AI Score</div>
          <div className={`text-2xl font-black mt-1 font-mono ${sc(summary.avgScore)}`}>{summary.avgScore}</div>
        </div>
        <div className="quantum-stat rounded-2xl p-3">
          <div className="text-slate-500 text-[10px] font-bold uppercase tracking-wider">🐋 Whale</div>
          <div className="text-2xl font-black text-purple-400 mt-1 font-mono">{summary.whaleAlerts}</div>
        </div>
        <div className="quantum-stat rounded-2xl p-3">
          <div className="text-slate-500 text-[10px] font-bold uppercase tracking-wider">MTF Avg</div>
          <div className={`text-2xl font-black mt-1 font-mono ${summary.avgMTF >= 75 ? 'text-emerald-400' : summary.avgMTF >= 50 ? 'text-cyan-400' : 'text-amber-400'}`}>{summary.avgMTF}%</div>
        </div>
      </div>

      {/* Signal Cards */}
      <div className="space-y-3">
        {filtered.map((s, idx) => (
          <div key={s.symbol} className={`trade-signal-card quantum-panel rounded-2xl overflow-hidden border transition-all animate-fade-in-up ${s.direction === 'LONG' ? 'border-emerald-500/20 hover:border-emerald-500/40' : 'border-red-500/20 hover:border-red-500/40'}`} style={{ animationDelay: `${idx * 40}ms` }}>
            {/* Main Row */}
            <div className="p-4 cursor-pointer" onClick={() => setExpandedSignal(expandedSignal === s.symbol ? null : s.symbol)}>
              <div className="flex flex-wrap items-start justify-between gap-3">
                {/* Left */}
                <div className="flex items-center gap-3 min-w-0">
                  <div className={`w-11 h-11 rounded-xl flex items-center justify-center text-lg font-black font-mono border ${s.direction === 'LONG' ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-400' : 'bg-red-500/10 border-red-500/30 text-red-400'}`}>
                    {idx + 1}
                  </div>
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-bold text-white text-sm">{s.symbol}</span>
                      <span className={`px-2 py-0.5 rounded-md text-[9px] font-bold border ${dirBadge[s.signal]}`}>
                        {s.signal.replace('_', ' ')}
                      </span>
                      <span className="text-[9px] text-slate-600 font-mono">
                        {s.market === 'CRYPTO' ? '₿' : s.market === 'IN' ? '🇮🇳' : '🇺🇸'} {s.sector}
                      </span>
                      <span className={`px-1.5 py-0.5 rounded text-[8px] font-bold ${s.timeframe === 'INTRADAY' ? 'bg-orange-500/15 text-orange-400' : s.timeframe === 'SWING_1_3D' ? 'bg-blue-500/15 text-blue-400' : 'bg-purple-500/15 text-purple-400'}`}>
                        {s.timeframe.replace('_', ' ')}
                      </span>
                      {s.smartMoneySignal && s.smartMoneySignal !== 'NONE' && (
                        <span className="px-1.5 py-0.5 rounded text-[8px] font-bold bg-purple-500/20 text-purple-300 border border-purple-500/30 animate-pulse">
                          🐋 {s.smartMoneySignal.replace('_', ' ')}
                        </span>
                      )}
                      {s.coinDcxPair && (
                        <span className="px-1.5 py-0.5 rounded text-[8px] font-bold bg-indigo-500/15 text-indigo-300 border border-indigo-500/20">
                          CoinDCX: {s.coinDcxPair}
                        </span>
                      )}
                    </div>
                    <div className="text-[11px] text-slate-400 truncate">{s.name} • {s.leverage}x leverage</div>
                  </div>
                </div>

                {/* Center: Price */}
                <div className="text-right">
                  <div className={`text-lg font-black font-mono ${s.change >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                    {s.market === 'IN' ? '₹' : '$'}{s.currentPrice.toFixed(2)}
                  </div>
                  <div className={`text-xs font-bold ${s.change >= 0 ? 'text-emerald-500' : 'text-red-500'}`}>
                    {s.change >= 0 ? '▲' : '▼'} {s.change.toFixed(2)}%
                  </div>
                </div>

                {/* Right: AI Score */}
                <div className="text-center">
                  <div className={`text-3xl font-black font-mono ${sc(s.aiScore)}`}>{s.aiScore}</div>
                  <div className="text-[9px] text-slate-600 font-bold uppercase">AI SCORE</div>
                  <div className="w-16 h-1.5 bg-slate-800 rounded-full mt-1 overflow-hidden">
                    <div className={`h-full rounded-full transition-all ${s.aiScore >= 65 ? 'bg-gradient-to-r from-emerald-500 to-cyan-500' : s.aiScore >= 45 ? 'bg-gradient-to-r from-amber-500 to-yellow-500' : 'bg-gradient-to-r from-red-500 to-orange-500'}`} style={{ width: `${s.aiScore}%` }} />
                  </div>
                </div>
              </div>

              {/* Price Ladder + Action */}
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <span className="text-xs font-bold">{s.actionHinglish}</span>
              </div>
              <div className="mt-2 grid grid-cols-2 sm:grid-cols-5 gap-2">
                <div className="bg-cyan-500/5 border border-cyan-500/15 rounded-lg p-2 text-center">
                  <div className="text-[8px] text-cyan-400/80 font-bold uppercase">Entry</div>
                  <div className="text-xs font-black font-mono text-cyan-400">{s.market === 'IN' ? '₹' : '$'}{s.entryPrice.toFixed(2)}</div>
                </div>
                <div className="bg-red-500/5 border border-red-500/15 rounded-lg p-2 text-center">
                  <div className="text-[8px] text-red-400/80 font-bold uppercase">Stop Loss</div>
                  <div className="text-xs font-black font-mono text-red-400">{s.market === 'IN' ? '₹' : '$'}{s.stopLoss.toFixed(2)}</div>
                </div>
                <div className="bg-emerald-500/5 border border-emerald-500/15 rounded-lg p-2 text-center">
                  <div className="text-[8px] text-emerald-400/80 font-bold uppercase">Target 1</div>
                  <div className="text-xs font-black font-mono text-emerald-400">{s.market === 'IN' ? '₹' : '$'}{s.target1.toFixed(2)}</div>
                </div>
                <div className="bg-emerald-500/5 border border-emerald-500/15 rounded-lg p-2 text-center">
                  <div className="text-[8px] text-emerald-400/80 font-bold uppercase">Target 2</div>
                  <div className="text-xs font-black font-mono text-emerald-400">{s.market === 'IN' ? '₹' : '$'}{s.target2.toFixed(2)}</div>
                </div>
                <div className="bg-emerald-500/5 border border-emerald-500/15 rounded-lg p-2 text-center">
                  <div className="text-[8px] text-emerald-400/80 font-bold uppercase">Target 3</div>
                  <div className="text-xs font-black font-mono text-emerald-400">{s.market === 'IN' ? '₹' : '$'}{s.target3.toFixed(2)}</div>
                </div>
              </div>
              <div className="mt-2 flex flex-wrap gap-2">
                <span className="px-2 py-1 rounded-lg bg-amber-500/10 text-amber-400 text-[10px] font-bold border border-amber-500/20">
                  ⚖️ R:R {s.riskReward}:1
                </span>
                <span className="px-2 py-1 rounded-lg bg-emerald-500/10 text-emerald-400 text-[10px] font-bold border border-emerald-500/20">
                  💰 +{s.potentialReturn}%
                </span>
                <span className="px-2 py-1 rounded-lg bg-purple-500/10 text-purple-400 text-[10px] font-bold border border-purple-500/20">
                  🎯 Conv: {s.conviction}%
                </span>
                <span className={`px-2 py-1 rounded-lg text-[10px] font-bold border ${s.riskPercent < 3 ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20' : s.riskPercent < 5 ? 'bg-amber-500/10 text-amber-400 border-amber-500/20' : 'bg-red-500/10 text-red-400 border-red-500/20'}`}>
                  ⚠️ Risk: {s.riskPercent}%
                </span>
                {s.multiTimeframeScore !== undefined && (
                  <span className={`px-2 py-1 rounded-lg text-[10px] font-bold border ${s.multiTimeframeScore >= 75 ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20' : s.multiTimeframeScore >= 50 ? 'bg-cyan-500/10 text-cyan-400 border-cyan-500/20' : 'bg-amber-500/10 text-amber-400 border-amber-500/20'}`}>
                    📊 MTF: {s.mtfAlignment}
                  </span>
                )}
                {s.vwap && (
                  <span className="px-2 py-1 rounded-lg bg-blue-500/10 text-blue-400 text-[10px] font-bold border border-blue-500/20">
                    VWAP: {s.market === 'IN' ? '₹' : '$'}{s.vwap.toFixed(2)}
                  </span>
                )}
              </div>
              {/* Daily Profit Calculator */}
              {s.qty500 && s.qty500 > 0 && (
                <div className="mt-2 bg-gradient-to-r from-emerald-500/10 to-cyan-500/10 border border-emerald-500/20 rounded-xl p-3">
                  <div className="text-[9px] text-emerald-400 font-bold uppercase mb-1">💰 DAILY PROFIT CALCULATOR (₹5000 Capital)</div>
                  <div className="flex flex-wrap gap-3 text-[10px]">
                    <span className="text-emerald-300">₹500 Profit: <strong>{s.qty500} qty</strong> (₹{s.investmentNeeded500?.toLocaleString('en-IN')} needed)</span>
                    <span className="text-cyan-300">₹1000 Profit: <strong>{s.qty1000} qty</strong> (₹{s.investmentNeeded1000?.toLocaleString('en-IN')} needed)</span>
                    <span className={s.investmentNeeded500 && s.investmentNeeded500 <= 5000 ? 'text-emerald-400 font-bold' : 'text-amber-400'}>{s.investmentNeeded500 && s.investmentNeeded500 <= 5000 ? '✅ FEASIBLE' : '⚠️ Need more capital'}</span>
                  </div>
                </div>
              )}
              <div className="mt-2 flex gap-2">
                <button onClick={(e) => { e.stopPropagation(); addActiveTrade(s); }} className="px-3 py-1.5 rounded-lg bg-gradient-to-r from-cyan-600/30 to-blue-600/30 text-cyan-300 text-[10px] font-bold border border-cyan-500/30 hover:border-cyan-400/50 transition-all">
                  ⚡ Enter Trade
                </button>
                {s.aiConsensus !== undefined && s.aiConsensus > 0 && (
                  <span className={`px-2 py-1 rounded-lg text-[10px] font-bold border ${
                    s.aiConsensus >= 75 ? 'bg-emerald-500/15 text-emerald-400 border-emerald-500/20' :
                    s.aiConsensus >= 45 ? 'bg-amber-500/15 text-amber-400 border-amber-500/20' :
                    'bg-red-500/15 text-red-400 border-red-500/20'
                  }`}>🧠 AI Consensus: {s.aiConsensus}%</span>
                )}
              </div>
              </div>

            {/* Expanded */}
            {expandedSignal === s.symbol && (
              <div className="border-t border-white/5 p-4 bg-black/20 animate-fade-in space-y-3">
                {/* Score Breakdown */}
                <div className="grid grid-cols-4 gap-2">
                  {[
                    { label: 'Technical', score: s.technicalScore, color: 'bg-cyan-500', w: '40%' },
                    { label: 'Momentum', score: s.momentumScore, color: 'bg-emerald-500', w: '30%' },
                    { label: 'Volatility', score: s.volatilityScore, color: 'bg-orange-500', w: '20%' },
                    { label: 'Sentiment', score: s.sentimentScore, color: 'bg-blue-500', w: '10%' },
                  ].map(f => (
                    <div key={f.label}>
                      <div className="flex justify-between text-[9px] mb-1">
                        <span className="text-slate-500">{f.label} ({f.w})</span>
                        <span className={sc(f.score)}>{f.score}</span>
                      </div>
                      <div className="w-full h-1.5 bg-slate-800 rounded-full overflow-hidden">
                        <div className={`h-full ${f.color} rounded-full transition-all`} style={{ width: `${f.score}%` }} />
                      </div>
                    </div>
                  ))}
                </div>

                {/* Advanced Indicators */}
                <div className="grid grid-cols-3 sm:grid-cols-6 gap-2">
                  {[
                    { label: 'RSI', value: s.rsi.toFixed(1), color: s.rsi < 35 ? 'text-emerald-400' : s.rsi > 65 ? 'text-red-400' : 'text-cyan-400' },
                    { label: 'StochRSI', value: s.stochRsi?.toFixed(0) || 'N/A', color: (s.stochRsi || 50) < 30 ? 'text-emerald-400' : (s.stochRsi || 50) > 70 ? 'text-red-400' : 'text-cyan-400' },
                    { label: 'ADX', value: s.adx?.toFixed(0) || 'N/A', color: (s.adx || 0) > 30 ? 'text-emerald-400' : 'text-amber-400' },
                    { label: 'MACD', value: s.macd.toFixed(2), color: s.macd > 0 ? 'text-emerald-400' : 'text-red-400' },
                    { label: 'Ichimoku', value: s.ichimokuSignal?.replace('_', ' ') || 'N/A', color: s.ichimokuSignal === 'ABOVE_CLOUD' ? 'text-emerald-400' : s.ichimokuSignal === 'BELOW_CLOUD' ? 'text-red-400' : 'text-amber-400' },
                    { label: 'Supertrend', value: s.supertrend || 'N/A', color: s.supertrend === 'BUY' ? 'text-emerald-400' : 'text-red-400' },
                  ].map(i => (
                    <div key={i.label} className="bg-black/30 rounded-lg p-2 text-center">
                      <div className="text-[9px] text-slate-500 font-bold">{i.label}</div>
                      <div className={`text-sm font-black font-mono ${i.color}`}>{i.value}</div>
                    </div>
                  ))}
                </div>
                <div className="grid grid-cols-3 sm:grid-cols-6 gap-2">
                  {[
                    { label: 'OBV', value: s.obvTrend || 'N/A', color: s.obvTrend === 'BULLISH' ? 'text-emerald-400' : s.obvTrend === 'BEARISH' ? 'text-red-400' : 'text-slate-400' },
                    { label: 'EMA Cross', value: s.emaCross || 'NONE', color: s.emaCross === 'GOLDEN' ? 'text-emerald-400' : s.emaCross === 'DEATH' ? 'text-red-400' : 'text-slate-400' },
                    { label: 'ATR', value: s.atr.toFixed(2), color: 'text-amber-400' },
                    { label: 'BB Width', value: s.bbWidth.toFixed(1) + '%', color: 'text-purple-400' },
                    { label: 'SMA20', value: s.sma20.toFixed(1), color: s.currentPrice > s.sma20 ? 'text-emerald-400' : 'text-red-400' },
                    { label: 'Volume', value: s.volume > 1e6 ? `${(s.volume / 1e6).toFixed(1)}M` : `${(s.volume / 1e3).toFixed(0)}K`, color: 'text-cyan-400' },
                  ].map(i => (
                    <div key={i.label} className="bg-black/30 rounded-lg p-2 text-center">
                      <div className="text-[9px] text-slate-500 font-bold">{i.label}</div>
                      <div className={`text-sm font-black font-mono ${i.color}`}>{i.value}</div>
                    </div>
                  ))}
                </div>

                {/* Multi-AI Consensus Panel */}
                <div className="bg-gradient-to-r from-purple-500/5 via-cyan-500/5 to-blue-500/5 rounded-xl p-3 border border-purple-500/20">
                  <div className="text-[10px] text-purple-400 font-bold uppercase mb-2">🧠 MULTI-AI CONSENSUS ({s.aiConsensusLabel || 'PENDING'})</div>
                  <div className="grid grid-cols-3 gap-2 mb-2">
                    <div className="bg-black/30 rounded-lg p-2">
                      <div className="text-[8px] text-orange-400 font-bold">GROQ (Llama 3.3)</div>
                      <div className="text-[10px] text-slate-300 mt-1">{s.groqAnalysis ? s.groqAnalysis.substring(0, 80) + '...' : '⏳ Pending...'}</div>
                    </div>
                    <div className="bg-black/30 rounded-lg p-2">
                      <div className="text-[8px] text-blue-400 font-bold">GEMINI 3.5 Flash</div>
                      <div className="text-[10px] text-slate-300 mt-1">{s.geminiAnalysis ? s.geminiAnalysis.substring(0, 80) + '...' : '⏳ Pending...'}</div>
                    </div>
                    <div className="bg-black/30 rounded-lg p-2">
                      <div className="text-[8px] text-violet-400 font-bold">CLAUDE / SMC Analyst</div>
                      <div className="text-[10px] text-slate-300 mt-1">{s.claudeAnalysis ? s.claudeAnalysis.substring(0, 80) + '...' : '⏳ Pending...'}</div>
                    </div>
                  </div>
                  {s.aiConsensus !== undefined && s.aiConsensus > 0 && (
                    <div className="flex items-center gap-2">
                      <div className="flex-1 h-2 bg-slate-800 rounded-full overflow-hidden">
                        <div className={`h-full rounded-full transition-all ${s.aiConsensus >= 75 ? 'bg-gradient-to-r from-emerald-500 to-cyan-500' : s.aiConsensus >= 45 ? 'bg-gradient-to-r from-amber-500 to-yellow-500' : 'bg-gradient-to-r from-red-500 to-orange-500'}`} style={{ width: `${s.aiConsensus}%` }} />
                      </div>
                      <span className={`text-xs font-black font-mono ${s.aiConsensus >= 75 ? 'text-emerald-400' : s.aiConsensus >= 45 ? 'text-amber-400' : 'text-red-400'}`}>{s.aiConsensus}%</span>
                    </div>
                  )}
                </div>

                {/* AI Reasoning */}
                <div className="bg-black/30 rounded-xl p-3 border border-white/5">
                  <div className="text-[10px] text-slate-500 font-bold uppercase mb-1">🤖 AI Reasoning</div>
                  <div className="text-xs text-slate-300">{s.reasoningHinglish}</div>
                </div>
              </div>
            )}
          </div>
        ))}
      </div>

      {/* Empty State */}
      {filtered.length === 0 && !isScanning && (
        <div className="quantum-panel rounded-2xl p-12 text-center animate-fade-in">
          <div className="text-4xl mb-3 animate-float">⚡</div>
          <div className="text-slate-400 font-medium">No trade signals found</div>
          <div className="text-xs text-slate-600 mt-1">Click Re-Scan to fetch live data</div>
        </div>
      )}

      {/* Active Trades & Journal */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 animate-fade-in-up">
        {/* Active Trades Tracker — LIVE */}
        <div className="quantum-panel rounded-2xl p-4 border border-cyan-500/10">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-sm font-bold text-white uppercase tracking-wider">🟢 Active Trades ({activeTrades.length})</h3>
            <span className="text-[10px] text-slate-500 font-mono">Live P&L</span>
          </div>
          {activeTrades.length === 0 ? (
            <div className="text-center py-6 text-slate-600 text-xs">No active trades — Click ⚡ Enter Trade on a signal</div>
          ) : (
            <div className="space-y-2 max-h-60 overflow-y-auto">
              {activeTrades.slice(0, 8).map(t => {
                const key = `${t.market}_${t.symbol}`;
                const livePrice = livePrices[key]?.price || t.entryPrice;
                const pnlPct = ((livePrice - t.entryPrice) / t.entryPrice) * 100 * (t.direction === 'LONG' ? 1 : -1);
                const pnlVal = (livePrice - t.entryPrice) * t.quantity * (t.direction === 'LONG' ? 1 : -1);
                return (
                  <div key={t.id} className="bg-black/30 rounded-xl p-3 border border-white/5 flex items-center justify-between">
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="font-bold text-sm text-white">{t.symbol}</span>
                        <span className={`text-[9px] px-1.5 py-0.5 rounded font-bold ${t.direction === 'LONG' ? 'bg-emerald-500/20 text-emerald-400' : 'bg-red-500/20 text-red-400'}`}>{t.direction} {t.leverage}x</span>
                        {t.platform && <span className="text-[8px] text-slate-600">{t.platform}</span>}
                        {t.pair && <span className="text-[8px] text-indigo-400">{t.pair}</span>}
                      </div>
                      <div className="text-[10px] text-slate-500 mt-1">Entry: ${t.entryPrice.toFixed(2)} → ${livePrice.toFixed(2)}</div>
                    </div>
                    <div className="text-right flex items-center gap-2">
                      <div>
                        <div className={`text-sm font-black font-mono ${pnlVal >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>{pnlVal >= 0 ? '+' : ''}{pnlVal.toFixed(1)}</div>
                        <div className={`text-[10px] font-bold ${pnlPct >= 0 ? 'text-emerald-500' : 'text-red-500'}`}>{pnlPct >= 0 ? '+' : ''}{pnlPct.toFixed(1)}%</div>
                      </div>
                      <button onClick={() => closeTrade(t, livePrice)} className="w-6 h-6 rounded bg-red-500/20 text-red-400 text-[10px] font-bold hover:bg-red-500/40 transition-all" title="Close Trade">✕</button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Trade Journal — Persistent Analytics */}
        <div className="quantum-panel rounded-2xl p-4 border border-purple-500/10">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-sm font-bold text-white uppercase tracking-wider">📔 Trade Journal ({journal.length})</h3>
            <div className="flex gap-2 text-[10px] font-mono">
              <span className={journalStats.winRate >= 60 ? 'text-emerald-400' : journalStats.winRate >= 40 ? 'text-amber-400' : 'text-red-400'}>WR: {journalStats.winRate}%</span>
              <span className={journalStats.totalPnl >= 0 ? 'text-emerald-400' : 'text-red-400'}>P&L: {journalStats.totalPnl >= 0 ? '+' : ''}{journalStats.totalPnl}</span>
            </div>
          </div>
          {journal.length === 0 ? (
            <div className="text-center py-6 text-slate-600 text-xs">No completed trades yet</div>
          ) : (
            <>
              <div className="grid grid-cols-4 gap-2 mb-3">
                <div className="bg-emerald-500/10 rounded-lg p-2 text-center"><div className="text-[9px] text-emerald-400 font-bold">WINS</div><div className="text-lg font-black text-emerald-400 font-mono">{journalStats.wins}</div></div>
                <div className="bg-red-500/10 rounded-lg p-2 text-center"><div className="text-[9px] text-red-400 font-bold">LOSSES</div><div className="text-lg font-black text-red-400 font-mono">{journalStats.losses}</div></div>
                <div className="bg-amber-500/10 rounded-lg p-2 text-center"><div className="text-[9px] text-amber-400 font-bold">AVG R:R</div><div className="text-lg font-black text-amber-400 font-mono">{journalStats.avgRR}</div></div>
                <div className={`rounded-lg p-2 text-center ${journalStats.totalPnl >= 0 ? 'bg-emerald-500/10' : 'bg-red-500/10'}`}><div className="text-[9px] text-slate-400 font-bold">TOTAL</div><div className={`text-lg font-black font-mono ${journalStats.totalPnl >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>{journalStats.totalPnl >= 0 ? '+' : ''}{journalStats.totalPnl}</div></div>
              </div>
              <div className="space-y-2 max-h-40 overflow-y-auto">
                {journal.slice(0, 6).map(t => (
                  <div key={t.id} className="bg-black/30 rounded-xl p-3 border border-white/5 flex items-center justify-between">
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="font-bold text-sm text-white">{t.symbol}</span>
                        <span className={`text-[9px] px-1.5 py-0.5 rounded font-bold ${t.result === 'WIN' ? 'bg-emerald-500/20 text-emerald-400' : 'bg-red-500/20 text-red-400'}`}>{t.result}</span>
                        {t.platform && <span className="text-[8px] text-slate-600">{t.platform}</span>}
                      </div>
                      <div className="text-[10px] text-slate-500 mt-1">{new Date(t.exitTime).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}</div>
                    </div>
                    <div className={`text-sm font-black font-mono ${t.pnl >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>{t.pnl >= 0 ? '+' : ''}{t.pnlPercent}%</div>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      </div>

      {/* Risk Calculator */}
      <div className="quantum-panel rounded-2xl p-4 animate-fade-in-up">
        <div className="text-[10px] text-slate-500 font-bold uppercase mb-3">⚙️ Risk Calculator</div>
        <div className="flex flex-wrap gap-4 items-end">
          <div>
            <label className="text-[9px] text-slate-500 font-bold uppercase block mb-1">Capital (₹)</label>
            <input type="number" value={riskCapital} onChange={e => setRiskCapital(Number(e.target.value))} className="w-32 px-3 py-1.5 quantum-input rounded-lg text-sm font-mono text-white" />
          </div>
          <div>
            <label className="text-[9px] text-slate-500 font-bold uppercase block mb-1">Risk/Trade %</label>
            <input type="number" value={riskPerTrade} onChange={e => setRiskPerTrade(Number(e.target.value))} className="w-20 px-3 py-1.5 quantum-input rounded-lg text-sm font-mono text-white" step="0.5" min="0.5" max="10" />
          </div>
          <div className="text-[10px] text-slate-400">
            Max Loss/Trade: <span className="text-amber-400 font-bold">₹{Math.round(riskCapital * riskPerTrade / 100).toLocaleString('en-IN')}</span>
          </div>
        </div>
      </div>

      {/* Legend */}
      <div className="quantum-panel rounded-2xl p-4 animate-fade-in-up">
        <div className="text-[10px] text-slate-500 font-bold uppercase mb-2">⚡ Deep Quantum AI — Pro Trading Methodology</div>
        <div className="flex flex-wrap gap-3 text-[10px] text-slate-400">
          <span><span className="text-cyan-400 font-bold">35%</span> Technical (RSI, StochRSI, SMA, MACD, Ichimoku)</span>
          <span><span className="text-emerald-400 font-bold">25%</span> Momentum (Change, ADX, OBV, EMA Cross)</span>
          <span><span className="text-orange-400 font-bold">15%</span> Volatility (ATR, BB, Supertrend)</span>
          <span><span className="text-blue-400 font-bold">10%</span> Sentiment (VIX, Fear/Greed)</span>
          <span><span className="text-purple-400 font-bold">15%</span> AI Consensus (Groq + Gemini + Claude)</span>
        </div>
        <div className="flex flex-wrap gap-3 text-[10px] text-slate-400 mt-1">
          <span>🐋 Smart Money Detection</span>
          <span>📊 Multi-Timeframe Confluence</span>
          <span>📐 Fibonacci Pivots</span>
          <span>☁️ Ichimoku Cloud</span>
          <span>📈 Supertrend</span>
          <span>💱 CoinDCX USDC/INR</span>
          <span>📱 INDmoney</span>
        </div>
        <div className="mt-2 text-[9px] text-slate-600 font-mono">
          Capital: ₹5,000 | Daily Target: ₹500-₹1000 | Groq + Gemini + Claude | 55+ Assets | Auto-scan: 60s | R:R ≥ 2.0:1
        </div>
      </div>
    </div>
  );
});
