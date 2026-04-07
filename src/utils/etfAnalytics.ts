// ETF Analytics Suite
// Comprehensive analytics for ETFs including tracking error, holdings overlap, liquidity, tax efficiency, and factor exposure

import { ETFInfo } from '../types';
import { PriceData } from '../types';

/**
 * ETF Analytics Engine
 * Provides advanced analytics for ETF selection and portfolio construction
 */
export class ETFAnalyticsEngine {
  /**
   * Calculate tracking error vs benchmark
   * @param etfReturns Historical returns of the ETF
   * @param benchmarkReturns Historical returns of the benchmark index
   * @returns Tracking error (annualized standard deviation of excess returns)
   */
  public static calculateTrackingError(
    etfReturns: number[],
    benchmarkReturns: number[]
  ): number {
    if (etfReturns.length !== benchmarkReturns.length || etfReturns.length === 0) {
      return 0;
    }

    // Calculate excess returns
    const excessReturns: number[] = [];
    for (let i = 0; i < etfReturns.length; i++) {
      excessReturns.push(etfReturns[i] - benchmarkReturns[i]);
    }

    // Calculate standard deviation of excess returns
    const mean = excessReturns.reduce((sum, val) => sum + val, 0) / excessReturns.length;
    const variance = excessReturns.reduce((sum, val) => sum + Math.pow(val - mean, 2), 0) / excessReturns.length;
    const stdDev = Math.sqrt(variance);

    // Annualize (assuming daily returns, multiply by sqrt(252))
    return stdDev * Math.sqrt(252);
  }

  /**
   * Calculate holdings overlap between two ETFs
   * @param holdings1 First ETF's holdings (array of symbols with weights)
   * @param holdings2 Second ETF's holdings (array of symbols with weights)
   * @returns Overlap coefficient (0-1, where 1 is identical holdings)
   */
  public static calculateHoldingsOverlap(
    holdings1: Array<{ symbol: string; weight: number }>,
    holdings2: Array<{ symbol: string; weight: number }>
  ): number {
    // Create maps for quick lookup
    const map1 = new Map(holdings1.map(h => [h.symbol, h.weight]));
    const map2 = new Map(holdings2.map(h => [h.symbol, h.weight]));

    // Get all unique symbols
    const allSymbols = new Set([
      ...holdings1.map(h => h.symbol),
      ...holdings2.map(h => h.symbol)
    ]);

    // Calculate overlap using minimum weight approach
    let overlap = 0;
    for (const symbol of allSymbols) {
      const weight1 = map1.get(symbol) || 0;
      const weight2 = map2.get(symbol) || 0;
      overlap += Math.min(weight1, weight2);
    }

    return overlap;
  }

  /**
   * Calculate liquidity score for an ETF
   * @param avgDailyVolume Average daily trading volume
   * @param bidAskSpread Average bid-ask spread (as percentage of price)
   * @param aum Assets under management
   * @returns Liquidity score (0-100, higher is better)
   */
  public static calculateLiquidityScore(
    avgDailyVolume: number,
    bidAskSpread: number,
    aum: number
  ): number {
    // Normalize each component to 0-100 scale
    // Volume score: log scale, assuming 1M+ volume is excellent
    const volumeScore = Math.min(100, Math.log(Math.max(1, avgDailyVolume)) / Math.log(1000000) * 100);

    // Spread score: inverse relationship, lower spread is better
    // Assuming 0.01% spread is excellent, 0.5% is poor
    const spreadScore = Math.max(0, 100 - (bidAskSpread * 10000)); // Convert to bps and invert

    // AUM score: log scale, assuming $1B+ is excellent
    const aumScore = Math.min(100, Math.log(Math.max(1, aum)) / Math.log(1000000000) * 100);

    // Weighted average (volume and spread are more important for trading)
    return volumeScore * 0.4 + spreadScore * 0.4 + aumScore * 0.2;
  }

