import React, { useState, useRef, useEffect, useCallback } from 'react';
import { Send, BrainCircuit, X, Trash2, Copy, Check, Sparkles } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';

// AI Engine Configurations — Groq + Gemini (Free) + Claude (Paid fallback)
const CONFIG = {
  groq: {
    apiKey: import.meta.env.VITE_GROQ_API_KEY || '',
    baseUrl: 'https://api.groq.com/openai/v1/chat/completions',
    model: 'llama-3.3-70b-versatile',
    // Groq Compound — FREE agentic model with built-in real-time web search (Market Expert)
    marketModel: 'groq/compound'
  },
  gemini: {
    apiKey: import.meta.env.VITE_GEMINI_API_KEY || '',
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta/models',
    model: 'gemini-2.0-flash'
  },
  claude: {
    apiKey: import.meta.env.VITE_CLAUDE_API_KEY || '',
    baseUrl: 'https://api.anthropic.com/v1/messages',
    model: 'claude-sonnet-4-5'
  }
} as const;

// --- Server API Proxy (same-origin → no CORS → uses server env vars) ---
const PROXY_BASE = import.meta.env.VITE_API_PROXY || '';
let _proxyStatus: Promise<{ groq: boolean; gemini: boolean; claude: boolean; tavily: boolean } | null> | null = null;

async function getServerAIStatus() {
  if (!_proxyStatus) {
    _proxyStatus = (async () => {
      try {
        const res = await fetch(`${PROXY_BASE}/api/ai-status`, { signal: AbortSignal.timeout(3000) });
        return res.ok ? await res.json() : null;
      } catch { return null; }
    })();
  }
  return _proxyStatus;
}

