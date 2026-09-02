// ============================================================
// assetPnl.test — EXACT-MATCH P&L engine (v4.4)
// Verifies the sync-truth math that makes Portfolio Total P&L /
// Unrealized P&L match the INDMoney app (USA $ / India ₹).
// ============================================================
import { describe, it, expect } from 'vitest';
import { syncedAssetPnl } from '../src/utils/assetPnl';
import type { Position } from '../src/types';

const pos = (over: Partial<Position>): Position => ({
  id: 'x', symbol: 'TEST', market: 'IN', qty: 10, avgPrice: 100,
  leverage: 1, dateAdded: '2026-01-01', ...over,
});

describe('syncedAssetPnl — INDMoney synced rows (India)', () => {
  const RATE = 87;

  it('right after a sync (no live tick yet) → EXACTLY INDMoney pnl', () => {
    // invested ₹10,000, value ₹12,363.91 → INDMoney pnl ₹2,363.91
    const p = pos({
      symbol: 'RELIANCE', qty: 10, avgPrice: 1000,
      indmInvestedINR: 10000, indmPnlINR: 2363.91, indmPnlPct: 23.64,
      indmLastPrice: 1236.391, source: 'indmoney',
    });
    const r = syncedAssetPnl(p, 1236.391, RATE); // curPrice === sync price
    expect(r.synced).toBe(true);
    expect(r.pnl).toBeCloseTo(2363.91, 1);
    expect(r.invested).toBe(10000);
    expect(r.value).toBeCloseTo(12363.91, 1);
    expect(r.pnlPct).toBeCloseTo(23.64, 1);
  });

  it('a live tick ABOVE the sync price adds only the delta on top', () => {
    const p = pos({
      symbol: 'RELIANCE', qty: 10, avgPrice: 1000,
      indmInvestedINR: 10000, indmPnlINR: 2000, indmLastPrice: 1200, source: 'indmoney',
    });
    // live 1230 vs sync 1200 → +300 delta → 2000 + 300 = 2300
    const r = syncedAssetPnl(p, 1230, RATE);
    expect(r.pnl).toBeCloseTo(2300, 4);
    expect(r.value).toBeCloseTo(12300, 4);
  });

  it('a live tick BELOW the sync price subtracts the delta', () => {
    const p = pos({
      symbol: 'TCS', qty: 5, indmInvestedINR: 5000, indmPnlINR: 500, indmLastPrice: 1100, source: 'indmoney',
    });
    const r = syncedAssetPnl(p, 1080, RATE);
    expect(r.pnl).toBeCloseTo(500 + (1080 - 1100) * 5, 4); // 400
  });

  it('NAV rows (no live feed) anchor to the snapshot pnl verbatim', () => {
    const p = pos({
      symbol: 'PSEUDO_MF', qty: 100, avgPrice: 15, noLive: true,
      indmInvestedINR: 1500, indmPnlINR: 150, indmLastPrice: 16.5, source: 'indmoney',
    });
    const r = syncedAssetPnl(p, 16.5, RATE); // seed = sync price
    expect(r.pnl).toBeCloseTo(150, 4);
  });
});

describe('syncedAssetPnl — US rows (USD native + INR conversion)', () => {
  const RATE = 87;

  it('snapshot pnl converts INR→USD at the live rate (FX cancels)', () => {
    // INDMoney reports INR: invested ₹87,000, pnl ₹6,021 (= their $69.21 at 87)
    const p = pos({
      symbol: 'MU', market: 'US', qty: 10, avgPrice: 100, // avgPrice USD (sync-converted)
      indmInvestedINR: 87000, indmPnlINR: 6021, indmPnlPct: 6.92,
      indmLastPrice: 93.021, source: 'indmoney', // USD per unit (server-converted)
    });
    const r = syncedAssetPnl(p, 93.021, RATE); // no tick yet
    expect(r.synced).toBe(true);
    expect(r.invested).toBeCloseTo(1000, 1);      // ₹87,000 / 87
    expect(r.pnl).toBeCloseTo(6021 / 87, 3);      // ₹6,021 / 87 ≈ $69.21 bucket
    expect(r.pnlINR).toBeCloseTo(6021, 1);        // INR mirror stays exact
    expect(r.investedINR).toBeCloseTo(87000, 1);
  });

  it('live delta in USD layers on top of the converted snapshot pnl', () => {
    const p = pos({
      symbol: 'SPCX', market: 'US', qty: 20, avgPrice: 10,
      indmInvestedINR: 17400, indmPnlINR: 870, indmLastPrice: 9.565, source: 'indmoney',
    });
    // live 9.8 vs sync 9.565 → delta = 0.235 × 20 = $4.70
    const r = syncedAssetPnl(p, 9.8, RATE);
    expect(r.pnl).toBeCloseTo(870 / 87 + 4.7, 3); // $10 + $4.70
  });
});

describe('syncedAssetPnl — CoinDCX rows (no cost basis)', () => {
  it('shows the pure live delta since the balance sync, pnlPct null', () => {
    const p = pos({
      symbol: 'BTC', qty: 0.5, avgPrice: 5000000, source: 'coindcx',
      indmLastPrice: 5000000, indmInvestedINR: undefined, indmPnlINR: undefined,
    });
    const r = syncedAssetPnl(p, 5100000, 87);
    expect(r.synced).toBe(true);
    expect(r.pnl).toBeCloseTo(0.5 * 100000, 2); // +₹50,000
    expect(r.pnlPct).toBeNull();
    expect(r.invested).toBe(0);
  });
});

describe('syncedAssetPnl — manual rows (legacy math intact)', () => {
  it('plain buy: pnl = live − cost, leverage-aware equity', () => {
    const p = pos({ symbol: 'WIPRO', qty: 100, avgPrice: 400 });
    const r = syncedAssetPnl(p, 450, 87);
    expect(r.synced).toBe(false);
    expect(r.pnl).toBe(5000);
    expect(r.invested).toBe(40000);
    expect(r.value).toBe(45000);
    expect(r.pnlPct).toBeCloseTo(12.5, 4);
  });

  it('leveraged row: invested = posSize / leverage (equity math)', () => {
    const p = pos({ symbol: 'X', qty: 10, avgPrice: 100, leverage: 2 });
    const r = syncedAssetPnl(p, 110, 87);
    expect(r.invested).toBe(500);
    expect(r.pnl).toBe(100);
    expect(r.value).toBe(600); // inv + pnl
  });
});
