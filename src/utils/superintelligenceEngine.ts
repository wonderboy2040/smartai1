// ============================================================
// SUPERINTELLIGENCE ENGINE v6.0 (composite SuperScore)
// ------------------------------------------------------------
// Aggregates real-time market data + portfolio-specific news +
// live prices + macro context into a single context blob that
// the LLM (or Quant Brain fallback) can reason over.
//
// Data sources (all real-time, 24x7):
//   1. /api/quote            — live prices for portfolio holdings
//   2. /api/crypto-prices    — CoinDCX INR crypto tickers
//   3. /api/forex            — USD/INR rate
//   4. /api/inflation        — India + US CPI
//   5. /api/tavily           — live web news (per-holding + macro)
//   6. TradingView scanner   — global indices + bonds
//   7. Portfolio context     — positions, P&L, technicals (passed in)
//
// Output: a structured "SuperintelligenceContext" blob suitable
// for injection into the LLM system prompt, OR for Quant Brain
// deterministic analysis when all LLMs fail.
// ============================================================

import { Position, PriceData } from '../types';
import { isCryptoSymbol } from './constants';
import { apiFetch } from './api';

const PROXY_BASE = (import.meta.env.VITE_API_PROXY as string) || '';

export interface MarketSnapshot {
  nifty?: number; niftyChange?: number;
  sensex?: number; sensexChange?: number;
  bankNifty?: number; bankNiftyChange?: number;
  spy?: number; spyChange?: number;
  qqq?: number; qqqChange?: number;
  usVix?: number; usVixChange?: number;
  indiaVix?: number; indiaVixChange?: number;
  dxy?: number; dxyChange?: number;
  gold?: number; goldChange?: number;
  crude?: number; crudeChange?: number;
  btcINR?: number; btcChange?: number;
  ethINR?: number; ethChange?: number;
  usdInr?: number;
  india10Y?: number; us10Y?: number;
  indiaInflation?: number; usInflation?: number;
  fetchedAt: number;
}

export interface PortfolioNewsItem {
  symbol: string;
  headline: string;
  source?: string;
  url?: string;
  publishedDate?: string;
  sentiment: 'positive' | 'negative' | 'neutral';
  summary: string;
}

export interface PortfolioSignal {
  symbol: string;
  market: 'IN' | 'US';
  currentPrice: number;
  change: number;
  rsi: number;
  signal: 'STRONG_BUY' | 'BUY' | 'HOLD' | 'SELL' | 'STRONG_SELL';
  confidence: number;
  reason: string;
  // Derived "inside story" insights from price action + news
  insideStory: string;
  // v6 SUPERSCORE: composite directional score 1-99 (>65 = buy-leaning, <35 = sell-leaning)
  // Weights: RSI zone 35% | SMA20/50 divergence 25% | MACD 15% |
  // day-range position 15% | anti-chasing momentum 10%
  superScore?: number;
  volume?: number;
  // Where price sits inside today's high-low range (0 = day low, 1 = day high)
  dayRangePos?: number;
}

export interface SuperintelligenceContext {
  market: MarketSnapshot;
  portfolioSignals: PortfolioSignal[];
  portfolioNews: PortfolioNewsItem[];
  macroNews: PortfolioNewsItem[];
  portfolioSummary: {
    totalValueINR: number;
    totalInvestedINR: number;
    totalPLINR: number;
    totalPLPct: number;
    todayPLINR: number;
    positionCount: number;
    topGainer?: { symbol: string; pct: number };
    topLoser?: { symbol: string; pct: number };
  };
  regime: 'RISK_ON' | 'NEUTRAL' | 'RISK_OFF' | 'GOLDILOCKS' | 'STAGFLATION';
  regimeReason: string;
  warnings: string[];
  opportunities: string[];
  formattedContext: string;  // ready-to-inject LLM prompt block
  fetchedAt: number;
}

