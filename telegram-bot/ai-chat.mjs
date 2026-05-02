// ============================================
// AI CHAT ENGINE v4.0 — Quantum Pro Deep Mind AI
// Groq + Gemini + Claude + Tavily Real-Time Search
// ============================================
import { GROQ_KEY, GEMINI_API_KEY, CLAUDE_API_KEY, isGroqAvailable, isGeminiAvailable, isClaudeAvailable } from './config.mjs';
import { fetchMarketIntelligence, fetchForexRate } from './market.mjs';
import { calculateMetrics, analyzeAsset } from './analysis.mjs';

// Tavily API for real-time web search
const TAVILY_API_KEY = process.env.TAVILY_API_KEY || process.env.VITE_TAVILY_API_KEY || '';

// Real-time market data cache
let realtimeMarketCache = { data: null, timestamp: 0 };
let realtimeForexCache = { rate: 85.5, timestamp: 0 };

// Per-user conversation history (in-memory)
const chatHistory = new Map();
const MAX_HISTORY = 10;

// Market intelligence cache
let cachedIntel = null;
let intelTimestamp = 0;

// Engine health tracking — tracks failures to avoid repeatedly calling broken engines
const engineHealth = {
  groq: { failures: 0, lastFailure: 0, cooldownMs: 30000 },
  gemini: { failures: 0, lastFailure: 0, cooldownMs: 30000 },
  claude: { failures: 0, lastFailure: 0, cooldownMs: 30000 }
};

function isEngineCoolingDown(engine) {
  const h = engineHealth[engine];
  if (h.failures >= 3 && Date.now() - h.lastFailure < h.cooldownMs) return true;
  // Reset after cooldown
  if (h.failures >= 3 && Date.now() - h.lastFailure >= h.cooldownMs) {
    h.failures = 0;
  }
  return false;
}

function recordEngineFailure(engine) {
  engineHealth[engine].failures++;
  engineHealth[engine].lastFailure = Date.now();
}

function recordEngineSuccess(engine) {
  engineHealth[engine].failures = 0;
}

// Startup diagnostics
function logAIStatus() {
  console.log('🤖 AI Engine Status (Dynamic):');
  console.log(`  ⚡ Groq: ${isGroqAvailable() ? '✓ Active' : '✗ Key Missing/Invalid'}`);
  console.log(`  🔵 Gemini: ${isGeminiAvailable() ? '✓ Active' : '✗ Key Missing/Invalid'}`);
  console.log(`  🟣 Claude: ${isClaudeAvailable() ? '✓ Active' : '✗ Key Missing/Invalid'}`);
}
logAIStatus();

// ============================================
// UTILITY: Retry with exponential backoff
// ============================================
async function retryWithBackoff(fn, maxRetries = 2, baseDelay = 1000) {
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      if (attempt === maxRetries) throw err;
      const delay = baseDelay * Math.pow(2, attempt) + Math.random() * 500;
      console.warn(`  ↻ Retry ${attempt + 1}/${maxRetries} after ${Math.round(delay)}ms...`);
      await new Promise(r => setTimeout(r, delay));
    }
  }
}

// ============================================
// TAVILY REAL-TIME WEB SEARCH — Live Market Data
// ============================================
async function fetchRealtimeWebData(query) {
  if (!TAVILY_API_KEY) return '';
  try {
    const res = await fetch('https://api.tavily.com/search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        api_key: TAVILY_API_KEY,
        query: query,
        search_depth: 'advanced',
        include_answer: true,
        max_results: 5,
        topic: 'finance'
      }),
      signal: AbortSignal.timeout(8000)
    });
    if (res.ok) {
      const data = await res.json();
      let context = '';
      if (data.answer) context += `LIVE WEB INTEL: ${data.answer}\n`;
      if (data.results) {
        for (const r of data.results.slice(0, 3)) {
          context += `• ${r.title}: ${r.content?.substring(0, 200)}\n`;
        }
      }
      return context;
    }
  } catch (e) {
    console.warn('Tavily search failed:', e.message);
  }
  return '';
}

