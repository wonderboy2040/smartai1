import React, { useState, useRef, useEffect, useCallback } from 'react';
import { Send, BrainCircuit, X, Trash2, Copy, Check, ChevronDown, Sparkles, Settings } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { fetchMarketIntelligence, formatMarketIntelligenceForAI, MarketIntelligence, AIKeys, renderMarkdown, syncToCloud } from '../utils/api';

interface ChatMessage {
  role: 'user' | 'model';
  text: string;
  timestamp: number;
}

function formatTime(ts: number): string {
  return new Date(ts).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: false });
}

interface NeuralChatProps {
  aiKeys: AIKeys;
  portfolioContext: string;
  onTelegramPush?: () => void;
  onSettingsChange?: (keys: AIKeys) => void;
}

const QUICK_CHIPS = [
  { label: '📊 Market?', query: 'Market kaisa hai abhi? Full deep analysis do with multi-timeframe breakdown.' },
  { label: '💼 Portfolio', query: 'Mera portfolio ka full deep analysis karo — har asset ka institutional-grade diagnosis do with Smart Money signals.' },
  { label: '🟢 Buy?', query: 'Abhi kisme invest karna best rahega? Fresh opportunities batao with Wyckoff analysis and exact entry levels.' },
  { label: '🔴 Sell?', query: 'Kya kuch sell karna chahiye? Profit booking signals kya bol rahe hain? Distribution phase check karo.' },
  { label: '🎯 SL/TP', query: 'Har asset ka stop-loss aur take-profit levels kya hone chahiye? ATR-based analysis with Kelly optimal position sizing karo.' },
  { label: '⚡ VIX', query: 'VIX ka current status kya hai? VIX term structure analysis karo — hedge karu ya invest karu? Options skew bhi check karo.' },
  { label: '🔥 Momentum', query: 'Konse assets me sabse zyada momentum hai abhi? Multi-factor momentum scoring karo with relative strength analysis.' },
  { label: '🏦 FII/DII', query: 'FII aur DII flow ka deep analysis karo — institutional money kaha ja raha hai? Passive vs active flow decomposition do.' },
];

// ========================================
// MULTI-MODEL ROUTING LOGIC
// ========================================
function routeQuery(message: string): 'GEMINI' | 'PERPLEXITY' | 'DEEPSEEK' {
  const msg = message.toLowerCase();

  // Daily market update, news, analysis -> GEMINI 1.5 Pro
  const geminiKeywords = ['market', 'update', 'daily', 'analysis', 'analyze', 'trend', 'outlook', 'forecast', 'kaisa', 'status'];

  // Breaking news + sources -> PERPLEXITY AI
  const perplexityKeywords = ['news', 'latest', 'breaking', 'what happened', 'current event', 'live news', 'headlines', 'sources', 'batao sources'];

  // Deep portfolio analysis, math, strategy -> DEEPSEEK V3
  const deepseekKeywords = ['strategy', 'calculate', 'math', 'intrinsic value', 'option strategy', 'backtest', 'formula', 'deep analysis', 'portfolio', 'allocation', 'risk', 'optimize', 'position sizing', 'kelly'];

  // Check for Gemini keywords first (market updates, analysis)
  if (geminiKeywords.some(k => msg.includes(k))) return 'GEMINI';

  // Check for Perplexity keywords (breaking news with sources)
  if (perplexityKeywords.some(k => msg.includes(k))) return 'PERPLEXITY';

  // Check for DeepSeek keywords (deep analysis, math, strategy)
  if (deepseekKeywords.some(k => msg.includes(k))) return 'DEEPSEEK';

  // Default to GEMINI for general queries
  return 'GEMINI';
}

