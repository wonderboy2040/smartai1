// ============================================================
// test/manualTrades.test.ts — v10.16 SECTION 2: MANUAL TRADE TRACKER
// ------------------------------------------------------------
// LOCKED HERE:
//   • the pure math: P&L (direction/lot/fx-domain), level distances
//     (favor-frame signed), entry-vs-LTP deviation warn
//   • the STATE BANNER priority: TARGET_HIT > EXIT_NOW > WEAKENING >
//     STALE > THESIS_INTACT
//   • the SNAPSHOT FREEZE: plan/votes/regime/aiScore at record time —
//     the baseline every later conviction delta is measured against
//   • CRUD validation (symbol/side/price/qty + F&O fields) + honest
//     close (price or live stamp; never a fake 0 exit)
//   • LTP resolution: tick-store keys per market, India fallback,
//     OPTION Black-Scholes re-price on the live underlying
//   • the ALERT ladder: flip (EXIT NOW, immediate) / SL approach
//     (0.3×ATR) / T1+T2 (once each) / cooldowns
//   • the 5s level-touch wiring contract: rows satisfy
//     telegramPush.detectLevelTouches (status OPEN · LONG/SHORT sides)
//     so the user's own trades ride the SAME pipeline
//   • the monitor loop: deps live on _mon.deps (the wiring bug this
//     suite locks out), conviction stamping, idle parking
// Same hermetic scaffolding as positionConviction/paperHistory suites.
// ============================================================
import { describe, it, expect, beforeEach, vi } from 'vitest';

// ---- hermetic store (no disk) ----
const _disk = vi.hoisted(() => new Map());
vi.mock('../server/lib/store.js', () => ({
  loadJSON: (f, d) => (_disk.has(f) ? _disk.get(f) : d),
  saveJSON: (f, v) => { _disk.set(f, v); },
}));
// ---- no backup IO ----
vi.mock('../server/intraday/backup.js', () => ({
  scheduleBackup: vi.fn(),
}));
// ---- controllable live tick store ----
const _ticks = vi.hoisted(() => new Map());
vi.mock('../server/liveFeed.js', () => ({
  getTick: (k) => _ticks.get(k) || null,
}));
// ---- telegramPush's transitive imports stay hermetic (same boundary
// mocks as test/telegramPush.test.ts — only the PURE detector +
// formatter are consumed here) ----
vi.mock('../server/ai/coindcxOrders.js', () => ({
  getPositionsWithPnl: vi.fn(async () => ({ positions: [] })),
  loadConfig: vi.fn(() => ({ killSwitch: false })),
}));
vi.mock('../server/intraday/paperTrading.js', () => ({
  getPaperSummary: vi.fn(() => ({ open: [] })),
}));
vi.mock('../server/ai/secrets.js', () => ({
  telegramConfig: vi.fn(() => ({ token: 'T', chatId: 'C', source: 'env' })),
  sendTelegramMessage: vi.fn(async () => ({ ok: true })),
}));

import {
  validateEntryVsLtp, manualPnlOf, manualLevelDistances, stateOfManualTrade,
  manualConvictionOf, flipSummary, manualTradesToPositionRows,
  recordManualTrade, listManualTrades, getManualTrade, closeManualTrade,
  ltpForManualTrade, manualTradeView, evaluateManualTradeAlerts,
  manualMonitorStatus, startManualTradeMonitor, stopManualTradeMonitor,
  __resetManualStoreForTests, __setManualStateForTests,
  __monitorTickForTests, __monitorStateForTests,
} from '../server/ai/manualTrades.js';
import { detectLevelTouches, formatLevelTouch } from '../server/ai/telegramPush.js';

const SIGNAL_SNAPSHOT = {
  symbol: 'RELIANCE', market: 'INDIA', side: 'LONG', grade: 'STRONG',
  confidence: 82, agreement: 0.78, voters: 9,
  regime: 'REGIME ALIGNED',
  superIntel: { aiScore: 84 },
  plan: { entry: 1235, stopLoss: 1210, target1: 1260, target2: 1290, riskPct: 0.8, atr: 9.5 },
  votes: [
    { id: 'trend', name: 'TrendMatrix', dir: 1, conf: 88 },
    { id: 'momentum', name: 'MomentumX', dir: 1, conf: 74 },
    { id: 'options', name: 'OptionsFlow', dir: -1, conf: 66 },
  ],
  summary: '9-model committee LONG',
};

