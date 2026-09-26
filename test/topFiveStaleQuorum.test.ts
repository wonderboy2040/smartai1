// ============================================================
// test/topFiveStaleQuorum.test.ts — v13.4 STALENESS & QUORUM FIX
// ------------------------------------------------------------
// The CL-SHORT board audit, pinned: a stale or under-quorum signal
// must never sit at the top of the board looking as actionable as a
// fresh, fully-voted one.
//
//   Fix 1 — STALENESS DECAY in computeTopFive ranking:
//     • age 10 min  → full weight, ranks normally
//     • age 45 min  → score visibly reduced (×0.575), drops rank
//     • age 90 min  → floor ×0.15, out of the top-5 when anything
//                     fresher is eligible — but never zero (alone it
//                     still answers, honestly degraded)
//   Fix 2 — HARD QUORUM GATE on eligibility:
//     • 4/9-vote ACTION signal → excluded, however high its score
//     • 5/9-vote ACTION signal → included (boundary on MIN_QUORUM_VOTES)
//     • AI_MIN_TOPFIVE_QUORUM env override is honoured
//     • abstain seats NEVER count toward quorum (the votes-array
//       length trap: it includes dir=0 abstains)
//   Fix 4 — liveInvalidationCheck (pure, server twin):
//     • LONG through SL / SHORT through SL → invalidated
//     • > 0.5×ATR beyond the far entry-zone edge → weakening
//     • missing inputs → honest ok
// ============================================================
import { describe, it, expect, vi } from 'vitest';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

// hermetic data dir (same trick as the other suites)
process.env.SMARTAI_DATA_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '../.test-data-v134');

const { computeTopFive, stalenessFactor, votingModelsOf, MIN_QUORUM_VOTES } = await import('../server/ai/signals.js');
const { liveInvalidationCheck } = await import('../server/ai/superIntel.js');

const NOW = 1_700_000_000_000; // fixed clock — computeTopFive takes `now`

const SIG = (over = {}) => ({
  symbol: 'RELIANCE', market: 'INDIA', side: 'LONG', grade: 'STRONG',
  confidence: 80, agreement: 0.75, participation: 0.9, participating: 9, voters: 9, totalModels: 10,
  ltp: 2400, changePct: 1.2,
  plan: { entry: 2400, stopLoss: 2320, target1: 2480, target2: 2560, riskPct: 3.33, rewardRisk: 2 },
  votes: Array.from({ length: 9 }, (_, i) => ({ id: `m${i}`, dir: i < 7 ? 1 : -1, conf: 70 })),
  // fresh by default: last board confirm 10 min before NOW
  signalAge: { firstSeenAt: NOW - 20 * 60_000, lastSeenAt: NOW - 10 * 60_000, ageMs: 20 * 60_000, flips24h: 0 },
  summary: 'test', aiNote: null, executable: true, generatedAt: NOW - 10 * 60_000,
  ...over,
});

describe('v13.4 stalenessFactor — the decay curve (pure)', () => {
  it('0-30 min since last board confirm → full weight ×1', () => {
    expect(stalenessFactor(SIG(), NOW)).toBe(1);
    expect(stalenessFactor(SIG({ signalAge: { firstSeenAt: NOW - 30 * 60_000, lastSeenAt: NOW - 30 * 60_000, ageMs: 0, flips24h: 0 } }), NOW)).toBe(1);
  });
  it('45 min → linear midpoint ×0.575', () => {
    const s = SIG({ signalAge: { firstSeenAt: NOW - 60 * 60_000, lastSeenAt: NOW - 45 * 60_000, ageMs: 0, flips24h: 0 } });
    expect(stalenessFactor(s, NOW)).toBeCloseTo(0.575, 6);
  });
  it('60+ min → floor ×0.15 (never zero — visible priority loss, not vanishing)', () => {
    const s = SIG({ signalAge: { firstSeenAt: NOW - 3 * 3600_000, lastSeenAt: NOW - 90 * 60_000, ageMs: 0, flips24h: 0 } });
    expect(stalenessFactor(s, NOW)).toBe(0.15);
    expect(stalenessFactor(SIG({ signalAge: { firstSeenAt: 1, lastSeenAt: 1, ageMs: 0, flips24h: 0 } }), NOW)).toBe(0.15);
  });
  it('fallback chain: lastSeenAt → firstSeenAt → generatedAt → now', () => {
    // no lastSeenAt (null) → firstSeenAt drives the age
    const s1 = SIG({ signalAge: { firstSeenAt: NOW - 50 * 60_000, lastSeenAt: null, ageMs: 0, flips24h: 0 } });
    expect(stalenessFactor(s1, NOW)).toBeCloseTo(1 - 0.85 * (20 / 30), 6);
    // no signalAge at all → generatedAt drives it
    const s2 = SIG({ signalAge: null, generatedAt: NOW - 35 * 60_000 });
    expect(stalenessFactor(s2, NOW)).toBeCloseTo(1 - 0.85 * (5 / 30), 6);
    // nothing at all → treated as fresh
    expect(stalenessFactor({}, NOW)).toBe(1);
  });
});

