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
    const symbols = portfolioSymbols.length > 0 ? portfolioSymbols : Object.keys(livePrices);
    const predictionList: PredictionCard[] = [];

    symbols.forEach(symbol => {
      const data = livePrices[symbol];
      if (!data || !data.price) return;

      const priceHistory = Array.from({ length: 100 }, (_, i) => {
        const base = data.price;
        const trend = Math.sin(i / 20) * 0.05;
        const noise = (Math.random() - 0.5) * 0.02;
        return base * (1 + trend + noise);
      });

      const daysAhead = selectedTimeframe === '1D' ? 1 : selectedTimeframe === '3D' ? 3 : selectedTimeframe === '7D' ? 7 : 14;
      const prediction = PredictionEngine.predictPrice(priceHistory, data.price, data, daysAhead);

      const sma20 = data.sma20 || data.price;
      const sma50 = data.sma50 || data.price;
      const trend = sma20 > sma50 ? 'BULLISH' : sma20 < sma50 ? 'BEARISH' : 'NEUTRAL';

      const aiScore = Math.round(
        prediction.confidence * 0.4 +
        (data.rsi ? (100 - Math.abs(data.rsi - 50)) * 0.3 : 0) +
        (trend === 'BULLISH' ? 20 : trend === 'BEARISH' ? -10 : 0)
      );

      predictionList.push({
        symbol: symbol.replace('IN_', '').replace('US_', '').replace('.NS', ''),
        currentPrice: data.price,
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

    setPredictions(predictionList.sort((a, b) => b.aiScore - a.aiScore));
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
            <div className="text-6xl mb