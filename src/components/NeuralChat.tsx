import React, { useState, useRef, useEffect, useCallback } from 'react';
import { Send, BrainCircuit, X, Trash2, Copy, Check, Sparkles, Cpu, ChevronDown, Mic } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';

const PROXY_BASE = import.meta.env.VITE_API_PROXY || '';
let _proxyStatus: Promise<any> | null = null;
let _proxyStatusTs = 0;
const PROXY_STATUS_TTL = 30000;

async function getServerAIStatus() {
  if (!_proxyStatus || Date.now() - _proxyStatusTs > PROXY_STATUS_TTL) {
    _proxyStatusTs = Date.now();
    _proxyStatus = (async () => {
      try {
        const res = await fetch(`${PROXY_BASE}/api/ai-status`, { signal: AbortSignal.timeout(3000) });
        return res.ok ? await res.json() : null;
      } catch { return null; }
    })();
  }
  return _proxyStatus;
}

async function callAIProxy(endpoint: string, body: any): Promise<Response | null> {
  const res = await fetch(`${PROXY_BASE}/api/${endpoint}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(60000)
  });
  if (res.ok) return res;
  if (res.status === 503 || res.status === 429) return null;
  const err = await res.json().catch(() => ({}));
  throw new Error(err?.error?.message || err?.error || `proxy error: ${res.status}`);
}

async function fetchRealtimeSnapshot(): Promise<string> {
  try {
    const [idxRes, coindcxRes, bondRes] = await Promise.allSettled([
      fetch('https://scanner.tradingview.com/global/scan', {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain;charset=UTF-8' },
        body: JSON.stringify({ symbols: { tickers: ['NSE:NIFTY','BSE:SENSEX','NSE:BANKNIFTY','AMEX:SPY','NASDAQ:QQQ','CBOE:VIX','NSE:INDIAVIX','TVC:DXY','COMEX:GC1!','NYMEX:CL1!'] }, columns: ['name','close','change','Recommend.All'] }),
        signal: AbortSignal.timeout(5000)
      }),
      fetch(`${PROXY_BASE}/api/crypto-prices?t=${Date.now()}`, { signal: AbortSignal.timeout(5000) }),
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

async function fetchWebIntel(query: string): Promise<string> {
  try {
    const res = await fetch(`${PROXY_BASE}/api/tavily`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ messages: [{ role: 'user', content: `${query} latest market news 2026` }], model: '' }),
      signal: AbortSignal.timeout(6000)
    });
    if (res.ok) {
      const data = await res.json();
      return data?.choices?.[0]?.message?.content?.substring(0, 1000) || '';
    }
  } catch { }
  return '';
}

interface ChatMessage {
  role: 'user' | 'model' | 'system';
  text: string;
  timestamp: number;
  model?: string;
}

interface EngineOption { id: string; label: string; model: string; endpoint: string; badge: string; }
const ENGINE_OPTIONS: EngineOption[] = [
  { id: 'auto',        label: 'Auto (Smart Failover)', model: '',                                       endpoint: 'auto',        badge: '⚡' },
  { id: 'gemini',      label: 'Gemini 2.5 Flash',      model: 'gemini-2.5-flash',                        endpoint: 'gemini',      badge: '🔷' },
  { id: 'groq',        label: 'Groq Llama 3.3 70B',    model: 'llama-3.3-70b-versatile',                 endpoint: 'groq',        badge: '⚡' },
  { id: 'claude',      label: 'Claude Sonnet 4',       model: 'claude-sonnet-4-20250514',                endpoint: 'claude',      badge: '🟣' },
  { id: 'openrouter',  label: 'OpenRouter Llama 3.3',  model: 'meta-llama/llama-3.3-70b-instruct:free',  endpoint: 'openrouter',  badge: '🔶' },
  { id: 'cerebras',    label: 'Cerebras Llama 3.3',    model: 'llama-3.3-70b',                           endpoint: 'cerebras',    badge: '🧠' },
  { id: 'huggingface', label: 'HuggingFace Qwen 72B',  model: 'Qwen/Qwen2.5-72B-Instruct',               endpoint: 'huggingface', badge: '🤗' },
  { id: 'nvidia',      label: 'NVIDIA Llama 3.3 70B',  model: 'meta/llama-3.3-70b-instruct',             endpoint: 'nvidia',      badge: '🟢' },
];

const QUICK_ACTIONS = [
  { label: 'Market Intel', query: 'Market ka live snapshot do — NIFTY, SENSEX, BANKNIFTY, US markets, gold, crude, DXY. Current regime + top 3 actionable insights. Simple Hinglish.', icon: '📊' },
  { label: 'Portfolio Deep Dive', query: 'Meri poori portfolio ka deep analysis karo — har position ka individual BUY/HOLD/SELL verdict do, target price, SL, RSI, MACD sab saath me. P&L bhi batao.', icon: '🔍' },
  { label: 'AI Trade Signal', query: 'What should I trade today? Best intraday / swing setup with exact entry, stop loss, and targets. Use live market data.', icon: '🎯' },
  { label: 'Risk Check', query: 'Meri portfolio ka risk analysis karo — VaR, concentration risk, sector exposure, drawdown. Suggestions do to reduce risk.', icon: '🛡️' },
  { label: 'Wealth Plan', query: 'Mujhe 15 saal ka wealth creation plan do — monthly SIP, asset allocation, step-up strategy, expected corpus. Realistic numbers ke saath.', icon: '🚀' },
];

export interface NeuralChatProps {
  portfolioContext: string;
  usdInrRate?: number;
}

const SYSTEM_WELCOME = `🤖 **SUPER INTELLIGENCE v3.0** • 7-Engine AI + Quant Brain

**Capabilities:**
• Real-time market data (NSE/BSE/NYSE/NASDAQ/Crypto)
• Full portfolio analysis with technicals
• Intraday/swing trading signals with exact levels
• Risk analysis (VaR, drawdown, concentration)
• Wealth planning & goal-based projections
• Indian + US + Crypto markets

**7 Engines:** Gemini | Groq | Claude | OpenRouter | Cerebras | HuggingFace | NVIDIA
**Fallback:** Quant Brain (always works, no API key needed)

Ask me anything about markets, your portfolio, trading, or wealth building!`;

export const NeuralChat = React.memo(({
  portfolioContext,
  usdInrRate: propUsdInrRate
}: NeuralChatProps) => {
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([{
    role: 'system',
    text: SYSTEM_WELCOME,
    timestamp: Date.now(),
    model: 'system'
  }]);
  const [chatInput, setChatInput] = useState('');
  const [isThinking, setIsThinking] = useState(false);
  const [showChat, setShowChat] = useState(false);
  const [copiedIdx, setCopiedIdx] = useState<number | null>(null);
  const [selectedEngine, setSelectedEngine] = useState<string>(() => {
    try { return localStorage.getItem('neural_engine') || 'auto'; } catch { return 'auto'; }
  });
  const [showEngineMenu, setShowEngineMenu] = useState(false);
  useEffect(() => { try { localStorage.setItem('neural_engine', selectedEngine); } catch { } }, [selectedEngine]);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const scrollToBottom = useCallback(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, []);
  useEffect(() => { if (showChat) scrollToBottom(); }, [chatMessages, showChat, scrollToBottom]);

  const copyToClipboard = useCallback((text: string, idx: number) => {
    try {
      navigator.clipboard.writeText(text).then(() => {
        setCopiedIdx(idx);
        setTimeout(() => setCopiedIdx(null), 2000);
      }).catch(() => { });
    } catch { }
  }, []);

  const clearChat = useCallback(() => {
    setChatMessages([{ role: 'system', text: SYSTEM_WELCOME, timestamp: Date.now(), model: 'system' }]);
  }, []);

  const lastRequestTimeRef = useRef<number>(0);
  const MIN_REQUEST_INTERVAL = 2000;

  const rateLimitedFetch = async <T,>(fn: () => Promise<T>): Promise<T> => {
    const now = Date.now();
    const timeSinceLastRequest = now - lastRequestTimeRef.current;
    if (timeSinceLastRequest < MIN_REQUEST_INTERVAL) {
      await new Promise(r => setTimeout(r, MIN_REQUEST_INTERVAL - timeSinceLastRequest));
    }
    lastRequestTimeRef.current = Date.now();
    let retries = 0;
    const maxRetries = 2;
    let lastError: Error | null = null;
    while (retries <= maxRetries) {
      try { return await fn(); }
      catch (e) {
        lastError = e instanceof Error ? e : new Error(String(e));
        if (lastError.message.includes('429') && retries < maxRetries) {
          await new Promise(r => setTimeout(r, Math.pow(2, retries + 1) * 2000 + Math.random() * 1000));
          retries++;
          continue;
        }
        throw lastError;
      }
    }
    throw lastError;
  };

  const tryAIEngine = async (endpoint: string, modelName: string, messages: any[], systemPrompt: string): Promise<string | null> => {
    const status = await getServerAIStatus();
    if (!status || !(status as any)[endpoint]) return null;
    const body = {
      messages: [{ role: 'system', content: systemPrompt }, ...messages.map(m => ({ role: m.role, content: m.content }))],
      model: modelName,
      max_tokens: 2048,
    };
    const res = await callAIProxy(endpoint, body);
    if (!res) return null;
    const data = await res.json();
    if (endpoint === 'gemini') {
      const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
      return text && text.trim().length >= 5 ? text : null;
    }
    if (endpoint === 'claude') {
      const text = data.content?.[0]?.text;
      return text && text.trim().length >= 5 ? text : null;
    }
    const text = data.choices?.[0]?.message?.content;
    return text && text.trim().length >= 5 ? text : null;
  };

  const quantBrainAnalysis = (userMessage: string, marketData: string, portfolioCtx: string): string => {
    const lines = marketData.split('\n');
    const assets: { name: string; price: number; change: number }[] = [];
    for (const line of lines) {
      const m = line.match(/^([A-Z_]+):\s*(\d+\.?\d*)\s*\(([+-]?\d+\.?\d*)%\)/);
      if (m) assets.push({ name: m[1], price: parseFloat(m[2]), change: parseFloat(m[3]) });
    }
    const positive = assets.filter(a => a.change > 0).length;
    const negative = assets.filter(a => a.change < 0).length;
    const regime = positive >= negative * 1.5 ? 'BULLISH' : negative >= positive * 1.5 ? 'BEARISH' : 'NEUTRAL';
    const vixAsset = assets.find(a => a.name.includes('VIX'));
    const vixLevel = vixAsset ? vixAsset.price : 15;
    const isVolatile = vixLevel > 22;

    let output = `🤖 **SUPER INTELLIGENCE QUANT BRAIN v3.0**
━━━━━━━━━━━━━━━━━━━━━━━━━━━

⏰ ${new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })} IST
🔍 Analysis: ${userMessage}\n
📊 **MARKET REGIME: ${regime}**${isVolatile ? ' ⚠️ HIGH VOLATILITY' : ''}

