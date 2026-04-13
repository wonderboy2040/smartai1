// Quantum Sentiment Analysis Engine
// Uses quantum-inspired algorithms for market sentiment analysis
// Implements density matrix representation of sentiment states

export interface SentimentData {
  symbol: string;
  headline: string;
  sentiment: number; // -1 to 1
  confidence: number; // 0 to 1
  timestamp: number;
  source?: string;
}

export interface QuantumSentimentState {
  // Density matrix representation (2x2 for bullish/bearish superposition)
  densityMatrix: number[][];
  // Classical probability of bullish sentiment
  bullishProbability: number;
  // Classical probability of bearish sentiment
  bearishProbability: number;
  // Quantum coherence (off-diagonal elements magnitude)
  coherence: number;
  // Entropy of the sentiment state
  entropy: number;
}

export interface SentimentPortfolio {
  symbol: string;
  sentimentWeight: number;
  quantumAdjustment: number;
  finalWeight: number;
}

/**
 * Quantum Sentiment Analysis Engine
 * Uses density matrices to model market sentiment as quantum states
 */
export class QuantumSentimentAnalyzer {
  private decayFactor: number;
  private coherenceDecay: number;
  private sentimentHistory: Map<string, QuantumSentimentState[]>;

  constructor(decayFactor: number = 0.95, coherenceDecay: number = 0.9) {
    this.decayFactor = decayFactor;
    this.coherenceDecay = coherenceDecay;
    this.sentimentHistory = new Map();
  }

  /**
   * Initialize a quantum sentiment state from news sentiment
   */
  public initializeSentiment(sentiment: number, confidence: number): QuantumSentimentState {
    // Convert classical sentiment (-1 to 1) to quantum state
    // |ψ⟩ = α|bullish⟩ + β|bearish⟩
    // where |α|² and |β|² are the probabilities

    const bullishProb = (sentiment + 1) / 2; // Map -1 to 1 -> 0 to 1
    const bearishProb = 1 - bullishProb;

    // Density matrix: ρ = |ψ⟩⟨ψ|
    // ρ = [|α|²    αβ*   ]
    //     [|β|²   α*β  ]
    const alpha = Math.sqrt(bullishProb * confidence);
    const beta = Math.sqrt(bearishProb * confidence);

    // If sentiment is strongly one-sided, add quantum phase
    const phase = sentiment * Math.PI / 4;
    const alphaReal = alpha * Math.cos(phase);
    const alphaImag = alpha * Math.sin(phase);

    const densityMatrix: number[][] = [
      [alphaReal * alphaReal + alphaImag * alphaImag, alphaReal * beta],
      [alphaReal * beta, beta * beta]
    ];

    // Calculate coherence (off-diagonal elements)
    const coherence = Math.abs(densityMatrix[0][1]) * 2;

    // Calculate entropy: S = -Tr(ρ log ρ)
    const entropy = this.calculateEntropy(densityMatrix);

    return {
      densityMatrix,
      bullishProbability: bullishProb,
      bearishProbability: bearishProb,
      coherence,
      entropy
    };
  }

  /**
   * Calculate von Neumann entropy of density matrix
   */
  private calculateEntropy(densityMatrix: number[][]): number {
    // S = -Tr(ρ log ρ) = -Σ λᵢ log λᵢ
    const eigenvalues = this.getEigenvalues(densityMatrix);
    let entropy = 0;

    for (const lambda of eigenvalues) {
      if (lambda > 0) {
        entropy -= lambda * Math.log2(lambda);
      }
    }

    return entropy;
  }

  /**
   * Get eigenvalues of 2x2 matrix
   */
  private getEigenvalues(matrix: number[][]): number[] {
    const a = matrix[0][0];
    const b = matrix[0][1];
    const c = matrix[1][0];
    const d = matrix[1][1];

    const trace = a + d;
    const det = a * d - b * c;
    const discriminant = Math.sqrt((trace * trace) - 4 * det);

    return [
      (trace + discriminant) / 2,
      (trace - discriminant) / 2
    ];
  }

