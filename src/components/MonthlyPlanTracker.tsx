import React, { useMemo, useState, useCallback, useRef, useEffect } from 'react';
import { useApp } from '../hooks/AppContext';
import {
  computeMonthlyPlan, formatMonthlyPlanForTelegram,
  type MarketPlanRow, type MarketBucket,
} from '../utils/monthlyPlanTracker';
import { secureStorage } from '../utils/secureStorage';
import { sendTelegramAlert } from '../utils/api';
import { resetPortfolioSnapshot } from '../utils/portfolioDiffEngine';

// ============================================================
// MONTHLY PLAN TRACKER v2 — Deep Analysis
// Planned vs Actual investment per market bucket with
// overshoot tracking, status badges, donut rings, and more.
// ============================================================

const fmtINR = (n: number) => {
  const a = Math.abs(n);
  if (a >= 10000000) return `₹${(n / 10000000).toFixed(2)} Cr`;
  if (a >= 100000) return `₹${(n / 100000).toFixed(2)} L`;
  return `₹${Math.round(n).toLocaleString('en-IN')}`;
};

function getDaysLeftInMonth(): number {
  const now = new Date();
  const lastDay = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
  return lastDay - now.getDate();
}

function getStatusBadge(progressPct: number, plannedAmount: number): { label: string; emoji: string; color: string; bg: string; border: string } {
  if (plannedAmount <= 0) return { label: 'No Plan', emoji: '➖', color: 'text-slate-400', bg: 'bg-slate-500/10', border: 'border-slate-500/20' };
  if (progressPct <= 0) return { label: 'Not Started', emoji: '⏳', color: 'text-slate-400', bg: 'bg-slate-500/10', border: 'border-slate-500/20' };
  if (progressPct >= 120) return { label: 'Overshot', emoji: '🔥', color: 'text-orange-400', bg: 'bg-orange-500/10', border: 'border-orange-500/20' };
  if (progressPct >= 100) return { label: 'Complete', emoji: '✅', color: 'text-emerald-400', bg: 'bg-emerald-500/10', border: 'border-emerald-500/20' };
  if (progressPct >= 50) return { label: 'On Track', emoji: '🔄', color: 'text-cyan-400', bg: 'bg-cyan-500/10', border: 'border-cyan-500/20' };
  return { label: 'Pending', emoji: '⚠️', color: 'text-amber-400', bg: 'bg-amber-500/10', border: 'border-amber-500/20' };
}

// Mini donut ring SVG
function DonutRing({ pct, size = 44, color }: { pct: number; size?: number; color: string }) {
  const r = (size - 6) / 2;
  const c = 2 * Math.PI * r;
  const fill = Math.min(pct, 150); // cap visual at 150%
  const offset = c - (fill / 100) * c;
  return (
    <svg width={size} height={size} className="flex-shrink-0">
      <circle cx={size/2} cy={size/2} r={r} fill="none" stroke="rgba(255,255,255,0.05)" strokeWidth="4" />
      <circle
        cx={size/2} cy={size/2} r={r} fill="none"
        stroke={color}
        strokeWidth="4"
        strokeLinecap="round"
        strokeDasharray={c}
        strokeDashoffset={offset}
        transform={`rotate(-90 ${size/2} ${size/2})`}
        className="transition-all duration-700"
      />
      <text x={size/2} y={size/2} textAnchor="middle" dominantBaseline="central"
        className="text-[9px] font-bold font-mono" fill="currentColor"
      >
        {pct > 0 ? `${Math.round(pct)}%` : '—'}
      </text>
    </svg>
  );
}

