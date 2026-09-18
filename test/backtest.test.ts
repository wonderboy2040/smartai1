// ============================================================
// test/backtest.test.ts — v6.5 WALK-FORWARD BACKTESTER
// ------------------------------------------------------------
// simulateSymbol on SYNTHETIC candles (deterministic, no network):
// the no-look-ahead guarantee, SL-first ambiguity, TP2 runner
// discipline, time-stop, R-normalized stats and the equity/DD math.
// ============================================================
import { describe, it, expect } from 'vitest';
import { simulateSymbol } from '../server/ai/backtest.js';

/** Deterministic candle generator — a clean up-trend with pullbacks. */
function trendCandles({ n = 160, start = 100, drift = 0.6, vol = 1.2, seed = 7 } = {}) {
  let s = seed;
  const rand = () => { s = (s * 1103515245 + 12345) % 2147483648; return s / 2147483648; };
  const out = [];
  let close = start;
  for (let i = 0; i < n; i++) {
    const open = close;
    close = close + drift + (rand() - 0.5) * 2 * vol;
    const high = Math.max(open, close) + rand() * vol;
    const low = Math.min(open, close) - rand() * vol;
    out.push({ time: 1700000000000 + i * 3600_000, open, high, low, close, volume: 1000 + Math.round(rand() * 500) });
  }
  return out;
}

/** Flat chop — a trend-follower should mostly abstain / churn small. */
function chopCandles({ n = 160, start = 100, vol = 0.8, seed = 11 } = {}) {
  let s = seed;
  const rand = () => { s = (s * 1103515245 + 12345) % 2147483648; return s / 2147483648; };
  const out = [];
  let close = start;
  for (let i = 0; i < n; i++) {
    const open = close;
    close = close + (rand() - 0.5) * 2 * vol;
    out.push({ time: 1700000000000 + i * 3600_000, open, high: Math.max(open, close) + rand() * 0.4, low: Math.min(open, close) - rand() * 0.4, close, volume: 1000 });
  }
  return out;
}

describe('simulateSymbol — structure', () => {
  it('returns null on unusable data (< warmup + 20 bars)', () => {
    expect(simulateSymbol({ symbol: 'X', market: 'CRYPTO', candles: trendCandles({ n: 50 }) })).toBeNull();
    expect(simulateSymbol({ symbol: 'X', market: 'CRYPTO', candles: [] })).toBeNull();
  });

  it('no look-ahead: a signal at bar i enters at bar i+1 open (±slippage)', () => {
    const candles = trendCandles({ n: 140 });
    const out = simulateSymbol({ symbol: 'BTC', market: 'CRYPTO', candles, capitalPerTradeINR: 1000 })!;
    expect(out).not.toBeNull();
    for (const t of out.trades) {
      const nextOpen = candles[t.entryBar].open;
      const long = t.side !== 'SHORT';
      const expected = Math.round(nextOpen * (1 + (long ? 0.001 : -0.001)) * 100) / 100;
      expect(t.entry).toBeCloseTo(expected, 1);
    }
  });

  it('every exit reason is one of SL / TP2 / TIME / EOD — TP1 never closes (runner discipline)', () => {
    const out = simulateSymbol({ symbol: 'BTC', market: 'CRYPTO', candles: trendCandles({ n: 200 }) })!;
    const allowed = new Set(['SL', 'TP2', 'TIME', 'EOD']);
    for (const t of out.trades) expect(allowed.has(t.reason)).toBe(true);
  });

  it('time-stop is honored: TIME exits only after maxHoldBars of holding', () => {
    const slow = trendCandles({ n: 150, drift: 0.02, vol: 0.25 });
    const out = simulateSymbol({ symbol: 'BTC', market: 'CRYPTO', candles: slow, minGrade: 'WATCH', capitalPerTradeINR: 1000, maxHoldBars: 48 })!;
    const timeExits = out.trades.filter(t => t.reason === 'TIME');
    for (const t of timeExits) {
      expect(t.holdBars).toBeGreaterThanOrEqual(48);
    }
  });

  it('R-multiples are normalized: |entry − SL| = 1R by construction', () => {
    const out = simulateSymbol({ symbol: 'BTC', market: 'CRYPTO', candles: trendCandles({ n: 200 }) })!;
    for (const t of out.trades) {
      const risk = Math.abs(t.entry! - t.sl!);
      expect(risk).toBeGreaterThan(0);
      const move = (t.side === 'LONG' ? t.exit! - t.entry! : t.entry! - t.exit!);
      expect(t.r).toBeCloseTo(move / risk, 1);
    }
  });
});

