// ============================================
// MULTI-AI CONSENSUS ENGINE — GROQ + GEMINI + CLAUDE
// Deep Quantum Trade Analysis | 24/7 Scanning
// Daily Profit ₹500-₹1000 Optimization
// ============================================

import { FuturesTradeSignal } from '../types';

const GROQ_API_KEY = import.meta.env.VITE_GROQ_API_KEY || '';
const GEMINI_API_KEY = import.meta.env.VITE_GEMINI_API_KEY || '';
const CLAUDE_API_KEY = import.meta.env.VITE_CLAUDE_API_KEY || '';

// ========== GROQ (Llama 3.3 70B — Ultra Fast) ==========
export async function getGroqTradeAnalysis(
  signals: FuturesTradeSignal[],
  top: number = 8
): Promise<Record<string, { analysis: string; direction: 'LONG' | 'SHORT' | 'SKIP'; conviction: number }>> {
  if (!GROQ_API_KEY || GROQ_API_KEY.length < 10) return {};

  const topSignals = signals.slice(0, top);
  const summary = topSignals.map((s, i) =>
    `${i + 1}. ${s.symbol} (${s.market}) | Price: $${s.currentPrice.toFixed(2)} | ${s.change >= 0 ? '+' : ''}${s.change.toFixed(2)}% | RSI: ${s.rsi.toFixed(0)} | MACD: ${s.macd.toFixed(3)} | SMA20: ${s.sma20.toFixed(2)} | SMA50: ${s.sma50.toFixed(2)} | Vol: ${(s.volume / 1e6).toFixed(1)}M | ATR: ${s.atr.toFixed(2)} | StochRSI: ${s.stochRsi?.toFixed(0) || 'N/A'} | ADX: ${s.adx?.toFixed(0) || 'N/A'} | Ichimoku: ${s.ichimokuSignal || 'N/A'} | Supertrend: ${s.supertrend || 'N/A'} | R:R ${s.riskReward}:1 | AI Score: ${s.aiScore}/100 | Entry: $${s.entryPrice.toFixed(2)} | SL: $${s.stopLoss.toFixed(2)} | T1: $${s.target1.toFixed(2)} | Smart Money: ${s.smartMoneySignal || 'NONE'}`
  ).join('\n');

  const prompt = `You are QUANTUM TRADE AI — an elite short-term trader analyzing for DAILY ₹500-₹1000 profit with ₹5000 capital.

ANALYZE each asset. For each give EXACTLY this format:
**SYMBOL**: DIRECTION(LONG/SHORT/SKIP) | Conviction: X/10 | Analysis in 2 lines Hinglish

RULES:
1. Only LONG if: RSI<50 + MACD bullish + Price>SMA20 + StochRSI oversold recovery + ADX>20
2. Only SHORT if: RSI>55 + MACD bearish + Price<SMA20 + StochRSI overbought + ADX>20
3. SKIP if: ADX<15 (no trend) or conflicting signals
4. Be EXTREMELY selective — only high-probability setups
5. Focus on ₹500-₹1000 daily profit feasibility
6. Today: ${new Date().toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata' })}

SIGNALS:
${summary}`;

  try {
    const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${GROQ_API_KEY}`
      },
      body: JSON.stringify({
        model: 'llama-3.3-70b-versatile',
        messages: [
          { role: 'system', content: 'You are QUANTUM TRADE AI. Respond ONLY with the analysis format requested. Be precise with directions.' },
          { role: 'user', content: prompt }
        ],
        temperature: 0.3,
        max_tokens: 2000,
        top_p: 0.9
      }),
      signal: AbortSignal.timeout(15000)
    });

    if (!res.ok) return {};
    const data = await res.json();
    const text = data.choices?.[0]?.message?.content || '';

    const results: Record<string, { analysis: string; direction: 'LONG' | 'SHORT' | 'SKIP'; conviction: number }> = {};

    for (const sig of topSignals) {
      const regex = new RegExp(`\\*\\*${sig.symbol}\\*\\*[:\\s]*([\\s\\S]*?)(?=\\*\\*[A-Z]|$)`, 'i');
      const match = text.match(regex);
      if (match) {
        const block = match[1].trim();
        let direction: 'LONG' | 'SHORT' | 'SKIP' = 'SKIP';
        if (/\bLONG\b/i.test(block) && !/\bSKIP\b/i.test(block)) direction = 'LONG';
        else if (/\bSHORT\b/i.test(block) && !/\bSKIP\b/i.test(block)) direction = 'SHORT';

        const convMatch = block.match(/Conviction[:\s]*(\d+)/i);
        const conviction = convMatch ? parseInt(convMatch[1]) : 5;

        results[sig.symbol] = { analysis: block.substring(0, 300), direction, conviction };
      }
    }

    // Fallback: if no matches, assign text to first signal
    if (Object.keys(results).length === 0 && text.length > 10) {
      results[topSignals[0].symbol] = { analysis: text.substring(0, 300), direction: 'SKIP', conviction: 5 };
    }

    return results;
  } catch (e) {
    console.warn('Groq trade analysis failed:', e);
    return {};
  }
}

// ========== CLAUDE (Sonnet — Deep Institutional Analysis) ==========
export async function getClaudeTradeAnalysis(
  signals: FuturesTradeSignal[],
  top: number = 5
): Promise<Record<string, { analysis: string; direction: 'LONG' | 'SHORT' | 'SKIP'; conviction: number }>> {
  if (!CLAUDE_API_KEY || CLAUDE_API_KEY.length < 10) {
    // Claude key not set — use Groq with Claude-style deep analysis prompt as fallback
    return getClaudeFallbackViaGroq(signals, top);
  }

  const topSignals = signals.slice(0, top);
  const summary = topSignals.map((s, i) =>
    `${i + 1}. ${s.symbol} (${s.market}/${s.sector}) | ₹${s.currentPrice.toFixed(2)} | ${s.change >= 0 ? '+' : ''}${s.change.toFixed(2)}% | RSI: ${s.rsi.toFixed(0)} | StochRSI: ${s.stochRsi?.toFixed(0) || 'N/A'} | MACD: ${s.macd.toFixed(3)} | ADX: ${s.adx?.toFixed(0) || 'N/A'} | SMA20: ${s.sma20.toFixed(2)} vs SMA50: ${s.sma50.toFixed(2)} | Ichimoku: ${s.ichimokuSignal || 'N/A'} | Supertrend: ${s.supertrend || 'N/A'} | R:R ${s.riskReward}:1 | Entry: $${s.entryPrice.toFixed(2)} | SL: $${s.stopLoss.toFixed(2)} | T1: $${s.target1.toFixed(2)} | T2: $${s.target2.toFixed(2)} | SmartMoney: ${s.smartMoneySignal || 'NONE'} | MTF: ${s.mtfAlignment || 'N/A'}`
  ).join('\n');

  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': CLAUDE_API_KEY,
        'anthropic-version': '2023-06-01',
        'anthropic-dangerous-direct-browser-access': 'true'
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 2000,
        messages: [{
          role: 'user',
          content: `You are DEEP QUANTUM INSTITUTIONAL ANALYST. Capital: ₹5000. Target: ₹500-₹1000 daily profit.

Analyze these trade setups with SMC (Smart Money Concepts), Wyckoff, and Order Flow. For each:
**SYMBOL**: DIRECTION(LONG/SHORT/SKIP) | Conviction: X/10 | 2-line Hinglish analysis

STRICT RULES:
- LONG only if: Bullish order block + demand zone + accumulation phase + RSI<50 recovering
- SHORT only if: Bearish order block + supply zone + distribution phase + RSI>55 falling
- Check ALL indicators: StochRSI, ADX, Ichimoku Cloud, Supertrend, EMA Cross, VWAP, OBV
- Factor in Smart Money signals — Whale activity gets HIGHEST priority
- Consider R:R ratio — minimum 2:1 for any trade
- For ₹5000 capital, calculate if ₹500 profit is feasible with given leverage

Date: ${new Date().toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata' })}

SIGNALS:
${summary}`
        }]
      }),
      signal: AbortSignal.timeout(20000)
    });

    if (!res.ok) {
      console.warn('Claude API error:', res.status, res.statusText);
      return getClaudeFallbackViaGroq(signals, top);
    }
    const data = await res.json();
    const text = data.content?.[0]?.text || '';

    return parseAiResponse(text, topSignals);
  } catch (e) {
    console.warn('Claude trade analysis failed (CORS/Network), using Groq fallback:', e);
    return getClaudeFallbackViaGroq(signals, top);
  }
}

// Claude fallback via Groq with deep SMC/Wyckoff analysis prompt
async function getClaudeFallbackViaGroq(
  signals: FuturesTradeSignal[],
  top: number = 5
): Promise<Record<string, { analysis: string; direction: 'LONG' | 'SHORT' | 'SKIP'; conviction: number }>> {
  if (!GROQ_API_KEY || GROQ_API_KEY.length < 10) return {};

  const topSignals = signals.slice(0, top);
  const summary = topSignals.map((s, i) =>
    `${i + 1}. ${s.symbol} (${s.market}) | $${s.currentPrice.toFixed(2)} | RSI: ${s.rsi.toFixed(0)} | StochRSI: ${s.stochRsi?.toFixed(0) || 'N/A'} | MACD: ${s.macd.toFixed(3)} | ADX: ${s.adx?.toFixed(0) || 'N/A'} | SMA20 vs SMA50: ${s.sma20 > s.sma50 ? 'BULLISH' : 'BEARISH'} | Ichimoku: ${s.ichimokuSignal || 'N/A'} | Supertrend: ${s.supertrend || 'N/A'} | OBV: ${s.obvTrend || 'N/A'} | EMA: ${s.emaCross || 'NONE'} | R:R ${s.riskReward}:1 | SmartMoney: ${s.smartMoneySignal || 'NONE'}`
  ).join('\n');

  try {
    const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${GROQ_API_KEY}` },
      body: JSON.stringify({
        model: 'llama-3.3-70b-versatile',
        messages: [
          { role: 'system', content: 'You are DEEP INSTITUTIONAL ANALYST using SMC (Smart Money Concepts) and Wyckoff methodology. Analyze with order blocks, supply/demand zones, accumulation/distribution phases.' },
          { role: 'user', content: `Capital ₹5000, target ₹500-₹1000 daily profit. Analyze using SMC + Wyckoff + Order Flow.\nFor each: **SYMBOL**: DIRECTION(LONG/SHORT/SKIP) | Conviction: X/10 | SMC Hinglish analysis\n\n${summary}` }
        ],
        temperature: 0.3, max_tokens: 1500
      }),
      signal: AbortSignal.timeout(15000)
    });
    if (!res.ok) return {};
    const data = await res.json();
    const text = data.choices?.[0]?.message?.content || '';
    return parseAiResponse(text, topSignals);
  } catch (e) {
    console.warn('Claude fallback via Groq also failed:', e);
    return {};
  }
}

