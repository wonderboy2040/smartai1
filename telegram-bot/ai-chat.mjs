// ============================================
// AI CHAT ENGINE — DEEP MIND AI ADVANCE PRO v23
// 6-Provider LLM Router + Quant Brain Fallback
// NEVER shows "AI Offline" — Quant Brain always works
// ============================================
import {
  GROQ_KEY, GEMINI_KEY, CLAUDE_KEY, TAVILY_API_KEY,
  OPENROUTER_KEY, CEREBRAS_KEY, HF_KEY, NVIDIA_KEY,
  isGroqAvailable, isGeminiAvailable, isClaudeAvailable, isTavilyAvailable,
  isOpenRouterAvailable, isCerebrasAvailable, isHFAvailable, isNvidiaAvailable,
  ALPHA_ETFS_IN, ALPHA_ETFS_US
} from './config.mjs';
import { fetchMarketIntelligence, fetchForexRate } from './market.mjs';
import { calculateMetrics, analyzeAsset } from './analysis.mjs';

let realtimeMarketCache = { data: null, timestamp: 0 };
let realtimeForexCache = { rate: 85.5, timestamp: 0 };

const chatHistory = new Map();
const MAX_HISTORY = 10;

// ============================================
// AI MODEL SELECTION — per-chat engine preference
// ============================================
export const AI_ENGINE_LABELS = {
  auto: '⚡ Auto (Smart Failover)',
  gemini: '🔷 Gemini 2.5 Flash',
  groq: '⚡ Groq Llama 3.3 70B',
  claude: '🟣 Claude Sonnet 4',
  openrouter: '🔶 OpenRouter Llama 3.3',
  cerebras: '🧠 Cerebras Llama 3.3',
  huggingface: '🤗 HuggingFace Qwen 72B',
  nvidia: '🟢 NVIDIA Llama 3.3 70B',
};
const chatEnginePref = new Map(); // chatId -> engineId
export function setChatEngine(chatId, engine) {
  if (!AI_ENGINE_LABELS[engine]) return false;
  chatEnginePref.set(String(chatId), engine);
  return true;
}
export function getChatEngine(chatId) {
  return chatEnginePref.get(String(chatId)) || 'auto';
}

let cachedIntel = null;
let intelTimestamp = 0;

// ============================================
// ENGINE HEALTH — 6 providers with cooldown
// ============================================
const engineHealth = {
  nvidia: { failures: 0, lastFailure: 0, cooldownMs: 15000 },
  groq: { failures: 0, lastFailure: 0, cooldownMs: 30000 },
  gemini: { failures: 0, lastFailure: 0, cooldownMs: 15000 },
  claude: { failures: 0, lastFailure: 0, cooldownMs: 15000 },
  openrouter: { failures: 0, lastFailure: 0, cooldownMs: 30000 },
  cerebras: { failures: 0, lastFailure: 0, cooldownMs: 30000 },
  huggingface: { failures: 0, lastFailure: 0, cooldownMs: 60000 },
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

console.log(`🤖 AI Engines: Gemini=${isGeminiAvailable()} Groq=${isGroqAvailable()} Claude=${isClaudeAvailable()} OpenRouter=${isOpenRouterAvailable()} Cerebras=${isCerebrasAvailable()} HF=${isHFAvailable()}`);

async function retryWithBackoff(fn, maxRetries = 1, baseDelay = 500) {
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try { return await fn(); }
    catch (err) {
      if (attempt === maxRetries) throw err;
      const delay = baseDelay * Math.pow(2, attempt) + Math.random() * 300;
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
        search_depth: 'basic', include_answer: true,
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
// LLM CALLERS — 6 Providers
// ============================================

// 0) NVIDIA (Primary Fallback out-of-the-box)
async function callNvidia(messages, systemPrompt, modelName = 'meta/llama-3.3-70b-instruct') {
  if (!isNvidiaAvailable()) throw new Error('NVIDIA key missing');
  if (engineHealth.nvidia.failures >= 3 && Date.now() - engineHealth.nvidia.lastFailure < engineHealth.nvidia.cooldownMs) throw new Error('NVIDIA cooling down');
  const res = await fetch('https://integrate.api.nvidia.com/v1/chat/completions', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${NVIDIA_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: modelName, messages: [{ role: 'system', content: systemPrompt }, ...messages], temperature: 0.7, max_tokens: 4000 }),
    signal: AbortSignal.timeout(10000)
  });
  if (!res.ok) { const err = await res.json().catch(()=>({})); throw new Error(`NVIDIA ${res.status}: ${err.error?.message||res.statusText}`); }
  const data = await res.json();
  const text = data.choices?.[0]?.message?.content;
  if (!text || text.trim().length < 5) throw new Error('NVIDIA empty response');
  return text;
}

// 1) GOOGLE GEMINI
async function callGemini(messages, systemPrompt, modelName = 'gemini-2.5-flash') {
  if (!isGeminiAvailable()) throw new Error('Gemini key missing');
  if (engineHealth.gemini.failures >= 3 && Date.now() - engineHealth.gemini.lastFailure < engineHealth.gemini.cooldownMs) throw new Error('Gemini cooling down');
  const contents = messages.map(m => ({ role: m.role === 'assistant' ? 'model' : 'user', parts: [{ text: m.content }] }));
  const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${modelName}:generateContent?key=${GEMINI_KEY}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ contents, systemInstruction: { parts: [{ text: systemPrompt }] }, generationConfig: { temperature: 0.7, maxOutputTokens: 8000 } }),
    signal: AbortSignal.timeout(10000)
  });
  if (!res.ok) { const err = await res.json().catch(()=>({})); throw new Error(`Gemini ${res.status}: ${err.error?.message||res.statusText}`); }
  const data = await res.json();
  const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text || text.trim().length < 5) throw new Error('Gemini empty response');
  return text;
}

