// ============================================
// WEALTH ENGINE — Long-Term Investment Intelligence
// XIRR | Milestones | Goals | Rebalancing | Weekly Reports
// ============================================

import { Position, PriceData } from '../types';
import { ALPHA_ETFS_IN, ALPHA_ETFS_US, formatCurrency } from './constants';

// ========== XIRR CALCULATOR (Newton-Raphson) ==========
interface CashFlow {
  amount: number; // negative = investment, positive = current value
  date: Date;
}

function xnpv(rate: number, flows: CashFlow[]): number {
  const d0 = flows[0].date.getTime();
  return flows.reduce((sum, cf) => {
    const years = (cf.date.getTime() - d0) / (365.25 * 24 * 60 * 60 * 1000);
    return sum + cf.amount / Math.pow(1 + rate, years);
  }, 0);
}

function xnpvDerivative(rate: number, flows: CashFlow[]): number {
  const d0 = flows[0].date.getTime();
  return flows.reduce((sum, cf) => {
    const years = (cf.date.getTime() - d0) / (365.25 * 24 * 60 * 60 * 1000);
    if (years === 0) return sum;
    return sum - years * cf.amount / Math.pow(1 + rate, years + 1);
  }, 0);
}

export function calculateXIRR(flows: CashFlow[], guess: number = 0.1, maxIter: number = 100, tol: number = 1e-7): number | null {
  if (flows.length < 2) return null;
  const hasNeg = flows.some(f => f.amount < 0);
  const hasPos = flows.some(f => f.amount > 0);
  if (!hasNeg || !hasPos) return null;

  let rate = guess;
  for (let i = 0; i < maxIter; i++) {
    const npv = xnpv(rate, flows);
    const dnpv = xnpvDerivative(rate, flows);
    if (Math.abs(dnpv) < 1e-12) break;
    const newRate = rate - npv / dnpv;
    if (Math.abs(newRate - rate) < tol) return newRate;
    rate = newRate;
    // Guard against divergence
    if (rate < -0.99 || rate > 10) break;
  }
  // Fallback: try bisection
  let lo = -0.5, hi = 5.0;
  for (let i = 0; i < 200; i++) {
    const mid = (lo + hi) / 2;
    const npv = xnpv(mid, flows);
    if (Math.abs(npv) < tol) return mid;
    if (xnpv(lo, flows) * npv < 0) hi = mid;
    else lo = mid;
  }
  return null;
}

export interface XIRRResult {
  symbol: string;
  market: string;
  xirr: number | null;      // annualized return %
  invested: number;
  currentValue: number;
  holdingDays: number;
}

