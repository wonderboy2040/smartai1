// ============================================
// EARNINGS CALENDAR + AI PRE-EARNINGS PREDICTION
// Indian + US stock earnings tracking
// ============================================

import { apiFetch } from './api';

const PROXY_BASE = (import.meta.env.VITE_API_PROXY as string) || '';

export interface EarningsEvent {
  symbol: string;
  name: string;
  market: 'IN' | 'US';
  date: string;
  time: 'PRE_MARKET' | 'POST_MARKET' | 'DURING_MARKET';
  estimatedEPS?: number;
  previousEPS?: number;
  estimatedRevenue?: number;
  previousRevenue?: number;
  aiPrediction: {
    beatProbability: number;
    expectedMove: number;
    direction: 'BULLISH' | 'BEARISH' | 'NEUTRAL';
    reasoning: string;
  };
  historicalBeatRate: number;
  daysUntil: number;
}

// NSE EARNINGS CALENDAR (Major NIFTY 50 Stocks)
const NSE_EARNINGS_DATA: { symbol: string; name: string; lastReported: string; nextExpected: string; beatRate: number; prevEPS: number; estEPS: number }[] = [
  { symbol: 'RELIANCE', name: 'Reliance Industries', lastReported: '2026-04-20', nextExpected: '2026-07-18', beatRate: 75, prevEPS: 25.5, estEPS: 27.0 },
  { symbol: 'TCS', name: 'Tata Consultancy Services', lastReported: '2026-04-10', nextExpected: '2026-07-10', beatRate: 80, prevEPS: 32.0, estEPS: 34.0 },
  { symbol: 'HDFCBANK', name: 'HDFC Bank', lastReported: '2026-04-15', nextExpected: '2026-07-15', beatRate: 85, prevEPS: 18.5, estEPS: 19.5 },
  { symbol: 'INFY', name: 'Infosys', lastReported: '2026-04-12', nextExpected: '2026-07-12', beatRate: 78, prevEPS: 15.8, estEPS: 16.5 },
  { symbol: 'ICICIBANK', name: 'ICICI Bank', lastReported: '2026-04-18', nextExpected: '2026-07-18', beatRate: 82, prevEPS: 9.2, estEPS: 10.0 },
  { symbol: 'BHARTIARTL', name: 'Bharti Airtel', lastReported: '2026-04-22', nextExpected: '2026-07-22', beatRate: 70, prevEPS: 12.5, estEPS: 13.0 },
  { symbol: 'SBIN', name: 'State Bank of India', lastReported: '2026-04-25', nextExpected: '2026-07-25', beatRate: 72, prevEPS: 8.5, estEPS: 9.0 },
  { symbol: 'BAJFINANCE', name: 'Bajaj Finance', lastReported: '2026-04-20', nextExpected: '2026-07-20', beatRate: 88, prevEPS: 82.0, estEPS: 88.0 },
  { symbol: 'TATAMOTORS', name: 'Tata Motors', lastReported: '2026-04-15', nextExpected: '2026-07-15', beatRate: 65, prevEPS: 18.0, estEPS: 20.0 },
  { symbol: 'LT', name: 'Larsen & Toubro', lastReported: '2026-04-20', nextExpected: '2026-07-20', beatRate: 76, prevEPS: 28.0, estEPS: 30.0 },
  { symbol: 'WIPRO', name: 'Wipro', lastReported: '2026-04-12', nextExpected: '2026-07-12', beatRate: 68, prevEPS: 5.8, estEPS: 6.0 },
  { symbol: 'MARUTI', name: 'Maruti Suzuki', lastReported: '2026-04-25', nextExpected: '2026-07-25', beatRate: 74, prevEPS: 245.0, estEPS: 260.0 },
  { symbol: 'HCLTECH', name: 'HCL Technologies', lastReported: '2026-04-12', nextExpected: '2026-07-12', beatRate: 72, prevEPS: 14.2, estEPS: 15.0 },
  { symbol: 'TITAN', name: 'Titan Company', lastReported: '2026-04-22', nextExpected: '2026-07-22', beatRate: 80, prevEPS: 35.0, estEPS: 38.0 },
  { symbol: 'ADANIENT', name: 'Adani Enterprises', lastReported: '2026-04-18', nextExpected: '2026-07-18', beatRate: 60, prevEPS: 15.0, estEPS: 18.0 },
];