// 2) GROQ LLAMA 3.3
async function callGroq(messages, systemPrompt, modelName = 'llama-3.3-70b-versatile') {
  if (!isGroqAvailable()) throw new Error('Groq key missing');
  if (engineHealth.groq.failures >= 3 && Date.now() - engineHealth.groq.lastFailure < engineHealth.groq.cooldownMs) throw new Error('Groq cooling down');
  const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST', headers: { 'Authorization': `Bearer ${GROQ_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: modelName, messages: [{ role: 'system', content: systemPrompt }, ...messages], temperature: 0.7, max_completion_tokens: 8000 }),
    signal: AbortSignal.timeout(10000)
  });
  if (!res.ok) { const err = await res.json().catch(()=>({})); throw new Error(`Groq ${res.status}: ${err.error?.message||res.statusText}`); }
  const data = await res.json();
  const text = data.choices?.[0]?.message?.content;
  if (!text || text.trim().length < 5) throw new Error('Groq empty response');
  return text;
}

// 3) ANTHROPIC CLAUDE
async function callClaude(messages, systemPrompt, modelName = 'claude-sonnet-4-20250514') {
  if (!isClaudeAvailable()) throw new Error('Claude key missing');
  if (engineHealth.claude?.failures >= 3 && Date.now() - engineHealth.claude.lastFailure < (engineHealth.claude?.cooldownMs||30000)) throw new Error('Claude cooling down');
  const claudeMessages = messages.map(m => ({ role: m.role === 'assistant' ? 'assistant' : 'user', content: m.content }));
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'x-api-key': CLAUDE_KEY, 'anthropic-version': '2023-06-01', 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: modelName, max_tokens: 8000, system: systemPrompt, messages: claudeMessages }),
    signal: AbortSignal.timeout(10000)
  });
  if (!res.ok) { const err = await res.json().catch(()=>({})); throw new Error(`Claude ${res.status}: ${err.error?.message||res.statusText}`); }
  const data = await res.json();
  const text = data.content?.[0]?.text;
  if (!text || text.trim().length < 5) throw new Error('Claude empty response');
  return text;
}

// 4) OPENROUTER (free models)
async function callOpenRouter(messages, systemPrompt, modelName = 'meta-llama/llama-3.3-70b-instruct:free') {
  if (!isOpenRouterAvailable()) throw new Error('OpenRouter key missing');
  if (engineHealth.openrouter.failures >= 3 && Date.now() - engineHealth.openrouter.lastFailure < engineHealth.openrouter.cooldownMs) throw new Error('OpenRouter cooling down');
  const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${OPENROUTER_KEY}`, 'Content-Type': 'application/json', 'HTTP-Referer': 'https://smartai1.onrender.com' },
    body: JSON.stringify({ model: modelName, messages: [{ role: 'system', content: systemPrompt }, ...messages], temperature: 0.7, max_tokens: 8000 }),
    signal: AbortSignal.timeout(10000)
  });
  if (!res.ok) { const err = await res.json().catch(()=>({})); throw new Error(`OpenRouter ${res.status}: ${err.error?.message||res.statusText}`); }
  const data = await res.json();
  const text = data.choices?.[0]?.message?.content;
  if (!text || text.trim().length < 5) throw new Error('OpenRouter empty response');
  return text;
}

// 5) CEREBRAS
async function callCerebras(messages, systemPrompt, modelName = 'llama-3.3-70b') {
  if (!isCerebrasAvailable()) throw new Error('Cerebras key missing');
  if (engineHealth.cerebras.failures >= 3 && Date.now() - engineHealth.cerebras.lastFailure < engineHealth.cerebras.cooldownMs) throw new Error('Cerebras cooling down');
  const res = await fetch('https://api.cerebras.ai/v1/chat/completions', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${CEREBRAS_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: modelName, messages: [{ role: 'system', content: systemPrompt }, ...messages], temperature: 0.7, max_tokens: 8000 }),
    signal: AbortSignal.timeout(10000)
  });
  if (!res.ok) { const err = await res.json().catch(()=>({})); throw new Error(`Cerebras ${res.status}: ${err.error?.message||res.statusText}`); }
  const data = await res.json();
  const text = data.choices?.[0]?.message?.content;
  if (!text || text.trim().length < 5) throw new Error('Cerebras empty response');
  return text;
}

// 6) HUGGINGFACE INFERENCE
async function callHuggingFace(messages, systemPrompt, modelName = 'Qwen/Qwen2.5-72B-Instruct') {
  if (!isHFAvailable()) throw new Error('HF key missing');
  if (engineHealth.huggingface.failures >= 3 && Date.now() - engineHealth.huggingface.lastFailure < engineHealth.huggingface.cooldownMs) throw new Error('HuggingFace cooling down');
  // FIX M25: previously all turns (user+assistant) joined as a single blob
  // labeled "User:". Preserve turn structure so multi-turn context survives.
  const convo = messages.map(m => `${m.role === 'assistant' ? 'Assistant' : 'User'}: ${m.content}`).join('\n');
  const fullPrompt = `System: ${systemPrompt}\n\n${convo}\nAssistant:`;
  const res = await fetch(`https://api-inference.huggingface.co/models/${modelName}`, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${HF_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ inputs: fullPrompt, parameters: { max_new_tokens: 4096, temperature: 0.7 } }),
    signal: AbortSignal.timeout(15000)
  });
  if (!res.ok) { const err = await res.json().catch(()=>({})); throw new Error(`HF ${res.status}: ${JSON.stringify(err)}`); }
  const data = await res.json();
  const text = Array.isArray(data) && data[0] ? data[0].generated_text : data.generated_text || '';
  if (!text || text.trim().length < 5) throw new Error('HuggingFace empty response');
  return text;
}

