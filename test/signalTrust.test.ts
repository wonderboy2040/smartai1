// ============================================================
// test/signalTrust.test.ts — v12.4 SIGNAL CONTINUITY ENGINE
// ------------------------------------------------------------
// LOCKED HERE (the WLD incident class):
//   • CONTINUITY — firstSeenAt age tracking across observations,
//     FLIP detection with prevSide + bounded 24h history, FLAT
//     handling (side cleared, last directional view preserved)
//   • OB/OS HARD GUARD — RSI ≥ 70 LONG / RSI ≤ 30 SHORT can never
//     wear ACTION/STRONG (WATCH cap + confidence floor); extreme
//     bands cut harder; neutral RSI untouched; grade never UPGRADED
//   • FLIP COOLDOWN — a side younger than 5m since the flip is
//     capped to WATCH; 5-10m takes a soft haircut; older flips pass
//   • WIRE — buildSignal forwards signalAge / obOs / freshFlip
//   • PERSISTENCE — holdingPositions reads journal + manual stores
//     (market filter, SELL→SHORT, pair normalization), and
//     pinHoldingOnBoard stamps existing cards + pins missing ones
//     (bounded), buildHoldingCard stays honest (≤WATCH, no plan,
//     not executable, holdingOnly marker)
// Hermetic: in-memory store mock (same pattern as manualTrades).
// ============================================================
import { describe, it, expect, beforeEach, vi } from 'vitest';

// ---- hermetic store (no disk) ----
const _disk = vi.hoisted(() => new Map());
vi.mock('../server/lib/store.js', () => ({
  loadJSON: (f: string, d: unknown) => (_disk.has(f) ? structuredClone(_disk.get(f)) : structuredClone(d)),
  saveJSON: (f: string, v: unknown) => { _disk.set(f, v); },
}));

import {
  remember, continuityOf, applySignalTrustGuards, holdingPositions, buildHoldingCard,
  pinHoldingOnBoard, normSym, __resetSignalMemoryForTests,
  OB_RSI, OS_RSI, OB_RSI_EXTREME, FLIP_COOLDOWN_MS,
} from '../server/ai/signalMemory.js';
import { buildSignal } from '../server/ai/ensemble.js';

const T0 = 1_800_000_000_000; // fixed epoch anchor

function consensusOf(over = {}) {
  return {
    side: 'LONG', dir: 1, confidence: 78, agreement: 0.8, participation: 0.9,
    grade: 'STRONG', voters: 10, participating: 10, totalModels: 14,
    bullWeight: 9, bearWeight: 1, summary: 'LONG 78% · 10/14 models voting',
    ...over,
  };
}

beforeEach(() => {
  _disk.clear();
  __resetSignalMemoryForTests();
  vi.useFakeTimers();
  vi.setSystemTime(T0);
});

