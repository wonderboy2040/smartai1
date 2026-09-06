// ============================================================
// test/futures.test.ts — v6.8 GLOBAL FUTURES (CoinDCX USDT perps)
// ------------------------------------------------------------
// Covers: RT price parsing, candlestick parsing, pair helpers,
// futures order body, wallet normalization + equity view, the
// execution gauntlet (venue gate, leverage clamp/sanity, wallet
// auto-transfer, native TP/SL arming, journal caps), the futures
// watcher (SL/TP close, exchange reconcile, trailing, liquidation),
// and manual close.
// ============================================================
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

const mockPrivate = vi.fn();
vi.mock('../server/mcp/coindcx.js', () => ({
  coindcxPrivate: (...args) => mockPrivate(...args),
  coindcxConnected: () => true,
  coindcxStatus: () => ({ connected: true }),
}));
vi.mock('../server/cryptoStream.js', () => ({
  fetchCoinDcxTickers: vi.fn(async () => []),
}));

import {
  futuresPairFor, baseOfFuturesPair, fetchFuturesPrices, fetchFuturesCandles,
  futuresOrderBody, fetchFuturesWallets, walletSnapshot, executeFuturesSignal,
  watchFuturesPositions, closeFuturesPosition, __resetFuturesForTests,
  __setUsdInrForTests, inrOfUsdt, roundFuturesQty,
} from '../server/ai/futures.js';
import { __resetForTests, __setJournalForTests, loadJournal, __setConfigForTests, todayIST } from '../server/ai/coindcxOrders.js';
import { saveJSON, loadJSON as loadJSONOrig } from '../server/lib/store.js';

// ---------------- fixtures ----------------
const STRONG_FUT = {
  symbol: 'BTC', market: 'FUTURES', side: 'LONG', grade: 'STRONG',
  confidence: 84, agreement: 0.8, generatedAt: Date.now(),
  ltp: 50000, plan: {
    entry: 50000, stopLoss: 48400, target1: 51600, target2: 53200,
    risk: 1600, riskPct: 3.2, rewardRisk: 2, atrUsed: 1000, planStyle: 'atr-based',
  },
  votes: [], summary: 'x', executable: true,
};
const freshSignal = async () => ({ ...STRONG_FUT });

const RT_PAYLOAD = {
  ts: 1720429586580, vs: 54009972,
  prices: {
    'B-BTC_USDT': { ls: 50000, pc: 2.5, h: 50500, l: 49500, v: 12345.6, mp: 49999.5, mkt: 'BTCUSDT' },
    'B-ETH_USDT': { ls: 3000, pc: -1.2, h: 3050, l: 2950, v: 9876.5, mp: 3000.1, mkt: 'ETHUSDT' },
    'B-DEAD_USDT': { ls: 0, pc: 0, h: 0, l: 0, v: 0, mp: 0, mkt: 'DEADUSDT' }, // dark row — must be skipped
  },
};

const CANDLE_ROWS = Array.from({ length: 40 }, (_, i) => ({
  open: 1654 + i, high: 1660 + i, low: 1650 + i, volume: 1000 + i, close: 1655 + i, time: 1704153600000 + i * 86400000,
}));
const CANDLES_PAYLOAD = { s: 'ok', data: CANDLE_ROWS.slice(-2).concat() };
// note: the endpoint returns whatever the from/to window asked — we feed a
// full 40-row window and assert the parser's ordering/shape contract

const WALLETS_PAYLOAD = [
  { id: 'w1', currency_short_name: 'USDT', balance: '6.1693226', locked_balance: '0.5', cross_order_margin: '0.2', cross_user_margin: '0.1' },
  { id: 'w2', currency_short_name: 'INR', balance: '1000', locked_balance: '0', cross_order_margin: '0', cross_user_margin: '0' },
];

// ---------------- fetch routing ----------------
const origFetch = globalThis.fetch;
function routeFetch(handlers = {}) {
  globalThis.fetch = vi.fn(async (url, opts) => {
    const u = String(url);
    for (const [needle, responder] of Object.entries(handlers)) {
      if (u.includes(needle)) {
        const body = typeof responder === 'function' ? responder(u, opts) : responder;
        return {
          ok: true, status: 200,
          json: async () => body,
          text: async () => JSON.stringify(body),
        };
      }
    }
    return { ok: true, status: 200, json: async () => ({}), text: async () => '{}' };
  });
}