// ============================================
// QUANT BRAIN — Deterministic fallback (always works)
// ============================================
// FIX H6: Previously searched for the literal string 'PORTFOLIO' in context
// lines, which never matched any position line. Now: if symbol is 'PORTFOLIO'
// (general query), extract the FIRST valid position line's price/change.
function quantBrainFallback(symbol, contextData) {
  const lines = contextData.split('\n');
  let rsi = 50, price = 0, change = 0;
  let foundPosition = false;

  for (const line of lines) {
    if (line.includes('RSI=')) {
      const m = line.match(/RSI=(\d+\.?\d*)/);
      if (m) rsi = parseFloat(m[1]);
    }
    // FIX H6: if symbol is 'PORTFOLIO' (general fallback), grab the FIRST
    // position line that has a price pattern. Otherwise look for the specific
    // symbol.
    const shouldMatch = symbol === 'PORTFOLIO' ? !foundPosition : line.includes(symbol);
    if (shouldMatch && line.includes(':')) {
      const m = line.match(/:\s*(\d+\.?\d+)\s*\(([+-]?\d+\.?\d*)%\)/);
      if (m) {
        price = parseFloat(m[1]);
        change = parseFloat(m[2]);
        foundPosition = true;
        if (symbol !== 'PORTFOLIO') break;  // found specific symbol, stop
      }
    }
  }

  let verdict = 'HOLD';
  let confidence = 55;
  let entry = price, sl = price * 0.95, tp1 = price * 1.05, tp2 = price * 1.10;

  if (rsi < 30) { verdict = 'STRONG_BUY'; confidence = 85; entry = price; sl = price * 0.93; tp1 = price * 1.08; tp2 = price * 1.15; }
  else if (rsi < 45) { verdict = 'BUY'; confidence = 70; entry = price; sl = price * 0.95; tp1 = price * 1.06; tp2 = price * 1.12; }
  else if (rsi > 75) { verdict = 'WAIT'; confidence = 60; }
  else if (rsi > 65) { verdict = 'HOLD'; confidence = 55; }

  // FIX CRIT: when price=0 (no data matched in context), `entry - sl = 0` →
  // R:R = NaN rendered as "R:R: NaN". Also `₹0.00` everywhere. Guard with a
  // safe denominator and a "no data" notice.
  const riskDenom = entry - sl;
  const rr = riskDenom > 0 ? ((tp1 - entry) / riskDenom).toFixed(2) : 'N/A';
  const noDataNote = price > 0 ? '' : '\n⚠️ No live price in context — values may be zero.';

  return `📊 QUANT BRAIN — ${symbol} (Auto-Analysis)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Verdict: ${verdict} (${confidence}%)
RSI: ${rsi} | Price: ₹${price.toFixed(2)} (${change >= 0 ? '+' : ''}${change.toFixed(2)}%)

🎯 Entry: ₹${entry.toFixed(2)}
🛑 Stop Loss: ₹${sl.toFixed(2)}
✅ Target 1: ₹${tp1.toFixed(2)}
✅ Target 2: ₹${tp2.toFixed(2)}
📐 R:R: ${rr}${noDataNote}

💡 ${rsi < 30 ? 'Deeply oversold — strong buying opportunity' : rsi < 45 ? 'Approaching oversold zone — accumulate' : rsi > 75 ? 'Overbought — wait for pullback' : 'Neutral — hold current position'}

⚡ LLM narration unavailable — Quant Brain always online`;
}

