import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { Position, PriceData, TabType, RiskLevel, TransactionType, Transaction, PriceAlert } from '../types';
import {
  DEFAULT_USD_INR, getTodayString, guessMarket, isCryptoSymbol, resolveTvChartSymbol
} from '../utils/constants';
import {
  fetchSinglePrice, batchFetchPrices, batchFetchIndianPrices, getIndiaPollInterval,
  batchFetchUSPrices, getUSPollInterval, fetchForexRate,
  syncToCloud, loadFromCloud, sendTelegramAlert,
  syncGroqKeyToCloud, loadGroqKeyFromCloud, getBatchInterval, fetchMarketIntelligence,
  apiFetch, setSessionToken,
} from '../utils/api';
import { secureStorage } from '../utils/secureStorage';
import { subscribeToPrices, disconnectPrices, getWebSocketLatency } from '../utils/tvWebsocket';
import { connectLiveStream } from '../utils/liveStream';
import { isAnyMarketOpen, isIndiaMarketOpen, isUSMarketOpen, analyzeAsset, getSmartAllocations, generateDeepAnalysis } from '../utils/telegram';
import { generateWeeklyWealthReport } from '../utils/wealthEngine';
import { applyPortfolioDiff } from '../utils/portfolioDiffEngine';
import { recordDailyPL, computeLiveDailyPL } from '../utils/dailyPLTracker';

