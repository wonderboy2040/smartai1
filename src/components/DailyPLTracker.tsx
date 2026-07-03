import React, { useMemo, useState, useEffect, useCallback } from 'react';
import { useApp } from '../hooks/AppContext';
import {
  buildMonthlyPLReport, formatMonthlyPLForTelegram,
  getRecentDailyPL, shouldAutoGenerateMonthlyReport,
  markMonthlyReportGenerated,
  type MonthlyPLReport, type DailyPLEntry,
} from '../utils/dailyPLTracker';
import { secureStorage } from '../utils/secureStorage';
import { sendTelegramAlert } from '../utils/api';

// ============================================================
// DAILY P&L TRACKER (Portfolio tab)
// Shows today's P&L per market + last 7 days strip + monthly
// report (auto-generated on 1st of month).
// ============================================================

const fmtINR = (n: number) => {
  const sign = n >= 0 ? '+' : '';
  const a = Math.abs(n);
  if (a >= 10000000) return `${sign}₹${(n / 10000000).toFixed(2)} Cr`;
  if (a >= 100000) return `${sign}₹${(n / 100000).toFixed(2)} L`;
  return `${sign}₹${Math.round(n).toLocaleString('en-IN')}`;
};

const fmtDay = (date: string) => {
  const d = new Date(date + 'T00:00:00');
  return d.toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric' });
};

