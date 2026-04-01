import { useState, useEffect, useCallback, useRef } from 'react';
import { Position, PriceData, TabType, RiskLevel, ExpertInfo, TransactionType } from './types';
import { 
  SECURE_PIN, TG_TOKEN, TG_CHAT_ID, EXACT_TICKER_MAP,
  getTodayString, guessMarket, getAssetCagrProxy, formatPrice
} from './utils/constants';
import { 
  fetchSinglePrice, batchFetchPrices, fetchForexRate, 
  syncToCloud, loadFromCloud, sendTelegramAlert 
} from './utils/api';

// Tailwind Dynamic Class Fix Matrix
const MACRO_COLORS: Record<string, { bg: string; border: string; text: string; tagBg: string }> = {
  blue: { bg: 'bg-blue-950/20', border: 'border-blue-500/30', text: 'text-blue-400', tagBg: 'bg-blue-900/50' },
  red: { bg: 'bg-red-950/20', border: 'border-red-500/30', text: 'text-red-400', tagBg: 'bg-red-900/50' },
  emerald: { bg: 'bg-emerald-950/20', border: 'border-emerald-500/30', text: 'text-emerald-400', tagBg: 'bg-emerald-900/50' },
  amber: { bg: 'bg-amber-950/20', border: 'border-amber-500/30', text: 'text-amber-400', tagBg: 'bg-amber-900/50' }
};

