// ============================================================
// test/globalFuturesRt.test.ts — v10.7 COINDCX GLOBAL FUTURES
// RT-FEED PRICING (app-parity) regression suite.
//
// THE BUG (user report): the Global Equity SIM desk priced every
// symbol from Yahoo stock spot — AAPL showed 332.27 (frozen outside
// US market hours) while the CoinDCX app showed 333.62 USDC (the
// live 24/7 USDC-margined perp LTP). Positions P&L/SL/TP were
// frozen the same way.
//
// THE CONTRACT (locked here):
//   • fetchGlobalFuturesRt() tries every plausible USDC param shape
//     and accepts a variant ONLY with >= 3 live B-<BASE>_USDC rows;
//     the working variant is STICKY (no re-probe per poll).
//   • total failure → 60s negative cache (ONE probe round per
//     minute, never one per poll — the v10.6.1 wick lesson).
//   • fetchGlobalQuotes() prices from the RT feed FIRST (source
//     'coindcx-usdc', feed's own 24h changePct), Yahoo fills ONLY
//     the uncovered symbols, SPACEX stays sim.
//   • buildGlobalCtxSync carries the honest priceSource.
//   • markets view exposes the CoinDCX pair (B-AAPL_USDC).
// ============================================================
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// refreshGlobalUniverse is NOT under test here — keep the universe seed-only
vi.mock('../server/mcp/coindcx.js', () => ({
  coindcxConnected: () => false,
  coindcxPrivate: vi.fn(),
  coindcxPrivateGET: vi.fn(),
  coindcxStatus: () => ({ connected: false }),
  fetchGlobalFuturesInstruments: vi.fn(async () => []),
}));

import {
  fetchGlobalFuturesRt, fetchGlobalQuotes, buildGlobalCtxSync,
  globalFuturesMarketsView, syntheticCandles,
  __resetGlobalForTests, __globalRtStateForTests,
} from '../server/ai/globalFutures.js';

const origFetch = globalThis.fetch;

// ---------------- payloads ----------------
const rtRow = (ls, pc = 0.4) => ({ ls, mp: ls * 0.9999, pc, h: ls * 1.01, l: ls * 0.99, v: 1_234_567 });
const RT_USDC_PAYLOAD = {
  ts: Date.now(),
  prices: {
    'B-AAPL_USDC': rtRow(333.62),
    'B-TSLA_USDC': rtRow(412.05),
    'B-NVDA_USDC': rtRow(196.4),
    'B-MSFT_USDC': rtRow(498.11),
  },
};
const RT_USDT_ONLY_PAYLOAD = {
  ts: Date.now(),
  prices: {
    'B-BTC_USDT': rtRow(77000.1),
    'B-ETH_USDT': rtRow(3900.2),
    'B-XAU_USDT': rtRow(4277.4),
  },
};
const yahooChart = (price, prev) => ({
  chart: { result: [{ meta: { regularMarketPrice: price, chartPreviousClose: prev } }] },
});

// ---------------- fetch routing ----------------
function routeFetch(handler: (url: string) => { ok: boolean; status: number; json: () => Promise<unknown> } | null) {
  globalThis.fetch = vi.fn(async (url: any) => {
    const r = handler(String(url));
    if (!r) return { ok: true, status: 200, json: async () => ({}), text: async () => '{}' };
    return { ...r, text: async () => JSON.stringify({}) };
  }) as any;
}

beforeEach(() => {
  __resetGlobalForTests();
});

afterEach(() => {
  globalThis.fetch = origFetch;
});

