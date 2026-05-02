import React, { useState, useRef, useEffect, useCallback } from 'react';
import { Send, BrainCircuit, X, Trash2, Copy, Check, Sparkles } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';

// AI Engine Configurations — Groq + Gemini 2.5 + Claude Sonnet 4 (Pro Quantum)
const CONFIG = {
  groq: {
    apiKey: import.meta.env.VITE_GROQ_API_KEY || '',
    baseUrl: 'https://api.groq.com/openai/v1/chat/completions',
    model: 'llama-3.3-70b-versatile'
  },
  gemini: {
    apiKey: import.meta.env.VITE_GEMINI_API_KEY || '',
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta/models',
    model: 'gemini-2.5-flash'
  },
  claude: {
    apiKey: import.meta.env.VITE_CLAUDE_API_KEY || '',
    baseUrl: 'https://api.anthropic.com/v1/messages',
    model: 'claude-sonnet-4-20250514'
  }
} as const;

const TAVILY_KEY = import.meta.env.VITE_TAVILY_API_KEY || '';

// Fetch real-time market snapshot for AI context
async function fetchRealtimeSnapshot(): Promise<string> {
  try {
    const tickers = [
      'NSE:NIFTY', 'BSE:SENSEX', 'NSE:BANKNIFTY',
      'AMEX:SPY', 'NASDAQ:QQQ', 'CBOE:VIX', 'NSE:INDIAVIX',
      'TVC:DXY', 'COMEX:GC1!', 'NYMEX:CL1!'
    ];
    const res = await fetch('https://scanner.tradingview.com/global/scan', {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=UTF-8' },
      body: JSON.stringify({ symbols: { tickers }, columns: ['name', 'close', 'change'] }),
      signal: AbortSignal.timeout(5000)
    });
    if (!res.ok) return '';
    const data = await res.json();
    const nameMap: Record<string, string> = { 'NSE:NIFTY': 'NIFTY50', 'BSE:SENSEX': 'SENSEX', 'NSE:BANKNIFTY': 'BANKNIFTY', 'AMEX:SPY': 'S&P500', 'NASDAQ:QQQ': 'NASDAQ100', 'CBOE:VIX': 'US_VIX', 'NSE:INDIAVIX': 'INDIA_VIX', 'TVC:DXY': 'DXY', 'COMEX:GC1!': 'GOLD', 'NYMEX:CL1!': 'CRUDE_OIL' };
    let snap = 'REAL-TIME MARKET:\n';
    for (const item of (data?.data || [])) {
      const n = nameMap[item.s] || item.s;
      const p = parseFloat(item.d?.[1]) || 0;
      const c = parseFloat(item.d?.[2]) || 0;
      if (p > 0) snap += `${n}: ${p.toFixed(2)} (${c >= 0 ? '+' : ''}${c.toFixed(2)}%)\n`;
    }
    return snap;
  } catch { return ''; }
}

// Fetch real-time USD/INR
async function fetchLiveForex(): Promise<number> {
  try {
    const res = await fetch('https://open.er-api.com/v6/latest/USD', { signal: AbortSignal.timeout(4000) });
    if (res.ok) {
      const data = await res.json();
      const rate = parseFloat(data?.rates?.INR);
      if (!isNaN(rate) && rate > 50 && rate < 150) return rate;
    }
  } catch {}
  return 85.5;
}

// Tavily web search for live news
async function fetchWebIntel(query: string): Promise<string> {
  if (!TAVILY_KEY) return '';
  try {
    const res = await fetch('https://api.tavily.com/search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ api_key: TAVILY_KEY, query: `${query} stock market India US latest`, search_depth: 'basic', include_answer: true, max_results: 3, topic: 'finance' }),
      signal: AbortSignal.timeout(6000)
    });
    if (res.ok) {
      const data = await res.json();
      let ctx = '';
      if (data.answer) ctx += `LIVE NEWS: ${data.answer}\n`;
      for (const r of (data.results || []).slice(0, 2)) ctx += `• ${r.title}: ${r.content?.substring(0, 150)}\n`;
      return ctx;
    }
  } catch {}
  return '';
}