// Shared response parser
function parseAiResponse(
  text: string,
  topSignals: FuturesTradeSignal[]
): Record<string, { analysis: string; direction: 'LONG' | 'SHORT' | 'SKIP'; conviction: number }> {
  const results: Record<string, { analysis: string; direction: 'LONG' | 'SHORT' | 'SKIP'; conviction: number }> = {};

  for (const sig of topSignals) {
    const regex = new RegExp(`\\*\\*${sig.symbol}\\*\\*[:\\s]*([\\s\\S]*?)(?=\\*\\*[A-Z]|$)`, 'i');
    const match = text.match(regex);
    if (match) {
      const block = match[1].trim();
      let direction: 'LONG' | 'SHORT' | 'SKIP' = 'SKIP';
      if (/\bLONG\b/i.test(block) && !/\bSKIP\b/i.test(block)) direction = 'LONG';
      else if (/\bSHORT\b/i.test(block) && !/\bSKIP\b/i.test(block)) direction = 'SHORT';
      const convMatch = block.match(/Conviction[:\s]*(\d+)/i);
      const conviction = convMatch ? parseInt(convMatch[1]) : 5;
      results[sig.symbol] = { analysis: block.substring(0, 300), direction, conviction };
    }
  }

  if (Object.keys(results).length === 0 && text.length > 10) {
    results[topSignals[0].symbol] = { analysis: text.substring(0, 300), direction: 'SKIP', conviction: 5 };
  }
  return results;
}

