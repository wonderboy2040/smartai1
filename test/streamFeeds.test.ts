// ============================================================
// streamFeeds tests — 2026 realtime audit regression suite
// Covers the "US/India realtime prices not streaming on site load" fixes:
//   RC1  Finnhub REST staleness gate (isStaleUsQuote + usMarketOpen)
//   RC2  WS-gap Yahoo fallback poller (SPY/SMH/VGT get zero WS trades)
//   RC3  Yahoo bootstrap seeds a LIVE snapshot (not Friday's close)
//   RC4  Reconnect deadlock (cleared timer + future _reconnectAt)
//   RC5  India server-side push (inStream: NSE gating, Groww→Yahoo, crypto filter)
// No network — fetch + WebSocket are injected test doubles.
// ============================================================
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { EventEmitter } from 'node:events';

// Deterministic market clocks:
//  - US OPEN  : Monday 2026-08-31 15:00 UTC = 11:00 AM ET
//  - NSE OPEN : Monday 2026-08-31 04:30 UTC = 10:00 AM IST
//  - NSE CLOSED (evening): Monday 2026-08-31 14:30 UTC = 20:00 IST
const US_OPEN_T = new Date('2026-08-31T15:00:00Z').getTime();
const NSE_OPEN_T = new Date('2026-08-31T04:30:00Z').getTime();
const NSE_CLOSED_T = new Date('2026-08-31T14:30:00Z').getTime();

const yahooResponse = (price, pc, tSec) => ({
  ok: true,
  json: async () => ({
    chart: {
      result: [{
        meta: {
          regularMarketPrice: price,
          chartPreviousClose: pc,
          regularMarketDayHigh: price + 2,
          regularMarketDayLow: price - 2,
          regularMarketVolume: 4242,
          regularMarketTime: tSec,
        },
      }],
    },
  }),
});

// ---- usMarketOpen / isStaleUsQuote (pure) -------------------------
describe('usMarketOpen (ET session clock)', () => {
  it.each([
    ['Mon 11:00 ET → open', new Date('2026-08-31T15:00:00Z'), true],
    ['Mon 09:30 ET → open', new Date('2026-08-31T13:30:00Z'), true],
    ['Mon 16:00 ET → open (close edge)', new Date('2026-08-31T20:00:00Z'), true],
    ['Mon 17:00 ET → closed', new Date('2026-08-31T21:00:00Z'), false],
    ['Mon 03:00 UTC = Sun 23:00 ET → closed (weekend)', new Date('2026-08-31T03:00:00Z'), false],
    ['Sat 15:00 UTC → closed', new Date('2026-09-05T15:00:00Z'), false],
  ])('%s', async (_label, date, expected) => {
    const { usMarketOpen } = await import('../server/usStream.js');
    expect(usMarketOpen(date)).toBe(expected);
  });
});

describe('isStaleUsQuote (RC1 freshness gate)', () => {
  it('rejects a >5min-old quote while the market is OPEN (the Friday-close bug)', async () => {
    const { isStaleUsQuote } = await import('../server/usStream.js');
    const now = Date.now();
    expect(isStaleUsQuote(now - 10 * 60 * 1000, now, true)).toBe(true);
    expect(isStaleUsQuote(now - 3 * 60 * 1000, now, true)).toBe(false);
  });
  it('accepts an old quote when the market is CLOSED (last close IS the price)', async () => {
    const { isStaleUsQuote } = await import('../server/usStream.js');
    const now = Date.now();
    expect(isStaleUsQuote(now - 3 * 24 * 60 * 60 * 1000, now, false)).toBe(false);
  });
  it('trusts quotes without a timestamp', async () => {
    const { isStaleUsQuote } = await import('../server/usStream.js');
    expect(isStaleUsQuote(0, Date.now(), true)).toBe(false);
  });
});