interface ChatMessage {
  role: 'user' | 'model' | 'system';
  text: string;
  timestamp: number;
  model?: 'groq' | 'gemini' | 'claude' | 'system';
  sources?: Array<{ title: string; url: string }>;
}

const QUICK_ACTIONS = [
  { label: 'Market News', query: 'Latest Indian and US market news and analysis with key levels', icon: '📰', type: 'gemini' },
  { label: 'Portfolio Analysis', query: 'Analyze my portfolio deeply with fundamentals, technicals and actionable recommendations', icon: '📊', type: 'claude' },
  { label: 'Quick Question', query: 'Explain RSI divergence and how to use it for trading', icon: '⚡', type: 'groq' },
  { label: 'Trading Strategy', query: 'Give me detailed intraday and swing trading strategies for current market conditions', icon: '🎯', type: 'claude' }
];

const MODEL_COLORS = {
  groq: 'bg-orange-500/10 text-orange-400 border-orange-500/20',
  gemini: 'bg-blue-500/10 text-blue-400 border-blue-500/20',
  claude: 'bg-purple-500/10 text-purple-400 border-purple-500/20',
  system: 'bg-slate-500/10 text-slate-400 border-slate-500/20'
};

export interface NeuralChatProps {
  groqKey?: string;
  portfolioContext: string;
  onTelegramPush?: () => void;
}

