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
  groqKey?: string;
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

export const NeuralChat = React.memo(({ groqKey: propGroqKey, geminiKey: propGeminiKey, deepseekKey: propDeepseekKey, portfolioContext, onTelegramPush }: NeuralChatProps) => {
  // Tavily Search API Configuration (Real-time Web Search - Gemini Replacement)
  const tavilyApiKey = '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';
  const tavilyBaseUrl = 'https://api.tavily.com/search';

  // NVIDIA API Configuration (DeepSeek V3 for Analysis)
  const nvidiaApiKey = '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';
  const nvidiaBaseUrl = 'https://integrate.api.nvidia.com/v1';
  const nvidiaDeepSeekModel = 'deepseek-ai/deepseek-v3.2';

  // Groq API Configuration (Fast Responses)
  const groqApiKey = propGroqKey || import.meta.env.VITE_GROQ_KEY || import.meta.env.VITE_GROQ_API_KEY || '';

  // Use environment variables as primary source, fallback to props
  const groqKey = groqApiKey;
  const geminiKey = tavilyApiKey; // Tavily replaces Gemini for real-time data
  const deepseekKey = propDeepseekKey || import.meta.env.VITE_DEEPSEEK_KEY || import.meta.env.VITE_DEEPSEEK_API_KEY || nvidiaApiKey;

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

  // Tavily Web Search (Real-time Data - Replaces Gemini)
  const searchTavily = async (query: string, days = 7) => {
    if (!tavilyApiKey) throw new Error('Tavily API Key missing');

    const res = await fetch(tavilyBaseUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        query: query,
        max_results: 5,
        days: days,
        include_domains: [],
        exclude_domains: []
      })
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error?.message || `Tavily API Error: ${res.status}`);
    }

    const data = await res.json();
    return data.results || [];
  };

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
    // Tavily Search for real-time data (replaces Gemini)
    const apiKey = tavilyApiKey || geminiKey;
    if (!apiKey) throw new Error('Tavily API Key missing');

    // Extract user query from messages
    const lastMessage = messages[messages.length - 1]?.content || '';

    // First, search the web for real-time data
    const searchResults = await searchTavily(lastMessage, 7);

    // Build context from search results
    let searchContext = '';
    if (searchResults.length > 0) {
      searchContext = '\n\n--- REAL-TIME WEB DATA (Tavily) ---\n';
      searchResults.forEach((result: any, i: number) => {
        searchContext += `${i + 1}. [${result.title || 'Result'}](${result.url || ''})\n   ${result.content}\n\n`;
      });
    }

    // Use DeepSeek via NVIDIA for final response with search context
    const formattedMessages = [
      { role: 'system', content: `${systemPrompt}\n\nUse the following real-time web data to answer the query accurately:${searchContext}` },
      ...messages.map(m => ({
        role: m.role === 'assistant' ? 'assistant' : 'user',
        content: m.content
      }))
    ];

    // NVIDIA DeepSeek for analysis
    const res = await fetch(`${nvidiaBaseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${nvidiaApiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: nvidiaDeepSeekModel,
        messages: formattedMessages,
        temperature: 0.7,
        max_tokens: 2048
      })
    });

    if (!res.ok) {
      let errMsg = `NVIDIA DeepSeek API Error: ${res.status}`;
      try {
        const errData = await res.json();
        errMsg = errData.error?.message || `NVIDIA DeepSeek API Error: ${res.status}`;
      } catch {}
      throw new Error(errMsg);
    }

    const data = await res.json();
    return data.choices?.[0]?.message?.content || '';
  };

  const callDeepSeek = async (messages: any[], systemPrompt: string) => {
    // Use NVIDIA API for DeepSeek V3 (best analysis)
    const apiKey = nvidiaApiKey || deepseekKey;
    if (!apiKey) throw new Error('DeepSeek/NVIDIA API Key missing');

    const formattedMessages = [
      { role: 'system', content: systemPrompt },
      ...messages.map(m => ({ role: m.role, content: m.content }))
    ];

    // NVIDIA OpenAI-compatible endpoint for DeepSeek V3
    const res = await fetch(`${nvidiaBaseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: nvidiaDeepSeekModel,
        messages: formattedMessages,
        temperature: 0.7,
        max_tokens: 2048
      })
    });

    if (!res.ok) {
      let errMsg = `NVIDIA DeepSeek V3 API Error: ${res.status}`;
      try {
        const errData = await res.json();
        errMsg = errData.error?.message || `NVIDIA DeepSeek V3 API Error: ${res.status}`;
      } catch {
        errMsg = `NVIDIA DeepSeek V3 API Error: ${res.status}`;
      }
      throw new Error(errMsg);
    }

    const data = await res.json();
    return data.choices?.[0]?.message?.content || '';
  };

  const callGroq = async (messages: any[], systemPrompt: string) => {
    const apiKey = groqKey;
    if (!apiKey) throw new Error('Groq API Key missing');

    const formattedMessages = [
      { role: 'system', content: systemPrompt },
      ...messages.map(m => ({ role: m.role, content: m.content }))
    ];

    // Groq Llama-3.3-70B for ultra-fast responses
    const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
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
      let errMsg = `Groq API Error: ${res.status}`;
      try {
        const errData = await res.json();
        errMsg = errData.error?.message || `Groq API Error: ${res.status}`;
      } catch {
        errMsg = `Groq API Error: ${res.status}`;
      }
      throw new Error(errMsg);
    }

    const data = await res.json();
    return data.choices?.[0]?.message?.content || '';
  };

  const sendMessage = async (userMessage: string) => {
    if (!userMessage.trim()) return;

    // Check if at least one AI key is available
    if (!groqKey && !geminiKey && !deepseekKey) {
      setChatMessages(prev => [...prev,
        { role: 'user', text: userMessage, timestamp: Date.now() },
        { role: 'model', text: '⚠️ **Neural Link Offline**\n\nAI keys not configured. Check environment variables.', timestamp: Date.now(), model: 'system' }
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
    // Tavily (real-time search) → DeepSeek V3 (analysis) → Groq (fast responses)
    if (finalModel === 'gemini' || (finalModel === 'auto' && intent.model === 'gemini')) {
      aiText = await callGemini(recentMessages, systemPrompt); // Tavily + DeepSeek
      usedModel = 'tavily';
    } else if (finalModel === 'deepseek' || (finalModel === 'auto' && intent.model === 'deepseek')) {
      aiText = await callDeepSeek(recentMessages, systemPrompt); // NVIDIA DeepSeek V3
      usedModel = 'deepseek';
    } else {
      aiText = await callGroq(recentMessages, systemPrompt); // Groq Llama-3
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
        className="fab fixed bottom-6 right-6 w-14 h-14 bg-gradient-to-br from-cyan-600/90 via-blue-800/90 to-indigo-900/90 rounded-2xl flex items-center justify-center border border-cyan-500/50 shadow-[0_0_30px_rgba(6,182,212,0.4)] z-[60] overflow-hidden group hover:scale-110 transition-transform sm:w-16 sm:h-16"
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
            className="fixed bottom-0 left-0 right-0 sm:bottom-24 sm:right-6 sm:w-[480px] h-[85vh] sm:h-[720px] max-h-[85vh] shadow-[0_0_50px_rgba(6,182,212,0.1)] z-[60] flex flex-col overflow-hidden sm:rounded-3xl"
          >
            <div className="absolute inset-0 bg-slate-950/90 backdrop-blur-xl border border-cyan-500/20 rounded-3xl" />

            <div className="relative p-3 sm:p-4 border-b border-cyan-500/20 bg-gradient-to-r from-cyan-950/60 to-indigo-950/60 flex items-center justify-between rounded-t-3xl">
              <div className="flex items-center gap-2 sm:gap-3">
                <div className="w-9 h-9 sm:w-10 sm:h-10 bg-gradient-to-br from-cyan-800/60 to-indigo-900/60 border border-cyan-500/30 rounded-xl flex items-center justify-center flex-shrink-0">
                  <BrainCircuit className="text-cyan-400" size={18} />
                </div>
                <div className="min-w-0">
                  <h3 className="text-xs sm:text-sm font-black text-white uppercase tracking-tight flex items-center gap-1">
                    <span className="hidden xs:inline">Quantum AI Assistant</span>
                    <span className="xs:hidden">Quantum AI</span>
                    <span className="text-[7px] sm:text-[8px] bg-gradient-to-r from-cyan-500/20 to-indigo-500/20 text-cyan-300 px-1 py-0.5 rounded-md border border-cyan-500/20 font-bold tracking-wider whitespace-nowrap">v6.0</span>
                  </h3>
                  <div className="text-[8px] sm:text-[9px] font-bold text-emerald-400 uppercase tracking-widest flex items-center gap-0.5">
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                    <span className="hidden sm:inline">Multi-AI Routing Active</span>
                    <span className="sm:hidden">Active</span>
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-1 sm:gap-1.5 flex-shrink-0">
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
              className="relative flex-1 overflow-y-auto p-3 sm:p-4 space-y-3 sm:space-y-4 scrollbar-hide"
            >
              {chatMessages.map((msg, i) => (
                <div key={i} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'} animate-message-in`}>
                  <div className={`max-w-[85%] sm:max-w-[90%] rounded-2xl text-[12px] sm:text-[13px] leading-relaxed whitespace-pre-line ${msg.role === 'user'
                    ? 'bg-gradient-to-br from-cyan-600/90 to-blue-700/90 text-white rounded-br-none border border-cyan-500/30 px-3 py-2.5 sm:px-4 sm:py-3'
                    : 'bg-slate-900/90 text-slate-200 rounded-tl-none border border-white/5 px-3 py-2.5 sm:px-4 sm:py-3 group/msg'
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

            <div className="relative p-3 sm:p-4 bg-slate-950/95 border-t border-cyan-500/15 rounded-b-3xl">
              <div className="relative flex items-center">
                <input
                  type="text"
                  placeholder="Ask Quantum AI..."
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
                <span className="text-[7px] sm:text-[8px] text-slate-600 font-mono truncate max-w-[60%]">Sensing: {selectedModel === 'auto' ? 'Auto-Route' : selectedModel.toUpperCase()}</span>
                <span className="text-[7px] sm:text-[8px] text-slate-600 flex-shrink-0">{chatMessages.length} pulses</span>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
});
