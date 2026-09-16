import React, { useMemo, useState } from 'react';
import { useApp } from '../hooks/AppContext';
import { buildMonthlyReturns, currentUnrealizedINR, type MonthlyReturn } from '../utils/portfolioAnalytics';

// ============================================================
// MONTHLY RETURN REPORT v2 — Deep Analysis
// Month-wise return jo maine book kiya (realized P&L) + capital
// deployed, plus current unrealized return till date.
// Enhanced: bar chart, per-market split, CAGR, color-coded rows,
// MoM delta, txn count, cumulative visual.
// ============================================================
const fmtINR = (n: number) => {
  const a = Math.abs(n);
  if (a >= 10000000) return `₹${(n / 10000000).toFixed(2)} Cr`;
  if (a >= 100000) return `₹${(n / 100000).toFixed(2)} L`;
  return `₹${Math.round(n).toLocaleString('en-IN')}`;
};

// Bar chart of monthly returns
function MonthlyReturnChart({ rows }: { rows: MonthlyReturn[] }) {
  // Show last 12 months, oldest-first
  const display = [...rows].reverse().slice(-12);
  if (display.length < 2) return null;
  const maxAbs = Math.max(...display.map(r => Math.abs(r.realizedPLINR)), 1);

  return (
    <div className="mb-4">
      <div className="text-[9px] text-slate-500 uppercase font-bold tracking-wider mb-2">Monthly Returns (Last 12 Months)</div>
      <div className="flex items-end gap-1 h-28 bg-black/20 rounded-lg p-2 pt-4">
        {display.map((r, i) => {
          const h = Math.max(3, (Math.abs(r.realizedPLINR) / maxAbs) * 85);
          const isProfit = r.realizedPLINR >= 0;
          const isLatest = i === display.length - 1;
          return (
            <div key={r.month} className="flex-1 flex flex-col items-center justify-end group relative" title={`${r.label}: ${fmtINR(r.realizedPLINR)}`}>
              {r.realizedPLINR !== 0 && (
                <div className={`text-[7px] font-mono mb-0.5 ${isProfit ? 'text-emerald-400' : 'text-red-400'} ${isLatest ? 'font-bold' : ''}`}>
                  {Math.abs(r.realizedPLINR) >= 1000 ? `${(r.realizedPLINR / 1000).toFixed(0)}K` : Math.round(r.realizedPLINR)}
                </div>
              )}
              <div
                className={`w-full rounded-t transition-all ${
                  r.realizedPLINR === 0
                    ? 'bg-slate-700'
                    : isProfit
                    ? 'bg-gradient-to-t from-emerald-700 to-emerald-400'
                    : 'bg-gradient-to-t from-red-700 to-red-400'
                } ${isLatest ? 'ring-1 ring-cyan-400 ring-offset-1 ring-offset-black/40' : ''}`}
                style={{ height: r.realizedPLINR === 0 ? '3px' : `${h}px` }}
              />
              <div className={`text-[7px] mt-1 ${isLatest ? 'text-cyan-400 font-bold' : 'text-slate-600'}`}>
                {r.label.split(' ')[0].slice(0, 3)}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// Cumulative return visual
function CumulativeReturnChart({ rows }: { rows: MonthlyReturn[] }) {
  const display = [...rows].reverse(); // oldest-first
  if (display.length < 2) return null;

  const maxAbs = Math.max(...display.map(r => Math.abs(r.cumulativeRealizedINR)), 1);
  const w = 350, h = 60;
  const stepX = w / (display.length - 1);

  const path = display.map((r, i) => {
    const x = i * stepX;
    const y = h / 2 - (r.cumulativeRealizedINR / maxAbs) * (h / 2 - 4);
    return `${i === 0 ? 'M' : 'L'}${x},${y}`;
  }).join(' ');

  const areaPath = `${path} L${w},${h/2} L0,${h/2} Z`;
  const final = display[display.length - 1].cumulativeRealizedINR;
  const isProfit = final >= 0;
  const color = isProfit ? '#34d399' : '#f87171';
  const fillColor = isProfit ? 'rgba(52,211,153,0.12)' : 'rgba(248,113,113,0.12)';

  return (
    <div className="mb-4">
      <div className="text-[9px] text-slate-500 uppercase font-bold tracking-wider mb-1.5">Cumulative Realized Return</div>
      <svg viewBox={`0 0 ${w} ${h}`} className="w-full h-14" preserveAspectRatio="none">
        <line x1="0" y1={h/2} x2={w} y2={h/2} stroke="rgba(75,85,99,0.3)" strokeWidth="0.5" strokeDasharray="2,2" />
        <path d={areaPath} fill={fillColor} />
        <path d={path} fill="none" stroke={color} strokeWidth="1.5" strokeLinejoin="round" />
        <circle cx={w} cy={h/2 - (final / maxAbs) * (h/2 - 4)} r="2.5" fill={color} />
      </svg>
      <div className="flex justify-between text-[8px] mt-0.5">
        <span className="text-slate-600">{display[0].label}</span>
        <span className={isProfit ? 'text-emerald-400 font-bold' : 'text-red-400 font-bold'}>
          Total: {final >= 0 ? '+' : ''}{fmtINR(final)}
        </span>
        <span className="text-slate-600">{display[display.length - 1].label}</span>
      </div>
    </div>
  );
}

export const MonthlyReturnReport = React.memo(function MonthlyReturnReport() {
  const { transactions, portfolio, livePrices, usdInrRate } = useApp();
  const [showSplit, setShowSplit] = useState(false);

  const { rows, totalRealizedINR } = useMemo(
    () => buildMonthlyReturns(transactions, usdInrRate),
    [transactions, usdInrRate]
  );

  // 2026 perf audit (M1): snapshot-key pattern.
  const livePriceKey = useMemo(() =>
    portfolio.map(p => (livePrices[`${p.market}_${p.symbol}`]?.price ?? 0).toFixed(2)).join('|') + `@${usdInrRate.toFixed(2)}`,
    [portfolio, livePrices, usdInrRate]);
  const live = useMemo(
    () => currentUnrealizedINR(portfolio, livePrices, usdInrRate),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [portfolio, livePriceKey]
  );

  const totalReturnINR = totalRealizedINR + live.unrealizedINR;
  const totalReturnPct = live.investedINR > 0 ? (totalReturnINR / live.investedINR) * 100 : 0;

  // CAGR estimate
  const cagrEstimate = useMemo(() => {
    if (rows.length < 2 || live.investedINR <= 0) return null;
    // Find earliest month from rows
    const sortedRows = [...rows].sort((a, b) => a.month.localeCompare(b.month));
    const firstMonth = sortedRows[0]?.month;
    if (!firstMonth) return null;
    const startDate = new Date(firstMonth + '-01');
    const now = new Date();
    const years = (now.getTime() - startDate.getTime()) / (365.25 * 24 * 3600000);
    if (years < 0.1) return null; // too short
    const totalValue = live.valueINR;
    const totalInvested = live.investedINR;
    if (totalInvested <= 0 || totalValue <= 0) return null;
    // CAGR = (FV/PV)^(1/years) - 1
    const cagr = (Math.pow(totalValue / totalInvested, 1 / years) - 1) * 100;
    return { cagr, years };
  }, [rows, live]);

  // Stats
  const profitMonths = rows.filter(r => r.realizedPLINR > 0).length;
  const lossMonths = rows.filter(r => r.realizedPLINR < 0).length;
  const totalTxns = rows.reduce((s, r) => s + r.txnCount, 0);
  const bestMonth = rows.length > 0 ? rows.reduce((b, r) => r.realizedPLINR > b.realizedPLINR ? r : b, rows[0]) : null;
  const worstMonth = rows.length > 0 ? rows.reduce((w, r) => r.realizedPLINR < w.realizedPLINR ? r : w, rows[0]) : null;

  return (
    <div className="quantum-panel rounded-2xl p-4 animate-fade-in-up">
      <div className="flex items-center justify-between mb-1">
        <h3 className="text-base font-black text-white flex items-center gap-2">
          📅 Monthly Return Report
          <span className="text-[8px] bg-emerald-500/20 text-emerald-300 px-1.5 py-0.5 rounded-md border border-emerald-500/20 font-bold tracking-wider">MONTH-WISE</span>
          {rows.length > 0 && (
            <span className="text-[8px] bg-indigo-500/10 text-indigo-300 px-1.5 py-0.5 rounded-md border border-indigo-500/20 font-bold">
              {rows.length} months
            </span>
          )}
        </h3>
        {rows.length > 0 && (
          <button
            onClick={() => setShowSplit(s => !s)}
            className="px-2 py-1 bg-white/5 border border-white/10 rounded text-[8px] font-bold text-slate-400 hover:text-cyan-400"
          >
            {showSplit ? '📊 Summary' : '🔀 Market Split'}
          </button>
        )}
      </div>
      <p className="text-[11px] text-slate-500 mb-3">
        Har month maine kitna return book kiya aur kitna capital deploy kiya — pura ledger se.
      </p>

      {/* Headline totals */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-2 mb-4">
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
        {/* CAGR card */}
        <div className="bg-black/30 rounded-xl p-3 border border-purple-500/15">
          <div className="text-[9px] text-purple-400/80 font-bold uppercase tracking-wider">Est. CAGR</div>
          {cagrEstimate ? (
            <>
              <div className={`text-sm font-black font-mono mt-0.5 ${cagrEstimate.cagr >= 0 ? 'text-purple-400' : 'text-red-400'}`}>
                {cagrEstimate.cagr >= 0 ? '+' : ''}{cagrEstimate.cagr.toFixed(1)}%
              </div>
              <div className="text-[8px] text-slate-500">{cagrEstimate.years.toFixed(1)} yrs tracked</div>
            </>
          ) : (
            <div className="text-sm font-mono text-slate-500 mt-0.5">N/A</div>
          )}
        </div>
      </div>

      {/* Stats row */}
      {rows.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 mb-3 text-[9px]">
          <span className="px-1.5 py-0.5 bg-emerald-500/10 border border-emerald-500/20 rounded text-emerald-400 font-bold">
            🟢 {profitMonths} profit months
          </span>
          <span className="px-1.5 py-0.5 bg-red-500/10 border border-red-500/20 rounded text-red-400 font-bold">
            🔴 {lossMonths} loss months
          </span>
          <span className="px-1.5 py-0.5 bg-white/5 border border-white/10 rounded text-slate-400 font-bold">
            📝 {totalTxns} total txns
          </span>
          {bestMonth && bestMonth.realizedPLINR > 0 && (
            <span className="px-1.5 py-0.5 bg-yellow-500/10 border border-yellow-500/20 rounded text-yellow-400 font-bold">
              🏆 Best: {bestMonth.label} ({fmtINR(bestMonth.realizedPLINR)})
            </span>
          )}
          {worstMonth && worstMonth.realizedPLINR < 0 && (
            <span className="px-1.5 py-0.5 bg-orange-500/10 border border-orange-500/20 rounded text-orange-400 font-bold">
              📉 Worst: {worstMonth.label} ({fmtINR(worstMonth.realizedPLINR)})
            </span>
          )}
        </div>
      )}

      {rows.length === 0 ? (
        <div className="p-6 text-center text-slate-500 border border-dashed border-white/10 rounded-xl">
          <div className="text-3xl mb-2">📈</div>
          <p className="text-[11px]">Abhi koi monthly return data nahi. Buy/Sell karte raho — har month ka return yahan aayega.</p>
        </div>
      ) : (
        <>
          {/* Monthly return bar chart */}
          <MonthlyReturnChart rows={rows} />

          {/* Cumulative return chart */}
          <CumulativeReturnChart rows={rows} />

          {/* Table */}
          <div className="table-wrapper overflow-x-auto">
            <table className="w-full text-left">
              <thead>
                <tr className="text-[9px] uppercase tracking-wider text-slate-500 font-bold border-b border-white/5">
                  <th className="py-2 pr-2">Month</th>
                  <th className="py-2 px-2 text-right">Net Deployed</th>
                  {showSplit && (
                    <>
                      <th className="py-2 px-1 text-right text-orange-400/60">🇮🇳</th>
                      <th className="py-2 px-1 text-right text-blue-400/60">🇺🇸</th>
                      <th className="py-2 px-1 text-right text-purple-400/60">🪙</th>
                    </>
                  )}
                  <th className="py-2 px-2 text-right">Booked P&amp;L</th>
                  <th className="py-2 px-2 text-right">Return %</th>
                  <th className="py-2 px-1 text-right">MoM</th>
                  <th className="py-2 px-1 text-center">Txns</th>
                  <th className="py-2 pl-2 text-right">Cumulative</th>
                </tr>
              </thead>
              <tbody>
                {rows.map(r => {
                  const isProfit = r.realizedPLINR > 0;
                  const isLoss = r.realizedPLINR < 0;
                  const rowBg = isProfit ? 'bg-emerald-500/[0.03]' : isLoss ? 'bg-red-500/[0.03]' : '';
                  return (
                    <tr key={r.month} className={`text-[11px] border-b border-white/[0.03] hover:bg-white/[0.02] ${rowBg}`}>
                      <td className="py-2 pr-2 font-bold text-white whitespace-nowrap">
                        <div className="flex items-center gap-1">
                          {isProfit ? <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 flex-shrink-0" /> : isLoss ? <span className="w-1.5 h-1.5 rounded-full bg-red-500 flex-shrink-0" /> : <span className="w-1.5 h-1.5 rounded-full bg-slate-600 flex-shrink-0" />}
                          {r.label}
                        </div>
                        <div className="text-[8px] text-slate-500 font-normal font-mono ml-3">{r.rangeLabel}</div>
                      </td>
                      <td className="py-2 px-2 text-right font-mono text-slate-300">{fmtINR(r.netInvestedINR)}</td>
                      {showSplit && (
                        <>
                          <td className="py-2 px-1 text-right font-mono text-[9px] text-orange-400/70">{r.indiaInvestedINR > 0 ? fmtINR(r.indiaInvestedINR) : '—'}</td>
                          <td className="py-2 px-1 text-right font-mono text-[9px] text-blue-400/70">{r.usaInvestedINR > 0 ? fmtINR(r.usaInvestedINR) : '—'}</td>
                          <td className="py-2 px-1 text-right font-mono text-[9px] text-purple-400/70">{r.cryptoInvestedINR > 0 ? fmtINR(r.cryptoInvestedINR) : '—'}</td>
                        </>
                      )}
                      <td className={`py-2 px-2 text-right font-mono font-bold ${r.realizedPLINR >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                        {r.realizedPLINR !== 0 ? `${r.realizedPLINR >= 0 ? '+' : ''}${fmtINR(r.realizedPLINR)}` : '—'}
                      </td>
                      <td className={`py-2 px-2 text-right font-mono font-bold ${r.realizedReturnPct >= 0 ? 'text-emerald-500' : 'text-red-500'}`}>
                        {r.realizedReturnPct !== 0 ? `${r.realizedReturnPct >= 0 ? '+' : ''}${r.realizedReturnPct.toFixed(1)}%` : '—'}
                      </td>
                      {/* MoM delta */}
                      <td className="py-2 px-1 text-right">
                        {r.momDeltaPct !== null ? (
                          <span className={`text-[9px] font-mono font-bold ${r.momDeltaPct >= 0 ? 'text-emerald-500/70' : 'text-red-500/70'}`}>
                            {r.momDeltaPct >= 0 ? '↑' : '↓'}{Math.abs(r.momDeltaPct).toFixed(0)}%
                          </span>
                        ) : (
                          <span className="text-[9px] text-slate-600">—</span>
                        )}
                      </td>
                      {/* Txn count */}
                      <td className="py-2 px-1 text-center">
                        <span className="text-[9px] font-mono text-slate-400">{r.txnCount}</span>
                        <div className="text-[7px] text-slate-600">{r.buyCount}B {r.sellCount}S</div>
                      </td>
                      <td className="py-2 pl-2 text-right font-mono text-cyan-400">{fmtINR(r.cumulativeInvestedINR)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </>
      )}
      <p className="text-[9px] text-slate-600 mt-3">
        ℹ️ "Booked P&amp;L" = sell karke realize kiya hua profit/loss. "Unrealized" = abhi holdings ka live profit. MoM = Month-over-Month investment change.
      </p>
    </div>
  );
});
