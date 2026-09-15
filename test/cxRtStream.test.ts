// ============================================================
// test/cxRtStream.test.ts — v10.10 COINDCX DIRECT ULTRA-FAST RT
// ------------------------------------------------------------
// THE BUG (user report): "SPOT, Global Futures & Equity SIM USDC —
// ye tino section me realtime prices fetch nahi ho rahe, isliye
// wrong call or signal show ho rahe hai."
//
// THE CONTRACT (locked here):
//   • /api/stream?…&fut=BTC,ETH subscribes FUT_<BASE> keys — the 2s
//     DIRECT CoinDCX USDT-perp poll (public.coindcx.com RT feed)
//     writes ticks into liveFeed with source 'coindcx-fut-rt'.
//   • /api/stream?…&glob=AAPL,SPACEX subscribes GLOB_<SYM> keys —
//     the CoinDCX USDC equity-perp RT wins first (source
//     'coindcx-glob-rt'); names the RT feed doesn't carry fall back
//     to Yahoo (10s cadence, source 'yahoo-global-rt'); SIM names
//     (SPACEX — no public price BY DESIGN) tick from the
//     deterministic synthetic walk (source 'global-sim-rt').
//   • refcounted subscriptions + idle-stop: no client → no timer;
//     release → graceful eviction after 90s.
//   • the futures RT fetch is single-flight (board compute + stream
//     share ONE upstream round-trip).
// ============================================================
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

const mockPrivate = vi.fn();
const mockPrivateGET = vi.fn();
vi.mock('../server/mcp/coindcx.js', () => ({
  coindcxPrivate: (...args) => mockPrivate(...args),
  coindcxPrivateGET: (...args) => mockPrivateGET(...args),
  coindcxConnected: () => false,
  coindcxStatus: () => ({ connected: false }),
  fetchGlobalFuturesInstruments: vi.fn(async () => []),
}));

import {
  ensureCxRtSubscribed, releaseCxRtSubscribed, cxRtClientUp, cxRtClientDown,
  _resetCxRtForTest, _cxRtStateForTest,
} from '../server/ai/cxRtStream.js';
import { fetchFuturesPrices } from '../server/ai/futures.js';
import { __resetFuturesForTests } from '../server/ai/futures.js';
import { __resetGlobalForTests, syntheticPriceAt } from '../server/ai/globalFutures.js';
import { getTick } from '../server/liveFeed.js';

const origFetch = globalThis.fetch;

// ---------------- payloads ----------------
const futRow = (ls, pc = 1.5) => ({ ls, mp: ls * 0.9999, pc, h: ls * 1.01, l: ls * 0.99, v: 12_345 });
const FUT_USDT_PAYLOAD = {
  ts: Date.now(),
  prices: {
    'B-BTC_USDT': futRow(50_000, 2.5),
    'B-ETH_USDT': futRow(3_000, -1.2),
    'B-SOL_USDT': futRow(148.55, 4.1),
  },
};
const globRow = (ls, pc = 0.4) => ({ ls, mp: ls * 0.9999, pc, h: ls * 1.01, l: ls * 0.99, v: 987_654 });
const GLOB_USDC_PAYLOAD = {
  ts: Date.now(),
  prices: {
    'B-AAPL_USDC': globRow(333.62),
    'B-TSLA_USDC': globRow(412.05),
    'B-NVDA_USDC': globRow(196.4),
    'B-MSFT_USDC': globRow(498.11),
  },
};
const yahooChart = (price, prev) => ({
  chart: { result: [{ meta: { regularMarketPrice: price, chartPreviousClose: prev } }] },
});

// ---------------- fetch routing ----------------
// Both desks share https://public.coindcx.com/market_data/v3/current_prices/futures/rt —
// the GLOBAL probe carries a margin_currency param, the USDT perp feed doesn't.
function routeFetch(handler: (url: string) => { ok: boolean; status: number; json: () => Promise<unknown> } | null) {
  globalThis.fetch = vi.fn(async (url: any) => {
    const r = handler(String(url));
    if (!r) return { ok: true, status: 200, json: async () => ({}), text: async () => '{}' };
    return { ...r, text: async () => JSON.stringify({}) };
  }) as any;
}

