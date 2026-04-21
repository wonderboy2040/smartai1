// ML Prediction Engine
// Lightweight implementations of time-series prediction models
// Works client-side without external ML libraries

import { PriceData } from '../types';

// ========================================
// TECHNICAL INDICATOR CALCULATOR
// ========================================

export class TechnicalIndicators {
  /**
   * Calculate RSI from price series
   */
  static RSI(closes: number[], period: number = 14): number {
    if (closes.length < period + 1) return 50;
    const changes = [];
    for (let i = 1; i < closes.length; i++) {
      changes.push(closes[i] - closes[i - 1]);
    }
    let avgGain = 0, avgLoss = 0;
    for (let i = 0; i < period; i++) {
      if (changes[i] > 0) avgGain += changes[i];
      else avgLoss += Math.abs(changes[i]);
    }
    avgGain /= period;
    avgLoss /= period;
    for (let i = period; i < changes.length; i++) {
      const change = changes[i];
      avgGain = (avgGain * (period - 1) + (change > 0 ? change : 0)) / period;
      avgLoss = (avgLoss * (period - 1) + (change > 0 ? 0 : Math.abs(change))) / period;
    }
    if (avgLoss === 0) return 100;
    const rs = avgGain / avgLoss;
    return 100 - (100 / (1 + rs));
  }

  /**
   * Moving Average (Simple)
   */
  static SMA(closes: number[], period: number): number {
    if (closes.length < period) return closes[closes.length - 1] || 0;
    let sum = 0;
    for (let i = closes.length - period; i < closes.length; i++) {
      sum += closes[i];
    }
    return sum / period;
  }

  /**
   * Exponential Moving Average
   */
  static EMA(closes: number[], period: number): number {
    if (closes.length === 0) return 0;
    const k = 2 / (period + 1);
    let ema = closes[0];
    for (let i = 1; i < closes.length; i++) {
      ema = closes[i] * k + ema * (1 - k);
    }
    return ema;
  }

  /**
   * MACD (Moving Average Convergence Divergence)
   */
  static MACD(closes: number[]): { macd: number; signal: number; histogram: number } {
    if (closes.length < 26) return { macd: 0, signal: 0, histogram: 0 };

    const ema12 = this.EMA(closes, 12);
    const ema26 = this.EMA(closes, 26);
    const macdLine = ema12 - ema26;

    // Calculate signal line (9-period EMA of MACD)
    const dailyMacd: number[] = [];

    // Optimization: Use a running EMA approach instead of slice-and-recalculate
    let currentEma12 = this.EMA(closes.slice(0, 26), 12);
    let currentEma26 = this.EMA(closes.slice(0, 26), 26);
    dailyMacd.push(currentEma12 - currentEma26);

    const k12 = 2 / (12 + 1);
    const k26 = 2 / (26 + 1);

    for (let i = 26; i < closes.length; i++) {
      currentEma12 = closes[i] * k12 + currentEma12 * (1 - k12);
      currentEma26 = closes[i] * k26 + currentEma26 * (1 - k26);
      dailyMacd.push(currentEma12 - currentEma26);
    }

    const signal = this.EMA(dailyMacd, 9);

    return { macd: macdLine, signal, histogram: macdLine - signal };
  }

  /**
   * Bollinger Bands
   */
  static BollingerBands(closes: number[], period: number = 20, stdDev: number = 2): { upper: number; middle: number; lower: number } {
    const sma = this.SMA(closes, period);
    const slice = closes.slice(-period);
    const variance = slice.reduce((sum, v) => sum + Math.pow(v - sma, 2), 0) / period;
    const std = Math.sqrt(variance);

    return {
      upper: sma + stdDev * std,
      middle: sma,
      lower: sma - stdDev * std
    };
  }

  /**
   * Average True Range (volatility indicator)
   */
  static ATR(highs: number[], lows: number[], closes: number[], period: number = 14): number {
    const trueRanges: number[] = [];
    for (let i = 0; i < closes.length - 1; i++) {
      const h = highs[i + 1], l = lows[i + 1], pc = closes[i];
      const tr = Math.max(h - l, Math.abs(h - pc), Math.abs(l - pc));
      trueRanges.push(tr);
    }
    const recent = trueRanges.slice(-period);
    return recent.reduce((s, v) => s + v, 0) / recent.length;
  }

