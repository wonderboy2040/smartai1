import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { Position, PriceData, TabType, RiskLevel, TransactionType, Transaction, PriceAlert } from '../types';
import {
  DEFAULT_USD_INR, getTodayString, guessMarket, isCryptoSymbol, resolveTvChartSymbol,
  ALPHA_ETFS_IN, ALPHA_ETFS_US,
} from '../utils/constants';
import {
  fetchSinglePrice, batchFetchPrices, batchFetchIndianPrices, getIndiaPollInterval,
  batchFetchUSPrices, getUSPollInterval, fetchForexRateOrNull,
  syncToCloud, loadFromCloud, sendTelegramAlert,
  syncGroqKeyToCloud, loadGroqKeyFromCloud, getBatchInterval, fetchMarketIntelligence,
  syncStateToCloud, loadAppStateFromCloud, CloudAppState,
  apiFetch, setSessionToken, ensureAuthenticated,
  fetchIndmAssets, forceIndmSync, hideIndmAsset, unhideIndmAsset, IndmAssetsResponse,
} from '../utils/api';
import { secureStorage } from '../utils/secureStorage';
import { subscribeToPrices, disconnectPrices, getWebSocketLatency } from '../utils/tvWebsocket';
import { connectLiveStream } from '../utils/liveStream';
import { isAnyMarketOpen, isIndiaMarketOpen, isUSMarketOpen, analyzeAsset, getSmartAllocations, generateDeepAnalysis } from '../utils/telegram';
import { generateWeeklyWealthReport } from '../utils/wealthEngine';
import { applyPortfolioDiff } from '../utils/portfolioDiffEngine';
import { recordDailyPL, computeLiveDailyPL } from '../utils/dailyPLTracker';
import { syncedAssetPnl } from '../utils/assetPnl';

function mergePriceData(existing: PriceData | undefined, incoming: Partial<PriceData>): PriceData {
  if (!existing) {
    return {
      price: incoming.price ?? 0,
      change: incoming.change ?? 0,
      high: incoming.high,
      low: incoming.low,
      volume: incoming.volume,
      rsi: incoming.rsi ?? 50,
      time: incoming.time ?? Date.now(),
      market: incoming.market ?? 'IN',
      sma20: incoming.sma20,
      sma50: incoming.sma50,
      macd: incoming.macd,
      tvExchange: incoming.tvExchange,
      tvExactSymbol: incoming.tvExactSymbol,
      isRealtime: incoming.isRealtime ?? false,
    };
  }

  const existingRealtime = !!existing.isRealtime;
  const incomingRealtime = !!incoming.isRealtime;
  const incomingTime = incoming.time ?? Date.now();

  // 1. If existing is real-time and incoming is NOT real-time:
  // Keep existing real-time price & change, but merge incoming indicators/metadata.
  if (existingRealtime && !incomingRealtime) {
    let changed = false;
    const merged = { ...existing };
    if (incoming.sma20 !== undefined && incoming.sma20 !== existing.sma20) { merged.sma20 = incoming.sma20; changed = true; }
    if (incoming.sma50 !== undefined && incoming.sma50 !== existing.sma50) { merged.sma50 = incoming.sma50; changed = true; }
    if (incoming.rsi !== undefined && incoming.rsi !== existing.rsi) { merged.rsi = incoming.rsi; changed = true; }
    if (incoming.macd !== undefined && incoming.macd !== existing.macd) { merged.macd = incoming.macd; changed = true; }
    if (incoming.tvExchange && incoming.tvExchange !== existing.tvExchange) { merged.tvExchange = incoming.tvExchange; changed = true; }
    if (incoming.tvExactSymbol && incoming.tvExactSymbol !== existing.tvExactSymbol) { merged.tvExactSymbol = incoming.tvExactSymbol; changed = true; }
    if (incoming.high !== undefined && (existing.high === undefined || incoming.high > existing.high)) { merged.high = incoming.high; changed = true; }
    if (incoming.low !== undefined && (existing.low === undefined || incoming.low < existing.low)) { merged.low = incoming.low; changed = true; }
    if (incoming.volume !== undefined && incoming.volume > (existing.volume || 0)) { merged.volume = incoming.volume; changed = true; }
    return changed ? merged : existing;
  }

  // 2. Freshness check: Reject incoming if it's older than existing data (unless upgrading to real-time)
  const isStale = existing.time && incomingTime < existing.time - 500;
  if (isStale && !incomingRealtime) {
    return existing;
  }

  // 3. Price & change updates
  const price = (incoming.price !== undefined && incoming.price > 0 && (!isStale || incomingRealtime))
    ? incoming.price
    : existing.price;

  const change = (incoming.change !== undefined && (!isStale || incomingRealtime))
    ? incoming.change
    : existing.change;

  const time = Math.max(existing.time || 0, incomingTime);
  const isRealtime = incomingRealtime || existingRealtime;

  const rsi = incoming.rsi ?? existing.rsi ?? 50;
  const sma20 = incoming.sma20 ?? existing.sma20;
  const sma50 = incoming.sma50 ?? existing.sma50;
  const macd = incoming.macd ?? existing.macd;
  const high = incoming.high ?? existing.high;
  const low = incoming.low ?? existing.low;
  const volume = incoming.volume ?? existing.volume;
  const tvExchange = incoming.tvExchange ?? existing.tvExchange;
  const tvExactSymbol = incoming.tvExactSymbol ?? existing.tvExactSymbol;
  const market = incoming.market ?? existing.market ?? 'IN';

  // Equality check to avoid redundant re-renders
  if (
    existing.price === price &&
    existing.change === change &&
    existing.isRealtime === isRealtime &&
    existing.rsi === rsi &&
    existing.sma20 === sma20 &&
    existing.sma50 === sma50 &&
    existing.macd === macd &&
    existing.high === high &&
    existing.low === low &&
    existing.volume === volume
  ) {
    return existing;
  }

  return { price, change, high, low, volume, rsi, time, market, sma20, sma50, macd, tvExchange, tvExactSymbol, isRealtime };
}

type IndmSyncMeta = Omit<IndmAssetsResponse, 'assets'>;

// Default crypto universe (dashboard widgets) — the poller unions this with
// any crypto symbols present in the synced portfolio (dynamic INDMoney coins).
const DEFAULT_CRYPTO_SYMBOLS = ['BTC', 'ETH', 'SOL', 'BNB', 'XRP', 'DOGE', 'ADA', 'AVAX', 'DOT', 'MATIC', 'LINK', 'UNI'];

// Stable pseudo-symbol for INDMoney assets without an exchange symbol
// (mutual funds, FDs, bonds…). Used as the livePrices key + table badge;
// those assets are `noLive` (NAV-priced by INDMoney, not exchange-quoted).
function indmPseudoSymbol(name: string, used: Set<string>): string {
  const STOP = new Set(['LTD', 'LIMITED', 'THE', 'OF', 'AND', 'INC', 'PLC', 'COMPANY', 'INDIA']);
  const words = String(name || 'ASSET').replace(/[^A-Za-z0-9\s]/g, ' ').split(/\s+/).filter(Boolean);
  const meaningful = words.filter(w => !STOP.has(w.toUpperCase()));
  let base = (meaningful.length ? meaningful : words).map(w => w.toUpperCase()).join('').slice(0, 10) || 'ASSET';
  if (!/^[A-Z]/.test(base)) base = `A${base.slice(0, 9)}`;
  let out = base; let n = 1;
  while (used.has(out)) out = `${base.slice(0, 8)}${n++}`;
  used.add(out);
  return out;
}

