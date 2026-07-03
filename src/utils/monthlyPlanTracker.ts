// ============================================================
// MONTHLY PLAN TRACKER
// ------------------------------------------------------------
// Compares the user's planned monthly investment (from Planner
// SIP settings) vs actual purchases this month (from the
// transaction ledger), per market bucket.
//
// Planned amounts come from the user's planner settings:
//   India: indiaSIP ₹/mo (monthly)
//   USA:    usSIP ₹/mo (frequency = MONTHLY | QUARTERLY)
//   Crypto: btcSIP + ethSIP ₹/mo (monthly, INR pairs)
//
// For each market we compute:
//   - plannedAmountINR (this month's target)
//   - plannedQty (estimated using live price of the asset(s) the
//                user has been buying — falls back to "any" if no
//                holdings yet)
//   - actualAmountINR (sum of buy amounts this month)
//   - actualQty (sum of buy qtys this month)
//   - remainingAmountINR (planned - actual)
//   - remainingQty (plannedQty - actualQty)
//   - progressPct (0-100)
//   - perSymbol breakdown (for holdings in that market)
// ============================================================

import { Transaction, Position, PriceData } from '../types';
import { isCryptoSymbol } from './constants';

export type MarketBucket = 'india' | 'usa' | 'crypto';
export type SIPFrequency = 'monthly' | 'quarterly';

export interface PlannerSettings {
  indiaSIP: number;
  usSIP: number;
  btcSIP: number;
  ethSIP: number;
  usFrequency?: SIPFrequency;  // default 'monthly'
}

export interface SymbolPlanRow {
  symbol: string;
  market: 'IN' | 'US';
  plannedQty: number;        // estimated qty to buy at current price (0 if no live price)
  actualQty: number;         // bought this month
  actualAmountINR: number;
  livePrice: number | null;
  remainingQty: number;
}

export interface MarketPlanRow {
  bucket: MarketBucket;
  emoji: string;
  label: string;
  plannedAmountINR: number;
  actualAmountINR: number;
  remainingAmountINR: number;
  progressPct: number;        // 0-100
  plannedQty: number;         // estimated total qty (sum of symbols)
  actualQty: number;
  remainingQty: number;
  symbols: SymbolPlanRow[];
  nextBuyNote: string;        // e.g. "Next USA buy in 2 months" for quarterly
}

export interface MonthlyPlanResult {
  month: string;              // YYYY-MM
  monthLabel: string;         // "Jul 2026"
  rows: MarketPlanRow[];      // one per bucket (india, usa, crypto)
  totals: {
    plannedAmountINR: number;
    actualAmountINR: number;
    remainingAmountINR: number;
    progressPct: number;
  };
}

