// ============================================================
// PORTFOLIO ANALYTICS ENGINE
// Builds month-wise investment analytics & return reports from
// the transaction ledger. Pure functions — no side effects.
// ============================================================
import { Transaction, Position, PriceData, MonthlyAnalytics } from '../types';
import { isCryptoSymbol } from './constants';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

// ------------------------------------------------------------
// v10.5 ASSET-CLASS ALLOCATION (Upgrade 3 — INDMoney net-worth)
// ------------------------------------------------------------
/** The allocation buckets the Portfolio tab's Net Worth card shows. */
export type AssetClass = 'Equity' | 'Mutual Funds' | 'EPF' | 'Gold' | 'Crypto' | 'Fixed Income' | 'Other';

// v13.5 (full-site recheck): ASSET_CLASS_ORDER + ASSET_CLASS_COLORS deleted —
// only assetAllocationBreakdown (also deleted) ever used them.

/**
 * Classify ONE position row into an asset class. Works for BOTH the
 * INDMoney-synced rows (name + noLive + source carry the hints) and
 * manual rows (symbol/market are all we have — equity/crypto by
 * symbol, everything ambiguous lands in Other honestly).
 */
export function classifyAssetClass(p: Position): AssetClass {
  if (p.source === 'coindcx') return 'Crypto';
  const symbol = (p.symbol || '').toUpperCase();
  if (isCryptoSymbol(symbol)) return 'Crypto';
  const name = `${p.name || ''} ${p.symbol || ''}`.toLowerCase();
  // retirement/pension vehicles → EPF bucket (EPF/PPF/NPS/pension)
  if (/epf|ppf|provident|pension|nps|gratuity/.test(name)) return 'EPF';
  // gold instruments (SGB, gold ETF, gold fund) — "digital gold" bhi
  if (/gold|sgb|sovereign gold/.test(name)) return 'Gold';
  // fixed-income: FD/RD/bonds/debentures/treasury
  if (/fixed deposit|\bfd\b|recurring deposit|\brd\b|bond|debenture|treasury|liquid fund|money market|arbitrage/.test(name)) return 'Fixed Income';
  // mutual funds: the fund-house vocabulary + index ETF vocabulary
  if (/mutual|fund|flexi cap|mid cap|small cap|large cap|multi ?cap|elss|balanced|hybrid|sip|nifty|sensex|bees|index|amc|direct growth|dividend yield|value fund|emerging|bluechip|tax ?saver/.test(name)) return 'Mutual Funds';
  // synced equities carry the indmoney source; manual stocks fall back
  // to "not one of the above" = plain equity
  if (p.source === 'indmoney') return 'Equity';
  return p.noLive ? 'Other' : 'Equity';
}

/** Value weight per asset class, in % (0-100). null when nothing has a
 * computable value — the caller shows "n/a" instead of fake zeros. */
export function assetClassWeights(
  portfolio: Position[],
  livePrices: Record<string, PriceData>,
  usdInr: number = 85.5
): Record<AssetClass, number> | null {
  const totals = new Map<AssetClass, number>();
  let total = 0;
  for (const p of portfolio) {
    const d = livePrices[`${p.market}_${p.symbol}`];
    const price = d?.price || p.avgPrice;
    const value = price * p.qty * (p.market === 'US' ? usdInr : 1);
    if (!(value > 0)) continue;
    const cls = classifyAssetClass(p);
    totals.set(cls, (totals.get(cls) || 0) + value);
    total += value;
  }
  if (total <= 0) return null;
  const out = {} as Record<AssetClass, number>;
  for (const [cls, v] of totals) out[cls] = (v / total) * 100;
  return out;
}

// v13.5 (full-site recheck): assetAllocationBreakdown deleted — zero call
// sites (the Net Worth card computes its allocation through
// allocationByAssetClass + classifyAssetClass, both live below).

function monthKey(date: string): string {
  // date is YYYY-MM-DD → YYYY-MM
  return (date || '').slice(0, 7) || new Date().toISOString().slice(0, 7);
}