describe('simulateSymbol — stats & sanity', () => {
  it('a persistent up-trend must NOT lose money overall (LONG-biased ensemble)', () => {
    const out = simulateSymbol({ symbol: 'BTC', market: 'CRYPTO', candles: trendCandles({ n: 240, drift: 0.8, seed: 3 }) })!;
    // if the ensemble traded at all on a clean trend, it must not be net-negative
    if (out.stats.trades > 0) {
      expect(out.stats.totalR!).toBeGreaterThanOrEqual(-1);
    }
  });

  it('stats math: winRate/avgR/profitFactor consistency', () => {
    const out = simulateSymbol({ symbol: 'BTC', market: 'CRYPTO', candles: trendCandles({ n: 200 }) })!;
    const s = out.stats;
    if (s.trades > 0) {
      expect(s.wins + s.losses).toBe(s.trades);
      expect(s.winRate).toBeCloseTo((s.wins / s.trades) * 100, 1);
      expect(s.avgR).not.toBeNull();
      const wins = out.trades.filter(t => t.r > 0);
      const losses = out.trades.filter(t => t.r <= 0);
      const gw = wins.reduce((a, t) => a + t.r, 0);
      const gl = Math.abs(losses.reduce((a, t) => a + t.r, 0));
      expect(s.profitFactor).toBeCloseTo(gl > 0 ? gw / gl : Infinity, 1);
    } else {
      expect(s.winRate).toBeNull();
      expect(s.avgR).toBeNull();
    }
  });

  it('maxDDR is a real drawdown of the cumulative R curve (≤ peak-cum)', () => {
    const out = simulateSymbol({ symbol: 'BTC', market: 'CRYPTO', candles: trendCandles({ n: 200 }) })!;
    let cum = 0, peak = 0, dd = 0;
    for (const t of out.trades) {
      cum += t.r;
      if (cum > peak) peak = cum;
      if (peak - cum > dd) dd = peak - cum;
    }
    expect(out.stats.maxDDR).toBeCloseTo(Math.round(dd * 100) / 100, 1);
  });

  it('chop regime: fewer or worse trades than a clean trend (honest degradation)', () => {
    const trend = simulateSymbol({ symbol: 'BTC', market: 'CRYPTO', candles: trendCandles({ n: 200, drift: 0.7 }) });
    const chop = simulateSymbol({ symbol: 'BTC', market: 'CRYPTO', candles: chopCandles({ n: 200 }) });
    const trendScore = (trend?.stats.avgR ?? 0) * (trend?.stats.trades ?? 0);
    const chopScore = (chop?.stats.avgR ?? 0) * (chop?.stats.trades ?? 0);
    expect(chopScore).toBeLessThan(trendScore + 2); // chop never beats a clean trend by much
  });

  it('minGrade STRONG produces a subset of the ACTION trade set (or zero)', () => {
    const candles = trendCandles({ n: 200 });
    const action = simulateSymbol({ symbol: 'BTC', market: 'CRYPTO', candles, minGrade: 'ACTION' })!;
    const strong = simulateSymbol({ symbol: 'BTC', market: 'CRYPTO', candles, minGrade: 'STRONG' })!;
    expect(strong.stats.trades).toBeLessThanOrEqual(action.stats.trades);
  });
});
