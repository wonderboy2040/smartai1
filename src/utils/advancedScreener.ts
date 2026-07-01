// ============================================
// ADVANCED AI STOCK SCREENER
// Custom filters, AI scoring, multi-criteria sorting
// ============================================

import { Position, PriceData, ScreenerResult } from '../types';
import { getAssetCagrProxy, ALPHA_ETFS_IN, ALPHA_ETFS_US } from './constants';

export interface ScreenerFilters {
  market: 'ALL' | 'IN' | 'US';
  signal: 'ALL' | 'STRONG_BUY' | 'BUY' | 'HOLD' | 'AVOID';
  rsiMin: number;
  rsiMax: number;
  priceMin: number;
  priceMax: number;
  changeMin: number;
  changeMax: number;
  sortBy: 'alphaScore' | 'qualityScore' | 'momentumScore' | 'valueScore' | 'rsi' | 'cagr' | 'change' | 'price';
  sortOrder: 'desc' | 'asc';
  sector: string;
}

export const DEFAULT_FILTERS: ScreenerFilters = {
  market: 'ALL',
  signal: 'ALL',
  rsiMin: 0,
  rsiMax: 100,
  priceMin: 0,
  priceMax: 999999,
  changeMin: -100,
  changeMax: 100,
  sortBy: 'alphaScore',
  sortOrder: 'desc',
  sector: 'ALL',
};

export const SECTORS = [
  'ALL', 'Technology', 'Finance', 'Healthcare', 'Energy', 'Consumer',
  'Industrial', 'Materials', 'Utilities', 'Real Estate', 'Telecom', 'Crypto', 'ETF'
];

// Sector mapping for Indian/US stocks
const SYMBOL_SECTOR_MAP: Record<string, string> = {
  // India
  'RELIANCE': 'Energy', 'TCS': 'Technology', 'HDFCBANK': 'Finance', 'INFY': 'Technology',
  'ICICIBANK': 'Finance', 'HINDUNILVR': 'Consumer', 'ITC': 'Consumer', 'SBIN': 'Finance',
  'BHARTIARTL': 'Telecom', 'KOTAKBANK': 'Finance', 'LT': 'Industrial', 'AXISBANK': 'Finance',
  'BAJFINANCE': 'Finance', 'MARUTI': 'Industrial', 'SUNPHARMA': 'Healthcare', 'TITAN': 'Consumer',
  'ASIANPAINT': 'Materials', 'NESTLEIND': 'Consumer', 'ULTRACEMCO': 'Materials', 'WIPRO': 'Technology',
  'TATAMOTORS': 'Industrial', 'ONGC': 'Energy', 'NTPC': 'Utilities', 'POWERGRID': 'Utilities',
  'TATASTEEL': 'Materials', 'ADANIENT': 'Industrial', 'ADANIPORTS': 'Industrial',
  // US
  'AAPL': 'Technology', 'MSFT': 'Technology', 'GOOGL': 'Technology', 'AMZN': 'Consumer',
  'NVDA': 'Technology', 'META': 'Technology', 'TSLA': 'Industrial', 'BRK.B': 'Finance',
  'UNH': 'Healthcare', 'JNJ': 'Healthcare', 'V': 'Finance', 'XOM': 'Energy',
  'JPM': 'Finance', 'PG': 'Consumer', 'MA': 'Finance', 'HD': 'Consumer',
  'CVX': 'Energy', 'LLY': 'Healthcare', 'ABBV': 'Healthcare', 'CRM': 'Technology',
  'NFLX': 'Technology', 'AMD': 'Technology', 'AVGO': 'Technology', 'COST': 'Consumer',
  // ETFs
  'SMH': 'Technology', 'VGT': 'Technology', 'QQQ': 'Technology', 'SPY': 'ETF',
  'VTI': 'ETF', 'VOO': 'ETF', 'ARKK': 'Technology', 'IBIT': 'Crypto',
  'COIN': 'Crypto', 'MSTR': 'Technology', 'PLTR': 'Technology',
};

function getSector(symbol: string): string {
  return SYMBOL_SECTOR_MAP[symbol.toUpperCase()] || 'Other';
}

function calcQualityScore(cagr: number, maxDD: number): number {
  let score = 0;
  if (cagr > 25) score += 40;
  else if (cagr > 20) score += 35;
  else if (cagr > 15) score += 28;
  else if (cagr > 10) score += 18;
  else score += 8;

  if (maxDD < 15) score += 35;
  else if (maxDD < 25) score += 28;
  else if (maxDD < 35) score += 20;
  else if (maxDD < 45) score += 12;
  else score += 5;

  const riskAdj = maxDD > 0 ? cagr / maxDD : cagr / 20;
  if (riskAdj > 1.5) score += 25;
  else if (riskAdj > 1.0) score += 20;
  else if (riskAdj > 0.7) score += 15;
  else if (riskAdj > 0.4) score += 8;
  else score += 3;

  return Math.min(100, score);
}

