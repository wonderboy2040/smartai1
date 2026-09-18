// ============================================
// MACRO REGIME DETECTOR + SECTOR ROTATION
// Regime classification, sector momentum, portfolio suggestions
// ============================================

import { Position, PriceData, MacroRegime, SectorMomentum } from '../types';

// Sector → ETF mapping for portfolio exposure
const SECTOR_MAP: Record<string, string> = {
  'SMH': 'US Tech',
  'SPY': 'US Broad', 'QQQ': 'US Tech', 'DIA': 'US Broad',
  'XLV': 'US Healthcare', 'XLE': 'US Energy', 'XLF': 'US Finance',
  'XLI': 'US Industrial', 'JUNIORBEES': 'IN Broad', 'MOMENTUM50': 'IN Smart Beta',
  'SMALLCAP': 'IN Smallcap', 'MID150BEES': 'IN Midcap',
  'BTC': 'Crypto', 'ETH': 'Crypto', 'SOL': 'Crypto',
  'BNB': 'Crypto', 'XRP': 'Crypto', 'DOGE': 'Crypto'
};

/**
 * Detect current macro regime
 */
export function detectMacroRegime(
  livePrices: Record<string, PriceData>,
  bondYields?: { us10y: number; us02y: number; spread: number }
): MacroRegime {
  // Get VIX data
  const vixUS = livePrices['US_VIX']?.price || 18;
  const vixIN = livePrices['IN_INDIAVIX']?.price || 15;
  const avgVix = (vixUS + vixIN) / 2;

  // Get yield curve
  const spread = bondYields?.spread ?? 0.3;

  // Get sector breadth (count positive vs negative sectors)
  const sectorKeys = ['US_XLK', 'US_XLF', 'US_XLE', 'US_XLV', 'US_XLI', 'IN_CNXIT', 'IN_CNXFIN', 'IN_CNXPHARMA'];
  const sectorChanges = sectorKeys.map(k => livePrices[k]?.change || 0);
  const positiveSectors = sectorChanges.filter(c => c > 0).length;
  const sectorBreadth = positiveSectors / sectorKeys.length;

  // Get growth vs defensive performance
  const growthChange = (livePrices['US_XLK']?.change || 0) + (livePrices['US_QQQ']?.change || 0);
  const defensivChange = (livePrices['US_XLV']?.change || 0) + (livePrices['US_XLE']?.change || 0);

  // Regime detection
  let regime: MacroRegime['regime'];
  let confidence: number;
  let description: string;
  let portfolioSuggestion: string;
  let sectorRecommendation: MacroRegime['sectorRecommendation'] = [];

  if (avgVix > 22 && (spread < -0.1 || sectorBreadth < 0.3)) {
    regime = 'RISK_OFF';
    confidence = Math.min(60 + (avgVix - 22) * 5, 95);
    description = `High volatility (VIX ${avgVix.toFixed(1)}), ${spread < 0 ? 'inverted yield curve' : 'weak breadth'}. Flight to safety mode. Institutional hedging extreme.`;
    portfolioSuggestion = 'Hoard cash for deep dips. Reduce smallcaps. Increase gold/defensive allocation. Only buy DEEP dip signals.';
    sectorRecommendation = [
      { sector: 'US Healthcare', action: 'OVERWEIGHT', reason: 'Defensive sector outperforms in risk-off' },
      { sector: 'US Tech', action: 'UNDERWEIGHT', reason: 'Growth sectors lead selloffs' },
      { sector: 'IN Smallcap', action: 'UNDERWEIGHT', reason: 'Smallcaps crushed in risk-off environments' },
      { sector: 'Crypto', action: 'NEUTRAL', reason: 'Digital gold hedge, but high beta' }
    ];
  } else if (avgVix > 18 && growthChange < defensivChange && spread < 0.2) {
    regime = 'STAGFLATION';
    confidence = 65;
    description = `Rising volatility with growth sectors lagging defensive. Possible stagflationary pressure.`;
    portfolioSuggestion = 'Shift allocation toward energy and healthcare. Reduce tech-heavy positions. Focus on value over growth.';
    sectorRecommendation = [
      { sector: 'US Energy', action: 'OVERWEIGHT', reason: 'Energy outperforms in stagflation' },
      { sector: 'US Healthcare', action: 'OVERWEIGHT', reason: 'Defensive with pricing power' },
      { sector: 'US Tech', action: 'UNDERWEIGHT', reason: 'Growth suffers in stagflation' },
      { sector: 'IN Smart Beta', action: 'NEUTRAL', reason: 'Momentum factor can adapt' }
    ];
  } else if (avgVix < 16 && spread > 0 && spread < 0.5 && sectorBreadth > 0.6) {
    regime = 'GOLDILOCKS';
    confidence = Math.min(70 + (16 - avgVix) * 3, 95);
    description = `Low volatility (VIX ${avgVix.toFixed(1)}), normal yield curve, broad market strength. Ideal conditions.`;
    portfolioSuggestion = 'Full deployment mode. SIP at maximum. Buy all dips aggressively. Growth + momentum favored.';
    sectorRecommendation = [
      { sector: 'US Tech', action: 'OVERWEIGHT', reason: 'Growth leads in goldilocks' },
      { sector: 'IN Smallcap', action: 'OVERWEIGHT', reason: 'Smallcaps thrive in low-vol' },
      { sector: 'IN Smart Beta', action: 'OVERWEIGHT', reason: 'Momentum factor excels' },
      { sector: 'US Energy', action: 'NEUTRAL', reason: 'No inflation scare' }
    ];
  } else {
    regime = 'RISK_ON';
    confidence = 55;
    description = `Moderate conditions. VIX ${avgVix.toFixed(1)}, yield spread ${spread.toFixed(2)}%. Neither extreme fear nor euphoria.`;
    portfolioSuggestion = 'Continue regular SIP. Buy mild dips. Maintain balanced allocation across sectors.';
    sectorRecommendation = [
      { sector: 'US Tech', action: 'NEUTRAL', reason: 'Normal market function' },
      { sector: 'IN Broad', action: 'OVERWEIGHT', reason: 'Broad market participation' },
      { sector: 'US Finance', action: 'NEUTRAL', reason: 'Stable rate environment' }
    ];
  }

  return { regime, confidence, vix: avgVix, yieldCurve: spread, description, portfolioSuggestion, sectorRecommendation };
}

