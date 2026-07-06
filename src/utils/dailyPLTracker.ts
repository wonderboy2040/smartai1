// ============================================================
// DAILY P&L TRACKER v2.0 — Advanced
// ------------------------------------------------------------
// Uses the `change` field from live prices to compute REAL
// daily P&L per market bucket. This is the same formula brokers
// use (Zerodha, Groww, etc.):
//
//   dailyPL_per_position = qty × currentPrice × (change% / 100)
//
// The `change` field IS the daily % move from previous close,
// provided by TradingView / CoinDCX / Finnhub / Groww. No
// snapshot diffing, no baseline tracking — just direct market
// movement P&L.
//
// For historical tracking (7-day strip, monthly report):
//   - Today's P&L is always LIVE (recomputed from current prices)
//   - Previous days are FROZEN entries in localStorage
//   - Frozen entry is updated throughout the day on each price tick
//   - When a new day starts, the previous day's last entry stays
// ============================================================

import { Position, PriceData } from '../types';
import { isCryptoSymbol } from './constants';
import { secureStorage } from './secureStorage';

const LOG_KEY = 'daily_pl_log_v2';

// ---------- Types ----------
export interface DailyPLEntry {
  date: string;              // YYYY-MM-DD
  india: number;             // INR P&L for the day
  usa: number;               // INR P&L (converted from USD)
  crypto: number;            // INR P&L
  total: number;             // INR
  // Per-market portfolio VALUES at time of snapshot (for context)
  indiaValueINR: number;
  usaValueINR: number;
  cryptoValueINR: number;
  portfolioValueINR: number;
  investedINR: number;
  ts: number;
}

export type DailyPLLog = Record<string, DailyPLEntry>;

export interface LiveDailyPL {
  india: number;
  usa: number;
  crypto: number;
  total: number;
  perPosition: {
    symbol: string;
    market: 'IN' | 'US';
    qty: number;
    price: number;
    change: number;
    plINR: number;
    isCrypto: boolean;
  }[];
  portfolioValueINR: number;
  investedINR: number;
  indiaValueINR: number;
  usaValueINR: number;
  cryptoValueINR: number;
}

export interface MonthlyPLReport {
  month: string;
  monthLabel: string;
  tradingDays: number;
  india: MarketStats;
  usa: MarketStats;
  crypto: MarketStats;
  total: MarketStats;
  daily: DailyPLEntry[];
  generatedAt: number;
}

interface MarketStats {
  total: number;
  profitDays: number;
  lossDays: number;
  bestDay: DailyPLEntry | null;
  worstDay: DailyPLEntry | null;
  avgPerDay: number;
  maxStreak: number;       // consecutive profit days
  currentStreak: number;
}