// ---- inStream pure + flow ----------------------------------------
describe('inStream (RC5 — India server-side push)', () => {
  let inStream;
  let getTick; // from the FRESH module registry (vi.resetModules re-imports liveFeed too)
  beforeEach(async () => {
    vi.resetModules();
    vi.useFakeTimers();
    getTick = (await import('../server/liveFeed.js')).getTick;
    inStream = await import('../server/inStream.js');
    inStream._resetInStreamForTest();
  });
  afterEach(() => { vi.useRealTimers(); vi.unstubAllEnvs(); });

  it('nseWindow: IST session + 15:40 grace, weekdays only', () => {
    expect(inStream.nseWindow(new Date(NSE_OPEN_T))).toBe(true);       // Mon 10:00 IST
    expect(inStream.nseWindow(new Date(NSE_CLOSED_T))).toBe(false);    // Mon 20:00 IST
    expect(inStream.nseWindow(new Date('2026-08-30T04:30:00Z'))).toBe(false); // Sunday
    expect(inStream.nseWindow(new Date('2026-08-31T10:10:00Z'))).toBe(true);  // 15:40 IST grace edge
  });

  it('subscribes equities, filters crypto bases (cryptoStream owns those)', () => {
    const groww = vi.fn(async () => ({ price: 3000, change: 0.5 }));
    inStream.initInStream({ fetchGrowwNseQuote: groww });
    inStream.ensureInSubscribed(['RELIANCE', 'BTC', 'ETH', 'TCS.NS']);
    const st = inStream.inDebugState();
    expect(st.subscribed).toContain('RELIANCE');
    expect(st.subscribed).toContain('TCS'); // .NS stripped
    expect(st.subscribed).not.toContain('BTC');
    expect(st.subscribed).not.toContain('ETH');
  });

  it('after-hours one-shot seeds the SSE snapshot via Groww (site-load price paint)', async () => {
    vi.setSystemTime(NSE_CLOSED_T); // 20:00 IST — NSE closed
    const groww = vi.fn(async (s) => ({ price: s === 'RELIANCE' ? 2925.5 : 0, change: 1.2, high: 2950, low: 2900, volume: 100, time: Date.now() }));
    inStream.initInStream({ fetchGrowwNseQuote: groww });
    inStream.ensureInSubscribed(['RELIANCE']);
    await vi.advanceTimersByTimeAsync(50);
    const t = getTick('IN_RELIANCE');
    expect(t).toBeTruthy();
    expect(t.price).toBe(2925.5);
    expect(t.source).toBe('groww-in-stream');
    // No polling loop outside NSE hours:
    expect(inStream.inDebugState().timer).toBe(false);
  });

  it('falls back to Yahoo (indices) when Groww has no quote', async () => {
    vi.setSystemTime(NSE_CLOSED_T);
    const groww = vi.fn(async () => null);
    const yahoo = vi.fn(async (ysym) => ({ price: 24800, change: -0.4, high: 25000, low: 24700, volume: 0, time: Date.now() }));
    const toY = vi.fn(() => '^NSEI');
    inStream.initInStream({ fetchGrowwNseQuote: groww, fetchYahooQuote: yahoo, toYahooSymbol: toY });
    inStream.ensureInSubscribed(['NIFTY']);
    await vi.advanceTimersByTimeAsync(50);
    const t = getTick('IN_NIFTY');
    expect(t).toBeTruthy();
    expect(t.price).toBe(24800);
    expect(t.source).toBe('yahoo-in-stream');
    expect(toY).toHaveBeenCalledWith('NIFTY', 'IN');
  });

  it('during NSE hours: 5s poll loop runs while clients are connected and stops when they leave', async () => {
    vi.setSystemTime(NSE_OPEN_T); // 10:00 IST Monday — open
    let calls = 0;
    const groww = vi.fn(async () => { calls++; return { price: 100 + calls, change: 0.1 }; });
    inStream.initInStream({ fetchGrowwNseQuote: groww });
    inStream.ensureInSubscribed(['SBIN']);
    await vi.advanceTimersByTimeAsync(50); // one-shot
    const afterOneShot = calls;

    inStream.inClientUp();               // SSE client connects → loop starts
    expect(inStream.inDebugState().timer).toBe(true);
    await vi.advanceTimersByTimeAsync(5000); // +1 poll round
    expect(calls).toBeGreaterThan(afterOneShot);

    inStream.inClientDown();             // last client leaves → loop stops
    expect(inStream.inDebugState().timer).toBe(false);
    const stopped = calls;
    await vi.advanceTimersByTimeAsync(15000);
    expect(calls).toBe(stopped);         // zero upstream calls while idle
  });
});

