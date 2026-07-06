import React, { useMemo, useState, useEffect, useCallback } from 'react';
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
// DAILY P&L TRACKER v2.0 — Advanced
// Uses `change` field directly (same as broker P&L).
// Real-time today + frozen history + monthly report.
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
  const [refreshTick, setRefreshTick] = useState(0);

  // ---- LIVE daily P&L (computed from `change` field) ----
  const livePL: LiveDailyPL = useMemo(() => {
    return computeLiveDailyPL(portfolio, livePrices, usdInrRate);
  }, [portfolio, livePrices, usdInrRate, refreshTick]);

  // ---- Freeze today's P&L into log (debounced) ----
  useEffect(() => {
    if (portfolio.length === 0) return;
    const t = setTimeout(() => {
      recordDailyPL(livePL);
      setRefreshTick(t => t + 1);  // trigger re-read of frozen log
    }, 3000);
    return () => clearTimeout(t);
  }, [livePL, portfolio.length]);

  // ---- Auto-generate previous month's report on 1st ----
  useEffect(() => {
    if (shouldAutoGenerateMonthlyReport()) {
      const r = buildMonthlyPLReport();
      setAutoReport(r);
      markMonthlyReportGenerated(r.month);
      setShowReport(true);
    }
  }, []);

  // Merge: livePL is always
  // more current because it's computed from the latest prices).
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
  }, [todayEntry, refreshTick]);

  const yesterdayEntry = recent.length > 1 ? recent[recent.length - 2] : null;

  // ---- Monthly reports ----
  const currentMonthReport = useMemo(() => {
    const now = new Date();
    const mk = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    return buildMonthlyPLReport(mk);
  }, [refreshTick]);

  const prevMonthReport = useMemo(() => buildMonthlyPLReport(), [refreshTick]);

  // ---- 30-day trend for chart ----
  const last30 = useMemo(() => getRecentDailyPL(30, todayEntry), [todayEntry, refreshTick]);

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

  return (
    <div className="quantum-panel rounded-2xl p-4 animate-fade-in-up">
      {/* Header */}
      <div className="flex items-center justify-between mb-2">
        <div>
          <h3 className="text-base font-black text-white flex items-center gap-2">
            📊 Daily P&L Tracker
            <span className="text-[8px] bg-amber-500/20 text-amber-300 px-1.5 py-0.5 rounded-md border border-amber-500/20 font-bold tracking-wider">LIVE v2</span>
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
          {/* ===== Today's P&L per market ===== */}
          <div className="grid grid-cols-3 gap-2 mb-3">
            <MarketCard label="🇮🇳 India" pl={livePL.india} value={livePL.indiaValueINR} />
            <MarketCard label="🇺🇸 USA" pl={livePL.usa} value={livePL.usaValueINR} />
            <MarketCard label="🪙 Crypto" pl={livePL.crypto} value={livePL.cryptoValueINR} />
          </div>

          {/* ===== Total today ===== */}
          <div className="p-3 bg-black/30 border border-white/5 rounded-xl mb-3">
            <div className="flex items-center justify-between mb-1">
              <div>
                <div className="text-[10px] text-slate-500 uppercase font-bold tracking-wider">Today's Total P&L</div>
                <div className={`text-2xl font-black font-mono ${livePL.total >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                  {fmtINR(livePL.total)}
                </div>
                <div className={`text-[10px] font-bold ${totalPct >= 0 ? 'text-emerald-500' : 'text-red-500'}`}>
                  {totalPct >= 0 ? '+' : ''}{totalPct.toFixed(2)}% of portfolio
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

          {/* ===== 14-day bar chart ===== */}
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
              <div className="flex items-end gap-0.5 h-28 bg-black/20 rounded-lg p-2">
                {recent.map((e, i) => {
                  const maxAbs = Math.max(...recent.map(r => Math.abs(r.total)), 1);
                  const h = Math.max(3, (Math.abs(e.total) / maxAbs) * 90);
                  const isProfit = e.total >= 0;
                  const isToday = i === recent.length - 1;
                  return (
                    <div key={e.date} className="flex-1 flex flex-col items-center justify-end group relative" title={`${e.date}: ${fmtINR(e.total)}`}>
                      <div className={`text-[7px] font-mono mb-0.5 ${isProfit ? 'text-emerald-400' : 'text-red-400'} ${isToday ? 'font-bold' : ''}`}>
                        {Math.abs(e.total) >= 1000 ? `${(e.total / 1000).toFixed(0)}K` : Math.abs(e.total)}
                      </div>
                      <div
                        className={`w-full rounded-t transition-all ${
                          isProfit
                            ? 'bg-gradient-to-t from-emerald-700 to-emerald-400'
                            : 'bg-gradient-to-t from-red-700 to-red-400'
                        } ${isToday ? 'ring-1 ring-cyan-400 ring-offset-1 ring-offset-black/40' : ''}`}
                        style={{ height: `${h}px` }}
                      />
                      <div className={`text-[6px] mt-1 ${isToday ? 'text-cyan-400 font-bold' : 'text-slate-600'}`}>
                        {fmtDay(e.date).split(' ')[0].slice(0, 2)}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* ===== Per-position breakdown ===== */}
          {livePL.perPosition.length > 0 && (
            <div className="mb-3">
              <button
                onClick={() => setShowPositions(s => !s)}
                className="w-full text-left text-[10px] text-slate-500 font-bold uppercase tracking-wider hover:text-cyan-400 transition-colors"
              >
                {showPositions ? '▼' : '▶'} Per-Position Breakdown ({livePL.perPosition.length})
              </button>
              {showPositions && (
                <div className="mt-2 space-y-1 max-h-48 overflow-y-auto scrollbar-hide">
                  {livePL.perPosition.map((p, i) => {
                    const cur = p.market === 'IN' ? '₹' : '$';
                    const isProfit = p.plINR >= 0;
                    return (
                      <div key={i} className="flex items-center justify-between gap-2 p-1.5 bg-black/20 rounded-lg text-[10px]">
                        <div className="flex items-center gap-2 flex-1 min-w-0">
                          <span className={`w-1 h-6 rounded-full ${isProfit ? 'bg-emerald-500' : 'bg-red-500'}`} />
                          <div className="min-w-0">
                            <div className="font-bold text-white truncate">{p.symbol}</div>
                            <div className="text-[8px] text-slate-500 font-mono">
                              {p.qty} × {cur}{p.price.toFixed(2)} · {p.change >= 0 ? '+' : ''}{p.change.toFixed(2)}%
                            </div>
                          </div>
                        </div>
                        <div className={`font-mono font-bold ${isProfit ? 'text-emerald-400' : 'text-red-400'}`}>
                          {fmtINR(p.plINR)}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          {/* ===== 30-day trend mini-chart ===== */}
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

// ---------- Market P&L Card ----------
interface MarketCardProps {
  label: string;
  pl: number;
  value: number;
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
        {pct >= 0 ? '+' : ''}{pct.toFixed(2)}%
      </div>
    </div>
  );
});

// ---------- Cumulative P&L line chart (SVG) ----------
function CumulativeChart({ entries }: { entries: DailyPLEntry[] }) {
  if (entries.length < 2) return null;

  let cumulative = 0;
  const points = entries.map(e => {
    cumulative += e.total;
    return { date: e.date, cum: cumulative, daily: e.total };
  });

  const maxAbs = Math.max(...points.map(p => Math.abs(p.cum)), 1);
  const w = 300, h = 60;
  const stepX = w / (points.length - 1);

  const path = points.map((p, i) => {
    const x = i * stepX;
    const y = h / 2 - (p.cum / maxAbs) * (h / 2 - 4);
    return `${i === 0 ? 'M' : 'L'}${x},${y}`;
  }).join(' ');

  const areaPath = `${path} L${w},${h/2} L0,${h/2} Z`;
  const finalCum = points[points.length - 1].cum;
  const isProfit = finalCum >= 0;
  const color = isProfit ? '#34d399' : '#f87171';
  const fillColor = isProfit ? 'rgba(52,211,153,0.1)' : 'rgba(248,113,113,0.1)';

  return (
    <div className="relative">
      <svg viewBox={`0 0 ${w} ${h}`} className="w-full h-16" preserveAspectRatio="none">
        <line x1="0" y1={h/2} x2={w} y2={h/2} stroke="rgba(75,85,99,0.3)" strokeWidth="0.5" strokeDasharray="2,2" />
        <path d={areaPath} fill={fillColor} />
        <path d={path} fill="none" stroke={color} strokeWidth="1.5" strokeLinejoin="round" />
        <circle cx={w} cy={h/2 - (finalCum / maxAbs) * (h/2 - 4)} r="2" fill={color} />
      </svg>
      <div className="flex justify-between text-[8px] text-slate-600 mt-0.5">
        <span>{fmtDay(points[0].date)}</span>
        <span className={isProfit ? 'text-emerald-400 font-bold' : 'text-red-400 font-bold'}>
          Cumulative: {fmtINR(finalCum)}
        </span>
        <span>Today</span>
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