// Fetch real-time market snapshot for AI context
async function getRealtimeMarketSnapshot() {
  const now = Date.now();
  if (realtimeMarketCache.data && now - realtimeMarketCache.timestamp < 60000) {
    return realtimeMarketCache.data;
  }
  try {
    const tickers = [
      'NSE:NIFTY', 'BSE:SENSEX', 'NSE:BANKNIFTY',
      'AMEX:SPY', 'NASDAQ:QQQ', 'CBOE:VIX', 'NSE:INDIAVIX',
      'TVC:DXY', 'COMEX:GC1!', 'NYMEX:CL1!', 'BITSTAMP:BTCUSD'
    ];
    const res = await fetch('https://scanner.tradingview.com/global/scan', {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=UTF-8' },
      body: JSON.stringify({ symbols: { tickers }, columns: ['name', 'close', 'change', 'high', 'low', 'volume'] }),
      signal: AbortSignal.timeout(6000)
    });
    if (res.ok) {
      const data = await res.json();
      let snapshot = 'REAL-TIME MARKET SNAPSHOT:\n';
      const nameMap = { 'NSE:NIFTY': 'NIFTY50', 'BSE:SENSEX': 'SENSEX', 'NSE:BANKNIFTY': 'BANKNIFTY', 'AMEX:SPY': 'S&P500', 'NASDAQ:QQQ': 'NASDAQ100', 'CBOE:VIX': 'US_VIX', 'NSE:INDIAVIX': 'INDIA_VIX', 'TVC:DXY': 'DXY', 'COMEX:GC1!': 'GOLD', 'NYMEX:CL1!': 'CRUDE_OIL', 'BITSTAMP:BTCUSD': 'BITCOIN' };
      if (data?.data) {
        for (const item of data.data) {
          const name = nameMap[item.s] || item.s;
          const price = parseFloat(item.d?.[1]) || 0;
          const change = parseFloat(item.d?.[2]) || 0;
          if (price > 0) snapshot += `${name}: ${price.toFixed(2)} (${change >= 0 ? '+' : ''}${change.toFixed(2)}%)\n`;
        }
      }
      realtimeMarketCache = { data: snapshot, timestamp: now };
      return snapshot;
    }
  } catch (e) {
    console.warn('Market snapshot failed:', e.message);
  }
  return realtimeMarketCache.data || '';
}

// Fetch real-time USD/INR
async function getRealtimeForex() {
  const now = Date.now();
  if (now - realtimeForexCache.timestamp < 30000) return realtimeForexCache.rate;
  try {
    const rate = await fetchForexRate();
    realtimeForexCache = { rate, timestamp: now };
    return rate;
  } catch (e) { return realtimeForexCache.rate; }
}

// ============================================
// GROQ API — Ultra-fast Responses (Latest Model)
// ============================================
async function callGroq(messages, systemPrompt) {
  if (!isGroqAvailable()) throw new Error('Groq key missing or invalid');
  if (isEngineCoolingDown('groq')) throw new Error('Groq temporarily cooling down after failures');

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
      max_completion_tokens: 2000
    }),
    signal: AbortSignal.timeout(25000)
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(`Groq ${res.status}: ${err.error?.message || res.statusText}`);
  }
  const data = await res.json();
  const text = data.choices?.[0]?.message?.content;
  if (!text || text.trim().length < 5) throw new Error('Groq returned empty response');
  return text;
}

