// ============================================================
// Wealth AI Pro — MCP AI Agent Planner & Allocation Engine
// ------------------------------------------------------------
// Dynamically optimizes multi-asset investment distribution based
// on User Investment Amount, Real-Time Live Prices, SuperScore v6.0,
// RSI Momentum, 20/50 SMA Trend, MACD, and Market Regimes.
//
// Curated Assets Universe:
//   INDIA: MOMENTUM50, SMALLCAP, MID150BEES, JUNIORBEES, SETFNIF50
//   USA:   SMH, VOOG, MU, SPCX, VGT
//   CRYPTO: BTC, ETH
// ============================================================

import { PriceData } from '../types';
import { DEFAULT_USD_INR, formatCurrency, formatPrice } from './constants';
import { computeUnifiedEntry } from './entryPriceEngine';

export type MCPPlannerAgentModel =
  | 'QUANTUM_ALPHA'
  | 'BALANCED_PARITY'
  | 'AGGRESSIVE_MOMENTUM'
  | 'DEEP_DIP_HUNTER';

export interface MCPAgentModelInfo {
  id: MCPPlannerAgentModel;
  name: string;
  emoji: string;
  badge: string;
  color: string;
  bg: string;
  border: string;
  description: string;
}

export const MCP_AGENT_MODELS: MCPAgentModelInfo[] = [
  {
    id: 'QUANTUM_ALPHA',
    name: 'Quantum Alpha Agent',
    emoji: '🤖',
    badge: 'SUPERSCORE v6 + REGIME',
    color: 'text-cyan-400',
    bg: 'bg-cyan-500/10',
    border: 'border-cyan-500/30',
    description: 'Dynamically tilts capital toward high SuperScore & value zones while maintaining strong compound growth.'
  },
  {
    id: 'BALANCED_PARITY',
    name: 'Balanced Parity Agent',
    emoji: '🛡️',
    badge: 'EQUAL-RISK DIVERSITY',
    color: 'text-emerald-400',
    bg: 'bg-emerald-500/10',
    border: 'border-emerald-500/30',
    description: 'Stabilizes risk across India broad growth, US tech powerhouses, and digital gold with lower volatility.'
  },
  {
    id: 'AGGRESSIVE_MOMENTUM',
    name: 'Aggressive Momentum Agent',
    emoji: '🚀',
    badge: 'MOMENTUM & BREAKOUTS',
    color: 'text-purple-400',
    bg: 'bg-purple-500/10',
    border: 'border-purple-500/30',
    description: 'Overweights high-momentum leaders (MOMENTUM50, SMH, MU, VGT) with trailing risk stops.'
  },
  {
    id: 'DEEP_DIP_HUNTER',
    name: 'Deep Dip Hunter Agent',
    emoji: '💎',
    badge: 'VALUE & ACCUMULATION',
    color: 'text-amber-400',
    bg: 'bg-amber-500/10',
    border: 'border-amber-500/30',
    description: 'Aggressively loads capital into whichever assets are currently at the deepest discounts / oversold levels.'
  }
];

export interface MCPAssetAllocation {
  symbol: string;
  name: string;
  market: 'IN' | 'US';
  category: string;
  emoji: string;
  currentPrice: number;
  priceINR: number;
  change24h: number;
  rsi: number;
  superScore: number;
  superScoreTier: 'TOP_BUY' | 'ACCUMULATE' | 'NEUTRAL' | 'CAUTION';
  signal: '💎 STRONG BUY' | '🟢 BUY NOW' | '🟢 ACCUMULATE' | '🟡 WAIT FOR DIP' | '🔴 OVERBOUGHT';
  baseWeight: number;
  dynamicWeight: number;
  allocPct: number;              // 0.0 to 1.0 (normalized)
  allocAmountINR: number;        // in INR
  allocAmountNative: number;     // ₹ or $
  targetUnits: number;           // shares or coins to buy
  targetEntry: number;
  entryZone: string;
  stopLoss: number;
  target1: number;
  target2: number;
  targetLongTerm3Yr: number;
  riskReward: number;
  trend: 'BULLISH ⚡' | 'NEUTRAL ↔' | 'CORRECTION ⚠️';
  convictionScore: number;       // 1-100
  aiThesis: string;
}

