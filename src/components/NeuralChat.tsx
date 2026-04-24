import React, { useState, useRef, useEffect, useCallback } from 'react';
import { Send, BrainCircuit, X, Trash2, Copy, Check, Sparkles } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';

// AI Engine Configurations — Groq + Gemini + Claude (All FREE)
const CONFIG = {
  groq: {
    apiKey: import.meta.env.VITE_GROQ_API_KEY || '',
    baseUrl: 'https://api.groq.com/openai/v1/chat/completions',
    model: 'llama-3.3-70b-versatile'
  },
  gemini: {
    apiKey: import.meta.env.VITE_GEMINI_API_KEY || '',
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta/models',
    model: 'gemini-2.0-flash'
  },
  claude: {
    apiKey: import.meta.env.VITE_CLAUDE_API_KEY || '',
    baseUrl: 'https://api.anthropic.com/v1/messages',
    model: 'claude-sonnet-4-20250514'
  }
} as const;

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

export const NeuralChat = React.memo(({ groqKey: propGroqKey, portfolioContext, onTelegramPush }: NeuralChatProps) => {
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([{
    role: 'system',
    text: '🧠 **DEEP MIND AI — Pro Trading Assistant**\n\n**Active AI Engines:**\n⚡ **Groq Llama-3.3**: Ultra-fast responses\n🔵 **Google Gemini 2.0**: Real-time market intelligence\n🟣 **Claude Sonnet**: Deep analysis & strategies\n\nAsk anything about markets, portfolio, or trading!',
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
    }).catch(() => {});
  }, []);

  const clearChat = useCallback(() => {
    setChatMessages([{
      role: 'system',
      text: '🧹 **Chat cleared!**\n\nReady for new analysis!',
      timestamp: Date.now(),
      model: 'system'
    }]);
  }, []);

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
        max_completion_tokens: 1200
      })
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error?.message || `Groq API Error: ${res.status}`);
    }
    const data = await res.json();
    return data.choices?.[0]?.message?.content || '';
  };

  // ============ GEMINI API (Real-time Intelligence) ============
  const callGemini = async (messages: any[], systemPrompt: string) => {
    const apiKey = import.meta.env.VITE_GEMINI_API_KEY || CONFIG.gemini.apiKey;
    if (!apiKey || apiKey.length < 10) {
      throw new Error('Gemini API Key missing — Settings me set karo');
    }

    const contents = [
      { role: 'user', parts: [{ text: systemPrompt }] },
      { role: 'model', parts: [{ text: 'Understood. I am DEEP MIND AI Pro Trading Assistant. Ready for analysis.' }] },
      ...messages.map(m => ({
        role: m.role === 'assistant' ? 'model' : 'user',
        parts: [{ text: m.content }]
      }))
    ];

    const res = await fetch(`${CONFIG.gemini.baseUrl}/${CONFIG.gemini.model}:generateContent?key=${apiKey}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents,
        generationConfig: { temperature: 0.7, maxOutputTokens: 2048 }
      })
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error?.message || `Gemini API Error: ${res.status}`);
    }
    const data = await res.json();
    return data.candidates?.[0]?.content?.parts?.[0]?.text || '';
  };

  // ============ CLAUDE API (Deep Analysis) ============
  const callClaude = async (messages: any[], systemPrompt: string) => {
    const apiKey = import.meta.env.VITE_CLAUDE_API_KEY || CONFIG.claude.apiKey;
    if (!apiKey || apiKey.length < 10) {
      // Fallback to Gemini if Claude key missing
      console.warn('Claude key missing, falling back to Gemini');
      return await callGemini(messages, systemPrompt);
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
        max_tokens: 2048,
        system: systemPrompt,
        messages: messages.map(m => ({ role: m.role === 'assistant' ? 'assistant' : 'user', content: m.content }))
      })
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      // Fallback to Gemini on any Claude error
      console.warn('Claude API error, falling back to Gemini:', err);
      return await callGemini(messages, systemPrompt);
    }
    const data = await res.json();
    return data.content?.[0]?.text || '';
  };

  // ============ MAIN AI ROUTER ============
  const callAI = async (userMessage: string, model: string) => {
    const systemPrompt = `You are DEEP MIND AI — Elite Pro Trading Intelligence Assistant. You provide expert-level trading insights, real-time market analysis, detailed fundamentals, options strategies, and portfolio recommendations.

RULES:
1. Use Hinglish (Hindi + English mix) for Indian users
2. Reference actual portfolio data provided in context
3. Give specific actionable advice with exact levels (support, resistance, SL, TP)
4. Include conviction scores and risk-reward ratios
5. For market news, provide current trends and their impact
6. Be concise but comprehensive

PORTFOLIO CONTEXT:
${portfolioContext || 'No portfolio data available. Provide general market analysis.'}`;

    const recentMessages = chatMessages.slice(-6).map(m => ({
      role: m.role === 'model' || m.role === 'system' ? 'assistant' : 'user',
      content: m.text
    }));

    // Try primary model, fallback chain: Claude → Gemini → Groq
    if (model === 'claude') {
      try {
        const text = await callClaude(recentMessages, systemPrompt);
        return { text, model: 'claude' as const };
      } catch (e) {
        try {
          const text = await callGemini(recentMessages, systemPrompt);
          return { text, model: 'gemini' as const };
        } catch {
          const text = await callGroq(recentMessages, systemPrompt);
          return { text, model: 'groq' as const };
        }
      }
    }

    if (model === 'gemini') {
      try {
        const text = await callGemini(recentMessages, systemPrompt);
        return { text, model: 'gemini' as const };
      } catch (e) {
        const text = await callGroq(recentMessages, systemPrompt);
        return { text, model: 'groq' as const };
      }
    }

    // Groq (default/fast)
    try {
      const text = await callGroq(recentMessages, systemPrompt);
      return { text, model: 'groq' as const };
    } catch (e) {
      try {
        const text = await callGemini(recentMessages, systemPrompt);
        return { text, model: 'gemini' as const };
      } catch {
        return { text: `🤖 **AI Response:**\n\nSabhi AI engines temporarily unavailable. Please check API keys in .env file.`, model: 'groq' as const };
      }
    }
  };

  const sendMessage = async (userMessage: string) => {
    if (!userMessage.trim()) return;
    setIsThinking(true);
    
    setChatMessages(prev => [...prev, { role: 'user', text: userMessage, timestamp: Date.now() }]);

    try {
      const lowerQuery = userMessage.toLowerCase();
      let selectedModelType = selectedModel;
      
      if (selectedModel === 'auto') {
        if (lowerQuery.includes('news') || lowerQuery.includes('market') || lowerQuery.includes('nifty') || lowerQuery.includes('live') || lowerQuery.includes('aaj')) {
          selectedModelType = 'gemini';
        } else if (lowerQuery.includes('portfolio') || lowerQuery.includes('analyze') || lowerQuery.includes('strategy') || lowerQuery.includes('fundamental') || lowerQuery.includes('deep')) {
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
                    <span className="text-[7px] sm:text-[8px] bg-gradient-to-r from-cyan-500/20 to-indigo-500/20 text-cyan-300 px-1 py-0.5 rounded-md border border-cyan-500/20 font-bold tracking-wider whitespace-nowrap">v8.0</span>
                  </h3>
                  <div className="text-[8px] sm:text-[9px] font-bold text-emerald-400 uppercase tracking-widest flex items-center gap-0.5">
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                    <span className="hidden sm:inline">Groq + Gemini + Claude</span>
                    <span className="sm:hidden">Online</span>
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
                  className={`px-2 sm:px-3 py-1 rounded-full text-[9px] sm:text-[10px] font-bold uppercase transition-all border whitespace-nowrap ${
                    selectedModel === m
                      ? 'bg-cyan-600 text-white border-cyan-400 shadow-[0_0_10px_rgba(6,182,212,0.3)]'
                      : 'bg-slate-800 text-slate-400 border-slate-700 hover:border-cyan-500/50'
                  }`}
                >
                  {m === 'auto' ? '🤖 Auto' : m === 'groq' ? '⚡ Groq' : m === 'gemini' ? '🔵 Gemini' : '🟣 Claude'}
                </button>
              ))}
            </div>

            {/* Messages */}
            <div ref={chatContainerRef} className="relative flex-1 overflow-y-auto p-3 sm:p-4 space-y-3 sm:space-y-4 scrollbar-hide">
              {chatMessages.map((msg, i) => (
                <div key={i} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'} animate-message-in`}>
                  <div className={`max-w-[85%] sm:max-w-[90%] rounded-2xl text-[12px] sm:text-[13px] leading-relaxed whitespace-pre-line ${
                    msg.role === 'user'
                      ? 'bg-gradient-to-br from-cyan-600/90 to-blue-700/90 text-white rounded-br-none border border-cyan-500/30 px-3 py-2.5 sm:px-4 sm:py-3'
                      : 'bg-slate-900/90 text-slate-200 rounded-tl-none border border-white/5 px-3 py-2.5 sm:px-4 sm:py-3 group/msg'
                  }`}>
                    {msg.role === 'user' ? msg.text : (
                      <>
                        {msg.model && (
                          <div className={`inline-block px-2 py-0.5 rounded-md text-[9px] font-black uppercase mb-2 border ${MODEL_COLORS[msg.model] || MODEL_COLORS.system}`}>
                            {msg.model === 'groq' ? '⚡ Groq' : msg.model === 'gemini' ? '🔵 Gemini' : msg.model === 'claude' ? '🟣 Claude' : 'System'}
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
                  Model: {selectedModel === 'auto' ? '🤖 Auto-Detect' : selectedModel === 'groq' ? '⚡ Groq' : selectedModel === 'gemini' ? '🔵 Gemini' : '🟣 Claude'}
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