// ============================================
// ANTI-HALLUCINATION GUARD
// ============================================
// FIX H9: previously this function only logged a warning and ALWAYS returned
// the LLM text unchanged — fabricated numbers flowed through to the user.
// Now returns `null` when too many suspicious numbers are detected so the
// caller (chatWithAI) can fall back to Quant Brain.
function antiHallucinationCheck(llmText, contextData) {
  if (!llmText) return llmText;
  // Extract numbers from LLM response
  const numbersInText = (llmText.match(/\b\d+\.?\d*\b/g) || []);
  // Extract numbers from context (prices, RSI, etc.)
  const contextNumbers = (contextData.match(/\b\d+\.?\d*\b/g) || []);
  const contextSet = new Set(contextNumbers);
  // Flag suspicious numbers > 100 not in context, but exempt common market ranges
  // (Sensex 60K-100K, Nifty 15K-30K, stock prices 100-10000, BTC 20K-200K, percentages, years)
  const suspicious = numbersInText.filter(n => {
    const val = parseFloat(n);
    if (val <= 100) return false; // small numbers are fine
    if (contextSet.has(n)) return false; // number is in context data
    // Exempt common ranges: years (2020-2030), percentages (already small), round targets
    if (val >= 2020 && val <= 2035) return false; // years
    if (val % 100 === 0 && val <= 10000) return false; // round price targets like 500, 1000
    if (val % 1000 === 0 && val <= 100000) return false; // round levels like 20000, 50000
    return true;
  });
  // FIX: raised threshold from 5 → 15. Stock analysis naturally contains many numbers
  // (prices, targets, support/resistance, market caps) that won't match context exactly.
  // Previous threshold of 5 caused valid responses to be rejected, falling back to
  // the simplistic Quant Brain which gave inaccurate generic results.
  // FIX H4: raised from 15→30 to avoid discarding accurate LLM output that
  // contains support/resistance levels, market caps, percentages, etc.
  if (suspicious.length > 30) {
    console.warn(`  ⚠️ Anti-hallucination triggered: ${suspicious.length} suspicious numbers — falling back to Quant Brain`);
    return null;
  }
  if (suspicious.length > 8) {
    console.warn(`  ⚠️ Anti-hallucination warning: ${suspicious.length} suspicious numbers (keeping response with disclaimer)`);
    return llmText + '\n\n⚠️ Note: Some figures may be approximate. Verify critical numbers from live data.';
  }
  return llmText;
}