// ---------- 1. Live market snapshot ----------
async function fetchMarketSnapshot(): Promise<MarketSnapshot> {
  const snap: MarketSnapshot = { fetchedAt: Date.now() };
  const nameMap: Record<string, keyof MarketSnapshot> = {
    'NSE:NIFTY': 'nifty', 'BSE:SENSEX': 'sensex', 'NSE:BANKNIFTY': 'bankNifty',
    'AMEX:SPY': 'spy', 'NASDAQ:QQQ': 'qqq', 'CBOE:VIX': 'usVix',
    'NSE:INDIAVIX': 'indiaVix', 'TVC:DXY': 'dxy', 'COMEX:GC1!': 'gold',
    'NYMEX:CL1!': 'crude',
  };
  const changeMap: Record<string, keyof MarketSnapshot> = {
    'NSE:NIFTY': 'niftyChange', 'BSE:SENSEX': 'sensexChange', 'NSE:BANKNIFTY': 'bankNiftyChange',
    'AMEX:SPY': 'spyChange', 'NASDAQ:QQQ': 'qqqChange', 'CBOE:VIX': 'usVixChange',
    'NSE:INDIAVIX': 'indiaVixChange', 'TVC:DXY': 'dxyChange', 'COMEX:GC1!': 'goldChange',
    'NYMEX:CL1!': 'crudeChange',
  };

  const tasks: Promise<void>[] = [];

  // TradingView global scanner
  tasks.push((async () => {
    try {
      const r = await fetch('https://scanner.tradingview.com/global/scan', {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain;charset=UTF-8' },
        body: JSON.stringify({
          symbols: { tickers: Object.keys(nameMap) },
          columns: ['name', 'close', 'change'],
        }),
        signal: AbortSignal.timeout(5000),
      });
      if (r.ok) {
        const data = await r.json();
        for (const item of (data?.data || [])) {
          const field = nameMap[item.s];
          const changeField = changeMap[item.s];
          if (field) (snap as any)[field] = parseFloat(item.d?.[1]) || 0;
          if (changeField) (snap as any)[changeField] = parseFloat(item.d?.[2]) || 0;
        }
      }
    } catch { /* noop */ }
  })());

  // Crypto via server proxy
  tasks.push((async () => {
    try {
      const r = await apiFetch(`${PROXY_BASE}/api/crypto-prices?t=${Date.now()}`, {
        signal: AbortSignal.timeout(5000),
      });
      if (r.ok) {
        const tickers = await r.json();
        const byMarket = new Map<string, any>();
        for (const t of tickers) byMarket.set(t.market, t);
        const btc = byMarket.get('BTCINR');
        if (btc) { snap.btcINR = parseFloat(btc.last_price) || 0; snap.btcChange = parseFloat(btc.change_24_hour) || 0; }
        const eth = byMarket.get('ETHINR');
        if (eth) { snap.ethINR = parseFloat(eth.last_price) || 0; snap.ethChange = parseFloat(eth.change_24_hour) || 0; }
      }
    } catch { /* noop */ }
  })());

  // Forex
  tasks.push((async () => {
    try {
      const r = await apiFetch(`${PROXY_BASE}/api/forex?t=${Date.now()}`, { signal: AbortSignal.timeout(4000) });
      if (r.ok) { const j = await r.json(); snap.usdInr = j.usdInr; }
    } catch { /* noop */ }
  })());

  // Inflation
  tasks.push((async () => {
    try {
      const r = await apiFetch(`${PROXY_BASE}/api/inflation?t=${Date.now()}`, { signal: AbortSignal.timeout(4000) });
      if (r.ok) {
        const j = await r.json();
        snap.indiaInflation = j.india;
        snap.usInflation = j.us;
      }
    } catch { /* noop */ }
  })());

  // Bond yields
  tasks.push((async () => {
    try {
      const r = await fetch('https://scanner.tradingview.com/bond/scan', {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain;charset=UTF-8' },
        body: JSON.stringify({
          symbols: { tickers: ['TVC:US10Y', 'TVC:IN10Y'] },
          columns: ['description', 'close', 'change'],
        }),
        signal: AbortSignal.timeout(5000),
      });
      if (r.ok) {
        const data = await r.json();
        for (const item of (data?.data || [])) {
          if (item.s === 'TVC:US10Y') snap.us10Y = parseFloat(item.d?.[1]) || 0;
          if (item.s === 'TVC:IN10Y') snap.india10Y = parseFloat(item.d?.[1]) || 0;
        }
      }
    } catch { /* noop */ }
  })());

  await Promise.allSettled(tasks);
  return snap;
}