beforeEach(() => {
  _disk.clear();
  _ticks.clear();
  __resetManualStoreForTests();
  stopManualTradeMonitor();
  // the module-level alert-cooldown map survives store resets (ids
  // restart at 1) — clear it or test N+1 inherits test N's cooldowns.
  __monitorStateForTests().alerts.clear();
});

// ------------------------------------------------------------
describe('validateEntryVsLtp — the typo guard (warn, never block)', () => {
  it('within tolerance → no warn, deviation reported', () => {
    const r = validateEntryVsLtp({ entryPrice: 1240, ltp: 1235.3 });
    expect(r.warn).toBe(false);
    expect(r.deviationPct).toBeCloseTo(0.4, 1);
  });

  it('beyond tolerance → warn (a typo here corrupts every downstream P&L)', () => {
    const r = validateEntryVsLtp({ entryPrice: 1240, ltp: 1000 });
    expect(r.warn).toBe(true);
    expect(r.deviationPct).toBeCloseTo(24, 0);
  });

  it('missing prices → honest no-warn, null deviation', () => {
    expect(validateEntryVsLtp({ entryPrice: null, ltp: 100 })).toEqual({ warn: false, deviationPct: null });
    expect(validateEntryVsLtp({ entryPrice: 100, ltp: null })).toEqual({ warn: false, deviationPct: null });
  });
});

// ------------------------------------------------------------
describe('manualPnlOf — direction / lots / currency-domain math', () => {
  it('India equity LONG: +pct and native INR', () => {
    const t = { market: 'INDIA', side: 'BUY', entryPrice: 100, qty: 10 };
    const p = manualPnlOf(t, 110);
    expect(p.pnlPct).toBeCloseTo(10, 2);
    expect(p.pnlINR).toBeCloseTo(100, 2);
    expect(p.pnlUSDT).toBeNull();
    expect(p.currency).toBe('INR');
  });

  it('SHORT flips the sign (SELL side reads a falling price as profit)', () => {
    const t = { market: 'INDIA', side: 'SELL', entryPrice: 100, qty: 10 };
    const p = manualPnlOf(t, 90);
    expect(p.pnlPct).toBeCloseTo(10, 2);
    expect(p.pnlINR).toBeCloseTo(100, 2);
  });

  it('FUTURES (USDT domain): native USDT + fx-converted INR', () => {
    const t = { market: 'FUTURES', side: 'BUY', entryPrice: 100, qty: 2 };
    const p = manualPnlOf(t, 105, { usdInr: 84 });
    expect(p.pnlUSDT).toBeCloseTo(10, 3);
    expect(p.pnlINR).toBeCloseTo(840, 1);
    expect(p.currency).toBe('USDT');
  });

  it('OPTION trades multiply qty (LOTS) by lotSize — the F&O paper-card convention', () => {
    const t = { market: 'INDIA', side: 'BUY', entryPrice: 100, qty: 2, lotSize: 75, assetKind: 'OPTION' };
    const p = manualPnlOf(t, 102);
    expect(p.pnlINR).toBeCloseTo(300, 1); // (102-100) × 2 lots × 75
    expect(p.pnlPct).toBeCloseTo(2, 2);
  });

  it('no live price → honest zeros (never a fake number)', () => {
    const p = manualPnlOf({ market: 'INDIA', side: 'BUY', entryPrice: 100, qty: 5 }, null);
    expect(p.pnlINR).toBe(0);
    expect(p.pnlPct).toBe(0);
    const u = manualPnlOf({ market: 'FUTURES', side: 'BUY', entryPrice: 100, qty: 5 }, null);
    expect(u.pnlUSDT).toBe(0);
  });
});

// ------------------------------------------------------------
describe('manualLevelDistances — favor-frame signed distances', () => {
  const plan = { stopLoss: 1210, target1: 1260, target2: 1290 };

  it('LONG: SL behind (negative), T1/T2 ahead (positive)', () => {
    const d = manualLevelDistances({ side: 'BUY', entryPrice: 1235, origin: { plan } }, 1240);
    expect(d.sl).toBeLessThan(0);
    expect(d.t1).toBeGreaterThan(0);
    expect(d.t2).toBeGreaterThan(0);
  });

  it('SHORT: the SAME plan mirrors (SL above = adverse)', () => {
    // a short entered at 1260 with SL 1290 / T1 1210 — reading 1240
    const shortPlan = { stopLoss: 1290, target1: 1210, target2: 1180 };
    const d = manualLevelDistances({ side: 'SELL', entryPrice: 1260, origin: { plan: shortPlan } }, 1240);
    expect(d.sl).toBeLessThan(0);   // SL above → against the short
    expect(d.t1).toBeGreaterThan(0); // T1 below → in favor
  });

  it('missing entry/ltp or levels → {} / nulls, never NaN', () => {
    expect(manualLevelDistances({ side: 'BUY', entryPrice: null }, 100)).toEqual({});
    expect(manualLevelDistances({ side: 'BUY', entryPrice: 100 }, null)).toEqual({});
    const d = manualLevelDistances({ side: 'BUY', entryPrice: 100, origin: { plan: {} } }, 100);
    expect(d.sl).toBeNull();
    expect(d.t1).toBeNull();
    expect(d.t2).toBeNull();
  });
});

