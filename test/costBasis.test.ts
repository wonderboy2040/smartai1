// ============================================================
// test/costBasis.test.ts — v5.1 portfolio P&L truth fixes
// ------------------------------------------------------------
// Covers the user-reported INDmoney / CoinDCX mismatch fixes:
//   1. CoinDCX trade-history → avg-cost basis (computeCostBasis +
//      normalizeTrades, both API shapes, endpoint fallback).
//   2. mapBalancesToAssets with a basis → invested/pnl/pnlPct like
//      the CoinDCX app (8,485 invested / 1,513 pnl case).
//   3. assetPnl hasBasis semantics — a basis-less crypto row's value
//      must NEVER count as P&L (the "India Returns 35,372 vs app
//      25,376" bug = crypto value 10,000 leaked into the 🇮🇳 bucket).
//   4. summarizeAssets (visible-only server summary incl. oneDayChange).
//   5. The calculateMetrics bucketing replica: crypto rows (market 'IN')
//      go to the CRYPTO bucket, not the India INR sub-totals.
// ============================================================
import { describe, it, expect } from 'vitest';
import {
  normalizeTrades, computeCostBasis, mapBalancesToAssets, __resetCoinDcxForTests,
} from '../server/mcp/coindcx.js';
import { summarizeAssets } from '../server/mcp/portfolioSync.js';
import { syncedAssetPnl } from '../src/utils/assetPnl';
import { isCryptoSymbol } from '../src/utils/constants';
import type { Position } from '../src/types';

// ---- helpers -------------------------------------------------
function mkPos(over: Partial<Position>): Position {
  return {
    id: 'x', symbol: 'BTC', market: 'IN', qty: 1, avgPrice: 100, leverage: 1,
    dateAdded: '2026-01-01', ...over,
  } as Position;
}

beforeEach(() => { __resetCoinDcxForTests(); });

// ============================================================
// 1) normalizeTrades
// ============================================================
describe('normalizeTrades', () => {
  it('parses the executed-trades shape (side/market/quantity/price)', () => {
    const out = normalizeTrades([
      { side: 'buy', market: 'BTCINR', quantity: 0.000736, price: 9000000, fee: 20, timestamp: 1750000000000 },
      { side: 'sell', market: 'ETHINR', quantity: 0.001, price: 250000, fee: 1, timestamp: 1750000001000 },
    ]);
    expect(out).toHaveLength(2);
    expect(out[0]).toMatchObject({ side: 'buy', base: 'BTC', quote: 'INR', qty: 0.000736, price: 9000000, fee: 20 });
    expect(out[1]).toMatchObject({ side: 'sell', base: 'ETH', quote: 'INR', qty: 0.001, price: 250000 });
  });

  it('parses the order-history shape (filled = total − remaining, avg price, status filter)', () => {
    const out = normalizeTrades([
      { side: 'buy', market: 'ETHINR', total_quantity: 0.02, remaining_quantity: 0.002, average_price: 240000, status: 'complete', timestamp: 1 },
      { side: 'buy', market: 'BTCINR', total_quantity: 0.001, remaining_quantity: 0.001, price: 9000000, status: 'cancelled', timestamp: 2 },
      { side: 'buy', market: 'BTCINR', total_quantity: 0.001, remaining_quantity: 0.0005, average_price: 9100000, status: 'partially_filled', timestamp: 3 },
    ]);
    expect(out).toHaveLength(2); // cancelled order dropped
    expect(out[0]).toMatchObject({ base: 'ETH', price: 240000 });
    expect(out[0].qty).toBeCloseTo(0.018, 9);
    expect(out[1]).toMatchObject({ base: 'BTC', price: 9100000 });
    expect(out[1].qty).toBeCloseTo(0.0005, 9);
  });

  it('skips garbage: unknown quote, INR base, missing side/price, non-array wrappers', () => {
    const out = normalizeTrades([
      { side: 'buy', market: 'BTCUSDTXXX', quantity: 1, price: 1 },   // no known quote suffix
      { side: 'buy', market: 'INRINR', quantity: 1, price: 1 },        // INR base
      { market: 'BTCINR', quantity: 1, price: 1 },                     // no side
      { side: 'buy', market: 'BTCINR', quantity: 1 },                  // no price
      null, 'junk',
    ]);
    expect(out).toHaveLength(0);
  });

  it('accepts { orders: [...] } / { data: [...] } wrappers', () => {
    const a = normalizeTrades({ orders: [{ side: 'buy', market: 'BTCINR', quantity: 1, price: 100, timestamp: 1 }] });
    const b = normalizeTrades({ data: [{ side: 'sell', market: 'ETHINR', quantity: 2, price: 100, timestamp: 2 }] });
    expect(a).toHaveLength(1);
    expect(b).toHaveLength(1);
  });
});