// ============================================
// GEMINI API — Google AI (Real-time Intelligence)
// ============================================
async function callGemini(messages, systemPrompt) {
  if (!isGeminiAvailable()) throw new Error('Gemini key missing or invalid');
  if (isEngineCoolingDown('gemini')) throw new Error('Gemini temporarily cooling down after failures');

  // Build contents with STRICT alternating user/model turns
  // Gemini requires: user → model → user → model pattern
  const contents = [];

  // Start with system prompt as first user message
  contents.push({ role: 'user', parts: [{ text: systemPrompt }] });
  contents.push({ role: 'model', parts: [{ text: 'Understood. DEEP MIND AI Pro Trader active. Ready for analysis in Pro Trader Hinglish style.' }] });

  // Add conversation history ensuring alternation
  let lastRole = 'model';
  for (const m of messages) {
    const geminiRole = m.role === 'assistant' ? 'model' : 'user';

    // If same role as last, merge with previous or skip
    if (geminiRole === lastRole) {
      // Merge into last message
      const lastMsg = contents[contents.length - 1];
      lastMsg.parts[0].text += '\n\n' + m.content;
    } else {
      contents.push({
        role: geminiRole,
        parts: [{ text: m.content }]
      });
      lastRole = geminiRole;
    }
  }

  // Gemini requires the last message to be 'user'
  if (lastRole === 'model' && contents.length > 2) {
    // This shouldn't happen in normal flow since user message is always last
    // But just in case, add a nudge
    contents.push({ role: 'user', parts: [{ text: 'Please respond to my last query.' }] });
  }

  const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${GEMINI_API_KEY}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents,
      generationConfig: {
        temperature: 0.7,
        maxOutputTokens: 2048,
        topP: 0.95,
        topK: 40
      },
      safetySettings: [
        { category: 'HARM_CATEGORY_HARASSMENT', threshold: 'BLOCK_NONE' },
        { category: 'HARM_CATEGORY_HATE_SPEECH', threshold: 'BLOCK_NONE' },
        { category: 'HARM_CATEGORY_SEXUALLY_EXPLICIT', threshold: 'BLOCK_NONE' },
        { category: 'HARM_CATEGORY_DANGEROUS_CONTENT', threshold: 'BLOCK_NONE' }
      ]
    }),
    signal: AbortSignal.timeout(45000)
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(`Gemini ${res.status}: ${err.error?.message || res.statusText}`);
  }
  const data = await res.json();

  // Check for blocked responses
  if (data.candidates?.[0]?.finishReason === 'SAFETY') {
    throw new Error('Gemini blocked response due to safety filters');
  }

  const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text || text.trim().length < 5) throw new Error('Gemini returned empty response');
  return text;
}

// ============================================
// CLAUDE API — Deep Analysis & Strategies
// ============================================
async function callClaude(messages, systemPrompt) {
  if (!isClaudeAvailable()) throw new Error('Claude key missing or invalid');
  if (isEngineCoolingDown('claude')) throw new Error('Claude temporarily cooling down after failures');

  // Filter out any system messages — Claude uses `system` param separately
  const claudeMessages = messages
    .filter(m => m.role === 'user' || m.role === 'assistant')
    .map(m => ({
      role: m.role === 'assistant' ? 'assistant' : 'user',
      content: m.content
    }));

  // Ensure messages alternate and start with user
  const fixedMessages = [];
  let expectedRole = 'user';
  for (const m of claudeMessages) {
    if (m.role === expectedRole) {
      fixedMessages.push(m);
      expectedRole = expectedRole === 'user' ? 'assistant' : 'user';
    } else if (m.role === 'user' && expectedRole === 'assistant') {
      // Missing assistant message, add placeholder
      fixedMessages.push({ role: 'assistant', content: 'Samjha. Continue karo.' });
      fixedMessages.push(m);
      expectedRole = 'assistant';
    }
  }

  // Must have at least one user message
  if (fixedMessages.length === 0 || fixedMessages[0].role !== 'user') {
    fixedMessages.unshift({ role: 'user', content: 'Hello' });
  }

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': CLAUDE_API_KEY,
      'anthropic-version': '2023-06-01',
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 3000,
      system: systemPrompt,
      messages: fixedMessages
    }),
    signal: AbortSignal.timeout(60000)
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(`Claude ${res.status}: ${err.error?.message || res.statusText}`);
  }
  const data = await res.json();
  const text = data.content?.[0]?.text;
  if (!text || text.trim().length < 5) throw new Error('Claude returned empty response');
  return text;
}