`;
    if (assets.length > 0) {
      output += '**LIVE MARKET SNAPSHOT:**\n';
      for (const a of assets.slice(0, 12)) {
        const icon = a.change > 0 ? '🟢' : a.change < 0 ? '🔴' : '⚪';
        output += `${icon} ${a.name}: ${a.price.toFixed(2)} (${a.change >= 0 ? '+' : ''}${a.change.toFixed(2)}%)\n`;
      }
    }

    output += `\n**7-STEP PRO ANALYSIS:**
1. Regime: **${regime}**${isVolatile ? ' — High VIX suggests caution' : ' — Normal conditions'}
2. Trend: ${positive > negative ? 'Positive breadth, bullish bias' : 'Negative breadth, bearish bias'}
3. Momentum: ${assets.some(a => Math.abs(a.change) > 2) ? 'Strong moves detected' : 'Moderate momentum'}
4. Support/Demand: Key levels based on recent price action
5. Risk: ${isVolatile ? '⚠️ Elevated — use smaller position sizes' : '✅ Normal — standard positioning'}
6. Conviction: ${assets.filter(a => a.change > 1).length >= 2 ? 'Multiple strong signals detected' : 'Mixed signals — selective approach'}
7. Action: ${regime === 'BULLISH' ? 'Look for buying opportunities on dips' : regime === 'BEARISH' ? 'Defensive — reduce risk, hold cash' : 'Selective — stock-specific approach'}

