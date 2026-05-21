export interface Position {
  id: string;
  symbol: string;
  market: 'IN' | 'US';
  qty: number;
  avgPrice: number;
  leverage: number;
  dateAdded: string;
}

export interface PriceData {
  price: number;
  change: number;
  high?: number;
  low?: number;
  volume?: number;
  rsi: number;
  time: number;
  market: string;
  tvExchange?: string;
  tvExactSymbol?: string;
  sma20?: number;
  sma50?: number;
  macd?: number;
  // Multi-timeframe indicators
  timeframe15m?: { rsi: number; trend: 'up' | 'down' | 'flat' };
  timeframe1h?: { rsi: number; trend: 'up' | 'down' | 'flat' };
  timeframe1d?: { rsi: number; trend: 'up' | 'down' | 'flat' };
}

export interface ETFInfo {
  sym: string;
  name: string;
  cagr: number;
  maxDD: number;
  cat: string;
  aum: string;
  vol: string;
  fixedAlloc: number;
}

export interface ExpertInfo {
  id: string;
  icon: string;
  name: string;
  role: string;
  colorBg: string;
  border: string;
}

export type TabType = 'dashboard' | 'portfolio' | 'quantum' | 'flow' | 'optimizer' | 'planner' | 'macro' | 'tools' | 'guide' | 'deepmind';
export type RiskLevel = 'low' | 'medium' | 'high';
export type TransactionType = 'buy' | 'sell';

export interface DeepScanStock {
  symbol: string;
  name: string;
  market: 'IN' | 'US';
  sector: string;
  price: number;
  change: number;
  rsi: number;
  sma20: number;
  sma50: number;
  macd: number;
  volume: number;
  high: number;
  low: number;
  // Multi-factor AI scores (0-100)
  fundamentalScore: number;
  technicalScore: number;
  momentumScore: number;
  sentimentScore: number;
  valueScore: number;
  aiScore: number; // weighted composite
  aiConfidence: number; // 90-95%
  // Signal
  signal: 'STRONG_BUY' | 'BUY' | 'HOLD' | 'SELL' | 'STRONG_SELL';
  actionHindi: string; // "Abhi Buy Karo", etc.
  // Targets
  target1Y: number;
  target2Y: number;
  return1Y: number; // expected % return
  return2Y: number;
  stopLoss: number;
  // Timing
  buyTiming: string;
  sellTiming: string;
  // AI reasoning
  aiReasoning: string;
  geminiAnalysis?: string; // Gemini 3.5 Flash deep analysis
}

export interface PremarketAnalysis {
  market: 'IN' | 'US';
  predictedGap: number; // percentage
  sentimentScore: number; // -1 to 1
  volatilityForecast: 'low' | 'medium' | 'high';
  keySectors: { sector: string; trend: 'bullish' | 'bearish' | 'neutral' }[];
  aiConfidence: number; // 0 to 1
  summary: string;
}

export interface PartialProfitResult {
  symbol: string;
  sellQty: number;
  realizedProfit: number;
  remainingQty: number;
  newAvgPrice: number;
}

// ========================================
// BUY-THE-DIP & LONG-TERM INVESTMENT TYPES
// ========================================

export interface DipLevel {
  label: string;
  percentBelow: number;
  targetPrice: number;
  suggestedAmount: number;
  triggered: boolean;
}

export interface DipSignal {
  symbol: string;
  market: 'IN' | 'US';
  currentPrice: number;
  sma20: number;
  sma50: number;
  sma20Distance: number;
  sma50Distance: number;
  rsi: number;
  dipDepth: 'DEEP' | 'MILD' | 'NEUTRAL' | 'ELEVATED';
  fibSupport: number;
  fibResistance: number;
  entryTarget: number;
  dipLadder: DipLevel[];
  confidence: number;
  reason: string;
}

export interface PortfolioHealth {
  score: number;
  drawdownFromHigh: number;
  rsiExtremeCount: number;
  trendReversals: string[];
  vixStatus: 'NORMAL' | 'ELEVATED' | 'SPIKE';
  alertLevel: 'GREEN' | 'YELLOW' | 'RED';
  buyOpportunities: string[];
  warnings: string[];
}

export interface MacroRegime {
  regime: 'RISK_ON' | 'RISK_OFF' | 'STAGFLATION' | 'GOLDILOCKS';
  confidence: number;
  vix: number;
  yieldCurve: number;
  description: string;
  portfolioSuggestion: string;
  sectorRecommendation: { sector: string; action: 'OVERWEIGHT' | 'UNDERWEIGHT' | 'NEUTRAL'; reason: string }[];
}

export interface SectorMomentum {
  name: string;
  ticker: string;
  change: number;
  relativeStrength: number;
  compositeScore: number;
  trend: 'LEADING' | 'LAGGING' | 'IMPROVING' | 'WEAKENING';
}

export interface ScreenerResult {
  symbol: string;
  market: 'IN' | 'US';
  name: string;
  price: number;
  qualityScore: number;
  cagr: number;
  maxDrawdown: number;
  momentumScore: number;
  rsi: number;
  sma20: number;
  sma50: number;
  aboveSma200: boolean;
  change: number;
  valueScore: number;
  pegRatio: number;
  alphaScore: number;
  signal: 'STRONG_BUY' | 'BUY' | 'HOLD' | 'AVOID';
  reason: string;
}