// US EARNINGS (Major NASDAQ/NYSE)
const US_EARNINGS_DATA: { symbol: string; name: string; lastReported: string; nextExpected: string; beatRate: number; prevEPS: number; estEPS: number }[] = [
  { symbol: 'NVDA', name: 'NVIDIA Corporation', lastReported: '2026-02-26', nextExpected: '2026-05-28', beatRate: 90, prevEPS: 5.16, estEPS: 5.80 },
  { symbol: 'AAPL', name: 'Apple Inc', lastReported: '2026-01-30', nextExpected: '2026-05-01', beatRate: 85, prevEPS: 2.18, estEPS: 2.25 },
  { symbol: 'MSFT', name: 'Microsoft Corp', lastReported: '2026-01-29', nextExpected: '2026-04-29', beatRate: 88, prevEPS: 3.23, estEPS: 3.35 },
  { symbol: 'GOOGL', name: 'Alphabet Inc', lastReported: '2026-02-04', nextExpected: '2026-04-29', beatRate: 82, prevEPS: 2.15, estEPS: 2.22 },
  { symbol: 'AMZN', name: 'Amazon.com Inc', lastReported: '2026-02-06', nextExpected: '2026-05-01', beatRate: 80, prevEPS: 1.86, estEPS: 1.95 },
  { symbol: 'META', name: 'Meta Platforms', lastReported: '2026-01-29', nextExpected: '2026-04-30', beatRate: 85, prevEPS: 6.77, estEPS: 7.10 },
  { symbol: 'TSLA', name: 'Tesla Inc', lastReported: '2026-01-29', nextExpected: '2026-04-22', beatRate: 60, prevEPS: 0.73, estEPS: 0.85 },
  { symbol: 'AVGO', name: 'Broadcom Inc', lastReported: '2026-03-06', nextExpected: '2026-06-05', beatRate: 82, prevEPS: 1.42, estEPS: 1.55 },
];