// ============================================================
// 2) computeCostBasis (avg-cost walk)
// ============================================================
describe('computeCostBasis', () => {
  it('buy-only: invested = Σ qty·price + fees', () => {
    const basis = computeCostBasis([
      { side: 'buy', base: 'BTC', quote: 'INR', qty: 0.0005, price: 9000000, fee: 10, ts: 1 },
      { side: 'buy', base: 'BTC', quote: 'INR', qty: 0.000236, price: 8000000, fee: 6, ts: 2 },
    ]);
    // 4500 + 10 + 1888 + 6 = 6404
    expect(basis.BTC.invested).toBeCloseTo(6404, 2);
    expect(basis.BTC.qty).toBeCloseTo(0.000736, 9);
    expect(basis.BTC.avgPrice).toBeCloseTo(6404 / 0.000736, 0);
  });

  it('partial sell reduces basis at AVERAGE cost (not FIFO)', () => {
    const basis = computeCostBasis([
      { side: 'buy', base: 'ETH', quote: 'INR', qty: 2, price: 100, fee: 0, ts: 1 },
      { side: 'buy', base: 'ETH', quote: 'INR', qty: 2, price: 200, fee: 0, ts: 2 },
      { side: 'sell', base: 'ETH', quote: 'INR', qty: 1, price: 500, fee: 0, ts: 3 },
    ]);
    // avg cost = (200 + 400) / 4 = 150 → after selling 1: cost 450, qty 3
    expect(basis.ETH.qty).toBe(3);
    expect(basis.ETH.invested).toBe(450);
  });

  it('sell-to-zero resets the coin (later buys start fresh)', () => {
    const basis = computeCostBasis([
      { side: 'buy', base: 'BTC', quote: 'INR', qty: 1, price: 100, fee: 0, ts: 1 },
      { side: 'sell', base: 'BTC', quote: 'INR', qty: 1, price: 90, fee: 0, ts: 2 },
      { side: 'buy', base: 'BTC', quote: 'INR', qty: 1, price: 80, fee: 0, ts: 3 },
    ]);
    expect(basis.BTC.invested).toBe(80);
    expect(basis.BTC.qty).toBe(1);
  });

  it('overselling (ledger hole) is clamped to the known balance', () => {
    const basis = computeCostBasis([
      { side: 'buy', base: 'XRP', quote: 'INR', qty: 1, price: 100, fee: 0, ts: 1 },
      { side: 'sell', base: 'XRP', quote: 'INR', qty: 5, price: 100, fee: 0, ts: 2 },
    ]);
    expect(basis.XRP).toBeUndefined(); // fully closed → no basis row
  });

  it('USDT-quote trades convert at the passed usdInr', () => {
    const basis = computeCostBasis([
      { side: 'buy', base: 'SOL', quote: 'USDT', qty: 2, price: 150, fee: 1, ts: 1 },
    ], 95);
    expect(basis.SOL.invested).toBeCloseTo(2 * 150 * 95 + 1 * 95, 2);
  });

  it('chronological ordering is enforced regardless of input order', () => {
    const basis = computeCostBasis([
      { side: 'sell', base: 'BTC', quote: 'INR', qty: 1, price: 90, fee: 0, ts: 2 },
      { side: 'buy', base: 'BTC', quote: 'INR', qty: 2, price: 100, fee: 0, ts: 1 },
    ]);
    // buy 2@100 → sell 1@avg → qty 1, cost 100
    expect(basis.BTC.qty).toBe(1);
    expect(basis.BTC.invested).toBe(100);
  });
});

