import React, { useMemo, useState } from 'react';
import { useApp } from '../../hooks/AppContext';
import { RiskLevel } from '../../types';
import { formatCurrency } from '../../utils/constants';
import { analyzeAsset } from '../../utils/telegram';
import { SmartDipSizer } from '../SmartDipSizer';
import { WhatIfSIPOptimizer } from '../WhatIfSIPOptimizer';
import { MonthlyAnalyticsPanel } from '../MonthlyAnalyticsPanel';
import {
  calculateWealthMilestones, compareSIPStepUps,
  analyzeGoals, analyzeRebalancing, calculatePortfolioXIRR,
  adjustForInflation, calculateFireVariants, planCryptoDCA,
  DEFAULT_GOALS, type InvestmentGoal
} from '../../utils/wealthEngine';

export default React.memo(function PlannerTab() {
  const {
    portfolio, livePrices, usdInrRate, metrics,
    indiaSIP, setIndiaSIP, usSIP, setUsSIP, btcSIP, setBtcSIP, ethSIP, setEthSIP,
    emergencyFund, setEmergencyFund, investYears, setInvestYears, riskLevel, setRiskLevel,
    monthlyExpenses, setMonthlyExpenses, currentAge, setCurrentAge,
    totalSIP, cagr, totalInvestedPlanner, fvMed, fvWorst, fvBest, multiplier,
    fireNumber, yearsToFire, fireProgress,
    smartAllocations,
  } = useApp();

  // --- Goals State (localStorage persisted) ---
  const [goals, setGoals] = useState<InvestmentGoal[]>(() => {
    try { const s = localStorage.getItem('wealth_goals'); return s ? JSON.parse(s) : DEFAULT_GOALS; } catch { return DEFAULT_GOALS; }
  });
  const [showAddGoal, setShowAddGoal] = useState(false);
  const [newGoalName, setNewGoalName] = useState('');
  const [newGoalAmount, setNewGoalAmount] = useState('');
  const [newGoalYear, setNewGoalYear] = useState('2035');
  const [newGoalEmoji, setNewGoalEmoji] = useState('🎯');

  // Persist goals
  React.useEffect(() => { localStorage.setItem('wealth_goals', JSON.stringify(goals)); }, [goals]);

  // --- Computed: Wealth Milestones ---
  const milestones = useMemo(() =>
    calculateWealthMilestones(metrics.totalValue, totalSIP, cagr, 10),
    [metrics.totalValue, totalSIP, cagr]
  );

  // --- Computed: SIP Step-Up Comparison ---
  const stepUpScenarios = useMemo(() =>
    compareSIPStepUps(totalSIP, investYears, cagr),
    [totalSIP, investYears, cagr]
  );

  // --- Computed: Goal Analysis ---
  const goalAnalysis = useMemo(() =>
    analyzeGoals(goals, metrics.totalValue, totalSIP, cagr),
    [goals, metrics.totalValue, totalSIP, cagr]
  );

  // --- Computed: Rebalancing ---
  const rebalanceItems = useMemo(() =>
    analyzeRebalancing(portfolio, livePrices, usdInrRate),
    [portfolio, livePrices, usdInrRate]
  );
  const needsRebalance = rebalanceItems.filter(r => r.action !== 'OK');

  // --- Computed: XIRR / Real Returns / FIRE Variants / Crypto DCA ---
  const xirrData = useMemo(() =>
    calculatePortfolioXIRR(portfolio, livePrices, usdInrRate),
    [portfolio, livePrices, usdInrRate]
  );
  const realFvMed = useMemo(() => adjustForInflation(fvMed, investYears), [fvMed, investYears]);
  const fireVariants = useMemo(() =>
    calculateFireVariants(monthlyExpenses, metrics.totalValue, currentAge, 60, cagr),
    [monthlyExpenses, metrics.totalValue, currentAge, cagr]
  );
  const cryptoDCA = useMemo(() => planCryptoDCA(btcSIP, ethSIP, investYears), [btcSIP, ethSIP, investYears]);

  const addGoal = () => {
    const amt = parseFloat(newGoalAmount);
    const yr = parseInt(newGoalYear);
    if (!newGoalName || isNaN(amt) || amt <= 0 || isNaN(yr)) return;
    setGoals(prev => [...prev, { id: Date.now().toString(), name: newGoalName, emoji: newGoalEmoji, targetAmount: amt, targetYear: yr, priority: 'MEDIUM' }]);
    setNewGoalName(''); setNewGoalAmount(''); setNewGoalYear('2035'); setShowAddGoal(false);
  };
  const removeGoal = (id: string) => setGoals(prev => prev.filter(g => g.id !== id));

  return (
    <div className="space-y-5 animate-fade-in">
      <h2 className="text-2xl font-black gradient-text-cyan font-display">
        🎯 Wealth Planner
      </h2>

      {/* ============ DEEP DATA ANALYTICS (monthly buy activity) ============ */}
      <MonthlyAnalyticsPanel />

      {/* SIP Config */}
      <div className="quantum-panel rounded-2xl p-5 animate-fade-in-up">
        <div className="text-[10px] text-cyan-500/70 font-bold uppercase tracking-wider mb-4">Monthly SIP Configuration</div>
        <div className="grid md:grid-cols-4 gap-3 mb-5">
          <div className="bg-blue-500/5 border border-blue-500/15 p-4 rounded-xl">
            <div className="text-xs font-bold text-blue-400 mb-2">🇮🇳 India SIP</div>
            <div className="flex items-center gap-2 quantum-input p-2 rounded-lg">
              <span className="text-lg text-blue-500/50">₹</span>
              <input type="number" value={indiaSIP} onChange={e => setIndiaSIP(parseFloat(e.target.value) || 0)} className="w-full bg-transparent outline-none text-lg font-bold text-white" />
            </div>
          </div>
          <div className="bg-emerald-500/5 border border-emerald-500/15 p-4 rounded-xl">
            <div className="text-xs font-bold text-emerald-400 mb-2">🌍 US/Global SIP</div>
            <div className="flex items-center gap-2 quantum-input p-2 rounded-lg">
              <span className="text-lg text-emerald-500/50">₹</span>
              <input type="number" value={usSIP} onChange={e => setUsSIP(parseFloat(e.target.value) || 0)} className="w-full bg-transparent outline-none text-lg font-bold text-white" />
            </div>
          </div>
          <div className="bg-orange-500/5 border border-orange-500/15 p-4 rounded-xl">
            <div className="text-xs font-bold text-orange-400 mb-2">₿ Bitcoin SIP</div>
            <div className="flex items-center gap-2 quantum-input p-2 rounded-lg">
              <span className="text-lg text-orange-500/50">₹</span>
              <input type="number" value={btcSIP} onChange={e => setBtcSIP(parseFloat(e.target.value) || 0)} className="w-full bg-transparent outline-none text-lg font-bold text-white" />
            </div>
          </div>
          <div className="bg-indigo-500/5 border border-indigo-500/15 p-4 rounded-xl">
            <div className="text-xs font-bold text-indigo-400 mb-2">🪙 Ethereum SIP</div>
            <div className="flex items-center gap-2 quantum-input p-2 rounded-lg">
              <span className="text-lg text-indigo-500/50">₹</span>
              <input type="number" value={ethSIP} onChange={e => setEthSIP(parseFloat(e.target.value) || 0)} className="w-full bg-transparent outline-none text-lg font-bold text-white" />
            </div>
          </div>
          <div className="bg-purple-500/5 border border-purple-500/15 p-4 rounded-xl">
            <div className="text-xs font-bold text-purple-400 mb-2">💵 Emergency Fund</div>
            <div className="flex items-center gap-2 quantum-input p-2 rounded-lg">
              <span className="text-lg text-purple-500/50">₹</span>
              <input type="number" value={emergencyFund} onChange={e => setEmergencyFund(parseFloat(e.target.value) || 0)} className="w-full bg-transparent outline-none text-lg font-bold text-white" />
            </div>
          </div>
        </div>
        <div className="grid md:grid-cols-2 gap-5">
          <div>
            <label className="text-slate-500 text-[10px] font-bold uppercase tracking-wider block mb-2">Investment Horizon</label>
            <select value={investYears} onChange={e => setInvestYears(parseInt(e.target.value))} className="w-full px-4 py-3 quantum-input rounded-xl text-white">
              {[3, 5, 10, 15, 20, 25, 30].map(y => (<option key={y} value={y}>{y} Years</option>))}
            </select>
          </div>
          <div>
            <label className="text-slate-500 text-[10px] font-bold uppercase tracking-wider block mb-2">Risk Appetite</label>
            <div className="flex gap-1.5">
              {(['low', 'medium', 'high'] as RiskLevel[]).map(r => (
                <button key={r} onClick={() => setRiskLevel(r)} className={`flex-1 py-2.5 rounded-xl font-semibold text-xs transition-all ${riskLevel === r ? 'bg-cyan-500/15 text-cyan-400 border border-cyan-500/20' : 'quantum-input text-slate-500'}`}>
                  {r === 'low' && '🛡️ Safe'}{r === 'medium' && '⚖️ Balanced'}{r === 'high' && '🚀 Aggressive'}
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Monte Carlo */}
      <div className="quantum-panel rounded-2xl p-5 animate-fade-in-up delay-100">
        <h3 className="text-base font-bold text-white mb-4 flex items-center gap-2">
          <span className="w-7 h-7 rounded-lg bg-cyan-500/10 flex items-center justify-center text-sm">🔮</span>
          Monte Carlo Simulator
        </h3>
        <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
          <div className="quantum-stat p-3 rounded-xl text-center">
            <div className="text-[10px] text-slate-500 font-bold uppercase tracking-wider mb-1">Monthly SIP</div>
            <div className="text-lg font-black text-white font-mono">₹{Math.round(totalSIP).toLocaleString('en-IN')}</div>
          </div>
          <div className="quantum-stat p-3 rounded-xl text-center">
            <div className="text-[10px] text-slate-500 font-bold uppercase tracking-wider mb-1">Total Invested</div>
            <div className="text-lg font-black text-slate-300 font-mono">₹{Math.round(totalInvestedPlanner).toLocaleString('en-IN')}</div>
          </div>
          <div className="bg-red-500/5 border border-red-500/15 p-3 rounded-xl text-center">
            <div className="text-[10px] text-red-400/80 font-bold uppercase tracking-wider mb-1">Worst Case</div>
            <div className="text-base font-black text-red-400 font-mono">₹{Math.round(fvWorst).toLocaleString('en-IN')}</div>
          </div>
          <div className="bg-cyan-500/5 border-2 border-cyan-500/20 p-4 rounded-xl text-center">
            <div className="text-[10px] text-cyan-400/80 font-bold uppercase tracking-wider mb-1">🎯 Expected</div>
            <div className="text-xl font-black text-cyan-400 font-mono">₹{Math.round(fvMed).toLocaleString('en-IN')}</div>
          </div>
          <div className="bg-emerald-500/5 border border-emerald-500/15 p-3 rounded-xl text-center">
            <div className="text-[10px] text-emerald-400/80 font-bold uppercase tracking-wider mb-1">Best Case</div>
            <div className="text-base font-black text-emerald-400 font-mono">₹{Math.round(fvBest).toLocaleString('en-IN')}</div>
          </div>
        </div>
        <div className="mt-4 p-4 bg-amber-500/5 rounded-xl border border-amber-500/15 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <span className="text-2xl">💎</span>
            <div>
              <div className="text-[10px] text-amber-400 font-bold uppercase tracking-wider">Wealth Multiplier</div>
              <div className="text-[10px] text-amber-200/40">Growth factor over investment period</div>
            </div>
          </div>
          <div className="text-3xl font-black text-amber-400 font-mono">{multiplier.toFixed(1)}x</div>
        </div>
        <div className="mt-3 p-4 bg-blue-500/5 rounded-xl border border-blue-500/15 flex items-center justify-between">
          <div>
            <div className="text-[10px] text-blue-400 font-bold uppercase tracking-wider">🧮 Real Value (Inflation-Adjusted @ 6%)</div>
            <div className="text-[10px] text-blue-200/40">Expected corpus in today's purchasing power</div>
          </div>
          <div className="text-xl font-black text-blue-300 font-mono">₹{Math.round(realFvMed).toLocaleString('en-IN')}</div>
        </div>
      </div>

      {/* What-If SIP Optimizer — Regime-Aware */}
      <WhatIfSIPOptimizer currentSIP={totalSIP} investYears={investYears} />

      {/* FIRE */}
      <div className="quantum-panel rounded-2xl p-5 border-orange-500/10 animate-fade-in-up delay-200">
        <h3 className="text-base font-bold text-white mb-4 flex items-center gap-2">
          <span className="w-7 h-7 rounded-lg bg-orange-500/10 flex items-center justify-center text-sm">🔥</span>
          FIRE Calculator
        </h3>
        <div className="grid md:grid-cols-2 gap-3 mb-4">
          <div className="bg-black/20 p-4 rounded-xl">
            <label className="text-slate-500 text-[10px] font-bold uppercase tracking-wider block mb-2">Monthly Expenses</label>
            <div className="flex items-center gap-2 quantum-input p-2 rounded-lg">
              <span className="text-lg text-slate-600">₹</span>
              <input type="number" value={monthlyExpenses} onChange={e => setMonthlyExpenses(parseFloat(e.target.value) || 0)} className="w-full bg-transparent outline-none text-lg font-bold text-white" />
            </div>
          </div>
          <div className="bg-black/20 p-4 rounded-xl">
            <label className="text-slate-500 text-[10px] font-bold uppercase tracking-wider block mb-2">Current Age</label>
            <div className="flex items-center gap-2 quantum-input p-2 rounded-lg">
              <span className="text-lg">🎂</span>
              <input type="number" value={currentAge} onChange={e => setCurrentAge(parseInt(e.target.value) || 0)} className="w-full bg-transparent outline-none text-lg font-bold text-white" />
            </div>
          </div>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <div className="stat-card bg-orange-500/5 border border-orange-500/15 p-3 rounded-xl text-center">
            <div className="text-[10px] text-orange-400/80 font-bold uppercase tracking-wider mb-1">FIRE Number</div>
            <div className="text-lg font-black text-orange-400 font-mono">₹{Math.round(fireNumber).toLocaleString('en-IN')}</div>
          </div>
          <div className="stat-card bg-emerald-500/5 border border-emerald-500/15 p-3 rounded-xl text-center">
            <div className="text-[10px] text-emerald-400/80 font-bold uppercase tracking-wider mb-1">Years to FIRE</div>
            <div className="text-lg font-black text-emerald-400">{yearsToFire} yrs</div>
          </div>
          <div className="stat-card bg-cyan-500/5 border border-cyan-500/15 p-3 rounded-xl text-center">
            <div className="text-[10px] text-cyan-400/80 font-bold uppercase tracking-wider mb-1">Retire At</div>
            <div className="text-lg font-black text-cyan-400">{currentAge + yearsToFire} yrs</div>
          </div>
          <div className="stat-card bg-purple-500/5 border border-purple-500/15 p-3 rounded-xl text-center">
            <div className="text-[10px] text-purple-400/80 font-bold uppercase tracking-wider mb-1">Passive Income</div>
            <div className="text-lg font-black text-purple-400 font-mono">₹{Math.round(fireNumber * 0.04 / 12).toLocaleString('en-IN')}/mo</div>
          </div>
        </div>
        <div className="mt-4">
          <div className="flex justify-between items-center mb-2">
            <span className="text-[10px] text-orange-400/80 font-bold uppercase tracking-wider">Progress to FIRE</span>
            <span className="text-sm font-black text-orange-400">{fireProgress.toFixed(1)}%</span>
          </div>
          <div className="w-full bg-black/40 rounded-full h-2.5 overflow-hidden border border-orange-500/10">
            <div className="bg-gradient-to-r from-orange-600 via-amber-400 to-emerald-400 h-full rounded-full transition-all duration-500" style={{ width: `${Math.min(100, fireProgress)}%` }} />
          </div>
        </div>
        {/* FIRE Variants — Lean / Standard / Fat / Coast (inflation-adjusted to age 60) */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mt-4">
          <div className="bg-black/20 p-3 rounded-xl text-center border border-white/5">
            <div className="text-[10px] text-slate-500 font-bold uppercase tracking-wider mb-1">🌱 Lean FIRE (20x)</div>
            <div className="text-sm font-black text-slate-200 font-mono">{formatCurrency(fireVariants.leanFire)}</div>
          </div>
          <div className="bg-black/20 p-3 rounded-xl text-center border border-white/5">
            <div className="text-[10px] text-slate-500 font-bold uppercase tracking-wider mb-1">🔥 Standard (25x)</div>
            <div className="text-sm font-black text-orange-300 font-mono">{formatCurrency(fireVariants.standardFire)}</div>
          </div>
          <div className="bg-black/20 p-3 rounded-xl text-center border border-white/5">
            <div className="text-[10px] text-slate-500 font-bold uppercase tracking-wider mb-1">👑 Fat FIRE (33x)</div>
            <div className="text-sm font-black text-purple-300 font-mono">{formatCurrency(fireVariants.fatFire)}</div>
          </div>
          <div className={`p-3 rounded-xl text-center border ${fireVariants.coastAchieved ? 'bg-emerald-500/10 border-emerald-500/30' : 'bg-black/20 border-white/5'}`}>
            <div className="text-[10px] text-slate-500 font-bold uppercase tracking-wider mb-1">🏖️ Coast FIRE</div>
            <div className={`text-sm font-black font-mono ${fireVariants.coastAchieved ? 'text-emerald-400' : 'text-cyan-300'}`}>{formatCurrency(fireVariants.coastFire)}</div>
            {fireVariants.coastAchieved && <div className="text-[9px] text-emerald-400 font-bold mt-0.5">✅ ACHIEVED</div>}
          </div>
        </div>
        <div className="text-[9px] text-slate-600 mt-2 italic">Targets are inflation-adjusted (6%) to age-60 expenses. Coast FIRE = corpus needed today to reach Standard FIRE with zero further SIP.</div>
      </div>

      {/* ============ PORTFOLIO XIRR (TRUE ANNUALIZED RETURN) ============ */}
      {portfolio.length > 0 && (
        <div className="quantum-panel rounded-2xl p-5 border-emerald-500/10 animate-fade-in-up">
          <h3 className="text-base font-bold text-white mb-4 flex items-center gap-2">
            <span className="w-7 h-7 rounded-lg bg-emerald-500/10 flex items-center justify-center text-sm">📐</span>
            True Annualized Return (XIRR)
            <span className="ml-auto badge bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 text-[10px]">PRO METRIC</span>
          </h3>
          <div className="flex items-center justify-between p-4 bg-black/20 rounded-xl border border-emerald-500/15 mb-3">
            <div>
              <div className="text-[10px] text-slate-500 font-bold uppercase tracking-wider">Overall Portfolio XIRR</div>
              <div className="text-[9px] text-slate-600">Time-weighted annualized return (all assets, INR)</div>
            </div>
            <div className={`text-2xl font-black font-mono ${(xirrData.overallXIRR || 0) >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
              {xirrData.overallXIRR !== null ? `${xirrData.overallXIRR >= 0 ? '+' : ''}${xirrData.overallXIRR.toFixed(1)}%` : 'N/A'}
            </div>
          </div>
          <div className="grid md:grid-cols-2 gap-2">
            {xirrData.perAsset.map((a, i) => (
              <div key={i} className="flex items-center justify-between bg-black/20 rounded-lg px-3 py-2 border border-white/5">
                <div>
                  <span className="text-xs font-bold text-white">{a.symbol.replace('.NS', '')}</span>
                  <span className="text-[9px] text-slate-600 ml-2">{a.holdingDays}d held</span>
                </div>
                <span className={`text-xs font-black font-mono ${(a.xirr || 0) >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                  {a.xirr !== null ? `${a.xirr >= 0 ? '+' : ''}${a.xirr.toFixed(1)}%` : 'N/A'}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ============ CRYPTO DCA PLANNER ============ */}
      {cryptoDCA.length > 0 && (
        <div className="quantum-panel rounded-2xl p-5 border-orange-500/10 animate-fade-in-up">
          <h3 className="text-base font-bold text-white mb-4 flex items-center gap-2">
            <span className="w-7 h-7 rounded-lg bg-orange-500/10 flex items-center justify-center text-sm">🪙</span>
            Crypto DCA Planner (BTC/ETH HODL)
            <span className="ml-auto text-[10px] text-slate-500 font-mono">{investYears}yr horizon</span>
          </h3>
          <div className="grid md:grid-cols-2 gap-3">
            {cryptoDCA.map((c, i) => (
              <div key={i} className={`rounded-xl p-4 border ${c.asset === 'BTC' ? 'bg-orange-500/5 border-orange-500/15' : 'bg-indigo-500/5 border-indigo-500/15'}`}>
                <div className="flex items-center justify-between mb-3">
                  <span className="font-bold text-white text-sm">{c.asset === 'BTC' ? '₿ Bitcoin' : 'Ξ Ethereum'}</span>
                  <span className="text-[10px] text-slate-500 font-mono">₹{c.monthlySIP.toLocaleString('en-IN')}/mo</span>
                </div>
                <div className="space-y-2 text-[11px]">
                  <div className="flex justify-between"><span className="text-slate-500">Total Invested</span><span className="font-mono text-slate-300">{formatCurrency(c.totalInvested)}</span></div>
                  <div className="flex justify-between"><span className="text-slate-500">Conservative ({c.conservativeCagr}% CAGR)</span><span className="font-mono text-amber-400">{formatCurrency(c.conservative)}</span></div>
                  <div className="flex justify-between"><span className="text-slate-500">Expected ({c.expectedCagr}% CAGR)</span><span className="font-mono text-emerald-400 font-bold">{formatCurrency(c.expected)}</span></div>
                </div>
              </div>
            ))}
          </div>
          <div className="text-[9px] text-slate-600 mt-3 italic">⚠️ Crypto is high-volatility (50-80% drawdowns possible). DCA + long HODL horizon required. Keep crypto ≤10% of net worth.</div>
        </div>
      )}

      {/* Smart AI Allocations */}
      {portfolio.length > 0 && (
        <div className="quantum-panel rounded-2xl p-5 border-purple-500/10 animate-fade-in-up delay-300">
          <h3 className="text-base font-bold text-white mb-4 flex items-center gap-2">
            <span className="w-7 h-7 rounded-lg bg-purple-500/10 flex items-center justify-center text-sm">🤖</span>
            Smart AI Allocation Engine
            <span className="ml-auto badge bg-purple-500/10 text-purple-400 border border-purple-500/20 text-[10px]">PRO ENGINE</span>
          </h3>

          {/* Per-Asset Analysis Cards */}
          <div className="grid md:grid-cols-2 gap-3 mb-4">
            {portfolio.slice(0, 8).map(p => {
              const key = `${p.market}_${p.symbol}`;
              const signal = analyzeAsset(p, livePrices[key]);
              const signalColors: Record<string, { bg: string; text: string; border: string }> = {
                'BUY': { bg: 'bg-emerald-500/10', text: 'text-emerald-400', border: 'border-emerald-500/20' },
                'SELL': { bg: 'bg-red-500/10', text: 'text-red-400', border: 'border-red-500/20' },
                'HOLD': { bg: 'bg-amber-500/10', text: 'text-amber-400', border: 'border-amber-500/20' },
              };
              const sc = signalColors[signal.action] || signalColors['HOLD'];
              const cur = p.market === 'IN' ? '₹' : '$';

              return (
                <div key={p.id} className={`bg-black/20 rounded-xl p-4 border ${sc.border}`}>
                  <div className="flex justify-between items-start mb-3">
                    <div>
                      <div className="font-bold text-white text-sm">{p.symbol.replace('.NS', '')}</div>
                      <div className="text-[10px] text-slate-500">{p.market === 'IN' ? '🇮🇳 India' : '🦅 USA'}</div>
                    </div>
                    <span className={`${sc.bg} ${sc.text} px-2.5 py-1 rounded-lg text-[10px] font-black border ${sc.border}`}>
                      {signal.action === 'BUY' ? '🟢' : signal.action === 'SELL' ? '🔴' : '🟡'} {signal.action}
                    </span>
                  </div>
                  {/* Metrics Grid */}
                  <div className="grid grid-cols-4 gap-1.5 text-center mb-3">
                    <div className="bg-black/30 rounded-lg p-1.5">
                      <div className="text-[8px] text-slate-600 uppercase">RSI</div>
                      <div className={`text-xs font-bold font-mono ${signal.rsi < 35 ? 'text-emerald-400' : signal.rsi > 65 ? 'text-red-400' : 'text-amber-400'}`}>{signal.rsi.toFixed(0)}</div>
                    </div>
                    <div className="bg-black/30 rounded-lg p-1.5">
                      <div className="text-[8px] text-slate-600 uppercase">Trend</div>
                      <div className="text-xs font-bold">{signal.trend === 'up' ? '📈' : signal.trend === 'down' ? '📉' : '↔'}</div>
                    </div>
                    <div className="bg-black/30 rounded-lg p-1.5">
                      <div className="text-[8px] text-slate-600 uppercase">Price</div>
                      <div className="text-xs font-bold text-cyan-400 font-mono">{cur}{signal.price.toFixed(2)}</div>
                    </div>
                    <div className="bg-black/30 rounded-lg p-1.5">
                      <div className="text-[8px] text-slate-600 uppercase">Score</div>
                      <div className={`text-xs font-bold font-mono ${sc.text}`}>{signal.confidence}</div>
                    </div>
                  </div>
                  {/* Strength Bar */}
                  <div className="mb-2">
                    <div className="w-full bg-slate-800/60 rounded-full h-1.5">
                      <div className={`h-full rounded-full transition-all ${signal.confidence > 75 ? 'bg-gradient-to-r from-emerald-500 to-cyan-400' : signal.confidence > 50 ? 'bg-gradient-to-r from-amber-500 to-yellow-400' : 'bg-gradient-to-r from-red-500 to-orange-400'}`} style={{ width: `${signal.confidence}%` }} />
                    </div>
                  </div>
                  {/* Fib S/R */}
                  <div className="flex items-center gap-2 text-[10px] text-slate-500">
                    <span>SL: <span className="text-red-400 font-mono">{cur}{(signal.fibLow || 0).toFixed(1)}</span></span>
                    <span className="text-slate-700">→</span>
                    <span>TP: <span className="text-emerald-400 font-mono">{cur}{(signal.fibHigh || 0).toFixed(1)}</span></span>
                  </div>
                </div>
              );
            })}
          </div>

          {/* Allocation Recommendations */}
          {(() => {
            const allocs = smartAllocations;
            return (
              <div className="bg-black/20 rounded-xl p-4 border border-purple-500/15">
                <div className="flex items-center justify-between mb-4">
                  <div className="text-[10px] text-purple-400 font-bold uppercase tracking-wider">
                    💰 Monthly SIP Allocation
                  </div>
                  <div className="text-[10px] text-slate-500 font-mono">
                    ₹{Math.round(indiaSIP).toLocaleString()} IN + ₹{usSIP.toLocaleString()} US + ₹{(btcSIP + ethSIP).toLocaleString()} Crypto
                  </div>
                </div>
                <div className="space-y-3">
                  {allocs.map((a, i) => {
                    const cur = a.market === 'IN' ? '₹' : '$';
                    const isGreen = a.signal.includes('BUY') || a.signal.includes('ACCUMULATE') || a.signal.includes('STRONG');
                    const isRed = a.signal.includes('AVOID') || a.signal.includes('DISTRIBUTE');
                    return (
                      <div key={i} className="bg-black/20 rounded-xl p-3 border border-white/5 hover:border-cyan-500/20 transition-all">
                        <div className="flex items-center justify-between mb-2">
                          <div className="flex items-center gap-2">
                            <span className="text-sm">{a.market === 'IN' ? '🇮🇳' : '🦅'}</span>
                            <div>
                              <span className="font-bold text-white text-sm">{a.symbol.replace('.NS', '')}</span>
                              <div className="text-[9px] text-slate-600 truncate max-w-[160px]">{a.name}</div>
                            </div>
                          </div>
                          <div className="text-right">
                            <div className="font-black text-cyan-400 font-mono text-sm">₹{a.allocAmount.toLocaleString()}</div>
                            <div className="text-[9px] text-slate-600">{(a.allocPct * 100).toFixed(0)}% of SIP</div>
                          </div>
                        </div>
                        {/* Signal + Allocation Bar */}
                        <div className="flex items-center gap-2 mb-2">
                          <span className={`text-[9px] font-black px-2 py-0.5 rounded-md border ${isGreen ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20' :
                            isRed ? 'bg-red-500/10 text-red-400 border-red-500/20' :
                              'bg-amber-500/10 text-amber-400 border-amber-500/20'
                            }`}>{a.signal}</span>
                          <div className="flex-1 bg-slate-800/60 rounded-full h-1.5">
                            <div className={`h-full rounded-full transition-all ${isGreen ? 'bg-emerald-500' : isRed ? 'bg-red-500' : 'bg-amber-500'}`} style={{ width: `${a.allocPct * 100}%` }} />
                          </div>
                        </div>
                        {/* Details Row */}
                        <div className="grid grid-cols-4 gap-1 text-[9px] text-slate-500">
                          <div>RSI: <span className="text-slate-300 font-mono">{a.rsi.toFixed(0)}</span></div>
                          <div>Entry: <span className="text-cyan-400 font-mono">{cur}{a.targetEntry.toFixed(1)}</span></div>
                          <div>Str: <span className={`font-bold ${a.strength > 65 ? 'text-emerald-400' : a.strength < 35 ? 'text-red-400' : 'text-amber-400'}`}>{a.strength}</span></div>
                          <div>R:R <span className="text-cyan-300 font-mono">{a.riskReward.toFixed(1)}</span></div>
                        </div>
                        {/* Reason */}
                        <div className="text-[9px] text-slate-600 mt-1.5 italic leading-snug">{a.reason}</div>
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })()}

          {/* Smart Buy-on-Dip Position Sizing */}
          <SmartDipSizer
            portfolio={portfolio}
            livePrices={livePrices}
            monthlyBudget={indiaSIP + usSIP}
          />

          {/* Quantum Compound Growth Projection Panel */}
          <div className="bg-black/20 rounded-xl p-4 border border-blue-500/15 col-span-1 md:col-span-2 mt-4">
            <div className="flex items-center justify-between mb-4">
              <div className="text-xs font-bold text-blue-400 uppercase tracking-wider flex items-center gap-2">
                <span className="text-lg">📈</span> Quantum Compound Growth Projection
              </div>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead>
                  <tr className="border-b border-white/5 text-slate-500">
                    <th className="py-2">Horizon</th>
                    <th className="py-2">Invested</th>
                    <th className="py-2 text-emerald-400">@ 15% CAGR</th>
                    <th className="py-2 text-emerald-400">@ 20% CAGR</th>
                    <th className="py-2 text-emerald-400">@ 25% CAGR</th>
                  </tr>
                </thead>
                <tbody className="text-slate-300">
                  {[5, 10, 15, 20].map(y => {
                    const inv = totalSIP * 12 * y;
                    const calc = (rate: number) => totalSIP * 12 * ((Math.pow(1 + rate/100, y) - 1) / (rate/100));
                    return (
                      <tr key={y} className="border-b border-white/5 last:border-0 hover:bg-white/5">
                        <td className="py-2 font-bold">{y} Years</td>
                        <td className="py-2 font-mono">₹{formatCurrency(inv, '')}</td>
                        <td className="py-2 font-mono text-emerald-400/70">₹{formatCurrency(calc(15), '')}</td>
                        <td className="py-2 font-mono text-emerald-400/85">₹{formatCurrency(calc(20), '')}</td>
                        <td className="py-2 font-mono text-emerald-400 font-bold">₹{formatCurrency(calc(25), '')}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>

          {/* Advanced Asset Allocation Strategy */}
          <div className="bg-black/20 rounded-xl p-4 border border-cyan-500/15 mt-4">
            <div className="text-xs font-bold text-cyan-400 uppercase tracking-wider mb-4 flex items-center gap-2">
              <span className="text-lg">🎯</span> Core-Satellite Allocation Strategy
            </div>
            <div className="space-y-3 text-sm text-slate-300">
              <div className="flex justify-between items-center p-2 bg-white/5 rounded">
                <span>Rule of 100 (Eq/Debt)</span>
                <span className="font-mono text-cyan-400">{100 - currentAge}% / {currentAge}%</span>
              </div>
              <div className="flex justify-between items-center p-2 bg-white/5 rounded">
                <span>Core (Index/Large Cap)</span>
                <span className="font-mono text-emerald-400">50-60%</span>
              </div>
              <div className="flex justify-between items-center p-2 bg-white/5 rounded">
                <span>Satellite (Mid/Small/Alpha)</span>
                <span className="font-mono text-orange-400">30-40%</span>
              </div>
              <div className="flex justify-between items-center p-2 bg-white/5 rounded">
                <span>Moonshot (Crypto/BTC/ETH)</span>
                <span className="font-mono text-purple-400">5-10%</span>
              </div>
            </div>
          </div>

          {/* SIP Step-Up Calculator */}
          <div className="bg-black/20 rounded-xl p-4 border border-purple-500/15 mt-4">
            <div className="text-xs font-bold text-purple-400 uppercase tracking-wider mb-4 flex items-center gap-2">
              <span className="text-lg">🚀</span> 10% Annual SIP Step-Up Magic
            </div>
            <div className="text-xs text-slate-400 mb-4">
              Increasing your SIP by 10% every year drastically boosts final wealth.
            </div>
            <div className="space-y-2">
              {(() => {
                const r = 0.15; // 15% CAGR
                const step = 0.10; // 10% Step-Up
                const y = investYears;
                let currentSip = totalSIP;
                let wealth = 0;
                let totalInv = 0;
                for(let i=1; i<=y; i++) {
                  const yearlySip = currentSip * 12;
                  totalInv += yearlySip;
                  wealth = (wealth + yearlySip) * (1 + r);
                  currentSip *= (1 + step);
                }
                return (
                  <div className="grid grid-cols-2 gap-4">
                    <div className="p-3 bg-white/5 rounded-lg text-center">
                      <div className="text-[10px] uppercase text-slate-500 mb-1">Total Invested</div>
                      <div className="font-mono text-sm text-white">₹{formatCurrency(totalInv, '')}</div>
                    </div>
                    <div className="p-3 bg-white/5 rounded-lg text-center border border-emerald-500/30">
                      <div className="text-[10px] uppercase text-emerald-500 mb-1">Final Wealth (15% CAGR)</div>
                      <div className="font-mono text-sm text-emerald-400 font-bold">₹{formatCurrency(wealth, '')}</div>
                    </div>
                  </div>
                );
              })()}
            </div>
           </div>

         </div>
       )}

      {/* ============ WEALTH MILESTONE TRACKER ============ */}
      <div className="quantum-panel rounded-2xl p-5 border-amber-500/10 animate-fade-in-up">
        <h3 className="text-base font-bold text-white mb-4 flex items-center gap-2">
          <span className="w-7 h-7 rounded-lg bg-amber-500/10 flex items-center justify-center text-sm">🏆</span>
          Wealth Milestone Tracker
          <span className="ml-auto badge bg-amber-500/10 text-amber-400 border border-amber-500/20 text-[10px]">JOURNEY</span>
        </h3>
        <div className="space-y-3">
          {milestones.map((m, i) => (
            <div key={i} className={`rounded-xl p-3 border transition-all ${
              m.reached ? 'bg-emerald-500/10 border-emerald-500/30' :
              m.progress > 50 ? 'bg-amber-500/5 border-amber-500/20' :
              'bg-black/20 border-white/5'
            }`}>
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2">
                  <span className="text-xl">{m.emoji}</span>
                  <div>
                    <span className="font-bold text-white text-sm">{m.label}</span>
                    {m.reached && <span className="ml-2 text-[10px] text-emerald-400 font-bold">✅ ACHIEVED!</span>}
                  </div>
                </div>
                <div className="text-right">
                  {m.reached ? (
                    <div className="text-sm font-black text-emerald-400">Done!</div>
                  ) : (
                    <>
                      <div className="text-sm font-black text-amber-400">{m.estimatedDate}</div>
                      <div className="text-[10px] text-slate-500">{m.yearsToReach ? `${m.yearsToReach} years` : '50+ yrs'}</div>
                    </>
                  )}
                </div>
              </div>
              <div className="w-full bg-slate-800/60 rounded-full h-2 overflow-hidden">
                <div
                  className={`h-full rounded-full transition-all duration-700 ${
                    m.reached ? 'bg-gradient-to-r from-emerald-500 to-cyan-400' :
                    m.progress > 50 ? 'bg-gradient-to-r from-amber-500 to-yellow-400' :
                    'bg-gradient-to-r from-cyan-600 to-blue-500'
                  }`}
                  style={{ width: `${m.progress}%` }}
                />
              </div>
              <div className="flex justify-between mt-1 text-[10px] text-slate-500">
                <span>{m.progress.toFixed(0)}%</span>
                <span>{!m.reached ? `₹${Math.round(m.target - metrics.totalValue).toLocaleString('en-IN')} remaining` : ''}</span>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* ============ SIP STEP-UP COMPARISON ============ */}
      <div className="quantum-panel rounded-2xl p-5 border-indigo-500/10 animate-fade-in-up">
        <h3 className="text-base font-bold text-white mb-4 flex items-center gap-2">
          <span className="w-7 h-7 rounded-lg bg-indigo-500/10 flex items-center justify-center text-sm">📊</span>
          SIP Step-Up Power Comparison
          <span className="ml-auto text-[10px] text-slate-500 font-mono">{investYears}yr @ {cagr}% CAGR</span>
        </h3>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead>
              <tr className="border-b border-white/5 text-slate-500">
                <th className="py-2">Scenario</th>
                <th className="py-2 text-right">Invested</th>
                <th className="py-2 text-right">Final Wealth</th>
                <th className="py-2 text-right">Profit</th>
                <th className="py-2 text-right">Multiplier</th>
              </tr>
            </thead>
            <tbody className="text-slate-300">
              {stepUpScenarios.map((s, i) => (
                <tr key={i} className={`border-b border-white/5 last:border-0 hover:bg-white/5 ${
                  s.stepUpPercent === 10 ? 'bg-cyan-500/5' : ''
                }`}>
                  <td className="py-2.5">
                    <span className="font-bold">{s.label}</span>
                    {s.stepUpPercent === 10 && <span className="ml-1 text-[8px] bg-cyan-500/20 text-cyan-400 px-1.5 py-0.5 rounded border border-cyan-500/20">RECOMMENDED</span>}
                  </td>
                  <td className="py-2.5 text-right font-mono text-slate-400">{formatCurrency(s.totalInvested)}</td>
                  <td className="py-2.5 text-right font-mono text-emerald-400 font-bold">{formatCurrency(s.finalWealth)}</td>
                  <td className="py-2.5 text-right font-mono text-cyan-400">{formatCurrency(s.wealthGain)}</td>
                  <td className="py-2.5 text-right">
                    <span className={`font-black font-mono ${
                      s.multiplier >= 5 ? 'text-emerald-400' : s.multiplier >= 3 ? 'text-cyan-400' : 'text-amber-400'
                    }`}>{s.multiplier}x</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {stepUpScenarios.length >= 2 && (
          <div className="mt-3 p-3 bg-emerald-500/5 border border-emerald-500/15 rounded-xl text-xs text-emerald-400">
            💡 <strong>10% Step-Up vs Flat SIP:</strong> You gain extra <strong>{formatCurrency((stepUpScenarios[2]?.finalWealth || 0) - (stepUpScenarios[0]?.finalWealth || 0))}</strong> — that's <strong>{((stepUpScenarios[2]?.finalWealth || 1) / (stepUpScenarios[0]?.finalWealth || 1) * 100 - 100).toFixed(0)}% MORE</strong> wealth!
          </div>
        )}
      </div>

      {/* ============ GOAL-BASED PLANNER ============ */}
      <div className="quantum-panel rounded-2xl p-5 border-teal-500/10 animate-fade-in-up">
        <h3 className="text-base font-bold text-white mb-4 flex items-center gap-2">
          <span className="w-7 h-7 rounded-lg bg-teal-500/10 flex items-center justify-center text-sm">🎯</span>
          Goal-Based Investment Planner
          <button onClick={() => setShowAddGoal(!showAddGoal)} className="ml-auto quantum-btn-primary px-3 py-1.5 bg-gradient-to-r from-teal-600 to-cyan-600 rounded-lg text-[10px] font-bold text-white">+ Add Goal</button>
        </h3>

        {/* Add Goal Form */}
        {showAddGoal && (
          <div className="mb-4 p-4 bg-black/20 rounded-xl border border-teal-500/20 animate-fade-in">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <div>
                <label className="text-[9px] text-slate-500 font-bold uppercase block mb-1">Goal Name</label>
                <input type="text" value={newGoalName} onChange={e => setNewGoalName(e.target.value)} placeholder="e.g. Dream House" className="w-full px-3 py-2 quantum-input rounded-lg text-xs text-white" />
              </div>
              <div>
                <label className="text-[9px] text-slate-500 font-bold uppercase block mb-1">Target (₹)</label>
                <input type="number" value={newGoalAmount} onChange={e => setNewGoalAmount(e.target.value)} placeholder="3000000" className="w-full px-3 py-2 quantum-input rounded-lg text-xs text-white font-mono" />
              </div>
              <div>
                <label className="text-[9px] text-slate-500 font-bold uppercase block mb-1">Target Year</label>
                <input type="number" value={newGoalYear} onChange={e => setNewGoalYear(e.target.value)} className="w-full px-3 py-2 quantum-input rounded-lg text-xs text-white font-mono" />
              </div>
              <div>
                <label className="text-[9px] text-slate-500 font-bold uppercase block mb-1">Emoji</label>
                <div className="flex gap-1.5">
                  {['🎯', '🏠', '🎓', '🚗', '✈️', '🏖️', '💍', '🏥'].map(e => (
                    <button key={e} onClick={() => setNewGoalEmoji(e)} className={`w-8 h-8 rounded-lg flex items-center justify-center text-base transition-all ${
                      newGoalEmoji === e ? 'bg-teal-500/20 border border-teal-500/40 scale-110' : 'bg-black/30 border border-white/5'
                    }`}>{e}</button>
                  ))}
                </div>
              </div>
            </div>
            <button onClick={addGoal} className="mt-3 quantum-btn-primary px-5 py-2 bg-gradient-to-r from-teal-600 to-emerald-600 rounded-lg text-xs font-bold text-white">✅ Add Goal</button>
          </div>
        )}

        {/* Goal Cards */}
        <div className="space-y-3">
          {goalAnalysis.map(g => (
            <div key={g.id} className={`rounded-xl p-4 border transition-all ${
              g.feasibility === 'ON_TRACK' ? 'bg-emerald-500/5 border-emerald-500/20' :
              g.feasibility === 'NEEDS_MORE' ? 'bg-amber-500/5 border-amber-500/20' :
              'bg-red-500/5 border-red-500/20'
            }`}>
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2">
                  <span className="text-xl">{g.emoji}</span>
                  <div>
                    <span className="font-bold text-white text-sm">{g.name}</span>
                    <div className="text-[10px] text-slate-500 font-mono">
                      Target: {formatCurrency(g.targetAmount)} by {g.targetYear} ({g.yearsLeft}yr left)
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <span className={`px-2 py-1 rounded-lg text-[9px] font-bold border ${
                    g.feasibility === 'ON_TRACK' ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20' :
                    g.feasibility === 'NEEDS_MORE' ? 'bg-amber-500/10 text-amber-400 border-amber-500/20' :
                    'bg-red-500/10 text-red-400 border-red-500/20'
                  }`}>
                    {g.feasibility === 'ON_TRACK' ? '🟢 ON TRACK' : g.feasibility === 'NEEDS_MORE' ? '🟡 NEEDS MORE' : '🔴 AT RISK'}
                  </span>
                  <button onClick={() => removeGoal(g.id)} className="text-slate-600 hover:text-red-400 transition-colors text-xs">✕</button>
                </div>
              </div>
              <div className="w-full bg-slate-800/60 rounded-full h-1.5 mb-2 overflow-hidden">
                <div className={`h-full rounded-full transition-all ${
                  g.feasibility === 'ON_TRACK' ? 'bg-gradient-to-r from-emerald-500 to-cyan-400' :
                  g.feasibility === 'NEEDS_MORE' ? 'bg-gradient-to-r from-amber-500 to-yellow-400' :
                  'bg-gradient-to-r from-red-500 to-orange-400'
                }`} style={{ width: `${Math.min(100, g.progress)}%` }} />
              </div>
              <div className="grid grid-cols-3 gap-2 text-[10px]">
                <div>
                  <span className="text-slate-500">Monthly Needed: </span>
                  <span className="text-cyan-400 font-mono font-bold">₹{g.monthlyNeeded.toLocaleString('en-IN')}</span>
                </div>
                <div>
                  <span className="text-slate-500">Progress: </span>
                  <span className="text-white font-bold">{g.progress}%</span>
                </div>
                <div>
                  {g.gap > 0 ? (
                    <><span className="text-slate-500">Gap: </span><span className="text-red-400 font-mono font-bold">₹{g.gap.toLocaleString('en-IN')}/mo</span></>
                  ) : (
                    <span className="text-emerald-400 font-bold">✅ SIP Covers This!</span>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* ============ REBALANCING ALERTS ============ */}
      {portfolio.length > 1 && (
        <div className="quantum-panel rounded-2xl p-5 border-rose-500/10 animate-fade-in-up">
          <h3 className="text-base font-bold text-white mb-4 flex items-center gap-2">
            <span className="w-7 h-7 rounded-lg bg-rose-500/10 flex items-center justify-center text-sm">⚖️</span>
            Portfolio Rebalancing
            {needsRebalance.length > 0 && (
              <span className="ml-2 px-2 py-0.5 bg-red-500/20 text-red-400 text-[9px] font-bold rounded-md border border-red-500/30 animate-pulse">
                {needsRebalance.length} ACTIONS NEEDED
              </span>
            )}
          </h3>

          <div className="space-y-2">
            {rebalanceItems.map((r, i) => (
              <div key={i} className={`rounded-xl p-3 border flex items-center gap-3 transition-all ${
                r.action === 'BUY_MORE' ? 'bg-emerald-500/5 border-emerald-500/15' :
                r.action === 'TRIM' ? 'bg-red-500/5 border-red-500/15' :
                'bg-black/20 border-white/5'
              }`}>
                <div className="w-28">
                  <div className="font-bold text-white text-sm">{r.symbol.replace('.NS', '')}</div>
                  <div className="text-[9px] text-slate-500">{r.market === 'IN' ? '🇮🇳' : '🦅'} {r.market}</div>
                </div>

                {/* Weight Bars */}
                <div className="flex-1">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-[9px] text-slate-500 w-14">Current</span>
                    <div className="flex-1 bg-slate-800/60 rounded-full h-1.5 overflow-hidden">
                      <div className="bg-cyan-500 h-full rounded-full transition-all" style={{ width: `${Math.min(100, r.currentWeight)}%` }} />
                    </div>
                    <span className="text-[10px] text-cyan-400 font-mono w-10 text-right">{r.currentWeight}%</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-[9px] text-slate-500 w-14">Target</span>
                    <div className="flex-1 bg-slate-800/60 rounded-full h-1.5 overflow-hidden">
                      <div className="bg-amber-500/50 h-full rounded-full transition-all" style={{ width: `${Math.min(100, r.targetWeight)}%` }} />
                    </div>
                    <span className="text-[10px] text-amber-400 font-mono w-10 text-right">{r.targetWeight}%</span>
                  </div>
                </div>

                {/* Drift */}
                <div className="w-16 text-center">
                  <div className={`text-xs font-black font-mono ${
                    Math.abs(r.drift) > 5 ? (r.drift > 0 ? 'text-red-400' : 'text-emerald-400') : 'text-slate-400'
                  }`}>
                    {r.drift > 0 ? '+' : ''}{r.drift}%
                  </div>
                  <div className="text-[8px] text-slate-600">drift</div>
                </div>

                {/* Action */}
                <div className="w-24 text-right">
                  {r.action !== 'OK' ? (
                    <>
                      <div className={`text-[10px] font-bold ${r.action === 'BUY_MORE' ? 'text-emerald-400' : 'text-red-400'}`}>
                        {r.action === 'BUY_MORE' ? '🟢 BUY' : '🔴 TRIM'}
                      </div>
                      <div className="text-[10px] font-mono text-slate-400">
                        ₹{Math.abs(r.adjustAmount).toLocaleString('en-IN')}
                      </div>
                    </>
                  ) : (
                    <span className="text-[10px] text-slate-500">✅ OK</span>
                  )}
                </div>
              </div>
            ))}
          </div>

          {needsRebalance.length === 0 && (
            <div className="mt-3 p-3 bg-emerald-500/5 border border-emerald-500/15 rounded-xl text-xs text-emerald-400 text-center">
              ✅ Portfolio is well-balanced! No rebalancing needed.
            </div>
          )}
        </div>
      )}

     </div>
   );
 });