export const DailyPLTracker = React.memo(function DailyPLTracker() {
  const { portfolio, livePrices, transactions } = useApp();
  const [sending, setSending] = useState(false);
  const [showReport, setShowReport] = useState(false);
  const [autoReport, setAutoReport] = useState<MonthlyPLReport | null>(null);

  // Auto-generate previous month's report on 1st of month (once).
  useEffect(() => {
    if (shouldAutoGenerateMonthlyReport()) {
      const r = buildMonthlyPLReport();  // defaults to previous month
      setAutoReport(r);
      markMonthlyReportGenerated(r.month);
      setShowReport(true);
    }
  }, []);

  const recent = useMemo(() => getRecentDailyPL(7), [transactions, livePrices, portfolio]);
  const todayEntry = recent.length > 0 ? recent[recent.length - 1] : null;
  const yesterdayEntry = recent.length > 1 ? recent[recent.length - 2] : null;

  // Build manual report (current month so far).
  const currentMonthReport = useMemo(() => {
    const now = new Date();
    const mk = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    return buildMonthlyPLReport(mk);
  }, [transactions, livePrices, portfolio]);

  const prevMonthReport = useMemo(() => buildMonthlyPLReport(), []);

  const sendReportToTelegram = useCallback(async (report: MonthlyPLReport) => {
    setSending(true);
    try {
      const token = await secureStorage.getItemAsync('TG_TOKEN');
      const chatId = await secureStorage.getItemAsync('TG_CHAT_ID');
      const msg = formatMonthlyPLForTelegram(report);
      const ok = await sendTelegramAlert(token || '', chatId || '', msg);
      alert(ok ? '✅ Report sent to Telegram!' : '⚠️ Send failed — Telegram not configured.');
    } finally {
      setSending(false);
    }
  }, []);

  return (
    <div className="quantum-panel rounded-2xl p-4 animate-fade-in-up">
      {/* Header */}
      <div className="flex items-center justify-between mb-2">
        <div>
          <h3 className="text-base font-black text-white flex items-center gap-2">
            📊 Daily P&L Tracker
            <span className="text-[8px] bg-amber-500/20 text-amber-300 px-1.5 py-0.5 rounded-md border border-amber-500/20 font-bold tracking-wider">DAILY</span>
          </h3>
          <p className="text-[11px] text-slate-500 mt-0.5">
            Daily profit/loss per market — har din ka P&L track hota hai.
          </p>
        </div>
        <button
          onClick={() => setShowReport(s => !s)}
          className="px-2 py-1 bg-cyan-500/10 border border-cyan-500/30 rounded text-[9px] font-bold text-cyan-400 hover:bg-cyan-500/20"
        >
          {showReport ? '📅 Daily View' : '📋 Monthly Report'}
        </button>
      </div>

      {!showReport ? (
        <>
          {/* Today's P&L per market */}
          <div className="grid grid-cols-3 gap-2 mb-4">
            <PLCard label="🇮🇳 India" entry={todayEntry} field="india" />
            <PLCard label="🇺🇸 USA" entry={todayEntry} field="usa" />
            <PLCard label="🪙 Crypto" entry={todayEntry} field="crypto" />
          </div>

          {/* Total today */}
          <div className="p-3 bg-black/30 border border-white/5 rounded-xl mb-4">
            <div className="flex items-center justify-between">
              <div>
                <div className="text-[10px] text-slate-500 uppercase font-bold tracking-wider">Today's Total P&L</div>
                <div className={`text-xl font-black font-mono ${(todayEntry?.total ?? 0) >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                  {todayEntry ? fmtINR(todayEntry.total) : '—'}
                </div>
              </div>
              <div className="text-right">
                <div className="text-[9px] text-slate-500">Portfolio Value</div>
                <div className="text-[11px] font-mono text-cyan-400">
                  {todayEntry ? `₹${(todayEntry.portfolioValueINR / 100000).toFixed(1)}L` : '—'}
                </div>
              </div>
            </div>
            {yesterdayEntry && (
              <div className="text-[9px] text-slate-600 mt-1.5">
                Yesterday: <span className={yesterdayEntry.total >= 0 ? 'text-emerald-400' : 'text-red-400'}>
                  {fmtINR(yesterdayEntry.total)}
                </span>
                {' · '}
                India {fmtINR(yesterdayEntry.india)} · USA {fmtINR(yesterdayEntry.usa)} · Crypto {fmtINR(yesterdayEntry.crypto)}
              </div>
            )}
          </div>

          {/* Last 7 days bar chart */}
          <div className="mb-2">
            <div className="text-[10px] text-slate-500 font-bold uppercase tracking-wider mb-2">Last 7 Days</div>
            {recent.length === 0 ? (
              <div className="p-4 bg-black/20 border border-dashed border-white/10 rounded-xl text-center text-[11px] text-slate-500">
                No daily P&L recorded yet. Snapshot starts tomorrow — keep the site open daily.
              </div>
            ) : (
              <div className="flex items-end gap-1.5 h-24 bg-black/20 rounded-lg p-2">
                {recent.map((e) => {
                  const maxAbs = Math.max(...recent.map(r => Math.abs(r.total)), 1);
                  const h = Math.max(4, (Math.abs(e.total) / maxAbs) * 80);
                  const isProfit = e.total >= 0;
                  return (
                    <div key={e.date} className="flex-1 flex flex-col items-center justify-end" title={`${e.date}: ${fmtINR(e.total)}`}>
                      <div className={`text-[8px] font-mono mb-0.5 ${isProfit ? 'text-emerald-400' : 'text-red-400'}`}>
                        {Math.abs(e.total) >= 1000 ? `${(e.total / 1000).toFixed(1)}K` : e.total}
                      </div>
                      <div
                        className={`w-full rounded-t transition-all ${isProfit ? 'bg-gradient-to-t from-emerald-600 to-emerald-400' : 'bg-gradient-to-t from-red-600 to-red-400'}`}
                        style={{ height: `${h}px` }}
                      />
                      <div className="text-[7px] text-slate-600 mt-1">{fmtDay(e.date)}</div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          <div className="text-[8px] text-slate-700 mt-2 leading-tight">
            💡 Auto-snapshots portfolio value at end of each day. P&L = market movement (excludes new capital deployed today).
            On 1st of each month, a full monthly report is auto-generated.
          </div>
        </>
      ) : (
        <>
          {/* Monthly report view */}
          {/* Auto-generated banner if 1st of month */}
          {autoReport && (
            <div className="mb-3 p-2.5 bg-emerald-500/10 border border-emerald-500/30 rounded-lg">
              <div className="text-[10px] text-emerald-300 font-bold">🎉 Auto-Generated: {autoReport.monthLabel} Report</div>
              <div className="text-[9px] text-emerald-400/70">Generated on 1st of this month</div>
            </div>
          )}

          {/* Report tabs: previous month vs current month so far */}
          <MonthlyReportView
            report={prevMonthReport}
            title={`${prevMonthReport.monthLabel} (Closed Month)`}
            onSend={() => sendReportToTelegram(prevMonthReport)}
            sending={sending}
          />

          <div className="my-3 border-t border-white/5" />

          <MonthlyReportView
            report={currentMonthReport}
            title={`${currentMonthReport.monthLabel} (Month-to-Date)`}
            onSend={() => sendReportToTelegram(currentMonthReport)}
            sending={sending}
          />
        </>
      )}
    </div>
  );
});

// ---------- Today P&L card per market ----------
interface PLCardProps {
  label: string;
  entry: DailyPLEntry | null;
  field: 'india' | 'usa' | 'crypto';
}
const PLCard = React.memo(function PLCard({ label, entry, field }: PLCardProps) {
  const v = entry?.[field] ?? 0;
  const color = v >= 0 ? 'text-emerald-400' : 'text-red-400';
  const bg = v >= 0 ? 'bg-emerald-500/5 border-emerald-500/15' : 'bg-red-500/5 border-red-500/15';
  return (
    <div className={`rounded-xl p-2.5 border ${bg} text-center`}>
      <div className="text-[9px] text-slate-500 uppercase font-bold tracking-wider mb-1">{label}</div>
      <div className={`text-sm font-black font-mono ${color}`}>
        {entry ? fmtINR(v) : '—'}
      </div>
    </div>
  );
});

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
    { label: '🇮🇳 India', data: report.india, field: 'india' as const },
    { label: '🇺🇸 USA', data: report.usa, field: 'usa' as const },
    { label: '🪙 Crypto', data: report.crypto, field: 'crypto' as const },
    { label: '📊 TOTAL', data: report.total, field: 'total' as const },
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
          <div className="text-[9px] text-slate-500 mb-2">Trading days: <b className="text-white">{report.tradingDays}</b></div>
          <div className="space-y-1.5">
            {sections.map(s => {
              const color = s.data.total >= 0 ? 'text-emerald-400' : 'text-red-400';
              const bg = s.data.total >= 0 ? 'bg-emerald-500/5' : 'bg-red-500/5';
              return (
                <div key={s.label} className={`rounded-lg p-2 ${bg} border border-white/5`}>
                  <div className="flex items-center justify-between">
                    <span className="text-[11px] font-bold text-white">{s.label}</span>
                    <span className={`text-sm font-mono font-black ${color}`}>{fmt(s.data.total)}</span>
                  </div>
                  <div className="flex items-center justify-between mt-0.5 text-[9px] text-slate-500">
                    <span>🟢 {s.data.profitDays} profit · 🔴 {s.data.lossDays} loss</span>
                    {s.data.bestDay && (
                      <span>Best: <span className="text-emerald-400">{fmt((s.data.bestDay as any)[s.field])}</span></span>
                    )}
                    {s.data.worstDay && (
                      <span>Worst: <span className="text-red-400">{fmt((s.data.worstDay as any)[s.field])}</span></span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
});