// ============================================================
// 3) mapBalancesToAssets with/without basis
// ============================================================
describe('mapBalancesToAssets (cost basis)', () => {
  const tickers = [
    { market: 'BTCINR', last_price: '7749225', change_24_hour: '0.53' },
    { market: 'ETHINR', last_price: '239431.2', change_24_hour: '-0.27' },
  ];
  const balances = [
    { base: 'BTC', qty: 0.000736, free: 0.000736, locked: 0 },
    { base: 'ETH', qty: 0.01794521012936, free: 0.01794521012936, locked: 0 },
  ];

  it('WITHOUT basis: invested/pnl/pnlPct stay null (honest)', () => {
    const assets = mapBalancesToAssets(balances, tickers, 94.9, null);
    expect(assets).toHaveLength(2);
    for (const a of assets) {
      expect(a.invested).toBeNull();
      expect(a.pnl).toBeNull();
      expect(a.pnlPct).toBeNull();
      expect(a.avgPrice).toBeNull();
      expect(a.market).toBe('IN');
      expect(a.source).toBe('coindcx');
    }
    expect(assets[0].value).toBeCloseTo(7749225 * 0.000736, 2); // ≈ 5703.43
  });

  it('WITH basis: invested/pnl/pnlPct like the CoinDCX app (₹8,485 → ≈₹1,515 pnl)', () => {
    // user's app: invested ₹8,485, value ₹9,999, PNL ₹1,513
    const basis = {
      BTC: { qty: 0.000736, invested: 5259.07, avgPrice: 7145470.11 },
      ETH: { qty: 0.01794521012936, invested: 3226.0, avgPrice: 179770.5 },
    };
    const assets = mapBalancesToAssets(balances, tickers, 94.9, basis);
    const totalInv = assets.reduce((s, a) => s + (a.invested || 0), 0);
    const totalVal = assets.reduce((s, a) => s + a.value, 0);
    const totalPnl = assets.reduce((s, a) => s + (a.pnl || 0), 0);
    expect(totalInv).toBeCloseTo(8485.07, 1);      // app: 8,485
    expect(totalVal).toBeCloseTo(10000.07, 1);     // app: 9,999
    expect(totalPnl).toBeCloseTo(1515.0, 1);       // app: 1,513
    expect(assets[0].pnlPct).toBeCloseTo((5703.43 - 5259.07) / 5259.07 * 100, 1);
  });

  it('a basis for a coin NOT in balances is ignored; basis with 0 invested ignored', () => {
    const assets = mapBalancesToAssets(
      [balances[0]],
      tickers,
      94.9,
      { DOGE: { qty: 5, invested: 100, avgPrice: 20 }, BTC: { qty: 0.000736, invested: 0, avgPrice: 0 } },
    );
    expect(assets).toHaveLength(1);
    expect(assets[0].invested).toBeNull();
  });
});