// ============================================
// 7-STEP PRO-TRADER SYSTEM PROMPT
// ============================================
function build7StepPrompt(contextData, intent) {
  const d = new Date().toLocaleDateString('en-IN', {timeZone:'Asia/Kolkata', day:'2-digit', month:'short', year:'numeric'});
  const t = new Date().toLocaleTimeString('en-IN', {timeZone:'Asia/Kolkata', hour:'2-digit', minute:'2-digit'});

  return `You are DEEP MIND AI SUPERINTELLIGENCE v4.0 — a market superintelligence engine with REAL-TIME 24x7 market data + portfolio-specific news + multi-engine routing + Quant Brain backup. Elite institutional-grade trading & investment AI. You NEVER go offline — Quant Brain always provides deterministic analysis. You have FULL, UNRESTRICTED ACCESS to the user's entire portfolio, transactions, live technicals, AND portfolio-specific news (fetched fresh from the web per query).

NEW IN v4.0:
- Portfolio-specific news headlines (top 5 holdings) fetched live via Tavily
- Per-holding "Inside Story" — derived insights from price action + RSI + MACD + SMA
- Auto-Warnings (overbought/sharp drops/negative news) + Auto-Opportunities (oversold/rallies/positive catalysts)
- Macro regime detection (VIX + breadth + DXY + gold)

PERSONA: You are the user's personal ADVANCE TOP PRO TRADER ASSISTANT — a seasoned institutional quant trader (20+ years NSE/BSE/NYSE/NASDAQ/FnO/Options/Crypto) who knows EVERYTHING about this user's portfolio and goals, available 24x7. Think Goldman Sachs + Citadel + Renaissance Technologies + Pantera Capital + Bridgewater combined. Speak in SIMPLE, EASY Hinglish so a normal person samajh jaye — "Bhai", "dekho", "simple words me", "isska matlab", "SL trail karo", "Smart Money accumulation".

SUPERINTELLIGENCE MANDATE (24x7 DEEP ANALYSIS):
- Connect MACRO (Fed/RBI, rates, inflation, DXY, bond yields, geopolitics, liquidity) WITH MICRO (individual stocks, sectors, crypto, the user's exact holdings).
- For market questions, cover: latest NEWS + INSIDE NEWS angle, key FACTS, FUNDAMENTALS, prevailing THEMES, and clear FUTURE PREDICTIONS based on the CURRENT live news/data below.
- Always relate everything to the user's actual positions: "isska aapke X pe ye asar".
- Be a teacher: explain the "why" in simple Hinglish, then give actionable DEEP tips. Proactively flag risks AND opportunities.

MANDATORY DATA USAGE RULES — FOLLOW STRICTLY:
1. YOU MUST read the PORTFOLIO DATA below. It contains ALL positions with live prices, RSI, MACD, SMA, trend, signal, confidence, SL, TP, P&L, CAGR.
2. For EVERY response, reference at least 2-3 specific positions by name with their current price, RSI, and signal.
3. If user asks about portfolio — analyze EVERY position one by one. Do NOT skip any.
4. NEVER say "I don't have portfolio data" — the data is provided below. Read it.

TODAY: ${d} | ${t} IST

CRITICAL ANTI-HALLUCINATION RULES:
- ONLY use the REAL-TIME data provided below. Do NOT invent, guess, or use memorized old prices.
- If data is not available, say "Live data not available" — do NOT make up numbers.

7-STEP ANALYSIS FRAMEWORK:
1. Regime: Risk-On/Neutral/Risk-Off (use VIX, FII/DII)
2. Trend: SMA50 vs SMA200 + ADX strength
3. Momentum: RSI level + MACD
4. Demand: Is price near demand zone / support?
5. Risk: SL distance, R:R ratio
6. Conviction: Map to STRONG_BUY / BUY / HOLD / WAIT
7. Action: Exact entry, SL, TP1/TP2 + position-sizing hint

ADVANCE PRO TRADING RULES:
1. Use SMC (Smart Money Concepts), Wyckoff phases, Elliott Wave counts, Fibonacci retracements/extensions for stocks. On-chain analysis, MVRV-Z score, Puell Multiple, halving cycles, whale tracking for crypto.
2. Give EXACT Support/Resistance/SL/Target 1/2/3 prices FROM THE PORTFOLIO DATA below.
3. Conviction scores (1-10) with rationale. Risk-reward ratio mandatory.
4. End with VERDICT: 🟢 STRONG BUY / 🟡 BUY / 🔴 STRONG SELL / ⚪ HOLD / ⏳ WAIT + exact entry price + 3 targets.
5. Emphasize LONG-TERM wealth creation (15-20 years), SIP step-up with specific amounts, power of compounding projections.
6. ALWAYS analyze EVERY position — stocks, ETFs, AND crypto. Read each ETF (Momentum, Smallcap, Junior BeES, SMH, VGT, SPCX etc.) by name. No position should EVER be ignored or skipped.

CRYPTO MASTER RULES: BTC supply cap 21M, halving cycle ~4yr, DCA strategy at -15% from ATH. Use MVRV Z-score (<0 = undervalued, >3 = overvalued), NVT ratio, exchange inflow/outflow, whale accumulation trends. BTC RSI: oversold<25, overbought>80.

ALPHA ETF UNIVERSE (use these CAGR/maxDD for wealth projections):
India: ${ALPHA_ETFS_IN.map(e => `${e.sym}(${e.name}): CAGR ${e.cagr}%, MaxDD ${e.maxDD}%`).join(' | ')}
US: ${ALPHA_ETFS_US.map(e => `${e.sym}(${e.name}): CAGR ${e.cagr}%, MaxDD ${e.maxDD}%`).join(' | ')}

INTENT: ${intent}

=== LIVE MARKET DATA (USE ONLY THIS) ===
${contextData}

=== END LIVE DATA ===

- Keep language SIMPLE Hinglish, easy to understand. Jargon ko explain karo.`;
}