  /**
   * Apply quantum interference from new sentiment data
   */
  public applyQuantumInterference(
    currentState: QuantumSentimentState,
    newSentiment: number,
    newConfidence: number
  ): QuantumSentimentState {
    const newState = this.initializeSentiment(newSentiment, newConfidence);

    // Interference: ρ_new = U ρ U† where U represents time evolution
    // Simplified: mix current and new states based on decay factor

    const interferenceMatrix: number[][] = [[0, 0], [0, 0]];

    for (let i = 0; i < 2; i++) {
      for (let j = 0; j < 2; j++) {
        interferenceMatrix[i][j] =
          this.decayFactor * currentState.densityMatrix[i][j] +
          (1 - this.decayFactor) * newState.densityMatrix[i][j];
      }
    }

    // Renormalize to ensure trace = 1
    const trace = interferenceMatrix[0][0] + interferenceMatrix[1][1];
    for (let i = 0; i < 2; i++) {
      for (let j = 0; j < 2; j++) {
        interferenceMatrix[i][j] /= trace;
      }
    }

    const coherence = Math.abs(interferenceMatrix[0][1]) * 2;
    const entropy = this.calculateEntropy(interferenceMatrix);

    return {
      densityMatrix: interferenceMatrix,
      bullishProbability: interferenceMatrix[0][0],
      bearishProbability: interferenceMatrix[1][1],
      coherence,
      entropy
    };
  }

  /**
   * Collapse sentiment state (simulate measurement)
   * High coherence states collapse more dramatically
   */
  public collapseSentiment(state: QuantumSentimentState): number {
    const { bullishProbability, coherence } = state;

    // Add quantum noise based on coherence
    const noise = (Math.random() - 0.5) * coherence * 0.2;

    // Collapse toward classical probability with noise
    let collapsedSentiment = 2 * (bullishProbability + noise) - 1;

    // Clamp to [-1, 1]
    return Math.max(-1, Math.min(1, collapsedSentiment));
  }

  /**
   * Calculate sentiment entanglement between two assets
   */
  public calculateEntanglement(
    state1: QuantumSentimentState,
    state2: QuantumSentimentState
  ): number {
    // Using quantum mutual information as entanglement measure
    const jointEntropy = this.calculateJointEntropy(state1, state2);
    const mutualInfo = state1.entropy + state2.entropy - jointEntropy;

    // Normalize to [0, 1]
    return Math.min(1, Math.max(0, mutualInfo));
  }

  /**
   * Calculate joint entropy of two sentiment states
   */
  private calculateJointEntropy(
    state1: QuantumSentimentState,
    state2: QuantumSentimentState
  ): number {
    // Tensor product of density matrices
    const jointDensity = this.tensorProduct(
      state1.densityMatrix,
      state2.densityMatrix
    );

    return this.calculateEntropy(jointDensity);
  }

  /**
   * Tensor product of two 2x2 matrices (gives 4x4 matrix)
   */
  private tensorProduct(A: number[][], B: number[][]): number[][] {
    const result: number[][] = [];

    for (let i = 0; i < 4; i++) {
      result[i] = [];
      for (let j = 0; j < 4; j++) {
        const rowA = Math.floor(i / 2);
        const colA = Math.floor(j / 2);
        const rowB = i % 2;
        const colB = j % 2;
        result[i][j] = A[rowA][colA] * B[rowB][colB];
      }
    }

    return result;
  }

  /**
   * Update sentiment history for a symbol
   */
  public updateSentimentHistory(
    symbol: string,
    state: QuantumSentimentState
  ): void {
    const history = this.sentimentHistory.get(symbol) || [];
    history.push(state);

    // Keep only last 100 states
    if (history.length > 100) {
      history.shift();
    }

    this.sentimentHistory.set(symbol, history);
  }

