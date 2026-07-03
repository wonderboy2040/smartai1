// ============================================================
// TAX OPTIMIZATION SUITE (India)
// ------------------------------------------------------------
// Scans the portfolio + transaction ledger for opportunities to
// reduce the user's capital-gains tax burden. Covers FY2024-25
// rules (Budget 2024):
//
//   Equity LTCG (>1yr hold):    12.5% on gains > ₹1.25L/yr
//   Equity STCG (<1yr hold):    20% on full gain
//   Debt  LTCG (held any per.): 12.5% on gains (no indexation)
//   Debt  STCG:                  per slab (30% for high income)
//   Crypto gains (30% flat, 1% TDS, no set-off)
//   80C (ELSS): ₹1.5L deduction, 3yr lock-in
//
// Provides 4 opportunity types:
//   1. harvest_loss   — sell loss-making holdings to offset gains
//   2. harvest_ltcg   — sell+rebuy appreciated equity to reset basis
//                       (use the ₹1.25L LTCG exemption each year)
//   3. elss_window    — remaining 80C capacity → suggest ELSS
//   4. withdrawal_order — recommended sell order in retirement
// ============================================================

import { Position, PriceData, Transaction } from '../types';

export type TaxOpportunityType =
  | 'harvest_loss'
  | 'harvest_ltcg'
  | 'elss_window'
  | 'withdrawal_order';

export interface TaxOpportunity {
  type: TaxOpportunityType;
  symbol: string;
  market: 'IN' | 'US';
  action: string;
  estTaxSaving: number;       // INR
  estTaxImpact: number;       // INR (tax to be paid if action taken)
  deadline: string;           // e.g. "March 31, 2025"
  priority: 'high' | 'medium' | 'low';
  detail: string;
  holdingDays: number;
  isLongTerm: boolean;
  currentGain: number;        // INR (unrealised)
  currentLoss: number;        // INR (unrealised, if negative)
}

export interface TaxSummary {
  financialYear: string;
  realizedGains: {
    equityLTCG: number;       // INR
    equitySTCG: number;
    debtLTCG: number;
    debtSTCG: number;
    crypto: number;
  };
  unrealizedGains: {
    equityLTCG: number;
    equitySTCG: number;
    debt: number;
    crypto: number;
  };
  estimatedTaxLiability: number; // INR
  opportunities: TaxOpportunity[];
  elssRemaining80C: number;      // INR still available in 80C
  totalPotentialSaving: number;  // sum of estTaxSaving across opportunities
}

// Constants — FY2024-25 (Budget 2024 rules)
const LTCG_EQUITY_RATE = 0.125;
const STCG_EQUITY_RATE = 0.20;
const LTCG_EQUITY_EXEMPTION = 125000;     // ₹1.25L per FY
const DEBT_LTCG_RATE = 0.125;
const DEBT_STCG_RATE = 0.30;              // assume high-slab
const CRYPTO_RATE = 0.30;
const SEC_80C_LIMIT = 150000;             // ₹1.5L
const LONG_TERM_EQUITY_DAYS = 365;
const LONG_TERM_DEBT_DAYS = 730;          // 24mo (post-Budget 2024)

function getFinancialYear(): string {
  const now = new Date();
  const yr = now.getMonth() >= 3 ? now.getFullYear() + 1 : now.getFullYear();
  return `FY${yr - 1}-${String(yr).slice(-2)}`;
}

function getMarch31Deadline(): string {
  const now = new Date();
  const fyEndYear = now.getMonth() >= 3 ? now.getFullYear() + 1 : now.getFullYear();
  return `March 31, ${fyEndYear}`;
}

function isCrypto(sym: string): boolean {
  const s = sym.toUpperCase();
  return ['BTC', 'ETH', 'SOL', 'BNB', 'XRP', 'DOGE', 'ADA', 'AVAX', 'DOT', 'MATIC', 'LINK', 'UNI'].includes(s);
}

function holdingDays(dateAdded: string): number {
  if (!dateAdded) return 0;
  const t = new Date(dateAdded).getTime();
  if (!Number.isFinite(t)) return 0;
  return Math.max(0, Math.round((Date.now() - t) / (24 * 60 * 60 * 1000)));
}

