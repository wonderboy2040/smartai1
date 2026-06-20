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

export type TabType = 'dashboard' | 'portfolio' | 'planner' | 'macro' | 'guide' | 'deepmind';
export type RiskLevel = 'low' | 'medium' | 'high';
export type TransactionType = 'buy' | 'sell';

// ========================================
// PRICE ALERTS (target / stop-loss → Telegram)
// ========================================
export interface PriceAlert {
  id: string;
  symbol: string;
  market: 'IN' | 'US';
  target?: number | null;      // upper target price (notify when price >= target)
  stopLoss?: number | null;    // lower stop-loss price (notify when price <= stopLoss)
  note?: string;               // optional user note shown in the alert
  enabled: boolean;
  createdAt: number;
  lastTriggered?: number;          // ts of last fired alert (cooldown)
  triggeredType?: 'target' | 'stoploss' | null; // which threshold last fired
}

// ========================================
// TRANSACTION LEDGER (powers monthly analytics & return reports)
// ========================================
export interface Transaction {
  id: string;
  symbol: string;
  market: 'IN' | 'US';
  type: TransactionType;
  qty: number;          // qty bought / sold
  price: number;        // per-unit price in native currency
  amount: number;       // qty * price (native currency)
  date: string;         // YYYY-MM-DD (trade date)
  ts: number;           // Date.now() when recorded
  prevQty: number;      // holding qty BEFORE this txn
  prevAvg: number;      // avg price BEFORE this txn
  newQty: number;       // holding qty AFTER this txn
  newAvg: number;       // avg price AFTER this txn
  realizedPL?: number;  // realized P&L for sells (native currency)
}

// Aggregated month-wise analytics row (Planner Deep Data Analytics)
export interface MarketBreakdown {
  buyQty: number;
  buyAmount: number;   // native-summed but tagged; INR for IN/CRYPTO-INR, USD for US
  buyAmountINR: number;
  txnCount: number;
}
export interface MonthlyAnalytics {
  month: string;            // YYYY-MM
  label: string;            // "Jun 2026"
  rangeLabel: string;       // "1 Jun – 30 Jun 2026"
  buyQty: number;           // total qty bought in month
  buyAmountINR: number;     // total invested in month (INR equivalent)
  sellQty: number;          // total qty sold in month
  sellAmountINR: number;    // total redeemed in month (INR equivalent)
  netInvestedINR: number;   // buyAmount - sellAmount (INR)
  realizedPLINR: number;    // realized P&L booked in month (INR)
  txnCount: number;
  symbols: string[];        // unique symbols transacted
  // market split: India, USA, Crypto
  india: MarketBreakdown;
  usa: MarketBreakdown;
  crypto: MarketBreakdown;
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
  aiAnalysis?: string; // Groq deep analysis
  // Deep Quantum AI — Enhanced fields
  bbUpper?: number;
  bbLower?: number;
  atr?: number;
  adx?: number;
  obv?: number;
  ema10?: number;
  ema20?: number;
  ema50?: number;
  ema200?: number;
  sectorRank?: number; // 1-10 sector relative strength
  accDistPhase?: 'ACCUMULATION' | 'DISTRIBUTION' | 'MARKUP' | 'MARKDOWN' | 'NEUTRAL';
  fibSupport?: number;
  fibResistance?: number;
  institutionalQuality?: number; // 0-100
  volumeProfile?: 'ABOVE_AVG' | 'NORMAL' | 'LOW';
  // ML Signal fields (from Python ML service)
  mlSignal?: string;
  mlConfidence?: number;
  mlEntry?: number;
  mlSL?: number;
  mlTP1?: number;
  mlRR?: number;
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
