// ============================================
// AI CHAT ENGINE — DEEP MIND AI ADVANCE PRO v22
// Primary: Google Gemini (1,500 req/day free)
// Fallback: Groq Llama 3.3 70B (100K tokens/day free)
// ============================================
import {
  GROQ_KEY, GEMINI_KEY, CLAUDE_KEY, TAVILY_API_KEY,
  isGroqAvailable, isGeminiAvailable, isClaudeAvailable, isTavilyAvailable,
  ALPHA_ETFS_IN, ALPHA_ETFS_US
} from './config.mjs';
import { fetchMarketIntelligence, fetchForexRate } from './market.mjs';
import { calculateMetrics, analyzeAsset } from './analysis.mjs';

let realtimeMarketCache = { data: null, timestamp: 0 };
let realtimeForexCache = { rate: 85.5, timestamp: 0 };

const chatHistory = new Map();
const MAX_HISTORY = 10;

let cachedIntel = null;
let intelTimestamp = 0;

const engineHealth = {
  groq: { failures: 0, lastFailure: 0, cooldownMs: 30000 },
  gemini: { failures: 0, lastFailure: 0, cooldownMs: 15000 },
  claude: { failures: 0, lastFailure: 0, cooldownMs: 15000 }
};

function recordEngineFailure(engine = 'groq') {
  if (!engineHealth[engine]) return;
  engineHealth[engine].failures++;
  engineHealth[engine].lastFailure = Date.now();
}
function recordEngineSuccess(engine = 'groq') {
  if (!engineHealth[engine]) return;
  engineHealth[engine].failures = 0;
}

console.log(`🤖 Gemini: ${isGeminiAvailable() ? '✓ Active' : '✗ Key Missing'} | Groq: ${isGroqAvailable() ? '✓ Active' : '✗ Key Missing'}`);

async function retryWithBackoff(fn, maxRetries = 2, baseDelay = 1000) {
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try { return await fn(); }
    catch (err) {
      if (attempt === maxRetries) throw err;
      const delay = baseDelay * Math.pow(2, attempt) + Math.random() * 500;
      console.warn(`  ↻ Retry ${attempt + 1}/${maxRetries} after ${Math.round(delay)}ms...`);
      await new Promise(r => setTimeout(r, delay));
    }
  }
}

// ============================================
// TAVILY REAL-TIME WEB SEARCH
// ============================================
async function fetchRealtimeWebData(query) {
  if (!isTavilyAvailable()) return '';
  try {
    const res = await fetch('https://api.tavily.com/search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        api_key: TAVILY_API_KEY, query,
        search_depth: 'advanced', include_answer: true,
        max_results: 5, topic: 'finance'
      }),
      signal: AbortSignal.timeout(8000)
    });
    if (res.ok) {
      const data = await res.json();
      let ctx = '';
      if (data.answer) ctx += `LIVE WEB INTEL: ${data.answer}\n`;
      if (data.results) for (const r of data.results.slice(0, 3)) ctx += `• ${r.title}: ${r.content?.substring(0, 200)}\n`;
      return ctx;
    }
  } catch (e) { console.warn('Tavily:', e.message); }
  return '';
}

// ============================================
// REAL-TIME MARKET SNAPSHOT
// ============================================
async function getRealtimeMarketSnapshot() {
  const now = Date.now();
  if (realtimeMarketCache.data && now - realtimeMarketCache.timestamp < 60000) return realtimeMarketCache.data;
  try {
    const tickers = ['NSE:NIFTY','BSE:SENSEX','NSE:BANKNIFTY','AMEX:SPY','NASDAQ:QQQ','CBOE:VIX','NSE:INDIAVIX','TVC:DXY','COMEX:GC1!','NYMEX:CL1!','BITSTAMP:BTCUSD'];
    const res = await fetch('https://scanner.tradingview.com/global/scan', {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=UTF-8' },
      body: JSON.stringify({ symbols: { tickers }, columns: ['name','close','change','high','low','volume'] }),
      signal: AbortSignal.timeout(6000)
    });
    if (res.ok) {
      const data = await res.json();
      let snap = 'REAL-TIME MARKET SNAPSHOT:\n';
      const nm = {'NSE:NIFTY':'NIFTY50','BSE:SENSEX':'SENSEX','NSE:BANKNIFTY':'BANKNIFTY','AMEX:SPY':'S&P500','NASDAQ:QQQ':'NASDAQ100','CBOE:VIX':'US_VIX','NSE:INDIAVIX':'INDIA_VIX','TVC:DXY':'DXY','COMEX:GC1!':'GOLD','NYMEX:CL1!':'CRUDE_OIL','BITSTAMP:BTCUSD':'BITCOIN'};
      if (data?.data) for (const i of data.data) {
        const n = nm[i.s] || i.s; const p = parseFloat(i.d?.[1])||0; const c = parseFloat(i.d?.[2])||0;
        if (p>0) snap += `${n}: ${p.toFixed(2)} (${c>=0?'+':''}${c.toFixed(2)}%)\n`;
      }
      realtimeMarketCache = { data: snap, timestamp: now };
      return snap;
    }
  } catch (e) { console.warn('Market snap:', e.message); }
  return realtimeMarketCache.data || '';
}

