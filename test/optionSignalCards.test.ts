// ============================================================
// test/optionSignalCards.test.ts — v9.4 F&O OPTION SIGNAL CARDS
// regression suite.
//
// Locks the user's EXACT requested format end-to-end:
//   Stock name : Nifty50 17Sep 23400 CE
//   Target     : 110.00   (premium)
//   Entry (Buy): 86.50
//   Stop Loss  : 77.00
//
// Guards (BUY premium semantics — SL < entry < target ALWAYS):
//   1. name format: <display> <DDMon> <strike> <CE|PE>
//   2. LONG consensus → CE card · SHORT → PE card (direction lock)
//   3. levels: index-plan→premium (BS re-price) or premium-based
//      fallback — ordering invariant holds either way
//   4. max premium loss capped at 65%
//   5. weekly expiry schedule: NIFTY=Tuesday, SENSEX=Thursday
//      (v9.6 fix — v9.4 had it backwards; the trader's live broker
//      terminal is ground truth: Nifty weekly 15Sep hi hai, 17Sep ka
//      Nifty contract exists hi nahi)
//   6. NEUTRAL/FLAT consensus → NO directional card (honest)
//   7. SENSEX desk works off the BS model with correct step/lot
//   8. v9.6: ATM+ITM+OTM candidates, AI-scored, ranked, agent-bar
//      tradeable flag, POP/breakeven/exit-plan pro layer
// All hermetic — no network. Pure functions under test.
// ============================================================
import { describe, it, expect } from 'vitest';
import { buildOptionSignalCards, expiryLabel, buildSyntheticChain, STRIKE_STEPS, LOT_SIZES } from '../server/ai/optionsDesk.js';
import { nextWeeklyExpiry } from '../server/ai/lib/blackScholes.js';

// A desk shaped exactly like getOptionsDesk() serves it (bs-model
// branch — rows carry the BS premiums the card must translate).
const mkDesk = (symbol, spot, expiry, overrides = {}) => ({
  ok: true, symbol, spot, expiry, dte: 4, lotSize: LOT_SIZES[symbol] || 1,
  source: 'bs-model', syntheticNote: 'model chain',
  rows: buildSyntheticChain(symbol, spot, 0.13, expiry, 8)?.rows || [],
  ...overrides,
});

// A deep-signal payload like getDeepSignal('NIFTY') returns for a
// LONG index consensus with a plan.
const mkDeep = (side, plan) => ({
  ok: true,
  signal: {
    symbol: 'NIFTY', side, confidence: 74, grade: 'ACTION', agreement: 0.7,
    ...(plan ? { plan } : {}),
  },
});