export function calculatePortfolioXIRR(
  portfolio: Position[],
  livePrices: Record<string, PriceData>,
  usdInrRate: number
): { perAsset: XIRRResult[]; overallXIRR: number | null } {
  const today = new Date();
  const allFlows: CashFlow[] = [];
  const perAsset: XIRRResult[] = [];

  for (const p of portfolio) {
    const key = `${p.market}_${p.symbol}`;
    const curPrice = livePrices[key]?.price || p.avgPrice;
    const invested = p.avgPrice * p.qty;
    const currentValue = curPrice * p.qty;
    const buyDate = new Date(p.dateAdded || '2024-01-01');
    // FIX H6: `new Date(badString)` returns Invalid Date → getTime() is NaN →
    // Math.max(1, NaN) is NaN, which then poisoned the XIRR bisection and
    // surfaced as "NaN days held" in the UI. Fall back to 1 day when invalid.
    const buyMs = buyDate.getTime();
    const holdingDays = Number.isFinite(buyMs)
      ? Math.max(1, Math.round((today.getTime() - buyMs) / (24 * 60 * 60 * 1000)))
      : 1;

    // Convert US assets to INR for overall XIRR
    const investedInr = p.market === 'US' ? invested * usdInrRate : invested;
    const valueInr = p.market === 'US' ? currentValue * usdInrRate : currentValue;

    // Per-asset XIRR
    const assetFlows: CashFlow[] = [
      { amount: -invested, date: buyDate },
      { amount: currentValue, date: today }
    ];
    const assetXirr = calculateXIRR(assetFlows);

    perAsset.push({
      symbol: p.symbol,
      market: p.market,
      xirr: assetXirr !== null ? assetXirr * 100 : null,
      invested,
      currentValue,
      holdingDays
    });

    // Add to overall flows
    allFlows.push({ amount: -investedInr, date: buyDate });
    allFlows.push({ amount: valueInr, date: today });
  }

  // Calculate overall XIRR
  // Group flows: combine all buy flows and single terminal value
  const totalBuyFlows: CashFlow[] = [];
  let totalCurrentValue = 0;
  for (const p of portfolio) {
    const key = `${p.market}_${p.symbol}`;
    const curPrice = livePrices[key]?.price || p.avgPrice;
    const invested = p.avgPrice * p.qty;
    const currentValue = curPrice * p.qty;
    const buyDate = new Date(p.dateAdded || '2024-01-01');
    const investedInr = p.market === 'US' ? invested * usdInrRate : invested;
    const valueInr = p.market === 'US' ? currentValue * usdInrRate : currentValue;
    totalBuyFlows.push({ amount: -investedInr, date: buyDate });
    totalCurrentValue += valueInr;
  }
  totalBuyFlows.push({ amount: totalCurrentValue, date: today });

  // Sort by date
  totalBuyFlows.sort((a, b) => a.date.getTime() - b.date.getTime());
  const overallXIRR = totalBuyFlows.length >= 2 ? calculateXIRR(totalBuyFlows) : null;

  return {
    perAsset: perAsset.sort((a, b) => (b.xirr || 0) - (a.xirr || 0)),
    overallXIRR: overallXIRR !== null ? overallXIRR * 100 : null
  };
}

// ========== WEALTH MILESTONE TRACKER ==========
export interface WealthMilestone {
  target: number;
  label: string;
  emoji: string;
  yearsToReach: number | null;
  estimatedDate: string;
  reached: boolean;
  progress: number;  // 0-100
}

export function calculateWealthMilestones(
  currentValue: number,
  monthlySIP: number,
  cagrPercent: number,
  sipStepUpPercent: number = 10
): WealthMilestone[] {
  const milestones = [
    { target: 1000000, label: '₹10 Lakh', emoji: '🥉' },
    { target: 2500000, label: '₹25 Lakh', emoji: '🥈' },
    { target: 5000000, label: '₹50 Lakh', emoji: '🥇' },
    { target: 10000000, label: '₹1 Crore', emoji: '💎' },
    { target: 25000000, label: '₹2.5 Crore', emoji: '👑' },
    { target: 50000000, label: '₹5 Crore', emoji: '🏆' },
    { target: 100000000, label: '₹10 Crore', emoji: '🚀' },
  ];

  const monthlyRate = cagrPercent / 100 / 12;
  const annualStepUp = sipStepUpPercent / 100;

  return milestones.map(m => {
    if (currentValue >= m.target) {
      return { ...m, yearsToReach: 0, estimatedDate: 'Achieved! ✅', reached: true, progress: 100 };
    }

    // Simulate year-by-year with SIP step-up
    let wealth = currentValue;
    let sip = monthlySIP;
    let years = 0;
    const maxYears = 50;

    while (wealth < m.target && years < maxYears) {
      for (let month = 0; month < 12; month++) {
        wealth = (wealth + sip) * (1 + monthlyRate);
      }
      years++;
      sip *= (1 + annualStepUp);
    }

    if (years >= maxYears) {
      return { ...m, yearsToReach: null, estimatedDate: '50+ years', reached: false, progress: Math.min(99, (currentValue / m.target) * 100) };
    }

    const now = new Date();
    const estDate = new Date(now.getFullYear() + years, now.getMonth(), 1);
    const dateStr = estDate.toLocaleDateString('en-IN', { month: 'short', year: 'numeric' });

    return {
      ...m,
      yearsToReach: years,
      estimatedDate: dateStr,
      reached: false,
      progress: Math.min(99, (currentValue / m.target) * 100)
    };
  });
}

// ========== SIP STEP-UP COMPARISON ==========
export interface SIPStepUpScenario {
  label: string;
  stepUpPercent: number;
  finalWealth: number;
  totalInvested: number;
  wealthGain: number;
  multiplier: number;
}

