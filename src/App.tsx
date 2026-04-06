import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { Position, PriceData, TabType, RiskLevel, TransactionType } from './types';
import {
  SECURE_PIN, TG_TOKEN, TG_CHAT_ID,
  getTodayString, guessMarket, getAssetCagrProxy, formatPrice
} from './utils/constants';
import {
  fetchSinglePrice, batchFetchPrices, fetchForexRate,
  syncToCloud, loadFromCloud, sendTelegramAlert,
  syncGroqKeyToCloud, loadGroqKeyFromCloud
} from './utils/api';
import { subscribeToPrices, disconnectPrices, getWebSocketLatency } from './utils/tvWebsocket';
import {
  isAnyMarketOpen, getMarketStatus, analyzeAsset,
  getSmartAllocations, generateDeepAnalysis
} from './utils/telegram';
import { calculateVaR, runStressTests, analyzeConcentrationRisk, analyzeDrawdown } from './utils/riskEngine';
import { PredictionEngine, TechnicalIndicators, AnomalyDetector } from './utils/mlPrediction';
import { AlertManager, detectSmartMoney } from './utils/alertManager';
import { ETFAnalyticsEngine } from './utils/etfAnalytics';
import { getBatchInterval } from './utils/api';
import { NeuralChat } from './components/NeuralChat';
import { Clock } from './components/Clock';

/**
 * Merge incoming WebSocket price data into existing PriceData.
 * Preserves fields not sent by TV (like sma20, sma50, macd from HTTP batch).
 * Only returns NEW object if a field actually changed — prevents unnecessary re-renders.
 */
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

  // Skip re-render if nothing meaningfully changed (price must differ > 0.01%)
  if (
    existing &&
    price > 0 &&
    Math.abs(existing.price - price) / price < 0.0001 &&
    existing.change === change &&
    existing.rsi === rsi
  ) {
    return existing;
  }

  return { price, change, high, low, volume, rsi, time, market, sma20, sma50, macd, tvExchange, tvExactSymbol };
}

