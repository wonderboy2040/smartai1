import React, { useEffect, useMemo, useState } from 'react';
import { useApp } from '../../hooks/AppContext';
import { scanAlgoSignals, AlgoSignal } from '../../utils/algoEngine';
import { TradeWallet, AngelOrder, AngelHolding, AngelPosition } from '../../types';

const API = (path: string) => `/api/trade/${path}`;

function cur(m: string) { return m === 'IN' ? '₹' : '$'; }

function dirStyle(d: AlgoSignal['direction']) {
  return d === 'LONG' ? 'text-emerald-400 bg-emerald-500/10 border-emerald-500/30'
    : d === 'SHORT' ? 'text-red-400 bg-red-500/10 border-red-500/30'
      : 'text-amber-400 bg-amber-500/10 border-amber-500/30';
}

function statusColor(s: string) {
  if (s === 'complete' || s === 'filled') return 'text-emerald-400';
  if (s === 'open' || s === 'pending') return 'text-yellow-400';
  if (s === 'cancelled' || s === 'rejected') return 'text-red-400';
  return 'text-slate-400';
}

interface SmartPick {
  sig: AlgoSignal;
  maxQty: number;
  cost: number;
  expectedProfit: number;
  expectedReturnPct: number;
  score: number;
}

const AlgoTradeTab = React.memo(function AlgoTradeTab() {
  const { portfolio, livePrices } = useApp();

  const [wallet, setWallet] = useState<TradeWallet | null>(null);
  const [orders, setOrders] = useState<AngelOrder[]>([]);
  const [holdings, setHoldings] = useState<AngelHolding[]>([]);
  const [positions, setPositions] = useState<AngelPosition[]>([]);
  const [placing, setPlacing] = useState<string | null>(null);
  const [placeMsg, setPlaceMsg] = useState('');
  const [msgType, setMsgType] = useState<'ok' | 'err'>('ok');
  const [tab, setTab] = useState<'smart' | 'positions' | 'orders' | 'holdings'>('smart');

  const watchKeys = useMemo(() => {
    const keys = new Set<string>();
    portfolio.forEach(p => keys.add(`${p.market}_${p.symbol}`));
    Object.keys(livePrices).forEach(k => keys.add(k));
    return [...keys].filter(k => !/_(INDIAVIX|VIX)$/i.test(k));
  }, [portfolio, livePrices]);

  const signals = useMemo(() => scanAlgoSignals(watchKeys, livePrices), [watchKeys, livePrices]);

  const cash = wallet ? parseFloat(wallet.availablecash || wallet.totalmargin || '0') : 0;
  const used = wallet ? parseFloat(wallet.utilisablemargin || '0') : 0;

  const smartPicks = useMemo((): SmartPick[] => {
    if (!cash) return [];
    const actionable = signals.filter(s => s.direction !== 'WAIT' && s.entry > 0);
    const picks: SmartPick[] = [];
    for (const sig of actionable) {
      const entry = sig.entry;
      const target1 = sig.target1;
      const maxQty = Math.floor(cash / entry);
      if (maxQty < 1) continue;
      const cost = maxQty * entry;
      const expectedReturnPct = ((target1 - entry) / entry) * 100;
      const expectedProfit = maxQty * (target1 - entry);
      const score = (expectedReturnPct * sig.conviction) / Math.max(sig.riskReward, 0.5);
      picks.push({ sig, maxQty, cost, expectedProfit, expectedReturnPct, score });
    }
    picks.sort((a, b) => b.score - a.score);
    return picks;
  }, [signals, cash]);

  const fetchWallet = async () => {
    try {
      const r = await fetch(API('wallet')); const j = await r.json();
      if (j && !j.error) setWallet(j);
    } catch {}
  };

  const fetchOrders = async () => {
    try {
      const r = await fetch(API('orders')); const j = await r.json();
      if (j?.orders) setOrders(j.orders);
    } catch {}
  };

  const fetchHoldings = async () => {
    try {
      const r = await fetch(API('holdings')); const j = await r.json();
      if (j?.holdings) setHoldings(j.holdings);
    } catch {}
  };

  const fetchPositions = async () => {
    try {
      const r = await fetch(API('positions')); const j = await r.json();
      if (j?.positions) setPositions(j.positions);
    } catch {}
  };

  const fetchAll = () => { fetchWallet(); fetchOrders(); fetchHoldings(); fetchPositions(); };

  useEffect(() => { fetchAll(); const id = setInterval(fetchAll, 10000); return () => clearInterval(id); }, []);

  const executeTrade = async (sig: AlgoSignal, qty: number) => {
    if (placing || qty < 1) return;
    setPlacing(sig.symbol); setPlaceMsg('');
    try {
      const r = await fetch(API('place'), {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          symbol: sig.symbol.includes('.NS') ? sig.symbol : `${sig.symbol}.NS`,
          side: sig.direction === 'LONG' ? 'BUY' : 'SELL',
          orderType: 'LIMIT', price: sig.entry, qty,
          variety: 'NORMAL', productType: 'DELIVERY', exchange: 'NSE',
        }),
      });
      const j = await r.json();
      if (j.orderId) { setPlaceMsg(`✅ ${sig.symbol}: ${j.orderId}`); setMsgType('ok'); setTimeout(fetchAll, 2000); }
      else { setPlaceMsg(`❌ ${j.error || 'Failed'}`); setMsgType('err'); }
    } catch (e: any) { setPlaceMsg(`❌ ${e?.message || 'Network error'}`); setMsgType('err'); }
    finally { setPlacing(null); setTimeout(() => setPlaceMsg(''), 4000); }
  };

  const cancelOrder = async (orderId: string) => {
    try {
      const r = await fetch(API('cancel'), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ orderId }) });
      const j = await r.json();
      if (j.message) setTimeout(fetchAll, 1500);
    } catch {}
  };

  return (
    <div className="space-y-5 animate-fade-in">
      {/* Header + Wallet */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-2xl font-black gradient-text-cyan font-display flex items-center gap-2">
            🤖 ALGO Trade <span className="quantum-badge text-[10px]">ADVANCE PRO</span>
          </h2>
          <p className="text-[11px] text-slate-500 mt-1">Smart Allocation · Wallet-Aware AI · Max Return</p>
        </div>
        <div className="flex items-center gap-2">
          <div className="quantum-panel rounded-xl px-4 py-2 border border-cyan-500/20 text-center bg-cyan-500/5">
            <div className="text-[10px] text-cyan-400/70 uppercase tracking-wider font-bold">Available</div>
            <div className="font-black text-2xl font-mono text-cyan-300">₹{cash.toLocaleString('en-IN')}</div>
          </div>
          {used > 0 && (
            <div className="quantum-panel rounded-xl px-4 py-2 border border-yellow-500/20 text-center bg-yellow-500/5">
              <div className="text-[10px] text-yellow-400/70 uppercase tracking-wider font-bold">Used</div>
              <div className="font-black font-mono text-yellow-300 text-lg">₹{used.toLocaleString('en-IN')}</div>
            </div>
          )}
        </div>
      </div>

      {/* Sub-tabs */}
      <div className="flex gap-2 border-b border-white/10 pb-2 overflow-x-auto">
        {([
          { k: 'smart', l: '🎯 Smart Allocation' },
          { k: 'positions', l: '📊 Positions' },
          { k: 'orders', l: '📋 Orders' },
          { k: 'holdings', l: '💎 Holdings' },
        ] as const).map(t => (
          <button key={t.k} onClick={() => setTab(t.k)}
            className={`px-4 py-2 rounded-xl font-semibold text-xs whitespace-nowrap transition-all ${tab === t.k ? 'bg-cyan-500/15 text-cyan-300 border border-cyan-500/30' : 'text-slate-500 hover:text-slate-300'}`}
          >{t.l}</button>
        ))}
      </div>

      {/* Status message */}
      {placeMsg && (
        <div className={`px-4 py-2.5 rounded-xl text-xs font-semibold ${msgType === 'ok' ? 'bg-emerald-500/10 text-emerald-300 border border-emerald-500/20' : 'bg-red-500/10 text-red-300 border border-red-500/20'}`}>
          {placeMsg}
        </div>
      )}

      {/* === SMART ALLOCATION TAB === */}
      {tab === 'smart' && (
        <>
          {!cash ? (
            <div className="quantum-panel rounded-2xl p-10 text-center border border-dashed border-white/10">
              <div className="text-4xl mb-2">💰</div>
              <p className="text-slate-400 font-medium">AngelOne wallet se connect nahi hua</p>
              <p className="text-xs text-slate-600 mt-1">Wallet balance load ho raha hai...</p>
            </div>
          ) : smartPicks.length === 0 ? (
            <div className="quantum-panel rounded-2xl p-10 text-center border border-dashed border-white/10">
              <div className="text-4xl mb-2">📡</div>
              <p className="text-slate-400 font-medium">Is wallet amount me koi affordable trade nahi mili</p>
              <p className="text-xs text-slate-600 mt-1">₹{cash.toLocaleString('en-IN')} me koi bhi stock ka 1 share bhi afford nahi ho raha</p>
            </div>
          ) : (
            <>
              {/* Wallet summary bar */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <div className="quantum-panel rounded-xl p-3 text-center border border-emerald-500/10 bg-emerald-500/[0.02]">
                  <div className="text-[10px] text-emerald-400/70 uppercase font-bold">Affordable Trades</div>
                  <div className="text-2xl font-black text-emerald-400">{smartPicks.length}</div>
                </div>
                <div className="quantum-panel rounded-xl p-3 text-center border border-cyan-500/10 bg-cyan-500/[0.02]">
                  <div className="text-[10px] text-cyan-400/70 uppercase font-bold">Best Return</div>
                  <div className="text-lg font-black text-cyan-300">+{smartPicks[0]?.expectedReturnPct.toFixed(1) || 0}%</div>
                </div>
                <div className="quantum-panel rounded-xl p-3 text-center border border-emerald-500/10 bg-emerald-500/[0.02]">
                  <div className="text-[10px] text-emerald-400/70 uppercase font-bold">Est. Profit</div>
                  <div className="text-lg font-black text-emerald-300">₹{smartPicks[0]?.expectedProfit.toFixed(0) || 0}</div>
                </div>
                <div className="quantum-panel rounded-xl p-3 text-center border border-white/5">
                  <div className="text-[10px] text-slate-500 uppercase font-bold">Cost</div>
                  <div className="text-lg font-black text-slate-200">₹{smartPicks[0]?.cost.toLocaleString('en-IN') || 0}</div>
                </div>
              </div>

              {/* Smart allocation picks */}
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <h3 className="text-sm font-bold text-white">🎯 Smart Picks — Sorted by Max Return</h3>
                  <span className="text-[10px] text-slate-500">Wallet: ₹{cash.toLocaleString('en-IN')}</span>
                </div>
                {smartPicks.slice(0, 10).map((pick, i) => {
                  const s = pick.sig;
                  const isTop = i === 0;
                  return (
                    <div key={`${s.market}_${s.symbol}`} className={`quantum-panel rounded-2xl p-4 border transition-all ${isTop ? 'border-emerald-500/30 bg-emerald-500/[0.02]' : 'border-white/5 hover:border-white/10'}`}>
                      {/* Rank + Symbol + Direction */}
                      <div className="flex items-start justify-between gap-2 mb-3">
                        <div className="flex items-center gap-2">
                          {isTop && <span className="text-emerald-400 text-lg">👑</span>}
                          <span className={`w-6 h-6 rounded-lg flex items-center justify-center text-xs font-black ${isTop ? 'bg-emerald-500/20 text-emerald-400' : 'bg-white/5 text-slate-500'}`}>#{i + 1}</span>
                          <div>
                            <div className="font-black text-white text-base">{s.symbol}</div>
                            <div className="text-[10px] text-slate-500">{s.strategy} · AI {s.aiScore}</div>
                          </div>
                        </div>
                        <span className={`px-3 py-1 rounded-lg text-xs font-black border ${dirStyle(s.direction)}`}>{s.direction}</span>
                      </div>

                      {/* Return bar */}
                      <div className="mb-3">
                        <div className="flex items-center justify-between text-xs mb-1">
                          <span className="text-emerald-400 font-bold">+{pick.expectedReturnPct.toFixed(1)}% Expected</span>
                          <span className="text-slate-400">Profit: <strong className="text-emerald-300">₹{pick.expectedProfit.toFixed(0)}</strong></span>
                        </div>
                        <div className="w-full h-2 bg-black/40 rounded-full overflow-hidden">
                          <div
                            className="h-full rounded-full bg-gradient-to-r from-emerald-500 to-emerald-300"
                            style={{ width: `${Math.min(100, pick.expectedReturnPct * 2)}%` }}
                          />
                        </div>
                      </div>

                      {/* Price points + quantity */}
                      <div className="grid grid-cols-2 sm:grid-cols-5 gap-2 text-[11px] mb-3">
                        <div className="bg-black/30 rounded-lg px-2.5 py-2 border border-white/5">
                          <span className="text-slate-500 text-[9px]">Price</span>
                          <div className="font-mono text-white font-bold">{cur(s.market)}{s.price.toFixed(2)}</div>
                        </div>
                        <div className="bg-black/30 rounded-lg px-2.5 py-2 border border-white/5">
                          <span className="text-slate-500 text-[9px]">Entry</span>
                          <div className="font-mono text-cyan-300 font-bold">{cur(s.market)}{s.entry.toFixed(2)}</div>
                        </div>
                        <div className="bg-black/30 rounded-lg px-2.5 py-2 border border-white/5">
                          <span className="text-slate-500 text-[9px]">Target</span>
                          <div className="font-mono text-emerald-300 font-bold">{cur(s.market)}{s.target1.toFixed(2)}</div>
                        </div>
                        <div className="bg-black/30 rounded-lg px-2.5 py-2 border border-white/5">
                          <span className="text-slate-500 text-[9px]">Stop</span>
                          <div className="font-mono text-red-300 font-bold">{cur(s.market)}{s.stopLoss.toFixed(2)}</div>
                        </div>
                        <div className="bg-black/30 rounded-lg px-2.5 py-2 border border-cyan-500/10">
                          <span className="text-slate-500 text-[9px]">Qty × R:R</span>
                          <div className="font-mono text-white font-bold">{pick.maxQty} × 1:{s.riskReward}</div>
                        </div>
                      </div>

                      {/* Action */}
                      <div className="flex items-center gap-2">
                        <div className="text-[10px] text-slate-500 flex-1">
                          Cost: <strong className="text-slate-300">₹{pick.cost.toFixed(0)}</strong> · Remaining: <strong className="text-amber-300">₹{Math.max(0, cash - pick.cost).toFixed(0)}</strong>
                        </div>
                        <button
                          onClick={() => executeTrade(s, pick.maxQty)}
                          disabled={!!placing}
                          className={`px-5 py-2 rounded-xl font-bold text-xs text-white transition-all ${placing === s.symbol ? 'bg-slate-600 cursor-wait opacity-60' : s.direction === 'LONG' ? 'bg-emerald-600 hover:bg-emerald-500 shadow-lg shadow-emerald-500/20' : 'bg-red-600 hover:bg-red-500 shadow-lg shadow-red-500/20'}`}
                        >
                          {placing === s.symbol ? '⏳' : `BUY ${pick.maxQty}`}
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* Investment allocation tip */}
              {smartPicks.length > 1 && (
                <div className="quantum-panel rounded-xl p-4 border border-cyan-500/10 bg-cyan-500/[0.02]">
                  <h4 className="text-xs font-bold text-cyan-300 mb-2">📊 Portfolio Allocation Suggestion</h4>
                  <div className="space-y-1.5 text-[11px]">
                    {smartPicks.slice(0, 3).map((pick, i) => {
                      const pct = ((pick.cost / cash) * 100);
                      return (
                        <div key={i} className="flex items-center gap-2">
                          <span className="w-16 font-bold text-white truncate">{pick.sig.symbol}</span>
                          <div className="flex-1 h-3 bg-black/40 rounded-full overflow-hidden">
                            <div className="h-full rounded-full bg-gradient-to-r from-cyan-500 to-emerald-400" style={{ width: `${pct}%` }} />
                          </div>
                          <span className="w-20 text-right font-mono text-slate-400">{pct.toFixed(0)}% · ₹{pick.cost.toFixed(0)}</span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </>
          )}
        </>
      )}

      {/* === POSITIONS TAB === */}
      {tab === 'positions' && (
        <div className="space-y-3">
          {positions.length === 0
            ? <div className="quantum-panel rounded-2xl p-8 text-center border border-dashed border-white/10"><p className="text-slate-500">No open positions</p></div>
            : positions.filter(p => parseInt(p.netqty) !== 0).map(p => {
                const net = parseInt(p.netqty);
                const buyAvg = parseFloat(p.buyavgprice) || 0;
                const ltp = parseFloat(p.ltp) || 0;
                const pnl = parseFloat(p.pnl) || 0;
                return (
                  <div key={p.tradingsymbol} className="quantum-panel rounded-xl p-4 border border-white/5">
                    <div className="flex items-center justify-between mb-2">
                      <div className="font-bold text-white">{p.tradingsymbol}</div>
                      <span className={`text-xs font-bold px-2 py-0.5 rounded ${net > 0 ? 'bg-emerald-500/10 text-emerald-400' : 'bg-red-500/10 text-red-400'}`}>{net > 0 ? 'LONG' : 'SHORT'} {Math.abs(net)}</span>
                    </div>
                    <div className="grid grid-cols-3 gap-2 text-[11px]">
                      <div><span className="text-slate-500">Avg</span><div className="font-mono text-white">₹{buyAvg.toFixed(2)}</div></div>
                      <div><span className="text-slate-500">LTP</span><div className="font-mono text-cyan-300">₹{ltp.toFixed(2)}</div></div>
                      <div><span className="text-slate-500">P&L</span><div className={`font-mono font-bold ${pnl >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>{pnl >= 0 ? '+' : ''}₹{pnl.toFixed(2)}</div></div>
                    </div>
                  </div>
                );
              })}
          <button onClick={fetchPositions} className="text-xs text-slate-500 hover:text-slate-300">↻ Refresh</button>
        </div>
      )}

      {/* === ORDERS TAB === */}
      {tab === 'orders' && (
        <div className="space-y-2">
          {orders.length === 0
            ? <div className="quantum-panel rounded-2xl p-8 text-center border border-dashed border-white/10"><p className="text-slate-500">No orders</p></div>
            : orders.slice(0, 50).map(o => (
                <div key={o.orderid} className="quantum-panel rounded-xl p-3 border border-white/5 flex flex-wrap items-center justify-between gap-2 text-xs">
                  <div>
                    <span className="font-bold text-white">{o.tradingsymbol}</span>
                    <span className={`ml-2 font-semibold ${o.transactiontype === 'BUY' ? 'text-emerald-400' : 'text-red-400'}`}>{o.transactiontype}</span>
                    <span className={`ml-2 ${statusColor(o.status)}`}>{o.status}</span>
                  </div>
                  <div className="text-slate-400">Qty: {o.quantity} @ {o.price || o.averageprice}</div>
                  {(o.status === 'open' || o.status === 'pending') && (
                    <button onClick={() => cancelOrder(o.orderid)} className="text-red-400 hover:text-red-300 font-semibold">✕ Cancel</button>
                  )}
                </div>
              ))}
          <button onClick={fetchOrders} className="text-xs text-slate-500 hover:text-slate-300">↻ Refresh</button>
        </div>
      )}

      {/* === HOLDINGS TAB === */}
      {tab === 'holdings' && (
        <div className="space-y-2">
          {holdings.length === 0
            ? <div className="quantum-panel rounded-2xl p-8 text-center border border-dashed border-white/10"><p className="text-slate-500">No holdings</p></div>
            : holdings.map(h => {
                const pnl = parseFloat(h.pnl) || 0;
                const val = parseFloat(h.valuation) || 0;
                const qty = parseInt(h.quantity) || 0;
                return (
                  <div key={h.tradingsymbol} className="quantum-panel rounded-xl p-3 border border-white/5 flex flex-wrap items-center justify-between gap-2 text-xs">
                    <div>
                      <span className="font-bold text-white">{h.tradingsymbol}</span>
                      <span className="ml-2 text-slate-400">{qty} @ ₹{parseFloat(h.averageprice || '0').toFixed(2)}</span>
                    </div>
                    <div className="text-right">
                      <div className="text-slate-300">₹{val.toFixed(2)}</div>
                      <div className={`font-semibold ${pnl >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>{pnl >= 0 ? '+' : ''}₹{pnl.toFixed(2)}</div>
                    </div>
                  </div>
                );
              })}
          <button onClick={fetchHoldings} className="text-xs text-slate-500 hover:text-slate-300">↻ Refresh</button>
        </div>
      )}

      <p className="text-[10px] text-slate-600 text-center">
        ⚠️ AI Smart Allocation · AngelOne SmartAPI · SL & TP use karein
      </p>
    </div>
  );
});

export default AlgoTradeTab;