describe('v13.4 votingModelsOf — abstains never count toward quorum', () => {
  it('the consensus voters field is authoritative', () => {
    expect(votingModelsOf({ voters: 4, participating: 9, votes: Array.from({ length: 9 }, () => ({ dir: 1 })) })).toBe(4);
    expect(votingModelsOf({ participating: 6, votes: [] })).toBe(6);
  });
  it('falls back to counting DIRECTIONAL votes (dir=0 abstains excluded)', () => {
    const votes = [
      { dir: 1 }, { dir: -1 }, { dir: 1 }, { dir: 0 }, { dir: 0 }, { dir: 1 },
    ];
    expect(votingModelsOf({ votes })).toBe(4);
  });
  it('garbage shapes degrade to 0 honestly', () => {
    expect(votingModelsOf(null)).toBe(0);
    expect(votingModelsOf({})).toBe(0);
    expect(votingModelsOf({ voters: 0, votes: null })).toBe(0);
  });
});

describe('v13.4 Fix 1 — staleness decay in computeTopFive ranking', () => {
  it('age 10 min, high conf → ranks normally (full weight, no staleness text)', () => {
    const [p] = computeTopFive([SIG({ symbol: 'FRESH' })], { niftyChange: 1 }, 'INDIA', 5, NOW);
    expect(p.score).toBeGreaterThan(70); // the raw composite, undecayed
    expect(p.rankReason).not.toContain('staleness');
  });

  it('age 45 min → score visibly reduced (×0.575) and the reason carries the factor', () => {
    const fresh = SIG({ symbol: 'F45' });
    const aged = SIG({ symbol: 'F45', signalAge: { firstSeenAt: NOW - 60 * 60_000, lastSeenAt: NOW - 45 * 60_000, ageMs: 0, flips24h: 0 } });
    const [pf] = computeTopFive([fresh], { niftyChange: 1 }, 'INDIA', 5, NOW);
    const [pa] = computeTopFive([aged], { niftyChange: 1 }, 'INDIA', 5, NOW);
    expect(pa.score).toBeLessThan(pf.score);
    expect(pa.score).toBeCloseTo(pf.score * 0.575, 1);
    expect(pa.rankReason).toMatch(/staleness ×0\.5[78]/); // rounded display
    expect(pa.rank).toBe(1); // alone it still answers — just degraded
  });

  it('age 90 min drops BELOW a fresh lower-conf signal (the pinning fix)', () => {
    const out = computeTopFive([
      SIG({ symbol: 'STALE_HI_CONF', confidence: 90, signalAge: { firstSeenAt: NOW - 4 * 3600_000, lastSeenAt: NOW - 90 * 60_000, ageMs: 0, flips24h: 0 } }),
      SIG({ symbol: 'FRESH_LO_CONF', confidence: 65 }),
    ], { niftyChange: 1 }, 'INDIA', 5, NOW);
    expect(out[0].symbol).toBe('FRESH_LO_CONF');
    expect(out[1].symbol).toBe('STALE_HI_CONF');
    // the 90-min floor: ~×0.15 of its raw score → far below the fresh pick
    expect(out[1].score).toBeLessThan(out[0].score * 0.25);
  });

  it('a 90-min-old signal falls OUT of the top-5 when 5 fresher signals are eligible', () => {
    const sigs = [
      SIG({ symbol: 'STALE_TOP', confidence: 95, signalAge: { firstSeenAt: NOW - 4 * 3600_000, lastSeenAt: NOW - 90 * 60_000, ageMs: 0, flips24h: 0 } }),
      ...Array.from({ length: 5 }, (_, i) => SIG({ symbol: `F${i}`, confidence: 60 + i })),
    ];
    const out = computeTopFive(sigs, { niftyChange: 1 }, 'INDIA', 5, NOW);
    expect(out).toHaveLength(5);
    expect(out.map(s => s.symbol)).not.toContain('STALE_TOP');
  });

  it('staleness uses lastSeenAt (board re-confirm), not firstSeenAt (direction age)', () => {
    // direction standing 3h, but the board re-confirmed it 5 min ago → fresh ranking
    const s = SIG({ symbol: 'RECONFIRMED', signalAge: { firstSeenAt: NOW - 3 * 3600_000, lastSeenAt: NOW - 5 * 60_000, ageMs: 0, flips24h: 2 } });
    const [p] = computeTopFive([s], { niftyChange: 1 }, 'INDIA', 5, NOW);
    expect(p.rankReason).not.toContain('staleness');
    expect(p.score).toBeGreaterThan(70);
  });
});