// ---------- 2. Portfolio signals (per-holding) ----------
function computePortfolioSignals(
  portfolio: Position[],
  livePrices: Record<string, PriceData>,
  _usdInrRate: number
): PortfolioSignal[] {
  const signals: PortfolioSignal[] = [];
  for (const p of portfolio) {
    const key = `${String(p.market || 'IN').toUpperCase()}_${p.symbol}`;
    const d = livePrices[key];
    const price = d?.price ?? p.avgPrice;
    const change = d?.change ?? 0;
    const rsi = d?.rsi ?? 50;
    const sma20 = d?.sma20;
    const sma50 = d?.sma50;
    const macd = d?.macd;

    // Signal
    let signal: PortfolioSignal['signal'] = 'HOLD';
    let confidence = 50;
    let reason = 'Neutral — wait for confirmation';
    if (rsi < 30) { signal = 'STRONG_BUY'; confidence = 90; reason = `RSI ${rsi.toFixed(0)} oversold`; }
    else if (rsi < 40) { signal = 'BUY'; confidence = 75; reason = `RSI ${rsi.toFixed(0)} approaching oversold`; }
    else if (rsi > 75) { signal = 'STRONG_SELL'; confidence = 85; reason = `RSI ${rsi.toFixed(0)} overbought`; }
    else if (rsi > 65) { signal = 'SELL'; confidence = 65; reason = `RSI ${rsi.toFixed(0)} elevated`; }

    // Trend confirmation
    if (sma20 && sma50) {
      if (sma20 > sma50 && (signal === 'STRONG_BUY' || signal === 'BUY')) {
        confidence = Math.min(99, confidence + 10);
        reason += '; SMA20>SMA50 bullish';
      } else if (sma50 > sma20 && (signal === 'STRONG_SELL' || signal === 'SELL')) {
        confidence = Math.min(99, confidence + 10);
        reason += '; SMA50>SMA20 bearish';
      }
    }
    if (macd !== undefined) {
      if (macd > 0 && (signal === 'STRONG_BUY' || signal === 'BUY')) {
        confidence = Math.min(99, confidence + 5);
        reason += '; MACD positive';
      } else if (macd < 0 && (signal === 'STRONG_SELL' || signal === 'SELL')) {
        confidence = Math.min(99, confidence + 5);
        reason += '; MACD negative';
      }
    }

    // ---------- v6 SUPERSCORE (composite directional, 1-99) ----------
    let score = 50;
    score += rsi < 30 ? 20 : rsi < 40 ? 10 : rsi > 75 ? -20 : rsi > 65 ? -10 : 0;      // 35% zone
    if (sma20 && sma50 && sma50 > 0) {                                                 // 25% trend
      const divergencePct = ((sma20 - sma50) / sma50) * 100;
      score += Math.max(-15, Math.min(15, divergencePct * 3));
    }
    if (macd !== undefined) score += macd > 0 ? 8 : -8;                                // 15% macd
    const hi = d?.high ?? price;
    const lo = d?.low ?? price;
    const dayRangePos = hi > lo ? (price - lo) / (hi - lo) : 0.5;                      // 15% range seat
    score += (0.5 - dayRangePos) * 12; // closer to day low = better entry
    score += change > 4 ? -6 : change > 0 ? 2 : change > -4 ? 4 : 6;                   // 10% anti-chasing
    const superScore = Math.max(1, Math.min(99, Math.round(score)));
    const volume = d?.volume;

    // "Inside story" — derive from price action + technicals + v6 score verdict
    let insideStory = deriveInsideStory(p, price, change, rsi, sma20, sma50, macd);
    insideStory += ` | ⚡SuperScore ${superScore}/99 ${superScore >= 65 ? '🔥 BUY-LEAN' : superScore <= 35 ? '⚠️ SELL-LEAN' : '⚪ NEUTRAL'}`;

    signals.push({
      symbol: p.symbol,
      market: p.market,
      currentPrice: price,
      change,
      rsi,
      signal,
      confidence,
      reason,
      insideStory,
      superScore,
      volume,
      dayRangePos,
    });
  }
  return signals;
}

function deriveInsideStory(
  p: Position,
  price: number,
  change: number,
  rsi: number,
  sma20?: number,
  sma50?: number,
  macd?: number
): string {
  const stories: string[] = [];
  const isCrypto = isCryptoSymbol(p.symbol);
  const plPct = p.avgPrice > 0 ? ((price - p.avgPrice) / p.avgPrice) * 100 : 0;

  // Price-action story
  if (change > 3) stories.push(`🔥 +${change.toFixed(1)}% strong rally — momentum buyers active`);
  else if (change < -3) stories.push(`⚠️ ${change.toFixed(1)}% sharp drop — panic selling or news-driven`);
  else if (change > 0) stories.push(`📈 +${change.toFixed(1)}% steady buying`);
  else if (change < 0) stories.push(`📉 ${change.toFixed(1)}% mild selling`);

  // RSI story
  if (rsi < 30) stories.push(`💎 RSI ${rsi.toFixed(0)} = deep oversold — institutional accumulation zone`);
  else if (rsi > 75) stories.push(`🚨 RSI ${rsi.toFixed(0)} = overbought — distribution risk, book partials`);
  else if (rsi < 40) stories.push(`🟢 RSI ${rsi.toFixed(0)} = approaching value zone`);
  else if (rsi > 65) stories.push(`🟠 RSI ${rsi.toFixed(0)} = elevated, momentum cooling`);

  // SMA story
  if (sma20 && sma50) {
    if (sma20 > sma50) stories.push(`🟢 Golden Cross (SMA20>SMA50) — uptrend intact`);
    else stories.push(`🔴 Death Cross (SMA50>SMA20) — downtrend`);
  }

  // MACD story
  if (macd !== undefined) {
    if (macd > 0) stories.push(`📈 MACD positive — bullish momentum`);
    else stories.push(`📉 MACD negative — bearish momentum`);
  }

  // P&L story
  if (plPct > 15) stories.push(`💰 +${plPct.toFixed(0)}% profit — consider trailing SL`);
  else if (plPct < -15) stories.push(`💸 ${plPct.toFixed(0)}% loss — review thesis, average only if fundamentals intact`);

  // Crypto-specific
  if (isCrypto && Math.abs(change) > 5) stories.push(`🪙 High-volatility crypto move — position size accordingly`);

  return stories.join(' · ');
}

