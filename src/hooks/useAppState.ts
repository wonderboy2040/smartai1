import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { Position, PriceData, TabType, RiskLevel, TransactionType } from '../types';
import {
  SECURE_PIN, TG_TOKEN, TG_CHAT_ID, DEFAULT_USD_INR,
  getTodayString, guessMarket, EXACT_TICKER_MAP, isCryptoSymbol
} from '../utils/constants';
import {
  fetchSinglePrice, batchFetchPrices, fetchForexRate, fetchCryptoUsdInrRate,
  syncToCloud, loadFromCloud, sendTelegramAlert,
  syncGroqKeyToCloud, loadGroqKeyFromCloud, getBatchInterval, fetchMarketIntelligence
} from '../utils/api';
import { secureStorage } from '../utils/secureStorage';
import { subscribeToPrices, disconnectPrices, getWebSocketLatency } from '../utils/tvWebsocket';
import { subscribeToCryptoPrices, disconnectCryptoPrices } from '../utils/binanceWebsocket';
import { isAnyMarketOpen, analyzeAsset, getSmartAllocations, generateDeepAnalysis } from '../utils/telegram';

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
  const [cryptoUsdInrRate, setCryptoUsdInrRate] = useState(88.0);
  const cryptoUsdInrRateRef = useRef(88.0);
  useEffect(() => { cryptoUsdInrRateRef.current = cryptoUsdInrRate; }, [cryptoUsdInrRate]);
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
  const [groqKey, setGroqKey] = useState(() => secureStorage.getItem('WEALTH_AI_GROQ') || '');
  const [addSymbol, setAddSymbol] = useState('');
  const [addQty, setAddQty] = useState('');
  const [addPrice, setAddPrice] = useState('');
  const [addDate, setAddDate] = useState(getTodayString());
  const [addLeverage, setAddLeverage] = useState('1');
  const [transactionType, setTransactionType] = useState<TransactionType>('buy');
  const [modalPrice, setModalPrice] = useState<{ price: number; change: number; market: string } | null>(null);
  const [editId, setEditId] = useState<string | null>(null);
  const [autoTelegram, setAutoTelegram] = useState(true);

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
    }).catch(() => {});
    loadGroqKeyFromCloud().then(cloudKey => {
      if (cloudKey) { setGroqKey(cloudKey); secureStorage.setItem('WEALTH_AI_GROQ', cloudKey); }
      else { const localKey = secureStorage.getItem('WEALTH_AI_GROQ'); if (localKey) syncGroqKeyToCloud(localKey).catch(() => {}); }
    }).catch(() => { const localKey = secureStorage.getItem('WEALTH_AI_GROQ'); if (localKey) { syncGroqKeyToCloud(localKey).catch(() => {}); setGroqKey(localKey); } });
    fetchForexRate().then(rate => setUsdInrRate(rate));
    fetchCryptoUsdInrRate().then(rate => setCryptoUsdInrRate(rate));
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
    } catch {}
  }, [isAuthenticated]);

  // --- Persist planner ---
  useEffect(() => {
    if (!isAuthenticated) return;
    secureStorage.setItem('plannerSettings', JSON.stringify({ indiaSIP, usSIP, btcSIP, ethSIP, investYears, riskLevel, emergencyFund, currentAge, monthlyExpenses }));
  }, [indiaSIP, usSIP, btcSIP, ethSIP, investYears, riskLevel, emergencyFund, currentAge, monthlyExpenses, isAuthenticated]);

  // --- Price flush interval (3s — WS gives real-time, no need for faster) ---
  useEffect(() => {
    if (!isAuthenticated || portfolio.length === 0) return;
    priceFlushRef.current = window.setInterval(() => { requestAnimationFrame(flushPricesToStorage); }, 3000);
    return () => { if (priceFlushRef.current) { clearInterval(priceFlushRef.current); priceFlushRef.current = null; } };
  }, [isAuthenticated, portfolio.length, flushPricesToStorage]);

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
    const cryptoSymbols = symbolsToSub.filter(s => isCryptoSymbol(s.split('_')[1]));
    const tvSymbols = symbolsToSub.filter(s => !isCryptoSymbol(s.split('_')[1]));
    const unsubscribeTv = subscribeToPrices(tvSymbols.map(s => s.split('_')[1]), (key, data) => {
      pendingPricesRef.current[key] = { ...(pendingPricesRef.current[key] || {}), ...data } as PriceData;
      statusCounter++;
      if (statusCounter % 50 === 1) setLiveStatus('● TV SOCKET LIVE ⚡');
    });
    const unsubscribeBinance = subscribeToCryptoPrices(cryptoSymbols.map(s => s.split('_')[1]), (key, data) => {
      const isIN = key.startsWith('IN_');
      const rate = cryptoUsdInrRateRef.current;
      const convertedData = { ...data };
      if (isIN) {
        if (convertedData.price) convertedData.price *= rate;
        if (convertedData.high) convertedData.high *= rate;
        if (convertedData.low) convertedData.low *= rate;
      }
      pendingPricesRef.current[key] = { ...(pendingPricesRef.current[key] || {}), ...convertedData } as PriceData;
      statusCounter++;
      if (statusCounter % 50 === 1) setLiveStatus('● BINANCE SOCKET LIVE ⚡');
    });
    return () => {
      if (syncIntervalRef.current) clearInterval(syncIntervalRef.current);
      unsubscribeTv(); unsubscribeBinance(); disconnectPrices(); disconnectCryptoPrices();
      flushPricesToStorage();
    };
  }, [isAuthenticated, portfolioSymbolKey, flushPricesToStorage]);

  // --- Save portfolio ---
  useEffect(() => {
    if (portfolio.length > 0) {
      secureStorage.setItem('portfolio', JSON.stringify(portfolio));
      if (!currentSymbol) { setCurrentSymbol(portfolio[0].symbol); setCurrentMarket(portfolio[0].market as 'IN' | 'US'); }
    }
  }, [portfolio]);

  // --- Cloud sync (debounced 5s instead of 3s) ---
  useEffect(() => {
    if (portfolio.length === 0) return;
    if (cloudSyncTimerRef.current) clearTimeout(cloudSyncTimerRef.current);
    cloudSyncTimerRef.current = window.setTimeout(() => {
      syncToCloud(portfolio, usdInrRate);
      secureStorage.setItem('portfolio', JSON.stringify(portfolio));
    }, 5000);
    return () => { if (cloudSyncTimerRef.current) clearTimeout(cloudSyncTimerRef.current); };
  }, [portfolio, usdInrRate]);

  // --- Forex refresh (180s — rates don't change fast) ---
  useEffect(() => {
    if (!isAuthenticated) return;
    const refreshForex = async () => {
      const rate = await fetchForexRate(); setUsdInrRate(rate);
      const cryptoRate = await fetchCryptoUsdInrRate(); setCryptoUsdInrRate(cryptoRate);
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
    // TradingView free embedded widget restricts NSE ETF symbols — BSE versions work
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

  // --- Metrics (optimized: use refs to avoid stale deps) ---
  const calculateMetrics = useCallback(() => {
    const p = portfolioRef.current;
    const lp = livePricesRef.current;
    const rate = usdInrRateRef.current;
    let totalInvested = 0, totalValue = 0, todayPL = 0;
    let indPL = 0, usPL = 0, cryptoPL = 0;
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
      const prevPrice = curPrice / (1 + (change / 100));
      const dayPL = (curPrice - prevPrice) * pos.qty;
      const dayPLINR = pos.market === 'IN' ? dayPL : dayPL * rate;
      todayPL += dayPLINR;
      if (isCryptoSymbol(pos.symbol.replace('.NS', '').replace('.BO', ''))) cryptoPL += dayPLINR;
      else if (pos.market === 'IN') indPL += dayPLINR;
      else usPL += dayPLINR;
    });
    const totalPL = totalValue - totalInvested;
    const plPct = totalInvested > 0 ? (totalPL / totalInvested) * 100 : 0;
    const todayPct = (totalValue - todayPL) > 0 ? (todayPL / (totalValue - todayPL)) * 100 : 0;
    return { totalInvested, totalValue, totalPL, plPct, todayPL, todayPct, indPL, usPL, cryptoPL };
  }, []);

  const metrics = useMemo(() => calculateMetrics(), [calculateMetrics, portfolio, livePrices, usdInrRate]);

  // Update latestDataRef for telegram interval
  useEffect(() => { latestDataRef.current = { portfolio, livePrices, usdInrRate }; }, [portfolio, livePrices, usdInrRate]);

  // --- Context regeneration (throttled 120s — heavy string ops) ---
  useEffect(() => {
    if (portfolio.length === 0) return;
    const now = Date.now();
    if (now - lastContextGenRef.current < 120000) return;
    lastContextGenRef.current = now;
    let ctx = `--- DEEP MIND QUANTUM LIVE SENSOR DATA ---\n`;
    const usVix = livePrices['US_VIX']?.price || 15;
    const inVix = livePrices['IN_INDIAVIX']?.price || 15;
    const avgVixCtx = (usVix + inVix) / 2;
    ctx += `Timestamp: ${new Date().toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata' })} IST\n`;
    ctx += `US VIX: ${usVix.toFixed(1)} | India VIX: ${inVix.toFixed(1)} | Avg: ${avgVixCtx.toFixed(1)}\n`;
    ctx += `Market Regime: ${avgVixCtx > 22 ? 'BEARISH' : avgVixCtx > 16 ? 'VOLATILE' : 'BULLISH'}\n`;
    ctx += `USD/INR: ₹${usdInrRate.toFixed(2)}\n`;
    ctx += `Portfolio Value: ₹${Math.round(metrics.totalValue).toLocaleString('en-IN')}\n`;
    ctx += `Total P&L: ${metrics.totalPL >= 0 ? '+' : ''}₹${Math.round(metrics.totalPL).toLocaleString('en-IN')} (${metrics.plPct.toFixed(2)}%)\n`;
    ctx += `Today P&L: ${metrics.todayPL >= 0 ? '+' : ''}₹${Math.round(metrics.todayPL).toLocaleString('en-IN')}\n`;
    ctx += `Total Assets: ${portfolio.length}\n\n`;
    ctx += `=== ALL ${portfolio.length} PORTFOLIO POSITIONS WITH LIVE TECHNICALS ===\n`;
    for (let idx = 0; idx < portfolio.length; idx++) {
      const p = portfolio[idx];
      const key = `${p.market}_${p.symbol}`;
      const data = livePrices[key];
      const curPrice = data?.price || p.avgPrice;
      const rsi = data?.rsi || 50;
      const change = data?.change || 0;
      const macd = data?.macd !== undefined ? data.macd.toFixed(2) : 'N/A';
      const sma20 = data?.sma20 ? data.sma20.toFixed(1) : 'N/A';
      const sma50 = data?.sma50 ? data.sma50.toFixed(1) : 'N/A';
      const vol = data?.volume ? (data.volume > 1e6 ? `${(data.volume / 1e6).toFixed(1)}M` : `${(data.volume / 1e3).toFixed(0)}K`) : 'N/A';
      const plPct = p.avgPrice > 0 ? ((curPrice - p.avgPrice) / p.avgPrice) * 100 : 0;
      const cleanSym = p.symbol.replace('.NS', '');
      const invested = p.avgPrice * p.qty;
      const curVal = curPrice * p.qty;
      const plAbs = curVal - invested;
      const sig = analyzeAsset(p, data);
      const atr = ((data?.high || curPrice) - (data?.low || curPrice)) || curPrice * 0.02;
      const slPrice = curPrice - atr * 1.5;
      const tpPrice = curPrice + atr * 2.5;
      const buyDate = new Date(p.dateAdded);
      const holdingDays = Math.max(0, Math.round((Date.now() - buyDate.getTime()) / (1000 * 60 * 60 * 24)));
      const holdingLabel = holdingDays > 365 ? `${(holdingDays / 365).toFixed(1)}Y` : `${holdingDays}D`;
      const years = holdingDays / 365;
      const cagrPct = (years > 0.1 && p.avgPrice > 0) ? ((Math.pow(curPrice / p.avgPrice, 1 / years) - 1) * 100) : plPct;
      const isCryptoAsset = isCryptoSymbol(cleanSym);
      const assetType = isCryptoAsset ? 'CRYPTO' : p.market;
      const trend = (data?.sma20 && data?.sma50) ? (data.sma20 > data.sma50 ? 'BULL' : 'BEAR') : (change > 0.5 ? 'BULL' : change < -0.5 ? 'BEAR' : 'FLAT');
      ctx += `${idx + 1}. ${cleanSym} [${assetType}] | Price=${curPrice.toFixed(2)} | Chg=${change >= 0 ? '+' : ''}${change.toFixed(2)}% | RSI=${rsi.toFixed(0)} | MACD=${macd} | SMA20=${sma20} | SMA50=${sma50} | Trend=${trend} | Vol=${vol} | Signal=${sig.signal} | Confidence=${sig.confidence}% | SL=${slPrice.toFixed(2)} | TP=${tpPrice.toFixed(2)} | AvgBuy=${p.avgPrice.toFixed(2)} | Qty=${p.qty} | Invested=${invested.toFixed(0)} | CurVal=${curVal.toFixed(0)} | P&L=${plPct >= 0 ? '+' : ''}${plPct.toFixed(2)}% (${plAbs >= 0 ? '+' : ''}${plAbs.toFixed(0)}) | Holding=${holdingLabel} | CAGR=${cagrPct >= 0 ? '+' : ''}${cagrPct.toFixed(1)}%\n`;
    }
    ctx += `=== END ALL ${portfolio.length} POSITIONS ===\n`;
    setPortfolioContextText(ctx);
  }, [portfolio.length, usdInrRate, livePrices, metrics]);

  // --- Telegram auto-report ---
  useEffect(() => {
    if (!isAuthenticated || !autoTelegram || portfolio.length === 0) return;
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

  // --- WS Latency (60s — cosmetic metric, no need for fast updates) ---
  useEffect(() => {
    if (!isAuthenticated) return;
    const interval = setInterval(() => { setWsLatency(getWebSocketLatency()); }, 60000);
    return () => clearInterval(interval);
  }, [isAuthenticated]);

  // --- Sector intel (3min instead of 2min) ---
  useEffect(() => {
    if (!isAuthenticated) return;
    const fetchIntel = async () => {
      try { const intel = await fetchMarketIntelligence(); if (intel.sectors?.length > 0) setSectorData(intel.sectors); } catch {}
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
  const rate = cagr / 100 / 12;
  const fvMed = totalSIP > 0 ? totalSIP * (Math.pow(1 + rate, months) - 1) * (1 + rate) / rate : 0;
  const worstRate = Math.max(0.5, cagr - 8) / 100 / 12;
  const fvWorst = totalSIP > 0 ? totalSIP * (Math.pow(1 + worstRate, months) - 1) * (1 + worstRate) / worstRate : 0;
  const fvBest = totalSIP > 0 ? totalSIP * (Math.pow(1 + (cagr + 8) / 100 / 12, months) - 1) * (1 + (cagr + 8) / 100 / 12) / ((cagr + 8) / 100 / 12) : 0;
  const multiplier = totalInvestedPlanner > 0 ? fvMed / totalInvestedPlanner : 0;

  // --- FIRE ---
  const fireNumber = monthlyExpenses * 12 * 25;
  const rawYears = totalSIP > 0 && rate > 0 && fireNumber > 0 ? Math.log((fireNumber * rate / totalSIP) + 1) / Math.log(1 + rate) / 12 : null;
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
    // Directly trigger analysis
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
      setAddDate(position.dateAdded); setAddLeverage(position.leverage.toString()); setEditId(position.id);
    } else {
      setAddSymbol(currentSymbol || ''); setAddQty(''); setAddPrice('');
      setAddDate(getTodayString()); setAddLeverage('1'); setEditId(null);
    }
    setTransactionType('buy'); setShowAddModal(true);
    if (currentSymbol) {
      fetchSinglePrice(currentSymbol).then(result => {
        if (result) {
          let finalPrice = result.price;
          if (isCryptoSymbol(currentSymbol.replace('.NS', '').replace('.BO', '')) && result.market === 'IN' && result.tvExchange === 'BINANCE') {
            finalPrice *= cryptoUsdInrRateRef.current;
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
    const leverage = parseFloat(addLeverage) || 1;
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
  }, [addSymbol, addQty, addPrice, addLeverage, addDate, transactionType, editId, modalPrice, portfolio]);

  const pushTelegramReport = useCallback(async () => {
    const msg = `🧠 <b>Quantum AI Master Report</b>\n\n🌍 <b>Global State:</b> ${sentiment.text}\n\n💼 <b>Total Equity:</b> ₹${Math.round(metrics.totalValue).toLocaleString('en-IN')}\n📈 <b>P&L:</b> ${metrics.totalPL >= 0 ? '+' : ''}₹${Math.round(metrics.totalPL).toLocaleString('en-IN')} (${metrics.plPct.toFixed(2)}%)\n⚡ <b>Today:</b> ${metrics.todayPL >= 0 ? '+' : ''}₹${Math.round(metrics.todayPL).toLocaleString('en-IN')}`;
    await sendTelegramAlert(TG_TOKEN, TG_CHAT_ID, msg);
    setSyncStatus('✅ Sent'); setTimeout(() => setSyncStatus(''), 3000);
  }, [sentiment, metrics]);

  const toggleTheme = useCallback(() => {
    const newTheme = theme === 'dark' ? 'light' : 'dark';
    setTheme(newTheme); secureStorage.setItem('theme', newTheme);
  }, [theme]);

  const flushCache = useCallback(() => {
    const groqSaved = secureStorage.getItem('WEALTH_AI_GROQ');
    const themeSaved = secureStorage.getItem('theme');
    secureStorage.clear();
    if (groqSaved) secureStorage.setItem('WEALTH_AI_GROQ', groqSaved);
    if (themeSaved) secureStorage.setItem('theme', themeSaved);
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
    addPrice, setAddPrice, addDate, setAddDate, addLeverage, setAddLeverage,
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
    totalSIP, cagr, months, totalInvestedPlanner, rate, fvMed, fvWorst, fvBest, multiplier,
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
