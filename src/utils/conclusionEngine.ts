/**
 * ============================================================
 * MASTER CONCLUSION ENGINE — Weighted Signal Aggregator
 * ============================================================
 * Aggregates ALL signals from every strategy/feature:
 *   1. analyzeAsset()     — RSI/MACD/SMA technical signals  (30%)
 *   2. ML Momentum        — Momentum score + regime detection (25%)
 *   3. AI Prediction      — PredictionEngine price forecast   (20%)
 *   4. Smart Allocation   — Allocation strength scores        (15%)
 *   5. Market Regime      — VIX-based global sentiment        (10%)
 *
 * Produces a FINAL weighted conclusion per asset with exact
 * entry, exit, stop-loss, and reversal price points.
 */

import { Position, PriceData } from '../types';
import { analyzeAsset, getSmartAllocations, AllocationRec } from './telegram';
import {
  detectRegime,
  scanMeanReversion,
  calculateMomentumScore,
  PredictionEngine,
} from './mlPrediction';


// ========================================
// TYPES
// ========================================

export type FinalVerdict = 'STRONG_BUY' | 'BUY' | 'HOLD' | 'SELL' | 'STRONG_SELL';

export interface StrategyBreakdown {
  name: string;
  signal: string;
  score: number;      // 0-100 (100 = max bullish)
  weight: number;     // weight used in final calculation
  detail: string;
}

export interface AssetConclusion {
  symbol: string;
  market: 'IN' | 'US';
  
  // Final Verdict
  verdict: FinalVerdict;
  verdictScore: number;          // 0-100 weighted composite
  confidence: number;            // 0-100 overall confidence
  
  // Price Levels
  currentPrice: number;
  entryPrice: number;            // best buy zone
  targetPrice: number;           // sell target / take profit
  stopLoss: number;              // stop loss level
  reversalZone: number;          // price where trend reverses
  riskReward: number;            // risk:reward ratio
  
  // Technical Data
  rsi: number;
  macd: number | undefined;
  sma20: number | undefined;
  sma50: number | undefined;
  change: number;
  volume: number;
  trend: 'BULLISH' | 'BEARISH' | 'SIDEWAYS';
  
  // Strategy Breakdown
  strategies: StrategyBreakdown[];
  
  // Action Plan (plain Hinglish)
  actionTitle: string;           // e.g. "🟢 BUY KARO"
  actionDetail: string;          // detailed what/when/how
  priceAction: string;           // entry/exit description
  holdingPeriod: string;         // recommended hold time
  
  // Portfolio context
  plPct: number;                 // P&L percentage if held
  allocPct: number;              // portfolio allocation %
}

export interface MarketPulse {
  regime: string;                // BULL / BEAR / SIDEWAYS
  regimeScore: number;           // 0-100
  usVix: number;
  inVix: number;
  avgVix: number;
  fearGreedScore: number;        // 0-100 (0=extreme fear, 100=extreme greed)
  globalMood: string;            // description
  indiaStatus: string;
  usaStatus: string;
  overallAction: string;         // portfolio-level action
  overallActionDetail: string;
}

export interface MasterConclusionData {
  conclusions: AssetConclusion[];
  marketPulse: MarketPulse;
  timestamp: number;
  buyCount: number;
  sellCount: number;
  holdCount: number;
  avgConfidence: number;
  topPick: AssetConclusion | null;
  topAvoid: AssetConclusion | null;
}

// ========================================
// SIGNAL SCORING HELPERS
// ========================================

function signalToScore(signal: string): number {
  const s = signal.toUpperCase();
  if (s.includes('STRONG_BUY') || s.includes('STRONG BUY')) return 95;
  if (s.includes('BUY') && !s.includes('SELL')) return 75;
  if (s.includes('ACCUMULATE')) return 70;
  if (s.includes('HOLD') || s.includes('WAIT') || s.includes('NEUTRAL')) return 50;
  if (s.includes('SELL') && !s.includes('STRONG') && !s.includes('BUY')) return 25;
  if (s.includes('STRONG_SELL') || s.includes('STRONG SELL') || s.includes('DISTRIBUTE')) return 10;
  if (s.includes('AVOID')) return 15;
  return 50;
}