const settle = () => new Promise(r => setTimeout(r, 30));

beforeEach(() => {
  _resetCxRtForTest();
  __resetFuturesForTests();
  __resetGlobalForTests();
});

afterEach(() => {
  _resetCxRtForTest();
  globalThis.fetch = origFetch;
});

describe('cxRtStream — USDT perp domain (FUT_ keys, 2s direct CoinDCX)', () => {
  it('subscribes, polls immediately and writes liveFeed ticks for the subscribed bases', async () => {
    routeFetch(url => {
      if (url.includes('current_prices/futures/rt') && !url.includes('margin_currency')) {
        return { ok: true, status: 200, json: async () => FUT_USDT_PAYLOAD };
      }
      return null;
    });
    ensureCxRtSubscribed({ fut: ['BTC', 'ETH'] });
    cxRtClientUp(); // ← fires the first poll instantly
    await vi.waitFor(() => expect(getTick('FUT_BTC')).toBeTruthy());

    const btc = getTick('FUT_BTC')!;
    expect(btc.price).toBeCloseTo(50_000, 6);
    expect(btc.source).toBe('coindcx-fut-rt');
    expect(btc.change).toBeCloseTo(2.5, 6);
    expect(btc.high).toBeGreaterThan(btc.price);
    expect(btc.low).toBeLessThan(btc.price);
    // 24h prevClose derived from changePct: price / (1 + pc/100)
    expect(btc.prevClose).toBeCloseTo(50_000 / 1.025, 4);

    const eth = getTick('FUT_ETH')!;
    expect(eth.price).toBeCloseTo(3_000, 6);
    expect(eth.source).toBe('coindcx-fut-rt');

    // NOT subscribed → no tick (the refcounted set is the contract)
    expect(getTick('FUT_SOL')).toBeNull();

    cxRtClientDown();
    expect(_cxRtStateForTest().timer).toBe(false); // idle-stop: no client → no timer
  });

  it('is single-flight: two concurrent fetchFuturesPrices calls share ONE upstream round-trip', async () => {
    let hits = 0;
    routeFetch(url => {
      if (url.includes('current_prices/futures/rt') && !url.includes('margin_currency')) {
        hits++;
        return { ok: true, status: 200, json: async () => FUT_USDT_PAYLOAD };
      }
      return null;
    });
    const [a, b] = await Promise.all([
      fetchFuturesPrices({ maxAgeMs: 0 }),
      fetchFuturesPrices({ maxAgeMs: 0 }),
    ]);
    expect(a).toBe(b); // same cached rows object
    expect(hits).toBe(1); // ONE upstream call for both consumers
  });

  it('falls back to Binance USDT perps (honest label) when CoinDCX RT goes dark', async () => {
    routeFetch(url => {
      if (url.includes('current_prices/futures/rt') && !url.includes('margin_currency')) {
        return { ok: false, status: 403, json: async () => ({}) }; // WAF block
      }
      if (url.includes('fapi.binance.com')) {
        return {
          ok: true, status: 200,
          json: async () => ([
            { symbol: 'BTCUSDT', lastPrice: '61000.5', priceChangePercent: '1.1', highPrice: '61500', lowPrice: '60200', volume: '21000.5' },
            { symbol: 'ETHUSDT', lastPrice: '3120.75', priceChangePercent: '-0.4', highPrice: '3150', lowPrice: '3080', volume: '15000.2' },
          ]),
        };
      }
      return null;
    });
    ensureCxRtSubscribed({ fut: ['BTC', 'ETH'] });
    cxRtClientUp();
    // NOTE: wait on the SOURCE, not just presence — liveFeed has no reset
    // hook, so FUT_BTC may still hold test-1's 'coindcx-fut-rt' tick when
    // this test starts. The Binance tick must actually LAND and overwrite.
    await vi.waitFor(() => expect(getTick('FUT_BTC')?.source).toBe('binance-fut-rt'));

    const btc = getTick('FUT_BTC')!;
    expect(btc.source).toBe('binance-fut-rt'); // honest label — NOT pretending to be CoinDCX
    expect(btc.price).toBeCloseTo(61_000.5, 6);
    expect(getTick('FUT_ETH')?.source).toBe('binance-fut-rt');
    cxRtClientDown();
  });
});