let _origCreds = null;

beforeEach(() => {
  __resetForTests();
  __resetFuturesForTests();
  __setUsdInrForTests(84);
  _origCreds = JSON.parse(JSON.stringify(loadJSONOrig('mcp-coindcx.json') || {}));
  saveJSON('mcp-coindcx.json', { apiKey: 'test-key', secret: 'test-secret', connectedAt: Date.now() });
  mockPrivate.mockReset();
  // default private transport: wallets rich, positions list with our pair,
  // create + tpsl succeed
  mockPrivate.mockImplementation(async (path) => {
    if (path === '/exchange/v1/derivatives/futures/wallets') return WALLETS_PAYLOAD;
    if (path === '/exchange/v1/derivatives/futures/positions') return [
      { id: 'pos-1', pair: 'B-BTC_USDT', active_pos: 0.01, avg_price: 50000, liquidation_price: 45000, leverage: 3, margin_type: 'isolated', mark_price: 50000, take_profit_trigger: null, stop_loss_trigger: null },
    ];
    if (path === '/exchange/v1/derivatives/futures/orders/create') return { order: { id: 'fut-order-1' } };
    if (path === '/exchange/v1/derivatives/futures/positions/create_tpsl') return { ok: true };
    if (path === '/exchange/v1/derivatives/futures/positions/exit') return { ok: true };
    if (path === '/exchange/v1/users/balances') return [];
    throw new Error(`unexpected private path: ${path}`);
  });
});

afterEach(() => {
  globalThis.fetch = origFetch;
  vi.unstubAllGlobals();
  saveJSON('mcp-coindcx.json', _origCreds && _origCreds.apiKey != null ? _origCreds : { apiKey: null, secret: null });
});

// ============================================================
// pair helpers + RT prices + candles
// ============================================================
describe('futures pair helpers', () => {
  it('derives the B-<BASE>_USDT instrument name and back', () => {
    expect(futuresPairFor('BTC')).toBe('B-BTC_USDT');
    expect(baseOfFuturesPair('B-BTC_USDT')).toBe('BTC');
    expect(baseOfFuturesPair('garbage')).toBe('GARBAGE');
  });
  it('rounds qty to the instrument precision', () => {
    expect(roundFuturesQty('B-BTC_USDT', 0.000876)).toBeCloseTo(0.0008, 6);
    expect(roundFuturesQty('B-DOGE_USDT', 1234.9)).toBe(1234);
  });
});

describe('fetchFuturesPrices (RT payload)', () => {
  it('parses ls/pc/mp/h/l/v and SKIPS dark (ls=0) rows', async () => {
    routeFetch({ 'current_prices/futures/rt': RT_PAYLOAD });
    const rows = await fetchFuturesPrices({ maxAgeMs: 0 });
    const dead = rows.find(r => r.pair === 'B-DEAD_USDT');
    expect(dead).toBeUndefined();
    const btc = rows.find(r => r.pair === 'B-BTC_USDT');
    expect(btc).toMatchObject({ base: 'BTC', last: 50000, mark: 49999.5, changePct: 2.5 });
  });
  it('rejects garbage payloads (empty / wrong shape)', async () => {
    routeFetch({ 'current_prices/futures/rt': { prices: {} } });
    await expect(fetchFuturesPrices({ maxAgeMs: 0 })).rejects.toThrow(/empty|unexpected/i);
  });
});

describe('fetchFuturesCandles (pcode=f)', () => {
  it('parses { s, data } oldest-first (≥30 rows → usable TA input)', async () => {
    routeFetch({ 'market_data/candlesticks': { s: 'ok', data: CANDLE_ROWS } });
    const out = await fetchFuturesCandles('B-MKR_USDT', '60', 40);
    expect(out).toHaveLength(40);
    expect(out[0].time).toBeLessThan(out[1].time);
    expect(out[39].close).toBe(1655 + 39);
  });
  it('returns null for short (<30) responses and bare-array tolerance', async () => {
    routeFetch({ 'market_data/candlesticks': CANDLE_ROWS.slice(0, 2) });
    expect(await fetchFuturesCandles('B-MKR_USDT', '60', 2)).toBeNull();
  });
});

