// ============================================
// MCP / AI FUNCTION CALLING TOOL REGISTRY
// Real-time Market Intelligence & Quantitative Execution
// ============================================

import {
  fetchSingleSymbol,
  fetchForexRate,
  fetchMarketIntelligence,
  fetchCryptoPricesINR,
  fetchCryptoPrices,
  fetchBondYields,
  fetchFIIDIIData
} from './market.mjs';
import { calculateMetrics, analyzeAsset } from './analysis.mjs';
import { TAVILY_API_KEY, isTavilyAvailable, guessMarket } from './config.mjs';

// ============================================
// 1. TOOL DEFINITIONS (OpenAI & Gemini Compatible)
// ============================================

export const MCP_TOOLS_OPENAI = [
  {
    type: 'function',
    function: {
      name: 'get_live_quote',
      description: 'Fetch real-time price, day change percentage, high, low, and volume for any Indian stock/ETF, US stock, or crypto ticker.',
      parameters: {
        type: 'object',
        properties: {
          symbol: {
            type: 'string',
            description: 'Ticker symbol (e.g. RELIANCE, TCS, NVDA, AAPL, BTC, ETH, JUNIORBEES, MOMENTUM50).'
          },
          market: {
            type: 'string',
            enum: ['IN', 'US'],
            description: 'Optional market (IN for NSE/BSE, US for NYSE/NASDAQ). Automatically guessed if omitted.'
          }
        },
        required: ['symbol']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'get_technical_analysis',
      description: 'Calculate RSI(14), MACD, SMA 20/50, support & resistance levels, trend, and quantitative signal for an asset.',
      parameters: {
        type: 'object',
        properties: {
          symbol: {
            type: 'string',
            description: 'Ticker symbol to analyze (e.g. NIFTY, RELIANCE, TSLA, BTC).'
          },
          market: {
            type: 'string',
            enum: ['IN', 'US'],
            description: 'Market: IN or US.'
          }
        },
        required: ['symbol']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'search_market_news',
      description: 'Search real-time financial news, quarterly earnings, institutional block deals, or breaking market events via Tavily web search.',
      parameters: {
        type: 'object',
        properties: {
          query: {
            type: 'string',
            description: 'Search query (e.g. "TCS quarterly results", "Fed rate cut impact NIFTY", "Bitcoin ETF inflows").'
          }
        },
        required: ['query']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'get_market_regime',
      description: 'Get real-time global market regime, India VIX, US VIX, DXY, Gold, Crude Oil, bond yields, and Fear & Greed narrative.',
      parameters: {
        type: 'object',
        properties: {}
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'get_portfolio_summary',
      description: "Get user's active portfolio metrics, total invested, current value, total P&L, today's P&L, and position-wise breakdown.",
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
      description: 'Calculate exact quantitative Entry Price, Stop Loss, Target 1, Target 2, Target 3, and Risk-to-Reward (R:R) ratio.',
      parameters: {
        type: 'object',
        properties: {
          symbol: {
            type: 'string',
            description: 'Asset symbol (e.g. RELIANCE, NIFTY, BTC).'
          },
          currentPrice: {
            type: 'number',
            description: 'Current market price of the asset.'
          },
          bias: {
            type: 'string',
            enum: ['BULLISH', 'BEARISH'],
            description: 'Trading bias (BULLISH for Buy setup, BEARISH for Short/Sell setup).'
          },
          atrPercent: {
            type: 'number',
            description: 'Optional expected volatility / ATR percent (defaults to 2.5%).'
          }
        },
        required: ['symbol', 'currentPrice', 'bias']
      }
    }
  }
];

// Gemini Declarations Format
export const MCP_TOOLS_GEMINI = [
  {
    functionDeclarations: MCP_TOOLS_OPENAI.map(t => t.function)
  }
];

// ============================================
// 2. TOOL EXECUTION ENGINE
// ============================================

export async function executeMCPTool(name, args = {}, context = {}) {
  const { portfolio = [], livePrices = {}, usdInrRate = 85.5 } = context;

  try {
    switch (name) {
      // 1. Live Quote Tool
      case 'get_live_quote': {
        const rawSym = String(args.symbol || '').trim().toUpperCase();
        if (!rawSym) return { error: 'Symbol is required' };
        const market = args.market || guessMarket(rawSym);
        const cacheKey = `${market}_${rawSym}`;

        // Check live prices cache first
        if (livePrices[cacheKey]?.price) {
          const p = livePrices[cacheKey];
          return {
            symbol: rawSym,
            market,
            price: p.price,
            change: p.change || 0,
            high: p.high || p.price,
            low: p.low || p.price,
            volume: p.volume || 0,
            currency: market === 'US' ? 'USD' : 'INR',
            source: 'liveCache'
          };
        }

        // Fetch fresh single symbol
        const quote = await fetchSingleSymbol(rawSym, market);
        if (quote && quote.price > 0) {
          return {
            symbol: rawSym,
            market,
            price: quote.price,
            change: quote.change || 0,
            high: quote.high || quote.price,
            low: quote.low || quote.price,
            volume: quote.volume || 0,
            currency: market === 'US' ? 'USD' : 'INR',
            source: quote.source || 'realtimeScanner'
          };
        }

        return { error: `Could not fetch live price for ${rawSym}` };
      }

      // 2. Technical Analysis Tool
      case 'get_technical_analysis': {
        const rawSym = String(args.symbol || '').trim().toUpperCase();
        if (!rawSym) return { error: 'Symbol is required' };
        const market = args.market || guessMarket(rawSym);
        const cacheKey = `${market}_${rawSym}`;
        const priceData = livePrices[cacheKey] || (await fetchSingleSymbol(rawSym, market)) || {};
        const pos = portfolio.find(p => p.symbol.toUpperCase() === rawSym) || { symbol: rawSym, market, avgPrice: priceData.price || 0, qty: 1 };

        const sig = analyzeAsset(pos, priceData);
        const rsi = priceData.rsi || 50;
        const macd = priceData.macd !== undefined ? priceData.macd : 0;
        const sma20 = priceData.sma20;
        const sma50 = priceData.sma50;

        return {
          symbol: rawSym,
          market,
          currentPrice: priceData.price || pos.avgPrice,
          change: priceData.change || 0,
          rsi: Math.round(rsi * 10) / 10,
          rsiCondition: rsi < 30 ? 'OVERSOLD (Accumulation Zone)' : rsi > 70 ? 'OVERBOUGHT (Distribution Zone)' : 'NEUTRAL',
          macd: macd ? (macd > 0 ? 'BULLISH' : 'BEARISH') : 'NEUTRAL',
          movingAverages: {
            sma20: sma20 || null,
            sma50: sma50 || null,
            trend: sma20 && sma50 ? (sma20 > sma50 ? 'GOLDEN CROSS / BULLISH' : 'DEATH CROSS / BEARISH') : 'UNKNOWN'
          },
          quantitativeSignal: sig.signal,
          confidence: `${sig.confidence}%`,
          targetPrice: sig.targetPrice,
          stopLoss: sig.stopLoss,
          rationale: sig.reason
        };
      }

      // 3. Search Market News Tool
      case 'search_market_news': {
        const query = String(args.query || '').trim();
        if (!query) return { error: 'Search query is required' };
        if (!isTavilyAvailable()) {
          return { error: 'Tavily search API key is not configured' };
        }

        const res = await fetch('https://api.tavily.com/search', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            api_key: TAVILY_API_KEY,
            query: `${query} latest financial market news`,
            search_depth: 'basic',
            include_answer: true,
            max_results: 5,
            topic: 'finance'
          }),
          signal: AbortSignal.timeout(8000)
        });

        if (!res.ok) return { error: `Tavily returned status ${res.status}` };
        const data = await res.json();
        return {
          query,
          aiSummary: data.answer || 'No direct summary found',
          articles: (data.results || []).slice(0, 4).map(r => ({
            title: r.title,
            content: (r.content || '').substring(0, 200),
            url: r.url
          }))
        };
      }

      // 4. Market Regime Tool
      case 'get_market_regime': {
        const intel = await fetchMarketIntelligence();
        const fx = await fetchForexRate().catch(() => usdInrRate);
        const bonds = await fetchBondYields().catch(() => []);

        return {
          narrative: intel?.marketNarrative || 'Market conditions neutral',
          fearGreedScore: intel?.fearGreedScore || 50,
          usdInr: fx,
          globalIndices: (intel?.globalIndices || []).map(i => ({ name: i.name, price: i.price, change: `${i.change >= 0 ? '+' : ''}${i.change.toFixed(2)}%` })),
          sectors: (intel?.sectors || []).map(s => ({ name: s.name, change: `${s.change >= 0 ? '+' : ''}${s.change.toFixed(2)}%` })),
          bondYields: bonds.map(b => ({ name: b.name, yield: `${b.yield.toFixed(3)}%` }))
        };
      }

      // 5. Portfolio Summary Tool
      case 'get_portfolio_summary': {
        if (!portfolio || portfolio.length === 0) {
          return { message: 'Portfolio is currently empty. No positions logged.' };
        }
        const m = calculateMetrics(portfolio, livePrices, usdInrRate);
        const positions = portfolio.map(p => {
          const k = `${p.market}_${p.symbol}`;
          const d = livePrices[k];
          const curPrice = d?.price || p.avgPrice;
          const plPct = p.avgPrice > 0 ? ((curPrice - p.avgPrice) / p.avgPrice) * 100 : 0;
          return {
            symbol: p.symbol,
            market: p.market,
            qty: p.qty,
            avgPrice: p.avgPrice,
            currentPrice: curPrice,
            pnlPercent: `${plPct >= 0 ? '+' : ''}${plPct.toFixed(2)}%`,
            rsi: d?.rsi || 50
          };
        });

        return {
          totalInvestedINR: Math.round(m.totalInvested),
          totalValueINR: Math.round(m.totalValue),
          totalPnLINR: Math.round(m.totalPL),
          totalPnLPercent: `${m.plPct >= 0 ? '+' : ''}${m.plPct.toFixed(2)}%`,
          todayPnLINR: Math.round(m.todayPL),
          todayPnLPercent: `${m.todayPct >= 0 ? '+' : ''}${m.todayPct.toFixed(2)}%`,
          positions
        };
      }

      // 6. Quantitative Trade Setup Tool
      case 'calculate_trade_setup': {
        const symbol = String(args.symbol || '').toUpperCase();
        const price = parseFloat(args.currentPrice);
        const bias = String(args.bias || 'BULLISH').toUpperCase();
        const atrPct = parseFloat(args.atrPercent) || 2.5;

        if (!price || price <= 0) return { error: 'Valid currentPrice is required' };

        const atr = price * (atrPct / 100);
        let entry, sl, tp1, tp2, tp3;

        if (bias === 'BULLISH') {
          entry = price;
          sl = price - (atr * 1.2);
          tp1 = price + (atr * 1.5);
          tp2 = price + (atr * 2.5);
          tp3 = price + (atr * 4.0);
        } else {
          entry = price;
          sl = price + (atr * 1.2);
          tp1 = price - (atr * 1.5);
          tp2 = price - (atr * 2.5);
          tp3 = price - (atr * 4.0);
        }

        const risk = Math.abs(entry - sl);
        const reward1 = Math.abs(tp1 - entry);
        const reward2 = Math.abs(tp2 - entry);

        return {
          symbol,
          bias,
          entryPrice: Math.round(entry * 100) / 100,
          stopLoss: Math.round(sl * 100) / 100,
          target1: Math.round(tp1 * 100) / 100,
          target2: Math.round(tp2 * 100) / 100,
          target3: Math.round(tp3 * 100) / 100,
          riskRewardT1: `1:${(reward1 / (risk || 1)).toFixed(2)}`,
          riskRewardT2: `1:${(reward2 / (risk || 1)).toFixed(2)}`,
          positionSizingAdvice: `Risk max 1-2% of total portfolio on this setup. SL is ${atrPct * 1.2}% away.`
        };
      }

      default:
        return { error: `Unknown tool name: ${name}` };
    }
  } catch (err) {
    return { error: `Tool execution failed: ${err.message}` };
  }
}
