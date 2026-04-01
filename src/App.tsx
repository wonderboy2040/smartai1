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

  // Quick select from portfolio
  const quickSelect = (sym: string) => {
    setSymbolInput(sym.replace('.NS', ''));
    setTimeout(() => analyzeSymbol(), 100);
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
    syncToCloud(portfolio, usdInrRate);
  };

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
      <div className="min-h-screen bg-gradient-to-br from-slate-950 via-slate-900 to-indigo-950 flex items-center justify-center p-4">
        <div className="bg-slate-900/90 backdrop-blur-xl rounded-3xl p-8 max-w-sm w-full border border-indigo-500/20 shadow-2xl">
          <div className="text-center mb-6">
            <div className="text-6xl mb-4">🔒</div>
            <h1 className="text-2xl font-black bg-gradient-to-r from-emerald-400 via-cyan-500 to-indigo-500 bg-clip-text text-transparent">
              Wealth AI
            </h1>
            <p className="text-slate-400 text-sm mt-2">Terminal unlock karne ke liye PIN enter karein</p>
          </div>
          <input
            type="password"
            value={pinInput}
            onChange={e => setPinInput(e.target.value)}
            onKeyPress={e => e.key === 'Enter' && verifyPin()}
            placeholder="••••"
            maxLength={4}
            className="w-full text-center px-4 py-4 bg-slate-950 rounded-xl border border-slate-700 focus:border-emerald-500 outline-none text-3xl tracking-[0.5em] text-emerald-400 font-bold mb-4"
          />
          <button
            onClick={verifyPin}
            className="w-full py-4 bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 rounded-xl font-bold text-white transition-all"
          >
            Unlock Terminal
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-950 via-slate-900 to-indigo-950 text-slate-200">
      {/* Expert Floating Buttons */}
      <div className="fixed bottom-6 right-6 flex flex-col gap-4 z-50">
        <button
          onClick={() => openExpert('IN')}
          className="w-12 h-12 bg-gradient-to-br from-orange-600 via-slate-800 to-green-700 rounded-full shadow-lg flex items-center justify-center border border-orange-500/30 hover:scale-110 transition-transform"
          title="Dalal Street Insider"
        >
          <span className="text-xl">🇮🇳</span>
        </button>
        <button
          onClick={() => openExpert('US')}
          className="w-14 h-14 bg-gradient-to-br from-blue-700 via-indigo-900 to-cyan-800 rounded-2xl shadow-lg flex items-center justify-center border border-cyan-500/30 hover:scale-110 transition-transform relative"
          title="Wall Street Insider"
        >
          <span className="text-2xl">🦅</span>
          <span className="absolute -top-1 -right-1 w-3 h-3 bg-cyan-400 rounded-full animate-pulse" />
        </button>
      </div>

      {/* Header */}
      <header className="sticky top-0 z-40 bg-slate-950/90 backdrop-blur-xl border-b border-cyan-500/20">
        {/* Ticker */}
        <div className="bg-gradient-to-r from-slate-950 via-cyan-950/20 to-slate-950 py-2 overflow-hidden border-b border-cyan-500/10">
          <div className="flex gap-10 whitespace-nowrap text-sm font-mono animate-pulse">
            <span className="text-cyan-600 font-bold uppercase tracking-widest">
              ⚡ QUANTUM NEURAL ENGINE ACTIVE | VIX: US {usVix.toFixed(1)} | IN {inVix.toFixed(1)} | {sentiment.text}
            </span>
          </div>
        </div>
        
        <div className="container mx-auto px-4 py-3">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <div className="text-3xl">🌍</div>
              <div>
                <h1 className="text-xl font-black bg-gradient-to-r from-cyan-400 to-indigo-400 bg-clip-text text-transparent uppercase">
                  Wealth AI <span className="text-[10px] text-cyan-200 bg-cyan-900/40 border border-cyan-500/30 px-1.5 py-0.5 rounded ml-1">DEEP QUANTUM</span>
                </h1>
                <div className="flex items-center gap-2 text-xs">
                  <span className={`w-2 h-2 rounded-full animate-pulse ${liveStatus.includes('ACTIVE') ? 'bg-cyan-400' : 'bg-amber-500'}`} />
                  <span className={liveStatus.includes('ACTIVE') ? 'text-cyan-400' : 'text-amber-400'}>{liveStatus}</span>
                  <span className="text-slate-600">|</span>
                  <span className="text-slate-400 font-mono">{currentTime.toLocaleTimeString('en-US', { hour12: false })}</span>
                </div>
              </div>
            </div>

            {/* Tabs */}
            <div className="flex gap-1 bg-slate-900/80 p-1.5 rounded-2xl border border-cyan-500/10">
              {(['dashboard', 'portfolio', 'planner', 'macro'] as TabType[]).map(tab => (
                <button
                  key={tab}
                  onClick={() => setActiveTab(tab)}
                  className={`px-4 py-2 rounded-xl font-bold text-sm transition-all ${
                    activeTab === tab 
                      ? 'bg-cyan-900/50 border border-cyan-500/30 text-cyan-400' 
                      : 'text-slate-400 hover:text-white hover:bg-slate-800'
                  }`}
                >
                  {tab === 'dashboard' && '📊 Neural Hub'}
                  {tab === 'portfolio' && '💼 Portfolio'}
                  {tab === 'planner' && '🎯 Planner'}
                  {tab === 'macro' && '🌍 Risk'}
                </button>
              ))}
            </div>

            <div className="flex gap-2">
              <button onClick={() => window.location.reload()} className="p-2.5 bg-slate-900 rounded-xl hover:bg-slate-800 border border-slate-700/50 text-lg">🔄</button>
              <button onClick={logout} className="p-2.5 bg-slate-900 rounded-xl hover:bg-slate-800 border border-slate-700/50 text-lg">⚙️</button>
            </div>
          </div>
        </div>
      </header>

      <main className="container mx-auto px-4 py-6">
        {/* Dashboard Tab */}
        {activeTab === 'dashboard' && (
          <div className="space-y-6">
            {/* Macro Alert */}
            <div className={`rounded-2xl p-4 border ${avgVix > 17 ? 'bg-red-950/40 border-red-500/40' : 'bg-emerald-950/40 border-emerald-500/40'}`}>
              <div className="flex items-center gap-3">
                <span className="text-3xl">{avgVix > 17 ? '🚨' : '🚀'}</span>
                <div>
                  <div className={`font-black uppercase tracking-widest ${sentiment.color}`}>
                    QUANTUM DEEP AI: {avgVix > 17 ? 'SELLOFF WARNING' : 'WHALE BUYING'}
                  </div>
                  <div className="text-sm text-slate-400 mt-1">
                    {avgVix > 17 ? 'Market me institutional liquidation chal raha hai. Cash hold karo.' : 'Perfect breakout! Dark pools heavily buy kar rahe hain.'}
                  </div>
                </div>
              </div>
            </div>

            {/* Search */}
            <div className="flex gap-3 bg-slate-900/80 p-3 rounded-2xl border border-cyan-500/20">
              <div className="flex-1 relative">
                <input
                  type="text"
                  value={symbolInput}
                  onChange={e => setSymbolInput(e.target.value.toUpperCase())}
                  onKeyPress={e => e.key === 'Enter' && analyzeSymbol()}
                  placeholder="Initialize Deep Scan (e.g. AAPL, RELIANCE, SPY)"
                  className="w-full px-5 py-4 pl-14 bg-slate-950 rounded-xl border border-slate-800 focus:border-cyan-500 outline-none uppercase font-bold text-lg text-white placeholder-slate-600"
                />
                <span className="absolute left-5 top-4 text-xl">🔍</span>
              </div>
              <button
                onClick={analyzeSymbol}
                disabled={isAnalyzing}
                className="px-8 py-4 bg-gradient-to-r from-cyan-600 to-indigo-600 rounded-xl font-bold text-white hover:scale-[1.02] transition-all disabled:opacity-50"
              >
                {isAnalyzing ? '⏳' : 'SCAN ⚡'}
              </button>
            </div>

            {/* Stats */}
            <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
              <div className="bg-slate-900/80 rounded-2xl p-4 border border-white/5">
                <div className="text-slate-400 text-xs font-bold uppercase">Target Asset</div>
                <div className="text-2xl font-black text-cyan-400">{currentSymbol.replace('.NS', '') || '---'}</div>
                <div className="text-xs text-slate-500">{currentMarket} Exchange</div>
              </div>
              <div className="bg-slate-900/80 rounded-2xl p-4 border border-white/5">
                <div className="text-slate-400 text-xs font-bold uppercase">Live Price</div>
                <div className={`text-2xl font-black font-mono ${currentChange >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                  {currentPrice > 0 ? formatPrice(currentPrice, currentMarket === 'IN' ? '₹' : '$') : '--'}
                </div>
                <div className={`text-sm font-bold ${currentChange >= 0 ? 'text-emerald-500' : 'text-red-500'}`}>
                  {currentChange >= 0 ? '▲' : '▼'} {currentChange.toFixed(2)}%
                </div>
              </div>
              <div className="bg-slate-900/80 rounded-2xl p-4 border border-white/5">
                <div className="text-slate-400 text-xs font-bold uppercase">AI Signal</div>
                <div className={`text-xl font-black ${signalData.color}`}>{signalData.signal}</div>
                <div className="text-xs text-cyan-600">Conf: {signalData.conf}%</div>
              </div>
              <div className="bg-slate-900/80 rounded-2xl p-4 border border-white/5">
                <div className="text-slate-400 text-xs font-bold uppercase">RSI</div>
                <div className={`text-2xl font-black ${currentRsi < 35 ? 'text-emerald-400' : currentRsi > 65 ? 'text-red-400' : 'text-cyan-400'}`}>
                  {currentRsi.toFixed(1)}
                </div>
                <div className="text-xs text-slate-500">Momentum Index</div>
              </div>
              <div className="bg-slate-900/80 rounded-2xl p-4 border border-white/5">
                <div className="text-slate-400 text-xs font-bold uppercase">Portfolio Value</div>
                <div className="text-2xl font-black text-purple-400">₹{Math.round(metrics.totalValue).toLocaleString('en-IN')}</div>
                <div className={`text-sm font-bold ${metrics.totalPL >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                  {metrics.plPct >= 0 ? '+' : ''}{metrics.plPct.toFixed(1)}%
                </div>
              </div>
            </div>

            {/* Value Zones */}
            <div className="bg-slate-900/80 rounded-2xl p-6 border border-cyan-500/20">
              <h2 className="text-lg font-black text-white mb-4">🎯 Deep Value Zones (Paisa Banao)</h2>
              <div className="grid grid-cols-3 gap-4 mb-4">
                <div className="bg-emerald-950/30 border border-emerald-500/30 rounded-xl p-4">
                  <div className="text-emerald-400 text-xs font-bold uppercase mb-2">DEEP VALUE (Buy)</div>
                  <div className="text-2xl font-black text-emerald-400 font-mono">
                    {currentPrice > 0 ? formatPrice(currentPrice * 0.95, currentMarket === 'IN' ? '₹' : '$') : '--'}
                  </div>
                </div>
                <div className="bg-amber-950/30 border border-amber-500/30 rounded-xl p-4">
                  <div className="text-amber-400 text-xs font-bold uppercase mb-2">FAIR PRICE (Current)</div>
                  <div className="text-2xl font-black text-amber-400 font-mono">
                    {currentPrice > 0 ? formatPrice(currentPrice, currentMarket === 'IN' ? '₹' : '$') : '--'}
                  </div>
                </div>
                <div className="bg-red-950/30 border border-red-500/30 rounded-xl p-4">
                  <div className="text-red-400 text-xs font-bold uppercase mb-2">OVERHEATED (Sell)</div>
                  <div className="text-2xl font-black text-red-400 font-mono">
                    {currentPrice > 0 ? formatPrice(currentPrice * 1.15, currentMarket === 'IN' ? '₹' : '$') : '--'}
                  </div>
                </div>
              </div>
              <div className="bg-emerald-950/60 p-4 rounded-xl border border-emerald-500/40 flex items-center justify-between">
                <div>
                  <div className="text-xs text-emerald-400 font-bold uppercase">Quantum AI Protocol</div>
                  <div className="text-lg font-black text-white mt-1">
                    {currentRsi < 45 ? `📈 WHALE ACTION: Algorithms khareed rahe hain ${currentSymbol.replace('.NS', '')}` :
                     currentRsi > 65 ? `📉 DISTRIBUTION: Profit book karo` :
                     `📊 NEUTRAL: Fair price par trade ho raha hai`}
                  </div>
                </div>
                <button 
                  onClick={() => openAddModal()}
                  className="px-6 py-3 bg-gradient-to-r from-emerald-600 to-cyan-600 rounded-xl font-bold text-white hover:scale-[1.02] transition-all"
                >
                  📈 Nivesh Karo
                </button>
              </div>
            </div>

            {/* Chart */}
            <div className="bg-slate-900/80 rounded-2xl p-6 border border-cyan-500/20">
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-lg font-black text-white">📊 Live Chart</h2>
                <div className="flex gap-1 bg-slate-950 p-1 rounded-xl">
                  {['D', 'W', 'M'].map(int => (
                    <button
                      key={int}
                      onClick={() => setChartInterval(int)}
                      className={`px-4 py-1.5 rounded-lg text-xs font-bold transition-all ${
                        chartInterval === int ? 'bg-cyan-700 text-white' : 'text-slate-400 hover:text-white'
                      }`}
                    >
                      1{int}
                    </button>
                  ))}
                </div>
              </div>
              <div 
                ref={chartContainerRef} 
                className="h-[500px] rounded-xl bg-slate-950 border border-slate-800 overflow-hidden"
              />
            </div>

            {/* Quick Assets */}
            <div className="bg-slate-900/80 rounded-2xl p-6 border border-cyan-500/10">
              <h2 className="text-lg font-black text-white mb-4">📂 Deep Storage (Core Holdings)</h2>
              <div className="flex flex-wrap gap-3">
                {portfolio.length === 0 ? (
                  <div className="w-full text-center text-cyan-600/50 py-6 border border-dashed border-cyan-500/30 rounded-xl">
                    📂 Database khali hai.
                  </div>
                ) : (
                  [...new Set(portfolio.map(p => p.symbol))].map(sym => {
                    const p = portfolio.find(x => x.symbol === sym)!;
                    const key = `${p.market}_${sym}`;
                    const data = livePrices[key];
                    const change = data?.change || 0;
                    return (
                      <button
                        key={sym}
                        onClick={() => quickSelect(sym)}
                        className="px-4 py-3 bg-black/40 hover:bg-black/60 rounded-xl border border-cyan-500/20 hover:border-cyan-400 transition-all"
                      >
                        <div className="font-bold text-white">{sym.replace('.NS', '')}</div>
                        <div className="flex items-center gap-2 text-sm mt-1">
                          <span className="font-mono text-cyan-100">
                            {formatPrice(data?.price || p.avgPrice, p.market === 'IN' ? '₹' : '$')}
                          </span>
                          <span className={`font-bold ${change >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
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

        {/* Portfolio Tab */}
        {activeTab === 'portfolio' && (
          <div className="space-y-6">
            <div className="flex items-center justify-between">
              <h2 className="text-2xl font-black bg-gradient-to-r from-blue-400 to-cyan-400 bg-clip-text text-transparent">
                💼 Institutional Portfolio
              </h2>
              <div className="flex gap-3">
                <button
                  onClick={() => loadFromCloud().then(data => { if (data) setPortfolio(data); })}
                  className="px-4 py-2.5 bg-slate-800 hover:bg-slate-700 rounded-xl font-bold border border-slate-600"
                >
                  📥 Sync
                </button>
                <button
                  onClick={() => openAddModal()}
                  className="px-5 py-2.5 bg-gradient-to-r from-blue-600 to-cyan-600 rounded-xl font-bold text-white"
                >
                  + Add Asset
                </button>
                <button
                  onClick={pushTelegramReport}
                  className="px-4 py-2.5 bg-indigo-900/40 hover:bg-indigo-600 border border-indigo-500/50 rounded-xl font-bold text-indigo-300"
                >
                  📲 TG Alert {syncStatus}
                </button>
              </div>
            </div>

            {/* USD/INR */}
            <div className="bg-slate-900/80 rounded-xl p-3 border border-cyan-500/20 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <span className="text-xl">💱</span>
                <span className="text-sm font-bold text-slate-400">Live USD/INR:</span>
                <span className="text-base font-black text-emerald-400 font-mono">₹{usdInrRate.toFixed(3)}</span>
              </div>
              <span className="text-xs text-cyan-400 font-bold">Forex Neural Sync</span>
            </div>

            {/* Summary Cards */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <div className="bg-slate-900/80 rounded-2xl p-4 border border-white/5">
                <div className="text-slate-400 text-xs font-bold uppercase">Capital Deployed</div>
                <div className="text-2xl font-black text-white font-mono mt-1">₹{Math.round(metrics.totalInvested).toLocaleString('en-IN')}</div>
                <div className="text-xs text-slate-500 mt-1">${Math.round(metrics.totalInvested / usdInrRate).toLocaleString('en-US')} USD</div>
              </div>
              <div className="bg-slate-900/80 rounded-2xl p-4 border border-cyan-500/30 bg-cyan-950/20">
                <div className="text-cyan-400 text-xs font-bold uppercase">Current Equity</div>
                <div className="text-2xl font-black text-cyan-300 font-mono mt-1">₹{Math.round(metrics.totalValue).toLocaleString('en-IN')}</div>
                <div className="text-xs text-slate-400 mt-1">${Math.round(metrics.totalValue / usdInrRate).toLocaleString('en-US')} USD</div>
              </div>
              <div className="bg-slate-900/80 rounded-2xl p-4 border border-white/5">
                <div className="text-slate-400 text-xs font-bold uppercase">Total P&L</div>
                <div className={`text-2xl font-black font-mono mt-1 ${metrics.totalPL >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                  {metrics.totalPL >= 0 ? '+' : ''}₹{Math.round(metrics.totalPL).toLocaleString('en-IN')}
                </div>
                <div className={`text-sm font-bold mt-1 ${metrics.totalPL >= 0 ? 'text-emerald-500' : 'text-red-500'}`}>
                  {metrics.plPct >= 0 ? '+' : ''}{metrics.plPct.toFixed(2)}%
                </div>
              </div>
              <div className="bg-slate-900/80 rounded-2xl p-4 border border-white/5">
                <div className="text-slate-400 text-xs font-bold uppercase">Today's P&L</div>
                <div className={`text-2xl font-black font-mono mt-1 ${metrics.todayPL >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                  {metrics.todayPL >= 0 ? '+' : ''}₹{Math.round(metrics.todayPL).toLocaleString('en-IN')}
                </div>
                <div className="flex gap-2 mt-2">
                  <div className={`text-xs font-bold ${metrics.indPL >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                    🇮🇳 {metrics.indPL >= 0 ? '+' : ''}₹{Math.round(metrics.indPL).toLocaleString('en-IN')}
                  </div>
                  <div className={`text-xs font-bold ${metrics.usPL >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                    🦅 {metrics.usPL >= 0 ? '+' : ''}₹{Math.round(metrics.usPL).toLocaleString('en-IN')}
                  </div>
                </div>
              </div>
            </div>

            {/* Portfolio Table */}
            <div className="bg-slate-900/80 rounded-2xl border border-cyan-500/20 overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-slate-950 border-b border-cyan-500/30">
                    <tr className="text-cyan-400 text-xs uppercase">
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
                        <tr key={p.id} className="hover:bg-slate-800/50">
                          <td className="p-4">
                            <div className="font-bold text-white text-lg">{p.symbol.replace('.NS', '')}</div>
                            <div className="text-xs text-slate-500 mt-1">
                              <span className={`px-1.5 py-0.5 rounded ${p.market === 'IN' ? 'bg-orange-900/50 text-orange-400' : 'bg-blue-900/50 text-blue-400'}`}>
                                {p.market}
                              </span>
                              {p.leverage > 1 && <span className="ml-1 bg-indigo-900/50 text-indigo-400 px-1.5 py-0.5 rounded">{p.leverage}x</span>}
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
                                className="w-9 h-9 flex items-center justify-center bg-cyan-950/60 hover:bg-cyan-600 border border-cyan-500/40 rounded-xl"
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
                                className="w-9 h-9 flex items-center justify-center bg-red-950/60 hover:bg-red-600 border border-red-500/40 rounded-xl"
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

        {/* Planner Tab */}
        {activeTab === 'planner' && (
          <div className="space-y-6">
            <h2 className="text-2xl font-black bg-gradient-to-r from-teal-400 to-cyan-400 bg-clip-text text-transparent">
              🎯 Deep Quantum Wealth Planner
            </h2>

            {/* SIP Config */}
            <div className="bg-slate-900/80 rounded-2xl p-6 border border-cyan-500/20">
              <div className="text-xs text-cyan-400 font-bold uppercase mb-4">💰 Monthly SIP Configuration</div>
              <div className="grid md:grid-cols-3 gap-4 mb-6">
                <div className="border border-blue-500/30 bg-blue-950/20 p-4 rounded-xl">
                  <div className="text-xs font-bold text-blue-400 mb-2">🇮🇳 India SIP</div>
                  <div className="flex items-center gap-2 bg-slate-950 p-2 rounded-lg">
                    <span className="text-xl text-blue-500/50">₹</span>
                    <input
                      type="number"
                      value={indiaSIP}
                      onChange={e => setIndiaSIP(parseFloat(e.target.value) || 0)}
                      className="w-full bg-transparent outline-none text-xl font-bold text-white"
                    />
                  </div>
                </div>
                <div className="border border-emerald-500/30 bg-emerald-950/20 p-4 rounded-xl">
                  <div className="text-xs font-bold text-emerald-400 mb-2">🌍 US/Global SIP</div>
                  <div className="flex items-center gap-2 bg-slate-950 p-2 rounded-lg">
                    <span className="text-xl text-emerald-500/50">$</span>
                    <input
                      type="number"
                      value={usSIP}
                      onChange={e => setUsSIP(parseFloat(e.target.value) || 0)}
                      className="w-full bg-transparent outline-none text-xl font-bold text-white"
                    />
                  </div>
                </div>
                <div className="border border-purple-500/30 bg-purple-950/20 p-4 rounded-xl">
                  <div className="text-xs font-bold text-purple-400 mb-2">💵 Emergency Fund</div>
                  <div className="flex items-center gap-2 bg-slate-950 p-2 rounded-lg">
                    <span className="text-xl text-purple-500/50">₹</span>
                    <input
                      type="number"
                      value={emergencyFund}
                      onChange={e => setEmergencyFund(parseFloat(e.target.value) || 0)}
                      className="w-full bg-transparent outline-none text-xl font-bold text-white"
                    />
                  </div>
                </div>
              </div>
              <div className="grid md:grid-cols-2 gap-6">
                <div>
                  <label className="text-cyan-400 text-xs font-bold uppercase block mb-2">⏰ Investment Horizon</label>
                  <select
                    value={investYears}
                    onChange={e => setInvestYears(parseInt(e.target.value))}
                    className="w-full px-4 py-3 bg-slate-950 rounded-xl border border-cyan-500/30 text-white"
                  >
                    {[3, 5, 10, 15, 20, 25, 30].map(y => (
                      <option key={y} value={y}>{y} Years</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="text-cyan-400 text-xs font-bold uppercase block mb-2">📊 Risk Appetite</label>
                  <div className="flex gap-2">
                    {(['low', 'medium', 'high'] as RiskLevel[]).map(r => (
                      <button
                        key={r}
                        onClick={() => setRiskLevel(r)}
                        className={`flex-1 py-3 rounded-xl font-bold text-sm transition-all ${
                          riskLevel === r
                            ? 'bg-cyan-600 text-white shadow-lg'
                            : 'bg-slate-900 text-slate-400 border border-slate-700'
                        }`}
                      >
                        {r === 'low' && '🛡️ Safe (8%)'}
                        {r === 'medium' && '⚖️ Balanced (12%)'}
                        {r === 'high' && '🚀 Aggressive (18%)'}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            </div>

            {/* Monte Carlo Simulator */}
            <div className="bg-slate-900/80 rounded-2xl p-6 border border-cyan-500/20">
              <h3 className="text-lg font-black text-white mb-4">🔮 Monte Carlo Simulator</h3>
              <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
                <div className="bg-slate-950 p-4 rounded-xl text-center border border-slate-700">
                  <div className="text-xs text-slate-500 font-bold uppercase mb-1">Monthly SIP</div>
                  <div className="text-xl font-black text-white font-mono">₹{Math.round(totalSIP).toLocaleString('en-IN')}</div>
                </div>
                <div className="bg-slate-950 p-4 rounded-xl text-center border border-slate-700">
                  <div className="text-xs text-slate-500 font-bold uppercase mb-1">Total Invested</div>
                  <div className="text-xl font-black text-slate-300 font-mono">₹{Math.round(totalInvestedPlanner).toLocaleString('en-IN')}</div>
                </div>
                <div className="bg-red-950/40 p-4 rounded-xl text-center border border-red-500/30">
                  <div className="text-xs text-red-400 font-bold uppercase mb-1">🔻 Worst Case</div>
                  <div className="text-lg font-black text-red-300 font-mono">₹{Math.round(fvWorst).toLocaleString('en-IN')}</div>
                </div>
                <div className="bg-cyan-900/40 p-5 rounded-xl text-center border-2 border-cyan-400/50 transform scale-105">
                  <div className="text-xs text-cyan-300 font-bold uppercase mb-1">🎯 Expected Value</div>
                  <div className="text-2xl font-black text-cyan-400 font-mono">₹{Math.round(fvMed).toLocaleString('en-IN')}</div>
                </div>
                <div className="bg-emerald-950/40 p-4 rounded-xl text-center border border-emerald-500/30">
                  <div className="text-xs text-emerald-400 font-bold uppercase mb-1">🚀 Best Case</div>
                  <div className="text-lg font-black text-emerald-300 font-mono">₹{Math.round(fvBest).toLocaleString('en-IN')}</div>
                </div>
              </div>
              <div className="mt-4 p-4 bg-amber-950/40 rounded-xl border border-amber-500/30 flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <span className="text-3xl">💎</span>
                  <div>
                    <div className="text-xs text-amber-400 font-bold uppercase">Wealth Multiplier</div>
                    <div className="text-xs text-amber-200/60">Aapka paisa kitna guna badhega</div>
                  </div>
                </div>
                <div className="text-4xl font-black text-amber-400 font-mono">{multiplier.toFixed(1)}x</div>
              </div>
            </div>

            {/* FIRE Calculator */}
            <div className="bg-gradient-to-br from-orange-950/30 to-slate-900 rounded-2xl p-6 border border-orange-500/30">
              <h3 className="text-lg font-black text-white mb-4">🔥 FIRE Neural Calculator</h3>
              <div className="grid md:grid-cols-2 gap-4 mb-4">
                <div className="bg-black/40 p-4 rounded-xl">
                  <label className="text-slate-400 text-xs font-bold uppercase block mb-2">Monthly Expenses (Retirement)</label>
                  <div className="flex items-center gap-2 bg-slate-900 p-2 rounded-lg">
                    <span className="text-xl text-slate-500">₹</span>
                    <input
                      type="number"
                      value={monthlyExpenses}
                      onChange={e => setMonthlyExpenses(parseFloat(e.target.value) || 0)}
                      className="w-full bg-transparent outline-none text-xl font-bold text-white"
                    />
                  </div>
                </div>
                <div className="bg-black/40 p-4 rounded-xl">
                  <label className="text-slate-400 text-xs font-bold uppercase block mb-2">Current Age</label>
                  <div className="flex items-center gap-2 bg-slate-900 p-2 rounded-lg">
                    <span className="text-xl">🎂</span>
                    <input
                      type="number"
                      value={currentAge}
                      onChange={e => setCurrentAge(parseInt(e.target.value) || 0)}
                      className="w-full bg-transparent outline-none text-xl font-bold text-white"
                    />
                  </div>
                </div>
              </div>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                <div className="bg-orange-950/60 p-4 rounded-xl text-center border border-orange-500/30">
                  <div className="text-xs text-orange-400 font-bold uppercase mb-1">FIRE Number</div>
                  <div className="text-xl font-black text-orange-400 font-mono">₹{Math.round(fireNumber).toLocaleString('en-IN')}</div>
                </div>
                <div className="bg-emerald-950/60 p-4 rounded-xl text-center border border-emerald-500/30">
                  <div className="text-xs text-emerald-400 font-bold uppercase mb-1">Years to FIRE</div>
                  <div className="text-xl font-black text-emerald-400">{yearsToFire} yrs</div>
                </div>
                <div className="bg-cyan-950/60 p-4 rounded-xl text-center border border-cyan-500/30">
                  <div className="text-xs text-cyan-400 font-bold uppercase mb-1">Retirement Age</div>
                  <div className="text-xl font-black text-cyan-400">{currentAge + yearsToFire} yrs</div>
                </div>
                <div className="bg-purple-950/60 p-4 rounded-xl text-center border border-purple-500/30">
                  <div className="text-xs text-purple-400 font-bold uppercase mb-1">Monthly Passive</div>
                  <div className="text-xl font-black text-purple-400 font-mono">₹{Math.round(fireNumber * 0.04 / 12).toLocaleString('en-IN')}</div>
                </div>
              </div>
              <div className="mt-4">
                <div className="flex justify-between items-center mb-2">
                  <span className="text-xs text-orange-300 font-bold uppercase">Progress to FIRE</span>
                  <span className="text-sm font-black text-orange-400">{fireProgress.toFixed(1)}%</span>
                </div>
                <div className="w-full bg-black/60 rounded-full h-3 overflow-hidden border border-orange-500/20">
                  <div
                    className="bg-gradient-to-r from-orange-600 via-amber-400 to-emerald-400 h-full rounded-full transition-all duration-500"
                    style={{ width: `${Math.min(100, fireProgress)}%` }}
                  />
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Macro Tab */}
        {activeTab === 'macro' && (
          <div className="space-y-6">
            <h2 className="text-2xl font-black bg-gradient-to-r from-red-400 to-orange-400 bg-clip-text text-transparent">
              🌍 Global Risk Radar
            </h2>

            <div className="bg-slate-900/80 rounded-2xl p-6 border border-cyan-500/30">
              <h3 className="text-lg font-bold text-cyan-400 uppercase mb-4">⚙️ Portfolio Risk Diagnostics</h3>
              <div className="grid md:grid-cols-2 gap-4">
                <div className="bg-black/60 p-5 rounded-xl border border-cyan-500/20">
                  <div className="text-xs text-cyan-500/80 font-bold uppercase mb-2">🌍 Global VIX State</div>
                  <div className={`text-2xl font-black ${avgVix > 22 ? 'text-red-400' : avgVix > 16 ? 'text-amber-400' : 'text-emerald-400'}`}>
                    {avgVix > 22 ? 'BEARISH' : avgVix > 16 ? 'VOLATILE' : 'BULLISH'}
                  </div>
                  <div className="text-xs text-slate-400 mt-2">
                    US VIX: <strong className="text-white">{usVix.toFixed(1)}</strong> | IN VIX: <strong className="text-white">{inVix.toFixed(1)}</strong>
                  </div>
                </div>
                <div className="bg-black/60 p-5 rounded-xl border border-cyan-500/20">
                  <div className="text-xs text-cyan-500/80 font-bold uppercase mb-2">📊 Risk Assessment</div>
                  <div className={`text-lg font-bold ${sentiment.color}`}>{sentiment.text}</div>
                </div>
              </div>
            </div>

            <div className="bg-slate-900/80 rounded-2xl p-6 border border-teal-500/40">
              <h3 className="text-lg font-bold text-teal-400 uppercase mb-4">🤖 Asset Analysis</h3>
              <div className="grid md:grid-cols-2 gap-4">
                {portfolio.map(p => {
                  const key = `${p.market}_${p.symbol}`;
                  const data = livePrices[key];
                  const rsi = data?.rsi || 50;
                  const cgr = getAssetCagrProxy(p.symbol, p.market);
                  
                  let tag = '🔵 FAIR VALUE', color = 'blue';
                  if (cgr <= 10) { tag = '🔴 ROTATE'; color = 'red'; }
                  else if (rsi < 45) { tag = '🟢 VALUE'; color = 'emerald'; }
                  else if (rsi > 70) { tag = '🟠 HOT'; color = 'amber'; }
                  
                  return (
                    <div key={p.id} className={`bg-black/40 p-4 rounded-xl border border-${color}-500/30`}>
                      <div className="flex justify-between items-start mb-2">
                        <div className="text-lg font-black text-white">{p.symbol.replace('.NS', '')}</div>
                        <span className={`bg-${color}-950/80 text-${color}-400 px-2 py-1 rounded text-xs font-bold`}>{tag}</span>
                      </div>
                      <div className="text-xs text-slate-500">
                        RSI: <span className="text-slate-300">{rsi.toFixed(1)}</span> | CAGR: <span className="text-slate-300">{cgr}%</span>
                      </div>
                    </div>
                  );
                })}
                {portfolio.length === 0 && (
                  <div className="col-span-2 text-center text-cyan-600/50 py-6 border border-dashed border-cyan-500/30 rounded-xl">
                    Add assets to see analysis
                  </div>
                )}
              </div>
            </div>
          </div>
        )}
      </main>

      {/* Add Modal */}
      {showAddModal && (
        <div className="fixed inset-0 bg-slate-950/90 backdrop-blur-xl z-50 flex items-center justify-center p-4">
          <div className="bg-slate-900 rounded-2xl w-full max-w-md border border-cyan-500/40 shadow-2xl">
            <div className="bg-gradient-to-r from-slate-950 to-cyan-950/80 p-5 border-b border-cyan-500/20 flex justify-between items-center rounded-t-2xl">
              <h3 className="text-xl font-black text-white">
                {transactionType === 'sell' ? '📉 Liquidate' : '➕ Add Asset'}
              </h3>
              <button
                onClick={() => setShowAddModal(false)}
                className="w-10 h-10 bg-black/50 rounded-full flex items-center justify-center hover:bg-red-600 text-2xl"
              >
                ×
              </button>
            </div>
            <div className="p-5 space-y-4">
              <div>
                <label className="text-cyan-400 text-xs font-bold uppercase mb-1 block">Symbol</label>
                <div className="flex gap-3">
                  <input
                    type="text"
                    value={addSymbol}
                    onChange={e => setAddSymbol(e.target.value.toUpperCase())}
                    placeholder="e.g. AAPL, RELIANCE"
                    className="flex-1 px-4 py-3 bg-black/40 rounded-xl border border-cyan-500/20 outline-none uppercase font-bold text-white"
                  />
                  <button
                    onClick={() => fetchModalPriceData(addSymbol)}
                    className="px-5 py-3 bg-cyan-900/40 border border-cyan-500/40 rounded-xl font-bold text-cyan-300"
                  >
                    🔍
                  </button>
                </div>
              </div>
              
              {modalPrice && (
                <div className="bg-black/40 rounded-xl p-4 border border-cyan-500/10 flex justify-between items-center">
                  <span className="text-slate-400 text-xs uppercase font-bold">Live Price</span>
                  <div className="text-right">
                    <span className={`text-2xl font-black font-mono ${modalPrice.change >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                      {modalPrice.market === 'IN' ? '₹' : '$'}{modalPrice.price.toFixed(2)}
                    </span>
                    <div className={`text-xs ${modalPrice.change >= 0 ? 'text-emerald-500' : 'text-red-500'}`}>
                      {modalPrice.change >= 0 ? '+' : ''}{modalPrice.change.toFixed(2)}%
                    </div>
                  </div>
                </div>
              )}

              <div className="flex gap-1 bg-black/50 rounded-xl p-1.5">
                <button
                  onClick={() => setTransactionType('buy')}
                  className={`flex-1 py-2.5 rounded-lg font-bold text-sm ${
                    transactionType === 'buy' ? 'bg-emerald-600 text-white' : 'text-slate-500'
                  }`}
                >
                  📈 BUY
                </button>
                <button
                  onClick={() => setTransactionType('sell')}
                  className={`flex-1 py-2.5 rounded-lg font-bold text-sm ${
                    transactionType === 'sell' ? 'bg-red-600 text-white' : 'text-slate-500'
                  }`}
                >
                  📉 SELL
                </button>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="text-cyan-400 text-xs font-bold uppercase mb-1 block">Quantity</label>
                  <input
                    type="number"
                    value={addQty}
                    onChange={e => setAddQty(e.target.value)}
                    placeholder="0"
                    className="w-full px-4 py-3 bg-black/40 rounded-xl border border-cyan-500/30 outline-none font-bold text-xl text-white"
                  />
                </div>
                <div>
                  <label className="text-cyan-400 text-xs font-bold uppercase mb-1 block">Price</label>
                  <input
                    type="number"
                    value={addPrice}
                    onChange={e => setAddPrice(e.target.value)}
                    placeholder="0.00"
                    className="w-full px-4 py-3 bg-black/40 rounded-xl border border-cyan-500/30 outline-none font-bold text-xl text-white"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="text-slate-400 text-xs font-bold uppercase mb-1 block">Date</label>
                  <input
                    type="date"
                    value={addDate}
                    onChange={e => setAddDate(e.target.value)}
                    className="w-full px-4 py-3 bg-black/40 rounded-xl border border-slate-700 outline-none text-slate-300"
                  />
                </div>
                <div>
                  <label className="text-slate-400 text-xs font-bold uppercase mb-1 block">Leverage</label>
                  <select
                    value={addLeverage}
                    onChange={e => setAddLeverage(e.target.value)}
                    className="w-full px-4 py-3 bg-black/40 rounded-xl border border-slate-700 outline-none text-slate-300"
                  >
                    <option value="1">1x (Cash)</option>
                    <option value="2">2x MTF</option>
                    <option value="3">3x</option>
                    <option value="5">5x</option>
                  </select>
                </div>
              </div>
            </div>
            <div className="p-5 border-t border-cyan-500/30 bg-black/90 rounded-b-2xl">
              <button
                onClick={savePosition}
                className="w-full py-4 bg-gradient-to-r from-cyan-600 to-indigo-600 rounded-xl font-bold text-lg text-white hover:scale-[1.02] transition-all"
              >
                💾 Save to Database
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Expert Modal */}
      {showExpertModal && expertInfo && (
        <div className="fixed inset-0 bg-slate-950/90 backdrop-blur-xl z-50 flex items-end sm:items-center justify-center p-4">
          <div className="bg-slate-900 rounded-t-3xl sm:rounded-2xl w-full max-w-lg border border-cyan-500/30 shadow-2xl max-h-[90vh] flex flex-col">
            <div className={`bg-gradient-to-r ${expertInfo.colorBg} p-5 border-b border-white/5 rounded-t-3xl sm:rounded-t-2xl flex items-center justify-between`}>
              <div className="flex items-center gap-4">
                <div className="w-12 h-12 bg-black/60 rounded-xl flex items-center justify-center text-2xl border border-cyan-500/30">
                  {expertInfo.icon}
                </div>
                <div>
                  <h3 className="font-black text-xl text-white">{expertInfo.name}</h3>
                  <p className="text-cyan-400 text-xs font-bold uppercase">{expertInfo.role}</p>
                </div>
              </div>
              <button
                onClick={() => setShowExpertModal(false)}
                className="w-8 h-8 bg-black/40 rounded-full flex items-center justify-center hover:bg-red-500 text-lg"
              >
                ×
              </button>
            </div>
            
            <div className="flex-1 overflow-y-auto p-5 space-y-4 min-h-[300px] max-h-[400px]">
              {expertMessages.map((msg, i) => (
                <div key={i} className={`flex gap-3 ${msg.sender === 'user' ? 'flex-row-reverse' : ''}`}>
                  <div className={`w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 ${
                    msg.sender === 'user' ? 'bg-cyan-800' : `bg-gradient-to-br ${expertInfo.colorBg}`
                  }`}>
                    {msg.sender === 'user' ? '👤' : expertInfo.icon}
                  </div>
                  <div className={`rounded-2xl p-4 max-w-[85%] ${
                    msg.sender === 'user' 
                      ? 'bg-cyan-900/40 border border-cyan-500/50' 
                      : 'bg-black/60 border border-white/10'
                  }`}>
                    <div className="text-sm whitespace-pre-line">{msg.text}</div>
                  </div>
                </div>
              ))}
            </div>

            <div className="p-4 bg-black/80 rounded-b-2xl border-t border-cyan-500/30">
              <div className="flex gap-3">
                <input
                  type="text"
                  value={expertInput}
                  onChange={e => setExpertInput(e.target.value)}
                  onKeyPress={e => e.key === 'Enter' && sendToExpert()}
                  placeholder="Ask about market, stocks, risk..."
                  className="flex-1 px-5 py-3 bg-slate-900/50 rounded-xl border border-cyan-500/20 outline-none text-sm text-cyan-100"
                />
                <button
                  onClick={sendToExpert}
                  className="px-6 py-3 bg-cyan-600/20 hover:bg-cyan-600/40 border border-cyan-500/50 rounded-xl font-bold text-cyan-400"
                >
                  SEND ⚡
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
