// ============================================================
// src/components/aitrading/types.ts — AI Trading Terminal types
// (mirrors the server/ai payload shapes 1:1)
// ============================================================

export type Side = 'LONG' | 'SHORT' | 'FLAT';
export type Grade = 'STRONG' | 'ACTION' | 'WATCH' | 'NEUTRAL';
export type MarketKind = 'INDIA' | 'CRYPTO';

export interface ModelVote {
  id: string;
  name: string;
  role: string;
  weight: number;
  dir: number;          // -1 | 0 | +1
  conf: number;         // 0-100
  reasons: string[];
}

export interface TradePlan {
  entry: number;
  stopLoss: number;
  target1: number;
  target2: number;
  risk: number;
  riskPct: number;
  rewardRisk: number;
  atrUsed: number;
  planStyle: string;
}

export interface AINote {
  verdict: string;
  note?: string;
  analysis?: string;
  model?: string | null;
}

export interface AISignal {
  symbol: string;
  market: MarketKind;
  side: Side;
  grade: Grade;
  confidence: number;
  agreement: number;
  participating: number;
  totalModels: number;
  bullWeight?: number | null;
  bearWeight?: number | null;
  ltp: number | null;
  changePct: number | null;
  plan: TradePlan | null;
  votes: ModelVote[];
  summary: string;
  aiNote: AINote | null;
  executable: boolean;
  generatedAt: number;
}

export interface ModelStatusRow {
  id: string;
  name: string;
  role: string;
  weight: number;
  online: boolean;
  engine: string; // 'quant' | provider name
}

export interface SignalBoard {
  ok: boolean;
  market: MarketKind;
  marketOpen?: boolean;
  reason?: string;
  regime?: { niftyChange?: number | null; indiaVix?: number | null; btcChange?: number | null };
  scanned?: number;
  signals: AISignal[];
  models: ModelStatusRow[];
  generatedAt: number;
}

export interface OptionRow {
  strike: number;
  expiry: string;
  callOI: number;
  callOIChange: number;
  callIV: number | null;
  callLTP: number;
  callVolume: number;
  putOI: number;
  putOIChange: number;
  putIV: number | null;
  putLTP: number;
  putVolume: number;
  callGreeks?: { delta: number | null; gamma: number | null; theta: number | null; vega: number | null };
  putGreeks?: { delta: number | null; gamma: number | null; theta: number | null; vega: number | null };
}

export interface StrategyLeg {
  action: 'BUY' | 'SELL';
  type: 'CE' | 'PE';
  strike: number;
  premium: number;
  iv: number | null;
  delta: number | null;
  theta: number | null;
}

export interface Strategy {
  id: string;
  name: string;
  bias: string;
  conviction: string;
  rationale: string;
  legs: StrategyLeg[];
  netDebit?: number | null;
  netCredit?: number | null;
  maxProfit: number | null;
  maxLoss: number | null;
  breakevens: number[] | null;
  netDelta?: number | null;
  netTheta?: number | null;
  perLot?: { maxProfit: number | null; maxLoss: number | null };
  exitPlan: string;
}

export interface OptionsDesk {
  ok: boolean;
  symbol: string;
  spot: number;
  spotChangePct?: number | null;
  vix?: number | null;
  expiry: string;
  source: 'nse' | 'bs-model';
  syntheticNote?: string | null;
  lotSize: number;
  analytics: {
    pcr: number | null;
    maxPain: number | null;
    atmIV: number | null;
    ivPercentile: number | null;
    oiSkew: number | null;
    callOI: number;
    putOI: number;
  } | null;
  consensus?: { side: Side; confidence: number; agreement: number; grade: Grade };
  strategies: Strategy[];
  rows: OptionRow[];
  fetchedAt: number;
  reason?: string;
}

export interface TradingConfig {
  mode: 'paper' | 'live';
  minConfidence: number;
  minAgreement: number;
  maxOrderINR: number;
  dailyMaxTrades: number;
  dailyMaxLossINR: number;
  onePositionPerPair: boolean;
  allowAuto: boolean;
  killSwitch: boolean;
  maxRiskPct: number;
  liveConfirmedAt: number | null;
}

export interface JournalPosition {
  id: string;
  pair: string;
  side: Side;
  mode: 'paper' | 'live';
  qty: number;
  entryPrice: number;
  notionalINR: number;
  sl: number | null;
  tp: number | null;
  tp2: number | null;
  signal?: { grade: string; confidence: number; agreement: number; summary?: string };
  openedAt: number;
  status: 'OPEN' | 'CLOSED' | 'UNKNOWN';
  closedAt?: number;
  closePrice?: number;
  pnlINR?: number;
  closeReason?: string;
  ltp?: number | null;
  unrealizedPnlINR?: number | null;
  exchangeOrderId?: string | null;
}

export interface JournalEntry {
  id: string;
  ts: number;
  kind: string;
  day: string;
  pair?: string;
  side?: string;
  mode?: string;
  status: string;
  reason?: string;
  qty?: number;
  price?: number;
  notionalINR?: number;
  pnlINR?: number;
  signal?: { grade?: string; conf?: number; agreement?: number };
}

export interface TradingState {
  ok: boolean;
  config: TradingConfig;
  stats: { day: string; tradesCount: number; realizedPnlINR: number };
  openPositions: number;
  blocked: { killSwitch: boolean; dailyTrades: boolean; dailyLoss: boolean; notConnected: boolean };
}