export function compareSIPStepUps(
  monthlySIP: number,
  investYears: number,
  cagrPercent: number
): SIPStepUpScenario[] {
  const scenarios = [
    { label: 'Flat SIP (0%)', stepUpPercent: 0 },
    { label: '5% Step-Up', stepUpPercent: 5 },
    { label: '10% Step-Up', stepUpPercent: 10 },
    { label: '15% Step-Up', stepUpPercent: 15 },
    { label: '20% Step-Up', stepUpPercent: 20 },
  ];

  const monthlyRate = cagrPercent / 100 / 12;

  return scenarios.map(s => {
    let wealth = 0;
    let totalInvested = 0;
    let currentSip = monthlySIP;

    for (let year = 0; year < investYears; year++) {
      for (let month = 0; month < 12; month++) {
        wealth = (wealth + currentSip) * (1 + monthlyRate);
        totalInvested += currentSip;
      }
      currentSip *= (1 + s.stepUpPercent / 100);
    }

    return {
      label: s.label,
      stepUpPercent: s.stepUpPercent,
      finalWealth: Math.round(wealth),
      totalInvested: Math.round(totalInvested),
      wealthGain: Math.round(wealth - totalInvested),
      multiplier: totalInvested > 0 ? Math.round((wealth / totalInvested) * 10) / 10 : 0
    };
  });
}

// ========== GOAL-BASED PLANNER ==========
export interface InvestmentGoal {
  id: string;
  name: string;
  emoji: string;
  targetAmount: number;
  targetYear: number;
  priority: 'HIGH' | 'MEDIUM' | 'LOW';
}

export interface GoalAnalysis extends InvestmentGoal {
  yearsLeft: number;
  monthlyNeeded: number;
  currentSipCovers: boolean;
  gap: number;
  progress: number;
  feasibility: 'ON_TRACK' | 'NEEDS_MORE' | 'AT_RISK';
}

export function analyzeGoals(
  goals: InvestmentGoal[],
  currentPortfolioValue: number,
  monthlySIP: number,
  cagrPercent: number
): GoalAnalysis[] {
  const now = new Date();
  const currentYear = now.getFullYear();
  const monthlyRate = cagrPercent / 100 / 12;

  return goals.map(goal => {
    const yearsLeft = Math.max(0, goal.targetYear - currentYear);
    const monthsLeft = yearsLeft * 12;

    // Monthly SIP needed to reach this goal from scratch
    let monthlyNeeded = 0;
    if (monthsLeft > 0 && monthlyRate > 0) {
      // FV = PMT * ((1+r)^n - 1) / r * (1+r) → PMT = FV * r / ((1+r)^n - 1) / (1+r)
      const factor = (Math.pow(1 + monthlyRate, monthsLeft) - 1) / monthlyRate * (1 + monthlyRate);
      monthlyNeeded = factor > 0 ? goal.targetAmount / factor : goal.targetAmount;
    } else {
      monthlyNeeded = goal.targetAmount;
    }

    // What current SIP will produce in yearsLeft
    const projectedWealth = monthlySIP > 0 && monthsLeft > 0
      ? monthlySIP * (Math.pow(1 + monthlyRate, monthsLeft) - 1) / monthlyRate * (1 + monthlyRate)
      : currentPortfolioValue;

    const progress = Math.min(100, (projectedWealth / goal.targetAmount) * 100);
    const gap = Math.max(0, monthlyNeeded - monthlySIP);
    const currentSipCovers = monthlySIP >= monthlyNeeded;

    let feasibility: GoalAnalysis['feasibility'] = 'ON_TRACK';
    if (progress < 50 && yearsLeft < 5) feasibility = 'AT_RISK';
    else if (!currentSipCovers) feasibility = 'NEEDS_MORE';

    return {
      ...goal,
      yearsLeft,
      monthlyNeeded: Math.round(monthlyNeeded),
      currentSipCovers,
      gap: Math.round(gap),
      progress: Math.round(progress),
      feasibility
    };
  }).sort((a, b) => a.targetYear - b.targetYear);
}