describe('v13.4 Fix 2 — hard quorum gate on computeTopFive eligibility', () => {
  it('a 4/9-vote ACTION signal is excluded regardless of its raw score', () => {
    const out = computeTopFive([
      SIG({ symbol: 'THIN', grade: 'ACTION', confidence: 95, voters: 4, participating: 4 }),
      SIG({ symbol: 'FULL', grade: 'ACTION', confidence: 60, voters: 5, participating: 5 }),
    ], { niftyChange: 1 }, 'INDIA', 5, NOW);
    expect(out.map(s => s.symbol)).toEqual(['FULL']);
  });

  it('5/9-vote ACTION signal is included — the boundary is exactly MIN_QUORUM_VOTES', () => {
    expect(MIN_QUORUM_VOTES).toBe(5);
    const out = computeTopFive([
      SIG({ symbol: 'B5', grade: 'ACTION', confidence: 70, voters: 5, participating: 5 }),
    ], { niftyChange: 1 }, 'INDIA', 5, NOW);
    expect(out.map(s => s.symbol)).toEqual(['B5']);
  });

  it('9 vote SEATS with 4 abstains → quorum counts 5 voters, not 9 seats', () => {
    // the exact CL shape: votes array has 9 seats, only 5 carry a direction,
    // and the consensus voters field is missing — the directional fallback must hold
    const votes = Array.from({ length: 9 }, (_, i) => ({ id: `m${i}`, dir: i < 5 ? 1 : 0, conf: i < 5 ? 70 : 0 }));
    const out = computeTopFive([
      SIG({ symbol: 'SEAT_TRAP', grade: 'ACTION', voters: null, participating: null, votes }),
      SIG({ symbol: 'REALLY_THIN', grade: 'ACTION', voters: null, participating: null, votes: votes.map(v => ({ ...v, dir: 0 })) }),
    ], { niftyChange: 1 }, 'INDIA', 5, NOW);
    expect(out.map(s => s.symbol)).toEqual(['SEAT_TRAP']);
  });

  it('STRONG grade does not bypass the quorum gate either', () => {
    const out = computeTopFive([
      SIG({ symbol: 'THIN_STRONG', grade: 'STRONG', confidence: 85, voters: 3, participating: 3 }),
    ], { niftyChange: 1 }, 'INDIA', 5, NOW);
    expect(out).toEqual([]); // honest empty list, never padded
  });

  it('AI_MIN_TOPFIVE_QUORUM env override raises the bar (env-tunable without redeploy)', async () => {
    const previous = process.env.AI_MIN_TOPFIVE_QUORUM;
    process.env.AI_MIN_TOPFIVE_QUORUM = '7';
    try {
      vi.resetModules();
      const fresh = await import('../server/ai/signals.js');
      expect(fresh.MIN_QUORUM_VOTES).toBe(7);
      const out = fresh.computeTopFive([
        SIG({ symbol: 'SIX', grade: 'ACTION', voters: 6, participating: 6 }),
        SIG({ symbol: 'SEVEN', grade: 'ACTION', voters: 7, participating: 7 }),
      ], { niftyChange: 1 }, 'INDIA', 5, NOW);
      expect(out.map(s => s.symbol)).toEqual(['SEVEN']);
    } finally {
      if (previous === undefined) delete process.env.AI_MIN_TOPFIVE_QUORUM;
      else process.env.AI_MIN_TOPFIVE_QUORUM = previous;
      vi.resetModules();
    }
  });
});

