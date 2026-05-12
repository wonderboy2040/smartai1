// ============================================
// AI ROUTER — Smart Model Selection (Groq / Gemini / Claude)
// ============================================
// NOTE: This module is kept for backward compatibility.
// NeuralChat.tsx and ai-chat.mjs have their own built-in routers
// that are more advanced and context-aware. This is used only as
// a lightweight fallback reference.

export type AIModel = 'groq' | 'gemini' | 'claude';

export interface IntentResult {
  model: AIModel;
  confidence: number;
  routingInfo: string;
}

const MODEL_LABELS: Record<AIModel, string> = {
  gemini: '🔵 Gemini 2.5 Flash',
  claude: '🟣 Claude Sonnet 4',
  groq: '⚡ Groq Llama-3.3-70B',
};

const ROUTING_EXPLANATIONS: Record<AIModel, string> = {
  gemini: 'Real-time data ke liye Gemini',
  claude: 'Deep analysis ke liye Claude',
  groq: 'Quick response ke liye Groq',
};

export function detectIntent(prompt: string): IntentResult {
  const q = prompt.toLowerCase();

  // Crisis override → Gemini (real-time)
  if (/\b(crash|circuit|emergency|war|ban|halt|breaking)\b/i.test(q)) {
    return { model: 'gemini', confidence: 0.95, routingInfo: `${ROUTING_EXPLANATIONS.gemini} (Crisis Override)` };
  }

  // Quantitative / deep analysis → Claude
  if (/\b(calculate|monte carlo|sharpe|backtest|projection|fundamental|valuation|dcf|intrinsic|graham)\b/i.test(q)) {
    return { model: 'claude', confidence: 0.95, routingInfo: `${ROUTING_EXPLANATIONS.claude} (Quantitative Override)` };
  }

  // Market / live / news → Gemini
  if (/\b(news|market|live|aaj|today|nifty|sensex|breaking|crypto|bitcoin|btc|gold|crude|dollar|vix|sector|rally|crash|correction|fed|rbi|ipo|fii|dii)/.test(q)) {
    return { model: 'gemini', confidence: 0.85, routingInfo: ROUTING_EXPLANATIONS.gemini };
  }

  // Portfolio / strategy / analysis → Claude
  if (/\b(analy[sz]|portfolio|strategy|risk|allocation|rebalance|compare|optimize|deep|sip|wealth|retirement|fibonacci|wyckoff|smc|elliott|options?)/.test(q)) {
    return { model: 'claude', confidence: 0.85, routingInfo: ROUTING_EXPLANATIONS.claude };
  }

  // Short quick questions → Groq
  const wordCount = prompt.split(/\s+/).length;
  if (wordCount < 10) {
    return { model: 'groq', confidence: 0.7, routingInfo: `${ROUTING_EXPLANATIONS.groq} (Short query)` };
  }

  // Default → Groq (fastest)
  return { model: 'groq', confidence: 0.5, routingInfo: `${ROUTING_EXPLANATIONS.groq} (Default)` };
}

export function getModelLabel(model: AIModel): string {
  return MODEL_LABELS[model];
}