  /**
   * Calculate tax efficiency score for India vs US ETFs
   * @param etf ETF information
   * @param holdingPeriodYears Expected holding period in years
   * @returns Tax efficiency score (0-100, higher is more tax efficient)
   */
  public static calculateTaxEfficiencyScore(
    etf: ETFInfo,
    _holdingPeriodYears: number = 3
  ): number {
    // India-specific tax considerations
    if (etf.sym.endsWith('.NS') || etf.sym.endsWith('.BO')) {
      // Equity ETFs in India: LTCG > 1 year @ 10% (without indexation) or 20% (with indexation)
      // STCG < 1 year @ 15%
      // Dividends: 10% DDT + applicable surcharge

      // For simplicity, assuming equity ETF with long-term holding
      const ltcgRate = 0.10; // 10% LTCG
      // STCG @ 15% — reserved for tax calculation extension
      const dividendTaxRate = 0.10; // 10% dividend distribution tax

      // Assuming 60% capital gains, 40% dividends return composition
      const effectiveTaxRate = 0.6 * ltcgRate + 0.4 * dividendTaxRate;
      return Math.max(0, 100 - (effectiveTaxRate * 100));
    } else {
      // US ETF tax considerations
      // Qualified dividends: 0-20% based on income bracket
      // Non-qualified dividends: ordinary income rates
      // LTCG: 0-20% based on income bracket
      // STCG: ordinary income rates

      // Assuming qualified dividends and long-term holdings for tax efficiency
      const qualifiedDividendTax = 0.15; // Middle bracket
      const ltcgTax = 0.15; // Middle bracket
      const effectiveTaxRate = 0.4 * qualifiedDividendTax + 0.6 * ltcgTax;
      return Math.max(0, 100 - (effectiveTaxRate * 100));
    }
  }

  /**
   * Calculate factor exposure scores
   * @param etf ETF information
   * @returns Object with factor exposure scores (0-100 scale)
   */
  public static calculateFactorExposures(etf: ETFInfo): Record<string, number> {
    const exposures: Record<string, number> = {
      size: 50,      // Market cap tilt (0=mega cap, 100=micro cap)
      value: 50,     // Value vs growth tilt
      momentum: 50,  // Momentum factor
      quality: 50,   // Quality factor (profitability, low debt)
      lowVol: 50,    // Low volatility factor
      dividend: 50   // Dividend yield focus
    };

    // Adjust based on category and CAGR
    switch (etf.cat) {
      case 'Next 50':
        exposures.size = 70;      // Mid-small cap focus
        exposures.momentum = 60;  // Growth-oriented
        break;
      case 'Smart Beta':
        if (etf.sym === 'MOMOMENTUM') {
          exposures.momentum = 85; // Explicit momentum focus
          exposures.value = 30;    // Lower value
        }
        break;
      case 'Growth':
        exposures.momentum = 75;
        exposures.value = 25;      // Growth over value
        exposures.quality = 60;    // Quality growth
        break;
      case 'Tech':
      case 'Broad Tech':
      case 'Tech Alpha':
        exposures.size = 40;       // Large/mega cap tech
        exposures.momentum = 70;   // Tech momentum
        exposures.quality = 75;    // Quality tech companies
        break;
      case 'US Tech':
      case 'US Finance':
      case 'US Energy':
      case 'US Healthcare':
      case 'US Industrial':
        exposures.size = 50;       // Sector-neutral within US
        break;
      case 'IN IT':
      case 'IN Finance':
      case 'IN Pharma':
        exposures.size = 50;       // Sector-neutral within India
        break;
    }

    // Adjust based on volatility (maxDD)
    if (etf.maxDD < 25) {
      exposures.lowVol = 80;       // Low volatility focus
    } else if (etf.maxDD > 40) {
      exposures.lowVol = 20;       // High volatility
    }

    // Adjust based on CAGR (higher CAGR might indicate momentum/growth)
    if (etf.cagr > 25) {
      exposures.momentum = Math.min(90, exposures.momentum + 15);
      exposures.value = Math.max(10, exposures.value - 10);
    } else if (etf.cagr < 15) {
      exposures.value = Math.min(90, exposures.value + 15);
      exposures.momentum = Math.max(10, exposures.momentum - 10);
    }

    // Ensure all values are in 0-100 range
    for (const key in exposures) {
      exposures[key] = Math.max(0, Math.min(100, exposures[key]));
    }

    return exposures;
  }