// Compute realised gains for the current FY from the transaction ledger.
function computeRealizedGains(transactions: Transaction[]): TaxSummary['realizedGains'] {
  const fy = getFinancialYear();
  const fyStart = fy.startsWith('FY')
    ? new Date(`04-01-${parseInt(fy.slice(2, 4)) + 2000}`)
    : new Date();
  const fyStartTs = fyStart.getTime();

  const out = { equityLTCG: 0, equitySTCG: 0, debtLTCG: 0, debtSTCG: 0, crypto: 0 };

  for (const t of transactions) {
    if (t.type !== 'sell') continue;
    if (t.ts < fyStartTs) continue;
    if (t.realizedPL == null) continue;
    const gain = t.realizedPL;
    const days = holdingDays(t.date);

    if (isCrypto(t.symbol)) {
      out.crypto += gain;
    } else if (t.market === 'IN') {
      // Treat as equity (most NSE stocks/ETFs); debt needs explicit tagging.
      // Conservative: assume ETFs like NIFTYBEES / JUNIORBEES = equity; if user
      // holds liquid funds (e.g. LIQUIDBEES) treat as debt — heuristic.
      const isDebt = /LIQUIDBEES|GILT|BOND/i.test(t.symbol);
      if (isDebt) {
        if (days >= LONG_TERM_DEBT_DAYS) out.debtLTCG += gain;
        else out.debtSTCG += gain;
      } else {
        if (days >= LONG_TERM_EQUITY_DAYS) out.equityLTCG += gain;
        else out.equitySTCG += gain;
      }
    } else {
      // US stocks — for Indian tax, treat as equity (LTCG >24mo @12.5% w/ indexation removed)
      if (days >= 730) out.equityLTCG += gain;
      else out.equitySTCG += gain;
    }
  }
  return out;
}

// Compute unrealised gains per holding (current price − avg price) × qty.
function computeUnrealizedGains(
  portfolio: Position[],
  livePrices: Record<string, PriceData>,
  usdInrRate: number
): TaxSummary['unrealizedGains'] & { perHolding: Array<{ position: Position; gainINR: number; days: number; isLongTerm: boolean; isDebt: boolean; isCryptoAsset: boolean }> } {
  const totals = { equityLTCG: 0, equitySTCG: 0, debt: 0, crypto: 0 };
  const perHolding: Array<{ position: Position; gainINR: number; days: number; isLongTerm: boolean; isDebt: boolean; isCryptoAsset: boolean }> = [];

  for (const p of portfolio) {
    const key = `${String(p.market || 'IN').toUpperCase()}_${p.symbol}`;
    const data = livePrices[key];
    const price = data?.price ?? p.avgPrice;
    const gainNative = (price - p.avgPrice) * p.qty;
    const gainINR = p.market === 'IN' ? gainNative : gainNative * usdInrRate;
    const days = holdingDays(p.dateAdded);
    const isDebt = /LIQUIDBEES|GILT|BOND/i.test(p.symbol);
    const isCryptoAsset = isCrypto(p.symbol);

    let isLongTerm = false;
    if (isCryptoAsset) {
      // No LT/ST distinction post-Budget 2022 — flat 30% always.
    } else if (isDebt) {
      isLongTerm = days >= LONG_TERM_DEBT_DAYS;
    } else {
      isLongTerm = days >= LONG_TERM_EQUITY_DAYS;
    }

    perHolding.push({ position: p, gainINR, days, isLongTerm, isDebt, isCryptoAsset });

    if (isCryptoAsset) totals.crypto += gainINR;
    else if (isDebt) totals.debt += gainINR;
    else if (isLongTerm) totals.equityLTCG += gainINR;
    else totals.equitySTCG += gainINR;
  }

  return { ...totals, perHolding };
}

/**
 * Scan portfolio + transactions for tax-saving opportunities.
 */