// ============================================
// ADVANCED INTENT DETECTION — Smart Model Routing
// ============================================
function detectIntent(query) {
  const q = query.toLowerCase().trim();

  // Real-time / News / Market queries → Gemini (has grounding/search capabilities)
  if (/\b(news|khabar|market|live|aaj|today|nifty|sensex|breaking|alert|ipo|fii|dii|rbi|fed|crude|gold|dollar|forex|rupee|sector|global|world|bull|bear|crash|rally|correction|gift\s*nifty|pre.?market|opening|closing|trend|intraday|sgx|dow|nasdaq|s&p|vix|india\s*vix|budget|policy|gdp|inflation|cpi|employment|earnings|results|quarterly)\b/i.test(q)) {
    return { model: 'gemini', intent: 'MARKET_INTEL', confidence: 88 };
  }

  // Deep analysis / Strategy / Institutional → Claude
  if (/\b(analy[sz]e|analysis|portfolio|strategy|fundamental|backtest|risk|allocation|rebalance|compare|optimize|deep|detailed|comprehensive|long.?term|sip|wealth|retirement|sharpe|cagr|calculate|projection|monte\s*carlo|fibonacci|wyckoff|smc|smart\s*money|elliott|wave|options?|pcr|iv|implied|greeks|hedge|iron\s*condor|straddle|strangle|bull.?spread|bear.?spread|intrinsic|book\s*value|roe|pe\s*ratio|dcf|graham|valuation|moat|competitive|balance\s*sheet|dividend|eps|revenue|margin|debt)\b/i.test(q)) {
    return { model: isClaudeAvailable() ? 'claude' : 'gemini', intent: 'DEEP_ANALYSIS', confidence: 85 };
  }

  // Hindi trading queries → Groq (fast response)
  if (/\b(kaise|kaisa|kya|kab|kidhar|konsa|kitna|achha|best|buy|sell|hold|entry|exit|target|stop.?loss|support|resistance|level|breakout|breakdown|accumulate|book\s*profit|averaging)\b/i.test(q)) {
    return { model: 'groq', intent: 'QUICK_TRADE', confidence: 75 };
  }

  // Default → Groq (fastest for general queries)
  return { model: 'groq', intent: 'GENERAL', confidence: 70 };
}

