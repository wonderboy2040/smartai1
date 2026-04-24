// ============================================
// AI CHAT ENGINE — Groq + Gemini + Claude (Pro Trader Combo)
// ============================================
import { GROQ_KEY } from './config.mjs';
import { fetchMarketIntelligence } from './market.mjs';
import { calculateMetrics, analyzeAsset } from './analysis.mjs';

// Per-user conversation history (in-memory)
const chatHistory = new Map();
const MAX_HISTORY = 8;

// Market intelligence cache
let cachedIntel = null;
let intelTimestamp = 0;

// API Configuration from environment
const GEMINI_API_KEY = process.env.GEMINI_API_KEY || process.env.VITE_GEMINI_API_KEY || '';
const CLAUDE_API_KEY = process.env.CLAUDE_API_KEY || process.env.VITE_CLAUDE_API_KEY || '';

const hasGroq = GROQ_KEY && GROQ_KEY.startsWith('gsk_');
const hasGemini = GEMINI_API_KEY && GEMINI_API_KEY.length > 10;
const hasClaude = CLAUDE_API_KEY && CLAUDE_API_KEY.length > 10;

console.log('🤖 AI Engine Status:');
console.log(`  ⚡ Groq: ${hasGroq ? '✓ Active' : '✗ Missing GROQ_KEY'}`);
console.log(`  🔵 Gemini: ${hasGemini ? '✓ Active' : '✗ Missing GEMINI_API_KEY'}`);
console.log(`  🟣 Claude: ${hasClaude ? '✓ Active' : '✗ Missing CLAUDE_API_KEY'}`);

// ============================================
// GROQ API — Ultra-fast Responses
// ============================================
async function callGroq(messages, systemPrompt) {
  if (!hasGroq) throw new Error('Groq key missing');
  
  const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${GROQ_KEY}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      model: 'llama-3.3-70b-versatile',
      messages: [
        { role: 'system', content: systemPrompt },
        ...messages
      ],
      temperature: 0.7,
      max_completion_tokens: 1500
    }),
    signal: AbortSignal.timeout(30000)
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(`Groq Error ${res.status}: ${err.error?.message || 'Unknown'}`);
  }
  const data = await res.json();
  return data.choices?.[0]?.message?.content || '';
}

// ============================================
// GEMINI API — Google AI (Real-time Intelligence)
// ============================================
async function callGemini(messages, systemPrompt) {
  if (!hasGemini) throw new Error('Gemini key missing');

  const contents = [
    { role: 'user', parts: [{ text: systemPrompt }] },
    { role: 'model', parts: [{ text: 'Understood. DEEP MIND AI Pro Trader active.' }] },
    ...messages.map(m => ({
      role: m.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: m.content }]
    }))
  ];

  const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${GEMINI_API_KEY}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents,
      generationConfig: { temperature: 0.7, maxOutputTokens: 2048 }
    }),
    signal: AbortSignal.timeout(30000)
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(`Gemini Error ${res.status}: ${err.error?.message || 'Unknown'}`);
  }
  const data = await res.json();
  return data.candidates?.[0]?.content?.parts?.[0]?.text || '';
}

// ============================================
// CLAUDE API — Deep Analysis & Strategies
// ============================================
async function callClaude(messages, systemPrompt) {
  if (!hasClaude) throw new Error('Claude key missing');

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': CLAUDE_API_KEY,
      'anthropic-version': '2023-06-01',
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 2048,
      system: systemPrompt,
      messages: messages.map(m => ({
        role: m.role === 'assistant' ? 'assistant' : 'user',
        content: m.content
      }))
    }),
    signal: AbortSignal.timeout(45000)
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(`Claude Error ${res.status}: ${err.error?.message || 'Unknown'}`);
  }
  const data = await res.json();
  return data.content?.[0]?.text || '';
}