export const MonthlyPlanTracker = React.memo(function MonthlyPlanTracker() {
  const {
    portfolio, livePrices, usdInrRate, transactions,
    indiaSIP, setIndiaSIP, usSIP, setUsSIP, btcSIP, setBtcSIP, ethSIP, setEthSIP,
    usFrequency, setUsFrequency, stateSyncStatus,
  } = useApp();
  const [sending, setSending] = useState(false);
  const [showSymbols, setShowSymbols] = useState<Record<string, boolean>>({});
  const [editingBucket, setEditingBucket] = useState<MarketBucket | null>(null);
  const [editValue, setEditValue] = useState('');
  // For crypto, we need separate BTC and ETH editing
  const [editBtcValue, setEditBtcValue] = useState('');
  const [editEthValue, setEditEthValue] = useState('');

  // 2026 perf audit (M1): snapshot-key — recomputes only when a price it
  // reads actually changes (not when livePrices identity changes per flush).
  const planPriceKey = useMemo(() =>
    portfolio.map(p => (livePrices[`${p.market}_${p.symbol}`]?.price ?? 0).toFixed(2)).join('|') + `@${usdInrRate.toFixed(2)}`,
    [portfolio, livePrices, usdInrRate]);
  const plan = useMemo(() =>
    computeMonthlyPlan(
      { indiaSIP, usSIP, btcSIP, ethSIP, usFrequency },
      transactions, portfolio, livePrices, usdInrRate
    ),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [indiaSIP, usSIP, btcSIP, ethSIP, usFrequency, transactions, portfolio, planPriceKey]
  );

  const daysLeft = useMemo(() => getDaysLeftInMonth(), []);

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
    setUsFrequency(usFrequency === 'monthly' ? 'quarterly' : 'monthly');
  };

  const resetMemory = () => {
    if (!confirm('Reset portfolio memory? Next sync will treat all holdings as fresh buys (will flood transactions). Only do this if you migrated data or want to start clean.')) return;
    resetPortfolioSnapshot();
    alert('✅ Memory reset. Reload the page to re-snapshot.');
  };

  // --- Edit handlers ---
  const startEdit = (bucket: MarketBucket) => {
    setEditingBucket(bucket);
    if (bucket === 'india') setEditValue(indiaSIP.toString());
    else if (bucket === 'usa') setEditValue(usSIP.toString());
    else if (bucket === 'crypto') {
      setEditBtcValue(btcSIP.toString());
      setEditEthValue(ethSIP.toString());
    }
  };

  const saveEdit = () => {
    if (!editingBucket) return;
    if (editingBucket === 'india') {
      const val = parseFloat(editValue);
      if (!isNaN(val) && val >= 0) setIndiaSIP(val);
    } else if (editingBucket === 'usa') {
      const val = parseFloat(editValue);
      if (!isNaN(val) && val >= 0) setUsSIP(val);
    } else if (editingBucket === 'crypto') {
      const btcVal = parseFloat(editBtcValue);
      const ethVal = parseFloat(editEthValue);
      if (!isNaN(btcVal) && btcVal >= 0) setBtcSIP(btcVal);
      if (!isNaN(ethVal) && ethVal >= 0) setEthSIP(ethVal);
    }
    setEditingBucket(null);
  };

  const cancelEdit = () => {
    setEditingBucket(null);
  };

  // Total status
  const totalStatus = getStatusBadge(plan.totals.progressPct, plan.totals.plannedAmountINR);
  const totalOvershoot = plan.totals.actualAmountINR - plan.totals.plannedAmountINR;

  return (
    <div className="quantum-panel rounded-2xl p-4 animate-fade-in-up">
      {/* Header */}
      <div className="flex items-center justify-between mb-2">
        <div>
          <h3 className="text-base font-black text-white flex items-center gap-2">
            🎯 Monthly Plan Tracker
            <span className="text-[8px] bg-cyan-500/20 text-cyan-300 px-1.5 py-0.5 rounded-md border border-cyan-500/20 font-bold tracking-wider">{plan.monthLabel}</span>
            <span className={`text-[8px] ${totalStatus.bg} ${totalStatus.color} px-1.5 py-0.5 rounded-md ${totalStatus.border} border font-bold tracking-wider`}>
              {totalStatus.emoji} {totalStatus.label}
            </span>
          </h3>
          <p className="text-[11px] text-slate-500 mt-0.5">
            Planned vs actual investment — click ✏️ to edit SIP amounts.
          </p>
        </div>
        <div className="flex items-center gap-1">
          {/* Cloud sync status — SIP plan + settings survive cache clears */}
          {stateSyncStatus && (
            <div className="px-2 py-1 bg-cyan-500/10 border border-cyan-500/20 rounded text-[9px] font-bold text-cyan-300" title="Plan settings auto-saved to Google Sheets cloud">
              {stateSyncStatus}
            </div>
          )}
          {/* Days left badge */}
          <div className="px-2 py-1 bg-indigo-500/10 border border-indigo-500/20 rounded text-[9px] font-bold text-indigo-400">
            ⏰ {daysLeft}d left
          </div>
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
        <div className="w-full bg-slate-800/60 rounded-full h-3 overflow-hidden relative">
          <div
            className={`h-full rounded-full transition-all ${
              plan.totals.progressPct >= 120
                ? 'bg-gradient-to-r from-orange-500 to-red-400'
                : plan.totals.progressPct >= 100
                ? 'bg-gradient-to-r from-emerald-500 to-teal-400'
                : plan.totals.progressPct > 50
                ? 'bg-gradient-to-r from-cyan-500 to-indigo-500'
                : 'bg-gradient-to-r from-amber-500 to-orange-400'
            }`}
            style={{ width: `${Math.min(100, plan.totals.progressPct)}%` }}
          />
          {/* 100% marker line */}
          {plan.totals.plannedAmountINR > 0 && (
            <div className="absolute top-0 bottom-0 left-[100%] w-px bg-white/20" style={{ left: `${Math.min(100, 100)}%` }} />
          )}
        </div>
        <div className="flex justify-between mt-1.5">
          <span className="text-[9px] text-slate-500">{plan.totals.progressPct.toFixed(0)}% of plan deployed</span>
          {totalOvershoot > 0 ? (
            <span className="text-[9px] text-orange-400 font-bold">🔥 Over-invested: {fmtINR(totalOvershoot)}</span>
          ) : (
            <span className="text-[9px] text-amber-400">Remaining: {fmtINR(plan.totals.remainingAmountINR)}</span>
          )}
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
            isEditing={editingBucket === row.bucket}
            onStartEdit={() => startEdit(row.bucket)}
            onSaveEdit={saveEdit}
            onCancelEdit={cancelEdit}
            editValue={editValue}
            setEditValue={setEditValue}
            editBtcValue={editBtcValue}
            setEditBtcValue={setEditBtcValue}
            editEthValue={editEthValue}
            setEditEthValue={setEditEthValue}
            btcSIP={btcSIP}
            ethSIP={ethSIP}
          />
        ))}
      </div>

      <div className="text-[8px] text-slate-700 mt-3 leading-tight">
        ☁️ SIP amounts, transactions & alerts auto-save to Google Sheets cloud — browser cache/cookies clear karne par bhi data safe rahega.
        Click ✏️ on any market row to edit SIP amounts inline. Click 🇺🇸 row's "Monthly/Quarterly" badge to toggle USA frequency.
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
  isEditing: boolean;
  onStartEdit: () => void;
  onSaveEdit: () => void;
  onCancelEdit: () => void;
  editValue: string;
  setEditValue: (v: string) => void;
  editBtcValue: string;
  setEditBtcValue: (v: string) => void;
  editEthValue: string;
  setEditEthValue: (v: string) => void;
  btcSIP: number;
  ethSIP: number;
}