describe('v12.4 continuity store — remember / continuityOf', () => {
  it('tracks firstSeenAt on first directional view and keeps it stable across re-observations', () => {
    remember('FUTURES', 'WLD', { side: 'LONG', confidence: 78, grade: 'STRONG', ltp: 0.4385 });
    vi.setSystemTime(T0 + 12 * 60_000);
    remember('FUTURES', 'WLD', { side: 'LONG', confidence: 74, grade: 'ACTION', ltp: 0.44 });
    const c = continuityOf('FUTURES', 'WLD');
    expect(c).not.toBeNull();
    expect(c!.side).toBe('LONG');
    expect(c!.firstSeenAt).toBe(T0); // age anchors at the FIRST sighting
    expect(c!.ageMs).toBe(12 * 60_000);
    expect(c!.lastConf).toBe(74);
    expect(c!.flips24h).toBe(0);
  });

  it('detects a side flip: prevSide recorded, age RESET, flip history bounded to 24h', () => {
    remember('FUTURES', 'WLD', { side: 'LONG', confidence: 78, grade: 'STRONG' });
    vi.setSystemTime(T0 + 30 * 60_000);
    remember('FUTURES', 'WLD', { side: 'SHORT', confidence: 71, grade: 'STRONG' });
    const c = continuityOf('FUTURES', 'WLD')!;
    expect(c.side).toBe('SHORT');
    expect(c.prevSide).toBe('LONG');
    expect(c.flippedAt).toBe(T0 + 30 * 60_000);
    expect(c.ageMs).toBe(0); // the SHORT is brand new
    expect(c.flips.length).toBe(1);
    expect(c.flips[0]).toMatchObject({ from: 'LONG', to: 'SHORT' });
    // 25h-old flips fall out of the 24h window
    vi.setSystemTime(T0 + 30 * 60_000 + 25 * 3600_000);
    const c2 = continuityOf('FUTURES', 'WLD')!;
    expect(c2.flips24h).toBe(0);
  });

  it('FLAT clears the current side but PRESERVES the last directional view (the pinned-card read)', () => {
    remember('FUTURES', 'WLD', { side: 'LONG', confidence: 78, grade: 'STRONG' });
    vi.setSystemTime(T0 + 8 * 60_000);
    remember('FUTURES', 'WLD', { side: 'FLAT', confidence: 0, grade: 'NEUTRAL' });
    const c = continuityOf('FUTURES', 'WLD')!;
    expect(c.side).toBeNull();
    expect(c.ageMs).toBeNull();
    expect(c.lastDirSide).toBe('LONG'); // "AI abhi neutral hai (last view: LONG 8m pehle)"
    expect(c.lastDirAgeMs).toBe(8 * 60_000);
    // a later opposite view counts as a FLIP vs the last directional side
    vi.setSystemTime(T0 + 10 * 60_000);
    remember('FUTURES', 'WLD', { side: 'SHORT', confidence: 65, grade: 'ACTION' });
    const c2 = continuityOf('FUTURES', 'WLD')!;
    expect(c2.prevSide).toBe('LONG');
    expect(c2.flips.length).toBe(1);
  });

  it('keys are per-market (WLD on FUTURES ≠ WLD on CRYPTO) and symbols normalize', () => {
    remember('FUTURES', 'WLD', { side: 'LONG', confidence: 60, grade: 'ACTION' });
    remember('CRYPTO', 'WLD', { side: 'SHORT', confidence: 55, grade: 'ACTION' });
    expect(continuityOf('FUTURES', 'WLD')!.side).toBe('LONG');
    expect(continuityOf('CRYPTO', 'WLD')!.side).toBe('SHORT');
    expect(normSym('B-WLD_USDT')).toBe('WLD');
    expect(normSym('WLDINR')).toBe('WLD');
    expect(normSym('NVDA-USD')).toBe('NVDA');
  });
});

describe('v12.4 applySignalTrustGuards — OB/OS hard guard', () => {
  it('LONG at RSI ≥ 70 is suppressed: grade capped to WATCH, confidence floored, obOs attached + summary says so', () => {
    const out = applySignalTrustGuards({
      market: 'FUTURES', symbol: 'WLD',
      consensus: consensusOf({ side: 'LONG', dir: 1, confidence: 82, grade: 'STRONG' }),
      ctx: { ltp: 0.4385, ind: { rsi: 74.3 } },
    })!;
    expect(out.grade).toBe('WATCH');
    expect(out.confidence).toBeLessThanOrEqual(50);
    expect(out.obOs).toMatchObject({ tag: 'OVERBOUGHT', rsi: 74.3 });
    expect(out.summary).toContain('OVERBOUGHT');
    expect(out.side).toBe('LONG'); // side/ltp untouched — plans stay valid
  });

  it('extreme overbought (RSI ≥ 78) cuts confidence harder', () => {
    const out = applySignalTrustGuards({
      market: 'FUTURES', symbol: 'WLD',
      consensus: consensusOf({ confidence: 90, grade: 'STRONG' }),
      ctx: { ltp: 1, ind: { rsi: OB_RSI_EXTREME + 1 } },
    })!;
    expect(out.grade).toBe('WATCH');
    expect(out.confidence).toBeLessThanOrEqual(42);
    expect(out.obOs?.extreme).toBe(true);
  });

  it('SHORT at RSI ≤ 30 is suppressed the same way (oversold bounce risk)', () => {
    const out = applySignalTrustGuards({
      market: 'CRYPTO', symbol: 'BTC',
      consensus: consensusOf({ side: 'SHORT', dir: -1, confidence: 76, grade: 'STRONG' }),
      ctx: { ltp: 60000, ind: { rsi: OS_RSI - 2 } },
    })!;
    expect(out.grade).toBe('WATCH');
    expect(out.obOs).toMatchObject({ tag: 'OVERSOLD' });
  });

  it('neutral RSI (30 < rsi < 70) leaves the consensus untouched apart from the age attach', () => {
    const out = applySignalTrustGuards({
      market: 'FUTURES', symbol: 'WLD',
      consensus: consensusOf({ confidence: 82, grade: 'STRONG' }),
      ctx: { ltp: 0.44, ind: { rsi: 58 } },
    })!;
    expect(out.grade).toBe('STRONG');
    expect(out.confidence).toBe(82);
    expect(out.obOs).toBeUndefined();
    expect(out.signalAge).toBeDefined();
  });

  it('LTF RSI wins over the daily RSI (the trading timeframe is what the entry rides on)', () => {
    const out = applySignalTrustGuards({
      market: 'FUTURES', symbol: 'WLD',
      consensus: consensusOf(),
      ctx: { ltp: 0.44, ind: { rsi: 55 } },
      ltf: { rsi: 73 },
    })!;
    expect(out.obOs).toMatchObject({ tag: 'OVERBOUGHT' });
  });

  it('a NEUTRAL/low grade is never UPGRADED, and a WATCH LONG below the RSI guard is untouched grade-wise', () => {
    const out = applySignalTrustGuards({
      market: 'FUTURES', symbol: 'WLD',
      consensus: consensusOf({ side: 'LONG', dir: 1, confidence: 40, grade: 'NEUTRAL' }),
      ctx: { ltp: 1, ind: { rsi: 75 } },
    })!;
    expect(out.grade).toBe('NEUTRAL'); // cap only ever TIGHTENS
    expect(out.obOs).toBeDefined();
  });
});

