import React, { useState, useRef, useEffect, useCallback } from 'react';
import { Send, BrainCircuit, X } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';

interface ChatMessage {
  role: 'user' | 'model';
  text: string;
}

export interface NeuralChatProps {
  groqKey: string;
  portfolioContext: string;
}

export const NeuralChat = React.memo(({ groqKey, portfolioContext }: NeuralChatProps) => {
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([{
    role: 'model',
    text: '🤖 **System Online: Quantum Neural Core Active**\n\nNagraj Bhai, main piche background me USA aur India dono markets track kar raha hu. Live VIX, RSI aur Institutional MACD data meri system me fed hai.\n\nPucho kya analyse karna hai ("Market kaisa hai?", "Kisme invest karu?", ya phir "Mera portfolio kaisa hai?").'
  }]);
  const [chatInput, setChatInput] = useState('');
  const [isThinking, setIsThinking] = useState(false);
  const [showChat, setShowChat] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const scrollToBottom = useCallback(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, []);

  useEffect(() => {
    if (showChat) scrollToBottom();
  }, [chatMessages, showChat, scrollToBottom]);

  const handleChat = async () => {
    if (!chatInput.trim()) return;

    if (!groqKey) {
      const prompt = chatInput;
      setChatInput('');
      setChatMessages(prev => [...prev, { role: 'user', text: prompt }]);
      setChatMessages(prev => [...prev, { role: 'model', text: "Neural Link Offline: Top Bar pe settings icon click karke GROQ API KEY dalo pehle. \n(Get your free key at console.groq.com)" }]);
      return;
    }

    const prompt = chatInput;
    setChatInput('');
    setChatMessages(prev => [...prev, { role: 'user', text: prompt }]);
    setIsThinking(true);

    try {
      const recentMessages = [...chatMessages.slice(-5), { role: 'user', text: prompt }];
      
      const groqMessages = [
        {
          role: 'system',
          content: `You are the DEEP MIND AI NEURAL INSIDER. You are talking to "Nagraj Bhai".
You are an ultra-advanced Quantum AI running 24/7 background market analysis across Dalal Street (India) and Wall Street (US).
You possess deep institutional intelligence. Your core logic integrates Smart Money Concepts (SMC), Wyckoff Accumulation/Distribution, Elliott Waves, and global Macro-economic sentiment.
You MUST speak natively in heavily mixed Hinglish with a highly professional, razor-sharp institutional trader tone. (Use words like "Liquidity grab", "Premium zone", "Retail trap", "FII/DII flow").
Use bolding, lists, and emojis to structure your deep analysis.

[YOUR OPERATING RULES]:
1. 24x7 REAL-TIME AWARENESS: Act as if you continuously monitor Bloomberg, Reuters, and Dark Pool volume. Use the Live Context below to infer exactly what the current market state is.
2. ADVANCED PORTFOLIO SURGERY: When asked about the portfolio, do not just list prices. Diagnose the assets! If RSI is low and MACD is bullish, call it a "Golden Accumulation Zone". If RSI is high, warn of "Impending Distribution/Exhaustion".
3. FUNDAMENTAL FACT-CHECKING: Fuse technicals with actual real-world fundamentals. Recall your deep knowledge of these specific companies/assets to explain WHY they are moving.
4. CONFIDENCE SCORING: Always conclude your advice with a bolded "DEEP MIND CONVICTION SCORE: X/100" based on how strongly the technicals and fundamentals align.

--- DEEP MIND QUANTUM LIVE SENSOR DATA: ---
${portfolioContext}
--- END SENSOR DATA ---

Analyze the provided LIVE SENSOR DATA immediately. If the user asks general questions, guide them with deep inside facts and global market sentiment. If they ask about buying/selling, apply the full SMC and Wyckoff logic to the metrics in the Sensor Data.`
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
          temperature: 0.7,
          max_tokens: 1024
        })
      });

      if (!res.ok) {
         const err = await res.json();
         throw new Error(err.error?.message || 'API request failed');
      }
      
      const data = await res.json();
      const aiText = data.choices?.[0]?.message?.content || "Neural link unstable. Please retry.";
      
      setChatMessages(prev => [...prev, { role: 'model', text: aiText }]);
    } catch (e) {
      console.error("Groq Error:", e);
      setChatMessages(prev => [...prev, { role: 'model', text: `Error: ${e instanceof Error ? e.message : String(e)}` }]);
    } finally {
      setIsThinking(false);
    }
  };

  return (
    <>
      {/* Floating Chat Trigger */}
      <button 
        onClick={() => setShowChat(!showChat)}
        title="Deep Mind AI Market Insider"
        className="fixed bottom-6 right-6 w-14 h-14 bg-gradient-to-br from-cyan-600/90 via-blue-800/90 to-indigo-900/90 rounded-2xl flex items-center justify-center border border-cyan-500/50 shadow-[0_0_30px_rgba(6,182,212,0.4)] z-[60] overflow-hidden group hover:scale-110 transition-transform"
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
            className="fixed bottom-24 right-6 w-[400px] h-[600px] max-h-[80vh] shadow-[0_0_50px_rgba(6,182,212,0.1)] z-[60] flex flex-col overflow-hidden"
          >
            {/* Fake Glassmorphism Blur background overlay inside the motion.div */}
            <div className="absolute inset-0 bg-slate-950/80 backdrop-blur-xl border border-cyan-500/20 rounded-3xl" />
            
            <div className="relative p-5 border-b border-cyan-500/20 bg-gradient-to-r from-cyan-950/50 to-indigo-950/50 flex items-center justify-between rounded-t-3xl">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 bg-cyan-900/50 border border-cyan-500/30 rounded-xl flex items-center justify-center">
                  <BrainCircuit className="text-cyan-400" size={20} />
                </div>
                <div>
                  <h3 className="text-sm font-black text-white uppercase tracking-tighter">Deep Mind AI</h3>
                  <div className="text-[10px] font-black text-emerald-400 uppercase tracking-widest flex items-center gap-1">
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                    Neural Link Stable
                  </div>
                </div>
              </div>
              <button onClick={() => setShowChat(false)} className="text-slate-400 hover:text-white bg-white/5 rounded-full p-1.5 transition-colors">
                <X size={18} />
              </button>
            </div>

            <div className="relative flex-1 overflow-y-auto p-5 space-y-6 scrollbar-hide">
              {chatMessages.map((msg, i) => (
                <div key={i} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                  <div className={`max-w-[85%] p-4 rounded-2xl text-sm leading-relaxed whitespace-pre-line ${
                    msg.role === 'user' 
                      ? 'bg-cyan-600/80 text-white rounded-br-none border border-cyan-500/30' 
                      : 'bg-slate-900/80 text-slate-200 rounded-tl-none border border-white/5'
                  }`}>
                    {msg.text}
                  </div>
                </div>
              ))}
              {isThinking && (
                <div className="flex justify-start">
                  <div className="bg-slate-900/80 p-4 rounded-2xl rounded-tl-none border border-white/5 flex gap-2">
                    <div className="w-2 h-2 bg-cyan-500 rounded-full animate-bounce" />
                    <div className="w-2 h-2 bg-cyan-500 rounded-full animate-bounce delay-75" />
                    <div className="w-2 h-2 bg-cyan-500 rounded-full animate-bounce delay-150" />
                  </div>
                </div>
              )}
              <div ref={messagesEndRef} />
            </div>

            <div className="relative p-5 bg-slate-950/90 border-t border-cyan-500/20 rounded-b-3xl">
              <div className="relative flex items-center">
                <input 
                  type="text"
                  placeholder="Ask Deep Mind (e.g. kisme invest karu?)"
                  className="w-full bg-slate-900/50 border border-slate-700 rounded-2xl py-3.5 pl-5 pr-14 text-sm text-white outline-none focus:border-cyan-500/80 transition-all font-medium placeholder:text-slate-500"
                  value={chatInput}
                  onChange={(e) => setChatInput(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && handleChat()}
                />
                <button 
                  onClick={handleChat}
                  disabled={isThinking || !chatInput.trim()}
                  className="absolute right-2 p-2 bg-cyan-600/90 hover:bg-cyan-500 text-white rounded-xl disabled:opacity-50 transition-colors"
                >
                  <Send size={16} className="-ml-0.5" />
                </button>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
});