async function proxyFetch(engine: 'groq' | 'gemini' | 'claude', body: any): Promise<Response | null> {
  const status = await getServerAIStatus();
  if (!status?.[engine]) return null;
  const res = await fetch(`${PROXY_BASE}/api/${engine}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(25000)
  });
  if (res.ok) return res;
  if (res.status === 503) return null; // key not configured on server → fallback to direct
  const err = await res.json().catch(() => ({}));
  throw new Error(err?.error || err?.error?.message || `${engine} proxy error: ${res.status}`);
}

// Fetch real-time market snapshot for AI context
async function fetchRealtimeSnapshot(): Promise<string> {
  try {
    const [idxRes, coindcxRes, bondRes] = await Promise.allSettled([
      fetch('https://scanner.tradingview.com/global/scan', {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain;charset=UTF-8' },
        body: JSON.stringify({
          symbols: {
            tickers: [
              'NSE:NIFTY', 'BSE:SENSEX', 'NSE:BANKNIFTY',
              'AMEX:SPY', 'NASDAQ:QQQ', 'CBOE:VIX', 'NSE:INDIAVIX',
              'TVC:DXY', 'COMEX:GC1!', 'NYMEX:CL1!'
            ]
          }, columns: ['name', 'close', 'change']
        }),
        signal: AbortSignal.timeout(5000)
      }),
      fetch('https://api.coindcx.com/exchange/ticker', {
        signal: AbortSignal.timeout(5000)
      }),
      fetch('https://scanner.tradingview.com/bond/scan', {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain;charset=UTF-8' },
        body: JSON.stringify({ symbols: { tickers: ['TVC:US10Y', 'TVC:IN10Y'] }, columns: ['description', 'close', 'change'] }),
        signal: AbortSignal.timeout(5000)
      })
    ]);

    let snap = 'REAL-TIME MARKET:\n';
    const nameMap: Record<string, string> = { 'NSE:NIFTY': 'NIFTY50', 'BSE:SENSEX': 'SENSEX', 'NSE:BANKNIFTY': 'BANKNIFTY', 'AMEX:SPY': 'S&P500', 'NASDAQ:QQQ': 'NASDAQ100', 'CBOE:VIX': 'US_VIX', 'NSE:INDIAVIX': 'INDIA_VIX', 'TVC:DXY': 'DXY', 'COMEX:GC1!': 'GOLD', 'NYMEX:CL1!': 'CRUDE_OIL' };

    // Indices
    if (idxRes.status === 'fulfilled' && idxRes.value.ok) {
      const data = await idxRes.value.json();
      for (const item of (data?.data || [])) {
        const n = nameMap[item.s] || item.s;
        const p = parseFloat(item.d?.[1]) || 0;
        const c = parseFloat(item.d?.[2]) || 0;
        if (p > 0) snap += `${n}: ${p.toFixed(2)} (${c >= 0 ? '+' : ''}${c.toFixed(2)}%)\n`;
      }
    }

    // Crypto (CoinDCX INR — matches user's exchange)
    const coinDcxNameMap: Record<string, string> = { 'BTCINR': 'BTC', 'ETHINR': 'ETH', 'SOLINR': 'SOL' };
    if (coindcxRes.status === 'fulfilled' && coindcxRes.value.ok) {
      const tickers = await coindcxRes.value.json();
      snap += '\nCRYPTO (CoinDCX INR):\n';
      for (const t of tickers) {
        if (coinDcxNameMap[t.market]) {
          const p = parseFloat(t.last_price) || 0;
          const c = parseFloat(t.change_24_hour) || 0;
          if (p > 0) {
            const inrStr = p >= 1000 ? `₹${p.toFixed(0).replace(/\B(?=(\d{3})+(?!\d))/g, ',')}` : `₹${p.toFixed(2)}`;
            snap += `${coinDcxNameMap[t.market]}: ${inrStr} (${c >= 0 ? '+' : ''}${c.toFixed(2)}%)\n`;
          }
        }
      }
    }

    // Bond Yields
    const bondMap: Record<string, string> = { 'TVC:US10Y': 'US_10Y_YIELD', 'TVC:IN10Y': 'INDIA_10Y_YIELD' };
    if (bondRes.status === 'fulfilled' && bondRes.value.ok) {
      const data = await bondRes.value.json();
      snap += '\nBOND YIELDS:\n';
      for (const item of (data?.data || [])) {
        const n = bondMap[item.s] || item.s;
        const p = parseFloat(item.d?.[1]) || 0;
        const c = parseFloat(item.d?.[2]) || 0;
        if (p > 0) snap += `${n}: ${p.toFixed(3)}% (${c >= 0 ? '+' : ''}${c.toFixed(3)})\n`;
      }
    }

    return snap;
  } catch { return ''; }
}

// Tavily web search for live news
async function fetchWebIntel(query: string, tavilyKey: string): Promise<string> {
  const apiKey = tavilyKey || import.meta.env.VITE_TAVILY_API_KEY || '';
  if (!apiKey) return '';
  try {
    const res = await fetch('https://api.tavily.com/search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ api_key: apiKey, query: `${query} ${/news|stock|crypto|market|price/i.test(query) ? '' : 'latest market news'}`, search_depth: 'basic', include_answer: true, max_results: 3, topic: 'finance' }),
      signal: AbortSignal.timeout(6000)
    });
    if (res.ok) {
      const data = await res.json();
      let ctx = '';
      if (data.answer) ctx += `LIVE NEWS: ${data.answer}\n`;
      for (const r of (data.results || []).slice(0, 2)) ctx += `• ${r.title}: ${r.content?.substring(0, 150)}\n`;
      return ctx;
    }
  } catch { }
  return '';
}

interface ChatMessage {
  role: 'user' | 'model' | 'system';
  text: string;
  timestamp: number;
  model?: 'market' | 'groq' | 'gemini' | 'claude' | 'system';
  sources?: Array<{ title: string; url: string }>;
}

const QUICK_ACTIONS = [
  { label: 'Market News', query: 'Latest Indian and US market news and analysis with key levels', icon: '📰', type: 'market' },
  { label: 'Portfolio Analysis', query: 'Analyze my ENTIRE portfolio deeply - every single position including crypto. Show P&L, technicals, fundamentals, and give specific BUY/HOLD/SELL verdict for each asset.', icon: '💼', type: 'claude' },
  { label: 'ETH Analysis', query: 'Deep analysis of my Ethereum (ETH) position with on-chain context, support/resistance levels, and long-term HODL thesis', icon: '🪙', type: 'gemini' },
  { label: 'Long-Term Strategy', query: 'Give me a 15-20 year wealth creation roadmap focusing on SIP step-up and compound growth', icon: '📈', type: 'claude' },
  { label: 'ETF Allocation', query: 'Analyze ETF allocations including Momentum, Smallcap and SPCX ETFs with growth projections', icon: '🎯', type: 'groq' }
];

const MODEL_COLORS = {
  market: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20',
  groq: 'bg-orange-500/10 text-orange-400 border-orange-500/20',
  gemini: 'bg-blue-500/10 text-blue-400 border-blue-500/20',
  claude: 'bg-purple-500/10 text-purple-400 border-purple-500/20',
  system: 'bg-slate-500/10 text-slate-400 border-slate-500/20'
};

export interface NeuralChatProps {
  groqKey?: string;
  geminiKey?: string;
  claudeKey?: string;
  portfolioContext: string;
  usdInrRate?: number;
}

export const NeuralChat = React.memo(({
  groqKey: propGroqKey,
  geminiKey: propGeminiKey,
  claudeKey: propClaudeKey,
  portfolioContext,
  usdInrRate: propUsdInrRate
}: NeuralChatProps) => {
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([{
    role: 'system',
    text: '🤖 **DEEP MIND AI ADVANCE PRO v16.0**\n\n**🔬 3-Engine AI Architecture:**\n🔵 **Google Gemini 2.0 Flash**: Real-time intel + Google Search grounding\n🟣 **Claude Sonnet 4.5**: Deep institutional analysis + strategy\n⚡ **Groq Llama-3.3 70B + Compound**: Ultra-fast + live web search\n🔍 **Tavily Search**: Live market news & web data\n\n**🧬 ADVANCE PRO Features:**\n• Deep Mind Analysis (Macro + Micro)\n• Deep Research (24x7 Live)\n• Real-Time Global Market Monitor\n• Portfolio Alert System (Hinglish)\n\n**📊 Real-Time Live Data Feeds:**\n• TradingView Scanner (NSE/BSE/NYSE/NASDAQ)\n• CoinDCX Live Crypto Prices (INR)\n• Bond Yields (US 10Y, India 10Y)\n• Live USD/INR Exchange Rate\n• Portfolio P&L with live technicals\n\nAsk anything — I have LIVE market data 24x7!',
    timestamp: Date.now(),
    model: 'system'
  }]);

  const [chatInput, setChatInput] = useState('');
  const [isThinking, setIsThinking] = useState(false);
  const [showChat, setShowChat] = useState(false);
  const [copiedIdx, setCopiedIdx] = useState<number | null>(null);
  const [selectedModel, setSelectedModel] = useState<'auto' | 'market' | 'groq' | 'gemini' | 'claude'>('auto');

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const chatContainerRef = useRef<HTMLDivElement>(null);

  const scrollToBottom = useCallback(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, []);

  useEffect(() => {
    if (showChat) scrollToBottom();
  }, [chatMessages, showChat, scrollToBottom]);

  const copyToClipboard = useCallback((text: string, idx: number) => {
    navigator.clipboard.writeText(text).then(() => {
      setCopiedIdx(idx);
      setTimeout(() => setCopiedIdx(null), 2000);
    }).catch(() => { });
  }, []);

  const clearChat = useCallback(() => {
    setChatMessages([{
      role: 'system',
      text: '🧹 **Chat cleared!**\n\nReady for new analysis!',
      timestamp: Date.now(),
      model: 'system'
    }]);
  }, []);

  // ============ RATE LIMITER & RETRY HELPER ============
  const lastRequestTimeRef = useRef<number>(0);
  const MIN_REQUEST_INTERVAL = 2000;

  const rateLimitedFetch = async <T,>(fn: () => Promise<T>): Promise<T> => {
    const now = Date.now();
    const timeSinceLastRequest = now - lastRequestTimeRef.current;
    
    if (timeSinceLastRequest < MIN_REQUEST_INTERVAL) {
      const waitTime = MIN_REQUEST_INTERVAL - timeSinceLastRequest;
      await new Promise(r => setTimeout(r, waitTime));
    }
    
    lastRequestTimeRef.current = Date.now();
    
    let retries = 0;
    const maxRetries = 3;
    let lastError: Error | null = null;
    
    while (retries <= maxRetries) {
      try {
        return await fn();
      } catch (e) {
        lastError = e instanceof Error ? e : new Error(String(e));
        const isRateLimit = lastError.message.includes('429') || lastError.message.includes('Too Many Requests');
        
        if (isRateLimit && retries < maxRetries) {
          const delay = Math.pow(2, retries + 1) * 2000 + Math.random() * 1000;
          console.warn(`Rate limited, retrying in ${delay}ms (attempt ${retries + 1}/${maxRetries})`);
          await new Promise(r => setTimeout(r, delay));
          retries++;
          continue;
        }
        throw lastError;
      }
    }
    
    throw lastError;
  };

  // ============ GROQ API (Ultra-Fast + Market Expert via groq/compound) ============
  const callGroq = async (messages: any[], systemPrompt: string, modelName: string = CONFIG.groq.model) => {
    const groqMessages = [{ role: 'system', content: systemPrompt }, ...messages.map(m => ({ role: m.role, content: m.content }))];

    const proxyRes = await proxyFetch('groq', { messages: groqMessages, model: modelName });
    if (proxyRes) {
      const data = await proxyRes.json();
      const text = data.choices?.[0]?.message?.content;
      if (!text || text.trim().length < 5) throw new Error('Groq returned empty response');
      return text;
    }

    const apiKey = import.meta.env.VITE_GROQ_API_KEY || propGroqKey || CONFIG.groq.apiKey;
    if (!apiKey || apiKey.length < 10) {
      throw new Error('Groq API Key missing — Render me VITE_GROQ_API_KEY set karo aur redeploy karo');
    }

    const directFetch = async () => {
      const res = await fetch(CONFIG.groq.baseUrl, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: modelName, messages: groqMessages, temperature: 0.7, max_tokens: 8000 }),
        signal: AbortSignal.timeout(20000)
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error?.message || `Groq Error: ${res.status}`);
      }
      return res.json();
    };

    const data = await rateLimitedFetch(directFetch);
    const text = data.choices?.[0]?.message?.content;
    if (!text || text.trim().length < 5) throw new Error('Groq returned empty response');
    return text;
  };

  // ============ GEMINI API (Real-time Intelligence) ============
  const callGemini = async (messages: any[], systemPrompt: string) => {
    const contents: Array<{ role: string; parts: Array<{ text: string }> }> = [];
    contents.push({ role: 'user', parts: [{ text: systemPrompt }] });
    contents.push({ role: 'model', parts: [{ text: 'Understood. DEEP MIND AI Pro Trader active. Ready for analysis in Pro Trader Hinglish.' }] });

    let lastRole = 'model';
    for (const m of messages) {
      const gemRole = m.role === 'assistant' ? 'model' : 'user';
      if (gemRole === lastRole) {
        contents[contents.length - 1].parts[0].text += '\n\n' + m.content;
      } else {
        contents.push({ role: gemRole, parts: [{ text: m.content }] });
        lastRole = gemRole;
      }
    }
    if (lastRole === 'model' && contents.length > 2) {
      contents.push({ role: 'user', parts: [{ text: 'Please respond.' }] });
    }

    const basePayload = {
      contents,
      generationConfig: { temperature: 0.7, maxOutputTokens: 8192, topP: 0.95, topK: 40 },
      safetySettings: [
        { category: 'HARM_CATEGORY_HARASSMENT', threshold: 'BLOCK_ONLY_HIGH' },
        { category: 'HARM_CATEGORY_HATE_SPEECH', threshold: 'BLOCK_ONLY_HIGH' },
        { category: 'HARM_CATEGORY_SEXUALLY_EXPLICIT', threshold: 'BLOCK_ONLY_HIGH' },
        { category: 'HARM_CATEGORY_DANGEROUS_CONTENT', threshold: 'BLOCK_ONLY_HIGH' }
      ]
    };

    const modelOptions = ['gemini-2.0-flash', 'gemini-2.0-flash-lite'];
    let lastError: any = null;

    for (const modelName of modelOptions) {
      // Try server proxy first
      const proxyRes = await proxyFetch('gemini', { ...basePayload, model: modelName });
      if (proxyRes) {
        try {
          const data = await proxyRes.json();
          if (data.candidates?.[0]?.finishReason === 'SAFETY') throw new Error('Gemini blocked by safety filters');
          const parts = data.candidates?.[0]?.content?.parts || [];
          const text = parts.map((p: any) => p.text || '').join('');
          if (!text || text.trim().length < 5) throw new Error('Gemini returned empty response');
          return text;
        } catch (e) {
          lastError = e instanceof Error ? e : new Error(String(e));
          if (lastError.message.includes('404') || lastError.message.includes('400')) continue;
          throw lastError;
        }
      }

      const apiKey = import.meta.env.VITE_GEMINI_API_KEY || propGeminiKey || CONFIG.gemini.apiKey;
      if (!apiKey || apiKey.length < 10) {
        throw new Error('Gemini API Key missing — Set VITE_GEMINI_API_KEY or add in Settings');
      }

      const targetUrl = `${CONFIG.gemini.baseUrl}/${modelName}:generateContent?key=${apiKey}`;

      const doFetch = async (): Promise<any> => {
        const res = await fetch(targetUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(basePayload),
          signal: AbortSignal.timeout(20000)
        });
        if (!res.ok) {
          const err = await res.json().catch(() => ({}));
          throw new Error(err.error?.message || `Gemini Error: ${res.status}`);
        }
        return res.json();
      };

      try {
        const data = await rateLimitedFetch(doFetch);
        if (data.candidates?.[0]?.finishReason === 'SAFETY') throw new Error('Gemini blocked by safety filters');
        const parts = data.candidates?.[0]?.content?.parts || [];
        const text = parts.map((p: any) => p.text || '').join('');
        if (!text || text.trim().length < 5) throw new Error('Gemini returned empty response');
        return text;
      } catch (e) {
        lastError = e instanceof Error ? e : new Error(String(e));
        if (lastError.message.includes('404') || lastError.message.includes('400')) continue;
        throw lastError;
      }
    }

    throw lastError || new Error('All Gemini model fallbacks failed');
  };

  // ============ CLAUDE API (Deep Analysis) ============
  const callClaude = async (messages: any[], systemPrompt: string) => {
    const fixed: Array<{ role: string; content: string }> = [];
    let expectedRole = 'user';
    for (const m of messages) {
      const role = m.role === 'assistant' ? 'assistant' : 'user';
      if (role === expectedRole) {
        fixed.push({ role, content: m.content });
        expectedRole = expectedRole === 'user' ? 'assistant' : 'user';
      } else if (role === 'user' && expectedRole === 'assistant') {
        fixed.push({ role: 'assistant', content: 'Samjha. Continue karo.' });
        fixed.push({ role: 'user', content: m.content });
        expectedRole = 'assistant';
      }
    }
    if (fixed.length === 0 || fixed[0].role !== 'user') {
      fixed.unshift({ role: 'user', content: 'Hello' });
    }

    const modelOptions = ['claude-sonnet-4-5', 'claude-3-5-haiku-latest'];
    let lastError: any = null;

    for (const modelName of modelOptions) {
      const payload = {
        model: modelName,
        max_tokens: 4096,
        system: systemPrompt,
        messages: fixed
      };

      // Try server proxy first
      const proxyRes = await proxyFetch('claude', payload);
      if (proxyRes) {
        try {
          const data = await proxyRes.json();
          const text = data.content?.[0]?.text;
          if (!text || text.trim().length < 5) throw new Error('Claude returned empty response');
          return text;
        } catch (e) {
          lastError = e instanceof Error ? e : new Error(String(e));
          continue;
        }
      }

      const apiKey = import.meta.env.VITE_CLAUDE_API_KEY || propClaudeKey || CONFIG.claude.apiKey;
      if (!apiKey || apiKey.length < 10) {
        throw new Error('Claude API Key missing — Set VITE_CLAUDE_API_KEY or add in Settings');
      }

      const doFetch = async (): Promise<any> => {
        const res = await fetch(CONFIG.claude.baseUrl, {
          method: 'POST',
          headers: {
            'x-api-key': apiKey,
            'anthropic-version': '2023-06-01',
            'anthropic-dangerous-direct-browser-access': 'true',
            'Content-Type': 'application/json'
          },
          body: JSON.stringify(payload),
          signal: AbortSignal.timeout(30000)
        });
        if (!res.ok) {
          const err = await res.json().catch(() => ({}));
          throw new Error(err.error?.message || `Claude Error: ${res.status}`);
        }
        return res.json();
      };

      try {
        const data = await rateLimitedFetch(doFetch);
        const text = data.content?.[0]?.text;
        if (!text || text.trim().length < 5) throw new Error('Claude returned empty response');
        return text;
      } catch (e) {
        lastError = e instanceof Error ? e : new Error(String(e));
        continue;
      }
    }

    throw lastError || new Error('All Claude model fallbacks failed');
  };

  // ============ MAIN AI ROUTER — Advanced Fallback Chain with Live Data ============
  const callAI = async (userMessage: string, model: string) => {
    const isNewsQuery = /\b(news|market|nifty|sensex|fed|rbi|ipo|crude|gold|dollar|breaking|aaj|today|live|bitcoin|btc|crypto|halving|eth|blockchain|defi|altcoin|binance|coinbase|regulation|sec)\b/i.test(userMessage);

    const results = await Promise.allSettled([
      fetchRealtimeSnapshot(),
      isNewsQuery ? fetchWebIntel(userMessage, '') : Promise.resolve('')
    ]);

    const marketData = results[0].status === 'fulfilled' ? results[0].value : '';
    const webIntelData = results[1].status === 'fulfilled' ? results[1].value : '';
    const forexRate = propUsdInrRate || 85.5;

    const portfolioCtx = portfolioContext || 'No portfolio data.';

    const systemPrompt = `You are DEEP MIND AI ADVANCE PRO v16.0 — Elite Institutional-Grade Trading & Investment Intelligence with DEEP RESEARCH + DEEP MIND ANALYSIS for Indian, US markets AND Cryptocurrency with REAL-TIME LIVE data access 24x7.

PERSONA: Seasoned institutional quant trader (15+ years NSE/BSE/NYSE/NASDAQ/FnO/Options/Crypto) guiding Nagraj Bhai. Think Goldman Sachs + Citadel + Renaissance Technologies + Pantera Capital combined.

CRITICAL ANTI-HALLUCINATION RULES:
- ONLY use the REAL-TIME data provided below. Do NOT invent, guess, or use memorized old prices.
- STRICT RULE: You are strictly forbidden from referencing old, offline training data for market analysis. Only the LIVE data injected below is valid.
- If data is not available for a symbol, say "Live data not available" — do NOT make up numbers.
- Today's date is ${new Date().toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata', day: '2-digit', month: 'short', year: 'numeric' })}.
- All prices, RSI, MACD values MUST come from the data below. If missing, explicitly state it.
- BTC/ETH trades 24/7 — ALWAYS use the live price from data below. NEVER use memorized/training prices for crypto.
- For crypto, prices can move 5-10% daily — old prices are DANGEROUS. Only use what's provided.