/**
 * Calculate sector momentum scores
 */
export function calculateSectorMomentum(
  sectorData: { name: string; change: number }[],
  benchmarkChange: number
): SectorMomentum[] {
  return sectorData.map(s => {
    const relativeStrength = s.change - benchmarkChange;
    // FIX H1: previously `50 + Math.abs(s.change) * 10` for down moves — a -5%
    // and +5% sector both scored 100. Keep the sign so direction matters.
    const directionScore = 50 + s.change * 10;
    const compositeScore = Math.max(0, Math.min(100,
      (Math.abs(s.change) * 20 + Math.abs(relativeStrength) * 30 + directionScore) / 150
    ));

    let trend: SectorMomentum['trend'];
    if (compositeScore > 60 && s.change > 0) trend = 'LEADING';
    else if (compositeScore < 40 && s.change < 0) trend = 'LAGGING';
    else if (s.change > 0 && relativeStrength > 0) trend = 'IMPROVING';
    else trend = 'WEAKENING';

    return {
      name: s.name,
      ticker: '',
      change: s.change,
      relativeStrength,
      compositeScore: Math.round(compositeScore),
      trend
    };
  }).sort((a, b) => b.compositeScore - a.compositeScore);
}

/**
 * Map portfolio position to sector
 */
export function mapSymbolToSector(symbol: string): string {
  return SECTOR_MAP[symbol.toUpperCase()] || 'Other';
}

/**
 * Analyze portfolio sector exposure vs momentum
 */
export function analyzePortfolioSectorExposure(
  portfolio: Position[],
  livePrices: Record<string, PriceData>,
  sectorMomentum: SectorMomentum[]
): { totalExposure: Record<string, number>; recommendations: { sector: string; currentPct: number; momentum: number; action: string }[] } {
  // Calculate total portfolio value and per-sector exposure
  const totalValue = portfolio.reduce((sum, pos) => {
    const key = `${pos.market}_${pos.symbol}`;
    const price = livePrices[key]?.price || pos.avgPrice;
    return sum + (price * pos.qty);
  }, 0);

  const exposureMap: Record<string, number> = {};
  portfolio.forEach(pos => {
    const key = `${pos.market}_${pos.symbol}`;
    const price = livePrices[key]?.price || pos.avgPrice;
    const value = price * pos.qty;
    const sector = mapSymbolToSector(pos.symbol);
    exposureMap[sector] = (exposureMap[sector] || 0) + value;
  });

  // Convert to percentages
  const totalExposure: Record<string, number> = {};
  Object.entries(exposureMap).forEach(([sector, value]) => {
    totalExposure[sector] = totalValue > 0 ? Math.round((value / totalValue) * 100) : 0;
  });

  // Generate recommendations
  const recommendations = Object.entries(totalExposure).map(([sector, pct]) => {
    const momentum = sectorMomentum.find(m => m.name === sector || sector.includes(m.name));
    const score = momentum?.compositeScore ?? 50;

    let action: string;
    if (pct > 40 && score < 50) action = `OVERCONCENTRATED (${pct}%) — consider reducing`;
    else if (pct > 30 && score < 40) action = `Sector weakening — shift to leading sectors`;
    else if (score > 65) action = `Strong momentum — maintain or add on dips`;
    else if (score < 35) action = `Weak momentum — avoid adding more`;
    else action = `Neutral — maintain current allocation`;

    return { sector, currentPct: pct, momentum: score, action };
  }).sort((a, b) => b.currentPct - a.currentPct);

  return { totalExposure, recommendations };
}
