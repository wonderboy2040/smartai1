// ============================================
// AI CHAT ENGINE — Groq Integration
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
// MAIN AI CHAT FUNCTION — Groq
// ========================================
export async function chatWithAI(chatId, userMessage, portfolio, livePrices, usdInrRate) {
  if (!GROQ_KEY) {
    return `⚠️ <b>AI Engine Offline</b>\n\nGroq API Key set nahi hai. Web app settings (⚙️) se key save karo.`;
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

  // Build Groq conversation format
  const groqMessages = [
    { role: 'system', content: `${SYSTEM_PROMPT}\n\n${portfolioCtx}\n${intelCtx}` }
  ];
  const recentHistory = history.slice(-MAX_HISTORY);
  for (const m of recentHistory) {
    groqMessages.push({
      role: m.role === 'model' ? 'assistant' : 'user',
      content: m.content
    });
  }

  try {
    const MODELS = ['llama-3.3-70b-versatile', 'llama-3.1-8b-instant', 'gemma2-9b-it', 'llama3-70b-8192'];
    let aiText = '';
    let lastError = '';

    for (const model of MODELS) {
      try {
        const res = await fetch(`https://api.groq.com/openai/v1/chat/completions`, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${GROQ_KEY}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            model: model,
            messages: groqMessages,
            temperature: 0.75,
            max_completion_tokens: 800
          }),
          signal: AbortSignal.timeout(60000)
        });

        if (!res.ok) {
          const err = await res.json().catch(() => ({}));
          const errMsg = err.error?.message || `API Error: ${res.status}`;
          if (res.status === 429 || errMsg.includes('decommissioned') || errMsg.includes('not exist')) {
            console.warn(`⚠️ Skipping ${model}: ${errMsg}`);
            lastError = `Skipped ${model}.`;
            continue; // Fallback
          }
          throw new Error(errMsg);
        }

        const data = await res.json();
        aiText = data.choices?.[0]?.message?.content || '';
        break; // Success
      } catch (e) {
        lastError = e.message;
        if (e.message.includes('Rate limit') || e.message.includes('decommissioned') || e.message.includes('429')) continue;
        throw e;
      }
    }

    if (!aiText) throw new Error(lastError || 'All AI models exhausted their daily limits!');

  // Clean up thinking tags and convert markdown to HTML for Telegram
  let safeText = aiText.replace(/<think>[\s\S]*?<\/think>/gi, '').trim();

  // First convert markdown to Telegram HTML tags (before escaping)
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

    return htmlText;
  } catch (e) {
    console.error('❌ Groq API Error:', e.message);
    return `❌ <b>AI Error:</b> ${e.message}\n\n<i>Retry karo ya thodi der baad try karo.</i>`;
  }
}

// Clear chat history
export function clearChatHistory(chatId) {
  chatHistory.delete(String(chatId));
}