// ---------- 3. Portfolio-specific news (via Tavily) ----------
async function fetchPortfolioNews(
  portfolio: Position[],
  _usdInrRate: number
): Promise<{ portfolioNews: PortfolioNewsItem[]; macroNews: PortfolioNewsItem[] }> {
  // Build a combined query covering the user's top 5 holdings + macro keywords.
  const topHoldings = [...portfolio]
    .sort((a, b) => (b.avgPrice * b.qty) - (a.avgPrice * a.qty))
    .slice(0, 5)
    .map(p => p.symbol.replace('.NS', '').replace('.BO', ''));

  if (topHoldings.length === 0) {
    // Just macro news
    const macroNews = await fetchTavilyNews('India stock market NIFTY today news Fed RBI inflation crude gold');
    return { portfolioNews: [], macroNews };
  }

  const portfolioQuery = `${topHoldings.join(' ')} stock news latest quarterly results insider trading institutional moves`;
  const macroQuery = 'India NIFTY SENSEX US Fed RBI inflation crude oil gold market regime today';

  const [pNews, mNews] = await Promise.all([
    fetchTavilyNews(portfolioQuery),
    fetchTavilyNews(macroQuery),
  ]);

  // Tag each portfolio news item with the matching symbol + crude sentiment.
  const tagged: PortfolioNewsItem[] = pNews.map(n => {
    const sym = topHoldings.find(s => n.headline.toUpperCase().includes(s) || n.summary.toUpperCase().includes(s));
    return { ...n, symbol: sym || 'PORTFOLIO' };
  });

  return { portfolioNews: tagged, macroNews: mNews };
}

async function fetchTavilyNews(query: string): Promise<PortfolioNewsItem[]> {
  try {
    const res = await apiFetch(`${PROXY_BASE}/api/tavily`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ messages: [{ role: 'user', content: query }] }),
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return [];
    const data = await res.json();
    const text = data?.choices?.[0]?.message?.content || '';
    // Tavily returns "answer + Sources:" format. Parse both.
    const items: PortfolioNewsItem[] = [];
    const lines = text.split('\n');
    for (const line of lines) {
      const m = line.match(/^\s*[•\-\d]+\s*(.+?):\s*(.+)$/);
      if (m) {
        const headline = m[1].trim();
        const summary = m[2].trim();
        const sentiment = classifySentiment(headline + ' ' + summary);
        items.push({
          symbol: 'PORTFOLIO',
          headline,
          summary: summary.substring(0, 250),
          sentiment,
          publishedDate: new Date().toISOString().split('T')[0],
        });
        // (currentHeadline tracking removed — unused)
      } else if (line.trim().startsWith('http')) {
        if (items.length > 0 && !items[items.length - 1].url) {
          items[items.length - 1].url = line.trim();
        }
      }
    }
    return items.slice(0, 8);
  } catch { return []; }
}

function classifySentiment(text: string): 'positive' | 'negative' | 'neutral' {
  const positive = /\b(beat|surge|rally|gain|profit|growth|upgrade|buy|bullish|record|high|jump|rise|boost|strong|outperform)\b/i;
  const negative = /\b(miss|fall|drop|decline|loss|downgrade|sell|bearish|low|crash|plunge|weak|underperform|fraud|scam|investigation|default)\b/i;
  if (positive.test(text) && !negative.test(text)) return 'positive';
  if (negative.test(text) && !positive.test(text)) return 'negative';
  return 'neutral';
}

// ---------- 4. Regime detection ----------
function detectRegime(snap: MarketSnapshot): { regime: SuperintelligenceContext['regime']; reason: string } {
  const usVix = snap.usVix ?? 15;
  const inVix = snap.indiaVix ?? 15;
  const avgVix = (usVix + inVix) / 2;
  const niftyChange = snap.niftyChange ?? 0;
  const spyChange = snap.spyChange ?? 0;
  const dxy = snap.dxy ?? 104;
  const goldChange = snap.goldChange ?? 0;

  let regime: SuperintelligenceContext['regime'] = 'NEUTRAL';
  let reason = '';

  if (avgVix < 14 && niftyChange > 0 && spyChange > 0) {
    regime = 'GOLDILOCKS';
    reason = `Low VIX (${avgVix.toFixed(1)}) + positive equity breadth = ideal risk-on`;
  } else if (avgVix > 25 && niftyChange < -1 && spyChange < -1) {
    regime = 'STAGFLATION';
    reason = `High VIX (${avgVix.toFixed(1)}) + negative equity = stagflation risk`;
  } else if (avgVix > 22 || (niftyChange < -1.5 && spyChange < -1.5)) {
    regime = 'RISK_OFF';
    reason = `Elevated VIX (${avgVix.toFixed(1)}) or sharp selloff = risk-off`;
  } else if (niftyChange > 0.5 && spyChange > 0.3 && avgVix < 18) {
    regime = 'RISK_ON';
    reason = `Positive momentum + moderate VIX (${avgVix.toFixed(1)}) = risk-on`;
  } else {
    regime = 'NEUTRAL';
    reason = `Mixed signals, VIX ${avgVix.toFixed(1)} = neutral`;
  }

  if (dxy > 106) reason += '; strong USD (DXY >106) = FII outflow risk for India';
  if (goldChange > 1.5) reason += '; gold rally = safe-haven demand rising';

  return { regime, reason };
}