// ============================================================
// order body + wallets
// ============================================================
describe('futuresOrderBody', () => {
  it('builds the documented NESTED order body (LONG→buy, market)', () => {
    const body = futuresOrderBody({ pair: 'B-BTC_USDT', side: 'LONG', qty: 0.01, leverage: 3 });
    expect(body.order).toMatchObject({
      side: 'buy', pair: 'B-BTC_USDT', order_type: 'market_order',
      total_quantity: 0.01, leverage: 3, hidden: false, post_only: false,
    });
    expect(typeof body.timestamp).toBe('number');
  });
  it('SHORT→sell and limit orders carry the price', () => {
    const body = futuresOrderBody({ pair: 'B-ETH_USDT', side: 'SHORT', qty: 2, leverage: 5, price: 3000 });
    expect(body.order.side).toBe('sell');
    expect(body.order.order_type).toBe('limit_order');
    expect(body.order.price).toBe('3000');
  });
});

describe('futures wallets + snapshot', () => {
  it('computes free = balance − locked − cross margins (never negative)', async () => {
    const rows = await fetchFuturesWallets();
    const usdt = rows.find(r => r.currency === 'USDT');
    // 6.169 − 0.5 (locked) − 0.2 (cross order) − 0.1 (cross user) = 5.369…
    expect(usdt.free).toBeCloseTo(5.37, 1);
    expect(usdt.locked).toBeCloseTo(0.7, 1);
  });
  it('walletSnapshot carries spot + futures + INR-equivalent equity', async () => {
    mockPrivate.mockImplementation(async (path) => {
      if (path === '/exchange/v1/derivatives/futures/wallets') return WALLETS_PAYLOAD;
      if (path === '/exchange/v1/users/balances') return [
        { currency_short_name: 'INR', available_balance: 8400, locked_balance: 0 },
        { currency_short_name: 'USDT', available_balance: 10, locked_balance: 0 },
      ];
      throw new Error(`unexpected ${path}`);
    });
    const snap = await walletSnapshot();
    expect(snap.ok).toBe(true);
    expect(snap.usdInr).toBe(84);
    // 8400 + 10×84 + 6.169×84 = 8400 + 840 + 518.2 ≈ 9758
    expect(snap.equityINR).toBeGreaterThan(9500);
    expect(snap.equityINR).toBeLessThan(10000);
    expect(snap.deployableFuturesUSDT).toBeCloseTo(5.37, 1);
    expect(snap.deployableSpotINR).toBe(8400);
  });
  it('walletSnapshot NEVER throws — a dead leg degrades with the reason', async () => {
    mockPrivate.mockRejectedValue(new Error('[401] bad key'));
    const snap = await walletSnapshot();
    expect(snap.ok).toBe(true);
    expect(snap.futures.error).toMatch(/401/);
  });
});

