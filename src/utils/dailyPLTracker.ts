// ============================================================
// DAILY P&L TRACKER
// ------------------------------------------------------------
// Records daily profit/loss per market bucket (India / USA /
// Crypto) by snapshotting portfolio value at the end of each
// day. On the 1st of each month, generates a monthly report
// aggregating all daily P&Ls of the previous month.
//
// Storage:
//   localStorage key `daily_pl_log_v1` = {
//     [YYYY-MM-DD]: {
//       india: number,   // INR
//       usa: number,     // INR (converted from USD)
//       crypto: number,  // INR
//       total: number,   // INR
//       portfolioValueINR: number,    // snapshot at end of day
//       investedINR: number,          // cumulative invested at end of day
//       ts: number,
//     },
//     ...
//   }
//
// Daily P&L formula:
//   todayPL = (todayValue - todayInvested) - (yesterdayValue - yesterdayInvested) - todayNetBuys
//   where:
//     todayValue = portfolio market value at end of today
//     todayInvested = cumulative cost basis at end of today
//     todayNetBuys = new capital deployed today (buys - sells)
//
//   Simplified: todayPL = changeInUnrealized - todayNetNewInvestment
//   This isolates "market movement" P&L from "capital flow" P&L.
//
// On 1st of month:
//   Reads all dailyPL entries for the previous month, aggregates
//   per market, returns MonthlyPLReport.
// ============================================================

import { Position, PriceData, Transaction } from '../types';
import { isCryptoSymbol } from './constants';
import { secureStorage } from './secureStorage';

const LOG_KEY = 'daily_pl_log_v1';
const LAST_SNAPSHOT_KEY = 'daily_pl_last_snapshot_v1';

export interface DailyPLEntry {
  date: string;            // YYYY-MM-DD
  india: number;           // INR P&L for the day
  usa: number;             // INR P&L for the day
  crypto: number;          // INR P&L for the day
  // FIX HIGH #8: per-market portfolio VALUES (INR) at end of day. Previously
  // we stored only P&L, so intra-day recompute couldn't reconstruct yesterday's
  // baseline values → USA/Crypto P&L cards showed wildly inflated numbers.
  indiaValueINR: number;
  usaValueINR: number;
  cryptoValueINR: number;
  total: number;           // INR
  portfolioValueINR: number;
  investedINR: number;
  ts: number;
}

export type DailyPLLog = Record<string, DailyPLEntry>;

interface LastSnapshot {
  date: string;            // YYYY-MM-DD of last snapshot
  portfolioValueINR: number;
  investedINR: number;
  perMarketValueINR: {
    india: number;
    usa: number;
    crypto: number;
  };
}

export interface MonthlyPLReport {
  month: string;           // YYYY-MM
  monthLabel: string;
  tradingDays: number;
  india: { total: number; profitDays: number; lossDays: number; bestDay: DailyPLEntry | null; worstDay: DailyPLEntry | null };
  usa: { total: number; profitDays: number; lossDays: number; bestDay: DailyPLEntry | null; worstDay: DailyPLEntry | null };
  crypto: { total: number; profitDays: number; lossDays: number; bestDay: DailyPLEntry | null; worstDay: DailyPLEntry | null };
  total: { total: number; profitDays: number; lossDays: number; bestDay: DailyPLEntry | null; worstDay: DailyPLEntry | null };
  daily: DailyPLEntry[];
  generatedAt: number;
}

function todayKey(): string {
  return new Date().toISOString().split('T')[0];
}

function monthKeyOf(date: string): string {
  return date.slice(0, 7);
}

function monthLabelOf(monthKey: string): string {
  const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const [y, m] = monthKey.split('-');
  return `${MONTHS[parseInt(m, 10) - 1]} ${y}`;
}

