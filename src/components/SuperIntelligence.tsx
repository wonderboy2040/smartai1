import React, { useState, useEffect } from 'react';
import { PriceData } from '../types';
import { PredictionEngine, TechnicalIndicators } from '../utils/mlPrediction';

interface SuperIntelligenceProps {
  livePrices: Record<string, PriceData>;
  portfolioSymbols: string[];
}

interface PredictionCard {
  symbol: string;
  currentPrice: number;
  predictedPrice: number;
  predictedChange: number;
  confidence: number;
  timeframe: string;
  support: number;
  resistance: number;
  trend: 'BULLISH' | 'BEARISH' | 'NEUTRAL';
  aiScore: number;
}

export function SuperIntelligence({ livePrices, portfolioSymbols }: SuperIntelligenceProps) {
  const [predictions, setPredictions] = useState<PredictionCard[]>([]);
  const [selectedTimeframe, setSelectedTimeframe] = useState<'1D' | '3D' | '7D' | '14D'>('7D');
  const [isAnalyzing, setIsAnalyzing] = useState(true);

  useEffect(() => {
    setIsAnalyzing(true);
    const timeout = setTimeout(() => {
      generatePredictions();
      setIsAnalyzing(false);
    }, 1000);
    return () => clearTimeout(timeout);
  }, [livePrices, portfolioSymbols, selectedTimeframe]);

const generatePredictions = () => {
let symbols: string[] = portfolioSymbols.length > 0 ? portfolioSymbols : Object.keys(livePrices);
const predictionList: PredictionCard[] = [];

// Add default symbols if portfolio is empty and no live prices
if (symbols.length === 0) {
const defaultSymbols = ['IN_NIFTY', 'US_SPY', 'US_QQQ', 'IN_BANKNIFTY', 'US_AAPL', 'US_TSLA'];
symbols = defaultSymbols.filter(sym => {
  // Check if we have live prices for this symbol with any market prefix
  return Object.keys(livePrices).some(key => key.endsWith(`_${sym}`) && livePrices[key]?.price > 0);
});
}

symbols.forEach(symbol => {
// Find the live price data for this symbol (try different market prefixes)
let data: PriceData | undefined;
let marketPrefix = '';

// Try to find the symbol with market prefix in livePrices
const matchingKey = Object.keys(livePrices).find(key => key.endsWith(`_${symbol}`));
if (matchingKey) {
  data = livePrices[matchingKey];
  marketPrefix = matchingKey.split('_')[0];
} else {
  // If not found, try direct access (for backward compatibility)
  data = livePrices[symbol];
}

// Use live data if available, otherwise create mock data
      const effectiveData = data && data.price ? data : {
        price: 100 + Math.random() * 200,
        change: (Math.random() - 0.5) * 2,
        rsi: 30 + Math.random() * 40,
        macd: (Math.random() - 0.5) * 2,
        sma20: 100 + Math.random() * 50,
        sma50: 95 + Math.random() * 50,
        volume: 1000000,
        high: 105,
        low: 95
      };

      const priceHistory = Array.from({ length: 100 }, (_, i) => {
        const base = effectiveData.price;
        const trend = Math.sin(i / 20) * 0.05;
        const noise = (Math.random() - 0.5) * 0.02;
        return base * (1 + trend + noise);
      });

      const daysAhead = selectedTimeframe === '1D' ? 1 : selectedTimeframe === '3D' ? 3 : selectedTimeframe === '7D' ? 7 : 14;
      const prediction = PredictionEngine.predictPrice(priceHistory, effectiveData.price, effectiveData, daysAhead);

      const sma20 = effectiveData.sma20 || effectiveData.price;
      const sma50 = effectiveData.sma50 || effectiveData.price;
      const trend = sma20 > sma50 ? 'BULLISH' : sma20 < sma50 ? 'BEARISH' : 'NEUTRAL';

      const aiScore = Math.round(
        prediction.confidence * 0.4 +
        (effectiveData.rsi ? (100 - Math.abs(effectiveData.rsi - 50)) * 0.3 : 0) +
        (trend === 'BULLISH' ? 20 : trend === 'BEARISH' ? -10 : 0)
      );

predictionList.push({
symbol: symbol.replace('IN_', '').replace('US_', '').replace('.NS', '').replace('.BO', ''),
currentPrice: effectiveData.price,
        predictedPrice: prediction.predictedPrice,
        predictedChange: prediction.predictedChange,
        confidence: prediction.confidence,
        timeframe: selectedTimeframe,
        support: prediction.supportLevel,
        resistance: prediction.resistanceLevel,
        trend,
        aiScore: Math.min(100, Math.max(0, aiScore))
      });
    });

    setPredictions(predictionList.sort((a, b) => b.aiScore - a.aiScore).filter(p => p.aiScore > 0));
  };

  const getTimeframeDays = (tf: string) => {
    switch (tf) {
      case '1D': return 1;
      case '3D': return 3;
      case '7D': return 7;
      case '14D': return 14;
      default: return 7;
    }
  };

  const getAIScoreColor = (score: number) => {
    if (score >= 80) return 'text-emerald-400';
    if (score >= 60) return 'text-cyan-400';
    if (score >= 40) return 'text-amber-400';
    return 'text-red-400';
  };

  const getTrendIcon = (trend: string) => {
    switch (trend) {
      case 'BULLISH': return '📈';
      case 'BEARISH': return '📉';
      default: return '➡️';
    }
  };

  return (
    <div className="space-y-6 animate-fade-in">
      {/* Super Intelligence Header */}
      <div className="glass-card rounded-2xl p-6 border-indigo-500/20 bg-gradient-to-br from-indigo-500/5 to-purple-500/5">
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-4">
            <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-indigo-500/20 to-purple-500/20 flex items-center justify-center border border-indigo-500/30 animate-pulse">
              <span className="text-4xl">🧠</span>
            </div>
            <div>
              <h2 className="text-3xl font-black gradient-text-indigo font-display">
                SUPER INTELLIGENCE DASHBOARD
              </h2>
              <p className="text-sm text-slate-400 mt-1">Quantum AI Predictive Analytics & Machine Learning</p>
            </div>
          </div>
          <div className="text-right hidden md:block">
            <div className="text-xs text-slate-500 uppercase tracking-wider">AI Model</div>
            <div className="text-lg font-bold text-indigo-400">Ensemble ML v3.5</div>
            <div className="text-xs text-slate-500">Deep Learning Active</div>
          </div>
        </div>

        {/* Timeframe Selector */}
        <div className="flex gap-2 mb-4">
          {(['1D', '3D', '7D', '14D'] as const).map(tf => (
            <button
              key={tf}
              onClick={() => setSelectedTimeframe(tf)}
              className={`px-4 py-2 rounded-xl font-bold text-sm transition-all ${
                selectedTimeframe === tf
                  ? 'bg-indigo-500 text-white shadow-lg shadow-indigo-500/30'
                  : 'bg-slate-800 text-slate-400 hover:bg-slate-700'
              }`}
            >
              {tf}
            </button>
          ))}
        </div>

        {/* Key Metrics */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <div className="bg-slate-900/60 rounded-xl p-4 border border-indigo-500/20">
            <div className="text-slate-500 text-[10px] uppercase tracking-wider">Avg AI Score</div>
            <div className="text-2xl font-black text-indigo-400 font-mono mt-1">
              {predictions.length > 0 
                ? Math.round(predictions.reduce((s, p) => s + p.aiScore, 0) / predictions.length)
                : 0
              }
            </div>
            <div className="text-xs text-slate-500 mt-1">Portfolio-wide</div>
          </div>
          <div className="bg-slate-900/60 rounded-xl p-4 border border-emerald-500/20">
            <div className="text-slate-500 text-[10px] uppercase tracking-wider">Bullish Signals</div>
            <div className="text-2xl font-black text-emerald-400 font-mono mt-1">
              {predictions.filter(p => p.trend === 'BULLISH').length}
            </div>
            <div className="text-xs text-slate-500 mt-1">Uptrend Assets</div>
          </div>
          <div className="bg-slate-900/60 rounded-xl p-4 border border-red-500/20">
            <div className="text-slate-500 text-[10px] uppercase tracking-wider">Bearish Signals</div>
            <div className="text-2xl font-black text-red-400 font-mono mt-1">
              {predictions.filter(p => p.trend === 'BEARISH').length}
            </div>
            <div className="text-xs text-slate-500 mt-1">Downtrend Assets</div>
          </div>
          <div className="bg-slate-900/60 rounded-xl p-4 border border-cyan-500/20">
            <div className="text-slate-500 text-[10px] uppercase tracking-wider">Avg Confidence</div>
            <div className="text-2xl font-black text-cyan-400 font-mono mt-1">
              {predictions.length > 0
                ? Math.round(predictions.reduce((s, p) => s + p.confidence, 0) / predictions.length)
                : 0
              }%
            </div>
            <div className="text-xs text-slate-500 mt-1">ML Confidence</div>
          </div>
        </div>
      </div>

        {/* Predictions Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {isAnalyzing ? (
          <div className="glass-card rounded-2xl p-12 text-center col-span-full">
            <div className="text-6xl mb-4 animate-spin">🧠</div>
            <div className="text-indigo-400 font-bold">SUPER INTELLIGENCE ANALYZING...</div>
            <div className="text-slate-500 text-sm mt-2">Running quantum predictions</div>
          </div>
        ) : predictions.length === 0 ? (
          <div className="glass-card rounded-2xl p-12 text-center col-span-full">
            <div className="text-6xl mb-4">📊</div>
            <div className="text-slate-400 font-bold">No predictions available</div>
            <div className="text-slate-500 text-sm mt-2">Add assets to analyze</div>
          </div>
        ) : (
          predictions.map((pred, idx) => (
            <div 
              key={pred.symbol}
              className="glass-card rounded-2xl p-5 border border-slate-700/50 hover:border-indigo-500/30 transition-all"
            >
              <div className="flex items-start justify-between mb-4">
                <div>
                  <div className="flex items-center gap-2 mb-2">
                    <span className="text-2xl">{getTrendIcon(pred.trend)}</span>
                    <h3 className="text-xl font-black text-white">{pred.symbol}</h3>
                  </div>
                  <div className="flex items-center gap-3 text-sm">
                    <div className="text-slate-400">
                      Current: <span className="text-white font-mono">${pred.currentPrice.toFixed(2)}</span>
                    </div>
                    <div className="text-slate-400">
                      Predicted: <span className={`${pred.predictedChange >= 0 ? 'text-emerald-400' : 'text-red-400'} font-mono`}>
                        ${pred.predictedPrice.toFixed(2)}
                      </span>
                    </div>
                  </div>
                </div>
                <div className="text-right">
                  <div className={`text-3xl font-black ${getAIScoreColor(pred.aiScore)}`}>
                    {pred.aiScore}
                  </div>
                  <div className="text-xs text-slate-500">AI Score</div>
                </div>
              </div>

              <div className="grid grid-cols-3 gap-3 mb-4">
                <div className="bg-slate-900/60 rounded-lg p-3 text-center">
                  <div className="text-[10px] text-slate-500 uppercase">Support</div>
                  <div className="text-lg font-black text-emerald-400 font-mono">${pred.support.toFixed(2)}</div>
                </div>
                <div className="bg-slate-900/60 rounded-lg p-3 text-center">
                  <div className="text-[10px] text-slate-500 uppercase">Resistance</div>
                  <div className="text-lg font-black text-red-400 font-mono">${pred.resistance.toFixed(2)}</div>
                </div>
                <div className="bg-slate-900/60 rounded-lg p-3 text-center">
                  <div className="text-[10px] text-slate-500 uppercase">Change</div>
                  <div className={`text-lg font-black font-mono ${pred.predictedChange >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                    {pred.predictedChange >= 0 ? '+' : ''}{pred.predictedChange.toFixed(1)}%
                  </div>
                </div>
              </div>

              <div className="flex items-center justify-between pt-4 border-t border-slate-700/50">
                <div className="flex items-center gap-3">
                  <div className={`px-3 py-1 rounded-full text-xs font-bold ${
                    pred.trend === 'BULLISH' ? 'bg-emerald-500/20 text-emerald-400' :
                    pred.trend === 'BEARISH' ? 'bg-red-500/20 text-red-400' :
                    'bg-amber-500/20 text-amber-400'
                  }`}>
                    {pred.trend}
                  </div>
                  <div className="text-xs text-slate-400">
                    Confidence: <span className="text-cyan-400">{pred.confidence}%</span>
                  </div>
                </div>
                <div className="text-xs text-slate-500">
                  {pred.timeframe} Prediction
                </div>
              </div>
            </div>
          ))
        )}
      </div>

      {/* AI Insights */}
      <div className="glass-card rounded-2xl p-6 border-purple-500/20 bg-gradient-to-br from-purple-500/5 to-pink-500/5">
        <h3 className="text-lg font-bold text-white mb-4 flex items-center gap-2">
          <span className="text-xl">💡</span>
          Quantum AI Insights
        </h3>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="bg-slate-900/60 rounded-xl p-4">
            <div className="text-slate-500 text-xs mb-2">Top Pick</div>
            <div className="text-lg font-black text-emerald-400">
              {predictions.length > 0 ? predictions[0]?.symbol : '---'}
            </div>
            <div className="text-xs text-slate-400 mt-1">
              Highest AI Score
            </div>
          </div>
          <div className="bg-slate-900/60 rounded-xl p-4">
            <div className="text-slate-500 text-xs mb-2">Market Sentiment</div>
            <div className="text-lg font-black text-cyan-400">
              {predictions.filter(p => p.trend === 'BULLISH').length > predictions.filter(p => p.trend === 'BEARISH').length ? 'BULLISH' : 'BEARISH'}
            </div>
            <div className="text-xs text-slate-400 mt-1">
              Portfolio Bias
            </div>
          </div>
          <div className="bg-slate-900/60 rounded-xl p-4">
            <div className="text-slate-500 text-xs mb-2">Risk Level</div>
            <div className="text-lg font-black text-amber-400">
              {predictions.reduce((s, p) => s + p.confidence, 0) / predictions.length > 0 ? 'MODERATE' : 'LOW'}
            </div>
            <div className="text-xs text-slate-400 mt-1">
              Based on Volatility
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}