  /**
   * Stochastic Oscillator
   */
  static Stochastic(closes: number[], highs: number[], lows: number[], kPeriod: number = 14): { k: number; d: number } {
    if (closes.length < kPeriod + 3) return { k: 50, d: 50 };

    const kValues: number[] = [];
    for (let i = 0; i < 3; i++) {
      const endIdx = closes.length - i;
      const sliceH = highs.slice(Math.max(0, endIdx - kPeriod), endIdx);
      const sliceL = lows.slice(Math.max(0, endIdx - kPeriod), endIdx);
      const highestHigh = Math.max(...sliceH);
      const lowestLow = Math.min(...sliceL);
      const range = highestHigh - lowestLow;

      if (range === 0) {
        kValues.push(50);
      } else {
        kValues.push(((closes[endIdx - 1] - lowestLow) / range) * 100);
      }
    }

    const k = kValues[0];
    const d = kValues.reduce((s, v) => s + v, 0) / kValues.length;
    return { k, d };
  }

  /**
   * On-Balance Volume (OBV)
   */
  static OBV(closes: number[], volumes: number[]): number {
    let obv = 0;
    for (let i = 1; i < closes.length; i++) {
      if (closes[i] > closes[i - 1]) obv += volumes[i] || 0;
      else if (closes[i] < closes[i - 1]) obv -= volumes[i] || 0;
    }
    return obv;
  }
}

// ========================================
// PRICE PREDICTION ENGINE
// ========================================

export interface PredictionResult {
  predictedPrice: number;
  predictedChange: number;
  confidence: number;
  direction: 'up' | 'down' | 'flat';
  timeframe: '1d' | '3d' | '7d' | '14d';
  model: string;
  supportLevel: number;
  resistanceLevel: number;
  indicators: Record<string, number>;
}

export class PredictionEngine {
  /**
   * Linear Regression prediction (simple trend line)
   */
  private static linearRegressionPredict(
    data: number[],
    forecastSteps: number = 1
  ): number {
    const n = data.length;
    if (n < 5) return data[n - 1] || 0;

    // Simple linear regression: y = mx + c
    let sumX = 0, sumY = 0, sumXY = 0, sumXX = 0;
    for (let i = 0; i < n; i++) {
      sumX += i;
      sumY += data[i];
      sumXY += i * data[i];
      sumXX += i * i;
    }

    const slope = (n * sumXY - sumX * sumY) / (n * sumXX - sumX * sumX);
    const intercept = (sumY - slope * sumX) / n;

    return slope * (n + forecastSteps - 1) + intercept;
  }

  /**
   * Exponential Smoothing (Holt's Method)
   */
  private static holtExponentialSmoothing(
    data: number[],
    alpha: number = 0.3,
    beta: number = 0.1,
    steps: number = 1
  ): number {
    if (data.length < 2) return data[0] || 0;

    let level = data[0];
    let trend = data[1] - data[0];

    for (let i = 1; i < data.length; i++) {
      const lastLevel = level;
      level = alpha * data[i] + (1 - alpha) * (level + trend);
      trend = beta * (level - lastLevel) + (1 - beta) * trend;
    }

    return level + steps * trend;
  }

  /**
   * Weighted Moving Average (recent data weighted more)
   */
  private static weightedMA(data: number[], weights: number[]): number {
    if (data.length === 0) return 0;
    const w = weights.length === data.length ? weights : data.map((_, i) => i + 1);
    const sumW = w.reduce((s, v) => s + v, 0);
    return data.reduce((sum, v, i) => sum + v * w[i], 0) / sumW;
  }

