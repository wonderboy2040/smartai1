import { useState, useEffect } from 'react';
import { PremarketAnalysis } from '../types';

export function PremarketTab() {
  const [analysis, setAnalysis] = useState<PremarketAnalysis | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // Simulating Quantum AI analysis delay
    const timer = setTimeout(() => {
      setAnalysis({
        market: 'IN',
        predictedGap: 0.45,
        sentimentScore: 0.72,
        volatilityForecast: 'medium',
        keySectors: [
          { sector: 'Nifty Bank', trend: 'bullish' },
          { sector: 'IT', trend: 'neutral' },
          { sector: 'Auto', trend: 'bearish' }
        ],
        aiConfidence: 0.89,
        summary: "Quantum analysis suggests a bullish opening for NSE driven by strong overnight US tech gains and stabilized crude prices. Watch for volatility in banking sector."
      });
      setLoading(false);
    }, 2000);
    return () => clearTimeout(timer);
  }, []);

  if (loading) return <div className="p-8 text-center text-gray-400 animate-pulse">Initializing Quantum Market Engine...</div>;
  if (!analysis) return <div className="p-8 text-center text-red-400">Error fetching intelligence.</div>;

  return (
    <div className="p-6 space-y-6 bg-[#0a0a0a] min-h-screen text-white">
      <div className="flex justify-between items-center border-b border-gray-800 pb-4">
        <h1 className="text-2xl font-bold tracking-tighter text-blue-400">PREMARKET INTELLIGENCE <span className="text-xs bg-blue-900 px-2 py-1 rounded ml-2">QUANTUM LEVEL</span></h1>
        <div className="text-sm text-gray-500">Confidence: {(analysis.aiConfidence * 100).toFixed(1)}%</div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {/* Gap Prediction Card */}
        <div className="bg-[#141414] p-6 rounded-xl border border-gray-800 shadow-xl">
          <p className="text-gray-400 text-sm mb-2">Predicted Opening Gap</p>
          <p className={`text-4xl font-black ${analysis.predictedGap >= 0 ? 'text-green-400' : 'text-red-400'}`}>
            {analysis.predictedGap > 0 ? '+' : ''}{analysis.predictedGap}%
          </p>
          <div className="mt-4 h-1 w-full bg-gray-800 rounded">
            <div className="h-1 bg-blue-500 rounded" style={{ width: `${analysis.aiConfidence * 100}%` }}></div>
          </div>
        </div>

        {/* Sentiment Score Card */}
        <div className="bg-[#141414] p-6 rounded-xl border border-gray-800 shadow-xl">
          <p className="text-gray-400 text-sm mb-2">Market Sentiment</p>
          <p className={`text-4xl font-black ${analysis.sentimentScore > 0 ? 'text-green-400' : 'text-red-400'}`}>
            {analysis.sentimentScore > 0 ? 'BULLISH' : 'BEARISH'}
          </p>
          <p className="text-xs text-gray-500 mt-2">Score: {analysis.sentimentScore.toFixed(2)}</p>
        </div>

        {/* Volatility Card */}
        <div className="bg-[#141414] p-6 rounded-xl border border-gray-800 shadow-xl">
          <p className="text-gray-400 text-sm mb-2">Volatility Forecast</p>
          <p className="text-4xl font-black text-yellow-400 capitalize">{analysis.volatilityForecast}</p>
          <p className="text-xs text-gray-500 mt-2">Predicted range: High activity expected</p>
        </div>
      </div>

      {/* Sector Trends */}
      <div className="bg-[#141414] p-6 rounded-xl border border-gray-800">
        <h2 className="text-lg font-semibold mb-4 text-blue-300">Sectoral Trend Analysis</h2>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          {analysis.keySectors.map((s, i) => (
            <div key={i} className="flex justify-between items-center p-3 bg-[#1c1c1c] rounded-lg border border-gray-700">
              <span className="font-medium">{s.sector}</span>
              <span className={`text-xs px-2 py-1 rounded uppercase font-bold ${
                s.trend === 'bullish' ? 'bg-green-900 text-green-300' :
                s.trend === 'bearish' ? 'bg-red-900 text-red-300' : 'bg-gray-700 text-gray-300'
              }`}>
                {s.trend}
              </span>
            </div>
          ))}
        </div>
      </div>

      {/* AI Summary */}
      <div className="bg-blue-900/10 border border-blue-800/50 p-6 rounded-xl">
        <div className="flex items-center gap-2 mb-2">
          <div className="w-2 h-2 bg-blue-500 rounded-full animate-ping"></div>
          <h2 className="text-blue-400 font-bold uppercase tracking-wider text-sm">Neural Chat Summary</h2>
        </div>
        <p className="text-gray-200 leading-relaxed italic">"{analysis.summary}"</p>
      </div>
    </div>
  );
}
