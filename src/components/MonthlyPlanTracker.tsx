import React, { useMemo, useState, useCallback } from 'react';
import { useApp } from '../hooks/AppContext';
import {
  computeMonthlyPlan, formatMonthlyPlanForTelegram,
  type MarketPlanRow,
} from '../utils/monthlyPlanTracker';
import { secureStorage } from '../utils/secureStorage';
import { sendTelegramAlert } from '../utils/api';
import { resetPortfolioSnapshot } from '../utils/portfolioDiffEngine';

// ============================================================
// MONTHLY PLAN TRACKER (Portfolio tab)
// Planned vs Actual investment per market bucket for the
// current calendar month.
// ============================================================

const fmtINR = (n: number) => {
  const a = Math.abs(n);
  if (a >= 10000000) return `₹${(n / 10000000).toFixed(2)} Cr`;
  if (a >= 100000) return `₹${(n / 100000).toFixed(2)} L`;
  return `₹${Math.round(n).toLocaleString('en-IN')}`;
};

export const MonthlyPlanTracker = React.memo(function MonthlyPlanTracker() {
  const {
    portfolio, livePrices, usdInrRate, transactions,
    indiaSIP, usSIP, btcSIP, ethSIP,
  } = useApp();
  const [sending, setSending] = useState(false);
  const [showSymbols, setShowSymbols] = useState<Record<string, boolean>>({});
  const [usFrequency, setUsFrequency] = useState<'monthly' | 'quarterly'>(() => {
    try {
      const s = secureStorage.getItem('plan_tracker_us_freq');
      return s === 'quarterly' ? 'quarterly' : 'monthly';
    } catch { return 'monthly'; }
  });

  const plan = useMemo(() =>
    computeMonthlyPlan(
      { indiaSIP, usSIP, btcSIP, ethSIP, usFrequency },
      transactions, portfolio, livePrices, usdInrRate
    ),
    [indiaSIP, usSIP, btcSIP, ethSIP, usFrequency, transactions, portfolio, livePrices, usdInrRate]
  );

  const sendToTelegram = useCallback(async () => {
    setSending(true);
    try {
      const token = await secureStorage.getItemAsync('TG_TOKEN');
      const chatId = await secureStorage.getItemAsync('TG_CHAT_ID');
      const msg = formatMonthlyPlanForTelegram(plan);
      const ok = await sendTelegramAlert(token || '', chatId || '', msg);
      alert(ok ? '✅ Plan sent to Telegram!' : '⚠️ Send failed — Telegram not configured.');
    } finally {
      setSending(false);
    }
  }, [plan]);

  const toggleFreq = () => {
    const next = usFrequency === 'monthly' ? 'quarterly' : 'monthly';
    setUsFrequency(next);
    try { secureStorage.setItem('plan_tracker_us_freq', next); } catch { /* noop */ }
  };

  const resetMemory = () => {
    if (!confirm('Reset portfolio memory? Next sync will treat all holdings as fresh buys (will flood transactions). Only do this if you migrated data or want to start clean.')) return;
    resetPortfolioSnapshot();
    alert('✅ Memory reset. Reload the page to re-snapshot.');
  };

  return (
    <div className="quantum-panel rounded-2xl p-4 animate-fade-in-up">
      {/* Header */}
      <div className="flex items-center justify-between mb-2">
        <div>
          <h3 className="text-base font-black text-white flex items-center gap-2">
            🎯 Monthly Plan Tracker
            <span className="text-[8px] bg-cyan-500/20 text-cyan-300 px-1.5 py-0.5 rounded-md border border-cyan-500/20 font-bold tracking-wider">{plan.monthLabel}</span>
          </h3>
          <p className="text-[11px] text-slate-500 mt-0.5">
            Planned vs actual investment — planner SIP ke hisaab se.
          </p>
        </div>
        <div className="flex items-center gap-1">
          <button
            onClick={resetMemory}
            className="px-2 py-1 bg-white/5 border border-white/10 rounded text-[9px] font-bold text-slate-400 hover:text-red-400"
            title="Reset portfolio memory"
          >
            🧠 Reset
          </button>
          <button
            onClick={sendToTelegram}
            disabled={sending}
            className="px-2 py-1 bg-cyan-500/10 border border-cyan-500/30 rounded text-[9px] font-bold text-cyan-400 hover:bg-cyan-500/20 disabled:opacity-50"
          >
            {sending ? '⏳' : '📤 TG'}
          </button>
        </div>
      </div>

      {/* Total progress strip */}
      <div className="mb-4 p-3 bg-black/30 border border-white/5 rounded-xl">
        <div className="flex items-center justify-between mb-1.5">
          <span className="text-[10px] text-slate-400 font-bold uppercase tracking-wider">Total Month Progress</span>
          <span className="text-[10px] font-mono">
            <span className="text-cyan-400 font-bold">{fmtINR(plan.totals.actualAmountINR)}</span>
            <span className="text-slate-600"> / </span>
            <span className="text-white">{fmtINR(plan.totals.plannedAmountINR)}</span>
          </span>
        </div>
        <div className="w-full bg-slate-800/60 rounded-full h-2.5 overflow-hidden">
          <div
            className={`h-full rounded-full transition-all ${
              plan.totals.progressPct >= 100
                ? 'bg-gradient-to-r from-emerald-500 to-teal-400'
                : plan.totals.progressPct > 50
                ? 'bg-gradient-to-r from-cyan-500 to-indigo-500'
                : 'bg-gradient-to-r from-amber-500 to-orange-400'
            }`}
            style={{ width: `${Math.min(100, plan.totals.progressPct)}%` }}
          />
        </div>
        <div className="flex justify-between mt-1">
          <span className="text-[9px] text-slate-500">{plan.totals.progressPct.toFixed(0)}% of plan deployed</span>
          <span className="text-[9px] text-amber-400">Remaining: {fmtINR(plan.totals.remainingAmountINR)}</span>
        </div>
      </div>

      {/* Per-market rows */}
      <div className="space-y-2">
        {plan.rows.map((row) => (
          <MarketRow
            key={row.bucket}
            row={row}
            expanded={!!showSymbols[row.bucket]}
            onToggle={() => setShowSymbols(prev => ({ ...prev, [row.bucket]: !prev[row.bucket] }))}
            usFrequency={usFrequency}
            onToggleFreq={toggleFreq}
          />
        ))}
      </div>

      <div className="text-[8px] text-slate-700 mt-3 leading-tight">
        💡 Auto-tracks every portfolio change from Google Sheets. When you add a buy in sheets, it appears here automatically.
        Click 🇺🇸 row's "Monthly/Quarterly" badge to toggle USA frequency.
      </div>
    </div>
  );
});

