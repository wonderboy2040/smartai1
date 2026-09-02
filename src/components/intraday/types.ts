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
  market?: 'INDIA' | 'CRYPTO';
  exchange?: 'NSE' | 'BSE' | 'BINANCE' | 'COINDCX';
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
  // v4 DUAL-AI EXPERT additions
  grade?: 'A+' | 'A' | 'B';
  tradeType?: 'SCALP' | 'MOMENTUM' | 'SWING' | null;
  entryQuality?: number | null; // 1-10 AI entry-timing score
  aiReasoning?: string;         // full Gemini+Groq reasoning chain
  riskFactors?: string[];
  geminiVerdict?: { confidence: number; note: string } | null;
  groqVerdict?: { confidence: number; note: string } | null;
  aiAdjustedSL?: number | null;
  aiAdjustedEntry?: number | null;
}

export interface MarketRegime {
  market?: 'INDIA' | 'CRYPTO';
  regime: 'BULLISH' | 'BEARISH' | 'NEUTRAL';
  vix: number | null;
  vixLevel: 'LOW' | 'ELEVATED' | 'HIGH' | null;
  niftyChange: number;
  niftyVwapDist: number;
  niftyRsi?: number | null;
  // CRYPTO regime payload (BTC-based) — mirrored keys.
  btcChange?: number;
  btcVwapDist?: number;
  btcRsi?: number | null;
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
  market?: 'INDIA' | 'CRYPTO';
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
  sources?: { tradingView?: number; groww?: number; coindcx?: number };
  marketRegime?: MarketRegime | null;
  freshEntriesAllowed?: boolean;
  deadZone?: boolean;
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
  market?: 'INDIA' | 'CRYPTO';
  direction: 'LONG' | 'SHORT';
  entry: number;
  qty: number;
  remainingQty: number;
  stopLoss: number;
  target1: number | null;
  target2: number | null;
  status: 'OPEN' | 'PARTIAL' | 'CLOSED';
  t1Hit: boolean;
  dayKey?: string;
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

export interface PaperDayStats {
  dayKey: string;
  trades: number;
  wins: number;
  losses: number;
  winRate: number;
  realizedPnl: number;
}

export interface PaperHistory {
  days: number;
  totalClosed: number;
  groups: PaperDayStats[];
  overall: {
    totalTrades: number;
    wins: number;
    losses: number;
    winRate: number;
    avgWin: number;
    avgLoss: number;
    profitFactor: number | null;
    totalPnl: number;
    bestDay: { dayKey: string; pnl: number } | null;
    worstDay: { dayKey: string; pnl: number } | null;
  };
  trades: PaperTrade[];
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
  market?: 'INDIA' | 'CRYPTO';
  baseCount: number;
  removedBase: string[];
  custom: string[];
  effectiveCount: number;
  effective: string[];
}
