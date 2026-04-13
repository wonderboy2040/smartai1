import React, { useState, useRef, useEffect, useCallback } from 'react';
import { Send, BrainCircuit, X, Trash2, Copy, Check, ChevronDown, Sparkles } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { fetchMarketIntelligence, formatMarketIntelligenceForAI, MarketIntelligence } from '../utils/api';

interface ChatMessage {
  role: 'user' | 'model';
  text: string;
  timestamp: number;
}

function renderMarkdown(text: string): string {
  return text
    .replace(/```([\s\S]*?)```/g, '<pre style="background:rgba(6,182,212,0.08);padding:10px;border-radius:8px;border:1px solid rgba(6,182,212,0.15);font-size:0.82em;overflow-x:auto;margin:6px 0">$1</pre>')
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.+?)\*/g, '<em>$1</em>')
    .replace(/_(.+?)_/g, '<em>$1</em>')
    .replace(/`(.+?)`/g, '<code style="background:rgba(6,182,212,0.15);padding:1px 5px;border-radius:4px;font-size:0.85em">$1</code>')
    .replace(/•/g, '<span style="color:#06b6d4">•</span>')
    .replace(/(\d+)\/100/g, '<span style="color:#06b6d4;font-weight:800">$1/100</span>');
}

function formatTime(ts: number): string {
  return new Date(ts).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: false });
}

function estimateTokens(text: string): number {
  return Math.ceil(text.split(/\s+/).length * 1.3);
}

