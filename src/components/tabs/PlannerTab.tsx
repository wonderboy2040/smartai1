import React from 'react';
import { useApp } from '../../hooks/AppContext';
import { RiskLevel } from '../../types';
import { formatCurrency } from '../../utils/constants';
import { analyzeAsset } from '../../utils/telegram';
import { SmartDipSizer } from '../SmartDipSizer';

export default React.memo(function PlannerTab() {
  const {
    portfolio, livePrices,
    indiaSIP, setIndiaSIP, usSIP, setUsSIP, btcSIP, setBtcSIP, ethSIP, setEthSIP,
    emergencyFund, setEmergencyFund, investYears, setInvestYears, riskLevel, setRiskLevel,
    monthlyExpenses, setMonthlyExpenses, currentAge, setCurrentAge,
    totalSIP, totalInvestedPlanner, fvMed, fvWorst, fvBest, multiplier,
    fireNumber, yearsToFire, fireProgress,
    smartAllocations,
  } = useApp();

  return (
    <div className="space-y-5 animate-fade-in">
      <h2 className="text-2xl font-black gradient-text-cyan font-display">
        🎯 Wealth Planner
      </h2>

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
      </div>

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
      </div>

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
    </div>
  );
});
