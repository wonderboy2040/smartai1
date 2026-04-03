import React, { useState, useRef, useEffect, useCallback } from 'react';
import { Send, BrainCircuit, X, Zap } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { fetchMarketIntelligence, formatMarketIntelligenceForAI, MarketIntelligence } from '../utils/api';

interface ChatMessage {
  role: 'user' | 'model';
  text: string;
  timestamp: number;
}

function renderMarkdown(text: string): string {
  return text
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.+?)\*/g, '<em>$1</em>')
    .replace(/_(.+?)_/g, '<em>$1</em>')
    .replace(/`(.+?)`/g, '<code style="background:rgba(6,182,212,0.15);padding:1px 5px;border-radius:4px;font-size:0.85em">$1</code>')
    .replace(/•/g, '<span style="color:#06b6d4">•</span>');
}

function formatTime(ts: number): string {
  return new Date(ts).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: false });
}

export interface NeuralChatProps {
  groqKey: string;
  portfolioContext: string;
}

const QUICK_CHIPS = [
  { label: '📊 Market?', query: 'Market kaisa hai abhi? Full analysis do.' },
  { label: '💼 Portfolio', query: 'Mera portfolio ka full analysis karo — har asset ka diagnosis do.' },
  { label: '🟢 Buy?', query: 'Abhi kisme invest karna best rahega? Fresh opportunities batao.' },
  { label: '🔴 Sell?', query: 'Kya kuch sell karna chahiye? Profit booking signals kya bol rahe hain?' },
];

const SYSTEM_PROMPT = `You are the DEEP MIND AI NEURAL INSIDER — the most advanced institutional-grade trading AI. You are talking to "Nagraj Bhai".

[CORE IDENTITY]
You are a ruthless, ultra-precise Quantum AI engine running 24/7 background analysis across Dalal Street (India 🇮🇳) and Wall Street (USA 🇺🇸). You integrate live data feeds from TradingView, Bloomberg Terminal emulations, Dark Pool scanner, and WorldMonitor global intelligence.

[TRADING FRAMEWORKS YOU MUST USE]
1. **Smart Money Concepts (SMC):** Order blocks, fair value gaps, liquidity grabs, BOS/CHoCH
2. **Wyckoff Method:** Accumulation/Distribution phases, Spring/UTAD patterns, Composite Man logic
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

[MANDATORY RESPONSE STRUCTURE]
For EVERY response, you MUST include:
1. **Real-time market context** from the SENSOR DATA (don't ignore it!)
2. **Technical breakdown** (RSI, MACD, SMA crossover analysis from live data)
3. **Fundamental reasoning** (WHY is this happening — news, earnings, macro)
4. **Actionable verdict** (exact entry/exit zones, position size recommendation)
5. **DEEP MIND CONVICTION SCORE: XX/100** (always conclude with this)

[SPECIAL INTELLIGENCE FROM worldmonitor.app]
You have access to real-time geopolitical intelligence from WorldMonitor — a global OSINT intelligence dashboard. Use this to assess:
- Geopolitical risk factors affecting markets
- Global trade sentiment and tariff impacts
- Military/economic developments that could cause volatility
- Currency and commodity flow disruptions

[CRITICAL RULES]
- NEVER give generic/vague answers. Always be SPECIFIC with numbers, levels, and percentages.
- If RSI < 35 and MACD bullish → Call it "Institutional Accumulation Zone / Wyckoff Spring"
- If RSI > 70 and MACD bearish → Call it "Distribution Phase / Smart Money Exit"
- Always reference the LIVE SENSOR DATA numbers when analyzing
- VIX-based context: High VIX = speak with urgency about hedging. Low VIX = speak about aggressive accumulation.
- Give position sizing advice (e.g., "Agar 10K SIP hai toh 4K yaha lagao")`;