TRADING & INVESTMENT RULES:
1. Speak in "Pro Trader Hinglish" — "Bhai", "Breakout confirm hua", "SL trail karo", "Smart Money accumulation".
2. ALWAYS analyze EVERY asset from portfolio data. Do NOT skip any position including crypto.
3. Use frameworks: SMC, Wyckoff, Elliott Wave, Fibonacci, Order Flow for stocks. For crypto: on-chain analysis, halving cycles, supply dynamics, whale tracking.
4. Give SPECIFIC levels: Support, Resistance, SL, Target 1/2/3 with exact prices FROM THE DATA.
5. Include conviction (1-10) and risk-reward ratios for all setups.
6. For news: explain exact impact — "RBI cut = Bank Nifty 500pt rally expected", "ETH ETF inflows = bullish".
7. Be comprehensive and detailed. Use **Bold** + emojis.
8. End with VERDICT: 🟢 BUY / 🔴 SELL / 🟡 HOLD / ⏳ WAIT + levels.
9. Emphasize LONG-TERM wealth creation (15-20 years), compounding, and SIP step-up magic. Mention crypto adoption (BTC/ETH) as moonshot allocation.
10. USD/INR: ₹${forexRate.toFixed(4)} (LIVE). Convert US holdings to INR.
11. Calculate actual P&L from provided data.

