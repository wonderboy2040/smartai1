import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { Position, PriceData, TabType, RiskLevel, TransactionType } from './types';
import { 
  SECURE_PIN, TG_TOKEN, TG_CHAT_ID,
  getTodayString, guessMarket
} from './utils/constants';
import { 
  fetchSinglePrice, batchFetchPrices, fetchForexRate, 
  syncToCloud, loadFromCloud, sendTelegramAlert,
  syncGroqKeyToCloud, loadGroqKeyFromCloud
} from './utils/api';
import { subscribeToPrices } from './utils/tvWebsocket';
import { isAnyMarketOpen, generateDeepAnalysis } from './utils/telegram';
import { NeuralChat } from './components/NeuralChat';
import { DashboardTab } from './components/DashboardTab';
import { PortfolioTab } from './components/PortfolioTab';
import { PlannerTab } from './components/PlannerTab';
import { MacroTab } from './components/MacroTab';

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
  const [currentTime, setCurrentTime] = useState(new Date());
  const [liveStatus, setLiveStatus] = useState('Connecting...');
  const [syncStatus, setSyncStatus] = useState('');
  const [, setPricesLoaded] = useState(false);

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
  const [modalPrice, setModalPrice] = useState<{price: number; change: number; market: string} | null>(null);
  const [editId, setEditId] = useState<string | null>(null);

  const syncIntervalRef = useRef<number | null>(null);
  const chartContainerRef = useRef<HTMLDivElement>(null);
  const [pendingAnalyze, setPendingAnalyze] = useState<string | null>(null);
  const [autoTelegram, setAutoTelegram] = useState(true);
  const telegramIntervalRef = useRef<number | null>(null);
  const forexIntervalRef = useRef<number | null>(null);
  const isInitialLoadRef = useRef(true);
  const livePricesWriteTimerRef = useRef<number | null>(null);

  // Stable portfolio ID key for dependency tracking (prevents unnecessary re-subscribes)
  const portfolioIdKey = useMemo(() => portfolio.map(p => p.id).join(','), [portfolio]);

  // Initialize auth
  useEffect(() => {
    const auth = localStorage.getItem('authDone');
    if (auth === 'true') {
      setIsAuthenticated(true);
    }
  }, []);

  // Time update
  useEffect(() => {
    const interval = setInterval(() => setCurrentTime(new Date()), 1000);
    return () => clearInterval(interval);
  }, []);

  // Load data when authenticated
  useEffect(() => {
    if (!isAuthenticated) return;
    
    // Load from localStorage
    try {
      const saved = localStorage.getItem('portfolio');
      if (saved) setPortfolio(JSON.parse(saved));
      
      const savedPrices = localStorage.getItem('livePrices');
      if (savedPrices) setLivePrices(JSON.parse(savedPrices));
    } catch (_e) { /* ignore corrupt localStorage */ }

    // Load from cloud
    loadFromCloud().then(data => {
      if (data && data.length > 0) {
        setPortfolio(data);
        localStorage.setItem('portfolio', JSON.stringify(data));
      }
      isInitialLoadRef.current = false;
    }).catch(() => {
      console.warn('Cloud sync unavailable');
      isInitialLoadRef.current = false;
    });

    // Load Groq key from cloud
    loadGroqKeyFromCloud().then(key => {
      if (key) {
        setGroqKey(key);
        localStorage.setItem('WEALTH_AI_GROQ', key);
      }
    }).catch(() => {});

    // Fetch forex rate
    fetchForexRate().then(rate => setUsdInrRate(rate));
  }, [isAuthenticated]);

  // Debounced localStorage write for live prices
  const debouncedSavePrices = useCallback((updatedPrices: Record<string, PriceData>) => {
    if (livePricesWriteTimerRef.current) {
      clearTimeout(livePricesWriteTimerRef.current);
    }
    livePricesWriteTimerRef.current = window.setTimeout(() => {
      localStorage.setItem('livePrices', JSON.stringify(updatedPrices));
    }, 5000); // Write at most once every 5 seconds
  }, []);

  // Background sync & WebSocket
  useEffect(() => {
    if (!isAuthenticated || portfolio.length === 0) return;

    // Fast HTTP Sync (Runs exactly once and every 10s for backup)
    const sync = async () => {
      setLiveStatus('● SYNCING...');
      await batchFetchPrices(portfolio, (key, data) => {
        setLivePrices(prev => {
          const updated = { ...prev, [key]: data };
          debouncedSavePrices(updated);
          return updated;
        });
      });
      setLiveStatus('● QUANTUM LINK ACTIVE');
      setPricesLoaded(true);
    };

    sync();
    syncIntervalRef.current = window.setInterval(sync, 10000);

    // Ultra-fast TradingView WebSocket integration
    const symbolsToSub = portfolio.map(p => `${p.market}_${p.symbol}`);
    if (currentSymbol) {
      symbolsToSub.push(`${currentMarket}_${currentSymbol}`);
    }
    const unsubscribe = subscribeToPrices(symbolsToSub, (key, data) => {
      setLivePrices(prev => {
        const existingInfo = prev[key] || {};
        const updated = { ...prev, [key]: { ...existingInfo, ...data, time: Date.now() } };
        debouncedSavePrices(updated);
        return updated;
      });
      setLiveStatus('● TV SOCKET LIVE ⚡');
    });

    return () => {
      if (syncIntervalRef.current) clearInterval(syncIntervalRef.current);
      if (livePricesWriteTimerRef.current) clearTimeout(livePricesWriteTimerRef.current);
      unsubscribe();
    };
  }, [isAuthenticated, portfolioIdKey, debouncedSavePrices, currentSymbol, currentMarket]);

  // Save portfolio to localStorage & Handle Initial Symbol
  useEffect(() => {
    if (portfolio.length > 0) {
      localStorage.setItem('portfolio', JSON.stringify(portfolio));
      if (!currentSymbol) {
        setCurrentSymbol(portfolio[0].symbol);
        setCurrentMarket(portfolio[0].market as 'IN' | 'US');
      }
    }
  }, [portfolio, currentSymbol]);

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

  // Sync to cloud whenever portfolio changes (skip initial load to avoid double-sync)
  useEffect(() => {
    if (portfolio.length > 0 && !isInitialLoadRef.current) {
      syncToCloud(portfolio, usdInrRate);
    }
  }, [portfolio, usdInrRate]);

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

  // Load TradingView Chart — fixed to use theme variable
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
      theme: theme === 'dark' ? 'dark' : 'light',
      style: '1',
      locale: 'en',
      enable_publishing: false,
      allow_symbol_change: true,
      studies: ['STD;RSI', 'STD;MACD']
    });
    container.appendChild(script);
  }, [currentSymbol, currentMarket, chartInterval, theme]);

  // Calculate portfolio metrics (memoized)
  const metrics = useMemo(() => {
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

  // VIX based sentiment
  const usVix = livePrices['US_VIX']?.price || 15;
  const inVix = livePrices['IN_INDIAVIX']?.price || 15;
  const avgVix = (usVix + inVix) / 2;
  
  const sentiment = useMemo(() => {
    if (avgVix > 22) return { text: '🔴 Global Risk Severe | Institutional Liquidation Active', color: 'text-red-400' };
    if (avgVix > 17) return { text: '🟠 Elevated Volatility | Smart Money Cautious', color: 'text-amber-400' };
    if (avgVix > 14) return { text: '🟡 Normal Range | Standard SIP Optimal', color: 'text-yellow-400' };
    return { text: '🟢 Ultra Low Risk | Whale Accumulation Zone', color: 'text-emerald-400' };
  }, [avgVix]);

  // Current symbol data
  const currentKey = `${currentMarket}_${currentSymbol}`;
  const currentData = livePrices[currentKey];
  const currentPrice = currentData?.price || 0;
  const currentChange = currentData?.change || 0;
  const currentRsi = currentData?.rsi || 50;

  // Generate signal (memoized)
  const signalData = useMemo(() => {
    if (currentRsi < 35) return { signal: '🟢 MAX BUY', color: 'text-emerald-400', conf: 98 };
    if (currentRsi < 45) return { signal: '🟢 ACCUMULATE', color: 'text-emerald-400', conf: 85 };
    if (currentRsi < 60) return { signal: '🟡 MAINTAIN', color: 'text-amber-400', conf: 75 };
    if (currentRsi < 70) return { signal: '🟠 THROTTLE', color: 'text-orange-400', conf: 65 };
    return { signal: '🔴 DISTRIBUTE', color: 'text-red-400', conf: 90 };
  }, [currentRsi]);

  // Planner calculations (memoized)
  const plannerMetrics = useMemo(() => {
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
    const yearsToFire = totalSIP > 0 && rate > 0 ? Math.ceil(Math.log((fireNumber * rate / totalSIP) + 1) / Math.log(1 + rate) / 12) : 99;
    const fireProgress = fireNumber > 0 ? Math.min(100, (metrics.totalValue / fireNumber) * 100) : 0;

    return { totalSIP, totalInvestedPlanner, fvMed, fvWorst, fvBest, multiplier, fireNumber, yearsToFire, fireProgress };
  }, [indiaSIP, usSIP, usdInrRate, riskLevel, investYears, monthlyExpenses, metrics.totalValue]);

  // Push Telegram Report (fixed: uses HTML format consistent with sendTelegramAlert)
  const pushTelegramReport = async () => {
    const msg = `🧠 <b>Quantum AI Master Report</b>\n\n🌍 <b>Global State:</b> ${sentiment.text}\n\n💼 <b>Total Equity:</b> ₹${Math.round(metrics.totalValue).toLocaleString('en-IN')}\n📈 <b>P&L:</b> ${metrics.totalPL >= 0 ? '+' : ''}₹${Math.round(metrics.totalPL).toLocaleString('en-IN')} (${metrics.plPct.toFixed(2)}%)\n⚡ <b>Today:</b> ${metrics.todayPL >= 0 ? '+' : ''}₹${Math.round(metrics.todayPL).toLocaleString('en-IN')}`;
    await sendTelegramAlert(TG_TOKEN, TG_CHAT_ID, msg);
    setSyncStatus('✅ Sent');
    setTimeout(() => setSyncStatus(''), 3000);
  };

  // Memoize portfolio context for NeuralChat (avoids recalculating every render)
  const portfolioContext = useMemo(
    () => generateDeepAnalysis(portfolio, livePrices, usdInrRate, metrics),
    [portfolio, livePrices, usdInrRate, metrics]
  );

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
                  <span className={`w-1.5 h-1.5 rounded-full ${liveStatus.includes('ACTIVE') || liveStatus.includes('LIVE') ? 'bg-cyan-400 animate-pulse-dot' : 'bg-amber-500 animate-pulse'}`} />
                  <span className={`font-medium ${liveStatus.includes('ACTIVE') || liveStatus.includes('LIVE') ? 'text-cyan-500/80' : 'text-amber-400/80'}`}>{liveStatus.includes('ACTIVE') || liveStatus.includes('LIVE') ? 'LIVE' : 'SYNCING'}</span>
                  <span className="text-slate-700">•</span>
                  <span className="text-slate-500 font-mono text-[10px]">{currentTime.toLocaleTimeString('en-US', { hour12: false })}</span>
                </div>
              </div>
            </div>

            {/* Tabs */}
            <div className="flex gap-0.5 glass-card p-1 rounded-2xl">
              {(['dashboard', 'portfolio', 'planner', 'macro'] as TabType[]).map(tab => (
                <button
                  key={tab}
                  onClick={() => setActiveTab(tab)}
                  className={`tab-btn px-4 py-2 rounded-xl font-semibold text-sm transition-all ${
                    activeTab === tab 
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
        {/* Dashboard Tab — uses extracted component with MTFMatrix, DeepFibZones */}
        {activeTab === 'dashboard' && currentSymbol && (
          <DashboardTab 
            avgVix={avgVix} sentiment={sentiment} symbolInput={symbolInput} setSymbolInput={setSymbolInput}
            analyzeSymbol={analyzeSymbol} isAnalyzing={isAnalyzing} currentSymbol={currentSymbol}
            currentMarket={currentMarket} currentPrice={currentPrice} currentChange={currentChange}
            currentRsi={currentRsi} signalData={signalData} metrics={metrics} openAddModal={openAddModal}
            chartInterval={chartInterval} setChartInterval={setChartInterval} chartContainerRef={chartContainerRef}
            currentData={currentData} usdInrRate={usdInrRate} portfolio={portfolio} livePrices={livePrices}
            quickSelect={quickSelect}
          />
        )}

        {/* Portfolio Tab — uses extracted component with TradeJournal */}
        {activeTab === 'portfolio' && (
          <PortfolioTab 
            loadFromCloud={loadFromCloud} setPortfolio={setPortfolio} openAddModal={openAddModal}
            pushTelegramReport={pushTelegramReport} syncStatus={syncStatus} usdInrRate={usdInrRate}
            metrics={metrics} portfolio={portfolio} livePrices={livePrices} setAddSymbol={setAddSymbol}
            setTransactionType={setTransactionType} setShowAddModal={setShowAddModal}
            fetchModalPriceData={fetchModalPriceData} setAddQty={setAddQty}
          />
        )}

        {/* Planner Tab — uses extracted component with PositionSizer */}
        {activeTab === 'planner' && (
          <PlannerTab 
            indiaSIP={indiaSIP} setIndiaSIP={setIndiaSIP} usSIP={usSIP} setUsSIP={setUsSIP}
            emergencyFund={emergencyFund} setEmergencyFund={setEmergencyFund}
            investYears={investYears} setInvestYears={setInvestYears} riskLevel={riskLevel}
            setRiskLevel={setRiskLevel} monthlyExpenses={monthlyExpenses} setMonthlyExpenses={setMonthlyExpenses}
            currentAge={currentAge} setCurrentAge={setCurrentAge} totalSIP={plannerMetrics.totalSIP}
            totalInvestedPlanner={plannerMetrics.totalInvestedPlanner} fvWorst={plannerMetrics.fvWorst}
            fvMed={plannerMetrics.fvMed} fvBest={plannerMetrics.fvBest} multiplier={plannerMetrics.multiplier}
            fireNumber={plannerMetrics.fireNumber} yearsToFire={plannerMetrics.yearsToFire}
            fireProgress={plannerMetrics.fireProgress} portfolio={portfolio} livePrices={livePrices}
            usdInrRate={usdInrRate} metrics={metrics} currentPrice={currentPrice} currentMarket={currentMarket}
          />
        )}

        {/* Macro / Risk Tab — uses extracted component with CorrelationScanner */}
        {activeTab === 'macro' && (
          <MacroTab 
            avgVix={avgVix} sentiment={sentiment} usVix={usVix} inVix={inVix}
            portfolio={portfolio} livePrices={livePrices}
          />
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

      {/* Neural Core Chat AI Integration with Deep Real-Time Portfolio Context Injection */}
      <NeuralChat groqKey={groqKey} portfolioContext={portfolioContext} />
    </div>
  );
}