export interface MCPPlannerSummary {
  agentModel: MCPPlannerAgentModel;
  agentInfo: MCPAgentModelInfo;
  investmentAmountINR: number;
  investmentType: 'SIP' | 'LUMPSUM';
  marketFocus: 'ALL' | 'IN' | 'US' | 'CRYPTO';
  totalAllocatedINR: number;
  indiaAllocINR: number;
  usaAllocINR: number;
  usaAllocUSD: number;
  cryptoAllocINR: number;
  usdInrRate: number;
  averageSuperScore: number;
  highestConvictionAsset: string;
  topBuyCount: number;
  allocations: MCPAssetAllocation[];
  marketRegime: {
    inVix: number;
    usVix: number;
    narrative: string;
  };
  generatedAt: number;
}

/**
 * SuperScore pure calculation
 */
export function computeAssetSuperScore(pd?: PriceData): number {
  if (!pd || !pd.price) return 50;
  const price = pd.price;
  const rsi = pd.rsi ?? 50;
  const change = pd.change ?? 0;
  let score = 50;

  // RSI component (35%)
  if (rsi < 30) score += 22;
  else if (rsi < 40) score += 12;
  else if (rsi < 50) score += 5;
  else if (rsi > 75) score -= 20;
  else if (rsi > 65) score -= 10;

  // Trend component (25%)
  if (pd.sma20 && pd.sma50 && pd.sma50 > 0) {
    const div = ((pd.sma20 - pd.sma50) / pd.sma50) * 100;
    score += Math.max(-15, Math.min(15, div * 3));
  }

  // MACD component (15%)
  if (pd.macd !== undefined) {
    score += pd.macd > 0 ? 8 : -8;
  }

  // Day range position (15%)
  const hi = pd.high ?? price;
  const lo = pd.low ?? price;
  if (hi > lo) {
    const pos = (price - lo) / (hi - lo);
    score += (0.5 - pos) * 12;
  }

  // Anti-chasing momentum (10%)
  if (change > 4) score -= 6;
  else if (change > 0) score += 2;
  else if (change < -4) score += 6;
  else score += 4;

  return Math.max(5, Math.min(99, Math.round(score)));
}

/**
 * Main Planner AI Optimization Engine
 */