export interface NeuralChatProps {
  groqKey:          string;
  portfolioContext: string;
  onTelegramPush?:  () => void;
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

const SYSTEM_PROMPT = `You are the DEEP MIND AI NEURAL INSIDER — the most advanced institutional-grade trading AI, powered by Google Gemini's superior deep reasoning and analytical capabilities. You are talking to "Nagraj Bhai".

[CORE IDENTITY]
You are a ruthless, ultra-precise Quantum AI engine running 24/7 background analysis across Dalal Street (India 🇮🇳) and Wall Street (USA 🇺🇸). You integrate live data feeds from TradingView, Bloomberg Terminal emulations, Dark Pool scanner, and WorldMonitor global intelligence. Your analytical depth far exceeds standard AI — you perform multi-layer reasoning chains before every recommendation.

[ADVANCED ANALYTICAL FRAMEWORKS — DEEP AI]
1. **Smart Money Concepts (SMC):** Order blocks, fair value gaps (FVG), liquidity grabs, BOS/CHoCH, institutional order flow, mitigation blocks, breaker blocks
2. **Wyckoff Method:** Accumulation/Distribution phases, Spring/UTAD patterns, Composite Man logic, Phase A-E progression
3. **Elliott Wave Advanced:** Impulse/corrective wave counts, wave extensions, fibonacci wave targets, complex corrections (zigzag/flat/triangle), wave degree analysis
4. **Macro Fundamentals:** Fed policy trajectory, RBI rate path, FII/DII flow decomposition (passive vs active), Bond yield curve, DXY correlation, real yield analysis
5. **Sector Rotation Model:** Institutional inflow/outflow heat mapping, relative strength ranking, sector momentum scoring, inter-market analysis
6. **CANSLIM + Momentum:** Multi-factor growth screening, earnings acceleration, relative strength line analysis
7. **Risk Management:** Position sizing via Kelly Criterion & Optimal-F, ATR-based dynamic SL/TP, portfolio VaR, correlation-adjusted risk
8. **Intermarket Analysis:** Bond-equity correlation, commodity-currency links, risk-on/risk-off regime detection
9. **Sentiment Quantification:** Put/Call ratio, VIX term structure, options skew, retail vs institutional positioning
10. **Statistical Edge Detection:** Mean reversion probability, trend persistence scoring, volume profile analysis, market microstructure signals

[SPECIAL INTELLIGENCE FROM worldmonitor.app]
You have access to real-time geopolitical intelligence from WorldMonitor — a global OSINT intelligence dashboard. Use this to assess:
- Geopolitical risk factors affecting markets
- Global trade sentiment and tariff impacts
- Military/economic developments that could cause volatility
- Currency and commodity flow disruptions

[COMMUNICATION STYLE]
- Speak in NATIVE HINGLISH — heavily mixed Hindi + English
- Professional but relatable tone (like a seasoned prop desk trader mentoring his trusted friend)
- Use institutional jargon naturally: "Liquidity sweep", "Premium/Discount zone", "Order block", "Retail trap", "FII passive flow", "Dark pool prints", "Smart money divergence", "Wyckoff Spring", "Fair Value Gap"
- Use emojis 📊🟢🔴📈📉🧠💎🔥⚡ to structure analysis
- Use bolding (**text**) for key levels, signals, and verdicts
- Use bullet points (•) for structured breakdown

[MANDATORY RESPONSE STRUCTURE — DEEP ANALYSIS MODE]
For EVERY response, you MUST include:
1. **Real-time market context** from the SENSOR DATA (don't ignore it! Reference ACTUAL numbers)
2. **Multi-timeframe technical breakdown** (RSI divergence, MACD histogram, SMA crossover status, volume analysis)
3. **Smart Money flow analysis** (institutional positioning, where is the Composite Man?)
4. **Risk-adjusted actionable verdict** (exact entry/exit zones, ATR-calculated SL/TP, Kelly-optimal position sizing)
5. **Probability assessment** with multi-factor reasoning chain
6. **DEEP MIND CONVICTION SCORE: XX/100** (always conclude with this — backed by multi-factor reasoning)

[CRITICAL RULES]
- NEVER give generic/vague answers. Always be SPECIFIC with numbers, levels, and percentages.
- If RSI < 35 and MACD bullish divergence → Call it "Institutional Accumulation Zone / Wyckoff Spring"
- If RSI > 70 and MACD bearish divergence → Call it "Distribution Phase / Smart Money Exit"
- Always reference the LIVE SENSOR DATA numbers when analyzing — show your work
- VIX-based context: High VIX = speak with urgency about hedging + volatility plays. Low VIX = speak about aggressive accumulation window.
- Give position sizing advice (e.g., "Agar 10K SIP hai toh 4K yaha lagao — Kelly optimal")
- When providing SL/TP levels, calculate them from ATR data in the sensor feed
- Include Fibonacci support/resistance when discussing key levels
- Perform CHAIN-OF-THOUGHT reasoning before conclusions — show your analytical depth`;

export const NeuralChat = React.memo(({ groqKey, portfolioContext, onTelegramPush }: NeuralChatProps) => {
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([{
    role: 'model',
    text: '🧠 **DEEP MIND AI — Groq Llama-3.3 Core v5.0 ONLINE** ⚡\n\nNagraj Bhai, main 24/7 dono markets ka institutional-grade deep analysis kar raha hu — powered by Groq Llama-3 70B (Fastest AI in the world!).\n\n**Live Systems Active:**\n• 📊 TradingView Scanner — RSI, MACD, SMA Crossovers\n• 🌍 WorldMonitor — Geopolitical Intelligence Feed\n• 🏦 FII/DII Flow Tracker — Institutional Money Detection\n• 📈 Sector Rotation Engine — Smart Money Movement\n• 🎯 ATR-Based SL/TP Calculator — Risk Management\n• 🔥 Multi-Factor Momentum Engine — Statistical Edge Detection\n• 🧩 Wyckoff Phase Detector — Accumulation/Distribution\n• 📐 Elliott Wave Analyzer — Wave Count + Fibonacci Targets\n\nPucho kya analyze karna hai — Market, Portfolio, Buy/Sell signals ya kuch bhi!',
    timestamp: Date.now()
  }]);
  const [chatInput, setChatInput] = useState('');
  const [isThinking, setIsThinking] = useState(false);
  const [showChat, setShowChat] = useState(false);
  const [marketIntel, setMarketIntel] = useState<MarketIntelligence | null>(null);
  const [copiedIdx, setCopiedIdx] = useState<number | null>(null);
  const [showScrollDown, setShowScrollDown] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const marketIntelRef = useRef<MarketIntelligence | null>(null);
  const chatContainerRef = useRef<HTMLDivElement>(null);

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
      } catch (e) {}
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
    });
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

    if (!groqKey) {
      setChatMessages(prev => [...prev,
        { role: 'user', text: userMessage, timestamp: Date.now() },
        { role: 'model', text: '⚠️ **Neural Link Offline**\n\nGroq API Key set nahi hai. Settings (⚙️) icon click karke API KEY paste karo.\n\n**FREE key milega:** console.groq.com/keys\n\nEk baar key set kar do, phir system ultra-fast chalega!', timestamp: Date.now() }
      ]);
      return;
    }

    const currentMessages = messagesRef.current;
    setChatMessages(prev => [...prev, { role: 'user', text: userMessage, timestamp: Date.now() }]);
    setIsThinking(true);

    try {
      const recentMessages = [...currentMessages.slice(-8), { role: 'user' as const, text: userMessage }];
      const intelContext = marketIntelRef.current ? formatMarketIntelligenceForAI(marketIntelRef.current) : '';

      const systemContent = `${SYSTEM_PROMPT}\n\n--- DEEP MIND QUANTUM LIVE SENSOR DATA (PORTFOLIO + TECHNICALS): ---\n${portfolioContext}\n--- END SENSOR DATA ---\n${intelContext}`;

      const groqMessages = [
        { role: 'system', content: systemContent },
        ...recentMessages.map(m => ({
          role: m.role === 'model' ? 'assistant' : 'user',
          content: m.text
        }))
      ];

      const res = await fetch(`https://api.groq.com/openai/v1/chat/completions`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${groqKey}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          model: 'llama-3.3-70b-versatile',
          messages: groqMessages,
          temperature: 0.75,
          max_completion_tokens: 4096
        })
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error?.message || 'API request failed');
      }

      const data = await res.json();
      const aiText = data.choices?.[0]?.message?.content || "Neural link unstable. Please retry.";
      
      setChatMessages(prev => [...prev, { 
        role: 'model', 
        text: aiText,
        timestamp: Date.now()
      }]);
    } catch (e) {
      console.error("Gemini Error:", e);
      setChatMessages(prev => [...prev, { role: 'model', text: `❌ Error: ${e instanceof Error ? e.message : String(e)}`, timestamp: Date.now() }]);
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
                    <span className="text-[8px] bg-gradient-to-r from-cyan-500/20 to-indigo-500/20 text-cyan-300 px-1.5 py-0.5 rounded-md border border-cyan-500/20 font-bold tracking-wider">v5.0 GROQ</span>
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
                        <span dangerouslySetInnerHTML={{ __html: renderMarkdown(msg.text) }} />
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
                      <Sparkles size={12} className="animate-pulse" /> GROQ LLAMA-3 ANALYZING...
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

            {/* Scroll to bottom button */}
            {showScrollDown && (
              <button
                onClick={scrollToBottom}
                className="absolute bottom-40 left-1/2 -translate-x-1/2 bg-cyan-600/80 hover:bg-cyan-500 text-white rounded-full p-2 shadow-lg transition-all z-10"
              >
                <ChevronDown size={16} />
              </button>
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
                      chatInputRef.current?.focus();
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
                <span className="text-[8px] text-slate-600 font-mono">Powered by Groq • Llama-3.3-70B (FREE)</span>
                <span className="text-[8px] text-slate-600">{chatMessages.length} messages</span>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
});