// ============================================
// BUILD CONTEXT — Real-Time Portfolio + Market + Web Data
// ============================================
async function buildContext(portfolio, livePrices, usdInrRate, userQuery = '') {
  let ctx = '';

  // 1. Real-time market snapshot (live prices)
  const marketSnapshot = await getRealtimeMarketSnapshot();
  if (marketSnapshot) ctx += marketSnapshot + '\n';

  // 2. Real-time USD/INR
  const liveForex = await getRealtimeForex();
  ctx += `LIVE USD/INR: ₹${liveForex.toFixed(4)}\n`;
  ctx += `Timestamp: ${new Date().toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata' })} IST\n\n`;

  // 3. Refresh market intelligence (cache 2 min)
  const now = Date.now();
  if (!cachedIntel || now - intelTimestamp > 120000) {
    try {
      cachedIntel = await fetchMarketIntelligence();
      intelTimestamp = now;
    } catch (e) {
      console.warn('  ⚠ Market intelligence fetch failed:', e.message);
    }
  }

  // Market intelligence context
  if (cachedIntel) {
    ctx += `GLOBAL INDICES:\n`;
    cachedIntel.globalIndices.forEach(i => {
      ctx += `${i.name}: ${i.price.toFixed(1)} (${i.change >= 0 ? '+' : ''}${i.change.toFixed(1)}%)\n`;
    });
    ctx += `\nSECTOR ROTATION:\n`;
    cachedIntel.sectors.forEach(s => {
      ctx += `${s.name}: ${s.change >= 0 ? '+' : ''}${s.change.toFixed(2)}%\n`;
    });
    ctx += `Fear/Greed: ${cachedIntel.fearGreedScore}/100\n`;
    ctx += `AI Narrative: ${cachedIntel.marketNarrative}\n\n`;
  }

  // 4. Real-time web search for market-related queries
  if (userQuery && TAVILY_API_KEY) {
    const isMarketQuery = /\b(news|market|nifty|sensex|fed|rbi|ipo|fii|dii|crude|gold|dollar|bitcoin|crypto|budget|gdp|inflation|earnings|results|breaking|today|aaj|live)\b/i.test(userQuery);
    if (isMarketQuery) {
      console.log('  🔍 Fetching real-time web data via Tavily...');
      const webData = await fetchRealtimeWebData(`${userQuery} India US stock market latest 2026`);
      if (webData) ctx += `\nLIVE WEB SEARCH RESULTS:\n${webData}\n`;
    }
  }

  // 5. Portfolio context with full technicals
  if (portfolio && portfolio.length > 0) {
    const metrics = calculateMetrics(portfolio, livePrices, usdInrRate);
    ctx += `\nPORTFOLIO DASHBOARD:\n`;
    ctx += `Total Value: ₹${Math.round(metrics.totalValue).toLocaleString('en-IN')}\n`;
    ctx += `Invested: ₹${Math.round(metrics.totalInvested).toLocaleString('en-IN')}\n`;
    ctx += `Total P&L: ${metrics.totalPL >= 0 ? '+' : ''}₹${Math.round(metrics.totalPL).toLocaleString('en-IN')} (${metrics.plPct.toFixed(2)}%)\n`;
    ctx += `Today P&L: ${metrics.todayPL >= 0 ? '+' : ''}₹${Math.round(metrics.todayPL).toLocaleString('en-IN')} (${metrics.todayPct.toFixed(2)}%)\n`;
    ctx += `India Today: ${metrics.indPL >= 0 ? '+' : ''}₹${Math.round(metrics.indPL).toLocaleString('en-IN')}\n`;
    ctx += `US Today: ${metrics.usPL >= 0 ? '+' : ''}₹${Math.round(metrics.usPL).toLocaleString('en-IN')}\n\n`;

    ctx += `POSITIONS WITH LIVE TECHNICALS:\n`;
    for (const p of portfolio) {
      const key = `${p.market}_${p.symbol}`;
      const data = livePrices[key];
      const price = data?.price || p.avgPrice;
      const change = data?.change || 0;
      const rsi = data?.rsi || 50;
      const sma20 = data?.sma20;
      const sma50 = data?.sma50;
      const macd = data?.macd;
      const volume = data?.volume || 0;
      const plPct = p.avgPrice > 0 ? ((price - p.avgPrice) / p.avgPrice) * 100 : 0;
      const plAbs = (price - p.avgPrice) * p.qty;
      const plINR = p.market === 'US' ? plAbs * usdInrRate : plAbs;
      const sig = analyzeAsset(p, data);
      const curVal = price * p.qty;
      const curValINR = p.market === 'US' ? curVal * usdInrRate : curVal;
      const cur = p.market === 'IN' ? '₹' : '$';
      ctx += `${p.symbol.replace('.NS','')} [${p.market}]: ${cur}${price.toFixed(2)} (${change >= 0 ? '+' : ''}${change.toFixed(1)}%) | RSI=${rsi.toFixed(0)} | MACD=${macd?.toFixed(2) || 'N/A'} | SMA20=${sma20?.toFixed(1) || 'N/A'} SMA50=${sma50?.toFixed(1) || 'N/A'} | Vol=${(volume/1000000).toFixed(1)}M | Signal=${sig.signal} (${sig.confidence}%) | Qty=${p.qty} Avg=${cur}${p.avgPrice.toFixed(2)} P&L=${plPct.toFixed(1)}% (₹${Math.round(plINR).toLocaleString('en-IN')}) Val=₹${Math.round(curValINR).toLocaleString('en-IN')}\n`;
    }
  }

  return ctx;
}

