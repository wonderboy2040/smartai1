import React, { useMemo, useState } from 'react';
import { useApp } from '../hooks/AppContext';
import { guessMarket } from '../utils/constants';

// ============================================================
// PRICE ALERTS PANEL
// Per-asset target / stop-loss alerts. When a live price crosses
// a threshold the app fires a Telegram notification (handled in
// useAppState's alert watcher). Alerts persist in localStorage.
// ============================================================

const PriceAlertsPanel = React.memo(function PriceAlertsPanel() {
  const {
    priceAlerts, addPriceAlert, updatePriceAlert, deletePriceAlert, togglePriceAlert,
    portfolio, livePrices,
  } = useApp();

  const [open, setOpen] = useState(false);
  const [symbol, setSymbol] = useState('');
  const [market, setMarket] = useState<'IN' | 'US'>('IN');
  const [target, setTarget] = useState('');
  const [stopLoss, setStopLoss] = useState('');
  const [note, setNote] = useState('');

  // suggest symbols from current portfolio for quick-fill
  const portfolioSymbols = useMemo(
    () => [...new Set(portfolio.map(p => `${p.symbol}|${p.market}`))],
    [portfolio]
  );

  const livePriceFor = (sym: string, mkt: 'IN' | 'US') => livePrices[`${mkt}_${sym}`]?.price;

  const handleAdd = () => {
    const sym = symbol.trim().toUpperCase();
    const t = target.trim() ? parseFloat(target) : null;
    const sl = stopLoss.trim() ? parseFloat(stopLoss) : null;
    if (!sym) { alert('Symbol daalo bhai.'); return; }
    if (t == null && sl == null) { alert('Target ya stop-loss me se ek to daalo.'); return; }
    if ((t != null && (isNaN(t) || t <= 0)) || (sl != null && (isNaN(sl) || sl <= 0))) {
      alert('Price valid number hona chahiye.'); return;
    }
    addPriceAlert({ symbol: sym, market, target: t, stopLoss: sl, note: note.trim() });
    setSymbol(''); setTarget(''); setStopLoss(''); setNote('');
  };

  const activeCount = priceAlerts.filter(a => a.enabled).length;

  return (
    <div className="quantum-panel rounded-2xl overflow-hidden animate-fade-in-up">
      <button
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center justify-between px-5 py-4 hover:bg-white/[0.02] transition-colors"
      >
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-amber-500/10 flex items-center justify-center text-base">🔔</div>
          <div className="text-left">
            <div className="text-sm font-black text-white">Price Alerts</div>
            <div className="text-[10px] text-slate-500">{activeCount} active · target / stop-loss → Telegram</div>
          </div>
        </div>
        <span className={`text-slate-500 transition-transform ${open ? 'rotate-180' : ''}`}>▼</span>
      </button>

      {open && (
        <div className="px-4 pb-4 border-t border-white/5">
          {/* Add form */}
          <div className="grid grid-cols-2 sm:grid-cols-6 gap-2 mt-3 mb-3 items-end">
            <div className="flex flex-col col-span-2 sm:col-span-1">
              <label className="text-[9px] text-slate-500 font-bold uppercase tracking-wider mb-1">Symbol</label>
              <input
                value={symbol}
                onChange={e => { const v = e.target.value.toUpperCase(); setSymbol(v); setMarket(guessMarket(v)); }}
                placeholder="e.g. AAPL"
                className="quantum-input rounded-lg px-2 py-1.5 text-xs text-white uppercase font-bold bg-slate-900/60"
                list="alert-symbols"
              />
              <datalist id="alert-symbols">
                {portfolioSymbols.map(s => { const [sym] = s.split('|'); return <option key={s} value={sym.replace('.NS', '')} />; })}
              </datalist>
            </div>
            <div className="flex flex-col">
              <label className="text-[9px] text-slate-500 font-bold uppercase tracking-wider mb-1">Market</label>
              <select value={market} onChange={e => setMarket(e.target.value as 'IN' | 'US')}
                className="quantum-input rounded-lg px-2 py-1.5 text-xs text-white bg-slate-900/60">
                <option value="IN">🇮🇳 IN</option>
                <option value="US">🇺🇸 US</option>
              </select>
            </div>
            <div className="flex flex-col">
              <label className="text-[9px] text-emerald-500 font-bold uppercase tracking-wider mb-1">🎯 Target</label>
              <input type="number" value={target} onChange={e => setTarget(e.target.value)} placeholder="—"
                className="quantum-input rounded-lg px-2 py-1.5 text-xs text-white bg-slate-900/60" />
            </div>
            <div className="flex flex-col">
              <label className="text-[9px] text-red-500 font-bold uppercase tracking-wider mb-1">🛑 Stop-Loss</label>
              <input type="number" value={stopLoss} onChange={e => setStopLoss(e.target.value)} placeholder="—"
                className="quantum-input rounded-lg px-2 py-1.5 text-xs text-white bg-slate-900/60" />
            </div>
            <div className="flex flex-col col-span-2 sm:col-span-1">
              <label className="text-[9px] text-slate-500 font-bold uppercase tracking-wider mb-1">Note</label>
              <input value={note} onChange={e => setNote(e.target.value)} placeholder="optional"
                className="quantum-input rounded-lg px-2 py-1.5 text-xs text-white bg-slate-900/60" />
            </div>
            <button onClick={handleAdd}
              className="quantum-btn-primary px-3 py-2 bg-gradient-to-r from-amber-500 to-orange-600 rounded-lg font-bold text-xs text-white col-span-2 sm:col-span-1">
              + Add Alert
            </button>
          </div>

          {/* Alerts list */}
          <div className="space-y-2 max-h-[360px] overflow-y-auto">
            {priceAlerts.length === 0 && (
              <div className="p-6 text-center text-slate-500 text-sm">No alerts yet. Add a target or stop-loss above.</div>
            )}
            {priceAlerts.map(a => {
              const c = a.market === 'IN' ? '₹' : '$';
              const live = livePriceFor(a.symbol, a.market);
              const towardTarget = a.target != null && live ? Math.min(100, (live / a.target) * 100) : null;
              return (
                <div key={a.id} className={`rounded-xl border p-3 flex items-center justify-between gap-3 flex-wrap ${a.enabled ? 'border-white/10 bg-black/20' : 'border-white/5 bg-black/10 opacity-60'}`}>
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="font-black text-white text-sm">{a.symbol.replace('.NS', '')}</span>
                    <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded ${a.market === 'IN' ? 'bg-orange-500/10 text-orange-400' : 'bg-blue-500/10 text-blue-400'}`}>
                      {a.market === 'IN' ? 'NSE' : 'US'}
                    </span>
                    {live != null && <span className="text-[10px] text-slate-400 font-mono">LTP {c}{live.toFixed(2)}</span>}
                    {a.triggeredType && a.lastTriggered && (
                      <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded ${a.triggeredType === 'target' ? 'bg-emerald-500/15 text-emerald-400' : 'bg-red-500/15 text-red-400'}`}>
                        {a.triggeredType === 'target' ? '🎯 hit' : '🛑 hit'}
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-3 text-xs font-mono">
                    {a.target != null && <span className="text-emerald-400">🎯 {c}{a.target.toFixed(2)}</span>}
                    {a.stopLoss != null && <span className="text-red-400">🛑 {c}{a.stopLoss.toFixed(2)}</span>}
                    {a.note && <span className="text-slate-500 italic max-w-[120px] truncate">{a.note}</span>}
                  </div>
                  <div className="flex items-center gap-1.5">
                    <button onClick={() => togglePriceAlert(a.id)}
                      className={`px-2 py-1 rounded-lg text-[10px] font-bold border ${a.enabled ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20' : 'bg-white/5 text-slate-400 border-white/10'}`}
                      title={a.enabled ? 'Disable' : 'Enable'}>
                      {a.enabled ? 'ON' : 'OFF'}
                    </button>
                    <button
                      onClick={() => {
                        const t = prompt('New target price (blank = none):', a.target != null ? String(a.target) : '');
                        if (t === null) return;
                        const sl = prompt('New stop-loss price (blank = none):', a.stopLoss != null ? String(a.stopLoss) : '');
                        if (sl === null) return;
                        const tNum = t.trim() ? parseFloat(t) : null;
                        const slNum = sl.trim() ? parseFloat(sl) : null;
                        updatePriceAlert(a.id, { target: tNum, stopLoss: slNum });
                      }}
                      className="px-2 py-1 rounded-lg bg-cyan-500/10 hover:bg-cyan-500/20 border border-cyan-500/20 text-[10px] font-bold text-cyan-400" title="Edit thresholds">✏️</button>
                    <button onClick={() => deletePriceAlert(a.id)}
                      className="px-2 py-1 rounded-lg bg-red-500/10 hover:bg-red-500/20 border border-red-500/20 text-[10px] font-bold text-red-400" title="Delete">🗑️</button>
                  </div>
                  {towardTarget != null && a.enabled && (
                    <div className="w-full h-1 bg-slate-800/80 rounded-full overflow-hidden mt-1">
                      <div className="h-full bg-emerald-500 rounded-full transition-all" style={{ width: `${towardTarget}%` }} />
                    </div>
                  )}
                </div>
              );
            })}
          </div>
          <p className="text-[9px] text-slate-600 mt-2">
            Alerts check live prices every 20s. On a hit, a Telegram message is sent (4-hour cooldown per alert). Requires Telegram configured (local token or the 24×7 bot proxy).
          </p>
        </div>
      )}
    </div>
  );
});

export default PriceAlertsPanel;