// ---------- 5. Warnings + opportunities ----------
function deriveWarningsAndOpportunities(
  signals: PortfolioSignal[],
  snap: MarketSnapshot,
  news: PortfolioNewsItem[]
): { warnings: string[]; opportunities: string[] } {
  const warnings: string[] = [];
  const opportunities: string[] = [];

  // Overbought positions
  const overbought = signals.filter(s => s.rsi > 75);
  if (overbought.length > 0) {
    warnings.push(`⚠️ ${overbought.length} position(s) overbought: ${overbought.map(s => s.symbol).join(', ')} — book partial profits`);
  }

  // Oversold positions
  const oversold = signals.filter(s => s.rsi < 30);
  if (oversold.length > 0) {
    opportunities.push(`💎 ${oversold.length} oversold position(s): ${oversold.map(s => s.symbol).join(', ')} — accumulation zone`);
  }

  // High VIX
  const avgVix = ((snap.usVix ?? 15) + (snap.indiaVix ?? 15)) / 2;
  if (avgVix > 25) {
    warnings.push(`🚨 VIX elevated (${avgVix.toFixed(1)}) — reduce position sizes, hedge with puts`);
  } else if (avgVix < 13) {
    opportunities.push(`✅ VIX ultra-low (${avgVix.toFixed(1)}) — complacency, consider protective puts`);
  }

  // Negative news on holdings
  const negativeNews = news.filter(n => n.sentiment === 'negative');
  if (negativeNews.length > 0) {
    warnings.push(`📰 Negative news on: ${negativeNews.slice(0, 3).map(n => n.headline.substring(0, 50)).join('; ')}`);
  }
  const positiveNews = news.filter(n => n.sentiment === 'positive');
  if (positiveNews.length > 0) {
    opportunities.push(`📰 Positive catalyst: ${positiveNews.slice(0, 3).map(n => n.headline.substring(0, 50)).join('; ')}`);
  }

  // Sharp movers
  const sharpUp = signals.filter(s => s.change > 4);
  if (sharpUp.length > 0) opportunities.push(`🔥 Sharp rally: ${sharpUp.map(s => `${s.symbol} +${s.change.toFixed(1)}%`).join(', ')}`);
  const sharpDown = signals.filter(s => s.change < -4);
  if (sharpDown.length > 0) warnings.push(`⚠️ Sharp drop: ${sharpDown.map(s => `${s.symbol} ${s.change.toFixed(1)}%`).join(', ')}`);

  // v6: VOLUME-BREAKOUT anomalies (big move + heavy volume = institutional footprint)
  const volumeBreakouts = signals.filter(s => Math.abs(s.change) > 3 && (s.volume ?? 0) > 1_000_000);
  for (const vb of volumeBreakouts.slice(0, 3)) {
    if (vb.change > 0) opportunities.push(`💥 VOLUME BREAKOUT: ${vb.symbol} +${vb.change.toFixed(1)}% on heavy tape — institutions buying`);
    else warnings.push(`💥 VOLUME SELL-OFF: ${vb.symbol} ${vb.change.toFixed(1)}% on heavy tape — distribution risk`);
  }

  // v6: SUPERSCORE extremes (5-factor alignment — rarer & more reliable than RSI alone)
  const extremeBuy = signals.filter(s => (s.superScore ?? 50) >= 78);
  if (extremeBuy.length > 0) opportunities.push(`⚡ SuperScore EXTREME-BUY: ${extremeBuy.map(s => `${s.symbol} (${s.superScore})`).join(', ')} — multi-factor alignment`);
  const extremeSell = signals.filter(s => (s.superScore ?? 50) <= 22);
  if (extremeSell.length > 0) warnings.push(`⚡ SuperScore EXTREME-SELL: ${extremeSell.map(s => `${s.symbol} (${s.superScore})`).join(', ')} — multi-factor breakdown`);

  return { warnings, opportunities };
}