export function computeMCPPlannerAllocations(
  livePrices: Record<string, PriceData>,
  investmentAmountINR: number = 25000,
  options: {
    agentModel?: MCPPlannerAgentModel;
    investmentType?: 'SIP' | 'LUMPSUM';
    marketFocus?: 'ALL' | 'IN' | 'US' | 'CRYPTO';
    usdInrRate?: number;
  } = {}
): MCPPlannerSummary {
  const {
    agentModel = 'QUANTUM_ALPHA',
    investmentType = 'SIP',
    marketFocus = 'ALL',
    usdInrRate = DEFAULT_USD_INR
  } = options;

  const agentInfo = MCP_AGENT_MODELS.find(m => m.id === agentModel) || MCP_AGENT_MODELS[0];

  // Market VIX readings
  const inVix = livePrices['IN_INDIAVIX']?.price || 14.2;
  const usVix = livePrices['US_VIX']?.price || 15.5;

  // Asset Universe Construction
  const assetSpecs: Array<{
    symbol: string;
    name: string;
    market: 'IN' | 'US';
    category: string;
    emoji: string;
    baseWeight: number;
    cagr: number;
    maxDD: number;
  }> = [
    // 🇮🇳 INDIA (5 Curated Alpha Assets)
    { symbol: 'MOMENTUM50', name: 'Motilal Oswal Nifty 500 Momentum 50', market: 'IN', category: 'Smart Beta Factor', emoji: '🇮🇳', baseWeight: 0.28, cagr: 22.5, maxDD: 30 },
    { symbol: 'SMALLCAP', name: 'Nippon India Nifty Smallcap 250', market: 'IN', category: 'High Growth Smallcap', emoji: '🇮🇳', baseWeight: 0.22, cagr: 24.5, maxDD: 40 },
    { symbol: 'MID150BEES', name: 'Nippon India Nifty Midcap 150', market: 'IN', category: 'Midcap Alpha Growth', emoji: '🇮🇳', baseWeight: 0.20, cagr: 21.0, maxDD: 35 },
    { symbol: 'JUNIORBEES', name: 'Nippon India ETF Junior BeES', market: 'IN', category: 'Nifty Next 50 Alpha', emoji: '🇮🇳', baseWeight: 0.18, cagr: 18.5, maxDD: 30 },
    { symbol: 'SETFNIF50', name: 'SBI ETF Nifty 50', market: 'IN', category: 'Core Nifty 50 Large Cap', emoji: '🇮🇳', baseWeight: 0.12, cagr: 14.0, maxDD: 25 },

    // 🇺🇸 USA (5 Curated Growth & Alpha Assets)
    { symbol: 'SMH', name: 'VanEck Semiconductor ETF', market: 'US', category: 'Semiconductor / AI Alpha', emoji: '🇺🇸', baseWeight: 0.30, cagr: 28.5, maxDD: 45 },
    { symbol: 'VOOG', name: 'Vanguard S&P 500 Growth ETF', market: 'US', category: 'US Mega Cap Growth', emoji: '🇺🇸', baseWeight: 0.25, cagr: 18.5, maxDD: 32 },
    { symbol: 'MU', name: 'Micron Technology Inc', market: 'US', category: 'AI Memory & Chip Alpha', emoji: '🇺🇸', baseWeight: 0.15, cagr: 24.0, maxDD: 45 },
    { symbol: 'SPCX', name: 'The SPAC and New Issue ETF', market: 'US', category: 'Tech Alpha & Innovation', emoji: '🇺🇸', baseWeight: 0.10, cagr: 18.0, maxDD: 38 },
    { symbol: 'VGT', name: 'Vanguard Information Technology ETF', market: 'US', category: 'Broad Tech Powerhouse', emoji: '🇺🇸', baseWeight: 0.20, cagr: 21.5, maxDD: 35 },

    // 🪙 CRYPTO (Digital Gold & Smart Contracts)
    { symbol: 'BTC', name: 'Bitcoin (Digital Gold)', market: 'IN', category: 'Digital Store of Value', emoji: '🪙', baseWeight: 0.65, cagr: 50.0, maxDD: 65 },
    { symbol: 'ETH', name: 'Ethereum (Web3 Ecosystem)', market: 'IN', category: 'Smart Contract Alpha', emoji: '🪙', baseWeight: 0.35, cagr: 42.0, maxDD: 70 },
  ];

  // Filter based on marketFocus
  let activeSpecs = assetSpecs;
  if (marketFocus === 'IN') {
    activeSpecs = assetSpecs.filter(a => a.market === 'IN' && !['BTC', 'ETH'].includes(a.symbol));
  } else if (marketFocus === 'US') {
    activeSpecs = assetSpecs.filter(a => a.market === 'US');
  } else if (marketFocus === 'CRYPTO') {
    activeSpecs = assetSpecs.filter(a => ['BTC', 'ETH'].includes(a.symbol));
  }

  const rawAllocations: MCPAssetAllocation[] = [];

  for (const spec of activeSpecs) {
    const key = `${spec.market}_${spec.symbol}`;
    const altKey = `${spec.market}_${spec.symbol}.NS`;
    const pd = livePrices[key] || livePrices[altKey];

    // Fallback price if not yet loaded in feed
    let price = pd?.price || 0;
    if (price <= 0) {
      if (spec.symbol === 'MOMENTUM50') price = 68.5;
      else if (spec.symbol === 'SMALLCAP') price = 185.0;
      else if (spec.symbol === 'MID150BEES') price = 22.4;
      else if (spec.symbol === 'JUNIORBEES') price = 685.0;
      else if (spec.symbol === 'SETFNIF50') price = 265.0;
      else if (spec.symbol === 'SMH') price = 280.0;
      else if (spec.symbol === 'VOOG') price = 365.0;
      else if (spec.symbol === 'MU') price = 125.0;
      else if (spec.symbol === 'SPCX') price = 32.0;
      else if (spec.symbol === 'VGT') price = 590.0;
      else if (spec.symbol === 'BTC') price = 7800000;
      else if (spec.symbol === 'ETH') price = 280000;
    }

    const priceINR = spec.market === 'US' ? price * usdInrRate : price;
    const change24h = pd?.change || 0;
    const rsi = pd?.rsi || 50;
    const superScore = computeAssetSuperScore(pd);

    const sma20 = pd?.sma20 || (price * 0.98);
    const sma50 = pd?.sma50 || (price * 0.95);
    const macd = pd?.macd;
    const isBull = sma20 > sma50;
    const hasMACD = macd !== undefined ? macd > 0 : false;

    // Trend Direction
    let trend: 'BULLISH ⚡' | 'NEUTRAL ↔' | 'CORRECTION ⚠️' = 'NEUTRAL ↔';
    if (isBull && hasMACD && rsi < 65) trend = 'BULLISH ⚡';
    else if (!isBull && (rsi < 40 || change24h < -2)) trend = 'CORRECTION ⚠️';

    // Quantitative Entry / Stop / Targets
    const unified = pd && pd.price > 0 ? computeUnifiedEntry(pd) : null;
    const targetEntry = unified ? unified.optimal : (rsi < 40 ? price * 0.97 : price * 0.99);
    const stopLoss = unified ? unified.stopLoss : (price * 0.91);
    const target1 = unified ? unified.target1 : (price * 1.10);
    const target2 = unified ? unified.target2 : (price * 1.25);
    const targetLongTerm3Yr = price * Math.pow(1 + (spec.cagr / 100), 3);
    const risk = Math.max(0.01, Math.abs(targetEntry - stopLoss));
    const reward = Math.abs(target1 - targetEntry);
    const riskReward = +(reward / risk).toFixed(2);

    // SuperScore Tier
    let superScoreTier: MCPAssetAllocation['superScoreTier'] = 'NEUTRAL';
    let signal: MCPAssetAllocation['signal'] = '🟡 WAIT FOR DIP';
    if (superScore >= 72 || rsi < 33) {
      superScoreTier = 'TOP_BUY';
      signal = '💎 STRONG BUY';
    } else if (superScore >= 60 || (isBull && rsi < 52)) {
      superScoreTier = 'ACCUMULATE';
      signal = '🟢 BUY NOW';
    } else if (superScore >= 45 || isBull) {
      superScoreTier = 'NEUTRAL';
      signal = '🟢 ACCUMULATE';
    } else if (rsi > 72 || superScore <= 32) {
      superScoreTier = 'CAUTION';
      signal = '🔴 OVERBOUGHT';
    }

    // Dynamic Multiplier based on Agent Model
    let agentMultiplier = 1.0;
    let aiThesis = '';

    switch (agentModel) {
      case 'QUANTUM_ALPHA': {
        // SuperScore + Dip Value weighted
        if (superScore >= 70) agentMultiplier = 1.45;
        else if (superScore >= 60) agentMultiplier = 1.20;
        else if (superScore <= 35) agentMultiplier = 0.55;
        else if (superScore <= 45) agentMultiplier = 0.80;

        aiThesis = superScore >= 65
          ? `SuperScore ${superScore}/99 high conviction. RSI ${Math.round(rsi)} accumulation zone active.`
          : superScore <= 38
          ? `SuperScore ${superScore}/99 caution. Asset near resistance, smaller weight assigned.`
          : `Healthy baseline compounding. Trend ${isBull ? 'positive' : 'consolidating'}.`;
        break;
      }
      case 'BALANCED_PARITY': {
        // Equal risk parity & lower drawdown sensitivity
        const riskFactor = spec.maxDD > 35 ? 0.85 : 1.15;
        agentMultiplier = riskFactor;
        aiThesis = `Balanced risk parity. Max drawdown factor ${spec.maxDD}% scaled for portfolio stability.`;
        break;
      }
      case 'AGGRESSIVE_MOMENTUM': {
        // Boost highest beta & trend momentum
        if (['MOMENTUM50', 'SMH', 'MU', 'VGT'].includes(spec.symbol)) {
          agentMultiplier = isBull ? 1.60 : 1.25;
          aiThesis = `High-alpha momentum leader. Trend strength aligned for maximum capital growth.`;
        } else if (['SETFNIF50', 'VOOG'].includes(spec.symbol)) {
          agentMultiplier = 0.70;
          aiThesis = `Core index buffer. Scaled down to overweight high-beta alpha.`;
        } else {
          agentMultiplier = 1.0;
          aiThesis = `Momentum follow-through steady.`;
        }
        break;
      }
      case 'DEEP_DIP_HUNTER': {
        // Max weight on lowest RSI / deepest dip
        if (rsi < 35 || change24h < -2.5) {
          agentMultiplier = 1.80;
          aiThesis = `🔥 DEEP VALUE DIP ALERT: RSI ${Math.round(rsi)} heavily oversold. Maximum capital allocated!`;
        } else if (rsi < 45) {
          agentMultiplier = 1.30;
          aiThesis = `Favorable discount zone. Sizing up on temporary pullback.`;
        } else if (rsi > 65) {
          agentMultiplier = 0.40;
          aiThesis = `Asset extended (RSI ${Math.round(rsi)}). Minimum weight until healthy dip.`;
        } else {
          agentMultiplier = 0.85;
          aiThesis = `Neutral valuation range.`;
        }
        break;
      }
    }

    const dynamicWeight = spec.baseWeight * agentMultiplier;
    const convictionScore = Math.min(99, Math.max(20, Math.round(superScore * 0.7 + (100 - rsi) * 0.3)));

    const entryZone = `${formatPrice(targetEntry * 0.99, spec.market === 'IN' ? '₹' : '$')} - ${formatPrice(targetEntry * 1.01, spec.market === 'IN' ? '₹' : '$')}`;

    rawAllocations.push({
      symbol: spec.symbol,
      name: spec.name,
      market: spec.market,
      category: spec.category,
      emoji: spec.emoji,
      currentPrice: price,
      priceINR,
      change24h,
      rsi: Math.round(rsi),
      superScore,
      superScoreTier,
      signal,
      baseWeight: spec.baseWeight,
      dynamicWeight,
      allocPct: 0,
      allocAmountINR: 0,
      allocAmountNative: 0,
      targetUnits: 0,
      targetEntry: +targetEntry.toFixed(2),
      entryZone,
      stopLoss: +stopLoss.toFixed(2),
      target1: +target1.toFixed(2),
      target2: +target2.toFixed(2),
      targetLongTerm3Yr: +targetLongTerm3Yr.toFixed(2),
      riskReward,
      trend,
      convictionScore,
      aiThesis
    });
  }

  // Normalize Allocations across markets
  // If ALL selected, split capital by asset class buckets:
  //   India: ~50%
  //   USA:   ~40%
  //   Crypto:~10%
  if (marketFocus === 'ALL') {
    const inAssets = rawAllocations.filter(a => a.market === 'IN' && !['BTC', 'ETH'].includes(a.symbol));
    const usAssets = rawAllocations.filter(a => a.market === 'US');
    const cryptoAssets = rawAllocations.filter(a => ['BTC', 'ETH'].includes(a.symbol));

    const normalizeBucket = (bucket: MCPAssetAllocation[], bucketTargetINR: number) => {
      const totalDyn = bucket.reduce((s, a) => s + a.dynamicWeight, 0) || 1;
      bucket.forEach(a => {
        const pctInBucket = a.dynamicWeight / totalDyn;
        a.allocAmountINR = Math.round(bucketTargetINR * pctInBucket);
        a.allocPct = investmentAmountINR > 0 ? +(a.allocAmountINR / investmentAmountINR).toFixed(4) : 0;
        a.allocAmountNative = a.market === 'US'
          ? +(a.allocAmountINR / usdInrRate).toFixed(2)
          : a.allocAmountINR;
        
        // Exact unit sizing
        if (a.market === 'US') {
          a.targetUnits = +(a.allocAmountNative / (a.currentPrice || 1)).toFixed(2);
        } else if (['BTC', 'ETH'].includes(a.symbol)) {
          a.targetUnits = +(a.allocAmountINR / (a.priceINR || 1)).toFixed(6);
        } else {
          a.targetUnits = Math.max(1, Math.floor(a.allocAmountINR / (a.currentPrice || 1)));
        }
      });
    };

    const inBudget = Math.round(investmentAmountINR * 0.52);
    const usBudget = Math.round(investmentAmountINR * 0.38);
    const cryptoBudget = Math.max(0, investmentAmountINR - inBudget - usBudget);

    normalizeBucket(inAssets, inBudget);
    normalizeBucket(usAssets, usBudget);
    normalizeBucket(cryptoAssets, cryptoBudget);
  } else {
    // Single Market Focus
    const totalDyn = rawAllocations.reduce((s, a) => s + a.dynamicWeight, 0) || 1;
    rawAllocations.forEach(a => {
      a.allocPct = +(a.dynamicWeight / totalDyn).toFixed(4);
      a.allocAmountINR = Math.round(investmentAmountINR * a.allocPct);
      a.allocAmountNative = a.market === 'US'
        ? +(a.allocAmountINR / usdInrRate).toFixed(2)
        : a.allocAmountINR;

      if (a.market === 'US') {
        a.targetUnits = +(a.allocAmountNative / (a.currentPrice || 1)).toFixed(2);
      } else if (['BTC', 'ETH'].includes(a.symbol)) {
        a.targetUnits = +(a.allocAmountINR / (a.priceINR || 1)).toFixed(6);
      } else {
        a.targetUnits = Math.max(1, Math.floor(a.allocAmountINR / (a.currentPrice || 1)));
      }
    });
  }

  // Sort by highest allocation amount & SuperScore
  rawAllocations.sort((a, b) => b.allocAmountINR - a.allocAmountINR);

  const totalAllocatedINR = rawAllocations.reduce((s, a) => s + a.allocAmountINR, 0);
  const indiaAllocINR = rawAllocations.filter(a => a.market === 'IN' && !['BTC', 'ETH'].includes(a.symbol)).reduce((s, a) => s + a.allocAmountINR, 0);
  const usaAllocINR = rawAllocations.filter(a => a.market === 'US').reduce((s, a) => s + a.allocAmountINR, 0);
  const cryptoAllocINR = rawAllocations.filter(a => ['BTC', 'ETH'].includes(a.symbol)).reduce((s, a) => s + a.allocAmountINR, 0);
  const usaAllocUSD = +(usaAllocINR / usdInrRate).toFixed(2);

  const avgScore = rawAllocations.length > 0
    ? Math.round(rawAllocations.reduce((s, a) => s + a.superScore, 0) / rawAllocations.length)
    : 50;

  const topBuyCount = rawAllocations.filter(a => a.signal.includes('STRONG') || a.signal.includes('BUY NOW')).length;
  const highestConvictionAsset = rawAllocations[0]?.symbol || 'MOMENTUM50';

  return {
    agentModel,
    agentInfo,
    investmentAmountINR,
    investmentType,
    marketFocus,
    totalAllocatedINR,
    indiaAllocINR,
    usaAllocINR,
    usaAllocUSD,
    cryptoAllocINR,
    usdInrRate,
    averageSuperScore: avgScore,
    highestConvictionAsset,
    topBuyCount,
    allocations: rawAllocations,
    marketRegime: {
      inVix,
      usVix,
      narrative: inVix < 15 && usVix < 16
        ? 'Low Volatility Goldilocks Regime — Highly favorable for systematic alpha compounding.'
        : 'Elevated Volatility — Maintain discipline and buy only within designated entry zones.'
    },
    generatedAt: Date.now()
  };
}

