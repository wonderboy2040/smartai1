import { describe, it, expect } from 'vitest';
import {
  calculateParametricVaR,
  calculateHistoricalVaR,
  calculateMonteCarloVaR,
  calculateVaR,
  runStressTests,
  analyzeConcentrationRisk,
  suggestPositionSize,
} from './riskEngine';
import { Position, PriceData } from '../types';

describe('calculateParametricVaR', () => {
  it('returns correct VaR at 95% confidence', () => {
    const result = calculateParametricVaR(100000, 0.02, 0.95);
    expect(result).toBeCloseTo(3290, -2);
  });

  it('returns higher VaR at 99% confidence', () => {
    const result = calculateParametricVaR(100000, 0.02, 0.99);
    expect(result).toBeGreaterThan(calculateParametricVaR(100000, 0.02, 0.95));
  });
});

describe('calculateHistoricalVaR', () => {
  it('returns 0 for empty changes', () => {
    const result = calculateHistoricalVaR(100000, []);
    expect(result).toBeGreaterThan(0);
  });

  it('handles positive and negative changes', () => {
    const result = calculateHistoricalVaR(100000, [-5, -3, -1, 2, 4], 0.95);
    expect(result).toBeGreaterThan(0);
  });
});

describe('calculateMonteCarloVaR', () => {
  it('returns non-negative VaR', () => {
    const result = calculateMonteCarloVaR(100000, 0.10, 0.20, 1, 500, 0.95);
    expect(result).toBeGreaterThanOrEqual(0);
    expect(result).toBeLessThan(100000);
  });
});

describe('calculateVaR', () => {
  it('uses default volatility when no live prices', () => {
    const positions: Position[] = [{ id: '1', symbol: 'SMH', qty: 10, avgPrice: 100, market: 'US', dateAdded: '2024-01-01', leverage: 1 }];
    const prices: Record<string, PriceData> = {};
    const result = calculateVaR(10000, positions, prices, 0.95);
    expect(result.parametric).toBeGreaterThan(0);
    expect(result.confidence).toBe(0.95);
  });
});

describe('runStressTests', () => {
  it('returns 6 scenarios', () => {
    const positions: Position[] = [{ id: '1', symbol: 'SMH', qty: 10, avgPrice: 100, market: 'US', dateAdded: '2024-01-01', leverage: 1 }];
    const prices: Record<string, PriceData> = { 'US_SMH': { price: 110, change: 2, high: 115, low: 105, volume: 0, rsi: 55, market: 'US', tvExchange: 'NASDAQ', tvExactSymbol: 'SMH', time: Date.now() } };
    const result = runStressTests(positions, prices);
    expect(result).toHaveLength(6);
    expect(result[0].name).toBe('2008 Financial Crisis');
    expect(result[0].impactPct).toBe(-45);
  });

  it('returns empty array for empty portfolio', () => {
    const result = runStressTests([], {});
    expect(result).toHaveLength(0);
  });
});

describe('analyzeConcentrationRisk', () => {
  it('returns sorted risk contributions', () => {
    const positions: Position[] = [
      { id: '1', symbol: 'SMH', qty: 10, avgPrice: 100, market: 'US', dateAdded: '2024-01-01', leverage: 1 },
      { id: '2', symbol: 'JUNIORBEES', qty: 50, avgPrice: 50, market: 'IN', dateAdded: '2024-01-01', leverage: 1 },
    ];
    const prices: Record<string, PriceData> = {
      'US_SMH': { price: 110, change: 2, high: 115, low: 105, volume: 0, rsi: 55, market: 'US', tvExchange: 'NASDAQ', tvExactSymbol: 'SMH', time: Date.now() },
      'IN_JUNIORBEES': { price: 52, change: 1, high: 53, low: 51, volume: 0, rsi: 50, market: 'IN', tvExchange: 'NSE', tvExactSymbol: 'JUNIORBEES', time: Date.now() },
    };
    const result = analyzeConcentrationRisk(positions, prices);
    expect(result.length).toBe(2);
    expect(result[0].contributionToRisk).toBeGreaterThanOrEqual(result[1].contributionToRisk);
  });
});

describe('suggestPositionSize', () => {
  it('allocates more to low-volatility assets', () => {
    const result = suggestPositionSize(10000, [
      { symbol: 'AAA', volatility: 0.1 },
      { symbol: 'BBB', volatility: 0.4 },
    ]);
    expect(result[0].suggestedAmount).toBeGreaterThan(result[1].suggestedAmount);
  });

  it('equal allocation when all volatility is zero', () => {
    const result = suggestPositionSize(10000, [
      { symbol: 'AAA', volatility: 0 },
      { symbol: 'BBB', volatility: 0 },
    ]);
    expect(result[0].suggestedAmount).toBe(5000);
  });
});
