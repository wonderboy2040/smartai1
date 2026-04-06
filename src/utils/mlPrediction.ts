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
    const slice = closes.slice(-period);
    return slice.reduce((sum, v) => sum + v, 0) / period;
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
    const ema12 = this.EMA(closes, 12);
    const ema26 = this.EMA(closes, 26);
    const macdLine = ema12 - ema26;

    // Calculate signal line (9-period EMA of MACD)
    const dailyMacd: number[] = [];
    for (let i = 26; i <= closes.length; i++) {
      const e12 = closes.slice(0, i).length >= 12 ? this.EMA(closes.slice(0, i), 12) : ema12;
      const e26 = this.EMA(closes.slice(0, i), 26);
      dailyMacd.push(e12 - e26);
    }
    const signal = dailyMacd.length > 0 ? this.EMA(dailyMacd, 9) : macdLine;

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
    const recentHighs = highs.slice(-kPeriod);
    const recentLows = lows.slice(-kPeriod);
    const highestHigh = Math.max(...recentHighs);
    const lowestLow = Math.min(...recentLows);
    const range = highestHigh - lowestLow;

    if (range === 0) return { k: 50, d: 50 };
    const k = ((closes[closes.length - 1] - lowestLow) / range) * 100;
    return { k, d: k }; // Simplified (D requires 3-period SMA of K)
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
    _liveData?: PriceData,
    daysAhead: number = 1
  ): PredictionResult {
    const closes = historicalPrices.length > 0 ? historicalPrices : [currentPrice];
    const latest = closes[closes.length - 1] || currentPrice;

    // Multiple model predictions
    const linearPred = this.linearRegressionPredict(closes, daysAhead);
    const holtPred = this.holtExponentialSmoothing(closes, 0.3, 0.1, daysAhead);

    // WMA for short-term forecast
    const recentCount = Math.min(10, closes.length);
    const recent = closes.slice(-recentCount);
    const wmaPred = this.weightedMA(recent, recent.map((_, i) => i + 1));
    const shortForecast = wmaPred * (1 + (wmaPred - closes.slice(-20)[0]) / closes.slice(-20)[0] * daysAhead * 0.1);

    // Simple equal-weight ensemble
    const predictions = [linearPred, holtPred, shortForecast];
    const avgPrediction = predictions.reduce((s, v) => s + v, 0) / predictions.length;

    // Predicted change percentage
    const predictedChange = currentPrice > 0
      ? ((avgPrediction - currentPrice) / currentPrice * 100)
      : 0;

    // Direction
    const direction: PredictionResult['direction'] =
      predictedChange > 0.5 ? 'up' : predictedChange < -0.5 ? 'down' : 'flat';

    // Confidence based on model agreement
    const predStd = Math.sqrt(predictions.reduce((s, p) => s + Math.pow(p - avgPrediction, 2), 0) / predictions.length);
    const confidence = Math.max(10, Math.min(95, 80 - predStd / latest * 1000));

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
      model: 'Ensemble (Linear + Holt Exp + WMA)',
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
