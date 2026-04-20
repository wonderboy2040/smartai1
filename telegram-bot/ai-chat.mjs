// ============================================
// AI CHAT ENGINE — Quantum Mind AI Routing
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

const SYSTEM_PROMPT = `You are DEEP ADVANCE PRO QUANTUM MIND AI — an Elite Multi-Model Trading Intelligence Engine. Talk to "Nagraj Bhai" in NATIVE HINGLISH.
You operate at INSTITUTIONAL LEVEL by routing queries through a neural network of specialized AIs:
• Gemini 1.5 Pro (General Market Intelligence & News)
• Perplexity AI (Breaking News & Real-time Web Sources)
• DeepSeek V3 (Deep Portfolio Analysis, Strategy & Quant Math)

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

function routeQuery(query) {
  const q = query.toLowerCase();
  if (q.includes('breaking') || q.includes('latest news') || q.includes('source') || q.includes('search') || q.includes('web')) return 'PERPLEXITY';
  if (q.includes('portfolio') || q.includes('calculate') || q.includes('strategy') || q.includes('risk') || q.includes('math') || q.includes('analyze this asset')) return 'DEEPSEEK';
  return 'GEMINI';
}

async function callGemini(messages, key) {
  const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-pro:generateContent?key=${key}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ contents: messages.map(m => ({ role: m.role === 'assistant' ? 'model' : 'user', parts: [{ text: m.content }] })) })
  });
  if (!res.ok) throw new Error(`Gemini API Error: ${res.status}`);
  const data = await res.json();
  return data.candidates?.[0]?.content?.parts?.[0]?.text || '';
}

async function callOpenAICompat(endpoint, messages, key, model) {
  const res = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model, messages, temperature: 0.75, max_tokens: 800 })
  });
  if (!res.ok) throw new Error(`API Error ${endpoint}: ${res.status}`);
  const data = await res.json();
  return data.choices?.[0]?.message?.content || '';
}

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
// MAIN AI CHAT FUNCTION — Quantum Mind Routing
// ========================================
export async function chatWithAI(chatId, userMessage, portfolio, livePrices, usdInrRate) {
  if (Object.values(AI_KEYS).every(k => !k)) {
    return `⚠️ <b>AI Engine Offline</b>\n\nQuantum Mind API Keys set nahi hain. Web app settings (⚙️) se keys save karo.`;
  }

  const idStr = String(chatId);
  if (!chatHistory.has(idStr)) chatHistory.set(idStr, []);
  const history = chatHistory.get(idStr);
  history.push({ role: 'user', content: userMessage });

  const portfolioCtx = buildPortfolioContext(portfolio, livePrices, usdInrRate);
  const intelCtx = await getMarketIntelContext();
  const systemContent = `${SYSTEM_PROMPT}\n\n${portfolioCtx}\n${intelCtx}`;

  const messages = [{ role: 'system', content: systemContent }];
  const recentHistory = history.slice(-MAX_HISTORY);
  for (const m of recentHistory) {
    messages.push({ role: m.role === 'model' ? 'assistant' : 'user', content: m.content });
  }

  const provider = routeQuery(userMessage);
  let aiText = '';

  try {
    if (provider === 'PERPLEXITY' && AI_KEYS.perplexity) {
      aiText = await callOpenAICompat('https://api.perplexity.ai/chat/completions', messages, AI_KEYS.perplexity, 'llama-3.1-sonar-large-128k-online');
    } else if (provider === 'DEEPSEEK' && AI_KEYS.deepseek) {
      aiText = await callOpenAICompat('https://api.deepseek.com/v1/chat/completions', messages, AI_KEYS.deepseek, 'deepseek-chat');
    } else if (AI_KEYS.gemini) {
      aiText = await callGemini(messages, AI_KEYS.gemini);
    } else if (AI_KEYS.groq) {
      aiText = await callOpenAICompat('https://api.groq.com/openai/v1/chat/completions', messages, AI_KEYS.groq, 'llama-3.3-70b-versatile');
    } else {
      throw new Error('No available AI keys for this request.');
    }

    let safeText = aiText.replace(/<think>[\s\S]*?<\/think>/gi, '').trim();
    safeText = safeText.replace(/\*\*(.+?)\*\*/g, '<b>$1</b>').replace(/\*(.+?)\*/g, '<i>$1</i>').replace(/_(.+?)_/g, '<i>$1</i>').replace(/`(.+?)`/g, '<code>$1</code>');
    const allowedTags = /<\/?(?:b|i|code|pre|a|s|u|em|strong|tg-spoiler|blockquote)>/gi;
    const parts = safeText.split(allowedTags);
    const htmlText = parts.map(part => {
      if (allowedTags.test(part)) { allowedTags.lastIndex = 0; return part; }
      allowedTags.lastIndex = 0;
      return part.replace(/</g, '&lt;').replace(/>/g, '&gt;');
    }).join('');

    history.push({ role: 'model', content: aiText });
    if (history.length > MAX_HISTORY * 2) history.splice(0, history.length - MAX_HISTORY);
    return htmlText;
  } catch (e) {
    console.error('❌ Quantum Mind AI Error:', e.message);
    return `❌ <b>AI Error:</b> ${e.message}\n\n<i>Quantum Routing failed. Retry karo ya keys check karo.</i>`;
  }
}

// Clear chat history
export function clearChatHistory(chatId) {
  chatHistory.delete(String(chatId));
}
