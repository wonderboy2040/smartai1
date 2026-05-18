import { lazy, Suspense } from 'react';
import { TabType } from './types';
import { TG_TOKEN, TG_CHAT_ID } from './utils/constants';
import { useAppState } from './hooks/useAppState';
import { AppContext } from './hooks/AppContext';
import { PortfolioHealthMonitor } from './components/PortfolioHealthMonitor';
import { Clock } from './components/Clock';

// Lazy load all tab components for faster initial load
const DashboardTab = lazy(() => import('./components/tabs/DashboardTab'));
const PortfolioTab = lazy(() => import('./components/tabs/PortfolioTab'));
const PlannerTab = lazy(() => import('./components/tabs/PlannerTab'));
const MacroTab = lazy(() => import('./components/tabs/MacroTab').then(m => ({ default: m.MacroTab })));
const GuideTab = lazy(() => import('./components/tabs/GuideTab').then(m => ({ default: m.GuideTab })));

const NeuralChat = lazy(() => import('./components/NeuralChat').then(m => ({ default: m.NeuralChat })));

export default function App() {
  const state = useAppState();

  const {
    isAuthenticated, pinInput, setPinInput, verifyPin, logout,
    activeTab, setActiveTab, portfolio, livePrices, metrics,
    theme, toggleTheme, flushCache, autoTelegram, setAutoTelegram,
    liveStatus, pushTelegramReport,
    showAddModal, setShowAddModal, groqKey,
    addSymbol, setAddSymbol, addQty, setAddQty, addPrice, setAddPrice,
    addDate, setAddDate, addLeverage, setAddLeverage,
    transactionType, setTransactionType, modalPrice,
    savePosition, usdInrRate, portfolioContextText,
  } = state;

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
                    <h1 className="text-lg font-black gradient-text-cyan font-display uppercase tracking-wider text-glow">QUANTUM_TRADE</h1>
                    <span className="quantum-badge">v12.0 PRO</span>
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
              <div className="flex gap-0.5 quantum-panel p-1 rounded-2xl overflow-x-auto scrollbar-hide flex-shrink-0">
                {(['dashboard', 'portfolio', 'planner', 'macro', 'guide'] as TabType[]).map(tab => (
                  <button key={tab} onClick={() => setActiveTab(tab)} className={`quantum-tab px-3 sm:px-4 py-2 rounded-xl font-semibold text-xs sm:text-sm whitespace-nowrap flex-shrink-0 ${activeTab === tab ? 'active' : 'text-slate-500 hover:text-slate-300 hover:bg-white/[0.03]'}`}>
                    <span className="hidden sm:inline">{tab === 'dashboard' && '📊 Dashboard'}{tab === 'portfolio' && '💼 Portfolio'}{tab === 'planner' && '🎯 Planner'}{tab === 'macro' && '🌍 Risk'}{tab === 'guide' && '📖 Guide'}</span>
                    <span className="sm:hidden">{tab === 'dashboard' && '📊'}{tab === 'portfolio' && '💼'}{tab === 'planner' && '🎯'}{tab === 'macro' && '🌍'}{tab === 'guide' && '📖'}</span>
                  </button>
                ))}
              </div>

              <div className="flex gap-2 relative">
                <button onClick={() => setAutoTelegram(prev => !prev)} className={`quantum-btn-ghost p-2 rounded-xl text-lg transition-all ${autoTelegram ? 'bg-emerald-500/10 border border-emerald-500/30' : ''}`} title={autoTelegram ? 'Auto Alerts ON' : 'Auto Alerts OFF'}>🔔</button>
                <button onClick={toggleTheme} className="w-10 h-10 rounded-xl flex items-center justify-center hover:bg-white/10 transition-colors text-lg" title={`Toggle ${theme === 'dark' ? 'Light' : 'Dark'} Mode`}>🌞</button>
                <button onClick={() => window.location.reload()} className="quantum-btn-ghost p-2 rounded-xl text-lg" title="Refresh">🔄</button>
                <button onClick={flushCache} className="quantum-btn-ghost p-2 rounded-xl text-lg" title="Flush Cache">🧹</button>
                <button onClick={logout} className="quantum-btn-ghost p-2 rounded-xl text-lg" title="Logout">🔐</button>
              </div>
            </div>
          </div>
        </header>

        <main className="container mx-auto px-4 py-6">
          <Suspense fallback={<div className="flex items-center justify-center py-20"><div className="text-center"><div className="text-4xl mb-3 animate-float">⚡</div><div className="text-sm text-slate-500 font-medium">Loading module...</div></div></div>}>
            {activeTab === 'dashboard' && <DashboardTab />}
            {activeTab === 'portfolio' && <PortfolioTab />}
            {activeTab === 'planner' && <PlannerTab />}
            {activeTab === 'macro' && <MacroTab />}
            {activeTab === 'guide' && <GuideTab />}
          </Suspense>
        </main>

        {/* Add/Edit Modal */}
        {showAddModal && (
          <div className="fixed inset-0 bg-black/80 backdrop-blur-xl z-50 flex items-center justify-center p-4 animate-fade-in">
            <div className="quantum-modal rounded-2xl w-full max-w-md shadow-2xl animate-scale-in">
              <div className="p-5 border-b border-white/5 flex justify-between items-center">
                <h3 className="text-lg font-bold text-white">{transactionType === 'sell' ? '📉 Sell Asset' : '➕ Add Asset'}</h3>
                <button onClick={() => { setShowAddModal(false); setAddLeverage('1'); }} className="w-8 h-8 rounded-lg bg-white/5 hover:bg-red-500/20 flex items-center justify-center text-lg text-slate-400 hover:text-red-400 transition-all">✕</button>
              </div>
              <div className="p-5 space-y-4">
                <div>
                  <label className="text-slate-500 text-[10px] font-bold uppercase tracking-wider mb-1.5 block">Symbol</label>
                  <div className="flex gap-2">
                    <input type="text" value={addSymbol} onChange={e => setAddSymbol(e.target.value.toUpperCase())} placeholder="e.g. AAPL, RELIANCE" className="flex-1 px-4 py-2.5 quantum-input rounded-xl uppercase font-bold text-white" />
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
                  <div><label className="text-slate-500 text-[10px] font-bold uppercase tracking-wider mb-1.5 block">Quantity</label><input type="number" value={addQty} onChange={e => setAddQty(e.target.value)} placeholder="0" className="w-full px-4 py-2.5 quantum-input rounded-xl font-bold text-lg text-white" /></div>
                  <div><label className="text-slate-500 text-[10px] font-bold uppercase tracking-wider mb-1.5 block">Price</label><input type="number" value={addPrice} onChange={e => setAddPrice(e.target.value)} placeholder="0.00" className="w-full px-4 py-2.5 quantum-input rounded-xl font-bold text-lg text-white" /></div>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div><label className="text-slate-500 text-[10px] font-bold uppercase tracking-wider mb-1.5 block">Date</label><input type="date" value={addDate} onChange={e => setAddDate(e.target.value)} className="w-full px-4 py-2.5 quantum-input rounded-xl text-slate-300" /></div>
                  <div><label className="text-slate-500 text-[10px] font-bold uppercase tracking-wider mb-1.5 block">Leverage</label><select value={addLeverage} onChange={e => setAddLeverage(e.target.value)} className="w-full px-4 py-2.5 quantum-input rounded-xl text-slate-300"><option value="1">1x (Cash)</option><option value="2">2x MTF</option><option value="3">3x</option><option value="5">5x</option></select></div>
                </div>
              </div>
              <div className="p-5 border-t border-white/5">
                <button onClick={savePosition} className="quantum-btn-primary w-full py-3 bg-gradient-to-r from-cyan-600 to-indigo-600 rounded-xl font-bold text-white">💾 Save</button>
              </div>
            </div>
          </div>
        )}

        {/* Portfolio Health Monitor */}
        <PortfolioHealthMonitor portfolio={portfolio} livePrices={livePrices} metrics={metrics} telegramConfig={{ token: TG_TOKEN, chatId: TG_CHAT_ID, enabled: autoTelegram }} />

        {/* Neural Chat */}
        <Suspense fallback={<div className="fixed bottom-6 right-6 w-80 h-96 quantum-panel rounded-2xl flex items-center justify-center animate-pulse"><div className="text-center"><div className="text-4xl mb-2 animate-float">🧠</div><div className="text-sm text-slate-400 font-medium">Loading AI Engine...</div></div></div>}>
          <NeuralChat groqKey={groqKey} portfolioContext={portfolioContextText || 'System initialized. Awaiting data...'} onTelegramPush={pushTelegramReport} usdInrRate={usdInrRate} />
        </Suspense>
      </div>
    </AppContext.Provider>
  );
}
