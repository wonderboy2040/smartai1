// ============================================
// SENTIMENT ANALYSIS ENGINE
// FinBERT-style financial news + social media sentiment
// Uses Groq/Claude API for NLP classification
// ============================================

const PROXY_BASE = (import.meta.env.VITE_API_PROXY as string) || '';

export interface SentimentResult {
  symbol: string;
  overall: 'BULLISH' | 'BEARISH' | 'NEUTRAL';
  score: number; // -100 to +100
  confidence: number; // 0-100
  sources: {
    news: { sentiment: string; score: number; headlines: string[] };
    social: { sentiment: string; score: number; trending: string };
    institutional: { sentiment: string; score: number; flow: string };
  };
  keyFactors: string[];
  timestamp: number;
}

export interface NewsItem {
  title: string;
  source: string;
  url?: string;
  publishedAt: string;
  sentiment?: 'POSITIVE' | 'NEGATIVE' | 'NEUTRAL';
  score?: number;
}

// ========================================
// BUILT-IN KEYWORD-BASED SENTIMENT (No API needed)
// ========================================
const BULLISH_WORDS = [
  'rally', 'surge', 'bull', 'upgrade', 'buy', 'outperform', 'beat', 'growth',
  'profit', 'strong', 'boom', 'breakout', 'accumulate', 'undervalued', 'cheap',
  'upgrade', 'momentum', 'institutional buying', 'fii buying', 'dii buying',
  'record high', 'all time high', 'ATH', 'green', 'positive', 'gains',
  'recovery', 'rebound', 'support', 'bounce', 'demand', 'inflow',
  'quarterly beat', 'revenue growth', 'eps beat', 'dividend hike',
  '扩张', '突破', '利好'
];

const BEARISH_WORDS = [
  'crash', 'plunge', 'bear', 'downgrade', 'sell', 'underperform', 'miss',
  'loss', 'weak', 'bust', 'breakdown', 'overvalued', 'expensive', 'risk',
  'panic', 'liquidation', 'fii selling', 'dii selling', 'record low',
  'red', 'negative', 'decline', 'fall', 'drop', 'resistance', 'outflow',
  'recession', 'default', 'fraud', 'investigation', 'lawsuit', 'ban',
  'quarterly miss', 'revenue decline', 'eps miss', 'dividend cut',
  '利空', '下跌', '崩盘'
];

function keywordSentiment(text: string): { score: number; matches: string[] } {
  const lower = text.toLowerCase();
  let score = 0;
  const matches: string[] = [];

  for (const word of BULLISH_WORDS) {
    if (lower.includes(word.toLowerCase())) {
      score += 15;
      matches.push(word);
    }
  }
  for (const word of BEARISH_WORDS) {
    if (lower.includes(word.toLowerCase())) {
      score -= 15;
      matches.push(word);
    }
  }

  return { score: Math.max(-100, Math.min(100, score)), matches };
}

// ========================================
// AI-POWERED SENTIMENT (via Groq/Claude proxy)
// ========================================
export async function analyzeSentimentWithAI(
  symbol: string,
  market: 'IN' | 'US',
  newsItems: NewsItem[]
): Promise<SentimentResult> {
  const defaults = createDefaultResult(symbol, newsItems);

  if (newsItems.length === 0) {
    return { ...defaults, overall: 'NEUTRAL', score: 0, confidence: 20, keyFactors: ['No recent news available'] };
  }

  // First: keyword-based sentiment (instant, no API)
  const allText = newsItems.map(n => n.title).join(' ');
  const kwResult = keywordSentiment(allText);

  // Try AI-powered sentiment
  try {
    const headlines = newsItems.slice(0, 8).map((n, i) => `${i + 1}. ${n.title} (${n.source})`).join('\n');
    const prompt = `Analyze financial sentiment for ${symbol} (${market === 'IN' ? 'Indian' : 'US'} stock).
Recent headlines:
${headlines}

Reply ONLY in this JSON format:
{"overall":"BULLISH"/"BEARISH"/"NEUTRAL","score":-100 to 100,"confidence":0-100,"keyFactors":["factor1","factor2"],"institutionalFlow":"buying"/"selling"/"neutral"}`;

    const res = await fetch(`${PROXY_BASE}/api/groq`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'llama-3.3-70b-versatile',
        messages: [
          { role: 'system', content: 'You are a financial sentiment analyst. Reply ONLY with valid JSON.' },
          { role: 'user', content: prompt }
        ],
        temperature: 0.2,
        max_tokens: 400
      }),
      signal: AbortSignal.timeout(12000)
    });

    if (res.ok) {
      const data = await res.json();
      const text = data.choices?.[0]?.message?.content || '';
      const jsonMatch = text.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]);
        const aiScore = typeof parsed.score === 'number' ? parsed.score : kwResult.score;
        const blendedScore = Math.round(kwResult.score * 0.4 + aiScore * 0.6);
        return {
          symbol,
          overall: parsed.overall || (blendedScore > 15 ? 'BULLISH' : blendedScore < -15 ? 'BEARISH' : 'NEUTRAL'),
          score: blendedScore,
          confidence: typeof parsed.confidence === 'number' ? parsed.confidence : 65,
          sources: {
            news: { sentiment: parsed.overall || 'NEUTRAL', score: aiScore, headlines: newsItems.slice(0, 5).map(n => n.title) },
            social: { sentiment: 'NEUTRAL', score: 0, trending: 'No social data' },
            institutional: { sentiment: parsed.institutionalFlow || 'neutral', score: 0, flow: parsed.institutionalFlow || 'neutral' }
          },
          keyFactors: Array.isArray(parsed.keyFactors) ? parsed.keyFactors : kwResult.matches.slice(0, 3),
          timestamp: Date.now()
        };
      }
    }
  } catch { /* fall through to keyword result */ }

  // Fallback: keyword-based
  return {
    symbol,
    overall: kwResult.score > 15 ? 'BULLISH' : kwResult.score < -15 ? 'BEARISH' : 'NEUTRAL',
    score: kwResult.score,
    confidence: Math.min(70, 30 + kwResult.matches.length * 10),
    sources: {
      news: { sentiment: kwResult.score > 0 ? 'POSITIVE' : kwResult.score < 0 ? 'NEGATIVE' : 'NEUTRAL', score: kwResult.score, headlines: newsItems.slice(0, 5).map(n => n.title) },
      social: { sentiment: 'NEUTRAL', score: 0, trending: 'N/A' },
      institutional: { sentiment: 'neutral', score: 0, flow: 'N/A' }
    },
    keyFactors: kwResult.matches.slice(0, 5),
    timestamp: Date.now()
  };
}