${portfolioCtx ? `**PORTFOLIO CONTEXT AVAILABLE:** ${portfolioCtx.substring(0, 200)}...\n` : ''}

**💡 NOTE:** LLM narration unavailable — Quant Brain provides deterministic analysis.
_Sabhi API keys free hain — Gemini: aistudio.google.com , Groq: console.groq.com_`;
    return output;
  };

  const callAI = async (userMessage: string) => {
    const isNewsQuery = /\b(news|market|nifty|sensex|fed|rbi|ipo|crude|gold|dollar|live|bitcoin|btc|crypto|eth|stock|price)\b/i.test(userMessage);
    const isTradeQuery = /\b(trade|buy|sell|entry|signal|target|stop|intraday|swing)\b/i.test(userMessage);
    const isPortfolioQuery = /\b(portfolio|position|holdings|my|meri|profit|pnl|return)\b/i.test(userMessage);
    const isRiskQuery = /\b(risk|var|drawdown|loss|volatility|hedge|protect)\b/i.test(userMessage);

    const results = await Promise.allSettled([
      fetchRealtimeSnapshot(),
      isNewsQuery ? fetchWebIntel(userMessage) : Promise.resolve('')
    ]);
    const marketData = results[0].status === 'fulfilled' ? results[0].value : '';
    const webIntelData = results[1].status === 'fulfilled' ? results[1].value : '';
    const forexRate = propUsdInrRate || 85.5;
    const portfolioCtx = portfolioContext || 'No portfolio data available.';

    const systemPrompt = `You are SUPER INTELLIGENCE v3.0 — a market superintelligence with 7-engine failover + Quant Brain deterministic backup. You have REAL-TIME LIVE market data access and FULL portfolio context.