// ============================================================
// the RT probe itself
// ============================================================
describe('fetchGlobalFuturesRt — variant probing + validation', () => {
  it('prices from the CoinDCX USDC RT feed (the exact LTP the app shows)', async () => {
    routeFetch((u) => {
      if (u.includes('current_prices/futures/rt') && u.includes('margin_currency_short_name=USDC')) {
        return { ok: true, status: 200, json: async () => RT_USDC_PAYLOAD };
      }
      return null;
    });
    const rt = await fetchGlobalFuturesRt();
    expect(rt).toBeTruthy();
    expect(rt.get('AAPL')).toMatchObject({ price: 333.62, source: 'coindcx-usdc', pair: 'B-AAPL_USDC' });
    expect(rt.get('AAPL').mark).toBeGreaterThan(333);
    expect(rt.get('AAPL').changePct).toBe(0.4);
  });

  it('falls through to the array-style param when the scalar one 403s, and the working variant is STICKY', async () => {
    let scalarCalls = 0;
    routeFetch((u) => {
      if (u.includes('margin_currency_short_name=USDC') && !u.includes('%5B%5D') && !u.includes('%5B')) {
        scalarCalls += 1;
        return { ok: false, status: 403, json: async () => ({}) };
      }
      if (u.includes('USDC')) { // array shape
        return { ok: true, status: 200, json: async () => RT_USDC_PAYLOAD };
      }
      return null;
    });
    const rt = await fetchGlobalFuturesRt();
    expect(rt?.get('TSLA')?.price).toBe(412.05);
    expect(scalarCalls).toBe(1);
    // next fresh probe reuses the sticky array variant — scalar never re-tried
    await fetchGlobalFuturesRt({ maxAgeMs: 0 });
    expect(scalarCalls).toBe(1);
  });

  it('a payload with ZERO USDC rows is REJECTED (a USDT-only response is not the global domain)', async () => {
    routeFetch(() => ({ ok: true, status: 200, json: async () => RT_USDT_ONLY_PAYLOAD }));
    const rt = await fetchGlobalFuturesRt();
    expect(rt).toBeNull();
    expect(__globalRtStateForTests().down).toBe(true); // negative cache armed
  });

  it('total failure arms the 60s negative cache — ONE probe round, not one per poll', async () => {
    let calls = 0;
    globalThis.fetch = vi.fn(async () => { calls += 1; return { ok: false, status: 403, json: async () => ({}), text: async () => '' }; }) as any;
    expect(await fetchGlobalFuturesRt()).toBeNull();
    const callsAfterProbe = calls;
    expect(callsAfterProbe).toBe(3); // scalar + array + combined = one full round
    expect(await fetchGlobalFuturesRt()).toBeNull();
    expect(await fetchGlobalFuturesRt()).toBeNull();
    expect(calls).toBe(callsAfterProbe); // negative cache served both
  });

  it('dark rows (ls=0) are skipped — illiquid USDC perps never zero a price', async () => {
    const payload = { ts: Date.now(), prices: {
      'B-AAPL_USDC': rtRow(333.62),
      'B-TSLA_USDC': { ...rtRow(0), ls: 0 },
      'B-NVDA_USDC': rtRow(196.4),
      'B-MSFT_USDC': rtRow(498.11),
    } };
    routeFetch((u) => (u.includes('current_prices/futures/rt') ? { ok: true, status: 200, json: async () => payload } : null));
    const rt = await fetchGlobalFuturesRt();
    expect(rt?.has('TSLA')).toBe(false);
    expect(rt?.get('AAPL')?.price).toBe(333.62);
  });
});

