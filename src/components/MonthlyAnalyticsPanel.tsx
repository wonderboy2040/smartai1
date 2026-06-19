import React, { useMemo } from 'react';
import { useApp } from '../hooks/AppContext';
import { buildMonthlyAnalytics, withMonthlyDeltas } from '../utils/portfolioAnalytics';

// ============================================================
// DEEP DATA ANALYTICS (Planner tab)
// Month-wise: kitni qty buy ki + kitna amount invest kiya,
// aur pichle month ke comparison me kya change hua.
// ============================================================
const fmtINR = (n: number) => {
  const a = Math.abs(n);
  if (a >= 10000000) return `₹${(n / 10000000).toFixed(2)} Cr`;
  if (a >= 100000) return `₹${(n / 100000).toFixed(2)} L`;
  return `₹${Math.round(n).toLocaleString('en-IN')}`;
};

const DeltaBadge = ({ pct }: { pct: number | null }) => {
  if (pct === null) return <span className="text-[9px] text-slate-600 font-mono">— first month</span>;
  const up = pct >= 0;
  return (
    <span className={`text-[9px] font-bold font-mono px-1.5 py-0.5 rounded ${up ? 'bg-emerald-500/10 text-emerald-400' : 'bg-red-500/10 text-red-400'}`}>
      {up ? '▲' : '▼'} {Math.abs(pct).toFixed(1)}% vs last mo
    </span>
  );
};