// ============================================
// BUILD CONTEXT — Real-Time Portfolio + Market + Web
// ============================================
async function buildContext(portfolio, livePrices, usdInrRate, userQuery = '') {
  let ctx = '';
  const now = Date.now();

  // ===== PERFORMANCE FIX: Run ALL network calls in PARALLEL =====
  // Previously these were sequential (25-45s). Now parallel (6-10s max).
  const needsIntel = !cachedIntel || now - intelTimestamp > 60000;
  const q = (userQuery || '').toLowerCase();
  const isMarketQuery = /\b(news|market|nifty|sensex|fed|rbi|ipo|crude|gold|dollar|bitcoin|btc|crypto|budget|gdp|inflation|earnings|breaking|today|live)\b/i.test(q);
  const isPortfolioQuery = /\b(portfolio|analy|strategy|deep|comprehensive|fundamental|valuation|sip|retirement|cagr|projection|holding|position)\b/i.test(q);

  // Build list of parallel fetches
  const tasks = [
    getRealtimeMarketSnapshot(),  // 0: market snapshot
    getRealtimeForex(),            // 1: forex rate
  ];
  if (needsIntel) tasks.push(fetchMarketIntelligence()); // 2: market intel
  else tasks.push(Promise.resolve(cachedIntel));

  // Only fetch Tavily web data for market/news queries (skip for simple questions)
  if (userQuery && isTavilyAvailable() && isMarketQuery) {
    console.log('  🔍 Fetching live web data via Tavily (parallel)...');
    tasks.push(fetchRealtimeWebData(userQuery + (/news|stock|crypto|market|price/i.test(userQuery)?'':' latest market news'))); // 3
  } else {
    tasks.push(Promise.resolve('')); // 3: no Tavily needed
  }

  // Only fetch portfolio-specific news for portfolio queries (saves 8s+ for general questions)
  if (portfolio?.length && isTavilyAvailable() && (isPortfolioQuery || isMarketQuery)) {
    try {
      const topHoldings = [...portfolio]
        .sort((a, b) => ((livePrices[`${b.market}_${b.symbol}`]?.price || b.avgPrice) * b.qty) - ((livePrices[`${a.market}_${a.symbol}`]?.price || a.avgPrice) * a.qty))
        .slice(0, 5)
        .map(p => p.symbol.replace('.NS', '').replace('.BO', ''));
      if (topHoldings.length > 0) {
        console.log(`  📰 Fetching portfolio-specific news for: ${topHoldings.join(', ')} (parallel)`);
        const portfolioQuery = `${topHoldings.join(' ')} stock news latest quarterly results insider trading institutional moves today`;
        tasks.push(fetchRealtimeWebData(portfolioQuery)); // 4
      } else {
        tasks.push(Promise.resolve('')); // 4
      }
    } catch (e) {
      console.warn('Portfolio news query build failed:', e.message);
      tasks.push(Promise.resolve('')); // 4
    }
  } else {
    tasks.push(Promise.resolve('')); // 4: skip portfolio news for non-portfolio queries
  }

  // ===== Execute ALL network calls in parallel =====
  const results = await Promise.allSettled(tasks);
  const val = (i) => results[i]?.status === 'fulfilled' ? results[i].value : null;

  // 0: Market Snapshot
  const ms = val(0);
  if (ms) ctx += ms + '\n';

  // 1: Forex
  const fx = val(1) || 85.5;
  ctx += `LIVE USD/INR: ₹${fx.toFixed(4)}\nTimestamp: ${new Date().toLocaleTimeString('en-IN', {timeZone:'Asia/Kolkata'})} IST\n\n`;

  // 2: Market Intelligence
  const intel = val(2);
  if (intel) {
    if (needsIntel) { cachedIntel = intel; intelTimestamp = now; }
    ctx += `GLOBAL INDICES:\n`;
    intel.globalIndices.forEach(i => ctx += `${i.name}: ${i.price.toFixed(1)} (${i.change>=0?'+':''}${i.change.toFixed(1)}%)\n`);
    ctx += `\nSECTOR ROTATION:\n`;
    intel.sectors.forEach(s => ctx += `${s.name}: ${s.change>=0?'+':''}${s.change.toFixed(2)}%\n`);
    ctx += `Fear/Greed: ${intel.fearGreedScore}/100\nAI Narrative: ${intel.marketNarrative}\n\n`;
  }

  // 3: Tavily Web Data
  const web = val(3);
  if (web) ctx += `\nLIVE WEB SEARCH RESULTS:\n${web}\n`;

  // 4: Portfolio News
  const newsRes = val(4);
  if (newsRes) ctx += `\nPORTFOLIO-SPECIFIC NEWS (top holdings):\n${String(newsRes).substring(0, 1500)}\n`;

  // ===== Portfolio positions (local computation, no network) =====
  if (portfolio?.length) {
    const m = calculateMetrics(portfolio, livePrices, usdInrRate);
    ctx += `\nPORTFOLIO DASHBOARD:\nTotal Value: ₹${Math.round(m.totalValue).toLocaleString('en-IN')}\nInvested: ₹${Math.round(m.totalInvested).toLocaleString('en-IN')}\nTotal P&L: ${m.totalPL>=0?'+':''}₹${Math.round(m.totalPL).toLocaleString('en-IN')} (${m.plPct.toFixed(2)}%)\nToday P&L: ${m.todayPL>=0?'+':''}₹${Math.round(m.todayPL).toLocaleString('en-IN')} (${m.todayPct.toFixed(2)}%)\n\n`;
    ctx += `POSITIONS WITH LIVE TECHNICALS + INSIDE STORY:\n`;

    // Track warnings + opportunities for auto-flagging.
    const warnings = [];
    const opportunities = [];
    let topGainer = null, topLoser = null;


    for (const p of portfolio) {
      const k = `${p.market}_${p.symbol}`;
      const d = livePrices[k];
      const price = d?.price || p.avgPrice;
      const chg = d?.change || 0;
      const rsi = d?.rsi || 50;
      const sma20 = d?.sma20, sma50 = d?.sma50, macd = d?.macd;
      const plPct = p.avgPrice>0 ? ((price-p.avgPrice)/p.avgPrice)*100 : 0;
      const plAbs = (price-p.avgPrice)*p.qty;
      const plINR = p.market==='US' ? plAbs*usdInrRate : plAbs;
      const sig = analyzeAsset(p, d);
      const cur = p.market==='IN'?'₹':'$';
      ctx += `${p.symbol.replace('.NS','')} [${p.market}]: ${cur}${price.toFixed(2)} (${chg>=0?'+':''}${chg.toFixed(1)}%) | RSI=${rsi.toFixed(0)} | ${sig.signal}(${sig.confidence}%) | Qty=${p.qty} Avg=${cur}${p.avgPrice.toFixed(2)} P&L=${plPct.toFixed(1)}% (₹${Math.round(plINR).toLocaleString('en-IN')})\n`;

      // ===== INSIDE STORY (derived from price action + technicals) =====
      const stories = [];
      if (chg > 3) stories.push(`🔥 +${chg.toFixed(1)}% strong rally`);
      else if (chg < -3) stories.push(`⚠️ ${chg.toFixed(1)}% sharp drop`);
      if (rsi < 30) stories.push(`💎 RSI ${rsi.toFixed(0)} oversold — accumulation zone`);
      else if (rsi > 75) stories.push(`🚨 RSI ${rsi.toFixed(0)} overbought — distribution risk`);
      if (sma20 && sma50) {
        if (sma20 > sma50) stories.push(`🟢 Golden Cross`);
        else stories.push(`🔴 Death Cross`);
      }
      if (macd !== undefined) {
        if (macd > 0) stories.push(`📈 MACD bullish`);
        else stories.push(`📉 MACD bearish`);
      }
      if (plPct > 15) stories.push(`💰 +${plPct.toFixed(0)}% profit — trail SL`);
      else if (plPct < -15) stories.push(`💸 ${plPct.toFixed(0)}% loss — review thesis`);
      if (stories.length > 0) ctx += `  Inside Story: ${stories.join(' · ')}\n`;

      // Track warnings + opportunities
      if (rsi > 75) warnings.push(`${p.symbol} overbought (RSI ${rsi.toFixed(0)})`);
      if (rsi < 30) opportunities.push(`${p.symbol} oversold (RSI ${rsi.toFixed(0)}) — accumulation zone`);
      if (chg > 4) opportunities.push(`${p.symbol} +${chg.toFixed(1)}% rally`);
      if (chg < -4) warnings.push(`${p.symbol} ${chg.toFixed(1)}% drop`);
      if (!topGainer || chg > topGainer.pct) topGainer = { symbol: p.symbol, pct: chg };
      if (!topLoser || chg < topLoser.pct) topLoser = { symbol: p.symbol, pct: chg };
    }

    // ===== AUTO WARNINGS + OPPORTUNITIES (Superintelligence v4.0) =====
    if (warnings.length > 0) {
      ctx += `\n⚠️ AUTO WARNINGS:\n`;
      warnings.forEach(w => ctx += `• ${w}\n`);
    }
    if (opportunities.length > 0) {
      ctx += `\n💡 AUTO OPPORTUNITIES:\n`;
      opportunities.forEach(o => ctx += `• ${o}\n`);
    }
    if (topGainer) ctx += `\nTop Gainer: ${topGainer.symbol} (+${topGainer.pct.toFixed(2)}%)\n`;
    if (topLoser) ctx += `Top Loser: ${topLoser.symbol} (${topLoser.pct.toFixed(2)}%)\n`;
  }
  return ctx;
}