function calcMomentumScore(rsi: number, sma20: number, sma50: number, change: number): number {
  let score = 0;
  if (rsi >= 40 && rsi <= 60) score += 30;
  else if (rsi >= 30 && rsi <= 70) score += 22;
  else if (rsi < 30) score += 15;
  else score += 8;

  if (sma20 > 0 && sma50 > 0) {
    if (sma20 > sma50 * 1.02) score += 35;
    else if (sma20 > sma50) score += 25;
    else if (sma20 > sma50 * 0.98) score += 12;
    else score += 5;
  } else {
    score += 15;
  }

  if (change > 3) score += 35;
  else if (change > 1) score += 28;
  else if (change > 0) score += 20;
  else if (change > -1) score += 12;
  else if (change > -3) score += 6;
  else score += 2;

  return Math.min(100, score);
}

function calcValueScore(price: number, sma50: number, cagr: number, rsi: number): number {
  let score = 0;
  const pegProxy = cagr > 0 ? (rsi / cagr) : 2;
  if (pegProxy < 1.0) score += 40;
  else if (pegProxy < 1.5) score += 30;
  else if (pegProxy < 2.0) score += 20;
  else if (pegProxy < 3.0) score += 10;
  else score += 5;

  if (sma50 > 0) {
    const discount = ((sma50 - price) / sma50) * 100;
    if (discount > 10) score += 35;
    else if (discount > 5) score += 28;
    else if (discount > 0) score += 20;
    else if (discount > -5) score += 12;
    else score += 5;
  } else {
    score += 15;
  }

  if (rsi < 35) score += 25;
  else if (rsi < 45) score += 20;
  else if (rsi < 55) score += 14;
  else if (rsi < 65) score += 8;
  else score += 3;

  return Math.min(100, score);
}

function getEstimatedMaxDD(symbol: string): number {
  const etf = [...ALPHA_ETFS_IN, ...ALPHA_ETFS_US].find(e => e.sym === symbol);
  if (etf) return etf.maxDD;
  const cryptoSyms = ['BTC', 'ETH', 'SOL', 'BNB', 'XRP', 'DOGE', 'ADA', 'AVAX', 'DOT', 'IBIT', 'COIN', 'MSTR'];
  if (cryptoSyms.includes(symbol.toUpperCase())) return 60;
  return 30;
}

export interface ScreenerResultEx extends ScreenerResult {
  sector: string;
  volProfile: 'ABOVE_AVG' | 'NORMAL' | 'LOW';
}

/**
 * Run advanced screener with custom filters
 */