export const MonthlyAnalyticsPanel = React.memo(function MonthlyAnalyticsPanel() {
  const { transactions, usdInrRate } = useApp();

  const rows = useMemo(() => buildMonthlyAnalytics(transactions, usdInrRate), [transactions, usdInrRate]);
  const deltas = useMemo(() => withMonthlyDeltas(rows), [rows]);

  const totals = useMemo(() => {
    return rows.reduce((acc, r) => ({
      buyQty: acc.buyQty + r.buyQty,
      invested: acc.invested + r.buyAmountINR,
      realized: acc.realized + r.realizedPLINR,
      txns: acc.txns + r.txnCount,
    }), { buyQty: 0, invested: 0, realized: 0, txns: 0 });
  }, [rows]);

  return (
    <div className="quantum-panel rounded-2xl p-5 animate-fade-in-up">
      <div className="flex items-center justify-between mb-1">
        <h3 className="text-lg font-black text-white flex items-center gap-2">
          📊 Deep Data Analytics
          <span className="text-[8px] bg-cyan-500/20 text-cyan-300 px-1.5 py-0.5 rounded-md border border-cyan-500/20 font-bold tracking-wider">MONTHLY</span>
        </h3>
        <span className="text-[10px] text-slate-500 font-mono">{totals.txns} trades logged</span>
      </div>
      <p className="text-[11px] text-slate-500 mb-4">
        Har month ki buying activity — kitni qty li aur kitna paisa lagaya, planner ke hisaab se.
      </p>

      {rows.length === 0 ? (
        <div className="p-8 text-center text-slate-500 border border-dashed border-white/10 rounded-xl">
          <div className="text-4xl mb-2">🧾</div>
          <p className="text-sm font-bold text-cyan-300/50">No transactions yet</p>
          <p className="text-[11px] mt-1">Portfolio me Buy/Sell karo — har trade yahan month-wise track hoga.</p>
        </div>
      ) : (
        <>
          {/* Summary strip */}
          <div className="grid grid-cols-3 gap-3 mb-4">
            <div className="bg-black/30 rounded-xl p-3 border border-white/5">
              <div className="text-[9px] text-slate-500 font-bold uppercase tracking-wider">Total Invested</div>
              <div className="text-base font-black text-cyan-400 font-mono mt-0.5">{fmtINR(totals.invested)}</div>
            </div>
            <div className="bg-black/30 rounded-xl p-3 border border-white/5">
              <div className="text-[9px] text-slate-500 font-bold uppercase tracking-wider">Total Qty Bought</div>
              <div className="text-base font-black text-white font-mono mt-0.5">{totals.buyQty.toLocaleString('en-IN', { maximumFractionDigits: 4 })}</div>
            </div>
            <div className="bg-black/30 rounded-xl p-3 border border-white/5">
              <div className="text-[9px] text-slate-500 font-bold uppercase tracking-wider">Booked P&amp;L</div>
              <div className={`text-base font-black font-mono mt-0.5 ${totals.realized >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                {totals.realized >= 0 ? '+' : ''}{fmtINR(totals.realized)}
              </div>
            </div>
          </div>

          {/* Month cards */}
          <div className="space-y-3">
            {deltas.map(({ current: r, qtyDeltaPct, investedDeltaPct }) => (
              <div key={r.month} className="bg-black/20 rounded-xl p-3 border border-white/5 hover:border-cyan-500/20 transition-colors">
                <div className="flex items-center justify-between mb-2">
                  <div>
                    <div className="font-black text-white text-sm">{r.label}</div>
                    <div className="text-[8px] text-slate-500 font-mono">{r.rangeLabel}</div>
                  </div>
                  <div className="text-[9px] text-slate-500 font-mono text-right">{r.txnCount} txn{r.txnCount > 1 ? 's' : ''} · {r.symbols.slice(0, 4).join(', ')}{r.symbols.length > 4 ? '…' : ''}</div>
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                  <div>
                    <div className="text-[8px] text-slate-500 uppercase font-bold tracking-wider">Qty Bought</div>
                    <div className="text-sm font-bold text-white font-mono">{r.buyQty.toLocaleString('en-IN', { maximumFractionDigits: 4 })}</div>
                    <DeltaBadge pct={qtyDeltaPct} />
                  </div>
                  <div>
                    <div className="text-[8px] text-slate-500 uppercase font-bold tracking-wider">Invested</div>
                    <div className="text-sm font-bold text-cyan-400 font-mono">{fmtINR(r.buyAmountINR)}</div>
                    <DeltaBadge pct={investedDeltaPct} />
                  </div>
                  <div>
                    <div className="text-[8px] text-slate-500 uppercase font-bold tracking-wider">Net Deployed</div>
                    <div className={`text-sm font-bold font-mono ${r.netInvestedINR >= 0 ? 'text-white' : 'text-amber-400'}`}>{fmtINR(r.netInvestedINR)}</div>
                  </div>
                  <div>
                    <div className="text-[8px] text-slate-500 uppercase font-bold tracking-wider">Booked P&amp;L</div>
                    <div className={`text-sm font-bold font-mono ${r.realizedPLINR >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                      {r.realizedPLINR !== 0 ? `${r.realizedPLINR >= 0 ? '+' : ''}${fmtINR(r.realizedPLINR)}` : '—'}
                    </div>
                  </div>
                </div>

                {/* Market-wise split: India / USA / Crypto */}
                <div className="grid grid-cols-3 gap-2 mt-3 pt-3 border-t border-white/5">
                  <div className="text-center">
                    <div className="text-[9px] font-bold text-orange-400">🇮🇳 India</div>
                    <div className="text-[11px] font-mono text-white">{fmtINR(r.india.buyAmountINR)}</div>
                    <div className="text-[8px] text-slate-500 font-mono">Qty {r.india.buyQty.toLocaleString('en-IN', { maximumFractionDigits: 2 })}</div>
                  </div>
                  <div className="text-center border-x border-white/5">
                    <div className="text-[9px] font-bold text-blue-400">🇺🇸 USA</div>
                    <div className="text-[11px] font-mono text-white">${Math.round(r.usa.buyAmount).toLocaleString('en-US')}</div>
                    <div className="text-[8px] text-slate-500 font-mono">Qty {r.usa.buyQty.toLocaleString('en-US', { maximumFractionDigits: 2 })}</div>
                  </div>
                  <div className="text-center">
                    <div className="text-[9px] font-bold text-amber-400">🪙 Crypto</div>
                    <div className="text-[11px] font-mono text-white">{fmtINR(r.crypto.buyAmountINR)}</div>
                    <div className="text-[8px] text-slate-500 font-mono">Qty {r.crypto.buyQty.toLocaleString('en-IN', { maximumFractionDigits: 4 })}</div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
});