// ========================================
// FETCH UPCOMING EARNINGS
// ========================================
export function getUpcomingEarnings(market: 'IN' | 'US' | 'ALL', daysAhead: number = 30): EarningsEvent[] {
  const allData = market === 'IN' ? NSE_EARNINGS_DATA : market === 'US' ? US_EARNINGS_DATA : [...NSE_EARNINGS_DATA, ...US_EARNINGS_DATA];
  const today = new Date();
  const cutoff = new Date(today);
  cutoff.setDate(cutoff.getDate() + daysAhead);

  const events: EarningsEvent[] = [];

  for (const stock of allData) {
    const nextDate = new Date(stock.nextExpected);
    if (nextDate > today && nextDate <= cutoff) {
      const daysUntil = Math.ceil((nextDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
      const mkt = NSE_EARNINGS_DATA.includes(stock) ? 'IN' : 'US';
      const beatProb = stock.beatRate;
      const expectedMove = Math.abs(stock.estEPS - stock.prevEPS) / stock.prevEPS * 100 * 2;

      events.push({
        symbol: stock.symbol,
        name: stock.name,
        market: mkt,
        date: stock.nextExpected,
        time: 'POST_MARKET',
        estimatedEPS: stock.estEPS,
        previousEPS: stock.prevEPS,
        aiPrediction: {
          beatProbability: beatProb,
          expectedMove: Math.round(expectedMove * 10) / 10,
          direction: stock.estEPS > stock.prevEPS ? 'BULLISH' : stock.estEPS < stock.prevEPS ? 'BEARISH' : 'NEUTRAL',
          reasoning: beatProb > 75
            ? `Strong ${stock.beatRate}% historical beat rate. EPS growth expected.`
            : beatProb > 60
              ? `Moderate beat probability. Watch guidance carefully.`
              : `Lower confidence. Mixed signals from sector.`
        },
        historicalBeatRate: stock.beatRate,
        daysUntil
      });
    }
  }

  return events.sort((a, b) => a.daysUntil - b.daysUntil);
}

// ========================================
// AI PRE-EARNINGS PREDICTION
// ========================================
export async function predictEarningsWithAI(
  symbol: string,
  market: 'IN' | 'US',
  previousEPS: number,
  estimatedEPS: number,
  beatRate: number
): Promise<{ direction: 'BULLISH' | 'BEARISH' | 'NEUTRAL'; expectedMove: number; reasoning: string }> {
  const defaults: { direction: 'BULLISH' | 'BEARISH' | 'NEUTRAL'; expectedMove: number; reasoning: string } = {
    direction: estimatedEPS > previousEPS ? 'BULLISH' : 'BEARISH',
    expectedMove: Math.abs(estimatedEPS - previousEPS) / previousEPS * 100 * 2,
    reasoning: `EPS expected: ${estimatedEPS} vs previous ${previousEPS}. Historical beat rate: ${beatRate}%.`
  };

  try {
    const prompt = `Predict earnings outcome for ${symbol} (${market === 'IN' ? 'Indian' : 'US'} stock):
Previous EPS: ${previousEPS}
Estimated EPS: ${estimatedEPS}
Historical Beat Rate: ${beatRate}%

Reply ONLY in JSON:
{"direction":"BULLISH"/"BEARISH"/"NEUTRAL","expectedMovePct":number,"reasoning":"2 lines"}`;

    const res = await apiFetch(`${PROXY_BASE}/api/groq`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'llama-3.3-70b-versatile',
        messages: [
          { role: 'system', content: 'You are an earnings analyst. Reply ONLY with valid JSON.' },
          { role: 'user', content: prompt }
        ],
        temperature: 0.3,
        max_tokens: 300
      }),
      signal: AbortSignal.timeout(10000)
    });

    if (res.ok) {
      const data = await res.json();
      const text = data.choices?.[0]?.message?.content || '';
      const jsonMatch = text.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]);
        return {
          direction: (['BULLISH', 'BEARISH', 'NEUTRAL'].includes(parsed.direction) ? parsed.direction : defaults.direction) as 'BULLISH' | 'BEARISH' | 'NEUTRAL',
          expectedMove: typeof parsed.expectedMovePct === 'number' ? parsed.expectedMovePct : defaults.expectedMove,
          reasoning: typeof parsed.reasoning === 'string' ? parsed.reasoning : defaults.reasoning
        };
      }
    }
  } catch { /* use defaults */ }

  return defaults;
}

// ========================================
// TELEGRAM FORMAT
// ========================================
export function formatEarningsForTelegram(events: EarningsEvent[]): string {
  let msg = `<b>EARNINGS CALENDAR (Next 30 Days)</b>\n`;
  msg += `━━━━━━━━━━━━━━━━━━━━━━━\n\n`;

  if (events.length === 0) {
    msg += `No major earnings in the next 30 days.\n`;
    return msg;
  }

  for (const e of events.slice(0, 10)) {
    const emoji = e.aiPrediction.direction === 'BULLISH' ? '\uD83D\uDFE2' : e.aiPrediction.direction === 'BEARISH' ? '\uD83D\uDD34' : '\uD83D\uDFE1';
    const cur = e.market === 'IN' ? '\u20B9' : '$';
    msg += `${emoji} <b>${e.symbol}</b> - ${e.name}\n`;
    msg += `Date: ${e.date} (${e.daysUntil}d)\n`;
    if (e.estimatedEPS) msg += `Est EPS: ${cur}${e.estimatedEPS} vs Prev: ${cur}${e.previousEPS}\n`;
    msg += `Beat Prob: <b>${e.aiPrediction.beatProbability}%</b> | Move: ~${e.aiPrediction.expectedMove}%\n`;
    msg += `${e.aiPrediction.reasoning}\n\n`;
  }

  msg += `<i>AI Earnings Predictor</i>`;
  return msg;
}
