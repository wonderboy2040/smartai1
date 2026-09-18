// ============================================================
// portfolioInsights.test — Portfolio TAB insight engine (v4.5)
// Pure functions: today's movers, all-time performers, HHI
// diversification, market split, health rubric.
// ============================================================
import { describe, it, expect } from 'vitest';
import { computePortfolioInsights, type InsightAsset } from '../src/utils/portfolioInsights';

const A = (over: Partial<InsightAsset> = {}): InsightAsset => ({
  label: 'X', group: 'india', pl: 0, plPct: 0, todayPL: 0, valINR: 100,
  ...over,
});

describe('computePortfolioInsights — today winners/losers', () => {
  it('ranks today movers by ₹ impact desc, caps at 3', () => {
    const assets = [
      A({ label: 'A', todayPL: 500, valINR: 1000 }),
      A({ label: 'B', todayPL: -200, valINR: 1000 }),
      A({ label: 'C', todayPL: 900, valINR: 1000 }),
      A({ label: 'D', todayPL: -700, valINR: 1000 }),
      A({ label: 'E', todayPL: 0, valINR: 1000 }),
    ];
    const r = computePortfolioInsights(assets, 5000);
    expect(r.todayWinners.map(a => a.label)).toEqual(['C', 'A']);
    expect(r.todayLosers.map(a => a.label)).toEqual(['D', 'B']);
  });

  it('ignores zero-impact rows for today lists', () => {
    const r = computePortfolioInsights([A({ todayPL: 0 }), A({ todayPL: 0 })], 200);
    expect(r.todayWinners).toEqual([]);
    expect(r.todayLosers).toEqual([]);
  });
});

describe('computePortfolioInsights — all-time performers', () => {
  it('ranks by pnlPct desc, caps at 3, skips no-basis rows', () => {
    const assets = [
      A({ label: 'A', plPct: 12.5, valINR: 1000 }),
      A({ label: 'B', plPct: -8, valINR: 1000 }),
      A({ label: 'C', plPct: 30, valINR: 1000 }),
      A({ label: 'D', plPct: 0, valINR: 1000 }),
      A({ label: 'E', plPct: -1, valINR: 1000 }),
    ];
    const r = computePortfolioInsights(assets, 5000);
    expect(r.bestPerformers.map(a => a.label)).toEqual(['C', 'A']);
    expect(r.worstPerformers.map(a => a.label)).toEqual(['B', 'E']);
  });
});

describe('computePortfolioInsights — concentration & health', () => {
  it('single 100% holding → EGG-IN-ONE-BASKET + score 0', () => {
    const r = computePortfolioInsights([A({ valINR: 1000 })], 1000);
    expect(r.topWeight).toBeCloseTo(100, 0);
    expect(r.hhi).toBe(10000);
    expect(r.diversificationScore).toBe(0);
    expect(r.health.grade).toBe('EGG-IN-ONE-BASKET');
  });

  it('60%+ top holding → EGG-IN-ONE-BASKET', () => {
    const assets = [
      A({ label: 'BIG', valINR: 700 }),
      A({ label: 'S1', valINR: 100 }),
      A({ label: 'S2', valINR: 100 }),
      A({ label: 'S3', valINR: 100 }),
    ];
    expect(computePortfolioInsights(assets, 1000).health.grade).toBe('EGG-IN-ONE-BASKET');
  });

  it('40-60% top holding → CONCENTRATED', () => {
    const assets = [
      A({ label: 'BIG', valINR: 50, group: 'usa' }),
      A({ label: 'S1', valINR: 25, group: 'india' }),
      A({ label: 'S2', valINR: 25, group: 'crypto' }),
    ];
    const r = computePortfolioInsights(assets, 100);
    expect(r.health.grade).toBe('CONCENTRATED');
    expect(r.top3Weight).toBeCloseTo(100, 0);
  });

  it('<25% top holding across 3 markets → WELL-DIVERSIFIED', () => {
    const assets = Array.from({ length: 8 }, (_, i) =>
      A({ label: `A${i}`, group: (['india', 'usa', 'crypto'] as const)[i % 3], valINR: 125 }));
    const r = computePortfolioInsights(assets, 1000);
    expect(r.topWeight).toBeLessThan(25);
    expect(r.markets).toBe(3);
    expect(r.health.grade).toBe('WELL-DIVERSIFIED');
    expect(r.diversificationScore).toBeGreaterThan(60);
  });

  it('top-3 weight sums the 3 largest weights', () => {
    const assets = [A({ valINR: 400 }), A({ valINR: 300 }), A({ valINR: 200 }), A({ valINR: 100 })];
    const r = computePortfolioInsights(assets, 1000);
    expect(r.top3Weight).toBeCloseTo(90, 0);
    expect(r.topWeight).toBeCloseTo(40, 0);
  });

  it('two equal holdings → balanced HHI = 5000, mid score', () => {
    const r = computePortfolioInsights([A({ valINR: 500 }), A({ valINR: 500 })], 1000);
    expect(r.hhi).toBe(5000);
    // 100 − 50 (HHI) − 10 (small-N penalty, <4 assets) = 40
    expect(r.diversificationScore).toBe(40);
  });
});

describe('computePortfolioInsights — market split', () => {
  it('splits value across groups and counts active markets', () => {
    const assets = [
      A({ group: 'india', valINR: 500 }),
      A({ group: 'usa', valINR: 300 }),
      A({ group: 'crypto', valINR: 200 }),
      A({ group: 'india', valINR: 0 }),
    ];
    const r = computePortfolioInsights(assets, 1000);
    expect(r.marketSplit.india).toBeCloseTo(50, 0);
    expect(r.marketSplit.usa).toBeCloseTo(30, 0);
    expect(r.marketSplit.crypto).toBeCloseTo(20, 0);
    expect(r.markets).toBe(3);
  });

  it('zero total value never divides by zero', () => {
    const r = computePortfolioInsights([A({ valINR: 0 }), A({ valINR: 0 })], 0);
    expect(r.marketSplit.india).toBe(0);
    expect(r.topWeight).toBe(0);
    expect(r.hhi).toBe(0);
    // markets=0 → the <25% + 3-markets branch can't fire → BALANCED
    expect(r.health.grade).toBe('BALANCED');
  });

  it('empty portfolio degrades gracefully', () => {
    const r = computePortfolioInsights([], 0);
    expect(r.todayWinners).toEqual([]);
    expect(r.bestPerformers).toEqual([]);
    expect(r.diversificationScore).toBe(0);
  });
});
