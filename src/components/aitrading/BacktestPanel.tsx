// ============================================================
// src/components/aitrading/BacktestPanel.tsx — v6.5
// ------------------------------------------------------------
// Walk-forward replay of the SAME 9-model ensemble on historical
// candles. Shows the honest question users actually ask: "would
// these signals have made money?" — win rate, avg R, profit
// factor, max drawdown, equity curve, per-symbol table.
// ============================================================
import { memo, useCallback, useEffect, useState } from 'react';
import type { BacktestResult } from './types';

const fmtINR = (n: number | null | undefined): string => {
  if (n == null || !Number.isFinite(n)) return '—';
  const s = n >= 0 ? '+' : '−';
  const a = Math.abs(n);
  if (a >= 1e5) return `${s}₹${(a / 1e5).toFixed(2)}L`;
  return `${s}₹${a.toLocaleString('en-IN', { maximumFractionDigits: 0 })}`;
};

function EquityCurve({ equity }: { equity: NonNullable<BacktestResult['equity']> }) {
  const pts = equity.filter(e => e.cumR != null);
  if (pts.length < 2) return null;
  const w = 600, h = 90, pad = 4;
  const vals = pts.map(p => p.cumR as number);
  const min = Math.min(0, ...vals), max = Math.max(0, ...vals);
  const range = max - min || 1;
  const x = (i: number) => pad + (i / (pts.length - 1)) * (w - 2 * pad);
  const y = (v: number) => h - pad - ((v - min) / range) * (h - 2 * pad);
  const line = pts.map((p, i) => `${i === 0 ? 'M' : 'L'}${x(i).toFixed(1)},${y(p.cumR as number).toFixed(1)}`).join(' ');
  const zeroY = y(0);
  const final = vals[vals.length - 1];
  const up = final >= 0;
  return (
    <div className="bg-black/30 rounded-xl p-2.5" aria-label="equity curve">
      <div className="flex items-center justify-between text-[10px] font-black mb-1">
        <span className="text-slate-500 tracking-wider">EQUITY CURVE (cumulative R)</span>
        <span className={`font-mono ${up ? 'text-emerald-400' : 'text-red-400'}`}>{final >= 0 ? '+' : ''}{final.toFixed(1)}R</span>
      </div>
      <svg viewBox={`0 0 ${w} ${h}`} className="w-full h-[90px]" preserveAspectRatio="none" role="img" aria-label={`cumulative R over ${pts.length} trades`}>
        <line x1={0} y1={zeroY} x2={w} y2={zeroY} stroke="rgba(148,163,184,0.25)" strokeDasharray="3 3" strokeWidth="1" />
        <path d={line} fill="none" stroke={up ? '#34d399' : '#f87171'} strokeWidth="2" strokeLinejoin="round" />
      </svg>
    </div>
  );
}

interface Props {
  market: 'INDIA' | 'CRYPTO';
  runBacktest: (market: 'INDIA' | 'CRYPTO', minGrade?: string) => Promise<BacktestResult | null>;
}