// ============================================
// INTENT DETECTION — Smart Model Routing
// ============================================
function detectIntent(query) {
  const q = query.toLowerCase();

  // Real-time / News queries → Gemini
  if (/\b(news|khabar|market|live|aaj|today|nifty|sensex|breaking|alert|ipo|fii|dii|rbi|fed|crude|gold|dollar|forex|rupee|sector|global|world|bull|bear|crash|rally|correction)\b/i.test(q)) {
    return { model: 'gemini', intent: 'MARKET_NEWS', confidence: 85 };
  }

  // Deep analysis / Strategy → Claude (fallback to Gemini)
  if (/\b(analyze|analysis|portfolio|strategy|fundamental|backtest|risk|allocation|rebalance|compare|optimize|deep|detailed|comprehensive|long term|sip|wealth|retirement|sharpe|cagr|calculate|projection|monte carlo|fibonacci|wyckoff|smc)\b/i.test(q)) {
    return { model: hasClaude ? 'claude' : 'gemini', intent: 'DEEP_ANALYSIS', confidence: 80 };
  }

  // Quick questions → Groq (fastest)
  return { model: 'groq', intent: 'QUICK_QUERY', confidence: 70 };
}

// ============================================
// BUILD CONTEXT — Portfolio + Market Data
// ============================================
async function buildContext(portfolio, livePrices, usdInrRate) {
  let ctx = '';

  // Refresh market intelligence (cache 3 min)
  const now = Date.now();
  if (!cachedIntel || now - intelTimestamp > 180000) {
    try {
      cachedIntel = await fetchMarketIntelligence();
      intelTimestamp = now;
    } catch (e) {
      console.warn('Market intelligence fetch failed:', e.message);
    }
  }

  // Market intelligence context
  if (cachedIntel) {
    ctx += `GLOBAL MARKET DATA:\n`;
    cachedIntel.globalIndices.forEach(i => {
      ctx += `${i.name}: ${i.price.toFixed(1)} (${i.change >= 0 ? '+' : ''}${i.change.toFixed(1)}%)\n`;
    });
    ctx += `Fear/Greed Score: ${cachedIntel.fearGreedScore}/100\n`;
    ctx += `Market Narrative: ${cachedIntel.marketNarrative}\n\n`;
  }

  // Portfolio context
  if (portfolio && portfolio.length > 0) {
    const metrics = calculateMetrics(portfolio, livePrices, usdInrRate);
    ctx += `PORTFOLIO (₹${Math.round(metrics.totalValue).toLocaleString('en-IN')}):\n`;
    ctx += `Total P&L: ${metrics.totalPL >= 0 ? '+' : ''}₹${Math.round(metrics.totalPL).toLocaleString('en-IN')} (${metrics.plPct.toFixed(1)}%)\n`;
    ctx += `Today: ${metrics.todayPL >= 0 ? '+' : ''}₹${Math.round(metrics.todayPL).toLocaleString('en-IN')}\n\n`;

    ctx += `POSITIONS:\n`;
    for (const p of portfolio) {
      const key = `${p.market}_${p.symbol}`;
      const data = livePrices[key];
      const price = data?.price || p.avgPrice;
      const change = data?.change || 0;
      const rsi = data?.rsi || 50;
      const plPct = p.avgPrice > 0 ? ((price - p.avgPrice) / p.avgPrice) * 100 : 0;
      const sig = analyzeAsset(p, data);
      ctx += `${p.symbol}: ₹${price.toFixed(1)} (${change >= 0 ? '+' : ''}${change.toFixed(1)}%) RSI=${rsi.toFixed(0)} Signal=${sig.signal} P&L=${plPct.toFixed(1)}%\n`;
    }
  }

  return ctx;
}

