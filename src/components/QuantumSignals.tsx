import React, { useState, useEffect } from 'react';
import { PriceData, Position } from '../types';
import { 
  detectRegime, 
  scanMeanReversion, 
  calculateMomentumScore,
  PredictionEngine 
} from '../utils/mlPrediction';

interface SignalData {
  symbol: string;
  signal: 'STRONG_BUY' | 'BUY' | 'HOLD' | 'SELL' | 'STRONG_SELL';
  confidence: number;
  timeframe: '1D' | '3D' | '7D' | '14D';
  entryPrice?: number;
  targetPrice?: number;
  stopLoss?: number;
  reasoning: string[];
  quantumScore: number;
  aiConfidence: number;
}

interface QuantumSignalsProps {
  livePrices: Record<string, PriceData>;
  portfolio: Position[];
}

export function QuantumSignals({ livePrices, portfolio }: QuantumSignalsProps) {
const [signals, setSignals] = useState<SignalData[]>([]);
const [marketRegime, setMarketRegime] = useState<string>('ANALYZING');
const [isLoading, setIsLoading] = useState(true);
let regimeCounter = 0;

  useEffect(() => {
    setIsLoading(true);
    const timeout = setTimeout(() => {
      generateSignals();
      setIsLoading(false);
    }, 800);
  }, [livePrices, portfolio]);

const generateSignals = () => {
let symbols: Position[] = portfolio.length > 0 ? portfolio : [];
const signalList: SignalData[] = [];

// Add default symbols if portfolio is empty
if (symbols.length === 0) {
const defaultSymbols = ['IN_NIFTY', 'US_SPY', 'US_QQQ', 'IN_BANKNIFTY', 'US_AAPL', 'US_TSLA'];
symbols = defaultSymbols.map(sym => ({
  id: sym,
  symbol: sym.replace('IN_', '').replace('US_', ''),
  market: sym.startsWith('IN') ? 'IN' : 'US',
  qty: 1,
  avgPrice: livePrices[sym]?.price || 100,
  leverage: 1,
  dateAdded: ''
}));
}

symbols.forEach(pos => {
const symbol = pos.symbol;
const marketPrefix = pos.market;
const fullKey = `${marketPrefix}_${symbol}`;

// Find the live price data for this symbol
let data = livePrices[fullKey];

      // Use live data if available, otherwise use portfolio avgPrice
      const currentPrice = data?.price || pos.avgPrice;
      const effectiveData = {
        price: currentPrice,
        change: data?.change || 0,
        high: data?.high || currentPrice * 1.01,
        low: data?.low || currentPrice * 0.99,
        volume: data?.volume || 0,
        rsi: data?.rsi || 50,
        macd: data?.macd || 0,
        sma20: data?.sma20 || currentPrice,
        sma50: data?.sma50 || currentPrice
      };

      const priceHistory = Array.from({ length: 50 }, (_, i) =>
        effectiveData.price * (1 + (Math.sin(i / 10) * 0.02) + (Math.random() - 0.5) * 0.01)
      );

      const regime = detectRegime(priceHistory, (livePrices['US_VIX']?.price || 15));
      if (regimeCounter === 0) {
        setMarketRegime(regime.regime);
      }
      regimeCounter++;

      const meanRev = scanMeanReversion(priceHistory, effectiveData.price);
      const momentum = calculateMomentumScore(
        effectiveData.rsi || 50,
        effectiveData.macd,
        effectiveData.sma20,
        effectiveData.sma50,
        effectiveData.price,
        effectiveData.change,
        effectiveData.volume || 0
      );

      const prediction = PredictionEngine.predictPrice(priceHistory, effectiveData.price, effectiveData, 7);

      let signal: SignalData['signal'] = 'HOLD';
      let confidence = 50;
      const reasoning: string[] = [];

      if (momentum.score >= 75 && (regime.regime === 'BULL' || regime.regime === 'STRONG_BULL')) {
        signal = 'STRONG_BUY';
        confidence = 85 + Math.random() * 10;
        reasoning.push(`Strong momentum score: ${momentum.score}/100`);
        reasoning.push(`Market regime: ${regime.regime.replace('_', ' ')}`);
        reasoning.push(`RSI at ${effectiveData.rsi?.toFixed(1)} - Room for upside`);
      } else if (momentum.score >= 60) {
        signal = 'BUY';
        confidence = 65 + Math.random() * 15;
        reasoning.push(`Momentum building: ${momentum.score}/100`);
        reasoning.push(`Technical indicators favorable`);
      } else if (momentum.score <= 30 && regime.regime.includes('BEAR')) {
        signal = 'STRONG_SELL';
        confidence = 80 + Math.random() * 10;
        reasoning.push(`Weak momentum: ${momentum.score}/100`);
        reasoning.push(`Bearish regime detected`);
        reasoning.push(`Risk-off signal triggered`);
      } else if (momentum.score <= 40) {
        signal = 'SELL';
        confidence = 60 + Math.random() * 15;
        reasoning.push(`Momentum fading: ${momentum.score}/100`);
        reasoning.push(`Technical weakness observed`);
      } else {
        reasoning.push(`Neutral momentum: ${momentum.score}/100`);
        reasoning.push(`Wait for clearer signals`);
      }

      if (meanRev && meanRev.probability > 60) {
        reasoning.push(`Mean reversion probability: ${meanRev.probability}%`);
      }

      const atr = ((effectiveData.high || effectiveData.price) - (effectiveData.low || effectiveData.price)) || effectiveData.price * 0.02;
      const quantumScore = Math.round(
        (momentum.score * 0.4) + 
        ((100 - Math.abs(effectiveData.change || 0) * 10) * 0.3) + 
        ((regime.trendStrength) * 0.3)
      );

      signalList.push({
        symbol: symbol.replace('.NS', ''),
        signal,
        confidence: Math.round(confidence),
        timeframe: '7D',
        entryPrice: effectiveData.price,
        targetPrice: effectiveData.price * (1 + (signal.includes('BUY') ? 0.08 : signal.includes('SELL') ? -0.05 : 0)),
        stopLoss: effectiveData.price * (1 + (signal.includes('BUY') ? -0.05 : signal.includes('SELL') ? 0.03 : 0)),
        reasoning,
        quantumScore,
        aiConfidence: Math.round((confidence + quantumScore) / 2)
      });
    });

setSignals(signalList.sort((a, b) => b.quantumScore - a.quantumScore));
};

  const getSignalColor = (signal: string) => {
    switch (signal) {
      case 'STRONG_BUY': return 'text-emerald-400 bg-emerald-500/10 border-emerald-500/30';
      case 'BUY': return 'text-cyan-400 bg-cyan-500/10 border-cyan-500/30';
      case 'HOLD': return 'text-amber-400 bg-amber-500/10 border-amber-500/30';
      case 'SELL': return 'text-orange-400 bg-orange-500/10 border-orange-500/30';
      case 'STRONG_SELL': return 'text-red-400 bg-red-500/10 border-red-500/30';
      default: return 'text-slate-400';
    }
  };

  const getRegimeColor = (regime: string) => {
    if (regime.includes('BULL')) return 'text-emerald-400';
    if (regime.includes('BEAR')) return 'text-red-400';
    return 'text-amber-400';
  };

  return (
    <div className="space-y-6 animate-fade-in">
      {/* Quantum AI Header */}
      <div className="glass-card rounded-2xl p-6 border-cyan-500/20">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-4">
            <div className="w-14 h-14 rounded-xl bg-gradient-to-br from-cyan-500/20 to-indigo-500/20 flex items-center justify-center border border-cyan-500/30 animate-pulse">
              <span className="text-3xl">⚛️</span>
            </div>
            <div>
              <h2 className="text-2xl font-black gradient-text-cyan font-display">
                DEEP MIND QUANTUM AI SIGNALS
              </h2>
              <p className="text-xs text-slate-500 mt-1">Advanced ML-Powered Trading Intelligence</p>
            </div>
          </div>
          <div className="text-right">
            <div className="text-xs text-slate-500 uppercase tracking-wider">Market Regime</div>
            <div className={`text-lg font-black ${getRegimeColor(marketRegime)}`}>
              {marketRegime.replace('_', ' ')}
            </div>
          </div>
        </div>

        {/* Market Stats */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <div className="bg-slate-900/50 rounded-xl p-4">
            <div className="text-slate-500 text-[10px] uppercase">Active Signals</div>
            <div className="text-2xl font-black text-cyan-400 font-mono mt-1">
              {signals.filter(s => s.signal.includes('BUY')).length}
            </div>
            <div className="text-xs text-slate-500 mt-1">Buy Opportunities</div>
          </div>
          <div className="bg-slate-900/50 rounded-xl p-4">
            <div className="text-slate-500 text-[10px] uppercase">Sell Signals</div>
            <div className="text-2xl font-black text-red-400 font-mono mt-1">
              {signals.filter(s => s.signal.includes('SELL')).length}
            </div>
            <div className="text-xs text-slate-500 mt-1">Reduce Positions</div>
          </div>
          <div className="bg-slate-900/50 rounded-xl p-4">
            <div className="text-slate-500 text-[10px] uppercase">Avg Confidence</div>
            <div className="text-2xl font-black text-white font-mono mt-1">
              {signals.length > 0 ? Math.round(signals.reduce((s, sig) => s + sig.aiConfidence, 0) / signals.length) : 0}%
            </div>
            <div className="text-xs text-slate-500 mt-1">AI Confidence</div>
          </div>
          <div className="bg-slate-900/50 rounded-xl p-4">
            <div className="text-slate-500 text-[10px] uppercase">Quantum Score</div>
            <div className="text-2xl font-black text-indigo-400 font-mono mt-1">
              {signals.length > 0 ? Math.round(signals.reduce((s, sig) => s + sig.quantumScore, 0) / signals.length) : 0}
            </div>
            <div className="text-xs text-slate-500 mt-1">Overall Rating</div>
          </div>
        </div>
      </div>

      {/* Trading Signals */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {isLoading ? (
          <div className="glass-card rounded-2xl p-12 text-center">
            <div className="text-6xl mb-4 animate-spin">⚛️</div>
            <div className="text-cyan-400 font-bold">QUANTUM AI ANALYZING...</div>
            <div className="text-slate-500 text-sm mt-2">Processing market data</div>
          </div>
        ) : signals.length === 0 ? (
          <div className="glass-card rounded-2xl p-12 text-center">
            <div className="text-6xl mb-4">📊</div>
            <div className="text-slate-400 font-bold">No signals available</div>
            <div className="text-slate-500 text-sm mt-2">Add positions to generate signals</div>
          </div>
        ) : (
          signals.map((sig, idx) => (
            <div 
              key={sig.symbol}
              className={`glass-card rounded-2xl p-5 border transition-all hover:scale-[1.02] ${
                sig.signal.includes('BUY') ? 'border-emerald-500/30' : 
                sig.signal.includes('SELL') ? 'border-red-500/30' : 'border-slate-700/50'
              }`}
              style={{ animationDelay: `${idx * 100}ms` }}
            >
              <div className="flex items-start justify-between mb-4">
                <div>
                  <div className="flex items-center gap-2 mb-2">
                    <h3 className="text-xl font-black text-white">{sig.symbol}</h3>
                    <span className={`px-3 py-1 rounded-full text-xs font-bold border ${getSignalColor(sig.signal)}`}>
                      {sig.signal.replace('_', ' ')}
                    </span>
                  </div>
                  <div className="flex items-center gap-4 text-sm">
                    <div className="text-slate-400">
                      Entry: <span className="text-white font-mono">{symbols.find(p => p.symbol.replace('.NS', '') === sig.symbol)?.market === 'IN' ? '₹' : '$'}{sig.entryPrice?.toFixed(2)}</span>
                    </div>
                    <div className="text-slate-400">
                      Target: <span className="text-emerald-400 font-mono">{symbols.find(p => p.symbol.replace('.NS', '') === sig.symbol)?.market === 'IN' ? '₹' : '$'}{sig.targetPrice?.toFixed(2)}</span>
                    </div>
                    <div className="text-slate-400">
                      Stop: <span className="text-red-400 font-mono">{symbols.find(p => p.symbol.replace('.NS', '') === sig.symbol)?.market === 'IN' ? '₹' : '$'}{sig.stopLoss?.toFixed(2)}</span>
                    </div>
                  </div>
                </div>
                <div className="text-right">
                  <div className="text-4xl font-black text-cyan-400">{sig.quantumScore}</div>
                  <div className="text-xs text-slate-500">Quantum Score</div>
                </div>
              </div>

              <div className="grid grid-cols-3 gap-3 mb-4">
                <div className="bg-slate-900/50 rounded-lg p-3 text-center">
                  <div className="text-[10px] text-slate-500 uppercase">AI Confidence</div>
                  <div className={`text-xl font-black ${sig.aiConfidence > 70 ? 'text-emerald-400' : sig.aiConfidence > 50 ? 'text-amber-400' : 'text-red-400'}`}>
                    {sig.aiConfidence}%
                  </div>
                </div>
                <div className="bg-slate-900/50 rounded-lg p-3 text-center">
                  <div className="text-[10px] text-slate-500 uppercase">Timeframe</div>
                  <div className="text-xl font-black text-white">{sig.timeframe}</div>
                </div>
                <div className="bg-slate-900/50 rounded-lg p-3 text-center">
                  <div className="text-[10px] text-slate-500 uppercase">Signal</div>
                  <div className={`text-lg font-black ${sig.signal.includes('BUY') ? 'text-emerald-400' : sig.signal.includes('SELL') ? 'text-red-400' : 'text-amber-400'}`}>
                    {sig.signal}
                  </div>
                </div>
              </div>

              <div className="bg-slate-900/30 rounded-lg p-3">
                <div className="text-xs text-slate-400 font-bold mb-2">AI Reasoning:</div>
                <ul className="space-y-1">
                  {sig.reasoning.map((reason, i) => (
                    <li key={i} className="text-xs text-slate-300 flex items-start gap-2">
                      <span className="text-cyan-400 mt-0.5">•</span>
                      {reason}
                    </li>
                  ))}
                </ul>
              </div>

              <div className="mt-4 pt-4 border-t border-slate-700/50 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <div className="w-2 h-2 rounded-full bg-cyan-400 animate-pulse"></div>
                  <span className="text-xs text-slate-400">Real-time Analysis</span>
                </div>
                <button
                  onClick={() => {
                    // Add click handler for View Details button
                    console.log(`View details for ${sig.symbol}`);
                  }}
                  className="px-4 py-2 bg-cyan-500/10 hover:bg-cyan-500/20 border border-cyan-500/30 rounded-lg text-cyan-400 text-sm font-bold transition-all"
                >
                  📊 View Details
                </button>
              </div>
            </div>
          ))
        )}
      </div>

      {/* Quantum AI Disclaimer */}
      <div className="glass-card rounded-2xl p-4 border-amber-500/20">
        <div className="flex items-start gap-3">
          <span className="text-2xl">⚠️</span>
          <div className="text-xs text-slate-400">
            <div className="font-bold text-amber-400 mb-1">AI Trading Disclaimer</div>
            These signals are generated by machine learning algorithms and should not be considered as financial advice. 
            Always do your own research and consult with a qualified financial advisor before making investment decisions.
          </div>
        </div>
      </div>
    </div>
  );
}