interface MarketRowProps {
  row: MarketPlanRow;
  expanded: boolean;
  onToggle: () => void;
  usFrequency: 'monthly' | 'quarterly';
  onToggleFreq: () => void;
}

const MarketRow = React.memo(function MarketRow({ row, expanded, onToggle, usFrequency, onToggleFreq }: MarketRowProps) {
  const progressColor = row.progressPct >= 100
    ? 'from-emerald-500 to-teal-400'
    : row.progressPct > 50
    ? 'from-cyan-500 to-indigo-500'
    : row.progressPct > 0
    ? 'from-amber-500 to-orange-400'
    : 'from-slate-600 to-slate-500';

  return (
    <div className="bg-black/20 border border-white/5 rounded-xl overflow-hidden">
      <button
        onClick={onToggle}
        className="w-full p-2.5 flex items-center justify-between hover:bg-white/[0.02] transition-colors text-left"
      >
        <div className="flex items-center gap-2">
          <span className="text-base">{row.emoji}</span>
          <div>
            <div className="text-[12px] font-bold text-white flex items-center gap-1.5">
              {row.label}
              {row.bucket === 'usa' && (
                <span
                  onClick={(e) => { e.stopPropagation(); onToggleFreq(); }}
                  className="text-[8px] bg-blue-500/10 text-blue-300 px-1 py-0.5 rounded border border-blue-500/20 cursor-pointer hover:bg-blue-500/20"
                  title="Click to toggle monthly/quarterly"
                >
                  {usFrequency === 'monthly' ? 'Monthly' : 'Quarterly'}
                </span>
              )}
            </div>
            <div className="text-[9px] text-slate-500">{row.nextBuyNote}</div>
          </div>
        </div>
        <div className="text-right">
          <div className="text-[11px] font-mono">
            <span className="text-cyan-400 font-bold">{fmtINR(row.actualAmountINR)}</span>
            <span className="text-slate-600"> / </span>
            <span className="text-white">{fmtINR(row.plannedAmountINR)}</span>
          </div>
          <div className="text-[9px] text-slate-500">
            {row.actualQty.toFixed(2)} / {row.plannedQty.toFixed(2)} qty
          </div>
        </div>
      </button>

      {/* Progress bar */}
      <div className="px-2.5 pb-1">
        <div className="w-full bg-slate-800/60 rounded-full h-1.5 overflow-hidden">
          <div
            className={`h-full rounded-full bg-gradient-to-r ${progressColor} transition-all`}
            style={{ width: `${Math.min(100, row.progressPct)}%` }}
          />
        </div>
        <div className="flex justify-between mt-0.5">
          <span className="text-[8px] text-slate-500">{row.progressPct.toFixed(0)}%</span>
          <span className="text-[8px] text-amber-400">Remaining: {fmtINR(row.remainingAmountINR)}</span>
        </div>
      </div>

      {/* Expanded: per-symbol breakdown */}
      {expanded && row.symbols.length > 0 && (
        <div className="border-t border-white/5 p-2.5 bg-black/30">
          <div className="text-[9px] text-slate-500 uppercase font-bold tracking-wider mb-1.5">Per-Symbol Breakdown</div>
          <div className="space-y-1">
            {row.symbols.map(s => {
              const cur2 = s.market === 'IN' ? '₹' : '$';
              return (
                <div key={s.symbol} className="flex items-center justify-between gap-2 text-[10px]">
                  <div className="flex-1 min-w-0">
                    <div className="font-bold text-white truncate">{s.symbol}</div>
                    <div className="text-[8px] text-slate-500 font-mono">
                      Plan: {s.plannedQty.toFixed(2)} @ {s.livePrice != null ? `${cur2}${s.livePrice.toFixed(2)}` : 'N/A'}
                    </div>
                  </div>
                  <div className="text-right">
                    <div className={`font-mono font-bold ${s.actualQty > 0 ? 'text-emerald-400' : 'text-slate-500'}`}>
                      {s.actualQty.toFixed(2)} {s.actualQty > 0 ? `(${fmtINR(s.actualAmountINR)})` : ''}
                    </div>
                    <div className="text-[8px] text-amber-400">
                      {s.remainingQty > 0 ? `Need: ${s.remainingQty.toFixed(2)}` : '✅ done'}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
      {expanded && row.symbols.length === 0 && (
        <div className="border-t border-white/5 p-2.5 bg-black/30 text-[9px] text-slate-500 text-center">
          No holdings in this market yet — buy something to see planned qty.
        </div>
      )}
    </div>
  );
});
