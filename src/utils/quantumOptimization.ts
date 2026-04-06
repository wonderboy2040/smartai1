// Quantum-inspired portfolio optimization algorithms
// Implements QAOA and VQE-inspired approaches for classical hardware

import { Position } from '../types';
import { ETFInfo } from '../constants';

/**
 * Quantum Approximate Optimization Algorithm (QAOA) inspired portfolio optimization
 * Uses classical simulation of quantum optimization principles
 */
export class QuantumInspiredOptimizer {
  private riskAversion: number;
  private maxIterations: number;
  private learningRate: number;

  constructor(riskAversion: number = 1.0, maxIterations: number = 100, learningRate: number = 0.01) {
    this.riskAversion = riskAversion;
    this.maxIterations = maxIterations;
    this.learningRate = learningRate;
  }

  /**
   * Optimize portfolio allocation using QAOA-inspired approach
   * @param expectedReturns Expected returns for each asset
   * @param covarianceMatrix Covariance matrix of asset returns
   * @param currentAllocations Current portfolio allocations (optional)
   * @returns Optimized allocations that balance return and risk
   */
  public optimizePortfolio(
    expectedReturns: number[],
    covarianceMatrix: number[][],
    currentAllocations: number[] = []
  ): number[] {
    const nAssets = expectedReturns.length;
    if (nAssets === 0) return [];

    // Initialize allocations (equal weight or current)
    let allocations = currentAllocations.length === nAssets
      ? [...currentAllocations]
      : Array(nAssets).fill(1 / nAssets);

    // Normalize to sum to 1
    let sum = allocations.reduce((acc, val) => acc + val, 0);
    allocations = allocations.map(val => val / sum);

    // QAOA-inspired iterative optimization
    for (let iter = 0; iter < this.maxIterations; iter++) {
      // Calculate gradient of objective function:
      // Maximize: expected_return - risk_aversion * portfolio_variance
      const gradient = this.calculateGradient(
        allocations,
        expectedReturns,
        covarianceMatrix
      );

      // Update allocations using gradient ascent with projection to simplex
      // (ensure allocations sum to 1 and are non-negative)
      for (let i = 0; i < nAssets; i++) {
        allocations[i] += this.learningRate * gradient[i];
      }

      // Project to probability simplex (non-negative, sum to 1)
      allocations = this.projectToSimplex(allocations);
    }

    return allocations;
  }

  /**
   * Calculate gradient of the objective function:
   * f(w) = w^T * μ - λ/2 * w^T * Σ * w
   * ∇f(w) = μ - λ * Σ * w
   */
  private calculateGradient(
    weights: number[],
    expectedReturns: number[],
    covarianceMatrix: number[][]
  ): number[] {
    const n = weights.length;
    const gradient: number[] = [];

    // ∇f(w) = μ - λ * Σ * w
    for (let i = 0; i < n; i++) {
      let grad = expectedReturns[i];

      // Risk component: -λ * Σ[i,:] * w
      let riskComponent = 0;
      for (let j = 0; j < n; j++) {
        riskComponent += covarianceMatrix[i][j] * weights[j];
      }

      grad -= this.riskAversion * riskComponent;
      gradient[i] = grad;
    }

    return gradient;
  }

  /**
   * Project vector onto probability simplex (non-negative components that sum to 1)
   * Based on the algorithm by Duchi et al. (2008)
   */
  private projectToSimplex(v: number[]): number[] {
    const n = v.length;
    if (n === 0) return [];

    // Sort v in descending order: u = sort(v, descending)
    const u = [...v].sort((a, b) => b - a);
    let cssv = 0; // cumulative sum
    let rho = 0;

    for (let j = 0; j < n; j++) {
      cssv += u[j];
      if (u[j] > (cssv - 1) / (j + 1)) {
        rho = j + 1;
      }
    }

    // Calculate theta = (1/rho) * (sum_{l=1..rho} u_l - 1)
    const theta = rho > 0 ? (cssv - 1) / rho : 0;

    // w_i = max(v_i - theta, 0)
    return v.map(val => Math.max(val - theta, 0));
  }

  /**
   * Variational Quantum Eigensolver (VQE) inspired optimization for minimum variance portfolio
   * Finds the portfolio with minimum variance (maximum quantum analog of ground state)
   */
  public minVariancePortfolio(covarianceMatrix: number[][]): number[] {
    const nAssets = covarianceMatrix.length;
    if (nAssets === 0) return [];

    // Initialize with equal weights
    let weights = Array(nAssets).fill(1 / nAssets);

    // Gradient of portfolio variance: w^T * Σ * w
    // ∇(w^T * Σ * w) = 2 * Σ * w
    for (let iter = 0; iter < this.maxIterations; iter++) {
      const gradient: number[] = [];

      for (let i = 0; i < nAssets; i++) {
        let sum = 0;
        for (let j = 0; j < nAssets; j++) {
          sum += covarianceMatrix[i][j] * weights[j];
        }
        gradient.push(2 * sum);
      }

      // Update: w = w - learning_rate * gradient
      for (let i = 0; i < nAssets; i++) {
        weights[i] -= this.learningRate * gradient[i];
      }

      // Project to simplex
      weights = this.projectToSimplex(weights);
    }

    return weights;
  }

