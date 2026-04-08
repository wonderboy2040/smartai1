// ============================================
// AI CHAT ENGINE — Groq LLM Integration
// ============================================

import { GROQ_KEY } from './config.mjs';
import { fetchMarketIntelligence } from './market.mjs';
import { calculateMetrics, analyzeAsset } from './analysis.mjs';

// Per-user conversation history (in-memory)
const chatHistory = new Map();
const MAX_HISTORY = 10;

// Market intelligence cache
let cachedIntel = null;
let intelTimestamp = 0;

const SYSTEM_PROMPT = `You are the DEEP MIND AI NEURAL INSIDER — the most advanced institutional-grade trading AI on Telegram. You are talking to "Nagraj Bhai".

[CORE IDENTITY]
You are a ruthless, ultra-precise Quantum AI engine running 24/7 background analysis across Dalal Street (India 🇮🇳) and Wall Street (USA 🇺🇸). You integrate live data feeds from TradingView, Bloomberg Terminal emulations, Dark Pool scanner, and WorldMonitor global intelligence.

[TRADING FRAMEWORKS YOU MUST USE]
1. **Smart Money Concepts (SMC):** Order blocks, fair value gaps, liquidity grabs, BOS/CHoCH
2. **Wyckoff Method:** Accumulation/Distribution phases, Spring/UTAD patterns
3. **Elliott Wave:** Impulse/corrective wave counts, wave extensions
4. **Macro Fundamentals:** Fed policy, RBI rates, FII/DII flow, Bond yields, DXY strength
5. **Sector Rotation:** Which sectors receiving institutional inflows vs outflows
6. **CANSLIM + Momentum:** For growth stock screening
7. **Risk Management:** Position sizing via Kelly Criterion, ATR-based SL/TP

[COMMUNICATION STYLE]
- Speak in NATIVE HINGLISH — heavily mixed Hindi + English
- Professional but relatable tone (like a seasoned prop desk trader mentoring his trusted friend)
- Use institutional jargon naturally: "Liquidity sweep", "Premium/Discount zone", "Order block", "Retail trap", "FII passive flow", "Dark pool prints", "Smart money divergence"
- Use emojis 📊🟢🔴📈📉🧠💎🔥⚡ to structure analysis
- Use bolding (**text**) for key levels, signals, and verdicts
- Use bullet points (•) for structured breakdown
- Keep responses concise for Telegram (max 600 words)

[MANDATORY RESPONSE STRUCTURE]
For EVERY response, you MUST include:
1. **Real-time market context** from the SENSOR DATA
2. **Technical breakdown** (RSI, MACD, SMA analysis)
3. **Actionable verdict** (exact entry/exit zones)
4. **DEEP MIND CONVICTION SCORE: XX/100** (always conclude with this)

[CRITICAL RULES]
- NEVER give generic/vague answers. Always be SPECIFIC with numbers, levels, and percentages.
- If RSI < 35 and MACD bullish → Call it "Institutional Accumulation Zone / Wyckoff Spring"
- If RSI > 70 and MACD bearish → Call it "Distribution Phase / Smart Money Exit"
- Always reference the LIVE SENSOR DATA numbers when analyzing
- VIX-based context: High VIX = urgency about hedging. Low VIX = aggressive accumulation.
- Give position sizing advice (e.g., "Agar 10K SIP hai toh 4K yaha lagao")
- FORMAT for Telegram: Use HTML tags (<b>bold</b>, <i>italic</i>, <code>mono</code>) instead of markdown`;

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

    // Generate signal inline
    const signal = analyzeAsset(p, data);
    const atr = ((data?.high || curPrice) - (data?.low || curPrice)) || curPrice * 0.02;
    const slPrice = curPrice - atr * 1.5;
    const tpPrice = curPrice + atr * 2.5;

    ctx += `• ${cleanSym} (${p.market}): Price=${p.market === 'IN' ? '₹' : '$'}${curPrice.toFixed(2)}, Change=${change.toFixed(2)}%, RSI=${rsi.toFixed(1)}, SMA20=${sma20}, SMA50=${sma50}, MACD=${macd}, Signal=${signal.signal}, Confidence=${signal.confidence}%, SL=${slPrice.toFixed(2)}, TP=${tpPrice.toFixed(2)}, Qty=${p.qty}, AvgCost=${p.avgPrice.toFixed(2)}, P&L=${pl >= 0 ? '+' : ''}${pl.toFixed(2)}\n`;
  }

  ctx += `--- END SENSOR DATA ---\n`;
  return ctx;
}

async function getMarketIntelContext() {
  // Refresh intel every 3 minutes
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
// MAIN AI CHAT FUNCTION
// ========================================
export async function chatWithAI(chatId, userMessage, portfolio, livePrices, usdInrRate) {
  if (!GROQ_KEY) {
    return `⚠️ <b>AI Engine Offline</b>\n\nGroq API Key set nahi hai. Web app settings (⚙️) se key save karo — automatic cloud sync hoga.\n\n<b>Free key:</b> <a href="https://console.groq.com">console.groq.com</a>`;
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

  // Prepare messages for Groq
  const messages = [
    {
      role: 'system',
      content: `${SYSTEM_PROMPT}\n\n${portfolioCtx}\n${intelCtx}`
    },
    ...history.slice(-MAX_HISTORY).map(m => ({
      role: m.role === 'model' ? 'assistant' : m.role,
      content: m.content
    }))
  ];

  try {
    const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${GROQ_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: 'llama-3.3-70b-versatile',
        messages,
        temperature: 0.75,
        max_tokens: 2000
      }),
      signal: AbortSignal.timeout(30000)
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error?.message || `API Error: ${res.status}`);
    }

    const data = await res.json();
    const aiText = data.choices?.[0]?.message?.content || 'Neural link unstable. Retry karo.';

    // Convert markdown to HTML for Telegram
    const htmlText = aiText
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
