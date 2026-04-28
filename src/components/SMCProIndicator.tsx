import { useState, useEffect, useRef } from 'react';
import { PriceData, Position } from '../types';
import { analyzeAllSMC, getSessionStatus, SMCAnalysisResult } from '../utils/smcEngine';

interface SMCProIndicatorProps {
  livePrices: Record<string, PriceData>;
  portfolio: Position[];
}

export function SMCProIndicator({ livePrices, portfolio }: SMCProIndicatorProps) {
  const [results, setResults] = useState<SMCAnalysisResult[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [expandedCard, setExpandedCard] = useState<string | null>(null);
  const [filterSignal, setFilterSignal] = useState<string>('ALL');
  const lastComputeRef = useRef(0);
  const initialRef = useRef(true);

  useEffect(() => {
    const now = Date.now();
    if (!initialRef.current && now - lastComputeRef.current < 8000) return;
    if (initialRef.current) { setIsLoading(true); initialRef.current = false; }

    const t = setTimeout(() => {
      const positions = portfolio.length > 0 ? portfolio : [
        'IN_NIFTY', 'US_SPY', 'US_QQQ', 'IN_BANKNIFTY', 'US_AAPL', 'US_TSLA'
      ].map(s => {
        const [m, sym] = s.split('_') as ['IN' | 'US', string];
        return { id: s, symbol: sym, market: m, qty: 1, avgPrice: livePrices[s]?.price || 100, leverage: 1, dateAdded: '' };
      });
      setResults(analyzeAllSMC(positions, livePrices));
      setIsLoading(false);
      lastComputeRef.current = Date.now();
    }, isLoading ? 600 : 100);
    return () => clearTimeout(t);
  }, [livePrices, portfolio]);

  const session = getSessionStatus();

  const getSignalColor = (s: string) => {
    if (s === 'STRONG_BUY') return 'text-emerald-400 bg-emerald-500/10 border-emerald-500/30';
    if (s === 'BUY') return 'text-cyan-400 bg-cyan-500/10 border-cyan-500/30';
    if (s === 'SELL') return 'text-orange-400 bg-orange-500/10 border-orange-500/30';
    if (s === 'STRONG_SELL') return 'text-red-400 bg-red-500/10 border-red-500/30';
    return 'text-amber-400 bg-amber-500/10 border-amber-500/30';
  };

  const getBiasColor = (b: string) => b === 'Bullish' ? 'text-emerald-400' : b === 'Bearish' ? 'text-red-400' : 'text-slate-400';
  const getTrendBadge = (l: string) => l === 'Bullish' ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20' : l === 'Bearish' ? 'bg-red-500/10 text-red-400 border-red-500/20' : l === 'Ranging' ? 'bg-amber-500/10 text-amber-400 border-amber-500/20' : 'bg-slate-500/10 text-slate-400 border-slate-500/20';

  const filtered = filterSignal === 'ALL' ? results : results.filter(r => {
    if (filterSignal === 'BUY') return r.signal.signal.includes('BUY');
    if (filterSignal === 'SELL') return r.signal.signal.includes('SELL');
    return r.signal.signal === 'HOLD';
  });

  const buyCount = results.filter(r => r.signal.signal.includes('BUY')).length;
  const sellCount = results.filter(r => r.signal.signal.includes('SELL')).length;
  const avgScore = results.length > 0 ? Math.round(results.reduce((s, r) => s + r.smcScore, 0) / results.length) : 0;
  const avgConf = results.length > 0 ? Math.round(results.reduce((s, r) => s + r.signal.confidence, 0) / results.length) : 0;

  return (
    <div className="space-y-6 animate-fade-in">
      {/* Header Dashboard */}
      <div className="glass-card rounded-2xl p-6 border border-cyan-500/20" style={{ background: 'linear-gradient(135deg, rgba(6,182,212,0.05) 0%, rgba(99,102,241,0.05) 50%, rgba(168,85,247,0.05) 100%)' }}>
        <div className="flex items-center justify-between mb-5">
          <div className="flex items-center gap-4">
            <div className="w-14 h-14 rounded-xl bg-gradient-to-br from-cyan-500/20 via-indigo-500/20 to-purple-500/20 flex items-center justify-center border border-cyan-500/30 relative">
              <span className="text-3xl">🏦</span>
              <div className="absolute -top-1 -right-1 w-3 h-3 rounded-full bg-cyan-400 animate-pulse" />
            </div>
            <div>
              <h2 className="text-2xl font-black font-display" style={{ background: 'linear-gradient(135deg, #06b6d4, #8b5cf6, #ec4899)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>
                SMC PRO INDICATOR
              </h2>
              <p className="text-xs text-slate-500 mt-1">Smart Money Concepts • Institutional Grade Analysis • All Assets</p>
            </div>
          </div>
          <div className="text-right hidden sm:block">
            <div className="text-xs text-slate-500 uppercase tracking-wider">Session</div>
            <div className="text-lg font-black text-white">{session.icon} {session.name}</div>
            <div className={`text-[10px] font-bold ${session.isKillZone ? 'text-emerald-400' : 'text-slate-600'}`}>
              {session.isKillZone ? '● KILL ZONE ACTIVE' : '○ OFF SESSION'}
            </div>
          </div>
        </div>

        {/* Stats Row */}
        <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
          <div className="bg-black/30 rounded-xl p-3 border border-white/5">
            <div className="text-[10px] text-slate-500 uppercase tracking-wider">SMC Score</div>
            <div className="text-2xl font-black text-cyan-400 font-mono mt-1">{avgScore}</div>
            <div className="text-[10px] text-slate-600">Portfolio Avg</div>
          </div>
          <div className="bg-black/30 rounded-xl p-3 border border-white/5">
            <div className="text-[10px] text-slate-500 uppercase tracking-wider">Buy Signals</div>
            <div className="text-2xl font-black text-emerald-400 font-mono mt-1">{buyCount}</div>
            <div className="text-[10px] text-slate-600">Accumulate</div>
          </div>
          <div className="bg-black/30 rounded-xl p-3 border border-white/5">
            <div className="text-[10px] text-slate-500 uppercase tracking-wider">Sell Signals</div>
            <div className="text-2xl font-black text-red-400 font-mono mt-1">{sellCount}</div>
            <div className="text-[10px] text-slate-600">Distribute</div>
          </div>
          <div className="bg-black/30 rounded-xl p-3 border border-white/5">
            <div className="text-[10px] text-slate-500 uppercase tracking-wider">Confidence</div>
            <div className="text-2xl font-black text-white font-mono mt-1">{avgConf}%</div>
            <div className="text-[10px] text-slate-600">AI Average</div>
          </div>
          <div className="bg-black/30 rounded-xl p-3 border border-white/5">
            <div className="text-[10px] text-slate-500 uppercase tracking-wider">Assets</div>
            <div className="text-2xl font-black text-indigo-400 font-mono mt-1">{results.length}</div>
            <div className="text-[10px] text-slate-600">Analyzed</div>
          </div>
        </div>
      </div>

      {/* Filter Tabs */}
      <div className="flex gap-2 glass-card p-1.5 rounded-xl">
        {['ALL', 'BUY', 'SELL', 'HOLD'].map(f => (
          <button key={f} onClick={() => setFilterSignal(f)}
            className={`px-4 py-2 rounded-lg text-xs font-bold transition-all ${filterSignal === f
              ? f === 'BUY' ? 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/30'
                : f === 'SELL' ? 'bg-red-500/15 text-red-400 border border-red-500/30'
                  : f === 'HOLD' ? 'bg-amber-500/15 text-amber-400 border border-amber-500/30'
                    : 'bg-cyan-500/15 text-cyan-400 border border-cyan-500/30'
              : 'text-slate-500 hover:text-white hover:bg-white/5'}`}
          >
            {f === 'ALL' ? `ALL (${results.length})` : f === 'BUY' ? `🟢 BUY (${buyCount})` : f === 'SELL' ? `🔴 SELL (${sellCount})` : `🟡 HOLD (${results.length - buyCount - sellCount})`}
          </button>
        ))}
      </div>

      {/* Asset Cards */}
      {isLoading ? (
        <div className="glass-card rounded-2xl p-16 text-center">
          <div className="text-6xl mb-4 animate-spin">🏦</div>
          <div className="text-cyan-400 font-bold text-lg">SMC PRO ENGINE ANALYZING...</div>
          <div className="text-slate-500 text-sm mt-2">Processing market structure for all assets</div>
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {filtered.map((r, idx) => {
            const isExpanded = expandedCard === r.symbol;
            const cur = r.market === 'IN' ? '₹' : '$';
            const cardBorder = r.signal.signal.includes('BUY') ? 'border-emerald-500/25 hover:border-emerald-500/40' : r.signal.signal.includes('SELL') ? 'border-red-500/25 hover:border-red-500/40' : 'border-slate-700/40 hover:border-slate-500/40';

            return (
              <div key={r.symbol} className={`glass-card rounded-2xl border transition-all duration-300 ${cardBorder} ${isExpanded ? 'lg:col-span-2' : ''}`}
                style={{ animationDelay: `${idx * 80}ms` }}>

                {/* Card Header */}
                <div className="p-5 cursor-pointer" onClick={() => setExpandedCard(isExpanded ? null : r.symbol)}>
                  <div className="flex items-start justify-between mb-3">
                    <div className="flex items-center gap-3">
                      <div className={`w-10 h-10 rounded-xl flex items-center justify-center text-lg font-black border ${r.signal.signal.includes('BUY') ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-400' : r.signal.signal.includes('SELL') ? 'bg-red-500/10 border-red-500/30 text-red-400' : 'bg-slate-800 border-slate-600 text-slate-300'}`}>
                        {r.smcScore}
                      </div>
                      <div>
                        <div className="flex items-center gap-2">
                          <h3 className="text-lg font-black text-white">{r.symbol}</h3>
                          <span className="text-[10px] text-slate-600 font-mono">{r.market}</span>
                        </div>
                        <div className="flex items-center gap-2 mt-0.5">
                          <span className="text-sm font-mono text-white">{cur}{r.price.toFixed(2)}</span>
                          <span className={`text-xs font-bold ${r.change >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                            {r.change >= 0 ? '+' : ''}{r.change.toFixed(2)}%
                          </span>
                        </div>
                      </div>
                    </div>
                    <div className="flex flex-col items-end gap-1">
                      <span className={`px-3 py-1 rounded-full text-xs font-black border ${getSignalColor(r.signal.signal)}`}>
                        {r.signal.signal.replace('_', ' ')}
                      </span>
                      <span className="text-[10px] text-slate-500">{r.signal.confidence}% conf</span>
                    </div>
                  </div>

                  {/* Quick Info Row */}
                  <div className="grid grid-cols-4 gap-2">
                    <div className="bg-black/20 rounded-lg p-2 text-center">
                      <div className="text-[9px] text-slate-500 uppercase">Structure</div>
                      <div className={`text-xs font-black ${r.structure.trendBias === 1 ? 'text-emerald-400' : r.structure.trendBias === -1 ? 'text-red-400' : 'text-slate-400'}`}>
                        {r.structure.lastHighType}/{r.structure.lastLowType}
                      </div>
                    </div>
                    <div className="bg-black/20 rounded-lg p-2 text-center">
                      <div className="text-[9px] text-slate-500 uppercase">HTF Bias</div>
                      <div className={`text-xs font-black ${getBiasColor(r.htfBias)}`}>{r.htfBias}</div>
                    </div>
                    <div className="bg-black/20 rounded-lg p-2 text-center">
                      <div className="text-[9px] text-slate-500 uppercase">Trend</div>
                      <div className={`text-xs font-black px-1 rounded ${getTrendBadge(r.trendFilter.label)}`}>{r.trendFilter.label}</div>
                    </div>
                    <div className="bg-black/20 rounded-lg p-2 text-center">
                      <div className="text-[9px] text-slate-500 uppercase">Confluence</div>
                      <div className="text-xs font-black text-cyan-400">{r.confluenceCount}/8</div>
                    </div>
                  </div>
                </div>

                {/* Pro Trader Levels Bar */}
                <div className="px-5 pb-3">
                  <div className="flex items-center gap-3 text-[10px]">
                    <div className="flex items-center gap-1">
                      <span className="w-2 h-2 rounded-full bg-red-500" />
                      <span className="text-slate-500">SL:</span>
                      <span className="text-red-400 font-mono font-bold">{cur}{r.levels.stopLoss.toFixed(2)}</span>
                    </div>
                    <div className="flex-1 relative h-1.5 bg-slate-800 rounded-full overflow-hidden">
                      <div className="absolute left-0 top-0 h-full bg-gradient-to-r from-red-500 via-amber-500 to-emerald-500 rounded-full" style={{ width: '100%', opacity: 0.3 }} />
                      <div className="absolute top-0 h-full w-1 bg-cyan-400 rounded-full" style={{
                        left: `${Math.min(95, Math.max(5, ((r.price - r.levels.stopLoss) / (r.levels.takeProfit - r.levels.stopLoss)) * 100))}%`
                      }} />
                    </div>
                    <div className="flex items-center gap-1">
                      <span className="text-slate-500">TP:</span>
                      <span className="text-emerald-400 font-mono font-bold">{cur}{r.levels.takeProfit.toFixed(2)}</span>
                      <span className="w-2 h-2 rounded-full bg-emerald-500" />
                    </div>
                    <span className="text-cyan-400 font-bold">R:R {r.levels.riskReward.toFixed(1)}</span>
                  </div>
                </div>

                {/* Expanded Details */}
                {isExpanded && (
                  <div className="px-5 pb-5 border-t border-white/5 pt-4 animate-fade-in">
                    <div className={`grid ${isExpanded ? 'md:grid-cols-3' : 'grid-cols-1'} gap-4`}>
                      {/* Structure Details */}
                      <div className="bg-black/20 rounded-xl p-4">
                        <h4 className="text-xs font-bold text-white mb-3 flex items-center gap-2">
                          <span className="w-5 h-5 rounded bg-cyan-500/20 flex items-center justify-center text-[10px]">📊</span>
                          Market Structure
                        </h4>
                        <div className="space-y-2 text-xs">
                          <div className="flex justify-between"><span className="text-slate-500">Swing High:</span><span className={`font-bold ${r.structure.lastHighType === 'HH' ? 'text-emerald-400' : 'text-red-400'}`}>{r.structure.lastHighType}</span></div>
                          <div className="flex justify-between"><span className="text-slate-500">Swing Low:</span><span className={`font-bold ${r.structure.lastLowType === 'HL' ? 'text-emerald-400' : 'text-red-400'}`}>{r.structure.lastLowType}</span></div>
                          <div className="flex justify-between"><span className="text-slate-500">Trend Bias:</span><span className={`font-bold ${r.structure.trendBias === 1 ? 'text-emerald-400' : r.structure.trendBias === -1 ? 'text-red-400' : 'text-amber-400'}`}>{r.structure.trendBias === 1 ? 'BULLISH' : r.structure.trendBias === -1 ? 'BEARISH' : 'NEUTRAL'}</span></div>
                          <div className="flex justify-between"><span className="text-slate-500">BOS:</span><span className={`font-bold ${r.hasBOS ? 'text-amber-400' : 'text-slate-600'}`}>{r.hasBOS ? `${r.bosType} BOS ✓` : 'None'}</span></div>
                          <div className="flex justify-between"><span className="text-slate-500">CHoCH:</span><span className={`font-bold ${r.hasCHoCH ? 'text-purple-400' : 'text-slate-600'}`}>{r.hasCHoCH ? `${r.chochType} CHoCH ✓` : 'None'}</span></div>
                          <div className="flex justify-between"><span className="text-slate-500">Bull Sweep:</span><span className={r.bullSweep ? 'text-emerald-400 font-bold' : 'text-slate-600'}>{r.bullSweep ? 'DETECTED ✓' : '—'}</span></div>
                          <div className="flex justify-between"><span className="text-slate-500">Bear Sweep:</span><span className={r.bearSweep ? 'text-red-400 font-bold' : 'text-slate-600'}>{r.bearSweep ? 'DETECTED ✓' : '—'}</span></div>
                        </div>
                      </div>

                      {/* Zones & Levels */}
                      <div className="bg-black/20 rounded-xl p-4">
                        <h4 className="text-xs font-bold text-white mb-3 flex items-center gap-2">
                          <span className="w-5 h-5 rounded bg-indigo-500/20 flex items-center justify-center text-[10px]">🎯</span>
                          Pro Trader Levels
                        </h4>
                        <div className="space-y-2 text-xs">
                          <div className="flex justify-between"><span className="text-slate-500">Entry:</span><span className="text-cyan-400 font-mono font-bold">{cur}{r.levels.entry.toFixed(2)}</span></div>
                          <div className="flex justify-between"><span className="text-slate-500">Stop Loss:</span><span className="text-red-400 font-mono font-bold">{cur}{r.levels.stopLoss.toFixed(2)}</span></div>
                          <div className="flex justify-between"><span className="text-slate-500">Take Profit:</span><span className="text-emerald-400 font-mono font-bold">{cur}{r.levels.takeProfit.toFixed(2)}</span></div>
                          <div className="flex justify-between"><span className="text-slate-500">Risk:Reward:</span><span className="text-cyan-400 font-bold">{r.levels.riskReward.toFixed(2)}</span></div>
                          <div className="flex justify-between"><span className="text-slate-500">Risk Amt:</span><span className="text-red-300 font-mono">{cur}{r.levels.riskAmount.toFixed(2)}</span></div>
                          <div className="flex justify-between"><span className="text-slate-500">Reward Amt:</span><span className="text-emerald-300 font-mono">{cur}{r.levels.rewardAmount.toFixed(2)}</span></div>
                          <div className="mt-2 pt-2 border-t border-white/5">
                            <div className="text-[10px] text-slate-500">Order Blocks: <span className="text-white font-bold">{r.orderBlocks.length}</span> active</div>
                            <div className="text-[10px] text-slate-500">Fair Value Gaps: <span className="text-white font-bold">{r.fvgs.length}</span> detected</div>
                          </div>
                        </div>
                      </div>

                      {/* AI Reasoning */}
                      <div className="bg-black/20 rounded-xl p-4">
                        <h4 className="text-xs font-bold text-white mb-3 flex items-center gap-2">
                          <span className="w-5 h-5 rounded bg-purple-500/20 flex items-center justify-center text-[10px]">🧠</span>
                          AI Confluence Analysis
                        </h4>
                        <div className="space-y-1.5 max-h-[200px] overflow-y-auto">
                          {r.signal.reasoning.map((reason, i) => (
                            <div key={i} className="flex items-start gap-1.5 text-[11px]">
                              <span className="text-cyan-500 mt-0.5 flex-shrink-0">•</span>
                              <span className="text-slate-300">{reason}</span>
                            </div>
                          ))}
                        </div>
                        {/* Confluence Meter */}
                        <div className="mt-3 pt-3 border-t border-white/5">
                          <div className="flex items-center justify-between text-[10px] mb-1">
                            <span className="text-slate-500">Confluence Meter</span>
                            <span className="text-cyan-400 font-bold">{r.confluenceCount}/8</span>
                          </div>
                          <div className="flex gap-0.5">
                            {Array.from({ length: 8 }).map((_, i) => (
                              <div key={i} className={`h-1.5 flex-1 rounded-full transition-all ${i < r.confluenceCount
                                ? r.confluenceCount >= 6 ? 'bg-emerald-500' : r.confluenceCount >= 4 ? 'bg-cyan-500' : 'bg-amber-500'
                                : 'bg-slate-800'}`} />
                            ))}
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                )}

                {/* Expand hint */}
                <div className="px-5 pb-3 flex justify-center">
                  <button onClick={() => setExpandedCard(isExpanded ? null : r.symbol)} className="text-[10px] text-slate-600 hover:text-slate-400 transition-colors">
                    {isExpanded ? '▲ Collapse' : '▼ Expand Full Analysis'}
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Portfolio SMC Summary */}
      {results.length > 0 && (
        <div className="glass-card rounded-2xl p-5 border border-indigo-500/20" style={{ background: 'linear-gradient(135deg, rgba(99,102,241,0.05) 0%, rgba(168,85,247,0.05) 100%)' }}>
          <div className="flex items-start gap-3">
            <span className="text-2xl">🏦</span>
            <div className="flex-1">
              <div className="font-bold text-white mb-2">SMC Pro Portfolio Summary</div>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-xs">
                <div>
                  <span className="text-slate-500">Bullish Structure: </span>
                  <span className="text-emerald-400 font-bold">{results.filter(r => r.structure.trendBias === 1).length} assets</span>
                </div>
                <div>
                  <span className="text-slate-500">Bearish Structure: </span>
                  <span className="text-red-400 font-bold">{results.filter(r => r.structure.trendBias === -1).length} assets</span>
                </div>
                <div>
                  <span className="text-slate-500">Trend Confirmed: </span>
                  <span className="text-cyan-400 font-bold">{results.filter(r => r.trendFilter.trendConfirmed).length} assets</span>
                </div>
                <div>
                  <span className="text-slate-500">Ranging (No Trade): </span>
                  <span className="text-amber-400 font-bold">{results.filter(r => r.trendFilter.isRanging).length} assets</span>
                </div>
              </div>
              <div className="text-[10px] text-slate-600 mt-3 italic">
                Based on Smart Money Concepts: Market Structure, BOS/CHoCH, Liquidity Sweeps, Order Blocks, FVGs, HTF Bias, AlgoAlpha Kalman+Supertrend Filter
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Disclaimer */}
      <div className="glass-card rounded-2xl p-4 border-amber-500/20">
        <div className="flex items-start gap-3">
          <span className="text-xl">⚠️</span>
          <div className="text-xs text-slate-400">
            <span className="font-bold text-amber-400">SMC Pro Disclaimer: </span>
            Ye indicator institutional Smart Money Concepts pe based hai. Pine Script prompts se ported logic use hota hai.
            Always DYOR — ye financial advice nahi hai. Risk management follow karo aur apna SL set karo.
          </div>
        </div>
      </div>
    </div>
  );
}
