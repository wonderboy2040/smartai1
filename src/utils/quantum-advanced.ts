// Deep Advance Pro Quantum AI - Advanced Prediction Engine
// Multi-model ensemble with LSTM, Transformer, and XGBoost simulations

import { PriceData } from '../types';

export interface QuantumPrediction {
  symbol: string;
  predictedPrice: number;
  confidence: number;
  timeframe: '1h' | '4h' | '1d' | '3d' | '7d';
  direction: 'STRONG_BUY' | 'BUY' | 'HOLD' | 'SELL' | 'STRONG_SELL';
  models: {
    lstm: number;
    transformer: number;
    xgboost: number;
    ensemble: number;
  };
  supportLevels: number[];
  resistanceLevels: number[];
  fibLevels: {
    level_0: number;
    level_236: number;
    level_382: number;
    level_500: number;
    level_618: number;
    level_786: number;
    level_1000: number;
  };
  priceTargets: {
    target1: number;
    target2: number;
    target3: number;
  };
  riskReward: number;
  winProbability: number;
  expectedMove: number;
}

export class QuantumPredictor {
  private priceHistory: Map<string, number[]> = new Map();
  private volumeHistory: Map<string, number[]> = new Map();

  updateHistory(symbol: string, price: number, volume?: number): void {
    const prices = this.priceHistory.get(symbol) || [];
    prices.push(price);
    if (prices.length > 200) prices.shift();
    this.priceHistory.set(symbol, prices);

    if (volume) {
      const volumes = this.volumeHistory.get(symbol) || [];
      volumes.push(volume);
      if (volumes.length > 200) volumes.shift();
      this.volumeHistory.set(symbol, volumes);
    }
  }

  private lstmPredict(prices: number[]): number {
    if (prices.length < 20) return prices[prices.length - 1] || 0;
    
    const recent = prices.slice(-20);
    const weights = [0.4, 0.3, 0.2, 0.1];
    let prediction = 0;
    
    for (let i = 0; i < 4; i++) {
      const slice = recent.slice(-5 * (i + 1));
      const avg = slice.reduce((s, v) => s + v, 0) / slice.length;
      prediction += avg * weights[i];
    }
    
    const trend = prices[prices.length - 1] - prices[prices.length - 10];
    return prediction + trend * 0.1;
  }

  private transformerPredict(prices: number[]): number {
    if (prices.length < 50) return prices[prices.length - 1] || 0;
    
    const attention = prices.map((_, i) => {
      const weight = Math.exp((i - prices.length) / 20);
      return weight;
    });
    
    const totalWeight = attention.reduce((s, v) => s + v, 0);
    const weightedSum = prices.reduce((sum, price, i) => sum + price * attention[i], 0);
    
    return weightedSum / totalWeight;
  }

  private xgboostPredict(prices: number[]): number {
    if (prices.length < 10) return prices[prices.length - 1] || 0;
    
    const features = [];
    for (let i = 10; i < prices.length; i++) {
      const slice = prices.slice(i - 10, i);
      const mean = slice.reduce((s, v) => s + v, 0) / 10;
      const variance = slice.reduce((s, v) => s + Math.pow(v - mean, 2), 0) / 10;
      const std = Math.sqrt(variance);
      const trend = (prices[i] - prices[i - 10]) / prices[i - 10];
      features.push({ mean, std, trend });
    }
    
    if (features.length === 0) return prices[prices.length - 1];
    
    const lastFeature = features[features.length - 1];
    const prediction = lastFeature.mean * (1 + lastFeature.trend * 0.5);
    
    return prediction;
  }

  private calculateFibLevels(prices: number[]): QuantumPrediction['fibLevels'] {
    const high = Math.max(...prices);
    const low = Math.min(...prices);
    const range = high - low;
    
    return {
      level_0: low,
      level_236: low + range * 0.236,
      level_382: low + range * 0.382,
      level_500: low + range * 0.5,
      level_618: low + range * 0.618,
      level_786: low + range * 0.786,
      level_1000: high
    };
  }

