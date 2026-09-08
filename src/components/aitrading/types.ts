// ============================================================
// src/components/aitrading/types.ts — AI Trading Terminal types
// (mirrors the server/ai payload shapes 1:1)
// ============================================================

export type Side = 'LONG' | 'SHORT' | 'FLAT';
export type Grade = 'STRONG' | 'ACTION' | 'WATCH' | 'NEUTRAL';
export type MarketKind = 'INDIA' | 'CRYPTO' | 'FUTURES';

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

/** v6.9: a TOP-5 ranked pick — the same AISignal payload plus the
 *  composite score, medal rank and the Hinglish rank reason. */
export interface TopPick extends AISignal {
  rank: number;
  score: number;
  rankReason: string;
}

export interface SignalBoard {
  ok: boolean;
  market: MarketKind;
  marketOpen?: boolean;
  reason?: string;
  regime?: { niftyChange?: number | null; indiaVix?: number | null; btcChange?: number | null };
  breadth?: MarketBreadth;
  /** v6.9: full-universe composite TOP-5 (ranked, scored, reason'd). */
  topFive?: TopPick[];
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
  /** v6.7: probability-of-profit % at expiry (lognormal N(d2) of breakevens) */
  pop?: number | null;
  /** v6.7: sampled expiry payoff curve (per share) for the SVG chart */
  payoff?: { s: number; pnl: number }[];
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
    /** v6.7: gamma-exposure profile (real OI chains only) */
    gex?: GexProfile;
    /** v6.11: OTM put-vs-call IV skew + volume/OI flow (real chains only) */
    skew?: { putIV: number | null; callIV: number | null; value: number | null; read: string };
    flow?: { callVolume: number; putVolume: number; callPutVolRatio: number | null; oiLean: number | null; oiLeanRead: string; read: string };
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
  /** v6.7: concentration guard — max simultaneous open positions (both desks) */
  maxOpenPositions?: number;
}

export interface JournalPosition {
  id: string;
  pair: string;
  symbol?: string;
  market?: 'CRYPTO' | 'INDIA' | 'FUTURES';
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
  /** v6.8: GLOBAL FUTURES fields (USDT domain) */
  notionalUSDT?: number | null;
  marginUSDT?: number | null;
  pnlUSDT?: number | null;
  closePriceUSDT?: number | null;
  unrealizedPnlUSDT?: number | null;
  usdInr?: number | null;
  exchangePositionId?: string | null;
  source?: string | null;
  /** v6.8: 'exchange' when the liquidation level came from CoinDCX itself */
  liquidationSource?: string | null;
}

export interface JournalEntry {
  id: string;
  ts: number;
  kind: string;
  day: string;
  pair?: string;
  side?: string;
  mode?: string;
  market?: string;
  source?: string;
  status: string;
  reason?: string;
  qty?: number;
  price?: number;
  notionalINR?: number;
  notionalUSDT?: number;
  marginUSDT?: number;
  leverage?: number;
  pnlINR?: number;
  pnlUSDT?: number;
  closePrice?: number;
  signal?: { grade?: string; conf?: number; agreement?: number };
}