// ------------------------------------------------------------
describe('stateOfManualTrade — the escalating banner', () => {
  const trade = { side: 'BUY', entryPrice: 1235, origin: { plan: { target1: 1260, target2: 1290 } } };

  it('TARGET_HIT beats EXIT_NOW (a reached target is bookable truth)', () => {
    expect(stateOfManualTrade({ convictionState: 'FLIPPED', ltp: 1265, trade })).toBe('TARGET_HIT');
  });

  it('FLIPPED → EXIT_NOW (thesis invalidated — the red pulsing row)', () => {
    expect(stateOfManualTrade({ convictionState: 'FLIPPED', ltp: 1240, trade })).toBe('EXIT_NOW');
  });

  it('WEAKENING / unknown / intact map straight through', () => {
    expect(stateOfManualTrade({ convictionState: 'WEAKENING', ltp: 1240, trade })).toBe('WEAKENING');
    expect(stateOfManualTrade({ convictionState: null, ltp: 1240, trade })).toBe('STALE');
    expect(stateOfManualTrade({ convictionState: 'UNKNOWN', ltp: 1240, trade })).toBe('STALE');
    expect(stateOfManualTrade({ convictionState: 'HOLDING', ltp: 1240, trade })).toBe('THESIS_INTACT');
    expect(stateOfManualTrade({ convictionState: 'STRENGTHENING', ltp: 1240, trade })).toBe('THESIS_INTACT');
  });
});

// ------------------------------------------------------------
describe('manualConvictionOf + flipSummary — the WHY behind a flip', () => {
  const trade = { side: 'BUY', origin: { aiScore: 84, votes: SIGNAL_SNAPSHOT.votes } };

  it('fresh opposite signal with quorum → FLIPPED (uses positionConviction core)', () => {
    const fresh = { side: 'SHORT', grade: 'STRONG', voters: 9, superIntel: { aiScore: 80 } };
    const c = manualConvictionOf(trade, fresh);
    expect(c.state).toBe('FLIPPED');
    expect(c.currentScore).toBe(80);
  });

  it('flipSummary names the models that switched sides vs entry (not the ones that always opposed)', () => {
    const fresh = {
      side: 'SHORT', superIntel: { aiScore: 80 },
      votes: [
        { id: 'trend', name: 'TrendMatrix', dir: -1 },     // was ours (dir 1) → FLIPPED
        { id: 'momentum', name: 'MomentumX', dir: 0 },      // was ours → now abstaining
        { id: 'options', name: 'OptionsFlow', dir: -1 },    // always opposed → not "ours"
        { id: 'newmodel', name: 'NewModel', dir: -1 },      // wasn't at entry → ignored
      ],
    };
    const w = flipSummary(trade, fresh);
    expect(w.flipped).toEqual(['TrendMatrix']);
    expect(w.abstainedNew).toEqual(['MomentumX']);
    expect(w.entryScore).toBe(84);
    expect(w.curScore).toBe(80);
  });

  it('no fresh signal → empty judgment aid', () => {
    const w = flipSummary(trade, null);
    expect(w.flipped).toEqual([]);
    expect(w.abstainedNew).toEqual([]);
  });
});