/**
 * Format order execution sheet for copy & paste
 */
export function formatBrokerOrderSheet(summary: MCPPlannerSummary): string {
  let text = `📋 SMARTAI MCP BROKER ORDER SHEET\n`;
  text += `Mode: ${summary.agentInfo.name} | Total: ${formatCurrency(summary.investmentAmountINR)}\n`;
  text += `Generated: ${new Date(summary.generatedAt).toLocaleString('en-IN')}\n`;
  text += `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n`;

  const inItems = summary.allocations.filter(a => a.market === 'IN' && !['BTC', 'ETH'].includes(a.symbol));
  if (inItems.length > 0) {
    text += `🇮🇳 INDIA ASSETS (NSE/BSE):\n`;
    inItems.forEach(a => {
      text += `• ${a.symbol.padEnd(12)}: BUY ${String(a.targetUnits).padStart(4)} units @ ₹${a.currentPrice.toFixed(2)} = ₹${a.allocAmountINR.toLocaleString('en-IN')} (SL: ₹${a.stopLoss} | T1: ₹${a.target1})\n`;
    });
    text += `  Subtotal: ₹${summary.indiaAllocINR.toLocaleString('en-IN')}\n\n`;
  }

  const usItems = summary.allocations.filter(a => a.market === 'US');
  if (usItems.length > 0) {
    text += `🇺🇸 USA ASSETS (INDmoney/Vested/Interactive Brokers):\n`;
    usItems.forEach(a => {
      text += `• ${a.symbol.padEnd(6)}: BUY $${a.allocAmountNative.toFixed(2)} (~${a.targetUnits} shs @ $${a.currentPrice.toFixed(2)}) = ₹${a.allocAmountINR.toLocaleString('en-IN')}\n`;
    });
    text += `  Subtotal: $${summary.usaAllocUSD} (₹${summary.usaAllocINR.toLocaleString('en-IN')})\n\n`;
  }

  const cryptoItems = summary.allocations.filter(a => ['BTC', 'ETH'].includes(a.symbol));
  if (cryptoItems.length > 0) {
    text += `🪙 CRYPTO ASSETS (CoinDCX / Binance):\n`;
    cryptoItems.forEach(a => {
      text += `• ${a.symbol.padEnd(6)}: BUY ${a.targetUnits} ${a.symbol} = ₹${a.allocAmountINR.toLocaleString('en-IN')} @ ₹${a.priceINR.toLocaleString('en-IN')}\n`;
    });
    text += `  Subtotal: ₹${summary.cryptoAllocINR.toLocaleString('en-IN')}\n\n`;
  }

  text += `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`;
  text += `⚡ Total Deployment: ₹${summary.totalAllocatedINR.toLocaleString('en-IN')} across ${summary.allocations.length} assets`;
  return text;
}

