import { lazy, Suspense, useEffect, useState } from 'react';
import { TabType } from './types';
import { secureStorage } from './utils/secureStorage';
import { useAppState } from './hooks/useAppState';
import { AppContext } from './hooks/AppContext';
import { PortfolioHealthMonitor } from './components/PortfolioHealthMonitor';
import { ErrorBoundary } from './components/ErrorBoundary';
import { Clock } from './components/Clock';
import { InstallPWA } from './components/InstallPWA';

// Lazy load with auto-recovery: after a fresh deploy the cached index.html can
// reference old hashed chunks that no longer exist ("Failed to fetch dynamically
// imported module"). On first failure we force one full reload to pick up the new
// build; if it fails again, the error surfaces normally to the ErrorBoundary.
function lazyWithRetry(importFn: () => Promise<any>, name: string) {
  return lazy(() =>
    importFn().catch((err: unknown) => {
      const key = `chunk_reload_${name}`;
      if (!sessionStorage.getItem(key)) {
        sessionStorage.setItem(key, '1');
        window.location.reload();
        return new Promise<never>(() => {}); // suspend while the page reloads
      }
      sessionStorage.removeItem(key);
      throw err;
    })
  );
}

// Lazy load all tab components for faster initial load
const DashboardTab = lazyWithRetry(() => import('./components/tabs/DashboardTab'), 'dashboard');
const IntradayProTab = lazyWithRetry(() => import('./components/tabs/IntradayProTab'), 'intraday');
const PortfolioTab = lazyWithRetry(() => import('./components/tabs/PortfolioTab'), 'portfolio');
const PlannerTab = lazyWithRetry(() => import('./components/tabs/PlannerTab'), 'planner');
const MacroTab = lazyWithRetry(() => import('./components/tabs/MacroTab').then(m => ({ default: m.MacroTab })), 'macro');
const GuideTab = lazyWithRetry(() => import('./components/tabs/GuideTab').then(m => ({ default: m.GuideTab })), 'guide');
const DeepScanTab = lazyWithRetry(() => import('./components/tabs/DeepScanTab'), 'deepscan');

const NeuralChat = lazyWithRetry(() => import('./components/NeuralChat').then(m => ({ default: m.NeuralChat })), 'neuralchat');