// ============================================
// SYSTEM PROMPT — Pro Trader Hinglish AI
// ============================================
function buildSystemPrompt(contextData, intent) {
  const todayDate = new Date().toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata', day: '2-digit', month: 'short', year: 'numeric' });
  const currentTime = new Date().toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit' });
  
  return `You are DEEP MIND AI QUANTUM PRO v4.0 — Elite Institutional-Grade Trading Intelligence for Indian & US markets. You have access to REAL-TIME LIVE market data feeds.

PERSONA: You are a seasoned institutional quant trader (15+ years NSE, BSE, NYSE, NASDAQ, FnO, Options) guiding Nagraj Bhai like a senior trader mentoring a junior. You think like Goldman Sachs + Citadel + Renaissance Technologies combined.

CRITICAL ANTI-HALLUCINATION RULES:
- TODAY'S DATE: ${todayDate} | TIME: ${currentTime} IST
- ONLY use the REAL-TIME data provided below. Do NOT invent, guess, or use memorized old prices.
- If data is not available for a symbol, say "Live data not available" — do NOT make up numbers.
- All prices, RSI, MACD values MUST come from the live data below. If missing, explicitly state it.
- NEVER reference old/historical prices from your training data as current prices.

TRADING RULES:
1. Speak strictly in "Pro Trader Hinglish" — use terms like "Bhai", "Breakout confirm hua", "SL trail karte chalo", "Fakeout se bacho", "Liquidity grab hua hai", "Smart Money ne accumulate kiya hai".
2. Use institutional frameworks: SMC (Smart Money Concepts), Wyckoff Phases, Elliott Wave counts, Fibonacci retracements/extensions, Order Flow analysis, Dark Pool activity.
3. Give SPECIFIC actionable levels: exact Support, Resistance, Stop Loss, Target 1, Target 2, Target 3 prices FROM THE DATA PROVIDED.
4. Include conviction scores (1-10) and precise risk-reward ratios (e.g., 1:2.5) for all setups.
5. For news/events: explain exact market impact like "RBI rate cut = Bank Nifty me 500 point rally expected".
6. Be concise, punchy, ultra-insightful. Max 600 words. Format with **bold** and emojis.
7. Always end with CLEAR ACTIONABLE VERDICT: 🟢 BUY / 🔴 SELL / 🟡 HOLD / ⏳ WAIT with specific price levels.
8. Reference USD/INR exchange rate when discussing US holdings in INR terms.
9. For portfolio queries, calculate and show actual P&L from the live data provided.

QUANTITATIVE EDGE:
- Calculate implied volatility impact on options
- Identify sector rotation patterns from the data
- Detect institutional accumulation/distribution via volume + price action
- Apply Kelly Criterion for position sizing recommendations
- Use Sharpe Ratio context for risk-adjusted returns

INTENT: ${intent}

LIVE REAL-TIME DATA (USE ONLY THIS — DO NOT INVENT DATA):
${contextData}`;
}