// ------------------------------------------------------------
describe('recordManualTrade — validation + THE SNAPSHOT FREEZE', () => {
  it('a valid trade records OK with the full originating snapshot frozen', () => {
    const out = recordManualTrade({
      market: 'INDIA', symbol: 'RELIANCE', side: 'LONG',
      entryPrice: 1235, qty: 10, ltp: 1235.3, signal: SIGNAL_SNAPSHOT,
    });
    expect(out.ok).toBe(true);
    expect(out.warn).toBeNull();
    const t = out.trade;
    expect(t.id).toBe(1);
    expect(t.status).toBe('OPEN');
    expect(t.market).toBe('INDIA');
    // THE BASELINE: plan + votes + regime + aiScore frozen verbatim
    expect(t.origin.aiScore).toBe(84);
    expect(t.origin.regime).toBe('REGIME ALIGNED');
    expect(t.origin.grade).toBe('STRONG');
    expect(t.origin.voters).toBe(9);
    expect(t.origin.plan).toMatchObject({ entry: 1235, stopLoss: 1210, target1: 1260, target2: 1290, atr: 9.5 });
    expect(t.origin.votes).toHaveLength(3);
    expect(t.origin.votes[0]).toEqual({ id: 'trend', name: 'TrendMatrix', dir: 1, conf: 88 });
  });

  it('rejects bad symbol / side / price / qty with honest errors', () => {
    expect(recordManualTrade({ symbol: 'X', side: 'BUY', entryPrice: 10, qty: 1 }).error).toContain('symbol');
    expect(recordManualTrade({ symbol: 'RELIANCE', side: 'SIDEWAYS', entryPrice: 10, qty: 1 }).error).toContain('side');
    expect(recordManualTrade({ symbol: 'RELIANCE', side: 'BUY', entryPrice: 0, qty: 1 }).error).toContain('entryPrice');
    expect(recordManualTrade({ symbol: 'RELIANCE', side: 'BUY', entryPrice: 10, qty: 0 }).error).toContain('qty');
  });

  it('F&O trades REQUIRE strike + CE/PE + expiry (the BS re-price contract)', () => {
    const base = { market: 'INDIA', symbol: 'NIFTY', side: 'LONG', entryPrice: 120, qty: 2, strike: 24500 };
    expect(recordManualTrade({ ...base, optType: 'XX', expiry: '2027-06-24' }).error).toContain('CE/PE');
    expect(recordManualTrade({ ...base, optType: 'CE', expiry: '24-06-2027' }).error).toContain('expiry');
    const ok = recordManualTrade({ ...base, optType: 'CE', expiry: '2027-06-24', iv: 13, lotSize: 75 });
    expect(ok.ok).toBe(true);
    expect(ok.trade.assetKind).toBe('OPTION');
    expect(ok.trade.lotSize).toBe(75);
    expect(ok.trade.underlying).toBe('NIFTY');
  });

  it('a wild entry-vs-LTP deviation WARNS but records (genuine fills can be off)', () => {
    const out = recordManualTrade({
      market: 'INDIA', symbol: 'RELIANCE', side: 'LONG',
      entryPrice: 1500, qty: 5, ltp: 1235.3, signal: SIGNAL_SNAPSHOT,
    });
    expect(out.ok).toBe(true);
    expect(out.warn).toContain('typo');
    expect(out.trade.entryWarn).toContain('%');
  });

  it('ids increment; list is open-first + newest-first; status filter works', () => {
    const a = recordManualTrade({ market: 'INDIA', symbol: 'AAA', side: 'BUY', entryPrice: 10, qty: 1 });
    const b = recordManualTrade({ market: 'INDIA', symbol: 'BBB', side: 'BUY', entryPrice: 10, qty: 1 });
    expect(b.trade.id).toBe(a.trade.id + 1);
    closeManualTrade(a.trade.id, { exitPrice: 11 });
    const list = listManualTrades();
    expect(list[0].symbol).toBe('BBB'); // open first
    expect(list.filter(t => t.status === 'CLOSED')).toHaveLength(1);
    expect(listManualTrades({ status: 'OPEN' })).toHaveLength(1);
  });
});

// ------------------------------------------------------------
describe('closeManualTrade — the honest exit', () => {
  it('closes at a given price with P&L stamped', () => {
    const { trade } = recordManualTrade({
      market: 'INDIA', symbol: 'RELIANCE', side: 'BUY', entryPrice: 100, qty: 10,
    });
    const out = closeManualTrade(trade.id, { exitPrice: 105, reason: 'booked' });
    expect(out.ok).toBe(true);
    expect(out.trade.status).toBe('CLOSED');
    expect(out.trade.exitPrice).toBe(105);
    expect(out.trade.closeReason).toBe('booked');
    expect(out.pnl.pnlPct).toBeCloseTo(5, 2);
    expect(out.trade.exitPnlINR).toBeCloseTo(50, 1);
  });

  it('closes at the LIVE stamp when no price is given', () => {
    const { trade } = recordManualTrade({ market: 'INDIA', symbol: 'TCS', side: 'BUY', entryPrice: 100, qty: 1 });
    trade.__ltp = 103; // the monitor's sweep stamp
    const out = closeManualTrade(trade.id, {});
    expect(out.ok).toBe(true);
    expect(out.trade.exitPrice).toBe(103);
  });

  it('unknown id / already closed / no price anywhere → honest errors, never a fake 0 exit', () => {
    expect(closeManualTrade(999, {})).toEqual({ ok: false, error: 'trade not found' });
    const { trade } = recordManualTrade({ market: 'INDIA', symbol: 'TCS', side: 'BUY', entryPrice: 100, qty: 1 });
    closeManualTrade(trade.id, { exitPrice: 101 });
    expect(closeManualTrade(trade.id, { exitPrice: 102 }).error).toBe('already closed');
    const { trade: t2 } = recordManualTrade({ market: 'INDIA', symbol: 'WIPRO', side: 'BUY', entryPrice: 100, qty: 1 });
    expect(closeManualTrade(t2.id, {}).error).toContain('exit price unavailable');
  });
});