async function getRealtimeForex() {
  const now = Date.now();
  if (now - realtimeForexCache.timestamp < 30000) return realtimeForexCache.rate;
  try { const r = await fetchForexRate(); realtimeForexCache = { rate: r, timestamp: now }; return r; }
  catch { return realtimeForexCache.rate; }
}

// ============================================
// GROQ LLAMA 3.3 70B — Fastest, most reliable Groq model
// Advance Pro v22 — Deep Research + Live Market Data
// ============================================
async function callGroq(messages, systemPrompt, modelName = 'llama-3.3-70b-versatile') {
  if (!isGroqAvailable()) throw new Error('Groq key missing');
  if (engineHealth.groq.failures >= 3 && Date.now() - engineHealth.groq.lastFailure < engineHealth.groq.cooldownMs) {
    throw new Error('Groq cooling down');
  }

  const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${GROQ_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: modelName, messages: [{ role: 'system', content: systemPrompt }, ...messages], temperature: 0.7, max_completion_tokens: 8000 }),
    signal: AbortSignal.timeout(30000)
  });

  if (!res.ok) {
    const err = await res.json().catch(()=>({}));
    throw new Error(`Groq ${res.status}: ${err.error?.message || res.statusText}`);
  }
  const data = await res.json();
  const text = data.choices?.[0]?.message?.content;
  if (!text || text.trim().length < 5) throw new Error('Groq empty response');
  return text;
}

// ============================================
// GOOGLE GEMINI — Primary engine (1,500 req/day free)
// ============================================
async function callGemini(messages, systemPrompt, modelName = 'gemini-2.0-flash') {
  if (!isGeminiAvailable()) throw new Error('Gemini key missing');
  if (engineHealth.gemini.failures >= 3 && Date.now() - engineHealth.gemini.lastFailure < engineHealth.gemini.cooldownMs) {
    throw new Error('Gemini cooling down');
  }

  const contents = messages.map(m => ({
    role: m.role === 'assistant' ? 'model' : 'user',
    parts: [{ text: m.content }]
  }));

  const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${modelName}:generateContent?key=${GEMINI_KEY}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents,
      systemInstruction: { parts: [{ text: systemPrompt }] },
      generationConfig: { temperature: 0.7, maxOutputTokens: 8000 }
    }),
    signal: AbortSignal.timeout(30000)
  });

  if (!res.ok) {
    const err = await res.json().catch(()=>({}));
    throw new Error(`Gemini ${res.status}: ${err.error?.message || res.statusText}`);
  }
  const data = await res.json();
  const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text || text.trim().length < 5) throw new Error('Gemini empty response');
  return text;
}

// ============================================
// ANTHROPIC CLAUDE — Third fallback engine
// ============================================
async function callClaude(messages, systemPrompt, modelName = 'claude-sonnet-4-20250514') {
  if (!isClaudeAvailable()) throw new Error('Claude key missing');
  if (engineHealth.claude?.failures >= 3 && Date.now() - engineHealth.claude.lastFailure < (engineHealth.claude?.cooldownMs || 30000)) {
    throw new Error('Claude cooling down');
  }

  const claudeMessages = messages.map(m => ({
    role: m.role === 'assistant' ? 'assistant' : 'user',
    content: m.content
  }));

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': CLAUDE_KEY,
      'anthropic-version': '2023-06-01',
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      model: modelName,
      max_tokens: 8000,
      system: systemPrompt,
      messages: claudeMessages
    }),
    signal: AbortSignal.timeout(30000)
  });

  if (!res.ok) {
    const err = await res.json().catch(()=>({}));
    throw new Error(`Claude ${res.status}: ${err.error?.message || res.statusText}`);
  }
  const data = await res.json();
  const text = data.content?.[0]?.text;
  if (!text || text.trim().length < 5) throw new Error('Claude empty response');
  return text;
}