  private calculateSupportResistance(prices: number[]): { support: number[]; resistance: number[] } {
    if (prices.length < 20) {
      return { support: [prices[0]], resistance: [prices[prices.length - 1]] };
    }

    const recent = prices.slice(-50);
    const localMaxs: number[] = [];
    const localMins: number[] = [];

    for (let i = 5; i < recent.length - 5; i++) {
      const slice = recent.slice(i - 5, i + 5);
      if (recent[i] === Math.max(...slice)) {
        localMaxs.push(recent[i]);
      }
      if (recent[i] === Math.min(...slice)) {
        localMins.push(recent[i]);
      }
    }

    const resistance = localMaxs.length > 0 ? 
      [localMaxs[localMaxs.length - 1], localMaxs[localMaxs.length - 2] || localMaxs[localMaxs.length - 1] * 1.02] : 
      [recent[recent.length - 1] * 1.02];
      
    const support = localMins.length > 0 ?
      [localMins[localMins.length - 1], localMins[localMins.length - 2] || localMins[localMins.length - 1] * 0.98] :
      [recent[recent.length - 1] * 0.98];

    return { support, resistance };
  }

  predict(symbol: string, currentPrice: number, _liveData?: PriceData): QuantumPrediction {
    const prices = this.priceHistory.get(symbol) || [currentPrice];
    if (prices.length < 10) {
      prices.push(currentPrice);
      this.priceHistory.set(symbol, prices);
    }

    const lstmPred = this.lstmPredict(prices);
    const transformerPred = this.transformerPredict(prices);
    const xgboostPred = this.xgboostPredict(prices);
    
    const weights = { lstm: 0.4, transformer: 0.35, xgboost: 0.3 };
    const ensemble = lstmPred * weights.lstm + transformerPred * weights.transformer + xgboostPred * weights.xgboost;

    const fibLevels = this.calculateFibLevels(prices);
    const { support, resistance } = this.calculateSupportResistance(prices);
    
    const atr = this.calculateATR(prices);
    const target1 = currentPrice + atr * 1.5;
    const target2 = currentPrice + atr * 2.5;
    const target3 = currentPrice + atr * 4;

    const changePred = (ensemble - currentPrice) / currentPrice * 100;
    let direction: QuantumPrediction['direction'] = 'HOLD';
    if (changePred > 2) direction = 'STRONG_BUY';
    else if (changePred > 0.5) direction = 'BUY';
    else if (changePred < -2) direction = 'STRONG_SELL';
    else if (changePred < -0.5) direction = 'SELL';

    const risk = currentPrice - support[0];
    const reward = resistance[0] - currentPrice;
    const riskReward = risk > 0 ? reward / risk : 0;
    const winProbability = Math.min(95, Math.max(5, 50 + changePred * 10));

    return {
      symbol,
      predictedPrice: Math.round(ensemble * 100) / 100,
      confidence: Math.round(winProbability),
      timeframe: '1d',
    direction,
    direction,
      models {
        lstm: Math.round(lstmPred * 100) / 100,
        transformer: Math.round(transformerPred * 100) / 100,
        xgboost: Math.round(xgboostPred * 100) / 100,
        ensemble: Math.round(ensemble * 100) / 100
      },
      supportLevels: support.map(s => Math.round(s * 100) / 100),
      resistanceLevels: resistance.map(r => Math.round(r * 100) / 100),
      fibLevels: {
        level_0: Math.round(fibLevels.level_0 * 100) / 100,
        level_236: Math.round(fibLevels.level_236 * 100) / 100,
        level_382: Math.round(fibLevels.level_382 * 100) / 100,
        level_500: Math.round(fibLevels.level_500 * 100) / 100,
        level_618: Math.round(fibLevels.level_618 * 100) / 100,
        level_786: Math.round(fibLevels.level_786 * 100) / 100,
        level_1000: Math.round(fibLevels.level_1000 * 100) / 100
      },
      priceTargets: {
        target1: Math.round(target1 * 100) / 100,
        target2: Math.round(target2 * 100) / 100,
        target3: Math.round(target3 * 100) / 100
      },
      riskReward: Math.round(riskReward * 100) / 100,
      winProbability: Math.round(winProbability * 100) / 100,
      expectedMove: Math.round(Math.abs(changePred) * 100) / 100
    };
  }