export const NeuralChat = React.memo(({ groqKey: propGroqKey, portfolioContext, onTelegramPush: _onTelegramPush }: NeuralChatProps) => {
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([{
    role: 'system',
    text: '🧠 **DEEP MIND AI QUANTUM PRO v10.0**\n\n**🚀 Active AI Engines:**\n⚡ **Groq Llama-3.3 70B**: Ultra-fast responses\n🔵 **Google Gemini 2.5 Flash**: Real-time market intelligence\n🟣 **Claude Sonnet 4**: Deep institutional analysis\n🔍 **Tavily Search**: Live market news & data\n\n**📊 Real-Time Data Feeds:**\n• TradingView Scanner (NSE/BSE/NYSE/NASDAQ)\n• Live USD/INR Exchange Rate\n• Portfolio P&L with live technicals\n• VIX, Gold, Crude, DXY tracking\n\nAsk anything — I have LIVE market data!',
    timestamp: Date.now(),
    model: 'system'
  }]);

  const [chatInput, setChatInput] = useState('');
  const [isThinking, setIsThinking] = useState(false);
  const [showChat, setShowChat] = useState(false);
  const [copiedIdx, setCopiedIdx] = useState<number | null>(null);
  const [selectedModel, setSelectedModel] = useState<'auto' | 'groq' | 'gemini' | 'claude'>('auto');
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

  // ============ RETRY HELPER ============
  const retryOnce = async (fn: () => Promise<string>): Promise<string> => {
    try { return await fn(); }
    catch (e) {
      await new Promise(r => setTimeout(r, 1000 + Math.random() * 500));
      return await fn();
    }
  };

  // ============ GROQ API (Ultra-Fast) ============
  const callGroq = async (messages: any[], systemPrompt: string) => {
    const envKey = import.meta.env.VITE_GROQ_API_KEY;
    const apiKey = envKey || propGroqKey || CONFIG.groq.apiKey;
    if (!apiKey || !apiKey.startsWith('gsk_')) {
      throw new Error('Groq API Key missing — Settings me set karo');
    }

    const res = await fetch(CONFIG.groq.baseUrl, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: CONFIG.groq.model,
        messages: [{ role: 'system', content: systemPrompt }, ...messages.map(m => ({ role: m.role, content: m.content }))],
        temperature: 0.7,
        max_tokens: 3000
      }),
      signal: AbortSignal.timeout(20000)
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error?.message || `Groq Error: ${res.status}`);
    }
    const data = await res.json();
    const text = data.choices?.[0]?.message?.content;
    if (!text || text.trim().length < 5) throw new Error('Groq returned empty response');
    return text;
  };

  // ============ GEMINI API (Real-time Intelligence) ============
  const callGemini = async (messages: any[], systemPrompt: string) => {
    const apiKey = import.meta.env.VITE_GEMINI_API_KEY || CONFIG.gemini.apiKey;
    if (!apiKey || apiKey.length < 10) {
      throw new Error('Gemini API Key missing — Settings me set karo');
    }

    // Build contents with STRICT alternating user/model turns
    const contents: Array<{ role: string; parts: Array<{ text: string }> }> = [];
    contents.push({ role: 'user', parts: [{ text: systemPrompt }] });
    contents.push({ role: 'model', parts: [{ text: 'Understood. DEEP MIND AI Pro Trader active. Ready for analysis in Pro Trader Hinglish.' }] });

    // Ensure strict alternation — merge consecutive same-role messages
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
    // Gemini requires last message to be 'user'
    if (lastRole === 'model' && contents.length > 2) {
      contents.push({ role: 'user', parts: [{ text: 'Please respond.' }] });
    }

    const res = await fetch(`${CONFIG.gemini.baseUrl}/${CONFIG.gemini.model}:generateContent?key=${apiKey}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents,
        generationConfig: { temperature: 0.7, maxOutputTokens: 4096, topP: 0.95, topK: 40 },
        safetySettings: [
          { category: 'HARM_CATEGORY_HARASSMENT', threshold: 'BLOCK_NONE' },
          { category: 'HARM_CATEGORY_HATE_SPEECH', threshold: 'BLOCK_NONE' },
          { category: 'HARM_CATEGORY_SEXUALLY_EXPLICIT', threshold: 'BLOCK_NONE' },
          { category: 'HARM_CATEGORY_DANGEROUS_CONTENT', threshold: 'BLOCK_NONE' }
        ]
      }),
      signal: AbortSignal.timeout(30000)
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error?.message || `Gemini Error: ${res.status}`);
    }
    const data = await res.json();
    if (data.candidates?.[0]?.finishReason === 'SAFETY') throw new Error('Gemini blocked by safety filters');
    const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!text || text.trim().length < 5) throw new Error('Gemini returned empty response');
    return text;
  };

  // ============ CLAUDE API (Deep Analysis) ============
  const callClaude = async (messages: any[], systemPrompt: string) => {
    const apiKey = import.meta.env.VITE_CLAUDE_API_KEY || CONFIG.claude.apiKey;
    if (!apiKey || apiKey.length < 10) {
      throw new Error('Claude API Key missing');
    }

    // Ensure messages alternate user/assistant and start with user
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

    const res = await fetch(CONFIG.claude.baseUrl, {
      method: 'POST',
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'anthropic-dangerous-direct-browser-access': 'true',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: CONFIG.claude.model,
        max_tokens: 4096,
        system: systemPrompt,
        messages: fixed
      }),
      signal: AbortSignal.timeout(45000)
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error?.message || `Claude Error: ${res.status}`);
    }
    const data = await res.json();
    const text = data.content?.[0]?.text;
    if (!text || text.trim().length < 5) throw new Error('Claude returned empty response');
    return text;
  };

  // ============ MAIN AI ROUTER — Advanced Fallback Chain with Live Data ============
  const callAI = async (userMessage: string, model: string) => {
    // Fetch real-time data in parallel
    const [marketSnap, liveForex, webIntel] = await Promise.allSettled([
      fetchRealtimeSnapshot(),
      fetchLiveForex(),
      /\b(news|market|nifty|sensex|fed|rbi|ipo|crude|gold|dollar|breaking|aaj|today|live)\b/i.test(userMessage) ? fetchWebIntel(userMessage) : Promise.resolve('')
    ]);

    const marketData = marketSnap.status === 'fulfilled' ? marketSnap.value : '';
    const forexRate = liveForex.status === 'fulfilled' ? liveForex.value : 85.5;
    const newsData = webIntel.status === 'fulfilled' ? webIntel.value : '';

    const portfolioCtx = portfolioContext || 'No portfolio data.';

    const systemPrompt = `You are DEEP MIND AI QUANTUM PRO v10.0 — Elite Institutional-Grade Trading Intelligence for Indian & US markets with REAL-TIME LIVE data access.

PERSONA: Seasoned institutional quant trader (15+ years NSE/BSE/NYSE/NASDAQ/FnO/Options) guiding Nagraj Bhai. Think Goldman Sachs + Citadel + Renaissance Technologies combined.

CRITICAL ANTI-HALLUCINATION RULES:
- ONLY use the REAL-TIME data provided below. Do NOT invent, guess, or use memorized old prices.
- If data is not available for a symbol, say "Live data not available" — do NOT make up numbers.
- Today's date is ${new Date().toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata', day: '2-digit', month: 'short', year: 'numeric' })}.
- All prices, RSI, MACD values MUST come from the data below. If missing, explicitly state it.