  /**
   * Calculate expected returns and covariance matrix from historical data
   * In a real implementation, this would connect to market data APIs
   */
  public static estimateReturnsAndCovariance(
    historicalReturns: number[][]  // Each column is an asset's returns over time
  ): { expectedReturns: number[]; covarianceMatrix: number[][] } {
    const nAssets = historicalReturns[0].length;
    const nPeriods = historicalReturns.length;

    if (nAssets === 0 || nPeriods === 0) {
      return { expectedReturns: [], covarianceMatrix: [] };
    }

    // Calculate expected returns (mean of each asset)
    const expectedReturns: number[] = [];
    for (let j = 0; j < nAssets; j++) {
      let sum = 0;
      for (let i = 0; i < nPeriods; i++) {
        sum += historicalReturns[i][j];
      }
      expectedReturns.push(sum / nPeriods);
    }

    // Calculate covariance matrix
    const covarianceMatrix: number[][] = Array(nAssets)
      .fill(0)
      .map(() => Array(nAssets).fill(0));

    for (let i = 0; i < nAssets; i++) {
      for (let j = 0; j < nAssets; j++) {
        let sum = 0;
        for (let k = 0; k < nPeriods; k++) {
          const ret_i = historicalReturns[k][i] - expectedReturns[i];
          const ret_j = historicalReturns[k][j] - expectedReturns[j];
          sum += ret_i * ret_j;
        }
        covarianceMatrix[i][j] = sum / (nPeriods - 1);
      }
    }

    return { expectedReturns, covarianceMatrix };
  }
}

/**
 * Enhanced allocation engine that uses quantum-inspired optimization
 */
export class QuantumAllocationEngine {
  private optimizer: QuantumInspiredOptimizer;

  constructor(riskAversion: number = 1.0) {
    this.optimizer = new QuantumInspiredOptimizer(riskAversion);
  }

  /**
   * Generate smart allocations using quantum-inspired optimization
   * @param livePrices Current price data for assets
   * @param indiaSIP Monthly SIP amount in INR
   * @param usSIP Monthly SIP amount in USD
   * @returns Allocation recommendations with quantum optimization
   */
  public generateSmartAllocations(
    livePrices: Record<string, any>,
    indiaSIP: number,
    usSIP: number
  ): Array<{
    symbol: string;
    name: string;
    market: 'IN' | 'US';
    allocAmount: number;
    allocPct: number;
    signal: string;
    rsi: number;
    strength: number;
    targetEntry: number;
    riskReward: number;
    reason: string;
  }> {
    // This would be implemented by:
    // 1. Extracting symbols from livePrices
    // 2. Estimating expected returns and covariance (would need historical data)
    // 3. Running quantum optimization
    // 4. Converting weights to allocation amounts
    // 5. Generating signals based on optimization results

    // For now, falling back to existing logic but enhanced with quantum principles
    return this.enhancedExistingAllocations(livePrices, indiaSIP, usSIP);
  }

