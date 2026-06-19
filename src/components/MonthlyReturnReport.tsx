import React, { useMemo } from 'react';
import { useApp } from '../hooks/AppContext';
import { buildMonthlyReturns, currentUnrealizedINR } from '../utils/portfolioAnalytics';

// ============================================================
// MONTHLY RETURN REPORT (Portfolio tab)
// Month-wise return jo maine book kiya (realized P&L) + capital
// deployed, plus current unrealized return till date.
// ============================================================
const fmtINR = (n: number) => {
  const a = Math.abs(n);
  if (a >= 10000000) return `₹${(n / 10000000).toFixed(2)} Cr`;
  if (a >= 100000) return `₹${(n / 100000).toFixed(2)} L`;
  return `₹${Math.round(n).toLocaleString('en-IN')}`;
};

export const MonthlyReturnReport = React.memo(function MonthlyReturnReport() {
  const { transactions, portfolio, livePrices, usdInrRate } = useApp();

  const { rows, totalRealizedINR } = useMemo(
    () => buildMonthlyReturns(transactions, usdInrRate),
    [transactions, usdInrRate]
  );

  const live = useMemo(
    () => currentUnrealizedINR(portfolio, livePrices, usdInrRate),
    [portfolio, livePrices, usdInrRate]
  );

  const totalReturnINR = totalRealizedINR + live.unrealizedINR;
  const totalReturnPct = live.investedINR > 0 ? (totalReturnINR / live.investedINR) * 100 : 0;

  return (
    <div className="quantum-panel rounded-2xl p-4 animate-fade-in-up">
      <div className="flex items-center justify-between mb-1">
        <h3 className="text-base font-black text-white flex items-center gap-2">
          📅 Monthly Return Report
          <span className="text-[8px] bg-emerald-500/20 text-emerald-300 px-1.5 py-0.5 rounded-md border border-emerald-500/20 font-bold tracking-wider">MONTH-WISE</span>
        </h3>
      </div>
      <p className="text-[11px] text-slate-500 mb-3">
        Har month maine kitna return book kiya aur kitna capital deploy kiya — pura ledger se.
      </p>

      {/* Headline totals */}
      <div className="grid grid-cols-3 gap-2 mb-4">
        <div className="bg-black/30 rounded-xl p-3 border border-white/5">
          <div className="text-[9px] text-slate-500 font-bold uppercase tracking-wider">Realized (Booked)</div>
          <div className={`text-sm font-black font-mono mt-0.5 ${totalRealizedINR >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
            {totalRealizedINR >= 0 ? '+' : ''}{fmtINR(totalRealizedINR)}
          </div>
        </div>
        <div className="bg-black/30 rounded-xl p-3 border border-white/5">
          <div className="text-[9px] text-slate-500 font-bold uppercase tracking-wider">Unrealized (Live)</div>
          <div className={`text-sm font-black font-mono mt-0.5 ${live.unrealizedINR >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
            {live.unrealizedINR >= 0 ? '+' : ''}{fmtINR(live.unrealizedINR)}
          </div>
        </div>
        <div className="bg-black/30 rounded-xl p-3 border border-emerald-500/15">
          <div className="text-[9px] text-emerald-500/80 font-bold uppercase tracking-wider">Total Return</div>
          <div className={`text-sm font-black font-mono mt-0.5 ${totalReturnINR >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
            {totalReturnINR >= 0 ? '+' : ''}{fmtINR(totalReturnINR)}
          </div>
          <div className={`text-[9px] font-bold ${totalReturnPct >= 0 ? 'text-emerald-500' : 'text-red-500'}`}>
            {totalReturnPct >= 0 ? '+' : ''}{totalReturnPct.toFixed(2)}%
          </div>
        </div>
      </div>

      {rows.length === 0 ? (
        <div className="p-6 text-center text-slate-500 border border-dashed border-white/10 rounded-xl">
          <div className="text-3xl mb-2">📈</div>
          <p className="text-[11px]">Abhi koi monthly return data nahi. Buy/Sell karte raho — har month ka return yahan aayega.</p>
        </div>
      ) : (
        <div className="table-wrapper overflow-x-auto">
          <table className="w-full text-left">
            <thead>
              <tr className="text-[9px] uppercase tracking-wider text-slate-500 font-bold border-b border-white/5">
                <th className="py-2 pr-3">Month</th>
                <th className="py-2 px-3 text-right">Net Deployed</th>
                <th className="py-2 px-3 text-right">Booked P&amp;L</th>
                <th className="py-2 px-3 text-right">Return %</th>
                <th className="py-2 pl-3 text-right">Cumulative Invested</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(r => (
                <tr key={r.month} className="text-[11px] border-b border-white/[0.03] hover:bg-white/[0.02]">
                  <td className="py-2 pr-3 font-bold text-white whitespace-nowrap">
                    {r.label}
                    <div className="text-[8px] text-slate-500 font-normal font-mono">{r.rangeLabel}</div>
                  </td>
                  <td className="py-2 px-3 text-right font-mono text-slate-300">{fmtINR(r.netInvestedINR)}</td>
                  <td className={`py-2 px-3 text-right font-mono font-bold ${r.realizedPLINR >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                    {r.realizedPLINR !== 0 ? `${r.realizedPLINR >= 0 ? '+' : ''}${fmtINR(r.realizedPLINR)}` : '—'}
                  </td>
                  <td className={`py-2 px-3 text-right font-mono font-bold ${r.realizedReturnPct >= 0 ? 'text-emerald-500' : 'text-red-500'}`}>
                    {r.realizedReturnPct !== 0 ? `${r.realizedReturnPct >= 0 ? '+' : ''}${r.realizedReturnPct.toFixed(1)}%` : '—'}
                  </td>
                  <td className="py-2 pl-3 text-right font-mono text-cyan-400">{fmtINR(r.cumulativeInvestedINR)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="text-[9px] text-slate-600 mt-3">
        ℹ️ "Booked P&amp;L" = sell karke realize kiya hua profit/loss. "Unrealized" = abhi holdings ka live profit.
      </p>
    </div>
  );
});
