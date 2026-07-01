import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useApp } from '../../hooks/AppContext';
import { scanAlgoSignals, AlgoSignal } from '../../utils/algoEngine';
import { isCryptoSymbol } from '../../utils/constants';

interface BrokerStatus {
  indmoney: {
    tradetronConnected: boolean;
    strategyConfigured: boolean;
    indmoneyLinked: boolean;
    enabled: boolean;
  };
  coindcx: {
    enabled: boolean;
    hasKey: boolean;
    hasSecret: boolean;
  };
  publicIp: string;
}

const PROXY_BASE = (import.meta.env.VITE_API_PROXY as string) || '';
const API = (path: string) => `${PROXY_BASE}/api/${path}`;

function cur(m: string) { return m === 'IN' ? '₹' : '$'; }

function dirStyle(d: AlgoSignal['direction']) {
  return d === 'LONG' ? 'text-emerald-400 bg-emerald-500/10 border-emerald-500/30'
    : d === 'SHORT' ? 'text-red-400 bg-red-500/10 border-red-500/30'
      : 'text-amber-400 bg-amber-500/10 border-amber-500/30';
}

interface SmartPick {
  sig: AlgoSignal; maxQty: number; cost: number; expectedProfit: number; expectedReturnPct: number; score: number;
}

interface AutoTradeLog {
  time: number; type: string; symbol: string; qty?: number; pnl?: number; entry?: number; price?: number; returnPct?: number; orderId: string; broker?: string;
}