TRADING RULES:
1. Speak in "Pro Trader Hinglish" — "Bhai", "Breakout confirm hua", "SL trail karo", "Liquidity grab", "Smart Money accumulation".
2. ALWAYS analyze EVERY asset from portfolio data. Do NOT skip any position.
3. Use frameworks: SMC, Wyckoff, Elliott Wave, Fibonacci, Order Flow, Dark Pool analysis.
4. Give SPECIFIC levels: Support, Resistance, SL, Target 1/2/3 with exact prices FROM THE DATA.
5. Include conviction (1-10) and risk-reward ratios (e.g. 1:2.5) for all setups.
6. For news: explain exact impact — "RBI cut = Bank Nifty 500pt rally expected".
7. Concise, punchy, max 600 words. **Bold** + emojis.
8. End with VERDICT: 🟢 BUY / 🔴 SELL / 🟡 HOLD / ⏳ WAIT + levels.
9. USD/INR: ₹${forexRate.toFixed(4)} (LIVE). Convert US holdings to INR.
10. Calculate actual P&L from provided data.

LIVE REAL-TIME DATA (USE ONLY THIS — DO NOT INVENT):
${marketData}
USD/INR: ₹${forexRate.toFixed(4)}
${newsData ? '\nLIVE NEWS:\n' + newsData : ''}