// ============================================
// BUILD CONTEXT — Real-Time Portfolio + Market + Web
// ============================================
async function buildContext(portfolio, livePrices, usdInrRate, userQuery = '') {
  let ctx = '';
  const ms = await getRealtimeMarketSnapshot();
  if (ms) ctx += ms + '\n';
  const fx = await getRealtimeForex();
  ctx += `LIVE USD/INR: ₹${fx.toFixed(4)}\nTimestamp: ${new Date().toLocaleTimeString('en-IN', {timeZone:'Asia/Kolkata'})} IST\n\n`;

  const now = Date.now();
  if (!cachedIntel || now - intelTimestamp > 120000) {
    try { cachedIntel = await fetchMarketIntelligence(); intelTimestamp = now; }
    catch {}
  }
  if (cachedIntel) {
    ctx += `GLOBAL INDICES:\n`;
    cachedIntel.globalIndices.forEach(i => ctx += `${i.name}: ${i.price.toFixed(1)} (${i.change>=0?'+':''}${i.change.toFixed(1)}%)\n`);
    ctx += `\nSECTOR ROTATION:\n`;
    cachedIntel.sectors.forEach(s => ctx += `${s.name}: ${s.change>=0?'+':''}${s.change.toFixed(2)}%\n`);
    ctx += `Fear/Greed: ${cachedIntel.fearGreedScore}/100\nAI Narrative: ${cachedIntel.marketNarrative}\n\n`;
  }

  if (userQuery && isTavilyAvailable()) {
    if (/\b(news|market|nifty|sensex|fed|rbi|ipo|crude|gold|dollar|bitcoin|btc|crypto|budget|gdp|inflation|earnings|breaking|today|live)\b/i.test(userQuery)) {
      console.log('  🔍 Fetching live web data via Tavily...');
      const web = await fetchRealtimeWebData(userQuery + (/news|stock|crypto|market|price/i.test(userQuery)?'':' latest market news'));
      if (web) ctx += `\nLIVE WEB SEARCH RESULTS:\n${web}\n`;
    }
  }

  if (portfolio?.length) {
    const m = calculateMetrics(portfolio, livePrices, usdInrRate);
    ctx += `\nPORTFOLIO DASHBOARD:\nTotal Value: ₹${Math.round(m.totalValue).toLocaleString('en-IN')}\nInvested: ₹${Math.round(m.totalInvested).toLocaleString('en-IN')}\nTotal P&L: ${m.totalPL>=0?'+':''}₹${Math.round(m.totalPL).toLocaleString('en-IN')} (${m.plPct.toFixed(2)}%)\nToday P&L: ${m.todayPL>=0?'+':''}₹${Math.round(m.todayPL).toLocaleString('en-IN')} (${m.todayPct.toFixed(2)}%)\n\n`;
    ctx += `POSITIONS WITH LIVE TECHNICALS:\n`;
    for (const p of portfolio) {
      const k = `${p.market}_${p.symbol}`;
      const d = livePrices[k];
      const price = d?.price || p.avgPrice;
      const chg = d?.change || 0;
      const rsi = d?.rsi || 50;
      const plPct = p.avgPrice>0 ? ((price-p.avgPrice)/p.avgPrice)*100 : 0;
      const plAbs = (price-p.avgPrice)*p.qty;
      const plINR = p.market==='US' ? plAbs*usdInrRate : plAbs;
      const sig = analyzeAsset(p, d);
      const cur = p.market==='IN'?'₹':'$';
      ctx += `${p.symbol.replace('.NS','')} [${p.market}]: ${cur}${price.toFixed(2)} (${chg>=0?'+':''}${chg.toFixed(1)}%) | RSI=${rsi.toFixed(0)} | ${sig.signal}(${sig.confidence}%) | Qty=${p.qty} Avg=${cur}${p.avgPrice.toFixed(2)} P&L=${plPct.toFixed(1)}% (₹${Math.round(plINR).toLocaleString('en-IN')})\n`;
    }
  }
  return ctx;
}

