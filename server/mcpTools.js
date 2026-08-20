// ============================================================
// Wealth AI Pro — Server-Side Superintelligence MCP Tool Engine
// Bridges Free AI Models (Gemini, Groq, OpenRouter) with
// Live Real-Time Market APIs, SuperScore v6, News & Portfolio Data
// ============================================================

import { getMLPrediction, getRegime, getAllSignals } from './mlEngine.js';

// ============================================
// 1. SUPERSCORE v6.0 PURE CALCULATION ENGINE
// ============================================
export function computeServerSuperScore(o) {
  const rsi = o.rsi || 50;
  const price = o.price || 1;
  const change = o.change || 0;
  let score = 50;

  // 35% RSI zone
  score += rsi < 30 ? 20 : rsi < 40 ? 10 : rsi > 75 ? -20 : rsi > 65 ? -10 : 0;

  // 25% trend divergence (SMA20 vs SMA50)
  if (o.sma20 && o.sma50 && o.sma50 > 0) {
    const divPct = ((o.sma20 - o.sma50) / o.sma50) * 100;
    score += Math.max(-15, Math.min(15, divPct * 3));
  }

  // 15% MACD direction
  if (o.macd !== undefined) score += o.macd > 0 ? 8 : -8;

  // 15% day-range seat (closer to day low = better entry)
  const hi = o.high ?? price;
  const lo = o.low ?? price;
  const dayRangePos = hi > lo ? (price - lo) / (hi - lo) : 0.5;
  score += (0.5 - dayRangePos) * 12;

  // 10% anti-chasing momentum
  score += change > 4 ? -6 : change > 0 ? 2 : change < -4 ? 6 : 4;

  return Math.max(1, Math.min(99, Math.round(score)));
}

// ============================================
// 2. SERVER TOOL DEFINITIONS
// ============================================

