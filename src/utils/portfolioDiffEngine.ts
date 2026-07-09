// ============================================================
// PORTFOLIO DIFF ENGINE
// ------------------------------------------------------------
// Detects changes between the last-seen portfolio snapshot and
// the current portfolio (loaded from Google Sheets cloud sync),
// and auto-creates transaction records for newly bought / sold
// quantities.
//
// Why this exists:
//   The user maintains their portfolio in Google Sheets
//   (qty + avg buy price). When the site syncs, the portfolio
//   state updates but NO transaction is recorded. This engine
//   fills that gap — every time the portfolio changes, we
//   compute the delta and append synthetic transactions to the
//   ledger so Monthly Plan Tracker + Monthly Return Report can
//   use them.
//
// Memory:
//   Last-seen snapshot stored in localStorage key
//   `portfolio_snapshot_v1` — { symbol_market: { qty, avgPrice,
//   market, dateAdded } }.
//
// Buy detection:
//   If newQty > oldQty → buy of (newQty - oldQty).
//   Buy price = (newQty·newAvg − oldQty·oldAvg) / (newQty − oldQty)
//   (weighted-average implied buy price).
//
// Sell detection:
//   If newQty < oldQty → sell of (oldQty - newQty) at oldAvg
//   (conservative — we don't know the sell price; use cost basis).
//   realizedPL is computed against oldAvg × sellQty vs current
//   live price if available, else 0.
// ============================================================

import { Position, Transaction, PriceData } from '../types';
import { secureStorage } from './secureStorage';

const SNAPSHOT_KEY = 'portfolio_snapshot_v1';

export interface SnapshotEntry {
  qty: number;
  avgPrice: number;
  market: 'IN' | 'US';
  dateAdded: string;
}

export type Snapshot = Record<string, SnapshotEntry>;  // key = `${market}_${symbol}`

export function loadSnapshot(): Snapshot {
  try {
    const s = secureStorage.getItem(SNAPSHOT_KEY);
    if (s) return JSON.parse(s);
  } catch { /* empty */ }
  return {};
}

export function saveSnapshot(snap: Snapshot): void {
  try {
    secureStorage.setItem(SNAPSHOT_KEY, JSON.stringify(snap));
  } catch { /* quota */ }
}

function posKey(market: string, symbol: string): string {
  return `${String(market || 'IN').toUpperCase()}_${symbol}`;
}

/**
 * Compute the diff between the last-saved snapshot and the current
 * portfolio. Returns synthetic transactions (without IDs — caller
 * assigns them) that should be appended to the ledger.
 *
 * Also returns the new snapshot (caller should save it).
 */