// ------------------------------------------------------------
describe('ltpForManualTrade — LTP resolution per market', () => {
  it('reads the tick store under the per-market key', async () => {
    _ticks.set('IN_RELIANCE', { price: 1236 });
    _ticks.set('FUT_SOL', { price: 21.5 });
    _ticks.set('GLOB_MU', { price: 180 });
    expect(await ltpForManualTrade({ market: 'INDIA', symbol: 'RELIANCE', status: 'OPEN' })).toBe(1236);
    expect(await ltpForManualTrade({ market: 'FUTURES', symbol: 'SOL', status: 'OPEN' })).toBe(21.5);
    expect(await ltpForManualTrade({ market: 'GLOBALFUTURES', symbol: 'MU', status: 'OPEN' })).toBe(180);
  });

  it('India falls back to the injected TV batch when the tick store is cold', async () => {
    const fetchIndiaQuotes = vi.fn(async () => ({ RELIANCE: { price: 1237.5 } }));
    const px = await ltpForManualTrade(
      { market: 'INDIA', symbol: 'RELIANCE', status: 'OPEN' },
      { fetchIndiaQuotes },
    );
    expect(px).toBe(1237.5);
    expect(fetchIndiaQuotes).toHaveBeenCalledWith(['RELIANCE']);
  });

  it('OPTION trades re-price the premium via Black-Scholes on the live underlying', async () => {
    // dynamic ~30d expiry — a hardcoded date is a time bomb
    const expiry = new Date(Date.now() + 30 * 86400_000).toISOString().slice(0, 10);
    const opt = {
      market: 'INDIA', symbol: 'NIFTY', underlying: 'NIFTY', status: 'OPEN', assetKind: 'OPTION',
      optType: 'CE', strike: 24000, expiry, iv: 13,
    };
    const fetchIndexSpot = vi.fn(async () => ({ price: 24500 }));
    const px = await ltpForManualTrade(opt, { fetchIndexSpot });
    expect(px).not.toBeNull();
    expect(px).toBeGreaterThan(550); // 500 intrinsic + real 30d time value
    expect(px).toBeLessThan(900);    // and not absurd
  });

  it('expired option → intrinsic only; CLOSED trade → null', async () => {
    const opt = {
      market: 'INDIA', symbol: 'NIFTY', underlying: 'NIFTY', status: 'OPEN', assetKind: 'OPTION',
      optType: 'CE', strike: 24000, expiry: '2020-01-01', iv: 13,
    };
    const fetchIndexSpot = vi.fn(async () => ({ price: 24500 }));
    expect(await ltpForManualTrade(opt, { fetchIndexSpot })).toBe(500); // intrinsic
    expect(await ltpForManualTrade({ market: 'INDIA', symbol: 'X', status: 'CLOSED' })).toBeNull();
  });
});

// ------------------------------------------------------------
describe('manualTradeView — the UI row contract', () => {
  it('wires ltp/pnl/distances/conviction/banner + ageMin', () => {
    const { trade } = recordManualTrade({
      market: 'INDIA', symbol: 'RELIANCE', side: 'LONG',
      entryPrice: 1235, qty: 10, signal: SIGNAL_SNAPSHOT,
    });
    const v = manualTradeView(trade, {
      ltp: 1250,
      conviction: { state: 'HOLDING', delta: -2, currentScore: 82, entryScore: 84 },
    });
    expect(v.__ltp).toBe(1250);
    expect(v.__view.pnl.pnlPct).toBeCloseTo(1.21, 2); // (1250−1235)/1235 = 1.2145…
    expect(v.__view.banner).toBe('THESIS_INTACT');
    expect(v.__view.conviction.delta).toBe(-2);
    expect(v.__view.ageMin).toBeGreaterThanOrEqual(0);
    expect(v.__view.distances.sl).toBeLessThan(0);
  });

  it('missing conviction degrades honestly (nulls, not invented numbers)', () => {
    const v = manualTradeView({ side: 'BUY', entryPrice: 100, origin: { aiScore: 80 } }, { ltp: 101 });
    expect(v.__view.conviction).toEqual({ state: null, delta: null, currentScore: null, entryScore: 80 });
  });
});

