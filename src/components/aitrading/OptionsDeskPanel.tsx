// ============================================================
// src/components/aitrading/OptionsDeskPanel.tsx — INDIA OPTIONS
// ------------------------------------------------------------
// Index selector · spot/VIX/PCR/max-pain strip · OI chain table
// (Greeks per strike) · ensemble-driven strategy cards with full
// P&L math. Clearly labels bs-model vs live NSE data.
// ============================================================
import { memo, useCallback, useEffect, useRef, useState } from 'react';
import { fetchOptionsDesk, fetchIncomeSetups } from './useAITrading';
import type { OptionsDesk, Strategy, GexProfile, IncomeView } from './types';

const INDICES = ['NIFTY', 'BANKNIFTY', 'FINNIFTY'];

function Metric({ label, value, tone }: { label: string; value: string; tone?: 'bull' | 'bear' | 'neutral' }) {
  const cls = tone === 'bull' ? 'text-emerald-300' : tone === 'bear' ? 'text-red-300' : 'text-slate-200';
  return (
    <div className="bg-black/30 rounded-xl px-3 py-2 text-center min-w-[86px]">
      <div className="text-[9px] text-slate-500 font-black tracking-wider">{label}</div>
      <div className={`text-sm font-mono font-black ${cls}`}>{value}</div>
    </div>
  );
}