function monthLabel(key: string): string {
  const [y, m] = key.split('-');
  const mi = Math.max(0, Math.min(11, parseInt(m, 10) - 1));
  return `${MONTHS[mi]} ${y}`;
}

// Full "1 Jun – 30 Jun 2026" range label (1st → last calendar day of the month)
function monthRangeLabel(key: string): string {
  const [y, m] = key.split('-').map(s => parseInt(s, 10));
  const mi = Math.max(0, Math.min(11, m - 1));
  const lastDay = new Date(y, m, 0).getDate(); // day 0 of next month = last day this month
  return `1 ${MONTHS[mi]} – ${lastDay} ${MONTHS[mi]} ${y}`;
}

function emptyBreakdown() {
  return { buyQty: 0, buyAmount: 0, buyAmountINR: 0, txnCount: 0 };
}

// Classify a transaction into India / USA / Crypto buckets
function marketBucket(t: Transaction): 'india' | 'usa' | 'crypto' {
  if (isCryptoSymbol(t.symbol)) return 'crypto';
  return t.market === 'US' ? 'usa' : 'india';
}

// Convert a native-currency amount to INR
function toINR(amount: number, market: 'IN' | 'US', usdInr: number): number {
  return market === 'US' ? amount * usdInr : amount;
}

// ------------------------------------------------------------
// MONTHLY INVESTMENT ANALYTICS (Planner → Deep Data Analytics)
// Aggregates qty bought + amount invested per calendar month.
// ------------------------------------------------------------
export function buildMonthlyAnalytics(
  transactions: Transaction[],
  usdInr: number = 85.5
): MonthlyAnalytics[] {
  const map = new Map<string, MonthlyAnalytics>();

  for (const t of transactions) {
    const key = monthKey(t.date);
    if (!map.has(key)) {
      map.set(key, {
        month: key, label: monthLabel(key), rangeLabel: monthRangeLabel(key),
        buyQty: 0, buyAmountINR: 0, sellQty: 0, sellAmountINR: 0,
        netInvestedINR: 0, realizedPLINR: 0, txnCount: 0, symbols: [],
        india: emptyBreakdown(), usa: emptyBreakdown(), crypto: emptyBreakdown(),
      });
    }
    const row = map.get(key)!;
    const amtINR = toINR(t.amount, t.market, usdInr);
    const bucket = marketBucket(t);
    if (t.type === 'buy') {
      row.buyQty += t.qty;
      row.buyAmountINR += amtINR;
      row[bucket].buyQty += t.qty;
      row[bucket].buyAmount += t.amount;     // native (USD for usa, INR otherwise)
      row[bucket].buyAmountINR += amtINR;
      row[bucket].txnCount += 1;
    } else {
      row.sellQty += t.qty;
      row.sellAmountINR += amtINR;
      if (typeof t.realizedPL === 'number') row.realizedPLINR += toINR(t.realizedPL, t.market, usdInr);
    }
    row.netInvestedINR = row.buyAmountINR - row.sellAmountINR;
    row.txnCount += 1;
    const sym = t.symbol.replace('.NS', '');
    if (!row.symbols.includes(sym)) row.symbols.push(sym);
  }

  // newest month first
  return Array.from(map.values()).sort((a, b) => b.month.localeCompare(a.month));
}

// Month-over-month delta vs the immediately previous month present in the data.
export interface MonthlyDelta {
  current: MonthlyAnalytics;
  prev: MonthlyAnalytics | null;
  qtyDeltaPct: number | null;       // % change in buyQty
  investedDeltaPct: number | null;  // % change in net invested
}

export function withMonthlyDeltas(rows: MonthlyAnalytics[]): MonthlyDelta[] {
  // rows newest-first
  return rows.map((current, i) => {
    const prev = rows[i + 1] || null;
    const pct = (now: number, before: number): number | null => {
      if (!prev) return null;
      if (before === 0) return now === 0 ? 0 : 100;
      return ((now - before) / Math.abs(before)) * 100;
    };
    return {
      current, prev,
      qtyDeltaPct: prev ? pct(current.buyQty, prev.buyQty) : null,
      investedDeltaPct: prev ? pct(current.netInvestedINR, prev.netInvestedINR) : null,
    };
  });
}