export default function App() {
  // Auth State
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [pinInput, setPinInput] = useState('');

  // Main State
  const [activeTab, setActiveTab] = useState<TabType>('dashboard');
  const [portfolio, setPortfolio] = useState<Position[]>([]);
  const [livePrices, setLivePrices] = useState<Record<string, PriceData>>({});
  const [usdInrRate, setUsdInrRate] = useState(83.5);
  const [theme, setTheme] = useState<'dark' | 'light'>(() => (localStorage.getItem('theme') as 'dark' | 'light') || 'dark');
  const [currentSymbol, setCurrentSymbol] = useState('');
  const [currentMarket, setCurrentMarket] = useState<'IN' | 'US'>('IN');
  const [symbolInput, setSymbolInput] = useState('');
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [chartInterval, setChartInterval] = useState('D');
  const [liveStatus, setLiveStatus] = useState('Connecting...');
  const [syncStatus, setSyncStatus] = useState('');

  // Planner State
  const [indiaSIP, setIndiaSIP] = useState(10000);
  const [usSIP, setUsSIP] = useState(200);
  const [emergencyFund, setEmergencyFund] = useState(50000);
  const [investYears, setInvestYears] = useState(15);
  const [riskLevel, setRiskLevel] = useState<RiskLevel>('medium');
  const [monthlyExpenses, setMonthlyExpenses] = useState(50000);
  const [currentAge, setCurrentAge] = useState(30);

  // Modal State
  const [showAddModal, setShowAddModal] = useState(false);

  // Settings / Keys State
  const [groqKey, setGroqKey] = useState(() => localStorage.getItem('WEALTH_AI_GROQ') || '');
  const [showSettings, setShowSettings] = useState(false);

  // Add Modal State
  const [addSymbol, setAddSymbol] = useState('');
  const [addQty, setAddQty] = useState('');
  const [addPrice, setAddPrice] = useState('');
  const [addDate, setAddDate] = useState(getTodayString());
  const [addLeverage, setAddLeverage] = useState('1');
  const [transactionType, setTransactionType] = useState<TransactionType>('buy');
  const [modalPrice, setModalPrice] = useState<{ price: number; change: number; market: string } | null>(null);
  const [editId, setEditId] = useState<string | null>(null);

  const priceFlushRef = useRef<number | null>(null);
  const chartContainerRef = useRef<HTMLDivElement>(null);
  const [pendingAnalyze, setPendingAnalyze] = useState<string | null>(null);
  const [autoTelegram, setAutoTelegram] = useState(true);
  const telegramIntervalRef = useRef<number | null>(null);
  const forexIntervalRef = useRef<number | null>(null);

  // Advanced features state
  const [wsLatency, setWsLatency] = useState<{ avg: number; heartbeat: number }>({ avg: 500, heartbeat: 15000 });
  const alertManagerRef = useRef<AlertManager>(new AlertManager());
  const anomalyDetectorRef = useRef<AnomalyDetector>(new AnomalyDetector());

  // Initialize
  useEffect(() => {
    const auth = localStorage.getItem('authDone');
    if (auth === 'true') {
      setIsAuthenticated(true);
    }
  }, []);

  // Time update removed -> Replaced by <Clock />

  // Load data when authenticated
  useEffect(() => {
    if (!isAuthenticated) return;

    // Load from localStorage
    try {
      const saved = localStorage.getItem('portfolio');
      if (saved) setPortfolio(JSON.parse(saved));

      const savedPrices = localStorage.getItem('livePrices');
      if (savedPrices) setLivePrices(JSON.parse(savedPrices));
    } catch (e) { }

    // Load from cloud
    loadFromCloud().then(data => {
      if (data && data.length > 0) {
        setPortfolio(data);
        localStorage.setItem('portfolio', JSON.stringify(data));
      }
    }).catch(() => console.warn('Cloud sync unavailable'));

    // Load Groq key from cloud
    loadGroqKeyFromCloud().then(key => {
      if (key) {
        setGroqKey(key);
        localStorage.setItem('WEALTH_AI_GROQ', key);
      }
    }).catch(() => { });

    // Fetch forex rate
    fetchForexRate().then(rate => setUsdInrRate(rate));
  }, [isAuthenticated]);

  const portfolioRef = useRef(portfolio);
  useEffect(() => {
    portfolioRef.current = portfolio;
  }, [portfolio]);

  // Ultra-fast price batching: WebSocket ticks → batch → ~50ms flush to React state
  const pendingPricesRef = useRef<Record<string, PriceData>>({});
  const lastLocalSaveRef = useRef(0);

  // Flush all pending WebSocket ticks into React state (batched at ~50ms intervals)
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
      // Throttle localStorage writes to max every 2s to avoid main thread blocking
      const now = Date.now();
      if (changed && now - lastLocalSaveRef.current > 2000) {
        lastLocalSaveRef.current = now;
        try { localStorage.setItem('livePrices', JSON.stringify(merged)); } catch { /* quota */ }
      }
      return merged;
    });
  }, []);

  // Flush batched WS ticks at ~20fps (50ms) for ultra-smooth UI
  useEffect(() => {
    if (!isAuthenticated || portfolio.length === 0) return;
    priceFlushRef.current = window.setInterval(flushPricesToStorage, 50);
    return () => {
      if (priceFlushRef.current) {
        clearInterval(priceFlushRef.current);
        priceFlushRef.current = null;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAuthenticated, portfolio.length]);

  // Background sync & WebSocket
  useEffect(() => {
    if (!isAuthenticated) return;
    const currentPortfolio = portfolioRef.current;
    if (currentPortfolio.length === 0) return;

    // Fast HTTP Sync (runs every 8s as backup, faster initial fill)
    let statusThrottle = 0;
    const sync = async () => {
      if (statusThrottle < 3) {
        setLiveStatus('● SYNCING...');
        statusThrottle++;
      }
      await batchFetchPrices(currentPortfolio, (key, data) => {
        pendingPricesRef.current[key] = data;
      });
      flushPricesToStorage();
      if (statusThrottle < 3) {
        setLiveStatus('● QUANTUM LINK ACTIVE');
      }
    };

    sync();
    const syncInterval = window.setInterval(sync, getBatchInterval());

    // Ultra-fast TradingView WebSocket — batch all ticks into 100ms flush (zero direct state updates)
    let statusCounter = 0;
    const symbolsToSub = currentPortfolio.map(p => p.symbol);
    const unsubscribe = subscribeToPrices(symbolsToSub, (key, data) => {
      // Queue into batch buffer — flushPricesToStorage handles React state at 10fps
      pendingPricesRef.current[key] = {
        ...(pendingPricesRef.current[key] || {}),
        ...data
      } as PriceData;
      // Only update status every 50th tick to avoid wasteful re-renders
      statusCounter++;
      if (statusCounter % 50 === 1) {
        setLiveStatus('● TV SOCKET LIVE ⚡');
      }
    });

    return () => {
      clearInterval(syncInterval);
      unsubscribe();
      disconnectPrices();
      // Flush any pending prices before cleanup
      flushPricesToStorage();
    };
  }, [isAuthenticated, portfolio.map(p => p.symbol).sort().join(',')]);

  // Save portfolio to localStorage & Handle Initial Symbol
  useEffect(() => {
    if (portfolio.length > 0) {
      localStorage.setItem('portfolio', JSON.stringify(portfolio));
      if (!currentSymbol) {
        setCurrentSymbol(portfolio[0].symbol);
        setCurrentMarket(portfolio[0].market as 'IN' | 'US');
      }
    }
  }, [portfolio]);

  // Load chart when symbol changes
  useEffect(() => {
    if (!isAuthenticated || !chartContainerRef.current || !currentSymbol) return;
    loadTradingViewChart();
  }, [currentSymbol, chartInterval, isAuthenticated, theme]);

  // Verify PIN
  const verifyPin = () => {
    if (pinInput === SECURE_PIN) {
      localStorage.setItem('authDone', 'true');
      setIsAuthenticated(true);
    } else {
      alert('❌ Security Access Denied. Galat PIN!');
      setPinInput('');
    }
  };

  // Logout
  const logout = () => {
    localStorage.removeItem('authDone');
    setIsAuthenticated(false);
    setPinInput('');
  };

  // Analyze symbol
  const analyzeSymbol = async () => {
    if (isAnalyzing || !symbolInput.trim()) return;

    setIsAnalyzing(true);
    const sym = symbolInput.toUpperCase().trim();

    try {
      const result = await fetchSinglePrice(sym);
      if (result && result.price > 0) {
        setCurrentSymbol(sym);
        setCurrentMarket(result.market as 'IN' | 'US');

        const key = `${result.market}_${sym}`;
        setLivePrices(prev => ({ ...prev, [key]: result }));
      }
    } catch (e) {
      console.warn('Analyze error:', e);
    } finally {
      setIsAnalyzing(false);
    }
  };

  // Effect-based analyze trigger for quickSelect
  useEffect(() => {
    if (pendingAnalyze) {
      const sym = pendingAnalyze;
      setPendingAnalyze(null);
      (async () => {
        setIsAnalyzing(true);
        try {
          const result = await fetchSinglePrice(sym);
          if (result && result.price > 0) {
            setCurrentSymbol(sym);
            setCurrentMarket(result.market as 'IN' | 'US');
            const key = `${result.market}_${sym}`;
            setLivePrices(prev => ({ ...prev, [key]: result }));
          }
        } catch (e) { console.warn('Analyze error:', e); }
        finally { setIsAnalyzing(false); }
      })();
    }
  }, [pendingAnalyze]);

  // Quick select from portfolio
  const quickSelect = (sym: string) => {
    const fullSym = sym.toUpperCase().trim();
    setSymbolInput(fullSym.replace('.NS', ''));
    setPendingAnalyze(fullSym);
  };

  // Add/Edit Position
  const openAddModal = (position?: Position) => {
    if (position) {
      setAddSymbol(position.symbol);
      setAddQty(position.qty.toString());
      setAddPrice(position.avgPrice.toString());
      setAddDate(position.dateAdded);
      setAddLeverage(position.leverage.toString());
      setEditId(position.id);
    } else {
      setAddSymbol(currentSymbol || '');
      setAddQty('');
      setAddPrice('');
      setAddDate(getTodayString());
      setAddLeverage('1');
      setEditId(null);
    }
    setTransactionType('buy');
    setShowAddModal(true);

    if (currentSymbol) fetchModalPriceData(currentSymbol);
  };

  const fetchModalPriceData = async (sym: string) => {
    const result = await fetchSinglePrice(sym);
    if (result) {
      setModalPrice({ price: result.price, change: result.change, market: result.market });
      setAddPrice(result.price.toString());
    }
  };

  const savePosition = () => {
    const qty = parseFloat(addQty);
    const price = parseFloat(addPrice);
    const leverage = parseFloat(addLeverage) || 1;

    if (!addSymbol || isNaN(qty) || isNaN(price) || qty <= 0 || price <= 0) {
      alert('Neural Error: Quantity ya price sahi daalo bhai.');
      return;
    }

    const mkt = modalPrice?.market || guessMarket(addSymbol);

    if (transactionType === 'sell') {
      const idx = portfolio.findIndex(p => p.symbol === addSymbol && p.market === mkt);
      if (idx >= 0) {
        const newQty = portfolio[idx].qty - qty;
        if (newQty <= 0) {
          setPortfolio(prev => prev.filter((_, i) => i !== idx));
        } else {
          setPortfolio(prev => prev.map((p, i) => i === idx ? { ...p, qty: newQty } : p));
        }
      }
    } else {
      if (editId) {
        setPortfolio(prev => prev.map(p =>
          p.id === editId ? { ...p, symbol: addSymbol, qty, avgPrice: price, leverage, dateAdded: addDate, market: mkt as 'IN' | 'US' } : p
        ));
      } else {
        const existing = portfolio.find(p => p.symbol === addSymbol && p.market === mkt);
        if (existing) {
          const totalQty = existing.qty + qty;
          const totalCost = (existing.qty * existing.avgPrice) + (qty * price);
          setPortfolio(prev => prev.map(p =>
            p.id === existing.id ? { ...p, qty: totalQty, avgPrice: totalCost / totalQty, leverage: Math.max(p.leverage, leverage) } : p
          ));
        } else {
          setPortfolio(prev => [...prev, {
            id: Date.now().toString(),
            symbol: addSymbol,
            market: mkt as 'IN' | 'US',
            qty,
            avgPrice: price,
            leverage,
            dateAdded: addDate
          }]);
        }
      }
    }

    setShowAddModal(false);
  };

  // Sync to cloud whenever portfolio changes (debounced 3s)
  const cloudSyncTimerRef = useRef<number | null>(null);
  useEffect(() => {
    if (portfolio.length === 0) return;
    if (cloudSyncTimerRef.current) clearTimeout(cloudSyncTimerRef.current);
    cloudSyncTimerRef.current = window.setTimeout(() => {
      syncToCloud(portfolio, usdInrRate);
    }, 3000);
    return () => {
      if (cloudSyncTimerRef.current) clearTimeout(cloudSyncTimerRef.current);
    };
  }, [portfolio]);



  // Continuous Forex Rate Refresh (every 60s)
  useEffect(() => {
    if (!isAuthenticated) return;

    const refreshForex = async () => {
      const rate = await fetchForexRate();
      setUsdInrRate(rate);
    };

    forexIntervalRef.current = window.setInterval(refreshForex, 60000);
    return () => {
      if (forexIntervalRef.current) clearInterval(forexIntervalRef.current);
    };
  }, [isAuthenticated]);

  // Deep Mind AI Neural Chat now handles expert logic natively.

  // Load TradingView Chart
  const loadTradingViewChart = useCallback(() => {
    if (!chartContainerRef.current) return;

    const cleanSym = currentSymbol.replace('.NS', '').replace('.BO', '');
    const isIndian = currentMarket === 'IN' || currentSymbol.includes('.NS');
    const tvSymbol = isIndian ? `BSE:${cleanSym}` : `NASDAQ:${cleanSym}`;

    chartContainerRef.current.innerHTML = '';

    const container = document.createElement('div');
    container.className = 'tradingview-widget-container';
    container.style.height = '100%';
    container.style.width = '100%';

    const inner = document.createElement('div');
    inner.className = 'tradingview-widget-container__widget';
    inner.style.height = '100%';
    inner.style.width = '100%';
    container.appendChild(inner);

    chartContainerRef.current.appendChild(container);

    const script = document.createElement('script');
    script.type = 'text/javascript';
    script.src = 'https://s3.tradingview.com/external-embedding/embed-widget-advanced-chart.js';
    script.async = true;
    script.innerHTML = JSON.stringify({
      autosize: true,
      symbol: tvSymbol,
      interval: chartInterval,
      timezone: 'Asia/Kolkata',
      theme: 'dark',
      style: '1',
      locale: 'en',
      enable_publishing: false,
      allow_symbol_change: true,
      studies: ['STD;RSI', 'STD;MACD']
    });
    container.appendChild(script);
  }, [currentSymbol, currentMarket, chartInterval]);

  // Calculate portfolio metrics
  const calculateMetrics = useCallback(() => {
    let totalInvested = 0, totalValue = 0, todayPL = 0;
    let indPL = 0, usPL = 0;

    portfolio.forEach(p => {
      const key = `${p.market}_${p.symbol}`;
      const data = livePrices[key];
      const curPrice = data?.price || p.avgPrice;
      const change = data?.change || 0;
      const lev = p.leverage || 1;

      const posSize = p.avgPrice * p.qty;
      const inv = posSize / lev;
      const curVal = curPrice * p.qty;
      const eqVal = inv + (curVal - posSize);

      const invINR = p.market === 'IN' ? inv : inv * usdInrRate;
      const valINR = p.market === 'IN' ? eqVal : eqVal * usdInrRate;

      totalInvested += invINR;
      totalValue += valINR;

      const prevPrice = curPrice / (1 + (change / 100));
      const dayPL = (curPrice - prevPrice) * p.qty;
      const dayPLINR = p.market === 'IN' ? dayPL : dayPL * usdInrRate;
      todayPL += dayPLINR;

      if (p.market === 'IN') indPL += dayPLINR;
      else usPL += dayPLINR;
    });

    const totalPL = totalValue - totalInvested;
    const plPct = totalInvested > 0 ? (totalPL / totalInvested) * 100 : 0;
    const todayPct = (totalValue - todayPL) > 0 ? (todayPL / (totalValue - todayPL)) * 100 : 0;

    return { totalInvested, totalValue, totalPL, plPct, todayPL, todayPct, indPL, usPL };
  }, [portfolio, livePrices, usdInrRate]);

  // Metrics calculation memoization
  const metrics = useMemo(() => calculateMetrics(), [calculateMetrics]);

  const latestDataRef = useRef({ portfolio, livePrices, usdInrRate, metrics });
  useEffect(() => {
    latestDataRef.current = { portfolio, livePrices, usdInrRate, metrics };
  }, [portfolio, livePrices, usdInrRate, metrics]);

  // Auto Telegram Notifications (market hours only, every 30 min)
  useEffect(() => {
    if (!isAuthenticated || !autoTelegram || portfolio.length === 0) return;

    const sendIfMarketOpen = async () => {
      const d = latestDataRef.current;
      if (!isAnyMarketOpen()) return;
      const msg = generateDeepAnalysis(d.portfolio, d.livePrices, d.usdInrRate, d.metrics);
      await sendTelegramAlert(TG_TOKEN, TG_CHAT_ID, msg);
    };

    // Send initial report after 2 min delay
    const initialTimeout = setTimeout(sendIfMarketOpen, 120000);
    // Then every 30 min
    telegramIntervalRef.current = window.setInterval(sendIfMarketOpen, 1800000);

    return () => {
      clearTimeout(initialTimeout);
      if (telegramIntervalRef.current) clearInterval(telegramIntervalRef.current);
    };
  }, [isAuthenticated, autoTelegram, portfolio.length]);

  // Update WebSocket latency periodically
  useEffect(() => {
    if (!isAuthenticated) return;
    const interval = setInterval(() => {
      setWsLatency(getWebSocketLatency());
    }, 15000);

    // Detect anomalies on price changes
    const anomalyManager = anomalyDetectorRef.current;
    const keys = Object.keys(livePrices).slice(-20); // Check recent 20
    for (const key of keys) {
      const data = livePrices[key];
      if (data?.price) {
        anomalyManager.update(key, data.price);
        const result = anomalyManager.isAnomalous(key);
        const symbol = key.replace('IN_', '').replace('US_', '');
        if (result.anomalous) {
          alertManagerRef.current.processPriceData(symbol, data);
        }

        // Detect smart money signals
        if (data?.volume) {
          const smartMoney = detectSmartMoney(symbol, data.volume, data.change);
          if (smartMoney) {
            alertManagerRef.current.processPriceData(symbol, {
              ...data,
              message: `Smart money ${smartMoney.type} detected (${(smartMoney.volume / 1000000).toFixed(1)}M volume)`
            });
          }
        }
      }
    }

    return () => clearInterval(interval);
  }, [isAuthenticated]);

  // VIX based sentiment
  const usVix = livePrices['US_VIX']?.price || 15;
  const inVix = livePrices['IN_INDIAVIX']?.price || 15;
  const avgVix = (usVix + inVix) / 2;

  const getSentiment = () => {
    if (avgVix > 22) return { text: '🔴 Global Risk Severe | Institutional Liquidation Active', color: 'text-red-400' };
    if (avgVix > 17) return { text: '🟠 Elevated Volatility | Smart Money Cautious', color: 'text-amber-400' };
    if (avgVix > 14) return { text: '🟡 Normal Range | Standard SIP Optimal', color: 'text-yellow-400' };
    return { text: '🟢 Ultra Low Risk | Whale Accumulation Zone', color: 'text-emerald-400' };
  };
  const sentiment = getSentiment();

  // Current symbol data
  const currentKey = `${currentMarket}_${currentSymbol}`;
  const currentData = livePrices[currentKey];
  const currentPrice = currentData?.price || 0;
  const currentChange = currentData?.change || 0;
  const currentRsi = currentData?.rsi || 50;

  // Generate signal
  const getSignal = () => {
    if (currentRsi < 35) return { signal: '🟢 MAX BUY', color: 'text-emerald-400', conf: 98 };
    if (currentRsi < 45) return { signal: '🟢 ACCUMULATE', color: 'text-emerald-400', conf: 85 };
    if (currentRsi < 60) return { signal: '🟡 MAINTAIN', color: 'text-amber-400', conf: 75 };
    if (currentRsi < 70) return { signal: '🟠 THROTTLE', color: 'text-orange-400', conf: 65 };
    return { signal: '🔴 DISTRIBUTE', color: 'text-red-400', conf: 90 };
  };
  const signalData = getSignal();

  // Planner calculations
  const totalSIP = indiaSIP + (usSIP * usdInrRate);
  const cagr = riskLevel === 'low' ? 8 : riskLevel === 'high' ? 18 : 12;
  const months = investYears * 12;
  const totalInvestedPlanner = totalSIP * months;
  const rate = cagr / 100 / 12;
  const fvMed = totalSIP > 0 ? totalSIP * (Math.pow(1 + rate, months) - 1) * (1 + rate) / rate : 0;
  const worstRate = Math.max(0.5, cagr - 8) / 100 / 12;
  const fvWorst = totalSIP > 0 ? totalSIP * (Math.pow(1 + worstRate, months) - 1) * (1 + worstRate) / worstRate : 0;
  const fvBest = totalSIP > 0 ? totalSIP * (Math.pow(1 + (cagr + 8) / 100 / 12, months) - 1) * (1 + (cagr + 8) / 100 / 12) / ((cagr + 8) / 100 / 12) : 0;
  const multiplier = totalInvestedPlanner > 0 ? fvMed / totalInvestedPlanner : 0;

  // FIRE calculations
  const fireNumber = monthlyExpenses * 12 * 25;
  const rawYears = totalSIP > 0 && rate > 0 && fireNumber > 0 ? Math.log((fireNumber * rate / totalSIP) + 1) / Math.log(1 + rate) / 12 : null;
  const yearsToFire = rawYears !== null && isFinite(rawYears) && rawYears > 0 ? Math.max(1, Math.ceil(rawYears)) : 99;
  const fireProgress = fireNumber > 0 ? Math.min(100, (metrics.totalValue / fireNumber) * 100) : 0;

  // Push Telegram Report
  const pushTelegramReport = async () => {
    const msg = `🧠 *Quantum AI Master Report*\n\n🌍 *Global State:* ${sentiment.text}\n\n💼 *Total Equity:* ₹${Math.round(metrics.totalValue).toLocaleString('en-IN')}\n📈 *P&L:* ${metrics.totalPL >= 0 ? '+' : ''}₹${Math.round(metrics.totalPL).toLocaleString('en-IN')} (${metrics.plPct.toFixed(2)}%)\n⚡ *Today:* ${metrics.todayPL >= 0 ? '+' : ''}₹${Math.round(metrics.todayPL).toLocaleString('en-IN')}`;
    await sendTelegramAlert(TG_TOKEN, TG_CHAT_ID, msg);
    setSyncStatus('✅ Sent');
    setTimeout(() => setSyncStatus(''), 3000);
  };

  // Auth Screen
  if (!isAuthenticated) {
    return (
      <div className="min-h-screen login-bg flex items-center justify-center p-4">
        <div className="login-card glass-modal rounded-3xl p-8 max-w-sm w-full animate-scale-in">
          <div className="text-center mb-8">
            <div className="relative inline-block">
              <div className="text-7xl mb-2 animate-float">💎</div>
              <div className="absolute -inset-4 bg-cyan-500/10 rounded-full blur-xl pointer-events-none" />
            </div>
            <h1 className="text-3xl font-black gradient-text-cyan font-display mt-4">
              Wealth AI
            </h1>
            <div className="flex items-center justify-center gap-2 mt-2">
              <span className="badge bg-cyan-500/10 text-cyan-400 border border-cyan-500/20">QUANTUM TERMINAL</span>
            </div>
            <p className="text-slate-500 text-sm mt-3">Secure PIN enter karein</p>
          </div>
          <div className="relative z-10">
            <input
              type="password"
              value={pinInput}
              onChange={e => setPinInput(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && verifyPin()}
              placeholder="••••"
              maxLength={4}
              className="w-full text-center px-4 py-5 glass-input rounded-2xl text-3xl tracking-[0.5em] text-cyan-400 font-bold mb-5 font-mono placeholder-slate-700 relative z-10"
            />
          </div>
          <button
            onClick={verifyPin}
            className="btn-primary w-full py-4 bg-gradient-to-r from-cyan-600 via-blue-600 to-indigo-600 animate-gradient rounded-2xl font-bold text-white text-lg relative z-10"
          >
            🔓 Unlock Terminal
          </button>
          <div className="text-center mt-5 relative z-10">
            <span className="text-[10px] text-slate-600 font-mono tracking-wider">ENCRYPTED • AES-256 • NEURAL LOCKED</span>
          </div>
        </div>
      </div>
    );
  }
  return (
    <div className={`min-h-screen bg-gradient-to-br from-slate-950 via-[#0a0f1e] to-slate-950 text-slate-200 ${theme}`}>
      {/* Header */}
      <header className="sticky top-0 z-40 glass-ultra border-b border-white/5">
        {/* Ticker */}
        <div className="ticker-wrapper py-1.5 border-b border-white/5 bg-black/30">
          <div className="ticker-content">
            {[0, 1].map(i => (
              <div key={i} className="flex items-center gap-8 px-4 whitespace-nowrap text-xs font-mono">
                <span className="text-cyan-500/80 font-semibold">⚡ QUANTUM NEURAL ENGINE</span>
                <span className="text-slate-500">│</span>
                <span className="text-slate-400">VIX US <strong className={usVix > 20 ? 'text-red-400' : 'text-emerald-400'}>{usVix.toFixed(1)}</strong></span>
                <span className="text-slate-500">│</span>
                <span className="text-slate-400">VIX IN <strong className={inVix > 20 ? 'text-red-400' : 'text-emerald-400'}>{inVix.toFixed(1)}</strong></span>
                <span className="text-slate-500">│</span>
                <span className={sentiment.color}>{sentiment.text}</span>
                <span className="text-slate-500">│</span>
                <span className="text-slate-400">USD/INR <strong className="text-cyan-400">₹{usdInrRate.toFixed(2)}</strong></span>
                <span className="text-slate-600 px-6">•••</span>
              </div>
            ))}
          </div>
        </div>

        <div className="container mx-auto px-4 py-2.5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-cyan-500/20 to-indigo-500/20 flex items-center justify-center border border-cyan-500/20">
                <span className="text-xl">💎</span>
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <h1 className="text-lg font-black gradient-text-cyan font-display uppercase tracking-wide">Wealth AI</h1>
                  <span className="badge bg-cyan-500/10 text-cyan-400/80 border border-cyan-500/15">PRO</span>
                </div>
                <div className="flex items-center gap-2 text-[11px]">
                  <span className={`w-1.5 h-1.5 rounded-full ${liveStatus.includes('ACTIVE') ? 'bg-cyan-400 animate-pulse-dot' : 'bg-amber-500 animate-pulse'}`} />
                  <span className={`font-medium ${liveStatus.includes('ACTIVE') ? 'text-cyan-500/80' : 'bg-amber-400/80'}`}>{liveStatus.includes('ACTIVE') ? 'LIVE' : 'SYNCING'}</span>
                  <span className="text-slate-700">•</span>
                  <Clock />
                </div>
              </div>
            </div>

            {/* Tabs */}
            <div className="flex gap-0.5 glass-card p-1 rounded-2xl">
              {(['dashboard', 'portfolio', 'planner', 'macro'] as TabType[]).map(tab => (
                <button
                  key={tab}
                  onClick={() => setActiveTab(tab)}
                  className={`tab-btn px-4 py-2 rounded-xl font-semibold text-sm transition-all ${activeTab === tab
                      ? 'tab-active bg-cyan-500/10 text-cyan-400 border border-cyan-500/20'
                      : 'text-slate-500 hover:text-slate-300 hover:bg-white/[0.03]'
                    }`}
                >
                  {tab === 'dashboard' && '📊 Dashboard'}
                  {tab === 'portfolio' && '💼 Portfolio'}
                  {tab === 'planner' && '🎯 Planner'}
                  {tab === 'macro' && '🌍 Risk'}
                </button>
              ))}
            </div>

            <div className="flex gap-2 relative">
              <div className="relative">
                <button
                  onClick={() => setShowSettings(!showSettings)}
                  className={`btn-glass p-2.5 rounded-xl text-lg transition-all ${showSettings ? 'bg-cyan-500/10 border border-cyan-500/30' : ''}`}
                  title="AI Settings"
                >
                  ⚙️
                </button>
                {showSettings && (
                  <div className="absolute right-0 top-full mt-3 w-72 glass-modal p-4 rounded-2xl shadow-2xl z-50 animate-scale-in">
                    <div className="text-xs font-bold text-cyan-400 uppercase tracking-wider mb-3 flex items-center gap-2">
                      <span className="text-lg">🧠</span> Groq API Key
                    </div>
                    <input
                      type="password"
                      placeholder="Paste your Groq API Key..."
                      value={groqKey}
                      onChange={(e) => {
                        const val = e.target.value;
                        setGroqKey(val);
                        localStorage.setItem('WEALTH_AI_GROQ', val);
                      }}
                      className="w-full glass-input rounded-xl px-4 py-3 text-sm text-white mb-3"
                    />
                    <button
                      onClick={() => {
                        setShowSettings(false);
                        if (groqKey) syncGroqKeyToCloud(groqKey);
                      }}
                      className="w-full btn-primary py-2.5 rounded-xl font-bold bg-gradient-to-r from-emerald-600 to-teal-600 text-white shadow-lg shadow-emerald-900/30 text-sm"
                    >
                      💾 Save & Cloud Sync
                    </button>
                    <div className="text-[10px] text-slate-500 mt-3 font-medium text-center">Key auto-syncs to cloud. Free at console.groq.com</div>
                  </div>
                )}
              </div>
              <button
                onClick={() => setAutoTelegram(prev => !prev)}
                className={`btn-glass p-2.5 rounded-xl text-lg transition-all ${autoTelegram ? 'bg-emerald-500/10 border border-emerald-500/30' : ''}`}
                title={autoTelegram ? 'Auto Alerts ON' : 'Auto Alerts OFF'}
              >
                {autoTelegram ? '🔔' : '🔕'}
              </button>
              <button onClick={() => {
                const newTheme = theme === 'dark' ? 'light' : 'dark';
                setTheme(newTheme);
                localStorage.setItem('theme', newTheme);
              }} className="w-10 h-10 rounded-xl flex items-center justify-center hover:bg-white/10 transition-colors text-lg" title={`Toggle ${theme === 'dark' ? 'Light' : 'Dark'} Mode`}>
                {theme === 'dark' ? '🌞' : '🌙'}
              </button>
              <button onClick={() => window.location.reload()} className="btn-glass p-2.5 rounded-xl text-lg" title="Refresh">🔄</button>
              <button onClick={logout} className="btn-glass p-2.5 rounded-xl text-lg" title="Logout">🔐</button>
            </div>
          </div>
        </div>
      </header>

      <main className="container mx-auto px-4 py-6">
        {/* Dashboard Tab */}
        {activeTab === 'dashboard' && currentSymbol && (
          <div className="space-y-5 animate-fade-in">
            {/* Macro Alert */}
            <div className={`alert-banner glass-card rounded-2xl p-4 border ${avgVix > 17 ? 'border-red-500/30 bg-red-950/20' : 'border-emerald-500/30 bg-emerald-950/20'} animate-fade-in-up`}>
              <div className="flex items-center gap-4">
                <div className={`w-12 h-12 rounded-xl flex items-center justify-center text-2xl ${avgVix > 17 ? 'bg-red-500/10' : 'bg-emerald-500/10'}`}>
                  {avgVix > 17 ? '🚨' : '🚀'}
                </div>
                <div className="flex-1">
                  <div className={`font-bold uppercase tracking-wider text-sm ${sentiment.color}`}>
                    {avgVix > 17 ? 'RISK ALERT: SELLOFF WARNING' : 'BULLISH: WHALE ACCUMULATION'}
                  </div>
                  <div className="text-sm text-slate-400/80 mt-0.5">
                    {avgVix > 17 ? 'Market me institutional liquidation chal raha hai. Cash hold karo.' : 'Dark pools heavily buy kar rahe hain. SIP continue karo.'}
                  </div>
                </div>
              </div>
            </div>

            {/* Search */}
            <div className="flex gap-3 glass-card p-3 rounded-2xl animate-fade-in-up delay-75">
              <div className="flex-1 relative">
                <input
                  type="text"
                  value={symbolInput}
                  onChange={e => setSymbolInput(e.target.value.toUpperCase())}
                  onKeyDown={e => e.key === 'Enter' && analyzeSymbol()}
                  placeholder="Search any asset... (AAPL, RELIANCE, SPY)"
                  className="w-full px-5 py-3.5 pl-12 glass-input rounded-xl uppercase font-semibold text-white placeholder-slate-600"
                />
                <span className="absolute left-4 top-3.5 text-lg text-slate-500">🔍</span>
              </div>
              <button
                onClick={analyzeSymbol}
                disabled={isAnalyzing}
                className="btn-primary px-7 py-3.5 bg-gradient-to-r from-cyan-600 to-indigo-600 rounded-xl font-bold text-white disabled:opacity-50"
              >
                {isAnalyzing ? '⏳ Scanning...' : 'SCAN ⚡'}
              </button>
            </div>

            {/* Stats */}
            <div className="grid grid-cols-2 md:grid-cols-5 gap-3 animate-fade-in-up delay-100">
              <div className="stat-card glass-card rounded-2xl p-4">
                <div className="text-slate-500 text-[10px] font-bold uppercase tracking-wider">Target Asset</div>
                <div className="text-xl font-black text-cyan-400 mt-1 font-display">{currentSymbol.replace('.NS', '') || '---'}</div>
                <div className="text-[10px] text-slate-600 mt-1 font-mono">{currentMarket === 'IN' ? 'NSE/BSE' : 'NASDAQ/NYSE'}</div>
              </div>
              <div className="stat-card glass-card rounded-2xl p-4">
                <div className="text-slate-500 text-[10px] font-bold uppercase tracking-wider">Live Price</div>
                <div className={`text-xl font-black font-mono mt-1 ${currentChange >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                  {currentPrice > 0 ? formatPrice(currentPrice, currentMarket === 'IN' ? '₹' : '$') : '--'}
                </div>
                <div className={`text-xs font-bold mt-1 flex items-center gap-1 ${currentChange >= 0 ? 'text-emerald-500' : 'text-red-500'}`}>
                  <span className="text-[10px]">{currentChange >= 0 ? '▲' : '▼'}</span> {currentChange.toFixed(2)}%
                </div>
              </div>
              <div className="stat-card glass-card rounded-2xl p-4">
                <div className="text-slate-500 text-[10px] font-bold uppercase tracking-wider">AI Signal</div>
                <div className={`text-lg font-black mt-1 ${signalData.color}`}>{signalData.signal}</div>
                <div className="mt-1">
                  <div className="w-full bg-slate-800/60 rounded-full h-1.5">
                    <div className="bg-gradient-to-r from-cyan-500 to-indigo-500 h-full rounded-full transition-all" style={{ width: `${signalData.conf}%` }} />
                  </div>
                  <div className="text-[10px] text-slate-500 mt-1 font-mono">{signalData.conf}% confidence</div>
                </div>
              </div>
              <div className="stat-card glass-card rounded-2xl p-4">
                <div className="text-slate-500 text-[10px] font-bold uppercase tracking-wider">RSI Index</div>
                <div className={`text-xl font-black font-mono mt-1 ${currentRsi < 35 ? 'text-emerald-400' : currentRsi > 65 ? 'text-red-400' : 'text-cyan-400'}`}>
                  {currentRsi.toFixed(1)}
                </div>
                <div className="text-[10px] text-slate-600 mt-1">{currentRsi < 35 ? '⬇ Oversold' : currentRsi > 65 ? '⬆ Overbought' : '↔ Neutral'}</div>
              </div>
              <div className="stat-card glass-card rounded-2xl p-4 col-span-2 md:col-span-1">
                <div className="text-slate-500 text-[10px] font-bold uppercase tracking-wider">Portfolio</div>
                <div className="text-xl font-black text-purple-400 font-mono mt-1">₹{Math.round(metrics.totalValue).toLocaleString('en-IN')}</div>
                <div className={`text-xs font-bold mt-1 ${metrics.totalPL >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                  {metrics.plPct >= 0 ? '+' : ''}{metrics.plPct.toFixed(1)}% total
                </div>
              </div>
            </div>

            {/* Value Zones */}
            <div className="glass-card rounded-2xl p-5 border-cyan-500/10 animate-fade-in-up delay-150">
              <h2 className="text-base font-bold text-white mb-4 flex items-center gap-2">
                <span className="w-7 h-7 rounded-lg bg-cyan-500/10 flex items-center justify-center text-sm">🎯</span>
                Value Zones
              </h2>
              <div className="grid grid-cols-3 gap-3 mb-4">
                <div className="bg-emerald-500/5 border border-emerald-500/20 rounded-xl p-4 text-center">
                  <div className="text-emerald-400/80 text-[10px] font-bold uppercase tracking-wider mb-2">Deep Value</div>
                  <div className="text-xl font-black text-emerald-400 font-mono">
                    {currentPrice > 0 ? formatPrice(currentPrice * 0.95, currentMarket === 'IN' ? '₹' : '$') : '--'}
                  </div>
                  <div className="text-[10px] text-emerald-500/60 mt-1">-5% from CMP</div>
                </div>
                <div className="bg-amber-500/5 border border-amber-500/20 rounded-xl p-4 text-center">
                  <div className="text-amber-400/80 text-[10px] font-bold uppercase tracking-wider mb-2">Fair Price</div>
                  <div className="text-xl font-black text-amber-400 font-mono">
                    {currentPrice > 0 ? formatPrice(currentPrice, currentMarket === 'IN' ? '₹' : '$') : '--'}
                  </div>
                  <div className="text-[10px] text-amber-500/60 mt-1">Current Market</div>
                </div>
                <div className="bg-red-500/5 border border-red-500/20 rounded-xl p-4 text-center">
                  <div className="text-red-400/80 text-[10px] font-bold uppercase tracking-wider mb-2">Overheated</div>
                  <div className="text-xl font-black text-red-400 font-mono">
                    {currentPrice > 0 ? formatPrice(currentPrice * 1.15, currentMarket === 'IN' ? '₹' : '$') : '--'}
                  </div>
                  <div className="text-[10px] text-red-500/60 mt-1">+15% from CMP</div>
                </div>
              </div>
              <div className={`p-4 rounded-xl border flex items-center justify-between gap-4 ${currentRsi < 45 ? 'bg-emerald-500/5 border-emerald-500/20' : currentRsi > 65 ? 'bg-red-500/5 border-red-500/20' : 'bg-cyan-500/5 border-cyan-500/20'}`}>
                <div>
                  <div className="text-[10px] text-slate-400 font-bold uppercase tracking-wider">AI Verdict</div>
                  <div className="text-sm font-bold text-white mt-1">
                    {currentRsi < 45 ? `📈 WHALE ACTION: Algorithms buying ${currentSymbol.replace('.NS', '')}` :
                      currentRsi > 65 ? `📉 DISTRIBUTION: Book partial profits` :
                        `📊 NEUTRAL: Trading at fair valuation`}
                  </div>
                </div>
                <button
                  onClick={() => openAddModal()}
                  className="btn-primary px-5 py-2.5 bg-gradient-to-r from-emerald-600 to-cyan-600 rounded-xl font-bold text-white text-sm whitespace-nowrap"
                >
                  📈 Invest
                </button>
              </div>
            </div>

            {/* Chart */}
            <div className="glass-card rounded-2xl p-5 border-cyan-500/10 animate-fade-in-up delay-200">
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-base font-bold text-white flex items-center gap-2">
                  <span className="w-7 h-7 rounded-lg bg-cyan-500/10 flex items-center justify-center text-sm">📊</span>
                  Live Chart — {currentSymbol.replace('.NS', '')}
                </h2>
                <div className="flex gap-0.5 bg-black/40 p-1 rounded-lg">
                  {['D', 'W', 'M'].map(int => (
                    <button
                      key={int}
                      onClick={() => setChartInterval(int)}
                      className={`px-3.5 py-1.5 rounded-md text-xs font-semibold transition-all ${chartInterval === int ? 'bg-cyan-500/20 text-cyan-400 border border-cyan-500/20' : 'text-slate-500 hover:text-slate-300'
                        }`}
                    >
                      1{int}
                    </button>
                  ))}
                </div>
              </div>
              <div
                ref={chartContainerRef}
                className="h-[500px] rounded-xl bg-black/30 border border-white/5 overflow-hidden"
              />
            </div>

            {/* Quantum Forensics Panel */}
            {currentPrice > 0 && (
              <div className="glass-card rounded-2xl p-5 border-cyan-500/10 animate-fade-in-up delay-200">
                <h2 className="text-base font-bold text-white mb-4 flex items-center gap-2">
                  <span className="w-7 h-7 rounded-lg bg-purple-500/10 flex items-center justify-center text-sm">🧬</span>
                  Quantum Forensics — {currentSymbol.replace('.NS', '')}
                  <span className="ml-auto badge bg-purple-500/10 text-purple-400 border border-purple-500/20 text-[10px]">DEEP SCAN</span>
                </h2>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
                  {/* RSI Gauge */}
                  <div className="bg-black/30 rounded-xl p-4 text-center border border-white/5">
                    <div className="text-[10px] text-slate-500 font-bold uppercase tracking-wider mb-2">RSI Gauge</div>
                    <div className="relative w-full h-3 bg-gradient-to-r from-emerald-600 via-amber-500 to-red-600 rounded-full overflow-hidden mb-2">
                      <div className="absolute top-0 w-1 h-full bg-white shadow-lg shadow-white/50" style={{ left: `${Math.min(100, currentRsi)}%` }} />
                    </div>
                    <div className={`text-2xl font-black font-mono ${currentRsi < 35 ? 'text-emerald-400' : currentRsi > 65 ? 'text-red-400' : 'text-amber-400'}`}>
                      {currentRsi.toFixed(1)}
                    </div>
                    <div className="text-[10px] text-slate-600 mt-1">{currentRsi < 30 ? 'OVERSOLD 🟢' : currentRsi > 70 ? 'OVERBOUGHT 🔴' : 'NEUTRAL ↔'}</div>
                  </div>

                  {/* MACD / SMA Trend */}
                  <div className="bg-black/30 rounded-xl p-4 text-center border border-white/5">
                    <div className="text-[10px] text-slate-500 font-bold uppercase tracking-wider mb-2">MACD Trend</div>
                    <div className={`text-2xl font-black ${currentData?.macd !== undefined ? (currentData.macd > 0 ? 'text-emerald-400' : 'text-red-400') : (currentChange > 0.5 ? 'text-emerald-400' : currentChange < -0.5 ? 'text-red-400' : 'text-slate-400')}`}>
                      {currentData?.macd !== undefined ? (currentData.macd > 0 ? '📈 BULL' : '📉 BEAR') : (currentChange > 0.5 ? '📈 BULL' : currentChange < -0.5 ? '📉 BEAR' : '➡️ FLAT')}
                    </div>
                    <div className="text-[10px] text-slate-600 mt-1">
                      {currentData?.macd !== undefined ? `MACD: ${currentData.macd.toFixed(2)}` : `Momentum: ${Math.abs(currentChange) > 2 ? 'STRONG' : Math.abs(currentChange) > 0.5 ? 'MODERATE' : 'WEAK'}`}
                    </div>
                  </div>

                  {/* Volume Analysis */}
                  <div className="bg-black/30 rounded-xl p-4 text-center border border-white/5">
                    <div className="text-[10px] text-slate-500 font-bold uppercase tracking-wider mb-2">Volume Flow</div>
                    <div className="text-2xl font-black text-cyan-400 font-mono">
                      {currentData?.volume ? (currentData.volume > 1000000 ? `${(currentData.volume / 1000000).toFixed(1)}M` : `${(currentData.volume / 1000).toFixed(0)}K`) : 'N/A'}
                    </div>
                    <div className="text-[10px] text-slate-600 mt-1">
                      {currentData?.volume && currentData.volume > 500000 ? '🔥 HIGH ACTIVITY' : '💤 LOW FLOW'}
                    </div>
                  </div>

                  {/* Day Range */}
                  <div className="bg-black/30 rounded-xl p-4 text-center border border-white/5">
                    <div className="text-[10px] text-slate-500 font-bold uppercase tracking-wider mb-2">Day Range</div>
                    <div className="flex items-center gap-2 justify-center mb-1">
                      <span className="text-xs font-mono text-emerald-400">{formatPrice(currentData?.low || currentPrice * 0.98, currentMarket === 'IN' ? '₹' : '$')}</span>
                      <span className="text-slate-600">→</span>
                      <span className="text-xs font-mono text-red-400">{formatPrice(currentData?.high || currentPrice * 1.02, currentMarket === 'IN' ? '₹' : '$')}</span>
                    </div>
                    <div className="w-full h-1.5 bg-slate-800 rounded-full overflow-hidden">
                      <div className="bg-gradient-to-r from-emerald-500 to-cyan-500 h-full rounded-full" style={{ width: `${currentData?.high && currentData?.low ? ((currentPrice - currentData.low) / (currentData.high - currentData.low)) * 100 : 50}%` }} />
                    </div>
                    <div className="text-[10px] text-slate-600 mt-1">Position in range</div>
                  </div>
                </div>

                {/* Market Status Bar */}
                <div className="flex flex-wrap gap-2">
                  <span className={`px-3 py-1.5 rounded-lg text-[10px] font-bold ${isAnyMarketOpen() ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20' : 'bg-slate-500/10 text-slate-400 border border-slate-500/20'}`}>
                    {getMarketStatus()}
                  </span>
                  <span className="px-3 py-1.5 rounded-lg text-[10px] font-bold bg-cyan-500/10 text-cyan-400 border border-cyan-500/20">
                    💱 USD/INR ₹{usdInrRate.toFixed(2)}
                  </span>
                  <span className={`px-3 py-1.5 rounded-lg text-[10px] font-bold ${currentChange >= 0 ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20' : 'bg-red-500/10 text-red-400 border border-red-500/20'}`}>
                    {currentChange >= 0 ? '📈' : '📉'} {currentChange >= 0 ? '+' : ''}{currentChange.toFixed(2)}% Today
                  </span>
                </div>
              </div>
            )}

            {/* Quick Assets */}
            <div className="glass-card rounded-2xl p-5 border-cyan-500/10 animate-fade-in-up delay-300">
              <h2 className="text-base font-bold text-white mb-4 flex items-center gap-2">
                <span className="w-7 h-7 rounded-lg bg-cyan-500/10 flex items-center justify-center text-sm">📂</span>
                Core Holdings
              </h2>
              <div className="flex flex-wrap gap-2.5">
                {portfolio.length === 0 ? (
                  <div className="w-full text-center text-slate-600 py-8 border border-dashed border-white/10 rounded-xl animate-fade-in">
                    <div className="text-3xl mb-2 animate-float">📂</div>
                    <p className="font-medium">No holdings yet</p>
                    <p className="text-xs text-slate-700 mt-1">Add assets to start tracking</p>
                  </div>
                ) : (
                  [...new Set(portfolio.map(p => p.symbol))].map((sym, i) => {
                    const p = portfolio.find(x => x.symbol === sym)!;
                    const key = `${p.market}_${sym}`;
                    const data = livePrices[key];
                    const change = data?.change || 0;
                    return (
                      <button
                        key={sym}
                        onClick={() => quickSelect(sym)}
                        className="stat-card glass-card px-4 py-3 rounded-xl text-left animate-fade-in-up"
                        style={{ animationDelay: `${i * 50}ms` }}
                      >
                        <div className="font-bold text-white text-sm">{sym.replace('.NS', '')}</div>
                        <div className="flex items-center gap-2 mt-1.5">
                          <span className="font-mono text-xs text-slate-300">
                            {formatPrice(data?.price || p.avgPrice, p.market === 'IN' ? '₹' : '$')}
                          </span>
                          <span className={`font-bold text-xs ${change >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                            {change >= 0 ? '+' : ''}{change.toFixed(2)}%
                          </span>
                        </div>
                      </button>
                    );
                  })
                )}
              </div>
            </div>
          </div>
        )}

        {activeTab === 'portfolio' && (
          <div className="space-y-5 animate-fade-in">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h2 className="text-2xl font-black gradient-text-cyan font-display">
                💼 Portfolio
              </h2>
              <div className="flex gap-2">
                <button
                  onClick={() => loadFromCloud().then(data => { if (data) setPortfolio(data); })}
                  className="btn-glass px-4 py-2 rounded-xl font-semibold text-sm"
                >
                  📥 Sync
                </button>
                <button
                  onClick={() => openAddModal()}
                  className="btn-primary px-5 py-2 bg-gradient-to-r from-cyan-600 to-indigo-600 rounded-xl font-bold text-sm text-white"
                >
                  + Add Asset
                </button>
                <button
                  onClick={pushTelegramReport}
                  className="btn-glass px-4 py-2 rounded-xl font-semibold text-sm text-indigo-300 border-indigo-500/20"
                >
                  📲 TG {syncStatus}
                </button>
              </div>
            </div>

            {/* USD/INR */}
            <div className="glass-card rounded-xl p-3 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 rounded-lg bg-emerald-500/10 flex items-center justify-center text-base">💱</div>
                <span className="text-sm font-medium text-slate-400">USD/INR</span>
                <span className="text-base font-black text-emerald-400 font-mono">₹{usdInrRate.toFixed(2)}</span>
              </div>
              <span className="text-[10px] text-cyan-500/60 font-bold uppercase tracking-wider">Live Forex</span>
            </div>

            {/* Summary Cards */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <div className="stat-card glass-card rounded-2xl p-4 animate-fade-in-up">
                <div className="text-slate-500 text-[10px] font-bold uppercase tracking-wider">Capital Deployed</div>
                <div className="text-xl font-black text-white font-mono mt-1">₹{Math.round(metrics.totalInvested).toLocaleString('en-IN')}</div>
                <div className="text-[10px] text-slate-600 mt-1 font-mono">${Math.round(metrics.totalInvested / usdInrRate).toLocaleString('en-US')}</div>
              </div>
              <div className="stat-card glass-card rounded-2xl p-4 border-cyan-500/15 animate-fade-in-up delay-75">
                <div className="text-cyan-500/80 text-[10px] font-bold uppercase tracking-wider">Current Equity</div>
                <div className="text-xl font-black text-cyan-400 font-mono mt-1">₹{Math.round(metrics.totalValue).toLocaleString('en-IN')}</div>
                <div className="text-[10px] text-slate-600 mt-1 font-mono">${Math.round(metrics.totalValue / usdInrRate).toLocaleString('en-US')}</div>
              </div>
              <div className="stat-card glass-card rounded-2xl p-4 animate-fade-in-up delay-150">
                <div className="text-slate-500 text-[10px] font-bold uppercase tracking-wider">Total P&L</div>
                <div className={`text-xl font-black font-mono mt-1 ${metrics.totalPL >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                  {metrics.totalPL >= 0 ? '+' : ''}₹{Math.round(metrics.totalPL).toLocaleString('en-IN')}
                </div>
                <div className={`text-xs font-bold mt-1 ${metrics.totalPL >= 0 ? 'text-emerald-500' : 'text-red-500'}`}>
                  {metrics.plPct >= 0 ? '+' : ''}{metrics.plPct.toFixed(2)}%
                </div>
              </div>
              <div className="stat-card glass-card rounded-2xl p-4 animate-fade-in-up delay-200">
                <div className="text-slate-500 text-[10px] font-bold uppercase tracking-wider">Today's P&L</div>
                <div className={`text-xl font-black font-mono mt-1 ${metrics.todayPL >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                  {metrics.todayPL >= 0 ? '+' : ''}₹{Math.round(metrics.todayPL).toLocaleString('en-IN')}
                </div>
                <div className="flex gap-3 mt-1.5">
                  <span className={`text-[10px] font-bold ${metrics.indPL >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                    🇮🇳 {metrics.indPL >= 0 ? '+' : ''}₹{Math.round(metrics.indPL).toLocaleString('en-IN')}
                  </span>
                  <span className={`text-[10px] font-bold ${metrics.usPL >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                    🦅 {metrics.usPL >= 0 ? '+' : ''}₹{Math.round(metrics.usPL).toLocaleString('en-IN')}
                  </span>
                </div>
              </div>
            </div>


            {/* Advance Pro Trader Portfolio Grid */}
            <div className="glass-card rounded-2xl overflow-hidden animate-fade-in-up delay-200 p-1">
              <div className="hidden md:grid grid-cols-[1.5fr_1fr_1fr_1fr_1fr_auto] gap-4 px-6 py-3 bg-black/40 border-b border-white/5 text-[10px] uppercase tracking-wider text-slate-500 font-bold">
                <div>Asset & Allocation</div>
                <div>LTP & 24H Range</div>
                <div className="text-right">Today's P&L</div>
                <div className="text-right">Value (Eq)</div>
                <div className="text-right">Unrealized P&L</div>
                <div className="text-center w-20">Trade</div>
              </div>

              <div className="divide-y divide-white/[0.03]">
                {portfolio.map(p => {
                  const key = `${p.market}_${p.symbol}`;
                  const data = livePrices[key];
                  const curPrice = data?.price || p.avgPrice;
                  const change = data?.change || 0;
                  const cur = p.market === 'IN' ? '₹' : '$';
                  const posSize = p.avgPrice * p.qty;
                  const inv = posSize / (p.leverage || 1);
                  const curVal = curPrice * p.qty;
                  const pl = curVal - posSize;
                  const plPct = inv > 0 ? (pl / inv) * 100 : 0;
                  const eqVal = inv + pl;
                  const prevPrice = curPrice / (1 + (change / 100));
                  const todayPL = (curPrice - prevPrice) * p.qty;

                  // Pro UI Calculations
                  const low = data?.low || curPrice * 0.98;
                  const high = data?.high || curPrice * 1.02;
                  const rangePct = Math.max(0, Math.min(100, ((curPrice - low) / (high - low)) * 100)) || 50;
                  const allocPct = metrics.totalValue > 0 ? (eqVal * (p.market === 'US' ? usdInrRate : 1) / metrics.totalValue) * 100 : 0;

                  return (
                    <div key={p.id} className="grid grid-cols-1 md:grid-cols-[1.5fr_1fr_1fr_1fr_1fr_auto] md:items-center gap-4 p-4 hover:bg-white/[0.02] transition-colors group relative">

                      {/* 1. ASSET & ALLOCATION */}
                      <div>
                        <div className="flex items-center justify-between md:justify-start gap-3">
                          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-slate-800 to-slate-900 border border-white/10 shadow-inner flex items-center justify-center font-black text-xs text-white">
                            {p.symbol.substring(0, 2).toUpperCase()}
                          </div>
                          <div className="flex-1">
                            <div className="font-black text-white text-base tracking-tight flex items-center gap-2">
                              {p.symbol.replace('.NS', '')}
                              {p.leverage > 1 && <span className="bg-indigo-500/20 text-indigo-400 text-[9px] px-1.5 py-0.5 rounded border border-indigo-500/20">{p.leverage}x</span>}
                            </div>
                            <div className="flex items-center gap-2 mt-0.5">
                              <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded ${p.market === 'IN' ? 'bg-orange-500/10 text-orange-400' : 'bg-blue-500/10 text-blue-400'}`}>
                                {p.market === 'IN' ? 'NSE' : 'US'}
                              </span>
                              <span className="text-[10px] text-slate-500 font-mono">Qty: {p.qty} @ {cur}{p.avgPrice.toFixed(2)}</span>
                            </div>
                          </div>
                        </div>
                        {/* Dominance Bar */}
                        <div className="mt-3 flex items-center gap-2">
                          <div className="flex-1 h-1 bg-slate-800/80 rounded-full overflow-hidden">
                            <div className="h-full bg-cyan-500 transition-all rounded-full" style={{ width: `${allocPct}%` }} />
                          </div>
                          <div className="text-[9px] text-slate-500 font-mono w-7 text-right">{allocPct.toFixed(1)}%</div>
                        </div>
                      </div>

                      {/* 2. LTP & 24H RANGE */}
                      <div className="flex justify-between md:block py-2 border-t border-b md:border-0 border-white/5 md:py-0">
                        <div className="md:hidden text-[10px] text-slate-500 uppercase font-bold mb-1">LTP Range</div>
                        <div className={`font-black font-mono text-lg md:text-base tracking-tight flex items-center gap-2 ${change >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                          {cur}{curPrice.toFixed(2)}
                          <div className={`flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[10px] ${change >= 0 ? 'bg-emerald-500/10' : 'bg-red-500/10'}`}>
                            {change >= 0 ? '▲' : '▼'} {Math.abs(change).toFixed(2)}%
                          </div>
                        </div>
                        {/* 24H Scrubber */}
                        <div className="mt-2 text-[9px] text-slate-500 flex items-center justify-between xl:w-4/5 font-mono">
                          <span>L</span>
                          <div className="flex-1 mx-2 h-1 bg-slate-800 rounded-full relative">
                            <div className="absolute top-1/2 -translate-y-1/2 w-1.5 h-2.5 bg-white rounded-sm shadow-[0_0_5px_rgba(255,255,255,0.5)] transition-all z-10" style={{ left: `${rangePct}%` }} />
                            <div className="absolute top-0 bottom-0 left-0 bg-gradient-to-r from-red-500/30 to-emerald-500/30 rounded-full" style={{ width: `100%` }} />
                          </div>
                          <span>H</span>
                        </div>
                      </div>

                      {/* 3. TODAY'S P&L */}
                      <div className="flex justify-between md:block md:text-right">
                        <div className="md:hidden text-[10px] text-slate-500 uppercase font-bold">Today</div>
                        <div className={`font-bold font-mono text-base ${todayPL >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                          {todayPL >= 0 ? '+' : ''}{cur}{todayPL.toFixed(2)}
                        </div>
                        {data?.rsi && (
                          <div className="text-[9px] mt-1 hidden md:block">
                            <span className="text-slate-500">RSI: </span>
                            <span className={`font-bold font-mono ${data.rsi < 35 ? 'text-cyan-400' : data.rsi > 70 ? 'text-red-400' : 'text-slate-300'}`}>
                              {data.rsi.toFixed(0)}
                            </span>
                          </div>
                        )}
                      </div>

                      {/* 4. VALUE */}
                      <div className="flex justify-between md:block md:text-right">
                        <div className="md:hidden text-[10px] text-slate-500 uppercase font-bold">Value</div>
                        <div className="font-bold font-mono text-base text-white tracking-tight">
                          {cur}{eqVal.toFixed(2)}
                        </div>
                        <div className="text-[9px] text-slate-500 mt-1 font-mono hidden md:block">
                          Eq Value
                        </div>
                      </div>

                      {/* 5. UNREALIZED P&L */}
                      <div className="flex justify-between md:block md:text-right">
                        <div className="md:hidden text-[10px] text-slate-500 uppercase font-bold">Total P&L</div>
                        <div>
                          <div className={`font-black font-mono text-base tracking-tight ${pl >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                            {pl >= 0 ? '+' : ''}{cur}{pl.toFixed(2)}
                          </div>
                          <div className={`text-[10px] font-bold mt-0.5 ${plPct >= 0 ? 'text-emerald-500' : 'text-red-500'}`}>
                            ({plPct >= 0 ? '+' : ''}{plPct.toFixed(2)}%)
                          </div>
                        </div>
                      </div>

                      {/* 6. ACTIONS */}
                      <div className="pt-2 md:pt-0 mt-3 border-t border-white/5 md:border-0 md:mt-0 flex justify-end gap-2 md:justify-center">
                        <button
                          onClick={() => {
                            setAddSymbol(p.symbol);
                            setCurrentMarket(p.market);
                            setAddQty('');
                            setAddPrice(data?.price?.toString() || p.avgPrice.toString());
                            setAddDate(getTodayString());
                            setAddLeverage(p.leverage.toString());
                            setEditId(null);
                            setTransactionType('buy');
                            setShowAddModal(true);
                            setModalPrice(data ? { price: data.price, change: data.change, market: data.market } : null);
                          }}
                          className="px-3 py-1.5 md:w-8 md:h-8 md:p-0 flex items-center justify-center bg-cyan-500/10 hover:bg-cyan-500 w-full md:hover:rotate-12 hover:shadow-[0_0_15px_rgba(6,182,212,0.4)] border border-cyan-500/30 rounded-lg transition-all text-xs text-cyan-400 hover:text-white font-bold uppercase tracking-wider"
                          title="Buy / Accumulate"
                        >
                          <span className="md:hidden mr-1">Buy</span> B
                        </button>
                        <button
                          onClick={() => {
                            setAddSymbol(p.symbol);
                            setCurrentMarket(p.market);
                            setAddQty(p.qty.toString());
                            setAddPrice(data?.price?.toString() || p.avgPrice.toString());
                            setAddDate(p.dateAdded);
                            setAddLeverage(p.leverage.toString());
                            setEditId(p.id);
                            setTransactionType('sell');
                            setShowAddModal(true);
                            setModalPrice(data ? { price: data.price, change: data.change, market: data.market } : null);
                          }}
                          className="px-3 py-1.5 md:w-8 md:h-8 md:p-0 flex items-center justify-center bg-red-500/10 hover:bg-red-500 w-full md:hover:-rotate-12 hover:shadow-[0_0_15px_rgba(239,68,68,0.4)] border border-red-500/30 rounded-lg transition-all text-xs text-red-400 hover:text-white font-bold uppercase tracking-wider"
                          title="Sell / Distribute"
                        >
                          <span className="md:hidden mr-1">Sell</span> S
                        </button>
                      </div>

                    </div>
                  );
                })}
              </div>

              {portfolio.length === 0 && (
                <div className="p-12 text-center text-slate-500">
                  <div className="text-6xl mb-4">🛰️</div>
                  <p className="text-lg font-bold text-cyan-300/50 uppercase tracking-widest">Sensors Offline</p>
                  <p className="text-sm mt-2">No assets detected in the neural grid.</p>
                </div>
              )}
            </div>
          </div>
        )}

        {activeTab === 'planner' && (
          <div className="space-y-5 animate-fade-in">
            <h2 className="text-2xl font-black gradient-text-cyan font-display">
              🎯 Wealth Planner
            </h2>

            {/* SIP Config */}
            <div className="glass-card rounded-2xl p-5 animate-fade-in-up">
              <div className="text-[10px] text-cyan-500/70 font-bold uppercase tracking-wider mb-4">Monthly SIP Configuration</div>
              <div className="grid md:grid-cols-3 gap-3 mb-5">
                <div className="bg-blue-500/5 border border-blue-500/15 p-4 rounded-xl">
                  <div className="text-xs font-bold text-blue-400 mb-2">🇮🇳 India SIP</div>
                  <div className="flex items-center gap-2 glass-input p-2 rounded-lg">
                    <span className="text-lg text-blue-500/50">₹</span>
                    <input type="number" value={indiaSIP} onChange={e => setIndiaSIP(parseFloat(e.target.value) || 0)} className="w-full bg-transparent outline-none text-lg font-bold text-white" />
                  </div>
                </div>
                <div className="bg-emerald-500/5 border border-emerald-500/15 p-4 rounded-xl">
                  <div className="text-xs font-bold text-emerald-400 mb-2">🌍 US/Global SIP</div>
                  <div className="flex items-center gap-2 glass-input p-2 rounded-lg">
                    <span className="text-lg text-emerald-500/50">$</span>
                    <input type="number" value={usSIP} onChange={e => setUsSIP(parseFloat(e.target.value) || 0)} className="w-full bg-transparent outline-none text-lg font-bold text-white" />
                  </div>
                </div>
                <div className="bg-purple-500/5 border border-purple-500/15 p-4 rounded-xl">
                  <div className="text-xs font-bold text-purple-400 mb-2">💵 Emergency Fund</div>
                  <div className="flex items-center gap-2 glass-input p-2 rounded-lg">
                    <span className="text-lg text-purple-500/50">₹</span>
                    <input type="number" value={emergencyFund} onChange={e => setEmergencyFund(parseFloat(e.target.value) || 0)} className="w-full bg-transparent outline-none text-lg font-bold text-white" />
                  </div>
                </div>
              </div>
              <div className="grid md:grid-cols-2 gap-5">
                <div>
                  <label className="text-slate-500 text-[10px] font-bold uppercase tracking-wider block mb-2">Investment Horizon</label>
                  <select value={investYears} onChange={e => setInvestYears(parseInt(e.target.value))} className="w-full px-4 py-3 glass-input rounded-xl text-white">
                    {[3, 5, 10, 15, 20, 25, 30].map(y => (<option key={y} value={y}>{y} Years</option>))}
                  </select>
                </div>
                <div>
                  <label className="text-slate-500 text-[10px] font-bold uppercase tracking-wider block mb-2">Risk Appetite</label>
                  <div className="flex gap-1.5">
                    {(['low', 'medium', 'high'] as RiskLevel[]).map(r => (
                      <button key={r} onClick={() => setRiskLevel(r)} className={`flex-1 py-2.5 rounded-xl font-semibold text-xs transition-all ${riskLevel === r ? 'bg-cyan-500/15 text-cyan-400 border border-cyan-500/20' : 'glass-input text-slate-500'}`}>
                        {r === 'low' && '🛡️ Safe'}{r === 'medium' && '⚖️ Balanced'}{r === 'high' && '🚀 Aggressive'}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            </div>

            {/* Monte Carlo */}
            <div className="glass-card rounded-2xl p-5 animate-fade-in-up delay-100">
              <h3 className="text-base font-bold text-white mb-4 flex items-center gap-2">
                <span className="w-7 h-7 rounded-lg bg-cyan-500/10 flex items-center justify-center text-sm">🔮</span>
                Monte Carlo Simulator
              </h3>
              <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
                <div className="stat-card glass-card p-3 rounded-xl text-center">
                  <div className="text-[10px] text-slate-500 font-bold uppercase tracking-wider mb-1">Monthly SIP</div>
                  <div className="text-lg font-black text-white font-mono">₹{Math.round(totalSIP).toLocaleString('en-IN')}</div>
                </div>
                <div className="stat-card glass-card p-3 rounded-xl text-center">
                  <div className="text-[10px] text-slate-500 font-bold uppercase tracking-wider mb-1">Total Invested</div>
                  <div className="text-lg font-black text-slate-300 font-mono">₹{Math.round(totalInvestedPlanner).toLocaleString('en-IN')}</div>
                </div>
                <div className="bg-red-500/5 border border-red-500/15 p-3 rounded-xl text-center">
                  <div className="text-[10px] text-red-400/80 font-bold uppercase tracking-wider mb-1">Worst Case</div>
                  <div className="text-base font-black text-red-400 font-mono">₹{Math.round(fvWorst).toLocaleString('en-IN')}</div>
                </div>
                <div className="bg-cyan-500/5 border-2 border-cyan-500/20 p-4 rounded-xl text-center">
                  <div className="text-[10px] text-cyan-400/80 font-bold uppercase tracking-wider mb-1">🎯 Expected</div>
                  <div className="text-xl font-black text-cyan-400 font-mono">₹{Math.round(fvMed).toLocaleString('en-IN')}</div>
                </div>
                <div className="bg-emerald-500/5 border border-emerald-500/15 p-3 rounded-xl text-center">
                  <div className="text-[10px] text-emerald-400/80 font-bold uppercase tracking-wider mb-1">Best Case</div>
                  <div className="text-base font-black text-emerald-400 font-mono">₹{Math.round(fvBest).toLocaleString('en-IN')}</div>
                </div>
              </div>
              <div className="mt-4 p-4 bg-amber-500/5 rounded-xl border border-amber-500/15 flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <span className="text-2xl">💎</span>
                  <div>
                    <div className="text-[10px] text-amber-400 font-bold uppercase tracking-wider">Wealth Multiplier</div>
                    <div className="text-[10px] text-amber-200/40">Growth factor over investment period</div>
                  </div>
                </div>
                <div className="text-3xl font-black text-amber-400 font-mono">{multiplier.toFixed(1)}x</div>
              </div>
            </div>

            {/* FIRE */}
            <div className="glass-card rounded-2xl p-5 border-orange-500/10 animate-fade-in-up delay-200">
              <h3 className="text-base font-bold text-white mb-4 flex items-center gap-2">
                <span className="w-7 h-7 rounded-lg bg-orange-500/10 flex items-center justify-center text-sm">🔥</span>
                FIRE Calculator
              </h3>
              <div className="grid md:grid-cols-2 gap-3 mb-4">
                <div className="bg-black/20 p-4 rounded-xl">
                  <label className="text-slate-500 text-[10px] font-bold uppercase tracking-wider block mb-2">Monthly Expenses</label>
                  <div className="flex items-center gap-2 glass-input p-2 rounded-lg">
                    <span className="text-lg text-slate-600">₹</span>
                    <input type="number" value={monthlyExpenses} onChange={e => setMonthlyExpenses(parseFloat(e.target.value) || 0)} className="w-full bg-transparent outline-none text-lg font-bold text-white" />
                  </div>
                </div>
                <div className="bg-black/20 p-4 rounded-xl">
                  <label className="text-slate-500 text-[10px] font-bold uppercase tracking-wider block mb-2">Current Age</label>
                  <div className="flex items-center gap-2 glass-input p-2 rounded-lg">
                    <span className="text-lg">🎂</span>
                    <input type="number" value={currentAge} onChange={e => setCurrentAge(parseInt(e.target.value) || 0)} className="w-full bg-transparent outline-none text-lg font-bold text-white" />
                  </div>
                </div>
              </div>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                <div className="stat-card bg-orange-500/5 border border-orange-500/15 p-3 rounded-xl text-center">
                  <div className="text-[10px] text-orange-400/80 font-bold uppercase tracking-wider mb-1">FIRE Number</div>
                  <div className="text-lg font-black text-orange-400 font-mono">₹{Math.round(fireNumber).toLocaleString('en-IN')}</div>
                </div>
                <div className="stat-card bg-emerald-500/5 border border-emerald-500/15 p-3 rounded-xl text-center">
                  <div className="text-[10px] text-emerald-400/80 font-bold uppercase tracking-wider mb-1">Years to FIRE</div>
                  <div className="text-lg font-black text-emerald-400">{yearsToFire} yrs</div>
                </div>
                <div className="stat-card bg-cyan-500/5 border border-cyan-500/15 p-3 rounded-xl text-center">
                  <div className="text-[10px] text-cyan-400/80 font-bold uppercase tracking-wider mb-1">Retire At</div>
                  <div className="text-lg font-black text-cyan-400">{currentAge + yearsToFire} yrs</div>
                </div>
                <div className="stat-card bg-purple-500/5 border border-purple-500/15 p-3 rounded-xl text-center">
                  <div className="text-[10px] text-purple-400/80 font-bold uppercase tracking-wider mb-1">Passive Income</div>
                  <div className="text-lg font-black text-purple-400 font-mono">₹{Math.round(fireNumber * 0.04 / 12).toLocaleString('en-IN')}/mo</div>
                </div>
              </div>
              <div className="mt-4">
                <div className="flex justify-between items-center mb-2">
                  <span className="text-[10px] text-orange-400/80 font-bold uppercase tracking-wider">Progress to FIRE</span>
                  <span className="text-sm font-black text-orange-400">{fireProgress.toFixed(1)}%</span>
                </div>
                <div className="w-full bg-black/40 rounded-full h-2.5 overflow-hidden border border-orange-500/10">
                  <div className="bg-gradient-to-r from-orange-600 via-amber-400 to-emerald-400 h-full rounded-full transition-all duration-500" style={{ width: `${Math.min(100, fireProgress)}%` }} />
                </div>
              </div>
            </div>

            {/* Smart AI Allocations */}
            {portfolio.length > 0 && (
              <div className="glass-card rounded-2xl p-5 border-purple-500/10 animate-fade-in-up delay-300">
                <h3 className="text-base font-bold text-white mb-4 flex items-center gap-2">
                  <span className="w-7 h-7 rounded-lg bg-purple-500/10 flex items-center justify-center text-sm">🤖</span>
                  Smart AI Allocation Engine
                  <span className="ml-auto badge bg-purple-500/10 text-purple-400 border border-purple-500/20 text-[10px]">PRO ENGINE</span>
                </h3>

                {/* Per-Asset Analysis Cards */}
                <div className="grid md:grid-cols-2 gap-3 mb-4">
                  {portfolio.slice(0, 8).map(p => {
                    const key = `${p.market}_${p.symbol}`;
                    const signal = analyzeAsset(p, livePrices[key]);
                    const signalColors: Record<string, { bg: string; text: string; border: string }> = {
                      'BUY': { bg: 'bg-emerald-500/10', text: 'text-emerald-400', border: 'border-emerald-500/20' },
                      'SELL': { bg: 'bg-red-500/10', text: 'text-red-400', border: 'border-red-500/20' },
                      'HOLD': { bg: 'bg-amber-500/10', text: 'text-amber-400', border: 'border-amber-500/20' },
                    };
                    const sc = signalColors[signal.action] || signalColors['HOLD'];
                    const cur = p.market === 'IN' ? '₹' : '$';

                    return (
                      <div key={p.id} className={`bg-black/20 rounded-xl p-4 border ${sc.border}`}>
                        <div className="flex justify-between items-start mb-3">
                          <div>
                            <div className="font-bold text-white text-sm">{p.symbol.replace('.NS', '')}</div>
                            <div className="text-[10px] text-slate-500">{p.market === 'IN' ? '🇮🇳 India' : '🦅 USA'}</div>
                          </div>
                          <span className={`${sc.bg} ${sc.text} px-2.5 py-1 rounded-lg text-[10px] font-black border ${sc.border}`}>
                            {signal.action === 'BUY' ? '🟢' : signal.action === 'SELL' ? '🔴' : '🟡'} {signal.action}
                          </span>
                        </div>
                        {/* Metrics Grid */}
                        <div className="grid grid-cols-4 gap-1.5 text-center mb-3">
                          <div className="bg-black/30 rounded-lg p-1.5">
                            <div className="text-[8px] text-slate-600 uppercase">RSI</div>
                            <div className={`text-xs font-bold font-mono ${signal.rsi < 35 ? 'text-emerald-400' : signal.rsi > 65 ? 'text-red-400' : 'text-amber-400'}`}>{signal.rsi.toFixed(0)}</div>
                          </div>
                          <div className="bg-black/30 rounded-lg p-1.5">
                            <div className="text-[8px] text-slate-600 uppercase">Trend</div>
                            <div className="text-xs font-bold">{signal.trend === 'up' ? '📈' : signal.trend === 'down' ? '📉' : '↔'}</div>
                          </div>
                          <div className="bg-black/30 rounded-lg p-1.5">
                            <div className="text-[8px] text-slate-600 uppercase">Price</div>
                            <div className="text-xs font-bold text-cyan-400 font-mono">{cur}{signal.price.toFixed(2)}</div>
                          </div>
                          <div className="bg-black/30 rounded-lg p-1.5">
                            <div className="text-[8px] text-slate-600 uppercase">Score</div>
                            <div className={`text-xs font-bold font-mono ${sc.text}`}>{signal.confidence}</div>
                          </div>
                        </div>
                        {/* Strength Bar */}
                        <div className="mb-2">
                          <div className="w-full bg-slate-800/60 rounded-full h-1.5">
                            <div className={`h-full rounded-full transition-all ${signal.confidence > 75 ? 'bg-gradient-to-r from-emerald-500 to-cyan-400' : signal.confidence > 50 ? 'bg-gradient-to-r from-amber-500 to-yellow-400' : 'bg-gradient-to-r from-red-500 to-orange-400'}`} style={{ width: `${signal.confidence}%` }} />
                          </div>
                        </div>
                        {/* Fib S/R */}
                        <div className="flex items-center gap-2 text-[10px] text-slate-500">
                          <span>SL: <span className="text-red-400 font-mono">{cur}{(signal.fibLow || 0).toFixed(1)}</span></span>
                          <span className="text-slate-700">→</span>
                          <span>TP: <span className="text-emerald-400 font-mono">{cur}{(signal.fibHigh || 0).toFixed(1)}</span></span>
                        </div>
                      </div>
                    );
                  })}
                </div>

                {/* Allocation Recommendations */}
                {(() => {
                  const allocs = getSmartAllocations(livePrices, indiaSIP, usSIP);
                  return (
                    <div className="bg-black/20 rounded-xl p-4 border border-purple-500/15">
                      <div className="flex items-center justify-between mb-4">
                        <div className="text-[10px] text-purple-400 font-bold uppercase tracking-wider">
                          💰 Monthly SIP Allocation
                        </div>
                        <div className="text-[10px] text-slate-500 font-mono">
                          ₹{Math.round(indiaSIP).toLocaleString()} IN + ${usSIP} US
                        </div>
                      </div>
                      <div className="space-y-3">
                        {allocs.map((a, i) => {
                          const cur = a.market === 'IN' ? '₹' : '$';
                          const isGreen = a.signal.includes('BUY') || a.signal.includes('ACCUMULATE') || a.signal.includes('STRONG');
                          const isRed = a.signal.includes('AVOID') || a.signal.includes('DISTRIBUTE');
                          return (
                            <div key={i} className="bg-black/20 rounded-xl p-3 border border-white/5 hover:border-cyan-500/20 transition-all">
                              <div className="flex items-center justify-between mb-2">
                                <div className="flex items-center gap-2">
                                  <span className="text-sm">{a.market === 'IN' ? '🇮🇳' : '🦅'}</span>
                                  <div>
                                    <span className="font-bold text-white text-sm">{a.symbol.replace('.NS', '')}</span>
                                    <div className="text-[9px] text-slate-600 truncate max-w-[160px]">{a.name}</div>
                                  </div>
                                </div>
                                <div className="text-right">
                                  <div className="font-black text-cyan-400 font-mono text-sm">{cur}{a.allocAmount.toLocaleString()}</div>
                                  <div className="text-[9px] text-slate-600">{(a.allocPct * 100).toFixed(0)}% of SIP</div>
                                </div>
                              </div>
                              {/* Signal + Allocation Bar */}
                              <div className="flex items-center gap-2 mb-2">
                                <span className={`text-[9px] font-black px-2 py-0.5 rounded-md border ${isGreen ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20' :
                                    isRed ? 'bg-red-500/10 text-red-400 border-red-500/20' :
                                      'bg-amber-500/10 text-amber-400 border-amber-500/20'
                                  }`}>{a.signal}</span>
                                <div className="flex-1 bg-slate-800/60 rounded-full h-1.5">
                                  <div className={`h-full rounded-full transition-all ${isGreen ? 'bg-emerald-500' : isRed ? 'bg-red-500' : 'bg-amber-500'}`} style={{ width: `${a.allocPct * 100}%` }} />
                                </div>
                              </div>
                              {/* Details Row */}
                              <div className="grid grid-cols-4 gap-1 text-[9px] text-slate-500">
                                <div>RSI: <span className="text-slate-300 font-mono">{a.rsi.toFixed(0)}</span></div>
                                <div>Entry: <span className="text-cyan-400 font-mono">{cur}{a.targetEntry.toFixed(1)}</span></div>
                                <div>Str: <span className={`font-bold ${a.strength > 65 ? 'text-emerald-400' : a.strength < 35 ? 'text-red-400' : 'text-amber-400'}`}>{a.strength}</span></div>
                                <div>R:R <span className="text-cyan-300 font-mono">{a.riskReward.toFixed(1)}</span></div>
                              </div>
                              {/* Reason */}
                              <div className="text-[9px] text-slate-600 mt-1.5 italic leading-snug">{a.reason}</div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  );
                })()}
              </div>
            )}
          </div>
        )}

        {activeTab === 'macro' && (
          <div className="space-y-5 animate-fade-in">
            <h2 className="text-2xl font-black gradient-text-cyan font-display">
              🌍 Risk Radar
            </h2>

            <div className="glass-card rounded-2xl p-5 animate-fade-in-up">
              <h3 className="text-base font-bold text-white mb-4 flex items-center gap-2">
                <span className="w-7 h-7 rounded-lg bg-cyan-500/10 flex items-center justify-center text-sm">⚙️</span>
                Risk Diagnostics
              </h3>
              <div className="grid md:grid-cols-2 gap-3">
                <div className="bg-black/20 p-4 rounded-xl">
                  <div className="text-[10px] text-slate-500 font-bold uppercase tracking-wider mb-2">Global VIX</div>
                  <div className={`text-xl font-black ${avgVix > 22 ? 'text-red-400' : avgVix > 16 ? 'text-amber-400' : 'text-emerald-400'}`}>
                    {avgVix > 22 ? 'BEARISH' : avgVix > 16 ? 'VOLATILE' : 'BULLISH'}
                  </div>
                  <div className="text-[10px] text-slate-500 mt-2 font-mono">
                    US: <strong className="text-slate-300">{usVix.toFixed(1)}</strong> | IN: <strong className="text-slate-300">{inVix.toFixed(1)}</strong>
                  </div>
                </div>
                <div className="bg-black/20 p-4 rounded-xl">
                  <div className="text-[10px] text-slate-500 font-bold uppercase tracking-wider mb-2">Risk Assessment</div>
                  <div className={`text-lg font-bold ${sentiment.color}`}>{sentiment.text}</div>
                </div>
              </div>
            </div>

            <div className="glass-card rounded-2xl p-5 animate-fade-in-up delay-100">
              <h3 className="text-base font-bold text-white mb-4 flex items-center gap-2">
                <span className="w-7 h-7 rounded-lg bg-teal-500/10 flex items-center justify-center text-sm">🤖</span>
                Asset Analysis
              </h3>
              <div className="grid md:grid-cols-2 gap-3">
                {portfolio.map(p => {
                  const key = `${p.market}_${p.symbol}`;
                  const data = livePrices[key];
                  const rsi = data?.rsi || 50;
                  const cgr = getAssetCagrProxy(p.symbol, p.market);

                  const colorMap: Record<string, { border: string; bg: string; text: string }> = {
                    red: { border: 'border-red-500/20', bg: 'bg-red-500/5', text: 'text-red-400' },
                    emerald: { border: 'border-emerald-500/20', bg: 'bg-emerald-500/5', text: 'text-emerald-400' },
                    amber: { border: 'border-amber-500/20', bg: 'bg-amber-500/5', text: 'text-amber-400' },
                    blue: { border: 'border-blue-500/20', bg: 'bg-blue-500/5', text: 'text-blue-400' },
                  };

                  let tag = '🔵 FAIR VALUE', colorKey = 'blue';
                  if (cgr <= 10) { tag = '🔴 ROTATE'; colorKey = 'red'; }
                  else if (rsi < 45) { tag = '🟢 VALUE'; colorKey = 'emerald'; }
                  else if (rsi > 70) { tag = '🟠 HOT'; colorKey = 'amber'; }
                  const c = colorMap[colorKey];

                  return (
                    <div key={p.id} className={`bg-black/20 p-4 rounded-xl border ${c.border}`}>
                      <div className="flex justify-between items-start mb-2">
                        <div className="font-bold text-white">{p.symbol.replace('.NS', '')}</div>
                        <span className={`${c.bg} ${c.text} px-2 py-1 rounded-md text-[10px] font-bold border ${c.border}`}>{tag}</span>
                      </div>
                      <div className="text-[10px] text-slate-500 font-mono">
                        RSI: <span className="text-slate-300">{rsi.toFixed(1)}</span> | CAGR: <span className="text-slate-300">{cgr}%</span>
                      </div>
                    </div>
                  );
                })}
                {portfolio.length === 0 && (
                  <div className="col-span-2 text-center text-slate-600 py-8 border border-dashed border-white/10 rounded-xl animate-fade-in">
                    <div className="text-3xl mb-2">🤖</div>
                    <p className="font-medium">No assets to analyze</p>
                    <p className="text-xs text-slate-700 mt-1">Add portfolio holdings first</p>
                  </div>
                )}
              </div>
            </div>

            {/* VaR Analysis */}
            {portfolio.length > 0 && (
              <div className="glass-card rounded-2xl p-5 animate-fade-in-up delay-200">
                <h3 className="text-base font-bold text-white mb-4 flex items-center gap-2">
                  <span className="w-7 h-7 rounded-lg bg-red-500/10 flex items-center justify-center text-sm">VaR</span>
                  Value at Risk Analysis
                  <span className="ml-auto badge bg-red-500/10 text-red-400 border border-red-500/20 text-[10px]">ADVANCED</span>
                </h3>
                {(() => {
                  const varResult = calculateVaR(metrics.totalValue, portfolio, livePrices);
                  return (
                    <div className="grid grid-cols-3 gap-3">
                      <div className="bg-red-500/5 border border-red-500/15 p-4 rounded-xl text-center">
                        <div className="text-[10px] text-red-400/80 font-bold uppercase tracking-wider mb-1">Parametric</div>
                        <div className="text-lg font-black text-red-400 font-mono">Rs.{varResult.parametric.toLocaleString('en-IN')}</div>
                      </div>
                      <div className="bg-amber-500/5 border border-amber-500/15 p-4 rounded-xl text-center">
                        <div className="text-[10px] text-amber-400/80 font-bold uppercase tracking-wider mb-1">Historical</div>
                        <div className="text-lg font-black text-amber-400 font-mono">Rs.{varResult.historical.toLocaleString('en-IN')}</div>
                      </div>
                      <div className="bg-orange-500/5 border border-orange-500/15 p-4 rounded-xl text-center">
                        <div className="text-[10px] text-orange-400/80 font-bold uppercase tracking-wider mb-1">Monte Carlo</div>
                        <div className="text-lg font-black text-orange-400 font-mono">Rs.{varResult.monteCarlo.toLocaleString('en-IN')}</div>
                      </div>
                      <div className="col-span-3 text-center mt-2">
                        <span className="text-[10px] text-slate-400">Confidence: {varResult.confidence * 100}% &mdash; Max daily loss estimate</span>
                      </div>
                    </div>
                  );
                })()}
              </div>
            )}

            {/* Stress Test Scenarios */}
            {portfolio.length > 0 && (
              <div className="glass-card rounded-2xl p-5 animate-fade-in-up delay-300">
                <h3 className="text-base font-bold text-white mb-4 flex items-center gap-2">
                  <span className="w-7 h-7 rounded-lg bg-rose-500/10 flex items-center justify-center text-sm">Stress</span>
                  Stress Testing
                </h3>
                {(() => {
                  const stressResults = runStressTests(portfolio, livePrices);
                  return (
                    <div className="space-y-2">
                      {stressResults.map((s, i) => (
                        <div key={i} className="bg-black/20 rounded-xl p-3 border border-white/5 flex items-center justify-between">
                          <div>
                            <div className="font-bold text-white text-sm">{s.name}</div>
                            <div className="text-[10px] text-slate-500">{s.description}</div>
                          </div>
                          <div className="text-right">
                            <div className="font-black text-red-400 font-mono">Rs.{Math.round(Math.abs(s.impactPct * metrics.totalValue / 100)).toLocaleString('en-IN')}</div>
                            <div className="text-[10px] text-red-400/60">{Math.abs(s.impactPct)}%</div>
                          </div>
                        </div>
                      ))}
                    </div>
                  );
                })()}
              </div>
            )}

            {/* Concentration Risk */}
            {portfolio.length > 0 && (
              <div className="glass-card rounded-2xl p-5 animate-fade-in-up delay-400">
                <h3 className="text-base font-bold text-white mb-4 flex items-center gap-2">
                  <span className="w-7 h-7 rounded-lg bg-yellow-500/10 flex items-center justify-center text-sm">Concentration</span>
                  Concentration Risk
                </h3>
                {(() => {
                  const concRisk = analyzeConcentrationRisk(portfolio, livePrices);
                  return (
                    <div className="space-y-2">
                      {concRisk.map((c, i) => (
                        <div key={i} className="bg-black/20 rounded-xl p-3 border border-white/5">
                          <div className="flex items-center justify-between mb-2">
                            <div className="font-bold text-white text-sm">{c.symbol}</div>
                            <div className="text-right">
                              <span className="text-xs text-slate-300">{c.weight}%</span>
                              <span className="text-[10px] text-slate-500 ml-2">Risk: {c.contributionToRisk}</span>
                            </div>
                          </div>
                          <div className="w-full h-1 bg-slate-800/80 rounded-full overflow-hidden">
                            <div className="h-full bg-gradient-to-r from-cyan-500 to-red-500 transition-all" style={{ width: `${Math.min(100, c.contributionToRisk * 2)}%` }} />
                          </div>
                        </div>
                      ))}
                    </div>
                  );
                })()}
              </div>
            )}

            {/* WebSocket Latency & Market Status */}
            <div className="glass-card rounded-2xl p-5 animate-fade-in-up">
              <h3 className="text-base font-bold text-white mb-4 flex items-center gap-2">
                <span className="w-7 h-7 rounded-lg bg-emerald-500/10 flex items-center justify-center text-sm">Conn</span>
                Connection Quality
              </h3>
              <div className="grid grid-cols-3 gap-3">
                <div className="bg-black/20 p-3 rounded-xl text-center">
                  <div className="text-[10px] text-slate-500 font-bold uppercase tracking-wider mb-1">WS Latency</div>
                  <div className={`text-lg font-black font-mono ${wsLatency.avg < 500 ? 'text-emerald-400' : wsLatency.avg < 1000 ? 'text-amber-400' : 'text-red-400'}`}>
                    {wsLatency.avg}ms
                  </div>
                </div>
                <div className="bg-black/20 p-3 rounded-xl text-center">
                  <div className="text-[10px] text-slate-500 font-bold uppercase tracking-wider mb-1">Heartbeat</div>
                  <div className="text-lg font-black text-cyan-400 font-mono">{(wsLatency.heartbeat / 1000).toFixed(0)}s</div>
                </div>
                <div className="bg-black/20 p-3 rounded-xl text-center">
                  <div className="text-[10px] text-slate-500 font-bold uppercase tracking-wider mb-1">Batch Interval</div>
                  <div className="text-lg font-black text-purple-400 font-mono">{getBatchInterval() / 1000}s</div>
                </div>
              </div>
            </div>
          </div>
        )}
      </main>

      {showAddModal && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-xl z-50 flex items-center justify-center p-4 animate-fade-in">
          <div className="glass-modal rounded-2xl w-full max-w-md shadow-2xl animate-scale-in">
            <div className="p-5 border-b border-white/5 flex justify-between items-center">
              <h3 className="text-lg font-bold text-white">
                {transactionType === 'sell' ? '📉 Sell Asset' : '➕ Add Asset'}
              </h3>
              <button onClick={() => setShowAddModal(false)} className="w-8 h-8 rounded-lg bg-white/5 hover:bg-red-500/20 flex items-center justify-center text-lg text-slate-400 hover:text-red-400 transition-all">×</button>
            </div>
            <div className="p-5 space-y-4">
              <div>
                <label className="text-slate-500 text-[10px] font-bold uppercase tracking-wider mb-1.5 block">Symbol</label>
                <div className="flex gap-2">
                  <input type="text" value={addSymbol} onChange={e => setAddSymbol(e.target.value.toUpperCase())} placeholder="e.g. AAPL, RELIANCE" className="flex-1 px-4 py-2.5 glass-input rounded-xl uppercase font-bold text-white" />
                  <button onClick={() => fetchModalPriceData(addSymbol)} className="btn-glass px-4 py-2.5 rounded-xl font-bold text-cyan-400">🔍</button>
                </div>
              </div>
              {modalPrice && (
                <div className="glass-card rounded-xl p-3 flex justify-between items-center">
                  <span className="text-slate-500 text-[10px] uppercase font-bold tracking-wider">Live Price</span>
                  <div className="text-right">
                    <span className={`text-xl font-black font-mono ${modalPrice.change >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                      {modalPrice.market === 'IN' ? '₹' : '$'}{modalPrice.price.toFixed(2)}
                    </span>
                    <div className={`text-xs ${modalPrice.change >= 0 ? 'text-emerald-500' : 'text-red-500'}`}>
                      {modalPrice.change >= 0 ? '+' : ''}{modalPrice.change.toFixed(2)}%
                    </div>
                  </div>
                </div>
              )}
              <div className="flex gap-1 bg-black/30 rounded-xl p-1">
                <button onClick={() => setTransactionType('buy')} className={`flex-1 py-2 rounded-lg font-semibold text-sm transition-all ${transactionType === 'buy' ? 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/20' : 'text-slate-500'}`}>📈 BUY</button>
                <button onClick={() => setTransactionType('sell')} className={`flex-1 py-2 rounded-lg font-semibold text-sm transition-all ${transactionType === 'sell' ? 'bg-red-500/15 text-red-400 border border-red-500/20' : 'text-slate-500'}`}>📉 SELL</button>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-slate-500 text-[10px] font-bold uppercase tracking-wider mb-1.5 block">Quantity</label>
                  <input type="number" value={addQty} onChange={e => setAddQty(e.target.value)} placeholder="0" className="w-full px-4 py-2.5 glass-input rounded-xl font-bold text-lg text-white" />
                </div>
                <div>
                  <label className="text-slate-500 text-[10px] font-bold uppercase tracking-wider mb-1.5 block">Price</label>
                  <input type="number" value={addPrice} onChange={e => setAddPrice(e.target.value)} placeholder="0.00" className="w-full px-4 py-2.5 glass-input rounded-xl font-bold text-lg text-white" />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-slate-500 text-[10px] font-bold uppercase tracking-wider mb-1.5 block">Date</label>
                  <input type="date" value={addDate} onChange={e => setAddDate(e.target.value)} className="w-full px-4 py-2.5 glass-input rounded-xl text-slate-300" />
                </div>
                <div>
                  <label className="text-slate-500 text-[10px] font-bold uppercase tracking-wider mb-1.5 block">Leverage</label>
                  <select value={addLeverage} onChange={e => setAddLeverage(e.target.value)} className="w-full px-4 py-2.5 glass-input rounded-xl text-slate-300">
                    <option value="1">1x (Cash)</option>
                    <option value="2">2x MTF</option>
                    <option value="3">3x</option>
                    <option value="5">5x</option>
                  </select>
                </div>
              </div>
            </div>
            <div className="p-5 border-t border-white/5">
              <button onClick={savePosition} className="btn-primary w-full py-3 bg-gradient-to-r from-cyan-600 to-indigo-600 rounded-xl font-bold text-white">
                💾 Save
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Neural Core Chat AI Integration with Deep Real-Time Portolio Context Injection */}
      <NeuralChat groqKey={groqKey} portfolioContext={generateDeepAnalysis(portfolio, livePrices, usdInrRate, metrics)} />
    </div>
  );
}