function StrategyCard({ s, lotSize, spot }: { s: Strategy; lotSize: number; spot: number }) {
  const bull = s.bias === 'BULLISH';
  // v6.7: payoff SVG — expiry P&L per share across ±6% of spot
  const payoff = s.payoff || [];
  const W = 260, H = 64;
  const xs = payoff.map(p => p.s);
  const ys = payoff.map(p => p.pnl);
  const xLo = Math.min(...xs, spot * 0.94), xHi = Math.max(...xs, spot * 1.06);
  const yLo = Math.min(...ys, 0), yHi = Math.max(...ys, 0);
  const px = (v: number) => ((v - xLo) / (xHi - xLo || 1)) * W;
  const py = (v: number) => H - ((v - yLo) / (yHi - yLo || 1)) * H;
  const spotX = px(spot);
  const zeroY = py(0);
  const path = payoff.map((p, i) => `${i === 0 ? 'M' : 'L'}${px(p.s).toFixed(1)},${py(p.pnl).toFixed(1)}`).join(' ');
  return (
    <div className={`quantum-panel rounded-2xl p-4 ${bull ? 'border-l-2 border-l-emerald-500/50' : s.bias === 'BEARISH' ? 'border-l-2 border-l-red-500/50' : 'border-l-2 border-l-violet-500/50'}`}>
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-sm font-black text-white">{s.name}</span>
        <span className={`px-2 py-0.5 rounded-md text-[9px] font-black ${bull ? 'bg-emerald-500/15 text-emerald-300' : s.bias === 'BEARISH' ? 'bg-red-500/15 text-red-300' : 'bg-violet-500/15 text-violet-300'}`}>{s.bias}</span>
        <span className="px-2 py-0.5 rounded-md text-[9px] font-black bg-slate-600/20 text-slate-300">{s.conviction} conviction</span>
        {s.pop != null && (
          <span className={`px-2 py-0.5 rounded-md text-[9px] font-black border ${s.pop >= 60 ? 'bg-emerald-500/10 text-emerald-300 border-emerald-500/25' : s.pop >= 40 ? 'bg-amber-500/10 text-amber-300 border-amber-500/25' : 'bg-red-500/10 text-red-300 border-red-500/25'}`} title="Probability of profit at expiry (lognormal N(d2) of the breakevens)">
            POP {s.pop}%
          </span>
        )}
        {s.netDebit != null && <span className="text-[11px] font-mono text-amber-300 font-bold">debit ₹{s.netDebit}</span>}
        {s.netCredit != null && <span className="text-[11px] font-mono text-emerald-300 font-bold">credit ₹{s.netCredit}</span>}
      </div>
      <p className="text-[11px] text-slate-400 mt-1.5 leading-relaxed">{s.rationale}</p>

      {/* Legs */}
      <div className="mt-2.5 grid gap-1">
        {s.legs.map((l, i) => (
          <div key={i} className="flex items-center gap-2 text-xs bg-black/30 rounded-lg px-3 py-1.5">
            <span className={`font-black ${l.action === 'BUY' ? 'text-emerald-400' : 'text-red-400'} w-12`}>{l.action}</span>
            <span className="font-mono font-bold text-slate-200 w-10">{l.type}</span>
            <span className="font-mono text-slate-400 w-20">strike {l.strike}</span>
            <span className="font-mono text-amber-300 ml-auto">@ ₹{l.premium}</span>
            {l.delta != null && <span className="font-mono text-slate-500 text-[10px]">Δ{l.delta}</span>}
          </div>
        ))}
      </div>

      {/* P&L grid */}
      <div className="grid grid-cols-3 gap-1.5 mt-2.5">
        <div className="bg-emerald-500/5 rounded-lg px-2 py-1.5 text-center border border-emerald-500/15">
          <div className="text-[8px] text-emerald-400/70 font-black tracking-wider">MAX PROFIT</div>
          <div className="text-xs font-mono font-black text-emerald-300">{s.maxProfit == null ? 'Unlimited' : `₹${s.maxProfit}`}</div>
        </div>
        <div className="bg-red-500/5 rounded-lg px-2 py-1.5 text-center border border-red-500/15">
          <div className="text-[8px] text-red-400/70 font-black tracking-wider">MAX LOSS</div>
          <div className="text-xs font-mono font-black text-red-300">₹{s.maxLoss ?? '—'}</div>
        </div>
        <div className="bg-black/30 rounded-lg px-2 py-1.5 text-center">
          <div className="text-[8px] text-slate-500 font-black tracking-wider">BREAKEVEN</div>
          <div className="text-xs font-mono font-black text-slate-300">{(s.breakevens || []).map(b => Math.round(b)).join(' / ') || '—'}</div>
        </div>
      </div>
      <div className="flex gap-2 mt-1.5 text-[10px] text-slate-500 font-mono">
        {s.perLot?.maxLoss != null && <span>per lot (×{lotSize}): max loss ₹{Math.round(s.perLot.maxLoss)}</span>}
        {s.perLot?.maxProfit != null && <span className="text-emerald-500/70">· max profit ₹{Math.round(s.perLot.maxProfit)}</span>}
      </div>
      {/* v6.7 payoff curve */}
      {payoff.length > 3 && (
        <div className="mt-2.5 bg-black/30 rounded-xl p-2">
          <div className="flex items-center justify-between text-[8px] text-slate-600 font-black tracking-wider mb-1">
            <span>EXPIRY PAYOFF / share</span>
            <span className="font-mono">green = profit zone</span>
          </div>
          <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-16" role="img" aria-label="Payoff curve at expiry">
            <line x1="0" y1={zeroY} x2={W} y2={zeroY} stroke="rgba(148,163,184,0.25)" strokeWidth="1" strokeDasharray="3,3" />
            <line x1={spotX} y1="0" x2={spotX} y2={H} stroke="rgba(34,211,238,0.4)" strokeWidth="1" strokeDasharray="2,3" />
            <path d={`${path} L${W},${zeroY} L0,${zeroY} Z`} fill="url(#payGrad)" opacity="0.25" />
            <path d={path} fill="none" stroke={bull ? '#34d399' : s.bias === 'BEARISH' ? '#f87171' : '#a78bfa'} strokeWidth="2" />
            <defs>
              <linearGradient id="payGrad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#34d399" stopOpacity="0.6" />
                <stop offset="50%" stopColor="transparent" stopOpacity="0" />
                <stop offset="100%" stopColor="#f87171" stopOpacity="0.6" />
              </linearGradient>
            </defs>
          </svg>
          <div className="flex justify-between text-[8px] font-mono text-slate-600">
            <span>{Math.round(xLo).toLocaleString('en-IN')}</span>
            <span className="text-cyan-500/70">spot {spot?.toLocaleString('en-IN', { maximumFractionDigits: 0 })}</span>
            <span>{Math.round(xHi).toLocaleString('en-IN')}</span>
          </div>
        </div>
      )}
      <p className="text-[10px] text-slate-500 mt-2 italic">📍 {s.exitPlan}</p>
    </div>
  );
}