/**
 * Format plan for Telegram Dispatch
 */
export function formatPlannerTelegramReport(summary: MCPPlannerSummary): string {
  const fmt = (n: number) => `₹${Math.round(n).toLocaleString('en-IN')}`;
  let msg = `🎯 <b>WEALTH PLANNER MCP AI ALLOCATION</b>\n`;
  msg += `<b>Model:</b> ${summary.agentInfo.emoji} ${summary.agentInfo.name}\n`;
  msg += `<b>Total Capital:</b> ${fmt(summary.investmentAmountINR)} (${summary.investmentType})\n`;
  msg += `<b>Avg SuperScore:</b> <code>${summary.averageSuperScore}/99</code>\n`;
  msg += `<code>━━━━━━━━━━━━━━━━━━━━━━━</code>\n\n`;

  summary.allocations.forEach(a => {
    const cur = a.market === 'IN' ? '₹' : '$';
    msg += `<b>${a.emoji} ${a.symbol}</b> — <i>${a.signal}</i>\n`;
    msg += `   Alloc: <b>${fmt(a.allocAmountINR)}</b> (${(a.allocPct * 100).toFixed(0)}%) | Units: <b>${a.targetUnits}</b>\n`;
    msg += `   LTP: ${cur}${a.currentPrice.toFixed(2)} | Score: <b>${a.superScore}/99</b> | RSI: ${a.rsi}\n`;
    msg += `   Target Entry: ${a.entryZone} | SL: ${cur}${a.stopLoss}\n`;
    msg += `   <i>Note: ${a.aiThesis}</i>\n\n`;
  });

  msg += `<b>📊 SPLIT:</b>\n`;
  msg += `🇮🇳 India: ${fmt(summary.indiaAllocINR)} | 🇺🇸 USA: $${summary.usaAllocUSD} (${fmt(summary.usaAllocINR)}) | 🪙 Crypto: ${fmt(summary.cryptoAllocINR)}\n`;
  msg += `<i>Regime: ${summary.marketRegime.narrative}</i>`;
  return msg;
}