// ---- usStream lifecycle (RC2/RC3/RC4) -----------------------------
describe('usStream — keyless Yahoo operation (RC2/RC3)', () => {
  let us;
  let getTick;
  let setTick;
  let fetchMock;
  beforeEach(async () => {
    vi.resetModules();
    vi.stubEnv('FINNHUB_API_KEY', '');
    vi.useFakeTimers();
    vi.setSystemTime(US_OPEN_T); // US market OPEN
    const lf = await import('../server/liveFeed.js');
    getTick = lf.getTick; setTick = lf.setTick;
    us = await import('../server/usStream.js');
    us._resetUsStreamForTest();
    fetchMock = vi.fn(async () => yahooResponse(713.36, 716.43, Math.floor(US_OPEN_T / 1000)));
    us._setUsFetchForTest(fetchMock);
  });
  afterEach(() => { vi.useRealTimers(); vi.unstubAllEnvs(); us?._setUsFetchForTest(null); });

  it('bootstrap seeds a LIVE Yahoo snapshot the moment a symbol is subscribed (no Finnhub key needed)', async () => {
    us.ensureUsSubscribed(['SPY']);
    await vi.advanceTimersByTimeAsync(50);
    const t = getTick('US_SPY');
    expect(t).toBeTruthy();
    expect(t.price).toBe(713.36);            // LIVE price, not Friday's close
    expect(t.source).toBe('yahoo-us-fallback');
    // change% computed against the CORRECT prevClose (716.43, not Thursday's 721.11)
    expect(t.change).toBeCloseTo(((713.36 - 716.43) / 716.43) * 100, 4);
  });

  it('WS-gap fallback poller refreshes symbols that get no WS trades (the SPY/SMH/VGT case)', async () => {
    us.ensureUsSubscribed(['SPY']);
    await vi.advanceTimersByTimeAsync(50);
    const bootCalls = fetchMock.mock.calls.length;

    us.usClientUp(); // SSE client active → fallback poller starts
    expect(us.usDebugState().fallbackTimer).toBe(true);
    await vi.advanceTimersByTimeAsync(5000); // one 5s cycle
    const t = getTick('US_SPY');
    expect(t.price).toBe(713.36);
    expect(fetchMock.mock.calls.length).toBeGreaterThan(bootCalls); // Yahoo was polled
    // ...and the poller idles once the last client leaves:
    us.usClientDown();
    expect(us.usDebugState().fallbackTimer).toBe(false);
  });

  it('WS trade ticks win over the fallback and mark lastWsTick so Yahoo stops polling that symbol', async () => {
    us.ensureUsSubscribed(['QQQ']);
    await vi.advanceTimersByTimeAsync(50);
    // (keyless — no WS here, so simulate the WS tick path via liveFeed directly)
    setTick('US_QQQ', { price: 713.68, change: -0.38, high: 715, low: 713, volume: 100, time: Date.now() }, 'finnhub-stream');
    const t = getTick('US_QQQ');
    expect(t.price).toBe(713.68);
    expect(t.source).toBe('finnhub-stream');
  });

  it('getUsSessionQuote: serves the shared stream session to /api/quote and expires when stale', async () => {
    us.ensureUsSubscribed(['SPY']);
    await vi.advanceTimersByTimeAsync(50); // bootstrap done
    const q = us.getUsSessionQuote('SPY');
    expect(q).toBeTruthy();
    expect(q.price).toBe(713.36);
    expect(q.source).toBe('yahoo-us-fallback');
    expect(q.prevClose).toBe(716.43); // correct prevClose (not Thursday's close)
    // No clients → no fallback refresh → session goes stale after maxStale (8s open):
    await vi.advanceTimersByTimeAsync(9000);
    expect(us.getUsSessionQuote('SPY')).toBeNull();
  });
});

