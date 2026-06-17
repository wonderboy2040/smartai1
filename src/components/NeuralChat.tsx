import React, { useState, useRef, useEffect, useCallback } from 'react';
import { Send, BrainCircuit, X, Trash2, Copy, Check, Sparkles } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';

const CONFIG = {
  groq: {
    apiKey: import.meta.env.VITE_GROQ_API_KEY || '',
    baseUrl: 'https://api.groq.com/openai/v1/chat/completions',
    model: 'meta-llama/llama-4-scout-17b-16e-instruct'
  }
} as const;

const PROXY_BASE = import.meta.env.VITE_API_PROXY || '';
let _proxyStatus: Promise<{ groq: boolean; tavily: boolean } | null> | null = null;

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

async function proxyFetch(body: any): Promise<Response | null> {
  const status = await getServerAIStatus();
  if (!status?.groq) return null;
  const res = await fetch(`${PROXY_BASE}/api/groq`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(25000)
  });
  if (res.ok) return res;
  if (res.status === 503) return null;
  const err = await res.json().catch(() => ({}));
  throw new Error(err?.error || err?.error?.message || `proxy error: ${res.status}`);
}

async function fetchRealtimeSnapshot(): Promise<string> {
  try {
    const [idxRes, coindcxRes, bondRes] = await Promise.allSettled([
      fetch('https://scanner.tradingview.com/global/scan', {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain;charset=UTF-8' },
        body: JSON.stringify({ symbols: { tickers: ['NSE:NIFTY','BSE:SENSEX','NSE:BANKNIFTY','AMEX:SPY','NASDAQ:QQQ','CBOE:VIX','NSE:INDIAVIX','TVC:DXY','COMEX:GC1!','NYMEX:CL1!'] }, columns: ['name','close','change'] }),
        signal: AbortSignal.timeout(5000)
      }),
      fetch('https://api.coindcx.com/exchange/ticker', { signal: AbortSignal.timeout(5000) }),
      fetch('https://scanner.tradingview.com/bond/scan', {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain;charset=UTF-8' },
        body: JSON.stringify({ symbols: { tickers: ['TVC:US10Y','TVC:IN10Y'] }, columns: ['description','close','change'] }),
        signal: AbortSignal.timeout(5000)
      })
    ]);

    let snap = 'REAL-TIME MARKET:\n';
    const nameMap: Record<string, string> = { 'NSE:NIFTY':'NIFTY50','BSE:SENSEX':'SENSEX','NSE:BANKNIFTY':'BANKNIFTY','AMEX:SPY':'S&P500','NASDAQ:QQQ':'NASDAQ100','CBOE:VIX':'US_VIX','NSE:INDIAVIX':'INDIA_VIX','TVC:DXY':'DXY','COMEX:GC1!':'GOLD','NYMEX:CL1!':'CRUDE_OIL' };

    if (idxRes.status === 'fulfilled' && idxRes.value.ok) {
      const data = await idxRes.value.json();
      for (const item of (data?.data || [])) {
        const n = nameMap[item.s] || item.s;
        const p = parseFloat(item.d?.[1]) || 0;
        const c = parseFloat(item.d?.[2]) || 0;
        if (p > 0) snap += `${n}: ${p.toFixed(2)} (${c >= 0 ? '+' : ''}${c.toFixed(2)}%)\n`;
      }
    }

    const coinDcxNameMap: Record<string, string> = { 'BTCINR':'BTC','ETHINR':'ETH','SOLINR':'SOL' };
    if (coindcxRes.status === 'fulfilled' && coindcxRes.value.ok) {
      const tickers = await coindcxRes.value.json();
      snap += '\nCRYPTO (CoinDCX INR):\n';
      for (const t of tickers) {
        if (coinDcxNameMap[t.market]) {
          const p = parseFloat(t.last_price) || 0;
          const c = parseFloat(t.change_24_hour) || 0;
          if (p > 0) snap += `${coinDcxNameMap[t.market]}: ₹${p >= 1000 ? p.toFixed(0).replace(/\B(?=(\d{3})+(?!\d))/g, ',') : p.toFixed(2)} (${c >= 0 ? '+' : ''}${c.toFixed(2)}%)\n`;
        }
      }
    }

    const bondMap: Record<string, string> = { 'TVC:US10Y':'US_10Y_YIELD','TVC:IN10Y':'INDIA_10Y_YIELD' };
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
  model?: 'groq' | 'system';
  sources?: Array<{ title: string; url: string }>;
}

const QUICK_ACTIONS = [
  { label: 'Market News', query: 'Latest Indian and US market news and analysis with key levels', icon: '📰' },
  { label: 'Portfolio Analysis', query: 'Analyze my ENTIRE portfolio deeply - every single position including crypto. Show P&L, technicals, fundamentals, and give specific BUY/HOLD/SELL verdict for each asset.', icon: '💼' },
  { label: 'ETH Analysis', query: 'Deep analysis of my Ethereum (ETH) position with on-chain context, support/resistance levels, and long-term HODL thesis', icon: '🪙' },
  { label: 'Long-Term Strategy', query: 'Give me a 15-20 year wealth creation roadmap focusing on SIP step-up and compound growth', icon: '📈' },
  { label: 'ETF Allocation', query: 'Analyze ETF allocations including Momentum, Smallcap and SPCX ETFs with growth projections', icon: '🎯' }
];

export interface NeuralChatProps {
  groqKey?: string;
  portfolioContext: string;
  usdInrRate?: number;
}

export const NeuralChat = React.memo(({
  groqKey: propGroqKey,
  portfolioContext,
  usdInrRate: propUsdInrRate
}: NeuralChatProps) => {
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([{
    role: 'system',
    text: '🤖 **DEEP MIND AI ADVANCE PRO v16.0**\n\n**⚡ GROQ SUPER INTELLIGENCE**\n• Llama 4 Scout 17B (Latest Groq Model)\n• Market Expert with Real-Time Web Search\n\n**🧬 Featur**\n• Deep Mind Analysis (Macro + Micro)\n• Deep Research (24x7 Live)\n• Real-Time Global Market Monitor\n• Portfolio Alert System (Hinglish)\n\n**📊 Real-Time Live Data Feeds:**\n• TradingView Scanner (NSE/BSE/NYSE/NASDAQ)\n• CoinDCX Live Crypto Prices (INR)\n• Bond Yields (US 10Y, India 10Y)\n• Live USD/INR Exchange Rate\n• Portfolio P&L with live technicals\n\nAsk anything — I have LIVE market data 24x7!',
    timestamp: Date.now(),
    model: 'system'
  }]);

  const [chatInput, setChatInput] = useState('');
  const [isThinking, setIsThinking] = useState(false);
  const [showChat, setShowChat] = useState(false);
  const [copiedIdx, setCopiedIdx] = useState<number | null>(null);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const chatContainerRef = useRef<HTMLDivElement>(null);

  const scrollToBottom = useCallback(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, []);

  useEffect(() => {
    if (showChat) scrollToBottom();
  }, [chatMessages, showChat, scrollToBottom]);

  const copyToClipboard = useCallback((text: string, idx: number) => {
    try {
      navigator.clipboard.writeText(text).then(() => {
        setCopiedIdx(idx);
        setTimeout(() => setCopiedIdx(null), 2000);
      }).catch(() => { });
    } catch { }
  }, []);

  const clearChat = useCallback(() => {
    setChatMessages([{
      role: 'system',
      text: '🧹 **Chat cleared!**\n\nReady for new analysis!',
      timestamp: Date.now(),
      model: 'system'
    }]);
  }, []);

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

  const callGroq = async (messages: any[], systemPrompt: string, modelName: string = CONFIG.groq.model) => {
    const groqMessages = [{ role: 'system', content: systemPrompt }, ...messages.map(m => ({ role: m.role, content: m.content }))];

    const proxyRes = await proxyFetch({ messages: groqMessages, model: modelName });
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

  const callAI = async (userMessage: string) => {
    const isNewsQuery = /\b(news|market|nifty|sensex|fed|rbi|ipo|crude|gold|dollar|breaking|aaj|today|live|bitcoin|btc|crypto|halving|eth|blockchain|defi|altcoin|binance|coinbase|regulation|sec)\b/i.test(userMessage);

    const results = await Promise.allSettled([
      fetchRealtimeSnapshot(),
      isNewsQuery ? fetchWebIntel(userMessage, '') : Promise.resolve('')
    ]);

    const marketData = results[0].status === 'fulfilled' ? results[0].value : '';
    const webIntelData = results[1].status === 'fulfilled' ? results[1].value : '';
    const forexRate = propUsdInrRate || 85.5;

    const portfolioCtx = portfolioContext || 'No portfolio data.';

    const systemPrompt = `You are DEEP MIND AI ADVANCE PRO v16.0 — GROQ COMPOUND SUPER INTELLIGENCE. Elite Institutional-Grade Trading & Investment Intelligence with DEEP RESEARCH + DEEP MIND ANALYSIS for Indian, US markets AND Cryptocurrency with REAL-TIME LIVE data access 24x7. You have built-in web search, code execution, and tool use capabilities — use them as needed.

PERSONA: Seasoned institutional quant trader (15+ years NSE/BSE/NYSE/NASDAQ/FnO/Options/Crypto) guiding Nagraj Bhai. Think Goldman Sachs + Citadel + Renaissance Technologies + Pantera Capital combined.

PLATFORM PERMISSIONS: You have FULL PERMISSION to use ALL data across ALL tabs: Dashboard, Portfolio, Planner, Macro, Guide, DeepScan. Access EVERYTHING — portfolio positions, live prices, technical indicators, fundamental data, projections, market intel, web search results. You are authorized to analyze, correlate, and derive insights from ALL available data.

CRITICAL ANTI-HALLUCINATION RULES:
- ONLY use the REAL-TIME data provided below. Do NOT invent, guess, or use memorized old prices.
- If data is not available, say "Live data not available" — do NOT make up numbers.
- Today's date is ${new Date().toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata', day: '2-digit', month: 'short', year: 'numeric' })}.
- All prices, RSI, MACD values MUST come from the data below.
- BTC/ETH trades 24/7 — ALWAYS use live price.

TRADING RULES:
1. Speak in "Pro Trader Hinglish".
2. ALWAYS analyze EVERY asset from portfolio data.
3. Give SPECIFIC levels: Support, Resistance, SL, Target 1/2/3 with exact prices.
4. Include conviction (1-10) and risk-reward ratios.
5. End with VERDICT: 🟢 BUY / 🔴 SELL / 🟡 HOLD / ⏳ WAIT + levels.
6. Emphasize LONG-TERM wealth creation (15-20 years), compounding, SIP step-up.
7. USD/INR: ₹${forexRate.toFixed(4)} (LIVE). Convert US holdings to INR.

CRYPTO RULES:
- BTC Supply Cap: 21 million, Halving Cycle: ~4 years.
- Use on-chain metrics: MVRV, NVT, Exchange flows, Whale accumulation.
- BTC RSI: Oversold < 25, Overbought > 80.

LIVE REAL-TIME DATA (USE ONLY THIS):
${marketData}
USD/INR: ₹${forexRate.toFixed(4)}
${webIntelData ? '\nLIVE NEWS:\n' + webIntelData : ''}

PORTFOLIO CONTEXT:
${portfolioCtx}`;

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

    try {
      const text = await rateLimitedFetch(() => callGroq(recentMessages, systemPrompt));
      return { text, model: 'groq' as const };
    } catch (e) {
      const lastError = e instanceof Error ? e.message : String(e);
      return { text: `🤖 **Groq Offline**\n\nBhai, Groq respond nahi kar paya.\n\n${lastError}\n\nRender me VITE_GROQ_API_KEY set karo aur redeploy karo.`, model: 'system' as const };
    }
  };

  const sendMessage = async (userMessage: string) => {
    if (!userMessage.trim() || isThinking) return;
    setIsThinking(true);

    setChatMessages(prev => [...prev, { role: 'user', text: userMessage, timestamp: Date.now() }]);

    try {
      const result = await callAI(userMessage);
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

            <div className="relative p-3 sm:p-4 border-b border-cyan-500/20 bg-gradient-to-r from-cyan-950/60 to-indigo-950/60 flex items-center justify-between rounded-t-3xl">
              <div className="flex items-center gap-2 sm:gap-3">
                <div className="w-9 h-9 sm:w-10 sm:h-10 bg-gradient-to-br from-cyan-800/60 to-indigo-900/60 border border-cyan-500/30 rounded-xl flex items-center justify-center flex-shrink-0">
                  <BrainCircuit className="text-cyan-400" size={18} />
                </div>
                <div className="min-w-0">
                  <h3 className="text-xs sm:text-sm font-black text-white uppercase tracking-tight flex items-center gap-1">
                    <span className="hidden xs:inline">Groq Super Intelligence</span>
                    <span className="xs:hidden">Groq AI</span>
                    <span className="text-[7px] sm:text-[8px] bg-gradient-to-r from-cyan-500/20 to-indigo-500/20 text-cyan-300 px-1 py-0.5 rounded-md border border-cyan-500/20 font-bold tracking-wider whitespace-nowrap">ADVANCE PRO v16</span>
                  </h3>
                  <div className="text-[8px] sm:text-[9px] font-bold text-emerald-400 uppercase tracking-widest flex items-center gap-0.5">
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                    <span className="hidden sm:inline">Groq Compound | Live Web + Data</span>
                    <span className="sm:hidden">LIVE • Compound</span>
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-1 sm:gap-1.5 flex-shrink-0">
                <button onClick={clearChat} className="text-slate-500 hover:text-red-400 bg-white/5 rounded-full p-1.5 transition-colors" title="Clear Chat"><Trash2 size={14} /></button>
                <button onClick={() => setShowChat(false)} className="text-slate-400 hover:text-white bg-white/5 rounded-full p-1.5 transition-colors"><X size={16} /></button>
              </div>
            </div>

            <div ref={chatContainerRef} className="relative flex-1 overflow-y-auto p-3 sm:p-4 space-y-3 sm:space-y-4 scrollbar-hide">
              {chatMessages.map((msg, i) => (
                <div key={i} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'} animate-message-in`}>
                  <div className={`max-w-[85%] sm:max-w-[90%] rounded-2xl text-[12px] sm:text-[13px] leading-relaxed whitespace-pre-line ${msg.role === 'user'
                    ? 'bg-gradient-to-br from-cyan-600/90 to-blue-700/90 text-white rounded-br-none border border-cyan-500/30 px-3 py-2.5 sm:px-4 sm:py-3'
                    : 'bg-slate-900/90 text-slate-200 rounded-tl-none border border-white/5 px-3 py-2.5 sm:px-4 sm:py-3 group/msg'
                    }`}>
                    {msg.role === 'user' ? msg.text : (
                      <>
                        <span dangerouslySetInnerHTML={{
                          __html: (() => {
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
                <span className="text-[7px] sm:text-[8px] text-slate-500 font-mono">
                  ⚡ Groq Compound
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