export const BacktestPanel = memo(function BacktestPanel({ market, runBacktest }: Props) {
  const [result, setResult] = useState<BacktestResult | null>(null);
  const [grade, setGrade] = useState<'ACTION' | 'STRONG' | 'WATCH'>('ACTION');
  const [running, setRunning] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const run = useCallback(async () => {
    setRunning(true); setErr(null);
    const r = await runBacktest(market, grade);
    setRunning(false);
    if (!r || !r.ok) { setErr(r?.disclaimer ? null : 'backtest data unavailable — try again'); setResult(r); return; }
    setResult(r);
  }, [market, grade, runBacktest]);

  // auto-run once per market switch (cheap: 10-min server cache)
  useEffect(() => { setResult(null); setErr(null); }, [market]);

  const s = result?.stats;

  return (
    <div className="quantum-panel rounded-2xl p-4 space-y-3" aria-label="Backtest panel">
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-xs font-black text-slate-200">📉 BACKTEST — {market === 'INDIA' ? 'NSE daily candles' : 'crypto 1h candles'}</span>
        <div className="flex gap-1 ml-1" role="group" aria-label="Minimum grade">
          {(['ACTION', 'STRONG', 'WATCH'] as const).map(g => (
            <button key={g} onClick={() => setGrade(g)} aria-pressed={grade === g}
              className={`px-2 py-0.5 rounded-lg text-[9px] font-black border ${grade === g ? 'bg-cyan-500/15 text-cyan-300 border-cyan-500/40' : 'bg-black/20 text-slate-500 border-slate-700/40'}`}>
              {g}
            </button>
          ))}
        </div>
        <button onClick={run} disabled={running}
          className="ml-auto px-3 py-1.5 rounded-lg text-[10px] font-black bg-gradient-to-r from-violet-600 to-indigo-600 text-white disabled:opacity-50">
          {running ? '⏳ REPLAYING HISTORY…' : '▶ RUN BACKTEST'}
        </button>
      </div>

      {result?.ok && s && (
        <>
          <div className="grid grid-cols-3 sm:grid-cols-6 gap-1.5">
            {[
              { l: 'TRADES', v: String(s.trades), c: 'text-slate-200' },
              { l: 'WIN RATE', v: s.winRate != null ? `${s.winRate}%` : '—', c: (s.winRate ?? 0) >= 50 ? 'text-emerald-300' : 'text-amber-300' },
              { l: 'AVG R', v: s.avgR != null ? `${s.avgR >= 0 ? '+' : ''}${s.avgR}` : '—', c: (s.avgR ?? 0) >= 0 ? 'text-emerald-300' : 'text-red-300' },
              { l: 'PROFIT FACTOR', v: s.profitFactor != null && Number.isFinite(s.profitFactor) ? String(s.profitFactor) : '∞', c: (s.profitFactor ?? 0) >= 1.2 ? 'text-emerald-300' : 'text-amber-300' },
              { l: 'MAX DD', v: `−${s.maxDDR ?? 0}R`, c: 'text-red-300' },
              { l: `P&L @₹${(result.params?.capitalPerTradeINR ?? 1000).toLocaleString('en-IN')}`, v: fmtINR(s.pnlINR), c: (s.pnlINR ?? 0) >= 0 ? 'text-emerald-300' : 'text-red-300' },
            ].map(x => (
              <div key={x.l} className="bg-black/30 rounded-lg px-2 py-1.5 text-center">
                <div className="text-[8px] text-slate-500 font-black tracking-wider">{x.l}</div>
                <div className={`text-xs font-mono font-bold ${x.c}`}>{x.v}</div>
              </div>
            ))}
          </div>

          {result.equity && result.equity.length > 1 && <EquityCurve equity={result.equity} />}

          <div className="grid gap-2 sm:grid-cols-2">
            <div className="bg-black/20 rounded-xl p-2.5">
              <div className="text-[10px] font-black text-slate-500 tracking-wider mb-1.5">PER SYMBOL</div>
              <div className="space-y-1 max-h-36 overflow-y-auto">
                {(result.perSymbol || []).filter(p => p.ok).map(p => (
                  <div key={p.symbol} className="flex items-center gap-2 text-[10px] font-mono">
                    <span className="text-slate-300 w-20 truncate">{p.symbol}</span>
                    <span className="text-slate-500 w-14">{p.stats?.trades ?? 0} trades</span>
                    <span className={(p.stats?.winRate ?? 0) >= 50 ? 'text-emerald-400' : 'text-amber-400'}>{p.stats?.winRate ?? '—'}% win</span>
                    <span className={`ml-auto ${(p.stats?.avgR ?? 0) >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>{(p.stats?.avgR ?? 0) >= 0 ? '+' : ''}{p.stats?.avgR ?? '—'}R</span>
                  </div>
                ))}
              </div>
            </div>
            <div className="bg-black/20 rounded-xl p-2.5">
              <div className="text-[10px] font-black text-slate-500 tracking-wider mb-1.5">EXIT REASONS</div>
              <div className="flex gap-1.5 flex-wrap">
                {Object.entries(result.exitDist || {}).map(([k, v]) => (
                  <span key={k} className={`px-2 py-0.5 rounded text-[10px] font-mono font-bold ${k === 'TP2' ? 'bg-emerald-500/10 text-emerald-300' : k === 'SL' ? 'bg-red-500/10 text-red-300' : 'bg-slate-600/20 text-slate-400'}`}>
                    {k} × {v}
                  </span>
                ))}
              </div>
              <div className="mt-2 text-[9px] text-slate-500 leading-relaxed">
                Discipline mirrors the live watcher: TP1 does NOT close (winners run to TP2), SL-first on ambiguous bars, 0.1% slippage both sides.
              </div>
            </div>
          </div>

          <p className="text-[9px] text-slate-600 leading-relaxed">{result.disclaimer}</p>
        </>
      )}

      {result && !result.ok && (
        <div className="text-[11px] text-amber-400/90 font-bold bg-amber-500/5 border border-amber-500/20 rounded-xl px-3 py-2.5">
          {market === 'INDIA'
            ? 'Historical daily candles unavailable for the default India set (Yahoo may be rate-limiting) — retry in a minute, symbols neeche board se chun ke bhi try kar sakte ho.'
            : 'CoinDCX candle history unavailable right now — retry in a minute.'}
        </div>
      )}
      {err && <div className="text-[11px] text-red-400 font-bold">⚠️ {err}</div>}
      {!result && !running && !err && (
        <div className="text-[11px] text-slate-500">
          Run karo — SAME live ensemble (indicators → 9-model votes → consensus → risk-capped plan) historical candles par replay hota hai.
          {market === 'INDIA' ? ' India: 2 saal daily candles, max 5-day hold.' : ' Crypto: 300 × 1h candles, max 48h hold.'}
        </div>
      )}
    </div>
  );
});