function prevMonthKey(of: string = todayKey()): string {
  const [y, m] = of.split('-').map(n => parseInt(n, 10));
  const d = new Date(y, m - 1, 1);  // first of this month
  d.setMonth(d.getMonth() - 1);     // back one month
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

export function loadDailyPLLog(): DailyPLLog {
  try {
    const s = secureStorage.getItem(LOG_KEY);
    if (s) return JSON.parse(s);
  } catch { /* empty */ }
  return {};
}

export function saveDailyPLLog(log: DailyPLLog): void {
  try {
    // Cap log size — keep last 400 days (~13 months).
    const keys = Object.keys(log).sort();
    while (keys.length > 400) {
      const old = keys.shift();
      if (old) delete log[old];
    }
    secureStorage.setItem(LOG_KEY, JSON.stringify(log));
  } catch { /* quota */ }
}

function loadLastSnapshot(): LastSnapshot | null {
  try {
    const s = secureStorage.getItem(LAST_SNAPSHOT_KEY);
    if (s) return JSON.parse(s);
  } catch { /* empty */ }
  return null;
}

function saveLastSnapshot(s: LastSnapshot): void {
  try {
    secureStorage.setItem(LAST_SNAPSHOT_KEY, JSON.stringify(s));
  } catch { /* quota */ }
}

// Compute current portfolio value per market bucket + total.
function portfolioValueByBucket(
  portfolio: Position[],
  livePrices: Record<string, PriceData>,
  usdInrRate: number
): { india: number; usa: number; crypto: number; total: number; invested: number; investedByBucket: { india: number; usa: number; crypto: number } } {
  let india = 0, usa = 0, crypto = 0;
  let indiaInv = 0, usaInv = 0, cryptoInv = 0;
  for (const p of portfolio) {
    const key = `${String(p.market || 'IN').toUpperCase()}_${p.symbol}`;
    const lp = livePrices[key];
    const price = lp?.price ?? p.avgPrice;
    const valNative = price * p.qty;
    const invNative = p.avgPrice * p.qty;
    const valINR = p.market === 'US' ? valNative * usdInrRate : valNative;
    const invINR = p.market === 'US' ? invNative * usdInrRate : invNative;
    if (isCryptoSymbol(p.symbol)) {
      crypto += valINR;
      cryptoInv += invINR;
    } else if (p.market === 'US') {
      usa += valINR;
      usaInv += invINR;
    } else {
      india += valINR;
      indiaInv += invINR;
    }
  }
  return {
    india, usa, crypto,
    total: india + usa + crypto,
    invested: indiaInv + usaInv + cryptoInv,
    investedByBucket: { india: indiaInv, usa: usaInv, crypto: cryptoInv },
  };
}

/**
 * Snapshot today's portfolio state and record (or update) the
 * daily P&L entry for today. Idempotent — calling multiple times
 * in one day updates the same entry.
 *
 * Returns the DailyPLEntry that was saved (or null if there's no
 * previous snapshot to diff against — first-ever run).
 */
export function recordDailyPL(
  portfolio: Position[],
  livePrices: Record<string, PriceData>,
  usdInrRate: number,
  transactions: Transaction[]
): DailyPLEntry | null {
  const today = todayKey();
  const log = loadDailyPLLog();
  const prev = loadLastSnapshot();

  const current = portfolioValueByBucket(portfolio, livePrices, usdInrRate);

  if (!prev) {
    // First run — just save snapshot, no P&L yet.
    saveLastSnapshot({
      date: today,
      portfolioValueINR: current.total,
      investedINR: current.invested,
      perMarketValueINR: { india: current.india, usa: current.usa, crypto: current.crypto },
    });
    return null;
  }

  // If prev.date === today, this is an intra-day update — recalculate
  // against YESTERDAY's snapshot instead. We use the last entry in the
  // log that's NOT today as the "yesterday" baseline.
  let baselineValue = prev.portfolioValueINR;
  let baselinePerMarket = prev.perMarketValueINR;

  if (prev.date === today) {
    // Find the most recent entry in the log that's NOT today.
    const sortedDates = Object.keys(log).sort().reverse();
    const yesterdayKey = sortedDates.find(d => d < today);
    if (yesterdayKey && log[yesterdayKey]) {
      const y = log[yesterdayKey];
      baselineValue = y.portfolioValueINR;
      // FIX HIGH #8: prefer the per-market VALUES stored in the entry
      // (added in this fix round). Fall back to proportional split only
      // for legacy entries that don't have the new fields.
      const yInd = (y as any).indiaValueINR;
      const yUsa = (y as any).usaValueINR;
      const yCrypto = (y as any).cryptoValueINR;
      const haveValues = typeof yInd === 'number' && typeof yUsa === 'number' && typeof yCrypto === 'number';
      baselinePerMarket = haveValues
        ? { india: yInd, usa: yUsa, crypto: yCrypto }
        : {
            india: y.portfolioValueINR > 0 ? (y.india / Math.max(1, y.india + y.usa + y.crypto)) * y.portfolioValueINR : 0,
            usa: y.portfolioValueINR > 0 ? (y.usa / Math.max(1, y.india + y.usa + y.crypto)) * y.portfolioValueINR : 0,
            crypto: y.portfolioValueINR > 0 ? (y.crypto / Math.max(1, y.india + y.usa + y.crypto)) * y.portfolioValueINR : 0,
          };
    }
  }

  // Compute today's new invested capital (buys - sells today, in INR).
  const todayTxns = transactions.filter(t => (t.date || '').startsWith(today));
  let newInvestedINR = 0;
  for (const t of todayTxns) {
    const amtINR = t.market === 'US' ? t.amount * usdInrRate : t.amount;
    if (t.type === 'buy') newInvestedINR += amtINR;
    else newInvestedINR -= amtINR;
  }

  // Today's P&L = change in (value - invested) − newInvested
  //            = (curValue − curInvested) − (baselineValue − baselineInvested) − newInvested
  //            = (curValue − baselineValue) − (curInvested − baselineInvested) − newInvested
  //            = (curValue − baselineValue) − newInvested − newInvested  (since curInvested − baselineInvested ≈ newInvested)
  // Simpler form: change in market value minus net new capital deployed.
  const totalPL = (current.total - baselineValue) - newInvestedINR;

  // Per-market: change in market value minus that market's share of newInvested.
  // Approximate: split newInvested by today's txn classification.
  let newInvestedByBucket = { india: 0, usa: 0, crypto: 0 };
  for (const t of todayTxns) {
    const amtINR = t.market === 'US' ? t.amount * usdInrRate : t.amount;
    const bucket = isCryptoSymbol(t.symbol) ? 'crypto' : (t.market === 'US' ? 'usa' : 'india');
    if (t.type === 'buy') newInvestedByBucket[bucket] += amtINR;
    else newInvestedByBucket[bucket] -= amtINR;
  }

  const indiaPL = (current.india - (baselinePerMarket.india || 0)) - newInvestedByBucket.india;
  const usaPL = (current.usa - (baselinePerMarket.usa || 0)) - newInvestedByBucket.usa;
  const cryptoPL = (current.crypto - (baselinePerMarket.crypto || 0)) - newInvestedByBucket.crypto;

  const entry: DailyPLEntry = {
    date: today,
    india: Math.round(indiaPL),
    usa: Math.round(usaPL),
    crypto: Math.round(cryptoPL),
    // FIX HIGH #8: store per-market VALUES so intra-day recompute can
    // reconstruct yesterday's baseline accurately.
    indiaValueINR: Math.round(current.india),
    usaValueINR: Math.round(current.usa),
    cryptoValueINR: Math.round(current.crypto),
    total: Math.round(totalPL),
    portfolioValueINR: Math.round(current.total),
    investedINR: Math.round(current.invested),
    ts: Date.now(),
  };

  log[today] = entry;
  saveDailyPLLog(log);

  // Save today's snapshot (overwrite the last-snapshot baseline).
  saveLastSnapshot({
    date: today,
    portfolioValueINR: current.total,
    investedINR: current.invested,
    perMarketValueINR: { india: current.india, usa: current.usa, crypto: current.crypto },
  });

  return entry;
}

/**
 * Build a monthly P&L report for the given month (YYYY-MM) by
 * aggregating all daily P&L entries in that month.
 *
 * Default: previous month (for the 1st-of-month auto-report).
 */
export function buildMonthlyPLReport(monthKey?: string): MonthlyPLReport {
  const targetMonth = monthKey || prevMonthKey();
  const log = loadDailyPLLog();

  const daily: DailyPLEntry[] = Object.values(log)
    .filter(e => monthKeyOf(e.date) === targetMonth)
    .sort((a, b) => a.date.localeCompare(b.date));

  const agg = (entries: DailyPLEntry[], key: keyof Pick<DailyPLEntry, 'india' | 'usa' | 'crypto' | 'total'>) => {
    const total = entries.reduce((s, e) => s + (e[key] as number), 0);
    const profitDays = entries.filter(e => (e[key] as number) > 0).length;
    const lossDays = entries.filter(e => (e[key] as number) < 0).length;
    let best: DailyPLEntry | null = null;
    let worst: DailyPLEntry | null = null;
    for (const e of entries) {
      const v = e[key] as number;
      if (!best || v > (best[key] as number)) best = e;
      if (!worst || v < (worst[key] as number)) worst = e;
    }
    return { total, profitDays, lossDays, bestDay: best, worstDay: worst };
  };

  return {
    month: targetMonth,
    monthLabel: monthLabelOf(targetMonth),
    tradingDays: daily.length,
    india: agg(daily, 'india'),
    usa: agg(daily, 'usa'),
    crypto: agg(daily, 'crypto'),
    total: agg(daily, 'total'),
    daily,
    generatedAt: Date.now(),
  };
}

/**
 * Get the last N days of P&L entries (for the 7-day strip).
 */
export function getRecentDailyPL(days: number = 7): DailyPLEntry[] {
  const log = loadDailyPLLog();
  return Object.values(log)
    .sort((a, b) => b.date.localeCompare(a.date))
    .slice(0, days)
    .reverse();
}

/**
 * Should we auto-generate the monthly report today? Returns true
 * if today is the 1st of the month AND we haven't generated the
 * report for the previous month yet (tracked via a separate
 * localStorage flag).
 */
export function shouldAutoGenerateMonthlyReport(): boolean {
  const today = new Date();
  if (today.getDate() !== 1) return false;
  const prevM = prevMonthKey();
  const flagKey = `monthly_pl_report_generated_${prevM}`;
  try {
    return secureStorage.getItem(flagKey) !== 'true';
  } catch { return false; }
}

export function markMonthlyReportGenerated(monthKey: string): void {
  try {
    secureStorage.setItem(`monthly_pl_report_generated_${monthKey}`, 'true');
  } catch { /* quota */ }
}

// ---------- Format monthly report for Telegram ----------
export function formatMonthlyPLForTelegram(r: MonthlyPLReport): string {
  const fmt = (n: number) => {
    const sign = n >= 0 ? '+' : '';
    return `${sign}₹${Math.round(n).toLocaleString('en-IN')}`;
  };
  let msg = `📊 <b>MONTHLY P&L REPORT</b> — ${r.monthLabel}\n`;
  msg += `<code>━━━━━━━━━━━━━━━━━━━━━━━</code>\n\n`;
  msg += `Trading days: <b>${r.tradingDays}</b>\n\n`;

  const rows = [
    { label: '🇮🇳 India', data: r.india },
    { label: '🇺🇸 USA', data: r.usa },
    { label: '🪙 Crypto', data: r.crypto },
    { label: '📊 TOTAL', data: r.total },
  ];
  for (const row of rows) {
    const color = row.data.total >= 0 ? '🟢' : '🔴';
    msg += `${color} <b>${row.label}</b>: ${fmt(row.data.total)}\n`;
    msg += `   Profit days: ${row.data.profitDays} | Loss days: ${row.data.lossDays}\n`;
    if (row.data.bestDay) {
      msg += `   Best day: ${row.data.bestDay.date} (${fmt((row.data as any).bestDay[row.label.includes('India') ? 'india' : row.label.includes('USA') ? 'usa' : row.label.includes('Crypto') ? 'crypto' : 'total'])})\n`;
    }
    if (row.data.worstDay) {
      msg += `   Worst day: ${row.data.worstDay.date} (${fmt((row.data as any).worstDay[row.label.includes('India') ? 'india' : row.label.includes('USA') ? 'usa' : row.label.includes('Crypto') ? 'crypto' : 'total'])})\n`;
    }
    msg += `\n`;
  }

  msg += `<i>Auto-generated on 1st of ${r.monthLabel.split(' ')[0]} ${r.monthLabel.split(' ')[1]}.</i>`;
  return msg;
}
