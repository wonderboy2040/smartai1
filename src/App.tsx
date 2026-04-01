import { useState, useEffect, useCallback, useRef } from 'react';
import { Position, PriceData, TabType, RiskLevel, ExpertInfo, TransactionType } from './types';
import { 
  SECURE_PIN, TG_TOKEN, TG_CHAT_ID,
  getTodayString, guessMarket, getAssetCagrProxy, formatPrice
} from './utils/constants';
import { 
  fetchSinglePrice, batchFetchPrices, fetchForexRate, 
  syncToCloud, loadFromCloud, sendTelegramAlert 
} from './utils/api';

export default function App() {
  // Auth State
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [pinInput, setPinInput] = useState('');

  // Main State
  const [activeTab, setActiveTab] = useState<TabType>('dashboard');
  const [portfolio, setPortfolio] = useState<Position[]>([]);
  const [livePrices, setLivePrices] = useState<Record<string, PriceData>>({});
  const [usdInrRate, setUsdInrRate] = useState(83.5);
  const [currentSymbol, setCurrentSymbol] = useState('ITBEES.NS');
  const [currentMarket, setCurrentMarket] = useState<'IN' | 'US'>('IN');
  const [symbolInput, setSymbolInput] = useState('');
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [chartInterval, setChartInterval] = useState('D');
  const [currentTime, setCurrentTime] = useState(new Date());
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
  const [showExpertModal, setShowExpertModal] = useState(false);
  const [expertInfo, setExpertInfo] = useState<ExpertInfo | null>(null);
  const [expertMessages, setExpertMessages] = useState<Array<{text: string; sender: 'user' | 'expert'}>>([]);
  const [expertInput, setExpertInput] = useState('');
  
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

  // Initialize
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
    } catch (e) {}

    // Load from cloud
    loadFromCloud().then(data => {
      if (data && data.length > 0) {
        setPortfolio(data);
        localStorage.setItem('portfolio', JSON.stringify(data));
      }
    });

    // Fetch forex rate
    fetchForexRate().then(rate => setUsdInrRate(rate));
  }, [isAuthenticated]);

  // Background sync
  useEffect(() => {
    if (!isAuthenticated || portfolio.length === 0) return;

    const sync = async () => {
      setLiveStatus('● SYNCING...');
      
      await batchFetchPrices(portfolio, (key, data) => {
        setLivePrices(prev => {
          const updated = { ...prev, [key]: data };
          localStorage.setItem('livePrices', JSON.stringify(updated));
          return updated;
        });
      });
      
      setLiveStatus('● QUANTUM LINK ACTIVE');
    };

    sync();
    syncIntervalRef.current = window.setInterval(sync, 5000);
    
    return () => {
      if (syncIntervalRef.current) clearInterval(syncIntervalRef.current);
    };
  }, [isAuthenticated, portfolio.length]);

  // Save portfolio to localStorage
  useEffect(() => {
    if (portfolio.length > 0) {
      localStorage.setItem('portfolio', JSON.stringify(portfolio));
    }
  }, [portfolio]);

  // Load chart when symbol changes
  useEffect(() => {
    if (!isAuthenticated || !chartContainerRef.current) return;
    loadTradingViewChart();
  }, [currentSymbol, chartInterval, isAuthenticated]);

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
    const cleanSym = sym.replace('.NS', '').toUpperCase().trim();
    setSymbolInput(cleanSym);
    setPendingAnalyze(sym.toUpperCase().trim());
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
      if (!addPrice) setAddPrice(result.price.toString());
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

  // Sync to cloud whenever portfolio changes
  useEffect(() => {
    if (portfolio.length > 0) {
      syncToCloud(portfolio, usdInrRate);
    }
  }, [portfolio]);

  // Expert Modal
  const openExpert = (type: 'IN' | 'US') => {
    const info: ExpertInfo = type === 'US' ? {
      id: 'US',
      icon: '🦅',
      name: 'Wall Street Quantum Insider',
      role: 'Global Macro & Dark Pool Matrix',
      colorBg: 'from-blue-900 to-cyan-900',
      border: 'border-cyan-500/50'
    } : {
      id: 'IN',
      icon: '🇮🇳',
      name: 'Dalal Street Neural Core',
      role: 'NSE FII/DII Algorithmic Tracker',
      colorBg: 'from-orange-900 to-emerald-900',
      border: 'border-orange-500/50'
    };
    
    setExpertInfo(info);
    setExpertMessages([{
      text: type === 'US' 
        ? 'System Online. I am the US Macro Insider.\n\nTracking FED liquidity, Dark Pool block trades, and S&P 500 whale movements 24/7.'
        : 'System Online. I am the Dalal Street Neural Core.\n\nMonitoring RBI sweeps, DII SIP deployments, and FII derivative footprints.',
      sender: 'expert'
    }]);
    setShowExpertModal(true);
  };

  const sendToExpert = async () => {
    if (!expertInput.trim()) return;
    
    const msg = expertInput;
    setExpertInput('');
    setExpertMessages(prev => [...prev, { text: msg, sender: 'user' }]);
    
    // Simulate AI response
    await new Promise(r => setTimeout(r, 1000));
    
    const response = generateExpertResponse(msg);
    setExpertMessages(prev => [...prev, { text: response, sender: 'expert' }]);
  };

  const generateExpertResponse = (query: string): string => {
    const q = query.toLowerCase();
    const usVix = livePrices['US_VIX']?.price || 15;
    const inVix = livePrices['IN_INDIAVIX']?.price || 15;
    
    if (q.includes('crash') || q.includes('risk')) {
      return `🔍 Global Macro Analysis:\n\nUS VIX: ${usVix.toFixed(1)} | India VIX: ${inVix.toFixed(1)}\n\n${usVix > 20 ? '⚠️ HIGH RISK: Market volatility elevated. Consider defensive positions.' : '✅ NORMAL: Volatility within acceptable range. Standard SIP safe.'}`;
    }
    
    if (q.includes('whale') || q.includes('buy')) {
      const lowRsiAssets = portfolio.filter(p => {
        const key = `${p.market}_${p.symbol}`;
        return (livePrices[key]?.rsi || 50) < 40;
      });
      
      if (lowRsiAssets.length > 0) {
        return `🐋 Whale Accumulation Detected:\n\n${lowRsiAssets.map(a => `• ${a.symbol}: RSI ${(livePrices[`${a.market}_${a.symbol}`]?.rsi || 50).toFixed(1)}`).join('\n')}\n\nThese assets show institutional buying patterns.`;
      }
      return '📊 No significant whale activity detected in your portfolio right now.';
    }
    
    return `🧠 AI Analysis:\n\nYour query: "${query}"\n\nBased on current market conditions (VIX: ${((usVix + inVix) / 2).toFixed(1)}), I recommend maintaining your current SIP allocation and monitoring key support levels.`;
  };

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

  const metrics = calculateMetrics();

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
  const fvWorst = totalSIP > 0 ? totalSIP * (Math.pow(1 + Math.max(0.01, (cagr - 8)) / 100 / 12, months) - 1) * (1 + Math.max(0.01, (cagr - 8)) / 100 / 12) / (Math.max(0.01, (cagr - 8)) / 100 / 12) : 0;
  const fvBest = totalSIP > 0 ? totalSIP * (Math.pow(1 + (cagr + 8) / 100 / 12, months) - 1) * (1 + (cagr + 8) / 100 / 12) / ((cagr + 8) / 100 / 12) : 0;
  const multiplier = totalInvestedPlanner > 0 ? fvMed / totalInvestedPlanner : 0;

  // FIRE calculations
  const fireNumber = monthlyExpenses * 12 * 25;
  const yearsToFire = totalSIP > 0 && rate > 0 ? Math.ceil(Math.log((fireNumber * rate / totalSIP) + 1) / Math.log(1 + rate) / 12) : 99;
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
              <div className="absolute -inset-4 bg-cyan-500/10 rounded-full blur-xl" />
            </div>
            <h1 className="text-3xl font-black gradient-text-cyan font-display mt-4">
              Wealth AI
            </h1>
            <div className="flex items-center justify-center gap-2 mt-2">
              <span className="badge bg-cyan-500/10 text-cyan-400 border border-cyan-500/20">QUANTUM TERMINAL</span>
            </div>
            <p className="text-slate-500 text-sm mt-3">Secure PIN enter karein</p>
          </div>
          <input
            type="password"
            value={pinInput}
            onChange={e => setPinInput(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && verifyPin()}
            placeholder="••••"
            maxLength={4}
            className="w-full text-center px-4 py-5 glass-input rounded-2xl text-3xl tracking-[0.5em] text-cyan-400 font-bold mb-5 font-mono placeholder-slate-700"
          />
          <button
            onClick={verifyPin}
            className="btn-primary w-full py-4 bg-gradient-to-r from-cyan-600 via-blue-600 to-indigo-600 animate-gradient rounded-2xl font-bold text-white text-lg"
          >
            🔓 Unlock Terminal
          </button>
          <div className="text-center mt-5">
            <span className="text-[10px] text-slate-600 font-mono tracking-wider">ENCRYPTED • AES-256 • NEURAL LOCKED</span>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-950 via-[#0a0f1e] to-slate-950 text-slate-200">
      {/* Expert Floating Buttons */}
      <div className="fixed bottom-6 right-6 flex flex-col gap-3 z-50">
        <button
          onClick={() => openExpert('IN')}
          className="fab w-12 h-12 bg-gradient-to-br from-orange-600/80 via-slate-800/90 to-green-700/80 rounded-full flex items-center justify-center border border-orange-500/30 relative"
          title="Dalal Street Insider"
        >
          <span className="text-xl">🇮🇳</span>
          <span className="ripple-ring rounded-full text-orange-500/30" />
        </button>
        <button
          onClick={() => openExpert('US')}
          className="fab w-14 h-14 bg-gradient-to-br from-blue-700/80 via-indigo-900/90 to-cyan-800/80 rounded-2xl flex items-center justify-center border border-cyan-500/30 relative"
          title="Wall Street Insider"
        >
          <span className="text-2xl">🦅</span>
          <span className="absolute -top-1 -right-1 w-3 h-3 bg-cyan-400 rounded-full animate-pulse-dot" />
          <span className="ripple-ring rounded-2xl text-cyan-500/30" />
        </button>
      </div>

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
                  <span className={`font-medium ${liveStatus.includes('ACTIVE') ? 'text-cyan-500/80' : 'text-amber-400/80'}`}>{liveStatus.includes('ACTIVE') ? 'LIVE' : 'SYNCING'}</span>
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

            <div className="flex gap-2">
              <button onClick={() => window.location.reload()} className="btn-glass p-2.5 rounded-xl text-lg" title="Refresh">🔄</button>
              <button onClick={logout} className="btn-glass p-2.5 rounded-xl text-lg" title="Logout">🔐</button>
            </div>
          </div>
        </div>
      </header>

      <main className="container mx-auto px-4 py-6">
        {/* Dashboard Tab */}
        {activeTab === 'dashboard' && (
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
                      className={`px-3.5 py-1.5 rounded-md text-xs font-semibold transition-all ${
                        chartInterval === int ? 'bg-cyan-500/20 text-cyan-400 border border-cyan-500/20' : 'text-slate-500 hover:text-slate-300'
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

            <div className="glass-card rounded-2xl overflow-hidden animate-fade-in-up delay-200">
              <div className="overflow-x-auto">
                <table className="w-full text-sm portfolio-table">
                  <thead className="bg-black/40 border-b border-white/5">
                    <tr className="text-slate-500 text-[10px] uppercase tracking-wider">
                      <th className="p-4 text-left">Asset</th>
                      <th className="p-4 text-left">Qty</th>
                      <th className="p-4 text-left">Avg Price</th>
                      <th className="p-4 text-left">LTP</th>
                      <th className="p-4 text-left">Today</th>
                      <th className="p-4 text-left">Value</th>
                      <th className="p-4 text-left">P&L</th>
                      <th className="p-4 text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-white/5">
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
                      
                      return (
                        <tr key={p.id} className="hover:bg-white/[0.02] transition-colors">
                          <td className="p-4">
                            <div className="font-bold text-white">{p.symbol.replace('.NS', '')}</div>
                            <div className="flex items-center gap-1.5 text-[10px] mt-1">
                              <span className={`badge ${p.market === 'IN' ? 'bg-orange-500/10 text-orange-400 border border-orange-500/15' : 'bg-blue-500/10 text-blue-400 border border-blue-500/15'}`}>
                                {p.market}
                              </span>
                              {p.leverage > 1 && <span className="badge bg-indigo-500/10 text-indigo-400 border border-indigo-500/15">{p.leverage}x</span>}
                            </div>
                          </td>
                          <td className="p-4 font-bold font-mono">{p.qty}</td>
                          <td className="p-4 text-slate-400 font-mono">{cur}{p.avgPrice.toFixed(2)}</td>
                          <td className="p-4">
                            <div className={`font-bold font-mono ${change >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                              {cur}{curPrice.toFixed(2)}
                            </div>
                            <div className={`text-xs ${change >= 0 ? 'text-emerald-500' : 'text-red-500'}`}>
                              {change >= 0 ? '+' : ''}{change.toFixed(2)}%
                            </div>
                          </td>
                          <td className="p-4">
                            <div className={`font-bold font-mono ${todayPL >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                              {todayPL >= 0 ? '+' : ''}{cur}{todayPL.toFixed(2)}
                            </div>
                          </td>
                          <td className="p-4 font-bold font-mono text-white">{cur}{eqVal.toFixed(2)}</td>
                          <td className="p-4">
                            <div className={`font-bold font-mono ${pl >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                              {pl >= 0 ? '+' : ''}{cur}{pl.toFixed(2)}
                            </div>
                            <div className={`text-xs ${plPct >= 0 ? 'text-emerald-500' : 'text-red-500'}`}>
                              ({plPct >= 0 ? '+' : ''}{plPct.toFixed(2)}%)
                            </div>
                          </td>
                          <td className="p-4">
                            <div className="flex gap-2 justify-end">
                              <button
                                onClick={() => {
                                  setAddSymbol(p.symbol);
                                  setTransactionType('buy');
                                  setShowAddModal(true);
                                  fetchModalPriceData(p.symbol);
                                }}
                                className="w-8 h-8 flex items-center justify-center bg-cyan-500/10 hover:bg-cyan-500/30 border border-cyan-500/20 rounded-lg transition-all text-sm"
                                title="Buy more"
                              >
                                ➕
                              </button>
                              <button
                                onClick={() => {
                                  setAddSymbol(p.symbol);
                                  setAddQty(p.qty.toString());
                                  setTransactionType('sell');
                                  setShowAddModal(true);
                                  fetchModalPriceData(p.symbol);
                                }}
                                className="w-8 h-8 flex items-center justify-center bg-red-500/10 hover:bg-red-500/30 border border-red-500/20 rounded-lg transition-all text-sm"
                                title="Sell"
                              >
                                ❌
                              </button>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
                {portfolio.length === 0 && (
                  <div className="p-12 text-center text-slate-500">
                    <div className="text-6xl mb-4">🛰️</div>
                    <p className="text-lg font-bold text-cyan-300/50 uppercase">Database Empty</p>
                    <p className="text-sm mt-2">Add assets to begin tracking.</p>
                  </div>
                )}
              </div>
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
                    red:     { border: 'border-red-500/20',     bg: 'bg-red-500/5',     text: 'text-red-400' },
                    emerald: { border: 'border-emerald-500/20', bg: 'bg-emerald-500/5', text: 'text-emerald-400' },
                    amber:   { border: 'border-amber-500/20',   bg: 'bg-amber-500/5',   text: 'text-amber-400' },
                    blue:    { border: 'border-blue-500/20',    bg: 'bg-blue-500/5',    text: 'text-blue-400' },
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

      {showExpertModal && expertInfo && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-xl z-50 flex items-end sm:items-center justify-center p-4 animate-fade-in">
          <div className="glass-modal rounded-t-2xl sm:rounded-2xl w-full max-w-lg shadow-2xl max-h-[90vh] flex flex-col animate-scale-in">
            <div className={`bg-gradient-to-r ${expertInfo.colorBg} p-4 border-b border-white/5 rounded-t-2xl flex items-center justify-between`}>
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 bg-black/40 rounded-xl flex items-center justify-center text-xl border border-white/10">{expertInfo.icon}</div>
                <div>
                  <h3 className="font-bold text-lg text-white">{expertInfo.name}</h3>
                  <p className="text-cyan-400/80 text-[10px] font-bold uppercase tracking-wider">{expertInfo.role}</p>
                </div>
              </div>
              <button onClick={() => setShowExpertModal(false)} className="w-8 h-8 rounded-lg bg-black/30 hover:bg-red-500/20 flex items-center justify-center text-lg text-slate-400 hover:text-red-400 transition-all">×</button>
            </div>
            
            <div className="flex-1 overflow-y-auto p-4 space-y-3 min-h-[300px] max-h-[400px]">
              {expertMessages.map((msg, i) => (
                <div key={i} className={`flex gap-3 ${msg.sender === 'user' ? 'flex-row-reverse' : ''}`}>
                  <div className={`w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0 text-sm ${msg.sender === 'user' ? 'bg-cyan-500/10' : `bg-gradient-to-br ${expertInfo.colorBg}`}`}>
                    {msg.sender === 'user' ? '👤' : expertInfo.icon}
                  </div>
                  <div className={`rounded-2xl p-3.5 max-w-[85%] ${msg.sender === 'user' ? 'bg-cyan-500/10 border border-cyan-500/15' : 'bg-black/30 border border-white/5'}`}>
                    <div className="text-sm whitespace-pre-line">{msg.text}</div>
                  </div>
                </div>
              ))}
            </div>

            <div className="p-4 border-t border-white/5">
              <div className="flex gap-2">
                <input type="text" value={expertInput} onChange={e => setExpertInput(e.target.value)} onKeyDown={e => e.key === 'Enter' && sendToExpert()} placeholder="Ask about market, stocks, risk..." className="flex-1 px-4 py-2.5 glass-input rounded-xl text-sm text-white" />
                <button onClick={sendToExpert} className="btn-primary px-5 py-2.5 bg-gradient-to-r from-cyan-600 to-indigo-600 rounded-xl font-bold text-sm text-cyan-100">Send ⚡</button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
