import React, { useState, useRef, useEffect, useCallback } from 'react';
import { MessageSquare, Send, BrainCircuit, X, Volume2 } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { GoogleGenAI, Modality } from "@google/genai";

interface ChatMessage {
  role: 'user' | 'model';
  text: string;
}

export interface NeuralChatProps {
  geminiKey: string;
  portfolioContext: string;
}

export const NeuralChat = React.memo(({ geminiKey, portfolioContext }: NeuralChatProps) => {
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([{
    role: 'model',
    text: '🤖 **System Online: Quantum Neural Core Active**\n\nNagraj Bhai, main piche background me USA aur India dono markets track kar raha hu. Live VIX, RSI aur Institutional MACD data meri system me fed hai.\n\nPucho kya analyse karna hai ("Market kaisa hai?", "Kisme invest karu?", ya phir "Mera portfolio kaisa hai?").'
  }]);
  const [chatInput, setChatInput] = useState('');
  const [isThinking, setIsThinking] = useState(false);
  const [showChat, setShowChat] = useState(false);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const scrollToBottom = useCallback(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, []);

  useEffect(() => {
    if (showChat) scrollToBottom();
  }, [chatMessages, showChat, scrollToBottom]);

  const speakText = async (text: string) => {
    if (!text || !geminiKey) return;
    setIsSpeaking(true);
    try {
      const ai = new GoogleGenAI({ apiKey: geminiKey });
      const response = await ai.models.generateContent({
        model: "gemini-2.5-flash-preview-tts",
        contents: [{ parts: [{ text: `Say in a professional, slightly robotic AI voice: ${text.replace(/[*_]/g, '')}` }] }],
        config: {
          responseModalities: [Modality.AUDIO],
          speechConfig: {
            voiceConfig: { prebuiltVoiceConfig: { voiceName: 'Fenrir' } }
          }
        }
      });

      const base64Audio = response.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
      if (base64Audio) {
        const binaryString = window.atob(base64Audio);
        const len = binaryString.length;
        const bytes = new Uint8Array(len);
        for (let i = 0; i < len; i++) bytes[i] = binaryString.charCodeAt(i);
        
        const int16Array = new Int16Array(bytes.buffer);
        const audioContext = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 24000 });
        const audioBuffer = audioContext.createBuffer(1, int16Array.length, 24000);
        const channelData = audioBuffer.getChannelData(0);
        for (let i = 0; i < int16Array.length; i++) channelData[i] = int16Array[i] / 32768.0;
        
        const source = audioContext.createBufferSource();
        source.buffer = audioBuffer;
        source.connect(audioContext.destination);
        source.start();
        source.onended = () => setIsSpeaking(false);
      }
    } catch (e) {
      console.error("TTS Error:", e);
      setIsSpeaking(false);
    }
  };

  const handleChat = async () => {
    if (!chatInput.trim()) return;

    if (!geminiKey) {
      const prompt = chatInput;
      setChatInput('');
      setChatMessages(prev => [...prev, { role: 'user', text: prompt }]);
      setChatMessages(prev => [...prev, { role: 'model', text: "Neural Link Offline: Top Bar pe settings icon click karke GEMINI API KEY dalo pehle." }]);
      return;
    }

    const prompt = chatInput;
    setChatInput('');
    setChatMessages(prev => [...prev, { role: 'user', text: prompt }]);
    setIsThinking(true);

    try {
      const ai = new GoogleGenAI({ apiKey: geminiKey });
      const modelName = "gemini-1.5-flash";
      
      const formattedContents: any[] = [];
      let expectedRole = 'user';
      const recentMessages = [...chatMessages.slice(-5), { role: 'user', text: prompt }];
      
      for (const msg of recentMessages) {
        const role = msg.role === 'model' ? 'model' : 'user';
        if (role === expectedRole) {
          formattedContents.push({ role, parts: [{ text: msg.text }] });
          expectedRole = role === 'user' ? 'model' : 'user';
        } else if (formattedContents.length > 0) {
          formattedContents[formattedContents.length - 1].parts[0].text += '\n\n' + msg.text;
        } else if (role === 'model') {
          continue;
        }
      }

      const sysInstruction = `You are the Deep Mind AI Market Insider. You are talking to "Nagraj Bhai".
You MUST speak natively in heavily mixed Hinglish, similar to a highly experienced professional Indian Dalal street institutional trader. 
Use markdown formatting (bolding, lists, emojis).
Be extremely precise with market insights. Use real-time data to justify your responses. 

--- CRITICAL REAL-TIME PORTFOLIO & LIVE MARKET INJECTION: ---
${portfolioContext}
--- END CONTEXT ---

The user has provided the above hidden prompt to give you exact visibility into their holding metrics, P&L, MACD/RSI indicators, and live prices of IN & US assets. If they ask "kisme invest karu?" or "kisko sell karu?", scan this context immediately to provide accurate advice, noting oversold RSIs or Bearish MACDs respectively.
If asked about general news, rely on your tools.`;

      const response = await ai.models.generateContent({
        model: modelName,
        contents: formattedContents,
        config: {
          systemInstruction: sysInstruction,
          tools: [{ googleSearch: {} }]
        }
      });

      const aiText = response.text || "Neural link unstable. Please retry.";
      setChatMessages(prev => [...prev, { role: 'model', text: aiText }]);
    } catch (e) {
      console.error("Gemini Error:", e);
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
                    {msg.role === 'model' && (
                      <button 
                        onClick={() => speakText(msg.text)}
                        className="mt-3 flex items-center gap-1.5 text-xs font-semibold text-cyan-400 hover:text-cyan-300 bg-cyan-950/50 w-fit px-2.5 py-1.5 rounded-lg border border-cyan-500/20 transition-colors"
                        disabled={isSpeaking}
                      >
                        <Volume2 size={14} className={isSpeaking ? "animate-pulse" : ""} />
                        {isSpeaking ? 'SPEAKING...' : 'PLAY AUDIO'}
                      </button>
                    )}
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