// ========== ENHANCED GEMINI (Already exists — enhanced prompt) ==========
export async function getGeminiEnhancedAnalysis(
  signals: FuturesTradeSignal[],
  top: number = 5
): Promise<Record<string, { analysis: string; direction: 'LONG' | 'SHORT' | 'SKIP'; conviction: number }>> {
  if (!GEMINI_API_KEY || GEMINI_API_KEY.length < 10) return {};

  const topSignals = signals.slice(0, top);
  const summary = topSignals.map((s, i) =>
    `${i + 1}. ${s.symbol} (${s.market}) — $${s.currentPrice.toFixed(2)} | AI: ${s.aiScore} | RSI: ${s.rsi.toFixed(0)} | StochRSI: ${s.stochRsi?.toFixed(0) || 'N/A'} | MACD: ${s.macd.toFixed(2)} | ADX: ${s.adx || 'N/A'} | Ichimoku: ${s.ichimokuSignal || 'N/A'} | Supertrend: ${s.supertrend || 'N/A'} | R:R ${s.riskReward}:1 | Entry: $${s.entryPrice.toFixed(2)} | SL: $${s.stopLoss.toFixed(2)} | T1: $${s.target1.toFixed(2)} | SmartMoney: ${s.smartMoneySignal || 'NONE'} | MTF: ${s.mtfAlignment || 'N/A'}`
  ).join('\n');

  try {
    const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${GEMINI_API_KEY}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [
          { role: 'user', parts: [{ text: `QUANTUM TRADE AI — Capital ₹5000, daily target ₹500-₹1000. Analyze for DIRECTION (LONG/SHORT/SKIP) with Conviction (1-10). Use Hinglish. 3 lines max per stock. Format: **SYMBOL**: DIRECTION | Conviction: X/10 | Analysis\n\nDate: ${new Date().toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata' })}\n\n${summary}` }] }
        ],
        generationConfig: { temperature: 0.4, maxOutputTokens: 2000 },
        safetySettings: [
          { category: 'HARM_CATEGORY_HARASSMENT', threshold: 'BLOCK_ONLY_HIGH' },
          { category: 'HARM_CATEGORY_HATE_SPEECH', threshold: 'BLOCK_ONLY_HIGH' },
          { category: 'HARM_CATEGORY_SEXUALLY_EXPLICIT', threshold: 'BLOCK_ONLY_HIGH' },
          { category: 'HARM_CATEGORY_DANGEROUS_CONTENT', threshold: 'BLOCK_ONLY_HIGH' }
        ]
      }),
      signal: AbortSignal.timeout(20000)
    });

    if (!res.ok) {
      console.warn('Gemini API error:', res.status, res.statusText);
      return {};
    }
    const data = await res.json();
    const text = data.candidates?.[0]?.content?.parts?.[0]?.text || '';
    return parseAiResponse(text, topSignals);
  } catch (e) {
    console.warn('Gemini enhanced analysis failed:', e);
    return {};
  }
}