// ------------------------------------------------------------
describe('evaluateManualTradeAlerts — the push ladder', () => {
  const mkTrade = (over = {}) => {
    const { trade } = recordManualTrade({
      market: 'INDIA', symbol: 'RELIANCE', side: 'LONG',
      entryPrice: 1235, qty: 10, signal: SIGNAL_SNAPSHOT,
    });
    return Object.assign(trade, over);
  };

  it('conviction FLIP → immediate EXIT NOW push carrying the WHY (models + score move)', async () => {
    const t = mkTrade({ __ltp: 1240 });
    const send = vi.fn(async () => ({ ok: true }));
    const pushed = await evaluateManualTradeAlerts(t, {
      send,
      conviction: { state: 'FLIPPED', delta: -160, currentScore: 80, side: 'SELL' },
      freshSignal: {
        side: 'SHORT', superIntel: { aiScore: 80 },
        votes: [
          { id: 'trend', name: 'TrendMatrix', dir: -1 },
          { id: 'momentum', name: 'MomentumX', dir: 0 },
        ],
      },
    });
    expect(pushed).toContain('flip');
    expect(send).toHaveBeenCalledTimes(1);
    const text = send.mock.calls[0][0];
    expect(text).toContain('EXIT NOW');
    expect(text).toContain('RELIANCE');
    expect(text).toContain('TrendMatrix'); // the flipped model named
    expect(text).toContain('84');          // entry score in the WHY
  });

  it('cooldown: an immediate second evaluation does NOT re-push the flip', async () => {
    const t = mkTrade({ __ltp: 1240 });
    const send = vi.fn(async () => ({ ok: true }));
    const args = { send, conviction: { state: 'FLIPPED', currentScore: 80 }, freshSignal: null };
    await evaluateManualTradeAlerts(t, args);
    const pushed2 = await evaluateManualTradeAlerts(t, args);
    expect(pushed2).toEqual([]);
    expect(send).toHaveBeenCalledTimes(1);
  });

  it('SL within 0.3×ATR → SL-approach push (suppressed while EXIT_NOW)', async () => {
    const t = mkTrade({ __ltp: 1212 }); // SL 1210, ATR 9.5 → |dist| 2 ≤ 0.3×9.5 = 2.85
    const send = vi.fn(async () => ({ ok: true }));
    const pushed = await evaluateManualTradeAlerts(t, { send, conviction: { state: 'HOLDING' } });
    expect(pushed).toContain('sl');
    expect(send.mock.calls[0][0]).toContain('SL approach');
    // EXIT_NOW suppresses the SL nudge (no noise during the bigger signal)
    const t2 = mkTrade({ __ltp: 1213 });
    const send2 = vi.fn(async () => ({ ok: true }));
    const p2 = await evaluateManualTradeAlerts(t2, { send: send2, conviction: { state: 'FLIPPED' } });
    expect(p2).toContain('flip');
    expect(p2).not.toContain('sl');
  });

  it('T1 and T2 each push ONCE (6h cooldown each)', async () => {
    const t = mkTrade({ __ltp: 1265 }); // T1 1260 touched
    const send = vi.fn(async () => ({ ok: true }));
    const pushed = await evaluateManualTradeAlerts(t, { send, conviction: { state: 'HOLDING' } });
    expect(pushed).toContain('t1');
    expect(send.mock.calls[0][0]).toContain('T1 HIT');
    // re-evaluate at T2 — t1 must not re-fire, t2 must
    t.__ltp = 1292;
    const p2 = await evaluateManualTradeAlerts(t, { send, conviction: { state: 'HOLDING' } });
    expect(p2).toContain('t2');
    expect(p2).not.toContain('t1');
    expect(send).toHaveBeenCalledTimes(2);
  });

  it('fresh healthy trade → zero pushes (no noise)', async () => {
    const t = mkTrade({ __ltp: 1240 }); // mid-range, THESIS_INTACT, young
    const send = vi.fn(async () => ({ ok: true }));
    const pushed = await evaluateManualTradeAlerts(t, { send, conviction: { state: 'HOLDING' } });
    expect(pushed).toEqual([]);
    expect(send).not.toHaveBeenCalled();
  });

  it('a send failure is contained and RETRYABLE (no full-cooldown suppression, honest pushed flag)', async () => {
    // v10.18 contract: the FULL cooldown arms only on a successful send —
    // one transient Telegram blip must not eat the EXIT-NOW push for 30
    // minutes. A failed send reserves a short 30s failure-retry hold, and
    // the pushed flag honestly reports that nothing went out.
    const t = mkTrade({ __ltp: 1240 });
    const send = vi.fn(async () => { throw new Error('telegram down'); });
    const pushed = await evaluateManualTradeAlerts(t, {
      send, conviction: { state: 'FLIPPED', currentScore: 80 }, freshSignal: null,
    });
    expect(pushed).not.toContain('flip'); // nothing actually went out
    expect(send).toHaveBeenCalledTimes(1); // attempted, no crash
    // immediate re-evaluation is still held back (no double-send hammer)
    const pushed2 = await evaluateManualTradeAlerts(t, {
      send, conviction: { state: 'FLIPPED', currentScore: 80 }, freshSignal: null,
    });
    expect(pushed2).not.toContain('flip');
    expect(send).toHaveBeenCalledTimes(1);
    // after the 30s failure-retry window the alert fires again — and
    // once Telegram is healthy the FULL cooldown arms
    const nowSpy = vi.spyOn(Date, 'now');
    const base = Date.now();
    nowSpy.mockReturnValue(base + 31_000);
    const sendOk = vi.fn(async () => ({ ok: true }));
    const pushed3 = await evaluateManualTradeAlerts(t, {
      send: sendOk, conviction: { state: 'FLIPPED', currentScore: 80 }, freshSignal: null,
    });
    expect(pushed3).toContain('flip'); // recovered — the alert was never lost
    expect(sendOk).toHaveBeenCalledTimes(1);
    // full cooldown now armed: a 4th evaluation inside 30 min does not re-send
    const pushed4 = await evaluateManualTradeAlerts(t, {
      send: sendOk, conviction: { state: 'FLIPPED', currentScore: 80 }, freshSignal: null,
    });
    expect(pushed4).not.toContain('flip');
    expect(sendOk).toHaveBeenCalledTimes(1);
    nowSpy.mockRestore();
  });
});