function mergePriceData(existing: PriceData | undefined, incoming: Partial<PriceData>): PriceData {
  const time = incoming.time ?? Date.now();
  
  // Real-time status
  const existingRealtime = existing?.isRealtime ?? false;
  const incomingRealtime = incoming.isRealtime ?? false;

  // If existing is real-time, but incoming is NOT, reject incoming
  if (existingRealtime && !incomingRealtime) {
    return existing!;
  }

  // If incoming is real-time, but existing is NOT, always accept incoming (skip freshness check)
  if (incomingRealtime && !existingRealtime) {
    // Accept incoming
  } else {
    // If both are same real-time status, apply freshness check
    if (existing && incoming.time && existing.time && incoming.time < existing.time - 2000) {
      return existing;
    }
  }

  const price = incoming.price ?? existing?.price ?? 0;
  const change = incoming.change ?? existing?.change ?? 0;
  const high = incoming.high ?? existing?.high;
  const low = incoming.low ?? existing?.low;
  const volume = incoming.volume ?? existing?.volume;
  const rsi = incoming.rsi ?? existing?.rsi ?? 50;
  const market = incoming.market ?? existing?.market ?? 'IN';
  const sma20 = incoming.sma20 ?? existing?.sma20;
  const sma50 = incoming.sma50 ?? existing?.sma50;
  const macd = incoming.macd ?? existing?.macd;
  const tvExchange = incoming.tvExchange ?? existing?.tvExchange;
  const tvExactSymbol = incoming.tvExactSymbol ?? existing?.tvExactSymbol;
  const isRealtime = incomingRealtime || existingRealtime;

  if (existing && price > 0 && Math.abs(existing.price - price) / price < 0.00005 && existing.change === change && existing.rsi === rsi && existing.isRealtime === isRealtime) {
    return existing;
  }
  return { price, change, high, low, volume, rsi, time, market, sma20, sma50, macd, tvExchange, tvExactSymbol, isRealtime };
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

  const [theme, setTheme] = useState<'dark' | 'light'>(() => (secureStorage.getItem('theme') as 'dark' | 'light') || 'dark');
  const [currentSymbol, setCurrentSymbol] = useState('');
  const [currentMarket, setCurrentMarket] = useState<'IN' | 'US'>('IN');
  const [symbolInput, setSymbolInput] = useState('');
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [chartInterval, setChartInterval] = useState('D');
  const [liveStatus, setLiveStatus] = useState('Connecting...');
  const [feedStatus, setFeedStatus] = useState<Record<string, boolean>>({});
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
  const lastLocalSaveRef = useRef(0);
  const pendingPricesRef = useRef<Record<string, PriceData>>({});
  const portfolioRef = useRef(portfolio);
  const livePricesRef = useRef(livePrices);
  const transactionsRef = useRef(transactions);
  const priceAlertsRef = useRef(priceAlerts);
  const latestDataRef = useRef({ portfolio, livePrices, usdInrRate });

  useEffect(() => { portfolioRef.current = portfolio; }, [portfolio]);
  useEffect(() => { livePricesRef.current = livePrices; }, [livePrices]);
  useEffect(() => { transactionsRef.current = transactions; }, [transactions]);
  useEffect(() => { priceAlertsRef.current = priceAlerts; }, [priceAlerts]);

  const portfolioSymbolKey = useMemo(() => portfolio.map(p => p.symbol).sort().join(','), [portfolio]);

  // --- Flush prices ---
  const flushPricesToStorage = useCallback(() => {
    const batched = { ...pendingPricesRef.current };
    pendingPricesRef.current = {};
    if (Object.keys(batched).length === 0) return;
    setLivePrices(prev => {
      const merged = { ...prev };
      let changed = false;
      for (const [key, data] of Object.entries(batched)) {
        const existing = merged[key] as PriceData | undefined;
        const result = mergePriceData(existing, data);
        if (result !== existing) { merged[key] = result; changed = true; }
      }
      if (!changed) return prev;
      const now = Date.now();
      if (now - lastLocalSaveRef.current > 30000) {
        lastLocalSaveRef.current = now;
        try { secureStorage.setItem('livePrices', JSON.stringify(merged)); } catch { /* quota */ }
      }
      return merged;
    });
  }, []);

  // --- Initialize ---
  useEffect(() => {
    const auth = secureStorage.getItem('authDone');
    if (auth === 'true') setIsAuthenticated(true);
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
      if (savedPrices) setLivePrices(JSON.parse(savedPrices));
    } catch (e) { console.warn('Failed to load local state:', e); }

    // 2) CLOUD — background fetch, merge when ready
    // Fire immediately (don't await) so the UI renders local data first.
    loadFromCloud().then(data => {
      if (data && data.length > 0) {
        setPortfolio(prev => {
          // Merge cloud + local by unique key (market + symbol)
          const localMap = new Map<string, Position>();
          for (const p of prev) {
            localMap.set(`${String(p.market || 'IN').toUpperCase()}_${p.symbol}`, p);
          }
          const cloudMap = new Map<string, Position>();
          for (const p of data!) {
            cloudMap.set(`${String(p.market || 'IN').toUpperCase()}_${p.symbol}`, p);
          }
          const merged: Position[] = [];
          const seen = new Set<string>();
          // Cloud positions first (authoritative)
          for (const [key, p] of cloudMap) {
            merged.push(p);
            seen.add(key);
          }
          // Add local-only positions (not in cloud — maybe not synced yet)
          for (const [key, p] of localMap) {
            if (!seen.has(key)) merged.push(p);
          }
          console.log(`☁️ Cloud Sync: merged ${cloudMap.size} cloud + ${merged.length - cloudMap.size} local-only = ${merged.length} total`);
          secureStorage.setItem('portfolio', JSON.stringify(merged));
          return merged;
        });
      } else {
        console.log('☁️ Cloud Sync: no cloud data — keeping local portfolio');
      }
    }).catch(() => { });
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
    fetchForexRate().then(rate => setUsdInrRate(rate));

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

  // --- Price flush interval (5s — WS gives real-time, throttled for performance) ---
  useEffect(() => {
    if (!isAuthenticated) return;
    priceFlushRef.current = window.setInterval(() => { requestAnimationFrame(flushPricesToStorage); }, 5000);
    return () => { if (priceFlushRef.current) { clearInterval(priceFlushRef.current); priceFlushRef.current = null; } };
  }, [isAuthenticated, flushPricesToStorage]);

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

    const pollCrypto = async () => {
      try {
        const res = await apiFetch(`${proxyBase}/api/crypto-prices?t=${Date.now()}`, {
          signal: AbortSignal.timeout(5000)
        });
        if (res.ok) {
          const tickers = await res.json();
          if (!Array.isArray(tickers)) return;
          let updated = false;

          const cryptoSymbols = ['BTC', 'ETH', 'SOL', 'BNB', 'XRP', 'DOGE', 'ADA', 'AVAX', 'DOT', 'MATIC', 'LINK', 'UNI'];

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
      } catch (e) {
        // CoinDCX failed — fallback to Binance USDT price converted to INR
        console.warn('CoinDCX poll failed, trying Binance fallback:', e);
        try {
          const cryptoSymbols = ['BTC', 'ETH', 'SOL', 'BNB', 'XRP', 'DOGE', 'ADA', 'AVAX', 'DOT', 'MATIC', 'LINK', 'UNI'];
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
          for (const result of binanceResults) {
            if (result.status !== 'fulfilled' || !result.value) continue;
            const { sym, price, change } = result.value;
            pendingPricesRef.current[`IN_${sym}`] = {
              price, change, high: price, low: price, volume: 0,
              rsi: 50, time: Date.now(), market: 'IN',
              tvExchange: 'BINANCE', tvExactSymbol: `${sym}USDT`,
              isRealtime: true
            };
            updated = true;
          }
          if (updated) flushPricesToStorage();
        } catch (e2) {
          console.warn('Binance crypto fallback also failed:', e2);
        }
      }
    };

    pollCrypto();
    const cryptoInterval = window.setInterval(pollCrypto, 5000); // 5s ultra-fast for real-time crypto
    return () => { clearInterval(cryptoInterval); };
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
        return (p.market || guessMarket(p.symbol)) === 'IN' && !isCryptoSymbol(clean);
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
  // Dedicated fast poller for US assets (SMH, VGT, SPCX, MU etc.).
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
        return (p.market || guessMarket(p.symbol)) === 'US' && !isCryptoSymbol(clean);
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
      const clean = p.symbol.replace('.NS', '').replace('.BO', '').trim().toUpperCase();
      const mkt = (p.market || guessMarket(p.symbol)).toUpperCase();
      const fullKey = `${mkt}_${p.symbol.trim()}`;
      if (isCryptoSymbol(clean)) { cryptoSymbols.push(clean); cleanToKey[`IN_${clean}`] = fullKey; }
      else if (mkt === 'US') { usSymbols.push(clean); cleanToKey[`US_${clean}`] = fullKey; }
      else { inSymbols.push(clean); cleanToKey[`IN_${clean}`] = fullKey; }
    };
    if (positions.length) positions.forEach(add);
    else {
      ['NIFTY', 'BANKNIFTY'].forEach(s => { inSymbols.push(s); cleanToKey[`IN_${s}`] = `IN_${s}`; });
      ['SPY', 'QQQ'].forEach(s => { usSymbols.push(s); cleanToKey[`US_${s}`] = `US_${s}`; });
    }
    ['BTC', 'ETH'].forEach(s => { if (!cryptoSymbols.includes(s)) { cryptoSymbols.push(s); cleanToKey[`IN_${s}`] = `IN_${s}`; } });

    let lastFlush = 0;
    let flushTimer: number | null = null;
    const throttledFlush = () => {
      const now = Date.now();
      if (now - lastFlush >= 800) { lastFlush = now; flushPricesToStorage(); }
      else if (!flushTimer) {
        flushTimer = window.setTimeout(() => { flushTimer = null; lastFlush = Date.now(); flushPricesToStorage(); }, 800 - (now - lastFlush));
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
      onStatus: (s) => setFeedStatus(s),
    });

    return () => { if (flushTimer) clearTimeout(flushTimer); disconnect(); };
  }, [isAuthenticated, portfolioSymbolKey, flushPricesToStorage]);

  // --- WebSocket + HTTP sync ---
  useEffect(() => {
    if (!isAuthenticated) return;
    const currentPortfolio = portfolioRef.current;
    const defaultSymbols = ['IN_NIFTY', 'US_SPY', 'US_QQQ', 'IN_BANKNIFTY', 'US_AAPL', 'US_TSLA', 'IN_INDIAVIX', 'US_VIX', 'IN_BTC', 'IN_ETH'];
    let symbolsToSub = currentPortfolio.length > 0 ? [...new Set(currentPortfolio.map(p => `${p.market}_${p.symbol}`))] : defaultSymbols;
    if (!symbolsToSub.includes('IN_BTC')) symbolsToSub.push('IN_BTC');
    if (!symbolsToSub.includes('IN_ETH')) symbolsToSub.push('IN_ETH');
    const positionsToSub: Position[] = symbolsToSub.map(symbol => {
      const idx = symbol.indexOf('_');
      const market = symbol.substring(0, idx) as 'IN' | 'US';
      const sym = symbol.substring(idx + 1);
      return { id: `temp-${symbol}`, symbol: sym, market, qty: 1, avgPrice: 1, leverage: 1, dateAdded: getTodayString() };
    });
    let statusThrottle = 0;
    const sync = async () => {
      if (statusThrottle < 3) { setLiveStatus('● SYNCING...'); statusThrottle++; }
      await batchFetchPrices(positionsToSub, (key, data) => { pendingPricesRef.current[key] = { ...(pendingPricesRef.current[key] || {}), ...data } as PriceData; });
      flushPricesToStorage();
      if (statusThrottle < 3) setLiveStatus('● QUANTUM LINK ACTIVE');
    };
    sync();
    syncIntervalRef.current = window.setInterval(sync, getBatchInterval());
    let statusCounter = 0;
    let lastFlushTime = 0;
    let flushTimer: number | null = null;

    const throttledFlush = () => {
      const now = Date.now();
      if (now - lastFlushTime >= 1000) {
        lastFlushTime = now;
        flushPricesToStorage();
      } else if (!flushTimer) {
        flushTimer = window.setTimeout(() => {
          flushTimer = null;
          lastFlushTime = Date.now();
          flushPricesToStorage();
        }, 1000 - (now - lastFlushTime));
      }
    };

    const unsubscribeTv = subscribeToPrices(symbolsToSub.map(s => s.split('_')[1]), (key, data) => {
      pendingPricesRef.current[key] = { ...(pendingPricesRef.current[key] || {}), ...data } as PriceData;
      statusCounter++;
      if (statusCounter % 50 === 1) setLiveStatus('● TV SOCKET LIVE ⚡');
      throttledFlush();
    });
    return () => {
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
  // Computes live daily P&L from the `change` field of each position
  // (same as broker P&L: qty × price × change%). Freezes into log.
  useEffect(() => {
    if (!isAuthenticated || portfolio.length === 0) return;
    const t = setTimeout(() => {
      const livePL = computeLiveDailyPL(portfolio, livePricesRef.current, usdInrRateRef.current);
      recordDailyPL(livePL);
    }, 3000);  // debounce 3s
    return () => clearTimeout(t);
  }, [portfolio, isAuthenticated, livePrices]);

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
  // FIX HIGH #9: previously `usdInrRate` was in deps, but forex updates every
  // 15s → cloud sync POSTed every ~20s even when portfolio unchanged → risk of
  // Apps Script quota exhaustion. Drop usdInrRate from deps; syncToCloud reads
  // it at call time via the ref.
  useEffect(() => {
    if (portfolio.length === 0) return;
    if (cloudSyncTimerRef.current) clearTimeout(cloudSyncTimerRef.current);
    cloudSyncTimerRef.current = window.setTimeout(() => {
      syncToCloud(portfolio, usdInrRateRef.current);
    }, 5000);
    return () => { if (cloudSyncTimerRef.current) clearTimeout(cloudSyncTimerRef.current); };
  }, [portfolio]);

  // --- Forex refresh (realtime 24x7, every 15s) ---
  useEffect(() => {
    if (!isAuthenticated) return;
    const refreshForex = async () => {
      const rate = await fetchForexRate(); setUsdInrRate(rate);
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
  // FIX: indPL/usPL/cryptoPL ab sab INR-normalized hain (consistent currency),
  // taaki dashboard pe split buckets compare/add karte waqt mismatch na ho.
  const calculateMetrics = useCallback((
    p: Position[] = portfolioRef.current,
    lp: Record<string, PriceData> = livePricesRef.current,
    rate: number = usdInrRateRef.current
  ) => {
    let totalInvested = 0, totalValue = 0, todayPL = 0;
    let indPL = 0, usPL = 0, cryptoPL = 0;
    let totalInvestedINR = 0, totalValueINR = 0;
    let totalInvestedUSD = 0, totalValueUSD = 0;

    p.forEach(pos => {
      const key = `${pos.market}_${pos.symbol}`;
      const data = lp[key];
      const curPrice = data?.price || pos.avgPrice;
      const change = data?.change || 0;
      const lev = pos.leverage || 1;
      const posSize = pos.avgPrice * pos.qty;
      const inv = posSize / lev;
      const curVal = curPrice * pos.qty;
      const eqVal = inv + (curVal - posSize);
      const invINR = pos.market === 'IN' ? inv : inv * rate;
      const valINR = pos.market === 'IN' ? eqVal : eqVal * rate;
      totalInvested += invINR; totalValue += valINR;

      if (pos.market === 'IN') {
        totalInvestedINR += inv;
        totalValueINR += eqVal;
      } else {
        totalInvestedUSD += inv;
        totalValueUSD += eqVal;
      }

      const prevPrice = change <= -100 ? curPrice * 2 : curPrice / (1 + (change / 100));
      const dayPL = (curPrice - prevPrice) * pos.qty;
      const dayPLINR = pos.market === 'IN' ? dayPL : dayPL * rate;
      todayPL += dayPLINR;

      // FIX: All P&L buckets in INR for consistent comparison/aggregation.
      const cleanSym = pos.symbol.replace('.NS', '').replace('.BO', '');
      if (isCryptoSymbol(cleanSym)) {
        cryptoPL += dayPLINR;
      } else if (pos.market === 'IN') {
        indPL += dayPLINR;
      } else {
        usPL += dayPLINR; // INR-normalized (was USD native before)
      }
    });
    const totalPL = totalValue - totalInvested;
    const plPct = totalInvested > 0 ? (totalPL / totalInvested) * 100 : 0;
    const todayPct = (totalValue - todayPL) > 0 ? (todayPL / (totalValue - todayPL)) * 100 : 0;
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
      totalValueUSD
    };
  }, []);

  const metrics = useMemo(() => calculateMetrics(portfolio, livePrices, usdInrRate), [calculateMetrics, portfolio, livePrices, usdInrRate]);

  // Update latestDataRef for telegram interval
  useEffect(() => { latestDataRef.current = { portfolio, livePrices, usdInrRate }; }, [portfolio, livePrices, usdInrRate]);

  // --- Context regeneration (throttled 120s) ---
  useEffect(() => {
    if (!isAuthenticated) return;
    const generateContext = () => {
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
        ctx += `${idx + 1}. ${cleanSym} [${assetType}] | Price=${curPrice.toFixed(2)} | Chg=${change >= 0 ? '+' : ''}${change.toFixed(2)}% | RSI=${rsi.toFixed(0)} | MACD=${macd} | SMA20=${sma20} | SMA50=${sma50} | Trend=${trend} | Vol=${vol} | Signal=${sig.signal} | Confidence=${sig.confidence}% | SL=${slPrice.toFixed(2)} | TP=${tpPrice.toFixed(2)} | AvgBuy=${pos.avgPrice.toFixed(2)} | Qty=${pos.qty} | Invested=${invested.toFixed(0)} | CurVal=${curVal.toFixed(0)} | P&L=${plPct >= 0 ? '+' : ''}${plPct.toFixed(2)}% (${plAbs >= 0 ? '+' : ''}${plAbs.toFixed(0)}) | Holding=${holdingLabel} | CAGR=${cagrPct >= 0 ? '+' : ''}${cagrPct.toFixed(1)}%\n`;
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
      if (telegramIntervalRef.current) clearInterval(telegramIntervalRef.current);
      if (forexIntervalRef.current) clearInterval(forexIntervalRef.current);
      if (syncIntervalRef.current) clearInterval(syncIntervalRef.current);
      if (cloudSyncTimerRef.current) clearTimeout(cloudSyncTimerRef.current);
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
  const totalSIP = indiaSIP + usSIP + btcSIP + ethSIP;
  const cagr = riskLevel === 'low' ? 8 : riskLevel === 'high' ? 18 : 12;
  const months = investYears * 12;
  const totalInvestedPlanner = totalSIP * months;
  const monthlyRate = cagr / 100 / 12;
  const fvMed = totalSIP > 0 ? totalSIP * (Math.pow(1 + monthlyRate, months) - 1) * (1 + monthlyRate) / monthlyRate : 0;
  const worstRate = Math.max(0.5, cagr - 8) / 100 / 12;
  const fvWorst = totalSIP > 0 ? totalSIP * (Math.pow(1 + worstRate, months) - 1) * (1 + worstRate) / worstRate : 0;
  const fvBest = totalSIP > 0 ? totalSIP * (Math.pow(1 + (cagr + 8) / 100 / 12, months) - 1) * (1 + (cagr + 8) / 100 / 12) / ((cagr + 8) / 100 / 12) : 0;
  const multiplier = totalInvestedPlanner > 0 ? fvMed / totalInvestedPlanner : 0;

  // --- FIRE ---
  const fireNumber = monthlyExpenses * 12 * 25;
  const rawYears = totalSIP > 0 && monthlyRate > 0 && fireNumber > 0 ? Math.log((fireNumber * monthlyRate / totalSIP) + 1) / Math.log(1 + monthlyRate) / 12 : null;
  const yearsToFire = rawYears !== null && isFinite(rawYears) && rawYears > 0 ? Math.max(1, Math.ceil(rawYears)) : 99;
  const fireProgress = fireNumber > 0 ? Math.min(100, (metrics.totalValue / fireNumber) * 100) : 0;

  // --- Smart allocations (memoized) ---
  const smartAllocations = useMemo(() => getSmartAllocations(livePrices, indiaSIP, usSIP, btcSIP, ethSIP, usdInrRate), [livePrices, indiaSIP, usSIP, btcSIP, ethSIP, usdInrRate]);

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
        alert('⚠️ Login failed: VITE_API_PROXY is not set. If frontend and backend are on different domains, set VITE_API_PROXY to the backend URL (e.g. https://smartai1.onrender.com) in Vercel environment variables.');
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
        setLivePrices(prev => ({ ...prev, [key]: result }));
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
          setLivePrices(prev => ({ ...prev, [key]: result }));
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
    const recordTxn = (
      type: TransactionType, prevQty: number, prevAvg: number,
      newQty: number, newAvg: number, realizedPL?: number
    ) => {
      const txn: Transaction = {
        id: `${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
        symbol: addSymbol, market: mkt, type, qty, price,
        amount: qty * price, date: addDate || getTodayString(), ts: Date.now(),
        prevQty, prevAvg, newQty, newAvg,
        ...(realizedPL !== undefined ? { realizedPL } : {}),
      };
      setTransactions(prev => [...prev, txn]);
    };

    if (transactionType === 'sell') {
      const idx = portfolio.findIndex(p => p.symbol === addSymbol && p.market === mkt);
      if (idx >= 0) {
        const pos = portfolio[idx];
        const newQty = pos.qty - qty;
        const realizedPL = (price - pos.avgPrice) * qty; // booked profit/loss (native)
        recordTxn('sell', pos.qty, pos.avgPrice, Math.max(0, newQty), pos.avgPrice, realizedPL);
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
      // 1) Forex (24x7)
      const ratePromise = fetchForexRate().then(rate => setUsdInrRate(rate)).catch(() => { });

      // 2) Live prices for current portfolio + key indices
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

      await Promise.all([ratePromise, pricePromise]);
      setSyncStatus('✅ Refreshed');
    } catch {
      setSyncStatus('⚠️ Refresh failed');
    } finally {
      setIsRefreshing(false);
      setTimeout(() => setSyncStatus(''), 2500);
    }
  }, [flushPricesToStorage]);

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

  const flushCache = useCallback(() => {
    const preserveKeys = [
      'WEALTH_AI_KEYS', 'WEALTH_AI_GROQ',
      'WEALTH_AI_TAVILY', 'TG_TOKEN', 'TG_CHAT_ID',
      'theme', 'portfolio', 'plannerSettings', 'wealth_goals', 'authDone',
      // FIX OPT-4: previously flushCache silently wiped all transaction
      // history and price alerts — user lost their entire trade ledger.
      'txn_history', 'price_alerts',
    ];
    const saved: Record<string, string> = {};
    for (const k of preserveKeys) {
      const v = secureStorage.getItem(k);
      if (v) saved[k] = v;
    }
    secureStorage.clear();
    for (const [k, v] of Object.entries(saved)) secureStorage.setItem(k, v);
    window.location.reload();
  }, []);

  return {
    // Auth
    isAuthenticated, pinInput, setPinInput, verifyPin, logout,
    // Core
    activeTab, setActiveTab, portfolio, setPortfolio, transactions, setTransactions, livePrices, usdInrRate, theme,
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
    totalSIP, cagr, months, totalInvestedPlanner, rate: monthlyRate, fvMed, fvWorst, fvBest, multiplier,
    fireNumber, yearsToFire, fireProgress,
    // Smart allocations (memoized)
    smartAllocations,
    // Handlers
    analyzeSymbol, quickSelect, openAddModal, savePosition, pushTelegramReport,
    toggleTheme, flushCache, loadTradingViewChart,
    // Re-exports for tabs
    loadFromCloud,
  };
}