// ============================================
// MAIN CHAT — 6-Engine Router + Quant Brain Fallback
// NEVER shows "AI Offline" again
// ============================================
// FIX L7: chatMutex declared BEFORE chatWithAI (which references it) so the
// code reads top-down without TDZ confusion.
const chatMutex = new Map();

export async function chatWithAI(chatId, userMessage, portfolio=[], livePrices={}, usdInrRate=83.5) {
  // v17 FIX (memory hygiene): cap total tracked chats — on long dyno runs
  // stray chatIds could grow this Map forever. Maps iterate in insertion
  // order, so evict the oldest entries first.
  const MAX_CHATS = 20;
  if (!chatHistory.has(chatId) && chatHistory.size >= MAX_CHATS) {
    const oldest = chatHistory.keys().next().value;
    chatHistory.delete(oldest);
    chatMutex.delete(oldest);
  }
  if (!chatHistory.has(chatId)) chatHistory.set(chatId, []);
  const history = chatHistory.get(chatId);

  // FIX H15: race condition — two concurrent /ai calls from the same chatId
  // could interleave: both push `user` before either pushes `assistant`,
  // producing [u1, u2, a1, a2] instead of [u1, a1, u2, a2]. Use a per-chat
  // mutex (chain of promises) so chats serialize cleanly.
  const prev = chatMutex.get(chatId) || Promise.resolve();
  const next = prev.then(() => _chatWithAIInner(chatId, userMessage, history, portfolio, livePrices, usdInrRate));
  chatMutex.set(chatId, next.catch(() => {}));  // never let a rejection break the chain
  return next;
}

