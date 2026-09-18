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

// FEATURE 6 (upgraded): Step-Up SIP projection with optional inflation
// adjustment. Now returns both nominal AND real (inflation-adjusted) FV.
function projectSIP(
  monthly: number,
  stepUpPct: number,
  years: number,
  cagr: number,
  inflationPct: number = 0
): { fv: number; invested: number; wealthGain: number; realFv: number; realMultiplier: number } {
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

  // FEATURE 9 hook: inflation-adjusted "real" future value, discounted
  // back to today's purchasing power using CAGR for full horizon.
  // Real FV = Nominal FV / (1 + inflation) ^ years
  const realFv = inflationPct > 0
    ? futureValue / Math.pow(1 + inflationPct / 100, years)
    : futureValue;
  // Real multiplier: real FV / invested (in today's terms)
  const realMultiplier = totalInvested > 0 ? realFv / totalInvested : 0;

  return {
    fv: Math.round(futureValue),
    invested: Math.round(totalInvested),
    wealthGain: Math.round(futureValue - totalInvested),
    realFv: Math.round(realFv),
    realMultiplier,
  };
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

  // FEATURE 6 + FEATURE 9 integration: inflation toggle + value.
  const [showInflation, setShowInflation] = useState(true);
  const [inflationRate, setInflationRate] = useState(6);  // India avg CPI

  // FEATURE 6 (new): Step-Up Comparison Panel.
  // Shows side-by-side: Flat SIP vs 5%/10%/15%/20% step-up, holding
  // years + cagr constant — proves the power of step-up.
  const stepUpComparison = useMemo(() => {
    return [0, 5, 10, 15, 20].map(step => {
      const r = projectSIP(currentSIP, step, investYears, 14, showInflation ? inflationRate : 0);
      return {
        stepUpPct: step,
        label: step === 0 ? 'Flat' : `+${step}%/yr`,
        fv: r.fv,
        realFv: r.realFv,
        invested: r.invested,
        multiplier: r.invested > 0 ? r.fv / r.invested : 0,
        finalYearSIP: currentSIP * Math.pow(1 + step / 100, investYears - 1),
      };
    });
  }, [currentSIP, investYears, showInflation, inflationRate]);

  const maxStepFV = Math.max(...stepUpComparison.map(s => s.fv), 1);

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
      ...projectSIP(s.monthlySIP, s.stepUpPct, s.years, s.cagr, showInflation ? inflationRate : 0),
    })),
    [scenarios, showInflation, inflationRate]
  );

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

  const fmtINR = (n: number) => {
    if (n >= 10000000) return `₹${(n / 10000000).toFixed(2)} Cr`;
    if (n >= 100000) return `₹${(n / 100000).toFixed(1)}L`;
    return `₹${Math.round(n).toLocaleString('en-IN')}`;
  };

  return (
    <div className="quantum-panel rounded-2xl p-5 animate-fade-in-up">
      <div className="flex items-center justify-between mb-4">
        <div className="text-[10px] text-cyan-500/70 font-bold uppercase tracking-wider">What-If SIP Optimizer · Step-Up Mode</div>
        <button
          onClick={applyRegime}
          disabled={regimeLoading}
          className="px-3 py-1 bg-purple-500/10 border border-purple-500/30 rounded-lg text-[10px] font-bold text-purple-400 hover:bg-purple-500/20 transition-all disabled:opacity-50"
        >
          {regimeLoading ? '⏳ Fetching...' : '🤖 Apply ML Regime'}
        </button>
      </div>

      {/* FEATURE 9 integration: inflation toggle */}
      <div className="mb-3 flex items-center gap-3 p-2 bg-blue-500/5 border border-blue-500/15 rounded-lg">
        <label className="flex items-center gap-1.5 text-[10px] text-blue-300 cursor-pointer">
          <input
            type="checkbox"
            checked={showInflation}
            onChange={e => setShowInflation(e.target.checked)}
            className="w-3 h-3 accent-blue-500"
          />
          Inflation-Adjusted (Real Value)
        </label>
        {showInflation && (
          <div className="flex items-center gap-1 ml-auto">
            <span className="text-[9px] text-slate-500">Inflation:</span>
            <input
              type="number"
              value={inflationRate}
              onChange={e => setInflationRate(Math.max(0, Math.min(20, parseFloat(e.target.value) || 0)))}
              className="w-12 bg-black/40 rounded px-1.5 py-0.5 text-[10px] font-bold text-white outline-none border border-white/5"
            />
            <span className="text-[9px] text-slate-500">%/yr</span>
          </div>
        )}
      </div>

      {regimeLabel && (
        <div className="mb-3 px-3 py-1.5 bg-purple-500/10 border border-purple-500/20 rounded-lg text-[10px] text-purple-300">
          Regime: <span className="font-bold text-purple-200">{regimeLabel}</span> — SIP adjusted by ML HMM multiplier
        </div>
      )}

      {/* FEATURE 6 (new): Step-Up Comparison Strip */}
      <div className="mb-4 p-3 bg-black/30 border border-white/5 rounded-xl">
        <div className="flex items-center justify-between mb-2">
          <span className="text-[10px] text-cyan-400 font-bold uppercase tracking-wider">📊 Step-Up Power Comparison</span>
          <span className="text-[9px] text-slate-600">{fmtINR(currentSIP)}/mo × {investYears}yr @ 14%</span>
        </div>
        <div className="grid grid-cols-3 sm:grid-cols-5 gap-1.5">
          {stepUpComparison.map((s, i) => {
            const barH = Math.max(8, (s.fv / maxStepFV) * 60);
            const isBest = s.fv === maxStepFV;
            return (
              <div key={i} className="flex flex-col items-center text-center">
                <div className="text-[9px] font-bold text-white">{s.label}</div>
                <div className="text-[8px] text-cyan-400 font-mono mb-1">{fmtINR(s.fv)}</div>
                <div
                  className={`w-full rounded-t transition-all ${isBest ? 'bg-gradient-to-t from-cyan-600 to-cyan-300' : 'bg-gradient-to-t from-slate-700 to-slate-500'}`}
                  style={{ height: `${barH}px` }}
                />
                <div className="text-[7px] text-slate-600 mt-1">
                  {s.multiplier.toFixed(1)}x
                </div>
                <div className="text-[7px] text-slate-700 mt-0.5">
                  ₹{(s.finalYearSIP / 1000).toFixed(0)}K/yr-end
                </div>
                {showInflation && (
                  <div className="text-[7px] text-blue-400/60 mt-0.5">
                    real {fmtINR(s.realFv)}
                  </div>
                )}
              </div>
            );
          })}
        </div>
        <div className="text-[8px] text-slate-600 mt-2 leading-snug">
          💡 {stepUpComparison[4].multiplier.toFixed(1)}x vs Flat ({stepUpComparison[0].multiplier.toFixed(1)}x) — step-up SIP can {(stepUpComparison[4].multiplier / stepUpComparison[0].multiplier).toFixed(1)}x your corpus!
        </div>
      </div>

      {/* Scenario Cards */}
      <div className="grid md:grid-cols-2 gap-3 mb-4">
        {projections.map((p, i) => {
          const barWidth = maxFV > 0 ? (p.fv / maxFV) * 100 : 0;
          const multLabel = p.regimeMultiplier !== 1 ? ` (${p.regimeMultiplier}x)` : '';
          return (
            <div key={i} className="bg-black/30 rounded-xl p-3 border border-white/5">
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs font-bold text-white">{p.emoji} {p.name}{multLabel}</span>
                <span className="text-[10px] font-bold text-cyan-400">{fmtINR(p.fv)}</span>
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
                <span className="text-slate-500">Invested: <span className="text-white font-bold">{fmtINR(p.invested)}</span></span>
                <span className="text-slate-500">Gain: <span className="text-emerald-400 font-bold">{fmtINR(p.wealthGain)}</span></span>
                <span className="text-slate-500">x: <span className="text-cyan-400 font-bold">{p.invested > 0 ? (p.fv / p.invested).toFixed(1) : '—'}x</span></span>
              </div>

              {/* FEATURE 9: Real value line */}
              {showInflation && (
                <div className="mt-1 pt-1 border-t border-white/5 text-[9px] text-blue-400/70">
                  💎 Real value: <span className="font-bold text-blue-300">{fmtINR(p.realFv)}</span> (today's purchasing power)
                </div>
              )}
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
        ML Regime-Tilted scenario auto-adjusts SIP via HMM regime multiplier (RISK_ON=1.3x, RISK_OFF=0.7x, GOLDILOCKS=1.1x, STAGFLATION=0.8x). Step-up comparison assumes 14% CAGR baseline. All projections are illustrative, not guaranteed.
      </div>
    </div>
  );
});

WhatIfSIPOptimizer.displayName = 'WhatIfSIPOptimizer';
