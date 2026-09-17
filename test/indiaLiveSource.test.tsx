// ============================================================
// test/indiaLiveSource.test.tsx — v10.12 (India plan #1) the
// India live-source transparency contract.
//
// THE ASK (user plan): "tag each tick with a src field —
// 'groww-live' when fetchGrowwNseQuote served it, 'yahoo-delayed'
// when the Yahoo index fallback served it, 'tv-ws' for the
// TradingView socket — and show the pill (Groww·live green /
// TV·WS blue / Yahoo·delayed amber) next to live LTP on each
// signal card."
//
// LOCKED HERE, per serving path:
//   1. inStream (SSE /api/stream?in=)  → groww-live / yahoo-delayed
//      (wire `source` — covered end-to-end in streamFeeds.test.ts)
//   2. intraday quotes stream (/api/intraday-stream) → every quote
//      tagged: stocks groww-live · indices yahoo-delayed · crypto
//      coindcx-inr
//   3. tvWebsocket (browser TV socket) → every update tagged 'tv-ws'
//   4. liveSourceBadge maps all three to the honest pills
//   (5. the SignalCard pill-gating contract lives in liveSourceBadge.test.tsx,
//      which renders the LIVE aitrading/SignalCard — the v11.7 cleanup removed
//      the dead intraday/SignalCard this file used to import)
// Hermetic: no network — fetch/WebSocket are injected doubles.
// ============================================================
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';

// ---------------- module mocks (same hermetic pattern as streamWatchSetPriority.test.ts) ----------------
vi.mock('../server/intraday/store.js', () => ({
  loadJSON: () => ({ trades: [], nextId: 1, dayKey: '' }),
  saveJSON: vi.fn(() => true),
}));
vi.mock('../server/intraday/journal.js', () => ({
  recordTradeClose: vi.fn(),
}));
vi.mock('../server/intraday/trackRecord.js', () => ({
  watcherSymbolsByMarket: vi.fn(() => ({ india: [], crypto: [] })),
}));

import { initIntradayStream, setScanSymbols, getLatestQuotes } from '../server/intraday/stream.js';
import { liveSourceBadge } from '../src/components/aitrading/LiveSourceBadge';
import { subscribeToPrices, handleParsedMessage, disconnectPrices } from '../src/utils/tvWebsocket';

// ============================================================
// 2. intraday quotes stream — per-path src tagging
// ============================================================
describe('intraday/stream — every quote is tagged with the upstream that served it', () => {
  // Mutable dep holders (initIntradayStream arms the watcher ONCE).
  const growwQuotes: Record<string, { price: number; change: number } | null> = {};
  const indexQuotes: Record<string, { price: number; change: number } | null> = {};
  let coinDcxTickers: Array<{ market: string; last_price: string; change_24_hour: string }> = [];

  beforeAll(() => {
    vi.useFakeTimers();
    vi.stubEnv('INTRADAY_DEBUG', '1'); // window gate off — deterministic ticks
    // regime.js's TV-scanner fetch (fire-and-forget inside _tick) fails fast offline:
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false })));
    initIntradayStream({
      fetchGrowwNseQuote: async (sym: string) => growwQuotes[sym] ?? null,
      fetchCoinDcxTickers: async () => coinDcxTickers,
      fetchIndexSpot: async (sym: string) => indexQuotes[sym] ?? null,
      sendTelegramRaw: null,
      escapeHtml: (s: string) => s,
      dispatchOutcomeAlert: null,
    });
  });
  afterAll(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });
  beforeEach(() => {
    // NOTE: deliberately NO vi.clearAllTimers() here — the watcher's own
    // 5s interval (armed once in beforeAll) IS the system under test;
    // clearing it would silently kill the tick loop. State resets instead:
    for (const k of Object.keys(growwQuotes)) delete growwQuotes[k];
    for (const k of Object.keys(indexQuotes)) delete indexQuotes[k];
    coinDcxTickers = [];
    setScanSymbols([]);
  });

  it('Groww-served stock quote → src "groww-live"', async () => {
    growwQuotes['RELIANCE'] = { price: 2925.5, change: 0.43 };
    setScanSymbols(['RELIANCE'], 'INDIA');
    await vi.advanceTimersByTimeAsync(5100); // one 5s watcher tick
    const q = getLatestQuotes().data['RELIANCE'];
    expect(q).toBeTruthy();
    expect(q.price).toBe(2925.5);
    expect(q.src).toBe('groww-live');
  });

  it('Yahoo-served INDEX quote → src "yahoo-delayed" (Groww has no index quotes)', async () => {
    growwQuotes['NIFTY'] = null;            // Groww miss…
    indexQuotes['NIFTY'] = { price: 24800, change: -0.4 }; // …Yahoo index fallback serves it
    setScanSymbols(['NIFTY'], 'INDIA');
    await vi.advanceTimersByTimeAsync(5100);
    const q = getLatestQuotes().data['NIFTY'];
    expect(q).toBeTruthy();
    expect(q.price).toBe(24800);
    expect(q.src).toBe('yahoo-delayed');
  });

  it('CoinDCX-served crypto watch symbol → src "coindcx-inr"', async () => {
    coinDcxTickers = [{ market: 'BTCINR', last_price: '4350000', change_24_hour: '1.25' }];
    setScanSymbols(['BTC'], 'CRYPTO');
    await vi.advanceTimersByTimeAsync(5100);
    const q = getLatestQuotes().data['BTC'];
    expect(q).toBeTruthy();
    expect(q.price).toBe(4350000);
    expect(q.src).toBe('coindcx-inr');
  });
});

