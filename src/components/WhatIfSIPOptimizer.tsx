import React, { useState, useMemo, useCallback } from 'react';
import { fetchMLRegime } from '../utils/mlApi';

interface Scenario {
  name: string;
  emoji: string;
  monthlySIP: number;
  stepUpPct: number;
  years: number;
  cagr: number;
  regimeMultiplier: number;
}

const BASE_SCENARIOS: Scenario[] = [
  { name: 'Conservative', emoji: '🛡️', monthlySIP: 10000, stepUpPct: 5, years: 15, cagr: 10, regimeMultiplier: 1 },
  { name: 'Balanced', emoji: '⚖️', monthlySIP: 15000, stepUpPct: 10, years: 15, cagr: 14, regimeMultiplier: 1 },
  { name: 'Aggressive', emoji: '🚀', monthlySIP: 20000, stepUpPct: 15, years: 15, cagr: 18, regimeMultiplier: 1 },
  { name: 'ML Regime-Tilted', emoji: '🤖', monthlySIP: 15000, stepUpPct: 10, years: 15, cagr: 14, regimeMultiplier: 1 },
];

function projectSIP(monthly: number, stepUpPct: number, years: number, cagr: number): { fv: number; invested: number; wealthGain: number } {
  let totalInvested = 0;
  let futureValue = 0;
  const monthlyRate = cagr / 100 / 12;
  const stepUpFactor = 1 + stepUpPct / 100;

  for (let year = 0; year < years; year++) {
    const yearlySIP = monthly * Math.pow(stepUpFactor, year);
    for (let m = 0; m < 12; m++) {
      const remainingMonths = (years - year) * 12 - m;
      totalInvested += yearlySIP;
      futureValue += yearlySIP * Math.pow(1 + monthlyRate, remainingMonths);
    }
  }

  return { fv: Math.round(futureValue), invested: Math.round(totalInvested), wealthGain: Math.round(futureValue - totalInvested) };
}

interface Props {
  currentSIP: number;
  investYears: number;
}

