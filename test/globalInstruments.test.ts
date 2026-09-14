// ============================================================
// test/globalInstruments.test.ts — v10.5.3 CoinDCX equity-perp
// discovery filter (Issue #2, server/mcp/coindcx.js).
//
// fetchGlobalFuturesInstruments() separates global-equity USDT perps
// from crypto perps so the Global Equity SIM desk's full-universe scan
// only ever adds real stock tickers. Classification contract:
//   • a base with a CoinDCX SPOT market = crypto coin → excluded
//   • leveraged-token suffixes (3L/3S/BULL/BEAR/HALF) → excluded
//   • perp-only crypto staples (WIF/PEPE/…) → excluded
//   • non-ticker shapes (digits) → excluded
//   • everything else (AAPL/MU/JPM/TSLA/NVDA…) → equity discovery
// ============================================================
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { fetchGlobalFuturesInstruments } from '../server/mcp/coindcx.js';

const origFetch = globalThis.fetch;

// a believable active-instruments response: crypto perps + equity perps
const INSTRUMENTS = [
  'B-BTC_USDT', 'B-ETH_USDT', 'B-AAPL_USDT', 'B-MU_USDT', 'B-DOGE_USDT',
  'B-ETH3L_USDT', 'B-JPM_USDT', 'B-WIF_USDT', 'B-TSLA_USDT', 'B-1000PEPE_USDT',
  'B-NVDA_USDT',
];
// the SPOT book (crypto coins trade spot; tokenized equities do not)
const TICKERS = [
  { market: 'BTCINR' }, { market: 'ETHUSDT' }, { market: 'DOGEINR' },
  { market: 'SOLINR' },
];

beforeEach(() => {
  globalThis.fetch = vi.fn(async (url: any) => {
    const u = String(url);
    if (u.includes('/derivatives/futures/data/active_instruments')) {
      return { ok: true, status: 200, json: async () => INSTRUMENTS, text: async () => JSON.stringify(INSTRUMENTS) };
    }
    if (u.includes('/exchange/ticker')) {
      return { ok: true, status: 200, json: async () => TICKERS, text: async () => JSON.stringify(TICKERS) };
    }
    return { ok: false, status: 404, json: async () => ({}), text: async () => '{}' };
  }) as any;
});

afterEach(() => { globalThis.fetch = origFetch; });

describe('fetchGlobalFuturesInstruments — equity-perp discovery filter', () => {
  it('keeps equity perps, drops crypto coins / leveraged tokens / perp-only memes / junk shapes', async () => {
    const rows = await fetchGlobalFuturesInstruments({ maxAgeMs: 0 });
    const syms = rows.map(r => r.symbol);
    // the equities survive
    for (const want of ['AAPL', 'MU', 'JPM', 'TSLA', 'NVDA']) expect(syms).toContain(want);
    // crypto coins WITH spot markets are excluded
    for (const no of ['BTC', 'ETH', 'DOGE', 'SOL']) expect(syms).not.toContain(no);
    // leveraged tokens are crypto derivatives, never equities
    expect(syms).not.toContain('ETH3L');
    // perp-only crypto staples
    expect(syms).not.toContain('WIF');
    // digit-prefixed meme units are not ticker-shaped
    expect(syms.some(s => s.includes('1000PEPE'))).toBe(false);
    // rows carry the CoinDCX pair
    for (const r of rows) expect(r.pair).toBe(`B-${r.symbol}_USDT`);
  });

  it('serves repeat calls from the cache (one upstream round-trip per TTL)', async () => {
    await fetchGlobalFuturesInstruments({ maxAgeMs: 0 }); // fresh fetch
    const f = globalThis.fetch as any;
    const calls = f.mock.calls.length;
    await fetchGlobalFuturesInstruments({ maxAgeMs: 60_000 }); // cache window
    expect(f.mock.calls.length).toBe(calls); // nothing hit the upstream
  });

  it('an unreachable CoinDCX throws (caller degrades to seed-only honestly)', async () => {
    globalThis.fetch = vi.fn(async () => ({ ok: false, status: 503, json: async () => ({}), text: async () => '' })) as any;
    await expect(fetchGlobalFuturesInstruments({ maxAgeMs: 0 })).rejects.toThrow();
  });
});
