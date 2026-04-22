import React, { useState, useRef, useEffect, useCallback } from 'react';
import { Send, BrainCircuit, X, Trash2, Copy, Check, ChevronDown, Sparkles, Zap, Activity, BarChart3, ShieldAlert } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { fetchMarketIntelligence, formatMarketIntelligenceForAI, MarketIntelligence } from '../utils/api';
import { detectIntent, getModelLabel, AIModel } from '../utils/ai-router';

interface ChatMessage {
  role: 'user' | 'model';
  text: string;
  timestamp: number;
  model?: AIModel;
}

function sanitizeHtml(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<script[^>]*>/gi, '')
    .replace(/\s*on\w+\s*=\s*["'][^"']*["']/gi, '')
    .replace(/\s*on\w+\s*=\s*[^\s>]+/gi, '');
}

function renderMarkdown(text: string): string {
  return sanitizeHtml(text
    .replace(/```([\s\S]*?)```/g, '<pre style="background:rgba(6,182,212,0.08);padding:10px;border-radius:8px;border:1px solid rgba(6,182,212,0.15);font-size:0.82em;overflow-x:auto;margin:6px 0">$1</pre>')
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.+?)\*/g, '<em>$1</em>')
    .replace(/_(.+?)_/g, '<em>$1</em>')
    .replace(/`(.+?)`/g, '<code style="background:rgba(6,182,212,0.15);padding:1px 5px;border-radius:4px;font-size:0.85em">$1</code>')
    .replace(/•/g, '<span style="color:#06b6d4">•</span>')
    .replace(/(\d+)\/100/g, '<span style="color:#06b6d4;font-weight:800">$1/100</span>'));
}

function formatTime(ts: number): string {
  return new Date(ts).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: false });
}

export interface NeuralChatProps {
  groqKey: string;
  geminiKey?: string;
  deepseekKey?: string;
  portfolioContext: string;
  onTelegramPush?: () => void;
}

const QUICK_ACTIONS = [
  { label: 'Morning Brief', query: '/morning', icon: <Activity size={12}/>, model: 'gemini' },
  { label: 'Latest News', query: '/news', icon: <Zap size={12}/>, model: 'gemini' },
  { label: 'Weekly Review', query: '/weekly', icon: <BarChart3 size={12}/>, model: 'deepseek' },
  { label: 'Deep Analyze', query: '/analyze', icon: <BrainCircuit size={12}/>, model: 'deepseek' },
  { label: 'Trim Check', query: '/trim', icon: <ShieldAlert size={12}/>, model: 'deepseek' },
  { label: 'Crisis Check', query: '/crisis', icon: <ShieldAlert size={12}/>, model: 'gemini' },
];

const MODEL_TAGS = {
  gemini: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20',
  deepseek: 'bg-purple-500/10 text-purple-400 border-purple-500/20',
  groq: 'bg-orange-500/10 text-orange-400 border-orange-500/20',
  multi: 'bg-cyan-500/10 text-cyan-400 border-cyan-500/20',
  system: 'bg-slate-500/10 text-slate-400 border-slate-500/20',
};