export default function App() {
  const state = useAppState();

  const [tgToken, setTgToken] = useState('');
  const [tgChatId, setTgChatId] = useState('');
  const [formError, setFormError] = useState('');
  useEffect(() => {
    Promise.all([secureStorage.getItemAsync('TG_TOKEN'), secureStorage.getItemAsync('TG_CHAT_ID')])
      .then(([token, chatId]) => {
        if (token) setTgToken(token);
        if (chatId) setTgChatId(chatId);
      });
  }, []);

  const {
    isAuthenticated, pinInput, setPinInput, verifyPin, logout,
    activeTab, setActiveTab, portfolio, livePrices, metrics,
    theme, toggleTheme, flushCache, autoTelegram, setAutoTelegram,
    liveStatus,
    showAddModal, setShowAddModal,
    addSymbol, setAddSymbol, addQty, setAddQty, addPrice, setAddPrice,
    addDate, setAddDate,
    transactionType, setTransactionType, modalPrice,
    savePosition, usdInrRate, portfolioContextText,
    refreshAll, isRefreshing,
  } = state;

  // Keyboard Shortcuts for Tabs (1-7)
  useEffect(() => {
    if (!isAuthenticated) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      // Ignore if user is typing in an input
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      const tabs: TabType[] = ['dashboard', 'intraday', 'portfolio', 'deepmind', 'planner', 'macro', 'guide'];
      const key = parseInt(e.key);
      if (!isNaN(key) && key >= 1 && key <= 7) {
        setActiveTab(tabs[key - 1]);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isAuthenticated, setActiveTab]);

  // Auth Screen
  if (!isAuthenticated) {
    return (
      <div className="min-h-screen login-bg flex items-center justify-center p-4">
        <div className="login-card quantum-modal rounded-3xl p-8 max-w-sm w-full animate-scale-in">
          <div className="text-center mb-8">
            <div className="relative inline-block">
              <div className="text-7xl mb-2 animate-float">💎</div>
              <div className="absolute -inset-4 bg-cyan-500/10 rounded-full blur-xl pointer-events-none" />
            </div>
            <h1 className="text-3xl font-black gradient-text-cyan font-display text-glow mt-4">Wealth AI</h1>
            <div className="flex items-center justify-center gap-2 mt-2">
              <span className="quantum-badge">QUANTUM TERMINAL</span>
            </div>
            <p className="text-slate-500 text-sm mt-3">Secure PIN enter karein</p>
          </div>
          <div className="relative z-10">
            <input type="password" value={pinInput} onChange={e => setPinInput(e.target.value)} onKeyDown={e => e.key === 'Enter' && verifyPin()} placeholder="••••" maxLength={4} className="w-full text-center px-4 py-5 quantum-input rounded-2xl text-3xl tracking-[0.5em] text-cyan-400 font-bold mb-5 font-mono placeholder-slate-700 relative z-10" />
          </div>
          <button onClick={verifyPin} className="quantum-btn-primary w-full py-4 bg-gradient-to-r from-cyan-500 to-purple-600 animate-gradient rounded-2xl font-bold text-white text-lg relative z-10">🔓 Unlock Terminal</button>
          <div className="text-center mt-5 relative z-10">
            <span className="text-[10px] text-slate-600 font-mono tracking-wider">ENCRYPTED • AES-256 • NEURAL LOCKED</span>
          </div>
        </div>
      </div>
    );
  }

  return (
    <AppContext.Provider value={state}>
      <div className={`min-h-screen bg-gradient-to-br from-slate-950 via-[#0a0f1e] to-slate-950 text-slate-200 ${theme}`}>
        {/* Header */}
        <header className="sticky top-0 z-40 quantum-appbar border-b border-white/5">
          {/* Ticker */}
          <div className="ticker-wrapper py-1.5 border-b border-white/5 bg-black/30">
            <div className="ticker-content">
              {[0, 1].map(i => (
                <div key={i} className="flex items-center gap-8 px-4 whitespace-nowrap text-xs font-mono">
                  <span className="text-cyan-500/80 font-semibold">⚡ QUANTUM NEURAL ENGINE</span>
                  <span className="text-slate-500">│</span>
                  <span className="text-slate-400">VIX US <strong className={state.usVix > 20 ? 'text-red-400' : 'text-emerald-400'}>{state.usVix.toFixed(1)}</strong></span>
                  <span className="text-slate-500">│</span>
                  <span className="text-slate-400">VIX IN <strong className={state.inVix > 20 ? 'text-red-400' : 'text-emerald-400'}>{state.inVix.toFixed(1)}</strong></span>
                  <span className="text-slate-500">│</span>
                  <span className={state.sentiment.color}>{state.sentiment.text}</span>
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
                    <h1 className="text-lg font-black gradient-text-cyan font-display uppercase tracking-wider text-glow">WEALTH AI</h1>
                    <span className="quantum-badge">v14.0 LTI</span>
                  </div>
                  <div className="flex items-center gap-2 text-[11px]">
                    <span className={`w-1.5 h-1.5 rounded-full ${/ACTIVE|LIVE/i.test(liveStatus) ? 'bg-cyan-400 animate-pulse-dot' : 'bg-amber-500 animate-pulse'}`} />
                    <span className={`font-medium ${/ACTIVE|LIVE/i.test(liveStatus) ? 'text-cyan-500/80' : 'text-amber-400/80'}`}>{/ACTIVE|LIVE/i.test(liveStatus) ? 'LIVE' : 'SYNCING'}</span>
                    <span className="text-slate-700">•</span>
                    <Clock />
                  </div>
                </div>
              </div>

              {/* Tabs */}
              <div className="flex gap-0.5 quantum-panel p-1 rounded-2xl overflow-x-auto scrollbar-hide flex-shrink-0">
                {(['dashboard', 'intraday', 'portfolio', 'deepmind', 'planner', 'macro', 'guide'] as TabType[]).map(tab => (
                  <button key={tab} onClick={() => setActiveTab(tab)} className={`quantum-tab px-3 sm:px-4 py-2 rounded-xl font-semibold text-xs sm:text-sm whitespace-nowrap flex-shrink-0 ${activeTab === tab ? 'active' : 'text-slate-500 hover:text-slate-300 hover:bg-white/[0.03]'}`}>
                    <span className="hidden sm:inline">{tab === 'dashboard' && '📊 Dashboard'}{tab === 'intraday' && '⚡ Intraday Pro'}{tab === 'portfolio' && '💼 Portfolio'}{tab === 'deepmind' && '🧠 DeepMind'}{tab === 'planner' && '🎯 Planner'}{tab === 'macro' && '🌍 Risk'}{tab === 'guide' && '📖 Guide'}</span>
                    <span className="sm:hidden">{tab === 'dashboard' && '📊'}{tab === 'intraday' && '⚡'}{tab === 'portfolio' && '💼'}{tab === 'deepmind' && '🧠'}{tab === 'planner' && '🎯'}{tab === 'macro' && '🌍'}{tab === 'guide' && '📖'}</span>
                  </button>
                ))}
              </div>

              <div className="flex gap-2 relative">
                <button onClick={() => setAutoTelegram(prev => !prev)} className={`quantum-btn-ghost p-2 rounded-xl text-lg transition-all ${autoTelegram ? 'bg-emerald-500/10 border border-emerald-500/30' : ''}`} title={autoTelegram ? 'Auto Alerts ON' : 'Auto Alerts OFF'}>🔔</button>
                <button onClick={toggleTheme} className="w-10 h-10 rounded-xl flex items-center justify-center hover:bg-white/10 transition-colors text-lg" title={`Toggle ${theme === 'dark' ? 'Light' : 'Dark'} Mode`}>🌞</button>
                <button onClick={refreshAll} disabled={isRefreshing} className="quantum-btn-ghost p-2 rounded-xl text-lg disabled:opacity-50" title="Refresh All (prices + forex)"><span className={isRefreshing ? 'inline-block animate-spin' : ''}>🔄</span></button>
                <button onClick={flushCache} className="quantum-btn-ghost p-2 rounded-xl text-lg" title="Flush Cache">🧹</button>
                <button onClick={logout} className="quantum-btn-ghost p-2 rounded-xl text-lg" title="Logout">🔐</button>
              </div>
            </div>
          </div>
        </header>

        <main className="container mx-auto px-4 py-6">
          <Suspense fallback={<div className="flex items-center justify-center py-20"><div className="text-center"><div className="text-4xl mb-3 animate-float">⚡</div><div className="text-sm text-slate-500 font-medium">Loading module...</div></div></div>}>
            <ErrorBoundary fallback={<div className="quantum-panel rounded-2xl p-8 text-center border border-red-500/20"><div className="text-4xl mb-3">🚨</div><div className="text-red-400 font-bold mb-2">Tab crashed</div><div className="text-slate-500 text-sm">Reload or switch tabs</div></div>}>
              {activeTab === 'dashboard' && <DashboardTab />}
              {activeTab === 'intraday' && <IntradayProTab />}
              {activeTab === 'portfolio' && <PortfolioTab />}
              {activeTab === 'deepmind' && <DeepScanTab />}
              {activeTab === 'planner' && <PlannerTab />}
              {activeTab === 'macro' && <MacroTab />}
              {activeTab === 'guide' && <GuideTab />}
            </ErrorBoundary>
          </Suspense>
        </main>

        {/* Add/Edit Modal */}
        {showAddModal && (
          <div className="fixed inset-0 bg-black/80 backdrop-blur-xl z-50 flex items-center justify-center p-4 animate-fade-in">
            <div className="quantum-modal rounded-2xl w-full max-w-md shadow-2xl animate-scale-in">
              <div className="p-5 border-b border-white/5 flex justify-between items-center">
                <h3 className="text-lg font-bold text-white">{transactionType === 'sell' ? '📉 Sell Asset' : '➕ Add Asset'}</h3>
                <button onClick={() => setShowAddModal(false)} className="w-8 h-8 rounded-lg bg-white/5 hover:bg-red-500/20 flex items-center justify-center text-lg text-slate-400 hover:text-red-400 transition-all">✕</button>
              </div>
              <div className="p-5 space-y-4">
                <div>
                  <label className="text-slate-500 text-[10px] font-bold uppercase tracking-wider mb-1.5 block">Symbol</label>
                  <div className="flex gap-2">
                    <input type="text" value={addSymbol} onChange={e => { setAddSymbol(e.target.value.toUpperCase()); setFormError(''); }} placeholder="e.g. AAPL, RELIANCE" className="flex-1 px-4 py-2.5 quantum-input rounded-xl uppercase font-bold text-white" />
                  </div>
                </div>
                {modalPrice && (
                  <div className="quantum-panel rounded-xl p-3 flex justify-between items-center">
                    <span className="text-slate-500 text-[10px] uppercase font-bold tracking-wider">Live Price</span>
                    <div className="text-right">
                      <span className={`text-xl font-black font-mono ${modalPrice.change >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>{modalPrice.market === 'IN' ? '₹' : '$'}{modalPrice.price.toFixed(2)}</span>
                      <div className={`text-xs ${modalPrice.change >= 0 ? 'text-emerald-500' : 'text-red-500'}`}>{modalPrice.change >= 0 ? '+' : ''}{modalPrice.change.toFixed(2)}%</div>
                    </div>
                  </div>
                )}
                <div className="flex gap-1 bg-black/30 rounded-xl p-1">
                  <button onClick={() => setTransactionType('buy')} className={`flex-1 py-2 rounded-lg font-semibold text-sm transition-all ${transactionType === 'buy' ? 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/20' : 'text-slate-500'}`}>📈 BUY</button>
                  <button onClick={() => setTransactionType('sell')} className={`flex-1 py-2 rounded-lg font-semibold text-sm transition-all ${transactionType === 'sell' ? 'bg-red-500/15 text-red-400 border border-red-500/20' : 'text-slate-500'}`}>📉 SELL</button>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div><label className="text-slate-500 text-[10px] font-bold uppercase tracking-wider mb-1.5 block">Quantity</label><input type="number" value={addQty} onChange={e => { setAddQty(e.target.value); setFormError(''); }} placeholder="0" min="0" step="any" className="w-full px-4 py-2.5 quantum-input rounded-xl font-bold text-lg text-white" /></div>
                  <div><label className="text-slate-500 text-[10px] font-bold uppercase tracking-wider mb-1.5 block">Price</label><input type="number" value={addPrice} onChange={e => { setAddPrice(e.target.value); setFormError(''); }} placeholder="0.00" min="0" step="any" className="w-full px-4 py-2.5 quantum-input rounded-xl font-bold text-lg text-white" /></div>
                </div>
                <div>
                  <label className="text-slate-500 text-[10px] font-bold uppercase tracking-wider mb-1.5 block">Date</label>
                  <input type="date" value={addDate} onChange={e => setAddDate(e.target.value)} className="w-full px-4 py-2.5 quantum-input rounded-xl text-slate-300" />
                </div>
              </div>
              {formError && <div className="px-5 pb-0"><p className="text-red-400 text-xs font-semibold bg-red-500/10 rounded-xl px-3 py-2">{formError}</p></div>}
              <div className="p-5 border-t border-white/5">
                <button onClick={() => {
                  if (!addSymbol.trim()) { setFormError('Symbol required'); return; }
                  const q = parseFloat(addQty); const p = parseFloat(addPrice);
                  if (isNaN(q) || q <= 0) { setFormError('Invalid quantity'); return; }
                  if (isNaN(p) || p <= 0) { setFormError('Invalid price'); return; }
                  if (!addDate) { setFormError('Date required'); return; }
                  setFormError(''); savePosition();
                }} className="quantum-btn-primary w-full py-3 bg-gradient-to-r from-cyan-600 to-indigo-600 rounded-xl font-bold text-white">💾 Save</button>
              </div>
            </div>
          </div>
        )}

        {/* PWA install prompt */}
        <InstallPWA />

        {/* Portfolio Health Monitor */}
        <PortfolioHealthMonitor portfolio={portfolio} livePrices={livePrices} metrics={metrics} telegramConfig={{ token: tgToken, chatId: tgChatId, enabled: autoTelegram }} />

        {/* Neural Chat */}
        <ErrorBoundary fallback={<div className="fixed bottom-6 right-6 w-14 h-14 bg-red-500/20 border border-red-500/30 rounded-2xl flex items-center justify-center text-red-400 z-[60]">⚠</div>}>
          <Suspense fallback={<div className="fixed bottom-6 right-6 w-80 h-96 quantum-panel rounded-2xl flex items-center justify-center animate-pulse"><div className="text-center"><div className="text-4xl mb-2 animate-float">🧠</div><div className="text-sm text-slate-400 font-medium">Loading AI Engine...</div></div></div>}>
            <NeuralChat portfolioContext={portfolioContextText || 'System initialized. Awaiting data...'} usdInrRate={usdInrRate} />
          </Suspense>
        </ErrorBoundary>
      </div>
    </AppContext.Provider>
  );
}