export function scanTaxOpportunities(
  portfolio: Position[],
  transactions: Transaction[],
  livePrices: Record<string, PriceData>,
  usdInrRate: number,
  options: { elssInvestedThisYear?: number } = {}
): TaxSummary {
  const realized = computeRealizedGains(transactions);
  const unreal = computeUnrealizedGains(portfolio, livePrices, usdInrRate);
  const opportunities: TaxOpportunity[] = [];
  const deadline = getMarch31Deadline();

  // ----- 1. TAX-LOSS HARVESTING -----
  // Sell holdings with unrealised LOSS to offset realised gains this FY.
  const realizedCryptoGains = realized.crypto;

  for (const h of unreal.perHolding) {
    if (h.gainINR >= 0) continue;
    const lossAmount = Math.abs(h.gainINR);

    // Loss can offset same-category gains (equity loss → equity gain).
    // Crypto losses can NOT offset non-crypto gains (post-Budget 2022).
    let offsettableGains = 0;
    if (h.isCryptoAsset) {
      offsettableGains = Math.max(0, realizedCryptoGains);
    } else if (h.isDebt) {
      offsettableGains = Math.max(0, realized.debtLTCG + realized.debtSTCG);
    } else {
      offsettableGains = Math.max(0, realized.equityLTCG + realized.equitySTCG);
    }

    if (offsettableGains <= 0) continue;

    // Effective tax saving = min(loss, offsettable gains) × applicable rate
    const offsetable = Math.min(lossAmount, offsettableGains);
    const rate = h.isCryptoAsset ? CRYPTO_RATE
      : (h.isLongTerm ? LTCG_EQUITY_RATE : STCG_EQUITY_RATE);
    const taxSaving = offsetable * rate;

    if (taxSaving > 500) {  // skip tiny opportunities
      opportunities.push({
        type: 'harvest_loss',
        symbol: h.position.symbol,
        market: h.position.market,
        action: `Sell ${h.position.symbol} (loss ₹${Math.round(lossAmount).toLocaleString('en-IN')}) to offset realized gains`,
        estTaxSaving: Math.round(taxSaving),
        estTaxImpact: 0,
        deadline,
        priority: taxSaving > 5000 ? 'high' : taxSaving > 1000 ? 'medium' : 'low',
        detail: `Unrealised loss ₹${Math.round(lossAmount).toLocaleString('en-IN')} can offset ₹${Math.round(offsetable).toLocaleString('en-IN')} of realized gains → saves ₹${Math.round(taxSaving).toLocaleString('en-IN')} tax. Rebuy after 24h to avoid wash-sale (India has no wash-sale rule, but maintain audit trail).`,
        holdingDays: h.days,
        isLongTerm: h.isLongTerm,
        currentGain: 0,
        currentLoss: lossAmount,
      });
    }
  }

  // ----- 2. LTCG HARVESTING (use ₹1.25L exemption) -----
  // If unrealised equity LTCG > ₹1.25L, sell+rebuy to reset basis using
  // the annual exemption. Effectively "free" ₹1.25L × 12.5% = ₹15,625/yr saving.
  const ltcgExemptionUsed = Math.max(0, Math.min(LTCG_EQUITY_EXEMPTION, realized.equityLTCG));
  const ltcgExemptionRemaining = LTCG_EQUITY_EXEMPTION - ltcgExemptionUsed;

  if (ltcgExemptionRemaining > 0) {
    // Find holdings with unrealised LTCG that we can harvest.
    const ltcgHoldings = unreal.perHolding
      .filter(h => !h.isCryptoAsset && !h.isDebt && h.isLongTerm && h.gainINR > 0)
      .sort((a, b) => b.gainINR - a.gainINR);

    let remainingExemption = ltcgExemptionRemaining;
    for (const h of ltcgHoldings) {
      if (remainingExemption <= 0) break;
      const harvestable = Math.min(h.gainINR, remainingExemption);
      const taxSaving = harvestable * LTCG_EQUITY_RATE;  // 12.5% on exempted portion
      if (taxSaving > 500) {
        opportunities.push({
          type: 'harvest_ltcg',
          symbol: h.position.symbol,
          market: h.position.market,
          action: `Sell+rebuy ${h.position.symbol} (harvest ₹${Math.round(harvestable).toLocaleString('en-IN')} LTCG using annual exemption)`,
          estTaxSaving: Math.round(taxSaving),
          estTaxImpact: 0,  // no tax because exemption
          deadline,
          priority: 'high',
          detail: `Harvest ₹${Math.round(harvestable).toLocaleString('en-IN')} of LTCG using the ₹1.25L/yr equity LTCG exemption. Sell+rebuy resets cost basis → future gains taxed from new (higher) basis. ₹${Math.round(taxSaving).toLocaleString('en-IN')} tax saved.`,
          holdingDays: h.days,
          isLongTerm: true,
          currentGain: h.gainINR,
          currentLoss: 0,
        });
        remainingExemption -= harvestable;
      }
    }
  }

  // ----- 3. ELSS 80C WINDOW -----
  const elssInvested = options.elssInvestedThisYear || 0;
  const elssRemaining = Math.max(0, SEC_80C_LIMIT - elssInvested);
  if (elssRemaining > 5000) {
    const taxSaving = elssRemaining * 0.30;  // assume 30% slab
    opportunities.push({
      type: 'elss_window',
      symbol: 'ELSS',
      market: 'IN',
      action: `Invest ₹${Math.round(elssRemaining).toLocaleString('en-IN')} in ELSS fund (80C deduction)`,
      estTaxSaving: Math.round(taxSaving),
      estTaxImpact: 0,
      deadline,
      priority: 'high',
      detail: `₹${Math.round(elssRemaining).toLocaleString('en-IN')} of 80C capacity remaining. Invest in ELSS (tax-saving MF) → 3yr lock-in (shortest among 80C options) → saves ₹${Math.round(taxSaving).toLocaleString('en-IN')} tax at 30% slab. ELSS also has equity upside.`,
      holdingDays: 0,
      isLongTerm: true,  // 3yr lock-in is LT by definition
      currentGain: 0,
      currentLoss: 0,
    });
  }

  // ----- 4. WITHDRAWAL ORDER (retirement) -----
  // When in withdrawal phase, sell debt first, equity last (let equity
  // compound tax-free longer). Only show if user has both equity + debt.
  const hasEquity = unreal.perHolding.some(h => !h.isDebt && !h.isCryptoAsset);
  const hasDebt = unreal.perHolding.some(h => h.isDebt);
  if (hasEquity && hasDebt) {
    opportunities.push({
      type: 'withdrawal_order',
      symbol: 'PORTFOLIO',
      market: 'IN',
      action: 'Withdrawal order: Debt → Equity (let equity compound tax-free)',
      estTaxSaving: 0,  // informational
      estTaxImpact: 0,
      deadline: 'Ongoing',
      priority: 'medium',
      detail: 'In retirement, sell debt holdings first (LTCG 12.5% w/o indexation) and let equity compound tax-free (LTCG exemption ₹1.25L/yr + 12.5% above). Equity also has higher expected returns.',
      holdingDays: 0,
      isLongTerm: true,
      currentGain: 0,
      currentLoss: 0,
    });
  }

  // ----- Estimated Tax Liability -----
  const equityLTCGTaxable = Math.max(0, realized.equityLTCG - LTCG_EQUITY_EXEMPTION);
  const taxLiability =
    equityLTCGTaxable * LTCG_EQUITY_RATE +
    realized.equitySTCG * STCG_EQUITY_RATE +
    realized.debtLTCG * DEBT_LTCG_RATE +
    realized.debtSTCG * DEBT_STCG_RATE +
    Math.max(0, realized.crypto) * CRYPTO_RATE;

  const totalPotentialSaving = opportunities.reduce((s, o) => s + o.estTaxSaving, 0);

  return {
    financialYear: getFinancialYear(),
    realizedGains: realized,
    unrealizedGains: { equityLTCG: unreal.equityLTCG, equitySTCG: unreal.equitySTCG, debt: unreal.debt, crypto: unreal.crypto },
    estimatedTaxLiability: Math.round(taxLiability),
    opportunities: opportunities.sort((a, b) => {
      const pOrder = { high: 0, medium: 1, low: 2 };
      if (pOrder[a.priority] !== pOrder[b.priority]) return pOrder[a.priority] - pOrder[b.priority];
      return b.estTaxSaving - a.estTaxSaving;
    }),
    elssRemaining80C: elssRemaining,
    totalPotentialSaving: Math.round(totalPotentialSaving),
  };
}