  /**
   * Get average sentiment for a symbol from history
   */
  public getAverageSentiment(symbol: string): number {
    const history = this.sentimentHistory.get(symbol);
    if (!history || history.length === 0) return 0;

    const avgBullish = history.reduce((sum, s) => sum + s.bullishProbability, 0) / history.length;
    return 2 * avgBullish - 1;
  }

  /**
   * Get sentiment momentum (rate of change)
   */
  public getSentimentMomentum(symbol: string): number {
    const history = this.sentimentHistory.get(symbol);
    if (!history || history.length < 2) return 0;

    const recent = history[history.length - 1];
    const previous = history[history.length - 2];

    return recent.bullishProbability - previous.bullishProbability;
  }

  /**
   * Calculate quantum-adjusted sentiment weights for portfolio
   */
  public calculateSentimentWeights(
    symbols: string[],
    baseWeights: number[]
  ): SentimentPortfolio[] {
    const results: SentimentPortfolio[] = [];

    for (let i = 0; i < symbols.length; i++) {
      const symbol = symbols[i];
      const baseWeight = baseWeights[i] || (1 / symbols.length);

      const sentiment = this.getAverageSentiment(symbol);
      const momentum = this.getSentimentMomentum(symbol);
      const history = this.sentimentHistory.get(symbol);

      // Quantum adjustment: sentiment drives weight deviation from base
      // High coherence = more confident adjustment
      let quantumAdjustment = sentiment * 0.3; // Base sentiment adjustment

      // Add momentum component
      quantumAdjustment += momentum * 0.1;

      // Amplify if high coherence
      if (history && history.length > 0) {
        const avgCoherence = history.reduce((sum, s) => sum + s.coherence, 0) / history.length;
        quantumAdjustment *= (1 + avgCoherence);
      }

      const finalWeight = baseWeight * (1 + quantumAdjustment);

      results.push({
        symbol,
        sentimentWeight: sentiment,
        quantumAdjustment,
        finalWeight
      });
    }

    // Renormalize weights
    const totalWeight = results.reduce((sum, r) => sum + r.finalWeight, 0);
    for (const result of results) {
      result.finalWeight /= totalWeight;
    }

    return results;
  }

  /**
   * Process news and update sentiment state
   */
  public processNews(symbol: string, news: SentimentData): QuantumSentimentState {
    const currentState = this.initializeSentiment(news.sentiment, news.confidence);
    const history = this.sentimentHistory.get(symbol);

    if (history && history.length > 0) {
      const previousState = history[history.length - 1];
      const updatedState = this.applyQuantumInterference(
        previousState,
        news.sentiment,
        news.confidence
      );

      this.updateSentimentHistory(symbol, updatedState);
      return updatedState;
    }

    this.updateSentimentHistory(symbol, currentState);
    return currentState;
  }

  /**
   * Get overall market sentiment (aggregate of all tracked symbols)
   */
  public getMarketSentiment(): { average: number; momentum: number; coherence: number } {
    let totalBullish = 0;
    let totalMomentum = 0;
    let totalCoherence = 0;
    let count = 0;

    for (const [symbol, history] of this.sentimentHistory) {
      if (history.length > 0) {
        const latest = history[history.length - 1];
        totalBullish += latest.bullishProbability;
        totalCoherence += latest.coherence;
        count++;

        if (history.length >= 2) {
          totalMomentum += latest.bullishProbability - history[history.length - 2].bullishProbability;
        }
      }
    }

    if (count === 0) {
      return { average: 0, momentum: 0, coherence: 0 };
    }

    return {
      average: 2 * (totalBullish / count) - 1,
      momentum: totalMomentum / count,
      coherence: totalCoherence / count
    };
  }
}

// Export singleton instance
export const quantumSentimentAnalyzer = new QuantumSentimentAnalyzer();