  /**
   * Ensemble prediction combining multiple models
   * Weights models based on recent accuracy
   */
  static predictPrice(
    historicalPrices: number[],
    currentPrice: number,
    daysAhead: number = 1
  ): PredictionResult {
    const closes = historicalPrices.length > 0 ? historicalPrices : [currentPrice];
    const latest = closes[closes.length - 1] || currentPrice;

    // Model 1: Linear Regression ( captures long-term linear trend)
    const linearPred = this.linearRegressionPredict(closes, daysAhead);

    // Model 2: Holt Exponential Smoothing ( captures trend and level)
    const holtPred = this.holtExponentialSmoothing(closes, 0.3, 0.1, daysAhead);

    // Model 3: WMA-based short-term momentum forecast
    const recentCount = Math.min(10, closes.length);
    const recent = closes.slice(-recentCount);
    const wmaPred = this.weightedMA(recent, recent.map((_, i) => i + 1));

    const lookback20 = closes.slice(-20);
    const basePrice = lookback20.length > 0 ? lookback20[0] : latest;
    const shortForecast = wmaPred * (1 + (wmaPred - basePrice) / basePrice * daysAhead * 0.1);

    // ADVANCED: Adaptive Weighting based on Regime
    // If the market is strongly trending, weight Linear/Holt more.
    // If sideways, weight WMA/Short-term more.
    let weights = { linear: 0.33, holt: 0.33, short: 0.34 };

    if (closes.length >= 20) {
      const regime = detectRegime(closes);
      if (regime.regime === 'STRONG_BULL' || regime.regime === 'STRONG_BEAR') {
        weights = { linear: 0.4, holt: 0.4, short: 0.2 };
      } else if (regime.regime === 'SIDEWAYS') {
        weights = { linear: 0.2, holt: 0.2, short: 0.6 };
      }
    }

    const avgPrediction = (linearPred * weights.linear) + (holtPred * weights.holt) + (shortForecast * weights.short);

    // Predicted change percentage
    const predictedChange = currentPrice > 0
      ? ((avgPrediction - currentPrice) / currentPrice * 100)
      : 0;

    // Direction
    const direction: PredictionResult['direction'] =
      predictedChange > 0.5 ? 'up' : predictedChange < -0.5 ? 'down' : 'flat';

    // Confidence based on model agreement and regime confidence
    const predictions = [linearPred, holtPred, shortForecast];
    const predStd = Math.sqrt(predictions.reduce((s, p) => s + Math.pow(p - avgPrediction, 2), 0) / predictions.length);

    let baseConfidence = 80 - predStd / latest * 1000;
    if (closes.length >= 20) {
      const regime = detectRegime(closes);
      baseConfidence = (baseConfidence * 0.7) + (regime.confidence * 0.3);
    }
    const confidence = Math.max(10, Math.min(95, baseConfidence));

    // Support / Resistance from Bollinger Bands
    const bb = TechnicalIndicators.BollingerBands(closes);
    const supportLevel = bb.lower;
    const resistanceLevel = bb.upper;

    // Collect all technical indicators
    const indicators: Record<string, number> = {};
    if (closes.length >= 26) {
      indicators.rsi = TechnicalIndicators.RSI(closes);
      indicators.sma20 = TechnicalIndicators.SMA(closes, 20);
      indicators.sma50 = TechnicalIndicators.SMA(closes, 50);
      indicators.ema12 = TechnicalIndicators.EMA(closes, 12);
      indicators.ema26 = TechnicalIndicators.EMA(closes, 26);
      const macd = TechnicalIndicators.MACD(closes);
      indicators.macd = macd.macd;
      indicators.macdSignal = macd.signal;
      indicators.macdHist = macd.histogram;
      indicators.bbUpper = bb.upper;
      indicators.bbMiddle = bb.middle;
      indicators.bbLower = bb.lower;
    }

    const timeframe: PredictionResult['timeframe'] =
      daysAhead <= 1 ? '1d' : daysAhead <= 3 ? '3d' : daysAhead <= 7 ? '7d' : '14d';

    return {
      predictedPrice: Math.round(avgPrediction * 100) / 100,
      predictedChange: Math.round(predictedChange * 100) / 100,
      confidence: Math.round(confidence),
      direction,
      timeframe,
      model: 'Adaptive Ensemble (Linear + Holt + WMA)',
      supportLevel: Math.round(supportLevel * 100) / 100,
      resistanceLevel: Math.round(resistanceLevel * 100) / 100,
      indicators
    };
  }
}

// ========================================
// ANOMALY DETECTION (for Alert System)
// ========================================

export class AnomalyDetector {
  private priceHistory: Map<string, number[]> = new Map();

  /**
   * Update price history for a symbol
   */
  update(symbol: string, price: number): void {
    const history = this.priceHistory.get(symbol) || [];
    history.push(price);
    if (history.length > 100) history.splice(0, history.length - 100);
    this.priceHistory.set(symbol, history);
  }