// ---------- Format for Telegram ----------
export function formatTaxSummaryForTelegram(s: TaxSummary): string {
  const fmt = (n: number) => `₹${Math.round(n).toLocaleString('en-IN')}`;
  let msg = `💰 <b>TAX OPTIMIZATION SUITE</b> — ${s.financialYear}\n`;
  msg += `<code>━━━━━━━━━━━━━━━━━━━━━━━</code>\n\n`;

  msg += `<b>📊 Realized Gains (FYTD):</b>\n`;
  msg += `• Equity LTCG: ${fmt(s.realizedGains.equityLTCG)}\n`;
  msg += `• Equity STCG: ${fmt(s.realizedGains.equitySTCG)}\n`;
  msg += `• Debt LTCG: ${fmt(s.realizedGains.debtLTCG)}\n`;
  msg += `• Debt STCG: ${fmt(s.realizedGains.debtSTCG)}\n`;
  msg += `• Crypto: ${fmt(s.realizedGains.crypto)}\n\n`;

  msg += `<b>💼 Unrealized Gains:</b>\n`;
  msg += `• Equity LTCG: ${fmt(s.unrealizedGains.equityLTCG)}\n`;
  msg += `• Equity STCG: ${fmt(s.unrealizedGains.equitySTCG)}\n`;
  msg += `• Debt: ${fmt(s.unrealizedGains.debt)}\n`;
  msg += `• Crypto: ${fmt(s.unrealizedGains.crypto)}\n\n`;

  msg += `<b>🧾 Estimated Tax Liability: ${fmt(s.estimatedTaxLiability)}</b>\n`;
  msg += `<b>💡 Total Potential Saving: ${fmt(s.totalPotentialSaving)}</b>\n\n`;

  if (s.opportunities.length === 0) {
    msg += `<i>No tax-saving opportunities detected. Portfolio is tax-efficient.</i>`;
  } else {
    msg += `<b>🎯 Opportunities (${s.opportunities.length}):</b>\n\n`;
    for (const o of s.opportunities.slice(0, 5)) {
      const emoji = o.priority === 'high' ? '🔴' : o.priority === 'medium' ? '🟡' : '🟢';
      msg += `${emoji} <b>${o.action}</b>\n`;
      msg += `   Saving: ${fmt(o.estTaxSaving)} · Deadline: ${o.deadline}\n`;
      msg += `   <i>${o.detail.substring(0, 150)}${o.detail.length > 150 ? '...' : ''}</i>\n\n`;
    }
  }
  return msg;
}