export function runAdvancedScreener(
  portfolio: Position[],
  livePrices: Record<string, PriceData>,
  filters: ScreenerFilters = DEFAULT_FILTERS,
): ScreenerResultEx[] {
  const allResults: ScreenerResultEx[] = [];

  // Screen portfolio assets
  for (const pos of portfolio) {
    const key = `${pos.market}_${pos.symbol}`;
    const pd = livePrices[key];
    const price = pd?.price || pos.avgPrice;
    const rsi = pd?.rsi || 50;
    const sma20 = pd?.sma20 || price;
    const sma50 = pd?.sma50 || price;
    const change = pd?.change || 0;
    const volume = pd?.volume || 0;

    const cagr = getAssetCagrProxy(pos.symbol, pos.market);
    const maxDD = getEstimatedMaxDD(pos.symbol);
    const sector = getSector(pos.symbol);
    const volProfile: ScreenerResultEx['volProfile'] = volume > 1500000 ? 'ABOVE_AVG' : volume > 500000 ? 'NORMAL' : 'LOW';

    const qualityScore = calcQualityScore(cagr, maxDD);
    const momentumScore = calcMomentumScore(rsi, sma20, sma50, change);
    const valueScore = calcValueScore(price, sma50, cagr, rsi);
    const alphaScore = Math.round(qualityScore * 0.4 + momentumScore * 0.3 + valueScore * 0.3);

    let signal: ScreenerResult['signal'];
    if (alphaScore >= 75) signal = 'STRONG_BUY';
    else if (alphaScore >= 55) signal = 'BUY';
    else if (alphaScore >= 35) signal = 'HOLD';
    else signal = 'AVOID';

    const reasons: string[] = [];
    if (qualityScore > 70) reasons.push('High quality');
    if (momentumScore > 70) reasons.push('Strong momentum');
    if (valueScore > 70) reasons.push('Good value');
    if (rsi < 35) reasons.push('Oversold zone');
    if (sma20 > sma50) reasons.push('Uptrend');
    else if (sma20 < sma50) reasons.push('Downtrend');
    if (cagr > 20) reasons.push(`${cagr}% CAGR`);

    const etfInfo = [...ALPHA_ETFS_IN, ...ALPHA_ETFS_US].find(e => e.sym === pos.symbol);
    const name = etfInfo?.name || pos.symbol;

    allResults.push({
      symbol: pos.symbol,
      market: pos.market,
      name,
      price,
      qualityScore,
      cagr,
      maxDrawdown: maxDD,
      momentumScore,
      rsi,
      sma20,
      sma50,
      aboveSma50: sma20 > sma50,
      change,
      valueScore,
      pegRatio: cagr > 0 ? +(rsi / cagr).toFixed(2) : 0,
      alphaScore,
      signal,
      reason: reasons.length > 0 ? reasons.join(', ') : 'Neutral factors',
      sector,
      volProfile,
    });
  }

  // Also screen ETFs not in portfolio
  const portfolioSymbols = new Set(portfolio.map(p => p.symbol));
  const allETFs = [...ALPHA_ETFS_IN, ...ALPHA_ETFS_US];

  for (const etf of allETFs) {
    if (portfolioSymbols.has(etf.sym)) continue;
    const mkt = ALPHA_ETFS_IN.includes(etf) ? 'IN' : 'US';
    const key = `${mkt}_${etf.sym}`;
    const pd = livePrices[key];
    const price = pd?.price || 0;
    if (price === 0) continue;

    const rsi = pd?.rsi || 50;
    const sma20 = pd?.sma20 || price;
    const sma50 = pd?.sma50 || price;
    const change = pd?.change || 0;
    const volume = pd?.volume || 0;

    const qualityScore = calcQualityScore(etf.cagr, etf.maxDD);
    const momentumScore = calcMomentumScore(rsi, sma20, sma50, change);
    const valueScore = calcValueScore(price, sma50, etf.cagr, rsi);
    const alphaScore = Math.round(qualityScore * 0.4 + momentumScore * 0.3 + valueScore * 0.3);

    let signal: ScreenerResult['signal'];
    if (alphaScore >= 75) signal = 'STRONG_BUY';
    else if (alphaScore >= 55) signal = 'BUY';
    else if (alphaScore >= 35) signal = 'HOLD';
    else signal = 'AVOID';

    const volProfile: ScreenerResultEx['volProfile'] = volume > 1500000 ? 'ABOVE_AVG' : volume > 500000 ? 'NORMAL' : 'LOW';

    allResults.push({
      symbol: etf.sym,
      market: mkt as 'IN' | 'US',
      name: etf.name,
      price,
      qualityScore,
      cagr: etf.cagr,
      maxDrawdown: etf.maxDD,
      momentumScore,
      rsi,
      sma20,
      sma50,
      aboveSma50: sma20 > sma50,
      change,
      valueScore,
      pegRatio: etf.cagr > 0 ? +(rsi / etf.cagr).toFixed(2) : 0,
      alphaScore,
      signal,
      reason: qualityScore > 70 ? 'High quality' : momentumScore > 70 ? 'Strong momentum' : 'Neutral',
      sector: 'ETF',
      volProfile,
    });
  }

  // Apply filters
  let filtered = allResults.filter(r => {
    if (filters.market !== 'ALL' && r.market !== filters.market) return false;
    if (filters.signal !== 'ALL' && r.signal !== filters.signal) return false;
    if (r.rsi < filters.rsiMin || r.rsi > filters.rsiMax) return false;
    if (r.price < filters.priceMin || r.price > filters.priceMax) return false;
    if (r.change < filters.changeMin || r.change > filters.changeMax) return false;
    if (filters.sector !== 'ALL' && r.sector !== filters.sector) return false;
    return true;
  });

  // Sort
  filtered.sort((a, b) => {
    const aVal = a[filters.sortBy];
    const bVal = b[filters.sortBy];
    const mult = filters.sortOrder === 'desc' ? -1 : 1;
    return (aVal - bVal) * mult;
  });

  return filtered;
}

/**
 * Get filter summary for display
 */
export function getFilterSummary(filters: ScreenerFilters): string {
  const parts: string[] = [];
  if (filters.market !== 'ALL') parts.push(filters.market);
  if (filters.signal !== 'ALL') parts.push(filters.signal.replace('_', ' '));
  if (filters.rsiMin > 0 || filters.rsiMax < 100) parts.push(`RSI ${filters.rsiMin}-${filters.rsiMax}`);
  if (filters.priceMin > 0 || filters.priceMax < 999999) parts.push(`Price ${filters.priceMin}-${filters.priceMax}`);
  if (filters.sector !== 'ALL') parts.push(filters.sector);
  return parts.length > 0 ? parts.join(' | ') : 'No filters';
}