describe('v12.4 applySignalTrustGuards — flip cooldown (anti-whipsaw)', () => {
  it('a side that JUST flipped (< 5m) is capped to WATCH + freshFlip flag', () => {
    remember('FUTURES', 'WLD', { side: 'LONG', confidence: 78, grade: 'STRONG' });
    vi.setSystemTime(T0 + 90_000); // flip 90s ago
    const out = applySignalTrustGuards({
      market: 'FUTURES', symbol: 'WLD',
      consensus: consensusOf({ side: 'SHORT', dir: -1, confidence: 80, grade: 'STRONG' }),
      ctx: { ltp: 0.43, ind: { rsi: 50 } },
    })!;
    expect(out.grade).toBe('WATCH');
    expect(out.freshFlip).toMatchObject({ from: 'LONG', to: 'SHORT' });
    expect(out.confidence).toBeLessThanOrEqual(52);
    expect(out.summary).toContain('FLIP');
  });

  it('5-10m after a flip: soft confidence haircut only, no grade cap', () => {
    remember('FUTURES', 'WLD', { side: 'LONG', confidence: 78, grade: 'STRONG' });
    vi.setSystemTime(T0 + 1000); // the SHORT first appears here (flip recorded)
    applySignalTrustGuards({
      market: 'FUTURES', symbol: 'WLD',
      consensus: consensusOf({ side: 'SHORT', dir: -1, confidence: 80, grade: 'STRONG' }),
      ctx: { ltp: 0.43, ind: { rsi: 50 } },
    });
    vi.setSystemTime(T0 + 7 * 60_000); // 7m after the flip
    const out = applySignalTrustGuards({
      market: 'FUTURES', symbol: 'WLD',
      consensus: consensusOf({ side: 'SHORT', dir: -1, confidence: 80, grade: 'STRONG' }),
      ctx: { ltp: 0.43, ind: { rsi: 50 } },
    })!;
    expect(out.grade).toBe('STRONG');
    expect(out.confidence).toBe(80 - 8);
    expect(out.freshFlip).toBeUndefined();
  });

  it(`a flip older than ${Math.round(FLIP_COOLDOWN_MS / 60000)}m+soft window passes clean`, () => {
    remember('FUTURES', 'WLD', { side: 'LONG', confidence: 78, grade: 'STRONG' });
    vi.setSystemTime(T0 + 1000); // the SHORT first appears here (flip recorded)
    applySignalTrustGuards({
      market: 'FUTURES', symbol: 'WLD',
      consensus: consensusOf({ side: 'SHORT', dir: -1, confidence: 80, grade: 'STRONG' }),
      ctx: { ltp: 0.43, ind: { rsi: 50 } },
    });
    vi.setSystemTime(T0 + 12 * 60_000); // 12m after the flip — clean
    const out = applySignalTrustGuards({
      market: 'FUTURES', symbol: 'WLD',
      consensus: consensusOf({ side: 'SHORT', dir: -1, confidence: 80, grade: 'STRONG' }),
      ctx: { ltp: 0.43, ind: { rsi: 50 } },
    })!;
    expect(out.grade).toBe('STRONG');
    expect(out.confidence).toBe(80);
  });

  it('a FIRST-EVER direction (no prevSide) is not treated as a flip', () => {
    const out = applySignalTrustGuards({
      market: 'FUTURES', symbol: 'NEWCOIN',
      consensus: consensusOf(),
      ctx: { ltp: 1, ind: { rsi: 50 } },
    })!;
    expect(out.freshFlip).toBeUndefined();
    expect(out.grade).toBe('STRONG');
  });

  it('FLAT consensus is remembered but never guarded (no flags, no grade change)', () => {
    const out = applySignalTrustGuards({
      market: 'FUTURES', symbol: 'WLD',
      consensus: consensusOf({ side: 'FLAT', dir: 0, confidence: 0, grade: 'NEUTRAL' }),
      ctx: { ltp: 0.44, ind: { rsi: 75 } },
    })!;
    expect(out.obOs).toBeUndefined();
    expect(out.grade).toBe('NEUTRAL');
    expect(continuityOf('FUTURES', 'WLD')!.side).toBeNull();
  });
});

