import React, { useState, useRef, useEffect, useCallback } from 'react';
import { Send, BrainCircuit, X, Trash2, Copy, Check, Sparkles } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';

// API Configurations from Environment Variables
const CONFIG = {
// Tavily Search API (Real-time Web Data)
tavily: {
apiKey: import.meta.env.VITE_TAVILY_API_KEY || 'tvly-dev-1Ck5et_vJzTUOAaAJVAakimgoGhHhiWTBvT7THrA9rU7SU7CO',
baseUrl: 'https://api.tavily.com/search'
},
// NVIDIA API (DeepSeek V3 for Analysis)
nvidia: {
apiKey: import.meta.env.VITE_NVIDIA_API_KEY || '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',
baseUrl: import.meta.env.VITE_NVIDIA_BASE_URL || 'https://integrate.api.nvidia.com/v1',
model: import.meta.env.VITE_NVIDIA_MODEL || 'deepseek-ai/deepseek-v3.2'
},
// Groq API (Fast Responses)
groq: {
apiKey: import.meta.env.VITE_GROQ_API_KEY || 'gsk_7rTlR1JQwJzQ8vP9mK2LWGzy',
baseUrl: 'https://api.groq.com/openai/v1/chat/completions',
model: 'llama-3.3-70b-versatile'
}
} as const;

interface ChatMessage {
  role: 'user' | 'model' | 'system';
  text: string;
  timestamp: number;
  model?: 'tavily' | 'deepseek' | 'groq' | 'system';
  sources?: Array<{ title: string; url: string }>;
}

const QUICK_ACTIONS = [
  { label: 'Market News', query: 'Latest market news and analysis', icon: '📰', type: 'tavily' },
  { label: 'Portfolio Analysis', query: 'Analyze my portfolio and give recommendations', icon: '📊', type: 'deepseek' },
  { label: 'Quick Question', query: 'Explain RSI indicator', icon: '⚡', type: 'groq' },
  { label: 'Nifty Analysis', query: 'Nifty 50 technical analysis with support resistance', icon: '📈', type: 'tavily' }
];

const MODEL_COLORS = {
  tavily: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20',
  deepseek: 'bg-purple-500/10 text-purple-400 border-purple-500/20',
  groq: 'bg-orange-500/10 text-orange-400 border-orange-500/20',
  system: 'bg-slate-500/10 text-slate-400 border-slate-500/20'
};

export interface NeuralChatProps {
  groqKey?: string;
  geminiKey?: string;
  deepseekKey?: string;
  portfolioContext: string;
  onTelegramPush?: () => void;
}

export const NeuralChat = React.memo(({ groqKey: propGroqKey, portfolioContext, onTelegramPush }: NeuralChatProps) => {
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([{
    role: 'system',
    text: '🧠 **DEEP MIND AI — Quantum Trading Assistant**\n\n**Active AI Engines:**\n🔍 **Tavily Search**: Real-time web & market data\n🧠 **DeepSeek V3**: Advanced portfolio analysis (via NVIDIA)\n⚡ **Groq Llama-3**: Ultra-fast responses\n\nAsk anything about markets, portfolio, or trading!',
    timestamp: Date.now(),
    model: 'system'
  }]);
  
  const [chatInput, setChatInput] = useState('');
  const [isThinking, setIsThinking] = useState(false);
  const [showChat, setShowChat] = useState(false);
  const [copiedIdx, setCopiedIdx] = useState<number | null>(null);
  const [selectedModel, setSelectedModel] = useState<'auto' | 'tavily' | 'deepseek' | 'groq'>('auto');
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const chatContainerRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to bottom
  const scrollToBottom = useCallback(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, []);

  useEffect(() => {
    if (showChat) scrollToBottom();
  }, [chatMessages, showChat, scrollToBottom]);

  // Copy to clipboard
  const copyToClipboard = useCallback((text: string, idx: number) => {
    navigator.clipboard.writeText(text).then(() => {
      setCopiedIdx(idx);
      setTimeout(() => setCopiedIdx(null), 2000);
    }).catch(() => {});
  }, []);

  // Clear chat
  const clearChat = useCallback(() => {
    setChatMessages([{
      role: 'system',
      text: '🧹 **Chat cleared!**\n\nReady for new analysis!',
      timestamp: Date.now(),
      model: 'system'
    }]);
  }, []);

// Tavily Search (Real-time Web Data)
const searchTavily = async (query: string, days = 7) => {
  try {
    // Validate API key
    const apiKey = import.meta.env.VITE_TAVILY_API_KEY || CONFIG.tavily.apiKey;
    if (!apiKey || apiKey === 'tvly-dev-1Ck5et_vJzTUOAaAJVAakimgoGhHhiWTBvT7THrA9rU7SU7CO') {
      console.warn('Tavily API key not configured properly');
      return [];
    }

    const res = await fetch(CONFIG.tavily.baseUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        query: query,
        max_results: 5,
        days: days,
        search_depth: 'advanced',
        include_answer: true,
        include_images: false,
        include_raw_content: false
      })
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error?.message || `Tavily API Error: ${res.status}`);
    }

    const data = await res.json();
    return data.results || [];
  } catch (error) {
    console.error('Tavily Search Error:', error);
    return [];
  }
};

