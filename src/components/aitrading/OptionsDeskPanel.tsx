// ============================================================
// src/components/aitrading/OptionsDeskPanel.tsx — INDIA OPTIONS
// ------------------------------------------------------------
// Index selector · spot/VIX/PCR/max-pain strip · OI chain table
// (Greeks per strike) · ensemble-driven strategy cards with full
// P&L math. Clearly labels bs-model vs live NSE data.
// ============================================================
import { memo, useCallback, useEffect, useState } from 'react';
import { fetchOptionsDesk } from './useAITrading';
import type { OptionsDesk, Strategy } from './types';

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

function StrategyCard({ s, lotSize }: { s: Strategy; lotSize: number }) {
  const bull = s.bias === 'BULLISH';
  return (
    <div className={`quantum-panel rounded-2xl p-4 ${bull ? 'border-l-2 border-l-emerald-500/50' : s.bias === 'BEARISH' ? 'border-l-2 border-l-red-500/50' : 'border-l-2 border-l-violet-500/50'}`}>
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-sm font-black text-white">{s.name}</span>
        <span className={`px-2 py-0.5 rounded-md text-[9px] font-black ${bull ? 'bg-emerald-500/15 text-emerald-300' : s.bias === 'BEARISH' ? 'bg-red-500/15 text-red-300' : 'bg-violet-500/15 text-violet-300'}`}>{s.bias}</span>
        <span className="px-2 py-0.5 rounded-md text-[9px] font-black bg-slate-600/20 text-slate-300">{s.conviction} conviction</span>
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
      <p className="text-[10px] text-slate-500 mt-2 italic">📍 {s.exitPlan}</p>
    </div>
  );
}

export const OptionsDeskPanel = memo(function OptionsDeskPanel() {
  const [symbol, setSymbol] = useState('NIFTY');
  const [desk, setDesk] = useState<OptionsDesk | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async (sym: string, force = false) => {
    setLoading(true);
    const d = await fetchOptionsDesk(sym, force);
    setDesk(d);
    setLoading(false);
  }, []);

  useEffect(() => { load(symbol); }, [symbol, load]);

  const spot = desk?.spot ?? 0;
  const atm = desk?.rows?.length
    ? desk.rows.reduce((best, r) => (Math.abs(r.strike - spot) < Math.abs(best.strike - spot) ? r : best), desk.rows[0])
    : null;

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
      </div>

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
        <div className="text-[10px] font-black text-slate-500 tracking-[0.2em] uppercase mb-2">Ensemble-Driven Strategies</div>
        <div className="grid gap-3 lg:grid-cols-2">
          {(desk?.strategies || []).map(s => <StrategyCard key={s.id} s={s} lotSize={desk?.lotSize || 1} />)}
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