  private enhancedExistingAllocations(
    livePrices: Record<string, any>,
    indiaSIP: number,
    usSIP: number
  ): Array<{
    symbol: string;
    name: string;
    market: 'IN' | 'US';
    allocAmount: number;
    allocPct: number;
    signal: string;
    rsi: number;
    strength: number;
    targetEntry: number;
    riskReward: number;
    reason: string;
  }> {
    const assets = Object.keys(livePrices);
    if (assets.length === 0) return [];

    // Build expected returns from price changes and momentum
    const expectedReturns: number[] = [];
    const assetSymbols: string[] = [];
    const assetMarkets: ('IN' | 'US')[] = [];

    for (const key of assets) {
      const data = livePrices[key];
      if (!data || !data.price || data.price <= 0) continue;

      const market = key.startsWith('IN_') ? 'IN' : 'US';
      const symbol = key.replace(/^IN_/, '').replace(/^US_/, '');

      // Use change% as proxy for expected return (momentum factor)
      const momentumReturn = data.change || 0;
      expectedReturns.push(momentumReturn);
      assetSymbols.push(symbol);
      assetMarkets.push(market);
    }

    if (assetSymbols.length < 2) {
      return assetSymbols.map((sym, i) => ({
        symbol: sym,
        name: sym,
        market: assetMarkets[i],
        allocAmount: 0,
        allocPct: assetSymbols.length > 0 ? 1 / assetSymbols.length : 1,
        signal: 'HOLD',
        rsi: livePrices[`${assetMarkets[i]}_${sym}`]?.rsi || 50,
        strength: 50,
        targetEntry: livePrices[`${assetMarkets[i]}_${sym}`]?.price || 0,
        riskReward: 0,
        reason: 'Not enough assets for quantum optimization'
      }));
    }

    // Build simple covariance from volatility
    const covMatrix: number[][] = [];
    const n = assetSymbols.length;
    for (let i = 0; i < n; i++) {
      const row: number[] = [];
      for (let j = 0; j < n; j++) {
        if (i === j) {
          row.push(Math.abs(expectedReturns[i]) * 0.1 + 0.01); // Diagonal volatility
        } else {
          row.push(Math.sqrt(Math.abs(expectedReturns[i] * expectedReturns[j])) * 0.005 + 0.001);
        }
      }
      covMatrix.push(row);
    }

    // Run quantum optimization
    const optimizedWeights = this.optimizer.optimizePortfolio(expectedReturns, covMatrix);

    // Build allocation results
    return assetSymbols.map((symbol, i) => {
      const key = `${assetMarkets[i]}_${symbol}`;
      const data = livePrices[key];
      const weight = optimizedWeights[i] || 1 / n;
      const market = assetMarkets[i];
      const totalSIP = market === 'IN' ? indiaSIP : usSIP;

      let signal = 'HOLD';
      if (data?.rsi !== undefined) {
        if (data.rsi < 35) signal = 'STRONG BUY';
        else if (data.rsi < 50) signal = 'BUY';
        else if (data.rsi > 70) signal = 'SELL';
      }

      return {
        symbol,
        name: symbol,
        market,
        allocAmount: Math.round(totalSIP * weight),
        allocPct: weight,
        signal,
        rsi: data?.rsi || 50,
        strength: Math.round((weight * 100)),
        targetEntry: data?.price || 0,
        riskReward: 0,
        reason: `Quantum-optimized allocation: ${(weight * 100).toFixed(1)}% based on risk-return surface`
      };
    });
  }

  /**
   * Calculate quantum-enhanced portfolio metrics
   * @param portfolio Current portfolio positions
   * @param livePrices Current price data
   * @param usdInrRate USD to INR exchange rate
   * @returns Enhanced portfolio metrics
   */
  public calculateEnhancedMetrics(
    portfolio: any[],
    livePrices: Record<string, any>,
    usdInrRate: number
  ) {
    // Calculate asset values and correlations
    const values: number[] = [];
    const returns: number[] = [];

    portfolio.forEach(p => {
      const key = `${p.market}_${p.symbol}`;
      const price = livePrices[key]?.price || p.avgPrice;
      const change = livePrices[key]?.change || 0;
      const valueINR = p.market === 'IN' ? price * p.qty : price * p.qty * usdInrRate;
      values.push(valueINR);
      returns.push(change);
    });

    const totalValue = values.reduce((s, v) => s + v, 0);
    const weights = values.map(v => totalValue > 0 ? v / totalValue : 0);

    // Entanglement entropy (Shannon entropy of weights)
    let entanglementEntropy = 0;
    for (const w of weights) {
      if (w > 0) entanglementEntropy -= w * Math.log2(w);
    }

    // Maximum entropy for equal weighting
    const maxEntropy = Math.log2(Math.max(weights.length, 1));
    const diversificationRatio = maxEntropy > 0 ? entanglementEntropy / maxEntropy : 0;

    // Coherence measure (how well-diversified vs concentrated)
    const hhi = weights.reduce((s, w) => s + w * w, 0); // Herfindahl-Hirschman Index
    const coherenceMeasure = 1 - (hhi - 1 / weights.length) / (1 - 1 / Math.max(weights.length, 2));

    return {
      quantumDiversificationRatio: Math.round(diversificationRatio * 100) / 100,
      entanglementEntropy: Math.round(entanglementEntropy * 100) / 100,
      coherenceMeasure: Math.max(0, Math.round(coherenceMeasure * 100) / 100),
      portfolioConcentration: Math.round(hhi * 1000) / 10,
      effectivePositions: Math.round(Math.exp(entanglementEntropy) * 10) / 10
    };
  }

  /**
   * Generate portfolio rebalancing suggestions using quantum principles
   */
  public suggestRebalancing(
    currentAllocations: number[],
    optimizedAllocations: number[],
    threshold: number = 0.05
  ): Array<{ assetIndex: number; currentPct: number; targetPct: number; rebalanceNeeded: boolean } | null> {
    return currentAllocations.map((curr, i) => {
      const target = optimizedAllocations[i] || 0;
      const drift = Math.abs(curr - target);
      return {
        assetIndex: i,
        currentPct: Math.round(curr * 1000) / 10,
        targetPct: Math.round(target * 1000) / 10,
        rebalanceNeeded: drift > threshold
      };
    });
  }
}