// NVIDIA DeepSeek V3 (Analysis)
const callDeepSeek = async (messages: any[], systemPrompt: string) => {
  try {
    // Validate API key
    const apiKey = import.meta.env.VITE_NVIDIA_API_KEY || CONFIG.nvidia.apiKey;
    if (!apiKey || !apiKey.startsWith('nvapi-')) {
      throw new Error('NVIDIA API key not configured');
    }

    const formattedMessages = [
      { role: 'system', content: systemPrompt },
      ...messages.map(m => ({ role: m.role, content: m.content }))
    ];

    // Use NVIDIA NIM API endpoint for DeepSeek
    const res = await fetch(`${CONFIG.nvidia.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        'Accept': 'application/json'
      },
      body: JSON.stringify({
        model: 'deepseek-ai/deepseek-r1',
        messages: formattedMessages,
        temperature: 0.6,
        max_tokens: 2048,
        top_p: 0.9,
        stream: false
      })
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      console.error('NVIDIA API Error:', res.status, err);
      throw new Error(err.error?.message || `NVIDIA DeepSeek API Error: ${res.status}`);
    }

    const data = await res.json();
    return data.choices?.[0]?.message?.content || '';
  } catch (error) {
    console.error('DeepSeek Error:', error);
    return "DeepSeek API currently unavailable. Using fallback analysis...";
  }
};

// Groq (Fast Responses)
const callGroq = async (messages: any[], systemPrompt: string) => {
  try {
    // Get API key from environment or props - check all possible sources
    const envKey = import.meta.env.VITE_GROQ_API_KEY;
    const apiKey = envKey || propGroqKey || CONFIG.groq.apiKey;

    if (!apiKey || !apiKey.startsWith('gsk_')) {
      console.error('Groq API Key missing or invalid. Key starts with:', apiKey ? apiKey.substring(0, 10) : 'undefined');
      throw new Error('Groq API Key missing or invalid');
    }

    const formattedMessages = [
      { role: 'system', content: systemPrompt },
      ...messages.map(m => ({ role: m.role, content: m.content }))
    ];

    const res = await fetch(CONFIG.groq.baseUrl, {
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
      const err = await res.json().catch(() => ({}));
      console.error('Groq API Error:', res.status, err);
      throw new Error(err.error?.message || `Groq API Error: ${res.status}`);
    }

    const data = await res.json();
    return data.choices?.[0]?.message?.content || '';
  } catch (error) {
    console.error('Groq Error:', error);
    return "🤖 Groq API unavailable. Please check your API key in environment variables.";
  }
};

// Main AI routing with Tavily + DeepSeek combination
const callAI = async (userMessage: string, model: string) => {
const systemPrompt = `You are DEEP MIND AI — Quantum Trading Assistant. Provide expert-level trading insights, market analysis, and portfolio recommendations. Use Hinglish (Hindi + English) for Indian users. Be concise but informative.`;

const recentMessages = chatMessages.slice(-6).map(m => ({
role: m.role === 'model' || m.role === 'system' ? 'assistant' : 'user',
content: m.text
}));

// Tavily + DeepSeek combination for real-time queries
if (model === 'tavily' || model === 'auto') {
try {
// Step 1: Search web for real-time data
const searchResults = await searchTavily(userMessage, 7);

let searchContext = '';
if (searchResults.length > 0) {
searchContext = '\n\n--- REAL-TIME WEB DATA (Tavily Search) ---\n';
searchResults.forEach((result: any, i: number) => {
searchContext += `${i + 1}. **${result.title || 'Result'}**\n ${result.content}\n Source: ${result.url || 'Web'}\n\n`;
});
}

// Step 2: Use DeepSeek V3 for analysis with search context
const fullSystemPrompt = `${systemPrompt}\n\nUse the following real-time web data to provide accurate, up-to-date answers:${searchContext}`;
const aiText = await callDeepSeek(recentMessages, fullSystemPrompt);

return {
text: aiText,
model: 'deepseek' as const,
sources: searchResults.map((r: any) => ({ title: r.title, url: r.url }))
};
} catch (error) {
// Fallback to Groq if Tavily/DeepSeek fails
console.log('Tavily/DeepSeek failed, using Groq fallback');
try {
const aiText = await callGroq(recentMessages, systemPrompt);
return { text: aiText, model: 'groq' as const };
} catch (groqError) {
// If both fail, return a helpful fallback message
return { text: `🤖 **AI Response:**\n\nMarket data analyze karne me temporary issue aa raha hai. Aapka query: "${userMessage}"\n\nRetry karein ya specific asset puchein.`, model: 'groq' as const };
}
}
}

// Direct DeepSeek for analysis
if (model === 'deepseek') {
try {
const aiText = await callDeepSeek(recentMessages, systemPrompt);
return { text: aiText, model: 'deepseek' as const };
} catch (error) {
// Fallback to Groq
const aiText = await callGroq(recentMessages, systemPrompt);
return { text: aiText, model: 'groq' as const };
}
}

// Groq for fast responses
if (model === 'groq') {
const aiText = await callGroq(recentMessages, systemPrompt);
return { text: aiText, model: 'groq' as const };
}

throw new Error('Invalid model selected');
};

  // Send message handler
  const sendMessage = async (userMessage: string) => {
    if (!userMessage.trim()) return;

    setIsThinking(true);
    
    // Add user message
    setChatMessages(prev => [...prev, {
      role: 'user',
      text: userMessage,
      timestamp: Date.now()
    }]);

    try {
      // Detect intent or use selected model
      const lowerQuery = userMessage.toLowerCase();
      let selectedModelType = selectedModel;
      
      if (selectedModel === 'auto') {
        if (lowerQuery.includes('news') || lowerQuery.includes('market') || lowerQuery.includes('nifty') || lowerQuery.includes('analysis')) {
          selectedModelType = 'tavily';
        } else if (lowerQuery.includes('portfolio') || lowerQuery.includes('analyze') || lowerQuery.includes('calculate')) {
          selectedModelType = 'deepseek';
        } else {
          selectedModelType = 'groq';
        }
      }

      // Call AI with selected model
      const result = await callAI(userMessage, selectedModelType);

      setChatMessages(prev => [...prev, {
        role: 'model',
        text: result.text,
        timestamp: Date.now(),
        model: result.model,
        sources: result.sources
      } as ChatMessage]);
} catch (error) {
const errorMsg = error instanceof Error ? error.message : 'Unknown error';
// Check if it's a network error vs API key error
const isAuthError = errorMsg.toLowerCase().includes('auth') || errorMsg.toLowerCase().includes('key');
const helpfulMsg = isAuthError
? `🔑 **API Key Issue:** ${errorMsg}\n\nSettings panel me API key check karein.`
: `⚠️ **AI Response:** ${errorMsg}\n\nNetwork check karein ya retry karein.`;

setChatMessages(prev => [...prev, {
role: 'system',
text: `❌ ${helpfulMsg}`,
timestamp: Date.now(),
model: 'system'
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
                    <span className="text-[7px] sm:text-[8px] bg-gradient-to-r from-cyan-500/20 to-indigo-500/20 text-cyan-300 px-1 py-0.5 rounded-md border border-cyan-500/20 font-bold tracking-wider whitespace-nowrap">v7.0</span>
                  </h3>
                  <div className="text-[8px] sm:text-[9px] font-bold text-emerald-400 uppercase tracking-widest flex items-center gap-0.5">
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                    <span className="hidden sm:inline">Tavily + DeepSeek V3 + Groq</span>
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
              {(['auto', 'tavily', 'deepseek', 'groq'] as const).map(m => (
                <button
                  key={m}
                  onClick={() => setSelectedModel(m)}
                  className={`px-2 sm:px-3 py-1 rounded-full text-[9px] sm:text-[10px] font-bold uppercase transition-all border whitespace-nowrap ${
                    selectedModel === m
                      ? 'bg-cyan-600 text-white border-cyan-400 shadow-[0_0_10px_rgba(6,182,212,0.3)]'
                      : 'bg-slate-800 text-slate-400 border-slate-700 hover:border-cyan-500/50'
                  }`}
                >
                  {m === 'auto' ? 'Auto-Detect' : m === 'tavily' ? 'Tavily+AI' : m === 'deepseek' ? 'DeepSeek V3' : 'Groq Fast'}
                </button>
              ))}
            </div>

            {/* Messages */}
            <div
              ref={chatContainerRef}
              className="relative flex-1 overflow-y-auto p-3 sm:p-4 space-y-3 sm:space-y-4 scrollbar-hide"
            >
              {chatMessages.map((msg, i) => (
                <div key={i} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'} animate-message-in`}>
                  <div className={`max-w-[85%] sm:max-w-[90%] rounded-2xl text-[12px] sm:text-[13px] leading-relaxed whitespace-pre-line ${
                    msg.role === 'user'
                      ? 'bg-gradient-to-br from-cyan-600/90 to-blue-700/90 text-white rounded-br-none border border-cyan-500/30 px-3 py-2.5 sm:px-4 sm:py-3'
                      : 'bg-slate-900/90 text-slate-200 rounded-tl-none border border-white/5 px-3 py-2.5 sm:px-4 sm:py-3 group/msg'
                  }`}>
                    {msg.role === 'user' ? (
                      msg.text
                    ) : (
                      <>
                        {msg.model && (
                          <div className={`inline-block px-2 py-0.5 rounded-md text-[9px] font-black uppercase mb-2 border ${MODEL_COLORS[msg.model] || MODEL_COLORS.system}`}>
                            {msg.model === 'tavily' ? 'Tavily Search' : msg.model === 'deepseek' ? 'DeepSeek V3' : msg.model === 'groq' ? 'Groq' : 'System'}
                          </div>
                        )}
                        <span dangerouslySetInnerHTML={{ 
                          __html: msg.text
                            .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
                            .replace(/\*(.+?)\*/g, '<em>$1</em>')
                            .replace(/`(.+?)`/g, '<code style="background:rgba(6,182,212,0.15);padding:1px 5px;border-radius:4px;font-size:0.85em">$1</code>')
                        }} />
                        
                        {msg.sources && msg.sources.length > 0 && (
                          <div className="mt-3 pt-2 border-t border-cyan-500/20">
                            <div className="text-[9px] font-bold text-cyan-400 mb-1">Sources:</div>
                            {msg.sources.slice(0, 3).map((source, idx) => (
                              <a
                                key={idx}
                                href={source.url}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="block text-[9px] text-slate-400 hover:text-cyan-400 truncate mb-0.5"
                              >
                                🔗 {source.title}
                              </a>
                            ))}
                          </div>
                        )}
                        
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
                  Model: {selectedModel === 'auto' ? 'Auto-Detect' : selectedModel.toUpperCase()}
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