// ---------- Date helpers ----------
function todayKey(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function monthKeyOf(date: string): string {
  return date.slice(0, 7);
}

function monthLabelOf(monthKey: string): string {
  const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const [y, m] = monthKey.split('-');
  return `${MONTHS[parseInt(m, 10) - 1]} ${y}`;
}

function prevMonthKey(): string {
  const now = new Date();
  const d = new Date(now.getFullYear(), now.getMonth(), 1);
  d.setMonth(d.getMonth() - 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

// (fmtDay is used by the component, not here)

// ---------- Storage ----------
export function loadDailyPLLog(): DailyPLLog {
  try {
    const s = secureStorage.getItem(LOG_KEY);
    if (s) {
      const parsed = JSON.parse(s);
      // Migration from v1: if old key exists, try to import
      if (parsed && typeof parsed === 'object') return parsed;
    }
  } catch { /* empty */ }
  return {};
}

export function saveDailyPLLog(log: DailyPLLog): void {
  try {
    const keys = Object.keys(log).sort();
    while (keys.length > 500) {
      const old = keys.shift();
      if (old) delete log[old];
    }
    secureStorage.setItem(LOG_KEY, JSON.stringify(log));
  } catch { /* quota */ }
}

// ---------- CORE: Compute live daily P&L from `change` field ----------
// This is the REAL daily P&L — same as what brokers show.
// Formula: PL = qty × currentPrice × (change% / 100)
export function computeLiveDailyPL(
  portfolio: Position[],
  livePrices: Record<string, PriceData>,
  usdInrRate: number
): LiveDailyPL {
  let india = 0, usa = 0, crypto = 0;
  let indiaVal = 0, usaVal = 0, cryptoVal = 0;
  let totalInvested = 0;
  const perPosition: LiveDailyPL['perPosition'] = [];

  for (const p of portfolio) {
    const key = `${String(p.market || 'IN').toUpperCase()}_${p.symbol}`;
    const d = livePrices[key];
    if (!d || !d.price || d.price <= 0) continue;

    const change = d.change ?? 0;
    const price = d.price;
    const qty = p.qty;

    // Daily P&L = qty × price × (change% / 100)
    // This IS the market daily movement — what the stock moved today.
    const plNative = qty * price * (change / 100);

    const isUS = String(p.market || 'IN').toUpperCase() === 'US';
    const isCrypto = isCryptoSymbol(p.symbol);
    const plINR = isUS ? plNative * usdInrRate : plNative;

    // Portfolio value (for context)
    const valNative = price * qty;
    const invNative = p.avgPrice * qty;
    const valINR = isUS ? valNative * usdInrRate : valNative;
    const invINR = isUS ? invNative * usdInrRate : invNative;

    if (isCrypto) {
      crypto += plINR;
      cryptoVal += valINR;
    } else if (isUS) {
      usa += plINR;
      usaVal += valINR;
    } else {
      india += plINR;
      indiaVal += valINR;
    }
    totalInvested += invINR;

    perPosition.push({
      symbol: p.symbol,
      market: p.market,
      qty,
      price,
      change,
      plINR,
      isCrypto,
    });
  }

  // Sort per-position by absolute P&L (biggest movers first)
  perPosition.sort((a, b) => Math.abs(b.plINR) - Math.abs(a.plINR));

  return {
    india: Math.round(india),
    usa: Math.round(usa),
    crypto: Math.round(crypto),
    total: Math.round(india + usa + crypto),
    perPosition,
    portfolioValueINR: Math.round(indiaVal + usaVal + cryptoVal),
    investedINR: Math.round(totalInvested),
    indiaValueINR: Math.round(indiaVal),
    usaValueINR: Math.round(usaVal),
    cryptoValueINR: Math.round(cryptoVal),
  };
}

// ---------- Freeze today's P&L into the log ----------
// Called on each price tick — updates today's entry with the latest
// live P&L. When a new day starts, the previous day's last entry
// stays frozen automatically.
export function recordDailyPL(pl: LiveDailyPL): DailyPLEntry {
  const today = todayKey();
  const log = loadDailyPLLog();

  const entry: DailyPLEntry = {
    date: today,
    india: pl.india,
    usa: pl.usa,
    crypto: pl.crypto,
    total: pl.total,
    indiaValueINR: pl.indiaValueINR,
    usaValueINR: pl.usaValueINR,
    cryptoValueINR: pl.cryptoValueINR,
    portfolioValueINR: pl.portfolioValueINR,
    investedINR: pl.investedINR,
    ts: Date.now(),
  };

  log[today] = entry;
  saveDailyPLLog(log);
  return entry;
}

// ---------- Get recent days (for 7-day strip) ----------
// Returns frozen entries for previous days + today's live entry
// (if passed). Today is always last.
export function getRecentDailyPL(
  days: number = 7,
  liveToday: DailyPLEntry | null = null
): DailyPLEntry[] {
  const log = loadDailyPLLog();
  const today = todayKey();
  const all = Object.values(log)
    .filter(e => e.date < today)  // exclude today (we use live)
    .sort((a, b) => b.date.localeCompare(a.date))
    .slice(0, days - 1)
    .reverse();

  // Append today's live entry at the end
  if (liveToday) all.push(liveToday);
  else if (log[today]) all.push(log[today]);

  return all;
}

// ---------- Monthly report ----------
export function buildMonthlyPLReport(monthKey?: string): MonthlyPLReport {
  const targetMonth = monthKey || prevMonthKey();
  const log = loadDailyPLLog();

  const daily: DailyPLEntry[] = Object.values(log)
    .filter(e => monthKeyOf(e.date) === targetMonth)
    .sort((a, b) => a.date.localeCompare(b.date));

  const agg = (entries: DailyPLEntry[], key: 'india' | 'usa' | 'crypto' | 'total'): MarketStats => {
    const total = entries.reduce((s, e) => s + e[key], 0);
    const profitDays = entries.filter(e => e[key] > 0).length;
    const lossDays = entries.filter(e => e[key] < 0).length;
    const avgPerDay = entries.length > 0 ? total / entries.length : 0;

    let best: DailyPLEntry | null = null;
    let worst: DailyPLEntry | null = null;
    for (const e of entries) {
      const v = e[key];
      if (!best || v > best[key]) best = e;
      if (!worst || v < worst[key]) worst = e;
    }

    // Streak calculation (consecutive profit days)
    let maxStreak = 0, currentStreak = 0;
    for (const e of entries) {
      if (e[key] > 0) { currentStreak++; maxStreak = Math.max(maxStreak, currentStreak); }
      else currentStreak = 0;
    }
    // Current streak from the last entry
    currentStreak = 0;
    for (let i = entries.length - 1; i >= 0; i--) {
      if (entries[i][key] > 0) currentStreak++;
      else break;
    }

    return { total, profitDays, lossDays, bestDay: best, worstDay: worst, avgPerDay, maxStreak, currentStreak };
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

// ---------- Auto-generate monthly report on 1st ----------
export function shouldAutoGenerateMonthlyReport(): boolean {
  const today = new Date();
  if (today.getDate() !== 1) return false;
  const prevM = prevMonthKey();
  const flagKey = `monthly_pl_report_v2_generated_${prevM}`;
  try { return secureStorage.getItem(flagKey) !== 'true'; }
  catch { return false; }
}

export function markMonthlyReportGenerated(monthKey: string): void {
  try { secureStorage.setItem(`monthly_pl_report_v2_generated_${monthKey}`, 'true'); }
  catch { /* quota */ }
}

// ---------- Format for Telegram ----------
export function formatMonthlyPLForTelegram(r: MonthlyPLReport): string {
  const fmt = (n: number) => `${n >= 0 ? '+' : ''}₹${Math.round(n).toLocaleString('en-IN')}`;
  let msg = `📊 <b>MONTHLY P&L REPORT</b> — ${r.monthLabel}\n`;
  msg += `<code>━━━━━━━━━━━━━━━━━━━━━━━</code>\n\n`;
  msg += `Trading days: <b>${r.tradingDays}</b>\n\n`;

  const rows = [
    { label: '🇮🇳 India', stats: r.india },
    { label: '🇺🇸 USA', stats: r.usa },
    { label: '🪙 Crypto', stats: r.crypto },
    { label: '📊 TOTAL', stats: r.total },
  ];
  for (const row of rows) {
    const emoji = row.stats.total >= 0 ? '🟢' : '🔴';
    msg += `${emoji} <b>${row.label}</b>: ${fmt(row.stats.total)}\n`;
    msg += `   Avg/day: ${fmt(row.stats.avgPerDay)} | 🟢${row.stats.profitDays} 🔴${row.stats.lossDays}`;
    if (row.stats.maxStreak > 0) msg += ` | Best streak: ${row.stats.maxStreak}d`;
    msg += `\n`;
    if (row.stats.bestDay) msg += `   Best: ${row.stats.bestDay.date} (${fmt((row.stats.bestDay as any)[rows.indexOf(row) === 0 ? 'india' : rows.indexOf(row) === 1 ? 'usa' : rows.indexOf(row) === 2 ? 'crypto' : 'total'])})\n`;
    if (row.stats.worstDay) msg += `   Worst: ${row.stats.worstDay.date} (${fmt((row.stats.worstDay as any)[rows.indexOf(row) === 0 ? 'india' : rows.indexOf(row) === 1 ? 'usa' : rows.indexOf(row) === 2 ? 'crypto' : 'total'])})\n`;
    msg += `\n`;
  }
  msg += `<i>Auto-generated on 1st of ${r.monthLabel}.</i>`;
  return msg;
}

// ---------- Export CSV ----------
export function exportDailyPLCSV(): string {
  const log = loadDailyPLLog();
  const entries = Object.values(log).sort((a, b) => a.date.localeCompare(b.date));
  let csv = 'Date,India PL (INR),USA PL (INR),Crypto PL (INR),Total PL (INR),Portfolio Value (INR),Invested (INR)\n';
  for (const e of entries) {
    csv += `${e.date},${e.india},${e.usa},${e.crypto},${e.total},${e.portfolioValueINR},${e.investedINR}\n`;
  }
  return csv;
}
