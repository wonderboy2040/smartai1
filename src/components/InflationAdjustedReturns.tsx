import React, { useState, useEffect } from 'react';
import {
  fetchInflationRates, realCagr, realValue, inflateExpense,
  inflateFireNumber, inflationDrag, realVsNominalSummary,
} from '../utils/inflationEngine';

interface Props {
  portfolioValue: number;        // INR
  nominalCagr: number;           // %, e.g. 12
  years: number;                 // horizon
  monthlyExpense: number;        // INR (today)
}

/**
 * Compact widget showing inflation-adjusted "real" returns alongside
 * the nominal numbers. Designed to be embedded in PlannerTab and
 * DashboardTab to give users a reality check on long-term projections.
 */
export const InflationAdjustedReturns = React.memo(({
  portfolioValue, nominalCagr, years, monthlyExpense,
}: Props) => {
  const [indiaInflation, setIndiaInflation] = useState(6);  // fallback default
  const [usInflation, setUsInflation] = useState(3);
  const [loading, setLoading] = useState(true);
  const [manualOverride, setManualOverride] = useState<number | null>(null);

  useEffect(() => {
    fetchInflationRates()
      .then(r => {
        setIndiaInflation(r.india);
        setUsInflation(r.us);
      })
      .catch(() => { /* defaults remain */ })
      .finally(() => setLoading(false));
  }, []);

  const inflation = manualOverride ?? indiaInflation;
  const realCagrPct = realCagr(nominalCagr, inflation);

  // Future value of current portfolio (nominal + real).
  const futureNominal = portfolioValue * Math.pow(1 + nominalCagr / 100, years);
  const futureReal = realValue(futureNominal, inflation, years);

  // Future inflated monthly expense (today's ₹50K → ₹X in 20yr).
  const futureMonthlyExpense = inflateExpense(monthlyExpense, inflation, years);

  // Inflated FIRE number (today's expense × 25 × inflation^years).
  const inflatedFireNumber = inflateFireNumber(monthlyExpense, inflation, years, 25);
  const inflatedFireReal = realValue(inflatedFireNumber, inflation, years);  // = today's FIRE

  // Inflation drag — purchasing power lost per year on current portfolio.
  const yearlyDrag = inflationDrag(portfolioValue, inflation);

  // 20-year drag summary.
  const dragSummary = realVsNominalSummary(futureNominal, inflation, years);

  const fmt = (n: number) => {
    if (n >= 10000000) return `₹${(n / 10000000).toFixed(2)} Cr`;
    if (n >= 100000) return `₹${(n / 100000).toFixed(1)}L`;
    return `₹${Math.round(n).toLocaleString('en-IN')}`;
  };

  return (
    <div className="quantum-panel rounded-2xl p-5 animate-fade-in-up">
      <div className="flex items-center justify-between mb-3">
        <div>
          <div className="text-[10px] text-cyan-500/70 font-bold uppercase tracking-wider">💎 Real Returns (Inflation-Adjusted)</div>
          <div className="text-[9px] text-slate-600 mt-0.5">
            India CPI: <span className="text-cyan-400 font-bold">{indiaInflation.toFixed(1)}%</span>
            {' · '}
            US CPI: <span className="text-cyan-400 font-bold">{usInflation.toFixed(1)}%</span>
            {loading && <span className="text-slate-700"> · loading...</span>}
          </div>
        </div>
        {/* Manual override */}
        <div className="flex items-center gap-1">
          <span className="text-[9px] text-slate-500">Custom:</span>
          <input
            type="number"
            value={manualOverride ?? inflation}
            onChange={e => {
              const v = parseFloat(e.target.value);
              setManualOverride(isNaN(v) ? null : Math.max(0, Math.min(20, v)));
            }}
            className="w-12 bg-black/40 rounded px-1.5 py-0.5 text-[10px] font-bold text-white outline-none border border-white/5"
          />
          <span className="text-[9px] text-slate-500">%</span>
        </div>
      </div>

      {/* Headline: Real CAGR */}
      <div className="grid grid-cols-3 gap-2 mb-3">
        <div className="bg-black/30 border border-white/5 rounded-xl p-2.5 text-center">
          <div className="text-[8px] text-slate-500 uppercase font-bold tracking-wider mb-1">Nominal CAGR</div>
          <div className="text-base font-black text-cyan-400 font-mono">{nominalCagr.toFixed(1)}%</div>
        </div>
        <div className="bg-black/30 border border-white/5 rounded-xl p-2.5 text-center">
          <div className="text-[8px] text-slate-500 uppercase font-bold tracking-wider mb-1">Inflation</div>
          <div className="text-base font-black text-amber-400 font-mono">{inflation.toFixed(1)}%</div>
        </div>
        <div className="bg-emerald-500/5 border border-emerald-500/15 rounded-xl p-2.5 text-center">
          <div className="text-[8px] text-emerald-400/70 uppercase font-bold tracking-wider mb-1">Real CAGR</div>
          <div className={`text-base font-black font-mono ${realCagrPct > 0 ? 'text-emerald-300' : 'text-red-300'}`}>
            {realCagrPct > 0 ? '+' : ''}{realCagrPct.toFixed(1)}%
          </div>
        </div>
      </div>

      {/* Future corpus: nominal vs real */}
      <div className="p-3 bg-blue-500/5 border border-blue-500/15 rounded-xl mb-3">
        <div className="text-[10px] text-blue-400 font-bold uppercase tracking-wider mb-2">
          📈 {years}-Year Future Value of Current Portfolio
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <div className="text-[9px] text-slate-500">Nominal (headlines)</div>
            <div className="text-lg font-black text-cyan-300 font-mono">{fmt(futureNominal)}</div>
          </div>
          <div>
            <div className="text-[9px] text-slate-500">Real (today's purchasing power)</div>
            <div className="text-lg font-black text-blue-300 font-mono">{fmt(futureReal)}</div>
          </div>
        </div>
        <div className="mt-2 pt-2 border-t border-white/5 text-[9px] text-slate-400 leading-snug">
          💡 Your ₹{Math.round(portfolioValue / 100000).toFixed(1)}L today will feel like <span className="text-blue-300 font-bold">{fmt(futureReal)}</span> in {years} years.
          Inflation eats <span className="text-red-400 font-bold">{dragSummary.lostPct.toFixed(0)}%</span> of nominal growth.
        </div>
      </div>

      {/* Future expense + FIRE */}
      <div className="grid grid-cols-2 gap-2 mb-3">
        <div className="bg-black/30 border border-white/5 rounded-xl p-2.5">
          <div className="text-[9px] text-slate-500 uppercase font-bold tracking-wider mb-1">Future Monthly Expense</div>
          <div className="text-sm font-black text-amber-300 font-mono">{fmt(futureMonthlyExpense)}</div>
          <div className="text-[8px] text-slate-600 mt-0.5">Today's ₹{monthlyExpense.toLocaleString('en-IN')} inflated</div>
        </div>
        <div className="bg-black/30 border border-white/5 rounded-xl p-2.5">
          <div className="text-[9px] text-slate-500 uppercase font-bold tracking-wider mb-1">Inflated FIRE Target</div>
          <div className="text-sm font-black text-orange-300 font-mono">{fmt(inflatedFireNumber)}</div>
          <div className="text-[8px] text-slate-600 mt-0.5">= {fmt(inflatedFireReal)} today's value</div>
        </div>
      </div>

      {/* Inflation drag */}
      <div className="p-2.5 bg-red-500/5 border border-red-500/15 rounded-lg">
        <div className="flex items-center justify-between">
          <div>
            <div className="text-[10px] text-red-400 font-bold uppercase tracking-wider">💸 Inflation Drag</div>
            <div className="text-[9px] text-slate-500">Purchasing power lost per year on current portfolio</div>
          </div>
          <div className="text-base font-black text-red-300 font-mono">{fmt(yearlyDrag)}/yr</div>
        </div>
      </div>

      <div className="text-[8px] text-slate-700 mt-2 leading-tight">
        Source: World Bank CPI (FP.CPI.TOTL.ZG). Real CAGR via Fisher equation: (1+nominal)/(1+inflation)−1. Override inflation % above to model different scenarios.
      </div>
    </div>
  );
});

InflationAdjustedReturns.displayName = 'InflationAdjustedReturns';
