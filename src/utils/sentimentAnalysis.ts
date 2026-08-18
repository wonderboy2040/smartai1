// ============================================================
// AI Sentiment & Confidence Analyzer — Wealth AI v18
// ------------------------------------------------------------
// Analyzes LLM / Quant Brain responses for technical conviction,
// risk calibration, numerical anchoring, and uncertainty markers.
// Renders confidence indicators to guide user decision making.
// ============================================================

export interface AIConfidenceScore {
  score: number; // 0 - 100
  level: 'HIGH' | 'MODERATE' | 'CAUTIOUS';
  sentiment: 'BULLISH' | 'BEARISH' | 'NEUTRAL' | 'VOLATILE';
  signalsCount: number;
  verdictSummary: string;
  badgeClass: string;
  badgeBg: string;
  badgeText: string;
  factors: string[];
}

const CERTAINTY_KEYWORDS = [
  'definitely', 'strong conviction', 'confirmed breakout', 'clear support',
  'high probability', 'strong momentum', 'solid setup', 'favorable r:r',
  'accumulate', 'strong buy', 'high confidence', 'confluence', 'institutional buying'
];

const UNCERTAINTY_KEYWORDS = [
  'maybe', 'possibly', 'could be', 'might reverse', 'uncertain',
  'unpredictable', 'speculative', 'caution advised', 'wait and watch',
  'volatile chop', 'false breakout', 'risky'
];

const BULLISH_MARKERS = [
  'bullish', 'breakout', 'uptrend', 'higher high', 'buying opportunity',
  'target hit', 'oversold bounce', 'golden cross', 'long setup', 'accumulate'
];

const BEARISH_MARKERS = [
  'bearish', 'breakdown', 'downtrend', 'lower low', 'profit booking',
  'stop loss hit', 'overbought', 'death cross', 'short setup', 'trim position'
];

export function analyzeAIResponse(text: string): AIConfidenceScore {
  if (!text || text.trim().length === 0) {
    return {
      score: 50,
      level: 'MODERATE',
      sentiment: 'NEUTRAL',
      signalsCount: 0,
      verdictSummary: 'Neutral baseline',
      badgeClass: 'border-slate-500/40 text-slate-400 bg-slate-800/40',
      badgeBg: 'bg-slate-500/10',
      badgeText: '50% Neutral',
      factors: []
    };
  }

  const lower = text.toLowerCase();
  let score = 60; // Base score
  const factors: string[] = [];

  // 1. Concrete number / price anchoring (+15)
  const numbersCount = (text.match(/₹?\d+(\.\d+)?%?/g) || []).length;
  if (numbersCount >= 6) {
    score += 15;
    factors.push('Anchored with precise price levels & metrics');
  } else if (numbersCount >= 3) {
    score += 8;
    factors.push('Price data referenced');
  }

  // 2. Risk parameters specified (+10)
  if (lower.includes('stop loss') || lower.includes('sl:') || lower.includes('invalidation')) {
    score += 10;
    factors.push('Defined risk & Stop-Loss protection');
  }

  // 3. Clear Target price specified (+10)
  if (lower.includes('target') || lower.includes('tp1') || lower.includes('r:r')) {
    score += 10;
    factors.push('Clear risk-reward targets');
  }

  // 4. Certainty & Conviction keywords (+15 max)
  let certaintyHits = 0;
  for (const kw of CERTAINTY_KEYWORDS) {
    if (lower.includes(kw)) {
      certaintyHits++;
      score += 4;
    }
  }
  if (certaintyHits > 0) {
    factors.push(`${certaintyHits} positive conviction signals`);
  }

  // 5. Uncertainty & Hedge deductions (-20 max)
  let uncertaintyHits = 0;
  for (const kw of UNCERTAINTY_KEYWORDS) {
    if (lower.includes(kw)) {
      uncertaintyHits++;
      score -= 5;
    }
  }
  if (uncertaintyHits > 0) {
    factors.push(`${uncertaintyHits} caution / volatility warnings`);
  }

  // 6. SuperScore / Multi-Factor mention (+10)
  if (lower.includes('superscore') || lower.includes('quant brain') || lower.includes('consensus')) {
    score += 8;
    factors.push('Multi-factor quant backing');
  }

  // Clamp score
  const finalScore = Math.max(20, Math.min(98, score));

  // Determine Sentiment
  let bullCount = 0;
  let bearCount = 0;
  for (const w of BULLISH_MARKERS) if (lower.includes(w)) bullCount++;
  for (const w of BEARISH_MARKERS) if (lower.includes(w)) bearCount++;

  let sentiment: AIConfidenceScore['sentiment'] = 'NEUTRAL';
  if (bullCount > bearCount + 1) sentiment = 'BULLISH';
  else if (bearCount > bullCount + 1) sentiment = 'BEARISH';
  else if (lower.includes('volatile') || lower.includes('vix')) sentiment = 'VOLATILE';

  // Determine Level & UI theme
  let level: AIConfidenceScore['level'] = 'MODERATE';
  let badgeClass = 'border-cyan-500/40 text-cyan-300 bg-cyan-950/40';
  let badgeBg = 'bg-cyan-500/10';

  if (finalScore >= 78) {
    level = 'HIGH';
    badgeClass = 'border-emerald-500/40 text-emerald-300 bg-emerald-950/40';
    badgeBg = 'bg-emerald-500/10';
  } else if (finalScore < 55) {
    level = 'CAUTIOUS';
    badgeClass = 'border-amber-500/40 text-amber-300 bg-amber-950/40';
    badgeBg = 'bg-amber-500/10';
  }

  const verdictSummary =
    level === 'HIGH'
      ? `${finalScore}% Conviction — Solid setup backed by data`
      : level === 'MODERATE'
      ? `${finalScore}% Confidence — Steady setup with standard risk`
      : `${finalScore}% Cautious — Elevated volatility or mixed signals`;

  return {
    score: finalScore,
    level,
    sentiment,
    signalsCount: bullCount + bearCount + certaintyHits,
    verdictSummary,
    badgeClass,
    badgeBg,
    badgeText: `${finalScore}% ${level === 'HIGH' ? 'High Conviction' : level === 'MODERATE' ? 'Moderate' : 'Cautious'}`,
    factors
  };
}
