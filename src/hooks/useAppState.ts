import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { Position, PriceData, TabType, RiskLevel, TransactionType } from '../types';
import {
  SECURE_PIN, TG_TOKEN, TG_CHAT_ID, DEFAULT_USD_INR,
  getTodayString, guessMarket, EXACT_TICKER_MAP, isCryptoSymbol
} from '../utils/constants';
import {
  fetchSinglePrice, batchFetchPrices, fetchForexRate,
  syncToCloud, loadFromCloud, sendTelegramAlert,
  syncGroqKeyToCloud, loadGroqKeyFromCloud, getBatchInterval, fetchMarketIntelligence
} from '../utils/api';
import { secureStorage } from '../utils/secureStorage';
import { subscribeToPrices, disconnectPrices, getWebSocketLatency } from '../utils/tvWebsocket';
import { isAnyMarketOpen, analyzeAsset, getSmartAllocations, generateDeepAnalysis } from '../utils/telegram';
import { generateWeeklyWealthReport } from '../utils/wealthEngine';

function mergePriceData(existing: PriceData | undefined, incoming: Partial<PriceData>): PriceData {
  const price = incoming.price ?? existing?.price ?? 0;
  const change = incoming.change ?? existing?.change ?? 0;
  const high = incoming.high ?? existing?.high;
  const low = incoming.low ?? existing?.low;
  const volume = incoming.volume ?? existing?.volume;
  const rsi = incoming.rsi ?? existing?.rsi ?? 50;
  const time = incoming.time ?? Date.now();
  const market = incoming.market ?? existing?.market ?? 'IN';
  const sma20 = incoming.sma20 ?? existing?.sma20;
  const sma50 = incoming.sma50 ?? existing?.sma50;
  const macd = incoming.macd ?? existing?.macd;
  const tvExchange = incoming.tvExchange ?? existing?.tvExchange;
  const tvExactSymbol = incoming.tvExactSymbol ?? existing?.tvExactSymbol;
  if (existing && price > 0 && Math.abs(existing.price - price) / price < 0.00005 && existing.change === change && existing.rsi === rsi) {
    return existing;
  }
  return { price, change, high, low, volume, rsi, time, market, sma20, sma50, macd, tvExchange, tvExactSymbol };
}