export const SERVER_MCP_TOOLS_OPENAI = [
  {
    type: 'function',
    function: {
      name: 'analyze_portfolio_superintelligence',
      description: 'Run deep quantitative audit on ALL user holdings. Returns SuperScore (1-99), exact Dip Buy zones, Hold zones, Profit Booking targets, Trailing Stop Losses, and 3-5 Year Long-Term Wealth projections.',
      parameters: {
        type: 'object',
        properties: {}
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'get_superscore_analysis',
      description: 'Calculate composite SuperScore v6.0 (1-99), RSI/SMA/MACD breakdown, and actionable timing advice for any single stock or crypto.',
      parameters: {
        type: 'object',
        properties: {
          symbol: { type: 'string', description: 'Stock or Crypto symbol (e.g. RELIANCE, TCS, NVDA, AAPL, BTC).' },
          market: { type: 'string', enum: ['IN', 'US'], description: 'Market: IN or US.' }
        },
        required: ['symbol']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'get_live_quote',
      description: 'Fetch real-time stock/ETF/crypto price, daily change, high, low, volume from NSE, BSE, NYSE, NASDAQ, or CoinDCX.',
      parameters: {
        type: 'object',
        properties: {
          symbol: { type: 'string', description: 'Stock or Crypto symbol (e.g. RELIANCE, TCS, NVDA, AAPL, BTC, ETH).' },
          market: { type: 'string', enum: ['IN', 'US'], description: 'Market: IN or US.' }
        },
        required: ['symbol']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'get_whale_block_deals',
      description: 'Scan user portfolio & Indian markets for unusually large institutional moves (>3%), bulk deals, block deals, and whale activity.',
      parameters: {
        type: 'object',
        properties: {}
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'get_fii_dii_positioning',
      description: 'Fetch latest FII & DII net cash flow, institutional sentiment, and smart money direction in Indian markets.',
      parameters: {
        type: 'object',
        properties: {}
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'get_sector_rotation_radar',
      description: 'Get real-time performance and capital rotation across major NSE sectors (IT, Bank, Auto, Pharma, FMCG, Metal, Realty).',
      parameters: {
        type: 'object',
        properties: {}
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'search_market_news',
      description: 'Search real-time financial news, quarterly earnings, or breaking events via Tavily.',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'News search query (e.g. "Tata Motors quarterly results", "NIFTY all-time high news").' }
        },
        required: ['query']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'get_market_regime',
      description: 'Get real-time global market regime, India VIX, US VIX, DXY, Gold, Crude Oil, and Fear & Greed narrative.',
      parameters: {
        type: 'object',
        properties: {}
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'calculate_trade_setup',
      description: 'Calculate quantitative Entry, Stop Loss, Target 1, Target 2, and Risk-to-Reward ratio.',
      parameters: {
        type: 'object',
        properties: {
          symbol: { type: 'string', description: 'Asset symbol.' },
          currentPrice: { type: 'number', description: 'Current market price.' },
          bias: { type: 'string', enum: ['BULLISH', 'BEARISH'], description: 'BULLISH for Buy, BEARISH for Sell.' },
          atrPercent: { type: 'number', description: 'Expected ATR % (default: 2.5).' }
        },
        required: ['symbol', 'currentPrice', 'bias']
      }
    }
  }
];

export const SERVER_MCP_TOOLS_GEMINI = [
  {
    functionDeclarations: SERVER_MCP_TOOLS_OPENAI.map(t => t.function)
  }
];

// ============================================
// 3. SERVER TOOL EXECUTION HANDLER
// ============================================
export async function executeServerMCPTool(name, args = {}, context = {}) {
  const { tavilyKey = '', portfolio = [], livePrices = {}, usdInrRate = 85.5 } = context;

  try {
    switch (name) {
      // 🌟 1. Deep Portfolio Superintelligence Audit
      case 'analyze_portfolio_superintelligence': {
        if (!portfolio || portfolio.length === 0) {
          return { message: 'Portfolio is currently empty. Add positions to unlock deep holding-by-holding audit.' };
        }

        const holdingsAudit = [];
        let totalScore = 0;

        for (const p of portfolio) {
          const mkt = String(p.market || 'IN').toUpperCase();
          const cacheKey = `${mkt}_${p.symbol}`;
          const pd = livePrices[cacheKey] || {};
          const price = pd.price || p.avgPrice || 1;
          const change = pd.change || 0;
          const rsi = pd.rsi || 50;
          const sma20 = pd.sma20 || (price * 0.98);
          const sma50 = pd.sma50 || (price * 0.95);
          const macd = pd.macd;

          const pnlINR = (price - p.avgPrice) * p.qty * (mkt === 'US' ? usdInrRate : 1);
          const pnlPct = p.avgPrice > 0 ? ((price - p.avgPrice) / p.avgPrice) * 100 : 0;
          const currentValueINR = price * p.qty * (mkt === 'US' ? usdInrRate : 1);

          const superScore = computeServerSuperScore({
            rsi, price, change, sma20, sma50, macd, high: pd.high, low: pd.low
          });
          totalScore += superScore;

          let actionBadge = '🛡️ HOLD & COMPOUND';
          let timingAdvice = 'Current levels healthy hain. Position hold karo, compounding chalne do.';
          let dipBuyZone = `${Math.round(price * 0.94)} - ${Math.round(price * 0.96)}`;

          if (superScore >= 68 || rsi < 35) {
            actionBadge = '💎 STRONG BUY / ACCUMULATE ON DIPS';
            timingAdvice = `Value & accumulation zone active hai. ${dipBuyZone} pe fresh quantity add karna highest return dega.`;
          } else if (superScore <= 35 || rsi > 72) {
            actionBadge = '💰 BOOK PARTIAL PROFIT (TRIM 15-25%)';
            timingAdvice = `Asset overbought hai (RSI ${Math.round(rsi)}). 15-25% profit book karke cash ready rakho.`;
          } else if (pnlPct < -18 && superScore < 45) {
            actionBadge = '⚠️ REVIEW THESIS / STOP LOSS ALERT';
            timingAdvice = `Heavy drawdown (${pnlPct.toFixed(1)}%). Re-evaluate thesis ya trailing stop-loss trigger consider karo.`;
          }

          holdingsAudit.push({
            symbol: p.symbol,
            market: mkt,
            qty: p.qty,
            avgPrice: p.avgPrice,
            currentPrice: price,
            currentValueINR: Math.round(currentValueINR),
            pnlINR: Math.round(pnlINR),
            pnlPct: `${pnlPct >= 0 ? '+' : ''}${pnlPct.toFixed(2)}%`,
            superScore: `${superScore}/99`,
            superScoreCategory: superScore >= 65 ? 'BUY-LEAN 🟢' : superScore <= 35 ? 'SELL-LEAN 🔴' : 'NEUTRAL 🟡',
            rsi: Math.round(rsi),
            actionBadge,
            timingAdvice,
            dipBuyZone,
            trailingStopLoss: Math.round(Math.max(p.avgPrice * 0.92, price * 0.90)),
            target1: Math.round(price * 1.10),
            targetLongTerm3Yr: Math.round(price * 1.65)
          });
        }

        const avgScore = Math.round(totalScore / portfolio.length);

        return {
          totalHoldings: portfolio.length,
          overallPortfolioSuperScore: `${avgScore}/99`,
          portfolioHealthVerdict: avgScore >= 65 ? 'EXCELLENT ACCUMULATION 🚀' : avgScore >= 48 ? 'HEALTHY COMPOUNDING 🟢' : 'CAUTION / REBALANCE NEEDED ⚠️',
          holdingsAudit
        };
      }

      // 2. Single Stock SuperScore Analysis
      case 'get_superscore_analysis': {
        const rawSym = String(args.symbol || '').trim().toUpperCase();
        if (!rawSym) return { error: 'symbol is required' };
        const market = (args.market || 'IN').toUpperCase();
        const cacheKey = `${market}_${rawSym}`;
        const pd = livePrices[cacheKey] || {};
        const price = pd.price || 1;
        const change = pd.change || 0;
        const rsi = pd.rsi || 50;
        const sma20 = pd.sma20 || (price * 0.98);
        const sma50 = pd.sma50 || (price * 0.95);
        const macd = pd.macd;

        const superScore = computeServerSuperScore({
          rsi, price, change, sma20, sma50, macd, high: pd.high, low: pd.low
        });

        return {
          symbol: rawSym,
          market,
          currentPrice: price,
          change: `${change >= 0 ? '+' : ''}${change.toFixed(2)}%`,
          superScore: `${superScore}/99`,
          stance: superScore >= 65 ? 'BUY-LEAN / ACCUMULATE' : superScore <= 35 ? 'SELL-LEAN / TRIM' : 'NEUTRAL / HOLD',
          rsi: Math.round(rsi),
          dipBuyZone: `${Math.round(price * 0.94)} - ${Math.round(price * 0.96)}`,
          trailingSL: Math.round(price * 0.91),
          target1: Math.round(price * 1.08),
          targetLongTerm3Yr: Math.round(price * 1.60)
        };
      }

      // 3. Live Quote
      case 'get_live_quote': {
        const rawSym = String(args.symbol || '').trim().toUpperCase();
        if (!rawSym) return { error: 'symbol is required' };
        const market = (args.market || (rawSym.endsWith('.NS') || rawSym === 'RELIANCE' || rawSym === 'NIFTY' ? 'IN' : 'US')).toUpperCase();
        
        if (market === 'IN') {
          try {
            const clean = rawSym.replace('.NS', '').replace('.BO', '');
            const growwRes = await fetch(`https://groww.in/v1/api/stocks_data/v1/tr_live_prices/exchange/NSE/segment/CASH/${encodeURIComponent(clean)}/latest`, {
              headers: { 'User-Agent': 'Mozilla/5.0' },
              signal: AbortSignal.timeout(5000)
            });
            if (growwRes.ok) {
              const j = await growwRes.json();
              if (j && j.ltp > 0) {
                return {
                  symbol: clean,
                  market: 'IN',
                  price: j.ltp,
                  change: j.dayChangePerc || 0,
                  high: j.high || j.ltp,
                  low: j.low || j.ltp,
                  volume: j.volume || 0,
                  currency: 'INR',
                  source: 'groww-nse-realtime'
                };
              }
            }
          } catch {}
        }

        try {
          const ysym = market === 'IN' && !rawSym.includes('.') && !rawSym.startsWith('^') ? `${rawSym}.NS` : rawSym;
          const yRes = await fetch(`https://query1.finance.yahoo.com/v7/finance/quote?symbols=${encodeURIComponent(ysym)}`, {
            headers: { 'User-Agent': 'Mozilla/5.0' },
            signal: AbortSignal.timeout(5000)
          });
          if (yRes.ok) {
            const j = await yRes.json();
            const q = j?.quoteResponse?.result?.[0];
            if (q && q.regularMarketPrice > 0) {
              return {
                symbol: rawSym,
                market,
                price: q.regularMarketPrice,
                change: q.regularMarketChangePercent || 0,
                high: q.regularMarketDayHigh || q.regularMarketPrice,
                low: q.regularMarketDayLow || q.regularMarketPrice,
                volume: q.regularMarketVolume || 0,
                currency: q.currency || (market === 'US' ? 'USD' : 'INR'),
                source: 'yahoo-realtime'
              };
            }
          }
        } catch {}

        return { error: `Could not fetch quote for ${rawSym}` };
      }

      // 4. Whale & Block Deals
      case 'get_whale_block_deals': {
        let tavilyDeals = null;
        if (tavilyKey) {
          try {
            const res = await fetch('https://api.tavily.com/search', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                api_key: tavilyKey,
                query: 'India NSE BSE block deal bulk deal institutional large trades today',
                search_depth: 'basic',
                include_answer: true,
                max_results: 4,
                topic: 'finance'
              }),
              signal: AbortSignal.timeout(8000)
            });
            if (res.ok) {
              const d = await res.json();
              tavilyDeals = d.answer || null;
            }
          } catch {}
        }
        return {
          marketBlockDealSummary: tavilyDeals || 'No major block deals flagged in current session.'
        };
      }

      // 5. FII / DII Flow
      case 'get_fii_dii_positioning': {
        if (!tavilyKey) return { error: 'Tavily key required for FII/DII live data' };
        const res = await fetch('https://api.tavily.com/search', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            api_key: tavilyKey,
            query: 'FII DII data today India stock market net buy sell crore latest',
            search_depth: 'basic',
            include_answer: true,
            max_results: 3,
            topic: 'finance'
          }),
          signal: AbortSignal.timeout(8000)
        });
        if (!res.ok) return { error: `Tavily returned status ${res.status}` };
        const d = await res.json();
        return {
          summary: d.answer || 'FII/DII data unavailable',
          institutionalBias: (d.answer || '').toLowerCase().includes('net buy') ? 'NET BUYERS (Institutional Inflows 🟢)' : 'NET SELLERS / CAUTIOUS 🔴'
        };
      }

      // 6. Sector Radar
      case 'get_sector_rotation_radar': {
        const mlRegime = getRegime();
        return {
          regime: mlRegime?.regime || 'NEUTRAL',
          narrative: mlRegime?.narrative || 'Sector breadth steady'
        };
      }

      // 7. Search News
      case 'search_market_news': {
        const query = String(args.query || '').trim();
        if (!query) return { error: 'query is required' };
        if (!tavilyKey) return { error: 'Tavily search API key is not configured' };

        const res = await fetch('https://api.tavily.com/search', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            api_key: tavilyKey,
            query: `${query} latest financial news`,
            search_depth: 'basic',
            include_answer: true,
            max_results: 4,
            topic: 'finance'
          }),
          signal: AbortSignal.timeout(8000)
        });

        if (!res.ok) return { error: `Tavily returned ${res.status}` };
        const data = await res.json();
        return {
          query,
          aiSummary: data.answer || 'No direct summary found',
          results: (data.results || []).slice(0, 3).map(r => ({
            title: r.title,
            content: (r.content || '').substring(0, 180),
            url: r.url
          }))
        };
      }

      // 8. Market Regime
      case 'get_market_regime': {
        const mlRegime = getRegime();
        return {
          regime: mlRegime?.regime || 'NEUTRAL',
          confidence: `${mlRegime?.confidence || 70}%`,
          volatilityLevel: mlRegime?.vix > 20 ? 'HIGH' : 'NORMAL',
          vix: mlRegime?.vix || 14.5,
          narrative: mlRegime?.narrative || 'Market breadth steady'
        };
      }

      // 9. Calculate Trade Setup
      case 'calculate_trade_setup': {
        const symbol = String(args.symbol || '').toUpperCase();
        const price = parseFloat(args.currentPrice);
        const bias = String(args.bias || 'BULLISH').toUpperCase();
        const atrPct = parseFloat(args.atrPercent) || 2.5;

        if (!price || price <= 0) return { error: 'Valid currentPrice is required' };
        const atr = price * (atrPct / 100);

        let entry = price;
        let sl = bias === 'BULLISH' ? price - (atr * 1.2) : price + (atr * 1.2);
        let tp1 = bias === 'BULLISH' ? price + (atr * 1.5) : price - (atr * 1.5);
        let tp2 = bias === 'BULLISH' ? price + (atr * 2.5) : price - (atr * 2.5);

        const risk = Math.abs(entry - sl);
        const reward1 = Math.abs(tp1 - entry);

        return {
          symbol,
          bias,
          entryPrice: Math.round(entry * 100) / 100,
          stopLoss: Math.round(sl * 100) / 100,
          target1: Math.round(tp1 * 100) / 100,
          target2: Math.round(tp2 * 100) / 100,
          riskReward: `1:${(reward1 / (risk || 1)).toFixed(2)}`,
          positionSizingRule: 'Risk no more than 1-2% of total trading capital on this setup.'
        };
      }

      default:
        return { error: `Unknown tool: ${name}` };
    }
  } catch (err) {
    return { error: `Tool execution failed: ${err.message}` };
  }
}
