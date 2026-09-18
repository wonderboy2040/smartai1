import React, { useMemo, useState, useCallback } from 'react';
import {
  scanTaxOpportunities, formatTaxSummaryForTelegram,
} from '../utils/taxOptimizer';
import { secureStorage } from '../utils/secureStorage';
import { sendTelegramAlert } from '../utils/api';
import type { Position, Transaction, PriceData } from '../types';

interface Props {
  portfolio: Position[];
  transactions: Transaction[];
  livePrices: Record<string, PriceData>;
  usdInrRate: number;
}

const TYPE_META: Record<string, { label: string; emoji: string; color: string }> = {
  harvest_loss: { label: 'Tax-Loss Harvest', emoji: '🔻', color: 'border-red-500/30 bg-red-500/5' },
  harvest_ltcg: { label: 'LTCG Harvest', emoji: '🌾', color: 'border-emerald-500/30 bg-emerald-500/5' },
  elss_window: { label: 'ELSS 80C', emoji: '🛡️', color: 'border-cyan-500/30 bg-cyan-500/5' },
  withdrawal_order: { label: 'Withdrawal Order', emoji: '📤', color: 'border-blue-500/30 bg-blue-500/5' },
};

const PRIORITY_META: Record<string, { label: string; color: string }> = {
  high: { label: 'HIGH', color: 'text-red-400 bg-red-500/10' },
  medium: { label: 'MED', color: 'text-amber-400 bg-amber-500/10' },
  low: { label: 'LOW', color: 'text-emerald-400 bg-emerald-500/10' },
};