CRYPTO-SPECIFIC RULES (MANDATORY for BTC/crypto queries):
- BTC Supply Cap: 21 million (scarcity thesis)
- Halving Cycle: ~4 years. Historically, BTC rallies 12-18 months post-halving.
- Key levels: All-time High, 200-week MA, realized price are critical for BTC.
- Use crypto-specific metrics: MVRV ratio, NVT ratio, Exchange outflows, Whale accumulation.
- For BTC portfolio analysis: Focus on DCA strategy, accumulation zones, and HODL thesis.
- BTC RSI thresholds are wider than stocks: Oversold < 25, Overbought > 80.
- Always mention BTC dominance trend if available.

LONG-TERM INVESTMENT PERSPECTIVE:
- This is a LONG-TERM HODL & SIP portfolio. Focus on accumulation strategy, not day-trading.
- For crypto: Emphasize DCA (Dollar-Cost Averaging) over timing the market.
- For ETFs: Focus on CAGR projections, compound growth, and allocation rebalancing.
- Always give a 3-5 year outlook alongside short-term analysis.
- Calculate projected portfolio value at 10%, 15%, 20% CAGR over 5/10/15 years.

REAL-TIME DATA PERMISSION (24x7 FULL ACCESS):
You HAVE FULL PERMISSION to use live web search results and ALL injected real-time market data 24x7 for: exact BUY/SELL price points, entry zones, stop-loss and target levels, backtesting context, and long-term (15-20 year) investment analysis. ALWAYS give EXACT actionable price points from the live data.

