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
    // v5.2: US value = qty × price (value-consistent lastPrice fixture —
    // (invested+pnl)/qty/rate, exactly how the server derives it).
    const p = pos({
      symbol: 'MU', market: 'US', qty: 10, avgPrice: 100, // avgPrice USD (sync-converted)
      indmInvestedINR: 87000, indmPnlINR: 6021, indmPnlPct: 6.92,
      indmLastPrice: 93021 / 10 / 87, source: 'indmoney', // USD per unit (server-converted)
    });
    const r = syncedAssetPnl(p, 93021 / 10 / 87, RATE); // no tick yet
    expect(r.synced).toBe(true);
    expect(r.invested).toBeCloseTo(1000, 1);      // ₹87,000 / 87
    expect(r.pnl).toBeCloseTo(6021 / 87, 3);      // ₹6,021 / 87 ≈ $69.21 bucket
    expect(r.pnlINR).toBeCloseTo(6021, 1);        // INR mirror stays exact
    expect(r.investedINR).toBeCloseTo(87000, 1);
  });

  it('live delta in USD layers on top of the converted snapshot pnl', () => {
    // sync price = (17400+870)/20/87 = $10.5; live 10.735 → +0.235 × 20 = $4.70
    const p = pos({
      symbol: 'SPCX', market: 'US', qty: 20, avgPrice: 10,
      indmInvestedINR: 17400, indmPnlINR: 870, indmLastPrice: 18270 / 20 / 87, source: 'indmoney',
    });
    const r = syncedAssetPnl(p, 10.735, RATE);
    expect(r.pnl).toBeCloseTo(870 / 87 + 4.7, 3); // $10 + $4.70
  });

  it('v5.2 APP-PARITY: invested converts at the calibrated app rate, value stays live — the 🦅 $118 vs app $60.31 bug', () => {
    // THE user case (live-verified numbers): INDMoney reports INR invested
    // ₹86,631.66 for SMH. Their app shows USD invested at ITS internal rate
    // (~92.0, buy-time FX) — NOT the live rate (94.89). The old code divided
    // by live FX → USD invested understated → the 🦅 P&L chip overstated by
    // the FX gain (~$50 on a $1,600 portfolio). With investedRate = the
    // calibrated rate, invested/pnl match the app; value stays live USD.
    const p = pos({
      symbol: 'SMH', market: 'US', qty: 1.9241956, avgPrice: 474.46,
      indmInvestedINR: 86631.66, indmPnlINR: 12782.95, indmLastPrice: 544.46, source: 'indmoney',
    });
    const r = syncedAssetPnl(p, 544.46, 94.892, 92.0006);
    expect(r.invested).toBeCloseTo(86631.66 / 92.0006, 2);   // ≈ $941.64 (app world)
    expect(r.value).toBeCloseTo(544.46 * 1.9241956, 2);      // live USD value
    expect(r.investedINR).toBeCloseTo(86631.66, 2);          // EXACT INDMoney INR mirror
    expect(r.pnl).toBeCloseTo(544.46 * 1.9241956 - 86631.66 / 92.0006, 2); // stock-only, app-style
    // and WITHOUT calibration the old FX-mixed behavior is preserved:
    const r2 = syncedAssetPnl(p, 544.46, 94.892);
    expect(r2.invested).toBeCloseTo(86631.66 / 94.892, 2);   // live-FX invested (legacy)
    expect(r2.pnl).toBeCloseTo(544.46 * 1.9241956 - 86631.66 / 94.892, 2);
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