describe('v9.4/v9.6 F&O option signal cards — the user format', () => {
  const EXPIRY = '2026-09-15'; // a TUESDAY — the real Nifty weekly
  const NIFTY_SPOT = 23411;
  const desk = mkDesk('NIFTY', NIFTY_SPOT, EXPIRY);
  // v9.6: cards are ranked candidates — grab the ATM one for the
  // classic single-contract assertions.
  const atmOf = (cards) => cards.find(x => x.strikeBias === 'ATM') ?? cards[0];

  it('names the card exactly "<display> <DDMon> <strike> <CE|PE>" (Nifty50 15Sep 23400 CE)', () => {
    const cards = buildOptionSignalCards(desk, mkDeep('LONG', { entry: NIFTY_SPOT, stopLoss: NIFTY_SPOT - 90, target1: NIFTY_SPOT + 120, target2: NIFTY_SPOT + 240 }));
    // v9.6: THREE ranked candidates (ATM + ITM + OTM) per index
    expect(cards.length).toBeGreaterThanOrEqual(1);
    expect(cards.length).toBeLessThanOrEqual(3);
    const c = atmOf(cards);
    expect(c.type).toBe('CE');
    // strike must be ATM (nearest 50-step to 23411 → 23400)
    expect(c.strike).toBe(23400);
    expect(c.name).toBe(`Nifty50 15Sep 23400 CE`);
    expect(expiryLabel(EXPIRY)).toBe('15Sep');
  });

  it('LONG consensus → CE · SHORT consensus → PE (direction lock)', () => {
    const long = buildOptionSignalCards(desk, mkDeep('LONG', { entry: NIFTY_SPOT, stopLoss: NIFTY_SPOT - 90, target1: NIFTY_SPOT + 120 }));
    const shortDesk = mkDesk('NIFTY', NIFTY_SPOT, EXPIRY);
    const short = buildOptionSignalCards(shortDesk, mkDeep('SHORT', { entry: NIFTY_SPOT, stopLoss: NIFTY_SPOT + 90, target1: NIFTY_SPOT - 120 }));
    expect(atmOf(long).type).toBe('CE');
    expect(atmOf(long).direction).toBe('LONG');
    expect(atmOf(short).type).toBe('PE');
    expect(atmOf(short).direction).toBe('SHORT');
    // v9.6: every candidate on the card list follows the lock
    for (const c of [...long, ...short]) expect(c.type).toBe(c.direction === 'LONG' ? 'CE' : 'PE');
  });

  it('premium ordering invariant: StopLoss < Entry (Buy) < Target — every card, every side, every basis', () => {
    const cases = [
      mkDeep('LONG', { entry: NIFTY_SPOT, stopLoss: NIFTY_SPOT - 40, target1: NIFTY_SPOT + 60 }),
      mkDeep('LONG', { entry: NIFTY_SPOT, stopLoss: NIFTY_SPOT - 200, target1: NIFTY_SPOT + 300 }),
      mkDeep('SHORT', { entry: NIFTY_SPOT, stopLoss: NIFTY_SPOT + 40, target1: NIFTY_SPOT - 60 }),
      mkDeep('SHORT', { entry: NIFTY_SPOT, stopLoss: NIFTY_SPOT + 250, target1: NIFTY_SPOT - 320 }),
      mkDeep('LONG', null), // no plan → premium-based fallback path
      mkDeep('SHORT', null),
    ];
    for (const deep of cases) {
      const cards = buildOptionSignalCards(desk, deep);
      expect(cards.length).toBeGreaterThanOrEqual(1);
      // v9.6: the invariant now holds on EVERY candidate (ATM/ITM/OTM)
      for (const { stopLoss, entry, target } of cards) {
        expect(stopLoss).toBeLessThan(entry);
        expect(entry).toBeLessThan(target);
        // max premium loss capped at 65% of entry
        expect(stopLoss).toBeGreaterThanOrEqual(entry * 0.35 - 0.06);
        // NSE 0.05 tick alignment
        for (const v of [stopLoss, entry, target]) {
          expect(Math.round(v * 20) / 20).toBeCloseTo(v, 10);
        }
      }
    }
  });

  it('translates the INDEX plan into premium terms (BS re-price at target1/stopLoss)', () => {
    const plan = { entry: NIFTY_SPOT, stopLoss: NIFTY_SPOT - 90, target1: NIFTY_SPOT + 120, target2: NIFTY_SPOT + 240 };
    const c = atmOf(buildOptionSignalCards(desk, mkDeep('LONG', plan)));
    expect(c.basis.target).toBe('index-plan→premium');
    expect(c.basis.stopLoss).toBe('index-plan→premium');
    expect(c.indexLevels.target1).toBeCloseTo(NIFTY_SPOT + 120, 1);
    expect(c.indexLevels.stopLoss).toBeCloseTo(NIFTY_SPOT - 90, 1);
    // target must meaningfully clear entry (≥ +10%)
    expect(c.target).toBeGreaterThan(c.entry * 1.09);
  });

  it('FLAT/NEUTRAL consensus produces NO directional card (honest)', () => {
    expect(buildOptionSignalCards(desk, mkDeep('FLAT', null))).toHaveLength(0);
    expect(buildOptionSignalCards(desk, { ok: false })).toHaveLength(0);
    expect(buildOptionSignalCards(desk, null)).toHaveLength(0);
    expect(buildOptionSignalCards({ ok: false }, mkDeep('LONG', null))).toHaveLength(0);
  });

  it('SENSEX desk: 100-step strikes, lot 20, Sensex display name', () => {
    const sdesk = mkDesk('SENSEX', 74489, '2026-09-17'); // a THURSDAY — the real Sensex weekly
    const c = atmOf(buildOptionSignalCards(sdesk, mkDeep('SHORT', { entry: 74489, stopLoss: 74489 + 250, target1: 74489 - 300 })));
    expect(c.type).toBe('PE');
    expect(c.strike % 100).toBe(0);
    expect(c.lotSize).toBe(20);
    expect(c.name).toMatch(/^Sensex 17Sep \d+ PE$/);
    expect(STRIKE_STEPS.SENSEX).toBe(100);
    expect(LOT_SIZES.SENSEX).toBe(20);
  });
});