// ============================================================
// 4) assetPnl hasBasis semantics (the core regression)
// ============================================================
describe('syncedAssetPnl hasBasis', () => {
  it('INDMoney sync row (invested + pnl + lastPrice) → hasBasis true, anchor math', () => {
    const pos = mkPos({
      symbol: 'SMALLCAP', market: 'IN', qty: 1774,
      indmInvestedINR: 74986.98, indmPnlINR: 12009.98, indmLastPrice: 49.04, source: 'indmoney',
    });
    const t = syncedAssetPnl(pos, 49.04, 94.9); // no live tick yet
    expect(t.hasBasis).toBe(true);
    expect(t.pnl).toBeCloseTo(12009.98, 2);
    expect(t.value).toBeCloseTo(74986.98 + 12009.98, 2);
    expect(t.investedINR).toBeCloseTo(74986.98, 2);
  });

  it('CoinDCX row WITH basis flows through the sync-truth branch (anchor + delta)', () => {
    const pos = mkPos({
      symbol: 'BTC', market: 'IN', qty: 0.000736, source: 'coindcx',
      indmInvestedINR: 5259.07, indmPnlINR: 444.36, indmLastPrice: 7749225,
    });
    const t = syncedAssetPnl(pos, 7800000, 94.9); // live tick up
    expect(t.hasBasis).toBe(true);
    expect(t.pnl).toBeCloseTo(444.36 + (7800000 - 7749225) * 0.000736, 2);
    expect(t.pnlPct).toBeCloseTo((t.pnl / 5259.07) * 100, 1);
  });

  it('CoinDCX row WITHOUT basis → hasBasis false, pnl = drift only (never a return)', () => {
    const pos = mkPos({
      symbol: 'ETH', market: 'IN', qty: 0.01794521012936, source: 'coindcx',
      indmLastPrice: 239431.2, avgPrice: 239431.2,
    });
    const t = syncedAssetPnl(pos, 240000, 94.9);
    expect(t.hasBasis).toBe(false);
    expect(t.pnlINR).toBeCloseTo((240000 - 239431.2) * 0.01794521012936, 2); // small drift
    expect(t.investedINR).toBe(0);
    expect(t.valueINR).toBeCloseTo(240000 * 0.01794521012936, 1);
  });

  it('manual row → hasBasis true (avgPrice×qty is a real cost)', () => {
    const t = syncedAssetPnl(mkPos({ avgPrice: 100, qty: 5 }), 110, 94.9);
    expect(t.hasBasis).toBe(true);
    expect(t.pnl).toBe(50);
  });

  it('REGRESSION — the user bug: crypto VALUE must not leak into India returns', () => {
    // The exact live shape that produced "site 35,372 vs app 25,376":
    // 5 India ETFs (pnl Σ = 25,689.08 at sync prices) + 2 basis-less
    // CoinDCX rows (value Σ = 10,000.07) — the old metrics summed
    // value−invested with crypto in the IN bucket → 25,689 + 10,000.
    const ind = [
      { sym: 'MOMENTUM50', inv: 103380.5, pnl: 4855.6, lp: 54.39, qty: 1990 },
      { sym: 'SMALLCAP', inv: 74986.98, pnl: 12009.98, lp: 49.04, qty: 1774 },
      { sym: 'MID150BEES', inv: 73056.7, pnl: 6176.3, lp: 240.1, qty: 330 },
      { sym: 'JUNIORBEES', inv: 28839.4, pnl: 2760.6, lp: 790, qty: 40 },
      { sym: 'SETFNIF50', inv: 11725.65, pnl: -113.4, lp: 258.05, qty: 45 },
    ].map(x => mkPos({
      symbol: x.sym, market: 'IN', qty: x.qty, source: 'indmoney',
      indmInvestedINR: x.inv, indmPnlINR: x.pnl, indmLastPrice: x.lp,
    }));
    const cry = [
      { sym: 'BTC', lp: 7749225, qty: 0.000736 },
      { sym: 'ETH', lp: 239431.2, qty: 0.01794521012936 },
    ].map(x => mkPos({
      symbol: x.sym, market: 'IN', qty: x.qty, source: 'coindcx',
      avgPrice: x.lp, indmLastPrice: x.lp,
    }));
    const all = [...ind, ...cry];
    const rate = 94.873;

    // --- replica of the NEW calculateMetrics loop ---
    let totalValueINR = 0, totalInvestedINR = 0, totalPL = 0, totalValueCRYPTO = 0;
    for (const pos of all) {
      const t = syncedAssetPnl(pos, (pos as any).indmLastPrice!, rate); // sync moment
      const isCrypto = isCryptoSymbol(pos.symbol);
      if (isCrypto) totalValueCRYPTO += t.valueINR;
      else if (pos.market === 'IN') { totalInvestedINR += t.invested; totalValueINR += t.value; }
      if (t.hasBasis) totalPL += t.pnlINR;
    }

    // India bucket = app's INDIA section EXACTLY (no +10,000 crypto leak)
    expect(totalInvestedINR).toBeCloseTo(291989.23, 1);                      // app: 291,989.23
    expect(totalValueINR).toBeCloseTo(317678.31, 1);                         // app's sync value
    expect(totalValueINR - totalInvestedINR).toBeCloseTo(25689.08, 1);       // app returns ≈ 25,376
    expect(totalValueCRYPTO).toBeCloseTo(10000.07, 1);                       // crypto bucket separate
    expect(totalPL).toBeCloseTo(25689.08, 1);                                // basis-less crypto adds 0
    // the OLD buggy math would have been 35,689 — assert we are NOT that:
    expect(totalValueINR - totalInvestedINR).not.toBeCloseTo(35689, 0);
  });
});