// ============================================
// MAIN CHAT FUNCTION — Advanced Fallback Chain
// ============================================
export async function chatWithAI(chatId, userMessage, portfolio = [], livePrices = {}, usdInrRate = 83.5) {
  // Get/create chat history
  if (!chatHistory.has(chatId)) chatHistory.set(chatId, []);
  const history = chatHistory.get(chatId);

  // Add user message to history
  history.push({ role: 'user', content: userMessage });

  // Detect intent and route to best model
  const { model: targetModel, intent, confidence } = detectIntent(userMessage);
  console.log(`  🧠 Intent: ${intent} | Target: ${targetModel} | Confidence: ${confidence}%`);

  // Build portfolio + market context
  let contextData = '';
  try {
    contextData = await buildContext(portfolio, livePrices, usdInrRate, userMessage);
  } catch (e) {
    console.warn('  ⚠ Context build partial failure:', e.message);
  }

  // Build system prompt
  const systemPrompt = buildSystemPrompt(contextData, intent);

  // Build messages for API
  const recentHistory = history.slice(-MAX_HISTORY).map(m => ({
    role: m.role,
    content: m.content
  }));

  let aiText = '';
  let usedModel = targetModel;

  // Build smart fallback chain based on target
  const modelChain = targetModel === 'gemini'
    ? ['gemini', 'groq', 'claude']
    : targetModel === 'claude'
    ? ['claude', 'gemini', 'groq']
    : ['groq', 'gemini', 'claude'];

  // Try each model in chain with retry
  for (const model of modelChain) {
    try {
      if (model === 'groq' && isGroqAvailable()) {
        console.log(`  ⚡ Trying Groq...`);
        aiText = await retryWithBackoff(() => callGroq(recentHistory, systemPrompt), 1, 800);
        usedModel = 'groq';
        recordEngineSuccess('groq');
        break;
      } else if (model === 'gemini' && isGeminiAvailable()) {
        console.log(`  🔵 Trying Gemini...`);
        aiText = await retryWithBackoff(() => callGemini(recentHistory, systemPrompt), 1, 1000);
        usedModel = 'gemini';
        recordEngineSuccess('gemini');
        break;
      } else if (model === 'claude' && isClaudeAvailable()) {
        console.log(`  🟣 Trying Claude...`);
        aiText = await retryWithBackoff(() => callClaude(recentHistory, systemPrompt), 1, 1000);
        usedModel = 'claude';
        recordEngineSuccess('claude');
        break;
      } else {
        console.log(`  ⏭ ${model} key not available, skipping...`);
      }
    } catch (e) {
      console.warn(`  ❌ ${model} FAILED:`, e.message);
      recordEngineFailure(model);
      continue;
    }
  }

  if (!aiText) {
    // All engines failed — provide diagnostic message
    const available = [];
    if (isGroqAvailable()) available.push('Groq');
    if (isGeminiAvailable()) available.push('Gemini');
    if (isClaudeAvailable()) available.push('Claude');

    if (available.length === 0) {
      aiText = '🤖 Bhai, koi bhi AI engine configured nahi hai!\n\n' +
        '🔑 Required API keys:\n' +
        '• GROQ_KEY (get from console.groq.com)\n' +
        '• GEMINI_API_KEY (get from aistudio.google.com/apikey)\n' +
        '• CLAUDE_API_KEY (get from console.anthropic.com)\n\n' +
        '.env file me keys set karo aur bot restart karo.';
    } else {
      aiText = `🤖 Bhai, sabhi AI engines (${available.join(', ')}) temporarily fail ho rahe hain.\n\n` +
        '⏳ Possible reasons:\n' +
        '• API rate limit hit ho gaya\n' +
        '• API keys expired ya invalid hain\n' +
        '• Network connectivity issue\n\n' +
        '🔄 Thodi der baad retry karo. Auto-recovery 30 sec me hoga.';
    }
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
  const modelLabel = usedModel === 'groq' ? 'Groq' : usedModel === 'gemini' ? 'Gemini 2.5' : usedModel === 'claude' ? 'Claude Sonnet 4' : 'System';

  return `${modelEmoji} <i>${modelLabel} | ${intent} | LIVE</i>\n\n${safeText}`;
}

export function clearChatHistory(chatId) {
  chatHistory.delete(chatId);
  return '🧹 Chat history cleared. Fresh start!';
}

// Health check export
export function getAIHealthStatus() {
  return {
    groq: { available: isGroqAvailable(), health: engineHealth.groq },
    gemini: { available: isGeminiAvailable(), health: engineHealth.gemini },
    claude: { available: isClaudeAvailable(), health: engineHealth.claude }
  };
}
