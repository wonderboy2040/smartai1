import { describe, it, expect } from 'vitest';
import { computeSuperScoreFromIndicators } from './superintelligenceEngine';

describe('computeSuperScoreFromIndicators (v6 shared math)', () => {
  it('always stays within the 1–99 bound', () => {
    const extremeBuy = computeSuperScoreFromIndicators({ rsi: 5, price: 90, change: -10, sma20: 100, sma50: 80, macd: 5, high: 100, low: 90 });
    const extremeSell = computeSuperScoreFromIndicators({ rsi: 99, price: 120, change: 15, sma20: 80, sma50: 100, macd: -5, high: 120, low: 90 });
    expect(extremeBuy).toBeGreaterThanOrEqual(1);
    expect(extremeBuy).toBeLessThanOrEqual(99);
    expect(extremeSell).toBeGreaterThanOrEqual(1);
    expect(extremeSell).toBeLessThanOrEqual(99);
  });

  it('scores strongly oversold + bull cross + near day-low as BUY-LEAN (≥65)', () => {
    const score = computeSuperScoreFromIndicators({
      rsi: 28, price: 95, change: -2,
      sma20: 102, sma50: 100, // SMA20>SMA50
      macd: 0.4, high: 101, low: 94, // near day low
    });
    expect(score).toBeGreaterThanOrEqual(65);
  });

  it('scores strongly overbought + bear cross + near day-high as SELL-LEAN (≤35)', () => {
    const score = computeSuperScoreFromIndicators({
      rsi: 82, price: 198, change: 5,
      sma20: 182, sma50: 190, // bearish cross
      macd: -0.6, high: 199, low: 180, // near day high
    });
    expect(score).toBeLessThanOrEqual(35);
  });

  it('treats flat/neutral inputs as NEUTRAL (35–64 inclusive zone)', () => {
    const score = computeSuperScoreFromIndicators({ rsi: 50, price: 100, change: 0.2, sma20: 100, sma50: 100, macd: 0.01, high: 101, low: 99 });
    expect(score).toBeGreaterThanOrEqual(35);
    expect(score).toBeLessThanOrEqual(64);
  });

  it('is deterministic & pure — same input always gives same output', () => {
    const input = { rsi: 35, price: 250, change: -1.5, sma20: 255, sma50: 260, macd: -0.2, high: 253, low: 244 };
    expect(computeSuperScoreFromIndicators(input)).toBe(computeSuperScoreFromIndicators(input));
  });

  it('works when optional indicators (sma/macd/high/low) are missing', () => {
    const score = computeSuperScoreFromIndicators({ rsi: 32, price: 100, change: -3 });
    expect(score).toBeGreaterThanOrEqual(1);
    expect(score).toBeLessThanOrEqual(99);
  });
});