// ============================================
// MAIN CHAT FUNCTION — Groq + Gemini + Claude
// ============================================
export async function chatWithAI(chatId, userMessage, portfolio = [], livePrices = {}, usdInrRate = 83.5) {
  // Get/create chat history
  if (!chatHistory.has(chatId)) chatHistory.set(chatId, []);
  const history = chatHistory.get(chatId);

  // Add user message to history
  history.push({ role: 'user', content: userMessage });

  // Detect intent and route to best model
  const { model: targetModel, intent } = detectIntent(userMessage);

  // Build portfolio + market context
  let contextData = '';
  try {
    contextData = await buildContext(portfolio, livePrices, usdInrRate);
  } catch (e) {
    console.warn('Context build partial failure:', e.message);
  }

  // System prompt
  const systemPrompt = `You are DEEP MIND AI — Elite Pro Trading Intelligence for Indian & US markets.

RULES:
1. Always respond in Hinglish (Hindi + English mix) — speak like "Nagraj Bhai" to the trader
2. Use institutional frameworks: SMC (Smart Money Concepts), Wyckoff, Elliott Wave, Fibonacci
3. Give SPECIFIC actionable levels: Support, Resistance, Stop Loss, Target Price
4. Include conviction scores (1-10) and risk-reward ratios
5. For news: provide latest developments and their market impact
6. For analysis: use RSI, MACD, SMA crossovers, volume analysis
7. For strategies: detailed entry/exit with position sizing
8. Be concise but comprehensive. Max 500 words.

LIVE DATA:
${contextData}`;

  // Build messages for API
  const recentHistory = history.slice(-MAX_HISTORY).map(m => ({
    role: m.role,
    content: m.content
  }));

  let aiText = '';
  let usedModel = targetModel;

  // Try primary model with fallback chain
  const modelChain = targetModel === 'gemini' 
    ? ['gemini', 'groq', 'claude']
    : targetModel === 'claude'
    ? ['claude', 'gemini', 'groq']
    : ['groq', 'gemini', 'claude'];

  for (const model of modelChain) {
    try {
      if (model === 'groq' && hasGroq) {
        aiText = await callGroq(recentHistory, systemPrompt);
        usedModel = 'groq';
        break;
      } else if (model === 'gemini' && hasGemini) {
        aiText = await callGemini(recentHistory, systemPrompt);
        usedModel = 'gemini';
        break;
      } else if (model === 'claude' && hasClaude) {
        aiText = await callClaude(recentHistory, systemPrompt);
        usedModel = 'claude';
        break;
      }
    } catch (e) {
      console.warn(`⚠️ ${model} failed:`, e.message);
      continue;
    }
  }

  if (!aiText) {
    aiText = '🤖 All AI engines temporarily unavailable. Please check API keys (GROQ_KEY, GEMINI_API_KEY, CLAUDE_API_KEY).';
    usedModel = 'system';
  }

  // Clean up and format for Telegram HTML
  let safeText = aiText.replace(/<think>[\s\S]*?<\/think>/gi, '').trim();

  // Escape ALL HTML first
  safeText = safeText.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

  // Convert markdown to Telegram HTML
  safeText = safeText
    .replace(/\*\*(.+?)\*\*/g, '<b>$1</b>')
    .replace(/\*(.+?)\*/g, '<i>$1</i>')
    .replace(/_(.+?)_/g, '<i>$1</i>')
    .replace(/`(.+?)`/g, '<code>$1</code>');

  // Save to history
  history.push({ role: 'assistant', content: aiText });

  // Trim history
  if (history.length > MAX_HISTORY * 2) {
    history.splice(0, history.length - MAX_HISTORY);
  }

  // Add model indicator
  const modelEmoji = usedModel === 'groq' ? '⚡' : usedModel === 'gemini' ? '🔵' : usedModel === 'claude' ? '🟣' : '🤖';
  const modelLabel = usedModel === 'groq' ? 'Groq' : usedModel === 'gemini' ? 'Gemini' : usedModel === 'claude' ? 'Claude' : 'System';

  return `${modelEmoji} <i>${modelLabel} | ${intent}</i>\n\n${safeText}`;
}

export function clearHistory(chatId) {
  chatHistory.delete(chatId);
  return '🧹 Chat history cleared. Fresh start!';
}