// ============================================================
// THE EXECUTION GAUNTLET (futures)
// ============================================================
describe('executeFuturesSignal', () => {
  beforeEach(() => {
    // LIVE-armed config (the gauntlet's gate 3) + generous caps so each
    // test can isolate ONE gate
    __setConfigForTests({ mode: 'live', cryptoLeverage: 10, maxRiskPct: 5, dailyMaxTrades: 50, dailyMaxLossINR: 100_000, maxOrderINR: 1_000_000, maxOpenPositions: 50 });
    routeFetch({
      'current_prices/futures/rt': RT_PAYLOAD,
      'derivatives/futures/data/instrument': { instrument: { pair: 'B-BTC_USDT', max_leverage_long: 10, max_leverage_short: 10, quantity_precision: 4, min_qty: 0.001, status: 'active' } },
    });
  });

  it('PAPER: fresh STRONG futures signal → journal position in the USDT domain', async () => {
    const out = await executeFuturesSignal({
      symbol: 'BTC', side: 'LONG', mode: 'paper', marginUSDT: 100, leverage: 3,
      getFreshSignal: freshSignal, source: 'manual',
    });
    expect(out.ok).toBe(true);
    expect(out.mode).toBe('paper');
    // qty = 100×3 / 50000 = 0.006 → floored at 4dp
    expect(out.filled.qty).toBeCloseTo(0.006, 6);
    expect(out.filled.marginUSDT).toBeCloseTo(100, 0);
    const j = loadJournal();
    const p = j.positions[0];
    expect(p.market).toBe('FUTURES');
    expect(p.pair).toBe('B-BTC_USDT');
    expect(p.notionalUSDT).toBeCloseTo(0.006 * 50000, 0);
    expect(p.notionalINR).toBeCloseTo(0.006 * 50000 * 84, 0); // INR twin at 84
    expect(j.entries[0].kind).toBe('ORDER');
    expect(j.entries[0].status).toBe('FILLED');
    expect(j.entries[0].market).toBe('FUTURES');
  });

  it('VENUE gate: a CRYPTO (spot) signal can never pass the futures gauntlet', async () => {
    const out = await executeFuturesSignal({
      symbol: 'BTC', side: 'LONG', mode: 'live', marginUSDT: 100, leverage: 1,
      getFreshSignal: async () => ({ ...STRONG_FUT, market: 'CRYPTO' }),
      source: 'manual',
    });
    expect(out.ok).toBe(false);
    expect(out.error).toMatch(/signal is for the CRYPTO market/i);
    const j = loadJournal();
    expect(j.entries[0].status).toBe('REJECTED');
  });

  it('FRESHNESS gate: a stale signal is rejected for LIVE', async () => {
    const stale = { ...STRONG_FUT, generatedAt: Date.now() - 10 * 60_000 };
    const out = await executeFuturesSignal({
      symbol: 'BTC', side: 'LONG', mode: 'live', marginUSDT: 100, leverage: 1,
      getFreshSignal: async () => stale, source: 'manual',
    });
    expect(out.ok).toBe(false);
    expect(out.error).toMatch(/stale/i);
  });

  it('LEVERAGE sanity: LIVE rejects when liquidation would fire before the SL', async () => {
    // WIDE stop (12%) → maxSane = floor(95/12) = 7 → 10x must REJECT live
    __setConfigForTests({ mode: 'live', cryptoLeverage: 10, maxRiskPct: 15, dailyMaxTrades: 50, dailyMaxLossINR: 100_000, maxOrderINR: 1_000_000, maxOpenPositions: 50 });
    const wide = { ...STRONG_FUT, plan: { ...STRONG_FUT.plan, stopLoss: 44000, risk: 6000, riskPct: 12, target1: 56000, target2: 62000, rewardRisk: 2 } };
    const out = await executeFuturesSignal({
      symbol: 'BTC', side: 'LONG', mode: 'live', marginUSDT: 100, leverage: 10,
      getFreshSignal: async () => wide, source: 'manual',
    });
    expect(out.ok).toBe(false);
    expect(out.error).toMatch(/liquidat/i);
  });

  it('LIVE: creates the order, resolves the position id, arms NATIVE TP/SL', async () => {
    const tpslCalls = [];
    mockPrivate.mockImplementation(async (path, _key, _sec, body) => {
      if (path === '/exchange/v1/derivatives/futures/wallets') return [
        { id: 'w1', currency_short_name: 'USDT', balance: '500', locked_balance: '0', cross_order_margin: '0', cross_user_margin: '0' },
      ];
      if (path === '/exchange/v1/derivatives/futures/positions') return [
        { id: 'pos-live-1', pair: 'B-BTC_USDT', active_pos: 0.006, avg_price: 50000, liquidation_price: 46000, leverage: 3, margin_type: 'isolated', mark_price: 50000, take_profit_trigger: null, stop_loss_trigger: null },
      ];
      if (path === '/exchange/v1/derivatives/futures/orders/create') return { order: { id: 'fut-order-9' } };
      if (path === '/exchange/v1/derivatives/futures/positions/create_tpsl') { tpslCalls.push(body); return { ok: true }; }
      throw new Error(`unexpected ${path}`);
    });
    const out = await executeFuturesSignal({
      symbol: 'BTC', side: 'LONG', mode: 'live', marginUSDT: 100, leverage: 3,
      getFreshSignal: freshSignal, source: 'manual',
    });
    expect(out.ok).toBe(true);
    expect(out.orderId).toBe('fut-order-9');
    const j = loadJournal();
    const p = j.positions[0];
    expect(p.mode).toBe('live');
    expect(p.exchangePositionId).toBe('pos-live-1');
    expect(p.liquidation).toBe(46000); // exchange-reported
    expect(p.liquidationSource).toBe('exchange');
    // native TP/SL armed with the plan levels (SL 48400 / TP2 53200)
    expect(tpslCalls.length).toBeGreaterThanOrEqual(1);
    expect(Number(tpslCalls[0].stop_loss.stop_price)).toBe(48400);
    expect(Number(tpslCalls[0].take_profit.stop_price)).toBe(53200);
  });

  it('WALLET gate: live rejects honestly when the DF wallet + spot are short', async () => {
    mockPrivate.mockImplementation(async (path) => {
      if (path === '/exchange/v1/derivatives/futures/wallets') return [
        { id: 'w1', currency_short_name: 'USDT', balance: '1', locked_balance: '0', cross_order_margin: '0', cross_user_margin: '0' },
      ];
      if (path === '/exchange/v1/users/balances') return [
        { currency_short_name: 'INR', available_balance: 100, locked_balance: 0 },
      ];
      throw new Error(`unexpected ${path}`);
    });
    const out = await executeFuturesSignal({
      symbol: 'BTC', side: 'LONG', mode: 'live', marginUSDT: 500, leverage: 3,
      getFreshSignal: freshSignal, source: 'manual',
    });
    expect(out.ok).toBe(false);
    expect(out.error).toMatch(/margin needed|wallet/i);
  });

  it('DAILY caps: the 3rd trade of the day is the LAST — a 4th is rejected', async () => {
    // user spec: dailyMaxTrades = 3 (override the gauntlet beforeEach's 50)
    __setConfigForTests({ mode: 'live', cryptoLeverage: 10, maxRiskPct: 5, dailyMaxTrades: 3, dailyMaxLossINR: 100_000, maxOrderINR: 1_000_000, maxOpenPositions: 50 });
    // simulate 3 trades already done today (non-rejected ORDER entries)
    const j = loadJournal();
    const today = todayIST();
    for (let i = 0; i < 3; i++) {
      j.entries.push({ id: `e${i}`, ts: Date.now(), kind: 'ORDER', day: today, pair: `X${i}`, status: 'FILLED' });
    }
    __setJournalForTests(j);
    const out = await executeFuturesSignal({
      symbol: 'BTC', side: 'LONG', mode: 'paper', marginUSDT: 100, leverage: 3,
      getFreshSignal: freshSignal, source: 'manual',
    });
    expect(out.ok).toBe(false);
    expect(out.error).toMatch(/daily trade cap/i);
  });
});

