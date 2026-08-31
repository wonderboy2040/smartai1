import React, { useState, useMemo, useCallback, useRef, useEffect } from 'react';
import { useApp } from '../hooks/AppContext';
import {
  computeMCPPlannerAllocations,
  formatBrokerOrderSheet,
  formatPlannerTelegramReport,
  MCP_AGENT_MODELS,
  type MCPPlannerAgentModel,
} from '../utils/mcpPlannerEngine';
import { formatCurrency, formatPrice, DEFAULT_USD_INR } from '../utils/constants';
import { sendTelegramAlert } from '../utils/api';
import { secureStorage } from '../utils/secureStorage';

export const MCPAgentAllocationPanel = React.memo(function MCPAgentAllocationPanel() {
  const {
    livePrices,
    usdInrRate,
    indiaSIP,
    setIndiaSIP,
    usSIP,
    setUsSIP,
    btcSIP,
    setBtcSIP,
    ethSIP,
    setEthSIP,
  } = useApp();

  const totalCurrentSIP = indiaSIP + usSIP + btcSIP + ethSIP;

  // --- Component State ---
  const [agentModel, setAgentModel] = useState<MCPPlannerAgentModel>('QUANTUM_ALPHA');
  const [investmentType, setInvestmentType] = useState<'SIP' | 'LUMPSUM'>('SIP');
  const [marketFocus, setMarketFocus] = useState<'ALL' | 'IN' | 'US' | 'CRYPTO'>('ALL');
  const [customAmount, setCustomAmount] = useState<string>(
    totalCurrentSIP > 0 ? String(totalCurrentSIP) : '25000'
  );
  const [copied, setCopied] = useState(false);
  const [sendingTG, setSendingTG] = useState(false);
  const [appliedMsg, setAppliedMsg] = useState(false);

  const numericAmount = Math.max(1000, parseFloat(customAmount) || 25000);

  // Perf: livePrices gets a fresh object identity on every tick flush (~5/s).
  // Keying the memo on a compact price snapshot of the 12 planner symbols
  // only recomputes the (heavy) allocation engine when a relevant price
  // actually changes — not on every unrelated tick.
  const PLANNER_SYMBOL_KEYS = [
    'IN_MOMENTUM50', 'IN_SMALLCAP', 'IN_MID150BEES', 'IN_JUNIORBEES', 'IN_SETFNIF50',
    'US_SMH', 'US_VOOG', 'US_MU', 'US_QQQ', 'US_VGT', 'IN_BTC', 'IN_ETH',
  ];
  const plannerPriceKey = useMemo(
    () => PLANNER_SYMBOL_KEYS.map(k => (livePrices[k]?.price ?? 0).toFixed(2)).join('|'),
    [livePrices]
  );
  const stablePricesRef = useRef(livePrices);
  stablePricesRef.current = livePrices;

  // Compute live MCP allocation plan
  const plan = useMemo(
    () =>
      computeMCPPlannerAllocations(stablePricesRef.current, numericAmount, {
        agentModel,
        investmentType,
        marketFocus,
        usdInrRate: usdInrRate || DEFAULT_USD_INR,
      }),
    [plannerPriceKey, numericAmount, agentModel, investmentType, marketFocus, usdInrRate]
  );

  // Timer cleanup — setState after unmount guard (was: raw setTimeouts).
  const copiedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const appliedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => {
    if (copiedTimerRef.current) clearTimeout(copiedTimerRef.current);
    if (appliedTimerRef.current) clearTimeout(appliedTimerRef.current);
  }, []);

  // Copy broker order sheet to clipboard (was: un-awaited + un-caught —
  // crashed on HTTP origins where navigator.clipboard is undefined).
  const handleCopyOrderSheet = useCallback(async () => {
    try {
      if (!navigator.clipboard?.writeText) throw new Error('clipboard unavailable');
      await navigator.clipboard.writeText(formatBrokerOrderSheet(plan));
      setCopied(true);
      if (copiedTimerRef.current) clearTimeout(copiedTimerRef.current);
      copiedTimerRef.current = setTimeout(() => setCopied(false), 2500);
    } catch {
      alert('⚠️ Clipboard unavailable (HTTPS required). Order sheet manually copy karein.');
    }
  }, [plan]);

  // Send plan to Telegram
  const handleSendTelegram = useCallback(async () => {
    setSendingTG(true);
    try {
      const token = await secureStorage.getItemAsync('TG_TOKEN');
      const chatId = await secureStorage.getItemAsync('TG_CHAT_ID');
      if (!token || !chatId) {
        alert('⚠️ Telegram token ya Chat ID configured nahi hai. Settings me configure karein.');
        return;
      }
      const msg = formatPlannerTelegramReport(plan);
      const ok = await sendTelegramAlert(token, chatId, msg);
      if (ok) {
        alert('✅ MCP AI Allocation Plan Telegram pe send ho gaya!');
      } else {
        alert('⚠️ Send failed. Telegram connection check karein.');
      }
    } catch {
      alert('⚠️ Telegram send me error aayi.');
    } finally {
      setSendingTG(false);
    }
  }, [plan]);

  // Apply allocation to App monthly SIP settings
  const handleApplyToSIP = useCallback(() => {
    if (plan.indiaAllocINR > 0) setIndiaSIP(plan.indiaAllocINR);
    if (plan.usaAllocINR > 0) setUsSIP(plan.usaAllocINR);
    const btcAlloc = plan.allocations.find(a => a.symbol === 'BTC')?.allocAmountINR || 0;
    const ethAlloc = plan.allocations.find(a => a.symbol === 'ETH')?.allocAmountINR || 0;
    if (btcAlloc > 0) setBtcSIP(btcAlloc);
    if (ethAlloc > 0) setEthSIP(ethAlloc);

    setAppliedMsg(true);
    if (appliedTimerRef.current) clearTimeout(appliedTimerRef.current);
    appliedTimerRef.current = setTimeout(() => setAppliedMsg(false), 3000);
  }, [plan, setIndiaSIP, setUsSIP, setBtcSIP, setEthSIP]);

  const PRESET_AMOUNTS = [10000, 25000, 50000, 100000, 250000, 500000];

  return (
    <div className="quantum-panel rounded-2xl p-5 border-cyan-500/20 animate-fade-in-up">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3 mb-4 pb-3 border-b border-white/5">
        <div>
          <div className="flex items-center gap-2">
            <span className="text-xl">🤖</span>
            <h3 className="text-base font-black text-white tracking-wide">
              MCP AI Agent Wealth Allocation Engine
            </h3>
            <span className="px-2 py-0.5 rounded-full text-[9px] font-bold bg-cyan-500/15 text-cyan-400 border border-cyan-500/30 font-mono">
              v6.2 REALTIME
            </span>
          </div>
          <p className="text-[11px] text-slate-400 mt-0.5">
            Real-time multi-asset investment distribution for India (MOMENTUM50, SMALLCAP, MID150BEES, JUNIORBEES, SETFNIF50), USA (SMH, VOOG, MU, QQQ, VGT) & Crypto based on live prices and SuperScore.
          </p>
        </div>

        {/* Global Regime Badge */}
        <div className="flex items-center gap-2">
          <div className="px-2.5 py-1 rounded-lg bg-black/40 border border-white/10 text-[10px] font-mono">
            <span className="text-slate-400">INDIA VIX: </span>
            <span className={`font-bold ${plan.marketRegime.inVix > 18 ? 'text-amber-400' : 'text-emerald-400'}`}>
              {plan.marketRegime.inVix.toFixed(1)}
            </span>
            <span className="text-slate-600 mx-1.5">|</span>
            <span className="text-slate-400">US VIX: </span>
            <span className={`font-bold ${plan.marketRegime.usVix > 20 ? 'text-amber-400' : 'text-emerald-400'}`}>
              {plan.marketRegime.usVix.toFixed(1)}
            </span>
          </div>
        </div>
      </div>

      {/* 1. MCP AI Agent Model Selector Bar */}
      <div className="mb-4">
        <label className="text-[10px] text-slate-400 font-bold uppercase tracking-wider block mb-2">
          Select MCP AI Agent Model
        </label>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2">
          {MCP_AGENT_MODELS.map(m => {
            const isSelected = agentModel === m.id;
            return (
              <button
                key={m.id}
                onClick={() => setAgentModel(m.id)}
                className={`p-3 rounded-xl text-left transition-all border ${
                  isSelected
                    ? `${m.bg} ${m.border} shadow-lg shadow-cyan-500/5 ring-1 ring-cyan-500/30`
                    : 'bg-black/20 border-white/5 hover:border-white/15 hover:bg-white/[0.02]'
                }`}
              >
                <div className="flex items-center justify-between mb-1">
                  <div className="flex items-center gap-1.5">
                    <span className="text-base">{m.emoji}</span>
                    <span className={`text-xs font-bold ${isSelected ? 'text-white' : 'text-slate-300'}`}>
                      {m.name}
                    </span>
                  </div>
                  {isSelected && (
                    <span className="w-2 h-2 rounded-full bg-cyan-400 animate-ping" />
                  )}
                </div>
                <div className={`text-[8px] font-mono font-bold tracking-wider mb-1 ${m.color}`}>
                  {m.badge}
                </div>
                <div className="text-[9px] text-slate-500 line-clamp-2 leading-tight">
                  {m.description}
                </div>
              </button>
            );
          })}
        </div>
      </div>

      {/* 2. Investment Amount Sizer & Controls */}
      <div className="bg-black/30 rounded-xl p-4 border border-white/5 mb-4">
        <div className="grid grid-cols-1 md:grid-cols-12 gap-3 items-center">
          {/* Amount input */}
          <div className="md:col-span-5">
            <label className="text-[10px] text-slate-400 font-bold uppercase tracking-wider block mb-1.5">
              Investment Capital ({investmentType === 'SIP' ? 'Monthly SIP Amount' : 'Lumpsum Capital'})
            </label>
            <div className="flex items-center gap-2 quantum-input p-2 rounded-xl bg-black/40 border border-white/10">
              <span className="text-base font-bold text-cyan-400">₹</span>
              <input
                type="number"
                value={customAmount}
                onChange={e => setCustomAmount(e.target.value)}
                placeholder="Enter investment amount"
                className="w-full bg-transparent outline-none text-base font-bold text-white font-mono"
                min="1000"
                step="1000"
              />
              <span className="text-[10px] text-slate-500 font-bold px-2 py-0.5 bg-white/5 rounded">
                INR
              </span>
            </div>
          </div>

          {/* Quick preset buttons */}
          <div className="md:col-span-4">
            <label className="text-[10px] text-slate-400 font-bold uppercase tracking-wider block mb-1.5">
              Quick Presets
            </label>
            <div className="flex flex-wrap gap-1.5">
              {PRESET_AMOUNTS.map(amt => (
                <button
                  key={amt}
                  onClick={() => setCustomAmount(String(amt))}
                  className={`px-2 py-1 rounded-lg text-[10px] font-mono font-bold transition-all ${
                    numericAmount === amt
                      ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/40'
                      : 'bg-white/5 text-slate-400 hover:text-white border border-white/5 hover:border-white/10'
                  }`}
                >
                  ₹{amt >= 100000 ? `${amt / 100000}L` : `${amt / 1000}k`}
                </button>
              ))}
            </div>
          </div>

          {/* Mode & Market Filters */}
          <div className="md:col-span-3 flex flex-col gap-1.5">
            <label className="text-[10px] text-slate-400 font-bold uppercase tracking-wider block">
              Mode & Market
            </label>
            <div className="flex gap-1">
              <button
                onClick={() => setInvestmentType('SIP')}
                className={`flex-1 py-1 px-2 rounded-lg text-[10px] font-bold transition-all ${
                  investmentType === 'SIP'
                    ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/30'
                    : 'bg-white/5 text-slate-400 border border-white/5'
                }`}
              >
                📅 Monthly SIP
              </button>
              <button
                onClick={() => setInvestmentType('LUMPSUM')}
                className={`flex-1 py-1 px-2 rounded-lg text-[10px] font-bold transition-all ${
                  investmentType === 'LUMPSUM'
                    ? 'bg-purple-500/20 text-purple-300 border border-purple-500/30'
                    : 'bg-white/5 text-slate-400 border border-white/5'
                }`}
              >
                💰 Lumpsum
              </button>
            </div>
            <div className="flex gap-1">
              {(['ALL', 'IN', 'US', 'CRYPTO'] as const).map(f => (
                <button
                  key={f}
                  onClick={() => setMarketFocus(f)}
                  className={`flex-1 py-1 rounded-md text-[9px] font-bold transition-all ${
                    marketFocus === f
                      ? 'bg-indigo-500/20 text-indigo-300 border border-indigo-500/30'
                      : 'bg-black/20 text-slate-500 border border-white/5'
                  }`}
                >
                  {f === 'ALL' ? '🌐 All' : f === 'IN' ? '🇮🇳 IN' : f === 'US' ? '🇺🇸 US' : '🪙 Crypto'}
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* 3. Summary Metrics Strip */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2 mb-4">
        <div className="bg-black/20 p-2.5 rounded-xl border border-white/5 text-center">
          <div className="text-[9px] text-slate-500 font-bold uppercase">Total Capital</div>
          <div className="text-sm font-black text-white font-mono mt-0.5">
            {formatCurrency(plan.totalAllocatedINR)}
          </div>
        </div>
        <div className="bg-blue-500/5 p-2.5 rounded-xl border border-blue-500/15 text-center">
          <div className="text-[9px] text-blue-400/80 font-bold uppercase">🇮🇳 India Alpha</div>
          <div className="text-sm font-black text-blue-300 font-mono mt-0.5">
            {formatCurrency(plan.indiaAllocINR)}
          </div>
        </div>
        <div className="bg-emerald-500/5 p-2.5 rounded-xl border border-emerald-500/15 text-center">
          <div className="text-[9px] text-emerald-400/80 font-bold uppercase">🇺🇸 USA Tech/Growth</div>
          <div className="text-sm font-black text-emerald-300 font-mono mt-0.5">
            ${plan.usaAllocUSD} <span className="text-[9px] text-slate-500">({formatCurrency(plan.usaAllocINR)})</span>
          </div>
        </div>
        <div className="bg-orange-500/5 p-2.5 rounded-xl border border-orange-500/15 text-center">
          <div className="text-[9px] text-orange-400/80 font-bold uppercase">🪙 Crypto DCA</div>
          <div className="text-sm font-black text-orange-300 font-mono mt-0.5">
            {formatCurrency(plan.cryptoAllocINR)}
          </div>
        </div>
        <div className="bg-cyan-500/5 p-2.5 rounded-xl border border-cyan-500/15 text-center">
          <div className="text-[9px] text-cyan-400/80 font-bold uppercase">Avg SuperScore</div>
          <div className="text-sm font-black text-cyan-400 font-mono mt-0.5">
            {plan.averageSuperScore}/99
          </div>
        </div>
        <div className="bg-purple-500/5 p-2.5 rounded-xl border border-purple-500/15 text-center">
          <div className="text-[9px] text-purple-400/80 font-bold uppercase">Top Buy Count</div>
          <div className="text-sm font-black text-purple-300 font-mono mt-0.5">
            💎 {plan.topBuyCount} Assets
          </div>
        </div>
      </div>

      {/* 4. Live Real-Time Allocation Grid */}
      <div className="space-y-2.5 mb-4">
        <div className="flex items-center justify-between text-[10px] text-slate-400 font-bold uppercase tracking-wider px-1">
          <span>Asset & Real-Time Market Metrics</span>
          <span>Target Allocation & Sizing</span>
        </div>

        {plan.allocations.map(a => {
          const cur = a.market === 'IN' ? '₹' : '$';
          const isTopBuy = a.signal.includes('STRONG');
          const isBuy = a.signal.includes('BUY NOW');
          const isAccumulate = a.signal.includes('ACCUMULATE');
          const isOverbought = a.signal.includes('OVERBOUGHT');

          const signalBadge = isTopBuy
            ? 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30'
            : isBuy
            ? 'bg-cyan-500/15 text-cyan-300 border-cyan-500/30'
            : isAccumulate
            ? 'bg-blue-500/15 text-blue-300 border-blue-500/30'
            : isOverbought
            ? 'bg-red-500/15 text-red-300 border-red-500/30'
            : 'bg-amber-500/15 text-amber-300 border-amber-500/30';

          return (
            <div
              key={a.symbol}
              className="bg-black/25 hover:bg-black/40 border border-white/5 hover:border-cyan-500/25 rounded-xl p-3.5 transition-all"
            >
              <div className="flex flex-wrap items-start justify-between gap-2 mb-2">
                {/* Symbol & Category */}
                <div className="flex items-center gap-2.5">
                  <span className="text-lg">{a.emoji}</span>
                  <div>
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-sm font-bold text-white tracking-wide">
                        {a.symbol}
                      </span>
                      <span className="text-[9px] px-1.5 py-0.5 rounded bg-white/5 text-slate-400 border border-white/5 font-medium">
                        {a.category}
                      </span>
                      <span className={`text-[9px] font-bold px-2 py-0.5 rounded-md border ${signalBadge}`}>
                        {a.signal}
                      </span>
                    </div>
                    <div className="text-[10px] text-slate-400 truncate max-w-[280px]">
                      {a.name}
                    </div>
                  </div>
                </div>

                {/* Allocation Sizing Box */}
                <div className="text-right">
                  <div className="text-sm font-black text-cyan-400 font-mono">
                    {a.market === 'US' ? `$${a.allocAmountNative.toFixed(2)}` : `₹${a.allocAmountINR.toLocaleString('en-IN')}`}
                    <span className="text-[10px] text-slate-500 ml-1.5 font-normal">
                      ({(a.allocPct * 100).toFixed(1)}%)
                    </span>
                  </div>
                  <div className="text-[10px] font-mono font-bold text-emerald-400 mt-0.5">
                    {a.targetUnits >= 1 || ['BTC', 'ETH'].includes(a.symbol) || a.market === 'US'
                      ? <>🎯 Buy {a.targetUnits} {a.market === 'US' ? 'shares' : ['BTC', 'ETH'].includes(a.symbol) ? a.symbol : 'units'}</>
                      : <span className="text-amber-400/80">⚠️ allocation unit ke liye choti hai</span>}
                  </div>
                </div>
              </div>

              {/* Real-time Indicator Badges */}
              <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-6 gap-2 my-2 text-[10px] font-mono bg-black/40 p-2 rounded-lg border border-white/5">
                <div>
                  <span className="text-slate-500 block text-[8px] uppercase">Live Price</span>
                  <span className="text-white font-bold">
                    {formatPrice(a.currentPrice, cur)}
                  </span>
                  <span className={`text-[8px] ml-1 font-bold ${a.change24h >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                    {a.change24h >= 0 ? '+' : ''}{a.change24h.toFixed(1)}%
                  </span>
                </div>

                <div>
                  <span className="text-slate-500 block text-[8px] uppercase">SuperScore</span>
                  <span className={`font-black ${a.superScore >= 68 ? 'text-emerald-400' : a.superScore <= 35 ? 'text-red-400' : 'text-cyan-400'}`}>
                    {a.superScore}/99
                  </span>
                </div>

                <div>
                  <span className="text-slate-500 block text-[8px] uppercase">RSI (14)</span>
                  <span className={`font-bold ${a.rsi < 35 ? 'text-emerald-400' : a.rsi > 65 ? 'text-red-400' : 'text-slate-300'}`}>
                    {a.rsi}
                  </span>
                </div>

                <div>
                  <span className="text-slate-500 block text-[8px] uppercase">Entry Zone</span>
                  <span className="text-cyan-300 font-bold">{a.entryZone}</span>
                </div>

                <div>
                  <span className="text-slate-500 block text-[8px] uppercase">Stop Loss / T1</span>
                  <span className="text-red-400">{cur}{a.stopLoss}</span>
                  <span className="text-slate-600 mx-0.5">/</span>
                  <span className="text-emerald-400">{cur}{a.target1}</span>
                </div>

                <div>
                  <span className="text-slate-500 block text-[8px] uppercase">3-Yr Target</span>
                  <span className="text-purple-300 font-bold">{cur}{a.targetLongTerm3Yr.toFixed(0)}</span>
                </div>
              </div>

              {/* AI Thesis Note */}
              <div className="text-[9px] text-slate-400 italic flex items-center justify-between gap-2 mt-1">
                <span>💡 {a.aiThesis}</span>
                <span className="text-[8px] font-mono text-slate-500 shrink-0">
                  R:R 1:{a.riskReward} • Conviction {a.convictionScore}%
                </span>
              </div>
            </div>
          );
        })}
      </div>

      {/* 5. Action Suite Bar */}
      <div className="flex flex-wrap items-center justify-between gap-3 pt-3 border-t border-white/5 bg-black/20 p-3 rounded-xl">
        <div className="text-[10px] text-slate-400">
          ⚡ <b>Live Execution:</b> Order sheet copy karke Zerodha, Groww ya INDmoney me direct execute karein.
        </div>

        <div className="flex items-center gap-2">
          {appliedMsg && (
            <span className="text-[10px] font-bold text-emerald-400 animate-fade-in">
              ✅ Monthly SIP settings updated!
            </span>
          )}

          <button
            onClick={handleApplyToSIP}
            className="px-3 py-1.5 rounded-xl bg-cyan-500/10 hover:bg-cyan-500/20 text-cyan-300 border border-cyan-500/30 text-xs font-bold transition-all flex items-center gap-1.5"
            title="Auto-apply calculated split to Monthly SIP inputs"
          >
            <span>⚡</span> Apply to SIP
          </button>

          <button
            onClick={handleCopyOrderSheet}
            className="px-3 py-1.5 rounded-xl bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 text-xs font-bold transition-all flex items-center gap-1.5"
          >
            <span>{copied ? '✅' : '📋'}</span>
            {copied ? 'Copied Order Sheet!' : 'Copy Order Sheet'}
          </button>

          <button
            onClick={handleSendTelegram}
            disabled={sendingTG}
            className="px-3 py-1.5 rounded-xl bg-indigo-500/10 hover:bg-indigo-500/20 text-indigo-300 border border-indigo-500/30 text-xs font-bold transition-all flex items-center gap-1.5 disabled:opacity-50"
          >
            <span>{sendingTG ? '⏳' : '📤'}</span>
            {sendingTG ? 'Sending...' : 'Send to Telegram'}
          </button>
        </div>
      </div>
    </div>
  );
});