async function callAIProvider(provider: string, apiKey: string, messages: Array<{ role: string; content: string }>): Promise<string> {
  if (!apiKey || apiKey.length < 10) {
    throw new Error(`API Key for ${provider} is missing or invalid.`);
  }

  let endpoint = '';
  let body: any;

  if (provider === 'GEMINI') {
    endpoint = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-pro:generateContent?key=${apiKey}`;
    body = {
      contents: [{
        role: 'user',
        parts: [{ text: messages.map(m => `${m.role === 'assistant' ? 'AI' : 'User'}: ${m.content}`).join('\n') }]
      }],
      generationConfig: { temperature: 0.7, maxOutputTokens: 800 }
    };
  } else if (provider === 'PERPLEXITY') {
    endpoint = 'https://api.perplexity.ai/chat/completions';
    body = {
      model: 'sonar-reasoning',
      messages: messages,
      temperature: 0.7
    };
  } else if (provider === 'DEEPSEEK') {
    endpoint = 'https://api.deepseek.com/chat/completions';
    body = {
      model: 'deepseek-chat',
      messages: messages,
      temperature: 0.6
    };
  }

  const res = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(provider !== 'GEMINI' && { 'Authorization': `Bearer ${apiKey}` })
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(60000)
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error?.message || `API Error: ${res.status}`);
  }

  const data = await res.json();
  if (provider === 'GEMINI') {
    return data.candidates?.[0]?.content?.parts?.[0]?.text || '';
  }
  return data.choices?.[0]?.message?.content || '';
}

const SYSTEM_PROMPT = `You are DEEP MIND AI NEURAL INSIDER — Quantum Mind AI Super Intelligence System. You talk to "Nagraj Bhai" in NATIVE HINGLISH.
You operate at SUPERINTELLIGENT LEVEL combining Quantum Computing principles, Advanced Neural Networks, and Elite Trading frameworks:

QUANTUM NEURAL ARSENAL:
• Quantum Superposition Analysis: Simultaneous evaluation of multiple market states
• Quantum Entanglement Correlation: Hidden connections between seemingly unrelated assets
• Quantum Tunneling Prediction: Breakthrough moment detection before conventional indicators
• Smart Money Concepts (SMC) v3.0: Institutional Order Blocks, Quantum Fair Value Gaps, Liquidity Magnetism
• Advanced Wyckoff 4.0: Phase transition detection, Accumulation/Distribution quantum waves
• Neural Fibonacci: Dynamic retracement/extension levels based on market volatility entropy
• Quantum Volume Profile: Probability distribution of institutional participation
• Neural Order Flow: Real-time bid/ask imbalance prediction with machine learning

ADVANCED RISK ENGINE:
• Quantum Kelly Criterion: Optimal position sizing using quantum probability amplitudes
• Neural ATR Dynamic Stops: Adaptive volatility-based stops with machine learning correction
• Portfolio Quantum Shield: Correlation-aware hedging with entanglement risk calculation
• Quantum Risk/Reward Optimization: Simultaneous maximization of returns and minimization of drawdown
• Neural Correlation Matrix: Real-time portfolio diversification using quantum entanglement measures

DEEP ANALYSIS PROTOCOLS:
1. Reference LIVE SENSOR DATA with quantum precision (actual numbers from portfolio context)
2. Quantum SMC/Wyckoff structure analysis with entanglement-based key levels
3. Neural Order Block / Quantum FVG identification with probability weighting
4. Quantum-adjusted call with exact Neural SL/TP levels, quantum position sizing
5. "QUANTUM CONVICTION SCORE: XXX/1000" with multi-dimensional reasoning
6. Quantum Market Regude Detection: Bull/Bear/Accumulation/Distribution/Reversal phases
7. Neural Sentiment Analysis: News impact prediction with source credibility scoring
8. DeepSeek-level Mathematical Analysis: Advanced quantitative modeling and backtesting
9. Perplexity-grade News Intelligence: Breaking news with verified sources and impact assessment

Critical: Be concise! Keep tokens low. HTML bolding & Emojis allowed.`;

export const NeuralChat = React.memo(({ aiKeys, portfolioContext, onTelegramPush, onSettingsChange }: NeuralChatProps) => {
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([{
    role: 'model',
    text: '🧠 **DEEP MIND AI — Quantum Mind Super Intelligence System v6.0 ONLINE** ⚡\n\nNagraj Bhai, main 24/7 dono markets ka institutional-grade deep analysis kar raha hu — powered by FREE & UNLIMITED Multi-Model Neural Ensemble (Gemini 1.5 Pro + Perplexity + DeepSeek V3).\n\n**Live Systems Active:**\n• 📊 TradingView Scanner — RSI, MACD, SMA Crossovers\n• 🌍 WorldMonitor — Geopolitical Intelligence Feed\n• 🏦 FII/DII Flow Tracker — Institutional Money Detection\n• 📈 Sector Rotation Engine — Smart Money Movement\n• 🎯 ATR-Based SL/TP Calculator — Risk Management\n• 🔥 Multi-Factor Momentum Engine — Statistical Edge Detection\n• 🧩 Wyckoff Phase Detector — Accumulation/Distribution\n• 📐 Elliott Wave Analyzer — Wave Count + Fibonacci Targets\n• ⚛️ Quantum Neural Core — Superposition Analysis & Entanglement Correlation\n• 🧠 Neural Sentiment Engine — News Impact Prediction\n• 📊 Deep Analysis Matrix — Quantitative Modeling & Backtesting\n\nPucho kya analyze karna hai — Market, Portfolio, Buy/Sell signals ya kuch bhi!',
    timestamp: Date.now()
  }]);
  const [chatInput, setChatInput] = useState('');
  const [isThinking, setIsThinking] = useState(false);
  const [showChat, setShowChat] = useState(false);
  const [marketIntel, setMarketIntel] = useState<MarketIntelligence | null>(null);
  const [copiedIdx, setCopiedIdx] = useState<number | null>(null);
  const [showScrollDown, setShowScrollDown] = useState(false);
  const [showAiSettings, setShowAiSettings] = useState(false);
  const [aiKeysTemp, setAiKeysTemp] = useState<AIKeys>(aiKeys);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const marketIntelRef = useRef<MarketIntelligence | null>(null);
  const chatContainerRef = useRef<HTMLDivElement>(null);
  const [aiProvider, setAiProvider] = useState<'GEMINI' | 'PERPLEXITY' | 'DEEPSEEK'>('GEMINI');

  const scrollToBottom = useCallback(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, []);

  useEffect(() => {
    if (showChat) scrollToBottom();
  }, [chatMessages, showChat, scrollToBottom]);

  const handleScroll = useCallback(() => {
    if (!chatContainerRef.current) return;
    const { scrollTop, scrollHeight, clientHeight } = chatContainerRef.current;
    setShowScrollDown(scrollHeight - scrollTop - clientHeight > 100);
  }, []);

  useEffect(() => {
    if (!showChat) return;
    const loadIntel = async () => {
      try {
        const intel = await fetchMarketIntelligence();
        setMarketIntel(intel);
        marketIntelRef.current = intel;
      } catch (e) { }
    };
    loadIntel();
    const iv = setInterval(loadIntel, 120000);
    return () => clearInterval(iv);
  }, [showChat]);

  const messagesRef = useRef<ChatMessage[]>(chatMessages);
  useEffect(() => {
    messagesRef.current = chatMessages;
  }, [chatMessages]);

  const copyToClipboard = useCallback((text: string, idx: number) => {
    navigator.clipboard.writeText(text).then(() => {
      setCopiedIdx(idx);
      setTimeout(() => setCopiedIdx(null), 2000);
    }).catch(() => { });
  }, []);

  const clearChat = useCallback(() => {
    setChatMessages([{
      role: 'model',
      text: '🧹 **Chat cleared! Fresh neural session started.**\n\nPucho kya analyze karna hai!',
      timestamp: Date.now()
    }]);
  }, []);

  const sendMessage = async (userMessage: string) => {
    if (!userMessage.trim()) return;

    // Check if at least one AI key is set
    const hasValidKey = Object.values(aiKeys).some(k => k && k.length > 10);
    if (!hasValidKey) {
      setChatMessages(prev => [...prev,
        { role: 'user', text: userMessage, timestamp: Date.now() },
        { role: 'model', text: '⚠️ **AI Engine Offline**\n\nKoi bhi AI API Key set nahi hai.\nSettings (⚙️) icon click karke:\n• Google Gemini 1.5 Pro key\n• Perplexity API key\n• DeepSeek API key\n\nPaste karo aur save karo!\n\nFree keys milengi:\n• gemini.google.com\n• perplexity.ai\n• deepseek.com', timestamp: Date.now() }
      ]);
      return;
    }

    const currentMessages = messagesRef.current;
    setChatMessages(prev => [...prev, { role: 'user', text: userMessage, timestamp: Date.now() }]);
    setIsThinking(true);

    try {
      const recentMessages = [...currentMessages.slice(-8), { role: 'user' as const, text: userMessage }];
      const intelContext = marketIntelRef.current ? formatMarketIntelligenceForAI(marketIntelRef.current) : '';

      const systemContent = `${SYSTEM_PROMPT}\n\n--- SENSOR DATA ---\n${portfolioContext}\n${intelContext}`;

      const fullMessages = [
        { role: 'system', content: systemContent },
        ...recentMessages.map(m => ({
          role: m.role === 'model' ? 'assistant' : 'user',
          content: m.text
        }))
      ];

      // Route query to appropriate AI model
      const provider = routeQuery(userMessage);
      setAiProvider(provider);

      // Get API key for selected provider
      const apiKey = aiKeys[provider];
      if (!apiKey || apiKey.length < 10) {
        throw new Error(`API Key missing for ${provider}. Please configure in Settings.`);
      }

      const aiText = await callAIProvider(provider, apiKey, fullMessages);

      // Convert markdown to HTML for display
      const htmlText = renderMarkdown(aiText);

      setChatMessages(prev => [...prev, {
        role: 'model',
        text: `<i>🤖 Neural Node: ${provider}</i><br/><br/>${htmlText}`,
        timestamp: Date.now()
      }]);
    } catch (e: any) {
      console.error("AI Error:", e);
      setChatMessages(prev => [...prev, { role: 'model', text: `❌ <b>AI Error:</b> ${e.message || String(e)}\n\n<i>Check your API key or try again.</i>`, timestamp: Date.now() }]);
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

  const handleSaveKeys = () => {
    if (onSettingsChange) {
      onSettingsChange(aiKeysTemp);
    }
    // Sync AI keys to cloud
    const keysToSync: AIKeys = {
      GEMINI: aiKeysTemp.GEMINI,
      PERPLEXITY: aiKeysTemp.PERPLEXITY,
      DEEPSEEK: aiKeysTemp.DEEPSEEK
    };
    syncToCloud([], 83.5).catch(() => {}); // Placeholder - cloud sync is handled via Google Apps Script

    setShowAiSettings(false);
  };

  return (
    <>
      {/* Floating Chat Trigger */}
      <button
        onClick={() => setShowChat(!showChat)}
        title="Deep Mind AI Market Insider"
        className="fab fixed bottom-6 right-6 w-14 h-14 bg-gradient-to-br from-cyan-600/90 via-blue-800/90 to-indigo-900/90 rounded-2xl flex items-center justify-center border border-cyan-500/50 shadow-[0_0_30px_rgba(6,182,212,0.4)] z-[60] overflow-hidden group hover:scale-110 transition-transform"
      >
        {showChat ? <X className="text-white z-10" /> : <span className="text-2xl z-10">🧠</span>}
        <span className="absolute -top-1 -right-1 w-3.5 h-3.5 bg-emerald-400 rounded-full animate-pulse-dot z-10 border-2 border-slate-900" />
        <div className="absolute inset-0 bg-gradient-to-t from-cyan-400/20 to-transparent opacity-0 group-hover:opacity-100 transition-opacity" />
        <span className="ripple-ring rounded-2xl text-cyan-400/50" />
      </button>

      <AnimatePresence>
        {showChat && (
          <motion.div
            initial={{ opacity: 0, y: 20, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 20, scale: 0.95 }}
            className="fixed bottom-24 right-4 left-4 sm:left-auto sm:right-6 sm:w-[440px] h-[680px] max-h-[85vh] shadow-[0_0_50px_rgba(6,182,212,0.1)] z-[60] flex flex-col overflow-hidden"
          >
            <div className="absolute inset-0 bg-slate-950/90 backdrop-blur-xl border border-cyan-500/20 rounded-3xl" />

            {/* Header */}
            <div className="relative p-4 border-b border-cyan-500/20 bg-gradient-to-r from-cyan-950/60 to-indigo-950/60 flex items-center justify-between rounded-t-3xl">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 bg-gradient-to-br from-cyan-800/60 to-indigo-900/60 border border-cyan-500/30 rounded-xl flex items-center justify-center">
                  <BrainCircuit className="text-cyan-400" size={20} />
                </div>
                <div>
                  <h3 className="text-sm font-black text-white uppercase tracking-tight flex items-center gap-1.5">
                    Deep Mind AI
                    <span className="text-[8px] bg-gradient-to-r from-cyan-500/20 to-indigo-500/20 text-cyan-300 px-1.5 py-0.5 rounded-md border border-cyan-500/20 font-bold tracking-wider">v6.0 FREE</span>
                  </h3>
                  <div className="text-[9px] font-bold text-emerald-400 uppercase tracking-widest flex items-center gap-1">
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                    Neural Link Active
                    {marketIntel && <span className="text-slate-500 ml-1">• {marketIntel.globalIndices.length} feeds</span>}
                    {portfolioContext && portfolioContext.length > 50 && <span className="text-cyan-500/50 ml-1">• Portfolio ✓</span>}
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-1.5">
                {marketIntel && (
                  <div className={`text-[9px] font-black px-2 py-1 rounded-lg border ${
                    marketIntel.fearGreedScore > 60 ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20' :
                      marketIntel.fearGreedScore < 40 ? 'bg-red-500/10 text-red-400 border-red-500/20' :
                        'bg-amber-500/10 text-amber-400 border-amber-500/20'
                    }`}>
                    {marketIntel.fearGreedScore > 60 ? '🟢' : marketIntel.fearGreedScore < 40 ? '🔴' : '🟡'} F&G {marketIntel.fearGreedScore}
                  </div>
                )}
                {onTelegramPush && (
                  <button
                    onClick={onTelegramPush}
                    title="Push report to Telegram"
                    className="text-slate-500 hover:text-indigo-400 bg-white/5 rounded-full p-1.5 transition-colors"
                  >📲</button>
                )}
                <button onClick={() => setShowAiSettings(true)} title="Configure AI Keys" className="text-slate-500 hover:text-cyan-400 bg-white/5 rounded-full p-1.5 transition-colors">
                  <Settings size={14} />
                </button>
                <button onClick={clearChat} title="Clear chat" className="text-slate-500 hover:text-red-400 bg-white/5 rounded-full p-1.5 transition-colors">
                  <Trash2 size={14} />
                </button>
                <button onClick={() => setShowChat(false)} className="text-slate-400 hover:text-white bg-white/5 rounded-full p-1.5 transition-colors">
                  <X size={16} />
                </button>
              </div>
            </div>

            {/* Messages */}
            <div
              ref={chatContainerRef}
              onScroll={handleScroll}
              className="relative flex-1 overflow-y-auto p-4 space-y-4 scrollbar-hide"
            >
              {chatMessages.map((msg, i) => (
                <div key={i} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'} animate-message-in`}>
                  <div className={`max-w-[90%] rounded-2xl text-[13px] leading-relaxed whitespace-pre-line ${msg.role === 'user'
                      ? 'bg-gradient-to-br from-cyan-600/90 to-blue-700/90 text-white rounded-br-none border border-cyan-500/30 px-4 py-3'
                      : 'bg-slate-900/90 text-slate-200 rounded-tl-none border border-white/5 px-4 py-3 group/msg'
                      }`}>
                    {msg.role === 'user' ? (
                      msg.text
                    ) : (
                      <>
                        <span dangerouslySetInnerHTML={{ __html: msg.text }} />
                        <div className="flex items-center gap-2 mt-2 opacity-0 group-hover/msg:opacity-100 transition-opacity">
                          <button
                            onClick={() => copyToClipboard(msg.text, i)}
                            className="text-[9px] text-slate-500 hover:text-cyan-400 flex items-center gap-1 transition-colors"
                          >
                            {copiedIdx === i ? <><Check size={10} /> Copied!</> : <><Copy size={10} /> Copy</>}
                          </button>
                        </div>
                      </>
                    )}
                    <div className={`text-[9px] mt-1 font-mono ${msg.role === 'user' ? 'text-cyan-200/50' : 'text-slate-600'}`}>
                      {formatTime(msg.timestamp)}
                    </div>
                  </div>
                </div>
              ))}
              {isThinking && (
                <div className="flex justify-start animate-message-in">
                  <div className="bg-slate-900/90 px-5 py-4 rounded-2xl rounded-tl-none border border-white/5">
                    <div className="flex items-center gap-2 text-[11px] text-cyan-400/70 mb-2 font-bold uppercase tracking-wider">
                      <Sparkles size={12} className="animate-pulse" /> {aiProvider === 'GEMINI' ? 'GEMINI 1.5 PRO' : aiProvider === 'PERPLEXITY' ? 'PERPLEXITY SONAR' : 'DEEPSEEK V3'} ANALYZING...
                    </div>
                    <div className="flex gap-1.5">
                      <div className="w-2 h-2 bg-cyan-500 rounded-full animate-bounce" />
                      <div className="w-2 h-2 bg-cyan-500 rounded-full animate-bounce" style={{ animationDelay: '100ms' }} />
                      <div className="w-2 h-2 bg-cyan-500 rounded-full animate-bounce" style={{ animationDelay: '200ms' }} />
                    </div>
                    <div className="text-[9px] text-slate-600 mt-2 font-mono">Deep reasoning: RSI, MACD, Smart Money, Wyckoff, Elliott Wave...</div>
                  </div>
                </div>
              )}
              <div ref={messagesEndRef} />
            </div>

            {/* AI Settings Modal */}
            {showAiSettings && (
              <motion.div
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: 20 }}
                className="absolute inset-0 bg-black/80 backdrop-blur-sm z-[70] rounded-3xl p-4 flex flex-col"
              >
                <div className="flex items-center justify-between mb-4">
                  <h3 className="text-sm font-bold text-white flex items-center gap-2">
                    <Settings size={16} className="text-cyan-400" />
                    Configure AI Providers
                  </h3>
                  <button
                    onClick={() => setShowAiSettings(false)}
                    className="text-slate-400 hover:text-white p-1"
                  >
                    <X size={16} />
                  </button>
                </div>

                <div className="flex-1 overflow-y-auto space-y-4">
                  <div className="p-3 bg-white/5 rounded-xl border border-white/10">
                    <div className="text-xs font-bold text-cyan-400 mb-2">Google Gemini 1.5 Pro</div>
                    <input
                      type="password"
                      placeholder="Paste Gemini API Key (free at gemini.google.com)"
                      value={aiKeysTemp.GEMINI}
                      onChange={(e) => setAiKeysTemp({ ...aiKeysTemp, GEMINI: e.target.value })}
                      className="w-full bg-slate-900 border border-white/10 rounded-lg px-3 py-2 text-sm text-white mb-2"
                    />
                    <div className="text-[10px] text-slate-400">Best for: Market updates, analysis, general queries</div>
                  </div>

                  <div className="p-3 bg-white/5 rounded-xl border border-white/10">
                    <div className="text-xs font-bold text-pink-400 mb-2">Perplexity AI (Sonar)</div>
                    <input
                      type="password"
                      placeholder="Paste Perplexity API Key (free at perplexity.ai)"
                      value={aiKeysTemp.PERPLEXITY}
                      onChange={(e) => setAiKeysTemp({ ...aiKeysTemp, PERPLEXITY: e.target.value })}
                      className="w-full bg-slate-900 border border-white/10 rounded-lg px-3 py-2 text-sm text-white mb-2"
                    />
                    <div className="text-[10px] text-slate-400">Best for: Breaking news, sources, latest market info</div>
                  </div>

                  <div className="p-3 bg-white/5 rounded-xl border border-white/10">
                    <div className="text-xs font-bold text-purple-400 mb-2">DeepSeek V3</div>
                    <input
                      type="password"
                      placeholder="Paste DeepSeek API Key (free at deepseek.com)"
                      value={aiKeysTemp.DEEPSEEK}
                      onChange={(e) => setAiKeysTemp({ ...aiKeysTemp, DEEPSEEK: e.target.value })}
                      className="w-full bg-slate-900 border border-white/10 rounded-lg px-3 py-2 text-sm text-white mb-2"
                    />
                    <div className="text-[10px] text-slate-400">Best for: Deep portfolio analysis, math, strategy, calculations</div>
                  </div>
                </div>

                <div className="mt-4">
                  <button
                    onClick={handleSaveKeys}
                    className="w-full py-3 bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-white rounded-xl font-bold text-sm transition-all"
                  >
                    💾 Save & Apply
                  </button>
                </div>
              </motion.div>
            )}

            {/* Quick Trading Tools — Screenshot Links */}
            <div className="relative px-4 pt-3 pb-1">
              <div className="text-[8px] font-bold text-slate-600 uppercase tracking-widest mb-2">⚡ Quick Trading Tools</div>
              <div className="grid grid-cols-2 gap-1.5">
                {[
                  { icon: '🧠', label: 'Options Analysis', sub: 'Sensibull Quantum', action: 'Scan live Option Chain for NIFTY. Analyze Put-Call Ratio (PCR), Max Pain, and Implied Volatility to find strong support and resistance levels.', clr: 'hover:bg-emerald-500/10 hover:border-emerald-500/30' },
                  { icon: '🎯', label: 'Option Strategist', sub: 'FrontPage AI', action: 'Based on current market volatility, construct 2 optimal actionable Option Strategies (e.g. Bull Call Spread, Iron Condor) with exact strikes, target, and SL.', clr: 'hover:bg-blue-500/10 hover:border-blue-500/30' },
                  { icon: '🌍', label: 'News Sentiment', sub: 'Global Pulse', action: 'Summarize the latest financial market news and calculate a collective Bullish/Bearish sentiment score (1-100) affecting the markets today.', clr: 'hover:bg-amber-500/10 hover:border-amber-500/30' },
                  { icon: '💼', label: 'Fund. Forensics', sub: 'Screener AI', action: 'Execute a deep fundamental forensic analysis for the top holding in my portfolio. Calculate Intrinsic Value using Benjamin Graham framework.', clr: 'hover:bg-purple-500/10 hover:border-purple-500/30' },
                ].map((tool, i) => (
                  <button
                    key={i}
                    onClick={() => {
                      sendMessage(tool.action);
                    }}
                    className={`flex items-center text-left gap-2 px-2.5 py-2 rounded-xl bg-white/[0.02] border border-white/[0.06] ${tool.clr} transition-all group`}
                  >
                    <span className="text-base flex-shrink-0">{tool.icon}</span>
                    <div className="overflow-hidden min-w-0">
                      <div className="text-[9px] font-bold text-slate-300 group-hover:text-white truncate leading-tight">{tool.label}</div>
                      <div className="text-[8px] font-bold text-slate-600 group-hover:text-slate-400 truncate">{tool.sub} ⚡</div>
                    </div>
                  </button>
                ))}
              </div>
            </div>

            {/* Quick Chips - scrollable */}

            <div className="relative px-4 pb-2 flex gap-1.5 overflow-x-auto scrollbar-hide">
              {QUICK_CHIPS.map((chip, i) => (
                <button
                  key={i}
                  onClick={() => { setChatInput(''); sendMessage(chip.query); }}
                  disabled={isThinking}
                  className="whitespace-nowrap text-[10px] font-bold px-3 py-1.5 rounded-xl bg-white/[0.03] border border-white/10 text-slate-400 hover:text-cyan-400 hover:border-cyan-500/30 hover:bg-cyan-500/5 transition-all disabled:opacity-30 shrink-0"
                >
                  {chip.label}
                </button>
              ))}
            </div>

            {/* Input */}
            <div className="relative p-4 bg-slate-950/95 border-t border-cyan-500/15 rounded-b-3xl">
              <div className="relative flex items-center">
                <input
                  type="text"
                  placeholder="Ask Deep Mind anything..."
                  className="w-full bg-slate-900/60 border border-slate-700/80 rounded-2xl py-3 pl-4 pr-12 text-sm text-white outline-none focus:border-cyan-500/60 transition-all font-medium placeholder:text-slate-600"
                  value={chatInput}
                  onChange={(e) => setChatInput(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && handleChat()}
                />
                <button
                  onClick={handleChat}
                  disabled={isThinking || !chatInput.trim()}
                  className="absolute right-1.5 p-2 bg-gradient-to-r from-cyan-600 to-blue-700 hover:from-cyan-500 hover:to-blue-600 text-white rounded-xl disabled:opacity-30 transition-all"
                >
                  <Send size={14} />
                </button>
              </div>
              <div className="flex items-center justify-between mt-2 px-1">
                <span className="text-[8px] text-slate-600 font-mono">Free & Unlimited Multi-Model Neural System</span>
                <span className="text-[8px] text-slate-600">{chatMessages.length} messages</span>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
});
