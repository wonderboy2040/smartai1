// ============================================================
// intraday/types — shared intraday tab types (v3)
// ============================================================

export interface IntradaySignal {
  symbol: string;
  ltp: number;
  changePct: number;
  direction: 'LONG' | 'SHORT';
  confidence: number;
  quantConfidence: number;
  aiConfidence: number | null;
  aiModel: string;
  aiNote: string;
  exchange?: 'NSE' | 'BSE';
  entry: number;
  entryZoneLow?: number;
  entryZoneHigh?: number;
  stopLoss: number;
  target1: number;
  target2: number;
  trailingSL?: number;
  trailAfterT1?: number;
  qtyPerLakh?: number;
  trendStrength?: string;
  freshEntriesAllowed?: boolean;
  sqOffBy?: string;
  marketPhase?: string;
  gapPct?: number;
  adx?: number;
  vwapDist?: number;
  rr: number;
  atr: number;
  vwap: number;
  rsi: number;
  volumeRatio: number;
  reasons: string[];
  // v3 additions
  orbMode?: 'LIVE' | 'PROXY';
  counterTrend?: boolean;
  slippage?: number;
  effRR?: number;
}

export interface MarketRegime {
  regime: 'BULLISH' | 'BEARISH' | 'NEUTRAL';
  vix: number | null;
  vixLevel: 'LOW' | 'ELEVATED' | 'HIGH' | null;
  niftyChange: number;
  niftyVwapDist: number;
  niftyRsi?: number | null;
  asOf?: string;
}

export interface IntradayAlertsStatus {
  enabled: boolean;
  telegramConfigured: boolean;
  cooldownMinutes: number;
  maxPerDay: number;
  sentToday: number;
}

export interface ScannerResponse {
  marketOpen: boolean;
  istTime?: string;
  weekday?: string;
  asOf?: string;
  scanned?: number;
  universe?: number;
  minConfidence?: number;
  aiVerified?: boolean;
  aiModel?: string;
  aiConsensus?: string;
  aiEngine?: string;
  engine?: string;
  sources?: { tradingView?: number; groww?: number };
  marketRegime?: MarketRegime | null;
  freshEntriesAllowed?: boolean;
  signals: IntradaySignal[];
  message?: string;
  error?: string;
  retryAfterSeconds?: number;
  disclaimer?: string;
}

export interface LiveQuote {
  price: number;
  change?: number;
  ts?: number;
}

export interface OutcomeEvent {
  type: 'OPEN' | 'FLIP' | 'T1_HIT' | 'T2_HIT' | 'SL_HIT' | 'BE_TRAIL_EXIT' | 'EOD_EXIT' | 'PAPER_CLOSE';
  symbol: string;
  direction?: 'LONG' | 'SHORT';
  price?: number;
  pnl?: number;
  rMultiple?: number;
  qty?: number;
  note?: string;
  confidence?: number;
}

export interface PaperTrade {
  id: number;
  symbol: string;
  direction: 'LONG' | 'SHORT';
  entry: number;
  qty: number;
  remainingQty: number;
  stopLoss: number;
  target1: number | null;
  target2: number | null;
  status: 'OPEN' | 'PARTIAL' | 'CLOSED';
  t1Hit: boolean;
  openedAt: number;
  closedAt: number | null;
  closeReason: string | null;
  lastPrice: number;
  realizedPnl: number;
  unrealizedPnl: number;
  parts: { qty: number; exitPrice: number; ts: number; reason: string }[];
  capital: number;
}

export interface PaperSummary {
  open: PaperTrade[];
  closedToday: PaperTrade[];
  stats: {
    openCount: number;
    dayRealizedPnl: number;
    dayUnrealizedPnl: number;
    totalRealizedPnl: number;
    wins: number;
    losses: number;
  };
}

export interface TrackRecordData {
  days: number;
  totalTracked: number;
  openCount: number;
  resolved: number;
  wins: number;
  losses: number;
  winRate: number | null;
  avgR: number | null;
  disciplinedPnlPerLakh: number;
  byStatus: Record<string, number>;
  open: {
    symbol: string; direction: string; entry: number; stopLoss: number;
    target1: number; target2: number; status: string; lastPrice: number;
    confidence: number; openedAt: number; t1Hit: boolean;
  }[];
  history: {
    symbol: string; direction: string; dayKey: string; entry: number;
    exitPrice: number | null; status: string; confidence: number;
    t1Hit: boolean; pnl: number | null; rMultiple: number | null;
    openedAt: number; closedAt: number | null;
  }[];
}

export interface UniverseInfo {
  baseCount: number;
  removedBase: string[];
  custom: string[];
  effectiveCount: number;
  effective: string[];
}