export const WhatIfSIPOptimizer = React.memo(({ currentSIP, investYears }: Props) => {
  const [scenarios, setScenarios] = useState<Scenario[]>(() =>
    BASE_SCENARIOS.map(s => ({ ...s, monthlySIP: s.name === 'Balanced' ? currentSIP : s.monthlySIP, years: investYears }))
  );
  const [regimeLoading, setRegimeLoading] = useState(false);
  const [regimeLabel, setRegimeLabel] = useState('');
  const [showCustom, setShowCustom] = useState(false);
  const [customName, setCustomName] = useState('');
  const [customSIP, setCustomSIP] = useState('');
  const [customStepUp, setCustomStepUp] = useState('10');
  const [customYears, setCustomYears] = useState(investYears.toString());
  const [customCAGR, setCustomCAGR] = useState('14');

  const applyRegime = useCallback(async () => {
    setRegimeLoading(true);
    try {
      const r = await fetchMLRegime();
      const mult = r.sip_multiplier || 1;
      const label = r.regime?.replace('_', ' ') || 'Unknown';
      setRegimeLabel(`${label} (${mult}x)`);
      setScenarios(prev => prev.map(s =>
        s.name === 'ML Regime-Tilted' ? { ...s, regimeMultiplier: mult, monthlySIP: Math.round(15000 * mult) } : s
      ));
    } catch {
      setRegimeLabel('ML offline — using 1x');
    } finally {
      setRegimeLoading(false);
    }
  }, []);

  const projections = useMemo(() =>
    scenarios.map(s => ({
      ...s,
      ...projectSIP(s.monthlySIP, s.stepUpPct, s.years, s.cagr),
    })),
    [scenarios]
  );

  // FIX L36: Math.max(...[]) returns -Infinity when projections is empty
  // (defensive — shouldn't happen but avoids NaN-derived bar widths).
  const maxFV = projections.length > 0 ? Math.max(...projections.map(p => p.fv)) : 0;

  const addCustom = () => {
    const sip = parseFloat(customSIP);
    const stepUp = parseFloat(customStepUp);
    const yrs = parseInt(customYears);
    const cagr = parseFloat(customCAGR);
    if (isNaN(sip) || sip <= 0 || isNaN(stepUp) || isNaN(yrs) || isNaN(cagr)) return;
    setScenarios(prev => [...prev, {
      name: customName || `Custom ₹${(sip / 1000).toFixed(0)}K`,
      emoji: '✨',
      monthlySIP: sip,
      stepUpPct: stepUp,
      years: yrs,
      cagr,
      regimeMultiplier: 1,
    }]);
    setShowCustom(false);
    setCustomName('');
    setCustomSIP('');
  };

  const updateScenario = (idx: number, field: keyof Scenario, value: number) => {
    setScenarios(prev => prev.map((s, i) => i === idx ? { ...s, [field]: value } : s));
  };

  return (
    <div className="quantum-panel rounded-2xl p-5 animate-fade-in-up">
      <div className="flex items-center justify-between mb-4">
        <div className="text-[10px] text-cyan-500/70 font-bold uppercase tracking-wider">What-If SIP Optimizer</div>
        <button
          onClick={applyRegime}
          disabled={regimeLoading}
          className="px-3 py-1 bg-purple-500/10 border border-purple-500/30 rounded-lg text-[10px] font-bold text-purple-400 hover:bg-purple-500/20 transition-all disabled:opacity-50"
        >
          {regimeLoading ? '⏳ Fetching...' : '🤖 Apply ML Regime'}
        </button>
      </div>

      {regimeLabel && (
        <div className="mb-3 px-3 py-1.5 bg-purple-500/10 border border-purple-500/20 rounded-lg text-[10px] text-purple-300">
          Regime: <span className="font-bold text-purple-200">{regimeLabel}</span> — SIP adjusted by ML HMM multiplier
        </div>
      )}

      {/* Scenario Cards */}
      <div className="grid md:grid-cols-2 gap-3 mb-4">
        {projections.map((p, i) => {
          const barWidth = maxFV > 0 ? (p.fv / maxFV) * 100 : 0;
          const multLabel = p.regimeMultiplier !== 1 ? ` (${p.regimeMultiplier}x)` : '';
          return (
            <div key={i} className="bg-black/30 rounded-xl p-3 border border-white/5">
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs font-bold text-white">{p.emoji} {p.name}{multLabel}</span>
                <span className="text-[10px] font-bold text-cyan-400">₹{(p.fv / 100000).toFixed(1)}L</span>
              </div>

              {/* Inputs */}
              <div className="grid grid-cols-2 gap-2 mb-2">
                <div>
                  <div className="text-[8px] text-slate-600 mb-0.5">Monthly SIP</div>
                  <div className="flex items-center gap-1 bg-black/40 rounded px-2 py-1">
                    <span className="text-[10px] text-slate-500">₹</span>
                    <input
                      type="number"
                      value={p.monthlySIP}
                      onChange={e => updateScenario(i, 'monthlySIP', parseFloat(e.target.value) || 0)}
                      className="w-full bg-transparent text-[11px] font-bold text-white outline-none"
                    />
                  </div>
                </div>
                <div>
                  <div className="text-[8px] text-slate-600 mb-0.5">Step-Up %</div>
                  <div className="flex items-center gap-1 bg-black/40 rounded px-2 py-1">
                    <input
                      type="number"
                      value={p.stepUpPct}
                      onChange={e => updateScenario(i, 'stepUpPct', parseFloat(e.target.value) || 0)}
                      className="w-full bg-transparent text-[11px] font-bold text-white outline-none"
                    />
                    <span className="text-[10px] text-slate-500">%</span>
                  </div>
                </div>
                <div>
                  <div className="text-[8px] text-slate-600 mb-0.5">Years</div>
                  <div className="flex items-center gap-1 bg-black/40 rounded px-2 py-1">
                    <input
                      type="number"
                      value={p.years}
                      onChange={e => updateScenario(i, 'years', parseInt(e.target.value) || 1)}
                      className="w-full bg-transparent text-[11px] font-bold text-white outline-none"
                    />
                  </div>
                </div>
                <div>
                  <div className="text-[8px] text-slate-600 mb-0.5">Expected CAGR</div>
                  <div className="flex items-center gap-1 bg-black/40 rounded px-2 py-1">
                    <input
                      type="number"
                      value={p.cagr}
                      onChange={e => updateScenario(i, 'cagr', parseFloat(e.target.value) || 0)}
                      className="w-full bg-transparent text-[11px] font-bold text-white outline-none"
                    />
                    <span className="text-[10px] text-slate-500">%</span>
                  </div>
                </div>
              </div>

              {/* Bar */}
              <div className="w-full bg-slate-800/60 rounded-full h-2 mb-1.5">
                <div
                  className="bg-gradient-to-r from-cyan-500 to-indigo-500 h-full rounded-full transition-all"
                  style={{ width: `${barWidth}%` }}
                />
              </div>

              {/* Stats */}
              <div className="flex justify-between text-[9px]">
                <span className="text-slate-500">Invested: <span className="text-white font-bold">₹{(p.invested / 100000).toFixed(1)}L</span></span>
                <span className="text-slate-500">Gain: <span className="text-emerald-400 font-bold">₹{(p.wealthGain / 100000).toFixed(1)}L</span></span>
                <span className="text-slate-500">x: <span className="text-cyan-400 font-bold">{p.invested > 0 ? (p.fv / p.invested).toFixed(1) : '—'}x</span></span>
              </div>
            </div>
          );
        })}
      </div>

      {/* Add Custom */}
      {!showCustom ? (
        <button onClick={() => setShowCustom(true)} className="w-full py-2 bg-white/5 border border-white/10 rounded-xl text-[10px] font-bold text-slate-400 hover:text-white hover:bg-white/10 transition-all">
          + Add Custom Scenario
        </button>
      ) : (
        <div className="bg-black/30 rounded-xl p-3 border border-cyan-500/20">
          <div className="text-[10px] text-cyan-400 font-bold mb-2">Custom Scenario</div>
          <div className="grid grid-cols-2 md:grid-cols-5 gap-2">
            <input placeholder="Name" value={customName} onChange={e => setCustomName(e.target.value)} className="bg-black/40 rounded px-2 py-1.5 text-[11px] text-white outline-none border border-white/10" />
            <input type="number" placeholder="SIP ₹" value={customSIP} onChange={e => setCustomSIP(e.target.value)} className="bg-black/40 rounded px-2 py-1.5 text-[11px] text-white outline-none border border-white/10" />
            <input type="number" placeholder="Step-Up %" value={customStepUp} onChange={e => setCustomStepUp(e.target.value)} className="bg-black/40 rounded px-2 py-1.5 text-[11px] text-white outline-none border border-white/10" />
            <input type="number" placeholder="Years" value={customYears} onChange={e => setCustomYears(e.target.value)} className="bg-black/40 rounded px-2 py-1.5 text-[11px] text-white outline-none border border-white/10" />
            <input type="number" placeholder="CAGR %" value={customCAGR} onChange={e => setCustomCAGR(e.target.value)} className="bg-black/40 rounded px-2 py-1.5 text-[11px] text-white outline-none border border-white/10" />
          </div>
          <div className="flex gap-2 mt-2">
            <button onClick={addCustom} className="px-4 py-1.5 bg-cyan-500/20 border border-cyan-500/30 rounded-lg text-[10px] font-bold text-cyan-400 hover:bg-cyan-500/30 transition-all">Add</button>
            <button onClick={() => setShowCustom(false)} className="px-4 py-1.5 bg-white/5 border border-white/10 rounded-lg text-[10px] font-bold text-slate-400 hover:text-white transition-all">Cancel</button>
          </div>
        </div>
      )}

      <div className="mt-3 text-[9px] text-slate-600">
        ML Regime-Tilted scenario auto-adjusts SIP via HMM regime multiplier (RISK_ON=1.3x, RISK_OFF=0.7x, GOLDILOCKS=1.1x, STAGFLATION=0.8x). All projections are illustrative, not guaranteed.
      </div>
    </div>
  );
});

WhatIfSIPOptimizer.displayName = 'WhatIfSIPOptimizer';
