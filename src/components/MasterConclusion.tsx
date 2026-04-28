import { useState, useEffect, useRef } from 'react';
import { Position, PriceData } from '../types';
import {
  generateMasterConclusion,
  MasterConclusionData,
  FinalVerdict
} from '../utils/conclusionEngine';

interface MasterConclusionProps {
  portfolio: Position[];
  livePrices: Record<string, PriceData>;
  usdInrRate: number;
  metrics: { totalValue: number; totalPL: number; plPct: number; todayPL: number };
}

const VERDICT_CONFIG: Record<FinalVerdict, { bg: string; text: string; border: string; glow: string; icon: string; label: string }> = {
  STRONG_BUY:  { bg: 'bg-emerald-500/15', text: 'text-emerald-400', border: 'border-emerald-500/30', glow: 'shadow-emerald-500/20', icon: '🟢', label: 'STRONG BUY' },
  BUY:         { bg: 'bg-cyan-500/15',    text: 'text-cyan-400',    border: 'border-cyan-500/30',    glow: 'shadow-cyan-500/20',    icon: '🟢', label: 'BUY' },
  HOLD:        { bg: 'bg-amber-500/15',   text: 'text-amber-400',   border: 'border-amber-500/30',   glow: 'shadow-amber-500/20',   icon: '🟡', label: 'HOLD' },
  SELL:        { bg: 'bg-orange-500/15',  text: 'text-orange-400',  border: 'border-orange-500/30',  glow: 'shadow-orange-500/20',  icon: '🔴', label: 'SELL' },
  STRONG_SELL: { bg: 'bg-red-500/15',     text: 'text-red-400',     border: 'border-red-500/30',     glow: 'shadow-red-500/20',     icon: '🔴', label: 'STRONG SELL' },
};