// ============================================
// SYSTEM PROMPT — Groq Compound Super Intelligence
// ============================================
function buildSystemPrompt(contextData, intent) {
  const d = new Date().toLocaleDateString('en-IN', {timeZone:'Asia/Kolkata', day:'2-digit', month:'short', year:'numeric'});
  const t = new Date().toLocaleTimeString('en-IN', {timeZone:'Asia/Kolkata', hour:'2-digit', minute:'2-digit'});

  return `You are DEEP MIND AI ADVANCE PRO v22.0 — GROQ LLAMA 3.3 70B SUPER INTELLIGENCE. Elite institutional-grade trading & investment AI with REAL-TIME live market data. You have FULL ACCESS to the ENTIRE Wealth AI platform - every tab, every data point, every position in the portfolio. You MUST read and analyze ALL data provided below before responding.

PERSONA: Seasoned institutional quant trader (15+ years NSE/BSE/NYSE/NASDAQ/FnO/Options/Crypto) guiding Nagraj Bhai. Think Goldman Sachs + Citadel + Renaissance Technologies + Pantera Capital combined. Speak strictly in "Pro Trader Hinglish" — "Bhai", "Breakout confirm", "SL trail karo", "Smart Money accumulation".

MANDATORY DATA USAGE RULES — FOLLOW STRICTLY:
1. YOU MUST read the PORTFOLIO DATA below. It contains ALL positions with live prices, RSI, MACD, SMA, trend, signal, confidence, SL, TP, P&L, CAGR.
2. For EVERY response, reference at least 2-3 specific positions by name with their current price, RSI, and signal.
3. If user asks about portfolio — analyze EVERY position one by one. Do NOT skip any.
4. NEVER say "I don't have portfolio data" — the data is provided below. Read it.
5. Cross-reference portfolio positions with the LIVE MARKET DATA provided below.

TODAY: ${d} | ${t} IST

ANTI-HALLUCINATION: You MUST use ONLY the live data provided below. Do NOT invent prices. If data is missing, say "Live data not available".

ADVANCE PRO TRADING RULES:
1. Use SMC (Smart Money Concepts), Wyckoff phases, Elliott Wave counts, Fibonacci retracements/extensions for stocks. On-chain analysis, MVRV-Z score, Puell Multiple, halving cycles, whale tracking for crypto.
2. Give EXACT Support/Resistance/SL/Target 1/2/3 prices FROM THE PORTFOLIO DATA below.
3. Conviction scores (1-10) with rationale. Risk-reward ratio mandatory.
4. End with VERDICT: 🟢 STRONG BUY / 🟡 BUY / 🔴 STRONG SELL / ⚪ HOLD / ⏳ WAIT + exact entry price + 3 targets.
5. Emphasize LONG-TERM wealth creation (15-20 years), SIP step-up with specific amounts, power of compounding projections.
6. ALWAYS analyze EVERY position including crypto. No position should be ignored.

CRYPTO MASTER RULES: BTC supply cap 21M, halving cycle ~4yr, DCA strategy at -15% from ATH. Use MVRV Z-score (<0 = undervalued, >3 = overvalued), NVT ratio, exchange inflow/outflow, whale accumulation trends. BTC RSI: oversold<25, overbought>80.

ALPHA ETF UNIVERSE (use these CAGR/maxDD for wealth projections):
India: ${ALPHA_ETFS_IN.map(e => `${e.sym}(${e.name}): CAGR ${e.cagr}%, MaxDD ${e.maxDD}%`).join(' | ')}
US: ${ALPHA_ETFS_US.map(e => `${e.sym}(${e.name}): CAGR ${e.cagr}%, MaxDD ${e.maxDD}%`).join(' | ')}

INTENT: ${intent}

=== LIVE MARKET DATA (USE ONLY THIS) ===
${contextData}

=== END LIVE DATA ===

RESPONSE STRUCTURE:
- Start with a summary of current market regime
- Then list ALL portfolio positions with analysis
- For each position: current price, RSI, signal, verdict with levels
- End with overall strategy recommendation
- Use Pro Trader Hinglish throughout`;
}