FUNDAMENTAL ANALYSIS PERMISSION:
You HAVE full permission to provide deep fundamental analysis including:
- On-chain metrics for crypto (supply, hash rate, active addresses, exchange flows)
- PE ratios, PB ratios, ROE, ROCE for stocks
- Intrinsic value calculations, DCF models, Graham Number
- Sector analysis, competitive moat assessment
- Dividend yield analysis, free cash flow analysis
- BTC stock-to-flow model interpretation

LIVE REAL-TIME DATA (USE ONLY THIS — DO NOT INVENT):
${marketData}
USD/INR: ₹${forexRate.toFixed(4)}
${webIntelData ? '\nLIVE NEWS:\n' + webIntelData : ''}

PORTFOLIO CONTEXT:
${portfolioCtx}`;

    // Filter out system messages, keep only user/assistant, limit to recent.
    // NOTE: chatMessages state is stale inside this closure (setState is async),
    // so the current user message MUST be appended explicitly — otherwise the AI
    // only sees the previous question and answers the wrong thing.
    const recentMessages = chatMessages
      .filter(m => m.role === 'user' || m.role === 'model')
      .slice(-8)
      .map(m => ({
        role: m.role === 'model' ? 'assistant' : 'user',
        content: m.text
      }));
    if (recentMessages.length === 0 || recentMessages[recentMessages.length - 1].content !== userMessage) {
      recentMessages.push({ role: 'user', content: userMessage });
    }

    // Build fallback chain: primary → fallback1 → fallback2...
    type Engine = 'market' | 'groq' | 'gemini' | 'claude';
    let chain: Engine[] = [];

    if (model === 'market') {
      chain = ['market', 'gemini', 'groq'];
    } else if (model === 'gemini') {
      chain = ['gemini', 'groq'];
    } else if (model === 'claude') {
      chain = ['claude', 'gemini', 'groq'];
    } else if (model === 'groq') {
      chain = ['groq', 'gemini'];
    } else {
      // auto — FREE engines first
      chain = ['groq', 'market', 'gemini', 'claude'];
    }

    const callers: Record<Engine, (msgs: any[], sp: string) => Promise<string>> = {
      market: (msgs, sp) => callGroq(msgs, sp, CONFIG.groq.marketModel),
      groq: callGroq,
      gemini: callGemini,
      claude: callClaude
    };

    // Try each engine with rate limiting and retries
    let fallbackError = '';
    for (const eng of chain) {
      try {
        const text = await rateLimitedFetch(() => callers[eng](recentMessages, systemPrompt));
        return { text, model: eng, fallbackError };
      } catch (e) {
        const errMsg = e instanceof Error ? e.message : String(e);
        console.warn(`${eng} failed:`, e);
        fallbackError += `⚠️ ${eng.toUpperCase()}: ${errMsg}\n`;
        continue;
      }
    }

    return { text: `🤖 **AI Engines Offline**\n\nBhai, Groq, Gemini aur Claude — sabhi engines fail ho gaye.\n\n**Possible reasons:**\n• API keys missing ya invalid\n• Rate limit hit\n• Network connectivity issues\n\nCheck .env file aur retry karo.`, model: 'system' as const };
  };

  const sendMessage = async (userMessage: string) => {
    if (!userMessage.trim()) return;
    if (isThinking) return;
    setIsThinking(true);

    setChatMessages(prev => [...prev, { role: 'user', text: userMessage, timestamp: Date.now() }]);

    try {
      const q = userMessage.toLowerCase();
      let selectedModelType = selectedModel;

      if (selectedModel === 'auto') {
        if (/\b(news|khabar|market|live|aaj|today|nifty|sensex|breaking|ipo|fii|dii|rbi|fed|crude|gold|dollar|vix|trend|intraday|pre.?market|global|sector|rally|crash|correction|bitcoin|btc|crypto|halving|eth|blockchain|defi|altcoin|binance|coinbase|regulation|sec)\b/i.test(q)) {
          selectedModelType = 'market';
        } else if (/\b(portfolio|analy[sz]|strategy|fundamental|backtest|risk|allocation|optimize|deep|comprehensive|options?|pcr|fibonacci|wyckoff|smc|elliott|valuation|dividend|dcf|compare|rebalance|hodl|dca|long.?term|cagr|projection|on.?chain|intrinsic)\b/i.test(q)) {
          selectedModelType = 'claude';
        } else {
          selectedModelType = 'groq';
        }
      }

      const result = await callAI(userMessage, selectedModelType);
      let finalText = result.text;
      // Show visible warning when engine fell back to a different model
      if (result.fallbackError && result.model !== selectedModelType) {
        finalText = `⚠️ **Fallback:** ${selectedModelType.toUpperCase()} respond nahi kar paya. ${result.model.toUpperCase()} se answer aa raha hai.\n\n**Errors:**\n${result.fallbackError}\n---\n\n${result.text}`;
      }
      setChatMessages(prev => [...prev, {
        role: 'model', text: finalText, timestamp: Date.now(), model: result.model
      } as ChatMessage]);
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : 'Unknown error';
      setChatMessages(prev => [...prev, {
        role: 'system',
        text: `❌ **Error:** ${errorMsg}\n\nAPI keys check karo ya retry karo.`,
        timestamp: Date.now(), model: 'system'
      }]);
    } finally {
      setIsThinking(false);
    }
  };

  const handleChat = () => {
    if (chatInput.trim()) {
      const msg = chatInput;
      setChatInput('');
      sendMessage(msg);
    }
  };

  return (
    <>
      <button
        onClick={() => setShowChat(!showChat)}
        className="fab fixed bottom-6 right-6 w-14 h-14 bg-gradient-to-br from-cyan-600/90 via-blue-800/90 to-indigo-900/90 rounded-2xl flex items-center justify-center border border-cyan-500/50 shadow-[0_0_30px_rgba(6,182,212,0.4)] z-[60] overflow-hidden group hover:scale-110 transition-transform"
      >
        {showChat ? <X className="text-white z-10" /> : <span className="text-2xl z-10">🧠</span>}
        <span className="absolute -top-1 -right-1 w-3.5 h-3.5 bg-emerald-400 rounded-full animate-pulse-dot z-10 border-2 border-slate-900" />
      </button>

      <AnimatePresence>
        {showChat && (
          <motion.div
            initial={{ opacity: 0, y: 20, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 20, scale: 0.95 }}
            className="fixed bottom-0 left-0 right-0 sm:bottom-24 sm:left-1/2 sm:right-auto sm:w-[520px] sm:-translate-x-1/2 h-[85vh] sm:h-[700px] max-h-[85vh] shadow-[0_0_50px_rgba(6,182,212,0.2)] z-[60] flex flex-col overflow-hidden sm:rounded-3xl border border-cyan-500/20"
          >
            <div className="absolute inset-0 bg-slate-950/90 backdrop-blur-xl border border-cyan-500/20 rounded-3xl" />

            {/* Header */}
            <div className="relative p-3 sm:p-4 border-b border-cyan-500/20 bg-gradient-to-r from-cyan-950/60 to-indigo-950/60 flex items-center justify-between rounded-t-3xl">
              <div className="flex items-center gap-2 sm:gap-3">
                <div className="w-9 h-9 sm:w-10 sm:h-10 bg-gradient-to-br from-cyan-800/60 to-indigo-900/60 border border-cyan-500/30 rounded-xl flex items-center justify-center flex-shrink-0">
                  <BrainCircuit className="text-cyan-400" size={18} />
                </div>
                <div className="min-w-0">
                  <h3 className="text-xs sm:text-sm font-black text-white uppercase tracking-tight flex items-center gap-1">
                    <span className="hidden xs:inline">Deep Mind AI</span>
                    <span className="xs:hidden">AI Assistant</span>
                    <span className="text-[7px] sm:text-[8px] bg-gradient-to-r from-cyan-500/20 to-indigo-500/20 text-cyan-300 px-1 py-0.5 rounded-md border border-cyan-500/20 font-bold tracking-wider whitespace-nowrap">ADVANCE PRO v16</span>
                  </h3>
                  <div className="text-[8px] sm:text-[9px] font-bold text-emerald-400 uppercase tracking-widest flex items-center gap-0.5">
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                    <span className="hidden sm:inline">Gemini 2.0 + Claude + Groq | Advance Pro</span>
                    <span className="sm:hidden">LIVE • Advance Pro</span>
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-1 sm:gap-1.5 flex-shrink-0">
                <button onClick={clearChat} className="text-slate-500 hover:text-red-400 bg-white/5 rounded-full p-1.5 transition-colors" title="Clear Chat"><Trash2 size={14} /></button>
                <button onClick={() => setShowChat(false)} className="text-slate-400 hover:text-white bg-white/5 rounded-full p-1.5 transition-colors"><X size={16} /></button>
              </div>
            </div>

            {/* Model Selector */}
            <div className="relative px-3 sm:px-4 py-3 bg-slate-900/40 border-b border-cyan-500/10 flex gap-2 overflow-x-auto scrollbar-hide">
              {(['auto', 'market', 'groq', 'gemini', 'claude'] as const).map(m => (
                <button
                  key={m}
                  onClick={() => setSelectedModel(m)}
                  className={`px-2 sm:px-3 py-1 rounded-full text-[9px] sm:text-[10px] font-bold uppercase transition-all border whitespace-nowrap ${selectedModel === m
                    ? 'bg-cyan-600 text-white border-cyan-400 shadow-[0_0_10px_rgba(6,182,212,0.3)]'
                    : 'bg-slate-800 text-slate-400 border-slate-700 hover:border-cyan-500/50'
                    }`}
                >
                  {m === 'auto' ? '🤖 Auto'
                    : m === 'market' ? '🌐 Market Expert'
                      : m === 'groq' ? '⚡ Groq'
                        : m === 'gemini' ? '🔵 Gemini'
                          : '🟣 Claude'}
                </button>
              ))}
            </div>

            {/* Messages */}
            <>
                <div ref={chatContainerRef} className="relative flex-1 overflow-y-auto p-3 sm:p-4 space-y-3 sm:space-y-4 scrollbar-hide">
                  {chatMessages.map((msg, i) => (
                    <div key={i} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'} animate-message-in`}>
                      <div className={`max-w-[85%] sm:max-w-[90%] rounded-2xl text-[12px] sm:text-[13px] leading-relaxed whitespace-pre-line ${msg.role === 'user'
                        ? 'bg-gradient-to-br from-cyan-600/90 to-blue-700/90 text-white rounded-br-none border border-cyan-500/30 px-3 py-2.5 sm:px-4 sm:py-3'
                        : 'bg-slate-900/90 text-slate-200 rounded-tl-none border border-white/5 px-3 py-2.5 sm:px-4 sm:py-3 group/msg'
                        }`}>
                        {msg.role === 'user' ? msg.text : (
                          <>
                            {msg.model && (
                              <div className={`inline-block px-2 py-0.5 rounded-md text-[9px] font-black uppercase mb-2 border ${MODEL_COLORS[msg.model] || MODEL_COLORS.system}`}>
                                {msg.model === 'market' ? '🌐 Market Expert Live'
                                  : msg.model === 'groq' ? '⚡ Groq'
                                    : msg.model === 'gemini' ? '🔵 Gemini'
                                      : msg.model === 'claude' ? '🟣 Claude'
                                        : 'System'}
                              </div>
                            )}
                            <span dangerouslySetInnerHTML={{
                              __html: (() => {
                                // Escape HTML entities first to prevent XSS
                                const escaped = msg.text
                                  .replace(/&/g, '&amp;')
                                  .replace(/</g, '&lt;')
                                  .replace(/>/g, '&gt;')
                                  .replace(/"/g, '&quot;');
                                return escaped
                                  .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
                                  .replace(/\*(.+?)\*/g, '<em>$1</em>')
                                  .replace(/`(.+?)`/g, '<code style="background:rgba(6,182,212,0.15);padding:1px 5px;border-radius:4px;font-size:0.85em">$1</code>');
                              })()
                            }} />
                            <div className="flex items-center gap-2 mt-2 opacity-0 group-hover/msg:opacity-100 transition-opacity">
                              <button onClick={() => copyToClipboard(msg.text, i)} className="text-[9px] text-slate-500 hover:text-cyan-400 flex items-center gap-1 transition-colors">
                                {copiedIdx === i ? <><Check size={10} /> Copied!</> : <><Copy size={10} /> Copy</>}
                              </button>
                            </div>
                          </>
                        )}
                        <div className={`text-[9px] mt-1 font-mono ${msg.role === 'user' ? 'text-cyan-200/50' : 'text-slate-600'}`}>
                          {new Date(msg.timestamp).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}
                        </div>
                      </div>
                    </div>
                  ))}

                  {isThinking && (
                    <div className="flex justify-start animate-message-in">
                      <div className="bg-slate-900/90 px-4 py-3 rounded-2xl rounded-tl-none border border-white/5">
                        <div className="flex items-center gap-2 text-[11px] text-cyan-400/70 mb-2 font-bold uppercase tracking-wider">
                          <Sparkles size={12} className="animate-pulse" /> AI is thinking...
                        </div>
                        <div className="flex gap-1.5">
                          <div className="w-2 h-2 bg-cyan-500 rounded-full animate-bounce" />
                          <div className="w-2 h-2 bg-cyan-500 rounded-full animate-bounce" style={{ animationDelay: '100ms' }} />
                          <div className="w-2 h-2 bg-cyan-500 rounded-full animate-bounce" style={{ animationDelay: '200ms' }} />
                        </div>
                      </div>
                    </div>
                  )}
                  <div ref={messagesEndRef} />
                </div>

                {/* Quick Actions */}
                <div className="relative px-3 sm:px-4 py-3 bg-slate-900/40 border-t border-cyan-500/10">
                  <div className="flex gap-2 overflow-x-auto scrollbar-hide">
                    {QUICK_ACTIONS.map((action, i) => (
                      <button
                        key={i}
                        onClick={() => { setChatInput(''); sendMessage(action.query); }}
                        disabled={isThinking}
                        className="flex items-center gap-1.5 whitespace-nowrap text-[9px] sm:text-[10px] font-bold px-2 sm:px-3 py-1.5 rounded-xl bg-white/[0.03] border border-white/10 text-slate-400 hover:text-white hover:border-cyan-500/50 hover:bg-cyan-500/5 transition-all disabled:opacity-30 shrink-0"
                      >
                        <span className="text-base">{action.icon}</span>
                        {action.label}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Input */}
                <div className="relative p-3 sm:p-4 bg-slate-950/95 border-t border-cyan-500/15 rounded-b-3xl">
                  <div className="relative flex items-center">
                    <input
                      type="text"
                      placeholder="Ask Deep Mind AI anything..."
                      className="w-full bg-slate-900/60 border border-slate-700/80 rounded-xl sm:rounded-2xl py-2.5 sm:py-3 pl-3 sm:pl-4 pr-10 sm:pr-12 text-xs sm:text-sm text-white outline-none focus:border-cyan-500/60 transition-all font-medium placeholder:text-slate-600"
                      value={chatInput}
                      onChange={(e) => setChatInput(e.target.value)}
                      onKeyDown={(e) => e.key === 'Enter' && handleChat()}
                    />
                    <button
                      onClick={handleChat}
                      disabled={isThinking || !chatInput.trim()}
                      className="absolute right-1 sm:right-1.5 p-1.5 sm:p-2 bg-gradient-to-r from-cyan-600 to-blue-700 hover:from-cyan-500 hover:to-blue-600 text-white rounded-lg sm:rounded-xl disabled:opacity-30 transition-all"
                    >
                      <Send size={14} />
                    </button>
                  </div>
                  <div className="flex items-center justify-between mt-1.5 sm:mt-2 px-1">
                    <span className="text-[7px] sm:text-[8px] text-slate-600 font-mono truncate max-w-[60%]">
                      Model: {selectedModel === 'auto' ? '🤖 Auto-Detect'
                        : selectedModel === 'market' ? '🌐 Market Expert'
                          : selectedModel === 'groq' ? '⚡ Groq'
                            : selectedModel === 'gemini' ? '🔵 Gemini'
                              : '🟣 Claude'}
                    </span>
                    <span className="text-[7px] sm:text-[8px] text-slate-600 flex-shrink-0">
                      {chatMessages.length} messages
                    </span>
                </div>
              </div>
            </>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
});