  /**
   * Comprehensive ETF analysis
   * @param etf ETF to analyze
   * @param livePrices Current price data
   * @param historicalData Optional historical returns for tracking error calculation
   * @param benchmarkReturns Optional benchmark returns for tracking error
   * @returns Detailed ETF analytics report
   */
  public static analyzeETF(
    etf: ETFInfo,
    _livePrices: Record<string, PriceData>,
    historicalData?: number[][],
    benchmarkReturns?: number[]
  ): {
    symbol: string;
    name: string;
    trackingError?: number;
    liquidityScore: number;
    taxEfficiencyScore: number;
    factorExposures: Record<string, number>;
    holdingPeriodRecommendation: string;
    overallScore: number;
  } {
    // Calculate tracking error if historical data provided
    let trackingError: number | undefined;
    if (historicalData && benchmarkReturns && historicalData.length > 0) {
      // Assuming first column is the ETF returns
      const etfReturns = historicalData.map(row => row[0] || 0);
      trackingError = this.calculateTrackingError(etfReturns, benchmarkReturns);
    }

    // Estimate liquidity score (simplified - would need real bid/ask and volume data)
    const volumeScore = etf.vol === 'High' ? 80 : etf.vol === 'Moderate' ? 50 : 30;
    const spreadScore = etf.vol === 'High' ? 70 : etf.vol === 'Moderate' ? 50 : 30; // Inverse relationship
    const aumScore = etf.aum.includes('B') || etf.aum.includes('k Cr') ?
      (etf.aum.includes('B') ? 90 : etf.aum.includes('k Cr') && parseFloat(etf.aum) > 10 ? 70 : 40) : 20;
    const liquidityScore = (volumeScore * 0.4 + spreadScore * 0.4 + aumScore * 0.2);

    // Calculate tax efficiency score
    const taxEfficiencyScore = this.calculateTaxEfficiencyScore(etf);

    // Calculate factor exposures
    const factorExposures = this.calculateFactorExposures(etf);

    // Holding period recommendation based on maxDD and CAGR
    let holdingPeriodRecommendation: string;
    if (etf.maxDD < 25 && etf.cagr > 20) {
      holdingPeriodRecommendation = 'Long-term (3+ years) - Low volatility, high growth';
    } else if (etf.maxDD > 40) {
      holdingPeriodRecommendation = 'Medium-term (1-3 years) - High volatility, consider SIP';
    } else {
      holdingPeriodRecommendation = 'Medium to Long-term (2+ years) - Balanced profile';
    }

    // Calculate overall score (weighted combination)
    const teScore = trackingError !== undefined ?
      Math.max(0, 100 - (trackingError * 10)) : // Lower tracking error is better
      80; // Default if no tracking error data
    const overallScore = (
      teScore * 0.25 +
      liquidityScore * 0.25 +
      taxEfficiencyScore * 0.25 +
      // Average of factor exposures (assuming balanced is good)
      Object.values(factorExposures).reduce((sum, val) => sum + val, 0) / Object.values(factorExposures).length * 0.25
    );

    return {
      symbol: etf.sym,
      name: etf.name,
      trackingError,
      liquidityScore,
      taxEfficiencyScore,
      factorExposures,
      holdingPeriodRecommendation,
      overallScore: Math.round(overallScore)
    };
  }

  /**
   * Compare multiple ETFs for portfolio construction
   * @param etfs Array of ETFs to compare
   * @param livePrices Current price data
   * @returns Comparison matrix and recommendations
   */
  public static compareETFs(
    etfs: ETFInfo[],
    livePrices: Record<string, PriceData>
  ): {
    comparison: Array<{
      symbol: string;
      name: string;
      overallScore: number;
      liquidityScore: number;
      taxEfficiencyScore: number;
      trackingError?: number;
    }>;
    recommendations: {
      bestForLiquidity: string;
      bestForTaxEfficiency: string;
      bestOverall: string;
      lowestTrackingError: string | undefined;
    };
  } {
    const analysis: Array<{
      symbol: string;
      name: string;
      overallScore: number;
      liquidityScore: number;
      taxEfficiencyScore: number;
      trackingError?: number;
    }> = [];

    etfs.forEach(etf => {
      const result = this.analyzeETF(etf, livePrices);
      analysis.push({
        symbol: etf.sym,
        name: etf.name,
        overallScore: result.overallScore,
        liquidityScore: result.liquidityScore,
        taxEfficiencyScore: result.taxEfficiencyScore,
        trackingError: result.trackingError
      });
    });

    // Find best in each category
    const bestForLiquidity = analysis.reduce((best, current) =>
      current.liquidityScore > best.liquidityScore ? current : best
    ).symbol;

    const bestForTaxEfficiency = analysis.reduce((best, current) =>
      current.taxEfficiencyScore > best.taxEfficiencyScore ? current : best
    ).symbol;

    const bestOverall = analysis.reduce((best, current) =>
      current.overallScore > best.overallScore ? current : best
    ).symbol;

    const lowestTrackingError = analysis
      .filter(item => item.trackingError !== undefined)
      .reduce((best, current) =>
        (current.trackingError || 100) < (best.trackingError || 100) ? current : best
      )?.symbol;

    return {
      comparison: analysis,
      recommendations: {
        bestForLiquidity,
        bestForTaxEfficiency,
        bestOverall,
        lowestTrackingError
      }
    };
  }
}