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

export type TabType = 'dashboard' | 'portfolio' | 'quantum' | 'flow' | 'optimizer' | 'planner' | 'macro' | 'tools' | 'guide' | 'deepmind' | 'trade';
export type RiskLevel = 'low' | 'medium' | 'high';
export type TransactionType = 'buy' | 'sell';

// ========================================
// ADVANCE PRO TRADING — FUTURES SIGNALS
// ========================================
export interface FuturesTradeSignal {
  symbol: string;
  name: string;
  market: 'CRYPTO' | 'US' | 'IN';
  sector: string;
  // Price levels
  currentPrice: number;
  entryPrice: number;
  target1: number;
  target2: number;
  target3: number;
  stopLoss: number;
  // Trade setup
  direction: 'LONG' | 'SHORT';
  leverage: number;
  timeframe: 'INTRADAY' | 'SWING_1_3D' | 'SWING_3_7D';
  // AI Scores (all 0-100)
  technicalScore: number;
  momentumScore: number;
  volatilityScore: number;
  sentimentScore: number;
  aiConsensusScore: number; // Multi-AI agreement score
  aiScore: number;       // weighted composite
  conviction: number;    // 90-99
  // Risk metrics
  riskReward: number;    // e.g. 2.5 means 2.5:1
  riskPercent: number;   // % from entry to SL
  potentialReturn: number; // % from entry to T1
  // Display
  signal: 'STRONG_LONG' | 'LONG' | 'STRONG_SHORT' | 'SHORT';
  actionHinglish: string;
  reasoningHinglish: string;
  // Technical data
  rsi: number;
  macd: number;
  sma20: number;
  sma50: number;
  atr: number;
  bbWidth: number;
  volume: number;
  change: number;
  // Deep Quantum AI — Advanced indicators
  vwap?: number;
  ema10?: number;
  ema20?: number;
  fibLevels?: { s1: number; s2: number; s3: number; r1: number; r2: number; r3: number };
  smartMoneySignal?: 'WHALE_BUY' | 'WHALE_SELL' | 'VOLUME_SPIKE' | 'BLOCK_DEAL' | 'NONE';
  multiTimeframeScore?: number; // 0-100 confluence
  mtfAlignment?: string; // "3/4 BULLISH" etc
  // CoinDCX USDC/INR
  coinDcxPair?: string;  // e.g. "BTCUSDC", "ETHUSDC"
  coinDcxInrPrice?: number;
  // Multi-AI Analysis (Groq + Gemini + Claude)
  geminiAnalysis?: string;
  groqAnalysis?: string;
  claudeAnalysis?: string;
  aiConsensus?: number;        // 0-100 agreement between models
  aiConsensusLabel?: 'STRONG_AGREE' | 'PARTIAL_AGREE' | 'DISAGREE' | 'PENDING';
  // Advanced Pro-Trader Indicators
  stochRsi?: number;           // 0-100, more sensitive than RSI
  stochRsiSignal?: number;     // signal line
  adx?: number;                // trend strength 0-100
  ichimokuSignal?: 'ABOVE_CLOUD' | 'IN_CLOUD' | 'BELOW_CLOUD';
  supertrend?: 'BUY' | 'SELL';
  supertrendValue?: number;
  obvTrend?: 'BULLISH' | 'BEARISH' | 'NEUTRAL';
  ema9?: number;
  ema21?: number;
  emaCross?: 'GOLDEN' | 'DEATH' | 'NONE';
  // Daily Profit Calculator (₹5000 capital)
  qty500?: number;             // quantity needed for ₹500 profit
  qty1000?: number;            // quantity needed for ₹1000 profit
  dailyProfitPotential?: number; // estimated daily profit in ₹
  investmentNeeded500?: number;  // capital needed for ₹500 target
  investmentNeeded1000?: number; // capital needed for ₹1000 target
}

// ========================================
// ACTIVE TRADE TRACKING — LIVE P&L
// ========================================
export interface ActiveTrade {
  id: string;
  symbol: string;
  market: 'CRYPTO' | 'US' | 'IN';
  direction: 'LONG' | 'SHORT';
  leverage: number;
  entryPrice: number;
  quantity: number;
  stopLoss: number;
  trailingStop?: number;
  target1: number;
  target2?: number;
  target3?: number;
  entryTime: number; // timestamp
  platform?: 'COINDCX' | 'INDMONEY' | 'ZERODHA' | 'BINANCE' | 'OTHER';
  pair?: string; // USDC pair for CoinDCX
  notes?: string;
  // Partial profit tracking
  t1Hit?: boolean;
  t2Hit?: boolean;
  partialExits?: { price: number; qty: number; time: number; pnl: number }[];
  dailyTarget?: number; // ₹500 or ₹1000
  aiConsensus?: number;
}

// ========================================
// TRADE JOURNAL — PERSISTENT HISTORY
// ========================================
export interface TradeJournalEntry {
  id: string;
  symbol: string;
  market: 'CRYPTO' | 'US' | 'IN';
  direction: 'LONG' | 'SHORT';
  leverage: number;
  entryPrice: number;
  exitPrice: number;
  quantity: number;
  pnl: number; // absolute P&L
  pnlPercent: number;
  riskReward: number;
  result: 'WIN' | 'LOSS' | 'BREAKEVEN';
  entryTime: number;
  exitTime: number;
  platform?: string;
  pair?: string;
  notes?: string;
  aiScore?: number;
}

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
  // Deep Quantum AI — Enhanced fields
  bbUpper?: number;
  bbLower?: number;
  atr?: number;
  adx?: number;
  obv?: number;
  ema10?: number;
  ema20?: number;
  sectorRank?: number; // 1-10 sector relative strength
  accDistPhase?: 'ACCUMULATION' | 'DISTRIBUTION' | 'MARKUP' | 'MARKDOWN' | 'NEUTRAL';
  fibSupport?: number;
  fibResistance?: number;
  institutionalQuality?: number; // 0-100
  volumeProfile?: 'ABOVE_AVG' | 'NORMAL' | 'LOW';
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
