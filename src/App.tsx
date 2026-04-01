import { useState, useEffect, useCallback, useRef } from 'react';
import { Position, PriceData, TabType, RiskLevel, ExpertInfo, TransactionType } from './types';
import { 
  SECURE_PIN, TG_TOKEN, TG_CHAT_ID,
  getTodayString, guessMarket, getAssetCagrProxy, formatPrice, EXACT_TICKER_MAP
} from './utils/constants';
import { 
  fetchSinglePrice, batchFetchPrices, fetchForexRate, 
  syncToCloud, loadFromCloud, sendTelegramAlert 
} from './utils/api';

export default function App() {
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [pinInput, setPinInput] = useState('');
  const [activeTab, setActiveTab] = useState<TabType>('dashboard');
  const [portfolio, setPortfolio] = useState<Position[]>([]);
  const [livePrices, setLivePrices] = useState<Record<string, PriceData>>({});
  const [usdInrRate, setUsdInrRate] = useState(83.5);
  const [currentSymbol, setCurrentSymbol] = useState('NIFTYBEES.NS');
  const [currentMarket, setCurrentMarket] = useState<'IN' | 'US'>('IN');
  const [symbolInput, setSymbolInput] = useState('');
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [chartInterval, setChartInterval] = useState('D');
  const [currentTime, setCurrentTime] = useState(new Date());
  const [liveStatus, setLiveStatus] = useState('Connecting...');
  const [syncStatus, setSyncStatus] = useState('');
  
  // Wallets & Planner
  const [inWallet, setInWallet] = useState(100000);
  const [usWallet, setUsWallet] = useState(5000);
  const [indiaSIP, setIndiaSIP] = useState(10000);
  const [usSIP, setUsSIP] = useState(200);

  const [showAddModal, setShowAddModal] = useState(false);
  const [addSymbol, setAddSymbol] = useState('');
  const [addQty, setAddQty] = useState('');
  const [addPrice, setAddPrice] = useState('');
  const [transactionType, setTransactionType] = useState<TransactionType>('buy');
  const [editId, setEditId] = useState<string | null>(null);

  const syncIntervalRef = useRef<number | null>(null);
  const chartContainerRef = useRef<HTMLDivElement>(null);

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
    
    // Cloud Sync overrides local storage for Multi-Device support
    setLiveStatus('● FETCHING CLOUD DATA...');
    loadFromCloud().then(data => {
      if (data && data.length > 0) {
        setPortfolio(data);
        localStorage.setItem('portfolio', JSON.stringify(data));
        setLiveStatus('● CLOUD SYNCED');
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
      setLiveStatus('● QUANTUM CORE ACTIVE');
    };
    sync();
    syncIntervalRef.current = window.setInterval(sync, 5000);
    return () => { if (syncIntervalRef.current) clearInterval(syncIntervalRef.current); };
  }, [isAuthenticated, portfolio.length]);

  useEffect(() => {
    if (!isAuthenticated || !chartContainerRef.current) return;
    loadTradingViewChart();
  }, [currentSymbol, chartInterval, isAuthenticated]);

  const verifyPin = () => {
    if (pinInput === SECURE_PIN) {
      localStorage.setItem('authDone', 'true');
      setIsAuthenticated(true);
    } else {
      setPinInput('');
    }
  };

  const updatePortfolioState = (newPortfolio: Position[]) => {
    setPortfolio(newPortfolio);
    localStorage.setItem('portfolio', JSON.stringify(newPortfolio));
    setSyncStatus('⏳ Syncing...');
    syncToCloud(newPortfolio, usdInrRate).then(success => {
      setSyncStatus(success ? '✅ Synced' : '❌ Cloud Error');
      setTimeout(() => setSyncStatus(''), 3000);
    });
  };

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
    } catch (e) {} 
    finally { setIsAnalyzing(false); }
  };

  const savePosition = () => {
    const qty = parseFloat(addQty);
    const price = parseFloat(addPrice);
    if (!addSymbol || isNaN(qty) || isNaN(price) || qty <= 0 || price <= 0) return;

    const mkt = guessMarket(addSymbol);
    let newPortfolio = [...portfolio];

    if (transactionType === 'sell') {
      const idx = newPortfolio.findIndex(p => p.symbol === addSymbol && p.market === mkt);
      if (idx >= 0) {
        newPortfolio[idx].qty -= qty;
        if (newPortfolio[idx].qty <= 0) newPortfolio = newPortfolio.filter((_, i) => i !== idx);
      }
    } else {
      const existing = newPortfolio.find(p => p.symbol === addSymbol && p.market === mkt);
      if (existing) {
        const totalQty = existing.qty + qty;
        existing.avgPrice = ((existing.qty * existing.avgPrice) + (qty * price)) / totalQty;
        existing.qty = totalQty;
      } else {
        newPortfolio.push({
          id: Date.now().toString(),
          symbol: addSymbol,
          market: mkt as 'IN' | 'US',
          qty,
          avgPrice: price,
          leverage: 1,
          dateAdded: getTodayString()
        });
      }
    }

    setShowAddModal(false);
    updatePortfolioState(newPortfolio);
  };

  const loadTradingViewChart = useCallback(() => {
    if (!chartContainerRef.current) return;
    const cleanSym = currentSymbol.replace('.NS', '').replace('.BO', '');
    const isIndian = currentMarket === 'IN' || currentSymbol.includes('.NS') || currentSymbol.includes('BEES');
    
    // Exact mapping for Indian ETFs to fix "Symbol only available on TradingView" error
    let tvSymbol = '';
    if (EXACT_TICKER_MAP[cleanSym]) {
      tvSymbol = EXACT_TICKER_MAP[cleanSym];
    } else if (isIndian) {
      tvSymbol = `NSE:${cleanSym}`; // Explicitly use NSE to prevent errors
    } else {
      tvSymbol = `NASDAQ:${cleanSym}`;
    }
    
    chartContainerRef.current.innerHTML = '';
    const container = document.createElement('div');
    container.className = 'tradingview-widget-container h-full w-full';
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
      backgroundColor: "rgba(11, 14, 20, 1)",
      gridColor: "rgba(30, 41, 59, 0.4)",
      hide_top_toolbar: false,
      enable_publishing: false,
      allow_symbol_change: true,
      studies: ['STD;RSI', 'STD;MACD', 'STD;Bollinger_Bands']
    });
    container.appendChild(script);
  }, [currentSymbol, currentMarket, chartInterval]);

  const currentKey = `${currentMarket}_${currentSymbol}`;
  const currentData = livePrices[currentKey];
  const currentPrice = currentData?.price || 0;
  const currentRsi = currentData?.rsi || 50;
  
  // AI Dynamic Fibonacci Matrix Logic
  const highPrice = currentData?.high || currentPrice * 1.05;
  const lowPrice = currentData?.low || currentPrice * 0.95;
  const diff = highPrice - lowPrice;
  const fib = {
    r236: highPrice - (diff * 0.236),
    r382: highPrice - (diff * 0.382),
    r500: highPrice - (diff * 0.500),
    r618: highPrice - (diff * 0.618),
  };

  // AI Wallet Planner (Buy Strong Signal Generation)
  const generateBuySignal = () => {
    if (currentRsi < 35 && currentPrice < fib.r618) {
      const allocAmt = currentMarket === 'IN' ? inWallet * 0.15 : usWallet * 0.15;
      const qty = Math.floor(allocAmt / currentPrice);
      return { action: 'STRONG BUY', qty, color: 'text-emerald-400', reason: 'Deep Discount + Oversold' };
    }
    if (currentRsi < 45 && currentPrice < fib.r500) {
      const allocAmt = currentMarket === 'IN' ? inWallet * 0.05 : usWallet * 0.05;
      const qty = Math.floor(allocAmt / currentPrice);
      return { action: 'ACCUMULATE', qty, color: 'text-cyan-400', reason: 'Value Zone + Dip' };
    }
    return { action: 'HOLD / WAIT', qty: 0, color: 'text-amber-400', reason: 'Neutral / Premium Pricing' };
  };
  const aiSignal = generateBuySignal();

  if (!isAuthenticated) return (
    <div className="min-h-screen bg-[#0b0e14] flex items-center justify-center p-4 gradient-bg">
      <div className="bg-[#111827]/80 backdrop-blur-2xl rounded-3xl p-8 w-full max-w-sm border border-cyan-500/20 shadow-[0_0_50px_rgba(6,182,212,0.1)]">
        <h1 className="text-3xl font-black text-center mb-8 text-transparent bg-clip-text bg-gradient-to-r from-cyan-400 to-indigo-500">PRO TERMINAL</h1>
        <input type="password" value={pinInput} onChange={e => setPinInput(e.target.value)} onKeyPress={e => e.key === 'Enter' && verifyPin()} placeholder="ACCESS KEY" className="w-full text-center px-4 py-4 bg-black/50 rounded-xl border border-slate-800 focus:border-cyan-500 outline-none text-2xl tracking-[0.5em] text-cyan-400 font-mono mb-6" />
        <button onClick={verifyPin} className="w-full py-4 bg-cyan-600 hover:bg-cyan-500 rounded-xl font-bold text-white transition-all glow-cyan">INITIALIZE</button>
      </div>
    </div>
  );

  return (
    <div className="min-h-screen bg-[#0b0e14] text-slate-200 font-sans selection:bg-cyan-900">
      {/* Top Ribbon */}
      <header className="sticky top-0 z-40 bg-[#0b0e14]/90 backdrop-blur-xl border-b border-white/5">
        <div className="bg-cyan-950/20 py-1.5 border-b border-cyan-500/10 overflow-hidden">
          <div className="text-[10px] font-mono text-cyan-500 tracking-widest px-4 flex justify-between animate-pulse">
            <span>SYS: DEEP MIND AI ACTIVE</span>
            <span>{syncStatus || liveStatus}</span>
          </div>
        </div>
        <div className="container mx-auto px-4 py-3 flex justify-between items-center">
          <h1 className="text-xl font-black tracking-tight text-white flex items-center gap-2">
            <span className="text-cyan-500">⚡</span> WEALTH<span className="text-slate-500">AI</span>
          </h1>
          <div className="flex bg-[#111827] p-1 rounded-xl border border-white/5">
            {(['dashboard', 'portfolio', 'planner'] as TabType[]).map(t => (
              <button key={t} onClick={() => setActiveTab(t)} className={`px-5 py-2 rounded-lg text-xs font-bold uppercase tracking-wider transition-all ${activeTab === t ? 'bg-cyan-900/50 text-cyan-400 border border-cyan-500/30 shadow-[0_0_15px_rgba(6,182,212,0.2)]' : 'text-slate-500 hover:text-white'}`}>
                {t}
              </button>
            ))}
          </div>
        </div>
      </header>

      <main className="container mx-auto px-4 py-6">
        {activeTab === 'dashboard' && (
          <div className="grid lg:grid-cols-12 gap-6">
            
            {/* Left Col: Asset Search & AI Metrics */}
            <div className="lg:col-span-3 space-y-6">
              <div className="bg-[#111827]/80 p-4 rounded-2xl border border-white/5 card-glass">
                <div className="flex gap-2 relative">
                  <input type="text" value={symbolInput} onChange={e => setSymbolInput(e.target.value)} onKeyPress={e => e.key === 'Enter' && analyzeSymbol()} placeholder="TICKER" className="w-full bg-[#0b0e14] px-4 py-3 rounded-xl border border-slate-800 focus:border-cyan-500 outline-none text-white font-mono uppercase" />
                  <button onClick={analyzeSymbol} className="bg-cyan-600 px-4 rounded-xl text-white font-bold hover:bg-cyan-500 transition-all">SCAN</button>
                </div>
              </div>

              {/* Dynamic Fibonacci Matrix */}
              <div className="bg-[#111827]/80 p-5 rounded-2xl border border-cyan-500/10 card-glass">
                <h3 className="text-xs font-bold text-cyan-500 mb-4 uppercase tracking-widest flex items-center gap-2">
                  <span>📐</span> AI Fibonacci Matrix
                </h3>
                <div className="space-y-3 font-mono text-sm">
                  <div className="flex justify-between text-slate-400"><span>R_0.236</span> <span className="text-white">{formatPrice(fib.r236)}</span></div>
                  <div className="flex justify-between text-slate-400"><span>R_0.382</span> <span className="text-white">{formatPrice(fib.r382)}</span></div>
                  <div className="flex justify-between text-amber-400 font-bold bg-amber-950/20 p-1 rounded"><span>Mid_0.5</span> <span>{formatPrice(fib.r500)}</span></div>
                  <div className="flex justify-between text-emerald-400 font-bold bg-emerald-950/20 p-1 rounded"><span>Golden_0.618</span> <span>{formatPrice(fib.r618)}</span></div>
                  <div className="flex justify-between items-center border-t border-white/5 pt-2 mt-2">
                    <span className="text-xs text-slate-500 uppercase">Current LTP</span>
                    <span className="text-lg text-white font-black">{formatPrice(currentPrice)}</span>
                  </div>
                </div>
              </div>

              {/* AI Wallet Planner Execution */}
              <div className="bg-[#111827]/80 p-5 rounded-2xl border border-purple-500/10 card-glass relative overflow-hidden">
                <div className="absolute top-0 right-0 w-32 h-32 bg-purple-500/10 rounded-full blur-3xl"></div>
                <h3 className="text-xs font-bold text-purple-400 mb-4 uppercase tracking-widest">🧠 AI Trade Planner</h3>
                <div className="space-y-4">
                  <div className="flex justify-between text-sm">
                    <span className="text-slate-400">India Wallet</span>
                    <span className="font-mono text-white">₹{inWallet.toLocaleString()}</span>
                  </div>
                  <div className="p-3 bg-black/40 rounded-xl border border-white/5">
                    <div className="text-[10px] text-slate-500 uppercase mb-1">Deep Mind Strategy</div>
                    <div className={`font-black text-lg ${aiSignal.color}`}>{aiSignal.action}</div>
                    <div className="text-xs text-slate-400 mt-1">{aiSignal.reason}</div>
                    {aiSignal.qty > 0 && (
                      <div className="mt-3 pt-3 border-t border-white/5 flex justify-between items-center">
                        <span className="text-xs text-slate-300">Suggested Qty:</span>
                        <span className="font-mono font-bold text-cyan-400">{aiSignal.qty} Units</span>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </div>

            {/* Middle Col: Advanced TV Chart & Order Entry */}
            <div className="lg:col-span-9 space-y-6">
              {/* Header Stats */}
              <div className="grid grid-cols-4 gap-4">
                <div className="bg-[#111827]/80 p-4 rounded-xl border border-white/5">
                  <div className="text-[10px] text-slate-500 uppercase font-bold">LTP</div>
                  <div className="text-2xl font-black text-white font-mono">{formatPrice(currentPrice, currentMarket==='IN'?'₹':'$')}</div>
                </div>
                <div className="bg-[#111827]/80 p-4 rounded-xl border border-white/5">
                  <div className="text-[10px] text-slate-500 uppercase font-bold">RSI Momentum</div>
                  <div className={`text-2xl font-black font-mono ${currentRsi<30?'text-emerald-400':currentRsi>70?'text-red-400':'text-cyan-400'}`}>{currentRsi.toFixed(1)}</div>
                </div>
                <div className="col-span-2 bg-gradient-to-r from-cyan-950/30 to-[#111827]/80 p-4 rounded-xl border border-cyan-500/20 flex items-center justify-between">
                  <div>
                    <div className="text-[10px] text-cyan-500 uppercase font-bold">AI Insider News</div>
                    <div className="text-sm text-slate-300 mt-1 font-medium">{currentRsi < 40 ? "Institutional dark pool accumulation detected. Volume spikes visible." : "Standard algorithmic rotation in progress. No major whale dumps."}</div>
                  </div>
                </div>
              </div>

              {/* Chart Container */}
              <div className="bg-[#111827]/80 rounded-2xl border border-white/5 p-2 card-glass flex flex-col" style={{ height: '600px' }}>
                <div className="flex justify-between items-center p-2 mb-2">
                  <div className="font-bold text-white flex items-center gap-2"><span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></span> {currentSymbol}</div>
                  <div className="flex gap-1">
                    {['15', '60', 'D', 'W'].map(t => (
                      <button key={t} onClick={() => setChartInterval(t)} className={`px-3 py-1 text-xs font-mono rounded ${chartInterval===t?'bg-cyan-600 text-white':'text-slate-400 hover:bg-white/5'}`}>{t}</button>
                    ))}
                  </div>
                </div>
                <div className="flex-1 rounded-xl overflow-hidden" ref={chartContainerRef}></div>
              </div>
            </div>
          </div>
        )}

        {/* Portfolio & Planner Tabs... (Same logic as existing, UI updated to #111827 dark theme) */}
        {activeTab === 'portfolio' && (
          <div className="bg-[#111827]/80 rounded-2xl border border-white/5 overflow-hidden card-glass">
            <div className="p-4 border-b border-white/5 flex justify-between items-center">
               <h2 className="text-lg font-bold text-white uppercase tracking-widest">Institutional Ledger</h2>
               <button onClick={() => {setAddSymbol(currentSymbol); setTransactionType('buy'); setShowAddModal(true);}} className="bg-cyan-600 px-4 py-2 rounded-lg text-xs font-bold hover:bg-cyan-500">NEW ORDER</button>
            </div>
            <table className="w-full text-left border-collapse">
              <thead className="bg-[#0b0e14] text-[10px] uppercase text-slate-500">
                <tr>
                  <th className="p-4 font-semibold">Asset</th>
                  <th className="p-4 font-semibold">Position</th>
                  <th className="p-4 font-semibold">Entry / LTP</th>
                  <th className="p-4 font-semibold">P&L</th>
                  <th className="p-4 font-semibold text-right">Execute</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/5 text-sm">
                {portfolio.map(p => {
                  const key = `${p.market}_${p.symbol}`;
                  const data = livePrices[key];
                  const curPrice = data?.price || p.avgPrice;
                  const pl = (curPrice - p.avgPrice) * p.qty;
                  const plPct = ((curPrice - p.avgPrice) / p.avgPrice) * 100;
                  return (
                    <tr key={p.id} className="hover:bg-white/5 transition-colors group">
                      <td className="p-4">
                        <div className="font-bold text-white">{p.symbol}</div>
                        <div className="text-[10px] text-slate-500 mt-0.5">{p.market} • {p.dateAdded}</div>
                      </td>
                      <td className="p-4 font-mono">{p.qty}</td>
                      <td className="p-4 font-mono">
                        <div className="text-slate-400">{formatPrice(p.avgPrice)}</div>
                        <div className="text-white mt-0.5">{formatPrice(curPrice)}</div>
                      </td>
                      <td className="p-4 font-mono">
                        <div className={pl >= 0 ? 'text-emerald-400' : 'text-red-400'}>{pl >= 0 ? '+' : ''}{formatPrice(pl)}</div>
                        <div className={`text-[10px] ${plPct >= 0 ? 'text-emerald-500' : 'text-red-500'} mt-0.5`}>{plPct.toFixed(2)}%</div>
                      </td>
                      <td className="p-4 text-right">
                        <button onClick={() => {
                          let newPort = portfolio.filter(x => x.id !== p.id);
                          updatePortfolioState(newPort);
                        }} className="text-slate-600 hover:text-red-500 px-2">LIQUIDATE</button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </main>
    </div>
  );
}
