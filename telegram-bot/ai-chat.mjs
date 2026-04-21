// ============================================
// AI CHAT ENGINE — Super Intelligence Neural System
// ============================================
import { AI_KEYS } from './config.mjs';
import { fetchMarketIntelligence } from './market.mjs';
import { calculateMetrics, analyzeAsset } from './analysis.mjs';

// Per-user conversation history (in-memory)
const chatHistory = new Map();
const MAX_HISTORY = 8;

// Market intelligence cache
let cachedIntel = null;
let intelTimestamp = 0;

const SYSTEM_PROMPT = `You are DEEP MIND AI NEURAL INSIDER — Quantum Mind AI Super Intelligence System. Talk to "Nagraj Bhai" in NATIVE HINGLISH.
You operate at SUPERINTELLIGENT LEVEL combining Quantum Computing principles, Advanced Neural Networks, and Elite Trading frameworks:

QUANTUM NEURAL ARSENAL:
• Quantum Superposition Analysis: Simultaneous evaluation of multiple market states
• Quantum Entanglement Correlation: Hidden connections between seemingly unrelated assets
• Quantum Tunneling Prediction: Breakthrough moment detection before conventional indicators
• Smart Money Concepts (SMC) v3.0: Institutional Order Blocks, Quantum Fair Value Gaps, Liquidity Magnetism
• Advanced Wyckoff 4.0: Phase transition detection, Accumulation/Distribution quantum waves
• Neural Fibonacci: Dynamic retracement/extension levels based on market volatility entropy
• Quantum Volume Profile: Probability distribution of institutional participation
• Neural Order Flow: Real-time bid/ask imbalance prediction with machine learning

ADVANCED RISK ENGINE:
• Quantum Kelly Criterion: Optimal position sizing using quantum probability amplitudes
• Neural ATR Dynamic Stops: Adaptive volatility-based stops with machine learning correction
• Portfolio Quantum Shield: Correlation-aware hedging with entanglement risk calculation
• Quantum Risk/Reward Optimization: Simultaneous maximization of returns and minimization of drawdown
• Neural Correlation Matrix: Real-time portfolio diversification using quantum entanglement measures

DEEP ANALYSIS PROTOCOLS:
1. Reference LIVE SENSOR DATA with quantum precision (actual numbers from portfolio context)
2. Quantum SMC/Wyckoff structure analysis with entanglement-based key levels
3. Neural Order Block / Quantum FVG identification with probability weighting
4. Quantum-adjusted call with exact Neural SL/TP levels, quantum position sizing
5. "QUANTUM CONVICTION SCORE: XXX/1000" with multi-dimensional reasoning
6. Quantum Market Regude Detection: Bull/Bear/Accumulation/Distribution/Reversal phases
7. Neural Sentiment Analysis: News impact prediction with source credibility scoring
8. DeepSeek-level Mathematical Analysis: Advanced quantitative modeling and backtesting
9. Perplexity-grade News Intelligence: Breaking news with verified sources and impact assessment

Critical: Be concise! Keep tokens low. Use HTML tags (<b>bold</b>, <i>italic</i>, <code>mono</code>) instead of markdown. Emojis allowed.`;

function buildPortfolioContext(portfolio, livePrices, usdInrRate) {
  const metrics = calculateMetrics(portfolio, livePrices, usdInrRate);
  const usVix = livePrices['US_VIX']?.price || 15;
  const inVix = livePrices['IN_INDIAVIX']?.price || 15;

  let ctx = `\n--- DEEP MIND LIVE SENSOR DATA ---\n`;
  ctx += `Portfolio Value: ₹${Math.round(metrics.totalValue).toLocaleString('en-IN')}\n`;
  ctx += `Total P&L: ${metrics.totalPL >= 0 ? '+' : ''}₹${Math.round(metrics.totalPL).toLocaleString('en-IN')} (${metrics.plPct.toFixed(2)}%)\n`;
  ctx += `Today P&L: ${metrics.todayPL >= 0 ? '+' : ''}₹${Math.round(metrics.todayPL).toLocaleString('en-IN')}\n`;
  ctx += `US VIX: ${usVix.toFixed(1)} | India VIX: ${inVix.toFixed(1)}\n`;
  ctx += `USD/INR: ₹${usdInrRate.toFixed(2)}\n\n`;

  ctx += `PORTFOLIO POSITIONS + SIGNALS:\n`;
  for (const p of portfolio) {
    const key = `${p.market}_${p.symbol}`;
    const data = livePrices[key];
    const curPrice = data?.price || p.avgPrice;
    const rsi = data?.rsi || 50;
    const change = data?.change || 0;
    const sma20 = data?.sma20 ? data.sma20.toFixed(2) : 'N/A';
    const sma50 = data?.sma50 ? data.sma50.toFixed(2) : 'N/A';
    const macd = data?.macd !== undefined ? data.macd.toFixed(2) : 'N/A';
    const pl = (curPrice - p.avgPrice) * p.qty;
    const cleanSym = p.symbol.replace('.NS', '');

    const signal = analyzeAsset(p, data);
    const atr = ((data?.high || curPrice) - (data?.low || curPrice)) || curPrice * 0.02;
    const slPrice = curPrice - atr * 1.5;
    const tpPrice = curPrice + atr * 2.5;

    ctx += `${cleanSym}:Pr=${curPrice.toFixed(1)}|Chg=${change.toFixed(1)}%|RSI=${rsi.toFixed(0)}|MACD=${macd}|Sig=${signal.signal}|SL=${slPrice.toFixed(1)}|TP=${tpPrice.toFixed(1)}|Qty=${p.qty}|P&L=${pl >= 0 ? '+' : ''}${pl.toFixed(0)}\n`;
  }

  ctx += `--- END SENSOR DATA ---\n`;
  return ctx;
}

