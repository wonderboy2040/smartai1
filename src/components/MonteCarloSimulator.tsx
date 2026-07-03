import React, { useState, useCallback } from 'react';
import {
  runMonteCarloSIP, VOLATILITY_PRESETS, summarizeMonteCarlo,
  type MonteCarloResult, type VolatilityPreset,
} from '../utils/monteCarloEngine';

interface Props {
  currentSIP: number;
  investYears: number;
}

const PRESET_LABELS: Record<VolatilityPreset, { label: string; cagr: number }> = {
  conservative: { label: '🛡️ Conservative (80% Debt)', cagr: 8 },
  balanced: { label: '⚖️ Balanced (50/50)', cagr: 11 },
  growth: { label: '🌱 Growth (70% Equity)', cagr: 13 },
  aggressive: { label: '🚀 Aggressive (90% Equity)', cagr: 15 },
  ultra_aggressive: { label: '🔥 Ultra (Small-cap heavy)', cagr: 17 },
  crypto: { label: '₿ Crypto (BTC/ETH)', cagr: 25 },
};

export const MonteCarloSimulator = React.memo(({ currentSIP, investYears }: Props) => {
  const [monthlySIP, setMonthlySIP] = useState(currentSIP);
  const [years, setYears] = useState(investYears);
  const [preset, setPreset] = useState<VolatilityPreset>('growth');
  const [stepUp, setStepUp] = useState(10);
  const [targetCorpus, setTargetCorpus] = useState(10000000); // 1 Cr default
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<MonteCarloResult | null>(null);

  // Pull cagr + volatility from the selected preset, but allow override.
  const cagr = PRESET_LABELS[preset].cagr;
  const volatility = VOLATILITY_PRESETS[preset];

  const runSim = useCallback(async () => {
    setRunning(true);
    // Defer to next tick so the spinner can render before the CPU-heavy loop.
    await new Promise(r => setTimeout(r, 30));
    try {
      const r = runMonteCarloSIP({
        monthlySIP, years,
        annualCagrPct: cagr,
        annualVolatilityPct: volatility,
        stepUpPct: stepUp,
        targetCorpus,
        simulations: 10_000,
        seed: 42,  // deterministic — same inputs → same outputs
      });
      setResult(r);
    } finally {
      setRunning(false);
    }
  }, [monthlySIP, years, cagr, volatility, stepUp, targetCorpus]);

  // Auto-run on first mount so users see results immediately.
  React.useEffect(() => {
    runSim();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const fmtINR = (n: number) => {
    if (n >= 10000000) return `₹${(n / 10000000).toFixed(2)} Cr`;
    if (n >= 100000) return `₹${(n / 100000).toFixed(1)}L`;
    return `₹${Math.round(n).toLocaleString('en-IN')}`;
  };

  const hitPct = result ? (result.hitProbability * 100).toFixed(0) : '0';
  const hitColor = result
    ? (result.hitProbability > 0.7 ? 'text-emerald-400' : result.hitProbability > 0.4 ? 'text-amber-400' : 'text-red-400')
    : 'text-slate-400';

  // Histogram max for bar scaling.
  const maxBucket = result ? Math.max(...result.histogram.map(h => h.count), 1) : 1;

  // Percentile curve max for line chart scaling.
  const curveMax = result && result.percentileCurve.length
    ? Math.max(...result.percentileCurve.flatMap(p => [p.p10, p.p50, p.p90]))
    : 1;

  return (
    <div className="quantum-panel rounded-2xl p-5 animate-fade-in-up">
      <div className="flex items-center justify-between mb-4">
        <div>
          <div className="text-[10px] text-cyan-500/70 font-bold uppercase tracking-wider">Monte Carlo SIP Simulator</div>
          <div className="text-[9px] text-slate-600 mt-0.5">10,000 simulations • realistic range of outcomes</div>
        </div>
        <button
          onClick={runSim}
          disabled={running}
          className="px-3 py-1.5 bg-cyan-500/20 border border-cyan-500/30 rounded-lg text-[10px] font-bold text-cyan-400 hover:bg-cyan-500/30 transition-all disabled:opacity-50"
        >
          {running ? '⏳ Simulating...' : '🔄 Run Simulation'}
        </button>
      </div>

      {/* Inputs Grid */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
        <div>
          <label className="text-[8px] text-slate-600 uppercase font-bold tracking-wider block mb-1">Monthly SIP</label>
          <div className="flex items-center gap-1 bg-black/40 rounded px-2 py-1.5 border border-white/5">
            <span className="text-[10px] text-slate-500">₹</span>
            <input
              type="number"
              value={monthlySIP}
              onChange={e => setMonthlySIP(Math.max(0, parseFloat(e.target.value) || 0))}
              className="w-full bg-transparent text-[11px] font-bold text-white outline-none"
            />
          </div>
        </div>
        <div>
          <label className="text-[8px] text-slate-600 uppercase font-bold tracking-wider block mb-1">Years</label>
          <div className="flex items-center gap-1 bg-black/40 rounded px-2 py-1.5 border border-white/5">
            <input
              type="number"
              value={years}
              onChange={e => setYears(Math.max(1, Math.min(40, parseInt(e.target.value) || 1)))}
              className="w-full bg-transparent text-[11px] font-bold text-white outline-none"
            />
          </div>
        </div>
        <div>
          <label className="text-[8px] text-slate-600 uppercase font-bold tracking-wider block mb-1">Step-Up %</label>
          <div className="flex items-center gap-1 bg-black/40 rounded px-2 py-1.5 border border-white/5">
            <input
              type="number"
              value={stepUp}
              onChange={e => setStepUp(Math.max(0, Math.min(50, parseFloat(e.target.value) || 0)))}
              className="w-full bg-transparent text-[11px] font-bold text-white outline-none"
            />
            <span className="text-[10px] text-slate-500">%/yr</span>
          </div>
        </div>
        <div>
          <label className="text-[8px] text-slate-600 uppercase font-bold tracking-wider block mb-1">Target Corpus</label>
          <div className="flex items-center gap-1 bg-black/40 rounded px-2 py-1.5 border border-white/5">
            <span className="text-[10px] text-slate-500">₹</span>
            <input
              type="number"
              value={targetCorpus}
              onChange={e => setTargetCorpus(Math.max(0, parseFloat(e.target.value) || 0))}
              className="w-full bg-transparent text-[11px] font-bold text-white outline-none"
            />
          </div>
        </div>
      </div>

      {/* Risk Preset */}
      <div className="mb-4">
        <label className="text-[8px] text-slate-600 uppercase font-bold tracking-wider block mb-1.5">Risk Profile (CAGR / Volatility)</label>
        <div className="grid grid-cols-2 md:grid-cols-3 gap-1.5">
          {(Object.keys(PRESET_LABELS) as VolatilityPreset[]).map(k => (
            <button
              key={k}
              onClick={() => setPreset(k)}
              className={`px-2 py-1.5 rounded-lg text-[10px] font-bold border transition-all ${
                preset === k
                  ? 'bg-cyan-500/20 border-cyan-500/40 text-cyan-300'
                  : 'bg-black/30 border-white/5 text-slate-400 hover:text-white hover:border-white/10'
              }`}
            >
              {PRESET_LABELS[k].label}
              <div className="text-[8px] text-slate-500 mt-0.5">{PRESET_LABELS[k].cagr}% / {VOLATILITY_PRESETS[k]}% vol</div>
            </button>
          ))}
        </div>
      </div>

      {/* Results */}
      {running && !result && (
        <div className="py-10 text-center text-[11px] text-slate-500 animate-pulse">
          Running 10,000 simulations...
        </div>
      )}

      {result && (
        <>
          {/* Headline Numbers */}
          <div className="grid grid-cols-3 gap-2 mb-4">
            <div className="bg-red-500/5 border border-red-500/15 rounded-xl p-3 text-center">
              <div className="text-[9px] text-red-400/70 font-bold uppercase tracking-wider mb-1">Worst 10%</div>
              <div className="text-base font-black text-red-300 font-mono">{fmtINR(result.p10)}</div>
              <div className="text-[8px] text-slate-600 mt-0.5">Plan for this</div>
            </div>
            <div className="bg-amber-500/5 border border-amber-500/15 rounded-xl p-3 text-center">
              <div className="text-[9px] text-amber-400/70 font-bold uppercase tracking-wider mb-1">Median (P50)</div>
              <div className="text-base font-black text-amber-300 font-mono">{fmtINR(result.p50)}</div>
              <div className="text-[8px] text-slate-600 mt-0.5">Most likely</div>
            </div>
            <div className="bg-emerald-500/5 border border-emerald-500/15 rounded-xl p-3 text-center">
              <div className="text-[9px] text-emerald-400/70 font-bold uppercase tracking-wider mb-1">Best 10%</div>
              <div className="text-base font-black text-emerald-300 font-mono">{fmtINR(result.p90)}</div>
              <div className="text-[8px] text-slate-600 mt-0.5">Bull case</div>
            </div>
          </div>

          {/* Target Hit Probability */}
          {targetCorpus > 0 && (
            <div className="mb-4 p-3 bg-black/30 border border-white/5 rounded-xl">
              <div className="flex items-center justify-between mb-2">
                <span className="text-[10px] text-slate-400">Probability of hitting <span className="text-white font-bold">{fmtINR(targetCorpus)}</span></span>
                <span className={`text-lg font-black font-mono ${hitColor}`}>{hitPct}%</span>
              </div>
              <div className="w-full bg-slate-800/60 rounded-full h-2.5 overflow-hidden">
                <div
                  className={`h-full rounded-full transition-all ${
                    result.hitProbability > 0.7
                      ? 'bg-gradient-to-r from-emerald-500 to-teal-400'
                      : result.hitProbability > 0.4
                      ? 'bg-gradient-to-r from-amber-500 to-yellow-400'
                      : 'bg-gradient-to-r from-red-500 to-orange-400'
                  }`}
                  style={{ width: `${Math.min(100, result.hitProbability * 100)}%` }}
                />
              </div>
              <div className="text-[9px] text-slate-600 mt-1.5">
                {result.hitProbability > 0.7
                  ? '✅ Strong chance — proceed with confidence'
                  : result.hitProbability > 0.4
                  ? '⚠️ Moderate chance — consider increasing SIP or extending years'
                  : '🚨 Low chance — increase SIP, extend years, or lower target'}
              </div>
            </div>
          )}

          {/* Histogram */}
          {result.histogram.length > 0 && (
            <div className="mb-4">
              <div className="text-[10px] text-slate-500 font-bold uppercase tracking-wider mb-2">Distribution of 10,000 Outcomes</div>
              <div className="flex items-end gap-0.5 h-20 bg-black/20 rounded-lg p-1">
                {result.histogram.map((h, i) => {
                  const heightPct = (h.count / maxBucket) * 100;
                  const isTargetBucket = targetCorpus > 0
                    ? (i === result.histogram.length - 1 || (i > 0 && result.histogram[i - 1].bucket < targetCorpus && h.bucket >= targetCorpus))
                    : false;
                  return (
                    <div
                      key={i}
                      className={`flex-1 rounded-t transition-all ${
                        isTargetBucket ? 'bg-cyan-400' : 'bg-gradient-to-t from-cyan-600/40 to-cyan-400/60'
                      }`}
                      style={{ height: `${Math.max(2, heightPct)}%` }}
                      title={`${fmtINR(h.bucket)}: ${h.count} sims`}
                    />
                  );
                })}
              </div>
              <div className="flex justify-between text-[8px] text-slate-600 mt-1">
                <span>{fmtINR(result.min)}</span>
                <span>{fmtINR(result.mean)}</span>
                <span>{fmtINR(result.max)}</span>
              </div>
            </div>
          )}

          {/* Percentile Curve Over Time */}
          {result.percentileCurve.length > 1 && (
            <div className="mb-4">
              <div className="text-[10px] text-slate-500 font-bold uppercase tracking-wider mb-2">Year-by-Year Percentile Curves</div>
              <div className="relative h-32 bg-black/20 rounded-lg p-2 overflow-hidden">
                <svg viewBox="0 0 400 120" className="w-full h-full" preserveAspectRatio="none">
                  {/* P10 (worst) — red */}
                  <polyline
                    fill="none"
                    stroke="rgba(248, 113, 113, 0.7)"
                    strokeWidth="1.5"
                    points={result.percentileCurve.map((p, i) => {
                      const x = (i / (result.percentileCurve.length - 1)) * 400;
                      const y = 120 - (p.p10 / curveMax) * 110;
                      return `${x},${y}`;
                    }).join(' ')}
                  />
                  {/* P50 (median) — amber */}
                  <polyline
                    fill="none"
                    stroke="rgba(251, 191, 36, 0.9)"
                    strokeWidth="2"
                    points={result.percentileCurve.map((p, i) => {
                      const x = (i / (result.percentileCurve.length - 1)) * 400;
                      const y = 120 - (p.p50 / curveMax) * 110;
                      return `${x},${y}`;
                    }).join(' ')}
                  />
                  {/* P90 (best) — green */}
                  <polyline
                    fill="none"
                    stroke="rgba(52, 211, 153, 0.7)"
                    strokeWidth="1.5"
                    points={result.percentileCurve.map((p, i) => {
                      const x = (i / (result.percentileCurve.length - 1)) * 400;
                      const y = 120 - (p.p90 / curveMax) * 110;
                      return `${x},${y}`;
                    }).join(' ')}
                  />
                  {/* Shaded P10-P90 band */}
                  <polygon
                    fill="rgba(251, 191, 36, 0.08)"
                    points={[
                      ...result.percentileCurve.map((p, i) => {
                        const x = (i / (result.percentileCurve.length - 1)) * 400;
                        const y = 120 - (p.p90 / curveMax) * 110;
                        return `${x},${y}`;
                      }),
                      ...result.percentileCurve.slice().reverse().map((p, i) => {
                        const x = ((result.percentileCurve.length - 1 - i) / (result.percentileCurve.length - 1)) * 400;
                        const y = 120 - (p.p10 / curveMax) * 110;
                        return `${x},${y}`;
                      }),
                    ].join(' ')}
                  />
                </svg>
                <div className="absolute bottom-1 left-2 text-[8px] text-slate-600">Year 0</div>
                <div className="absolute bottom-1 right-2 text-[8px] text-slate-600">Year {years}</div>
              </div>
              <div className="flex items-center gap-3 mt-1.5 text-[9px]">
                <span className="flex items-center gap-1"><span className="w-2 h-0.5 bg-red-400"></span><span className="text-slate-500">P10</span></span>
                <span className="flex items-center gap-1"><span className="w-2 h-0.5 bg-amber-400"></span><span className="text-slate-500">P50</span></span>
                <span className="flex items-center gap-1"><span className="w-2 h-0.5 bg-emerald-400"></span><span className="text-slate-500">P90</span></span>
              </div>
            </div>
          )}

          {/* Invested vs Returns */}
          <div className="grid grid-cols-2 gap-2 mb-3">
            <div className="bg-black/30 border border-white/5 rounded-lg p-2.5">
              <div className="text-[9px] text-slate-500 uppercase font-bold tracking-wider">Total Invested</div>
              <div className="text-sm font-bold text-white font-mono">{fmtINR(result.invested)}</div>
            </div>
            <div className="bg-black/30 border border-white/5 rounded-lg p-2.5">
              <div className="text-[9px] text-slate-500 uppercase font-bold tracking-wider">Median Multiplier</div>
              <div className="text-sm font-bold text-cyan-400 font-mono">
                {result.invested > 0 ? `${(result.p50 / result.invested).toFixed(1)}x` : '—'}
              </div>
            </div>
          </div>

          {/* Summary line */}
          <div className="text-[9px] text-slate-600 mt-2 leading-relaxed">
            {summarizeMonteCarlo(result, targetCorpus)}
          </div>
          <div className="text-[8px] text-slate-700 mt-1.5 leading-relaxed">
            ⚠️ Past volatility does not guarantee future results. Monte Carlo assumes normally-distributed monthly returns which understates tail risk (black swans). Use as a planning guide, not a prediction.
          </div>
        </>
      )}
    </div>
  );
});

MonteCarloSimulator.displayName = 'MonteCarloSimulator';
