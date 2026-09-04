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
  /** v6.4: structural ATR stop exceeded the risk cap → SL fitted to the
   *  cap and targets re-derived (honest display + audit trail). */
  riskClamped?: boolean;
  originalRiskPct?: number;
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
  participation?: number | null; // v6.3: voting-weight quorum (0-1)
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

export interface MarketBreadth {
  bull: number;
  bear: number;
  flat: number;
  avgConf: number;
}

export interface SignalBoard {
  ok: boolean;
  market: MarketKind;
  marketOpen?: boolean;
  reason?: string;
  regime?: { niftyChange?: number | null; indiaVix?: number | null; btcChange?: number | null };
  breadth?: MarketBreadth;
  /** v6.4: the user's max-stop% the board plans were built within. */
  riskCap?: number;
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
  indiaMode: 'paper' | 'live';
  minConfidence: number;
  minAgreement: number;
  maxOrderINR: number;
  indiaMaxOrderINR: number;
  dailyMaxTrades: number;
  dailyMaxLossINR: number;
  onePositionPerPair: boolean;
  allowAuto: boolean;
  killSwitch: boolean;
  maxRiskPct: number;
  liveConfirmedAt: number | null;
  indiaLiveConfirmedAt: number | null;
  /** v6.5 trailing stop-loss */
  trailEnabled: boolean;
  trailArmR: number;
  trailOffsetR: number;
  /** v6.6: crypto margin leverage ceiling (1-10; 1 = spot only) */
  cryptoLeverage?: number;
}

export interface JournalPosition {
  id: string;
  pair: string;
  symbol?: string;
  market?: 'CRYPTO' | 'INDIA';
  side: Side;
  mode: 'paper' | 'live';
  qty: number;
  entryPrice: number;
  notionalINR: number;
  sl: number | null;
  tp: number | null;
  tp2: number | null;
  /** v6.5 trailing state */
  peakPrice?: number | null;
  initialRisk?: number | null;
  trailing?: 'breakeven' | 'trail' | null;
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
  slOrderId?: string | null;
  /** v6.6: leverage fields (margin positions only; spot positions omit) */
  leverage?: number;
  marginINR?: number;
  liquidation?: number | null;
  marginPair?: string | null;
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

// ---------------- v6.5: Backtest ----------------
export interface BacktestTrade {
  symbol: string;
  side: Side;
  grade: Grade;
  confidence: number;
  entry: number | null;
  exit: number | null;
  sl: number | null;
  tp2: number | null;
  r: number | null;
  pnlINR: number | null;
  reason: string;
  holdBars: number | null;
  planStyle?: string;
}

export interface BacktestStats {
  trades: number;
  wins: number;
  losses: number;
  winRate: number | null;
  avgR: number | null;
  totalR: number | null;
  profitFactor: number | null;
  maxDDR: number | null;
  avgHoldBars: number | null;
  pnlINR: number | null;
  symbols?: number;
}

export interface BacktestResult {
  ok: boolean;
  market: MarketKind;
  params?: { minGrade?: string; capitalPerTradeINR?: number; maxRiskPct?: number; maxHoldBars?: number; slippagePct?: number };
  scannedSymbols?: number;
  perSymbol?: { symbol: string; ok: boolean; reason?: string; stats?: BacktestStats }[];
  stats: BacktestStats;
  gradeDist?: Record<string, number>;
  exitDist?: Record<string, number>;
  equity?: { i: number; cumR: number; symbol: string; r: number | null }[];
  trades?: BacktestTrade[];
  disclaimer?: string;
  generatedAt?: number;
}

// ---------------- v6.5: Alerts + AI keys + Dhan ----------------
export interface MaskedSecret {
  configured: boolean;
  tail: string | null;
}

export interface AlertsStatus {
  ok: boolean;
  status: {
    telegramBotToken: MaskedSecret;
    telegramChatId: MaskedSecret;
    geminiApiKey: MaskedSecret;
    groqApiKey: MaskedSecret;
  };
  telegram: { configured: boolean; source?: string | null };
}

export interface DhanStatus {
  ok: boolean;
  connected: boolean;
  scrips?: { cached?: boolean; symbols?: number; updatedAt?: number | null };
  profile?: { name?: string | null; clientId?: string | null } | null;
}
