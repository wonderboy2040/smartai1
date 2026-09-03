// ============================================================
// assetPnl — SYNC-TRUTH P&L ENGINE (v4.4 exact-match pass)
// ------------------------------------------------------------
// PROBLEM (user-reported): after an INDMoney MCP sync, the site's
// Total P&L / Unrealized P&L showed MORE than INDMoney's own app
// (USA: $69.21, India: ₹23,639.10). Root cause: the UI recomputed
// P&L from `livePrice*qty − avgPrice*qty`, mixing THREE price
// worlds — the live quote (Yahoo/Groww/TV), the sync snapshot
// price, and an FX-converted cost basis — none of which equal
// INDMoney's own `market_value − invested_amount`.
//
// FIX: ground every synced row's P&L in the SERVER SNAPSHOT
// (INDMoney's own numbers) and layer ONLY the live-price delta
// since that snapshot on top:
//
//   pnl(native) = indmPnlINR[/rate]  +  (livePrice − syncPrice) × qty
//
// Right after a sync the delta is 0 → the numbers EXACTLY match
// the INDMoney app. As ticks arrive, P&L moves tick-by-tick from
// that anchor (never re-basing on a different cost/FX world).
// NAV rows (MF/FD/bonds) and CoinDCX rows without a cost basis
// keep well-defined behavior (see below). Manual rows use the
// legacy math untouched.
// ============================================================
import type { Position } from '../types';

export interface PnlBreakdown {
  /** Unrealized P&L in the position's NATIVE currency (INR for IN, USD for US). */
  pnl: number;
  /** Cost basis in native currency (sync-truth when available). */
  invested: number;
  /** Current value in native currency = invested + pnl. */
  value: number;
  /** P&L % against the cost basis (null when no cost basis exists). */
  pnlPct: number | null;
  /** true = grounded in the sync snapshot (INDMoney/CoinDCX truth). */
  synced: boolean;
  /** true = a real cost basis exists → the pnl is a genuine unrealized
   *  number. false (CoinDCX rows without trade-history basis) means pnl
   *  is only sync-drift — it must NEVER be counted into portfolio P&L
   *  totals (that bug showed +₹10k of crypto VALUE as India RETURNS). */
  hasBasis: boolean;
  /** INR value of the position (native × live FX for US rows). */
  valueINR: number;
  /** INR unrealized P&L (native × live FX for US rows). */
  pnlINR: number;
  /** INR cost basis (native × live FX for US rows). */
  investedINR: number;
}

/**
 * Exact per-asset P&L for a synced (or manual) position.
 * @param pos    the portfolio row
 * @param curPrice live price in native currency (fallback = pos.avgPrice)
 * @param rate   live USD/INR rate (used only for US rows)
 */
export function syncedAssetPnl(pos: Position, curPrice: number, rate: number): PnlBreakdown {
  const isUS = pos.market === 'US';
  const fx = isUS ? (rate > 0 ? rate : 1) : 1;
  const qty = pos.qty || 0;
  const lev = pos.leverage || 1;

  // ---- synced rows: snapshot truth + live delta ----
  const hasSyncPnl = typeof pos.indmPnlINR === 'number' && Number.isFinite(pos.indmPnlINR);
  const hasSyncInvested = typeof pos.indmInvestedINR === 'number' && pos.indmInvestedINR > 0;

  if ((hasSyncPnl || hasSyncInvested) && typeof pos.indmLastPrice === 'number' && pos.indmLastPrice > 0) {
    // INDMoney reports INR natively; US rows' snapshot fields were already
    // unit-converted server-side (per-unit prices in USD, INR aggregates).
    // `indmPnlINR`/`indmInvestedINR` are INR aggregates → convert to native.
    // CoinDCX rows WITH a trade-history basis flow through here too (their
    // invested/pnl/lastPrice are set server-side, market = IN).
    const basePnl = hasSyncPnl ? (pos.indmPnlINR as number) / fx : null;
    const invested = hasSyncInvested ? (pos.indmInvestedINR as number) / fx : null;
    const syncPrice = pos.indmLastPrice; // native per-unit price at sync

    // Live delta since the snapshot (0 for NAV rows & pre-tick seeds —
    // the seed IS the sync price, so the math collapses to the snapshot).
    const delta = (curPrice - syncPrice) * qty;

    const pnl = basePnl != null ? basePnl + delta : (invested != null ? (curPrice * qty - invested) : delta);
    const value = invested != null ? invested + pnl : (basePnl != null ? (pos.indmLastPrice + (curPrice - pos.indmLastPrice)) * qty : curPrice * qty);
    const pnlPct = invested != null && invested > 0 ? (pnl / invested) * 100 : (pos.indmPnlPct != null ? pos.indmPnlPct : null);
    return {
      pnl, invested: invested ?? 0, value, pnlPct, synced: true,
      hasBasis: hasSyncInvested || hasSyncPnl,
      pnlINR: pnl * fx, investedINR: (invested ?? 0) * fx, valueINR: value * fx,
    };
  }

  // ---- CoinDCX rows (no cost basis): drift-only, NEVER counted as P&L ----
  // pnl here is just movement since the sync snapshot — with no trade
  // history there is no cost basis, so portfolio P&L totals must skip it
  // (hasBasis: false) and the UI shows "P&L n/a" instead of a fake number.
  if (pos.source === 'coindcx' && typeof pos.indmLastPrice === 'number' && pos.indmLastPrice > 0) {
    const delta = (curPrice - pos.indmLastPrice) * qty;
    return {
      pnl: delta, invested: 0, value: curPrice * qty, pnlPct: null, synced: true,
      hasBasis: false,
      pnlINR: delta, investedINR: 0, valueINR: curPrice * qty, // IN market (INR pairs)
    };
  }

  // ---- manual rows: legacy math (leverage-aware) ----
  const posSize = pos.avgPrice * qty;
  const inv = posSize / lev;
  const curVal = curPrice * qty;
  const eqVal = inv + (curVal - posSize);
  const pl = curVal - posSize;
  return {
    pnl: pl, invested: inv, value: eqVal,
    pnlPct: inv > 0 ? (pl / inv) * 100 : 0, synced: false,
    hasBasis: posSize > 0,
    pnlINR: pl * fx, investedINR: inv * fx, valueINR: eqVal * fx,
  };
}

/** Live price for a position (seed/live quote with avgPrice fallback). */
export function livePriceFor(pos: Position, data?: { price?: number } | null): number {
  return data?.price || pos.avgPrice;
}