export function MasterConclusion({ portfolio, livePrices, usdInrRate, metrics }: MasterConclusionProps) {
  const [data, setData] = useState<MasterConclusionData | null>(null);
  const [expandedAsset, setExpandedAsset] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const lastComputeRef = useRef(0);
  const initialLoadRef = useRef(true);

  useEffect(() => {
    const now = Date.now();
    const shouldCompute = initialLoadRef.current || (now - lastComputeRef.current > 8000);
    if (!shouldCompute) return;

    if (initialLoadRef.current) {
      setIsLoading(true);
      initialLoadRef.current = false;
    }

    const timeout = setTimeout(() => {
      const result = generateMasterConclusion(portfolio, livePrices, usdInrRate, metrics);
      setData(result);
      setIsLoading(false);
      lastComputeRef.current = Date.now();
    }, isLoading ? 600 : 100);

    return () => clearTimeout(timeout);
  }, [portfolio, livePrices, usdInrRate, metrics]);

  // Separate throttled update for live prices
  useEffect(() => {
    if (initialLoadRef.current) return;
    const now = Date.now();
    if (now - lastComputeRef.current < 8000) return;
    const timeout = setTimeout(() => {
      const result = generateMasterConclusion(portfolio, livePrices, usdInrRate, metrics);
      setData(result);
      lastComputeRef.current = Date.now();
    }, 200);
    return () => clearTimeout(timeout);
  }, [livePrices]);

  if (isLoading || !data) {
    return (
      <div className="space-y-5 animate-fade-in">
        <div className="glass-card rounded-2xl p-12 text-center">
          <div className="text-7xl mb-4 animate-float">🔮</div>
          <div className="text-2xl font-black gradient-text-cyan font-display mb-2">MASTER CONCLUSION ENGINE</div>
          <div className="text-slate-500 text-sm">Aggregating all strategies & computing final verdict...</div>
          <div className="flex justify-center gap-2 mt-6">
            {['RSI/MACD', 'ML Momentum', 'AI Prediction', 'Smart Alloc', 'VIX Regime'].map((s, i) => (
              <span key={s} className="px-2 py-1 bg-cyan-500/10 text-cyan-400 text-[9px] rounded-full border border-cyan-500/20 animate-pulse" style={{ animationDelay: `${i * 200}ms` }}>
                {s}
              </span>
            ))}
          </div>
        </div>
      </div>
    );
  }

  const { conclusions, marketPulse, buyCount, sellCount, holdCount, avgConfidence, topPick, topAvoid } = data;

  return (
    <div className="space-y-5 animate-fade-in">

      {/* ═══════ MARKET PULSE HEADER ═══════ */}
      <div className="glass-card rounded-2xl p-5 border-cyan-500/20 bg-gradient-to-br from-cyan-500/5 to-indigo-500/5">
        <div className="flex items-center justify-between mb-5">
          <div className="flex items-center gap-4">
            <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-cyan-500/20 to-purple-500/20 flex items-center justify-center border border-cyan-500/30">
              <span className="text-3xl">🔮</span>
            </div>
            <div>
              <h2 className="text-2xl font-black gradient-text-cyan font-display">MASTER CONCLUSION</h2>
              <p className="text-xs text-slate-500 mt-0.5">All 5 strategies aggregated → One final verdict per asset</p>
            </div>
          </div>
          <div className="text-right hidden md:block">
            <div className="text-[10px] text-slate-500 uppercase tracking-wider">Last Computed</div>
            <div className="text-sm font-mono text-cyan-400">{new Date(data.timestamp).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}</div>
          </div>
        </div>

        {/* Market Pulse Cards */}
        <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mb-4">
          <div className="bg-black/30 rounded-xl p-3 text-center border border-white/5">
            <div className="text-[9px] text-slate-500 uppercase tracking-wider mb-1">Fear & Greed</div>
            <div className={`text-2xl font-black font-mono ${marketPulse.fearGreedScore >= 60 ? 'text-emerald-400' : marketPulse.fearGreedScore >= 40 ? 'text-amber-400' : 'text-red-400'}`}>
              {marketPulse.fearGreedScore}
            </div>
            <div className="w-full h-1.5 bg-slate-800 rounded-full mt-1 overflow-hidden">
              <div className="h-full rounded-full bg-gradient-to-r from-red-500 via-amber-500 to-emerald-500 transition-all" style={{ width: `${marketPulse.fearGreedScore}%` }} />
            </div>
          </div>
          <div className="bg-black/30 rounded-xl p-3 text-center border border-white/5">
            <div className="text-[9px] text-slate-500 uppercase tracking-wider mb-1">🇺🇸 US VIX</div>
            <div className={`text-xl font-black font-mono ${marketPulse.usVix > 20 ? 'text-red-400' : 'text-emerald-400'}`}>{marketPulse.usVix.toFixed(1)}</div>
            <div className="text-[9px] text-slate-600 mt-0.5">{marketPulse.usaStatus}</div>
          </div>
          <div className="bg-black/30 rounded-xl p-3 text-center border border-white/5">
            <div className="text-[9px] text-slate-500 uppercase tracking-wider mb-1">🇮🇳 India VIX</div>
            <div className={`text-xl font-black font-mono ${marketPulse.inVix > 20 ? 'text-red-400' : 'text-emerald-400'}`}>{marketPulse.inVix.toFixed(1)}</div>
            <div className="text-[9px] text-slate-600 mt-0.5">{marketPulse.indiaStatus}</div>
          </div>
          <div className="bg-black/30 rounded-xl p-3 text-center border border-white/5">
            <div className="text-[9px] text-slate-500 uppercase tracking-wider mb-1">Buy Signals</div>
            <div className="text-xl font-black text-emerald-400 font-mono">{buyCount}</div>
            <div className="text-[9px] text-slate-600 mt-0.5">of {conclusions.length} assets</div>
          </div>
          <div className="bg-black/30 rounded-xl p-3 text-center border border-white/5">
            <div className="text-[9px] text-slate-500 uppercase tracking-wider mb-1">Sell Signals</div>
            <div className="text-xl font-black text-red-400 font-mono">{sellCount}</div>
            <div className="text-[9px] text-slate-600 mt-0.5">{holdCount} hold</div>
          </div>
        </div>

        {/* Global Mood + Overall Action */}
        <div className="grid md:grid-cols-2 gap-3">
          <div className="bg-black/20 rounded-xl p-4 border border-white/5">
            <div className="text-[10px] text-slate-500 font-bold uppercase tracking-wider mb-2">🌍 Global Market Mood</div>
            <div className="text-sm text-slate-300 leading-relaxed">{marketPulse.globalMood}</div>
          </div>
          <div className={`rounded-xl p-4 border ${marketPulse.overallAction.includes('🟢') ? 'bg-emerald-500/5 border-emerald-500/20' : marketPulse.overallAction.includes('🔴') ? 'bg-red-500/5 border-red-500/20' : 'bg-amber-500/5 border-amber-500/20'}`}>
            <div className="text-[10px] text-slate-500 font-bold uppercase tracking-wider mb-2">💼 Portfolio Action</div>
            <div className="font-bold text-white text-sm mb-1">{marketPulse.overallAction}</div>
            <div className="text-xs text-slate-400 leading-relaxed">{marketPulse.overallActionDetail}</div>
          </div>
        </div>
      </div>

      {/* ═══════ TOP PICK & TOP AVOID ═══════ */}
      {(topPick || topAvoid) && (
        <div className="grid md:grid-cols-2 gap-3">
          {topPick && (
            <div className="glass-card rounded-2xl p-5 border-emerald-500/20 bg-gradient-to-br from-emerald-500/5 to-cyan-500/5">
              <div className="flex items-center gap-2 mb-3">
                <span className="text-2xl">🏆</span>
                <div>
                  <div className="text-[10px] text-emerald-400 font-bold uppercase tracking-wider">Top Pick — Best Opportunity</div>
                  <div className="text-xl font-black text-white">{topPick.symbol} <span className="text-sm text-emerald-400">({topPick.verdict.replace('_', ' ')})</span></div>
                </div>
              </div>
              <div className="text-xs text-slate-300 leading-relaxed mb-2">{topPick.actionDetail}</div>
              <div className="text-[10px] text-cyan-400 font-mono">{topPick.priceAction}</div>
            </div>
          )}
          {topAvoid && topAvoid.verdict.includes('SELL') && (
            <div className="glass-card rounded-2xl p-5 border-red-500/20 bg-gradient-to-br from-red-500/5 to-orange-500/5">
              <div className="flex items-center gap-2 mb-3">
                <span className="text-2xl">⚠️</span>
                <div>
                  <div className="text-[10px] text-red-400 font-bold uppercase tracking-wider">Top Caution — Risk Alert</div>
                  <div className="text-xl font-black text-white">{topAvoid.symbol} <span className="text-sm text-red-400">({topAvoid.verdict.replace('_', ' ')})</span></div>
                </div>
              </div>
              <div className="text-xs text-slate-300 leading-relaxed mb-2">{topAvoid.actionDetail}</div>
              <div className="text-[10px] text-red-400 font-mono">{topAvoid.priceAction}</div>
            </div>
          )}
        </div>
      )}

      {/* ═══════ ASSET VERDICT CARDS ═══════ */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="text-lg font-black text-white flex items-center gap-2">
            <span className="w-8 h-8 rounded-lg bg-purple-500/10 flex items-center justify-center text-base">📊</span>
            Per-Asset Final Verdict
            <span className="badge bg-purple-500/10 text-purple-400 border border-purple-500/20 text-[9px] ml-2">
              {conclusions.length} ASSETS
            </span>
          </h3>
          <div className="text-[10px] text-slate-500 font-mono">Avg Confidence: {avgConfidence}%</div>
        </div>

        {conclusions.map((c) => {
          const vc = VERDICT_CONFIG[c.verdict];
          const isExpanded = expandedAsset === c.symbol;
          const cur = c.market === 'IN' ? '₹' : '$';

          return (
            <div
              key={c.symbol}
              className={`glass-card rounded-2xl overflow-hidden border transition-all duration-300 ${vc.border} ${isExpanded ? `${vc.bg} shadow-lg ${vc.glow}` : 'hover:border-cyan-500/30'}`}
            >
              {/* Collapsed Header */}
              <button
                onClick={() => setExpandedAsset(isExpanded ? null : c.symbol)}
                className="w-full p-4 flex items-center gap-4 text-left"
              >
                {/* Verdict Badge */}
                <div className={`w-12 h-12 rounded-xl ${vc.bg} flex items-center justify-center border ${vc.border} flex-shrink-0`}>
                  <span className="text-xl">{vc.icon}</span>
                </div>

                {/* Symbol + Verdict */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-0.5">
                    <span className="font-black text-white text-base">{c.symbol}</span>
                    <span className={`px-2 py-0.5 rounded-md text-[9px] font-black uppercase ${vc.bg} ${vc.text} border ${vc.border}`}>{vc.label}</span>
                    <span className={`text-[9px] px-1.5 py-0.5 rounded ${c.market === 'IN' ? 'bg-orange-500/10 text-orange-400' : 'bg-blue-500/10 text-blue-400'}`}>
                      {c.market === 'IN' ? '🇮🇳' : '🇺🇸'}
                    </span>
                  </div>
                  <div className="text-xs text-slate-500 truncate">{c.actionTitle}</div>
                </div>

                {/* Price + Change */}
                <div className="text-right flex-shrink-0">
                  <div className={`font-black font-mono text-base ${c.change >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                    {cur}{c.currentPrice.toFixed(2)}
                  </div>
                  <div className={`text-xs font-bold ${c.change >= 0 ? 'text-emerald-500' : 'text-red-500'}`}>
                    {c.change >= 0 ? '▲' : '▼'} {Math.abs(c.change).toFixed(2)}%
                  </div>
                </div>

                {/* Verdict Score */}
                <div className="text-center flex-shrink-0 w-14">
                  <div className={`text-2xl font-black font-mono ${vc.text}`}>{c.verdictScore}</div>
                  <div className="text-[8px] text-slate-600 uppercase">Score</div>
                </div>

                {/* Expand Icon */}
                <div className={`w-6 h-6 rounded-full bg-white/5 flex items-center justify-center text-slate-500 transition-transform ${isExpanded ? 'rotate-180' : ''}`}>
                  ▼
                </div>
              </button>

              {/* Expanded Content */}
              {isExpanded && (
                <div className="px-4 pb-5 space-y-4 animate-fade-in border-t border-white/5">

                  {/* Action Plan */}
                  <div className={`rounded-xl p-4 ${vc.bg} border ${vc.border} mt-4`}>
                    <div className="font-bold text-white text-sm mb-2">{c.actionTitle}</div>
                    <div className="text-xs text-slate-300 leading-relaxed mb-3">{c.actionDetail}</div>
                    <div className="text-[10px] font-mono text-cyan-400 mb-1">{c.priceAction}</div>
                    <div className="text-[10px] text-slate-500">⏱️ {c.holdingPeriod}</div>
                  </div>

                  {/* Price Levels Grid */}
                  <div className="grid grid-cols-2 md:grid-cols-5 gap-2">
                    <div className="bg-black/30 rounded-lg p-3 text-center border border-white/5">
                      <div className="text-[8px] text-emerald-400/70 uppercase tracking-wider mb-1">Entry Zone</div>
                      <div className="text-sm font-black text-emerald-400 font-mono">{cur}{c.entryPrice.toFixed(2)}</div>
                    </div>
                    <div className="bg-black/30 rounded-lg p-3 text-center border border-white/5">
                      <div className="text-[8px] text-cyan-400/70 uppercase tracking-wider mb-1">Target</div>
                      <div className="text-sm font-black text-cyan-400 font-mono">{cur}{c.targetPrice.toFixed(2)}</div>
                    </div>
                    <div className="bg-black/30 rounded-lg p-3 text-center border border-white/5">
                      <div className="text-[8px] text-red-400/70 uppercase tracking-wider mb-1">Stop Loss</div>
                      <div className="text-sm font-black text-red-400 font-mono">{cur}{c.stopLoss.toFixed(2)}</div>
                    </div>
                    <div className="bg-black/30 rounded-lg p-3 text-center border border-white/5">
                      <div className="text-[8px] text-purple-400/70 uppercase tracking-wider mb-1">Reversal</div>
                      <div className="text-sm font-black text-purple-400 font-mono">{cur}{c.reversalZone.toFixed(2)}</div>
                    </div>
                    <div className="bg-black/30 rounded-lg p-3 text-center border border-white/5">
                      <div className="text-[8px] text-amber-400/70 uppercase tracking-wider mb-1">Risk:Reward</div>
                      <div className="text-sm font-black text-amber-400 font-mono">{c.riskReward.toFixed(1)}:1</div>
                    </div>
                  </div>

                  {/* Technical Indicators */}
                  <div className="grid grid-cols-3 md:grid-cols-6 gap-2">
                    <div className="bg-black/30 rounded-lg p-2 text-center">
                      <div className="text-[8px] text-slate-600 uppercase">RSI</div>
                      <div className={`text-sm font-bold font-mono ${c.rsi < 35 ? 'text-emerald-400' : c.rsi > 65 ? 'text-red-400' : 'text-amber-400'}`}>{c.rsi.toFixed(0)}</div>
                    </div>
                    <div className="bg-black/30 rounded-lg p-2 text-center">
                      <div className="text-[8px] text-slate-600 uppercase">MACD</div>
                      <div className={`text-sm font-bold font-mono ${(c.macd || 0) > 0 ? 'text-emerald-400' : 'text-red-400'}`}>{c.macd?.toFixed(2) || 'N/A'}</div>
                    </div>
                    <div className="bg-black/30 rounded-lg p-2 text-center">
                      <div className="text-[8px] text-slate-600 uppercase">Trend</div>
                      <div className={`text-sm font-bold ${c.trend === 'BULLISH' ? 'text-emerald-400' : c.trend === 'BEARISH' ? 'text-red-400' : 'text-amber-400'}`}>
                        {c.trend === 'BULLISH' ? '📈' : c.trend === 'BEARISH' ? '📉' : '↔️'} {c.trend}
                      </div>
                    </div>
                    <div className="bg-black/30 rounded-lg p-2 text-center">
                      <div className="text-[8px] text-slate-600 uppercase">Volume</div>
                      <div className="text-sm font-bold text-cyan-400 font-mono">{c.volume > 1e6 ? `${(c.volume / 1e6).toFixed(1)}M` : c.volume > 1e3 ? `${(c.volume / 1e3).toFixed(0)}K` : 'N/A'}</div>
                    </div>
                    <div className="bg-black/30 rounded-lg p-2 text-center">
                      <div className="text-[8px] text-slate-600 uppercase">P&L</div>
                      <div className={`text-sm font-bold font-mono ${c.plPct >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>{c.plPct >= 0 ? '+' : ''}{c.plPct.toFixed(1)}%</div>
                    </div>
                    <div className="bg-black/30 rounded-lg p-2 text-center">
                      <div className="text-[8px] text-slate-600 uppercase">Confidence</div>
                      <div className={`text-sm font-bold font-mono ${c.confidence > 70 ? 'text-emerald-400' : c.confidence > 50 ? 'text-amber-400' : 'text-red-400'}`}>{c.confidence}%</div>
                    </div>
                  </div>

                  {/* Strategy Breakdown */}
                  <div className="bg-black/20 rounded-xl p-4 border border-white/5">
                    <div className="text-[10px] text-slate-500 font-bold uppercase tracking-wider mb-3">📊 Strategy-wise Breakdown (5 Engines)</div>
                    <div className="space-y-2.5">
                      {c.strategies.map((s, i) => (
                        <div key={i} className="flex items-center gap-3">
                          <div className="w-28 flex-shrink-0">
                            <div className="text-[9px] text-slate-400 font-bold truncate">{s.name}</div>
                            <div className="text-[8px] text-slate-600">{(s.weight * 100).toFixed(0)}% weight</div>
                          </div>
                          <div className="flex-1">
                            <div className="flex items-center gap-2 mb-0.5">
                              <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded ${s.score > 60 ? 'bg-emerald-500/10 text-emerald-400' : s.score > 40 ? 'bg-amber-500/10 text-amber-400' : 'bg-red-500/10 text-red-400'}`}>{s.signal}</span>
                              <span className="text-[9px] text-slate-500 font-mono">{s.score}/100</span>
                            </div>
                            <div className="w-full h-1 bg-slate-800 rounded-full overflow-hidden">
                              <div
                                className={`h-full rounded-full transition-all ${s.score > 60 ? 'bg-emerald-500' : s.score > 40 ? 'bg-amber-500' : 'bg-red-500'}`}
                                style={{ width: `${s.score}%` }}
                              />
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                    <div className="mt-3 pt-3 border-t border-white/5">
                      <div className="flex items-center gap-2">
                        <div className="text-[9px] text-slate-400 font-bold">FINAL WEIGHTED SCORE:</div>
                        <div className={`text-lg font-black font-mono ${vc.text}`}>{c.verdictScore}/100</div>
                        <span className={`px-2 py-0.5 rounded-md text-[9px] font-black uppercase ${vc.bg} ${vc.text} border ${vc.border}`}>{vc.label}</span>
                      </div>
                    </div>
                  </div>

                  {/* Strategy Details */}
                  <div className="bg-black/10 rounded-xl p-3">
                    <div className="text-[9px] text-slate-500 font-bold uppercase tracking-wider mb-2">🔍 Detailed Reasoning</div>
                    <div className="space-y-1">
                      {c.strategies.map((s, i) => (
                        <div key={i} className="text-[10px] text-slate-400 flex items-start gap-2">
                          <span className="text-cyan-400 mt-0.5">•</span>
                          <span><strong className="text-slate-300">{s.name}:</strong> {s.detail}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* ═══════ DISCLAIMER ═══════ */}
      <div className="glass-card rounded-2xl p-4 border-amber-500/20">
        <div className="flex items-start gap-3">
          <span className="text-2xl">⚠️</span>
          <div className="text-xs text-slate-400">
            <div className="font-bold text-amber-400 mb-1">Master Conclusion Disclaimer</div>
            Ye conclusions 5 different AI/ML strategies ko aggregate karke generate hote hain. Ye financial advice NAHI hai.
            Always apna research karo aur qualified financial advisor se consult karo before investing.
            Past performance future results guarantee nahi karta.
          </div>
        </div>
      </div>
    </div>
  );
}