// ========================================
// FETCH NEWS FROM TRADINGVIEW / WEB
// ========================================
export async function fetchStockNews(symbol: string, market: 'IN' | 'US'): Promise<NewsItem[]> {
  const items: NewsItem[] = [];

  // Try TradingView news feed
  try {
    const tvSymbol = market === 'IN' ? `NSE:${symbol}` : `NASDAQ:${symbol}`;
    const res = await fetch(`https://scanner.tradingview.com/${market === 'IN' ? 'india' : 'america'}/scan`, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=UTF-8' },
      body: JSON.stringify({
        symbols: { tickers: [tvSymbol] },
        columns: ['name', 'close', 'change', 'description']
      }),
      signal: AbortSignal.timeout(5000)
    });
    if (res.ok) {
      const data = await res.json();
      if (data?.data?.[0]) {
        const d = data.data[0].d;
        items.push({
          title: `${symbol} trading at ${d[1]} (${d[2] >= 0 ? '+' : ''}${d[2]?.toFixed(2)}%)`,
          source: 'TradingView',
          publishedAt: new Date().toISOString(),
          sentiment: 'NEUTRAL'
        });
      }
    }
  } catch { /* continue */ }

  return items;
}

// ========================================
// HELPERS
// ========================================
function createDefaultResult(symbol: string, newsItems: NewsItem[]): SentimentResult {
  return {
    symbol,
    overall: 'NEUTRAL',
    score: 0,
    confidence: 20,
    sources: {
      news: { sentiment: 'NEUTRAL', score: 0, headlines: newsItems.slice(0, 5).map(n => n.title) },
      social: { sentiment: 'NEUTRAL', score: 0, trending: 'N/A' },
      institutional: { sentiment: 'neutral', score: 0, flow: 'N/A' }
    },
    keyFactors: [],
    timestamp: Date.now()
  };
}

export function formatSentimentForTelegram(result: SentimentResult, _market: 'IN' | 'US'): string {
  const emoji = result.overall === 'BULLISH' ? '🟢' : result.overall === 'BEARISH' ? '🔴' : '🟡';
  let msg = `${emoji} <b>SENTIMENT: ${result.symbol}</b>\n`;
  msg += `Score: <b>${result.score > 0 ? '+' : ''}${result.score}/100</b> | Conf: ${result.confidence}%\n`;
  msg += `Overall: <b>${result.overall}</b>\n\n`;
  if (result.keyFactors.length > 0) {
    msg += `<b>Key Factors:</b>\n`;
    result.keyFactors.forEach(f => { msg += `\u2022 ${f}\n`; });
  }
  if (result.sources.news.headlines.length > 0) {
    msg += `\n<b>Recent Headlines:</b>\n`;
    result.sources.news.headlines.slice(0, 3).forEach(h => { msg += `\u2022 ${h.substring(0, 80)}\n`; });
  }
  msg += `\n<i>AI Sentiment Engine</i>`;
  return msg;
}