// ---------- 6. Format the full context for LLM injection ----------
function formatContext(ctx: SuperintelligenceContext): string {
  const m = ctx.market;
  const fmt = (n: number | undefined, digits = 2) => n != null ? n.toFixed(digits) : 'N/A';
  const fmtPct = (n: number | undefined) => n != null ? `${n >= 0 ? '+' : ''}${n.toFixed(2)}%` : 'N/A';

  let out = `=== SUPERINTELLIGENCE LIVE CONTEXT v6.0 ===
Time: ${new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })} IST

--- LIVE MARKET SNAPSHOT ---
NIFTY: ${fmt(m.nifty)} (${fmtPct(m.niftyChange)})
SENSEX: ${fmt(m.sensex)} (${fmtPct(m.sensexChange)})
BANKNIFTY: ${fmt(m.bankNifty)} (${fmtPct(m.bankNiftyChange)})
S&P 500 (SPY): ${fmt(m.spy)} (${fmtPct(m.spyChange)})
NASDAQ 100 (QQQ): ${fmt(m.qqq)} (${fmtPct(m.qqqChange)})
US VIX: ${fmt(m.usVix)} (${fmtPct(m.usVixChange)})
INDIA VIX: ${fmt(m.indiaVix)} (${fmtPct(m.indiaVixChange)})
DXY: ${fmt(m.dxy)} (${fmtPct(m.dxyChange)})
GOLD: ${fmt(m.gold)} (${fmtPct(m.goldChange)})
CRUDE OIL: ${fmt(m.crude)} (${fmtPct(m.crudeChange)})
BTC/INR: ${fmt(m.btcINR, 0)} (${fmtPct(m.btcChange)})
ETH/INR: ${fmt(m.ethINR, 0)} (${fmtPct(m.ethChange)})
USD/INR: ${fmt(m.usdInr, 4)}
India 10Y: ${fmt(m.india10Y, 3)}% | US 10Y: ${fmt(m.us10Y, 3)}%
India Inflation: ${fmt(m.indiaInflation, 1)}% | US Inflation: ${fmt(m.usInflation, 1)}%

--- MARKET REGIME: ${ctx.regime} ---
${ctx.regimeReason}

--- PORTFOLIO SUMMARY ---
Total Value: ₹${Math.round(ctx.portfolioSummary.totalValueINR).toLocaleString('en-IN')}
Total Invested: ₹${Math.round(ctx.portfolioSummary.totalInvestedINR).toLocaleString('en-IN')}
Total P&L: ${ctx.portfolioSummary.totalPLINR >= 0 ? '+' : ''}₹${Math.round(ctx.portfolioSummary.totalPLINR).toLocaleString('en-IN')} (${ctx.portfolioSummary.totalPLPct.toFixed(2)}%)
Today P&L: ${ctx.portfolioSummary.todayPLINR >= 0 ? '+' : ''}₹${Math.round(ctx.portfolioSummary.todayPLINR).toLocaleString('en-IN')}
Positions: ${ctx.portfolioSummary.positionCount}
${ctx.portfolioSummary.topGainer ? `Top Gainer: ${ctx.portfolioSummary.topGainer.symbol} (+${ctx.portfolioSummary.topGainer.pct.toFixed(2)}%)` : ''}
${ctx.portfolioSummary.topLoser ? `Top Loser: ${ctx.portfolioSummary.topLoser.symbol} (${ctx.portfolioSummary.topLoser.pct.toFixed(2)}%)` : ''}

--- PORTFOLIO SIGNALS (per-holding, top 10 by confidence) ---
`;

  // FIX H5: slice to top 10 by confidence so the LLM system prompt doesn't
  // grow unbounded for 30+ position portfolios (token bloat + context overflow).
  const topSignals = [...ctx.portfolioSignals].sort((a, b) => b.confidence - a.confidence).slice(0, 10);
  for (const s of topSignals) {
    const cur = s.market === 'IN' ? '₹' : '$';
    out += `• ${s.symbol} [${s.market}] — ${cur}${s.currentPrice.toFixed(2)} (${s.change >= 0 ? '+' : ''}${s.change.toFixed(2)}%) | RSI ${s.rsi.toFixed(0)} | Signal: ${s.signal} (${s.confidence}% conf) | ⚡SuperScore: ${s.superScore ?? '—'}/99 | ${s.reason}\n`;
    out += `  Inside Story: ${s.insideStory}\n`;
  }

  if (ctx.portfolioNews.length > 0) {
    out += `\n--- PORTFOLIO-SPECIFIC NEWS ---\n`;
    for (const n of ctx.portfolioNews.slice(0, 6)) {
      out += `[${n.sentiment.toUpperCase()}] ${n.headline}\n  ${n.summary}\n`;
    }
  }

  if (ctx.macroNews.length > 0) {
    out += `\n--- MACRO NEWS ---\n`;
    for (const n of ctx.macroNews.slice(0, 4)) {
      out += `[${n.sentiment.toUpperCase()}] ${n.headline}\n  ${n.summary}\n`;
    }
  }

  if (ctx.warnings.length > 0) {
    out += `\n--- ⚠️ WARNINGS ---\n`;
    for (const w of ctx.warnings) out += `${w}\n`;
  }

  if (ctx.opportunities.length > 0) {
    out += `\n--- 💡 OPPORTUNITIES ---\n`;
    for (const o of ctx.opportunities) out += `${o}\n`;
  }

  out += `\n=== END CONTEXT ===\n`;
  return out;
}