  /**
   * Detect if current price is anomalous (Z-score based)
   */
  isAnomalous(symbol: string, threshold: number = 2.0): { anomalous: boolean; zScore: number; reason?: string } {
    const history = this.priceHistory.get(symbol) || [];
    if (history.length < 5) return { anomalous: false, zScore: 0 };

    const mean = history.reduce((s, v) => s + v, 0) / history.length;
    const std = Math.sqrt(history.reduce((s, v) => s + Math.pow(v - mean, 2), 0) / history.length);

    if (std === 0) return { anomalous: false, zScore: 0 };

    const currentPrice = history[history.length - 1];
    const zScore = Math.abs(currentPrice - mean) / std;

    if (zScore > threshold) {
      const direction = currentPrice > mean ? 'spike' : 'dump';
      return { anomalous: true, zScore: Math.round(zScore * 100) / 100, reason: `${direction} detected: ${currentPrice.toFixed(2)} vs mean ${mean.toFixed(2)}` };
    }

    return { anomalous: false, zScore: Math.round(zScore * 100) / 100 };
  }
}

// ========================================
// MOMENTUM SCORING ENGINE
// Multi-factor momentum with RSI, MACD, volume, price velocity
// ========================================
export interface MomentumScore {
  symbol: string;
  score: number;        // 0-100
  grade: 'A+' | 'A' | 'B' | 'C' | 'D' | 'F';
  factors: {
    rsiMomentum: number;
    macdStrength: number;
    priceVelocity: number;
    volumeForce: number;
    trendAlignment: number;
  };
  signal: 'STRONG_MOMENTUM' | 'BUILDING' | 'NEUTRAL' | 'FADING' | 'REVERSAL';
}

export function calculateMomentumScore(
  rsi: number,
  macd: number | undefined,
  sma20: number | undefined,
  sma50: number | undefined,
  price: number,
  change: number,
  volume: number
): MomentumScore {
  // Factor 1: RSI Momentum (0-25)
  let rsiMomentum = 0;
  if (rsi >= 50 && rsi <= 70) rsiMomentum = 20 + (rsi - 50) * 0.25;  // Sweet spot
  else if (rsi > 70) rsiMomentum = Math.max(0, 25 - (rsi - 70) * 1.5); // Overextended
  else if (rsi >= 30 && rsi < 50) rsiMomentum = rsi * 0.3;  // Building
  else rsiMomentum = 5; // Oversold = reversal potential

  // Factor 2: MACD Strength (0-25)
  let macdStrength = 12.5;
  if (macd !== undefined) {
    macdStrength = macd > 0 ? Math.min(25, 12.5 + macd * 5) : Math.max(0, 12.5 + macd * 5);
  }

  // Factor 3: Price Velocity (0-20)
  const priceVelocity = Math.min(20, Math.max(0, 10 + change * 3));

  // Factor 4: Volume Force (0-15)
  let volumeForce = 7.5;
  if (volume > 5000000) volumeForce = 15;
  else if (volume > 1000000) volumeForce = 12;
  else if (volume > 500000) volumeForce = 10;
  else if (volume < 50000) volumeForce = 3;

  // Factor 5: Trend Alignment (0-15)
  let trendAlignment = 7.5;
  if (sma20 && sma50) {
    if (sma20 > sma50 && price > sma20) trendAlignment = 15;  // Perfect alignment
    else if (sma20 > sma50) trendAlignment = 12;
    else if (price > sma20) trendAlignment = 8;
    else if (sma50 > sma20 && price < sma50) trendAlignment = 0;  // Full bearish
    else trendAlignment = 4;
  }

  const totalScore = Math.round(rsiMomentum + macdStrength + priceVelocity + volumeForce + trendAlignment);
  const score = Math.max(0, Math.min(100, totalScore));

  let grade: MomentumScore['grade'] = 'C';
  if (score >= 85) grade = 'A+';
  else if (score >= 70) grade = 'A';
  else if (score >= 55) grade = 'B';
  else if (score >= 40) grade = 'C';
  else if (score >= 25) grade = 'D';
  else grade = 'F';

  let signal: MomentumScore['signal'] = 'NEUTRAL';
  if (score >= 75 && change > 0) signal = 'STRONG_MOMENTUM';
  else if (score >= 60) signal = 'BUILDING';
  else if (score <= 30 && change < -1) signal = 'REVERSAL';
  else if (score <= 40) signal = 'FADING';

  return {
    symbol: '',
    score,
    grade,
    factors: {
      rsiMomentum: Math.round(rsiMomentum * 10) / 10,
      macdStrength: Math.round(macdStrength * 10) / 10,
      priceVelocity: Math.round(priceVelocity * 10) / 10,
      volumeForce: Math.round(volumeForce * 10) / 10,
      trendAlignment: Math.round(trendAlignment * 10) / 10,
    },
    signal,
  };
}