export default function App() {
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [pinInput, setPinInput] = useState('');
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

  // Modals
  const [showAddModal, setShowAddModal] = useState(false);
  const [showExpertModal, setShowExpertModal] = useState(false);
  const [expertInfo, setExpertInfo] = useState<ExpertInfo | null>(null);
  const [expertMessages, setExpertMessages] = useState<Array<{text: string; sender: 'user' | 'expert'}>>([]);
  const [expertInput, setExpertInput] = useState('');
  
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
  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const auth = localStorage.getItem('authDone');
    if (auth === 'true') setIsAuthenticated(true);
  }, []);

  useEffect(() => {
    const interval = setInterval(() => setCurrentTime(new Date()), 1000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    if (!isAuthenticated) return;
    setLiveStatus('● CLOUD SYNCING...');
    loadFromCloud().then(data => {
      if (data && data.length > 0) {
        setPortfolio(data);
        localStorage.setItem('portfolio', JSON.stringify(data));
      } else {
        const saved = localStorage.getItem('portfolio');
        if (saved) setPortfolio(JSON.parse(saved));
      }
    });

    const savedPrices = localStorage.getItem('livePrices');
    if (savedPrices) setLivePrices(JSON.parse(savedPrices));
    fetchForexRate().then(rate => setUsdInrRate(rate));
  }, [isAuthenticated]);

  useEffect(() => {
    if (!isAuthenticated || portfolio.length === 0) return;
    const sync = async () => {
      await batchFetchPrices(portfolio, (key, data) => {
        setLivePrices(prev => {
          const updated = { ...prev, [key]: data };
          localStorage.setItem('livePrices', JSON.stringify(updated));
          return updated;
        });
      });
      setLiveStatus('● NEURAL LINK ACTIVE');
    };
    sync();
    syncIntervalRef.current = window.setInterval(sync, 5000);
    return () => { if (syncIntervalRef.current) clearInterval(syncIntervalRef.current); };
  }, [isAuthenticated, portfolio.length]);

  useEffect(() => {
    if (!isAuthenticated || !chartContainerRef.current) return;
    loadTradingViewChart();
  }, [currentSymbol, chartInterval, isAuthenticated]);

  // Scroll to bottom of chat
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [expertMessages]);

  const verifyPin = () => {
    if (pinInput === SECURE_PIN) {
      localStorage.setItem('authDone', 'true');
      setIsAuthenticated(true);
    } else {
      setPinInput('');
    }
  };

  const logout = () => {
    localStorage.removeItem('authDone');
    setIsAuthenticated(false);
    setPinInput('');
  };

  // Fixed Analysis Logic (Stale Closure Fix)
  const executeAnalysis = async (targetSymbol: string) => {
    if (isAnalyzing || !targetSymbol.trim()) return;
    setIsAnalyzing(true);
    setSymbolInput(targetSymbol); // Update input field visually
    
    try {
      const result = await fetchSinglePrice(targetSymbol.toUpperCase());
      if (result && result.price > 0) {
        setCurrentSymbol(targetSymbol.toUpperCase());
        setCurrentMarket(result.market as 'IN' | 'US');
        const key = `${result.market}_${targetSymbol.toUpperCase()}`;
        setLivePrices(prev => ({ ...prev, [key]: result }));
      }
    } catch (e) {} 
    finally { setIsAnalyzing(false); }
  };

  const quickSelect = (sym: string) => {
    const cleanSym = sym.replace('.NS', '');
    executeAnalysis(cleanSym);
  };

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

  // Fix Stale State Cloud Sync Bug
  const savePosition = () => {
    const qty = parseFloat(addQty);
    const price = parseFloat(addPrice);
    const leverage = parseFloat(addLeverage) || 1;
    
    if (!addSymbol || isNaN(qty) || isNaN(price) || qty <= 0 || price <= 0) return;

    const mkt = modalPrice?.market || guessMarket(addSymbol);
    let newPortfolio = [...portfolio];

    if (transactionType === 'sell') {
      const idx = newPortfolio.findIndex(p => p.symbol === addSymbol && p.market === mkt);
      if (idx >= 0) {
        newPortfolio[idx] = { ...newPortfolio[idx], qty: newPortfolio[idx].qty - qty };
        if (newPortfolio[idx].qty <= 0) newPortfolio = newPortfolio.filter((_, i) => i !== idx);
      }
    } else {
      if (editId) {
        newPortfolio = newPortfolio.map(p => 
          p.id === editId ? { ...p, symbol: addSymbol, qty, avgPrice: price, leverage, dateAdded: addDate, market: mkt as 'IN' | 'US' } : p
        );
      } else {
        const existingIdx = newPortfolio.findIndex(p => p.symbol === addSymbol && p.market === mkt);
        if (existingIdx >= 0) {
          const ex = newPortfolio[existingIdx];
          const totalQty = ex.qty + qty;
          const newAvgPrice = ((ex.qty * ex.avgPrice) + (qty * price)) / totalQty;
          newPortfolio[existingIdx] = { ...ex, qty: totalQty, avgPrice: newAvgPrice, leverage: Math.max(ex.leverage, leverage) };
        } else {
          newPortfolio.push({
            id: Date.now().toString(),
            symbol: addSymbol,
            market: mkt as 'IN' | 'US',
            qty,
            avgPrice: price,
            leverage,
            dateAdded: addDate
          });
        }
      }
    }

    setPortfolio(newPortfolio);
    setShowAddModal(false);
    // Explicitly pass the NEW portfolio variable to avoid stale state closure bug
    syncToCloud(newPortfolio, usdInrRate);
  };

  const openExpert = (type: 'IN' | 'US') => {
    const info: ExpertInfo = type === 'US' ? {
      id: 'US', icon: '🦅', name: 'Wall Street Quantum Insider', role: 'Global Macro & Dark Pool Matrix', colorBg: 'from-blue-900 to-cyan-900', border: 'border-cyan-500/50'
    } : {
      id: 'IN', icon: '🇮🇳', name: 'Dalal Street Neural Core', role: 'NSE FII/DII Algorithmic Tracker', colorBg: 'from-orange-900 to-emerald-900', border: 'border-orange-500/50'
    };
    setExpertInfo(info);
    setExpertMessages([{
      text: type === 'US' ? 'System Online. I am the US Macro Insider.\nTracking FED liquidity, Dark Pool block trades, and S&P 500 whale movements.' : 'System Online. I am the Dalal Street Neural Core.\nMonitoring RBI sweeps, DII SIP deployments, and FII footprints.',
      sender: 'expert'
    }]);
    setShowExpertModal(true);
  };

  const sendToExpert = async () => {
    if (!expertInput.trim()) return;
    const msg = expertInput;
    setExpertInput('');
    setExpertMessages(prev => [...prev, { text: msg, sender: 'user' }]);
    setTimeout(() => {
      setExpertMessages(prev => [...prev, { text: 'Analyzing neural network parameters...', sender: 'expert' }]);
    }, 1000);
  };

  const loadTradingViewChart = useCallback(() => {
    if (!chartContainerRef.current) return;
    const cleanSym = currentSymbol.replace('.NS', '').replace('.BO', '');
    const isIndian = currentMarket === 'IN' || currentSymbol.includes('.NS') || currentSymbol.includes('BEES');
    
    let tvSymbol = '';
    if (EXACT_TICKER_MAP[cleanSym]) tvSymbol = EXACT_TICKER_MAP[cleanSym];
    else if (isIndian) tvSymbol = `NSE:${cleanSym}`;
    else tvSymbol = `NASDAQ:${cleanSym}`;
    
    chartContainerRef.current.innerHTML = '';
    const container = document.createElement('div');
    container.className = 'tradingview-widget-container h-full w-full rounded-xl overflow-hidden';
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
      backgroundColor: "rgba(15, 23, 42, 0.4)",
      gridColor: "rgba(255, 255, 255, 0.05)",
      enable_publishing: false,
      allow_symbol_change: true,
      studies: ['STD;RSI', 'STD;MACD']
    });
    container.appendChild(script);
  }, [currentSymbol, currentMarket, chartInterval]);

  const calculateMetrics = useCallback(() => {
    let totalInvested = 0, totalValue = 0, todayPL = 0;
    let indPL = 0, usPL = 0;
    portfolio.forEach(p => {
      const key = `${p.market}_${p.symbol}`;
      const data = livePrices[key];
      const curPrice = data?.price || p.avgPrice;
      const change = data?.change || 0;
      
      const posSize = p.avgPrice * p.qty;
      const inv = posSize / (p.leverage || 1);
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
  const avgVix = ((livePrices['US_VIX']?.price || 15) + (livePrices['IN_INDIAVIX']?.price || 15)) / 2;
  const sentiment = avgVix > 22 ? { text: '🔴 Global Risk Severe', color: 'text-red-400' } : avgVix > 17 ? { text: '🟠 Elevated Volatility', color: 'text-amber-400' } : avgVix > 14 ? { text: '🟡 Normal Range', color: 'text-yellow-400' } : { text: '🟢 Ultra Low Risk', color: 'text-emerald-400' };

  const currentKey = `${currentMarket}_${currentSymbol}`;
  const currentData = livePrices[currentKey];
  const currentPrice = currentData?.price || 0;
  const currentChange = currentData?.change || 0;
  const currentRsi = currentData?.rsi || 50;
  const signalData = currentRsi < 35 ? { signal: '🟢 MAX BUY', color: 'text-emerald-400', conf: 98 } : currentRsi < 45 ? { signal: '🟢 ACCUMULATE', color: 'text-emerald-400', conf: 85 } : currentRsi < 60 ? { signal: '🟡 MAINTAIN', color: 'text-amber-400', conf: 75 } : { signal: '🔴 DISTRIBUTE', color: 'text-red-400', conf: 90 };

  const pushTelegramReport = async () => {
    setSyncStatus('Pushing...');
    const msg = `🧠 *Wealth AI Report*\n\n🌍 *State:* ${sentiment.text}\n💼 *Total Equity:* ₹${Math.round(metrics.totalValue).toLocaleString('en-IN')}\n📈 *P&L:* ${metrics.totalPL >= 0 ? '+' : ''}₹${Math.round(metrics.totalPL).toLocaleString('en-IN')} (${metrics.plPct.toFixed(2)}%)\n⚡ *Today:* ${metrics.todayPL >= 0 ? '+' : ''}₹${Math.round(metrics.todayPL).toLocaleString('en-IN')}`;
    await sendTelegramAlert(TG_TOKEN, TG_CHAT_ID, msg);
    setSyncStatus('✅ Sent');
    setTimeout(() => setSyncStatus(''), 3000);
  };

  if (!isAuthenticated) {
    return (
      <div className="min-h-screen bg-slate-950 flex items-center justify-center p-4 relative overflow-hidden">
        {/* Floating Particles BG */}
        <div className="absolute top-1/4 left-1/4 w-96 h-96 bg-cyan-500/20 rounded-full blur-[100px] animate-float"></div>
        <div className="absolute bottom-1/4 right-1/4 w-96 h-96 bg-indigo-500/20 rounded-full blur-[100px] animate-float" style={{animationDelay: '2s'}}></div>
        
        <div className="glass-ultra rounded-3xl p-10 max-w-sm w-full animate-scale-in z-10 relative">
          <div className="text-center mb-8">
            <div className="w-20 h-20 mx-auto bg-gradient-to-br from-cyan-400 to-indigo-600 rounded-2xl flex items-center justify-center shadow-lg shadow-cyan-500/30 mb-6 animate-float">
               <span className="text-4xl text-white">💎</span>
            </div>
            <h1 className="text-3xl font-black text-white tracking-tight mb-2">Wealth<span className="text-transparent bg-clip-text bg-gradient-to-r from-cyan-400 to-indigo-400">AI</span></h1>
            <p className="text-cyan-400/80 text-xs uppercase tracking-widest font-bold">Terminal Initialization</p>
          </div>
          <input
            type="password"
            value={pinInput}
            onChange={e => setPinInput(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && verifyPin()}
            placeholder="••••"
            maxLength={4}
            className="w-full text-center px-4 py-4 glass-input rounded-xl text-3xl tracking-[0.5em] text-cyan-400 font-mono mb-6"
          />
          <button onClick={verifyPin} className="w-full py-4 btn-primary rounded-xl font-bold text-white tracking-widest">
            DECRYPT
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-950 text-slate-200 selection:bg-cyan-500/30">
      
      {/* Floating Experts */}
      <div className="fixed bottom-6 right-6 flex flex-col gap-4 z-50">
        <button onClick={() => openExpert('IN')} className="w-12 h-12 bg-slate-900/80 backdrop-blur border border-orange-500/30 rounded-full shadow-lg flex items-center justify-center hover:scale-110 transition-transform animate-fade-in-up stagger-1">
          <span className="text-xl">🇮🇳</span>
        </button>
        <button onClick={() => openExpert('US')} className="w-14 h-14 bg-slate-900/80 backdrop-blur border border-cyan-500/30 rounded-2xl shadow-lg flex items-center justify-center hover:scale-110 transition-transform relative animate-fade-in-up stagger-2">
          <span className="text-2xl">🦅</span>
          <span className="absolute -top-1 -right-1 w-3 h-3 bg-cyan-400 rounded-full animate-pulse shadow-[0_0_10px_#22d3ee]" />
        </button>
      </div>

      {/* Header */}
      <header className="sticky top-0 z-40 bg-slate-950/80 backdrop-blur-xl border-b border-white/5">
        <div className="bg-gradient-to-r from-cyan-900/20 via-indigo-900/20 to-transparent py-1.5 border-b border-cyan-500/10">
          <div className="ticker-wrap">
            <div className="ticker-content text-xs font-mono text-cyan-400/80 font-bold uppercase tracking-widest">
              {[...Array(3)].map((_, i) => (
                <span key={i} className="mx-10">
                  ⚡ QUANTUM AI ONLINE | VIX US {(livePrices['US_VIX']?.price||15).toFixed(1)} | IN {(livePrices['IN_INDIAVIX']?.price||15).toFixed(1)} | MACRO: {sentiment.text}
                </span>
              ))}
            </div>
          </div>
        </div>
        
        <div className="container mx-auto px-4 py-4">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-cyan-500 to-indigo-600 flex items-center justify-center shadow-lg shadow-cyan-500/20">
                <span className="text-xl text-white">💎</span>
              </div>
              <div>
                <h1 className="text-xl font-black tracking-tight text-white flex items-baseline gap-1">
                  Wealth<span className="text-gradient bg-gradient-to-r from-cyan-400 to-indigo-400">AI</span>
                </h1>
                <div className="flex items-center gap-2 text-xs">
                  <span className={`w-2 h-2 rounded-full shadow-[0_0_8px_currentColor] ${liveStatus.includes('ACTIVE') ? 'bg-cyan-400 text-cyan-400' : 'bg-amber-400 text-amber-400'}`} />
                  <span className="text-slate-400 font-mono tracking-wider">{liveStatus}</span>
                </div>
              </div>
            </div>

            <div className="flex bg-slate-900/60 p-1.5 rounded-full border border-white/5 backdrop-blur-md">
              {(['dashboard', 'portfolio', 'planner', 'macro'] as TabType[]).map(tab => (
                <button
                  key={tab}
                  onClick={() => setActiveTab(tab)}
                  className={`px-5 py-2 rounded-full font-bold text-sm transition-all duration-300 ${
                    activeTab === tab 
                      ? 'bg-cyan-500/20 text-cyan-300 shadow-[inset_0_1px_0_rgba(255,255,255,0.1)]' 
                      : 'text-slate-400 hover:text-white hover:bg-white/5'
                  }`}
                >
                  {tab.charAt(0).toUpperCase() + tab.slice(1)}
                </button>
              ))}
            </div>
            
            <button onClick={logout} className="p-2.5 bg-slate-900/80 rounded-full hover:bg-red-500/20 hover:text-red-400 transition-colors border border-white/5">
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1"></path></svg>
            </button>
          </div>
        </div>
      </header>

      <main className="container mx-auto px-4 py-8">
        
        {/* DASHBOARD */}
        {activeTab === 'dashboard' && (
          <div className="space-y-6 animate-fade-in-up">
            
            {/* Search Engine */}
            <div className="glass-card rounded-2xl p-3 flex gap-3">
              <div className="flex-1 relative">
                <input
                  type="text"
                  value={symbolInput}
                  onChange={e => setSymbolInput(e.target.value.toUpperCase())}
                  onKeyDown={e => e.key === 'Enter' && executeAnalysis(symbolInput)}
                  placeholder="Analyze Ticker (e.g. AAPL, RELIANCE)"
                  className="w-full glass-input px-5 py-4 pl-14 rounded-xl text-lg font-bold text-white placeholder-slate-500"
                />
                <span className="absolute left-5 top-4 text-xl opacity-60">🔎</span>
              </div>
              <button onClick={() => executeAnalysis(symbolInput)} className="btn-primary px-8 rounded-xl font-bold text-white uppercase tracking-wider">
                Analyze
              </button>
            </div>

            {/* AI Stats Cards */}
            <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
              <div className="glass-card rounded-2xl p-5 hover:-translate-y-1 transition-transform stagger-1">
                <div className="text-[10px] text-slate-400 font-bold uppercase tracking-widest mb-1">Target Asset</div>
                <div className="text-2xl font-black text-white truncate">{currentSymbol.replace('.NS', '') || '---'}</div>
                <div className="text-xs text-cyan-400 mt-1">{currentMarket} Neural Link</div>
              </div>
              <div className="glass-card rounded-2xl p-5 hover:-translate-y-1 transition-transform stagger-2">
                <div className="text-[10px] text-slate-400 font-bold uppercase tracking-widest mb-1">Live Price</div>
                <div className={`text-2xl font-black font-mono ${currentChange >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                  {currentPrice > 0 ? formatPrice(currentPrice, currentMarket === 'IN' ? '₹' : '$') : '--'}
                </div>
                <div className={`text-xs font-bold mt-1 ${currentChange >= 0 ? 'text-emerald-500' : 'text-red-500'}`}>
                  {currentChange >= 0 ? '▲' : '▼'} {currentChange.toFixed(2)}%
                </div>
              </div>
              <div className="glass-card rounded-2xl p-5 hover:-translate-y-1 transition-transform stagger-3">
                <div className="text-[10px] text-slate-400 font-bold uppercase tracking-widest mb-1">Momentum (RSI)</div>
                <div className={`text-2xl font-black font-mono ${currentRsi < 35 ? 'text-emerald-400' : currentRsi > 65 ? 'text-red-400' : 'text-cyan-400'}`}>
                  {currentRsi.toFixed(1)}
                </div>
                <div className="w-full bg-slate-800 rounded-full h-1.5 mt-2">
                  <div className={`h-full rounded-full ${currentRsi < 35 ? 'bg-emerald-400' : currentRsi > 65 ? 'bg-red-400' : 'bg-cyan-400'}`} style={{width: `${currentRsi}%`}}></div>
                </div>
              </div>
              <div className="glass-card rounded-2xl p-5 hover:-translate-y-1 transition-transform stagger-4 col-span-2 md:col-span-2">
                <div className="text-[10px] text-slate-400 font-bold uppercase tracking-widest mb-1">AI Recommendation</div>
                <div className={`text-xl font-black mt-1 ${signalData.color}`}>{signalData.signal}</div>
                <div className="text-sm text-slate-300 mt-2 line-clamp-2">
                  {currentRsi < 45 ? "Deep value zone identified. Smart money accumulation patterns detected." : "Trading near fair value or premium. Monitor for breakouts."}
                </div>
              </div>
            </div>

            {/* Chart Area */}
            <div className="glass-card rounded-2xl p-6">
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-lg font-bold text-white uppercase tracking-widest flex items-center gap-2">
                  <span className="w-2 h-2 rounded-full bg-cyan-400 animate-pulse"></span> Terminal Matrix
                </h2>
                <div className="flex gap-1 bg-slate-900/50 p-1 rounded-lg">
                  {['15', '60', 'D', 'W'].map(int => (
                    <button key={int} onClick={() => setChartInterval(int)} className={`px-4 py-1.5 rounded-md text-xs font-bold font-mono transition-colors ${chartInterval === int ? 'bg-cyan-500/20 text-cyan-300' : 'text-slate-500 hover:text-white'}`}>
                      {int}
                    </button>
                  ))}
                </div>
              </div>
              <div ref={chartContainerRef} className="h-[500px] rounded-xl overflow-hidden border border-white/5 bg-black/40" />
            </div>
            
            {/* Quick Assets Grid */}
            <div className="glass-card rounded-2xl p-6">
              <h2 className="text-sm font-bold text-slate-400 uppercase tracking-widest mb-4">Core Holdings Radar</h2>
              <div className="flex flex-wrap gap-3">
                {portfolio.length === 0 ? (
                  <div className="w-full text-center text-slate-600 py-8 font-mono text-sm border border-dashed border-white/10 rounded-xl">
                    No active connections in database.
                  </div>
                ) : (
                  [...new Set(portfolio.map(p => p.symbol))].map((sym, i) => {
                    const p = portfolio.find(x => x.symbol === sym)!;
                    const data = livePrices[`${p.market}_${sym}`];
                    const change = data?.change || 0;
                    return (
                      <button key={sym} onClick={() => quickSelect(sym)} className={`px-4 py-3 bg-slate-900/60 hover:bg-slate-800 rounded-xl border border-white/5 hover:border-cyan-500/40 transition-all text-left animate-scale-in`} style={{animationDelay: `${i*0.05}s`}}>
                        <div className="font-bold text-white text-sm">{sym.replace('.NS', '')}</div>
                        <div className="flex items-center gap-2 mt-1">
                          <span className="font-mono text-slate-300 text-xs">{formatPrice(data?.price || p.avgPrice, p.market === 'IN' ? '₹' : '$')}</span>
                          <span className={`text-[10px] font-bold ${change >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>{change >= 0 ? '+' : ''}{change.toFixed(2)}%</span>
                        </div>
                      </button>
                    );
                  })
                )}
              </div>
            </div>
          </div>
        )}

        {/* PORTFOLIO */}
        {activeTab === 'portfolio' && (
          <div className="space-y-6 animate-fade-in-up">
            <div className="flex items-center justify-between">
              <h2 className="text-2xl font-black text-white tracking-tight">Institutional Ledger</h2>
              <div className="flex gap-3">
                <button onClick={() => openAddModal()} className="btn-primary px-5 py-2.5 rounded-xl font-bold text-sm text-white shadow-lg shadow-cyan-500/20">
                  + Execute Trade
                </button>
                <button onClick={pushTelegramReport} className="glass-card px-4 py-2.5 rounded-xl font-bold text-sm text-cyan-400 hover:text-white hover:bg-cyan-500/20">
                  📲 {syncStatus || 'Push Report'}
                </button>
              </div>
            </div>

            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
               <div className="glass-card rounded-2xl p-5 border-l-2 border-l-slate-500">
                  <div className="text-[10px] text-slate-400 font-bold uppercase tracking-widest mb-1">Deployed Capital</div>
                  <div className="text-2xl font-black text-white font-mono">₹{Math.round(metrics.totalInvested).toLocaleString('en-IN')}</div>
               </div>
               <div className="glass-card rounded-2xl p-5 border-l-2 border-l-cyan-500 bg-cyan-950/10">
                  <div className="text-[10px] text-cyan-400 font-bold uppercase tracking-widest mb-1">Current Equity</div>
                  <div className="text-2xl font-black text-cyan-300 font-mono">₹{Math.round(metrics.totalValue).toLocaleString('en-IN')}</div>
               </div>
               <div className={`glass-card rounded-2xl p-5 border-l-2 ${metrics.totalPL >= 0 ? 'border-l-emerald-500' : 'border-l-red-500'}`}>
                  <div className="text-[10px] text-slate-400 font-bold uppercase tracking-widest mb-1">Total P&L</div>
                  <div className={`text-2xl font-black font-mono ${metrics.totalPL >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                    {metrics.totalPL >= 0 ? '+' : ''}₹{Math.round(metrics.totalPL).toLocaleString('en-IN')}
                  </div>
               </div>
               <div className={`glass-card rounded-2xl p-5 border-l-2 ${metrics.todayPL >= 0 ? 'border-l-emerald-500' : 'border-l-red-500'}`}>
                  <div className="text-[10px] text-slate-400 font-bold uppercase tracking-widest mb-1">Today's Delta</div>
                  <div className={`text-2xl font-black font-mono ${metrics.todayPL >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                    {metrics.todayPL >= 0 ? '+' : ''}₹{Math.round(metrics.todayPL).toLocaleString('en-IN')}
                  </div>
               </div>
            </div>

            <div className="glass-card rounded-2xl overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-sm text-left whitespace-nowrap">
                  <thead className="bg-slate-900/80 text-[10px] uppercase tracking-widest text-slate-500 border-b border-white/5">
                    <tr>
                      <th className="p-5 font-bold">Asset</th>
                      <th className="p-5 font-bold">Position</th>
                      <th className="p-5 font-bold">Average</th>
                      <th className="p-5 font-bold">LTP</th>
                      <th className="p-5 font-bold">Value</th>
                      <th className="p-5 font-bold">P&L</th>
                      <th className="p-5 font-bold text-right">Execute</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-white/5">
                    {portfolio.length === 0 ? (
                      <tr><td colSpan={7} className="p-10 text-center text-slate-600 font-mono">No active positions.</td></tr>
                    ) : portfolio.map(p => {
                      const data = livePrices[`${p.market}_${p.symbol}`];
                      const ltp = data?.price || p.avgPrice;
                      const pl = (ltp - p.avgPrice) * p.qty;
                      const plPct = ((ltp - p.avgPrice) / p.avgPrice) * 100;
                      const val = ltp * p.qty;
                      const c = p.market === 'IN' ? '₹' : '$';
                      return (
                        <tr key={p.id} className="hover:bg-white/[0.02] transition-colors">
                          <td className="p-5">
                            <div className="font-bold text-white text-base">{p.symbol.replace('.NS', '')}</div>
                            <div className="text-[10px] text-slate-500 mt-0.5 uppercase tracking-wider">{p.market} Exchange</div>
                          </td>
                          <td className="p-5 font-mono font-bold text-slate-300">{p.qty}</td>
                          <td className="p-5 font-mono text-slate-400">{c}{p.avgPrice.toFixed(2)}</td>
                          <td className="p-5 font-mono">
                            <div className="text-white font-bold">{c}{ltp.toFixed(2)}</div>
                            <div className={`text-[10px] ${data?.change >= 0 ? 'text-emerald-500' : 'text-red-500'}`}>{data?.change >= 0 ? '+' : ''}{(data?.change || 0).toFixed(2)}%</div>
                          </td>
                          <td className="p-5 font-mono font-bold text-white">{c}{val.toFixed(2)}</td>
                          <td className="p-5 font-mono">
                            <div className={pl >= 0 ? 'text-emerald-400' : 'text-red-400'}>{pl >= 0 ? '+' : ''}{c}{pl.toFixed(2)}</div>
                            <div className={`text-[10px] ${pl >= 0 ? 'text-emerald-500' : 'text-red-500'}`}>({plPct >= 0 ? '+' : ''}{plPct.toFixed(2)}%)</div>
                          </td>
                          <td className="p-5 text-right flex gap-2 justify-end">
                            <button onClick={() => { setAddSymbol(p.symbol); setTransactionType('buy'); setShowAddModal(true); fetchModalPriceData(p.symbol); }} className="w-8 h-8 rounded-lg bg-emerald-500/10 text-emerald-400 hover:bg-emerald-500 hover:text-white transition-colors text-xs font-bold">+</button>
                            <button onClick={() => { setAddSymbol(p.symbol); setAddQty(p.qty.toString()); setTransactionType('sell'); setShowAddModal(true); fetchModalPriceData(p.symbol); }} className="w-8 h-8 rounded-lg bg-red-500/10 text-red-400 hover:bg-red-500 hover:text-white transition-colors text-xs font-bold">-</button>
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}

        {/* PLANNER */}
        {activeTab === 'planner' && (
          <div className="space-y-6 animate-fade-in-up">
            <h2 className="text-2xl font-black text-white tracking-tight">Deep Wealth Algorithms</h2>
            
            <div className="glass-card rounded-2xl p-6">
               <h3 className="text-xs font-bold text-slate-400 uppercase tracking-widest mb-6">SIP & Capital Configuration</h3>
               <div className="grid md:grid-cols-3 gap-6 mb-6">
                 <div>
                   <label className="text-[10px] text-cyan-400 font-bold uppercase tracking-widest mb-2 block">India SIP</label>
                   <div className="glass-input flex items-center px-4 py-3 rounded-xl">
                      <span className="text-slate-500 mr-2">₹</span>
                      <input type="number" value={indiaSIP} onChange={e=>setIndiaSIP(Number(e.target.value))} className="w-full bg-transparent text-white font-bold outline-none font-mono" />
                   </div>
                 </div>
                 <div>
                   <label className="text-[10px] text-indigo-400 font-bold uppercase tracking-widest mb-2 block">Global SIP (USD)</label>
                   <div className="glass-input flex items-center px-4 py-3 rounded-xl">
                      <span className="text-slate-500 mr-2">$</span>
                      <input type="number" value={usSIP} onChange={e=>setUsSIP(Number(e.target.value))} className="w-full bg-transparent text-white font-bold outline-none font-mono" />
                   </div>
                 </div>
                 <div>
                   <label className="text-[10px] text-purple-400 font-bold uppercase tracking-widest mb-2 block">Horizon (Years)</label>
                   <div className="glass-input flex items-center px-4 py-3 rounded-xl">
                      <span className="text-slate-500 mr-2">⏳</span>
                      <input type="number" value={investYears} onChange={e=>setInvestYears(Number(e.target.value))} className="w-full bg-transparent text-white font-bold outline-none font-mono" />
                   </div>
                 </div>
               </div>
            </div>
            
            <div className="grid md:grid-cols-2 gap-6">
              {/* Monte Carlo Visual (Simplified for space but premium UI) */}
              <div className="glass-card rounded-2xl p-6 relative overflow-hidden">
                <div className="absolute top-0 right-0 w-32 h-32 bg-cyan-500/10 blur-3xl rounded-full"></div>
                <h3 className="text-xs font-bold text-slate-400 uppercase tracking-widest mb-6">Monte Carlo Projection</h3>
                {(() => {
                  const rate = 12 / 100 / 12; const months = investYears * 12;
                  const total = indiaSIP + (usSIP * usdInrRate);
                  const fv = total > 0 ? total * (Math.pow(1 + rate, months) - 1) * (1 + rate) / rate : 0;
                  return (
                    <div className="text-center py-4">
                      <div className="text-4xl font-black text-transparent bg-clip-text bg-gradient-to-r from-cyan-400 to-indigo-400 font-mono mb-2">₹{Math.round(fv).toLocaleString('en-IN')}</div>
                      <div className="text-xs text-slate-500 uppercase tracking-widest">Expected Value in {investYears} Years</div>
                    </div>
                  );
                })()}
              </div>
              
              <div className="glass-card rounded-2xl p-6 relative overflow-hidden">
                <div className="absolute top-0 left-0 w-32 h-32 bg-orange-500/10 blur-3xl rounded-full"></div>
                <h3 className="text-xs font-bold text-slate-400 uppercase tracking-widest mb-6">FIRE Calculator</h3>
                <div className="flex items-center justify-between mb-4">
                  <span className="text-sm text-slate-300">Target Monthly Expenses</span>
                  <div className="glass-input flex items-center px-3 py-1.5 rounded-lg w-32">
                    <span className="text-slate-500 mr-1 text-xs">₹</span>
                    <input type="number" value={monthlyExpenses} onChange={e=>setMonthlyExpenses(Number(e.target.value))} className="w-full bg-transparent text-white font-bold outline-none font-mono text-sm" />
                  </div>
                </div>
                {(() => {
                  const fireNum = monthlyExpenses * 12 * 25;
                  const prog = fireNum > 0 ? Math.min(100, (metrics.totalValue / fireNum) * 100) : 0;
                  return (
                    <div>
                       <div className="flex justify-between text-[10px] font-bold uppercase tracking-widest text-orange-400 mb-2 mt-6">
                         <span>Progress</span> <span>{prog.toFixed(2)}%</span>
                       </div>
                       <div className="w-full bg-slate-800 rounded-full h-2">
                         <div className="bg-gradient-to-r from-orange-500 to-amber-400 h-full rounded-full transition-all duration-1000" style={{width: `${prog}%`}}></div>
                       </div>
                       <div className="mt-4 text-center">
                         <div className="text-sm text-slate-400">Target Corpus: <span className="text-white font-bold font-mono">₹{fireNum.toLocaleString('en-IN')}</span></div>
                       </div>
                    </div>
                  )
                })()}
              </div>
            </div>
          </div>
        )}

        {/* MACRO */}
        {activeTab === 'macro' && (
          <div className="space-y-6 animate-fade-in-up">
             <h2 className="text-2xl font-black text-white tracking-tight">Global Macro Radar</h2>
             <div className="glass-card rounded-2xl p-6">
                <div className="flex items-center gap-6">
                   <div className="w-24 h-24 rounded-full border-4 flex items-center justify-center shadow-[0_0_30px_rgba(0,0,0,0.5)]" style={{borderColor: avgVix > 22 ? '#ef4444' : avgVix > 17 ? '#fbbf24' : '#10b981'}}>
                      <div className="text-2xl font-black font-mono">{avgVix.toFixed(1)}</div>
                   </div>
                   <div>
                     <div className="text-xs text-slate-400 font-bold uppercase tracking-widest mb-1">Global Volatility Index</div>
                     <div className={`text-xl font-black ${sentiment.color}`}>{sentiment.text}</div>
                     <p className="text-sm text-slate-500 mt-2 max-w-md">VIX measures market expectations of near-term volatility. Current levels suggest {avgVix > 17 ? 'high institutional hedging. Use caution.' : 'stable environment for systematic accumulation.'}</p>
                   </div>
                </div>
             </div>

             <div className="grid md:grid-cols-2 gap-4">
                {portfolio.map((p, i) => {
                  const rsi = livePrices[`${p.market}_${p.symbol}`]?.rsi || 50;
                  let colorKey = 'blue';
                  if (rsi < 40) colorKey = 'emerald';
                  else if (rsi > 70) colorKey = 'red';
                  else if (rsi > 60) colorKey = 'amber';
                  
                  // Using static dictionary mapping to fix Tailwind dynamic class bug
                  const theme = MACRO_COLORS[colorKey];

                  return (
                    <div key={p.id} className={`${theme.bg} border ${theme.border} p-5 rounded-2xl animate-scale-in`} style={{animationDelay: `${i*0.1}s`}}>
                      <div className="flex justify-between items-start mb-2">
                        <div className="font-bold text-lg text-white">{p.symbol}</div>
                        <span className={`px-2 py-1 rounded text-[10px] font-bold tracking-wider ${theme.tagBg} ${theme.text}`}>
                          RSI: {rsi.toFixed(1)}
                        </span>
                      </div>
                      <div className="text-xs text-slate-400">
                        Algorithm Status: <span className="text-slate-200">{rsi < 40 ? 'Value Zone (Accumulate)' : rsi > 70 ? 'Overheated (Distribute)' : 'Fair Value (Hold)'}</span>
                      </div>
                    </div>
                  )
                })}
             </div>
          </div>
        )}
      </main>

      {/* Add Order Modal */}
      {showAddModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-slate-950/80 backdrop-blur-sm" onClick={() => setShowAddModal(false)}></div>
          <div className="glass-ultra rounded-3xl w-full max-w-md animate-scale-in relative border border-cyan-500/30 overflow-hidden">
            <div className="p-6 border-b border-white/10 bg-gradient-to-r from-slate-900 to-slate-900/50">
               <h3 className="text-xl font-black text-white">{transactionType === 'buy' ? 'Execute Buy' : 'Execute Sell'}</h3>
            </div>
            <div className="p-6 space-y-5">
              <div>
                <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-2 block">Target Asset</label>
                <div className="flex gap-2">
                  <input type="text" value={addSymbol} onChange={e=>setAddSymbol(e.target.value.toUpperCase())} className="glass-input w-full px-4 py-3 rounded-xl font-bold uppercase text-white" />
                  <button onClick={() => fetchModalPriceData(addSymbol)} className="px-4 bg-slate-800 rounded-xl hover:bg-slate-700">🔍</button>
                </div>
              </div>
              
              <div className="flex bg-slate-900/50 rounded-xl p-1 border border-white/5">
                <button onClick={() => setTransactionType('buy')} className={`flex-1 py-2 rounded-lg text-sm font-bold transition-all ${transactionType === 'buy' ? 'bg-emerald-500 text-white' : 'text-slate-500'}`}>BUY</button>
                <button onClick={() => setTransactionType('sell')} className={`flex-1 py-2 rounded-lg text-sm font-bold transition-all ${transactionType === 'sell' ? 'bg-red-500 text-white' : 'text-slate-500'}`}>SELL</button>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-2 block">Quantity</label>
                  <input type="number" value={addQty} onChange={e=>setAddQty(e.target.value)} className="glass-input w-full px-4 py-3 rounded-xl font-mono font-bold text-white text-lg" placeholder="0" />
                </div>
                <div>
                  <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-2 block">Execution Price</label>
                  <input type="number" value={addPrice} onChange={e=>setAddPrice(e.target.value)} className="glass-input w-full px-4 py-3 rounded-xl font-mono font-bold text-white text-lg" placeholder="0.00" />
                </div>
              </div>
            </div>
            <div className="p-6 bg-slate-900/80 border-t border-white/5">
               <button onClick={savePosition} className={`w-full py-4 rounded-xl font-bold tracking-widest text-white transition-all ${transactionType === 'buy' ? 'bg-emerald-600 hover:bg-emerald-500' : 'bg-red-600 hover:bg-red-500'}`}>
                 CONFIRM ORDER
               </button>
            </div>
          </div>
        </div>
      )}

      {/* Expert Chat Modal */}
      {showExpertModal && expertInfo && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-slate-950/80 backdrop-blur-sm" onClick={() => setShowExpertModal(false)}></div>
          <div className="glass-ultra rounded-3xl w-full max-w-lg h-[80vh] flex flex-col animate-scale-in relative border border-cyan-500/30 overflow-hidden shadow-[0_0_50px_rgba(6,182,212,0.1)]">
            
            <div className={`bg-gradient-to-r ${expertInfo.colorBg} p-5 border-b border-white/10 flex items-center justify-between`}>
              <div className="flex items-center gap-4">
                <div className="w-12 h-12 bg-black/40 rounded-2xl flex items-center justify-center text-2xl border border-white/10">{expertInfo.icon}</div>
                <div>
                  <h3 className="font-black text-lg text-white">{expertInfo.name}</h3>
                  <p className="text-[10px] font-bold uppercase tracking-widest text-white/70">{expertInfo.role}</p>
                </div>
              </div>
              <button onClick={() => setShowExpertModal(false)} className="w-8 h-8 flex items-center justify-center bg-black/20 hover:bg-red-500/80 rounded-full transition-colors">×</button>
            </div>
            
            <div className="flex-1 overflow-y-auto p-5 space-y-4">
              {expertMessages.map((msg, i) => (
                <div key={i} className={`flex gap-3 animate-fade-in-up ${msg.sender === 'user' ? 'flex-row-reverse' : ''}`}>
                  <div className={`w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 text-sm ${msg.sender === 'user' ? 'bg-indigo-500' : 'bg-slate-800 border border-white/10'}`}>
                    {msg.sender === 'user' ? '👤' : expertInfo.icon}
                  </div>
                  <div className={`px-4 py-3 rounded-2xl max-w-[80%] text-sm whitespace-pre-line ${msg.sender === 'user' ? 'bg-indigo-600 text-white rounded-tr-sm' : 'glass-card text-slate-200 rounded-tl-sm'}`}>
                    {msg.text}
                  </div>
                </div>
              ))}
              <div ref={messagesEndRef} />
            </div>

            <div className="p-4 bg-slate-900/90 border-t border-white/10">
              <div className="flex gap-2">
                <input
                  type="text"
                  value={expertInput}
                  onChange={e => setExpertInput(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && sendToExpert()}
                  placeholder="Request neural analysis..."
                  className="flex-1 glass-input px-4 py-3 rounded-xl text-sm text-white"
                />
                <button onClick={sendToExpert} className="btn-primary px-5 rounded-xl font-bold text-white shadow-lg shadow-cyan-500/20">
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8"></path></svg>
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
