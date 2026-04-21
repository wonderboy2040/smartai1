import { Position } from '../types';

export type AIModel = 'gemini' | 'deepseek' | 'groq';

export interface IntentResult {
  model: AIModel;
  confidence: number;
  routingInfo: string;
}

const INTENT_PATTERNS: Record<AIModel, RegExp[]> = {
  gemini: [
    /\b(today|aaj|abhi|now|current|live|latest|breaking)\b/i,
    /\b(price|keemat|rate|level|value)\b/i,
    /\b(news|khabar|update|alert|announcement)\b/i,
    /\b(market|bazaar|bazar|indices|index)\b/i,
    /\b(open|close|volume|trading|session)\b/i,
    /\b(nifty|sensex|nasdaq|dow|s&p|spy)\b/i,
    /\b(fii|dii|foreign|institutional|flows)\b/i,
    /\b(crude|oil|gold|silver|commodity)\b/i,
    /\b(dollar|rupee|forex|currency|usd|inr)\b/i,
    /\b(fed|rbi|rate|policy|meeting|minutes)\b/i,
    /\b(earnings|result|quarterly|guidance)\b/i,
    /\b(ipo|listing|merger|acquisition)\b/i,
    /\b(global|world|international|geopolitical)\b/i,
    /\b(sector|performance|weekly|monthly)\b/i,
    /\b(smh|qqqm|xlk|momomentum|smallcap|mid150|juniorbees)\b/i,
    /\b(nvidia|apple|microsoft|broadcom|amd|tsmc)\b/i,
    /\b(inflation|gdp|unemployment|economic|data)\b/i,
    /\b(bull|bear|rally|crash|correction|dip)\b/i,
    /\b(support|resistance|breakout|breakdown)\b/i,
    /\b(what is happening|kya ho raha|market me kya)\b/i,
  ],
  deepseek: [
    /\b(analyze|analysis|analyse|analytic)\b/i,
    /\b(portfolio|holdings|allocation|weight)\b/i,
    /\b(cagr|return|compound|compounding|growth)\b/i,
    /\b(risk|drawdown|volatility|variance|deviation)\b/i,
    /\b(rebalance|rebalancing|trim|trimming|overweight)\b/i,
    /\b(factor|momentum|quality|value|size|growth)\b/i,
    /\b(sharpe|sortino|ratio|metric|measure)\b/i,
    /\b(backtest|historical|simulation|monte carlo)\b/i,
    /\b(correlation|overlap|diversification|exposure)\b/i,
    /\b(calculate|computation|math|formula|projection)\b/i,
    /\b(optimize|optimization|best allocation|strategy)\b/i,
    /\b(long term|longterm|15 year|20 year|decade)\b/i,
    /\b(wealth|corpus|retirement|financial freedom)\b/i,
    /\b(sip|systematic|investment|plan|schedule)\b/i,
    /\b(tax|ltcg|stcg|taxation|indexation)\b/i,
    /\b(should i|kya karu|kitna lagau|recommend)\b/i,
    /\b(compare|comparison|vs|versus|better|best)\b/i,
    /\b(expected|probability|scenario|forecast|project)\b/i,
    /\b(momomentum|smallcap|mid150|juniorbees|smh|qqqm|xlk)\b/i,
    /\b(deep|detailed|comprehensive|complete|full)\b/i,
  ],
  groq: [
    /\b(what is|kya hai|define|meaning|matlab|explain)\b/i,
    /\b(quick|fast|brief|short|simple|basic)\b/i,
    /\b(concept|terminology|term|word|definition)\b/i,
    /\b(how does|kaise kaam|how to|kaise)\b/i,
    /\b(difference|difference between|alag|same)\b/i,
    /\b(example|examples|udaharan|jaise)\b/i,
    /\b(yes or no|haan ya na|simple answer)\b/i,
    /\b(tell me|batao|samjhao|bolo)\b/i,
  ],
};

const MODEL_LABELS: Record<AIModel, string> = {
  gemini: '🌐 Gemini 1.5 Pro',
  deepseek: '🧠 DeepSeek V3',
  groq: '⚡ Groq Llama-3.3-70B',
};

const ROUTING_EXPLANATIONS: Record<AIModel, string> = {
  gemini: 'Real-time data ke liye Gemini',
  deepseek: 'Deep analysis ke liye DeepSeek',
  groq: 'Quick response ke liye Groq',
};

export function detectIntent(prompt: string): IntentResult {
  const lowerPrompt = prompt.toLowerCase();

  // High Priority Overrides
  if (/\b(crash|circuit|emergency|war|ban|halt)\b/i.test(lowerPrompt)) {
    return {
      model: 'gemini',
      confidence: 0.95,
      routingInfo: `${ROUTING_EXPLANATIONS.gemini} (Crisis Override)`
    };
  }
  if (/\b(calculate|monte carlo|sharpe|backtest|projection)\b/i.test(lowerPrompt)) {
    return {
      model: 'deepseek',
      confidence: 0.95,
      routingInfo: `${ROUTING_EXPLANATIONS.deepseek} (Quantitative Override)`
    };
  }

  const scores: Record<AIModel, number> = { gemini: 0, deepseek: 0, groq: 0 };

  // Keyword Scoring
  for (const [model, patterns] of Object.entries(INTENT_PATTERNS)) {
    patterns.forEach(pattern => {
      if (pattern.test(lowerPrompt)) scores[model as AIModel]++;
    });
  }

  // Heuristics
  const wordCount = prompt.split(/\s+/).length;
  if (wordCount > 20) scores.deepseek += 2;
  if (wordCount < 8) scores.groq += 1;

  const bestModel = (Object.keys(scores) as AIModel[]).reduce((a, b) => scores[a] > scores[b] ? a : b);
  const bestScore = scores[bestModel];

  if (bestScore === 0) {
    return {
      model: 'groq',
      confidence: 0.5,
      routingInfo: `${ROUTING_EXPLANATIONS.groq} (Fallback)`
    };
  }

  const confidence = Math.min(bestScore / 5, 1.0);

  return {
    model: bestModel,
    confidence,
    routingInfo: `${ROUTING_EXPLANATIONS[bestModel]} (Confidence: ${Math.round(confidence * 100)}%)`,
  };
}

export function getModelLabel(model: AIModel): string {
  return MODEL_LABELS[model];
}