// ------------------------------------------------------------
// MONTHLY RETURN REPORT (Portfolio → month-wise returns)
// Realized return booked each month from sells + capital deployed.
// Enhanced with per-market split, txn count, and MoM delta.
// ------------------------------------------------------------
export interface MonthlyReturn {
  month: string;
  label: string;
  rangeLabel: string;         // "1 Jun – 30 Jun 2026"
  netInvestedINR: number;     // capital deployed this month (buy - sell value)
  realizedPLINR: number;      // booked profit/loss this month
  realizedReturnPct: number;  // realizedPL / cost-basis sold
  cumulativeInvestedINR: number; // running deployed capital up to & incl. this month
  cumulativeRealizedINR: number; // running realized P&L up to & incl. this month
  // Per-market investment split this month
  indiaInvestedINR: number;
  usaInvestedINR: number;
  cryptoInvestedINR: number;
  // Transaction count
  txnCount: number;
  buyCount: number;
  sellCount: number;
  // MoM delta
  momDeltaPct: number | null;  // month-over-month change in net invested %
}

export function buildMonthlyReturns(
  transactions: Transaction[],
  usdInr: number = 85.5
): { rows: MonthlyReturn[]; totalRealizedINR: number } {
  const analytics = buildMonthlyAnalytics(transactions, usdInr);
  // oldest-first for running totals
  const asc = [...analytics].sort((a, b) => a.month.localeCompare(b.month));
  let running = 0;
  let totalRealized = 0;
  const rowsAsc: MonthlyReturn[] = asc.map((m, i) => {
    running += m.netInvestedINR;
    totalRealized += m.realizedPLINR;
    // cost basis of what was sold this month ≈ sellAmount - realizedPL
    const costBasisSold = m.sellAmountINR - m.realizedPLINR;
    const realizedReturnPct = costBasisSold > 0 ? (m.realizedPLINR / costBasisSold) * 100 : 0;
    // MoM delta
    const prev = i > 0 ? asc[i - 1] : null;
    let momDeltaPct: number | null = null;
    if (prev && Math.abs(prev.netInvestedINR) > 0) {
      momDeltaPct = ((m.netInvestedINR - prev.netInvestedINR) / Math.abs(prev.netInvestedINR)) * 100;
    }
    // Count buys vs sells
    const monthTxns = transactions.filter(t => (t.date || '').startsWith(m.month));
    const buyCount = monthTxns.filter(t => t.type === 'buy').length;
    const sellCount = monthTxns.filter(t => t.type === 'sell').length;
    return {
      month: m.month, label: m.label, rangeLabel: m.rangeLabel,
      netInvestedINR: m.netInvestedINR,
      realizedPLINR: m.realizedPLINR,
      realizedReturnPct,
      cumulativeInvestedINR: running,
      cumulativeRealizedINR: totalRealized,
      indiaInvestedINR: m.india.buyAmountINR,
      usaInvestedINR: m.usa.buyAmountINR,
      cryptoInvestedINR: m.crypto.buyAmountINR,
      txnCount: m.txnCount,
      buyCount,
      sellCount,
      momDeltaPct,
    };
  });
  return { rows: rowsAsc.reverse(), totalRealizedINR: totalRealized };
}

// Current unrealized P&L (INR) across live positions — pairs with realized for "total return".
export function currentUnrealizedINR(
  portfolio: Position[],
  livePrices: Record<string, PriceData>,
  usdInr: number
): { unrealizedINR: number; investedINR: number; valueINR: number } {
  let unrealized = 0, invested = 0, value = 0;
  for (const p of portfolio) {
    const d = livePrices[`${p.market}_${p.symbol}`];
    const price = d?.price || p.avgPrice;
    const inv = p.avgPrice * p.qty;
    const val = price * p.qty;
    invested += toINR(inv, p.market, usdInr);
    value += toINR(val, p.market, usdInr);
    unrealized += toINR(val - inv, p.market, usdInr);
  }
  return { unrealizedINR: unrealized, investedINR: invested, valueINR: value };
}