describe('cxRtStream — USDC global equity domain (GLOB_ keys)', () => {
  it('prices listed names from the DIRECT CoinDCX USDC RT feed', async () => {
    routeFetch(url => {
      if (url.includes('current_prices/futures/rt') && url.includes('margin_currency')) {
        return { ok: true, status: 200, json: async () => GLOB_USDC_PAYLOAD };
      }
      if (url.includes('query1.finance.yahoo.com')) {
        return { ok: true, status: 200, json: async () => yahooChart(200, 198) };
      }
      if (url.includes('current_prices/futures/rt')) {
        return { ok: true, status: 200, json: async () => FUT_USDT_PAYLOAD };
      }
      return null;
    });
    ensureCxRtSubscribed({ glob: ['AAPL'] });
    cxRtClientUp();
    await vi.waitFor(() => expect(getTick('GLOB_AAPL')).toBeTruthy());

    const aapl = getTick('GLOB_AAPL')!;
    expect(aapl.price).toBeCloseTo(333.62, 6);
    expect(aapl.source).toBe('coindcx-glob-rt');
    cxRtClientDown();
  });

  it('ticks SIM names (SPACEX) from the deterministic synthetic walk — never frozen, honestly labeled', async () => {
    routeFetch(url => {
      if (url.includes('current_prices/futures/rt') && url.includes('margin_currency')) {
        return { ok: true, status: 200, json: async () => GLOB_USDC_PAYLOAD };
      }
      if (url.includes('query1.finance.yahoo.com')) {
        return { ok: true, status: 200, json: async () => yahooChart(200, 198) };
      }
      if (url.includes('current_prices/futures/rt')) {
        return { ok: true, status: 200, json: async () => FUT_USDT_PAYLOAD };
      }
      return null;
    });
    ensureCxRtSubscribed({ glob: ['SPACEX'] });
    cxRtClientUp();
    await vi.waitFor(() => expect(getTick('GLOB_SPACEX')).toBeTruthy());

    const spx = getTick('GLOB_SPACEX')!;
    expect(spx.source).toBe('global-sim-rt');
    expect(spx.price).toBeGreaterThan(0);
    // the tick IS the synthetic walk at poll time (deterministic contract)
    expect(spx.price).toBeCloseTo(syntheticPriceAt('SPACEX', spx.time), 6);
    cxRtClientDown();
  });
});

describe('cxRtStream — lifecycle hygiene', () => {
  it('no client → subscribe does NOT start the poller', () => {
    routeFetch(() => null);
    ensureCxRtSubscribed({ fut: ['BTC'], glob: ['AAPL'] });
    expect(_cxRtStateForTest().timer).toBe(false);
    expect(_cxRtStateForTest().activeClients).toBe(0);
  });

  it('release → graceful eviction after the 90s grace window', async () => {
    vi.useFakeTimers();
    try {
      routeFetch(() => null);
      ensureCxRtSubscribed({ fut: ['BTC'] });
      releaseCxRtSubscribed({ fut: ['BTC'] });
      expect(_cxRtStateForTest().fut).toContain('BTC'); // still inside the grace window
      vi.advanceTimersByTime(91_000);
      expect(_cxRtStateForTest().fut).not.toContain('BTC'); // evicted
    } finally {
      vi.useRealTimers();
    }
  });

  it('refcount: two subscribers, one release keeps the symbol alive', () => {
    routeFetch(() => null);
    ensureCxRtSubscribed({ fut: ['BTC'] });
    ensureCxRtSubscribed({ fut: ['BTC'] });
    releaseCxRtSubscribed({ fut: ['BTC'] });
    expect(_cxRtStateForTest().fut).toContain('BTC');
    releaseCxRtSubscribed({ fut: ['BTC'] });
    expect(_cxRtStateForTest().fut).toContain('BTC'); // still within grace — NOT evicted yet
  });
});
