// ============================================
// AI CHAT ENGINE — Tavily Search + NVIDIA DeepSeek V3 + Groq
// ============================================
import { GROQ_KEY, GEMINI_KEY, DEEPSEEK_KEY, TAVILY_API_KEY, TAVILY_BASE_URL, NVIDIA_API_KEY, NVIDIA_BASE_URL, NVIDIA_DEEPSEEK_MODEL, NVIDIA_GEMINI_MODEL } from './config.mjs';
import { fetchMarketIntelligence } from './market.mjs';
import { calculateMetrics, analyzeAsset } from './analysis.mjs';

// Per-user conversation history (in-memory)
const chatHistory = new Map();
const MAX_HISTORY = 8;

// Market intelligence cache
let cachedIntel = null;
let intelTimestamp = 0;

// API Configuration
const hasTavily = TAVILY_API_KEY && TAVILY_API_KEY.startsWith('tvly-');
const hasNVIDIA = NVIDIA_API_KEY && NVIDIA_API_KEY.startsWith('nvapi-');
const hasGroq = GROQ_KEY && GROQ_KEY.startsWith('gsk_');

// Tavily Search Function (for real-time web data)
async function searchTavily(query, days = 7) {
  if (!hasTavily) {
    console.log('Tavily not configured, skipping search');
    return [];
  }

  try {
    const res = await fetch(TAVILY_BASE_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${TAVILY_API_KEY}`
      },
      body: JSON.stringify({
        query: query,
        max_results: 5,
        days: days,
        search_depth: 'advanced',
        include_answer: true,
        include_images: false
      })
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      console.warn('Tavily API Error:', res.status, err);
      return [];
    }

    const data = await res.json();
    return data.results || [];
  } catch (e) {
    console.error('Tavily Search Error:', e.message);
    return [];
  }
}

// AI Router — Intent Detection with NVIDIA-first logic
function detectIntent(prompt) {
  const lower = prompt.toLowerCase();

  // Emergency/Crisis routing - NVIDIA Gemini
  if (/\b(crash|circuit|emergency|war|ban|halt|breaking)\b/i.test(lower)) {
    return hasNVIDIA ? 'nvidia-gemini' : hasGroq ? 'groq' : 'deepseek';
  }

  // Deep quantitative - NVIDIA DeepSeek
  if (/\b(calculate|monte carlo|sharpe|backtest|projection|calculate|optimization)\b/i.test(lower)) {
    return hasNVIDIA ? 'nvidia-deepseek' : hasGroq ? 'groq' : 'gemini';
  }

  // Real-time data queries - NVIDIA Gemini
  if (/\b(today|aaj|abhi|now|live|latest|breaking|price|rate|news|market|nifty|sensex|vix|gift nifty|us markets|global markets)\b/i.test(lower)) {
    return hasNVIDIA ? 'nvidia-gemini' : hasGroq ? 'groq' : 'deepseek';
  }

  // Portfolio/Analysis - NVIDIA DeepSeek
  if (/\b(analyze|analysis|portfolio|allocation|risk|compare|backtest|optimize|strategy|allocation|rebalance|trim)\b/i.test(lower)) {
    return hasNVIDIA ? 'nvidia-deepseek' : hasGroq ? 'groq' : 'gemini';
  }

  // News/Updates - NVIDIA Gemini
  if (/\b(news|khabar|update|announcement|earnings|ipo|merger)\b/i.test(lower)) {
    return hasNVIDIA ? 'nvidia-gemini' : hasGroq ? 'groq' : 'deepseek';
  }

  // Quick questions - NVIDIA or Groq
  return hasNVIDIA ? 'nvidia-gemini' : hasGroq ? 'groq' : 'gemini';
}

// Validate AI configuration
const availableAIs = [];
if (hasNVIDIA) availableAIs.push('NVIDIA (DeepSeek + Gemini)');
if (hasGroq) availableAIs.push('Groq');

if (availableAIs.length === 0) {
  console.error('❌ CRITICAL: No AI keys configured!');
  console.error('Bot will not be able to respond to AI queries.');
} else {
  console.log(`🧠 AI Engines Available: ${availableAIs.join(', ')} (NVIDIA Primary)`);
}

// NVIDIA Gemini API Call (Primary)
async function callNvidiaGemini(messages, systemPrompt) {
  if (!NVIDIA_API_KEY) throw new Error('NVIDIA API key missing');

  const formattedMessages = [
    { role: 'system', content: systemPrompt },
    ...messages.map(m => ({
      role: m.role === 'assistant' ? 'assistant' : 'user',
      content: m.content
    }))
  ];

  try {
    const res = await fetch(`${NVIDIA_BASE_URL}/chat/completions`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${NVIDIA_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: NVIDIA_GEMINI_MODEL,
        messages: formattedMessages,
        temperature: 0.7,
        max_tokens: 2048
      })
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error?.message || `NVIDIA Gemini API Error: ${res.status}`);
    }

    const data = await res.json();
    if (!data.choices?.[0]?.message?.content) {
      throw new Error('Empty response from NVIDIA Gemini');
    }
    return data.choices[0].message.content;
  } catch (e) {
    console.error('❌ NVIDIA Gemini API Error:', e.message);
    throw e;
  }
}

// NVIDIA DeepSeek API Call (Primary)
async function callNvidiaDeepSeek(messages, systemPrompt) {
  if (!NVIDIA_API_KEY) throw new Error('NVIDIA API key missing');

  const formattedMessages = [
    { role: 'system', content: systemPrompt },
    ...messages.map(m => ({ role: m.role, content: m.content }))
  ];

  try {
    const res = await fetch(`${NVIDIA_BASE_URL}/chat/completions`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${NVIDIA_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: NVIDIA_DEEPSEEK_MODEL,
        messages: formattedMessages,
        temperature: 0.7,
        max_tokens: 2048
      })
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error?.message || `NVIDIA DeepSeek API Error: ${res.status}`);
    }

    const data = await res.json();
    if (!data.choices?.[0]?.message?.content) {
      throw new Error('Empty response from NVIDIA DeepSeek');
    }
    return data.choices[0].message.content;
  } catch (e) {
    console.error('❌ NVIDIA DeepSeek API Error:', e.message);
    throw e;
  }
}

// Legacy Gemini API Call (Fallback)
async function callGemini(messages, systemPrompt) {
  if (!GEMINI_KEY || !GEMINI_KEY.startsWith('AIza')) {
    throw new Error('Gemini API key missing');
  }

  const formattedMessages = [
    { role: 'system', parts: [{ text: systemPrompt }] },
    ...messages.map(m => ({
      role: m.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: m.content }]
    }))
  ];

  try {
    const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${GEMINI_KEY}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ contents: formattedMessages })
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error?.message || `Gemini API Error: ${res.status}`);
    }

    const data = await res.json();
    if (!data.candidates?.[0]?.content?.parts?.[0]?.text) {
      throw new Error('Empty response from Gemini');
    }
    return data.candidates[0].content.parts[0].text;
  } catch (e) {
    console.error('❌ Gemini API Error:', e.message);
    throw e;
  }
}

// Legacy DeepSeek API Call (Fallback)
async function callDeepSeek(messages, systemPrompt) {
  if (!DEEPSEEK_KEY) throw new Error('DeepSeek key missing');

  const formattedMessages = [
    { role: 'system', content: systemPrompt },
    ...messages.map(m => ({ role: m.role, content: m.content }))
  ];

  try {
    const res = await fetch('https://api.deepseek.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${DEEPSEEK_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: 'deepseek-chat',
        messages: formattedMessages,
        temperature: 0.7,
        max_tokens: 1200
      })
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error?.message || `DeepSeek API Error: ${res.status}`);
    }

    const data = await res.json();
    if (!data.choices?.[0]?.message?.content) {
      throw new Error('Empty response from DeepSeek');
    }
    return data.choices[0].message.content;
  } catch (e) {
    console.error('❌ DeepSeek API Error:', e.message);
    throw e;
  }
}

// Groq API Call (existing logic)
async function callGroq(messages, systemPrompt) {
  if (!GROQ_KEY) throw new Error('Groq key missing');

  const formattedMessages = [
    { role: 'system', content: systemPrompt },
    ...messages.map(m => ({ role: m.role, content: m.content }))
  ];

  const MODELS = ['llama-3.3-70b-versatile', 'llama-3.1-8b-instant'];
  let lastError = '';

  for (const model of MODELS) {
    try {
      const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${GROQ_KEY}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          model,
          messages: formattedMessages,
          temperature: 0.75,
          max_completion_tokens: 800
        })
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        const errMsg = err.error?.message || `API Error: ${res.status}`;
        if (res.status === 429 || errMsg.includes('decommissioned') || errMsg.includes('not exist')) {
          lastError = `Skipped ${model}.`;
          continue;
        }
        throw new Error(errMsg);
      }

      const data = await res.json();
      if (!data.choices?.[0]?.message?.content) {
        throw new Error('Empty response from Groq');
      }
      return data.choices[0].message.content;
    } catch (e) {
      lastError = e.message;
      if (e.message.includes('Rate limit') || e.message.includes('decommissioned')) continue;
      throw e;
    }
  }

  throw new Error(lastError || 'Groq models exhausted');
}

const SYSTEM_PROMPT = `You are DEEP MIND AI NEURAL INSIDER — an Elite Pro Trading Intelligence Engine. Talk to "Nagraj Bhai" in NATIVE HINGLISH.
You operate at INSTITUTIONAL LEVEL using these frameworks:

TECHNICAL ARSENAL:
• Smart Money Concepts (SMC): Order Blocks, Fair Value Gaps (FVG), Break of Structure (BOS), Change of Character (CHoCH), Liquidity Sweeps, Inducement
• Wyckoff Method: Accumulation/Distribution phases, Spring/Upthrust, Effort vs Result
• Fibonacci: Retracement (0.236-0.786), Extension (1.272-2.618), Confluence zones
• Volume Profile: POC, Value Area High/Low, Delta Analysis, Imbalance detection
• Order Flow: Bid/Ask imbalance, Iceberg orders, Stop runs, Trap detection

RISK MANAGEMENT:
• Position sizing using Kelly Criterion and volatility-based stops
• ATR-based dynamic Stop Loss (1.5-2.5x ATR)
• Risk per trade: max 2% of portfolio, max 6% drawdown limit
• R:R minimum 1:2, prefer 1:3+
• Correlation-aware position sizing

Response rules:
1. Reference LIVE SENSOR DATA (actual numbers from portfolio context)
2. SMC/Wyckoff structure analysis with key levels
3. Order Block / FVG identification if applicable
4. Risk-adjusted call with exact SL (ATR-based), TP (Fib extension), position size
5. "CONVICTION SCORE: XX/100" with reasoning
6. If volatile market, add "EMERGENCY PROTOCOL" section

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
// MAIN AI CHAT FUNCTION — Multi-AI Router
// ========================================
export async function chatWithAI(chatId, userMessage, portfolio, livePrices, usdInrRate) {
  // Build context
  const portfolioCtx = buildPortfolioContext(portfolio, livePrices, usdInrRate);
  const intelCtx = await getMarketIntelContext();
  const systemPrompt = `${SYSTEM_PROMPT}\n\n${portfolioCtx}\n${intelCtx}`;

  // Get/create conversation history
  const idStr = String(chatId);
  if (!chatHistory.has(idStr)) {
    chatHistory.set(idStr, []);
  }
  const history = chatHistory.get(idStr);
  history.push({ role: 'user', content: userMessage });

  // Detect intent and route to optimal AI
  const intent = detectIntent(userMessage);
  const recentHistory = history.slice(-MAX_HISTORY).map(m => ({
    role: m.role === 'model' ? 'assistant' : 'user',
    content: m.content
  }));

  try {
    let aiText = '';
    let usedModel = intent;

    // Check if the detected intent's AI is available, fallback to available AI
    const checkAndRoute = (model) => {
      if (model === 'gemini' && GEMINI_KEY) return true;
      if (model === 'deepseek' && DEEPSEEK_KEY) return true;
      if (model === 'groq' && GROQ_KEY) return true;
      return false;
    };

    // Try primary intent first, then fallback
    const fallbackOrder = ['groq', 'gemini', 'deepseek'];
    let routedModel = null;

    if (checkAndRoute(intent)) {
      routedModel = intent;
    } else {
      // Find first available
      for (const model of fallbackOrder) {
        if (checkAndRoute(model)) {
          routedModel = model;
          break;
        }
      }
    }

    if (!routedModel) {
      throw new Error('No AI engines available. Check API keys.');
    }

    // Route to appropriate AI (NVIDIA first)
    if (intent === 'nvidia-gemini' || intent === 'gemini') {
      aiText = hasNVIDIA ? await callNvidiaGemini(recentHistory, systemPrompt) : await callGemini(recentHistory, systemPrompt);
    } else if (intent === 'nvidia-deepseek' || intent === 'deepseek') {
      aiText = hasNVIDIA ? await callNvidiaDeepSeek(recentHistory, systemPrompt) : await callDeepSeek(recentHistory, systemPrompt);
    } else if (intent === 'groq') {
      aiText = await callGroq(recentHistory, systemPrompt);
    } else {
      // Fallback to NVIDIA
      aiText = hasNVIDIA ? await callNvidiaGemini(recentHistory, systemPrompt) : await callGroq(recentHistory, systemPrompt);
    }

    if (!aiText) throw new Error('AI returned empty response');

    // Clean up thinking tags and convert markdown to HTML for Telegram
    let safeText = aiText.replace(/<think>[\s\S]*?<\/think>/gi, '').trim();

    // First escape ALL < > to prevent injection
    safeText = safeText.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

    // Convert markdown to Telegram HTML tags (on already-escaped text)
    safeText = safeText
      .replace(/\*\*(.+?)\*\*/g, '<b>$1</b>')
      .replace(/\*(.+?)\*/g, '<i>$1</i>')
      .replace(/_(.+?)_/g, '<i>$1</i>')
      .replace(/`(.+?)`/g, '<code>$1</code>');

    // Save to history
    history.push({ role: 'model', content: aiText });

    // Trim history
    if (history.length > MAX_HISTORY * 2) {
      history.splice(0, history.length - MAX_HISTORY);
    }

    return safeText;
  } catch (e) {
    console.error(`❌ ${intent} AI Error:`, e.message);
    let errorMsg = e.message;
    if (errorMsg.includes('No AI engines available')) {
      return `❌ <b>AI Configuration Error:</b> No API keys configured. Admin se contact karo.`;
    }
    if (errorMsg.includes('Insufficient balance') || errorMsg.includes('insufficient_balance')) {
      return `❌ <b>API Balance Error:</b> Insufficient balance in AI service. Admin se contact karo.`;
    }
    return `❌ <b>AI Error:</b> ${errorMsg}\n\n<i>Retry karo ya /clear karke phir try karo.</i>`;
  }
}

// Clear chat history
export function clearChatHistory(chatId) {
  chatHistory.delete(String(chatId));
}