const AlgoTradeTab = React.memo(function AlgoTradeTab() {
  const { portfolio, livePrices } = useApp();

  const [status, setStatus] = useState<BrokerStatus | null>(null);
  const [tab, setTab] = useState<'smart' | 'auto' | 'indmoney' | 'coindcx'>('smart');

  // INDMoney (Tradetron) lists
  const [ttPositions, setTtPositions] = useState<any[]>([]);
  const [ttHistory, setTtHistory] = useState<any[]>([]);
  const [strategyStatus, setStrategyStatus] = useState<any>(null);

  // CoinDCX Futures lists
  const [cdcxPositions, setCdcxPositions] = useState<any[]>([]);
  const [cdcxOrders, setCdcxOrders] = useState<any[]>([]);
  const [cdcxBalance, setCdcxBalance] = useState<any>(null);
  const [cdcxHistory, setCdcxHistory] = useState<any[]>([]);

  // Placement state
  const [placing, setPlacing] = useState<string | null>(null);
  const [placeMsg, setPlaceMsg] = useState('');
  const [msgType, setMsgType] = useState<'ok' | 'err'>('ok');

  // Auto config state
  const [autoCfg, setAutoCfg] = useState<any>(null);
  const [autoBusy, setAutoBusy] = useState(false);
  const [cfgMode, setCfgMode] = useState<'equity' | 'crypto' | 'both'>('both');
  const [cfgMax, setCfgMax] = useState('');
  const [cfgMinRet, setCfgMinRet] = useState('3');
  const [cfgDailyTrades, setCfgDailyTrades] = useState('5');
  const [cfgLeverage, setCfgLeverage] = useState('5');
  const [fetchError, setFetchError] = useState('');

  const autoActive = autoCfg?.enabled;
  const signalsRef = useRef<AlgoSignal[]>([]);

  // Watch keys (India stocks & Crypto only - no US)
  const watchKeys = useMemo(() => {
    const keys = new Set<string>();
    portfolio.forEach(p => {
      if (p.market === 'IN' || isCryptoSymbol(p.symbol)) {
        keys.add(`${p.market}_${p.symbol}`);
      }
    });
    Object.keys(livePrices).forEach(k => {
      const parts = k.split('_');
      if (parts[0] === 'IN' || (parts[1] && isCryptoSymbol(parts[1]))) {
        keys.add(k);
      }
    });
    return [...keys].filter(k => !/_(INDIAVIX|VIX)$/i.test(k));
  }, [portfolio, livePrices]);

  const signals = useMemo(() => scanAlgoSignals(watchKeys, livePrices), [watchKeys, livePrices]);
  signalsRef.current = signals;

  // Wallet balances
  const indmoneyCash = strategyStatus?.capital || 0; // or available balance
  const coindcxCash = cdcxBalance?.balance?.usdt || 0;

  const smartPicks = useMemo((): SmartPick[] => {
    const actionable = signals.filter(s => s.direction !== 'WAIT' && s.entry > 0);
    const picks: SmartPick[] = [];
    for (const sig of actionable) {
      const isCrypto = isCryptoSymbol(sig.symbol);
      const limitCash = isCrypto ? (coindcxCash > 0 ? coindcxCash : 1000) : (indmoneyCash > 0 ? indmoneyCash : 100000);
      const entry = sig.entry;
      const target1 = sig.target1;
      const maxQty = Math.floor(limitCash / entry);
      if (maxQty < 1) continue;
      const cost = maxQty * entry;
      const expectedReturnPct = ((target1 - entry) / entry) * 100;
      const expectedProfit = maxQty * (target1 - entry);
      const score = (expectedReturnPct * sig.conviction) / Math.max(sig.riskReward, 0.5);
      picks.push({ sig, maxQty, cost, expectedProfit, expectedReturnPct, score });
    }
    picks.sort((a, b) => b.score - a.score);
    return picks;
  }, [signals, indmoneyCash, coindcxCash]);

  // Fetch status
  const fetchStatus = async () => {
    try {
      const r = await fetch(API('trade/status'));
      const j = await r.json();
      if (j && !j.error) setStatus(j);
    } catch {}
  };

  // Fetch Tradetron (INDMoney)
  const fetchTradetronData = async () => {
    try {
      const [posRes, histRes, statusRes] = await Promise.all([
        fetch(API('trade/positions')),
        fetch(API('trade/history')),
        fetch(API('trade/strategy-status'))
      ]);
      const [pos, hist, stat] = await Promise.all([posRes.json(), histRes.json(), statusRes.json()]);
      if (pos?.positions) setTtPositions(pos.positions);
      if (hist?.trades) setTtHistory(hist.trades);
      if (stat && !stat.error) setStrategyStatus(stat);
    } catch {}
  };

  // Fetch CoinDCX Futures
  const fetchCoinDcxData = async () => {
    try {
      const [posRes, ordRes, balRes, histRes] = await Promise.all([
        fetch(API('futures/positions')),
        fetch(API('futures/orders')),
        fetch(API('futures/balance')),
        fetch(API('futures/trades'))
      ]);
      const [pos, ord, bal, hist] = await Promise.all([posRes.json(), ordRes.json(), balRes.json(), histRes.json()]);
      if (pos?.positions) setCdcxPositions(pos.positions);
      if (ord?.orders) setCdcxOrders(ord.orders);
      if (bal && !bal.error) setCdcxBalance(bal);
      if (hist?.trades) setCdcxHistory(hist.trades);
    } catch {}
  };

  // Fetch auto trader config
  const fetchAutoCfg = async () => {
    try {
      const r = await fetch(API('trade/auto/config'));
      const j = await r.json();
      if (j && !j.error) {
        setAutoCfg(j);
        setCfgMode(j.mode || 'both');
        if (j.maxAmount > 0) setCfgMax(String(j.maxAmount));
        setCfgMinRet(String(j.minReturnPct));
        setCfgDailyTrades(String(j.maxDailyTrades || 5));
        setCfgLeverage(String(j.cryptoLeverage || 5));
        setFetchError('');
      }
    } catch {
      setFetchError('Failed to fetch auto config');
    }
  };

  const fetchAll = () => {
    fetchStatus();
    fetchAutoCfg();
    fetchTradetronData();
    fetchCoinDcxData();
  };

  useEffect(() => {
    fetchAll();
    const id = setInterval(fetchAll, 15000);
    return () => clearInterval(id);
  }, []);

  // Tick loop
  const runAutoTick = async () => {
    if (autoBusy || !autoActive) return;
    setAutoBusy(true);
    try {
      await fetch(API('trade/auto/tick'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ signals: signalsRef.current }),
      });
      await fetchAutoCfg();
    } catch {} finally {
      setAutoBusy(false);
    }
  };

  useEffect(() => {
    if (!autoActive) return;
    runAutoTick();
    const id = setInterval(runAutoTick, 30000);
    return () => clearInterval(id);
  }, [autoActive]);

  const toggleAuto = async (on: boolean) => {
    try {
      const body: any = {
        enabled: on,
        mode: cfgMode,
        minReturnPct: parseFloat(cfgMinRet) || 3,
        maxDailyTrades: parseInt(cfgDailyTrades) || 5,
        cryptoLeverage: parseInt(cfgLeverage) || 5
      };
      const max = parseFloat(cfgMax);
      if (max > 0) body.maxAmount = max;
      const r = await fetch(API('trade/auto/config'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      });
      const j = await r.json();
      if (j && !j.error) setAutoCfg(j);
    } catch {}
  };

  // Direct manual trade trigger
  const executeTrade = async (sig: AlgoSignal, qty: number) => {
    const isCrypto = isCryptoSymbol(sig.symbol);
    setPlacing(sig.symbol);
    setPlaceMsg('');
    try {
      const endpoint = isCrypto ? API('futures/place') : API('trade/place');
      const payload = isCrypto ? {
        market: `B-${sig.symbol}_USDT`,
        side: sig.direction === 'LONG' ? 'buy' : 'sell',
        qty: qty || 1,
        price: sig.entry,
        leverage: parseInt(cfgLeverage) || 5,
        orderType: 'limit_order'
      } : {
        symbol: sig.symbol,
        side: sig.direction === 'LONG' ? 'BUY' : 'SELL',
        price: sig.entry,
        qty,
        exchange: 'NSE',
        orderType: 'LIMIT',
        productType: 'MIS'
      };

      const r = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const j = await r.json();
      if (j.orderId || j.status === 'success') {
        setPlaceMsg(`✅ Order placed: ${j.orderId || 'Success'}`);
        setMsgType('ok');
        setTimeout(fetchAll, 2000);
      } else {
        setPlaceMsg(`❌ Failed: ${j.error || 'Server error'}`);
        setMsgType('err');
      }
    } catch (e: any) {
      setPlaceMsg(`❌ Error: ${e?.message || 'Network error'}`);
      setMsgType('err');
    } finally {
      setPlacing(null);
      setTimeout(() => setPlaceMsg(''), 5000);
    }
  };

  const cancelDcxOrder = async (orderId: string) => {
    try {
      const r = await fetch(API('futures/cancel'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ orderId }),
      });
      const j = await r.json();
      if (j.message) {
        setPlaceMsg('✅ Order cancelled successfully');
        setMsgType('ok');
        setTimeout(fetchAll, 1500);
      }
    } catch {}
  };

  const autoLog: AutoTradeLog[] = autoCfg?.tradeLog || [];
  const lastAction = autoCfg?.lastAction || '';
  const autoState = autoCfg?.lastState || 'stopped';

  const stateLabel: Record<string, string> = {
    stopped: 'STOPPED',
    disabled: 'DISABLED',
    market_closed: 'CLOSED',
    scanning: '🔍 SCANNING',
    entered: '✅ ENTERED',
    limit_reached: '⚠️ LIMIT REACHED',
    error: '⚠️ ERROR'
  };

  return (
    <div className="space-y-5 animate-fade-in text-slate-100">
      {/* Header and Broker status */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-2xl font-black gradient-text-cyan font-display flex items-center gap-2">
            🚀 SmartAI Algo trading <span className="quantum-badge text-[10px]">MULTIBROKER</span>
          </h2>
          <div className="flex flex-wrap items-center gap-2 mt-1.5">
            <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-bold border ${status?.indmoney?.enabled ? 'bg-emerald-500/10 text-emerald-300 border-emerald-500/30' : 'bg-red-500/10 text-red-300 border-red-500/30'}`}>
              📈 INDMoney / Tradetron {status?.indmoney?.enabled ? 'CONNECTED' : 'OFF'}
            </span>
            <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-bold border ${status?.coindcx?.enabled ? 'bg-cyan-500/10 text-cyan-300 border-cyan-500/30' : 'bg-amber-500/10 text-amber-300 border-amber-500/30'}`}>
              🪙 CoinDCX Futures {status?.coindcx?.enabled ? 'ACTIVE' : 'KEYS MISSING'}
            </span>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {indmoneyCash > 0 && (
            <div className="quantum-panel rounded-xl px-4 py-2 border border-emerald-500/20 text-center bg-emerald-500/5">
              <div className="text-[10px] text-emerald-400 uppercase tracking-wider font-bold">INDMoney Capital</div>
              <div className="font-black text-lg font-mono text-emerald-300">₹{indmoneyCash.toLocaleString('en-IN')}</div>
            </div>
          )}
          <div className="quantum-panel rounded-xl px-4 py-2 border border-cyan-500/20 text-center bg-cyan-500/5">
            <div className="text-[10px] text-cyan-400 uppercase tracking-wider font-bold">CoinDCX USDT</div>
            <div className="font-black text-lg font-mono text-cyan-300">${coindcxCash.toFixed(2)}</div>
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-2 border-b border-white/10 pb-2 overflow-x-auto">
        {( [
          { k: 'smart', l: '🎯 AI Smart Picks' },
          { k: 'auto', l: '🤖 AUTO Trader Setup' },
          { k: 'indmoney', l: '📈 Tradetron / INDstocks' },
          { k: 'coindcx', l: '🪙 CoinDCX Futures' }
        ] as const).map(t => (
          <button key={t.k} onClick={() => setTab(t.k)}
            className={`px-4 py-2 rounded-xl font-semibold text-xs whitespace-nowrap transition-all ${tab === t.k ? 'bg-cyan-500/15 text-cyan-300 border border-cyan-500/30' : 'text-slate-500 hover:text-slate-300'}`}
          >{t.l}</button>
        ))}
      </div>

      {/* Notification Banner */}
      {placeMsg && (
        <div className={`px-4 py-2.5 rounded-xl text-xs font-semibold ${msgType === 'ok' ? 'bg-emerald-500/10 text-emerald-300 border border-emerald-500/20' : 'bg-red-500/10 text-red-300 border border-red-500/20'}`}>
          {placeMsg}
        </div>
      )}
      {fetchError && (
        <div className="px-4 py-2.5 rounded-xl text-xs font-semibold bg-red-500/10 text-red-300 border border-red-500/20">
          ⚠️ {fetchError}
        </div>
      )}

      {/* === 1. SMART PICKS TAB === */}
      {tab === 'smart' && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-bold text-white">🔥 Live AI signals (India Intraday & Crypto Futures)</h3>
            <span className="text-xs text-slate-500">{signals.length} Signals scanned</span>
          </div>

          {smartPicks.length === 0 ? (
            <div className="quantum-panel rounded-2xl p-10 text-center border border-dashed border-white/10">
              <div className="text-4xl mb-2">📡</div>
              <p className="text-slate-400 font-medium">Waiting for signals...</p>
              <p className="text-xs text-slate-600 mt-1">Live price data triggers trading signals automatically.</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {smartPicks.map((pick) => {
                const s = pick.sig;
                const isCrypto = isCryptoSymbol(s.symbol);
                return (
                  <div key={`${s.market}_${s.symbol}`} className="quantum-panel rounded-2xl p-4 border border-white/5 hover:border-white/10 transition-all flex flex-col justify-between">
                    <div>
                      <div className="flex items-start justify-between mb-2">
                        <div>
                          <div className="font-black text-white text-base flex items-center gap-1.5">
                            {isCrypto ? '🪙' : '🇮🇳'} {s.symbol}
                            <span className="text-[10px] text-slate-500 font-normal">({isCrypto ? 'CoinDCX' : 'INDMoney'})</span>
                          </div>
                          <div className="text-[10px] text-slate-500 font-semibold">{s.strategy}</div>
                        </div>
                        <div className="text-right">
                          <span className={`px-2 py-0.5 rounded text-xs font-black border ${dirStyle(s.direction)}`}>{s.direction}</span>
                          <div className="text-[10px] font-bold text-cyan-400 mt-1">🤖 AI {s.aiScore}/100</div>
                        </div>
                      </div>

                      <div className="flex items-center gap-2 mb-3">
                        <span className="font-mono text-sm text-slate-200">{cur(s.market)}{s.price}</span>
                        <span className={`text-xs font-bold ${s.change >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                          {s.change >= 0 ? '+' : ''}{s.change}%
                        </span>
                        <span className="ml-auto text-[10px] text-slate-500">Conviction {s.conviction}% · R:R 1:{s.riskReward}</span>
                      </div>

                      <div className="grid grid-cols-2 gap-1.5 text-[10px] mb-3 bg-black/20 p-2.5 rounded-lg border border-white/5">
                        <div><span className="text-slate-500">Entry Target</span><div className="font-mono text-cyan-300 font-bold">{cur(s.market)}{s.entry}</div></div>
                        <div><span className="text-slate-500">Stop Loss</span><div className="font-mono text-red-300 font-bold">{cur(s.market)}{s.stopLoss}</div></div>
                        <div><span className="text-slate-500">Target 1</span><div className="font-mono text-emerald-300 font-bold">{cur(s.market)}{s.target1}</div></div>
                        <div><span className="text-slate-500">Target 2</span><div className="font-mono text-emerald-300 font-bold">{cur(s.market)}{s.target2}</div></div>
                      </div>
                    </div>

                    <div className="flex items-center justify-between mt-2 pt-2 border-t border-white/5">
                      <div className="text-[10px] text-slate-400">
                        Est. Return: <span className="text-emerald-400 font-bold">+{pick.expectedReturnPct.toFixed(1)}%</span>
                      </div>
                      <button
                        onClick={() => executeTrade(s, pick.maxQty)}
                        disabled={!!placing}
                        className={`px-4 py-1.5 rounded-xl font-bold text-xs text-white ${s.direction === 'LONG' ? 'bg-emerald-600 hover:bg-emerald-500' : 'bg-red-600 hover:bg-red-500'}`}
                      >
                        {placing === s.symbol ? '⏳ Placing' : `EXECUTE (${pick.maxQty} Qty)`}
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* === 2. AUTO TRADER SETUP TAB === */}
      {tab === 'auto' && (
        <div className="space-y-4">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <div className={`quantum-panel rounded-xl p-3 text-center border ${autoActive ? 'border-emerald-500/30 bg-emerald-500/[0.03]' : 'border-white/10'}`}>
              <div className="text-[10px] text-slate-500 uppercase font-bold">Engine Status</div>
              <div className={`text-lg font-black mt-1 ${autoActive ? 'text-emerald-400' : 'text-slate-500'}`}>{autoActive ? '🟢 RUNNING' : '🔴 STOPPED'}</div>
            </div>
            <div className="quantum-panel rounded-xl p-3 text-center border border-white/10">
              <div className="text-[10px] text-slate-500 uppercase font-bold">Auto State</div>
              <div className="text-lg font-black mt-1 text-slate-200">{stateLabel[autoState] || autoState}</div>
            </div>
            <div className="quantum-panel rounded-xl p-3 text-center border border-white/10">
              <div className="text-[10px] text-slate-500 uppercase font-bold">Min Return</div>
              <div className="text-lg font-black mt-1 text-cyan-300">{autoCfg?.minReturnPct || 3}%</div>
            </div>
            <div className="quantum-panel rounded-xl p-3 text-center border border-white/10">
              <div className="text-[10px] text-slate-500 uppercase font-bold">Daily Trades</div>
              <div className="text-lg font-black mt-1 text-slate-200">{autoCfg?.dailyTradeCount || 0}/{autoCfg?.maxDailyTrades || 5}</div>
            </div>
          </div>

          <div className="quantum-panel rounded-2xl p-5 border border-white/10 space-y-4">
            <h3 className="text-sm font-bold text-white flex items-center gap-1.5">⚙️ Trading Configuration</h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-5 gap-3">
              <div>
                <label className="text-[10px] text-slate-500 uppercase font-bold block mb-1">Trading Mode</label>
                <select value={cfgMode} onChange={e => setCfgMode(e.target.value as any)}
                  className="w-full bg-black/40 border border-white/10 rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-cyan-500">
                  <option value="both">Both (INDMoney + Crypto)</option>
                  <option value="equity">India Intraday Only</option>
                  <option value="crypto">CoinDCX Crypto Only</option>
                </select>
              </div>
              <div>
                <label className="text-[10px] text-slate-500 uppercase font-bold block mb-1">Max Capital Allocation</label>
                <input type="number" value={cfgMax} onChange={e => setCfgMax(e.target.value)}
                  className="w-full bg-black/40 border border-white/10 rounded-xl px-3 py-2 text-xs font-mono text-white placeholder-slate-600 focus:outline-none focus:border-cyan-500"
                  placeholder="0 = Default" />
              </div>
              <div>
                <label className="text-[10px] text-slate-500 uppercase font-bold block mb-1">Min Target Pct %</label>
                <input type="number" step="0.5" value={cfgMinRet} onChange={e => setCfgMinRet(e.target.value)}
                  className="w-full bg-black/40 border border-white/10 rounded-xl px-3 py-2 text-xs font-mono text-white focus:outline-none" />
              </div>
              <div>
                <label className="text-[10px] text-slate-500 uppercase font-bold block mb-1">Max Daily Trades</label>
                <input type="number" value={cfgDailyTrades} onChange={e => setCfgDailyTrades(e.target.value)}
                  className="w-full bg-black/40 border border-white/10 rounded-xl px-3 py-2 text-xs font-mono text-white focus:outline-none" />
              </div>
              <div>
                <label className="text-[10px] text-slate-500 uppercase font-bold block mb-1">Crypto Leverage (x)</label>
                <input type="number" value={cfgLeverage} onChange={e => setCfgLeverage(e.target.value)}
                  className="w-full bg-black/40 border border-white/10 rounded-xl px-3 py-2 text-xs font-mono text-white focus:outline-none" />
              </div>
            </div>

            <div className="flex items-center gap-2 pt-2">
              <button onClick={() => toggleAuto(true)} disabled={autoActive}
                className={`px-5 py-2 rounded-xl font-bold text-xs transition-all ${autoActive ? 'bg-slate-700 text-slate-500 cursor-not-allowed' : 'bg-emerald-600 hover:bg-emerald-500 text-white shadow-lg shadow-emerald-500/20'}`}
              >🟢 START ALGO TERMINAL</button>
              <button onClick={() => toggleAuto(false)} disabled={!autoActive}
                className={`px-5 py-2 rounded-xl font-bold text-xs transition-all ${!autoActive ? 'bg-slate-700 text-slate-500 cursor-not-allowed' : 'bg-red-600 hover:bg-red-500 text-white shadow-lg shadow-red-500/20'}`}
              >🔴 STOP ENGINE</button>
              <button onClick={runAutoTick} disabled={autoBusy || !autoActive}
                className="ml-auto px-4 py-2 rounded-xl bg-cyan-600/30 hover:bg-cyan-600/50 text-cyan-300 font-bold text-xs border border-cyan-500/30 transition-all disabled:opacity-30"
              >{autoBusy ? '⏳ Processing' : '↻ Force Tick Now'}</button>
            </div>
          </div>

          {/* Last actions log */}
          {lastAction && (
            <div className="quantum-panel rounded-2xl p-4 border border-cyan-500/15 bg-cyan-500/[0.01]">
              <div className="text-[10px] text-cyan-400 font-bold mb-1 uppercase tracking-wider">Engine status narrative</div>
              <div className="font-mono text-xs text-white">{lastAction}</div>
            </div>
          )}

          {/* Combined Trade Log */}
          {autoLog.length > 0 && (
            <div className="quantum-panel rounded-2xl p-4 border border-white/10">
              <h4 className="text-sm font-bold text-white mb-2">📜 Auto Execution History</h4>
              <div className="space-y-1.5 max-h-60 overflow-y-auto">
                {autoLog.slice().reverse().map((e, idx) => (
                  <div key={idx} className="flex items-center gap-2 text-xs py-1.5 border-b border-white/5 last:border-0">
                    <span className="text-slate-500 font-mono w-12 shrink-0">{new Date(e.time).toLocaleTimeString()}</span>
                    <span className={`font-bold w-16 shrink-0 ${e.type === 'ENTER' ? 'text-emerald-400' : 'text-red-400'}`}>{e.type}</span>
                    <span className="font-bold text-white truncate flex-1">{e.symbol} <span className="text-[10px] text-slate-500 font-normal">({e.broker || 'generic'})</span></span>
                    {e.qty && <span className="text-slate-400">Qty: {e.qty}</span>}
                    {e.entry && <span className="text-slate-500 font-mono">Price: {cur(e.broker === 'coindcx' ? 'US' : 'IN')}{e.entry}</span>}
                    {e.orderId && <span className="text-slate-600 font-mono text-[9px] truncate max-w-[80px]">{e.orderId}</span>}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* === 3. TRADETRON / INDMONEY TAB === */}
      {tab === 'indmoney' && (
        <div className="space-y-4">
          <div className="quantum-panel rounded-2xl p-5 border border-white/10 space-y-4">
            <h3 className="text-base font-black text-white">📈 Tradetron Strategy Connection</h3>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 text-xs">
              <div className="bg-black/25 p-3 rounded-xl border border-white/5">
                <span className="text-slate-500">API Connection</span>
                <div className="font-bold text-white mt-1">{status?.indmoney?.tradetronConnected ? '✅ CONNECTED' : '❌ NOT CONFIG'}</div>
              </div>
              <div className="bg-black/25 p-3 rounded-xl border border-white/5">
                <span className="text-slate-500">Strategy Deployment</span>
                <div className="font-bold text-white mt-1">{status?.indmoney?.strategyConfigured ? '✅ CONFIGURED' : '❌ NO STRATEGY_ID'}</div>
              </div>
              <div className="bg-black/25 p-3 rounded-xl border border-white/5">
                <span className="text-slate-500">INDMoney Broker Token</span>
                <div className="font-bold text-white mt-1">{status?.indmoney?.indmoneyLinked ? '✅ LINKED' : '❌ TOKEN EXPIRED/MISSING'}</div>
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="quantum-panel rounded-2xl p-4 border border-white/10">
              <h4 className="text-sm font-bold text-white mb-2">📊 Current Portfolio Positions</h4>
              {ttPositions.length === 0 ? (
                <div className="p-8 text-center text-xs text-slate-500 border border-dashed border-white/5 rounded-xl">No open equity positions reported by Tradetron</div>
              ) : (
                <div className="space-y-2">
                  {ttPositions.map((pos, idx) => (
                    <div key={idx} className="flex justify-between items-center bg-black/20 p-2.5 rounded-lg text-xs">
                      <div>
                        <div className="font-bold text-white">{pos.instrument || pos.symbol}</div>
                        <div className="text-slate-500 text-[10px]">Qty: {pos.qty} · Avg: ₹{pos.avgPrice}</div>
                      </div>
                      <div className="text-right">
                        <div className={`font-bold ${pos.pnl >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>₹{pos.pnl || '0.00'}</div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="quantum-panel rounded-2xl p-4 border border-white/10">
              <h4 className="text-sm font-bold text-white mb-2">📋 Orders & Trades Execution Log</h4>
              {ttHistory.length === 0 ? (
                <div className="p-8 text-center text-xs text-slate-500 border border-dashed border-white/5 rounded-xl">No trade logs found</div>
              ) : (
                <div className="space-y-2">
                  {ttHistory.map((tr, idx) => (
                    <div key={idx} className="flex justify-between items-center bg-black/20 p-2.5 rounded-lg text-xs">
                      <div>
                        <span className="font-bold text-white">{tr.instrument || tr.symbol}</span>
                        <span className={`ml-2 px-1 py-0.5 rounded text-[9px] ${tr.type === 'BUY' ? 'bg-emerald-500/10 text-emerald-300' : 'bg-red-500/10 text-red-300'}`}>{tr.type}</span>
                      </div>
                      <div className="text-right text-slate-400">
                        Qty: {tr.qty} @ ₹{tr.price}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* === 4. COINDCX FUTURES TAB === */}
      {tab === 'coindcx' && (
        <div className="space-y-4">
          <div className="quantum-panel rounded-2xl p-5 border border-white/10 space-y-4">
            <h3 className="text-base font-black text-white">🪙 CoinDCX Futures Trading Hub</h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-4 text-xs">
              <div className="bg-black/25 p-3 rounded-xl border border-white/5">
                <span className="text-slate-500">API Status</span>
                <div className="font-bold text-white mt-1">{status?.coindcx?.enabled ? '✅ KEYS LOADED' : '❌ NOT CONFIG'}</div>
              </div>
              <div className="bg-black/25 p-3 rounded-xl border border-white/5">
                <span className="text-slate-500">Derivatives Balance</span>
                <div className="font-bold text-cyan-300 mt-1">${coindcxCash.toFixed(2)} USDT</div>
              </div>
              <div className="bg-black/25 p-3 rounded-xl border border-white/5">
                <span className="text-slate-500">Open Positions</span>
                <div className="font-bold text-white mt-1">{cdcxPositions.length}</div>
              </div>
              <div className="bg-black/25 p-3 rounded-xl border border-white/5">
                <span className="text-slate-500">Active Orders</span>
                <div className="font-bold text-white mt-1">{cdcxOrders.length}</div>
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* CoinDCX Positions */}
            <div className="quantum-panel rounded-2xl p-4 border border-white/10">
              <h4 className="text-sm font-bold text-white mb-2">📊 Derivatives Positions (USDT-M)</h4>
              {cdcxPositions.length === 0 ? (
                <div className="p-8 text-center text-xs text-slate-500 border border-dashed border-white/5 rounded-xl">No active crypto futures positions</div>
              ) : (
                <div className="space-y-2">
                  {cdcxPositions.map((pos, idx) => (
                    <div key={idx} className="bg-black/20 p-2.5 rounded-lg text-xs space-y-1 border border-white/5">
                      <div className="flex justify-between items-center">
                        <span className="font-black text-white">{pos.market || pos.symbol}</span>
                        <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${pos.side?.toUpperCase() === 'BUY' || pos.qty > 0 ? 'bg-emerald-500/10 text-emerald-400' : 'bg-red-500/10 text-red-400'}`}>
                          {pos.side?.toUpperCase() === 'BUY' || pos.qty > 0 ? 'LONG' : 'SHORT'} {pos.leverage || '5'}x
                        </span>
                      </div>
                      <div className="flex justify-between text-[10px] text-slate-500">
                        <span>Size: {Math.abs(pos.qty || pos.quantity)}</span>
                        <span>Entry: ${pos.entryPrice || pos.avgPrice}</span>
                        <span>PNL: <strong className={parseFloat(pos.pnl) >= 0 ? 'text-emerald-400' : 'text-red-400'}>${pos.pnl || '0.00'}</strong></span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* CoinDCX Active Orders */}
            <div className="quantum-panel rounded-2xl p-4 border border-white/10">
              <h4 className="text-sm font-bold text-white mb-2">📋 Active Limit & Trigger Orders</h4>
              {cdcxOrders.length === 0 ? (
                <div className="p-8 text-center text-xs text-slate-500 border border-dashed border-white/5 rounded-xl">No pending triggers</div>
              ) : (
                <div className="space-y-2">
                  {cdcxOrders.map((ord, idx) => (
                    <div key={idx} className="flex justify-between items-center bg-black/20 p-2.5 rounded-lg text-xs">
                      <div>
                        <div className="font-bold text-white">{ord.market}</div>
                        <div className="text-[10px] text-slate-500">{ord.side?.toUpperCase()} · {ord.qty} Qty @ ${ord.price}</div>
                      </div>
                      <button onClick={() => cancelDcxOrder(ord.id)} className="text-red-400 hover:text-red-300 text-[10px] font-bold">
                        CANCEL
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      <p className="text-[10px] text-slate-600 text-center">
        ⚠️ Programmatic Trading via SmartAI Algo. Trading futures and intraday equities contains high financial risk.
      </p>
    </div>
  );
});

export default AlgoTradeTab;