describe('v12.4 wire — buildSignal forwards the trust fields', () => {
  it('signalAge / obOs / freshFlip ride the payload to the card', () => {
    const sig = buildSignal({
      symbol: 'WLD', market: 'FUTURES',
      ctx: { ltp: 0.4385, changePct: -2.1 },
      votes: [],
      consensus: consensusOf({
        confidence: 50, grade: 'WATCH',
        signalAge: { firstSeenAt: T0 - 300_000, lastSeenAt: T0, ageMs: 300_000, flips24h: 2 },
        obOs: { tag: 'OVERBOUGHT', rsi: 74.3, extreme: false },
        freshFlip: { from: 'SHORT', to: 'LONG', ageSec: 45 },
      }),
      plan: null,
    });
    expect(sig.signalAge).toMatchObject({ flips24h: 2 });
    expect(sig.obOs).toMatchObject({ tag: 'OVERBOUGHT' });
    expect(sig.freshFlip).toMatchObject({ from: 'SHORT', to: 'LONG' });
    expect(sig.executable).toBe(false); // WATCH + no plan → never executable
  });
});

describe('v12.4 holdingPositions — the pinning source', () => {
  it('reads OPEN journal positions + manual trades for the market, normalizing sides and symbols', () => {
    _disk.set('ai-trading-journal.json', {
      entries: [],
      positions: [
        { pair: 'WLD-USDT', symbol: 'WLD', market: 'FUTURES', side: 'LONG', status: 'OPEN', entryPrice: 0.4385, qty: 692, mode: 'live', source: 'manual', openedAt: T0 - 3600_000 },
        { pair: 'BTCINR', market: 'CRYPTO', side: 'SHORT', status: 'OPEN', entryPrice: 600000, qty: 0.01, mode: 'paper', source: 'auto', openedAt: T0 - 60_000 },
        { pair: 'X-INR', market: 'CRYPTO', side: 'LONG', status: 'CLOSED', entryPrice: 1, qty: 1 }, // closed → ignored
        { pair: 'RELIANCE', symbol: 'RELIANCE', market: 'INDIA', side: 'LONG', status: 'OPEN', entryPrice: 1400, qty: 10, openedAt: T0 },
      ],
    });
    _disk.set('manual-trades.json', {
      trades: [
        { id: 9, symbol: 'WLD', market: 'FUTURES', side: 'BUY', entryPrice: 0.4371, qty: 300, status: 'OPEN', entryTime: T0 - 7200_000 },
        { id: 10, symbol: 'HBAR', market: 'FUTURES', side: 'SELL', entryPrice: 0.1512, qty: 1000, status: 'CLOSED' },
      ],
    });
    const fut = holdingPositions('FUTURES');
    expect(fut).toHaveLength(2); // journal WLD + manual WLD (closed HBAR ignored)
    expect(fut[0]).toMatchObject({ symbol: 'WLD', side: 'LONG', entryPrice: 0.4385, qty: 692, via: 'journal' });
    expect(fut[1]).toMatchObject({ symbol: 'WLD', side: 'LONG', via: 'manual', entryPrice: 0.4371 });
    const cry = holdingPositions('CRYPTO');
    expect(cry).toHaveLength(1);
    expect(cry[0]).toMatchObject({ symbol: 'BTC', side: 'SHORT' }); // BTCINR normalized, side kept
    expect(holdingPositions('GLOBALFUTURES')).toHaveLength(0);
  });

  it('degrades to empty on unreadable stores (never throws)', () => {
    _disk.set('ai-trading-journal.json', null as never);
    _disk.set('manual-trades.json', { trades: 'garbage' } as never);
    expect(() => holdingPositions('FUTURES')).not.toThrow();
  });
});