export const OptionsDeskPanel = memo(function OptionsDeskPanel() {
  const [symbol, setSymbol] = useState('NIFTY');
  const [desk, setDesk] = useState<OptionsDesk | null>(null);
  const [loading, setLoading] = useState(true);
  const seqRef = useRef(0);

  const load = useCallback(async (sym: string, force = false) => {
    // v6.2: sequence guard — rapid NIFTY→BANKNIFTY switching leaves two
    // fetches in flight and the LAST-RESOLVED response used to win,
    // painting NIFTY's (up to 30s-uncached) chain under a BANKNIFTY-
    // highlighted selector. Only the CURRENT request's response applies.
    const seq = ++seqRef.current;
    setLoading(true);
    const d = await fetchOptionsDesk(sym, force);
    if (seq !== seqRef.current) return; // stale response for a previous index — discard
    setDesk(d);
    setLoading(false);
  }, []);

  useEffect(() => { load(symbol); }, [symbol, load]);

  const spot = desk?.spot ?? 0;
  const atm = desk?.rows?.length
    ? desk.rows.reduce((best, r) => (Math.abs(r.strike - spot) < Math.abs(best.strike - spot) ? r : best), desk.rows[0])
    : null;
  const gex = desk?.analytics?.gex ?? null;

  return (
    <section className="space-y-3" aria-label="India options desk">
      {/* Index selector + refresh */}
      <div className="flex items-center gap-2 flex-wrap">
        <div className="flex gap-1 quantum-panel p-1 rounded-2xl">
          {INDICES.map(ix => (
            <button key={ix} onClick={() => setSymbol(ix)}
              aria-pressed={symbol === ix}
              className={`px-4 py-2 rounded-xl text-xs font-black transition-all ${symbol === ix ? 'bg-gradient-to-r from-orange-600 to-amber-600 text-white shadow-lg shadow-orange-500/20' : 'text-slate-400 hover:text-slate-200'}`}>
              {ix}
            </button>
          ))}
        </div>
        <button onClick={() => load(symbol, true)} disabled={loading}
          className="quantum-btn-ghost px-3 py-2 rounded-xl text-xs font-bold disabled:opacity-50">
          <span className={loading ? 'inline-block animate-spin' : ''}>🔄</span> Refresh
        </button>
        {desk?.source && (
          <span className={`px-2 py-1 rounded-lg text-[10px] font-black border ${desk.source === 'nse' ? 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30' : 'bg-amber-500/15 text-amber-300 border-amber-500/30'}`}>
            {desk.source === 'nse' ? 'LIVE NSE CHAIN' : 'BS MODEL CHAIN'}
          </span>
        )}
        {desk?.consensus && (
          <span className={`px-2 py-1 rounded-lg text-[10px] font-black border ${desk.consensus.side === 'LONG' ? 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30' : desk.consensus.side === 'SHORT' ? 'bg-red-500/15 text-red-300 border-red-500/30' : 'bg-slate-600/20 text-slate-300 border-slate-600/30'}`}>
            ENSEMBLE: {desk.consensus.side} {desk.consensus.confidence}% ({desk.consensus.grade})
          </span>
        )}
      </div>

      {desk?.syntheticNote && (
        <div className="quantum-panel rounded-xl px-4 py-2.5 text-[11px] text-amber-200/80 leading-relaxed border border-amber-500/20">
          ⚠️ {desk.syntheticNote}
        </div>
      )}

      {/* Metrics strip */}
      <div className="flex flex-wrap gap-2">
        <Metric label="SPOT" value={desk ? desk.spot?.toLocaleString('en-IN', { maximumFractionDigits: 0 }) : '—'} />
        <Metric label="DAY %" value={desk?.spotChangePct != null ? `${desk.spotChangePct >= 0 ? '+' : ''}${desk.spotChangePct.toFixed(2)}%` : '—'} tone={(desk?.spotChangePct ?? 0) >= 0 ? 'bull' : 'bear'} />
        <Metric label="INDIA VIX" value={desk?.vix != null ? desk.vix.toFixed(1) : '—'} />
        <Metric label="EXPIRY" value={desk?.expiry || '—'} />
        <Metric label="LOT SIZE" value={desk ? String(desk.lotSize) : '—'} />
        <Metric label="PCR" value={desk?.analytics?.pcr != null ? desk.analytics.pcr.toFixed(2) : 'n/a'} tone={desk?.analytics?.pcr != null ? (desk.analytics.pcr > 1.4 ? 'bull' : desk.analytics.pcr < 0.6 ? 'bear' : 'neutral') : 'neutral'} />
        <Metric label="MAX PAIN" value={desk?.analytics?.maxPain != null ? desk.analytics.maxPain.toLocaleString('en-IN') : 'n/a'} />
        <Metric label="ATM IV" value={desk?.analytics?.atmIV != null ? `${desk.analytics.atmIV.toFixed(1)}%` : 'n/a'} />
        {gex && <Metric label="GAMMA FLIP" value={gex.gammaFlip != null ? gex.gammaFlip.toLocaleString('en-IN') : 'n/a'} tone="neutral" />}
        {gex && <Metric label="CALL WALL" value={gex.callWall != null ? gex.callWall.toLocaleString('en-IN') : 'n/a'} tone="bear" />}
        {gex && <Metric label="PUT WALL" value={gex.putWall != null ? gex.putWall.toLocaleString('en-IN') : 'n/a'} tone="bull" />}
        {gex && <Metric label="EXP MOVE" value={gex.expectedMove?.pct != null ? `±${gex.expectedMove.pct}%` : 'n/a'} tone="neutral" />}
        {desk?.analytics?.skew?.value != null && (
          <Metric label="IV SKEW" value={`${desk.analytics.skew.value > 0 ? '+' : ''}${desk.analytics.skew.value}`} tone={desk.analytics.skew.value >= 2.5 ? 'bear' : desk.analytics.skew.value < -0.5 ? 'bull' : 'neutral'} />
        )}
        {desk?.analytics?.flow?.callPutVolRatio != null && (
          <Metric label="C/P VOL" value={desk.analytics.flow.callPutVolRatio.toFixed(2)} tone={desk.analytics.flow.callPutVolRatio >= 1.5 ? 'bull' : desk.analytics.flow.callPutVolRatio <= 0.67 ? 'bear' : 'neutral'} />
        )}
      </div>

      {/* v6.11: skew + flow reads (glama tv-mcp) */}
      {(desk?.analytics?.skew || desk?.analytics?.flow) && (
        <div className="grid sm:grid-cols-2 gap-2">
          {desk?.analytics?.skew && (
            <div className="quantum-panel rounded-2xl p-3">
              <div className="text-[9px] font-black text-slate-500 tracking-wider mb-1">📐 IV SKEW (OTM put − call, 2–6%)</div>
              <div className="text-[10px] text-slate-300 leading-relaxed">{desk.analytics.skew.read}</div>
              <div className="text-[9px] font-mono text-slate-600 mt-1">put IV {desk.analytics.skew.putIV ?? '—'} · call IV {desk.analytics.skew.callIV ?? '—'}</div>
            </div>
          )}
          {desk?.analytics?.flow && (
            <div className="quantum-panel rounded-2xl p-3">
              <div className="text-[9px] font-black text-slate-500 tracking-wider mb-1">🌊 OPTIONS FLOW (aaj ka premium)</div>
              <div className="text-[10px] text-slate-300 leading-relaxed">{desk.analytics.flow.read} · {desk.analytics.flow.oiLeanRead}</div>
              <div className="text-[9px] font-mono text-slate-600 mt-1">CE vol {desk.analytics.flow.callVolume?.toLocaleString('en-IN')} · PE vol {desk.analytics.flow.putVolume?.toLocaleString('en-IN')}</div>
            </div>
          )}
        </div>
      )}

      {/* v6.11: income setup ranker (glama tv-mcp rank_income_setups) */}
      <IncomeRanker />

      {/* v6.7 GEX profile — dealer gamma positioning */}
      {gex && (
        <GexChart gex={gex} spot={desk?.spot ?? 0} />
      )}

      {/* OI chain table */}
      <div className="quantum-panel rounded-2xl overflow-hidden">
        <div className="px-4 py-2.5 border-b border-white/5 flex items-center justify-between">
          <span className="text-xs font-black text-slate-200">📊 OPTION CHAIN — {symbol} · {desk?.expiry || ''}</span>
          <span className="text-[10px] text-slate-500 font-mono">{desk?.rows?.length || 0} strikes</span>
        </div>
        <div className="overflow-x-auto max-h-96 overflow-y-auto">
          <table className="w-full text-[11px] font-mono">
            <thead className="sticky top-0 bg-[#0d1424] z-10">
              <tr className="text-[9px] text-slate-500 font-black tracking-wider">
                <th className="px-2 py-2 text-right">CE OI</th>
                <th className="px-2 py-2 text-right">CE IV</th>
                <th className="px-2 py-2 text-right">CE LTP</th>
                <th className="px-2 py-2 text-right">CE Δ</th>
                <th className="px-3 py-2 text-center text-cyan-400">STRIKE</th>
                <th className="px-2 py-2 text-left">PE Δ</th>
                <th className="px-2 py-2 text-left">PE LTP</th>
                <th className="px-2 py-2 text-left">PE IV</th>
                <th className="px-2 py-2 text-left">PE OI</th>
              </tr>
            </thead>
            <tbody>
              {(desk?.rows || []).map(r => {
                const isATM = atm?.strike === r.strike;
                const maxOI = Math.max(...(desk?.rows || []).map(x => Math.max(x.callOI, x.putOI)), 1);
                return (
                  <tr key={r.strike} className={`border-t border-white/[0.03] hover:bg-white/[0.03] ${isATM ? 'bg-cyan-500/10' : ''}`}>
                    <td className="px-2 py-1.5 text-right relative">
                      {r.callOI > 0 && <div className="absolute right-0 top-1 bottom-1 bg-emerald-500/10 rounded" style={{ width: `${(r.callOI / maxOI) * 100}%` }} />}
                      <span className="relative text-emerald-300/90">{r.callOI ? (r.callOI / 1000).toFixed(0) + 'k' : '—'}</span>
                    </td>
                    <td className="px-2 py-1.5 text-right text-slate-500">{r.callIV != null ? r.callIV.toFixed(0) : '—'}</td>
                    <td className="px-2 py-1.5 text-right text-slate-200">{r.callLTP ? r.callLTP.toFixed(1) : '—'}</td>
                    <td className="px-2 py-1.5 text-right text-slate-500">{r.callGreeks?.delta != null ? r.callGreeks.delta.toFixed(2) : '—'}</td>
                    <td className={`px-3 py-1.5 text-center font-black ${isATM ? 'text-cyan-300' : 'text-slate-300'}`}>{r.strike}</td>
                    <td className="px-2 py-1.5 text-left text-slate-500">{r.putGreeks?.delta != null ? r.putGreeks.delta.toFixed(2) : '—'}</td>
                    <td className="px-2 py-1.5 text-left text-slate-200">{r.putLTP ? r.putLTP.toFixed(1) : '—'}</td>
                    <td className="px-2 py-1.5 text-left text-slate-500">{r.putIV != null ? r.putIV.toFixed(0) : '—'}</td>
                    <td className="px-2 py-1.5 text-left relative">
                      {r.putOI > 0 && <div className="absolute left-0 top-1 bottom-1 bg-red-500/10 rounded" style={{ width: `${(r.putOI / maxOI) * 100}%` }} />}
                      <span className="relative text-red-300/90">{r.putOI ? (r.putOI / 1000).toFixed(0) + 'k' : '—'}</span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Strategy cards */}
      <div>
        <div className="text-[10px] font-black text-slate-500 tracking-[0.2em] uppercase mb-2">Ensemble-Driven Strategies — POP + payoff ke saath</div>
        <div className="grid gap-3 lg:grid-cols-2">
          {(desk?.strategies || []).map(s => <StrategyCard key={s.id} s={s} lotSize={desk?.lotSize || 1} spot={spot} />)}
          {(desk?.strategies || []).length === 0 && (
            <div className="quantum-panel rounded-2xl p-6 text-center text-slate-500 text-xs">
              {loading ? 'Building strategies…' : 'No strategies — index data unavailable'}
            </div>
          )}
        </div>
      </div>
    </section>
  );
});

// ---------------- v6.7: GEX bar chart ----------------
function GexChart({ gex, spot }: { gex: GexProfile; spot: number }) {
  const per = (gex.perStrike || []).slice(-24); // right-most strikes window
  if (per.length < 6) return null;
  const maxAbs = Math.max(...per.map(p => Math.abs(p.netGex)), 1);
  const lo = per[0].strike, hi = per[per.length - 1].strike;
  const posOf = (k: number) => ((k - lo) / (hi - lo || 1)) * 100;
  const net = gex.totalNetGex ?? 0;
  const em = gex.expectedMove;
  return (
    <div className="quantum-panel rounded-2xl p-4">
      <div className="flex items-center justify-between flex-wrap gap-2 mb-2">
        <span className="text-xs font-black text-slate-200">⚡ GEX PROFILE — dealer gamma positioning</span>
        <span className={`px-2 py-0.5 rounded-md text-[9px] font-black border ${net > 0 ? 'bg-violet-500/10 text-violet-300 border-violet-500/25' : 'bg-amber-500/10 text-amber-300 border-amber-500/25'}`}>
          {net > 0 ? 'POSITIVE (pin regime)' : 'NEGATIVE (trend regime)'}
        </span>
      </div>
      {/* per-strike bars (center-anchored) */}
      <div className="relative h-24 flex items-center">
        <div className="absolute left-0 right-0 top-1/2 h-px bg-white/10" />
        {per.map(p => {
          const h = Math.max(2, (Math.abs(p.netGex) / maxAbs) * 46);
          const w = Math.max(3, 80 / per.length);
          const left = posOf(p.strike);
          return (
            <div key={p.strike}
              title={`strike ${p.strike} · net GEX ${p.netGex.toLocaleString('en-IN')}`}
              className={p.netGex >= 0 ? 'absolute bg-violet-400/60 rounded-t' : 'absolute bg-amber-400/60 rounded-b'}
              style={{
                left: `${Math.min(99, Math.max(0, left - w / 2.2))}%`,
                width: `${w}%`,
                top: p.netGex >= 0 ? `${50 - (h / 1.24)}%` : '50%',
                height: `${h / 1.24}%`,
              }} />
          );
        })}
        {gex.gammaFlip != null && (
          <div className="absolute top-0 bottom-0 border-l-2 border-dashed border-cyan-400/70" style={{ left: `${posOf(gex.gammaFlip)}%` }}>
            <span className="absolute -top-0.5 left-1 text-[8px] font-black text-cyan-300 whitespace-nowrap">flip {gex.gammaFlip}</span>
          </div>
        )}
        {gex.callWall != null && (
          <div className="absolute top-0 bottom-0 border-l border-dashed border-red-400/50" style={{ left: `${posOf(gex.callWall)}%` }}>
            <span className="absolute bottom-0 left-1 text-[8px] font-black text-red-300 whitespace-nowrap">C-wall</span>
          </div>
        )}
        {gex.putWall != null && (
          <div className="absolute top-0 bottom-0 border-l border-dashed border-emerald-400/50" style={{ left: `${posOf(gex.putWall)}%` }}>
            <span className="absolute bottom-0 left-1 text-[8px] font-black text-emerald-300 whitespace-nowrap">P-wall</span>
          </div>
        )}
        {spot > 0 && (
          <div className="absolute top-0 bottom-0 border-l-2 border-cyan-300/60" style={{ left: `${posOf(Math.min(hi, Math.max(lo, spot)))}%` }}>
            <span className="absolute top-0 left-1 text-[8px] font-black text-cyan-200 whitespace-nowrap">spot</span>
          </div>
        )}
      </div>
      <div className="flex justify-between text-[8px] font-mono text-slate-600 mt-1">
        <span>{lo.toLocaleString('en-IN')}</span>
        <span>{hi.toLocaleString('en-IN')}</span>
      </div>
      <div className="mt-2.5 grid sm:grid-cols-2 gap-1.5">
        {em && (
          <div className="bg-cyan-500/5 border border-cyan-500/15 rounded-lg px-2.5 py-1.5">
            <div className="text-[9px] font-black text-cyan-300/80 tracking-wider">EXPECTED MOVE (1 expiry, {em.method})</div>
            <div className="text-[11px] font-mono text-slate-200">{em.low?.toLocaleString('en-IN')} — {em.high?.toLocaleString('en-IN')} {em.pct != null ? <span className="text-slate-500">(±{em.pct}%)</span> : null}</div>
          </div>
        )}
        <div className="bg-black/30 rounded-lg px-2.5 py-1.5">
          <div className="text-[9px] font-black text-slate-500 tracking-wider">READ</div>
          <div className="text-[10px] text-slate-400 leading-snug">{gex.regimeNote}{gex.gammaFlip != null ? ` · Spot ${spot > gex.gammaFlip ? 'ABOVE' : 'BELOW'} the flip (${gex.gammaFlip.toLocaleString('en-IN')})` : ''}</div>
        </div>
      </div>
    </div>
  );
}

// ---------------- v6.11: Income Setup Ranker (glama tv-mcp) ----------------
function IncomeRanker() {
  const [view, setView] = useState<IncomeView | null>(null);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setView(await fetchIncomeSetups());
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  return (
    <div className="quantum-panel rounded-2xl p-3">
      <div className="flex items-center justify-between gap-2 mb-2">
        <span className="text-[10px] font-black text-slate-200">💰 INCOME SETUP RANKER — teeno indices ke credit setups ranked</span>
        <button onClick={load} className="quantum-btn-ghost px-2 py-1 rounded-lg text-[10px] font-bold" aria-label="Refresh income ranker">
          <span className={loading ? 'inline-block animate-spin' : ''}>🔄</span>
        </button>
      </div>
      {!view || view.count === 0 && (
        <div className="py-3 text-center text-[10px] text-slate-500">{loading ? 'Strategies build ho rahe hain…' : (view?.note || 'koi credit setup nahi bana')}</div>
      )}
      {view && view.count > 0 && (
        <div className="space-y-1.5">
          {(view.top || []).map((r, i) => (
            <div key={`${r.symbol}-${r.id}`} className={`bg-black/25 rounded-xl px-3 py-2 flex items-center gap-2 flex-wrap ${i === 0 ? 'border-l-2 border-l-cyan-500/60' : ''}`}>
              <span className="text-[9px] font-black text-slate-600 w-4">{i + 1}</span>
              <span className="text-[10px] font-black text-white">{r.symbol}</span>
              <span className="text-[9px] text-slate-400">{r.name}</span>
              <span className="px-1.5 py-0.5 rounded text-[8px] font-black bg-cyan-500/15 text-cyan-300">score {r.score ?? '—'}</span>
              <span className="px-1.5 py-0.5 rounded text-[8px] font-black bg-emerald-500/10 text-emerald-300">POP {r.pop ?? '—'}%</span>
              <span className="text-[9px] font-mono text-slate-500">credit ₹{r.credit}</span>
              {r.riskReward != null && <span className="text-[9px] font-mono text-slate-600">c/l {r.riskReward}</span>}
              <span className={`ml-auto text-[8px] font-black ${r.source === 'bs-model' ? 'text-amber-400/70' : 'text-slate-600'}`}>{r.source === 'bs-model' ? 'model' : 'live'}</span>
            </div>
          ))}
          <div className="text-[8px] text-slate-600 leading-relaxed">{view.methodology} · {view.note}</div>
        </div>
      )}
    </div>
  );
}