PERSONA: Expert institutional quant trader (20+ years NSE/BSE/NYSE/NASDAQ/Crypto). Think Goldman Sachs + Citadel + Renaissance + Pantera combined. Speak in SIMPLE Hinglish. Use "bhai", "dekho", "simple words me". Explain concepts clearly.

MANDATORY RULES:
1. READ the portfolio context below — it contains ALL positions with live data
2. Reference 2-3 specific positions by name with current price and signal
3. NEVER say "I don't have portfolio data" — it's provided below
4. ONLY use the REAL-TIME data below — do NOT invent prices
5. Today: ${new Date().toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata', day: '2-digit', month: 'short', year: 'numeric' })}
6. CRITICAL: If this is a trade query, give EXACT entry, SL, target prices. If portfolio query, analyze EVERY position. If risk query, calculate VaR and suggestions. If general, give market overview.

7-STEP FRAMEWORK:
1. Regime: Risk-On/Neutral/Risk-Off (use VIX, breadth)
2. Trend: Direction from SMA + price action
3. Momentum: RSI + MACD analysis
4. Support/Demand: Key price levels
5. Risk: SL distance, R:R ratio, position sizing
6. Conviction: STRONG_BUY / BUY / HOLD / WAIT / SELL
7. Action: Exact entry, SL, targets, size

RESPONSE STRUCTURE:
- 1-line macro snapshot in simple Hinglish
- Connect macro → micro: what it means for user's holdings
- ${isTradeQuery ? 'EXACT entry/SL/targets with R:R' : ''}
- ${isPortfolioQuery ? 'Every position analyzed individually with verdict' : ''}
- ${isRiskQuery ? 'VaR, drawdown, concentration risk, suggestions' : ''}
- End with strategy + 3 action items + 1 pro tip

USD/INR: ₹${forexRate.toFixed(4)}

=== LIVE MARKET DATA ===
${marketData}
USD/INR: ₹${forexRate.toFixed(4)}
${webIntelData ? '\nLIVE NEWS:\n' + webIntelData : ''}

=== PORTFOLIO CONTEXT ===
${portfolioCtx}

=== END DATA ===

RESPONSE STYLE: Simple Hinglish. Short paragraphs. Bullet points for levels. Bold for key numbers.`;

    const recentMessages = chatMessages
      .filter(m => m.role === 'user' || m.role === 'model')
      .slice(-6)
      .map(m => ({ role: m.role === 'model' ? 'assistant' : 'user', content: m.text }));
    if (recentMessages.length === 0 || recentMessages[recentMessages.length - 1].content !== userMessage) {
      recentMessages.push({ role: 'user', content: userMessage });
    }

    const allEngines = ENGINE_OPTIONS.filter(e => e.id !== 'auto').map(e => ({ name: e.id, model: e.model, endpoint: e.endpoint }));
    let engines = allEngines;
    if (selectedEngine && selectedEngine !== 'auto') {
      const chosen = allEngines.filter(e => e.name === selectedEngine);
      const rest = allEngines.filter(e => e.name !== selectedEngine);
      engines = [...chosen, ...rest];
    }

    let text = null;
    let usedEngine = 'quant_brain';
    for (const engine of engines) {
      try {
        text = await rateLimitedFetch(() => tryAIEngine(engine.endpoint, engine.model, recentMessages, systemPrompt));
        if (text) { usedEngine = engine.name; break; }
      } catch { continue; }
    }

    if (!text) {
      text = quantBrainAnalysis(userMessage, marketData, portfolioCtx);
      usedEngine = 'quant_brain';
    }

    return { text, model: usedEngine as any };
  };

  const sendMessage = async (userMessage: string) => {
    if (!userMessage.trim() || isThinking) return;
    setIsThinking(true);
    setChatMessages(prev => [...prev, { role: 'user', text: userMessage, timestamp: Date.now() }]);
    try {
      const result = await callAI(userMessage);
      setChatMessages(prev => [...prev, { role: 'model', text: result.text, timestamp: Date.now(), model: result.model }]);
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : 'Unknown error';
      setChatMessages(prev => [...prev, { role: 'system', text: `❌ Error: ${errorMsg}\n\nTry again or switch engine.`, timestamp: Date.now(), model: 'system' }]);
    } finally {
      setIsThinking(false);
    }
  };

  const handleChat = () => {
    if (chatInput.trim()) { const msg = chatInput; setChatInput(''); sendMessage(msg); }
  };

  const [isListening, setIsListening] = useState(false);
  const recognitionRef = useRef<any>(null);
  const speechSupported = typeof window !== 'undefined' &&
    ((window as any).SpeechRecognition || (window as any).webkitSpeechRecognition);

  const toggleVoiceInput = useCallback(() => {
    const SR = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SR) { alert('Voice input not supported in this browser. Try Chrome.'); return; }
    if (recognitionRef.current && isListening) { try { recognitionRef.current.stop(); } catch { } return; }
    const recognition = new SR();
    recognition.lang = 'hi-IN';
    recognition.interimResults = true;
    recognition.continuous = false;
    recognition.maxAlternatives = 1;
    recognition.onstart = () => setIsListening(true);
    recognition.onerror = () => setIsListening(false);
    recognition.onend = () => { setIsListening(false); recognitionRef.current = null; };
    recognition.onresult = (event: any) => {
      let transcript = '';
      for (let i = 0; i < event.results.length; i++) transcript += event.results[i][0].transcript;
      setChatInput(transcript);
    };
    recognitionRef.current = recognition;
    try { recognition.start(); } catch { setIsListening(false); }
  }, [isListening]);

  useEffect(() => () => { try { recognitionRef.current?.stop(); } catch { } }, []);

  return (
    <>
      <button
        onClick={() => setShowChat(!showChat)}
        className="fab fixed bottom-6 right-6 w-14 h-14 bg-gradient-to-br from-cyan-600/90 via-blue-800/90 to-indigo-900/90 rounded-2xl flex items-center justify-center border border-cyan-500/50 shadow-[0_0_30px_rgba(6,182,212,0.4)] z-[60] overflow-hidden group hover:scale-110 transition-transform"
      >
        {showChat ? <X className="text-white z-10" /> : <BrainCircuit className="text-cyan-400 z-10" size={24} />}
        <span className="absolute -top-1 -right-1 w-3.5 h-3.5 bg-emerald-400 rounded-full animate-pulse-dot z-10 border-2 border-slate-900" />
      </button>

      <AnimatePresence>
        {showChat && (
          <motion.div
            initial={{ opacity: 0, y: 20, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 20, scale: 0.95 }}
            className="fixed bottom-0 left-0 right-0 sm:bottom-24 sm:left-1/2 sm:right-auto sm:w-[600px] sm:-translate-x-1/2 h-[85vh] sm:h-[700px] max-h-[85vh] shadow-[0_0_50px_rgba(6,182,212,0.2)] z-[60] flex flex-col overflow-hidden sm:rounded-3xl border border-cyan-500/20"
          >
            <div className="absolute inset-0 bg-slate-950/90 backdrop-blur-xl border border-cyan-500/20 rounded-3xl" />

            <div className="relative p-3 sm:p-4 border-b border-cyan-500/20 bg-gradient-to-r from-cyan-950/60 to-indigo-950/60 flex items-center justify-between rounded-t-3xl">
              <div className="flex items-center gap-2 sm:gap-3">
                <div className="w-9 h-9 sm:w-10 sm:h-10 bg-gradient-to-br from-cyan-800/60 to-indigo-900/60 border border-cyan-500/30 rounded-xl flex items-center justify-center flex-shrink-0">
                  <BrainCircuit className="text-cyan-400" size={18} />
                </div>
                <div className="min-w-0">
                  <h3 className="text-xs sm:text-sm font-black text-white uppercase tracking-tight flex items-center gap-1">
                    Super Intelligence
                    <span className="text-[7px] sm:text-[8px] bg-gradient-to-r from-cyan-500/20 to-indigo-500/20 text-cyan-300 px-1 py-0.5 rounded-md border border-cyan-500/20 font-bold tracking-wider whitespace-nowrap">v3.0</span>
                  </h3>
                  <div className="text-[8px] sm:text-[9px] font-bold text-emerald-400 uppercase tracking-widest flex items-center gap-0.5">
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                    <span className="hidden sm:inline">7-Engine AI + Quant Brain | Always Online</span>
                    <span className="sm:hidden">LIVE</span>
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-1 sm:gap-1.5 flex-shrink-0">
                <div className="relative">
                  <button
                    onClick={() => setShowEngineMenu(v => !v)}
                    className="flex items-center gap-1 text-[9px] sm:text-[10px] font-bold text-cyan-300 bg-cyan-500/10 hover:bg-cyan-500/20 border border-cyan-500/30 rounded-lg px-1.5 sm:px-2 py-1 transition-colors"
                    title="Select AI Model"
                  >
                    <Cpu size={12} />
                    <span className="hidden xs:inline max-w-[70px] truncate">
                      {ENGINE_OPTIONS.find(e => e.id === selectedEngine)?.label.split(' ')[0] || 'Auto'}
                    </span>
                    <ChevronDown size={10} />
                  </button>
                  {showEngineMenu && (
                    <div className="absolute right-0 top-full mt-1 w-52 max-h-72 overflow-y-auto bg-slate-900 border border-cyan-500/30 rounded-xl shadow-2xl z-[70] p-1 scrollbar-hide">
                      <div className="text-[8px] uppercase tracking-wider text-slate-500 font-bold px-2 py-1">AI Model</div>
                      {ENGINE_OPTIONS.map(e => (
                        <button key={e.id}
                          onClick={() => { setSelectedEngine(e.id); setShowEngineMenu(false); }}
                          className={`w-full flex items-center gap-2 text-left text-[11px] px-2 py-1.5 rounded-lg transition-colors ${selectedEngine === e.id ? 'bg-cyan-500/20 text-cyan-300 font-bold' : 'text-slate-300 hover:bg-white/5'}`}
                        >
                          <span>{e.badge}</span>
                          <span className="flex-1 truncate">{e.label}</span>
                          {selectedEngine === e.id && <Check size={12} className="text-cyan-400" />}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
                <button onClick={clearChat} className="text-slate-500 hover:text-red-400 bg-white/5 rounded-full p-1.5 transition-colors" title="Clear Chat"><Trash2 size={14} /></button>
                <button onClick={() => setShowChat(false)} className="text-slate-400 hover:text-white bg-white/5 rounded-full p-1.5 transition-colors"><X size={16} /></button>
              </div>
            </div>

            <div className="relative flex-1 overflow-y-auto p-3 sm:p-4 space-y-3 sm:space-y-4 scrollbar-hide">
              {chatMessages.map((msg, i) => (
                <div key={msg.timestamp} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'} animate-message-in`}>
                  <div className={`max-w-[85%] sm:max-w-[92%] rounded-2xl text-[12px] sm:text-[13px] leading-relaxed whitespace-pre-line ${msg.role === 'user'
                    ? 'bg-gradient-to-br from-cyan-600/90 to-blue-700/90 text-white rounded-br-none border border-cyan-500/30 px-3 py-2.5 sm:px-4 sm:py-3'
                    : 'bg-slate-900/90 text-slate-200 rounded-tl-none border border-white/5 px-3 py-2.5 sm:px-4 sm:py-3 group/msg'
                  }`}>
                    {msg.role === 'user' ? msg.text : (
                      <>
                        <span dangerouslySetInnerHTML={{
                          __html: msg.text
                            .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
                            .replace(/\*\*(.+?)\*\*/g, '<strong style="color:#22d3ee">$1</strong>')
                            .replace(/\*(.+?)\*/g, '<em>$1</em>')
                            .replace(/`(.+?)`/g, '<code style="background:rgba(6,182,212,0.15);padding:1px 5px;border-radius:4px;font-size:0.85em">$1</code>')
                        }} />
                        {msg.model && msg.model !== 'system' && (
                          <div className="flex items-center gap-2 mt-2 opacity-0 group-hover/msg:opacity-100 transition-opacity">
                            <span className="text-[8px] text-slate-600 bg-slate-800/60 px-1.5 py-0.5 rounded">
                              {msg.model === 'quant_brain' ? '🧠 Quant Brain' : `🔷 ${msg.model}`}
                            </span>
                            <button onClick={() => copyToClipboard(msg.text, i)} className="text-[9px] text-slate-500 hover:text-cyan-400 flex items-center gap-1 transition-colors">
                              {copiedIdx === i ? <><Check size={10} /> Copied!</> : <><Copy size={10} /> Copy</>}
                            </button>
                          </div>
                        )}
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
                      <Sparkles size={12} className="animate-pulse" /> Analyzing...
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
                {QUICK_ACTIONS.map(action => (
                  <button key={action.label}
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
                  placeholder={isListening ? '🎙️ Listening... speak now' : 'Ask Super Intelligence about markets, portfolio, or trades...'}
                  className="w-full bg-slate-900/60 border border-slate-700/80 rounded-xl sm:rounded-2xl py-2.5 sm:py-3 pl-3 sm:pl-4 pr-[4.5rem] sm:pr-20 text-xs sm:text-sm text-white outline-none focus:border-cyan-500/60 transition-all font-medium placeholder:text-slate-600"
                  value={chatInput}
                  onChange={(e) => setChatInput(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && handleChat()}
                />
                {speechSupported && (
                  <button
                    onClick={toggleVoiceInput}
                    title={isListening ? 'Stop listening' : 'Voice input (Hinglish)'}
                    className={`absolute right-9 sm:right-11 p-1.5 sm:p-2 rounded-lg sm:rounded-xl transition-all ${isListening ? 'bg-red-500/80 text-white animate-pulse' : 'bg-slate-800/80 text-cyan-400 hover:bg-slate-700'}`}
                  >
                    <Mic size={14} />
                  </button>
                )}
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
                  {selectedEngine === 'auto' ? '⚡ Auto Failover + Quant Brain' : `${ENGINE_OPTIONS.find(e => e.id === selectedEngine)?.badge || ''} ${ENGINE_OPTIONS.find(e => e.id === selectedEngine)?.label || ''}`}
                </span>
                <span className="text-[7px] sm:text-[8px] text-slate-600 flex-shrink-0">
                  {chatMessages.length} msgs
                </span>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
});
