import React, { useMemo, useState, useEffect, useCallback, useRef } from 'react';
import { useApp } from '../hooks/AppContext';
import {
  computeLiveDailyPL, recordDailyPL, buildMonthlyPLReport,
  formatMonthlyPLForTelegram, getRecentDailyPL,
  shouldAutoGenerateMonthlyReport, markMonthlyReportGenerated,
  exportDailyPLCSV,
  type MonthlyPLReport, type DailyPLEntry, type LiveDailyPL,
} from '../utils/dailyPLTracker';
import { secureStorage } from '../utils/secureStorage';
import { sendTelegramAlert } from '../utils/api';

// ============================================================
// DAILY P&L TRACKER v3.0 — Deep Analysis
// Uses `change` field directly (same as broker P&L).
// Real-time today + frozen history + monthly report.
// Enhanced: best/worst highlights, week comparison, MTD,
// contribution %, larger charts, top gainer/loser.
// ============================================================

const fmtINR = (n: number) => {
  const sign = n >= 0 ? '+' : '';
  const a = Math.abs(n);
  if (a >= 10000000) return `${sign}₹${(a / 10000000).toFixed(2)} Cr`;
  if (a >= 100000) return `${sign}₹${(a / 100000).toFixed(2)} L`;
  if (a >= 1000) return `${sign}₹${(a / 1000).toFixed(1)}K`;
  return `${sign}₹${Math.round(a).toLocaleString('en-IN')}`;
};

const fmtDay = (date: string) => {
  const d = new Date(date + 'T00:00:00');
  return d.toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric' });
};