// ---------- Main entry: build full Superintelligence context ----------
export async function buildSuperintelligenceContext(
  portfolio: Position[],
  livePrices: Record<string, PriceData>,
  usdInrRate: number,
  _portfolioContextText: string
): Promise<SuperintelligenceContext> {
  // Fire all data fetches in parallel.
  const [market, newsResult] = await Promise.all([
    fetchMarketSnapshot(),
    fetchPortfolioNews(portfolio, usdInrRate),
  ]);

  // FIX L4: `??` only catches null/undefined, not 0. If /api/forex ever
  // returns usdInr=0 (broken), use the passed-in fallback instead.
  const usdInr = market.usdInr || usdInrRate;
  const signals = computePortfolioSignals(portfolio, livePrices, usdInr);
  const { regime, reason } = detectRegime(market);
  const { warnings, opportunities } = deriveWarningsAndOpportunities(signals, market, newsResult.portfolioNews);

  // Portfolio summary
  let totalValue = 0, totalInvested = 0, todayPL = 0;
  let topGainer: { symbol: string; pct: number } | undefined;
  let topLoser: { symbol: string; pct: number } | undefined;
  for (const p of portfolio) {
    const key = `${String(p.market || 'IN').toUpperCase()}_${p.symbol}`;
    const d = livePrices[key];
    const price = d?.price ?? p.avgPrice;
    const change = d?.change ?? 0;
    const val = price * p.qty;
    const inv = p.avgPrice * p.qty;
    // FIX L6: normalize market to uppercase so lowercase 'us' from legacy
    // persisted data still triggers INR conversion.
    const isUS = String(p.market || 'IN').toUpperCase() === 'US';
    const valINR = isUS ? val * usdInr : val;
    const invINR = isUS ? inv * usdInr : inv;
    totalValue += valINR;
    totalInvested += invINR;
    // FIX M5: guard against near-100% drops (e.g. -99% → price/0.01 = 100x).
    // Treat any |change| >= 95% as data error → use current price as prev.
    const prevPrice = Math.abs(change) >= 95 ? price : price / (1 + change / 100);
    const dayPL = (price - prevPrice) * p.qty;
    todayPL += isUS ? dayPL * usdInr : dayPL;
    // FIX M6: only set topGainer/topLoser when there's an actual move (>0.01%),
    // otherwise single-position portfolios show "Top Gainer: X (+0.00%)".
    if (change > 0.01 && (!topGainer || change > topGainer.pct)) topGainer = { symbol: p.symbol, pct: change };
    if (change < -0.01 && (!topLoser || change < topLoser.pct)) topLoser = { symbol: p.symbol, pct: change };
  }

  const ctx: SuperintelligenceContext = {
    market,
    portfolioSignals: signals,
    portfolioNews: newsResult.portfolioNews,
    macroNews: newsResult.macroNews,
    portfolioSummary: {
      totalValueINR: totalValue,
      totalInvestedINR: totalInvested,
      totalPLINR: totalValue - totalInvested,
      totalPLPct: totalInvested > 0 ? ((totalValue - totalInvested) / totalInvested) * 100 : 0,
      todayPLINR: todayPL,
      positionCount: portfolio.length,
      topGainer,
      topLoser,
    },
    regime,
    regimeReason: reason,
    warnings,
    opportunities,
    formattedContext: '',  // filled below
    fetchedAt: Date.now(),
  };

  ctx.formattedContext = formatContext(ctx);
  return ctx;
}