// ============================================
// MAIN CHAT — Gemini → Groq → Claude (auto-failover)
// ============================================
export async function chatWithAI(chatId, userMessage, portfolio=[], livePrices={}, usdInrRate=83.5) {
  if (!chatHistory.has(chatId)) chatHistory.set(chatId, []);
  const history = chatHistory.get(chatId);
  history.push({ role: 'user', content: userMessage });

  const q = userMessage.toLowerCase();
  const isMarketQuery = /\b(news|market|live|nifty|sensex|breaking|ipo|fii|dii|rbi|fed|crude|gold|dollar|bitcoin|btc|crypto|budget|gdp|inflation|earnings|sector|global|pre.?market|gift\s*nifty)\b/i.test(q);
  const intent = isMarketQuery ? 'MARKET_INTEL' : (/\b(portfolio|analy|strategy|deep|comprehensive|fundamental|valuation|sip|retirement|cagr|projection)\b/i.test(q) ? 'DEEP_ANALYSIS' : 'GENERAL');
  console.log(`  🧠 Intent: ${intent}`);

  let contextData = '';
  try { contextData = await buildContext(portfolio, livePrices, usdInrRate, userMessage); }
  catch {}

  const systemPrompt = buildSystemPrompt(contextData, intent);
  const recentHistory = history.slice(-MAX_HISTORY).map(m => ({ role: m.role, content: m.content }));

  let aiText = '';
  let usedEngine = '';

  // Try Gemini first (1,500 req/day free — most generous)
  try {
    if (isGeminiAvailable()) {
      console.log('  🔷 Gemini Flash...');
      aiText = await retryWithBackoff(() => callGemini(recentHistory, systemPrompt), 1, 800);
      recordEngineSuccess('gemini');
      usedEngine = 'gemini';
    }
  } catch (e) {
    console.warn('  ❌ Gemini failed:', e.message);
    recordEngineFailure('gemini');
  }

  // Fallback to Groq
  if (!aiText) {
    try {
      if (isGroqAvailable()) {
        console.log('  ⚡ Groq Llama 3.3...');
        aiText = await retryWithBackoff(() => callGroq(recentHistory, systemPrompt), 1, 800);
        recordEngineSuccess('groq');
        usedEngine = 'groq';
      }
    } catch (e) {
      console.warn('  ❌ Groq failed:', e.message);
      recordEngineFailure('groq');
    }
  }

  // Fallback to Claude
  if (!aiText) {
    try {
      if (isClaudeAvailable()) {
        console.log('  🟣 Claude Sonnet...');
        aiText = await retryWithBackoff(() => callClaude(recentHistory, systemPrompt), 1, 800);
        recordEngineSuccess('claude');
        usedEngine = 'claude';
      }
    } catch (e) {
      console.warn('  ❌ Claude failed:', e.message);
      recordEngineFailure('claude');
    }
  }

  if (!aiText) {
    const gemAvail = isGeminiAvailable();
    const groqAvail = isGroqAvailable();
    const claudeAvail = isClaudeAvailable();
    aiText = `🤖 **AI Unavailable** — Sabhi engines respond nahi kar paye.

🔷 Gemini: ${gemAvail ? '✓ Key set' : '✗ Key missing'}
⚡ Groq: ${groqAvail ? '✓ Key set' : '✗ Key missing'}
🟣 Claude: ${claudeAvail ? '✓ Key set' : '✗ Key missing'}

Server pe free API key set karo (ek bhi kaafi hai):
🔑 Gemini: https://aistudio.google.com/apikey (1,500 req/day)
🔑 Groq: https://console.groq.com (100K tokens/day)
🔑 Claude: https://console.anthropic.com (free tier)`;
    usedEngine = 'system';
  }

  let safeText = aiText.replace(/<think>[\s\S]*?<\/think>/gi, '').trim();
  safeText = safeText.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  safeText = safeText.replace(/\*\*(.+?)\*\*/g,'<b>$1</b>').replace(/\*(.+?)\*/g,'<i>$1</i>').replace(/`(.+?)`/g,'<code>$1</code>');

  history.push({ role: 'assistant', content: aiText });
  if (history.length > MAX_HISTORY * 2) history.splice(0, history.length - MAX_HISTORY);

  const label = usedEngine === 'gemini' ? '🔷 Gemini Flash' : usedEngine === 'groq' ? '⚡ Groq Llama 3.3' : usedEngine === 'claude' ? '🟣 Claude Sonnet' : '';
  return `${label} | ${intent} | LIVE\n\n${safeText}`;
}

export function clearChatHistory(chatId) {
  chatHistory.delete(chatId);
  return '🧹 Chat history cleared!';
}

export function getAIHealthStatus() {
  return {
    gemini: { available: isGeminiAvailable(), health: engineHealth.gemini },
    groq: { available: isGroqAvailable(), health: engineHealth.groq },
    claude: { available: isClaudeAvailable(), health: engineHealth.claude }
  };
}