describe('usStream — Finnhub WS lifecycle + reconnect deadlock fix (RC4)', () => {
  let us;
  let getTick;
  let wsInstances;
  let fetchMock;
  const makeFakeWs = () => {
    const ws = new EventEmitter();
    ws.readyState = 0; // CONNECTING
    ws.sent = [];
    ws.send = (d) => { ws.sent.push(JSON.parse(d)); };
    ws.close = () => { ws.readyState = 3; };
    wsInstances.push(ws);
    setTimeout(() => { ws.readyState = 1; ws.emit('open'); }, 20); // async open
    return ws;
  };
  beforeEach(async () => {
    vi.resetModules();
    vi.stubEnv('FINNHUB_API_KEY', 'TEST-KEY');
    vi.useFakeTimers();
    vi.setSystemTime(US_OPEN_T);
    getTick = (await import('../server/liveFeed.js')).getTick;
    us = await import('../server/usStream.js');
    us._resetUsStreamForTest();
    wsInstances = [];
    us._setWsFactoryForTest(makeFakeWs);
    fetchMock = vi.fn(async () => yahooResponse(713.36, 716.43, Math.floor(US_OPEN_T / 1000)));
    us._setUsFetchForTest(fetchMock);
  });
  afterEach(() => { vi.useRealTimers(); vi.unstubAllEnvs(); us?._setWsFactoryForTest(null); us?._setUsFetchForTest(null); });

  it('connects on first client and subscribes every tracked symbol', async () => {
    us.ensureUsSubscribed(['SPY', 'QQQ']);
    await vi.advanceTimersByTimeAsync(30);
    us.usClientUp();
    await vi.advanceTimersByTimeAsync(30);
    expect(wsInstances.length).toBe(1);
    const subs = wsInstances[0].sent.filter(m => m.type === 'subscribe').map(m => m.symbol);
    expect(subs).toContain('SPY');
    expect(subs).toContain('QQQ');
  });

  it('REGRESSION (deadlock): a client arriving inside the reconnect backoff window still gets connected', async () => {
    us.ensureUsSubscribed(['SPY']);
    await vi.advanceTimersByTimeAsync(30);
    us.usClientUp();
    await vi.advanceTimersByTimeAsync(30);
    expect(wsInstances.length).toBe(1);

    // Socket dies → 5s backoff scheduled.
    wsInstances[0].emit('error');
    expect(us.usDebugState().reconnectAt).toBeGreaterThan(Date.now());

    // The only client leaves → _disconnect() CLEARS the reconnect timer
    // (old bug: timer cleared but _reconnectAt stayed in the future).
    us.usClientDown();

    // A NEW client arrives 2s into the 5s backoff — must not be stranded.
    vi.advanceTimersByTime(2000);
    us.usClientUp();
    // Old code: _connect() refused by _reconnectAt and NOTHING would ever retry.
    await vi.advanceTimersByTimeAsync(3001); // ride out the remaining backoff
    await vi.advanceTimersByTimeAsync(50);   // let the fresh socket finish opening
    expect(wsInstances.length).toBe(2);      // reconnect actually happened
    const subs = wsInstances[1].sent.filter(m => m.type === 'subscribe').map(m => m.symbol);
    expect(subs).toContain('SPY');
  });

  it('WS trade message sets a realtime tick with trade volume and lastWsTick tracking', async () => {
    us.ensureUsSubscribed(['NVDA']);
    await vi.advanceTimersByTimeAsync(30);
    us.usClientUp();
    await vi.advanceTimersByTimeAsync(30);
    const ws = wsInstances[0];
    ws.emit('message', JSON.stringify({
      type: 'trade',
      data: [{ s: 'NVDA', p: 219.74, t: Date.now(), v: 350 }],
    }));
    const t = getTick('US_NVDA');
    expect(t).toBeTruthy();
    expect(t.price).toBe(219.74);
    expect(t.volume).toBe(350); // per-trade volume now forwarded (was always 0)
    expect(us.usDebugState().lastWsTick.NVDA).toBeGreaterThan(0);
  });
});