export function useAppState() {
  // --- Auth ---
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [pinInput, setPinInput] = useState('');

  // --- Core State ---
  const [activeTab, setActiveTab] = useState<TabType>('dashboard');
  const [portfolio, setPortfolio] = useState<Position[]>([]);
  // --- Transaction ledger (buy/sell history → monthly analytics & return reports) ---
  const [transactions, setTransactions] = useState<Transaction[]>(() => {
    try { const s = secureStorage.getItem('txn_history'); return s ? JSON.parse(s) : []; } catch { return []; }
  });
  // --- Price alerts (target / stop-loss → Telegram) ---
  const [priceAlerts, setPriceAlerts] = useState<PriceAlert[]>(() => {
    try { const s = secureStorage.getItem('price_alerts'); return s ? JSON.parse(s) : []; } catch { return []; }
  });
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [livePrices, setLivePrices] = useState<Record<string, PriceData>>({});
  const [usdInrRate, setUsdInrRate] = useState(DEFAULT_USD_INR);
  const usdInrRateRef = useRef(DEFAULT_USD_INR);
  useEffect(() => { usdInrRateRef.current = usdInrRate; }, [usdInrRate]);

  // v5.2 APP-PARITY FX: INDMoney's app shows the US Invested in USD at ITS
  // own internal rate (~buy-time FX), not the live rate — so the site's 🦅
  // invested/P&L can differ from the app purely by FX-rate choice. The user
  // calibrates ONCE ("Match App": enters the app's USD invested → the implied
  // rate is stored here); null = live rate (legacy behavior). Persisted in
  // localStorage so it survives reloads.
  const [usdAppRate, setUsdAppRateState] = useState<number | null>(() => {
    const raw = secureStorage.getItem('usdAppRate');
    const n = Number(raw);
    return raw != null && Number.isFinite(n) && n > 50 && n < 150 ? n : null;
  });
  const usdAppRateRef = useRef<number | null>(usdAppRate);
  useEffect(() => { usdAppRateRef.current = usdAppRate; }, [usdAppRate]);
  const setUsdAppRate = useCallback((v: number | null) => {
    const safe = v != null && Number.isFinite(v) && v > 50 && v < 150 ? v : null;
    usdAppRateRef.current = safe;
    setUsdAppRateState(safe);
    try {
      if (safe == null) secureStorage.removeItem('usdAppRate');
      else secureStorage.setItem('usdAppRate', String(safe));
    } catch { /* quota */ }
  }, []);

  const [theme, setTheme] = useState<'dark' | 'light'>(() => (secureStorage.getItem('theme') as 'dark' | 'light') || 'dark');
  const [currentSymbol, setCurrentSymbol] = useState('');
  const [currentMarket, setCurrentMarket] = useState<'IN' | 'US'>('IN');
  const [symbolInput, setSymbolInput] = useState('');
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [chartInterval, setChartInterval] = useState('D');
  const [liveStatus, setLiveStatus] = useState('Connecting...');
  const [feedStatus, setFeedStatus] = useState<Record<string, boolean>>({});
  // 2026 perf audit (H4): ref mirror so the sync loop can check SSE health
  // without re-arming on every status update.
  const feedStatusRef = useRef<Record<string, boolean>>({});
  const setFeedStatusTracked = useCallback((s: Record<string, boolean>) => {
    feedStatusRef.current = s;
    setFeedStatus(s);
  }, []);
  const [syncStatus, setSyncStatus] = useState('');

  // --- Planner ---
  const [indiaSIP, setIndiaSIP] = useState(10000);
  const [usSIP, setUsSIP] = useState(5000);
  const [btcSIP, setBtcSIP] = useState(1000);
  const [ethSIP, setEthSIP] = useState(500);
  const [emergencyFund, setEmergencyFund] = useState(50000);
  const [investYears, setInvestYears] = useState(15);
  const [riskLevel, setRiskLevel] = useState<RiskLevel>('medium');
  const [monthlyExpenses, setMonthlyExpenses] = useState(50000);
  const [currentAge, setCurrentAge] = useState(30);
  // USA SIP frequency (monthly/quarterly) — lives here (not in the widget)
  // so it participates in cloud-state sync and survives cache clears.
  const [usFrequency, setUsFrequencyState] = useState<'monthly' | 'quarterly'>(() => {
    try {
      const s = secureStorage.getItem('plan_tracker_us_freq');
      return s === 'quarterly' ? 'quarterly' : 'monthly';
    } catch { return 'monthly'; }
  });
  const setUsFrequency = useCallback((f: 'monthly' | 'quarterly') => {
    setUsFrequencyState(f);
    try { secureStorage.setItem('plan_tracker_us_freq', f); } catch { /* noop */ }
  }, []);
  // Cloud app-state sync status ("☁️ Saved" / "Syncing…" etc.)
  const [stateSyncStatus, setStateSyncStatus] = useState('');

  // --- Sector ---
  const [sectorData, setSectorData] = useState<{ name: string; change: number }[]>([]);

  // --- Modal ---
  const [showAddModal, setShowAddModal] = useState(false);

  const [aiKeys, setAiKeys] = useState<{
    groqKey: string;
    tavilyKey: string;
    tgToken: string;
    tgChatId: string;
  }>(() => {
    try {
      const saved = secureStorage.getItem('WEALTH_AI_KEYS');
      if (saved) return JSON.parse(saved);
    } catch { }
    return {
      groqKey: secureStorage.getItem('WEALTH_AI_GROQ') || '',
      tavilyKey: secureStorage.getItem('WEALTH_AI_TAVILY') || '',
      tgToken: secureStorage.getItem('TG_TOKEN') || '',
      tgChatId: secureStorage.getItem('TG_CHAT_ID') || ''
    };
  });

  const groqKey = aiKeys.groqKey;

  const updateAiKeys = useCallback((newKeys: Partial<typeof aiKeys>) => {
    setAiKeys(prev => {
      const updated = { ...prev, ...newKeys };
      secureStorage.setItem('WEALTH_AI_KEYS', JSON.stringify(updated));
      if (updated.groqKey) secureStorage.setItem('WEALTH_AI_GROQ', updated.groqKey);
      if (updated.tavilyKey) secureStorage.setItem('WEALTH_AI_TAVILY', updated.tavilyKey);
      if (updated.tgToken) secureStorage.setItem('TG_TOKEN', updated.tgToken);
      if (updated.tgChatId) secureStorage.setItem('TG_CHAT_ID', updated.tgChatId);

      const serialized = JSON.stringify(updated);
      syncGroqKeyToCloud(serialized).catch(() => { });
      return updated;
    });
  }, []);
  const [addSymbol, setAddSymbol] = useState('');
  const [addQty, setAddQty] = useState('');
  const [addPrice, setAddPrice] = useState('');
  const [addDate, setAddDate] = useState(getTodayString());

  const [transactionType, setTransactionType] = useState<TransactionType>('buy');
  const [modalPrice, setModalPrice] = useState<{ price: number; change: number; market: string } | null>(null);
  const [editId, setEditId] = useState<string | null>(null);
  // FIX: Default OFF to avoid duplicate Telegram alerts — the 24x7 bot already
  // handles auto-alerts server-side. User can manually toggle ON from the UI.
  const [autoTelegram, setAutoTelegram] = useState(false);

  // --- Advanced ---
  const [wsLatency, setWsLatency] = useState<{ avg: number; heartbeat: number }>({ avg: 45, heartbeat: 15000 });
  const [portfolioContextText, setPortfolioContextText] = useState<string>('');

  // --- Refs ---
  const priceFlushRef = useRef<number | null>(null);
  const chartContainerRef = useRef<HTMLDivElement>(null);
  const tvWidgetRef = useRef<any>(null);
  const telegramIntervalRef = useRef<number | null>(null);
  const forexIntervalRef = useRef<number | null>(null);
  const syncIntervalRef = useRef<number | null>(null);
  const initialTimeoutRef = useRef<number | ReturnType<typeof setTimeout> | null>(null);
  const cloudSyncTimerRef = useRef<number | null>(null);
  const cloudLoadTimerRef = useRef<number | null>(null);
  const lastLocalSaveRef = useRef(0);
  const pendingPricesRef = useRef<Record<string, PriceData>>({});
  const portfolioRef = useRef(portfolio);
  const livePricesRef = useRef(livePrices);
  const transactionsRef = useRef(transactions);
  const priceAlertsRef = useRef(priceAlerts);
  const latestDataRef = useRef({ portfolio, livePrices, usdInrRate });

  useEffect(() => { portfolioRef.current = portfolio; }, [portfolio]);
  // NOTE (v5.0): livePrices is NO LONGER synced state→ref here. The flush path
  // keeps livePricesRef authoritative (ref-first merge); React state is a
  // throttled, display-gated mirror. A state→ref sync effect would roll the
  // ref BACKWARD to the throttled state and lose fresher merged ticks.
  useEffect(() => { transactionsRef.current = transactions; }, [transactions]);
  useEffect(() => { priceAlertsRef.current = priceAlerts; }, [priceAlerts]);

  const portfolioSymbolKey = useMemo(() => portfolio.map(p => p.symbol).sort().join(','), [portfolio]);

  // --- Flush prices (v5.0 lag fix) ------------------------------------------
  // WAS: a plain setState every 250ms — every crypto wiggle (24/7) produced a
  // NEW livePrices identity → the whole context value rebuilt → ALL useApp()
  // consumers re-rendered up to 4×/sec forever (typing/scroll/chart stutter).
  // NOW: ref-first + display-precision gate + 1s throttle + hidden gate:
  //   • livePricesRef is ALWAYS fresh (pollers, P&L, AI context read it);
  //   • React state updates at most 1×/s, only when a DISPLAYED value
  //     (price/change at 2dp) actually changed;
  //   • sub-display wiggles and background tabs cost ZERO React work.
  // ---------------------------------------------------------------------------
  const priceFlushLastAtRef = useRef(0);
  const priceFlushTimerRef = useRef<number | null>(null);
  const priceHiddenDirtyRef = useRef(false);
  const pricePersistSnapRef = useRef<Record<string, PriceData> | null>(null);

  const flushPricesToStorage = useCallback(() => {
    const batched = pendingPricesRef.current;
    const keys = Object.keys(batched);
    if (keys.length === 0) return;
    pendingPricesRef.current = {};

    const base = livePricesRef.current || {};
    const merged = { ...base };
    let displayChanged = false;
    for (const key of keys) {
      const existing = merged[key] as PriceData | undefined;
      const result = mergePriceData(existing, batched[key]);
      if (result !== existing) {
        if (
          !existing ||
          Math.round((existing.price ?? 0) * 100) !== Math.round((result.price ?? 0) * 100) ||
          Math.round((existing.change ?? 0) * 100) !== Math.round((result.change ?? 0) * 100)
        ) displayChanged = true;
        merged[key] = result;
      }
    }
    // Ref = single source of truth (objects are never mutated after publish).
    livePricesRef.current = merged;
    pricePersistSnapRef.current = merged;

    const persist = () => {
      const now = Date.now();
      if (now - lastLocalSaveRef.current > 30000) {
        lastLocalSaveRef.current = now;
        const snap = pricePersistSnapRef.current;
        if (snap) { try { secureStorage.setItem('livePrices', JSON.stringify(snap)); } catch { /* quota */ } }
      }
    };

    // Sub-display wiggle → no React work at all (refs stay fresh).
    if (!displayChanged) { persist(); return; }

    // Background tab → refs only; React catches up on visibility return.
    if (document.hidden) { priceHiddenDirtyRef.current = true; persist(); return; }

    const now = Date.now();
    if (now - priceFlushLastAtRef.current < 900) {
      // Too soon — schedule ONE trailing flush so the newest tick always lands.
      if (priceFlushTimerRef.current == null) {
        priceFlushTimerRef.current = window.setTimeout(() => {
          priceFlushTimerRef.current = null;
          priceFlushLastAtRef.current = Date.now();
          setLivePrices(livePricesRef.current);
        }, 900 - (now - priceFlushLastAtRef.current));
      }
      return;
    }
    priceFlushLastAtRef.current = now;
    setLivePrices(livePricesRef.current);
  }, []);

  // --- Initialize ---
  // On page load, restore the session IMMEDIATELY (no async wait). If we have
  // a token, set isAuthenticated=true right away so data loading starts
  // instantly. Then verify in the background — if the token is expired, we'll
  // gracefully logout. This fixes the "empty portfolio after refresh" bug
  // where the async auth check blocked loadFromCloud() from running.
  useEffect(() => {
    const auth = secureStorage.getItem('authDone');
    if (auth !== 'true') return;

    // Restore token from sessionStorage OR localStorage.
    const token = (() => {
      try {
        return sessionStorage.getItem('wealthai_session_token') || localStorage.getItem('wealthai_session_token');
      } catch { return null; }
    })();

    if (!token) {
      // No token — force re-login.
      console.warn('🔒 Session token missing — forcing re-login.');
      secureStorage.removeItem('authDone');
      setIsAuthenticated(false);
      return;
    }

    // We have a token — restore it and authenticate IMMEDIATELY (no await).
    // This lets loadFromCloud() and price fetching start right away.
    setSessionToken(token);
    setIsAuthenticated(true);

    // Verify in the background. If invalid, logout gracefully (but don't
    // block the initial data load).
    ensureAuthenticated().then(valid => {
      if (!valid) {
        console.warn('🔒 Session token expired — forcing re-login.');
        secureStorage.removeItem('authDone');
        setSessionToken(null);
        setIsAuthenticated(false);
      }
    });
  }, []);

  const skipNextCloudSaveRef = useRef(false);

  // ============================================================
  // INDMoney synced ASSET TABLE (the portfolio's source of truth)
  // ------------------------------------------------------------
  // The manual assets table + Google Sheets sync are REPLACED by the
  // server-side 2×-daily INDMoney MCP sync while connected:
  //   • assets  → Position[] (the grouped INDIA / USA / Crypto table)
  //   • prices  → live exchange quotes for stock/ETF/crypto assets; MF/
  //     FD/bond assets keep INDMoney's own unit price (NAV), seeded here
  //     and refreshed on each scheduled sync.
  //   • Google Sheets cloud sync (load AND save) is fully disconnected
  //     while a sync source is active — the Sheet can never overwrite or
  //     pollute the synced portfolio.
  // ============================================================
  // indmSource: which engine drives the ASSET TABLE — 'indmoney' (MCP
  // holdings, INDMoney connected), 'coindcx' (only the crypto exchange
  // account is connected), 'manual' (no source — manual/Sheets mode),
  // 'unknown' (first probe still running).
  const [indmSource, setIndmSource] = useState<'unknown' | 'indmoney' | 'coindcx' | 'manual'>('unknown');
  const [indmMeta, setIndmMeta] = useState<IndmSyncMeta | null>(null);
  const [indmSyncing, setIndmSyncing] = useState(false);
  const indmActiveRef = useRef(false);
  const indmBusyRef = useRef(false);
  // Mirror for the 90s AI-context generator (it runs in an interval closure
  // that must see the LATEST sync status without re-subscribing).
  const indmMetaRef = useRef<IndmSyncMeta | null>(null);
  useEffect(() => { indmMetaRef.current = indmMeta; }, [indmMeta]);

  const loadIndmAssets = useCallback(async (force = false): Promise<boolean> => {
    if (indmBusyRef.current) return false;
    indmBusyRef.current = true;
    setIndmSyncing(true);
    try {
      const data = force ? await forceIndmSync() : await fetchIndmAssets();
      if (!data) {
        // Network/server error — keep current state; only resolve unknown.
        setIndmSource(prev => (prev === 'unknown' ? 'manual' : prev));
        return false;
      }
      const { assets, ...meta } = data;
      setIndmMeta(meta as IndmSyncMeta);
      if (data.ok && Array.isArray(assets) && assets.length > 0) {
        indmActiveRef.current = true;
        // Full power = INDMoney MCP; crypto-only = CoinDCX exchange account.
        setIndmSource(data.sources?.indmoney ? 'indmoney' : 'coindcx');

        const used = new Set<string>();
        const positions: Position[] = assets.map(a => ({
          id: a.id,
          symbol: a.symbol || indmPseudoSymbol(a.name, used),
          market: a.market === 'US' ? ('US' as const) : ('IN' as const),
          qty: a.qty > 0 ? a.qty : 1,
          avgPrice: a.avgPrice ?? a.lastPrice ?? 0,
          leverage: 1,
          dateAdded: data.syncedAt ? new Date(data.syncedAt).toISOString().slice(0, 10) : getTodayString(),
          name: a.name,
          noLive: a.noLive,
          indmKey: a.key,
          source: a.source === 'coindcx' ? 'coindcx' : (a.source ? 'indmoney' : undefined),
          // Ground-truth INR invested from the sync snapshot — the metrics use
          // this so US rows never mix sync-time FX with live FX (the deep P&L
          // mismatch fix: Capital Deployed / Total P&L now stay coherent).
          indmInvestedINR: typeof a.invested === 'number' ? a.invested : undefined,
          // EXACT-MATCH P&L anchors (v4.4): INDMoney's own pnl/pnlPct + the
          // per-unit sync price. assetPnl.ts grounds every row's P&L on
          // these + the live-tick delta, so Total P&L / Unrealized P&L match
          // the INDMoney app (USA $ / India ₹) exactly right after a sync.
          indmPnlINR: typeof a.pnl === 'number' ? a.pnl : undefined,
          indmPnlPct: typeof a.pnlPct === 'number' ? a.pnlPct : undefined,
          indmLastPrice: typeof a.lastPrice === 'number' && a.lastPrice > 0 ? a.lastPrice : undefined,
        }));
        setPortfolio(positions);
        try { secureStorage.setItem('portfolio', JSON.stringify(positions)); } catch { /* quota */ }

        // Seed prices so values render instantly; the live pollers/SSE take
        // over within seconds for exchange-listed assets. A seed NEVER
        // overwrites a live quote and refreshes stale seeds (older sync).
        const seeds: Record<string, PriceData> = {};
        assets.forEach((a, i) => {
          const p = positions[i];
          if (a.lastPrice == null || !(a.lastPrice > 0)) return;
          const seedChange = a.oneDayChangePct ?? 0;
          seeds[`${p.market}_${p.symbol}`] = {
            price: a.lastPrice,
            change: seedChange,
            high: a.lastPrice, low: a.lastPrice, volume: 0,
            rsi: 50, time: Date.now(), market: p.market, isRealtime: false,
            // Seed day baseline from INDMoney's 1-day change % so NAV rows
            // (and live rows during the seconds before the first tick) still
            // show a meaningful Today's P&L.
            prevClose: seedChange > -100 ? a.lastPrice / (1 + seedChange / 100) : undefined,
          };
        });
        if (Object.keys(seeds).length > 0) {
          // v5.0: merge ref-first (state may be a throttled mirror of the ref).
          const next = { ...(livePricesRef.current || {}) };
          let changed = false;
          for (const [k, v] of Object.entries(seeds)) {
            const ex = next[k];
            if (!ex || (!ex.isRealtime && Date.now() - (ex.time || 0) > 5 * 60_000)) { next[k] = v; changed = true; }
          }
          if (changed) { livePricesRef.current = next; setLivePrices(next); }
        }
        console.log(`🏦 Synced assets: ${positions.length} loaded (${data.counts?.live ?? 0} live-priced, ${data.counts?.noLive ?? 0} NAV-priced${data.counts?.coindcx ? `, ${data.counts.coindcx} CoinDCX` : ''}${data.hiddenCount ? `, ${data.hiddenCount} removed` : ''})`);
        return true;
      }
      // Not connected / empty → manual mode (Sheets paths may resume).
      // EXCEPTION: all rows removed by the user ('all-hidden') — a source
      // is still connected, so the table stays in synced mode (empty table
      // + restore bar) instead of falling back to manual entry.
      indmActiveRef.current = false;
      if (data.reason === 'all-hidden' && (data.sources?.indmoney || data.sources?.coindcx)) {
        indmActiveRef.current = true;
        setIndmSource(data.sources?.indmoney ? 'indmoney' : 'coindcx');
        setPortfolio([]);
        try { secureStorage.setItem('portfolio', '[]'); } catch { /* quota */ }
        return false;
      }
      if (data.reason === 'not-connected') setIndmSource('manual');
      return false;
    } finally {
      indmBusyRef.current = false;
      setIndmSyncing(false);
    }
  }, []);

  // --- REMOVE a synced asset row (INDIA / USA / Crypto — any source) ---
  // Server marks the key hidden (persists across 2×-daily syncs); the
  // frontend optimistically drops the row so the UI never waits on the
  // re-fetch. Restore is always available while the row still exists.
  const removeIndmAsset = useCallback(async (key: string | undefined): Promise<boolean> => {
    if (!key) return false;
    const ok = await hideIndmAsset(key);
    if (ok) {
      setPortfolio(prev => prev.filter(p => p.indmKey !== key));
      setIndmMeta(prev => (prev ? { ...prev, hiddenCount: (prev.hiddenCount || 0) + 1 } : prev));
      // Cheap GET refresh so the RESTORE bar (hiddenAssets list) appears
      // immediately — the server already persisted the hidden key.
      void loadIndmAssets();
    }
    return ok;
  }, [loadIndmAssets]);

  // --- Restore a removed synced asset row (single key, or all). ---
  const restoreIndmAsset = useCallback(async (key?: string, all = false): Promise<boolean> => {
    if (!key && !all) return false;
    const ok = await unhideIndmAsset(key || '', all);
    if (ok) await loadIndmAssets(); // cheap GET — server returns the visible set
    return ok;
  }, [loadIndmAssets]);

  // --- Reusable cloud load: pulls from Google Sheets and updates state ---
  // Sets skipNextCloudSaveRef to true so loading FROM cloud doesn't trigger auto-save BACK to cloud.
  // DISCONNECTED while INDMoney is the portfolio source (ref guard also covers
  // the race where synced assets land mid-flight).
  const mergeCloudData = useCallback(() => {
    if (indmActiveRef.current) return Promise.resolve(false);
    return loadFromCloud().then(data => {
      if (indmActiveRef.current) return false; // INDMoney assets landed — Sheets must not overwrite
      if (data && data.length > 0) {
        skipNextCloudSaveRef.current = true;
        setPortfolio(data);
        try { secureStorage.setItem('portfolio', JSON.stringify(data)); } catch { }
        console.log(`☁️ Cloud Sync: loaded ${data.length} positions directly from Google Sheets`);
        return true;
      } else {
        console.log('☁️ Cloud Sync: no cloud data — keeping local portfolio');
        return false;
      }
    }).catch(() => false);
  }, []);

  // --- Load data on auth ---
  // FIX: Load local FIRST (instant render), then cloud sync in background.
  // Previously cloud sync was awaited before rendering → 2-5s blank screen.
  // Now: local loads synchronously → user sees portfolio immediately →
  // cloud sync merges in background (1-3s later).
  useEffect(() => {
    if (!isAuthenticated) return;

    // 1) LOCAL — instant (synchronous localStorage read)
    try {
      const saved = secureStorage.getItem('portfolio');
      if (saved) {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed) && parsed.length > 0) {
          setPortfolio(parsed);
          console.log(`📁 Local: loaded ${parsed.length} positions instantly`);
        }
      }
      const savedPrices = secureStorage.getItem('livePrices');
      if (savedPrices) {
        const parsed = JSON.parse(savedPrices);
        livePricesRef.current = parsed;
        setLivePrices(parsed);
      }
    } catch (e) { console.warn('Failed to load local state:', e); }

    // 1.5) INDMoney — the ASSET TABLE source of truth. Kicked off BEFORE
    // the Sheets fallback so synced assets win the race; the cloud merge
    // self-cancels (ref guard) if assets land mid-flight.
    void loadIndmAssets();

    // 2) CLOUD — background fetch, merge when ready (manual mode only)
    // Fire immediately (don't await) so the UI renders local data first.
    mergeCloudData().then(success => {
      if (!success) {
        // Retry once after 3.5s in case backend server was waking up from cold sleep
        setTimeout(() => {
          mergeCloudData();
        }, 3500);
      }
    });
    loadGroqKeyFromCloud().then(cloudKey => {
      if (cloudKey) {
        if (cloudKey.startsWith('{') && cloudKey.endsWith('}')) {
          try {
            const parsed = JSON.parse(cloudKey);
            setAiKeys(parsed);
            secureStorage.setItem('WEALTH_AI_KEYS', cloudKey);
            if (parsed.groqKey) secureStorage.setItem('WEALTH_AI_GROQ', parsed.groqKey);
            if (parsed.tavilyKey) secureStorage.setItem('WEALTH_AI_TAVILY', parsed.tavilyKey);
            if (parsed.tgToken) secureStorage.setItem('TG_TOKEN', parsed.tgToken);
            if (parsed.tgChatId) secureStorage.setItem('TG_CHAT_ID', parsed.tgChatId);
          } catch (e) {
            setAiKeys(prev => {
              const updated = { ...prev, groqKey: cloudKey };
              secureStorage.setItem('WEALTH_AI_KEYS', JSON.stringify(updated));
              secureStorage.setItem('WEALTH_AI_GROQ', cloudKey);
              return updated;
            });
          }
        } else {
          setAiKeys(prev => {
            const updated = { ...prev, groqKey: cloudKey };
            secureStorage.setItem('WEALTH_AI_KEYS', JSON.stringify(updated));
            secureStorage.setItem('WEALTH_AI_GROQ', cloudKey);
            return updated;
          });
        }
      } else {
        const localKeys = secureStorage.getItem('WEALTH_AI_KEYS');
        if (localKeys) {
          syncGroqKeyToCloud(localKeys).catch(() => { });
        } else {
          const oldGroq = secureStorage.getItem('WEALTH_AI_GROQ');
          if (oldGroq) {
            const initial = {
              groqKey: oldGroq,
              tavilyKey: secureStorage.getItem('WEALTH_AI_TAVILY') || '',
              tgToken: secureStorage.getItem('TG_TOKEN') || '',
              tgChatId: secureStorage.getItem('TG_CHAT_ID') || ''
            };
            syncGroqKeyToCloud(JSON.stringify(initial)).catch(() => { });
          }
        }
      }
    }).catch(() => {
      try {
        const saved = secureStorage.getItem('WEALTH_AI_KEYS');
        if (saved) setAiKeys(JSON.parse(saved));
      } catch { }
    });
  // FIX (audit M6): on total forex failure, fetchForexRate returns the stale
    // DEFAULT_USD_INR (83.5) — writing that into state would overwrite the last
    // good rate and skew all USD→INR math. Use the null-variant and keep the
    // current rate when no source responds.
    fetchForexRateOrNull().then(rate => { if (rate != null) setUsdInrRate(rate); });

    try {
      const p = secureStorage.getItem('plannerSettings');
      if (p) {
        const s = JSON.parse(p);
        if (s.indiaSIP) setIndiaSIP(s.indiaSIP);
        if (s.usSIP) setUsSIP(s.usSIP);
        if (s.btcSIP) setBtcSIP(s.btcSIP);
        if (s.ethSIP) setEthSIP(s.ethSIP);
        if (s.investYears) setInvestYears(s.investYears);
        if (s.riskLevel) setRiskLevel(s.riskLevel);
        if (s.emergencyFund) setEmergencyFund(s.emergencyFund);
        if (s.currentAge) setCurrentAge(s.currentAge);
        if (s.monthlyExpenses) setMonthlyExpenses(s.monthlyExpenses);
      }
    } catch (e) { console.warn('Failed to load planner settings:', e); }
  }, [isAuthenticated]);

  // --- Persist planner ---
  useEffect(() => {
    if (!isAuthenticated) return;
    secureStorage.setItem('plannerSettings', JSON.stringify({ indiaSIP, usSIP, btcSIP, ethSIP, investYears, riskLevel, emergencyFund, currentAge, monthlyExpenses }));
  }, [indiaSIP, usSIP, btcSIP, ethSIP, investYears, riskLevel, emergencyFund, currentAge, monthlyExpenses, isAuthenticated]);

  // ============================================================
  // CLOUD APP-STATE SYNC
  // ------------------------------------------------------------
  // Everything the Monthly Plan Tracker + Planner needs survives a
  // browser cache/cookie clear: SIP settings, USA frequency,
  // transaction ledger and price alerts are pushed to Google Sheets
  // via /api/state/save and restored on login when cloud is newer.
  // ============================================================
  const cloudSaveTimerRef = useRef<number | null>(null);
  const lastSavedFingerprintRef = useRef('');
  const skipNextStateSaveRef = useRef(false);

  const buildCloudState = useCallback((): CloudAppState => ({
    v: 1,
    savedAt: Date.now(),
    plannerSettings: { indiaSIP, usSIP, btcSIP, ethSIP, investYears, riskLevel, emergencyFund, currentAge, monthlyExpenses },
    usFrequency,
    transactions,
    priceAlerts,
  }), [indiaSIP, usSIP, btcSIP, ethSIP, investYears, riskLevel, emergencyFund, currentAge, monthlyExpenses, usFrequency, transactions, priceAlerts]);

  // Change-detection fingerprint — EXCLUDES savedAt (fresh Date.now() per
  // build would otherwise make every comparison differ → redundant saves
  // on every tab hide / debounce tick).
  const cloudStateFingerprint = useCallback((s: CloudAppState): string => {
    const { savedAt, ...rest } = s;
    void savedAt;
    return JSON.stringify(rest);
  }, []);

  const applyCloudState = useCallback((s: CloudAppState) => {
    const p = s.plannerSettings as Record<string, number | string> | undefined;
    if (p) {
      if (typeof p.indiaSIP === 'number' && p.indiaSIP > 0) setIndiaSIP(p.indiaSIP);
      if (typeof p.usSIP === 'number' && p.usSIP > 0) setUsSIP(p.usSIP);
      if (typeof p.btcSIP === 'number' && p.btcSIP > 0) setBtcSIP(p.btcSIP);
      if (typeof p.ethSIP === 'number' && p.ethSIP > 0) setEthSIP(p.ethSIP);
      if (typeof p.investYears === 'number' && p.investYears > 0) setInvestYears(p.investYears);
      if (p.riskLevel === 'low' || p.riskLevel === 'medium' || p.riskLevel === 'high') setRiskLevel(p.riskLevel);
      if (typeof p.emergencyFund === 'number' && p.emergencyFund > 0) setEmergencyFund(p.emergencyFund);
      if (typeof p.currentAge === 'number' && p.currentAge > 0) setCurrentAge(p.currentAge);
      if (typeof p.monthlyExpenses === 'number' && p.monthlyExpenses > 0) setMonthlyExpenses(p.monthlyExpenses);
    }
    if (s.usFrequency === 'monthly' || s.usFrequency === 'quarterly') setUsFrequency(s.usFrequency);
    if (Array.isArray(s.transactions)) setTransactions(s.transactions as Transaction[]);
    if (Array.isArray(s.priceAlerts)) setPriceAlerts(s.priceAlerts as PriceAlert[]);
  }, [setUsFrequency]);

  // Restore from cloud on login — only when cloud is NEWER than what we
  // last applied locally (tracked via 'cloud_state_ts'). After a cache
  // clear the local ts is gone → cloud always wins → nothing is lost.
  // Google Sheets is DISCONNECTED while a sync source drives the asset table.
  useEffect(() => {
    if (!isAuthenticated || indmSource === 'unknown' || indmSource === 'indmoney' || indmSource === 'coindcx') return;
    let cancelled = false;
    loadAppStateFromCloud().then(cloud => {
      if (cancelled || !cloud) return;
      let localTs = 0;
      try { localTs = parseInt(secureStorage.getItem('cloud_state_ts') || '0', 10) || 0; } catch { /* noop */ }
      const cloudTs = cloud.savedAt || 0;
      if (cloudTs > localTs) {
        skipNextStateSaveRef.current = true; // don't echo the restore back up
        applyCloudState(cloud);
        try { secureStorage.setItem('cloud_state_ts', String(cloudTs)); } catch { /* noop */ }
        console.log(`☁️ State Sync: restored app state from Google Sheets (saved ${new Date(cloudTs).toLocaleString()})`);
      }
      // Seed the dedupe fingerprint so the first debounced save doesn't fire
      // needlessly when nothing changed.
      lastSavedFingerprintRef.current = cloudStateFingerprint(buildCloudState());
    }).catch(() => { /* offline — local data stays */ });
    return () => { cancelled = true; };
    // buildCloudState intentionally excluded — baseline seeding only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAuthenticated, indmSource, applyCloudState, cloudStateFingerprint]);

  // Debounced auto-save (4s) whenever any tracked piece changes.
  // OFF while INDMoney is the portfolio source (Sheets disconnected).
  useEffect(() => {
    if (!isAuthenticated) return;
    if (indmActiveRef.current) return;
    if (skipNextStateSaveRef.current) {
      skipNextStateSaveRef.current = false;
      // Refresh dedupe fingerprint with post-restore values — the closure
      // that seeded it above captured pre-restore state (stale baseline
      // would cause a redundant echo-save right after every restore).
      lastSavedFingerprintRef.current = cloudStateFingerprint(buildCloudState());
      return;
    }
    if (cloudSaveTimerRef.current) clearTimeout(cloudSaveTimerRef.current);
    cloudSaveTimerRef.current = window.setTimeout(async () => {
      if (indmActiveRef.current) return; // INDMoney active — Sheets disconnected
      const state = buildCloudState();
      const fingerprint = cloudStateFingerprint(state);
      if (fingerprint === lastSavedFingerprintRef.current) return; // nothing changed
      setStateSyncStatus('☁️ Syncing…');
      const ok = await syncStateToCloud(state);
      if (ok) {
        lastSavedFingerprintRef.current = fingerprint;
        try { secureStorage.setItem('cloud_state_ts', String(state.savedAt)); } catch { /* noop */ }
        setStateSyncStatus('☁️ Saved');
      } else {
        setStateSyncStatus('⚠️ Cloud offline');
      }
      setTimeout(() => setStateSyncStatus(''), 2500);
    }, 4000);
    return () => { if (cloudSaveTimerRef.current) clearTimeout(cloudSaveTimerRef.current); };
  }, [isAuthenticated, buildCloudState, cloudStateFingerprint]);

  // Safety flush on tab hide/close so a quick edit never gets lost.
  useEffect(() => {
    const flush = () => {
      if (document.visibilityState !== 'hidden') return;
      if (indmActiveRef.current) return; // Sheets disconnected
      const state = buildCloudState();
      const fingerprint = cloudStateFingerprint(state);
      if (fingerprint === lastSavedFingerprintRef.current) return;
      syncStateToCloud(state).then(ok => {
        if (ok) {
          lastSavedFingerprintRef.current = fingerprint;
          try { secureStorage.setItem('cloud_state_ts', String(state.savedAt)); } catch { /* noop */ }
        }
      }).catch(() => { });
    };
    document.addEventListener('visibilitychange', flush);
    window.addEventListener('pagehide', flush);
    return () => {
      document.removeEventListener('visibilitychange', flush);
      window.removeEventListener('pagehide', flush);
    };
  }, [buildCloudState, cloudStateFingerprint]);

  // --- Price flush interval (v5.0: 250ms → 1s) -------------------------------
  // The flush itself is display-gated + self-throttled (see above), so a 1s
  // sweep is plenty: live feel (1s ≈ one visual refresh) is preserved while
  // the re-render storm is gone. Ticks still land in the ref instantly via
  // the SSE/WS callbacks (they call flush directly, which merges the ref).
  useEffect(() => {
    if (!isAuthenticated) return;
    priceFlushRef.current = window.setInterval(flushPricesToStorage, 1000);
    return () => {
      if (priceFlushRef.current) { clearInterval(priceFlushRef.current); priceFlushRef.current = null; }
    };
  }, [isAuthenticated, flushPricesToStorage]);

  // v5.0: background tab → React catches up the moment the user returns.
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === 'visible' && priceHiddenDirtyRef.current) {
        priceHiddenDirtyRef.current = false;
        priceFlushLastAtRef.current = Date.now();
        setLivePrices(livePricesRef.current);
      }
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, []);

  // --- Crypto Fast Polling (CoinDCX INR prices updated every 10s) ---
  // NOTE: CoinDCX's API does NOT serve CORS headers, so direct browser fetches
  // are always blocked. We route through the server proxy at /api/crypto-prices.
  const hasCrypto = useMemo(() => {
    if (portfolio.length === 0) return true; // Default: poll for dashboard crypto widgets
    return portfolio.some(p => isCryptoSymbol(p.symbol.replace('.NS', '').replace('.BO', '')));
  }, [portfolio]);

  useEffect(() => {
    if (!isAuthenticated || !hasCrypto) return;
    const proxyBase = (import.meta.env.VITE_API_PROXY as string) || '';

    // FIX (audit H4): in-flight guard + Binance fallback circuit breaker.
    // The 2s interval is shorter than the 5s request timeout — when the proxy
    // is slow, requests previously piled up (memory/sockets). And Binance is
    // geo-blocked in India (HTTP 451) — the app's primary market — so the
    // fallback previously fired 12 parallel requests every 2s into a dead
    // endpoint. The breaker disables the fallback after 3 consecutive
    // failures and re-probes every 10 minutes.
    let inFlight = false;
    let binanceFailures = 0;
    let lastBinanceAttempt = 0;

    const pollCrypto = async () => {
      if (document.hidden) return;
      if (inFlight) return;
      inFlight = true;
      try {
        // Dynamic universe: dashboard defaults + crypto assets synced from
        // INDMoney (resolved exchange symbols like BTC / SOL / DOGE).
        const cryptoSymbols = [...new Set([
          ...DEFAULT_CRYPTO_SYMBOLS,
          ...(portfolioRef.current || [])
            .map(p => p.symbol.replace('.NS', '').replace('.BO', '').trim().toUpperCase())
            .filter(s => isCryptoSymbol(s)),
        ])];
        try {
          const res = await apiFetch(`${proxyBase}/api/crypto-prices?t=${Date.now()}`, {
            signal: AbortSignal.timeout(5000)
          });
          if (res.ok) {
            const tickers = await res.json();
            if (Array.isArray(tickers)) {
              let updated = false;

              cryptoSymbols.forEach(sym => {
                const ticker = tickers.find((t: any) => t.market === `${sym}INR`);
                if (ticker && ticker.last_price) {
                  const priceVal = parseFloat(ticker.last_price);
                  const changeVal = parseFloat(ticker.change_24_hour) || 0;
                  if (!isNaN(priceVal) && priceVal > 0) {
                    const key = `IN_${sym}`;
                    pendingPricesRef.current[key] = {
                      price: priceVal,
                      change: changeVal,
                      high: parseFloat(ticker.high) || priceVal,
                      low: parseFloat(ticker.low) || priceVal,
                      volume: parseFloat(ticker.volume) || 0,
                      rsi: 50,
                      time: Date.now(),
                      market: 'IN',
                      tvExchange: 'COINDCX',
                      tvExactSymbol: `${sym}INR`,
                      isRealtime: true
                    };
                    updated = true;
                  }
                }
              });
              if (updated) flushPricesToStorage();
            }
          }
        } catch (e) {
          // CoinDCX failed — fallback to Binance USDT price converted to INR.
          if (binanceFailures >= 3) {
            if (Date.now() - lastBinanceAttempt > 10 * 60 * 1000) {
              binanceFailures = 0; // allow one probe after the cooldown
            } else {
              return;
            }
          }
          lastBinanceAttempt = Date.now();
          console.warn('CoinDCX poll failed, trying Binance fallback:', e);
          try {
            const binanceResults = await Promise.allSettled(
              cryptoSymbols.map(async (sym) => {
                const r = await fetch(`https://api.binance.com/api/v3/ticker/24hr?symbol=${sym}USDT`, {
                  signal: AbortSignal.timeout(4000)
                });
                if (!r.ok) return null;
                const j = await r.json();
                const price = parseFloat(j.lastPrice);
                const change = parseFloat(j.priceChangePercent);
                if (isNaN(price) || price <= 0) return null;
                const rate = usdInrRateRef.current || DEFAULT_USD_INR;
                return { sym, price: price * rate, change };
              })
            );
            let updated = false;
            let anySuccess = false;
            for (const result of binanceResults) {
              if (result.status !== 'fulfilled' || !result.value) continue;
              anySuccess = true;
              const { sym, price, change } = result.value;
              pendingPricesRef.current[`IN_${sym}`] = {
                price, change, high: price, low: price, volume: 0,
                rsi: 50, time: Date.now(), market: 'IN',
                tvExchange: 'BINANCE', tvExactSymbol: `${sym}USDT`,
                isRealtime: true
              };
              updated = true;
            }
            binanceFailures = anySuccess ? 0 : binanceFailures + 1;
            if (updated) flushPricesToStorage();
          } catch (e2) {
            binanceFailures++;
            console.warn('Binance crypto fallback also failed:', e2);
          }
        }
      } finally {
        inFlight = false;
      }
    };

    pollCrypto();
    // v5.0: the SSE stream pushes coindcx-live ticks every 1-2s — this HTTP
    // poller is only a WATCHDOG now: 30s while the crypto SSE feed is
    // healthy, 3s when it is dark. (Was a flat 3s = ~20 req/min that
    // duplicated every SSE tick and re-triggered the render pipeline.)
    let cryptoStopped = false;
    let cryptoTimer: number | null = null;
    const scheduleCrypto = () => {
      if (cryptoStopped) return;
      const feeds = feedStatusRef.current || {};
      const cryptoSseLive = Object.keys(feeds).some(s => feeds[s] && /coindcx/i.test(s));
      cryptoTimer = window.setTimeout(() => { pollCrypto().finally(scheduleCrypto); }, cryptoSseLive ? 30000 : 3000);
    };
    scheduleCrypto();
    return () => { cryptoStopped = true; if (cryptoTimer) clearTimeout(cryptoTimer); };
  }, [isAuthenticated, hasCrypto, flushPricesToStorage]);

  // --- NSE / BSE Realtime Streaming (HTTP) -----------------------------------
  // TradingView's anonymous WebSocket only pushes US exchanges in real-time, so
  // Indian (NSE/BSE) holdings never streamed live. This dedicated fast poller
  // (3s while NSE is open, 30s when closed) hits the TradingView India scanner
  // and feeds the SAME price pipeline, so Indian stocks AND ETFs tick live just
  // like the US assets do.
  const hasIndianEquity = useMemo(() => {
    if (portfolio.length === 0) return true; // default dashboard widgets (NIFTY etc.)
    return portfolio.some(p => {
      const clean = p.symbol.replace('.NS', '').replace('.BO', '');
      return (p.market || guessMarket(p.symbol)) === 'IN' && !isCryptoSymbol(clean);
    });
  }, [portfolio]);

  useEffect(() => {
    if (!isAuthenticated || !hasIndianEquity) return;

    const buildIndianPositions = (): Position[] => {
      const inPositions = portfolioRef.current.filter(p => {
        const clean = p.symbol.replace('.NS', '').replace('.BO', '');
        // noLive = INDMoney NAV-priced assets (MF/FD/bond) — no exchange quote.
        return !p.noLive && (p.market || guessMarket(p.symbol)) === 'IN' && !isCryptoSymbol(clean);
      });
      if (inPositions.length > 0) return inPositions;
      // Fallback so India indices stay live even with an empty portfolio.
      return ['NIFTY', 'BANKNIFTY'].map(sym => ({
        id: `temp-IN_${sym}`, symbol: sym, market: 'IN' as const,
        qty: 1, avgPrice: 1, leverage: 1, dateAdded: getTodayString()
      }));
    };

    let stopped = false;
    let timer: number | null = null;

    const pollIndia = async () => {
      if (stopped) return;
      if (document.hidden) {
        timer = window.setTimeout(pollIndia, 10000); // Slow down polling when tab hidden
        return;
      }
      try {
        await batchFetchIndianPrices(buildIndianPositions(), (key, data) => {
          pendingPricesRef.current[key] = { ...(pendingPricesRef.current[key] || {}), ...data } as PriceData;
        });
        flushPricesToStorage();
        if (isIndiaMarketOpen()) setLiveStatus('\u25cf \ud83c\uddee\ud83c\uddf3 NSE LIVE \u26a1');
      } catch (e) {
        console.warn('NSE realtime stream failed:', e);
      } finally {
        if (!stopped) timer = window.setTimeout(pollIndia, getIndiaPollInterval());
      }
    };

    pollIndia();
    return () => { stopped = true; if (timer) clearTimeout(timer); };
  }, [isAuthenticated, hasIndianEquity, flushPricesToStorage]);

  // --- US Market Realtime Streaming (HTTP) ------------------------------------
  // Dedicated fast poller for US assets (SMH, VGT, QQQ, MU etc.).
  // Uses 'last' (last traded price) instead of 'close' which was causing the
  // ~15 minute delay after US market open (7:00 PM IST). Polls every 3s when
  // US market is open, 5s in pre-market, 30s when closed.
  const hasUSEquity = useMemo(() => {
    if (portfolio.length === 0) return true; // default dashboard widgets (SPY, QQQ etc.)
    return portfolio.some(p => {
      const clean = p.symbol.replace('.NS', '').replace('.BO', '');
      return (p.market || guessMarket(p.symbol)) === 'US' && !isCryptoSymbol(clean);
    });
  }, [portfolio]);

  useEffect(() => {
    if (!isAuthenticated || !hasUSEquity) return;

    const buildUSPositions = (): Position[] => {
      const usPositions = portfolioRef.current.filter(p => {
        const clean = p.symbol.replace('.NS', '').replace('.BO', '');
        // noLive = INDMoney NAV-priced assets — no exchange quote to poll.
        return !p.noLive && (p.market || guessMarket(p.symbol)) === 'US' && !isCryptoSymbol(clean);
      });
      if (usPositions.length > 0) return usPositions;
      // Fallback so US indices stay live even with an empty portfolio.
      return ['SPY', 'QQQ'].map(sym => ({
        id: `temp-US_${sym}`, symbol: sym, market: 'US' as const,
        qty: 1, avgPrice: 1, leverage: 1, dateAdded: getTodayString()
      }));
    };

    let stopped = false;
    let timer: number | null = null;

    const pollUS = async () => {
      if (stopped) return;
      if (document.hidden) {
        timer = window.setTimeout(pollUS, 10000); // Slow down polling when tab hidden
        return;
      }
      try {
        await batchFetchUSPrices(buildUSPositions(), (key, data) => {
          pendingPricesRef.current[key] = { ...(pendingPricesRef.current[key] || {}), ...data } as PriceData;
        });
        flushPricesToStorage();
        if (isUSMarketOpen()) setLiveStatus('● 🇺🇸 US LIVE ⚡');
      } catch (e) {
        console.warn('US realtime stream failed:', e);
      } finally {
        if (!stopped) timer = window.setTimeout(pollUS, getUSPollInterval());
      }
    };

    pollUS();
    return () => { stopped = true; if (timer) clearTimeout(timer); };
  }, [isAuthenticated, hasUSEquity, flushPricesToStorage]);

  // --- Real-time SSE push (NSE ws + Finnhub US ws + CoinDCX crypto) --
  // The server pushes ticks the instant they happen and we feed them into the
  // SAME price pipeline the pollers use. This makes prices tick live (no 2s
  // wait). EventSource auto-reconnects; the pollers remain as a safety net.
  useEffect(() => {
    if (!isAuthenticated) return;
    const positions = portfolioRef.current;
    const inSymbols: string[] = [];
    const usSymbols: string[] = [];
    const cryptoSymbols: string[] = [];
    const cleanToKey: Record<string, string> = {}; // server key (IN_RELIANCE) -> app key

    const add = (p: Position) => {
      if (p.noLive) return; // INDMoney NAV assets (MF/FD) — no live feed to stream
      const clean = p.symbol.replace('.NS', '').replace('.BO', '').trim().toUpperCase();
      const mkt = (p.market || guessMarket(p.symbol)).toUpperCase();
      const fullKey = `${mkt}_${p.symbol.trim()}`;
      if (isCryptoSymbol(clean)) { cryptoSymbols.push(clean); cleanToKey[`IN_${clean}`] = fullKey; }
      else if (mkt === 'US') { usSymbols.push(clean); cleanToKey[`US_${clean}`] = fullKey; }
      else { inSymbols.push(clean); cleanToKey[`IN_${clean}`] = fullKey; }
    };
    if (positions.length) positions.forEach(add);
    else {
      ['NIFTY', 'BANKNIFTY', 'MOMENTUM50', 'SMALLCAP', 'MID150BEES', 'JUNIORBEES', 'SETFNIF50'].forEach(s => { inSymbols.push(s); cleanToKey[`IN_${s}`] = `IN_${s}`; });
      ['SPY', 'SMH', 'VOOG', 'MU', 'QQQ', 'VGT'].forEach(s => { usSymbols.push(s); cleanToKey[`US_${s}`] = `US_${s}`; });
    }
    ['BTC', 'ETH'].forEach(s => { if (!cryptoSymbols.includes(s)) { cryptoSymbols.push(s); cleanToKey[`IN_${s}`] = `IN_${s}`; } });

    let lastFlush = 0;
    let flushTimer: number | null = null;
    const throttledFlush = () => {
      const now = Date.now();
      if (now - lastFlush >= 200) { lastFlush = now; flushPricesToStorage(); }
      else if (!flushTimer) {
        flushTimer = window.setTimeout(() => { flushTimer = null; lastFlush = Date.now(); flushPricesToStorage(); }, 200 - (now - lastFlush));
      }
    };

    const disconnect = connectLiveStream({
      inSymbols: [...new Set(inSymbols)],
      usSymbols: [...new Set(usSymbols)],
      cryptoSymbols: [...new Set(cryptoSymbols)],
      onTick: (serverKey, data) => {
        const key = cleanToKey[serverKey] || serverKey;
        pendingPricesRef.current[key] = { ...(pendingPricesRef.current[key] || {}), ...data } as PriceData;
        throttledFlush();
      },
      onStatus: (s) => setFeedStatusTracked(s),
    });

    return () => { if (flushTimer) clearTimeout(flushTimer); disconnect(); };
  }, [isAuthenticated, portfolioSymbolKey, flushPricesToStorage]);

  // --- WebSocket + HTTP sync ---
  useEffect(() => {
    if (!isAuthenticated) return;
    const currentPortfolio = portfolioRef.current;
    const defaultSymbols = [
      'IN_NIFTY', 'IN_BANKNIFTY', 'IN_MOMENTUM50', 'IN_SMALLCAP', 'IN_MID150BEES', 'IN_JUNIORBEES', 'IN_SETFNIF50',
      'US_SPY', 'US_SMH', 'US_VOOG', 'US_MU', 'US_QQQ', 'US_VGT',
      'IN_INDIAVIX', 'US_VIX', 'IN_BTC', 'IN_ETH'
    ];
    let symbolsToSub = currentPortfolio.length > 0
      ? [...new Set([...currentPortfolio.filter(p => !p.noLive).map(p => `${p.market}_${p.symbol}`), ...defaultSymbols])]
      : defaultSymbols;
    if (!symbolsToSub.includes('IN_BTC')) symbolsToSub.push('IN_BTC');
    if (!symbolsToSub.includes('IN_ETH')) symbolsToSub.push('IN_ETH');
    const positionsToSub: Position[] = symbolsToSub.map(symbol => {
      const idx = symbol.indexOf('_');
      const market = symbol.substring(0, idx) as 'IN' | 'US';
      const sym = symbol.substring(idx + 1);
      return { id: `temp-${symbol}`, symbol: sym, market, qty: 1, avgPrice: 1, leverage: 1, dateAdded: getTodayString() };
    });
    let statusThrottle = 0;
    let syncTimer: number | null = null;
    let syncStopped = false;
    const sync = async () => {
      // 2026-09 ultra-fast pass: the crypto SSE source ticks 24/7 every 1-2s,
      // which previously masked the WHOLE batch loop (anySseLive → skip) —
      // even when the US or India feed specifically was dark. Gate PER
      // MARKET now: the batch loop only sleeps while BOTH the India and US
      // SSE sources are healthy (the crypto poller covers its own market).
      const feeds = feedStatusRef.current;
      const inSseLive = Object.keys(feeds).some(s => feeds[s] && /in-stream|groww/.test(s));
      const usSseLive = Object.keys(feeds).some(s => feeds[s] && /finnhub|us-fallback|tv-us-batch/.test(s));
      if (inSseLive && usSseLive) {
        // Still keep the storage flush path warm.
        flushPricesToStorage();
        return;
      }
      if (statusThrottle < 3) { setLiveStatus('● SYNCING...'); statusThrottle++; }
      await batchFetchPrices(positionsToSub, (key, data) => { pendingPricesRef.current[key] = { ...(pendingPricesRef.current[key] || {}), ...data } as PriceData; });
      flushPricesToStorage();
      if (statusThrottle < 3) setLiveStatus('● QUANTUM LINK ACTIVE');
    };
    sync();
    // 2026 perf audit (L1): self-rescheduling timer — the interval was fixed
    // at whatever getBatchInterval() returned when the effect ran, so an app
    // left open across market open/close never adapted its cadence.
    const scheduleSync = () => {
      if (syncStopped) return;
      syncTimer = window.setTimeout(() => { sync().finally(scheduleSync); }, getBatchInterval());
    };
    scheduleSync();
    let statusCounter = 0;
    let lastFlushTime = 0;
    let flushTimer: number | null = null;

    const throttledFlush = () => {
      const now = Date.now();
      if (now - lastFlushTime >= 200) {
        lastFlushTime = now;
        flushPricesToStorage();
      } else if (!flushTimer) {
        flushTimer = window.setTimeout(() => {
          flushTimer = null;
          lastFlushTime = Date.now();
          flushPricesToStorage();
        }, 200 - (now - lastFlushTime));
      }
    };

    // US holdings must use the dedicated Finnhub/Yahoo realtime pipeline only.
    // TradingView's browser socket can be delayed and was making US prices
    // oscillate between two different feeds (one tick up, next tick down).
    // Keep TradingView enrichment for Indian equity/indices; exclude crypto symbols
    // so raw USD Binance ticks don't pollute INR crypto keys.
    const indiaTvSymbols = symbolsToSub
      .filter(s => s.startsWith('IN_') && !isCryptoSymbol(s.split('_')[1]))
      .map(s => s.split('_')[1]);
    const unsubscribeTv = subscribeToPrices(indiaTvSymbols, (key, data) => {
      pendingPricesRef.current[key] = { ...(pendingPricesRef.current[key] || {}), ...data } as PriceData;
      statusCounter++;
      if (statusCounter % 50 === 1) setLiveStatus('● TV SOCKET LIVE ⚡');
      throttledFlush();
    });
    return () => {
      syncStopped = true;
      if (syncTimer) clearTimeout(syncTimer);
      if (syncIntervalRef.current) clearInterval(syncIntervalRef.current);
      if (flushTimer) clearTimeout(flushTimer);
      unsubscribeTv(); disconnectPrices();
      flushPricesToStorage();
    };
  }, [isAuthenticated, portfolioSymbolKey, flushPricesToStorage]);

  // --- Save portfolio ---
  useEffect(() => {
    if (portfolio.length > 0) {
      secureStorage.setItem('portfolio', JSON.stringify(portfolio));
      if (!currentSymbol) { setCurrentSymbol(portfolio[0].symbol); setCurrentMarket(portfolio[0].market as 'IN' | 'US'); }
    } else {
      if (!currentSymbol) {
        setCurrentSymbol('NIFTY');
        setCurrentMarket('IN');
      }
    }
  }, [portfolio, currentSymbol]);

  // --- Auto-diff portfolio vs last-seen snapshot (Google Sheets sync) ---
  // When the portfolio changes (e.g. user added a buy in Google Sheets →
  // cloud sync replaces state), compute the diff and append synthetic
  // transactions to the ledger so Monthly Plan Tracker + Return Report
  // can see them. Skips the very first run (initial load) so we don't
  // flood the ledger with all existing holdings.
  const diffInitRef = useRef(false);
  useEffect(() => {
    if (!isAuthenticated) return;
    if (portfolio.length === 0) return;
    // Skip the very first invocation (initial load) — just establish baseline.
    if (!diffInitRef.current) {
      diffInitRef.current = true;
      applyPortfolioDiff(portfolio, transactionsRef.current, livePricesRef.current, usdInrRateRef.current);
      return;
    }
    const { transactions: updated, added } = applyPortfolioDiff(
      portfolio, transactionsRef.current, livePricesRef.current, usdInrRateRef.current
    );
    if (added > 0) {
      // FIX #20: demoted debug log to console.debug so dev console isn't spammed
      // on every portfolio sync. esbuild drops it in production.
      console.debug(`[diff-engine] ${added} new transaction(s) auto-recorded from portfolio change.`);
      setTransactions(updated);
    }
  }, [portfolio, isAuthenticated]);

  // --- Daily P&L snapshot (v2 — uses `change` field directly) ---
  // Computes live daily P&L from the `change` field of each position and
  // freezes it into the log.
  // FIX (audit H1): was a 3s DEBOUNCE keyed on `livePrices` — every price tick
  // (crypto polls 24/7 every 2s; NSE/US tick every 1-3s) reset the timer, so
  // during market hours the snapshot almost NEVER fired — exactly when it
  // matters. Switched to a 60s THROTTLE: record immediately on mount/portfolio
  // change, then at most once per minute (reading live prices from the ref).
  useEffect(() => {
    if (!isAuthenticated || portfolio.length === 0) return;
    let lastRecord = 0;
    const record = () => {
      const now = Date.now();
      if (now - lastRecord < 60_000) return;
      lastRecord = now;
      const livePL = computeLiveDailyPL(portfolioRef.current, livePricesRef.current, usdInrRateRef.current);
      recordDailyPL(livePL);
    };
    // First snapshot 3s after portfolio becomes non-empty (lets prices land).
    const initial = setTimeout(record, 3000);
    const interval = window.setInterval(record, 60_000); // throttle: 1/min
    return () => { clearTimeout(initial); clearInterval(interval); };
  }, [portfolio.length, isAuthenticated]);

  // --- Save transaction ledger ---
  useEffect(() => {
    try { secureStorage.setItem('txn_history', JSON.stringify(transactions)); } catch { }
  }, [transactions]);

  // --- Save price alerts ---
  useEffect(() => {
    try { secureStorage.setItem('price_alerts', JSON.stringify(priceAlerts)); } catch { }
  }, [priceAlerts]);

  // --- Price alert watcher (target / stop-loss hit → Telegram) ---
  // Checks live prices against configured alerts every 20s. A 4-hour cooldown
  // per alert prevents spamming the same notification repeatedly.
  useEffect(() => {
    if (!isAuthenticated) return;
    const ALERT_COOLDOWN_MS = 4 * 60 * 60 * 1000; // 4 hours
    const checkAlerts = async () => {
      const alerts = priceAlertsRef.current || [];
      const active = alerts.filter(a => a.enabled && (a.target != null || a.stopLoss != null));
      if (active.length === 0) return;
      const prices = livePricesRef.current || {};
      const now = Date.now();
      const fired: { alert: PriceAlert; type: 'target' | 'stoploss'; price: number }[] = [];

      for (const a of active) {
        const data = prices[`${a.market}_${a.symbol}`];
        const price = data?.price;
        if (!price || price <= 0) continue;
        if (a.lastTriggered && now - a.lastTriggered < ALERT_COOLDOWN_MS) continue;
        if (a.target != null && price >= a.target) {
          fired.push({ alert: a, type: 'target', price });
        } else if (a.stopLoss != null && price <= a.stopLoss) {
          fired.push({ alert: a, type: 'stoploss', price });
        }
      }
      if (fired.length === 0) return;

      const [tgToken, tgChatId] = await Promise.all([
        secureStorage.getItemAsync('TG_TOKEN'), secureStorage.getItemAsync('TG_CHAT_ID'),
      ]);
      for (const f of fired) {
        const cur = f.alert.market === 'IN' ? '₹' : '$';
        const sym = f.alert.symbol.replace('.NS', '').replace('.BO', '');
        const isTarget = f.type === 'target';
        const threshold = isTarget ? f.alert.target! : f.alert.stopLoss!;
        const emoji = isTarget ? '🎯' : '🛑';
        const title = isTarget ? 'TARGET HIT' : 'STOP-LOSS HIT';
        const msg = `${emoji} <b>${title}</b>\n\n<b>${sym}</b> (${f.alert.market})\nLive: <b>${cur}${f.price.toFixed(2)}</b>\n${isTarget ? 'Target' : 'Stop-Loss'}: ${cur}${threshold.toFixed(2)}${f.alert.note ? `\n📝 ${f.alert.note}` : ''}\n\n— Wealth AI Alert`;
        try { await sendTelegramAlert(tgToken || '', tgChatId || '', msg); } catch { }
      }
      // Mark fired alerts with cooldown timestamp + triggered type
      const firedIds = new Map(fired.map(f => [f.alert.id, f.type] as const));
      setPriceAlerts(prev => prev.map(a =>
        firedIds.has(a.id) ? { ...a, lastTriggered: now, triggeredType: firedIds.get(a.id)! } : a
      ));
    };
    const interval = window.setInterval(checkAlerts, 20000); // 20s
    checkAlerts();
    return () => clearInterval(interval);
  }, [isAuthenticated]);

  // --- Cloud sync (debounced 5s on portfolio change only) ---
  // Skips saving if portfolio was just loaded FROM cloud (prevents circular overwrite).
  // OFF while INDMoney drives the portfolio — synced assets must never be
  // pushed into the user's Google Sheet.
  useEffect(() => {
    if (portfolio.length === 0) return;
    if (indmActiveRef.current) return;
    if (skipNextCloudSaveRef.current) {
      skipNextCloudSaveRef.current = false;
      console.log('☁️ Cloud Sync: skipped auto-save because portfolio was just loaded from Google Sheets');
      return;
    }
    if (cloudSyncTimerRef.current) clearTimeout(cloudSyncTimerRef.current);
    cloudSyncTimerRef.current = window.setTimeout(() => {
      syncToCloud(portfolio, usdInrRateRef.current);
    }, 5000);
    return () => { if (cloudSyncTimerRef.current) clearTimeout(cloudSyncTimerRef.current); };
  }, [portfolio]);

  // --- Periodic cloud LOAD (manual mode only — Google Sheets is
  // disconnected while INDMoney is the asset source) ---
  useEffect(() => {
    if (!isAuthenticated) return;
    cloudLoadTimerRef.current = window.setInterval(() => {
      if (document.visibilityState === 'visible' && !indmActiveRef.current) {
        console.log('☁️ Cloud Sync: periodic auto-load from Google Sheets…');
        mergeCloudData();
      }
    }, 30000); // 30 seconds
    return () => { if (cloudLoadTimerRef.current) clearInterval(cloudLoadTimerRef.current); };
  }, [isAuthenticated, mergeCloudData]);

  // --- Tab Visibility Auto-Sync (manual mode only) ---
  useEffect(() => {
    if (!isAuthenticated) return;
    const handleVisibility = () => {
      if (document.visibilityState === 'visible' && !indmActiveRef.current) {
        console.log('👁️ Tab active: fetching latest portfolio from Google Sheets…');
        mergeCloudData();
      }
    };
    document.addEventListener('visibilitychange', handleVisibility);
    return () => document.removeEventListener('visibilitychange', handleVisibility);
  }, [isAuthenticated, mergeCloudData]);

  // --- Forex refresh (realtime 24x7, every 15s) ---
  useEffect(() => {
    if (!isAuthenticated) return;
    const refreshForex = async () => {
      // FIX (audit M6): don't clobber a good rate with the hardcoded default
      // when every forex source fails (offline / rate-limited).
      const rate = await fetchForexRateOrNull();
      if (rate != null) setUsdInrRate(rate);
    };
    refreshForex(); // immediate fetch on mount
    // FIX OPT-1: Forex rates change ~1x/day; 15s polling wastes bandwidth.
    // Poll every 60s during market hours, every 5min when all markets closed.
    const getForexInterval = () => isAnyMarketOpen() ? 60000 : 300000;
    let forexTimer: number | null = null;
    const scheduleNext = () => {
      forexTimer = window.setTimeout(async () => {
        await refreshForex();
        scheduleNext();
      }, getForexInterval());
    };
    scheduleNext();
    return () => { if (forexTimer) clearTimeout(forexTimer); if (forexIntervalRef.current) clearInterval(forexIntervalRef.current); };
  }, [isAuthenticated]);

  // --- Load chart ---
  // Resolved TV symbol — recomputes when the price engine resolves the exact
  // exchange:symbol, so the chart reloads from a guessed symbol to the correct
  // one (e.g. NSE:JUNIORBEES) as soon as live data confirms it.
  const chartTvSymbol = useMemo(
    () => resolveTvChartSymbol(
      currentSymbol, currentMarket,
      livePrices[`${currentMarket}_${currentSymbol}`]?.tvExactSymbol
    ),
    [currentSymbol, currentMarket, livePrices]
  );

  const loadTradingViewChart = useCallback(() => {
    if (!chartContainerRef.current) return;
    chartContainerRef.current.innerHTML = '';
    tvWidgetRef.current = null;
    // Use the exact symbol the live-price engine resolved (NSE vs BSE, exact ETF
    // ticker, etc.) so the chart is guaranteed to exist wherever a price does.
    const tvSymbol = chartTvSymbol;
    const containerId = `tv-chart-${Date.now()}`;
    const container = document.createElement('div');
    container.id = containerId; container.style.height = '100%'; container.style.width = '100%';
    chartContainerRef.current.appendChild(container);
    const initWidget = () => {
      if (!(window as any).TradingView) return;
      try {
        tvWidgetRef.current = new (window as any).TradingView.widget({
          autosize: true, symbol: tvSymbol, interval: chartInterval, timezone: 'Asia/Kolkata',
          theme: theme === 'dark' ? 'dark' : 'light', style: '1', locale: 'en', enable_publishing: false,
          allow_symbol_change: true, studies: ['STD;RSI', 'STD;MACD'], container_id: containerId,
          withdateranges: true, calendar: false, hide_side_toolbar: false, details: true, hotlist: true,
          support_host: 'https://www.tradingview.com'
        });
      } catch (e) { console.warn('TradingView widget init error:', e); }
    };
    const tvScript = document.querySelector('script[src="https://s3.tradingview.com/tv.js"]');
    if (!tvScript) {
      const script = document.createElement('script');
      script.src = 'https://s3.tradingview.com/tv.js'; script.async = true;
      script.onload = () => setTimeout(initWidget, 100);
      script.onerror = () => {
        if (chartContainerRef.current) {
          chartContainerRef.current.innerHTML = '';
          const widgetDiv = document.createElement('div');
          widgetDiv.className = 'tradingview-widget-container'; widgetDiv.style.height = '100%'; widgetDiv.style.width = '100%';
          widgetDiv.innerHTML = `<div class="tradingview-widget-container__widget" style="height:100%;width:100%"></div>`;
          const embedScript = document.createElement('script');
          embedScript.type = 'text/javascript';
          embedScript.src = 'https://s3.tradingview.com/external-embedding/embed-widget-advanced-chart.js';
          embedScript.async = true;
          embedScript.innerHTML = JSON.stringify({
            autosize: true, symbol: tvSymbol, interval: chartInterval, timezone: 'Asia/Kolkata',
            theme: theme === 'dark' ? 'dark' : 'light', style: '1', locale: 'en', enable_publishing: false,
            allow_symbol_change: true, calendar: false, studies: ['STD;RSI', 'STD;MACD'],
            support_host: 'https://www.tradingview.com'
          });
          widgetDiv.appendChild(embedScript);
          chartContainerRef.current.appendChild(widgetDiv);
        }
      };
      document.head.appendChild(script);
    } else {
      if ((window as any).TradingView) setTimeout(initWidget, 50);
      else tvScript.addEventListener('load', () => setTimeout(initWidget, 100));
    }
  }, [chartTvSymbol, chartInterval, theme]);

  useEffect(() => {
    if (!isAuthenticated || !chartContainerRef.current || !currentSymbol) return;
    loadTradingViewChart();
  }, [currentSymbol, chartInterval, isAuthenticated, loadTradingViewChart]);

  // --- Metrics (pure with optional args; refs only for interval callers) ---
  // 2026 deep P&L accuracy pass (the "prices mismatch" fix):
  //   1. Today's P&L uses the REAL previous close (prevClose) when the quote
  //      source provides one — (price - prevClose) * qty exactly — instead of
  //      back-computing from the rounded change % (which drifted a few bps
  //      per row and compounded across the summary).
  //   2. US "Capital Deployed" uses the sync's ground-truth INR invested
  //      (indmInvestedINR) converted at the CURRENT live FX — same rate the
  //      equity side uses — so USD buckets and INR buckets always agree
  //      (the old code baked the sync-time FX into avgPrice and the two
  //      sides silently disagreed as the rupee moved).
  //   3. indPL/usPL/cryptoPL stay INR-normalized (consistent buckets).
  const calculateMetrics = useCallback((
    p: Position[] = portfolioRef.current,
    lp: Record<string, PriceData> = livePricesRef.current,
    rate: number = usdInrRateRef.current,
    appRate: number | null | undefined = usdAppRateRef.current
  ) => {
    let totalInvested = 0, totalValue = 0, todayPL = 0;
    let indPL = 0, usPL = 0, cryptoPL = 0;
    let totalInvestedINR = 0, totalValueINR = 0;
    let totalInvestedUSD = 0, totalValueUSD = 0;
    let totalInvestedCRYPTO = 0, totalValueCRYPTO = 0, totalPLCRYPTO = 0;
    // v5.1 P&L truth fix: totalPL now sums ONLY rows with a real cost
    // basis (hasBasis). A basis-less crypto row's VALUE still counts in
    // Current Equity (the user owns it) but its value must NEVER leak
    // into P&L — that was the "+₹10k crypto value shown as India
    // Returns" bug (site 35,372 vs app 25,376).
    let totalPL = 0;

    p.forEach(pos => {
      const key = `${pos.market}_${pos.symbol}`;
      const data = lp[key];
      const curPrice = data?.price || pos.avgPrice;
      const change = data?.change || 0;

      // ---- EXACT-MATCH P&L (v4.4) --------------------------------------
      // Synced rows: INDMoney's own snapshot P&L + live-tick delta since the
      // sync (assetPnl.ts). This is what makes Total P&L / the India & USA
      // sub-buckets match the INDMoney app right after a sync (they used to
      // overshoot because the old math re-derived value from a different
      // price/FX world: live quote × qty vs INR snapshot cost).
      // Manual rows: legacy leverage-aware math, unchanged.
      // v5.2: `appRate` calibrates the US invested side to INDMoney's
      // internal FX — the 🦅 section then matches the app's USD numbers.
      const pnlTruth = syncedAssetPnl(pos, curPrice, rate, appRate ?? undefined);

      totalInvested += pnlTruth.investedINR;
      totalValue += pnlTruth.valueINR;

      // v5.1 bucketing fix: CoinDCX rows carry market 'IN' (INR pairs) but
      // they are CRYPTO, not India equity — bucket them with
      // isCryptoSymbol (same classification the grouped table + insights
      // use) so the 🇮🇳 sub-lines equal the INDMoney app's INDIA section.
      const cleanSym = pos.symbol.replace('.NS', '').replace('.BO', '');
      const isCrypto = isCryptoSymbol(cleanSym);
      if (isCrypto) {
        totalInvestedCRYPTO += pnlTruth.investedINR;
        totalValueCRYPTO += pnlTruth.valueINR;
      } else if (pos.market === 'IN') {
        totalInvestedINR += pnlTruth.invested;
        totalValueINR += pnlTruth.value;
      } else {
        totalInvestedUSD += pnlTruth.invested;
        totalValueUSD += pnlTruth.value;
      }

      // P&L totals: basis-known rows ONLY (see comment above).
      if (pnlTruth.hasBasis) {
        totalPL += pnlTruth.pnlINR;
        if (isCrypto) totalPLCRYPTO += pnlTruth.pnlINR;
      }

      // Exact day baseline: REAL previous close when the quote source served
      // one (Groww/Yahoo/Finnhub/TV-batch all do now); else back-compute.
      const prevPrice = (data?.prevClose && data.prevClose > 0)
        ? data.prevClose
        : (change <= -100 ? curPrice * 2 : curPrice / (1 + (change / 100)));
      const dayPL = (curPrice - prevPrice) * pos.qty;
      const dayPLINR = pos.market === 'IN' ? dayPL : dayPL * rate;
      todayPL += dayPLINR;

      // FIX: All P&L buckets in INR for consistent comparison/aggregation.
      if (isCrypto) {
        cryptoPL += dayPLINR;
      } else if (pos.market === 'IN') {
        indPL += dayPLINR;
      } else {
        usPL += dayPLINR; // INR-normalized (was USD native before)
      }
    });
    const plPct = totalInvested > 0 ? (totalPL / totalInvested) * 100 : 0;
    const todayPct = (totalValue - todayPL) > 0 ? (todayPL / (totalValue - todayPL)) * 100 : 0;
    // v5.2 APP-PARITY section metrics — the three cards mirror the official
    // apps' sections exactly:
    //   🇮🇳 India: INR-native invested/value/returns (INDMoney exact)
    //   🦅 USA: USD invested at the calibrated rate, USD value at live,
    //         unrealized = value − invested (app-style, stock-only)
    //   🪙 Crypto: invested from trade-ledger/manual basis, live value
    const usPnlUSD = totalValueUSD - totalInvestedUSD;
    const cryptoPct = totalInvestedCRYPTO > 0 ? (totalPLCRYPTO / totalInvestedCRYPTO) * 100 : null;
    const indiaPct = totalInvestedINR > 0 ? ((totalValueINR - totalInvestedINR) / totalInvestedINR) * 100 : 0;
    return {
      totalInvested,
      totalValue,
      totalPL,
      plPct,
      todayPL,
      todayPct,
      indPL,
      usPL,
      cryptoPL,
      totalInvestedINR,
      totalValueINR,
      totalInvestedUSD,
      totalValueUSD,
      totalInvestedCRYPTO,
      totalValueCRYPTO,
      totalPLCRYPTO,
      // v5.2 sections (app-parity)
      usPnlUSD,
      cryptoPct,
      indiaPct,
    };
  }, []);

  const metrics = useMemo(() => calculateMetrics(portfolio, livePrices, usdInrRate, usdAppRate), [calculateMetrics, portfolio, livePrices, usdInrRate, usdAppRate]);

  // Update latestDataRef for telegram interval
  useEffect(() => { latestDataRef.current = { portfolio, livePrices, usdInrRate }; }, [portfolio, livePrices, usdInrRate]);

  // --- Context regeneration (throttled 120s) ---
  useEffect(() => {
    if (!isAuthenticated) return;
    const generateContext = () => {
      // v5.0: multi-KB serialization only for a visible tab — the text is
      // consumed by NeuralChat, which can't be read while hidden anyway.
      if (document.hidden) return;
      const p = portfolioRef.current;
      const lp = livePricesRef.current;
      const rate = usdInrRateRef.current;
      if (p.length === 0) return;
      const currentMetrics = calculateMetrics();

      let ctx = `--- DEEP MIND QUANTUM LIVE SENSOR DATA ---\n`;
      const usVix = lp['US_VIX']?.price || 15;
      const inVix = lp['IN_INDIAVIX']?.price || 15;
      const avgVixCtx = (usVix + inVix) / 2;
      ctx += `Timestamp: ${new Date().toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata' })} IST\n`;
      ctx += `US VIX: ${usVix.toFixed(1)} | India VIX: ${inVix.toFixed(1)} | Avg: ${avgVixCtx.toFixed(1)}\n`;
      ctx += `Market Regime: ${avgVixCtx > 22 ? 'BEARISH' : avgVixCtx > 16 ? 'VOLATILE' : 'BULLISH'}\n`;
      ctx += `USD/INR: ₹${rate.toFixed(2)}\n`;
      ctx += `Portfolio Value: ₹${Math.round(currentMetrics.totalValue).toLocaleString('en-IN')}\n`;
      ctx += `Total P&L: ${currentMetrics.totalPL >= 0 ? '+' : ''}₹${Math.round(currentMetrics.totalPL).toLocaleString('en-IN')} (${currentMetrics.plPct.toFixed(2)}%)\n`;
      ctx += `Today P&L: ${currentMetrics.todayPL >= 0 ? '+' : ''}₹${Math.round(currentMetrics.todayPL).toLocaleString('en-IN')}\n`;
      ctx += `Total Assets: ${p.length}\n\n`;
      // 2026-09 site integration: portfolio source + freshness header so the
      // AI knows WHERE the portfolio comes from (INDMoney MCP / CoinDCX
      // exchange) and how fresh the NAV rows are.
      const im = indmMetaRef.current;
      if (im && (im.counts?.assets ?? 0) > 0) {
        const c = im.counts!;
        ctx += `=== PORTFOLIO SOURCE (site-synced) ===\n`;
        ctx += `Sources: INDMoney=${(c.assets ?? 0) - (c.coindcx ?? 0)} · CoinDCX=${c.coindcx ?? 0} · Live-priced=${c.live ?? 0} · NAV-priced=${c.noLive ?? 0}\n`;
        ctx += `Last sync: ${im.syncedAt ? new Date(im.syncedAt).toISOString() : 'unknown'}${im.stale ? ' (STALE — NAV values may be outdated)' : ''}\n`;
        if (im.nextSyncAt) ctx += `Next auto-sync: ${new Date(im.nextSyncAt).toISOString()} (2× daily 09:30/21:30 IST)\n`;
        ctx += `\n`;
      }
      ctx += `=== ALL ${p.length} PORTFOLIO POSITIONS WITH LIVE TECHNICALS ===\n`;
      for (let idx = 0; idx < p.length; idx++) {
        const pos = p[idx];
        const key = `${pos.market}_${pos.symbol}`;
        const data = lp[key];
        const curPrice = data?.price || pos.avgPrice;
        const rsi = data?.rsi || 50;
        const change = data?.change || 0;
        const macd = data?.macd !== undefined ? data.macd.toFixed(2) : 'N/A';
        const sma20 = data?.sma20 ? data.sma20.toFixed(1) : 'N/A';
        const sma50 = data?.sma50 ? data.sma50.toFixed(1) : 'N/A';
        const vol = data?.volume ? (data.volume > 1e6 ? `${(data.volume / 1e6).toFixed(1)}M` : `${(data.volume / 1e3).toFixed(0)}K`) : 'N/A';
        const plPct = pos.avgPrice > 0 ? ((curPrice - pos.avgPrice) / pos.avgPrice) * 100 : 0;
        const cleanSym = pos.symbol.replace('.NS', '');
        const invested = pos.avgPrice * pos.qty;
        const curVal = curPrice * pos.qty;
        const plAbs = curVal - invested;
        const sig = analyzeAsset(pos, data);
        const atr = ((data?.high || curPrice) - (data?.low || curPrice)) || curPrice * 0.02;
        const slPrice = curPrice - atr * 1.5;
        const tpPrice = curPrice + atr * 2.5;
        const buyDate = new Date(pos.dateAdded);
        const holdingDays = Math.max(0, Math.round((Date.now() - buyDate.getTime()) / (1000 * 60 * 60 * 24)));
        const holdingLabel = holdingDays > 365 ? `${(holdingDays / 365).toFixed(1)}Y` : `${holdingDays}D`;
        const years = holdingDays / 365;
        const cagrPct = (years > 0.1 && pos.avgPrice > 0) ? ((Math.pow(curPrice / pos.avgPrice, 1 / years) - 1) * 100) : plPct;
        const isCryptoAsset = isCryptoSymbol(cleanSym);
        const assetType = isCryptoAsset ? 'CRYPTO' : pos.market;
        const trend = (data?.sma20 && data?.sma50) ? (data.sma20 > data.sma50 ? 'BULL' : 'BEAR') : (change > 0.5 ? 'BULL' : change < -0.5 ? 'BEAR' : 'FLAT');
        // 2026-09: source tag (INDMONEY/COINDCX/MANUAL) + full name + NAV
        // awareness — NAV rows (MF/FD/bond) have NO technicals; the AI must
        // treat their price as the sync-time unit value, not a live quote.
        const srcTag = pos.source === 'coindcx' ? 'COINDCX' : (pos.source === 'indmoney' ? 'INDMONEY' : 'MANUAL');
        const nameTag = pos.name && pos.name !== cleanSym ? ` | Name="${String(pos.name).slice(0, 40)}"` : '';
        if (pos.noLive) {
          ctx += `${idx + 1}. ${cleanSym} [${assetType}/NAV·${srcTag}]${nameTag} | Price=₹${curPrice.toFixed(2)} (sync value, NAV) | Chg=${change >= 0 ? '+' : ''}${change.toFixed(2)}% (sync) | AvgBuy=${pos.avgPrice.toFixed(2)} | Qty=${pos.qty} | Invested=${invested.toFixed(0)} | CurVal=${curVal.toFixed(0)} | P&L=${plPct >= 0 ? '+' : ''}${plPct.toFixed(2)}% (${plAbs >= 0 ? '+' : ''}${plAbs.toFixed(0)}) | Holding=${holdingLabel} | CAGR=${cagrPct >= 0 ? '+' : ''}${cagrPct.toFixed(1)}% | NOTE: no live exchange quote — fund/NAV asset, technicals N/A\n`;
        } else {
          ctx += `${idx + 1}. ${cleanSym} [${assetType}/${srcTag}]${nameTag} | Price=${curPrice.toFixed(2)} | Chg=${change >= 0 ? '+' : ''}${change.toFixed(2)}% | RSI=${rsi.toFixed(0)} | MACD=${macd} | SMA20=${sma20} | SMA50=${sma50} | Trend=${trend} | Vol=${vol} | Signal=${sig.signal} | Confidence=${sig.confidence}% | SL=${slPrice.toFixed(2)} | TP=${tpPrice.toFixed(2)} | AvgBuy=${pos.avgPrice.toFixed(2)} | Qty=${pos.qty} | Invested=${invested.toFixed(0)} | CurVal=${curVal.toFixed(0)} | P&L=${plPct >= 0 ? '+' : ''}${plPct.toFixed(2)}% (${plAbs >= 0 ? '+' : ''}${plAbs.toFixed(0)}) | Holding=${holdingLabel} | CAGR=${cagrPct >= 0 ? '+' : ''}${cagrPct.toFixed(1)}%\n`;
        }
      }
      ctx += `=== END ALL ${p.length} POSITIONS ===\n`;

      // Monthly investment behaviour (last 6 months) — gives AI full picture of buying pattern
      const txns = transactionsRef.current || [];
      if (txns.length > 0) {
        const byMonth: Record<string, { buyQty: number; investedINR: number; sells: number }> = {};
        for (const t of txns) {
          const mk = (t.date || '').slice(0, 7);
          if (!mk) continue;
          if (!byMonth[mk]) byMonth[mk] = { buyQty: 0, investedINR: 0, sells: 0 };
          const amtINR = t.market === 'US' ? t.amount * rate : t.amount;
          if (t.type === 'buy') { byMonth[mk].buyQty += t.qty; byMonth[mk].investedINR += amtINR; }
          else byMonth[mk].sells += 1;
        }
        const months = Object.keys(byMonth).sort().reverse().slice(0, 6);
        ctx += `\n=== MONTHLY INVESTMENT BEHAVIOUR (last ${months.length} months) ===\n`;
        for (const mk of months) {
          const r = byMonth[mk];
          ctx += `${mk}: Bought Qty=${r.buyQty.toFixed(2)} | Invested=\u20b9${Math.round(r.investedINR).toLocaleString('en-IN')} | Sells=${r.sells}\n`;
        }
        ctx += `=== END MONTHLY BEHAVIOUR ===\n`;
      }

      setPortfolioContextText(ctx);
    };

    generateContext();
    const interval = window.setInterval(generateContext, 90000); // 90s — AI context refresh (45s was overkill, wasted CPU serializing portfolio)
    return () => { clearInterval(interval); };
  }, [isAuthenticated, calculateMetrics, portfolio]);

  // --- Telegram auto-report (OFF by default — bot handles 24x7 alerts) ---
  // FIX HIGH #1: previously `metrics` was in deps, but `metrics` rebuilds on
  // every live price tick → the 120s timeout + 30min interval were constantly
  // cleared & re-scheduled, so NO auto-report ever fired. Drop `metrics` from
  // deps; read fresh metrics inside the closure via `latestDataRef.current`.
  useEffect(() => {
    if (!isAuthenticated || !autoTelegram || portfolio.length === 0) return;
    const sendIfMarketOpen = async () => {
      const d = latestDataRef.current;
      if (!isAnyMarketOpen()) return;
      const [tgToken, tgChatId] = await Promise.all([secureStorage.getItemAsync('TG_TOKEN'), secureStorage.getItemAsync('TG_CHAT_ID')]);
      if (!tgToken || !tgChatId) return;
      // Recompute metrics fresh inside the closure so we always send current state.
      const currentMetrics = calculateMetrics();
      const msg = generateDeepAnalysis(d.portfolio, d.livePrices, d.usdInrRate, currentMetrics);
      await sendTelegramAlert(tgToken, tgChatId, msg);
    };
    initialTimeoutRef.current = setTimeout(sendIfMarketOpen, 120000);
    telegramIntervalRef.current = window.setInterval(sendIfMarketOpen, 1800000);
    return () => {
      if (initialTimeoutRef.current) clearTimeout(initialTimeoutRef.current);
      if (telegramIntervalRef.current) clearInterval(telegramIntervalRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAuthenticated, autoTelegram, portfolio.length]);

  // --- Weekly Wealth Report (Sunday 9 AM IST) ---
  // FIX HIGH #25: same root cause as #1 — drop `metrics` from deps.
  // FIX H3: use secureStorage for dedup so page reload doesn't re-fire.
  useEffect(() => {
    if (!isAuthenticated || !autoTelegram || portfolio.length === 0) return;
    const checkWeeklyReport = async () => {
      const now = new Date();
      const ist = new Date(now.toLocaleString('en-US', { timeZone: 'Asia/Kolkata' }));
      const day = ist.getDay(); // 0 = Sunday
      const hour = ist.getHours();
      const todayStr = ist.toISOString().split('T')[0];

      // FIX H3: check secureStorage instead of in-memory ref — survives reloads.
      const alreadySent = secureStorage.getItem(`weekly_report_sent_${todayStr}`) === '1';
      if (day === 0 && hour === 9 && !alreadySent) {
        secureStorage.setItem(`weekly_report_sent_${todayStr}`, '1');
        const d = latestDataRef.current;
        const currentMetrics = calculateMetrics();
        let weeklyTotalSIP = 16500;
        let weeklyInvestYears = 15;
        let weeklyCagr = 12;
        try {
          const ps = secureStorage.getItem('plannerSettings');
          if (ps) {
            const s = JSON.parse(ps);
            weeklyTotalSIP = (s.indiaSIP || 10000) + (s.usSIP || 5000) + (s.btcSIP || 1000) + (s.ethSIP || 500);
            weeklyInvestYears = s.investYears || 15;
            weeklyCagr = s.riskLevel === 'low' ? 8 : s.riskLevel === 'high' ? 18 : 12;
          }
        } catch { /* use defaults */ }
        const totalSIP = weeklyTotalSIP;
        const investYears = weeklyInvestYears;
        const cagr = weeklyCagr;
        const msg = generateWeeklyWealthReport(
          d.portfolio, d.livePrices, d.usdInrRate,
          { ...currentMetrics, totalInvested: currentMetrics.totalInvested || 0 },
          totalSIP, investYears, cagr
        );
        const [tgToken, tgChatId] = await Promise.all([secureStorage.getItemAsync('TG_TOKEN'), secureStorage.getItemAsync('TG_CHAT_ID')]);
        if (tgToken && tgChatId) sendTelegramAlert(tgToken, tgChatId, msg).catch(() => { });
      }
    };

    const interval = setInterval(checkWeeklyReport, 600000); // every 10 min
    checkWeeklyReport();
    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAuthenticated, autoTelegram, portfolio.length]);

  // --- WS Latency (60s — cosmetic) ---
  useEffect(() => {
    if (!isAuthenticated) return;
    // OPT-3: cosmetic latency readout — 120s is plenty (was 60s)
    const interval = setInterval(() => { setWsLatency(getWebSocketLatency()); }, 120000);
    return () => clearInterval(interval);
  }, [isAuthenticated]);

  // --- Sector intel (3min) ---
  useEffect(() => {
    if (!isAuthenticated) return;
    const fetchIntel = async () => {
      // v5.0: sector rotation is a Macro-tab visual — no reason to hit the
      // TradingView scanners while the tab is hidden.
      if (document.hidden) return;
      try { const intel = await fetchMarketIntelligence(); if (intel.sectors?.length > 0) setSectorData(intel.sectors); } catch { }
    };
    fetchIntel();
    const interval = setInterval(fetchIntel, 180000);
    return () => clearInterval(interval);
  }, [isAuthenticated]);

  // --- Cleanup ---
  useEffect(() => {
    return () => {
      if (priceFlushRef.current) clearInterval(priceFlushRef.current);
      if (priceFlushTimerRef.current) clearTimeout(priceFlushTimerRef.current);
      if (telegramIntervalRef.current) clearInterval(telegramIntervalRef.current);
      if (forexIntervalRef.current) clearInterval(forexIntervalRef.current);
      if (syncIntervalRef.current) clearInterval(syncIntervalRef.current);
      if (cloudSyncTimerRef.current) clearTimeout(cloudSyncTimerRef.current);
      if (cloudLoadTimerRef.current) clearInterval(cloudLoadTimerRef.current);
      if (initialTimeoutRef.current) clearTimeout(initialTimeoutRef.current);
    };
  }, []);

  // --- Computed values ---
  const usVix = livePrices['US_VIX']?.price || 15;
  const inVix = livePrices['IN_INDIAVIX']?.price || 15;
  const avgVix = (usVix + inVix) / 2;

  const sentiment = useMemo(() => {
    if (avgVix > 22) return { text: '🚨 Global Risk Severe | Institutional Liquidation Active', color: 'text-red-400' };
    if (avgVix > 17) return { text: '⚠️ Elevated Volatility | Smart Money Cautious', color: 'text-amber-400' };
    if (avgVix > 14) return { text: '✅ Normal Range | Standard SIP Optimal', color: 'text-yellow-400' };
    return { text: '🟢 Ultra Low Risk | Whale Accumulation Zone', color: 'text-emerald-400' };
  }, [avgVix]);

  const currentKey = `${currentMarket}_${currentSymbol}`;
  const currentData = livePrices[currentKey];
  const currentPrice = currentData?.price || 0;
  const currentChange = currentData?.change || 0;
  const currentRsi = currentData?.rsi || 50;

  const signalData = useMemo(() => {
    if (currentRsi < 35) return { signal: '🔥 MAX BUY', color: 'text-emerald-400', conf: 98 };
    if (currentRsi < 45) return { signal: '🟢 ACCUMULATE', color: 'text-emerald-400', conf: 85 };
    if (currentRsi < 60) return { signal: '🟡 MAINTAIN', color: 'text-amber-400', conf: 75 };
    if (currentRsi < 70) return { signal: '🟠 THROTTLE', color: 'text-orange-400', conf: 65 };
    return { signal: '🚨 DISTRIBUTE', color: 'text-red-400', conf: 90 };
  }, [currentRsi]);

  // --- Planner calculations ---
  // v5.0 dedupe: fvMed/fvWorst/fvBest/multiplier/totalInvestedPlanner/months
  // removed — they fed only the deleted "fake Monte Carlo" summary panel in
  // PlannerTab. The REAL projections live in MonteCarloSimulator (10k paths)
  // and WhatIfSIPOptimizer (scenario + step-up engine).
  const totalSIP = indiaSIP + usSIP + btcSIP + ethSIP;
  const cagr = riskLevel === 'low' ? 8 : riskLevel === 'high' ? 18 : 12;
  const monthlyRate = cagr / 100 / 12;

  // --- FIRE ---
  const fireNumber = monthlyExpenses * 12 * 25;
  const rawYears = totalSIP > 0 && monthlyRate > 0 && fireNumber > 0 ? Math.log((fireNumber * monthlyRate / totalSIP) + 1) / Math.log(1 + monthlyRate) / 12 : null;
  const yearsToFire = rawYears !== null && isFinite(rawYears) && rawYears > 0 ? Math.max(1, Math.ceil(rawYears)) : 99;
  const fireProgress = fireNumber > 0 ? Math.min(100, (metrics.totalValue / fireNumber) * 100) : 0;

  // --- Smart allocations (memoized) ---
  // 2026 perf audit (M1): keyed on the exact symbols + fields
  // getSmartAllocations reads (the ALPHA ETF lists + VIX + BTC/ETH), not the
  // whole livePrices object (whose identity changes on EVERY flush).
  const smartAllocFeedKey = useMemo(() => {
    const syms = [
      ...ALPHA_ETFS_IN.map(e => `IN_${e.sym}`),
      ...ALPHA_ETFS_US.map(e => `US_${e.sym}`),
      'IN_BTC', 'IN_ETH', 'US_VIX', 'IN_INDIAVIX',
    ];
    return syms.map(k => {
      const d = livePrices[k];
      if (!d) return '0';
      return `${(d.price ?? 0).toFixed(2)}:${(d.rsi ?? 0).toFixed(0)}:${(d.low ?? 0).toFixed(2)}:${(d.high ?? 0).toFixed(2)}:${(d.sma20 ?? 0).toFixed(1)}:${(d.sma50 ?? 0).toFixed(1)}`;
    }).join('|');
  }, [livePrices]);
  const smartAllocations = useMemo(() => getSmartAllocations(livePrices, indiaSIP, usSIP, btcSIP, ethSIP, usdInrRate),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [smartAllocFeedKey, indiaSIP, usSIP, btcSIP, ethSIP, usdInrRate]);

  // --- Handlers ---
  // SECURITY: PIN is verified SERVER-SIDE via /api/auth/login. The server
  // compares the PIN against APP_PIN (server-side env var, never exposed to
  // the browser) and sets an httpOnly session cookie. The previous client-side
  // check (pinInput === VITE_SECURE_PIN || '2023') was trivially bypassable.
  const verifyPin = useCallback(async () => {
    if (!pinInput) return;
    try {
      const proxyBase = (import.meta.env.VITE_API_PROXY as string) || '';
      const res = await apiFetch(`${proxyBase}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pin: pinInput }),
      });
      if (res.ok) {
        const data = await res.json().catch(() => ({}));
        // Store the session token for EventSource (SSE can't use cookies cross-origin).
        if (data.sessionToken) setSessionToken(data.sessionToken);
        secureStorage.setItem('authDone', 'true');
        setIsAuthenticated(true);
      } else if (res.status === 401) {
        alert('❌ Security Access Denied. Galat PIN!');
        setPinInput('');
      } else {
        alert(`⚠️ Login failed (HTTP ${res.status}). Check server logs.`);
        setPinInput('');
      }
    } catch (e) {
      console.warn('Login failed:', e);
      const proxyBase = (import.meta.env.VITE_API_PROXY as string) || '';
      if (!proxyBase) {
        alert('⚠️ Login failed: VITE_API_PROXY is not set. If frontend and backend are on different domains, set VITE_API_PROXY to the backend URL (e.g. https://smartback-iyuq.onrender.com) in Vercel environment variables.');
      } else {
        alert(`⚠️ Cannot reach backend at ${proxyBase}. Check: 1) Backend is deployed and running, 2) ALLOWED_ORIGINS on backend includes this frontend URL, 3) Network/CORS settings.`);
      }
      setPinInput('');
    }
  }, [pinInput]);

  const logout = useCallback(() => {
    secureStorage.removeItem('authDone');
    setIsAuthenticated(false);
    setPinInput('');
    setSessionToken(null);
    // Also invalidate the server-side session.
    const proxyBase = (import.meta.env.VITE_API_PROXY as string) || '';
    apiFetch(`${proxyBase}/api/auth/logout`, { method: 'POST' }).catch(() => {});
  }, []);

  const analyzeSymbol = useCallback(async () => {
    if (isAnalyzing || !symbolInput.trim()) return;
    setIsAnalyzing(true);
    const sym = symbolInput.toUpperCase().trim();
    try {
      const result = await fetchSinglePrice(sym);
      if (result && result.price > 0) {
        setCurrentSymbol(sym); setCurrentMarket(result.market as 'IN' | 'US');
        const key = `${result.market}_${sym}`;
        // v5.0: ref-first write (rare, user-initiated → sync immediately).
        livePricesRef.current = { ...(livePricesRef.current || {}), [key]: result };
        setLivePrices(livePricesRef.current);
      }
    } catch (e) { console.warn('Analyze error:', e); }
    finally { setIsAnalyzing(false); }
  }, [isAnalyzing, symbolInput]);

  const quickSelect = useCallback((sym: string) => {
    const fullSym = sym.toUpperCase().trim();
    setSymbolInput(fullSym.replace('.NS', ''));
    (async () => {
      setIsAnalyzing(true);
      try {
        const result = await fetchSinglePrice(fullSym);
        if (result && result.price > 0) {
          setCurrentSymbol(fullSym); setCurrentMarket(result.market as 'IN' | 'US');
          const key = `${result.market}_${fullSym}`;
          // v5.0: ref-first write (rare, user-initiated → sync immediately).
          livePricesRef.current = { ...(livePricesRef.current || {}), [key]: result };
          setLivePrices(livePricesRef.current);
        }
      } catch (e) { console.warn('Symbol analysis failed:', e); }
      finally { setIsAnalyzing(false); }
    })();
  }, []);

  const openAddModal = useCallback((position?: Position) => {
    if (position) {
      setAddSymbol(position.symbol); setAddQty(position.qty.toString()); setAddPrice(position.avgPrice.toString());
      setAddDate(position.dateAdded); setEditId(position.id);
    } else {
      setAddSymbol(currentSymbol || ''); setAddQty(''); setAddPrice('');
      setAddDate(getTodayString()); setEditId(null);
    }
    setTransactionType('buy'); setShowAddModal(true);
    if (currentSymbol) {
      fetchSinglePrice(currentSymbol).then(result => {
        if (result) {
          let finalPrice = result.price;
          if (isCryptoSymbol(currentSymbol.replace('.NS', '').replace('.BO', '')) && result.market === 'IN' && result.tvExchange === 'BINANCE') {
            finalPrice *= usdInrRateRef.current;
          }
          setModalPrice({ price: finalPrice, change: result.change, market: result.market });
          setAddPrice(finalPrice.toString());
        }
      });
    }
  }, [currentSymbol]);

  const savePosition = useCallback(() => {
    const qty = parseFloat(addQty);
    const price = parseFloat(addPrice);
    const leverage = 1;
    if (!addSymbol || isNaN(qty) || isNaN(price) || qty <= 0 || price <= 0) {
      alert('Neural Error: Quantity ya price sahi daalo bhai.'); return;
    }
    const mkt = (modalPrice?.market || guessMarket(addSymbol)) as 'IN' | 'US';

    // Helper to append a transaction to the ledger (powers monthly analytics + return reports)
    // txnMarket override keeps the ledger honest when the sell resolves to a
    // position whose recorded market differs from the modal's market guess.
    const recordTxn = (
      type: TransactionType, prevQty: number, prevAvg: number,
      newQty: number, newAvg: number, realizedPL?: number, txnMarket?: 'IN' | 'US'
    ) => {
      const txn: Transaction = {
        id: `${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
        symbol: addSymbol, market: txnMarket || mkt, type, qty, price,
        amount: qty * price, date: addDate || getTodayString(), ts: Date.now(),
        prevQty, prevAvg, newQty, newAvg,
        ...(realizedPL !== undefined ? { realizedPL } : {}),
      };
      setTransactions(prev => [...prev, txn]);
    };

    if (transactionType === 'sell') {
      // 2026-09 audit fix (silent sell no-op): the position lookup used
      // symbol+market where market came from the ADD-time modal price —
      // which can differ from what guessMarket() now returns for the same
      // symbol (e.g. stale live-price fetch vs a fresh guess). When the
      // exact match misses, fall back to symbol-only: the user clicked
      // SELL on a specific row, the symbol identifies it, and a silent
      // no-op (no txn, no removal, no error) is the worst outcome.
      let idx = portfolio.findIndex(p => p.symbol === addSymbol && p.market === mkt);
      if (idx < 0) idx = portfolio.findIndex(p => p.symbol === addSymbol);
      if (idx >= 0) {
        const pos = portfolio[idx];
        const newQty = pos.qty - qty;
        const realizedPL = (price - pos.avgPrice) * qty; // booked profit/loss (native)
        recordTxn('sell', pos.qty, pos.avgPrice, Math.max(0, newQty), pos.avgPrice, realizedPL, pos.market);
        if (newQty <= 0) setPortfolio(prev => prev.filter((_, i) => i !== idx));
        else setPortfolio(prev => prev.map((p, i) => i === idx ? { ...p, qty: newQty } : p));
      }
    } else {
      if (editId) {
        const pos = portfolio.find(p => p.id === editId);
        recordTxn('buy', pos?.qty || 0, pos?.avgPrice || price, qty, price);
        setPortfolio(prev => prev.map(p => p.id === editId ? { ...p, symbol: addSymbol, qty, avgPrice: price, leverage, dateAdded: addDate, market: mkt } : p));
      } else {
        const existing = portfolio.find(p => p.symbol === addSymbol && p.market === mkt);
        if (existing) {
          const totalQty = existing.qty + qty;
          const totalCost = (existing.qty * existing.avgPrice) + (qty * price);
          const newAvg = totalCost / totalQty;
          recordTxn('buy', existing.qty, existing.avgPrice, totalQty, newAvg);
          setPortfolio(prev => prev.map(p => p.id === existing.id ? { ...p, qty: totalQty, avgPrice: newAvg, leverage: Math.max(p.leverage, leverage) } : p));
        } else {
          recordTxn('buy', 0, price, qty, price);
          setPortfolio(prev => [...prev, { id: Date.now().toString(), symbol: addSymbol, market: mkt, qty, avgPrice: price, leverage, dateAdded: addDate }]);
        }
      }
    }
    setShowAddModal(false);
  }, [addSymbol, addQty, addPrice, addDate, transactionType, editId, modalPrice, portfolio]);

  // --- Transaction ledger: manual delete / edit ---
  const deleteTransaction = useCallback((id: string) => {
    setTransactions(prev => prev.filter(t => t.id !== id));
  }, []);

  const editTransaction = useCallback((id: string, patch: Partial<Transaction>) => {
    setTransactions(prev => prev.map(t => {
      if (t.id !== id) return t;
      const merged = { ...t, ...patch };
      // keep amount consistent with qty * price
      merged.amount = (merged.qty || 0) * (merged.price || 0);
      return merged;
    }));
  }, []);

  // --- Price alerts: add / update / delete / toggle ---
  const addPriceAlert = useCallback((alert: Omit<PriceAlert, 'id' | 'createdAt' | 'enabled'> & { enabled?: boolean }) => {
    const newAlert: PriceAlert = {
      id: `alert_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      createdAt: Date.now(),
      enabled: alert.enabled ?? true,
      symbol: alert.symbol,
      market: alert.market,
      target: alert.target ?? null,
      stopLoss: alert.stopLoss ?? null,
      note: alert.note || '',
      lastTriggered: undefined,
      triggeredType: null,
    };
    setPriceAlerts(prev => [newAlert, ...prev]);
  }, []);

  const updatePriceAlert = useCallback((id: string, patch: Partial<PriceAlert>) => {
    // reset cooldown when thresholds change so it can re-fire
    setPriceAlerts(prev => prev.map(a => a.id === id
      ? { ...a, ...patch, lastTriggered: undefined, triggeredType: null }
      : a));
  }, []);

  const deletePriceAlert = useCallback((id: string) => {
    setPriceAlerts(prev => prev.filter(a => a.id !== id));
  }, []);

  const togglePriceAlert = useCallback((id: string) => {
    setPriceAlerts(prev => prev.map(a => a.id === id ? { ...a, enabled: !a.enabled } : a));
  }, []);

  // --- Force refresh everything: forex + live prices + cloud portfolio ---
  const refreshAll = useCallback(async () => {
    setIsRefreshing(true);
    setSyncStatus('🔄 Refreshing…');
    try {
      // 1) Forex (24x7) — keep last good rate on failure (audit M6)
      const ratePromise = fetchForexRateOrNull().then(rate => { if (rate != null) setUsdInrRate(rate); }).catch(() => { });

      // 2) Portfolio source refresh — INDMoney snapshot when active
      //    (Google Sheets is disconnected in that mode).
      const cloudPromise = indmActiveRef.current ? loadIndmAssets() : mergeCloudData();

      // 3) Live prices for current portfolio + key indices
      const cur = portfolioRef.current;
      const defaults = ['IN_NIFTY', 'US_SPY', 'US_QQQ', 'IN_BTC', 'IN_ETH'];
      const keys = [...new Set([...cur.map(p => `${p.market}_${p.symbol}`), ...defaults])];
      const positions: Position[] = keys.map(k => {
        const idx = k.indexOf('_');
        const market = k.substring(0, idx) as 'IN' | 'US';
        const sym = k.substring(idx + 1);
        return { id: `refresh-${k}`, symbol: sym, market, qty: 1, avgPrice: 1, leverage: 1, dateAdded: getTodayString() };
      });
      const pricePromise = batchFetchPrices(positions, (key, data) => { pendingPricesRef.current[key] = { ...(pendingPricesRef.current[key] || {}), ...data } as PriceData; })
        .then(() => flushPricesToStorage()).catch(() => { });

      await Promise.all([ratePromise, cloudPromise, pricePromise]);
      setSyncStatus('✅ Refreshed');
    } catch {
      setSyncStatus('⚠️ Refresh failed');
    } finally {
      setIsRefreshing(false);
      setTimeout(() => setSyncStatus(''), 2500);
    }
  }, [flushPricesToStorage, mergeCloudData, loadIndmAssets]);

  const pushTelegramReport = useCallback(async () => {
    const [tgToken, tgChatId] = await Promise.all([secureStorage.getItemAsync('TG_TOKEN'), secureStorage.getItemAsync('TG_CHAT_ID')]);
    const msg = `🧠 <b>Quantum AI Master Report</b>\n\n🌍 <b>Global State:</b> ${sentiment.text}\n\n💼 <b>Total Equity:</b> ₹${Math.round(metrics.totalValue).toLocaleString('en-IN')}\n📈 <b>P&L:</b> ${metrics.totalPL >= 0 ? '+' : ''}₹${Math.round(metrics.totalPL).toLocaleString('en-IN')} (${metrics.plPct.toFixed(2)}%)\n⚡ <b>Today:</b> ${metrics.todayPL >= 0 ? '+' : ''}₹${Math.round(metrics.todayPL).toLocaleString('en-IN')}`;
    setSyncStatus('📤 Sending…');
    // sendTelegramAlert falls back to the server proxy (bot's token) when local config is missing
    const ok = await sendTelegramAlert(tgToken || '', tgChatId || '', msg);
    setSyncStatus(ok ? '✅ Sent' : '⚠️ Telegram not configured');
    setTimeout(() => setSyncStatus(''), 3000);
  }, [sentiment, metrics]);

  const toggleTheme = useCallback(() => {
    const newTheme = theme === 'dark' ? 'light' : 'dark';
    setTheme(newTheme); secureStorage.setItem('theme', newTheme);
  }, [theme]);

  // FIX (audit C2): flushCache previously read sensitive keys with the SYNC
  // getItem(), which always returns null for `enc:` values (WebCrypto is
  // async-only). The preserve-list therefore captured nothing for API keys /
  // Telegram credentials and localStorage.clear() silently destroyed them.
  // Now async: sensitive keys are read with getItemAsync and written back
  // (re-encrypted) after the clear.
  const flushCache = useCallback(async () => {
    const preserveKeys = [
      'WEALTH_AI_KEYS', 'WEALTH_AI_GROQ',
      'WEALTH_AI_TAVILY', 'TG_TOKEN', 'TG_CHAT_ID',
      'theme', 'portfolio', 'plannerSettings', 'wealth_goals', 'authDone',
      // FIX OPT-4: previously flushCache silently wiped all transaction
      // history and price alerts — user lost their entire trade ledger.
      'txn_history', 'price_alerts',
      // Cloud-state sync keys (SIP frequency + last cloud timestamp)
      'plan_tracker_us_freq', 'cloud_state_ts',
    ];
    const sensitive = new Set(['WEALTH_AI_KEYS', 'WEALTH_AI_GROQ', 'WEALTH_AI_TAVILY', 'TG_TOKEN', 'TG_CHAT_ID']);
    const saved: Record<string, string> = {};
    // Phase 1 — read everything BEFORE clearing (sensitive keys via async path).
    for (const k of preserveKeys) {
      const v = sensitive.has(k)
        ? await secureStorage.getItemAsync(k)
        : secureStorage.getItem(k);
      if (v) saved[k] = v;
      // Preserve undecryptable-ciphertext backups too (audit C3 recovery path).
      try {
        const bak = localStorage.getItem(`${k}_undecryptable`);
        if (bak) saved[`${k}_undecryptable`] = bak;
      } catch { /* ignore */ }
    }
    // Phase 2 — wipe, then restore.
    secureStorage.clear();
    for (const [k, v] of Object.entries(saved)) {
      if (k.endsWith('_undecryptable')) secureStorage.setItemPlain(k, v);
      else secureStorage.setItem(k, v);
    }
    window.location.reload();
  }, []);

  return useMemo(() => ({
    // Auth
    isAuthenticated, pinInput, setPinInput, verifyPin, logout,
    // Core
    activeTab, setActiveTab, portfolio, setPortfolio, transactions, setTransactions, livePrices, usdInrRate, usdAppRate, setUsdAppRate, theme,
    // Transaction ledger helpers
    deleteTransaction, editTransaction,
    // Price alerts
    priceAlerts, setPriceAlerts, addPriceAlert, updatePriceAlert, deletePriceAlert, togglePriceAlert,
    // Refresh
    refreshAll, isRefreshing,
    currentSymbol, setCurrentSymbol, currentMarket, setCurrentMarket,
    symbolInput, setSymbolInput, isAnalyzing, chartInterval, setChartInterval,
    liveStatus, syncStatus, feedStatus,
    // Planner
    indiaSIP, setIndiaSIP, usSIP, setUsSIP, btcSIP, setBtcSIP, ethSIP, setEthSIP,
    emergencyFund, setEmergencyFund, investYears, setInvestYears, riskLevel, setRiskLevel,
    monthlyExpenses, setMonthlyExpenses, currentAge, setCurrentAge,
    usFrequency, setUsFrequency, stateSyncStatus,
    // Sector
    sectorData,
    // Modal
    showAddModal, setShowAddModal, groqKey, addSymbol, setAddSymbol, addQty, setAddQty,
    addPrice, setAddPrice, addDate, setAddDate,
    // API Keys
    aiKeys, updateAiKeys,
    transactionType, setTransactionType, modalPrice, setModalPrice, editId, setEditId,
    autoTelegram, setAutoTelegram,
    // Advanced
    wsLatency, portfolioContextText,
    // Refs
    chartContainerRef,
    // Computed
    usVix, inVix, avgVix, sentiment, currentData, currentPrice, currentChange, currentRsi,
    signalData, metrics,
    // Planner computed
    totalSIP, cagr,
    fireNumber, yearsToFire, fireProgress,
    // Smart allocations (memoized)
    smartAllocations,
    // Handlers
    analyzeSymbol, quickSelect, openAddModal, savePosition, pushTelegramReport,
    toggleTheme, flushCache, loadTradingViewChart,
    // Re-exports for tabs
    loadFromCloud,
    // INDMoney synced asset table (source of truth when connected)
    indmSource, indmMeta, indmSyncing, loadIndmAssets,
    removeIndmAsset, restoreIndmAsset,
  }), [
    isAuthenticated, pinInput, setPinInput, verifyPin, logout,
    activeTab, setActiveTab, portfolio, transactions, livePrices, usdInrRate, theme,
    deleteTransaction, editTransaction,
    priceAlerts, addPriceAlert, updatePriceAlert, deletePriceAlert, togglePriceAlert,
    refreshAll, isRefreshing,
    currentSymbol, currentMarket,
    symbolInput, isAnalyzing, chartInterval,
    liveStatus, syncStatus, feedStatus,
    indiaSIP, usSIP, btcSIP, ethSIP,
    emergencyFund, investYears, riskLevel,
    monthlyExpenses, currentAge,
    usFrequency, stateSyncStatus,
    sectorData,
    showAddModal, groqKey, addSymbol, addQty,
    addPrice, addDate,
    aiKeys, updateAiKeys,
    transactionType, modalPrice, editId,
    autoTelegram,
    wsLatency, portfolioContextText,
    usVix, inVix, avgVix, sentiment, currentData, currentPrice, currentChange, currentRsi,
    signalData, metrics,
    totalSIP, cagr,
    fireNumber, yearsToFire, fireProgress,
    smartAllocations,
    analyzeSymbol, quickSelect, openAddModal, savePosition, pushTelegramReport,
    toggleTheme, flushCache, loadTradingViewChart,
    indmSource, indmMeta, indmSyncing, loadIndmAssets,
    removeIndmAsset, restoreIndmAsset,
  ]);
}
