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

export type TabType = 'dashboard' | 'portfolio' | 'planner' | 'macro' | 'tools' | 'trim' | 'quantum' | 'signals' | 'intelligence';
export type RiskLevel = 'low' | 'medium' | 'high';
export type TransactionType = 'buy' | 'sell';

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