// ========== DEFAULT GOALS ==========
export const DEFAULT_GOALS: InvestmentGoal[] = [
  { id: '1', name: 'Emergency Fund', emoji: '🛡️', targetAmount: 500000, targetYear: 2027, priority: 'HIGH' },
  { id: '2', name: 'Car Upgrade', emoji: '🚗', targetAmount: 1500000, targetYear: 2030, priority: 'MEDIUM' },
  { id: '3', name: 'House Down Payment', emoji: '🏠', targetAmount: 3000000, targetYear: 2032, priority: 'HIGH' },
  { id: '4', name: 'Child Education', emoji: '🎓', targetAmount: 5000000, targetYear: 2040, priority: 'HIGH' },
  { id: '5', name: 'Early Retirement', emoji: '🏖️', targetAmount: 50000000, targetYear: 2045, priority: 'HIGH' },
];

// ========== REBALANCING ALERTS ==========
export interface RebalanceItem {
  symbol: string;
  market: string;
  currentWeight: number;   // actual %
  targetWeight: number;    // ideal %
  drift: number;          // actual - target
  action: 'BUY_MORE' | 'TRIM' | 'OK';
  adjustAmount: number;   // ₹ to buy (+) or sell (-)
}

export function analyzeRebalancing(
  portfolio: Position[],
  livePrices: Record<string, PriceData>,
  usdInrRate: number
): RebalanceItem[] {
  if (portfolio.length === 0) return [];

  // Calculate current values in INR
  const items: { symbol: string; market: string; valueInr: number }[] = [];
  let totalValueInr = 0;

  for (const p of portfolio) {
    const key = `${p.market}_${p.symbol}`;
    const price = livePrices[key]?.price || p.avgPrice;
    const value = price * p.qty;
    const valueInr = p.market === 'US' ? value * usdInrRate : value;
    items.push({ symbol: p.symbol, market: p.market, valueInr });
    totalValueInr += valueInr;
  }

  if (totalValueInr <= 0) return [];

  // Target weights: equal-weight as default (simple & effective for long-term)
  const equalWeight = 100 / items.length;

  // For known ETFs, use their fixedAlloc as target
  const results: RebalanceItem[] = items.map(item => {
    const currentWeight = (item.valueInr / totalValueInr) * 100;

    // Find target from ETF configs or use equal weight
    let targetWeight = equalWeight;
    const inETF = ALPHA_ETFS_IN.find(e => e.sym === item.symbol);
    const usETF = ALPHA_ETFS_US.find(e => e.sym === item.symbol);
    if (inETF) targetWeight = inETF.fixedAlloc * 100;
    else if (usETF) targetWeight = usETF.fixedAlloc * 100;

    const drift = currentWeight - targetWeight;
    const adjustAmount = -(drift / 100) * totalValueInr;

    let action: RebalanceItem['action'] = 'OK';
    if (drift > 5) action = 'TRIM';
    else if (drift < -5) action = 'BUY_MORE';

    return {
      symbol: item.symbol,
      market: item.market,
      currentWeight: Math.round(currentWeight * 10) / 10,
      targetWeight: Math.round(targetWeight * 10) / 10,
      drift: Math.round(drift * 10) / 10,
      action,
      adjustAmount: Math.round(adjustAmount)
    };
  });

  return results.sort((a, b) => Math.abs(b.drift) - Math.abs(a.drift));
}