const MarketRow = React.memo(function MarketRow({
  row, expanded, onToggle, usFrequency, onToggleFreq,
  isEditing, onStartEdit, onSaveEdit, onCancelEdit,
  editValue, setEditValue,
  editBtcValue, setEditBtcValue, editEthValue, setEditEthValue,
  btcSIP, ethSIP,
}: MarketRowProps) {
  const editInputRef = useRef<HTMLInputElement>(null);
  const btcInputRef = useRef<HTMLInputElement>(null);

  // Auto-focus on edit mode
  useEffect(() => {
    if (isEditing) {
      if (row.bucket === 'crypto') {
        btcInputRef.current?.focus();
      } else {
        editInputRef.current?.focus();
      }
    }
  }, [isEditing, row.bucket]);

  // Status badge for this market
  const status = getStatusBadge(row.progressPct, row.plannedAmountINR);
  const overshoot = row.actualAmountINR - row.plannedAmountINR;
  const isOvershot = overshoot > 0 && row.plannedAmountINR > 0;
  // Allow progressPct to go beyond 100 for display
  const rawProgressPct = row.plannedAmountINR > 0
    ? (row.actualAmountINR / row.plannedAmountINR) * 100
    : 0;

  const donutColor = rawProgressPct >= 120 ? '#f97316' : rawProgressPct >= 100 ? '#34d399' : rawProgressPct > 50 ? '#06b6d4' : rawProgressPct > 0 ? '#f59e0b' : '#475569';

  const progressColor = rawProgressPct >= 120
    ? 'from-orange-500 to-red-400'
    : rawProgressPct >= 100
    ? 'from-emerald-500 to-teal-400'
    : rawProgressPct > 50
    ? 'from-cyan-500 to-indigo-500'
    : rawProgressPct > 0
    ? 'from-amber-500 to-orange-400'
    : 'from-slate-600 to-slate-500';

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') onSaveEdit();
    if (e.key === 'Escape') onCancelEdit();
  };

  return (
    <div className="bg-black/20 border border-white/5 rounded-xl overflow-hidden">
      {/* Header row */}
      <div className="flex items-center justify-between p-2.5">
        <button
          onClick={onToggle}
          className="flex-1 flex items-center gap-2.5 hover:bg-white/[0.02] transition-colors text-left"
        >
          {/* Donut ring */}
          <DonutRing pct={rawProgressPct} color={donutColor} />
          <div className="flex-1">
            <div className="text-[12px] font-bold text-white flex items-center gap-1.5 flex-wrap">
              <span className="text-base mr-0.5">{row.emoji}</span>
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
              {/* Status badge */}
              <span className={`text-[8px] ${status.bg} ${status.color} px-1 py-0.5 rounded ${status.border} border font-bold`}>
                {status.emoji} {status.label}
              </span>
            </div>
            <div className="text-[9px] text-slate-500">{row.nextBuyNote}</div>
          </div>
        </button>
        <div className="flex items-center gap-2">
          <div className="text-right">
            <div className="text-[11px] font-mono">
              <span className="text-cyan-400 font-bold">{fmtINR(row.actualAmountINR)}</span>
              <span className="text-slate-600"> / </span>
              <span className="text-white">{fmtINR(row.plannedAmountINR)}</span>
            </div>
            {isOvershot ? (
              <div className="text-[9px] text-orange-400 font-bold font-mono">
                🔥 +{fmtINR(overshoot)} over
              </div>
            ) : (
              <div className="text-[9px] text-slate-500">
                {row.actualQty.toFixed(2)} / {row.plannedQty.toFixed(2)} qty
              </div>
            )}
          </div>
          {/* Edit button */}
          <button
            onClick={(e) => { e.stopPropagation(); onStartEdit(); }}
            className="w-6 h-6 rounded-md bg-white/5 hover:bg-cyan-500/20 border border-white/10 hover:border-cyan-500/30 flex items-center justify-center transition-all text-[10px] text-slate-400 hover:text-cyan-400"
            title={`Edit ${row.label} SIP amount`}
          >
            ✏️
          </button>
        </div>
      </div>

      {/* Inline Edit Panel */}
      {isEditing && (
        <div className="px-2.5 pb-2.5 animate-fade-in">
          <div className="p-3 bg-cyan-500/5 border border-cyan-500/20 rounded-lg">
            <div className="text-[9px] text-cyan-400 font-bold uppercase tracking-wider mb-2">
              ✏️ Edit {row.label} SIP Amount
            </div>
            {row.bucket === 'crypto' ? (
              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <span className="text-[10px] text-orange-400 font-bold w-10">₿ BTC</span>
                  <div className="flex items-center gap-1 flex-1 bg-black/30 border border-white/10 rounded-lg px-2 py-1.5">
                    <span className="text-[10px] text-slate-500">₹</span>
                    <input
                      ref={btcInputRef}
                      type="number"
                      value={editBtcValue}
                      onChange={e => setEditBtcValue(e.target.value)}
                      onKeyDown={handleKeyDown}
                      className="flex-1 bg-transparent outline-none text-sm font-bold text-white font-mono w-full min-w-0"
                      min="0"
                      step="100"
                    />
                  </div>
                  <span className="text-[8px] text-slate-600">was ₹{btcSIP.toLocaleString('en-IN')}</span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-[10px] text-indigo-400 font-bold w-10">🪙 ETH</span>
                  <div className="flex items-center gap-1 flex-1 bg-black/30 border border-white/10 rounded-lg px-2 py-1.5">
                    <span className="text-[10px] text-slate-500">₹</span>
                    <input
                      type="number"
                      value={editEthValue}
                      onChange={e => setEditEthValue(e.target.value)}
                      onKeyDown={handleKeyDown}
                      className="flex-1 bg-transparent outline-none text-sm font-bold text-white font-mono w-full min-w-0"
                      min="0"
                      step="100"
                    />
                  </div>
                  <span className="text-[8px] text-slate-600">was ₹{ethSIP.toLocaleString('en-IN')}</span>
                </div>
              </div>
            ) : (
              <div className="flex items-center gap-2">
                <div className="flex items-center gap-1 flex-1 bg-black/30 border border-white/10 rounded-lg px-2 py-1.5">
                  <span className="text-[10px] text-slate-500">₹</span>
                  <input
                    ref={editInputRef}
                    type="number"
                    value={editValue}
                    onChange={e => setEditValue(e.target.value)}
                    onKeyDown={handleKeyDown}
                    className="flex-1 bg-transparent outline-none text-sm font-bold text-white font-mono w-full min-w-0"
                    min="0"
                    step="500"
                  />
                </div>
                <span className="text-[8px] text-slate-600">/month</span>
              </div>
            )}
            <div className="flex items-center gap-2 mt-2">
              <button
                onClick={onSaveEdit}
                className="px-3 py-1.5 bg-emerald-500/15 hover:bg-emerald-500/25 border border-emerald-500/30 rounded-lg text-[10px] font-bold text-emerald-400 transition-all"
              >
                ✅ Save
              </button>
              <button
                onClick={onCancelEdit}
                className="px-3 py-1.5 bg-white/5 hover:bg-white/10 border border-white/10 rounded-lg text-[10px] font-bold text-slate-400 transition-all"
              >
                ✕ Cancel
              </button>
              <span className="text-[8px] text-slate-600 ml-auto">Enter = save, Esc = cancel</span>
            </div>
          </div>
        </div>
      )}

      {/* Progress bar */}
      <div className="px-2.5 pb-1">
        <div className="w-full bg-slate-800/60 rounded-full h-1.5 overflow-hidden">
          <div
            className={`h-full rounded-full bg-gradient-to-r ${progressColor} transition-all`}
            style={{ width: `${Math.min(100, rawProgressPct)}%` }}
          />
        </div>
        <div className="flex justify-between mt-0.5">
          <span className="text-[8px] text-slate-500">{rawProgressPct.toFixed(0)}%</span>
          {isOvershot ? (
            <span className="text-[8px] text-orange-400 font-bold">+{fmtINR(overshoot)} over plan</span>
          ) : (
            <span className="text-[8px] text-amber-400">Remaining: {fmtINR(row.remainingAmountINR)}</span>
          )}
        </div>
      </div>

      {/* Expanded: per-symbol breakdown */}
      {expanded && row.symbols.length > 0 && (
        <div className="border-t border-white/5 p-2.5 bg-black/30">
          <div className="text-[9px] text-slate-500 uppercase font-bold tracking-wider mb-1.5">Per-Symbol Breakdown</div>
          <div className="space-y-1.5">
            {row.symbols.map(s => {
              const cur2 = s.market === 'IN' ? '₹' : '$';
              const symbolDone = s.plannedQty > 0 ? (s.actualQty / s.plannedQty) * 100 : 0;
              return (
                <div key={s.symbol} className="flex items-center justify-between gap-2 text-[10px]">
                  <div className="flex-1 min-w-0">
                    <div className="font-bold text-white truncate flex items-center gap-1.5">
                      {s.symbol}
                      {/* Mini progress pill */}
                      <div className="w-12 h-1 bg-slate-800/60 rounded-full overflow-hidden">
                        <div
                          className={`h-full rounded-full ${symbolDone >= 100 ? 'bg-emerald-500' : symbolDone > 0 ? 'bg-cyan-500' : 'bg-slate-600'}`}
                          style={{ width: `${Math.min(100, symbolDone)}%` }}
                        />
                      </div>
                      <span className={`text-[8px] font-mono ${symbolDone >= 100 ? 'text-emerald-400' : 'text-slate-500'}`}>
                        {symbolDone > 0 ? `${symbolDone.toFixed(0)}%` : '—'}
                      </span>
                    </div>
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