async function getMarketIntelContext() {
  if (Date.now() - intelTimestamp > 180000 || !cachedIntel) {
    try {
      cachedIntel = await fetchMarketIntelligence();
      intelTimestamp = Date.now();
    } catch (e) {}
  }

  if (!cachedIntel) return '';

  let ctx = `\n--- LIVE GLOBAL MARKET INTELLIGENCE ---\n`;
  ctx += `Fear/Greed: ${cachedIntel.fearGreedScore}/100\n`;
  for (const idx of cachedIntel.globalIndices) {
    ctx += `${idx.name}: ${idx.price.toFixed(2)} (${idx.change >= 0 ? '+' : ''}${idx.change.toFixed(2)}%)\n`;
  }
  for (const s of cachedIntel.sectors) {
    ctx += `Sector ${s.name}: ${s.change >= 0 ? '+' : ''}${s.change.toFixed(2)}%\n`;
  }
  ctx += `Narrative: ${cachedIntel.marketNarrative}\n`;
  ctx += `--- END INTELLIGENCE ---\n`;
  return ctx;
}

// ========================================
// QUANTUM MIND ORCHESTRATOR - SUPER INTELLIGENCE NEURAL SYSTEM
// ========================================
function routeIntent(message) {
  const msg = message.toLowerCase();
  
  // Daily market update, news, analysis -> GEMINI 1.5 Pro
  const geminiKeywords = ['market', 'update', 'daily', 'analysis', 'analyze', 'trend', 'outlook', 'forecast'];
  
  // Breaking news + sources -> PERPLEXITY AI
  const perplexityKeywords = ['news', 'latest', 'breaking', 'what happened', 'current event', 'live news', 'headlines', 'sources'];
  
  // Deep portfolio analysis, math, strategy -> DEEPSEEK V3
  const deepseekKeywords = ['strategy', 'calculate', 'math', 'intrinsic value', 'option strategy', 'backtest', 'formula', 'deep analysis', 'portfolio', 'allocation', 'risk', 'optimize', 'position sizing', 'kelly'];

  // Check for Gemini keywords first (market updates, analysis)
  if (geminiKeywords.some(k => msg.includes(k))) return 'GEMINI';
  
  // Check for Perplexity keywords (breaking news with sources)
  if (perplexityKeywords.some(k => msg.includes(k))) return 'PERPLEXITY';
  
  // Check for DeepSeek keywords (deep analysis, math, strategy)
  if (deepseekKeywords.some(k => msg.includes(k))) return 'DEEPSEEK';
  
  // Default to GEMINI for general queries
  return 'GEMINI';
}