// ========== WEEKLY TELEGRAM WEALTH REPORT ==========
export function generateWeeklyWealthReport(
  portfolio: Position[],
  livePrices: Record<string, PriceData>,
  usdInrRate: number,
  metrics: { totalValue: number; totalInvested: number; totalPL: number; plPct: number; todayPL: number },
  monthlySIP: number,
  investYears: number,
  cagrPercent: number
): string {
  const now = new Date();
  const dateStr = now.toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata', weekday: 'long', day: '2-digit', month: 'short', year: 'numeric' });

  // Milestones
  const milestones = calculateWealthMilestones(metrics.totalValue, monthlySIP, cagrPercent);
  const nextMilestone = milestones.find(m => !m.reached);
  const achievedCount = milestones.filter(m => m.reached).length;

  // XIRR
  const xirrResult = calculatePortfolioXIRR(portfolio, livePrices, usdInrRate);
  const xirrStr = xirrResult.overallXIRR !== null ? `${xirrResult.overallXIRR.toFixed(1)}%` : 'N/A';

  // Top & Bottom performers
  const performers = xirrResult.perAsset.filter(a => a.xirr !== null);
  const topPerf = performers.slice(0, 3);
  const bottomPerf = [...performers].sort((a, b) => (a.xirr || 0) - (b.xirr || 0)).slice(0, 3);

  // Step-up projection
  const stepUp = compareSIPStepUps(monthlySIP, investYears, cagrPercent);
  const with10StepUp = stepUp.find(s => s.stepUpPercent === 10);

  // Rebalancing
  const rebalance = analyzeRebalancing(portfolio, livePrices, usdInrRate);
  const needsRebalance = rebalance.filter(r => r.action !== 'OK');

  let msg = `📊 <b>WEEKLY WEALTH REPORT</b>\n`;
  msg += `📅 <i>${dateStr}</i>\n`;
  msg += `━━━━━━━━━━━━━━━━━━━━━━━\n\n`;

  // Portfolio Summary
  msg += `💼 <b>Portfolio Snapshot</b>\n`;
  msg += `Current Equity: <b>₹${Math.round(metrics.totalValue).toLocaleString('en-IN')}</b>\n`;
  msg += `Total Invested: ₹${Math.round(metrics.totalInvested).toLocaleString('en-IN')}\n`;
  msg += `Total Return: <b>${metrics.totalPL >= 0 ? '+' : ''}₹${Math.round(metrics.totalPL).toLocaleString('en-IN')}</b> (${metrics.plPct >= 0 ? '+' : ''}${metrics.plPct.toFixed(2)}%)\n`;
  msg += `Portfolio XIRR: <b>${xirrStr}</b>\n\n`;

  // Milestone Progress
  msg += `🏆 <b>Milestone Progress</b>\n`;
  msg += `Milestones Achieved: ${achievedCount}/${milestones.length}\n`;
  if (nextMilestone) {
    msg += `Next Target: <b>${nextMilestone.label}</b> ${nextMilestone.emoji}\n`;
    msg += `Progress: ${nextMilestone.progress.toFixed(0)}% | ETA: ${nextMilestone.estimatedDate}\n`;
    const remaining = nextMilestone.target - metrics.totalValue;
    msg += `Remaining: ₹${Math.round(remaining).toLocaleString('en-IN')}\n`;
  }
  msg += '\n';

  // Top Performers
  if (topPerf.length > 0) {
    msg += `📈 <b>Top Performers (XIRR)</b>\n`;
    topPerf.forEach(p => {
      msg += `• ${p.symbol.replace('.NS', '')}: <b>${p.xirr !== null ? (p.xirr >= 0 ? '+' : '') + p.xirr.toFixed(1) + '%' : 'N/A'}</b>\n`;
    });
    msg += '\n';
  }

  // Bottom Performers
  if (bottomPerf.length > 0 && bottomPerf[0].xirr !== null && bottomPerf[0].xirr < 0) {
    msg += `📉 <b>Needs Attention</b>\n`;
    bottomPerf.filter(p => p.xirr !== null && p.xirr < 5).forEach(p => {
      msg += `• ${p.symbol.replace('.NS', '')}: ${p.xirr !== null ? (p.xirr >= 0 ? '+' : '') + p.xirr.toFixed(1) + '%' : 'N/A'}\n`;
    });
    msg += '\n';
  }

  // SIP Power
  msg += `💰 <b>SIP Intelligence</b>\n`;
  msg += `Monthly SIP: ₹${monthlySIP.toLocaleString('en-IN')}\n`;
  if (with10StepUp) {
    msg += `With 10% Step-Up (${investYears}yr): <b>${formatCurrency(with10StepUp.finalWealth)}</b> (${with10StepUp.multiplier}x)\n`;
  }
  msg += '\n';

  // Rebalancing
  if (needsRebalance.length > 0) {
    msg += `⚖️ <b>Rebalancing Needed</b>\n`;
    needsRebalance.slice(0, 4).forEach(r => {
      const action = r.action === 'BUY_MORE' ? '🟢 Buy' : '🔴 Trim';
      msg += `• ${r.symbol.replace('.NS', '')}: ${action} ₹${Math.abs(r.adjustAmount).toLocaleString('en-IN')} (drift: ${r.drift > 0 ? '+' : ''}${r.drift}%)\n`;
    });
    msg += '\n';
  }

  // Motivation
  const weeklyGrowth = metrics.totalValue * (cagrPercent / 100 / 52);
  msg += `🚀 <b>Weekly Growth Power</b>\n`;
  msg += `Your wealth grew ~₹${Math.round(weeklyGrowth).toLocaleString('en-IN')} this week via compounding!\n`;

  msg += `\n━━━━━━━━━━━━━━━━━━━━━━━\n`;
  msg += `<i>⚡ Wealth AI Pro — Weekly Intelligence Report</i>`;

  return msg;
}