// ------------------------------------------------------------
describe('manualTradesToPositionRows — the 5s level-touch wiring contract', () => {
  it('rows satisfy detectLevelTouches: status OPEN + LONG/SHORT sides + MAN- ids', () => {
    const { trade } = recordManualTrade({
      market: 'INDIA', symbol: 'RELIANCE', side: 'LONG',
      entryPrice: 1235, qty: 10, signal: SIGNAL_SNAPSHOT,
    });
    trade.__ltp = 1209; // at/below SL 1210 → the detector must FIRE (LONG: ltp ≤ sl)
    const rows = manualTradesToPositionRows([trade]);
    expect(rows).toHaveLength(1);
    expect(rows[0].id).toBe('MAN-1');
    expect(rows[0].status).toBe('OPEN');
    expect(rows[0].side).toBe('LONG');
    const touches = detectLevelTouches(rows);
    expect(touches.map(t => t.kind)).toContain('SL');
    expect(touches[0].manual).toBe(true);
    // the push text carries the MANUAL tag (not the executor footer)
    const text = formatLevelTouch(touches[0]);
    expect(text).toContain('MANUAL');
    expect(text).toContain('aapka trade');
  });

  it('BUY/SELL is translated to LONG/SHORT — a BUY trade is never level-checked inverted', () => {
    const shortTrade = {
      id: 2, status: 'OPEN', market: 'INDIA', symbol: 'TCS', side: 'SELL',
      entryPrice: 400, qty: 5,
      origin: { plan: { stopLoss: 420, target1: 380 } },
      __ltp: 421, // above SL → SHORT stop touched
    };
    const rows = manualTradesToPositionRows([shortTrade]);
    expect(rows[0].side).toBe('SHORT');
    const touches = detectLevelTouches(rows);
    expect(touches.map(t => t.kind)).toContain('SL');
    // and the T1 at 380 must NOT fire for a SHORT at 421
    expect(touches.map(t => t.kind)).not.toContain('TP1');
  });

  it('CLOSED trades and priceless rows are skipped; INR-domain rows carry ₹ uP&L, USDT-domain stay null', () => {
    const openIndia = { id: 3, status: 'OPEN', market: 'INDIA', symbol: 'SBIN', side: 'BUY', entryPrice: 600, qty: 2, origin: { plan: {} }, __ltp: 610 };
    const openPerp = { id: 4, status: 'OPEN', market: 'FUTURES', symbol: 'SOL', side: 'BUY', entryPrice: 20, qty: 3, origin: { plan: {} }, __ltp: 22 };
    const closed = { id: 5, status: 'CLOSED', market: 'INDIA', symbol: 'OLD', side: 'BUY', entryPrice: 100, qty: 1, origin: { plan: {} }, __ltp: 101 };
    const noEntry = { id: 6, status: 'OPEN', market: 'INDIA', symbol: 'BAD', side: 'BUY', entryPrice: null, qty: 1 };
    const rows = manualTradesToPositionRows([openIndia, openPerp, closed, noEntry]);
    expect(rows.map(r => r.id)).toEqual(['MAN-3', 'MAN-4']);
    expect(rows[0].unrealizedPnlINR).toBeCloseTo(20, 1);  // (610-600)×2
    expect(rows[1].unrealizedPnlINR).toBeNull();           // USDT domain — omitted, not guessed
    expect(rows[1].liquidation).toBeNull();
    expect(rows[1].leverage).toBe(1);
  });
});