// ============================================================
// THE FUTURES WATCHER
// ============================================================
describe('watchFuturesPositions', () => {
  const mkPos = (over = {}) => ({
    id: 'p1', pair: 'B-BTC_USDT', symbol: 'BTC', market: 'FUTURES', side: 'LONG', mode: 'paper',
    source: 'agent', qty: 0.01, entryPrice: 50000, notionalUSDT: 500, notionalINR: 42000,
    marginUSDT: 100, marginINR: 8400, leverage: 3, liquidation: 34166.67,
    sl: 48400, tp: 51600, tp2: 53200, initialRisk: 1600, peakPrice: 50000,
    signal: { grade: 'STRONG', confidence: 84, agreement: 0.8 },
    openedAt: Date.now(), status: 'OPEN', ...over,
  });

  beforeEach(() => {
    routeFetch({ 'current_prices/futures/rt': RT_PAYLOAD });
  });

  it('closes a PAPER position when the RT price crosses the SL', async () => {
    __setJournalForTests({ entries: [], positions: [mkPos()] });
    // price 48000 ≤ SL 48400
    routeFetch({ 'current_prices/futures/rt': { ...RT_PAYLOAD, prices: { ...RT_PAYLOAD.prices, 'B-BTC_USDT': { ...RT_PAYLOAD.prices['B-BTC_USDT'], ls: 48000 } } } });
    const closures = await watchFuturesPositions({});
    expect(closures).toHaveLength(1);
    expect(closures[0].reason).toMatch(/STOP-LOSS/i);
    const j = loadJournal();
    const p = j.positions[0];
    expect(p.status).toBe('CLOSED');
    expect(p.closeReason).toMatch(/STOP-LOSS/i);
    // USDT P&L = (48000 − 50000) × 0.01 = −20 USDT → ×84 = −1680 INR
    expect(p.pnlUSDT).toBeCloseTo(-20, 0);
    expect(p.pnlINR).toBeCloseTo(-20 * 84, 0);
  });

  it('closes at TARGET-2 with the runner profit', async () => {
    __setJournalForTests({ entries: [], positions: [mkPos()] });
    routeFetch({ 'current_prices/futures/rt': { ...RT_PAYLOAD, prices: { ...RT_PAYLOAD.prices, 'B-BTC_USDT': { ...RT_PAYLOAD.prices['B-BTC_USDT'], ls: 53300 } } } });
    const closures = await watchFuturesPositions({});
    expect(closures[0].reason).toMatch(/TARGET-2/i);
    const p = loadJournal().positions[0];
    expect(p.pnlUSDT).toBeCloseTo(33, 0); // (53300 − 50000) × 0.01
  });

  it('reconciles a LIVE position the exchange already closed (native TP/SL)', async () => {
    __setJournalForTests({ entries: [], positions: [mkPos({ mode: 'live', exchangePositionId: 'pos-1' })] });
    // exchange says active_pos = 0 with an SL trigger 48400 → reconciled close
    mockPrivate.mockImplementation(async (path) => {
      if (path === '/exchange/v1/derivatives/futures/positions') return [
        { id: 'pos-1', pair: 'B-BTC_USDT', active_pos: 0, avg_price: 50000, liquidation_price: 0, leverage: 3, margin_type: 'isolated', mark_price: 48000, take_profit_trigger: null, stop_loss_trigger: 48400 },
      ];
      throw new Error(`unexpected ${path}`);
    });
    const closures = await watchFuturesPositions({});
    expect(closures).toHaveLength(1);
    const p = loadJournal().positions[0];
    expect(p.status).toBe('CLOSED');
    expect(p.closeReason).toMatch(/native/i);
    expect(p.closePrice).toBe(48400);
  });

  it('updates the entry price + liquidation from the exchange while open', async () => {
    __setJournalForTests({ entries: [], positions: [mkPos({ mode: 'live', exchangePositionId: 'pos-1' })] });
    mockPrivate.mockImplementation(async (path) => {
      if (path === '/exchange/v1/derivatives/futures/positions') return [
        { id: 'pos-1', pair: 'B-BTC_USDT', active_pos: 0.01, avg_price: 50100, liquidation_price: 45500, leverage: 3, margin_type: 'isolated', mark_price: 50000, take_profit_trigger: null, stop_loss_trigger: null },
      ];
      throw new Error(`unexpected ${path}`);
    });
    await watchFuturesPositions({});
    const p = loadJournal().positions[0];
    expect(p.status).toBe('OPEN');
    expect(p.entryPrice).toBe(50100);
    expect(p.liquidation).toBe(45500);
    expect(p.liquidationSource).toBe('exchange');
  });

  it('paper liquidation closes the whole margin when the estimate is crossed', async () => {
    __setJournalForTests({ entries: [], positions: [mkPos()] });
    routeFetch({ 'current_prices/futures/rt': { ...RT_PAYLOAD, prices: { ...RT_PAYLOAD.prices, 'B-BTC_USDT': { ...RT_PAYLOAD.prices['B-BTC_USDT'], ls: 34000 } } } });
    const closures = await watchFuturesPositions({});
    expect(closures[0].reason).toMatch(/LIQUIDATED/i);
    const p = loadJournal().positions[0];
    expect(p.closeReason).toMatch(/LIQUIDATED/i);
    expect(p.closePrice).toBe(34166.67);
  });

  it('manual close (paper) settles at the RT price', async () => {
    __setJournalForTests({ entries: [], positions: [mkPos()] });
    const out = await closeFuturesPosition('p1');
    expect(out.ok).toBe(true);
    expect(loadJournal().positions[0].closeReason).toBe('Manual close');
  });
});

// ============================================================
// conversion twin
// ============================================================
describe('USDT→INR twin', () => {
  it('rounds to 2dp at the given FX rate', () => {
    expect(inrOfUsdt(6.1693226, 84)).toBeCloseTo(518.22, 1);
    expect(inrOfUsdt(NaN, 84)).toBeNull();
  });
});