export const TaxOptimizationSuite = React.memo(({ portfolio, transactions, livePrices, usdInrRate }: Props) => {
  const [sending, setSending] = useState(false);
  const [elssInvested, setElssInvested] = useState(0);

  const summary = useMemo(() =>
    scanTaxOpportunities(portfolio, transactions, livePrices, usdInrRate, { elssInvestedThisYear: elssInvested }),
    [portfolio, transactions, livePrices, usdInrRate, elssInvested]
  );

  const fmt = (n: number) => `₹${Math.round(n).toLocaleString('en-IN')}`;

  const sendToTelegram = useCallback(async () => {
    setSending(true);
    try {
      const token = await secureStorage.getItemAsync('TG_TOKEN');
      const chatId = await secureStorage.getItemAsync('TG_CHAT_ID');
      const msg = formatTaxSummaryForTelegram(summary);
      const ok = await sendTelegramAlert(token || '', chatId || '', msg);
      alert(ok ? '✅ Sent to Telegram!' : '⚠️ Send failed — Telegram not configured.');
    } finally {
      setSending(false);
    }
  }, [summary]);

  return (
    <div className="quantum-panel rounded-2xl p-5 animate-fade-in-up">
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <div>
          <div className="text-[10px] text-cyan-500/70 font-bold uppercase tracking-wider">Tax Optimization Suite</div>
          <div className="text-[9px] text-slate-600 mt-0.5">{summary.financialYear} · India rules (Budget 2024)</div>
        </div>
        <button
          onClick={sendToTelegram}
          disabled={sending}
          className="px-3 py-1.5 bg-cyan-500/20 border border-cyan-500/30 rounded-lg text-[10px] font-bold text-cyan-400 hover:bg-cyan-500/30 disabled:opacity-50"
        >
          {sending ? '⏳' : '📤 Send Report'}
        </button>
      </div>

      {/* Headline */}
      <div className="grid grid-cols-2 gap-2 mb-4">
        <div className="bg-red-500/5 border border-red-500/15 rounded-xl p-3 text-center">
          <div className="text-[9px] text-red-400/70 font-bold uppercase tracking-wider mb-1">Est. Tax Liability</div>
          <div className="text-xl font-black text-red-300 font-mono">{fmt(summary.estimatedTaxLiability)}</div>
        </div>
        <div className="bg-emerald-500/5 border border-emerald-500/15 rounded-xl p-3 text-center">
          <div className="text-[9px] text-emerald-400/70 font-bold uppercase tracking-wider mb-1">Potential Saving</div>
          <div className="text-xl font-black text-emerald-300 font-mono">{fmt(summary.totalPotentialSaving)}</div>
        </div>
      </div>

      {/* Realized / Unrealized breakdown */}
      <div className="grid grid-cols-2 gap-2 mb-4">
        <div className="bg-black/30 border border-white/5 rounded-xl p-3">
          <div className="text-[9px] text-slate-500 uppercase font-bold tracking-wider mb-1.5">Realized Gains (FYTD)</div>
          <div className="space-y-0.5 text-[10px]">
            <div className="flex justify-between"><span className="text-slate-400">Equity LTCG:</span><span className="text-white font-mono">{fmt(summary.realizedGains.equityLTCG)}</span></div>
            <div className="flex justify-between"><span className="text-slate-400">Equity STCG:</span><span className="text-white font-mono">{fmt(summary.realizedGains.equitySTCG)}</span></div>
            <div className="flex justify-between"><span className="text-slate-400">Debt LTCG:</span><span className="text-white font-mono">{fmt(summary.realizedGains.debtLTCG)}</span></div>
            <div className="flex justify-between"><span className="text-slate-400">Debt STCG:</span><span className="text-white font-mono">{fmt(summary.realizedGains.debtSTCG)}</span></div>
            <div className="flex justify-between"><span className="text-slate-400">Crypto:</span><span className="text-white font-mono">{fmt(summary.realizedGains.crypto)}</span></div>
          </div>
        </div>
        <div className="bg-black/30 border border-white/5 rounded-xl p-3">
          <div className="text-[9px] text-slate-500 uppercase font-bold tracking-wider mb-1.5">Unrealized Gains</div>
          <div className="space-y-0.5 text-[10px]">
            <div className="flex justify-between"><span className="text-slate-400">Equity LTCG:</span><span className="text-emerald-300 font-mono">{fmt(summary.unrealizedGains.equityLTCG)}</span></div>
            <div className="flex justify-between"><span className="text-slate-400">Equity STCG:</span><span className="text-amber-300 font-mono">{fmt(summary.unrealizedGains.equitySTCG)}</span></div>
            <div className="flex justify-between"><span className="text-slate-400">Debt:</span><span className="text-cyan-300 font-mono">{fmt(summary.unrealizedGains.debt)}</span></div>
            <div className="flex justify-between"><span className="text-slate-400">Crypto:</span><span className="text-purple-300 font-mono">{fmt(summary.unrealizedGains.crypto)}</span></div>
          </div>
        </div>
      </div>

      {/* ELSS input */}
      <div className="mb-4 p-2.5 bg-cyan-500/5 border border-cyan-500/15 rounded-lg">
        <div className="flex items-center justify-between gap-2">
          <div>
            <div className="text-[10px] text-cyan-400 font-bold">🛡️ ELSS 80C Already Invested This Year</div>
            <div className="text-[9px] text-slate-500">Remaining: <span className="text-cyan-300 font-bold">{fmt(summary.elssRemaining80C)}</span> / ₹1.5L</div>
          </div>
          <input
            type="number"
            value={elssInvested}
            onChange={e => setElssInvested(Math.max(0, parseFloat(e.target.value) || 0))}
            className="w-24 bg-black/40 rounded px-2 py-1 text-[11px] font-bold text-white outline-none border border-white/10 text-right"
          />
        </div>
      </div>

      {/* Opportunities list */}
      <div className="mb-2 flex items-center justify-between">
        <div className="text-[10px] text-cyan-400 font-bold uppercase tracking-wider">🎯 Opportunities ({summary.opportunities.length})</div>
      </div>

      {summary.opportunities.length === 0 ? (
        <div className="p-3 bg-emerald-500/5 border border-emerald-500/15 rounded-lg text-[10px] text-emerald-300 text-center">
          ✅ Portfolio is tax-efficient. No harvest opportunities detected.
        </div>
      ) : (
        <div className="space-y-2">
          {summary.opportunities.map((o, i) => {
            const meta = TYPE_META[o.type] || TYPE_META.elss_window;
            const pri = PRIORITY_META[o.priority] || PRIORITY_META.medium;
            return (
              <div key={i} className={`rounded-xl p-3 border ${meta.color}`}>
                <div className="flex items-start justify-between mb-1">
                  <div className="flex items-center gap-2">
                    <span className="text-base">{meta.emoji}</span>
                    <div>
                      <div className="text-[11px] font-bold text-white">{meta.label}</div>
                      <div className="text-[9px] text-slate-400">{o.action}</div>
                    </div>
                  </div>
                  <span className={`text-[8px] font-bold px-1.5 py-0.5 rounded ${pri.color}`}>{pri.label}</span>
                </div>
                <div className="grid grid-cols-2 gap-2 mb-1.5 text-[10px]">
                  <div className="bg-black/20 rounded px-2 py-1">
                    <span className="text-slate-500">Tax Saving: </span>
                    <span className="text-emerald-300 font-bold font-mono">{fmt(o.estTaxSaving)}</span>
                  </div>
                  <div className="bg-black/20 rounded px-2 py-1">
                    <span className="text-slate-500">Deadline: </span>
                    <span className="text-amber-300 font-bold">{o.deadline}</span>
                  </div>
                </div>
                <div className="text-[9px] text-slate-400 leading-snug">{o.detail}</div>
              </div>
            );
          })}
        </div>
      )}

      <div className="text-[8px] text-slate-700 mt-3 leading-tight">
        ⚠️ Educational only — rules per Budget 2024 (LTCG equity 12.5% above ₹1.25L/yr, STCG 20%, debt 12.5% w/o indexation, crypto 30% flat). Consult a CA before acting. Loss offset rules: equity↔equity, debt↔debt; crypto losses cannot offset non-crypto.
      </div>
    </div>
  );
});

TaxOptimizationSuite.displayName = 'TaxOptimizationSuite';