async function _chatWithAIInner(chatId, userMessage, history, portfolio, livePrices, usdInrRate) {
  history.push({ role: 'user', content: userMessage });

  const q = userMessage.toLowerCase();
  const isMarketQuery = /\b(news|market|live|nifty|sensex|breaking|ipo|fii|dii|rbi|fed|crude|gold|dollar|bitcoin|btc|crypto|budget|gdp|inflation|earnings|sector|global|pre.?market|gift\s*nifty)\b/i.test(q);
  const intent = isMarketQuery ? 'MARKET_INTEL' : (/\b(portfolio|analy|strategy|deep|comprehensive|fundamental|valuation|sip|retirement|cagr|projection)\b/i.test(q) ? 'DEEP_ANALYSIS' : 'GENERAL');
  console.log(`  🧠 Intent: ${intent}`);

  let contextData = '';
  try { contextData = await buildContext(portfolio, livePrices, usdInrRate, userMessage); }
  // FIX M3: log buildContext failures so Tavily/TradingView/calculateMetrics
  // errors don't silently produce empty context.
  catch (e) { console.warn('buildContext failed:', e.message); }

  const systemPrompt = build7StepPrompt(contextData, intent);
  const recentHistory = history.slice(-MAX_HISTORY).map(m => ({ role: m.role, content: m.content }));

  let aiText = '';
  let usedEngine = '';

  // Try 7 engines in order: NVIDIA -> Gemini -> Groq -> Claude -> OpenRouter -> Cerebras -> HuggingFace
  const engines = [
    { name: 'nvidia', fn: () => callNvidia(recentHistory, systemPrompt), available: isNvidiaAvailable },
    { name: 'gemini', fn: () => callGemini(recentHistory, systemPrompt), available: isGeminiAvailable },
    { name: 'groq', fn: () => callGroq(recentHistory, systemPrompt), available: isGroqAvailable },
    { name: 'claude', fn: () => callClaude(recentHistory, systemPrompt), available: isClaudeAvailable },
    { name: 'openrouter', fn: () => callOpenRouter(recentHistory, systemPrompt), available: isOpenRouterAvailable },
    { name: 'cerebras', fn: () => callCerebras(recentHistory, systemPrompt), available: isCerebrasAvailable },
    { name: 'huggingface', fn: () => callHuggingFace(recentHistory, systemPrompt), available: isHFAvailable },
  ];

  // Honor per-chat model selection: chosen engine first, rest as failover.
  const pref = getChatEngine(chatId);
  let orderedEngines = engines;
  if (pref && pref !== 'auto') {
    const chosen = engines.filter(e => e.name === pref);
    const rest = engines.filter(e => e.name !== pref);
    orderedEngines = [...chosen, ...rest];
    console.log(`  🎛️ Model preference: ${pref} (first)`);
  }

  for (const engine of orderedEngines) {
    try {
      if (engine.available()) {
        console.log(`  🤖 Trying ${engine.name}...`);
        aiText = await retryWithBackoff(engine.fn, 0, 500);
        recordEngineSuccess(engine.name);
        usedEngine = engine.name;
        break;
      }
    } catch (e) {
      console.warn(`  ❌ ${engine.name} failed: ${e.message}`);
      recordEngineFailure(engine.name);
    }
  }

  // QUANT BRAIN FALLBACK — NEVER show "AI Offline"
  if (!aiText) {
    console.log('  🧠 All LLMs unavailable — using Quant Brain fallback');
    aiText = quantBrainFallback('PORTFOLIO', contextData);
    usedEngine = 'quant_brain';
  }

  // Anti-hallucination check
  // FIX H9: handle `null` return (hallucination detected) → fall back to
  // Quant Brain so the user gets deterministic data instead of fabricated LLM
  // numbers.
  const checked = antiHallucinationCheck(aiText, contextData);
  if (checked === null) {
    console.log('  🧠 Anti-hallucination fallback → Quant Brain');
    aiText = quantBrainFallback('PORTFOLIO', contextData);
    usedEngine = 'quant_brain_hallucination_fallback';
  } else {
    aiText = checked;
  }

  let safeText = aiText.replace(/<think>[\s\S]*?<\/think>/gi, '').trim();
  safeText = safeText.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  safeText = safeText.replace(/\*\*(.+?)\*\*/g,'<b>$1</b>').replace(/\*(.+?)\*/g,'<i>$1</i>').replace(/`(.+?)`/g,'<code>$1</code>');

  history.push({ role: 'assistant', content: aiText });
  if (history.length > MAX_HISTORY * 2) history.splice(0, history.length - MAX_HISTORY);

  const engineLabels = {
    nvidia: '🟢 NVIDIA Llama', gemini: '🔷 Gemini Flash', groq: '⚡ Groq Llama 3.3', claude: '🟣 Claude Sonnet',
    openrouter: '🔶 OpenRouter', cerebras: '🧠 Cerebras', huggingface: '🤗 HuggingFace',
    quant_brain: '📊 Quant Brain',
  };
  const label = engineLabels[usedEngine] || usedEngine;
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
    claude: { available: isClaudeAvailable(), health: engineHealth.claude },
    openrouter: { available: isOpenRouterAvailable(), health: engineHealth.openrouter },
    cerebras: { available: isCerebrasAvailable(), health: engineHealth.cerebras },
    huggingface: { available: isHFAvailable(), health: engineHealth.huggingface },
  };
}