describe('v12.4 pinHoldingOnBoard + buildHoldingCard — traded symbols never vanish', () => {
  it('stamps an existing board card with holding and pins a missing symbol (honest card)', () => {
    _disk.set('ai-trading-journal.json', {
      entries: [],
      positions: [
        { pair: 'WLD-USDT', symbol: 'WLD', market: 'FUTURES', side: 'LONG', status: 'OPEN', entryPrice: 0.4385, qty: 692, mode: 'live', source: 'manual', openedAt: T0 - 3600_000 },
      ],
    });
    remember('FUTURES', 'WLD', { side: 'LONG', confidence: 71, grade: 'STRONG', ltp: 0.4401 });
    const board = [
      { symbol: 'BTC', market: 'FUTURES', side: 'LONG', grade: 'STRONG', confidence: 80, executable: true },
    ];
    pinHoldingOnBoard(board as never, 'FUTURES', { maxPinned: 4 });
    // existing BTC card got a stamp? (no BTC position here — only WLD)
    const wld = board.find(s => s.symbol === 'WLD');
    expect(wld).toBeDefined(); // the pin landed
    expect(wld!.holdingOnly).toBe(true);
    expect(wld!.holding).toMatchObject({ side: 'LONG', entryPrice: 0.4385, qty: 692 });
    expect(['WATCH', 'NEUTRAL']).toContain(wld!.grade); // never above WATCH
    expect(wld!.executable).toBe(false); // context, not a trade call
    expect(wld!.plan).toBeNull();
    expect(wld!.summary).toContain('OPEN POSITION PIN');
    expect(wld!.summary).toContain('AI view'); // the current AI view stamped
  });

  it('stamps the HOLDING badge on a card that IS on the board', () => {
    _disk.set('ai-trading-journal.json', {
      entries: [],
      positions: [{ pair: 'BTC-USDT', symbol: 'BTC', market: 'FUTURES', side: 'LONG', status: 'OPEN', entryPrice: 60000, qty: 0.5, mode: 'live', openedAt: T0 - 600_000 }],
    });
    const board = [
      { symbol: 'BTC', market: 'FUTURES', side: 'LONG', grade: 'STRONG', confidence: 80, executable: true },
    ];
    pinHoldingOnBoard(board as never, 'FUTURES');
    expect(board).toHaveLength(1); // stamped, not duplicated
    expect(board[0].holding).toMatchObject({ side: 'LONG', entryPrice: 60000, qty: 0.5 });
    expect(board[0].holdingOnly).toBeUndefined();
  });

  it('bounds the pins (maxPinned) so a full book cannot flood the board', () => {
    _disk.set('ai-trading-journal.json', {
      entries: [],
      positions: ['A', 'B', 'C', 'D', 'E', 'F'].map(s => ({
        pair: `${s}-USDT`, symbol: s, market: 'FUTURES', side: 'LONG', status: 'OPEN', entryPrice: 1, qty: 1, openedAt: T0,
      })),
    });
    const board: object[] = [];
    pinHoldingOnBoard(board as never, 'FUTURES', { maxPinned: 4 });
    expect(board).toHaveLength(4);
  });

  it('a held symbol with NO fresh AI view pins with the honest stale note and position side', () => {
    _disk.set('ai-trading-journal.json', {
      entries: [],
      positions: [{ pair: 'DOGE-USDT', symbol: 'DOGE', market: 'FUTURES', side: 'SHORT', status: 'OPEN', entryPrice: 0.12, qty: 5000, openedAt: T0 - 86_400_000 }],
    });
    const board: object[] = [];
    pinHoldingOnBoard(board as never, 'FUTURES');
    const card = board[0] as Record<string, unknown>;
    expect(card.side).toBe('SHORT'); // position side carries the card
    expect(card.summary).toContain('stale');
    expect(card.holding).toMatchObject({ side: 'SHORT', qty: 5000 });
  });
});