export interface TradingState {
  ok: boolean;
  config: TradingConfig;
  stats: { day: string; tradesCount: number; realizedPnlINR: number };
  openPositions: number;
  blocked: { killSwitch: boolean; dailyTrades: boolean; dailyLoss: boolean; notConnected: boolean; maxOpenPositions?: boolean };
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
  /** v6.7: backtest-learned gate recommendation (read-only; user applies) */
  learned?: {
    perGrade: Record<string, { n: number; winRate: number | null; avgR: number | null }>;
    currentMinConfidence: number;
    suggestedMinConfidence: number | null;
    recommendation: string;
    changed: boolean;
    disclaimer?: string;
  };
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

// ---------------- v6.7: GEX · swing · whales · ledger · brief ----------------
export interface GexProfile {
  perStrike: { strike: number; netGex: number; cumGex: number }[];
  gammaFlip: number | null;
  callWall: number | null;
  putWall: number | null;
  totalNetGex: number;
  expectedMove: { abs: number | null; pct: number | null; low: number; high: number; method: string };
  regimeNote: string;
}

export interface SwingIdea {
  symbol: string;
  market: MarketKind;
  side: Side;
  grade: 'A' | 'B';
  score: number;
  ltp: number | null;
  rsi: number | null;
  atr: number | null;
  plan: { entry: number; stopLoss: number; target1: number; target2: number; riskPct: number; rewardRisk: number } | null;
  holdDays: string;
  reasons: string[];
  source?: string;
}

export interface SwingBoard {
  ok: boolean;
  market: MarketKind;
  horizon: string;
  ideas: SwingIdea[];
  scanned: number;
  disclaimer?: string;
  generatedAt?: number;
}

export interface WhaleAlert {
  symbol: string;
  market: MarketKind;
  spike: number;
  changePct: number | null;
  ltp: number | null;
  direction: 'ACCUMULATION' | 'DISTRIBUTION';
  obvSlope: number | null;
  note: string;
}

export interface WhaleRadar {
  ok: boolean;
  market: MarketKind;
  whales: WhaleAlert[];
  scanned: number;
  note?: string;
  generatedAt?: number;
}

export interface LedgerEntryLite {
  id: string;
  ts: number;
  market: string;
  symbol: string;
  side: string;
  grade: string | null;
  confidence: number | null;
  mode: string;
  plan: { entry: number; stopLoss: number; target2: number } | null;
  outcome: { ts: number; r: number | null; pnlINR: number | null; reason: string | null; exit: number | null } | null;
  hash: string;
  prevHash: string | null;
}

export interface LedgerView {
  ok: boolean;
  entries: number;
  settled: number;
  open: number;
  wins: number;
  losses: number;
  winRate: number | null;
  headHash: string | null;
  verified: boolean;
  brokenAt: number | null;
  verify?: { ok: boolean; entries: number; brokenAt: number | null };
  recent: LedgerEntryLite[];
}

export interface AdaptiveModelStatus {
  model: string;
  mul: number;
  n: number;
  posterior: number | null;
  hitRate: number | null;
}

export interface MorningBrief {
  ok: boolean;
  asOf: string;
  nseOpen: boolean;
  market: { nifty: number | null; niftyChangePct: number | null; indiaVix: number | null; btc: number | null; btcChangePct: number | null };
  topSignals: {
    india: { symbol: string; side: Side; grade: Grade; confidence: number; ltp: number | null; plan: { entry: number; stopLoss: number; target2: number } | null }[];
    crypto: { symbol: string; side: Side; grade: Grade; confidence: number; ltp: number | null; plan: { entry: number; stopLoss: number; target2: number } | null }[];
  };
  swingTop: { symbol: string; side: Side; grade: string; score: number; ltp: number | null }[];
  whales: WhaleAlert[];
  book: {
    openPositions: { market: string; symbol: string; side: string; mode: string; qty: number; uPnl: number | null; sl: number | null }[];
    todayRealized: number | null;
    tradesToday: number;
    caps: { dailyMaxTrades: number; dailyMaxLossINR: number; maxOpenPositions: number; blocked: Record<string, boolean> };
  };
  ledger?: { entries: number; settled: number; winRate: number | null; verified: boolean };
  adaptive?: { enabled: boolean; learning: AdaptiveModelStatus[] };
  /** v6.11: context-aware "ab kya karein" suggestions (glama oneqaz). */
  nextActions?: NextActionItem[];
  note?: string;
}

export interface OrderbookView {
  ok: boolean;
  symbol: string;
  pair: string;
  bestBid: number;
  bestAsk: number;
  spreadPct: number | null;
  bidVol: number;
  askVol: number;
  imbalancePct: number | null;
  bidWall: { price: number; qty: number };
  askWall: { price: number; qty: number };
  read: string;
  error?: string;
}

// ---------------- v6.8: GLOBAL FUTURES + AGENT + WALLET ----------------

export interface WalletRow {
  currency: string;
  free: number;
  locked: number;
  total: number;
  crossUserMargin?: number | null;
}

export interface WalletView {
  ok: boolean;
  connected: boolean;
  usdInr: number;
  spot: {
    inr: WalletRow | { free: number; locked: number; total: number };
    usdt: WalletRow | { free: number; locked: number; total: number };
    error: string | null;
    rows: WalletRow[];
  };
  futures: {
    usdt: WalletRow | { free: number; locked: number; total: number; crossUserMargin?: number | null };
    error: string | null;
  };
  equityINR: number;
  deployableFuturesUSDT: number;
  deployableSpotINR: number;
  fetchedAt: number;
  error?: string;
}

export interface FuturesMarketRow {
  pair: string;
  base: string;
  last: number;
  mark: number;
  changePct: number | null;
  high: number | null;
  low: number | null;
  volumeUSDT: number | null;
}

export interface FuturesMarketsView {
  ok: boolean;
  count: number;
  markets: FuturesMarketRow[];
  fetchedAt: number;
  error?: string;
}

export interface AgentTradeToday {
  ts: number;
  pair: string;
  side: string;
  mode: string;
  market: string;
  status: string;
  qty: number | null;
  price: number | null;
  leverage: number | null;
  marginUSDT: number | null;
  reason: string | null;
}

export interface AgentLogLine {
  ts: number;
  level: 'info' | 'entry' | 'exit' | 'skip' | 'error' | string;
  text: string;
}

export interface AgentConfig {
  enabled: boolean;
  mode: 'paper' | 'live' | string;
  desks: { futures: boolean; spot: boolean; india: boolean };
  maxTradesPerDay: number;
  minConfidence: number;
  minAgreement: number;
  riskPerTradePct: number;
  maxLeverage: number;
  cooldownMin: number;
  maxHoldMin: number;
  dailyLossCapPct: number;
  minEquityINR: number;
}

export interface AgentOpenPosition {
  id: string;
  pair: string;
  market: string;
  side: string;
  mode: string;
  qty: number;
  entryPrice: number;
  sl: number | null;
  tp2: number | null;
  leverage: number | null;
  marginUSDT: number | null;
  openedAt: number;
  ageMin: number | null;
  maxHoldMin: number;
}

export interface AgentPick {
  symbol: string;
  side: Side;
  grade: string;
  confidence: number;
  ltp: number | null;
  pair: string;
  plan: { entry: number; stopLoss: number; target2: number; riskPct: number } | null;
}

export interface AgentView {
  ok: boolean;
  engine: string;
  config: AgentConfig;
  trading: { mode: string; allowAuto: boolean; killSwitch: boolean; connected: boolean };
  state: {
    running: boolean;
    runningSince: number | null;
    lastScanAt: number | null;
    scans: number;
    lastEntryAt: number | null;
    lastEntryPair: string | null;
    pausedToday: { day: string; reason: string } | null;
    lastWallet: { equityINR: number; usdInr: number; deployableFuturesUSDT: number; deployableSpotINR: number; at: number } | null;
    log: AgentLogLine[];
  };
  today: {
    day: string;
    trades: AgentTradeToday[];
    tradesCount: number;
    maxTrades: number;
    realizedPnlINR: number;
    lossCapINR: number;
    paused: { day: string; reason: string } | null;
  };
  openPositions: AgentOpenPosition[];
  wallet: WalletView | null;
  picks: Partial<Record<'INDIA' | 'FUTURES' | 'CRYPTO', AgentPick[]>>;
}

// ============================================================
// v6.11 — glama Tier-2/3 feature types
// ------------------------------------------------------------

/** Calibration bucket: claimed confidence vs realized win-rate. */
export interface CalibrationBucket {
  bucket: string;
  claimed: number;
  n: number;
  winRate: number | null;
  gap: number | null;
}

export interface MonthlyTrendRow {
  month: string;
  n: number;
  winRate: number;
  avgR: number;
}

export interface TrustReport {
  ok: boolean;
  settled: number;
  sufficient: boolean;
  calibration: CalibrationBucket[];
  brier: number | null;
  brierVerdict: string | null;
  monthly: MonthlyTrendRow[];
  drift?: number | null;
  overall?: { winRate: number; avgConfidence: number };
  note?: string;
}

export interface GovernanceRow {
  model: string;
  n: number;
  hitRate: number | null;
  baseRate: number;
  pValue: number;
  verdict: 'SIGNIFICANT' | 'BORDERLINE' | 'NOISE' | 'NEEDS DATA';
  edge: number | null;
}

export interface GovernanceView {
  ok: boolean;
  settled: number;
  baseRate: number;
  method: string;
  minN: number;
  models: GovernanceRow[];
  note?: string;
}

export interface TrustView {
  ok: boolean;
  calibration: TrustReport;
  governance: GovernanceView;
}

export interface PerfView {
  ok: boolean;
  settled: number;
  sufficient: boolean;
  expectancy?: number | null;
  winRate?: number;
  totalR?: number | null;
  totalPnlINR?: number | null;
  mdd?: { r: number; note: string | null };
  sharpe?: { perTrade: number | null; note?: string };
  sortino?: { perTrade: number | null };
  calmar?: { expectancyOverMdd: number | null; note?: string | null };
  streaks?: { win: number; loss: number };
  profitFactor?: number | null;
  avgWinR?: number | null;
  avgLossR?: number | null;
  equityCurveR?: number[];
  byMarket?: Record<string, { n: number; winRate: number; avgR: number | null; totalR: number | null } | null>;
  byMode?: Record<string, { n: number; winRate: number; avgR: number | null; totalR: number | null } | null>;
  note?: string;
}

export interface CorrAsset { key: string; label: string; group: string }

export interface CorrView {
  ok: boolean;
  window: number;
  assets: CorrAsset[];
  skipped: string[];
  matrix: (number | null)[][];
  top: { mostPositive: { a: string; b: string; r: number }[]; mostNegative: { a: string; b: string; r: number }[] };
  riskLink: { pair: string; r: number; read: string } | null;
  note: string;
}

export interface SectorRow {
  sector: string;
  symbols: number;
  breadth: number;
  avgChangePct: number;
  avgRsi: number;
  mood: 'BULLISH' | 'NEUTRAL' | 'BEARISH';
  indexChangePct: number | null;
  leader: { symbol: string; changePct: number } | null;
  laggard: { symbol: string; changePct: number } | null;
}

export interface ContextChain {
  macro: { niftyChangePct: number | null; vix: number | null; vixRegime: string | null; dollar: number | null; crude: number | null; gold: number | null; bias: string };
  read: string;
  strongest: { sector: string; mood: string; breadth: number; top: { symbol: string; changePct: number; fscore: number }[] }[];
}

export interface FScoreRow {
  symbol: string;
  ltp?: number | null;
  score: number;
  grade: 'A' | 'B' | 'C';
  rsi?: number | null;
  pos52?: number | null;
  adx?: number | null;
}

export interface SectorView {
  ok: boolean;
  universe?: number;
  sectors: SectorRow[];
  chain: ContextChain | null;
  fscore?: {
    top: FScoreRow[];
    bottom: FScoreRow[];
    distribution: { A: number; B: number; C: number };
    disclaimer?: string;
  };
  error?: string;
  note?: string;
}

export interface IncomeRow {
  symbol: string;
  name: string;
  id: string;
  credit: number;
  creditPct: number;
  pop: number | null;
  maxLoss: number | null;
  riskReward: number | null;
  score: number | null;
  breakevens: number[];
  source: string;
  expiry: string;
  exitPlan?: string;
}

export interface IncomeView {
  ok: boolean;
  count: number;
  desksLoaded?: number;
  top: IncomeRow[];
  methodology: string;
  note: string;
}

export interface NextActionItem {
  id: string;
  label: string;
  kind: string;
  market?: string;
  symbol?: string;
}

export interface NextActionsView {
  ok: boolean;
  nseOpen: boolean;
  actions: NextActionItem[];
  followups: string[];
  note?: string;
}

/** Deep-scan regime story (glama explain_ticker). */
export interface NarrativeView {
  title: string;
  story: string[];
  watch: string;
  asOf?: number;
}