// ========== AI CONSENSUS CALCULATOR ==========
export interface AIConsensusResult {
  symbol: string;
  groqDirection: 'LONG' | 'SHORT' | 'SKIP';
  geminiDirection: 'LONG' | 'SHORT' | 'SKIP';
  claudeDirection: 'LONG' | 'SHORT' | 'SKIP';
  groqConviction: number;
  geminiConviction: number;
  claudeConviction: number;
  groqAnalysis: string;
  geminiAnalysis: string;
  claudeAnalysis: string;
  consensus: number;        // 0-100
  consensusLabel: 'STRONG_AGREE' | 'PARTIAL_AGREE' | 'DISAGREE';
  finalDirection: 'LONG' | 'SHORT' | 'SKIP';
  avgConviction: number;
  modelsAgree: number;      // how many agree (0-3)
}

export function calculateConsensus(
  groq: { direction: 'LONG' | 'SHORT' | 'SKIP'; conviction: number; analysis: string } | undefined,
  gemini: { direction: 'LONG' | 'SHORT' | 'SKIP'; conviction: number; analysis: string } | undefined,
  claude: { direction: 'LONG' | 'SHORT' | 'SKIP'; conviction: number; analysis: string } | undefined,
  engineDirection: 'LONG' | 'SHORT'
): Omit<AIConsensusResult, 'symbol'> {
  const groqDir = groq?.direction || 'SKIP';
  const geminiDir = gemini?.direction || 'SKIP';
  const claudeDir = claude?.direction || 'SKIP';
  const groqConv = groq?.conviction || 0;
  const geminiConv = gemini?.conviction || 0;
  const claudeConv = claude?.conviction || 0;

  // Count agreements with engine direction
  const directions = [groqDir, geminiDir, claudeDir].filter(d => d !== 'SKIP') as Array<'LONG' | 'SHORT'>;
  const agreeWithEngine = directions.filter(d => d === engineDirection).length;
  const disagreeWithEngine = directions.filter(d => d !== engineDirection).length;


  // Consensus score
  let consensus: number;
  if (agreeWithEngine === 3) consensus = 95; // All 3 AI + engine agree
  else if (agreeWithEngine === 2 && disagreeWithEngine === 0) consensus = 85;
  else if (agreeWithEngine === 2) consensus = 70;
  else if (agreeWithEngine === 1 && disagreeWithEngine === 0) consensus = 55;
  else if (agreeWithEngine === 1) consensus = 40;
  else if (directions.length === 0) consensus = 50; // No AI data, trust engine
  else consensus = 20; // All disagree

  // Adjust for conviction levels
  const avgConv = [groqConv, geminiConv, claudeConv].filter(c => c > 0);
  const avgConviction = avgConv.length > 0 ? avgConv.reduce((a, b) => a + b, 0) / avgConv.length : 5;
  if (avgConviction >= 8) consensus = Math.min(100, consensus + 10);
  else if (avgConviction <= 3) consensus = Math.max(0, consensus - 15);

  let consensusLabel: 'STRONG_AGREE' | 'PARTIAL_AGREE' | 'DISAGREE';
  if (consensus >= 75) consensusLabel = 'STRONG_AGREE';
  else if (consensus >= 45) consensusLabel = 'PARTIAL_AGREE';
  else consensusLabel = 'DISAGREE';

  // Final direction (majority vote)
  const longVotes = [groqDir, geminiDir, claudeDir, engineDirection].filter(d => d === 'LONG').length;
  const shortVotes = [groqDir, geminiDir, claudeDir, engineDirection].filter(d => d === 'SHORT').length;
  let finalDirection: 'LONG' | 'SHORT' | 'SKIP' = engineDirection;
  if (longVotes > shortVotes && longVotes >= 2) finalDirection = 'LONG';
  else if (shortVotes > longVotes && shortVotes >= 2) finalDirection = 'SHORT';
  else if (consensus < 30) finalDirection = 'SKIP';

  return {
    groqDirection: groqDir,
    geminiDirection: geminiDir,
    claudeDirection: claudeDir,
    groqConviction: groqConv,
    geminiConviction: geminiConv,
    claudeConviction: claudeConv,
    groqAnalysis: groq?.analysis || '',
    geminiAnalysis: gemini?.analysis || '',
    claudeAnalysis: claude?.analysis || '',
    consensus,
    consensusLabel,
    finalDirection,
    avgConviction: Math.round(avgConviction * 10) / 10,
    modelsAgree: agreeWithEngine
  };
}