describe('v13.4 Fix 4 — liveInvalidationCheck (server twin, pure)', () => {
  it('missing live price or stop → honest ok', () => {
    expect(liveInvalidationCheck({ side: 'LONG', liveLtp: null, stopLoss: 100 })).toEqual({ status: 'ok' });
    expect(liveInvalidationCheck({ side: 'LONG', liveLtp: 100, stopLoss: null as unknown as number })).toEqual({ status: 'ok' });
    expect(liveInvalidationCheck({ side: 'LONG', liveLtp: 0, stopLoss: 100 })).toEqual({ status: 'ok' });
  });
  it('LONG with live <= stopLoss → invalidated; SHORT with live >= stopLoss → invalidated', () => {
    expect(liveInvalidationCheck({ side: 'LONG', liveLtp: 99.9, stopLoss: 100 })).toEqual({ status: 'invalidated', reason: expect.any(String) });
    expect(liveInvalidationCheck({ side: 'SHORT', liveLtp: 100.1, stopLoss: 100 })).toEqual({ status: 'invalidated', reason: expect.any(String) });
    // the thesis direction intact → not invalidated
    expect(liveInvalidationCheck({ side: 'LONG', liveLtp: 100.1, stopLoss: 100 })).toEqual({ status: 'ok' });
    expect(liveInvalidationCheck({ side: 'SHORT', liveLtp: 99.9, stopLoss: 100 })).toEqual({ status: 'ok' });
  });
  it('> 0.5×ATR beyond the FAR entry-zone edge → weakening (LONG far edge = zone low)', () => {
    // LONG: zone 90-92, live 95, atr 2 → |95-90| = 5 > 1 → weakening
    expect(liveInvalidationCheck({ side: 'LONG', liveLtp: 95, stopLoss: 88, entryZoneLow: 90, entryZoneHigh: 92, atr: 2 }).status).toBe('weakening');
    // just past the edge within 0.5×ATR → still ok
    expect(liveInvalidationCheck({ side: 'LONG', liveLtp: 90.9, stopLoss: 88, entryZoneLow: 90, entryZoneHigh: 92, atr: 2 }).status).toBe('ok');
    // SHORT far edge = zone HIGH: live 87 vs zone-high 92, atr 2 → |87-92| = 5 > 1 → weakening
    expect(liveInvalidationCheck({ side: 'SHORT', liveLtp: 87, stopLoss: 95, entryZoneLow: 90, entryZoneHigh: 92, atr: 2 }).status).toBe('weakening');
  });
  it('atr missing → 1.2% of liveLtp is the fallback band', () => {
    // live 100, far edge 90 → |100-90| = 10 vs 0.5×1.2 = 0.6 → weakening
    expect(liveInvalidationCheck({ side: 'LONG', liveLtp: 100, stopLoss: 85, entryZoneLow: 90, entryZoneHigh: 92 }).status).toBe('weakening');
  });
  it('no entry zone → only the SL check applies', () => {
    expect(liveInvalidationCheck({ side: 'LONG', liveLtp: 150, stopLoss: 100 }).status).toBe('ok');
  });
});