describe('v9.6 weekly expiry schedule — user-verified vs the live exchange', () => {
  // Reference clock: Fri 2026-09-11 14:00 IST (market open).
  const FRI_IST = new Date('2026-09-11T08:30:00Z');

  it('NIFTY weekly expiry is TUESDAY — Fri 11 Sep → 15 Sep (17Sep ka Nifty weekly exists hi nahi)', () => {
    // nextWeeklyExpiry(now, 2) — the NIFTY weekday under the corrected schedule
    const d = new Date(nextWeeklyExpiry(FRI_IST, 2));
    expect(d.getUTCFullYear()).toBe(2026);
    expect(d.getUTCMonth()).toBe(8); // September (0-based)
    expect(d.getUTCDate()).toBe(15);
  });

  it('SENSEX weekly expiry is THURSDAY — Fri 11 Sep → 17 Sep', () => {
    const d = new Date(nextWeeklyExpiry(FRI_IST, 4));
    expect(d.getUTCFullYear()).toBe(2026);
    expect(d.getUTCMonth()).toBe(8);
    expect(d.getUTCDate()).toBe(17);
  });

  it('expiryLabel renders DDMon shorthand for every month', () => {
    expect(expiryLabel('2026-09-17')).toBe('17Sep');
    expect(expiryLabel('2026-01-05')).toBe('5Jan');
    expect(expiryLabel('2026-12-31')).toBe('31Dec');
    expect(expiryLabel('garbage')).toBeNull();
    expect(expiryLabel(null)).toBeNull();
  });

  it('synthetic SENSEX chain honours the given weekly expiry + 100 strikes', () => {
    const chain = buildSyntheticChain('SENSEX', 74489, 0.13, '2026-09-17', 4);
    expect(chain.source).toBe('bs-model');
    expect(chain.atmStrike % 100).toBe(0);
    expect(chain.rows.length).toBeGreaterThan(5);
    for (const r of chain.rows) expect(r.expiry).toBe('2026-09-17');
  });
});

describe('v9.6 superintelligence layer — AI score, POP, ranking, tradeable bar', () => {
  const EXPIRY = '2026-09-15'; // Tuesday — the real Nifty weekly
  const NIFTY_SPOT = 23411;
  const desk = mkDesk('NIFTY', NIFTY_SPOT, EXPIRY);
  const atmOf = (cards) => cards.find(x => x.strikeBias === 'ATM') ?? cards[0];
  const PLAN = { entry: NIFTY_SPOT, stopLoss: NIFTY_SPOT - 90, target1: NIFTY_SPOT + 120, target2: NIFTY_SPOT + 240 };

  it('every card carries an AI score (0-100), a tier, a POP and a strike-bias chip', () => {
    const cards = buildOptionSignalCards(desk, mkDeep('LONG', PLAN));
    expect(cards.length).toBeGreaterThanOrEqual(1);
    for (const c of cards) {
      expect(c.aiScore).toBeGreaterThanOrEqual(0);
      expect(c.aiScore).toBeLessThanOrEqual(100);
      expect(['ELITE', 'STRONG', 'ACTION', 'WATCH']).toContain(c.tier);
      expect(c.pop).toBeGreaterThan(0);
      expect(c.pop).toBeLessThanOrEqual(100);
      expect(['ATM', 'ITM', 'OTM']).toContain(c.strikeBias);
      expect(c.machineNote).toBeTruthy();
      // long-CE breakeven = strike + premium paid
      expect(Math.abs(c.breakeven - (c.strike + c.entry))).toBeLessThanOrEqual(0.06);
      // exit plan rides with the card
      expect(c.exitPlan.t1).toBeGreaterThanOrEqual(c.entry);
      expect(c.exitPlan.t1).toBeLessThanOrEqual(c.target);
      expect(Math.abs(c.exitPlan.t2 - c.target)).toBeLessThanOrEqual(0.06);
      expect(Math.abs(c.exitPlan.hardStop - c.stopLoss)).toBeLessThanOrEqual(0.06);
    }
  });

  it('cards are ranked by AI score, best first (view merges → TOP 4)', () => {
    const cards = buildOptionSignalCards(desk, mkDeep('LONG', PLAN));
    for (let i = 1; i < cards.length; i++) {
      expect(cards[i - 1].aiScore).toBeGreaterThanOrEqual(cards[i].aiScore);
    }
    // ITM/OTM candidates actually exist on the synthetic chain
    expect(new Set(cards.map(c => c.strikeBias)).size).toBeGreaterThanOrEqual(2);
  });

  it('tradeable mirrors the auto-agent bar: ACTION/STRONG grade YA 75+ AI score', () => {
    // (a) ACTION-grade consensus → tradeable (the standard desk case)
    expect(atmOf(buildOptionSignalCards(desk, mkDeep('LONG', PLAN))).tradeable).toBe(true);
    // (b) soft NEUTRAL consensus, low conf → score 75 ke neeche → WATCHLIST
    const weak = { ok: true, signal: { symbol: 'NIFTY', side: 'LONG', confidence: 40, grade: 'NEUTRAL', agreement: 0.5, plan: PLAN } };
    const c = atmOf(buildOptionSignalCards(desk, weak));
    expect(c.aiScore).toBeLessThan(75);
    expect(c.tradeable).toBe(false);
    expect(c.consensus.grade).toBe('NEUTRAL');
  });
});
