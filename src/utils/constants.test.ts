import { describe, it, expect } from 'vitest';
import {
  getTodayString, isCryptoSymbol, guessMarket,
  getAssetCagrProxy, formatCurrency, formatPrice,
} from './constants';

describe('getTodayString', () => {
  it('returns YYYY-MM-DD format', () => {
    const result = getTodayString();
    expect(result).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});

describe('isCryptoSymbol', () => {
  it('detects BTC', () => { expect(isCryptoSymbol('BTC')).toBe(true); });
  it('detects ETH', () => { expect(isCryptoSymbol('ETH')).toBe(true); });
  it('detects SOLUSDT', () => { expect(isCryptoSymbol('SOLUSDT')).toBe(true); });
  it('rejects SMH', () => { expect(isCryptoSymbol('SMH')).toBe(false); });
  it('rejects NIFTY', () => { expect(isCryptoSymbol('NIFTY')).toBe(false); });
});

describe('guessMarket', () => {
  it('returns IN for .NS suffix', () => { expect(guessMarket('RELIANCE.NS')).toBe('IN'); });
  it('returns IN for BEES ETFs', () => { expect(guessMarket('JUNIORBEES')).toBe('IN'); });
  it('returns IN for crypto', () => { expect(guessMarket('BTC')).toBe('IN'); });
  it('returns US for SMH', () => { expect(guessMarket('SMH')).toBe('US'); });
  it('returns US for NVDA', () => { expect(guessMarket('NVDA')).toBe('US'); });
});

describe('getAssetCagrProxy', () => {
  it('returns known IN ETF CAGR', () => { expect(getAssetCagrProxy('JUNIORBEES', 'IN')).toBe(18.5); });
  it('returns known US ETF CAGR', () => { expect(getAssetCagrProxy('SMH', 'US')).toBe(28.5); });
  it('returns crypto CAGR for BTC', () => { expect(getAssetCagrProxy('BTC', 'IN')).toBe(55); });
  it('returns default for unknown symbol', () => {
    const r = getAssetCagrProxy('UNKNOWN', 'US');
    expect(r).toBeGreaterThanOrEqual(10);
    expect(r).toBeLessThanOrEqual(15);
  });
});

describe('formatCurrency', () => {
  it('formats lakhs', () => { expect(formatCurrency(150000, '₹')).toContain('L'); });
  it('formats crores', () => { expect(formatCurrency(15000000, '₹')).toContain('Cr'); });
  it('formats regular number', () => { expect(formatCurrency(5000, '₹')).toContain('5,000'); });
});

describe('formatPrice', () => {
  it('formats INR price', () => { expect(formatPrice(2500.5, '₹')).toContain('₹'); });
  it('formats USD price', () => { expect(formatPrice(150.75, '$')).toContain('$'); });
  it('shows 6 decimals for sub-1 prices', () => {
    const result = formatPrice(0.123456, '$');
    expect(result.split('.')[1]?.length).toBe(6);
  });
});
