import { describe, it, expect } from 'vitest';
import { runSuperScoreBacktestFromCandles, formatSuperScoreReport, type Candle } from './superScoreBacktest';

// Deterministic synthetic candles — gentle uptrend with cyclic pullbacks.
// No Math.random(): same input → same result forever (CI-safe).
function makeCandles(days: number): Candle[] {
  const candles: Candle[] = [];
  for (let i = 0; i < days; i++) {
    const base = 100 + i * 0.08;                    // slow drift up
    const wave = Math.sin(i / 4.7) * 2.4;           // cyclic momentum
    const close = base + wave;
    candles.push({
      date: `2025-${String(Math.floor(i / 21) + 1).padStart(2, '0')}-${String((i % 21) + 1).padStart(2, '0')}`,
      open: close * 0.999,
      high: close * 1.006,
      low: close * 0.993,
      close,
      volume: 1_500_000 + (i % 7) * 100_000,
    });
  }
  return candles;
}

describe('SuperScore Backtester (deterministic)', () => {
  const candles = makeCandles(250);
  const result = runSuperScoreBacktestFromCandles('TEST', 'IN', candles);

  it('reports the full candle window', () => {
    expect(result.days).toBe(250);
    expect(result.symbol).toBe('TEST');
  });

  it('produces all 4 score-band stats with consistent sample math', () => {
    expect(result.bandStats).toHaveLength(4);
    for (const b of result.bandStats) {
      expect(b.samples).toBeGreaterThanOrEqual(0);
      expect(b.winRate).toBeGreaterThanOrEqual(0);
      expect(b.winRate).toBeLessThanOrEqual(100);
    }
  });

  it('simulated trades have sane arithmetic & ordering', () => {
    for (const t of result.trades) {
      const expected = ((t.exitPrice - t.entryPrice) / t.entryPrice) * 100;
      expect(Math.abs(expected - t.returnPct)).toBeLessThan(1e-9);
      expect(t.holdingDays).toBeGreaterThan(0);
      expect(t.entryDate <= t.exitDate).toBe(true);
      expect(['WIN', 'LOSS', 'BREAKEVEN']).toContain(t.result);
    }
    expect(result.totalTrades).toBe(result.trades.length);
    expect(result.winRate).toBeGreaterThanOrEqual(0);
    expect(result.winRate).toBeLessThanOrEqual(100);
  });

  it('on a bullish synthetic series the strategy is NOT a guaranteed winner — no cherry-picking', () => {
    // We only assert the metrics exist and are finite (no fabricated positivity).
    expect(Number.isFinite(result.totalReturn)).toBe(true);
    expect(Number.isFinite(result.profitFactor)).toBe(true);
  });

  it('formats a chat-friendly report mentioning the symbol', () => {
    const text = formatSuperScoreReport(result);
    expect(text).toContain('TEST');
    expect(text.length).toBeLessThan(4000); // fits a chat bubble
  });

  it('is fully deterministic — second run matches first', () => {
    const again = runSuperScoreBacktestFromCandles('TEST', 'IN', candles);
    expect(again.totalTrades).toBe(result.totalTrades);
    expect(again.totalReturn).toBeCloseTo(result.totalReturn, 10);
    expect(again.bandStats.map(b => b.samples)).toEqual(result.bandStats.map(b => b.samples));
  });

  it('handles very short history gracefully (no indicators → no crash)', () => {
    const tiny = runSuperScoreBacktestFromCandles('TINY', 'US', makeCandles(60));
    expect(tiny.days).toBe(60);
    expect(Number.isFinite(tiny.totalReturn)).toBe(true);
  });
});