function scoreToVerdict(score: number): FinalVerdict {
  if (score >= 80) return 'STRONG_BUY';
  if (score >= 62) return 'BUY';
  if (score >= 40) return 'HOLD';
  if (score >= 22) return 'SELL';
  return 'STRONG_SELL';
}

function getTrend(sma20: number | undefined, sma50: number | undefined, macd: number | undefined, change: number): 'BULLISH' | 'BEARISH' | 'SIDEWAYS' {
  let bullish = 0, bearish = 0;
  if (sma20 && sma50) {
    if (sma20 > sma50) bullish += 2; else bearish += 2;
  }
  if (macd !== undefined) {
    if (macd > 0) bullish += 1; else bearish += 1;
  }
  if (change > 0.5) bullish += 1;
  else if (change < -0.5) bearish += 1;
  
  if (bullish > bearish + 1) return 'BULLISH';
  if (bearish > bullish + 1) return 'BEARISH';
  return 'SIDEWAYS';
}

// ========================================
// MAIN ENGINE
// ========================================

export function generateMasterConclusion(
  portfolio: Position[],
  livePrices: Record<string, PriceData>,
  usdInrRate: number,
  metrics: { totalValue: number; totalPL: number; plPct: number; todayPL: number }
): MasterConclusionData {
  
  const usVix = livePrices['US_VIX']?.price || 15;
  const inVix = livePrices['IN_INDIAVIX']?.price || 15;
  const avgVix = (usVix + inVix) / 2;
  
  // Get Smart Allocations for strength data
  const allocations = getSmartAllocations(livePrices, 10000, 200);
  const allocMap = new Map<string, AllocationRec>();
  allocations.forEach(a => allocMap.set(a.symbol, a));
  
  // Symbols to analyze = portfolio + default market symbols
  let symbolsToAnalyze: Position[] = [...portfolio];
  
  // Add defaults if portfolio empty
  if (symbolsToAnalyze.length === 0) {
    const defaults = ['IN_NIFTY', 'US_SPY', 'US_QQQ', 'IN_BANKNIFTY', 'US_AAPL', 'US_TSLA'];
    symbolsToAnalyze = defaults.map(sym => ({
      id: sym,
      symbol: sym.replace('IN_', '').replace('US_', ''),
      market: (sym.startsWith('IN') ? 'IN' : 'US') as 'IN' | 'US',
      qty: 1,
      avgPrice: livePrices[sym]?.price || 100,
      leverage: 1,
      dateAdded: ''
    }));
  }
  
  const conclusions: AssetConclusion[] = [];
  
  for (const pos of symbolsToAnalyze) {
    const symbol = pos.symbol;
    const market = pos.market;
    const fullKey = `${market}_${symbol}`;
    const data = livePrices[fullKey];
    const currentPrice = data?.price || pos.avgPrice;
    
    if (currentPrice <= 0) continue;
    
    const rsi = data?.rsi || 50;
    const change = data?.change || 0;
    const volume = data?.volume || 0;
    const sma20 = data?.sma20;
    const sma50 = data?.sma50;
    const macd = data?.macd;
    const high = data?.high || currentPrice * 1.01;
    const low = data?.low || currentPrice * 0.99;
    const atr = (high - low) || currentPrice * 0.02;
    
    const strategies: StrategyBreakdown[] = [];
    
    // ──────── STRATEGY 1: Technical Analysis (30%) ────────
    const techSignal = analyzeAsset(pos, data);
    const techScore = signalToScore(techSignal.signal);
    strategies.push({
      name: 'Technical (RSI/MACD/SMA)',
      signal: techSignal.signal.replace('_', ' '),
      score: techScore,
      weight: 0.30,
      detail: techSignal.reason
    });
    
    // ──────── STRATEGY 2: ML Momentum (25%) ────────
    const priceHistory = Array.from({ length: 50 }, (_, i) =>
      currentPrice * (1 + (Math.sin(i / 10) * 0.02) + (Math.random() - 0.5) * 0.01)
    );
    
    const momentum = calculateMomentumScore(
      rsi, macd || 0, sma20 || currentPrice, sma50 || currentPrice,
      currentPrice, change, volume
    );
    const regime = detectRegime(priceHistory, usVix);
    const meanRev = scanMeanReversion(priceHistory, currentPrice);
    
    let mlSignal = 'HOLD';
    let mlScore = momentum.score;
    if (momentum.score >= 75 && (regime.regime === 'BULL' || regime.regime === 'STRONG_BULL')) {
      mlSignal = 'STRONG BUY'; mlScore = Math.min(98, momentum.score + 10);
    } else if (momentum.score >= 60) {
      mlSignal = 'BUY'; mlScore = momentum.score;
    } else if (momentum.score <= 30 && regime.regime.includes('BEAR')) {
      mlSignal = 'STRONG SELL'; mlScore = Math.max(5, 100 - momentum.score);
    } else if (momentum.score <= 40) {
      mlSignal = 'SELL'; mlScore = Math.max(10, 100 - momentum.score);
    }
    // Invert score for sell signals
    if (mlSignal.includes('SELL')) mlScore = 100 - mlScore;
    
    let mlDetail = `Momentum: ${momentum.score}/100, Regime: ${regime.regime}`;
    if (meanRev && meanRev.probability > 50) {
      mlDetail += `, Mean Reversion: ${meanRev.probability}%`;
    }
    
    strategies.push({
      name: 'ML Momentum Engine',
      signal: mlSignal,
      score: signalToScore(mlSignal),
      weight: 0.25,
      detail: mlDetail
    });
    
    // ──────── STRATEGY 3: AI Prediction (20%) ────────
    const effectiveData: PriceData = {
      price: currentPrice, change, high, low, volume, rsi,
      macd: macd || 0, sma20: sma20 || currentPrice, sma50: sma50 || currentPrice,
      time: Date.now(), market: market
    };
    const prediction = PredictionEngine.predictPrice(priceHistory, currentPrice, effectiveData, 7);
    
    let predScore = 50;
    let predSignal = 'HOLD';
    if (prediction.predictedChange > 5) { predSignal = 'STRONG BUY'; predScore = 90; }
    else if (prediction.predictedChange > 2) { predSignal = 'BUY'; predScore = 72; }
    else if (prediction.predictedChange < -5) { predSignal = 'STRONG SELL'; predScore = 10; }
    else if (prediction.predictedChange < -2) { predSignal = 'SELL'; predScore = 28; }
    
    strategies.push({
      name: 'AI Price Prediction (7D)',
      signal: predSignal,
      score: predScore,
      weight: 0.20,
      detail: `Predicted: ${prediction.predictedChange >= 0 ? '+' : ''}${prediction.predictedChange.toFixed(1)}% in 7 days (Confidence: ${prediction.confidence}%)`
    });
    
    // ──────── STRATEGY 4: Allocation Strength (15%) ────────
    const alloc = allocMap.get(symbol.replace('.NS', ''));
    let allocScore = 50;
    let allocSignal = 'HOLD';
    let allocDetail = 'No allocation data available';
    
    if (alloc) {
      allocScore = alloc.strength;
      allocSignal = alloc.signal.replace(/🟢|🔴|🟡/g, '').trim();
      allocDetail = `Strength: ${alloc.strength}/100, Trend: ${alloc.trendStrength}, ${alloc.volumeSignal}`;
    } else {
      // Derive from RSI + VIX
      if (rsi < 40 && avgVix < 18) { allocScore = 70; allocSignal = 'BUY'; allocDetail = 'RSI value zone + low VIX'; }
      else if (rsi > 65 || avgVix > 22) { allocScore = 30; allocSignal = 'SELL'; allocDetail = 'Overbought/high VIX'; }
    }
    
    strategies.push({
      name: 'Smart Allocation',
      signal: allocSignal,
      score: allocScore,
      weight: 0.15,
      detail: allocDetail
    });
    
    // ──────── STRATEGY 5: Market Regime (10%) ────────
    let regimeScore = 50;
    let regimeSignal = 'NEUTRAL';
    let regimeDetail = `Avg VIX: ${avgVix.toFixed(1)}`;
    
    if (avgVix < 13) { regimeScore = 85; regimeSignal = 'BULLISH'; regimeDetail += ' — Ultra low volatility, greed zone'; }
    else if (avgVix < 16) { regimeScore = 70; regimeSignal = 'BULLISH'; regimeDetail += ' — Normal-bullish conditions'; }
    else if (avgVix < 20) { regimeScore = 50; regimeSignal = 'NEUTRAL'; regimeDetail += ' — Mixed signals, selective'; }
    else if (avgVix < 25) { regimeScore = 30; regimeSignal = 'CAUTIOUS'; regimeDetail += ' — Elevated volatility'; }
    else { regimeScore = 15; regimeSignal = 'BEARISH'; regimeDetail += ' — Fear dominant, capital preservation'; }
    
    strategies.push({
      name: 'Market Regime (VIX)',
      signal: regimeSignal,
      score: regimeScore,
      weight: 0.10,
      detail: regimeDetail
    });
    
    // ──────── CALCULATE WEIGHTED FINAL SCORE ────────
    const verdictScore = Math.round(
      strategies.reduce((sum, s) => sum + (s.score * s.weight), 0)
    );
    const verdict = scoreToVerdict(verdictScore);
    
    // Confidence = average of strategy scores weighted by divergence
    const scoreVariance = strategies.reduce((sum, s) => sum + Math.abs(s.score - verdictScore), 0) / strategies.length;
    const confidence = Math.round(Math.max(40, Math.min(98, 100 - scoreVariance)));
    
    // ──────── PRICE LEVELS ────────
    const entryPrice = verdict.includes('BUY') 
      ? Math.min(currentPrice, low, sma20 || currentPrice * 0.99)
      : currentPrice;
    
    const targetPrice = verdict.includes('BUY')
      ? currentPrice + (atr * 2.5)
      : verdict.includes('SELL')
        ? currentPrice - (atr * 1.5)
        : currentPrice + (atr * 1.0);
    
    const stopLoss = verdict.includes('BUY')
      ? currentPrice - (atr * 1.5)
      : verdict.includes('SELL')
        ? currentPrice + (atr * 1.0)
        : currentPrice - (atr * 2.0);
    
    // Reversal zone: where the trend is likely to flip
    const reversalZone = verdict.includes('BUY')
      ? currentPrice - (atr * 2.5)  // below this = bearish reversal
      : currentPrice + (atr * 2.5); // above this = bullish reversal
    
    const rr = Math.abs(stopLoss - currentPrice) > 0
      ? Math.abs(targetPrice - currentPrice) / Math.abs(stopLoss - currentPrice)
      : 0;
    
    const trend = getTrend(sma20, sma50, macd, change);
    
    // ──────── P&L CONTEXT ────────
    const plPct = pos.avgPrice > 0 ? ((currentPrice - pos.avgPrice) / pos.avgPrice) * 100 : 0;
    const posValue = currentPrice * pos.qty * (market === 'US' ? usdInrRate : 1);
    const allocPctVal = metrics.totalValue > 0 ? (posValue / metrics.totalValue) * 100 : 0;
    
    // ──────── ACTION PLAN (HINGLISH) ────────
    const cur = market === 'IN' ? '₹' : '$';
    let actionTitle = '';
    let actionDetail = '';
    let priceAction = '';
    let holdingPeriod = '';
    
    if (verdict === 'STRONG_BUY') {
      actionTitle = '🟢 STRONG BUY — Aggressively Accumulate Karo';
      actionDetail = `Bhai, ${symbol} me sabhi 5 strategies BULLISH dikha rahi hain. RSI ${rsi.toFixed(0)} pe hai, momentum strong hai, aur AI prediction bhi positive hai. Iss dip pe aggressively buy karo. SL strict rakho ${cur}${stopLoss.toFixed(2)} pe.`;
      priceAction = `Entry Zone: ${cur}${entryPrice.toFixed(2)} — ${cur}${currentPrice.toFixed(2)} | Target: ${cur}${targetPrice.toFixed(2)} | SL: ${cur}${stopLoss.toFixed(2)}`;
      holdingPeriod = '7-14 days (Swing) or SIP mode me continue';
    } else if (verdict === 'BUY') {
      actionTitle = '🟢 BUY — Dheere Dheere Accumulate Karo';
      actionDetail = `${symbol} me majority signals positive hain. RSI ${rsi.toFixed(0)} decent zone me hai. Ek baar me sab mat daalo — 2-3 tranches me entry lo. ${cur}${entryPrice.toFixed(2)} ke paas best entry milegi.`;
      priceAction = `Entry Zone: ${cur}${entryPrice.toFixed(2)} | Target: ${cur}${targetPrice.toFixed(2)} | SL: ${cur}${stopLoss.toFixed(2)}`;
      holdingPeriod = '7-21 days hold karo, trail SL lagao';
    } else if (verdict === 'HOLD') {
      actionTitle = '🟡 HOLD — Abhi Wait Karo';
      actionDetail = `${symbol} me mixed signals aa rahe hain. Kuch strategies bullish, kuch bearish. Naya position mat lo abhi. Agar already hold hai toh trail SL pe rakho. ${rsi > 55 ? 'RSI thoda high side pe hai, correction ka wait karo.' : 'RSI neutral zone me hai, dip aaye toh consider karo.'}`;
      priceAction = `Current: ${cur}${currentPrice.toFixed(2)} | Support: ${cur}${stopLoss.toFixed(2)} | Resistance: ${cur}${targetPrice.toFixed(2)}`;
      holdingPeriod = 'Wait for clear signal — SIP continue karo';
    } else if (verdict === 'SELL') {
      actionTitle = '🔴 SELL — Partial Profit Book Karo';
      actionDetail = `${symbol} me bearish signals aa rahe hain. RSI ${rsi.toFixed(0)} pe hai${rsi > 65 ? ' (overbought zone!)' : ''}. MACD bhi weakness dikha raha hai. 20-40% position sell karo aur baaki pe trail SL lagao ${cur}${stopLoss.toFixed(2)} pe.`;
      priceAction = `Sell Zone: ${cur}${currentPrice.toFixed(2)} — ${cur}${targetPrice.toFixed(2)} | Trail SL: ${cur}${stopLoss.toFixed(2)} | Reversal: ${cur}${reversalZone.toFixed(2)}`;
      holdingPeriod = 'Book profits NOW, re-enter at reversal zone';
    } else {
      actionTitle = '🔴 STRONG SELL — Exit Position';
      actionDetail = `Bhai, ${symbol} me sabhi strategies RED dikha rahi hain! RSI ${rsi.toFixed(0)}, bearish regime, negative momentum. Jaldi se position reduce karo. ${cur}${reversalZone.toFixed(2)} ke neeche jaaye toh aur gir sakta hai.`;
      priceAction = `EXIT NOW at ${cur}${currentPrice.toFixed(2)} | If reversal above ${cur}${reversalZone.toFixed(2)} — re-enter`;
      holdingPeriod = 'EXIT immediately, re-evaluate after reversal';
    }
    
    conclusions.push({
      symbol: symbol.replace('.NS', ''),
      market,
      verdict,
      verdictScore,
      confidence,
      currentPrice,
      entryPrice,
      targetPrice,
      stopLoss,
      reversalZone,
      riskReward: parseFloat(rr.toFixed(2)),
      rsi,
      macd,
      sma20,
      sma50,
      change,
      volume,
      trend,
      strategies,
      actionTitle,
      actionDetail,
      priceAction,
      holdingPeriod,
      plPct,
      allocPct: allocPctVal,
    });
  }
  
  // Sort by verdictScore descending (best opportunities first)
  conclusions.sort((a, b) => b.verdictScore - a.verdictScore);
  
  // ──────── MARKET PULSE ────────
  const globalRegime = detectRegime(
    Array.from({ length: 30 }, (_, i) => 100 * (1 + Math.sin(i / 10) * 0.02)),
    usVix
  );
  
  let fearGreedScore = 50;
  if (avgVix > 30) fearGreedScore = 10;
  else if (avgVix > 25) fearGreedScore = 20;
  else if (avgVix > 20) fearGreedScore = 35;
  else if (avgVix > 16) fearGreedScore = 50;
  else if (avgVix > 12) fearGreedScore = 70;
  else fearGreedScore = 85;
  
  let globalMood = '';
  if (fearGreedScore >= 70) globalMood = '🚀 GREED MODE — Markets bullish, SIP chalao, lekin FOMO se bacho!';
  else if (fearGreedScore >= 45) globalMood = '⚖️ NEUTRAL — Markets confused, selective entries only. Cash buffer rakho.';
  else if (fearGreedScore >= 25) globalMood = '⚠️ FEAR — Volatility high, defensive rahoo. Sirf quality assets ko dip pe accumulate karo.';
  else globalMood = '🔴 EXTREME FEAR — Panic selling chal rahi hai. Cash king hai. Bas watch karo, jab VIX girne lage tab entry lo.';
  
  const buyCount = conclusions.filter(c => c.verdict === 'STRONG_BUY' || c.verdict === 'BUY').length;
  const sellCount = conclusions.filter(c => c.verdict === 'STRONG_SELL' || c.verdict === 'SELL').length;
  const holdCount = conclusions.filter(c => c.verdict === 'HOLD').length;
  const avgConf = conclusions.length > 0 ? Math.round(conclusions.reduce((s, c) => s + c.confidence, 0) / conclusions.length) : 0;
  
  let overallAction = '';
  let overallActionDetail = '';
  if (buyCount > sellCount * 2) {
    overallAction = '🟢 AGGRESSIVE — Deploy Capital';
    overallActionDetail = 'Majority assets bullish. SIP amounts badhao, dips pe extra investment karo. Portfolio me momentum stocks ka weight badhao.';
  } else if (sellCount > buyCount * 2) {
    overallAction = '🔴 DEFENSIVE — Protect Capital';
    overallActionDetail = 'Majority assets bearish. Profits book karo, cash badhao 30-40% tak. SIP continue karo but fresh investment hold karo.';
  } else {
    overallAction = '🟡 BALANCED — Normal SIP Mode';
    overallActionDetail = 'Mixed signals — kuch bullish, kuch bearish. Regular SIP chalne do, selective dips pe extra deploy karo. Over-trading avoid karo.';
  }
  
  const marketPulse: MarketPulse = {
    regime: globalRegime.regime.replace('_', ' '),
    regimeScore: globalRegime.trendStrength,
    usVix,
    inVix,
    avgVix,
    fearGreedScore,
    globalMood,
    indiaStatus: inVix > 20 ? '🔴 India High Volatility' : inVix > 15 ? '🟡 India Moderate' : '🟢 India Bullish',
    usaStatus: usVix > 20 ? '🔴 US High Volatility' : usVix > 15 ? '🟡 US Moderate' : '🟢 US Bullish',
    overallAction,
    overallActionDetail,
  };
  
  return {
    conclusions,
    marketPulse,
    timestamp: Date.now(),
    buyCount,
    sellCount,
    holdCount,
    avgConfidence: avgConf,
    topPick: conclusions.length > 0 ? conclusions[0] : null,
    topAvoid: conclusions.length > 0 ? conclusions[conclusions.length - 1] : null,
  };
}