// ============================================================
// the quotes merge — RT first, Yahoo fills gaps, sim stays sim
// ============================================================
describe('fetchGlobalQuotes — CoinDCX RT wins, Yahoo fills ONLY the gaps', () => {
  it('RT-covered symbols price from the feed; uncovered ones from Yahoo; SPACEX stays sim', async () => {
    routeFetch((u) => {
      if (u.includes('current_prices/futures/rt') && u.includes('USDC')) {
        // feed covers AAPL + NVDA only
        return { ok: true, status: 200, json: async () => ({ ts: Date.now(), prices: {
          'B-AAPL_USDC': rtRow(333.62), 'B-NVDA_USDC': rtRow(196.4), 'B-TSLA_USDC': rtRow(412.05),
        } }) };
      }
      if (u.includes('query1.finance.yahoo.com')) {
        const m = u.match(/chart\/([A-Z0-9.-]+)\?/);
        const sym = m ? m[1] : null;
        // Yahoo's AAPL is STALE (332.27 — the bug's number): must NOT win
        if (sym === 'AAPL') return { ok: true, status: 200, json: async () => yahooChart(332.27, 330) };
        return { ok: true, status: 200, json: async () => yahooChart(100, 99) };
      }
      return null;
    });
    const q = await fetchGlobalQuotes({ maxAgeMs: 0 });
    // the headline case: AAPL = the CoinDCX app's LTP, not Yahoo's stale spot
    expect(q.get('AAPL')).toMatchObject({ price: 333.62, source: 'coindcx-usdc', sim: false });
    expect(q.get('AAPL').dcxPair).toBe('B-AAPL_USDC');
    // uncovered symbol → honest Yahoo fallback
    expect(q.get('MU')).toMatchObject({ source: 'yahoo', sim: false });
    expect(q.get('MU').price).toBe(100);
    // SPACEX stays the labeled sim
    expect(q.get('SPACEX')).toMatchObject({ source: 'sim', sim: true });
  });

  it('feed DOWN → full Yahoo fallback (the desk never goes dark)', async () => {
    routeFetch((u) => {
      if (u.includes('current_prices/futures/rt')) return { ok: false, status: 403, json: async () => ({}) };
      if (u.includes('query1.finance.yahoo.com')) {
        return { ok: true, status: 200, json: async () => yahooChart(227.5, 225) };
      }
      return null;
    });
    const q = await fetchGlobalQuotes({ maxAgeMs: 0 });
    expect(q.get('AAPL')).toMatchObject({ price: 227.5, source: 'yahoo', sim: false });
    expect(q.size).toBeGreaterThan(10);
  });

  it('buildGlobalCtxSync carries the honest per-source priceSource', () => {
    const candles = syntheticCandles('SPACEX');
    const rtx = buildGlobalCtxSync('NVDA', { price: 196.4, changePct: 0.4, source: 'coindcx-usdc', sim: false }, candles, {});
    expect(rtx.priceSource).toBe('coindcx-usdc');
    expect(rtx.ltp).toBe(196.4);
    const yh = buildGlobalCtxSync('NVDA', { price: 196.1, changePct: 0.3, sim: false }, candles, {});
    expect(yh.priceSource).toBe('yahoo-1h');
    const sim = buildGlobalCtxSync('SPACEX', { price: 185, sim: true }, candles, {});
    expect(sim.priceSource).toBe('synthetic-sim');
  });

  it('markets view exposes the CoinDCX pair on RT-priced rows', async () => {
    routeFetch((u) => {
      if (u.includes('current_prices/futures/rt') && u.includes('USDC')) {
        return { ok: true, status: 200, json: async () => RT_USDC_PAYLOAD };
      }
      if (u.includes('query1.finance.yahoo.com')) {
        return { ok: true, status: 200, json: async () => yahooChart(100, 99) };
      }
      return null;
    });
    const view = await globalFuturesMarketsView();
    const aapl = view.markets.find((m: any) => m.symbol === 'AAPL');
    expect(aapl.last).toBe(333.62);
    expect(aapl.dcxPair).toBe('B-AAPL_USDC');
    expect(aapl.source).toBe('coindcx-usdc');
    // Yahoo-priced row keeps dcxPair null (never invented)
    const mu = view.markets.find((m: any) => m.symbol === 'MU');
    expect(mu.source).toBe('yahoo');
    expect(mu.dcxPair).toBeNull();
  });
});

// ============================================================
// single-flight — concurrent callers share ONE probe
// ============================================================
describe('fetchGlobalFuturesRt — single-flight', () => {
  it('concurrent callers share one probe round (no fetch stampede)', async () => {
    let inflight = 0, peak = 0;
    globalThis.fetch = vi.fn(async (url: any) => {
      inflight += 1; peak = Math.max(peak, inflight);
      await new Promise((r) => setTimeout(r, 20));
      inflight -= 1;
      const u = String(url);
      if (u.includes('margin_currency_short_name=USDC') && !u.includes('%5B')) {
        return { ok: true, status: 200, json: async () => RT_USDC_PAYLOAD };
      }
      return { ok: false, status: 404, json: async () => ({}) };
    }) as any;
    const [a, b, c] = await Promise.all([
      fetchGlobalFuturesRt({ maxAgeMs: 0 }),
      fetchGlobalFuturesRt({ maxAgeMs: 0 }),
      fetchGlobalFuturesRt({ maxAgeMs: 0 }),
    ]);
    expect(a?.get('AAPL')?.price).toBe(333.62);
    expect(b?.get('AAPL')?.price).toBe(333.62);
    expect(c?.get('AAPL')?.price).toBe(333.62);
    expect(peak).toBe(1); // ONE request in flight at a time — shared probe
  });
});

// ============================================================
// the probe deadline — a HUNG upstream must never stall the caller
// ============================================================
describe('fetchGlobalFuturesRt — probe deadline (positions realtime guarantee)', () => {
  it('a hanging feed resolves null within the deadline budget, then negative-caches', async () => {
    globalThis.fetch = vi.fn(() => new Promise(() => { /* never resolves — worst case */ })) as any;
    const t0 = Date.now();
    const rt = await fetchGlobalFuturesRt({ maxAgeMs: 0 });
    const took = Date.now() - t0;
    expect(rt).toBeNull();
    expect(took).toBeLessThan(10_000);   // ≤6s deadline (+ CI slack)
    expect(took).toBeGreaterThanOrEqual(4_000); // the deadline did the cutting, not luck
    // the negative cache is armed — the next call is INSTANT null
    const t1 = Date.now();
    expect(await fetchGlobalFuturesRt()).toBeNull();
    expect(Date.now() - t1).toBeLessThan(500);
  }, 20_000);
});
