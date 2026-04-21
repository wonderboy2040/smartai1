import { useState, useEffect, useCallback } from 'react';
import { PremarketAnalysis } from '../types';

const PREMARKET_TICKERS = [
  'NSE:GIFT_NIFTY', 'NSE:GIFTYNIFTY',
  'CME_MINI:ES1!', 'CME_MINI:NQ1!',
  'TVC:NI225', 'TVC:HSI', 'XETR:DAX',
  'TVC:DXY', 'COMEX:GC1!', 'NYMEX:CL1!',
  'NSE:BANKNIFTY', 'NSE:CNXIT', 'NSE:CNXFIN'
];

const TICKER_NAMES: Record<string, string> = {
  'NSE:GIFT_NIFTY': 'GIFT Nifty', 'NSE:GIFTYNIFTY': 'GIFT Nifty',
  'CME_MINI:ES1!': 'S&P 500 Fut', 'CME_MINI:NQ1!': 'NASDAQ Fut',
  'TVC:NI225': 'Nikkei 225', 'TVC:HSI': 'Hang Seng', 'XETR:DAX': 'DAX',
  'TVC:DXY': 'DXY Dollar', 'COMEX:GC1!': 'Gold', 'NYMEX:CL1!': 'Crude Oil',
  'NSE:BANKNIFTY': 'Bank Nifty', 'NSE:CNXIT': 'IT Sector', 'NSE:CNXFIN': 'Finance Sector'
};

const SECTOR_TICKERS: Record<string, string> = {
  'NSE:BANKNIFTY': 'Nifty Bank', 'NSE:CNXIT': 'IT', 'NSE:CNXFIN': 'Finance'
};

export function PremarketTab() {
  const [analysis, setAnalysis] = useState<PremarketAnalysis | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchPremarket = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('https://scanner.tradingview.com/global/scan', {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain;charset=UTF-8' },
        body: JSON.stringify({ symbols: { tickers: PREMARKET_TICKERS }, columns: ['close', 'change'] }),
        signal: AbortSignal.timeout(10000)
      });

      if (!res.ok) throw new Error('API unavailable');

      const data = await res.json();
      if (!data?.data || data.data.length === 0) throw new Error('No data returned');

      const results: Record<string, { price: number; change: number }> = {};
      const seen = new Set<string>();
      for (const item of data.data) {
        const name = TICKER_NAMES[item.s];
        if (!name || seen.has(name)) continue;
        seen.add(name);
        const price = parseFloat(item.d?.[0]) || 0;
        const change = parseFloat(item.d?.[1]) || 0;
        if (price > 0) results[item.s] = { price, change };
      }

      if (Object.keys(results).length === 0) throw new Error('No valid price data');

      let giftChange = 0;
      let esChange = 0;
      let nqChange = 0;
      let goldChange = 0;
      let crudeChange = 0;
      const sectorTrends: { sector: string; trend: 'bullish' | 'bearish' | 'neutral' }[] = [];

      for (const [ticker, val] of Object.entries(results)) {
        if (ticker.includes('GIFT')) giftChange = val.change;
        if (ticker === 'CME_MINI:ES1!') esChange = val.change;
        if (ticker === 'CME_MINI:NQ1!') nqChange = val.change;
        if (ticker === 'COMEX:GC1!') goldChange = val.change;
        if (ticker === 'NYMEX:CL1!') crudeChange = val.change;
        if (SECTOR_TICKERS[ticker]) {
          sectorTrends.push({
            sector: SECTOR_TICKERS[ticker],
            trend: val.change > 0.5 ? 'bullish' : val.change < -0.5 ? 'bearish' : 'neutral'
          });
        }
      }

      const avgUS = (esChange + nqChange) / 2;
      const predictedGap = giftChange !== 0 ? giftChange : avgUS * 0.6;
      const sentimentScore = Math.max(-1, Math.min(1, (giftChange * 0.4 + avgUS * 0.3 + goldChange * 0.15 + crudeChange * 0.15) / 2));
      const volatilityForecast = Math.abs(giftChange) > 1 || Math.abs(avgUS) > 1.5 ? 'high' : Math.abs(giftChange) > 0.3 || Math.abs(avgUS) > 0.5 ? 'medium' : 'low';

      const dataPoints = Object.keys(results).length;
      const aiConfidence = Math.min(0.95, 0.4 + (dataPoints / PREMARKET_TICKERS.length) * 0.55);

      let summary = '';
      if (giftChange > 0.5 || avgUS > 0.5) {
        summary = `Strong pre-market signals detected. GIFT Nifty at ${giftChange >= 0 ? '+' : ''}${giftChange.toFixed(2)}%, US Futures ${avgUS >= 0 ? '+' : ''}${avgUS.toFixed(2)}%. Gap-Up opening likely. Bullish momentum expected at open.`;
      } else if (giftChange < -0.5 || avgUS < -0.5) {
        summary = `Weak pre-market conditions. GIFT Nifty at ${giftChange.toFixed(2)}%, US Futures ${avgUS.toFixed(2)}%. Gap-Down risk elevated. Wait for first 15-min candle break before entry.`;
      } else {
        summary = `Mixed pre-market signals. GIFT Nifty ${giftChange >= 0 ? '+' : ''}${giftChange.toFixed(2)}%, US Futures ${avgUS >= 0 ? '+' : ''}${avgUS.toFixed(2)}%. Flat to rangebound opening expected. Watch for directional breakout.`;
      }
      if (goldChange > 0.5) summary += ' Gold rising — risk-off sentiment.';
      if (crudeChange > 1) summary += ' Crude oil spike — watch India fiscal impact.';

      if (sectorTrends.length === 0) {
        sectorTrends.push(
          { sector: 'Nifty Bank', trend: giftChange > 0.3 ? 'bullish' : giftChange < -0.3 ? 'bearish' : 'neutral' },
          { sector: 'IT', trend: avgUS > 0.3 ? 'bullish' : avgUS < -0.3 ? 'bearish' : 'neutral' },
          { sector: 'Auto', trend: 'neutral' }
        );
      }

      setAnalysis({
        market: 'IN',
        predictedGap: Math.round(predictedGap * 100) / 100,
        sentimentScore: Math.round(sentimentScore * 100) / 100,
        volatilityForecast,
        keySectors: sectorTrends,
        aiConfidence: Math.round(aiConfidence * 100) / 100,
        summary
      });
    } catch (e: any) {
      setError(e.message || 'Failed to fetch premarket data');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchPremarket();
    const interval = setInterval(fetchPremarket, 60000);
    return () => clearInterval(interval);
  }, [fetchPremarket]);

  if (loading && !analysis) return <div className="p-8 text-center text-gray-400 animate-pulse">Fetching live pre-market data...</div>;
  if (error && !analysis) return (
    <div className="p-8 text-center">
      <div className="text-red-400 mb-4">Error: {error}</div>
      <button onClick={fetchPremarket} className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 text-sm">Retry</button>
    </div>
  );
  if (!analysis) return <div className="p-8 text-center text-gray-400">No data available.</div>;

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