PORTFOLIO CONTEXT:
${portfolioCtx}`;

    // Filter out system messages, keep only user/assistant, limit to recent
    const recentMessages = chatMessages
      .filter(m => m.role === 'user' || m.role === 'model')
      .slice(-8)
      .map(m => ({
        role: m.role === 'model' ? 'assistant' : 'user',
        content: m.text
      }));

    // Build fallback chain: primary → fallback1 → fallback2
    type Engine = 'groq' | 'gemini' | 'claude';
    const chain: Engine[] = model === 'gemini'
      ? ['gemini', 'groq', 'claude']
      : model === 'claude'
        ? ['claude', 'gemini', 'groq']
        : ['groq', 'gemini', 'claude'];

    const callers: Record<Engine, (msgs: any[], sp: string) => Promise<string>> = {
      groq: callGroq, gemini: callGemini, claude: callClaude
    };

    // Try each engine with one retry
    for (const eng of chain) {
      try {
        const text = await retryOnce(() => callers[eng](recentMessages, systemPrompt));
        return { text, model: eng };
      } catch (e) {
        console.warn(`${eng} failed:`, e);
        continue;
      }
    }

    return { text: `🤖 **AI Engines Offline**\n\nBhai, Groq, Gemini aur Claude — teeno fail ho gaye.\n\n**Possible reasons:**\n• API keys missing ya invalid\n• Rate limit hit\n• Network issue\n\nCheck .env file aur retry karo.`, model: 'system' as const };
  };

  const sendMessage = async (userMessage: string) => {
    if (!userMessage.trim()) return;
    setIsThinking(true);

    setChatMessages(prev => [...prev, { role: 'user', text: userMessage, timestamp: Date.now() }]);

    try {
      const q = userMessage.toLowerCase();
      let selectedModelType = selectedModel;

      if (selectedModel === 'auto') {
        // Advanced intent detection with Hindi/trading keywords
        if (/\b(news|khabar|market|live|aaj|today|nifty|sensex|breaking|ipo|fii|dii|rbi|fed|crude|gold|dollar|vix|trend|intraday|pre.?market|global|sector|rally|crash|correction)\b/i.test(q)) {
          selectedModelType = 'gemini';
        } else if (/\b(portfolio|analy[sz]|strategy|fundamental|backtest|risk|allocation|optimize|deep|comprehensive|options?|pcr|fibonacci|wyckoff|smc|elliott|valuation|dividend|dcf|compare|rebalance)\b/i.test(q)) {
          selectedModelType = 'claude';
        } else {
          selectedModelType = 'groq';
        }
      }

      const result = await callAI(userMessage, selectedModelType);
      setChatMessages(prev => [...prev, {
        role: 'model', text: result.text, timestamp: Date.now(), model: result.model
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
                    <span className="text-[7px] sm:text-[8px] bg-gradient-to-r from-cyan-500/20 to-indigo-500/20 text-cyan-300 px-1 py-0.5 rounded-md border border-cyan-500/20 font-bold tracking-wider whitespace-nowrap">QUANTUM PRO v10</span>
                  </h3>
                  <div className="text-[8px] sm:text-[9px] font-bold text-emerald-400 uppercase tracking-widest flex items-center gap-0.5">
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                    <span className="hidden sm:inline">Groq + Gemini 2.5 + Claude Sonnet 4</span>
                    <span className="sm:hidden">LIVE • Quantum Pro</span>
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-1 sm:gap-1.5 flex-shrink-0">
                <button onClick={clearChat} className="text-slate-500 hover:text-red-400 bg-white/5 rounded-full p-1.5 transition-colors"><Trash2 size={14} /></button>
                <button onClick={() => setShowChat(false)} className="text-slate-400 hover:text-white bg-white/5 rounded-full p-1.5 transition-colors"><X size={16} /></button>
              </div>
            </div>

            {/* Model Selector */}
            <div className="relative px-3 sm:px-4 py-3 bg-slate-900/40 border-b border-cyan-500/10 flex gap-2 overflow-x-auto scrollbar-hide">
              {(['auto', 'groq', 'gemini', 'claude'] as const).map(m => (
                <button
                  key={m}
                  onClick={() => setSelectedModel(m)}
                  className={`px-2 sm:px-3 py-1 rounded-full text-[9px] sm:text-[10px] font-bold uppercase transition-all border whitespace-nowrap ${selectedModel === m
                      ? 'bg-cyan-600 text-white border-cyan-400 shadow-[0_0_10px_rgba(6,182,212,0.3)]'
                      : 'bg-slate-800 text-slate-400 border-slate-700 hover:border-cyan-500/50'
                    }`}
                >
                  {m === 'auto' ? '🤖 Auto' : m === 'groq' ? '⚡ Groq' : m === 'gemini' ? '🔵 Gemini 2.5' : '🟣 Claude 4'}
                </button>
              ))}
            </div>

            {/* Messages */}
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
                            {msg.model === 'groq' ? '⚡ Groq' : msg.model === 'gemini' ? '🔵 Gemini 2.5' : msg.model === 'claude' ? '🟣 Claude Sonnet 4' : 'System'}
                          </div>
                        )}
                        <span dangerouslySetInnerHTML={{
                          __html: msg.text
                            .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
                            .replace(/\*(.+?)\*/g, '<em>$1</em>')
                            .replace(/`(.+?)`/g, '<code style="background:rgba(6,182,212,0.15);padding:1px 5px;border-radius:4px;font-size:0.85em">$1</code>')
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
                  Model: {selectedModel === 'auto' ? '🤖 Auto-Detect' : selectedModel === 'groq' ? '⚡ Groq' : selectedModel === 'gemini' ? '🔵 Gemini 2.5' : '🟣 Claude Sonnet 4'}
                </span>
                <span className="text-[7px] sm:text-[8px] text-slate-600 flex-shrink-0">
                  {chatMessages.length} messages
                </span>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
});