// ========================================
// MEAN REVERSION SCANNER
// Z-score based mean reversion probability
// ========================================
export interface MeanReversionResult {
  symbol: string;
  zScore: number;
  probability: number;  // 0-100% chance of reverting to mean
  direction: 'OVEREXTENDED_UP' | 'OVEREXTENDED_DOWN' | 'NEAR_MEAN';
  meanPrice: number;
  currentPrice: number;
  expectedMove: number; // % expected move toward mean
}

export function scanMeanReversion(
  prices: number[],
  currentPrice: number
): Omit<MeanReversionResult, 'symbol'> | null {
  if (prices.length < 10) return null;

  const mean = prices.reduce((s, v) => s + v, 0) / prices.length;
  const std = Math.sqrt(prices.reduce((s, v) => s + Math.pow(v - mean, 2), 0) / prices.length);

  if (std === 0 || mean === 0) return null;

  const zScore = (currentPrice - mean) / std;
  const absZ = Math.abs(zScore);

  // Probability of mean reversion increases with distance from mean
  // Using simplified normal distribution CDF approximation
  const probability = Math.min(95, Math.round(absZ > 1 ? 50 + (absZ - 1) * 20 : absZ * 30));

  let direction: MeanReversionResult['direction'] = 'NEAR_MEAN';
  if (zScore > 1.5) direction = 'OVEREXTENDED_UP';
  else if (zScore < -1.5) direction = 'OVEREXTENDED_DOWN';

  const expectedMove = mean > 0 ? ((mean - currentPrice) / currentPrice) * 100 : 0;

  return {
    zScore: Math.round(zScore * 100) / 100,
    probability,
    direction,
    meanPrice: Math.round(mean * 100) / 100,
    currentPrice,
    expectedMove: Math.round(expectedMove * 100) / 100,
  };
}

// ========================================
// CORRELATION ANALYSIS
// Portfolio correlation matrix for diversification
// ========================================
export interface CorrelationPair {
  symbol1: string;
  symbol2: string;
  correlation: number;  // -1 to +1
  risk: 'HIGH_CORRELATION' | 'MODERATE' | 'DIVERSIFIED' | 'INVERSE';
}

export function calculateCorrelation(returns1: number[], returns2: number[]): number {
  const n = Math.min(returns1.length, returns2.length);
  if (n < 5) return 0;

  const r1 = returns1.slice(-n);
  const r2 = returns2.slice(-n);

  const mean1 = r1.reduce((s, v) => s + v, 0) / n;
  const mean2 = r2.reduce((s, v) => s + v, 0) / n;

  let cov = 0, var1 = 0, var2 = 0;
  for (let i = 0; i < n; i++) {
    const d1 = r1[i] - mean1;
    const d2 = r2[i] - mean2;
    cov += d1 * d2;
    var1 += d1 * d1;
    var2 += d2 * d2;
  }

  const denom = Math.sqrt(var1 * var2);
  if (denom === 0) return 0;

  return Math.round((cov / denom) * 1000) / 1000;
}

export function analyzePortfolioCorrelations(
  priceHistories: Map<string, number[]>
): CorrelationPair[] {
  const symbols = Array.from(priceHistories.keys());
  const pairs: CorrelationPair[] = [];

  // Convert prices to returns
  const returnsMap = new Map<string, number[]>();
  for (const [sym, prices] of priceHistories) {
    const returns: number[] = [];
    for (let i = 1; i < prices.length; i++) {
      returns.push(prices[i - 1] > 0 ? (prices[i] - prices[i - 1]) / prices[i - 1] : 0);
    }
    returnsMap.set(sym, returns);
  }

  for (let i = 0; i < symbols.length; i++) {
    for (let j = i + 1; j < symbols.length; j++) {
      const r1 = returnsMap.get(symbols[i]) || [];
      const r2 = returnsMap.get(symbols[j]) || [];
      const corr = calculateCorrelation(r1, r2);

      let risk: CorrelationPair['risk'] = 'MODERATE';
      if (corr > 0.8) risk = 'HIGH_CORRELATION';
      else if (corr < -0.3) risk = 'INVERSE';
      else if (corr < 0.4) risk = 'DIVERSIFIED';

      pairs.push({
        symbol1: symbols[i],
        symbol2: symbols[j],
        correlation: corr,
        risk,
      });
    }
  }

  return pairs.sort((a, b) => Math.abs(b.correlation) - Math.abs(a.correlation));
}