// ============================================================
// 5) summarizeAssets (server /assets summary, visible-only)
// ============================================================
// ============================================================
// 6) fetchCoinDcxTrades endpoint fallback + fetchCoinDcxAssets e2e
//    (mocked REST: first endpoint 403 → next wins; balances+tickers+
//    trades merge into basis-carrying asset rows)
// ============================================================
describe('fetchCoinDcxTrades / fetchCoinDcxAssets (mocked REST)', () => {
  const TR = 'https://api.coindcx.com/exchange/v1/trades';
  const UT = 'https://api.coindcx.com/exchange/v1/users/trades';
  const BAL = 'https://api.coindcx.com/exchange/v1/users/balances';
  const TIC = 'https://api.coindcx.com/exchange/ticker';
  const realFetch = globalThis.fetch;

  afterEach(() => { globalThis.fetch = realFetch; });

  function res(json, status = 200) {
    return {
      ok: status >= 200 && status < 300,
      status,
      headers: new Map(),
      text: async () => JSON.stringify(json),
      json: async () => json,
    };
  }

  it('falls back to the next endpoint when the first is permission-denied (403)', async () => {
    const calls: string[] = [];
    globalThis.fetch = (async (url: string) => {
      calls.push(String(url));
      if (String(url) === TR) return res({ message: 'permission denied' }, 403);
      if (String(url) === UT) return res([
        { side: 'buy', market: 'BTCINR', quantity: 0.000736, price: 9000000, fee: 10, timestamp: 1 },
      ]);
      throw new Error('unexpected url ' + url);
    }) as any;
    const { __fetchCoinDcxTradesForTests } = await import('../server/mcp/coindcx.js');
    const out = await __fetchCoinDcxTradesForTests()('k', 's');
    expect(out.endpoint).toBe(UT.replace('https://api.coindcx.com', ''));
    expect(out.trades).toHaveLength(1);
    expect(out.trades[0]).toMatchObject({ base: 'BTC', qty: 0.000736, price: 9000000 });
    expect(calls[0]).toBe(TR);
    expect(calls[1]).toBe(UT);
  });

  it('returns null when every endpoint is denied (view-only key) — basis honestly absent', async () => {
    globalThis.fetch = (async (_url: string) => res({ message: 'denied' }, 403)) as any;
    const { __fetchCoinDcxTradesForTests } = await import('../server/mcp/coindcx.js');
    const out = await __fetchCoinDcxTradesForTests()('k', 's');
    expect(out).toBeNull();
  });

  it('fetchCoinDcxAssets merges balances + tickers + trades into basis-carrying rows', async () => {
    const { fetchCoinDcxAssets, __setCredsForTests } = await import('../server/mcp/coindcx.js');
    __setCredsForTests('key', 'secret');
    globalThis.fetch = (async (url: string) => {
      const u = String(url);
      if (u === BAL) return res([{ currency_short_name: 'BTC', balance: 0.000736 }]);
      if (u.startsWith(TIC)) return res([{ market: 'BTCINR', last_price: '7749225', change_24_hour: '0.53' }]);
      if (u === TR) return res([
        { side: 'buy', market: 'BTCINR', quantity: 0.0005, price: 9000000, fee: 10, timestamp: 1 },
        { side: 'buy', market: 'BTCINR', quantity: 0.000236, price: 8000000, fee: 6, timestamp: 2 },
      ]);
      return res([], 403); // any other path → denied (fallback safe)
    }) as any;

    const out = await fetchCoinDcxAssets(94.9);
    expect(out.balanceCount).toBe(1);
    expect(out.assets).toHaveLength(1);
    const row = out.assets[0];
    // basis: 0.0005×9000000+10 + 0.000236×8000000+6 = 6404
    expect(row.invested).toBeCloseTo(6404, 1);
    expect(row.pnl).toBeCloseTo(7749225 * 0.000736 - 6404, 1);
    expect(row.pnlPct).toBeCloseTo((row.value - 6404) / 6404 * 100, 1);
    expect(out.basis.BTC.invested).toBeCloseTo(6404, 1);
  });
});

// ============================================================
// 5) summarizeAssets (server /assets summary, visible-only)
// ============================================================
describe('summarizeAssets', () => {
  it('sums visible rows; basis-less crypto contributes value but NOT pnl', () => {
    const s = summarizeAssets([
      { value: 100, invested: 80, pnl: 20, oneDayChangePct: 1 },
      { value: 10, invested: null, pnl: null, oneDayChangePct: 2 }, // basis-less crypto
      { value: 50, invested: 60 },                                    // pnl via value−invested
    ]);
    expect(s.totalValue).toBe(160);
    expect(s.totalInvested).toBe(140);
    expect(s.totalPnl).toBe(10);  // 20 + (50−60) + 0 (no-basis row skipped)
    expect(s.totalPnlPct).toBeCloseTo(10 / 140 * 100, 2);
    expect(s.holdingCount).toBe(3);
    expect(s.withBasis).toBe(2);
    expect(s.oneDayChange).toBeCloseTo(1 + 0.2, 2);   // 100×1% + 10×2%
    expect(s.oneDayChangePct).toBeCloseTo(1.2 / 160 * 100, 2);
  });

  it('empty / null-safe', () => {
    const s = summarizeAssets([]);
    expect(s).toMatchObject({ totalValue: 0, totalInvested: 0, totalPnl: 0, holdingCount: 0 });
    expect(s.totalPnlPct).toBeNull();
    expect(s.oneDayChange).toBeNull();
    expect(summarizeAssets(null as any).holdingCount).toBe(0);
  });
});
