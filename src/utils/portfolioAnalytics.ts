// ============================================================
// PORTFOLIO ANALYTICS ENGINE
// Builds month-wise investment analytics & return reports from
// the transaction ledger. Pure functions — no side effects.
// ============================================================
import { Transaction, Position, PriceData, MonthlyAnalytics } from '../types';
import { isCryptoSymbol } from './constants';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

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
// ------------------------------------------------------------
export interface MonthlyReturn {
  month: string;
  label: string;
  rangeLabel: string;         // "1 Jun – 30 Jun 2026"
  netInvestedINR: number;     // capital deployed this month (buy - sell value)
  realizedPLINR: number;      // booked profit/loss this month
  realizedReturnPct: number;  // realizedPL / cost-basis sold
  cumulativeInvestedINR: number; // running deployed capital up to & incl. this month
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
  const rowsAsc: MonthlyReturn[] = asc.map(m => {
    running += m.netInvestedINR;
    totalRealized += m.realizedPLINR;
    // cost basis of what was sold this month ≈ sellAmount - realizedPL
    const costBasisSold = m.sellAmountINR - m.realizedPLINR;
    const realizedReturnPct = costBasisSold > 0 ? (m.realizedPLINR / costBasisSold) * 100 : 0;
    return {
      month: m.month, label: m.label, rangeLabel: m.rangeLabel,
      netInvestedINR: m.netInvestedINR,
      realizedPLINR: m.realizedPLINR,
      realizedReturnPct,
      cumulativeInvestedINR: running,
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
