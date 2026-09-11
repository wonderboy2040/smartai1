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
//   5. weekly expiry schedule: NIFTY=Thursday, SENSEX=Tuesday
//      (the Sept-2026 exchange swap — old code had it backwards)
//   6. NEUTRAL/FLAT consensus → NO directional card (honest)
//   7. SENSEX desk works off the BS model with correct step/lot
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

describe('v9.4 F&O option signal cards — the user format', () => {
  const EXPIRY = '2026-09-17'; // a Thursday
  const NIFTY_SPOT = 23411;
  const desk = mkDesk('NIFTY', NIFTY_SPOT, EXPIRY);

  it('names the card exactly "<display> <DDMon> <strike> <CE|PE>" (Nifty50 17Sep 23400 CE)', () => {
    const cards = buildOptionSignalCards(desk, mkDeep('LONG', { entry: NIFTY_SPOT, stopLoss: NIFTY_SPOT - 90, target1: NIFTY_SPOT + 120, target2: NIFTY_SPOT + 240 }));
    expect(cards).toHaveLength(1);
    const c = cards[0];
    expect(c.type).toBe('CE');
    // strike must be ATM (nearest 50-step to 23411 → 23400)
    expect(c.strike).toBe(23400);
    expect(c.name).toBe(`Nifty50 17Sep 23400 CE`);
    expect(expiryLabel(EXPIRY)).toBe('17Sep');
  });

  it('LONG consensus → CE · SHORT consensus → PE (direction lock)', () => {
    const long = buildOptionSignalCards(desk, mkDeep('LONG', { entry: NIFTY_SPOT, stopLoss: NIFTY_SPOT - 90, target1: NIFTY_SPOT + 120 }))[0];
    const shortDesk = mkDesk('NIFTY', NIFTY_SPOT, EXPIRY);
    const short = buildOptionSignalCards(shortDesk, mkDeep('SHORT', { entry: NIFTY_SPOT, stopLoss: NIFTY_SPOT + 90, target1: NIFTY_SPOT - 120 }))[0];
    expect(long.type).toBe('CE');
    expect(long.direction).toBe('LONG');
    expect(short.type).toBe('PE');
    expect(short.direction).toBe('SHORT');
  });

  it('premium ordering invariant: StopLoss < Entry (Buy) < Target — every side, every basis', () => {
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
      expect(cards).toHaveLength(1);
      const { stopLoss, entry, target } = cards[0];
      expect(stopLoss).toBeLessThan(entry);
      expect(entry).toBeLessThan(target);
      // max premium loss capped at 65% of entry
      expect(stopLoss).toBeGreaterThanOrEqual(entry * 0.35 - 0.06);
      // NSE 0.05 tick alignment
      for (const v of [stopLoss, entry, target]) {
        expect(Math.round(v * 20) / 20).toBeCloseTo(v, 10);
      }
    }
  });

  it('translates the INDEX plan into premium terms (BS re-price at target1/stopLoss)', () => {
    const plan = { entry: NIFTY_SPOT, stopLoss: NIFTY_SPOT - 90, target1: NIFTY_SPOT + 120, target2: NIFTY_SPOT + 240 };
    const c = buildOptionSignalCards(desk, mkDeep('LONG', plan))[0];
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
    const sdesk = mkDesk('SENSEX', 74489, '2026-09-15'); // a Tuesday
    const c = buildOptionSignalCards(sdesk, mkDeep('SHORT', { entry: 74489, stopLoss: 74489 + 250, target1: 74489 - 300 }))[0];
    expect(c.type).toBe('PE');
    expect(c.strike % 100).toBe(0);
    expect(c.lotSize).toBe(20);
    expect(c.name).toMatch(/^Sensex 15Sep \d+ PE$/);
    expect(STRIKE_STEPS.SENSEX).toBe(100);
    expect(LOT_SIZES.SENSEX).toBe(20);
  });
});

describe('v9.4 weekly expiry schedule — the Sept 2026 exchange swap', () => {
  // Reference clock: Fri 2026-09-11 14:00 IST (market open).
  const FRI_IST = new Date('2026-09-11T08:30:00Z');

  it('NIFTY fallback expiry lands on the NEXT THURSDAY (17 Sep)', () => {
    // nextWeeklyExpiry(now, 4) — the NIFTY weekday under the new schedule
    const d = new Date(nextWeeklyExpiry(FRI_IST, 4));
    expect(d.getUTCFullYear()).toBe(2026);
    expect(d.getUTCMonth()).toBe(8); // September (0-based)
    expect(d.getUTCDate()).toBe(17);
  });

  it('SENSEX fallback expiry lands on the NEXT TUESDAY (15 Sep)', () => {
    const d = new Date(nextWeeklyExpiry(FRI_IST, 2));
    expect(d.getUTCFullYear()).toBe(2026);
    expect(d.getUTCMonth()).toBe(8);
    expect(d.getUTCDate()).toBe(15);
  });

  it('expiryLabel renders DDMon shorthand for every month', () => {
    expect(expiryLabel('2026-09-17')).toBe('17Sep');
    expect(expiryLabel('2026-01-05')).toBe('5Jan');
    expect(expiryLabel('2026-12-31')).toBe('31Dec');
    expect(expiryLabel('garbage')).toBeNull();
    expect(expiryLabel(null)).toBeNull();
  });

  it('synthetic SENSEX chain uses Tuesday-weekly expiry + 100 strikes', () => {
    const chain = buildSyntheticChain('SENSEX', 74489, 0.13, '2026-09-15', 4);
    expect(chain.source).toBe('bs-model');
    expect(chain.atmStrike % 100).toBe(0);
    expect(chain.rows.length).toBeGreaterThan(5);
    for (const r of chain.rows) expect(r.expiry).toBe('2026-09-15');
  });
});
