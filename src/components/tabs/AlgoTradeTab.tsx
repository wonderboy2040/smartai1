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

const AlgoTradeTab = React.memo(function AlgoTradeTab() {
  const { portfolio, livePrices } = useApp();

  const [wallet, setWallet] = useState<TradeWallet | null>(null);
  const [orders, setOrders] = useState<AngelOrder[]>([]);
  const [holdings, setHoldings] = useState<AngelHolding[]>([]);
  const [positions, setPositions] = useState<AngelPosition[]>([]);
  const [placing, setPlacing] = useState<string | null>(null);
  const [placeMsg, setPlaceMsg] = useState('');
  const [msgType, setMsgType] = useState<'ok' | 'err'>('ok');
  const [tab, setTab] = useState<'signals' | 'positions' | 'orders' | 'holdings'>('signals');

  const watchKeys = useMemo(() => {
    const keys = new Set<string>();
    portfolio.forEach(p => keys.add(`${p.market}_${p.symbol}`));
    Object.keys(livePrices).forEach(k => keys.add(k));
    return [...keys].filter(k => !/_(INDIAVIX|VIX)$/i.test(k));
  }, [portfolio, livePrices]);

  const signals = useMemo(() => scanAlgoSignals(watchKeys, livePrices), [watchKeys, livePrices]);
  const actionable = signals.filter(s => s.direction !== 'WAIT');
  const top = actionable[0];

  const fetchWallet = async () => {
    try {
      const r = await fetch(API('wallet'));
      const j = await r.json();
      if (j && !j.error) setWallet(j);
    } catch {}
  };

  const fetchOrders = async () => {
    try {
      const r = await fetch(API('orders'));
      const j = await r.json();
      if (j?.orders) setOrders(j.orders);
    } catch {}
  };

  const fetchHoldings = async () => {
    try {
      const r = await fetch(API('holdings'));
      const j = await r.json();
      if (j?.holdings) setHoldings(j.holdings);
    } catch {}
  };

  const fetchPositions = async () => {
    try {
      const r = await fetch(API('positions'));
      const j = await r.json();
      if (j?.positions) setPositions(j.positions);
    } catch {}
  };

  const fetchAll = () => {
    fetchWallet(); fetchOrders(); fetchHoldings(); fetchPositions();
  };

  useEffect(() => { fetchAll(); const id = setInterval(fetchAll, 10000); return () => clearInterval(id); }, []);

  const placeFromSignal = async (sig: AlgoSignal) => {
    if (placing) return;
    setPlacing(sig.symbol);
    setPlaceMsg('');
    try {
      const r = await fetch(API('place'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          symbol: sig.symbol.includes('.NS') ? sig.symbol : `${sig.symbol}.NS`,
          side: sig.direction === 'LONG' ? 'BUY' : 'SELL',
          orderType: 'LIMIT',
          price: sig.entry,
          qty: 1,
          variety: 'NORMAL',
          productType: 'DELIVERY',
          exchange: 'NSE',
        }),
      });
      const j = await r.json();
      if (j.orderId) {
        setPlaceMsg(`Order placed: ${j.orderId}`);
        setMsgType('ok');
        setTimeout(fetchAll, 2000);
      } else {
        setPlaceMsg(j.error || 'Order failed');
        setMsgType('err');
      }
    } catch (e: any) {
      setPlaceMsg(e?.message || 'Network error');
      setMsgType('err');
    } finally {
      setPlacing(null);
      setTimeout(() => setPlaceMsg(''), 4000);
    }
  };

  const cancelOrder = async (orderId: string) => {
    try {
      const r = await fetch(API('cancel'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ orderId }),
      });
      const j = await r.json();
      if (j.message) setTimeout(fetchAll, 1500);
    } catch {}
  };

  const cash = wallet ? parseFloat(wallet.availablecash || wallet.totalmargin || '0') : 0;
  const used = wallet ? parseFloat(wallet.utilisablemargin || '0') : 0;

  return (
    <div className="space-y-5 animate-fade-in">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-2xl font-black gradient-text-cyan font-display flex items-center gap-2">
            🤖 ALGO Trading <span className="quantum-badge text-[10px]">AngelOne</span>
          </h2>
          <p className="text-[11px] text-slate-500 mt-1">Advance Pro Algo Trading · Live Execution · AI Signals</p>
        </div>
        <div className="flex items-center gap-2">
          {wallet && (
            <div className="quantum-panel rounded-xl px-4 py-2 border border-white/5 text-center">
              <div className="text-[10px] text-slate-500">Wallet</div>
              <div className="font-black text-cyan-300 font-mono">₹{cash.toLocaleString('en-IN')}</div>
            </div>
          )}
          {wallet && used > 0 && (
            <div className="quantum-panel rounded-xl px-4 py-2 border border-white/5 text-center">
              <div className="text-[10px] text-slate-500">Used</div>
              <div className="font-black text-yellow-300 font-mono">₹{used.toLocaleString('en-IN')}</div>
            </div>
          )}
        </div>
      </div>

      {/* Sub-tabs */}
      <div className="flex gap-2 border-b border-white/10 pb-2 overflow-x-auto">
        {([
          { k: 'signals', l: '📡 Signals' },
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
        <div className={`px-4 py-2 rounded-xl text-xs font-semibold ${msgType === 'ok' ? 'bg-emerald-500/10 text-emerald-300 border border-emerald-500/20' : 'bg-red-500/10 text-red-300 border border-red-500/20'}`}>
          {placeMsg}
        </div>
      )}

      {/* === SIGNALS TAB === */}
      {tab === 'signals' && (
        <>
          {top && top.direction !== 'WAIT' && (
            <div className="quantum-panel rounded-2xl p-5 border border-cyan-500/20 animate-fade-in-up">
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-sm font-bold text-white flex items-center gap-2">🎯 Top Signal</h3>
                <span className={`px-3 py-1 rounded-lg text-xs font-black border ${dirStyle(top.direction)}`}>{top.direction} · {top.strategy}</span>
              </div>
              <div className="flex flex-wrap items-end gap-4 mb-4">
                <div>
                  <div className="text-3xl font-black text-white">{top.symbol}</div>
                  <div className="text-xs text-slate-500">{cur(top.market)}{top.price} · AI {top.aiScore}/100</div>
                </div>
                <div className="ml-auto grid grid-cols-2 sm:grid-cols-4 gap-2 text-[11px]">
                  <div className="bg-black/30 rounded-lg px-3 py-2 border border-white/5"><span className="text-slate-500">Entry</span><div className="font-mono text-cyan-300 font-bold">{cur(top.market)}{top.entry}</div></div>
                  <div className="bg-black/30 rounded-lg px-3 py-2 border border-white/5"><span className="text-slate-500">Stop</span><div className="font-mono text-red-300 font-bold">{cur(top.market)}{top.stopLoss}</div></div>
                  <div className="bg-black/30 rounded-lg px-3 py-2 border border-white/5"><span className="text-slate-500">T1 / T2</span><div className="font-mono text-emerald-300 font-bold">{top.target1} / {top.target2}</div></div>
                  <div className="bg-black/30 rounded-lg px-3 py-2 border border-white/5"><span className="text-slate-500">R:R · Size</span><div className="font-mono text-white font-bold">1:{top.riskReward} · {top.positionSizePct}%</div></div>
                </div>
              </div>
              <button
                onClick={() => placeFromSignal(top)}
                disabled={!!placing}
                className={`px-6 py-3 rounded-xl font-bold text-sm text-white transition-all ${placing === top.symbol ? 'bg-slate-600 cursor-wait' : top.direction === 'LONG' ? 'bg-emerald-600 hover:bg-emerald-500' : 'bg-red-600 hover:bg-red-500'}`}
              >
                {placing === top.symbol ? '⏳ Placing...' : `🚀 Execute ${top.direction}`}
              </button>
              <p className="text-xs text-slate-400 mt-2 italic">{top.reasoning}</p>
            </div>
          )}

          {signals.length === 0
            ? <div className="quantum-panel rounded-2xl p-10 text-center border border-dashed border-white/10">
                <div className="text-4xl mb-2">📡</div>
                <p className="text-slate-400 font-medium">Waiting for live data...</p>
              </div>
            : <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                {signals.map(s => (
                  <div key={`${s.market}_${s.symbol}`} className="quantum-panel rounded-2xl p-4 border border-white/5 hover:-translate-y-0.5 transition-all">
                    <div className="flex items-start justify-between gap-2 mb-2">
                      <div>
                        <div className="font-black text-white text-base">{s.symbol}</div>
                        <div className="text-[10px] text-slate-500">{s.market} · {s.strategy}</div>
                      </div>
                      <div className="text-right">
                        <span className={`px-2.5 py-1 rounded-lg text-xs font-black border ${dirStyle(s.direction)}`}>{s.direction}</span>
                        <div className="mt-1 text-[10px] font-bold text-cyan-400">AI {s.aiScore}</div>
                      </div>
                    </div>
                    <div className="flex items-center gap-2 mb-2">
                      <span className="font-mono text-sm text-slate-200">{cur(s.market)}{s.price}</span>
                      <span className={`text-xs font-bold ${s.change >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>{s.change >= 0 ? '+' : ''}{s.change}%</span>
                    </div>
                    <div className="grid grid-cols-2 gap-1.5 text-[10px] mb-3">
                      <div className="bg-black/30 rounded-lg px-2 py-1.5 border border-white/5"><span className="text-slate-500">Entry</span><div className="font-mono text-cyan-300 font-bold">{parseFloat(String(s.entry || 0)).toFixed(2)}</div></div>
                      <div className="bg-black/30 rounded-lg px-2 py-1.5 border border-white/5"><span className="text-slate-500">Stop</span><div className="font-mono text-red-300 font-bold">{parseFloat(String(s.stopLoss || 0)).toFixed(2)}</div></div>
                    </div>
                    <button
                      onClick={() => placeFromSignal(s)}
                      disabled={!!placing}
                      className={`w-full py-2 rounded-xl font-bold text-xs text-white transition-all ${placing === s.symbol ? 'bg-slate-600 cursor-wait' : s.direction === 'LONG' ? 'bg-emerald-600/80 hover:bg-emerald-600' : s.direction === 'SHORT' ? 'bg-red-600/80 hover:bg-red-600' : 'bg-slate-600/50 cursor-not-allowed'}`}
                    >{placing === s.symbol ? '⏳' : s.direction === 'LONG' ? 'BUY' : s.direction === 'SHORT' ? 'SELL' : 'WAIT'}</button>
                  </div>
                ))}
              </div>
          }
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
          <button onClick={fetchPositions} className="text-xs text-slate-500 hover:text-slate-300">Refresh</button>
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
                  <div className="text-slate-400">
                    Qty: {o.quantity} @ {o.price || o.averageprice}
                  </div>
                  {(o.status === 'open' || o.status === 'pending') && (
                    <button onClick={() => cancelOrder(o.orderid)} className="text-red-400 hover:text-red-300 font-semibold">Cancel</button>
                  )}
                </div>
              ))}
          <button onClick={fetchOrders} className="text-xs text-slate-500 hover:text-slate-300">Refresh</button>
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
          <button onClick={fetchHoldings} className="text-xs text-slate-500 hover:text-slate-300">Refresh</button>
        </div>
      )}

      <p className="text-[10px] text-slate-600 text-center">
        ⚠️ Algorithmic trading via AngelOne SmartAPI. Use stop-loss. Not financial advice.
      </p>
    </div>
  );
});

export default AlgoTradeTab;