// ---------- Quant Brain fallback (deterministic, no LLM) ----------
export function quantBrainSuperintelligence(
  userMessage: string,
  ctx: SuperintelligenceContext
): string {
  const m = ctx.market;
  const fmt = (n: number | undefined, digits = 2) => n != null ? n.toFixed(digits) : 'N/A';
  const fmtPct = (n: number | undefined) => n != null ? `${n >= 0 ? '+' : ''}${n.toFixed(2)}%` : 'N/A';

  let out = `🧠 **SUPERINTELLIGENCE QUANT BRAIN v6.0**
━━━━━━━━━━━━━━━━━━━━━━━━━━━

⏰ ${new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })} IST
🔍 Query: ${userMessage}

📊 **MARKET REGIME: ${ctx.regime}**
${ctx.regimeReason}

**LIVE SNAPSHOT:**
🇮🇳 NIFTY: ${fmt(m.nifty)} (${fmtPct(m.niftyChange)}) | SENSEX: ${fmt(m.sensex)} (${fmtPct(m.sensexChange)})
🇺🇸 SPY: ${fmt(m.spy)} (${fmtPct(m.spyChange)}) | QQQ: ${fmt(m.qqq)} (${fmtPct(m.qqqChange)})
⚠️ VIX: US ${fmt(m.usVix)} | INDIA ${fmt(m.indiaVix)}
🛢️ Crude: ${fmt(m.crude)} (${fmtPct(m.crudeChange)}) | 🥇 Gold: ${fmt(m.gold)} (${fmtPct(m.goldChange)})
💎 BTC: ₹${fmt(m.btcINR, 0)} (${fmtPct(m.btcChange)}) | ETH: ₹${fmt(m.ethINR, 0)} (${fmtPct(m.ethChange)})
💵 USD/INR: ${fmt(m.usdInr, 4)}

💼 **PORTFOLIO:** ₹${(ctx.portfolioSummary.totalValueINR / 100000).toFixed(1)}L value | ${ctx.portfolioSummary.totalPLPct >= 0 ? '+' : ''}${ctx.portfolioSummary.totalPLPct.toFixed(2)}% P&L | Today: ${ctx.portfolioSummary.todayPLINR >= 0 ? '+' : ''}₹${Math.round(ctx.portfolioSummary.todayPLINR).toLocaleString('en-IN')}
`;

  if (ctx.portfolioSignals.length > 0) {
    out += `\n**PORTFOLIO SIGNALS:**\n`;
    // FIX H3: sort a COPY, not the original array (mutating ctx.portfolioSignals
    // would silently reorder it for any later caller).
    const sortedSignals = [...ctx.portfolioSignals].sort((a, b) => b.confidence - a.confidence);
    for (const s of sortedSignals.slice(0, 8)) {
      const cur = s.market === 'IN' ? '₹' : '$';
      const emoji = s.signal === 'STRONG_BUY' ? '🟢' : s.signal === 'BUY' ? '🟢' : s.signal === 'SELL' ? '🔴' : s.signal === 'STRONG_SELL' ? '🔴' : '🟡';
      out += `${emoji} ${s.symbol}: ${cur}${s.currentPrice.toFixed(2)} (${s.change >= 0 ? '+' : ''}${s.change.toFixed(2)}%) — ${s.signal} (${s.confidence}%)\n`;
      out += `   ${s.insideStory}\n`;
    }
  }

  if (ctx.warnings.length > 0) {
    out += `\n**⚠️ WARNINGS:**\n`;
    for (const w of ctx.warnings) out += `• ${w}\n`;
  }
  if (ctx.opportunities.length > 0) {
    out += `\n**💡 OPPORTUNITIES:**\n`;
    for (const o of ctx.opportunities) out += `• ${o}\n`;
  }

  if (ctx.portfolioNews.length > 0) {
    out += `\n**📰 PORTFOLIO NEWS:**\n`;
    for (const n of ctx.portfolioNews.slice(0, 4)) {
      out += `[${n.sentiment === 'positive' ? '🟢' : n.sentiment === 'negative' ? '🔴' : '⚪'}] ${n.headline}\n`;
    }
  }

  out += `\n**7-STEP ANALYSIS:**
1. Regime: **${ctx.regime}** — ${ctx.regimeReason}
2. Trend: ${ctx.portfolioSignals.filter(s => s.change > 0).length}/${ctx.portfolioSignals.length} positions green
3. Momentum: ${ctx.portfolioSignals.filter(s => s.rsi < 40).length} oversold, ${ctx.portfolioSignals.filter(s => s.rsi > 65).length} overbought
4. Risk: ${((m.usVix ?? 15) + (m.indiaVix ?? 15)) / 2 > 22 ? '⚠️ Elevated VIX — reduce size' : '✅ Normal'}
5. Conviction: ${ctx.portfolioSignals.filter(s => s.confidence > 70).length} high-conviction signals
6. Action: ${ctx.regime === 'RISK_ON' ? 'Aggressive — buy dips' : ctx.regime === 'RISK_OFF' ? 'Defensive — raise cash' : 'Selective — stock-specific'}
7. Top pick: ${[...ctx.portfolioSignals].sort((a, b) => (b.superScore ?? b.confidence) - (a.superScore ?? a.confidence))[0]?.symbol || 'N/A'} (⚡SuperScore ranked)

⚡ LLM narration unavailable — Quant Brain deterministic analysis. All API keys free: Gemini (aistudio.google.com), Groq (console.groq.com)`;

  return out;
}

// ---------- System prompt builder for LLM ----------
export function buildSuperintelligenceSystemPrompt(ctx: SuperintelligenceContext): string {
  return `You are SUPERINTELLIGENCE v6.0 — a market superintelligence with REAL-TIME 24x7 market data + portfolio-specific news + live technicals. You have FULL access to the user's portfolio and live market data below.

PERSONA: Elite institutional quant trader (20+ years NSE/BSE/NYSE/NASDAQ/Crypto). Think Goldman Sachs + Citadel + Renaissance + Pantera combined. Speak SIMPLE Hinglish — "bhai", "dekho", "simple words me". Explain like talking to a smart friend.

SUPERINTELLIGENCE MANDATE (24x7):
1. READ the live market data + portfolio context below — it's REAL-TIME, use it
2. For EVERY portfolio query, reference 2-3 specific positions with current price + signal
3. For EVERY market query, use the live snapshot (NIFTY/SPY/VIX/etc.) — NOT stale memory
4. For portfolio-specific news, mention the headline + your "inside story" interpretation
5. NEVER say "I don't have data" — it's ALL provided below
6. Connect MACRO (Fed/RBI/rates/inflation/DXY) WITH MICRO (user's holdings)

7-STEP FRAMEWORK (use for every analysis):
1. Regime: Risk-On / Neutral / Risk-Off (use VIX + breadth)
2. Trend: Direction from SMA + price action
3. Momentum: RSI + MACD analysis per holding
4. Support/Demand: Key price levels
5. Risk: SL distance, R:R ratio, position sizing
6. Conviction: STRONG_BUY / BUY / HOLD / WAIT / SELL
7. Action: EXACT entry, SL, targets, size (no vague "buy around X")

RESPONSE STYLE:
- Start with 1-line macro snapshot in Hinglish
- Connect macro → micro: what it means for user's holdings
- Use bullet points for levels (entry/SL/targets)
- Bold for key numbers
- End with "💡 Pro Tip:" actionable insight
- For trade queries: EXACT entry, SL, 2 targets, R:R
- For portfolio queries: every position analyzed with verdict
- For risk queries: VaR, drawdown, concentration, hedge suggestions

=== ${ctx.formattedContext} ===`;
}