export const DailyPLTracker = React.memo(function DailyPLTracker() {
  const { portfolio, livePrices, usdInrRate } = useApp();
  const [sending, setSending] = useState(false);
  const [showReport, setShowReport] = useState(false);
  const [showPositions, setShowPositions] = useState(false);
  const [autoReport, setAutoReport] = useState<MonthlyPLReport | null>(null);
  const [logRefreshTick, setLogRefreshTick] = useState(0);

  // Always-fresh prices for the 60s recorder interval (stable ref so the
  // interval doesn't re-arm on every flush).
  const livePricesRef = useRef(livePrices);
  livePricesRef.current = livePrices;

  // ---- LIVE daily P&L (computed from `change` field) ----
  const livePL: LiveDailyPL = useMemo(() => {
    return computeLiveDailyPL(portfolio, livePrices, usdInrRate);
  }, [portfolio, livePrices, usdInrRate]);

  // ---- Freeze today's P&L into log ----
  // 2026 perf audit (M3): the old 5s debounce re-armed on EVERY price flush
  // (livePL is a new object each time) so it NEVER fired while prices were
  // moving — the hook's own 60s recorder (useAppState) was the only thing
  // actually saving data. A plain 60s interval records reliably and the
  // "recent" table refreshes on the same cadence.
  useEffect(() => {
    if (portfolio.length === 0) return;
    const t = setInterval(() => {
      recordDailyPL(computeLiveDailyPL(portfolio, livePricesRef.current, usdInrRate));
      setLogRefreshTick(k => k + 1);
    }, 60_000);
    return () => clearInterval(t);
  }, [portfolio, usdInrRate]);

  // ---- Auto-generate previous month's report on 1st ----
  useEffect(() => {
    if (shouldAutoGenerateMonthlyReport()) {
      const r = buildMonthlyPLReport();
      setAutoReport(r);
      markMonthlyReportGenerated(r.month);
      setShowReport(true);
    }
  }, []);

  const todayEntry: DailyPLEntry | null = useMemo(() => {
    if (portfolio.length === 0) return null;
    return {
      date: new Date().toISOString().split('T')[0],
      india: livePL.india,
      usa: livePL.usa,
      crypto: livePL.crypto,
      total: livePL.total,
      indiaValueINR: livePL.indiaValueINR,
      usaValueINR: livePL.usaValueINR,
      cryptoValueINR: livePL.cryptoValueINR,
      portfolioValueINR: livePL.portfolioValueINR,
      investedINR: livePL.investedINR,
      ts: Date.now(),
    };
  }, [livePL, portfolio.length]);

  // Recent days: frozen history + today live
  const recent: DailyPLEntry[] = useMemo(() => {
    return getRecentDailyPL(14, todayEntry);
  }, [todayEntry, logRefreshTick]);

  const yesterdayEntry = recent.length > 1 ? recent[recent.length - 2] : null;

  // ---- MTD (month-to-date) P&L ----
  const mtdPL = useMemo(() => {
    const now = new Date();
    const monthKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    return recent
      .filter(e => e.date.startsWith(monthKey))
      .reduce((s, e) => s + e.total, 0);
  }, [recent]);

  // ---- Week summary (this week vs last week) ----
  const weekSummary = useMemo(() => {
    const now = new Date();
    const today = now.getDay(); // 0=Sun, 1=Mon...
    const thisWeekStart = new Date(now);
    thisWeekStart.setDate(now.getDate() - (today === 0 ? 6 : today - 1)); // Monday of this week
    const lastWeekStart = new Date(thisWeekStart);
    lastWeekStart.setDate(thisWeekStart.getDate() - 7);

    const fmt = (d: Date) => d.toISOString().split('T')[0];
    const thisWeekKey = fmt(thisWeekStart);
    const lastWeekKey = fmt(lastWeekStart);

    const thisWeek = recent.filter(e => e.date >= thisWeekKey);
    const lastWeek = recent.filter(e => e.date >= lastWeekKey && e.date < thisWeekKey);

    return {
      thisWeekPL: thisWeek.reduce((s, e) => s + e.total, 0),
      thisWeekDays: thisWeek.length,
      lastWeekPL: lastWeek.reduce((s, e) => s + e.total, 0),
      lastWeekDays: lastWeek.length,
    };
  }, [recent]);

  // ---- Best & worst day in recent ----
  const bestDay = useMemo(() => {
    if (recent.length === 0) return null;
    return recent.reduce((best, e) => e.total > best.total ? e : best, recent[0]);
  }, [recent]);
  const worstDay = useMemo(() => {
    if (recent.length === 0) return null;
    return recent.reduce((worst, e) => e.total < worst.total ? e : worst, recent[0]);
  }, [recent]);

  // ---- Top gainer & loser positions ----
  const topGainer = livePL.perPosition.length > 0 ? livePL.perPosition[0] : null;
  const topLoser = livePL.perPosition.length > 0 ? livePL.perPosition[livePL.perPosition.length - 1] : null;

  // ---- Monthly reports ----
  const currentMonthReport = useMemo(() => {
    const now = new Date();
    const mk = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    return buildMonthlyPLReport(mk);
  }, [logRefreshTick]);

  const prevMonthReport = useMemo(() => buildMonthlyPLReport(), [logRefreshTick]);

  // ---- 30-day trend for chart ----
  const last30 = useMemo(() => getRecentDailyPL(30, todayEntry), [todayEntry, logRefreshTick]);

  // ---- Telegram send ----
  const sendReportToTelegram = useCallback(async (report: MonthlyPLReport) => {
    setSending(true);
    try {
      const token = await secureStorage.getItemAsync('TG_TOKEN');
      const chatId = await secureStorage.getItemAsync('TG_CHAT_ID');
      const msg = formatMonthlyPLForTelegram(report);
      const ok = await sendTelegramAlert(token || '', chatId || '', msg);
      alert(ok ? '✅ Report sent to Telegram!' : '⚠️ Send failed — Telegram not configured.');
    } finally { setSending(false); }
  }, []);

  // ---- CSV download ----
  const downloadCSV = useCallback(() => {
    const csv = exportDailyPLCSV();
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `daily_pl_log_${new Date().toISOString().split('T')[0]}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }, []);

  // ---- P&L as % of portfolio value ----
  const totalPct = todayEntry && todayEntry.portfolioValueINR > 0
    ? (todayEntry.total / todayEntry.portfolioValueINR) * 100
    : 0;
  const totalInvestedPct = todayEntry && todayEntry.investedINR > 0
    ? (todayEntry.total / todayEntry.investedINR) * 100
    : 0;

  return (
    <div className="quantum-panel rounded-2xl p-4 animate-fade-in-up">
      {/* Header */}
      <div className="flex items-center justify-between mb-2">
        <div>
          <h3 className="text-base font-black text-white flex items-center gap-2">
            📊 Daily P&L Tracker
            <span className="text-[8px] bg-amber-500/20 text-amber-300 px-1.5 py-0.5 rounded-md border border-amber-500/20 font-bold tracking-wider">LIVE v3</span>
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" title="Real-time" />
          </h3>
          <p className="text-[11px] text-slate-500 mt-0.5">
            Broker-style P&L · qty × price × change% — real-time from market data
          </p>
        </div>
        <div className="flex items-center gap-1">
          <button
            onClick={downloadCSV}
            className="px-2 py-1 bg-white/5 border border-white/10 rounded text-[9px] font-bold text-slate-400 hover:text-white"
            title="Download CSV"
          >
            📥 CSV
          </button>
          <button
            onClick={() => setShowReport(s => !s)}
            className="px-2 py-1 bg-cyan-500/10 border border-cyan-500/30 rounded text-[9px] font-bold text-cyan-400 hover:bg-cyan-500/20"
          >
            {showReport ? '📅 Daily' : '📋 Monthly'}
          </button>
        </div>
      </div>

      {!showReport ? (
        <>
          {/* ===== Today's P&L per market — enhanced cards ===== */}
          <div className="grid grid-cols-3 gap-2 mb-3">
            <MarketCard label="🇮🇳 India" pl={livePL.india} value={livePL.indiaValueINR} invested={livePL.investedINR > 0 ? livePL.indiaValueINR - (livePL.indiaValueINR / (1 + livePL.india / (livePL.indiaValueINR || 1))) : 0} />
            <MarketCard label="🇺🇸 USA" pl={livePL.usa} value={livePL.usaValueINR} invested={0} />
            <MarketCard label="🪙 Crypto" pl={livePL.crypto} value={livePL.cryptoValueINR} invested={0} />
          </div>

          {/* ===== Total today + MTD row ===== */}
          <div className="p-3 bg-black/30 border border-white/5 rounded-xl mb-3">
            <div className="flex items-center justify-between mb-1">
              <div>
                <div className="text-[10px] text-slate-500 uppercase font-bold tracking-wider">Today's Total P&L</div>
                <div className={`text-2xl font-black font-mono ${livePL.total >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                  {fmtINR(livePL.total)}
                </div>
                <div className="flex items-center gap-2 mt-0.5">
                  <div className={`text-[10px] font-bold ${totalPct >= 0 ? 'text-emerald-500' : 'text-red-500'}`}>
                    {totalPct >= 0 ? '+' : ''}{totalPct.toFixed(2)}% of portfolio
                  </div>
                  <span className="text-slate-700">•</span>
                  <div className={`text-[10px] font-bold ${totalInvestedPct >= 0 ? 'text-cyan-500' : 'text-red-500'}`}>
                    {totalInvestedPct >= 0 ? '+' : ''}{totalInvestedPct.toFixed(2)}% of invested
                  </div>
                </div>
              </div>
              <div className="text-right">
                <div className="text-[9px] text-slate-500">Portfolio Value</div>
                <div className="text-sm font-mono text-cyan-400">
                  {livePL.portfolioValueINR >= 10000000
                    ? `₹${(livePL.portfolioValueINR / 10000000).toFixed(2)} Cr`
                    : `₹${(livePL.portfolioValueINR / 100000).toFixed(1)} L`
                    }
                </div>
                <div className="text-[8px] text-slate-600 mt-0.5">
                  Invested: ₹{(livePL.investedINR / 100000).toFixed(1)}L
                </div>
              </div>
            </div>
            {/* P&L bar (visual) */}
            <div className="mt-2 relative h-1.5 bg-slate-800/60 rounded-full overflow-hidden">
              <div
                className={`absolute top-0 left-1/2 h-full rounded-full transition-all ${
                  livePL.total >= 0
                    ? 'bg-gradient-to-r from-emerald-600 to-emerald-400'
                    : 'bg-gradient-to-l from-red-600 to-red-400'
                }`}
                style={{
                  width: `${Math.min(50, Math.abs(totalPct) * 5)}%`,
                  transform: livePL.total >= 0 ? 'translateX(0)' : 'translateX(-100%)',
                }}
              />
              <div className="absolute top-0 left-1/2 w-px h-full bg-slate-600" />
            </div>
          </div>

          {/* ===== MTD + Week Summary Row ===== */}
          <div className="grid grid-cols-2 gap-2 mb-3">
            {/* MTD */}
            <div className="p-2.5 bg-black/20 border border-white/5 rounded-xl">
              <div className="text-[9px] text-indigo-400/70 uppercase font-bold tracking-wider mb-1">📅 Month-to-Date</div>
              <div className={`text-lg font-black font-mono ${mtdPL >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                {fmtINR(mtdPL)}
              </div>
              <div className="text-[8px] text-slate-500">{recent.filter(e => e.date.startsWith(new Date().toISOString().slice(0, 7))).length} trading days</div>
            </div>
            {/* Week vs Week */}
            <div className="p-2.5 bg-black/20 border border-white/5 rounded-xl">
              <div className="text-[9px] text-purple-400/70 uppercase font-bold tracking-wider mb-1">📊 Week Comparison</div>
              <div className="flex items-baseline gap-2">
                <div>
                  <div className="text-[8px] text-slate-500">This Week</div>
                  <div className={`text-sm font-black font-mono ${weekSummary.thisWeekPL >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                    {fmtINR(weekSummary.thisWeekPL)}
                  </div>
                </div>
                <div className="text-slate-700 text-xs">vs</div>
                <div>
                  <div className="text-[8px] text-slate-500">Last Week</div>
                  <div className={`text-sm font-bold font-mono ${weekSummary.lastWeekPL >= 0 ? 'text-emerald-500/60' : 'text-red-500/60'}`}>
                    {fmtINR(weekSummary.lastWeekPL)}
                  </div>
                </div>
              </div>
              {weekSummary.lastWeekPL !== 0 && (
                <div className={`text-[8px] font-bold mt-0.5 ${weekSummary.thisWeekPL > weekSummary.lastWeekPL ? 'text-emerald-400' : 'text-red-400'}`}>
                  {weekSummary.thisWeekPL > weekSummary.lastWeekPL ? '↑ Better' : '↓ Worse'} than last week
                </div>
              )}
            </div>
          </div>

          {/* ===== Yesterday comparison ===== */}
          {yesterdayEntry && (
            <div className="p-2 bg-black/20 border border-white/5 rounded-lg mb-3">
              <div className="text-[9px] text-slate-500 uppercase font-bold tracking-wider mb-1">Yesterday ({fmtDay(yesterdayEntry.date)})</div>
              <div className="flex items-center gap-3 text-[10px]">
                <span className={yesterdayEntry.total >= 0 ? 'text-emerald-400 font-bold' : 'text-red-400 font-bold'}>
                  Total: {fmtINR(yesterdayEntry.total)}
                </span>
                <span className="text-slate-500">🇮🇳 {fmtINR(yesterdayEntry.india)}</span>
                <span className="text-slate-500">🇺🇸 {fmtINR(yesterdayEntry.usa)}</span>
                <span className="text-slate-500">🪙 {fmtINR(yesterdayEntry.crypto)}</span>
              </div>
            </div>
          )}

          {/* ===== Top Gainer / Loser ===== */}
          {topGainer && topLoser && livePL.perPosition.length >= 2 && (
            <div className="grid grid-cols-2 gap-2 mb-3">
              <div className="p-2 bg-emerald-500/5 border border-emerald-500/15 rounded-lg">
                <div className="text-[8px] text-emerald-400 font-bold uppercase tracking-wider mb-0.5">🏆 Top Gainer</div>
                <div className="text-[11px] font-bold text-white">{topGainer.symbol}</div>
                <div className="text-[10px] font-mono font-bold text-emerald-400">{fmtINR(topGainer.plINR)}</div>
                <div className="text-[8px] text-emerald-500/60">{topGainer.change >= 0 ? '+' : ''}{topGainer.change.toFixed(2)}%</div>
              </div>
              <div className="p-2 bg-red-500/5 border border-red-500/15 rounded-lg">
                <div className="text-[8px] text-red-400 font-bold uppercase tracking-wider mb-0.5">📉 Top Loser</div>
                <div className="text-[11px] font-bold text-white">{topLoser.symbol}</div>
                <div className="text-[10px] font-mono font-bold text-red-400">{fmtINR(topLoser.plINR)}</div>
                <div className="text-[8px] text-red-500/60">{topLoser.change >= 0 ? '+' : ''}{topLoser.change.toFixed(2)}%</div>
              </div>
            </div>
          )}

          {/* ===== 14-day bar chart — enhanced with best/worst highlights ===== */}
          <div className="mb-3">
            <div className="flex items-center justify-between mb-2">
              <div className="text-[10px] text-slate-500 font-bold uppercase tracking-wider">Last 14 Days</div>
              <div className="text-[8px] text-slate-600">
                {recent.filter(r => r.total >= 0).length} green · {recent.filter(r => r.total < 0).length} red
              </div>
            </div>
            {recent.length === 0 ? (
              <div className="p-4 bg-black/20 border border-dashed border-white/10 rounded-xl text-center text-[11px] text-slate-500">
                No history yet. Today's P&L will be the first entry — keep the site open.
              </div>
            ) : (
              <div className="flex items-end gap-0.5 h-36 bg-black/20 rounded-lg p-2 pt-5">
                {recent.map((e, i) => {
                  const maxAbs = Math.max(...recent.map(r => Math.abs(r.total)), 1);
                  const h = Math.max(4, (Math.abs(e.total) / maxAbs) * 100);
                  const isProfit = e.total >= 0;
                  const isToday = i === recent.length - 1;
                  const isBest = bestDay && e.date === bestDay.date && e.total > 0;
                  const isWorst = worstDay && e.date === worstDay.date && e.total < 0;
                  return (
                    <div key={e.date} className="flex-1 flex flex-col items-center justify-end group relative" title={`${e.date}: ${fmtINR(e.total)}`}>
                      {/* Best/Worst badge */}
                      {isBest && <div className="text-[7px] text-emerald-400 font-bold mb-0.5 animate-pulse">🏆</div>}
                      {isWorst && <div className="text-[7px] text-red-400 font-bold mb-0.5">📉</div>}
                      <div className={`text-[8px] font-mono mb-0.5 ${isProfit ? 'text-emerald-400' : 'text-red-400'} ${isToday ? 'font-bold' : ''}`}>
                        {Math.abs(e.total) >= 1000 ? `${(e.total / 1000).toFixed(0)}K` : Math.round(e.total)}
                      </div>
                      <div
                        className={`w-full rounded-t transition-all ${
                          isBest
                            ? 'bg-gradient-to-t from-emerald-600 to-yellow-400 ring-1 ring-yellow-400/50'
                            : isWorst
                            ? 'bg-gradient-to-t from-red-700 to-orange-400 ring-1 ring-orange-400/50'
                            : isProfit
                            ? 'bg-gradient-to-t from-emerald-700 to-emerald-400'
                            : 'bg-gradient-to-t from-red-700 to-red-400'
                        } ${isToday ? 'ring-1 ring-cyan-400 ring-offset-1 ring-offset-black/40' : ''}`}
                        style={{ height: `${h}px` }}
                      />
                      <div className={`text-[7px] mt-1 ${isToday ? 'text-cyan-400 font-bold' : 'text-slate-600'}`}>
                        {fmtDay(e.date).split(' ')[0].slice(0, 2)}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* ===== Per-position breakdown — enhanced with contribution % ===== */}
          {livePL.perPosition.length > 0 && (
            <div className="mb-3">
              <button
                onClick={() => setShowPositions(s => !s)}
                className="w-full text-left text-[10px] text-slate-500 font-bold uppercase tracking-wider hover:text-cyan-400 transition-colors"
              >
                {showPositions ? '▼' : '▶'} Per-Position Breakdown ({livePL.perPosition.length})
              </button>
              {showPositions && (
                <div className="mt-2 space-y-1 max-h-60 overflow-y-auto scrollbar-hide">
                  {livePL.perPosition.map((p, i) => {
                    const cur = p.market === 'IN' ? '₹' : '$';
                    const isProfit = p.plINR >= 0;
                    const contribution = livePL.total !== 0 ? (p.plINR / livePL.total) * 100 : 0;
                    return (
                      <div key={i} className="flex items-center justify-between gap-2 p-1.5 bg-black/20 rounded-lg text-[10px]">
                        <div className="flex items-center gap-2 flex-1 min-w-0">
                          <span className={`w-1 h-6 rounded-full ${isProfit ? 'bg-emerald-500' : 'bg-red-500'}`} />
                          <div className="min-w-0 flex-1">
                            <div className="font-bold text-white truncate">{p.symbol}</div>
                            <div className="text-[8px] text-slate-500 font-mono">
                              {p.qty} × {cur}{p.price.toFixed(2)} · {p.change >= 0 ? '+' : ''}{p.change.toFixed(2)}%
                            </div>
                          </div>
                        </div>
                        <div className="text-right flex items-center gap-2">
                          <div>
                            <div className={`font-mono font-bold ${isProfit ? 'text-emerald-400' : 'text-red-400'}`}>
                              {fmtINR(p.plINR)}
                            </div>
                            {/* Contribution % */}
                            <div className={`text-[8px] font-mono ${Math.abs(contribution) > 20 ? (isProfit ? 'text-emerald-500' : 'text-red-500') : 'text-slate-500'}`}>
                              {contribution >= 0 ? '+' : ''}{contribution.toFixed(1)}% contrib
                            </div>
                          </div>
                          {/* Mini bar */}
                          <div className="w-8 h-4 flex items-end">
                            <div
                              className={`w-full rounded-t ${isProfit ? 'bg-emerald-500/40' : 'bg-red-500/40'}`}
                              style={{ height: `${Math.min(100, Math.abs(contribution))}%` }}
                            />
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          {/* ===== 30-day trend mini-chart — enhanced ===== */}
          {last30.length >= 3 && (
            <div className="mb-3">
              <div className="text-[10px] text-slate-500 font-bold uppercase tracking-wider mb-1">30-Day Cumulative P&L Trend</div>
              <CumulativeChart entries={last30} />
            </div>
          )}

          <div className="text-[8px] text-slate-700 mt-2 leading-tight">
            💡 P&L = qty × currentPrice × (daily change%). Same formula as Zerodha/Groww.
            "India/USA/Crypto" split by market. USA P&L converted to INR at live forex rate.
            On 1st of each month, a full monthly report auto-generates.
          </div>
        </>
      ) : (
        <>
          {/* ===== Monthly report view ===== */}
          {autoReport && (
            <div className="mb-3 p-2.5 bg-emerald-500/10 border border-emerald-500/30 rounded-lg">
              <div className="text-[10px] text-emerald-300 font-bold">🎉 Auto-Generated: {autoReport.monthLabel} Report</div>
              <div className="text-[9px] text-emerald-400/70">Generated on 1st of this month</div>
            </div>
          )}

          <MonthlyReportView
            report={currentMonthReport}
            title={`${currentMonthReport.monthLabel} (Month-to-Date)`}
            onSend={() => sendReportToTelegram(currentMonthReport)}
            sending={sending}
          />

          <div className="my-3 border-t border-white/5" />

          <MonthlyReportView
            report={prevMonthReport}
            title={`${prevMonthReport.monthLabel} (Closed Month)`}
            onSend={() => sendReportToTelegram(prevMonthReport)}
            sending={sending}
          />
        </>
      )}
    </div>
  );
});

// ---------- Market P&L Card — Enhanced ----------
interface MarketCardProps {
  label: string;
  pl: number;
  value: number;
  invested: number;
}
const MarketCard = React.memo(function MarketCard({ label, pl, value }: MarketCardProps) {
  const isProfit = pl >= 0;
  const pct = value > 0 ? (pl / value) * 100 : 0;
  return (
    <div className={`rounded-xl p-2.5 border text-center ${
      isProfit ? 'bg-emerald-500/5 border-emerald-500/15' : 'bg-red-500/5 border-red-500/15'
    }`}>
      <div className="text-[9px] text-slate-500 uppercase font-bold tracking-wider mb-1">{label}</div>
      <div className={`text-sm font-black font-mono ${isProfit ? 'text-emerald-400' : 'text-red-400'}`}>
        {fmtINR(pl)}
      </div>
      <div className={`text-[8px] ${isProfit ? 'text-emerald-500/60' : 'text-red-500/60'}`}>
        {pct >= 0 ? '+' : ''}{pct.toFixed(2)}% of value
      </div>
    </div>
  );
});

// ---------- Cumulative P&L line chart (SVG) — Larger & Enhanced ----------
function CumulativeChart({ entries }: { entries: DailyPLEntry[] }) {
  if (entries.length < 2) return null;

  let cumulative = 0;
  const points = entries.map(e => {
    cumulative += e.total;
    return { date: e.date, cum: cumulative, daily: e.total };
  });

  const maxAbs = Math.max(...points.map(p => Math.abs(p.cum)), 1);
  const w = 400, h = 90;
  const stepX = w / (points.length - 1);

  const path = points.map((p, i) => {
    const x = i * stepX;
    const y = h / 2 - (p.cum / maxAbs) * (h / 2 - 6);
    return `${i === 0 ? 'M' : 'L'}${x},${y}`;
  }).join(' ');

  const areaPath = `${path} L${w},${h/2} L0,${h/2} Z`;
  const finalCum = points[points.length - 1].cum;
  const isProfit = finalCum >= 0;
  const color = isProfit ? '#34d399' : '#f87171';
  const fillColor = isProfit ? 'rgba(52,211,153,0.12)' : 'rgba(248,113,113,0.12)';

  // Find max & min points for markers
  const maxPt = points.reduce((m, p) => p.cum > m.cum ? p : m, points[0]);
  const minPt = points.reduce((m, p) => p.cum < m.cum ? p : m, points[0]);
  const maxPtI = points.indexOf(maxPt);
  const minPtI = points.indexOf(minPt);

  return (
    <div className="relative">
      <svg viewBox={`0 0 ${w} ${h}`} className="w-full h-24" preserveAspectRatio="none">
        {/* Grid lines */}
        <line x1="0" y1={h/4} x2={w} y2={h/4} stroke="rgba(75,85,99,0.15)" strokeWidth="0.5" strokeDasharray="3,3" />
        <line x1="0" y1={h/2} x2={w} y2={h/2} stroke="rgba(75,85,99,0.3)" strokeWidth="0.5" strokeDasharray="2,2" />
        <line x1="0" y1={3*h/4} x2={w} y2={3*h/4} stroke="rgba(75,85,99,0.15)" strokeWidth="0.5" strokeDasharray="3,3" />
        {/* Area fill */}
        <path d={areaPath} fill={fillColor} />
        {/* Line */}
        <path d={path} fill="none" stroke={color} strokeWidth="2" strokeLinejoin="round" />
        {/* End dot */}
        <circle cx={w} cy={h/2 - (finalCum / maxAbs) * (h/2 - 6)} r="3" fill={color} />
        {/* Max point marker */}
        <circle cx={maxPtI * stepX} cy={h/2 - (maxPt.cum / maxAbs) * (h/2 - 6)} r="2.5" fill="#fbbf24" stroke="#fbbf24" strokeWidth="1" />
        {/* Min point marker */}
        <circle cx={minPtI * stepX} cy={h/2 - (minPt.cum / maxAbs) * (h/2 - 6)} r="2.5" fill="#f87171" stroke="#f87171" strokeWidth="1" />
      </svg>
      <div className="flex justify-between text-[8px] text-slate-600 mt-1">
        <span>{fmtDay(points[0].date)}</span>
        <div className="flex items-center gap-3">
          <span className="text-yellow-400 text-[7px]">● Max: {fmtINR(maxPt.cum)}</span>
          <span className="text-red-400 text-[7px]">● Min: {fmtINR(minPt.cum)}</span>
        </div>
        <span className={isProfit ? 'text-emerald-400 font-bold' : 'text-red-400 font-bold'}>
          Cum: {fmtINR(finalCum)}
        </span>
      </div>
    </div>
  );
}

// ---------- Monthly report block ----------
interface MonthlyReportViewProps {
  report: MonthlyPLReport;
  title: string;
  onSend: () => void;
  sending: boolean;
}
const MonthlyReportView = React.memo(function MonthlyReportView({ report, title, onSend, sending }: MonthlyReportViewProps) {
  const fmt = (n: number) => `${n >= 0 ? '+' : ''}₹${Math.round(n).toLocaleString('en-IN')}`;
  const sections = [
    { label: '🇮🇳 India', stats: report.india, field: 'india' as const },
    { label: '🇺🇸 USA', stats: report.usa, field: 'usa' as const },
    { label: '🪙 Crypto', stats: report.crypto, field: 'crypto' as const },
    { label: '📊 TOTAL', stats: report.total, field: 'total' as const },
  ];

  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <div className="text-[11px] font-bold text-white">{title}</div>
        <button
          onClick={onSend}
          disabled={sending}
          className="px-2 py-0.5 bg-cyan-500/10 border border-cyan-500/30 rounded text-[9px] font-bold text-cyan-400 hover:bg-cyan-500/20 disabled:opacity-50"
        >
          {sending ? '⏳' : '📤 Send'}
        </button>
      </div>

      {report.tradingDays === 0 ? (
        <div className="p-3 bg-black/20 border border-dashed border-white/10 rounded-lg text-center text-[10px] text-slate-500">
          No daily P&L recorded for {report.monthLabel}.
        </div>
      ) : (
        <>
          <div className="text-[9px] text-slate-500 mb-2">
            Trading days: <b className="text-white">{report.tradingDays}</b> ·
            Win rate: <b className="text-cyan-400">{((report.total.profitDays / report.tradingDays) * 100).toFixed(0)}%</b>
          </div>
          <div className="space-y-1.5">
            {sections.map(s => {
              const color = s.stats.total >= 0 ? 'text-emerald-400' : 'text-red-400';
              const bg = s.stats.total >= 0 ? 'bg-emerald-500/5' : 'bg-red-500/5';
              return (
                <div key={s.label} className={`rounded-lg p-2 ${bg} border border-white/5`}>
                  <div className="flex items-center justify-between">
                    <span className="text-[11px] font-bold text-white">{s.label}</span>
                    <span className={`text-sm font-mono font-black ${color}`}>{fmt(s.stats.total)}</span>
                  </div>
                  <div className="flex items-center justify-between mt-0.5 text-[9px] text-slate-500">
                    <span>🟢 {s.stats.profitDays} · 🔴 {s.stats.lossDays} · Avg {fmt(s.stats.avgPerDay)}/d</span>
                    {s.stats.maxStreak > 1 && <span className="text-amber-400">🔥 Best streak: {s.stats.maxStreak}d</span>}
                  </div>
                  {s.stats.bestDay && (
                    <div className="text-[8px] text-emerald-400/60 mt-0.5">
                      Best: {fmtDay(s.stats.bestDay.date)} ({fmt((s.stats.bestDay as any)[s.field])})
                    </div>
                  )}
                  {s.stats.worstDay && (
                    <div className="text-[8px] text-red-400/60">
                      Worst: {fmtDay(s.stats.worstDay.date)} ({fmt((s.stats.worstDay as any)[s.field])})
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
});