// ========== INFLATION-ADJUSTED (REAL) VALUE ==========
export function adjustForInflation(nominalValue: number, years: number, inflationPct: number = 6): number {
  return nominalValue / Math.pow(1 + inflationPct / 100, years);
}

// ========== ADVANCED FIRE VARIANTS (Lean / Standard / Fat / Coast) ==========
export interface FireVariants {
  leanFire: number;     // 20x annual expenses (frugal retirement)
  standardFire: number; // 25x annual expenses (4% SWR)
  fatFire: number;      // 33x annual expenses (3% SWR, luxury)
  coastFire: number;    // corpus needed TODAY to coast to Standard FIRE with zero further SIP
  coastAchieved: boolean;
}

export function calculateFireVariants(
  monthlyExpenses: number,
  currentValue: number,
  currentAge: number,
  retireAge: number = 60,
  cagrPercent: number = 12,
  inflationPct: number = 6
): FireVariants {
  const annualExpenses = monthlyExpenses * 12;
  const yearsToRetire = Math.max(0, retireAge - currentAge);
  // Inflate expenses to retirement year for realistic corpus targets
  const futureAnnualExpenses = annualExpenses * Math.pow(1 + inflationPct / 100, yearsToRetire);

  const standardFire = futureAnnualExpenses * 25;
  const leanFire = futureAnnualExpenses * 20;
  const fatFire = futureAnnualExpenses * 33;

  // Coast FIRE = PV of Standard FIRE discounted at expected CAGR
  const coastFire = yearsToRetire > 0
    ? standardFire / Math.pow(1 + cagrPercent / 100, yearsToRetire)
    : standardFire;

  return {
    leanFire: Math.round(leanFire),
    standardFire: Math.round(standardFire),
    fatFire: Math.round(fatFire),
    coastFire: Math.round(coastFire),
    coastAchieved: currentValue >= coastFire
  };
}

// ========== CRYPTO DCA PLANNER (BTC/ETH SIP — HODL Strategy) ==========
export interface CryptoDCAProjection {
  asset: 'BTC' | 'ETH';
  monthlySIP: number;
  totalInvested: number;
  conservative: number;
  expected: number;
  conservativeCagr: number;
  expectedCagr: number;
}

export function planCryptoDCA(btcSIP: number, ethSIP: number, years: number): CryptoDCAProjection[] {
  const project = (sip: number, cagr: number) => {
    const r = cagr / 100 / 12;
    let wealth = 0;
    for (let m = 0; m < years * 12; m++) wealth = (wealth + sip) * (1 + r);
    return Math.round(wealth);
  };
  const out: CryptoDCAProjection[] = [];
  if (btcSIP > 0) {
    out.push({
      asset: 'BTC', monthlySIP: btcSIP, totalInvested: btcSIP * 12 * years,
      conservative: project(btcSIP, 20), expected: project(btcSIP, 35),
      conservativeCagr: 20, expectedCagr: 35
    });
  }
  if (ethSIP > 0) {
    out.push({
      asset: 'ETH', monthlySIP: ethSIP, totalInvested: ethSIP * 12 * years,
      conservative: project(ethSIP, 15), expected: project(ethSIP, 30),
      conservativeCagr: 15, expectedCagr: 30
    });
  }
  return out;
}