function currentMonthKey(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

function monthLabel(key: string): string {
  const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const [y, m] = key.split('-');
  return `${MONTHS[parseInt(m, 10) - 1]} ${y}`;
}

function classify(t: Transaction): MarketBucket {
  if (isCryptoSymbol(t.symbol)) return 'crypto';
  return t.market === 'US' ? 'usa' : 'india';
}

function classifyPosition(p: Position): MarketBucket {
  if (isCryptoSymbol(p.symbol)) return 'crypto';
  return p.market === 'US' ? 'usa' : 'india';
}

/**
 * For quarterly USA SIP: returns true if THIS month is a "buy month".
 * Convention: January, April, July, October are USA buy months
 * (start of each calendar quarter). User can override by editing
 * usFrequency to 'monthly'.
 */
function isUsaBuyMonth(d: Date, frequency: SIPFrequency): boolean {
  if (frequency === 'monthly') return true;
  // Quarterly: Jan(0), Apr(3), Jul(6), Oct(9)
  return [0, 3, 6, 9].includes(d.getMonth());
}

function monthsUntilNextUsaBuy(d: Date): number {
  const m = d.getMonth();
  const quarters = [0, 3, 6, 9];
  for (const q of quarters) {
    if (q >= m) return q - m;
  }
  return 12 - m + 0;  // next is Jan of next year
}

/**
 * Main entry: compute the monthly plan vs actual for the current
 * calendar month.
 */
export function computeMonthlyPlan(
  settings: PlannerSettings,
  transactions: Transaction[],
  portfolio: Position[],
  livePrices: Record<string, PriceData>,
  usdInrRate: number
): MonthlyPlanResult {
  const monthKey = currentMonthKey();
  const now = new Date();

  // Filter transactions to THIS month + buy type.
  const thisMonthBuys = transactions.filter(t =>
    t.type === 'buy' && (t.date || '').startsWith(monthKey)
  );

  // Group portfolio holdings by market bucket.
  const holdingsByBucket: Record<MarketBucket, Position[]> = {
    india: [], usa: [], crypto: [],
  };
  for (const p of portfolio) {
    holdingsByBucket[classifyPosition(p)].push(p);
  }

  // ---- INDIA ----
  const indiaPlanned = settings.indiaSIP || 0;
  const indiaBuys = thisMonthBuys.filter(t => classify(t) === 'india');
  const indiaActualAmount = indiaBuys.reduce((s, t) =>
    s + (t.market === 'US' ? t.amount * usdInrRate : t.amount), 0);
  const indiaActualQty = indiaBuys.reduce((s, t) => s + t.qty, 0);

  // Per-symbol planned qty: distribute indiaPlanned across existing holdings
  // proportional to current value (so the dominant holding gets more SIP).
  const indiaSymbols = buildSymbolPlanRows(
    holdingsByBucket.india, indiaBuys, livePrices, usdInrRate, indiaPlanned
  );
  const indiaPlannedQty = indiaSymbols.reduce((s, r) => s + r.plannedQty, 0);

  // ---- USA ----
  const usFrequency = settings.usFrequency || 'monthly';
  const isBuyMonth = isUsaBuyMonth(now, usFrequency);
  const usPlanned = isBuyMonth ? (settings.usSIP || 0) : 0;
  const usBuys = thisMonthBuys.filter(t => classify(t) === 'usa');
  const usActualAmount = usBuys.reduce((s, t) =>
    s + (t.market === 'US' ? t.amount * usdInrRate : t.amount), 0);
  const usActualQty = usBuys.reduce((s, t) => s + t.qty, 0);
  const usSymbols = buildSymbolPlanRows(
    holdingsByBucket.usa, usBuys, livePrices, usdInrRate, usPlanned
  );
  const usPlannedQty = usSymbols.reduce((s, r) => s + r.plannedQty, 0);
  const usNextNote = usFrequency === 'monthly'
    ? 'Monthly buy month'
    : isBuyMonth
      ? 'Quarterly buy month (this month)'
      : `Next USA buy in ${monthsUntilNextUsaBuy(now)} month(s)`;

  // ---- CRYPTO ----
  const cryptoPlanned = (settings.btcSIP || 0) + (settings.ethSIP || 0);
  const cryptoBuys = thisMonthBuys.filter(t => classify(t) === 'crypto');
  const cryptoActualAmount = cryptoBuys.reduce((s, t) =>
    s + (t.market === 'US' ? t.amount * usdInrRate : t.amount), 0);
  const cryptoActualQty = cryptoBuys.reduce((s, t) => s + t.qty, 0);
  const cryptoSymbols = buildSymbolPlanRows(
    holdingsByBucket.crypto, cryptoBuys, livePrices, usdInrRate, cryptoPlanned
  );
  const cryptoPlannedQty = cryptoSymbols.reduce((s, r) => s + r.plannedQty, 0);

  const rows: MarketPlanRow[] = [
    {
      bucket: 'india',
      emoji: '🇮🇳',
      label: 'India',
      plannedAmountINR: indiaPlanned,
      actualAmountINR: indiaActualAmount,
      remainingAmountINR: Math.max(0, indiaPlanned - indiaActualAmount),
      progressPct: indiaPlanned > 0 ? Math.min(100, (indiaActualAmount / indiaPlanned) * 100) : 0,
      plannedQty: indiaPlannedQty,
      actualQty: indiaActualQty,
      remainingQty: Math.max(0, indiaPlannedQty - indiaActualQty),
      symbols: indiaSymbols,
      nextBuyNote: 'Monthly',
    },
    {
      bucket: 'usa',
      emoji: '🇺🇸',
      label: 'USA',
      plannedAmountINR: usPlanned,
      actualAmountINR: usActualAmount,
      remainingAmountINR: Math.max(0, usPlanned - usActualAmount),
      progressPct: usPlanned > 0 ? Math.min(100, (usActualAmount / usPlanned) * 100) : 0,
      plannedQty: usPlannedQty,
      actualQty: usActualQty,
      remainingQty: Math.max(0, usPlannedQty - usActualQty),
      symbols: usSymbols,
      nextBuyNote: usNextNote,
    },
    {
      bucket: 'crypto',
      emoji: '🪙',
      label: 'Crypto',
      plannedAmountINR: cryptoPlanned,
      actualAmountINR: cryptoActualAmount,
      remainingAmountINR: Math.max(0, cryptoPlanned - cryptoActualAmount),
      progressPct: cryptoPlanned > 0 ? Math.min(100, (cryptoActualAmount / cryptoPlanned) * 100) : 0,
      plannedQty: cryptoPlannedQty,
      actualQty: cryptoActualQty,
      remainingQty: Math.max(0, cryptoPlannedQty - cryptoActualQty),
      symbols: cryptoSymbols,
      nextBuyNote: 'Monthly (BTC + ETH)',
    },
  ];

  const totals = {
    plannedAmountINR: rows.reduce((s, r) => s + r.plannedAmountINR, 0),
    actualAmountINR: rows.reduce((s, r) => s + r.actualAmountINR, 0),
    remainingAmountINR: 0,
    progressPct: 0,
  };
  totals.remainingAmountINR = Math.max(0, totals.plannedAmountINR - totals.actualAmountINR);
  totals.progressPct = totals.plannedAmountINR > 0
    ? Math.min(100, (totals.actualAmountINR / totals.plannedAmountINR) * 100)
    : 0;

  return {
    month: monthKey,
    monthLabel: monthLabel(monthKey),
    rows,
    totals,
  };
}

/**
 * Build per-symbol plan rows for one market bucket.
 * Distributes the planned amount across the bucket's holdings
 * proportional to their current portfolio value (so a 60% holding
 * gets 60% of the SIP). For each symbol, plannedQty = (allocated
 * amount) / (live price).
 */
function buildSymbolPlanRows(
  holdings: Position[],
  buys: Transaction[],
  livePrices: Record<string, PriceData>,
  usdInrRate: number,
  plannedAmountINR: number
): SymbolPlanRow[] {
  if (holdings.length === 0 && buys.length === 0) return [];
  if (plannedAmountINR <= 0) return [];

  // Use holdings if present, else symbols from this month's buys.
  const symbolSet = new Set<string>();
  for (const p of holdings) symbolSet.add(`${p.market}_${p.symbol}`);
  for (const t of buys) symbolSet.add(`${t.market}_${t.symbol}`);

  // Weight by current portfolio value (in INR).
  const weights = new Map<string, number>();
  let totalWeight = 0;
  for (const k of symbolSet) {
    const p = holdings.find(h => `${h.market}_${h.symbol}` === k);
    const t = buys.find(b => `${b.market}_${b.symbol}` === k);
    const lp = livePrices[k];
    const qty = p?.qty ?? t?.qty ?? 0;
    const price = lp?.price ?? p?.avgPrice ?? t?.price ?? 0;
    const inrPrice = (p?.market ?? t?.market) === 'US' ? price * usdInrRate : price;
    const w = qty * inrPrice;
    weights.set(k, w);
    totalWeight += w;
  }

  // If totalWeight is 0 (no holdings + no live price), distribute equally.
  const symbols = Array.from(symbolSet).sort();
  const out: SymbolPlanRow[] = [];
  for (const k of symbols) {
    const [market, symbol] = k.split('_');
    const mkt = (market as 'IN' | 'US');
    const lp = livePrices[k];
    const livePrice = lp?.price ?? null;
    const weight = totalWeight > 0 ? (weights.get(k) || 0) / totalWeight : 1 / symbols.length;
    const allocatedAmountINR = plannedAmountINR * weight;
    // Planned qty uses live price (in native currency for that market).
    const nativePrice = livePrice != null
      ? (mkt === 'US' ? livePrice : livePrice)
      : null;
    const plannedQty = nativePrice != null && nativePrice > 0
      ? (mkt === 'US' ? allocatedAmountINR / usdInrRate : allocatedAmountINR) / nativePrice
      : 0;

    // Actual qty + amount for this symbol this month.
    const symbolBuys = buys.filter(t => t.symbol === symbol);
    const actualQty = symbolBuys.reduce((s, t) => s + t.qty, 0);
    const actualAmountINR = symbolBuys.reduce((s, t) =>
      s + (t.market === 'US' ? t.amount * usdInrRate : t.amount), 0);

    out.push({
      symbol,
      market: mkt,
      plannedQty,
      actualQty,
      actualAmountINR,
      livePrice,
      remainingQty: Math.max(0, plannedQty - actualQty),
    });
  }

  return out;
}

// ---------- Format for Telegram / chat ----------
export function formatMonthlyPlanForTelegram(r: MonthlyPlanResult): string {
  const fmt = (n: number) => `₹${Math.round(n).toLocaleString('en-IN')}`;
  let msg = `📅 <b>MONTHLY PLAN TRACKER</b> — ${r.monthLabel}\n`;
  msg += `<code>━━━━━━━━━━━━━━━━━━━━━━━</code>\n\n`;
  for (const row of r.rows) {
    const emoji = row.progressPct >= 100 ? '✅' : row.progressPct > 0 ? '🔄' : '⏳';
    msg += `${emoji} <b>${row.emoji} ${row.label}</b> — ${row.nextBuyNote}\n`;
    msg += `   Planned: ${fmt(row.plannedAmountINR)} | Actual: ${fmt(row.actualAmountINR)} | Remaining: ${fmt(row.remainingAmountINR)}\n`;
    msg += `   Progress: ${row.progressPct.toFixed(0)}% (${row.actualQty.toFixed(2)}/${row.plannedQty.toFixed(2)} qty)\n`;
    if (row.symbols.length > 0) {
      msg += `   <i>Symbols:</i>\n`;
      for (const s of row.symbols.slice(0, 4)) {
        const cur = s.market === 'IN' ? '₹' : '$';
        const priceStr = s.livePrice != null ? `${cur}${s.livePrice.toFixed(2)}` : 'N/A';
        msg += `   • ${s.symbol}: planned ${s.plannedQty.toFixed(2)} @ ${priceStr} | bought ${s.actualQty.toFixed(2)} (${fmt(s.actualAmountINR)})\n`;
      }
    }
    msg += `\n`;
  }
  msg += `<b>📊 TOTAL: ${fmt(r.totals.actualAmountINR)} / ${fmt(r.totals.plannedAmountINR)} (${r.totals.progressPct.toFixed(0)}%)</b>`;
  return msg;
}