// ============================================================
// 3. tvWebsocket — every browser TV-socket update is tagged 'tv-ws'
// ============================================================
describe('tvWebsocket — the browser TV socket tags its updates', () => {
  const FakeWebSocket = class {
    static readonly CONNECTING = 0;
    static readonly OPEN = 1;
    static readonly CLOSING = 2;
    static readonly CLOSED = 3;
    readyState = 0; // CONNECTING — subscribeToPrices won't re-connect
    onopen: unknown = null;
    onmessage: unknown = null;
    onclose: unknown = null;
    onerror: unknown = null;
    send() { /* offline double */ }
    close() { /* offline double */ }
  };

  afterEach(() => { disconnectPrices(); });

  it('a qsd price update reaches callbacks with src "tv-ws" + isRealtime', () => {
    vi.stubGlobal('WebSocket', FakeWebSocket);
    try {
      const seen: Array<{ key: string; data: Record<string, unknown> }> = [];
      subscribeToPrices(['RELIANCE'], (key, data) => { seen.push({ key, data: data as Record<string, unknown> }); });

      // TradingView wire shape: qsd = { m:'qsd', p:[session, {n:'NSE:RELIANCE', s:'ok', v:{lp,…}}] }
      handleParsedMessage({
        m: 'qsd',
        p: ['sess_1', { n: 'NSE:RELIANCE', s: 'ok', v: { lp: 2925.5, chp: 0.42, high_price: 2950, low_price: 2900, volume: 1234 } }],
      });

      expect(seen.length).toBe(1);
      expect(seen[0].key).toBe('IN_RELIANCE');
      expect(seen[0].data.price).toBe(2925.5);
      expect(seen[0].data.src).toBe('tv-ws');
      expect(seen[0].data.isRealtime).toBe(true);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

// ============================================================
// 4. liveSourceBadge — the three India labels map to the plan's pills
// ============================================================
describe('liveSourceBadge — India label → pill mapping', () => {
  it('groww-live → Groww·live (green)', () => {
    const b = liveSourceBadge('groww-live');
    expect(b.label).toBe('Groww·live');
    expect(b.cls).toContain('emerald');
  });
  it('tv-ws → TV·WS (blue)', () => {
    const b = liveSourceBadge('tv-ws');
    expect(b.label).toBe('TV·WS');
    expect(b.cls).toContain('sky');
  });
  it('yahoo-delayed → Yahoo·delayed (amber)', () => {
    const b = liveSourceBadge('yahoo-delayed');
    expect(b.label).toBe('Yahoo·delayed');
    expect(b.cls).toContain('amber');
  });
  it('coindcx-inr (intraday crypto watch) → CoinDCX·RT', () => {
    expect(liveSourceBadge('coindcx-inr').label).toBe('CoinDCX·RT');
  });
});