export const NeuralChat = React.memo(({ groqKey, geminiKey: propGeminiKey, deepseekKey: propDeepseekKey, portfolioContext, onTelegramPush }: NeuralChatProps) => {
  const geminiKey = propGeminiKey || import.meta.env.VITE_GEMINI_KEY || groqKey;
  const deepseekKey = propDeepseekKey || import.meta.env.VITE_DEEPSEEK_KEY || groqKey;
  
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([{
    role: 'model',
    text: '🧠 **QUANTUM AI — Neural Link Online** ⚡\n\nNagraj Bhai, Quantum Routing Engine active hai. Main Gemini, DeepSeek, aur Groq ko intelligently route karunga based on your query.\n\n**Active Modes:**\n• 🌐 Gemini: Real-time News & Live Data\n• 🧠 DeepSeek: Quant Analysis & Trim Rules\n• ⚡ Groq: Fast Concept Explanations\n\nKya analyze karna hai aaj?',
    timestamp: Date.now(),
    model: 'system'
  }]);
  const [chatInput, setChatInput] = useState('');
  const [isThinking, setIsThinking] = useState(false);
  const [showChat, setShowChat] = useState(false);
  const [marketIntel, setMarketIntel] = useState<MarketIntelligence | null>(null);
  const [copiedIdx, setCopiedIdx] = useState<number | null>(null);
  const [selectedModel, setSelectedModel] = useState<'auto' | 'gemini' | 'deepseek' | 'groq' | 'multi'>('auto');
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

  const copyToClipboard = useCallback((text: string, idx: number) => {
    navigator.clipboard.writeText(text).then(() => {
      setCopiedIdx(idx);
      setTimeout(() => setCopiedIdx(null), 2000);
    }).catch(() => {});
  }, []);

  const clearChat = useCallback(() => {
    setChatMessages([{
      role: 'model',
      text: '🧹 **Chat cleared! Quantum session reset.**\n\nReady for new analysis!',
      timestamp: Date.now(),
      model: 'system'
    }]);
  }, []);

  const callGemini = async (messages: any[], systemPrompt: string) => {
    const apiKey = import.meta.env.VITE_GEMINI_KEY || groqKey;
    if (!apiKey) throw new Error('Gemini API Key missing');

    const formattedMessages = [
      { role: 'system', parts: [{ text: systemPrompt }] },
      ...messages.map(m => ({
        role: m.role === 'assistant' ? 'model' : 'user',
        parts: [{ text: m.content }]
      }))
    ];

    const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-pro:generateContent?key=${apiKey}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ contents: formattedMessages })
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error?.message || `Gemini API Error: ${res.status}`);
    }

    const data = await res.json();
    return data.candidates?.[0]?.content?.parts?.[0]?.text || '';
  };

  const callDeepSeek = async (messages: any[], systemPrompt: string) => {
    const apiKey = import.meta.env.VITE_DEEPSEEK_KEY || groqKey;
    if (!apiKey) throw new Error('DeepSeek API Key missing');

    const formattedMessages = [
      { role: 'system', content: systemPrompt },
      ...messages.map(m => ({ role: m.role, content: m.content }))
    ];

    const res = await fetch('https://api.deepseek.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: 'deepseek-chat',
        messages: formattedMessages,
        temperature: 0.7,
        max_tokens: 1200
      })
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error?.message || `DeepSeek API Error: ${res.status}`);
    }

    const data = await res.json();
    return data.choices?.[0]?.message?.content || '';
  };

  const callGroq = async (messages: any[], systemPrompt: string) => {
    if (!groqKey) throw new Error('Groq API Key missing');

    const formattedMessages = [
      { role: 'system', content: systemPrompt },
      ...messages.map(m => ({ role: m.role, content: m.content }))
    ];

    const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${groqKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: 'llama-3.3-70b-versatile',
        messages: formattedMessages,
        temperature: 0.75,
        max_completion_tokens: 800
      })
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error?.message || `Groq API Error: ${res.status}`);
    }

    const data = await res.json();
    return data.choices?.[0]?.message?.content || '';
  };

  const sendMessage = async (userMessage: string) => {
    if (!userMessage.trim()) return;

    if (!groqKey) {
      setChatMessages(prev => [...prev,
        { role: 'user', text: userMessage, timestamp: Date.now() },
        { role: 'model', text: '⚠️ **Neural Link Offline**\n\nAPI Key missing. Settings (⚙️) check karo.', timestamp: Date.now(), model: 'system' }
      ]);
      return;
    }

    setChatMessages(prev => [...prev, { role: 'user', text: userMessage, timestamp: Date.now() }]);
    setIsThinking(true);

    try {
      const intent = detectIntent(userMessage);
      const finalModel = selectedModel === 'auto' ? intent.model : (selectedModel === 'multi' ? 'multi' : selectedModel as AIModel);
      const systemPrompt = `You are DEEP MIND AI — Quantum Trading Assistant. ${portfolioContext}`;

      const recentMessages = chatMessages.slice(-8).map(m => ({
        role: m.role === 'model' ? 'assistant' : m.role,
        content: m.text
      }));

      let aiText = '';
      let usedModel: AIModel = 'groq';

      // Route to appropriate AI based on intent or manual selection
      if (finalModel === 'gemini' || (finalModel === 'auto' && intent.model === 'gemini')) {
        aiText = await callGemini(recentMessages, systemPrompt);
        usedModel = 'gemini';
      } else if (finalModel === 'deepseek' || (finalModel === 'auto' && intent.model === 'deepseek')) {
        aiText = await callDeepSeek(recentMessages, systemPrompt);
        usedModel = 'deepseek';
      } else {
        aiText = await callGroq(recentMessages, systemPrompt);
        usedModel = 'groq';
      }

      setChatMessages(prev => [...prev, {
        role: 'model',
        text: aiText,
        timestamp: Date.now(),
        model: finalModel === 'auto' ? usedModel : (finalModel === 'multi' ? 'multi' : finalModel as AIModel)
      }]);
    } catch (e) {
      setChatMessages(prev => [...prev, { role: 'model', text: `❌ Error: ${e instanceof Error ? e.message : String(e)}`, timestamp: Date.now(), model: 'system' }]);
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
            className="fixed bottom-24 right-4 left-4 sm:left-auto sm:right-6 sm:w-[480px] h-[720px] max-h-[85vh] shadow-[0_0_50px_rgba(6,182,212,0.1)] z-[60] flex flex-col overflow-hidden"
          >
            <div className="absolute inset-0 bg-slate-950/90 backdrop-blur-xl border border-cyan-500/20 rounded-3xl" />

            <div className="relative p-4 border-b border-cyan-500/20 bg-gradient-to-r from-cyan-950/60 to-indigo-950/60 flex items-center justify-between rounded-t-3 la">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 bg-gradient-to-br from-cyan-800/60 to-indigo-900/60 border border-cyan-500/30 rounded-xl flex items-center justify-center">
                  <BrainCircuit className="text-cyan-400" size={20} />
                </div>
                <div>
                  <h3 className="text-sm font-black text-white uppercase tracking-tight flex items-center gap-1.5">
                    Quantum AI Assistant
                    <span className="text-[8px] bg-gradient-to-r from-cyan-500/20 to-indigo-500/20 text-cyan-300 px-1.5 py-0.5 rounded-md border border-cyan-500/20 font-bold tracking-wider">v6.0 ROUTER</span>
                  </h3>
                  <div className="text-[9px] font-bold text-emerald-400 uppercase tracking-widest flex items-center gap-1">
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                    Multi-AI Routing Active
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-1.5">
                <button onClick={clearChat} className="text-slate-500 hover:text-red-400 bg-white/5 rounded-full p-1.5 transition-colors"><Trash2 size={14} /></button>
                <button onClick={() => setShowChat(false)} className="text-slate-400 hover:text-white bg-white/5 rounded-full p-1.5 transition-colors"><X size={16} /></button>
              </div>
            </div>

            {/* Model Selector Bar */}
            <div className="relative px-4 py-3 bg-slate-900/40 border-b border-cyan-500/10 flex gap-2 overflow-x-auto scrollbar-hide">
              {(['auto', 'gemini', 'deepseek', 'groq', 'multi'] as const).map(m => (
                <button
                  key={m}
                  onClick={() => setSelectedModel(m)}
                  className={`px-3 py-1 rounded-full text-[10px] font-bold uppercase transition-all border ${selectedModel === m ? 'bg-cyan-600 text-white border-cyan-400 shadow-[0_0_10px_rgba(6,182,212,0.3)]' : 'bg-slate-800 text-slate-400 border-slate-700 hover:border-cyan-500/50'}`}
                >
                  {m === 'auto' ? 'Auto-Route' : m === 'multi' ? 'Multi-AI' : getModelLabel(m as AIModel).split(' ')[0]}
                </button>
              ))}
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
                        <div className={`inline-block px-2 py-0.5 rounded-md text-[9px] font-black uppercase mb-2 border ${MODEL_TAGS[msg.model || 'system']}`}>
                          {msg.model ? getModelLabel(msg.model) : 'Quantum System'}
                        </div>
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
                      <Sparkles size={12} className="animate-pulse" /> Routing to optimal AI...
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

            {/* Quick Actions Bar */}
            <div className="relative px-4 py-3 bg-slate-900/40 border-t border-cyan-500/10">
              <div className="flex gap-2 overflow-x-auto scrollbar-hide">
                {QUICK_ACTIONS.map((action, i) => (
                  <button
                    key={i}
                    onClick={() => { setChatInput(''); sendMessage(action.query); }}
                    disabled={isThinking}
                    className="flex items-center gap-1.5 whitespace-nowrap text-[10px] font-bold px-3 py-1.5 rounded-xl bg-white/[0.03] border border-white/10 text-slate-400 hover:text-white hover:border-cyan-500/50 hover:bg-cyan-500/5 transition-all disabled:opacity-30 shrink-0"
                  >
                    <span className="text-cyan-400">{action.icon}</span>
                    {action.label}
                  </button>
                ))}
              </div>
            </div>

            <div className="relative p-4 bg-slate-950/95 border-t border-cyan-500/15 rounded-b-3xl">
              <div className="relative flex items-center">
                <input
                  type="text"
                  placeholder="Ask Quantum AI anything..."
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
                <span className="text-[8px] text-slate-600 font-mono">Sensing: {selectedModel === 'auto' ? 'Auto-Route' : selectedModel.toUpperCase()}</span>
                <span className="text-[8px] text-slate-600">{chatMessages.length} neural pulses</span>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
});