export function useAppState() {
  // --- Auth ---
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [pinInput, setPinInput] = useState('');

  // --- Core State ---
  const [activeTab, setActiveTab] = useState<TabType>('dashboard');
  const [portfolio, setPortfolio] = useState<Position[]>([]);
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

  // --- API Keys State ---
  const [aiKeys, setAiKeys] = useState<{
    groqKey: string;
    geminiKey: string;
    claudeKey: string;
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
      geminiKey: secureStorage.getItem('WEALTH_AI_GEMINI') || '',
      claudeKey: secureStorage.getItem('WEALTH_AI_CLAUDE') || '',
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
      if (updated.geminiKey) secureStorage.setItem('WEALTH_AI_GEMINI', updated.geminiKey);
      if (updated.claudeKey) secureStorage.setItem('WEALTH_AI_CLAUDE', updated.claudeKey);
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
  const lastContextGenRef = useRef(0);
  const lastLocalSaveRef = useRef(0);
  const pendingPricesRef = useRef<Record<string, PriceData>>({});
  const portfolioRef = useRef(portfolio);
  const livePricesRef = useRef(livePrices);
  const latestDataRef = useRef({ portfolio, livePrices, usdInrRate });

  useEffect(() => { portfolioRef.current = portfolio; }, [portfolio]);
  useEffect(() => { livePricesRef.current = livePrices; }, [livePrices]);

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
  useEffect(() => {
    if (!isAuthenticated) return;
    try {
      const saved = secureStorage.getItem('portfolio');
      if (saved) setPortfolio(JSON.parse(saved));
      const savedPrices = secureStorage.getItem('livePrices');
      if (savedPrices) setLivePrices(JSON.parse(savedPrices));
    } catch (e) { console.warn('Failed to load local state:', e); }
    loadFromCloud().then(data => {
      if (data && data.length > 0) {
        setPortfolio(data);
        secureStorage.setItem('portfolio', JSON.stringify(data));
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
            if (parsed.geminiKey) secureStorage.setItem('WEALTH_AI_GEMINI', parsed.geminiKey);
            if (parsed.claudeKey) secureStorage.setItem('WEALTH_AI_CLAUDE', parsed.claudeKey);
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
              geminiKey: secureStorage.getItem('WEALTH_AI_GEMINI') || '',
              claudeKey: secureStorage.getItem('WEALTH_AI_CLAUDE') || '',
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
  const hasCrypto = useMemo(() => {
    if (portfolio.length === 0) return true; // Default: poll for dashboard crypto widgets
    return portfolio.some(p => isCryptoSymbol(p.symbol.replace('.NS', '').replace('.BO', '')));
  }, [portfolio]);

  useEffect(() => {
    if (!isAuthenticated || !hasCrypto) return;

    const pollCrypto = async () => {
      try {
        const res = await fetch(`https://api.coindcx.com/exchange/ticker?t=${Date.now()}`, {
          signal: AbortSignal.timeout(3000)
        });
        if (res.ok) {
          const tickers = await res.json();
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
                  tvExactSymbol: `${sym}INR`
                };
                updated = true;
              }
            }
          });
          if (updated) flushPricesToStorage();
        }
      } catch (e) {
        console.warn('Crypto fast poll failed:', e);
      }
    };

    pollCrypto();
    const cryptoInterval = window.setInterval(pollCrypto, 10000); // 10s (balanced for performance)
    return () => { clearInterval(cryptoInterval); };
  }, [isAuthenticated, hasCrypto, flushPricesToStorage]);

  // --- WebSocket + HTTP sync ---
  useEffect(() => {
    if (!isAuthenticated) return;
    const currentPortfolio = portfolioRef.current;
    const defaultSymbols = ['IN_NIFTY', 'US_SPY', 'US_QQQ', 'IN_BANKNIFTY', 'US_AAPL', 'US_TSLA', 'IN_INDIAVIX', 'US_VIX', 'IN_BTC', 'IN_ETH'];
    let symbolsToSub = currentPortfolio.length > 0 ? [...new Set(currentPortfolio.map(p => `${p.market}_${p.symbol}`))] : defaultSymbols;
    if (!symbolsToSub.includes('IN_BTC')) symbolsToSub.push('IN_BTC');
    if (!symbolsToSub.includes('IN_ETH')) symbolsToSub.push('IN_ETH');
    const positionsToSub: Position[] = symbolsToSub.map(symbol => {
      const [market, sym] = symbol.split('_') as ['IN' | 'US', string];
      return { id: `temp-${symbol}`, symbol: sym, market, qty: 1, avgPrice: 1, leverage: 1, dateAdded: getTodayString() };
    });
    let statusThrottle = 0;
    const sync = async () => {
      if (statusThrottle < 3) { setLiveStatus('● SYNCING...'); statusThrottle++; }
      await batchFetchPrices(positionsToSub, (key, data) => { pendingPricesRef.current[key] = data; });
      flushPricesToStorage();
      if (statusThrottle < 3) setLiveStatus('● QUANTUM LINK ACTIVE');
    };
    sync();
    syncIntervalRef.current = window.setInterval(sync, getBatchInterval());
    let statusCounter = 0;
    const unsubscribeTv = subscribeToPrices(symbolsToSub.map(s => s.split('_')[1]), (key, data) => {
      pendingPricesRef.current[key] = { ...(pendingPricesRef.current[key] || {}), ...data } as PriceData;
      statusCounter++;
      if (statusCounter % 50 === 1) setLiveStatus('● TV SOCKET LIVE ⚡');
    });
    return () => {
      if (syncIntervalRef.current) clearInterval(syncIntervalRef.current);
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

  // --- Cloud sync (debounced 5s) ---
  useEffect(() => {
    if (portfolio.length === 0) return;
    if (cloudSyncTimerRef.current) clearTimeout(cloudSyncTimerRef.current);
    cloudSyncTimerRef.current = window.setTimeout(() => {
      syncToCloud(portfolio, usdInrRate);
    }, 5000);
    return () => { if (cloudSyncTimerRef.current) clearTimeout(cloudSyncTimerRef.current); };
  }, [portfolio, usdInrRate]);

  // --- Forex refresh (180s) ---
  useEffect(() => {
    if (!isAuthenticated) return;
    const refreshForex = async () => {
      const rate = await fetchForexRate(); setUsdInrRate(rate);
    };
    forexIntervalRef.current = window.setInterval(refreshForex, 180000);
    return () => { if (forexIntervalRef.current) clearInterval(forexIntervalRef.current); };
  }, [isAuthenticated]);

  // --- Load chart ---
  const loadTradingViewChart = useCallback(() => {
    if (!chartContainerRef.current) return;
    chartContainerRef.current.innerHTML = '';
    tvWidgetRef.current = null;
    const cleanSym = currentSymbol.replace('.NS', '').replace('.BO', '');
    const isIndian = currentMarket === 'IN' || currentSymbol.includes('.NS');
    let tvSymbol = EXACT_TICKER_MAP[cleanSym] || (isIndian ? `NSE:${cleanSym}` : `NASDAQ:${cleanSym}`);
    const BSE_CHART_OVERRIDES = ['JUNIORBEES', 'MOMENTUM50', 'SMALLCAP', 'MID150BEES'];
    if (BSE_CHART_OVERRIDES.includes(cleanSym)) tvSymbol = `BSE:${cleanSym}`;
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
  }, [currentSymbol, currentMarket, chartInterval, theme]);

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

      const prevPrice = curPrice / (1 + (change / 100));
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
      setPortfolioContextText(ctx);
    };

    generateContext();
    const interval = window.setInterval(generateContext, 120000); // 120 seconds
    return () => { clearInterval(interval); };
  }, [isAuthenticated, calculateMetrics]);

  // --- Telegram auto-report (OFF by default — bot handles 24x7 alerts) ---
  useEffect(() => {
    if (!isAuthenticated || !autoTelegram || portfolio.length === 0) return;
    if (!TG_TOKEN || !TG_CHAT_ID) return; // FIX: skip if no telegram creds
    const sendIfMarketOpen = async () => {
      const d = latestDataRef.current;
      if (!isAnyMarketOpen()) return;
      const msg = generateDeepAnalysis(d.portfolio, d.livePrices, d.usdInrRate, metrics);
      await sendTelegramAlert(TG_TOKEN, TG_CHAT_ID, msg);
    };
    initialTimeoutRef.current = setTimeout(sendIfMarketOpen, 120000);
    telegramIntervalRef.current = window.setInterval(sendIfMarketOpen, 1800000);
    return () => {
      if (initialTimeoutRef.current) clearTimeout(initialTimeoutRef.current);
      if (telegramIntervalRef.current) clearInterval(telegramIntervalRef.current);
    };
  }, [isAuthenticated, autoTelegram, portfolio.length, metrics]);

  // --- Weekly Wealth Report (Sunday 9 AM IST) ---
  const weeklyReportRef = useRef<string>('');
  useEffect(() => {
    if (!isAuthenticated || !autoTelegram || portfolio.length === 0) return;
    if (!TG_TOKEN || !TG_CHAT_ID) return; // FIX: skip if no telegram creds

    const checkWeeklyReport = () => {
      const now = new Date();
      const ist = new Date(now.toLocaleString('en-US', { timeZone: 'Asia/Kolkata' }));
      const day = ist.getDay(); // 0 = Sunday
      const hour = ist.getHours();
      const todayStr = ist.toISOString().split('T')[0];

      if (day === 0 && hour === 9 && weeklyReportRef.current !== todayStr) {
        weeklyReportRef.current = todayStr;
        const d = latestDataRef.current;
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
          { ...metrics, totalInvested: metrics.totalInvested || 0 },
          totalSIP, investYears, cagr
        );
        sendTelegramAlert(TG_TOKEN, TG_CHAT_ID, msg).catch(() => { });
        console.log('[WeeklyReport] Sunday wealth report sent!');
      }
    };

    const interval = setInterval(checkWeeklyReport, 600000); // every 10 min
    checkWeeklyReport();
    return () => clearInterval(interval);
  }, [isAuthenticated, autoTelegram, portfolio.length, metrics]);

  // --- WS Latency (60s — cosmetic) ---
  useEffect(() => {
    if (!isAuthenticated) return;
    const interval = setInterval(() => { setWsLatency(getWebSocketLatency()); }, 60000);
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
  const smartAllocations = useMemo(() => getSmartAllocations(livePrices, indiaSIP, usSIP, btcSIP, ethSIP), [livePrices, indiaSIP, usSIP, btcSIP, ethSIP]);

  // --- Handlers ---
  const verifyPin = useCallback(() => {
    if (pinInput === SECURE_PIN) { secureStorage.setItem('authDone', 'true'); setIsAuthenticated(true); }
    else { alert('❌ Security Access Denied. Galat PIN!'); setPinInput(''); }
  }, [pinInput]);

  const logout = useCallback(() => {
    secureStorage.removeItem('authDone'); setIsAuthenticated(false); setPinInput('');
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
    const mkt = modalPrice?.market || guessMarket(addSymbol);
    if (transactionType === 'sell') {
      const idx = portfolio.findIndex(p => p.symbol === addSymbol && p.market === mkt);
      if (idx >= 0) {
        const newQty = portfolio[idx].qty - qty;
        if (newQty <= 0) setPortfolio(prev => prev.filter((_, i) => i !== idx));
        else setPortfolio(prev => prev.map((p, i) => i === idx ? { ...p, qty: newQty } : p));
      }
    } else {
      if (editId) {
        setPortfolio(prev => prev.map(p => p.id === editId ? { ...p, symbol: addSymbol, qty, avgPrice: price, leverage, dateAdded: addDate, market: mkt as 'IN' | 'US' } : p));
      } else {
        const existing = portfolio.find(p => p.symbol === addSymbol && p.market === mkt);
        if (existing) {
          const totalQty = existing.qty + qty;
          const totalCost = (existing.qty * existing.avgPrice) + (qty * price);
          setPortfolio(prev => prev.map(p => p.id === existing.id ? { ...p, qty: totalQty, avgPrice: totalCost / totalQty, leverage: Math.max(p.leverage, leverage) } : p));
        } else {
          setPortfolio(prev => [...prev, { id: Date.now().toString(), symbol: addSymbol, market: mkt as 'IN' | 'US', qty, avgPrice: price, leverage, dateAdded: addDate }]);
        }
      }
    }
    setShowAddModal(false);
  }, [addSymbol, addQty, addPrice, addDate, transactionType, editId, modalPrice, portfolio]);

  const pushTelegramReport = useCallback(async () => {
    if (!TG_TOKEN || !TG_CHAT_ID) { setSyncStatus('⚠️ No Telegram config'); setTimeout(() => setSyncStatus(''), 3000); return; }
    const msg = `🧠 <b>Quantum AI Master Report</b>\n\n🌍 <b>Global State:</b> ${sentiment.text}\n\n💼 <b>Total Equity:</b> ₹${Math.round(metrics.totalValue).toLocaleString('en-IN')}\n📈 <b>P&L:</b> ${metrics.totalPL >= 0 ? '+' : ''}₹${Math.round(metrics.totalPL).toLocaleString('en-IN')} (${metrics.plPct.toFixed(2)}%)\n⚡ <b>Today:</b> ${metrics.todayPL >= 0 ? '+' : ''}₹${Math.round(metrics.todayPL).toLocaleString('en-IN')}`;
    await sendTelegramAlert(TG_TOKEN, TG_CHAT_ID, msg);
    setSyncStatus('✅ Sent'); setTimeout(() => setSyncStatus(''), 3000);
  }, [sentiment, metrics]);

  const toggleTheme = useCallback(() => {
    const newTheme = theme === 'dark' ? 'light' : 'dark';
    setTheme(newTheme); secureStorage.setItem('theme', newTheme);
  }, [theme]);

  const flushCache = useCallback(() => {
    const preserveKeys = [
      'WEALTH_AI_KEYS', 'WEALTH_AI_GROQ', 'WEALTH_AI_GEMINI', 'WEALTH_AI_CLAUDE',
      'WEALTH_AI_TAVILY', 'TG_TOKEN', 'TG_CHAT_ID',
      'theme', 'portfolio', 'plannerSettings', 'wealth_goals', 'authDone'
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
    activeTab, setActiveTab, portfolio, setPortfolio, livePrices, usdInrRate, theme,
    currentSymbol, setCurrentSymbol, currentMarket, setCurrentMarket,
    symbolInput, setSymbolInput, isAnalyzing, chartInterval, setChartInterval,
    liveStatus, syncStatus,
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