// ------------------------------------------------------------
describe('the monitor loop — 5s LTP sweep + 30s conviction re-vote', () => {
  it('parks idle with zero open trades (no error, no pushes)', async () => {
    startManualTradeMonitor({ send: vi.fn() });
    await __monitorTickForTests();
    const st = manualMonitorStatus();
    expect(st.ok).toBe(true);
    expect(st.openTrades).toBe(0);
    expect(st.lastError).toBeNull();
  });

  it('THE WIRING CONTRACT: deps are read from _mon.deps — a deep signal re-votes + fires alerts', async () => {
    const { trade } = recordManualTrade({
      market: 'INDIA', symbol: 'RELIANCE', side: 'LONG',
      entryPrice: 1235, qty: 10, signal: SIGNAL_SNAPSHOT,
    });
    _ticks.set('IN_RELIANCE', { price: 1240 });
    const send = vi.fn(async () => ({ ok: true }));
    const getDeepSignal = vi.fn(async () => ({
      ok: true,
      signal: {
        side: 'SHORT', grade: 'STRONG', voters: 9, superIntel: { aiScore: 80 },
        votes: [{ id: 'trend', name: 'TrendMatrix', dir: -1 }],
      },
    }));
    startManualTradeMonitor({
      getDeepSignal,
      depsForSignals: () => ({}),
      send,
      fetchIndiaQuotes: vi.fn(),
      fetchIndexSpot: vi.fn(),
      usdInrOf: async () => 84,
    });
    await __monitorTickForTests();
    // LTP sweep stamped from the tick store
    expect(trade.__ltp).toBe(1240);
    // conviction re-vote ran through the INJECTED getDeepSignal (not undefined)
    expect(getDeepSignal).toHaveBeenCalledWith('RELIANCE', 'INDIA', {});
    expect(trade.__conviction.state).toBe('FLIPPED');
    expect(trade.__conviction.side).toBe('SELL');
    // the EXIT NOW push fired with the WHY
    expect(send).toHaveBeenCalledTimes(1);
    expect(send.mock.calls[0][0]).toContain('EXIT NOW');
    // status is honest
    const st = manualMonitorStatus();
    expect(st.openTrades).toBe(1);
    expect(st.pushes).toBe(1);
  });

  it('a failing deep signal degrades to UNKNOWN conviction (never crashes the loop)', async () => {
    const { trade } = recordManualTrade({ market: 'INDIA', symbol: 'TCS', side: 'BUY', entryPrice: 100, qty: 1 });
    _ticks.set('IN_TCS', { price: 101 });
    startManualTradeMonitor({ getDeepSignal: vi.fn(async () => { throw new Error('boom'); }), send: vi.fn() });
    await __monitorTickForTests();
    expect(trade.__conviction.state).toBe('UNKNOWN');
    const st = manualMonitorStatus();
    expect(st.lastError).toContain('boom');
  });

  it('startManualTradeMonitor is idempotent (one timer, not a stack)', () => {
    startManualTradeMonitor({ send: vi.fn() });
    startManualTradeMonitor({ send: vi.fn() });
    const { mon } = __monitorStateForTests();
    expect(mon).toBeTruthy();
    expect(mon.timer).toBeTruthy();
    const timersBefore = mon.timer;
    startManualTradeMonitor({ send: vi.fn() });
    expect(__monitorStateForTests().mon.timer).toBe(timersBefore);
  });
});