export function diffPortfolio(
  current: Position[],
  prevSnap: Snapshot,
  livePrices: Record<string, PriceData>,
  _usdInrRate: number
): { newTransactions: Omit<Transaction, 'id'>[]; newSnapshot: Snapshot } {
  const newSnap: Snapshot = {};
  const newTxns: Omit<Transaction, 'id'>[] = [];
  const today = new Date().toISOString().split('T')[0];
  const now = Date.now();

  // Build new snapshot from current portfolio.
  for (const p of current) {
    const k = posKey(p.market, p.symbol);
    newSnap[k] = {
      qty: p.qty,
      avgPrice: p.avgPrice,
      market: p.market,
      dateAdded: p.dateAdded,
    };
  }

  // Detect changes.
  // 1) Positions in BOTH snapshots — check qty change.
  for (const k of Object.keys(newSnap)) {
    const cur = newSnap[k];
    const prev = prevSnap[k];
    if (!prev) continue;  // handled in (2)

    const qtyDelta = cur.qty - prev.qty;
    if (Math.abs(qtyDelta) < 1e-6) {
      // No qty change — but if avgPrice changed materially without a qty
      // change, that's a user edit; we can't model it as a transaction.
      // Skip silently.
      continue;
    }

    const [market, symbol] = k.split('_');
    const mkt = (market as 'IN' | 'US');

    if (qtyDelta > 0) {
      // BUY of qtyDelta
      const oldInvestment = prev.qty * prev.avgPrice;
      const newInvestment = cur.qty * cur.avgPrice;
      const buyAmount = newInvestment - oldInvestment;
      const buyPrice = qtyDelta > 0 ? buyAmount / qtyDelta : cur.avgPrice;

      newTxns.push({
        symbol,
        market: mkt,
        type: 'buy',
        qty: qtyDelta,
        price: buyPrice,
        amount: buyAmount,
        // FIX H1: use the position's ORIGINAL dateAdded (not today) so
        // taxOptimizer computes correct holding period (LTCG vs STCG).
        date: prev.dateAdded || today,
        ts: now,
        prevQty: prev.qty,
        prevAvg: prev.avgPrice,
        newQty: cur.qty,
        newAvg: cur.avgPrice,
      });
    } else {
      // SELL of |qtyDelta|
      const sellQty = Math.abs(qtyDelta);
      // Approximate sell price = current live price (best guess).
      const lp = livePrices[k];
      const sellPrice = lp?.price ?? cur.avgPrice;
      const realizedPL = (sellPrice - prev.avgPrice) * sellQty;

      newTxns.push({
        symbol,
        market: mkt,
        type: 'sell',
        qty: sellQty,
        price: sellPrice,
        amount: sellQty * sellPrice,
        // FIX H1: use original dateAdded for correct holding period.
        date: prev.dateAdded || today,
        ts: now,
        prevQty: prev.qty,
        prevAvg: prev.avgPrice,
        newQty: cur.qty,
        newAvg: cur.avgPrice,
        realizedPL,
      });
    }
  }

  // 2) Positions in prevSnap but NOT in newSnap → full sell (or removed).
  for (const k of Object.keys(prevSnap)) {
    if (newSnap[k]) continue;  // still exists
    const prev = prevSnap[k];
    const [market, symbol] = k.split('_');
    const mkt = (market as 'IN' | 'US');
    const lp = livePrices[k];
    const sellPrice = lp?.price ?? prev.avgPrice;
    const realizedPL = (sellPrice - prev.avgPrice) * prev.qty;

    newTxns.push({
      symbol,
      market: mkt,
      type: 'sell',
      qty: prev.qty,
      price: sellPrice,
      amount: prev.qty * sellPrice,
      date: today,
      ts: now,
      prevQty: prev.qty,
      prevAvg: prev.avgPrice,
      newQty: 0,
      newAvg: 0,
      realizedPL,
    });
  }

  // 3) Positions in newSnap but NOT in prevSnap → fresh buy (full position).
  //    This is already handled by the loop above because prev=undefined
  //    means we skip in (1). Let's handle here explicitly.
  for (const k of Object.keys(newSnap)) {
    if (prevSnap[k]) continue;
    const cur = newSnap[k];
    const [market, symbol] = k.split('_');
    const mkt = (market as 'IN' | 'US');

    // Fresh buy — use avgPrice as buy price (it IS the buy price for a
    // brand-new position).
    newTxns.push({
      symbol,
      market: mkt,
      type: 'buy',
      qty: cur.qty,
      price: cur.avgPrice,
      amount: cur.qty * cur.avgPrice,
      date: cur.dateAdded || today,
      ts: now,
      prevQty: 0,
      prevAvg: 0,
      newQty: cur.qty,
      newAvg: cur.avgPrice,
    });
  }

  return { newTransactions: newTxns, newSnapshot: newSnap };
}

/**
 * Convenience: apply the diff to an existing transaction list,
 * deduplicating against transactions already recorded today for
 * the same symbol+type (so multiple portfolio syncs in one day
 * don't double-count).
 */
export function applyPortfolioDiff(
  current: Position[],
  existingTxns: Transaction[],
  livePrices: Record<string, PriceData>,
  usdInrRate: number
): { transactions: Transaction[]; snapshot: Snapshot; added: number } {
  const prevSnap = loadSnapshot();
  const { newTransactions, newSnapshot } = diffPortfolio(current, prevSnap, livePrices, usdInrRate);

  if (newTransactions.length === 0) {
    // Still save the snapshot so it stays current.
    saveSnapshot(newSnapshot);
    return { transactions: existingTxns, snapshot: newSnapshot, added: 0 };
  }

  // Dedup: skip a new txn if an existing txn already has the same
  // {symbol, type, date, qty, price} (within tolerance).
  const TOLERANCE = 1e-4;
  const filtered = newTransactions.filter(nt => {
    return !existingTxns.some(et =>
      et.symbol === nt.symbol &&
      et.type === nt.type &&
      et.date === nt.date &&
      Math.abs(et.qty - nt.qty) < TOLERANCE &&
      Math.abs(et.price - nt.price) / Math.max(1, nt.price) < 0.001
    );
  });

  const appended: Transaction[] = filtered.map((t, i) => ({
    ...t,
    id: `diff_${Date.now()}_${i}_${Math.random().toString(36).slice(2, 7)}`,
  }));

  saveSnapshot(newSnapshot);
  return {
    transactions: [...existingTxns, ...appended],
    snapshot: newSnapshot,
    added: appended.length,
  };
}

/**
 * Force-reset the snapshot — useful when the user wants to clear
 * the diff memory (e.g. after migrating data, or to stop auto-
 * recording). Exposed via the UI as a "Reset Memory" button.
 */
export function resetPortfolioSnapshot(): void {
  try { secureStorage.removeItem(SNAPSHOT_KEY); } catch { /* noop */ }
}