// ========================================
// MARKET REGIME DETECTOR
// HMM-inspired regime classifier (bull/bear/sideways)
// ========================================
export type MarketRegime = 'STRONG_BULL' | 'BULL' | 'SIDEWAYS' | 'BEAR' | 'STRONG_BEAR' | 'TRANSITION';

export interface RegimeResult {
  regime: MarketRegime;
  confidence: number;     // 0-100
  duration: number;       // estimated regime duration in ticks
  volatilityState: 'LOW' | 'NORMAL' | 'HIGH' | 'EXTREME';
  trendStrength: number;  // 0-100
}

export function detectRegime(
  prices: number[],
  vix: number = 15
): RegimeResult {
  if (prices.length < 20) {
    return { regime: 'SIDEWAYS', confidence: 30, duration: 0, volatilityState: 'NORMAL', trendStrength: 0 };
  }

  // Calculate returns
  const returns: number[] = [];
  for (let i = 1; i < prices.length; i++) {
    returns.push(prices[i - 1] > 0 ? (prices[i] - prices[i - 1]) / prices[i - 1] * 100 : 0);
  }

  const recentReturns = returns.slice(-20);
  const meanReturn = recentReturns.reduce((s, v) => s + v, 0) / recentReturns.length;
  const volatility = Math.sqrt(recentReturns.reduce((s, v) => s + Math.pow(v - meanReturn, 2), 0) / recentReturns.length);

  // Short-term vs long-term trend
  const shortPrices = prices.slice(-5);
  const longPrices = prices.slice(-20);
  const shortMean = shortPrices.reduce((s, v) => s + v, 0) / shortPrices.length;
  const longMean = longPrices.reduce((s, v) => s + v, 0) / longPrices.length;
  const trendDiff = longMean > 0 ? ((shortMean - longMean) / longMean) * 100 : 0;

  // Count consecutive moves
  let posCount = 0, negCount = 0;
  for (const r of recentReturns.slice(-10)) {
    if (r > 0) posCount++;
    else negCount++;
  }

  // Regime classification
  let regime: MarketRegime = 'SIDEWAYS';
  let confidence = 50;
  let trendStrength = 50;

  if (meanReturn > 0.5 && trendDiff > 2 && posCount >= 7) {
    regime = 'STRONG_BULL'; confidence = 85; trendStrength = 90;
  } else if (meanReturn > 0.2 && trendDiff > 0.5 && posCount >= 6) {
    regime = 'BULL'; confidence = 70; trendStrength = 70;
  } else if (meanReturn < -0.5 && trendDiff < -2 && negCount >= 7) {
    regime = 'STRONG_BEAR'; confidence = 85; trendStrength = 90;
  } else if (meanReturn < -0.2 && trendDiff < -0.5 && negCount >= 6) {
    regime = 'BEAR'; confidence = 70; trendStrength = 70;
  } else if (volatility > 2) {
    regime = 'TRANSITION'; confidence = 45; trendStrength = 30;
  } else {
    regime = 'SIDEWAYS'; confidence = 60; trendStrength = 20;
  }

  // Volatility state from VIX
  let volatilityState: RegimeResult['volatilityState'] = 'NORMAL';
  if (vix > 30) volatilityState = 'EXTREME';
  else if (vix > 22) volatilityState = 'HIGH';
  else if (vix < 12) volatilityState = 'LOW';

  // Duration estimate (how long since regime started)
  let duration = 0;
  const isCurrentlyBullish = meanReturn > 0;
  for (let i = recentReturns.length - 1; i >= 0; i--) {
    if ((isCurrentlyBullish && recentReturns[i] > -0.3) || (!isCurrentlyBullish && recentReturns[i] < 0.3)) {
      duration++;
    } else break;
  }

  return { regime, confidence, duration, volatilityState, trendStrength };
}