// ========== RUN ALL AI ANALYSES IN PARALLEL ==========
export async function runMultiAiAnalysis(
  signals: FuturesTradeSignal[]
): Promise<Record<string, AIConsensusResult>> {
  if (signals.length === 0) return {};

  const top = signals.slice(0, 8);

  // Run all three AI models in parallel
  const [groqResults, geminiResults, claudeResults] = await Promise.allSettled([
    getGroqTradeAnalysis(signals, 8),
    getGeminiEnhancedAnalysis(signals, 5),
    getClaudeTradeAnalysis(signals, 5)
  ]);

  const groqData = groqResults.status === 'fulfilled' ? groqResults.value : {};
  const geminiData = geminiResults.status === 'fulfilled' ? geminiResults.value : {};
  const claudeData = claudeResults.status === 'fulfilled' ? claudeResults.value : {};

  const results: Record<string, AIConsensusResult> = {};

  for (const sig of top) {
    const consensusResult = calculateConsensus(
      groqData[sig.symbol],
      geminiData[sig.symbol],
      claudeData[sig.symbol],
      sig.direction
    );

    results[sig.symbol] = {
      symbol: sig.symbol,
      ...consensusResult
    };
  }

  return results;
}

// ========== DAILY PROFIT CALCULATOR ==========
export function calculateDailyProfitQty(
  entryPrice: number,
  targetPrice: number,
  leverage: number,
  targetProfit: number, // ₹500 or ₹1000
  market: 'CRYPTO' | 'US' | 'IN',
  usdInrRate: number = 85
): { qty: number; investment: number; feasible: boolean } {
  const priceDiff = Math.abs(targetPrice - entryPrice);
  if (priceDiff <= 0) return { qty: 0, investment: 0, feasible: false };

  // Convert to INR if needed
  const priceDiffInr = market === 'IN' ? priceDiff : priceDiff * usdInrRate;
  const entryPriceInr = market === 'IN' ? entryPrice : entryPrice * usdInrRate;

  // Qty needed for target profit (with leverage)
  const qtyNeeded = Math.ceil(targetProfit / (priceDiffInr * leverage));
  const investment = (qtyNeeded * entryPriceInr) / leverage;

  return {
    qty: qtyNeeded,
    investment: Math.round(investment),
    feasible: investment <= 5000 // ₹5000 capital
  };
}

// ========== MARKET HOURS CHECK ==========
export function isMarketActive(market: 'CRYPTO' | 'US' | 'IN'): boolean {
  if (market === 'CRYPTO') return true; // 24/7

  const now = new Date();
  const istOffset = 5.5 * 60; // IST is UTC+5:30
  const utcMinutes = now.getUTCHours() * 60 + now.getUTCMinutes();
  const istMinutes = utcMinutes + istOffset;
  const day = now.getUTCDay();

  if (day === 0 || day === 6) return false; // Weekend

  if (market === 'IN') {
    // 9:15 AM - 3:30 PM IST
    return istMinutes >= 555 && istMinutes <= 930;
  }

  if (market === 'US') {
    // 7:00 PM - 1:30 AM IST (pre-market from 6:30 PM)
    return istMinutes >= 1110 || istMinutes <= 90;
  }

  return false;
}