  private calculateATR(prices: number[]): number {
    if (prices.length < 14) return prices.length > 0 ? prices[0] * 0.02 : 0;
    
    let atr = 0;
    for (let i = 1; i < Math.min(15, prices.length); i++) {
      atr += Math.abs(prices[i] - prices[i - 1]);
    }
    return atr / 14;
  }
}

export interface EntanglementMap {
  symbol: string;
  correlations: { [key: string]: number };
  leadingIndicators: string[];
  laggingIndicators: string[];
  entanglementStrength: 'STRONG' | 'MODERATE' | 'WEAK';
}

export class QuantumEntanglementAnalyzer {
  private priceHistories: Map<string, number[]> = new Map();

  updatePrice(symbol: string, price: number): void {
    const prices = this.priceHistories.get(symbol) || [];
    prices.push(price);
    if (prices.length > 100) prices.shift();
    this.priceHistories.set(symbol, prices);
  }

  analyzeEntanglement(symbol: string, allSymbols: string[]): EntanglementMap {
    const correlations: { [key: string]: number } = {};
    const leading: string[] = [];
    const lagging: string[] = [];

    const symbolPrices = this.priceHistories.get(symbol) || [];
    if (symbolPrices.length < 20) {
      return { symbol, correlations: {}, leadingIndicators: [], laggingIndicators: [], entanglementStrength: 'WEAK' };
    }

    for (const otherSymbol of allSymbols) {
      if (otherSymbol === symbol) continue;
      
      const otherPrices = this.priceHistories.get(otherSymbol) || [];
      if (otherPrices.length < 20) continue;

      const minLen = Math.min(symbolPrices.length, otherPrices.length);
      const returns1: number[] = [];
      const returns2: number[] = [];

      for (let i = 1; i < minLen; i++) {
        returns1.push((symbolPrices[i] - symbolPrices[i - 1]) / symbolPrices[i - 1]);
        returns2.push((otherPrices[i] - otherPrices[i - 1]) / otherPrices[i - 1]);
      }

      const correlation = this.calculateCorrelation(returns1, returns2);
      correlations[otherSymbol] = Math.round(correlation * 1000) / 1000;

      if (Math.abs(correlation) > 0.7) {
        if (correlation > 0.8) leading.push(otherSymbol);
        else if (correlation < -0.5) lagging.push(otherSymbol);
      }
    }

    const strongCorrelations = Object.values(correlations).filter(c => Math.abs(c) > 0.7);
    const entanglementStrength = strongCorrelations.length > 3 ? 'STRONG' : strongCorrelations.length > 1 ? 'MODERATE' : 'WEAK';

    return { symbol, correlations, leadingIndicators: leading, laggingIndicators: lagging, entanglementStrength };
  }

  private calculateCorrelation(x: number[], y: number[]): number {
    const n = Math.min(x.length, y.length);
    if (n < 5) return 0;

    const meanX = x.reduce((s, v) => s + v, 0) / n;
    const meanY = y.reduce((s, v) => s + v, 0) / n;

    let covariance = 0, varX = 0, varY = 0;
    for (let i = 0; i < n; i++) {
      const dx = x[i] - meanX;
      const dy = y[i] - meanY;
      covariance += dx * dy;
      varX += dx * dx;
      varY += dy * dy;
    }

    const denominator = Math.sqrt(varX * varY);
    return denominator === 0 ? 0 : covariance / denominator;
  }
}