async function callAIProvider(provider, messages) {
  const key = AI_KEYS[provider];
  if (!key) throw new Error(`API Key for ${provider} is missing.`);

  let endpoint, body;

  if (provider === 'GEMINI') {
    // Gemini 1.5 Pro (Google AI SDK style via REST)
    endpoint = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-pro:generateContent?key=${key}`;
    body = {
      contents: [{
        role: 'user',
        parts: [{ text: messages.map(m => `${m.role === 'assistant' ? 'AI' : 'User'}: ${m.content}`).join('\\n') }]
      }],
      generationConfig: { temperature: 0.7, maxOutputTokens: 800 }
    };
  } else if (provider === 'PERPLEXITY') {
    endpoint = 'https://api.perplexity.ai/chat/completions';
    body = {
      model: 'sonar-reasoning',
      messages: messages,
      temperature: 0.7
    };
  } else if (provider === 'DEEPSEEK') {
    endpoint = 'https://api.deepseek.com/chat/completions';
    body = {
      model: 'deepseek-chat',
      messages: messages,
      temperature: 0.6
    };
  }

  const res = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(provider !== 'GEMINI' && { 'Authorization': `Bearer ${key}` })
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(60000)
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error?.message || `API Error: ${res.status}`);
  }

  const data = await res.json();
  if (provider === 'GEMINI') {
    return data.candidates?.[0]?.content?.parts?.[0]?.text || '';
  }
  return data.choices?.[0]?.message?.content || '';
}

// ========================================
// MAIN AI CHAT FUNCTION
// ========================================
export async function chatWithAI(chatId, userMessage, portfolio, livePrices, usdInrRate) {
  if (!Object.values(AI_KEYS).some(k => k && k.length > 10)) {
    return `⚠️ <b>AI Engine Offline</b>\n\nSuper Intelligence keys set nahi hain. Web app settings (⚙️) se keys save karo.`;
  }

  // Get/create conversation history
  const idStr = String(chatId);
  if (!chatHistory.has(idStr)) {
    chatHistory.set(idStr, []);
  }
  const history = chatHistory.get(idStr);

  // Add user message
  history.push({ role: 'user', content: userMessage });

  // Build context
  const portfolioCtx = buildPortfolioContext(portfolio, livePrices, usdInrRate);
  const intelCtx = await getMarketIntelContext();

  // Route intent
  const provider = routeIntent(userMessage);

  // Build conversation format
  const messages = [
    { role: 'system', content: `${SYSTEM_PROMPT}\n\nSENSORS:\n${portfolioCtx}\n${intelCtx}` }
  ];
  const recentHistory = history.slice(-MAX_HISTORY);
  for (const m of recentHistory) {
    messages.push({
      role: m.role === 'model' ? 'assistant' : 'user',
      content: m.content
    });
  }

  try {
    let aiText = '';
    let errorCount = 0;

    // Try primary provider first
    try {
      aiText = await callAIProvider(provider, messages);
    } catch (e) {
      errorCount++;
      console.warn(`Primary provider ${provider} failed:`, e.message);
      aiText = '';
    }

    // Fallback to other available providers if primary fails
    if (!aiText || aiText.length === 0) {
      const fallbackOrder = provider === 'GEMINI' ? ['DEEPSEEK', 'PERPLEXITY'] :
                          provider === 'DEEPSEEK' ? ['GEMINI', 'PERPLEXITY'] :
                          ['GEMINI', 'DEEPSEEK'];

      for (const fallbackProvider of fallbackOrder) {
        try {
          if (AI_KEYS[fallbackProvider] && AI_KEYS[fallbackProvider].length > 10) {
            aiText = await callAIProvider(fallbackProvider, messages);
            if (aiText && aiText.length > 0) {
              console.log(`Fallback to ${fallbackProvider} successful`);
              break;
            }
          }
        } catch (e) {
          console.warn(`Fallback provider ${fallbackProvider} failed:`, e.message);
          continue;
        }
      }
    }

    if (!aiText || aiText.length === 0) {
      throw new Error('All AI providers failed. Please check your API keys.');
    }

  // Clean up thinking tags and convert markdown to HTML for Telegram
  let safeText = aiText.replace(/<think>[\s\S]*?<\/think>/gi, '').trim();

  // First convert markdown to Telegram HTML tags
  safeText = safeText
    .replace(/\*\*(.+?)\*\*/g, '<b>$1</b>')
    .replace(/\*(.+?)\*/g, '<i>$1</i>')
    .replace(/_(.+?)_/g, '<i>$1</i>')
    .replace(/`(.+?)`/g, '<code>$1</code>');

  // Now escape remaining raw < > that are NOT Telegram HTML tags
  const allowedTags = /<\/?(?:b|i|code|pre|a|s|u|em|strong|tg-spoiler|blockquote)>/gi;
  const parts = safeText.split(allowedTags);
  const htmlText = parts.map(part => {
    if (allowedTags.test(part)) {
      allowedTags.lastIndex = 0;
      return part;
    }
    allowedTags.lastIndex = 0;
    return part.replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }).join('');

    // Save to history
    history.push({ role: 'model', content: aiText });

    // Trim history
    if (history.length > MAX_HISTORY * 2) {
      history.splice(0, history.length - MAX_HISTORY);
    }

    return `🤖 <i>Neural Node: ${provider}</i>\n\n${htmlText}`;
  } catch (e) {
    console.error('❌ AI Orchestrator Error:', e.message);
    return `❌ <b>AI Error:</b> ${e.message}\n\n<i>Retry karo ya thodi der baad try karo.</i>`;
  }
}

// Clear chat history
export function clearChatHistory(chatId) {
  chatHistory.delete(String(chatId));
}
