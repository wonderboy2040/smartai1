import React, { useState, useCallback } from 'react';
import { useApp } from '../hooks/AppContext';

const PROXY_BASE = import.meta.env.VITE_API_PROXY || '';

interface NewsItem {
  title: string;
  sentiment: 'BULLISH' | 'BEARISH' | 'NEUTRAL';
  impact: 'HIGH' | 'MEDIUM' | 'LOW';
  source: string;
  time: string;
  tickers: string[];
}

interface EarningsEvent {
  symbol: string;
  date: string;
  estimate: string;
  sentiment: string;
  action: string;
}

export const NewsSentimentFeed = React.memo(() => {
  const { portfolio } = useApp();
  const [news, setNews] = useState<NewsItem[]>([]);
  const [earnings, setEarnings] = useState<EarningsEvent[]>([]);
  const [loading, setLoading] = useState(false);
  const [activeTab, setActiveTab] = useState<'news' | 'earnings'>('news');
  const [error, setError] = useState('');

  const analyzeNews = useCallback(async () => {
    setLoading(true);
    setError('');

    try {
      const symbols = portfolio.map(p => p.symbol).join(', ');
      const prompt = `Analyze current market news and earnings for these stocks: ${symbols}.
Return JSON with:
1. "news": array of {title, sentiment (BULLISH/BEARISH/NEUTRAL), impact (HIGH/MEDIUM/LOW), source, tickers[]}
2. "earnings": array of {symbol, date, estimate, sentiment, action}

Focus on:
- Recent earnings surprises or guidance changes
- Macro events affecting these sectors
- FI/DII activity news
- Any regulatory changes

Return ONLY valid JSON, no markdown.`;

      // Route through proxy to avoid exposing API key in browser
      const res = await fetch(`${PROXY_BASE}/api/groq`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: [
            { role: 'system', content: 'You are a financial news analyst. Return JSON only, no markdown formatting.' },
            { role: 'user', content: prompt },
          ],
          model: 'llama-3.3-70b-versatile',
        }),
        signal: AbortSignal.timeout(30000),
      });

      if (!res.ok) throw new Error(`AI proxy error: ${res.status}`);
      const data = await res.json();
      const content = data.choices?.[0]?.message?.content || data.candidates?.[0]?.content?.parts?.[0]?.text || '';

      // Extract JSON from response (may be wrapped in markdown)
      const jsonMatch = content.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]);
        setNews(parsed.news || []);
        setEarnings(parsed.earnings || []);
      } else {
        throw new Error('Could not parse AI response');
      }
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [portfolio]);

  const sentimentColor: Record<string, string> = {
    BULLISH: 'text-emerald-400 bg-emerald-500/10 border-emerald-500/30',
    BEARISH: 'text-red-400 bg-red-500/10 border-red-500/30',
    NEUTRAL: 'text-amber-400 bg-amber-500/10 border-amber-500/30',
  };

  const impactColor: Record<string, string> = {
    HIGH: 'text-red-400',
    MEDIUM: 'text-amber-400',
    LOW: 'text-slate-400',
  };

  return (
    <div className="quantum-panel rounded-2xl p-5 animate-fade-in-up">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <span className="w-6 h-6 rounded-lg bg-blue-500/10 flex items-center justify-center text-xs">📰</span>
          <span className="text-[10px] text-blue-500/70 font-bold uppercase tracking-wider">News & Earnings Sentiment</span>
        </div>
        <div className="flex gap-1">
          <button
            onClick={() => setActiveTab('news')}
            className={`px-3 py-1 rounded-lg text-[10px] font-bold transition-all ${activeTab === 'news' ? 'bg-blue-500/20 text-blue-400 border border-blue-500/30' : 'text-slate-500 hover:text-white'}`}
          >
            News
          </button>
          <button
            onClick={() => setActiveTab('earnings')}
            className={`px-3 py-1 rounded-lg text-[10px] font-bold transition-all ${activeTab === 'earnings' ? 'bg-blue-500/20 text-blue-400 border border-blue-500/30' : 'text-slate-500 hover:text-white'}`}
          >
            Earnings
          </button>
          <button
            onClick={analyzeNews}
            disabled={loading}
            className="px-3 py-1 bg-blue-500/10 border border-blue-500/30 rounded-lg text-[10px] font-bold text-blue-400 hover:bg-blue-500/20 transition-all disabled:opacity-50 ml-2"
          >
            {loading ? '⏳ Analyzing...' : '🧠 Groq Analyze'}
          </button>
        </div>
      </div>

      {error && (
        <div className="mb-3 px-3 py-1.5 bg-red-500/10 border border-red-500/20 rounded-lg text-[10px] text-red-300">{error}</div>
      )}

      {activeTab === 'news' && (
        <div className="space-y-2">
          {news.length === 0 && !loading && (
            <div className="text-center py-6 text-[10px] text-slate-600">
              Click "Groq Analyze" to fetch AI-powered news sentiment
            </div>
          )}
          {news.map(item => (
            <div key={item.title} className="bg-black/30 rounded-xl p-3 border border-white/5">
              <div className="flex items-start justify-between gap-3">
                <div className="flex-1">
                  <div className="text-xs font-bold text-white mb-1">{item.title}</div>
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className={`px-1.5 py-0.5 rounded text-[8px] font-bold border ${sentimentColor[item.sentiment]}`}>
                      {item.sentiment}
                    </span>
                    <span className={`text-[8px] font-bold ${impactColor[item.impact]}`}>
                      {item.impact} Impact
                    </span>
                    <span className="text-[8px] text-slate-600">{item.source}</span>
                    {item.tickers?.length > 0 && (
                      <div className="flex gap-1">
                        {item.tickers.map(t => (
                          <span key={t} className="px-1 py-0.5 bg-cyan-500/10 text-cyan-400 text-[8px] rounded font-mono">{t}</span>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {activeTab === 'earnings' && (
        <div className="space-y-2">
          {earnings.length === 0 && !loading && (
            <div className="text-center py-6 text-[10px] text-slate-600">
              Click "Groq Analyze" to fetch earnings calendar & sentiment
            </div>
          )}
          {earnings.map(e => (
            <div key={`${e.symbol}_${e.date}`} className="bg-black/30 rounded-xl p-3 border border-white/5">
              <div className="flex items-center justify-between">
                <div>
                  <span className="text-xs font-bold text-white font-mono">{e.symbol}</span>
                  <span className="text-[9px] text-slate-500 ml-2">{e.date}</span>
                </div>
                <span className="text-[9px] text-cyan-400 font-mono">{e.estimate}</span>
              </div>
              <div className="flex items-center gap-2 mt-1">
                <span className={`text-[9px] font-bold ${e.sentiment === 'BULLISH' ? 'text-emerald-400' : e.sentiment === 'BEARISH' ? 'text-red-400' : 'text-amber-400'}`}>
                  {e.sentiment}
                </span>
                <span className="text-[9px] text-slate-500">→</span>
                <span className="text-[9px] text-slate-300">{e.action}</span>
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="mt-3 text-[9px] text-slate-600">
        Powered by Groq LLM (llama-3.3-70b). News sentiment is AI-processed, not investment advice.
      </div>
    </div>
  );
});

NewsSentimentFeed.displayName = 'NewsSentimentFeed';
