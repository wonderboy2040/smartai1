import { useState, useEffect } from 'react';
import { Position, PriceData } from '../types';
import { QuantumPredictor, QuantumPrediction } from '../utils/quantum-advanced';

interface DeepQuantumDashboardProps {
  portfolio: Position[];
  livePrices: Record<string, PriceData>;
}

export function DeepQuantumDashboard({ portfolio, livePrices }: DeepQuantumDashboardProps) {
  const [predictions, setPredictions] = useState<QuantumPrediction[]>([]);
  const [selectedSymbol, setSelectedSymbol] = useState('');
  const quantumPredictor = new QuantumPredictor();

  useEffect(() => {
    const preds: QuantumPrediction[] = [];
    portfolio.forEach(p => {
      const key = `${p.market}_${p.symbol}`;
      const data = livePrices[key];
      if (data?.price) {
        quantumPredictor.updateHistory(p.symbol, data.price, data.volume);
        const pred = quantumPredictor.predict(p.symbol, data.price, data);
        preds.push(pred);
      }
    });
    setPredictions(preds);
  }, [portfolio, livePrices]);

  const getDirectionColor = (direction: string) => {
    if (direction.includes('BUY')) return 'text-emerald-400';
    if (direction.includes('SELL')) return 'text-red-400';
    return 'text-cyan-400';
  };

  const getDirectionBg = (direction: string) => {
    if (direction.includes('BUY')) return 'bg-emerald-500/10 border-emerald-500/30';
    if (direction.includes('SELL')) return 'bg-red-500/10 border-red-500/30';
    return 'bg-cyan-500/10 border-cyan-500/30';
  };

  return (
    <div className="space-y-6 animate-fade-in">
      {/* Quantum AI Header */}
      <div className="glass-card rounded-2xl p-6 border-cyan-500/20">
        <div className="flex items-center gap-4 mb-4">
          <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-cyan-500/20 to-indigo-500/20 flex items-center justify-center border border-cyan-500/30">
            <span className="text-2xl">🧠</span>
          </div>
          <div>
            <h2 className="text-xl font-black gradient-text-cyan font-display">
              DEEP QUANTUM AI PREDICTIONS
            </h2>
            <p className="text-xs text-slate-500 mt-1">Multi-Model Ensemble: LSTM + Transformer + XGBoost</p>
          </div>
        </div>

        {/* Model Predictions Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {predictions.map(pred => (
            <div key={pred.symbol} className="bg-slate-900/50 rounded-xl p-4 border border-slate-700/50">
              <div className="flex items-center justify-between mb-3">
                <span className="font-bold text-white">{pred.symbol}</span>
                <span className={`text-xs font-bold px-2 py-1 rounded ${getDirectionBg(pred.direction)} ${getDirectionColor(pred.direction)}`}>
                  {pred.direction}
                </span>
              </div>
              
              <div className="space-y-2 text-sm">
                <div className="flex justify-between">
                  <span className="text-slate-500">Current:</span>
                  <span className="text-white font-mono">{pred.predictedPrice.toFixed(2)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-500">LSTM:</span>
                  <span className="text-cyan-400 font-mono">{pred.models.lstm.toFixed(2)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-500">Transformer:</span>
                  <span className="text-indigo-400 font-mono">{pred.models.transformer.toFixed(2)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-500">XGBoost:</span>
                  <span className="text-purple-400 font-mono">{pred.models.xgboost.toFixed(2)}</span>
                </div>
                <div className="flex justify-between border-t border-slate-700 pt-2">
                  <span className="text-slate-500">Ensemble:</span>
                  <span className="text-emerald-400 font-bold">{pred.models.ensemble.toFixed(2)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-500">Confidence:</span>
                  <span className="text-cyan-400 font-bold">{pred.confidence}%</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-500">Win Probability:</span>
                  <span className={pred.winProbability > 60 ? 'text-emerald-400' : 'text-amber-400'}>
                    {pred.winProbability}%
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-500">Risk/Reward:</span>
                  <span className={pred.riskReward > 2 ? 'text-emerald-400' : 'text-red-400'}>
                    1:{pred.riskReward.toFixed(2)}
                  </span>
                </div>
              </div>

              {/* Price Targets */}
              <div className="mt-3 pt-3 border-t border-slate-700">
                <div className="text-xs text-slate-500 mb-2">Price Targets:</div>
                <div className="grid grid-cols-3 gap-2 text-xs">
                  <div className="text-center">
                    <div className="text-slate-600">T1</div>
                    <div className="text-emerald-400 font-mono">{pred.priceTargets.target1.toFixed(2)}</div>
                  </div>
                  <div className="text-center">
                    <div className="text-slate-600">T2</div>
                    <div className="text-emerald-400 font-mono">{pred.priceTargets.target2.toFixed(2)}</div>
                  </div>
                  <div className="text-center">
                    <div className="text-slate-600">T3</div>
                    <div className="text-emerald-400 font-mono">{pred.priceTargets.target3.toFixed(2)}</div>
                  </div>
                </div>
              </div>

              {/* Support & Resistance */}
              <div className="mt-3 pt-3 border-t border-slate-700">
                <div className="text-xs text-slate-500 mb-2">Levels:</div>
                <div className="flex justify-between text-xs">
                  <span className="text-red-400">R: {pred.resistanceLevels[0]?.toFixed(2) || 'N/A'}</span>
                  <span className="text-emerald-400">S: {pred.supportLevels[0]?.toFixed(2) || 'N/A'}</span>
                </div>
              </div>

              <button
                onClick={() => setSelectedSymbol(pred.symbol)}
                className="w-full mt-3 btn-primary py-2 bg-gradient-to-r from-cyan-600 to-indigo-600 rounded-xl text-xs font-bold"
              >
                📊 View Details
              </button>
            </div>
          ))}
        </div>
      </div>

      {/* Fibonacci Levels */}
      {selectedSymbol && predictions.find(p => p.symbol === selectedSymbol) && (
        <div className="glass-card rounded-2xl p-6 border-fib-500/20">
          <h3 className="text-lg font-bold text-white mb-4 flex items-center gap-2">
            <span className="text-xl">🎯</span>
            Fibonacci Levels - {selectedSymbol}
          </h3>
          {(() => {
            const pred = predictions.find(p => p.symbol === selectedSymbol);
            if (!pred) return null;
            return (
              <div className="grid grid-cols-7 gap-2">
                {Object.entries(pred.fibLevels).map(([level, value]) => (
                  <div key={level} className="text-center p-3 bg-slate-900/50 rounded-xl">
                    <div className="text-[10px] text-slate-500 uppercase">{level.replace('level_', '')}</div>
                    <div className="text-sm font-black text-cyan-400 font-mono">{value.toFixed(2)}</div>
                  </div>
                ))}
              </div>
            );
          })()}
          <button
            onClick={() => setSelectedSymbol('')}
            className="mt-4 btn-glass px-4 py-2 rounded-xl text-sm"
          >
            ✕ Close
          </button>
        </div>
      )}
    </div>
  );
}