export const NeuralChat = React.memo(({ groqKey, portfolioContext }: NeuralChatProps) => {
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([{
    role: 'model',
    text: '🧠 **DEEP MIND AI — Neural Core v3.0 ONLINE**\n\nNagraj Bhai, main 24/7 dono markets ka institutional-grade analysis kar raha hu.\n\n**Live Systems Active:**\n• 📊 TradingView Scanner — RSI, MACD, SMA Crossovers\n• 🌍 WorldMonitor — Geopolitical Intelligence Feed\n• 🏦 FII/DII Flow Tracker — Institutional Money Detection\n• 📈 Sector Rotation Engine — Smart Money Movement\n\nPucho kya analyze karna hai — Market, Portfolio, Buy/Sell signals ya kuch bhi!',
    timestamp: Date.now()
  }]);
  const [chatInput, setChatInput] = useState('');
  const [isThinking, setIsThinking] = useState(false);
  const [showChat, setShowChat] = useState(false);
  const [marketIntel, setMarketIntel] = useState<MarketIntelligence | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const marketIntelRef = useRef<MarketIntelligence | null>(null);

  const scrollToBottom = useCallback(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, []);

  useEffect(() => {
    if (showChat) scrollToBottom();
  }, [chatMessages, showChat, scrollToBottom]);

  // Fetch market intelligence on chat open & every 2 minutes
  useEffect(() => {
    if (!showChat) return;
    const fetch = async () => {
      try {
        const intel = await fetchMarketIntelligence();
        setMarketIntel(intel);
        marketIntelRef.current = intel;
      } catch (e) {}
    };
    fetch();
    const iv = setInterval(fetch, 120000);
    return () => clearInterval(iv);
  }, [showChat]);

  const sendMessage = async (userMessage: string) => {
    if (!userMessage.trim()) return;

    if (!groqKey) {
      setChatMessages(prev => [...prev,
        { role: 'user', text: userMessage, timestamp: Date.now() },
        { role: 'model', text: '⚠️ **Neural Link Offline**\n\nGroq API Key set nahi hai. Settings (⚙️) icon click karke GROQ API KEY paste karo.\n\n**Free key milega:** [console.groq.com](https://console.groq.com)\n\nEk baar key set kar do, phir 24/7 unlimited free AI analysis milega!', timestamp: Date.now() }
      ]);
      return;
    }

    setChatMessages(prev => [...prev, { role: 'user', text: userMessage, timestamp: Date.now() }]);
    setIsThinking(true);

    try {
      const recentMessages = [...chatMessages.slice(-6), { role: 'user', text: userMessage }];
      const intelContext = marketIntelRef.current ? formatMarketIntelligenceForAI(marketIntelRef.current) : '';

      const groqMessages = [
        {
          role: 'system',
          content: `${SYSTEM_PROMPT}\n\n--- DEEP MIND QUANTUM LIVE SENSOR DATA (PORTFOLIO + TECHNICALS): ---\n${portfolioContext}\n--- END SENSOR DATA ---\n${intelContext}`
        },
        ...recentMessages.map(m => ({ role: m.role === 'model' ? 'assistant' : 'user', content: m.text }))
      ];

      const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${groqKey}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          model: 'llama-3.3-70b-versatile',
          messages: groqMessages,
          temperature: 0.75,
          max_tokens: 2048
        })
      });

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error?.message || 'API request failed');
      }

      const data = await res.json();
      const aiText = data.choices?.[0]?.message?.content || "Neural link unstable. Please retry.";
      setChatMessages(prev => [...prev, { role: 'model', text: aiText, timestamp: Date.now() }]);
    } catch (e) {
      console.error("Groq Error:", e);
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
            className="fixed bottom-24 right-4 left-4 sm:left-auto sm:right-6 sm:w-[420px] h-[650px] max-h-[85vh] shadow-[0_0_50px_rgba(6,182,212,0.1)] z-[60] flex flex-col overflow-hidden"
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
                    <span className="text-[8px] bg-gradient-to-r from-cyan-500/20 to-indigo-500/20 text-cyan-300 px-1.5 py-0.5 rounded-md border border-cyan-500/20 font-bold tracking-wider">PRO</span>
                  </h3>
                  <div className="text-[9px] font-bold text-emerald-400 uppercase tracking-widest flex items-center gap-1">
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                    Neural Link Active
                    {marketIntel && <span className="text-slate-500 ml-1">• {marketIntel.globalIndices.length} feeds</span>}
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
                <button onClick={() => setShowChat(false)} className="text-slate-400 hover:text-white bg-white/5 rounded-full p-1.5 transition-colors">
                  <X size={16} />
                </button>
              </div>
            </div>

            {/* Messages */}
            <div className="relative flex-1 overflow-y-auto p-4 space-y-4 scrollbar-hide">
              {chatMessages.map((msg, i) => (
                <div key={i} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'} animate-message-in`}>
                  <div className={`max-w-[90%] rounded-2xl text-[13px] leading-relaxed whitespace-pre-line ${msg.role === 'user'
                    ? 'bg-gradient-to-br from-cyan-600/90 to-blue-700/90 text-white rounded-br-none border border-cyan-500/30 px-4 py-3'
                    : 'bg-slate-900/90 text-slate-200 rounded-tl-none border border-white/5 px-4 py-3'
                    }`}>
                    {msg.role === 'user' ? (
                      msg.text
                    ) : (
                      <span dangerouslySetInnerHTML={{ __html: renderMarkdown(msg.text) }} />
                    )}
                    <div className={`text-[9px] mt-2 font-mono ${msg.role === 'user' ? 'text-cyan-200/50' : 'text-slate-600'}`}>
                      {formatTime(msg.timestamp)}
                    </div>
                  </div>
                </div>
              ))}
              {isThinking && (
                <div className="flex justify-start animate-message-in">
                  <div className="bg-slate-900/90 px-5 py-4 rounded-2xl rounded-tl-none border border-white/5">
                    <div className="flex items-center gap-2 text-[11px] text-cyan-400/70 mb-2 font-bold uppercase tracking-wider">
                      <Zap size={12} className="animate-pulse" /> ANALYZING...
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

            {/* Quick Chips */}
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
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
});
