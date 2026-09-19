// ============================================================
// STOCK QUALITY SCORECARD — Fundamental Layer
// ------------------------------------------------------------
// Computes a 0-100 quality score for any stock using a multi-factor
// fundamental model. Designed for long-term (15-20yr) holders who
// need to filter out low-quality businesses that may permanently
// destroy capital (e.g. DHFL, Jet Airways, Yes Bank).
//
// Data source: Yahoo Finance quoteSummary endpoint proxied through
// our /api/fundamentals/:symbol endpoint (server caches 24h).
//
// Factors (weighted):
//   1. Piotroski F-Score (0-9)       25%
//   2. Altman Z-Score (bankruptcy)   20%
//   3. ROE 5yr trend                 15%
//   4. Debt-to-Equity                15%
//   5. Promoter holding trend        10%
//   6. Free cash flow yield          10%
//   7. Earnings consistency (5yr EPS) 5%
// ============================================================

export interface FundamentalData {
  symbol: string;
  market: 'IN' | 'US';
  // Income statement (annual, last 5y)
  revenue5yr: number[];
  netIncome5yr: number[];
  eps5yr: number[];
  // Balance sheet (latest)
  totalAssets: number;
  totalLiabilities: number;
  totalEquity: number;
  totalDebt: number;
  retainedEarnings: number;
  workingCapital: number;       // current assets - current liabilities
  ebit: number;                 // operating income
  marketCap: number;
  salesOrRevenue: number;       // TTM
  // Cash flow
  operatingCashFlow: number;    // TTM
  capex: number;                // TTM
  // Per-share
  bookValuePerShare: number;
  // Ownership (Indian stocks)
  promoterHoldingPct?: number;
  promoterHolding1yrAgoPct?: number;
  // Margins
  grossMargin: number;
  netMargin: number;
  roe: number;                  // %
  // Risk flags
  isBank?: boolean;             // Z-Score invalid for banks/financials
  currentRatio?: number;        // current assets / current liabilities
}

export interface FactorScore {
  name: string;
  score: number;            // 0-100 normalized
  raw: number;              // raw value (e.g. F-Score 7)
  weight: number;           // 0-1
  weighted: number;         // score * weight
  detail: string;           // human-readable explanation
  redFlag?: boolean;        // true if critical issue
}

export interface QualityScorecard {
  symbol: string;
  market: 'IN' | 'US';
  totalScore: number;            // 0-100
  grade: 'A+' | 'A' | 'B+' | 'B' | 'C' | 'D' | 'F';
  factors: FactorScore[];
  redFlags: string[];
  recommendations: string[];
  raw: FundamentalData;
  fetchedAt: number;
}

// ---------- Piotroski F-Score (0-9) ----------
// 9 criteria, 1 point each. Categories: profitability, leverage, efficiency.
function piotroskiFScore(d: FundamentalData): { score: number; detail: string } {
  let points = 0;
  const checks: string[] = [];

  // Profitability (4)
  const ni = d.netIncome5yr[d.netIncome5yr.length - 1] || 0;
  const niPrev = d.netIncome5yr[d.netIncome5yr.length - 2] || 0;
  if (ni > 0) { points++; checks.push('✅ Net income positive'); }
  else checks.push('❌ Net income negative');

  const ocf = d.operatingCashFlow || 0;
  if (ocf > 0) { points++; checks.push('✅ Operating cash flow positive'); }
  else checks.push('❌ Operating cash flow negative');

  if (ocf > ni) { points++; checks.push('✅ OCF > Net income (earnings quality)'); }
  else checks.push('❌ OCF < Net income (accruals risk)');

  const roaNow = d.totalAssets > 0 ? ni / d.totalAssets : 0;
  const roaPrev = d.totalAssets > 0 && niPrev > 0 ? niPrev / d.totalAssets : 0;
  if (roaNow > roaPrev) { points++; checks.push('✅ ROA improving'); }
  else checks.push('❌ ROA declining');

  // Leverage / Liquidity (3)
  const deNow = d.totalEquity > 0 ? d.totalDebt / d.totalEquity : 0;
  // Approximate prev DE from 5yr ago — we don't have historical balance sheet
  // so just flag high absolute D/E. Use heuristic: D/E < 0.5 is improving.
  if (deNow < 0.5) { points++; checks.push(`✅ Low D/E (${deNow.toFixed(2)})`); }
  else checks.push(`❌ High D/E (${deNow.toFixed(2)})`);

  if (d.currentRatio && d.currentRatio > 1) { points++; checks.push('✅ Current ratio > 1'); }
  else checks.push('❌ Current ratio ≤ 1 (liquidity risk)');


  // No new shares issued (use equity trend as proxy if available)
  if (d.totalEquity > 0 && d.netIncome5yr[0] > 0) {
    const equityGrowthFromProfit = d.netIncome5yr.reduce((a, b) => a + Math.max(0, b), 0) * 0.5;
    if (d.totalEquity >= equityGrowthFromProfit * 0.5) { points++; checks.push('✅ No significant dilution'); }
    else checks.push('❌ Possible share dilution');
  } else {
    points++; // be lenient if data missing
    checks.push('⚪ Dilution check skipped (data unavailable)');
  }

  // Efficiency (2)
  const revNow = d.revenue5yr[d.revenue5yr.length - 1] || d.salesOrRevenue || 0;
  const revPrev = d.revenue5yr[d.revenue5yr.length - 2] || 0;
  if (revNow > revPrev) { points++; checks.push('✅ Revenue growing'); }
  else checks.push('❌ Revenue declining');

  const assetTurnover = d.totalAssets > 0 ? revNow / d.totalAssets : 0;
  // Heuristic: asset turnover > 0.5 is healthy for most businesses
  if (assetTurnover > 0.5) { points++; checks.push(`✅ Asset turnover ${assetTurnover.toFixed(2)} healthy`); }
  else checks.push(`❌ Low asset turnover ${assetTurnover.toFixed(2)}`);

  // Normalize: 9 points → 100
  const score = (points / 9) * 100;
  return {
    score,
    detail: `F-Score: ${points}/9\n${checks.join('\n')}`,
  };
}

// (currentRatio is now declared directly on FundamentalData above.)

// ---------- Altman Z-Score (bankruptcy risk) ----------
// Z = 1.2*X1 + 1.4*X2 + 3.3*X3 + 0.6*X4 + 1.0*X5
// X1 = working capital / total assets
// X2 = retained earnings / total assets
// X3 = EBIT / total assets
// X4 = market cap / total liabilities
// X5 = sales / total assets
// Z > 2.99 = safe, 1.81 < Z < 2.99 = grey zone, Z < 1.81 = distress
function altmanZScore(d: FundamentalData): { score: number; raw: number; detail: string; redFlag?: boolean } {
  if (d.isBank) {
    return {
      score: 50,
      raw: 0,
      detail: 'Z-Score not applicable to banks/financials (different capital structure).',
    };
  }
  if (d.totalAssets <= 0 || d.totalLiabilities <= 0) {
    return { score: 50, raw: 0, detail: 'Insufficient balance sheet data.' };
  }

  const x1 = d.workingCapital / d.totalAssets;
  const x2 = d.retainedEarnings / d.totalAssets;
  const x3 = d.ebit / d.totalAssets;
  const x4 = d.marketCap / d.totalLiabilities;
  const x5 = (d.salesOrRevenue || 0) / d.totalAssets;
  const z = 1.2 * x1 + 1.4 * x2 + 3.3 * x3 + 0.6 * x4 + 1.0 * x5;

  let score: number;
  let redFlag = false;
  let band = '';
  if (z >= 2.99) {
    score = 90;
    band = 'Safe zone';
  } else if (z >= 1.81) {
    score = 60;
    band = 'Grey zone — monitor';
  } else {
    score = 15;
    band = '⚠️ Distress zone — high bankruptcy risk';
    redFlag = true;
  }

  return {
    score,
    raw: z,
    detail: `Z-Score: ${z.toFixed(2)} — ${band}\nX1(WC/TA)=${x1.toFixed(2)} X2(RE/TA)=${x2.toFixed(2)} X3(EBIT/TA)=${x3.toFixed(2)} X4(MC/TL)=${x4.toFixed(2)} X5(Sales/TA)=${x5.toFixed(2)}`,
    redFlag,
  };
}

// ---------- ROE 5-yr trend ----------
// Quality companies have ROE > 15% AND stable/rising.
function roeTrendScore(d: FundamentalData): { score: number; detail: string; redFlag?: boolean } {
  if (!d.roe || d.roe <= 0) {
    return { score: 10, detail: `Current ROE: ${d.roe.toFixed(1)}% — poor`, redFlag: true };
  }
  let score = 0;
  const tier = d.roe >= 20 ? 90 : d.roe >= 15 ? 75 : d.roe >= 10 ? 55 : d.roe >= 5 ? 35 : 15;
  score = tier;

  // Bonus for consistency: if EPS 5yr all positive and growing
  const eps = d.eps5yr.filter(v => v > 0);
  if (eps.length === d.eps5yr.length) {
    let growing = true;
    for (let i = 1; i < eps.length; i++) {
      if (eps[i] < eps[i - 1] * 0.85) { growing = false; break; }
    }
    if (growing) {
      score = Math.min(100, score + 10);
      return { score, detail: `ROE: ${d.roe.toFixed(1)}% (tier ${tier}) + 10 bonus for 5yr EPS growth consistency` };
    }
  }

  return { score, detail: `ROE: ${d.roe.toFixed(1)}% → tier ${tier}/100` };
}

// ---------- Debt-to-Equity ----------
function debtToEquityScore(d: FundamentalData): { score: number; detail: string; redFlag?: boolean } {
  const de = d.totalEquity > 0 ? d.totalDebt / d.totalEquity : 0;
  if (de > 3) {
    return { score: 10, detail: `D/E: ${de.toFixed(2)} — extremely leveraged`, redFlag: true };
  }
  if (d.isBank) {
    return { score: 70, detail: `Banks naturally run high D/E (${de.toFixed(2)}) — apply bank-specific lens` };
  }
  const score = de < 0.5 ? 95 : de < 1 ? 80 : de < 2 ? 60 : de < 3 ? 35 : 10;
  return { score, detail: `D/E: ${de.toFixed(2)} → score ${score}/100` };
}

// ---------- Promoter holding trend (Indian stocks only) ----------
function promoterTrendScore(d: FundamentalData): { score: number; detail: string; redFlag?: boolean } {
  if (d.market !== 'IN' || d.promoterHoldingPct == null) {
    return { score: 70, detail: 'Promoter data unavailable (US stock or missing) — neutral' };
  }
  const cur = d.promoterHoldingPct;
  const prev = d.promoterHolding1yrAgoPct ?? cur;
  const change = cur - prev;

  // Absolute level matters too — <30% is concerning for Indian stocks
  let levelScore = cur >= 60 ? 95 : cur >= 50 ? 85 : cur >= 40 ? 70 : cur >= 30 ? 50 : 25;
  // Trend matters more — declining = big red flag
  if (change < -3) {
    return { score: Math.min(levelScore, 30), detail: `Promoter: ${cur.toFixed(1)}% (was ${prev.toFixed(1)}%, ▼${Math.abs(change).toFixed(1)}pp) — SELL signal`, redFlag: true };
  }
  if (change < -1) {
    return { score: Math.min(levelScore, 55), detail: `Promoter: ${cur.toFixed(1)}% (▼${Math.abs(change).toFixed(1)}pp) — slight decline` };
  }
  if (change > 1) {
    return { score: Math.min(100, levelScore + 10), detail: `Promoter: ${cur.toFixed(1)}% (▲${change.toFixed(1)}pp) — confidence rising` };
  }
  return { score: levelScore, detail: `Promoter: ${cur.toFixed(1)}% (stable)` };
}

// ---------- Free Cash Flow Yield ----------
// FCF yield = (OCF - Capex) / MarketCap
// > 5% = undervalued, < 0% = burning cash
function fcfYieldScore(d: FundamentalData): { score: number; detail: string } {
  if (d.marketCap <= 0) {
    return { score: 50, detail: 'Market cap unavailable' };
  }
  const fcf = (d.operatingCashFlow || 0) - (d.capex || 0);
  const yieldPct = (fcf / d.marketCap) * 100;
  const score = yieldPct > 8 ? 95 : yieldPct > 5 ? 85 : yieldPct > 2 ? 70 : yieldPct > 0 ? 50 : yieldPct > -3 ? 25 : 10;
  return {
    score,
    detail: `FCF Yield: ${yieldPct.toFixed(2)}% (FCF ${fcf >= 0 ? '+' : ''}${(fcf / 1e7).toFixed(1)} Cr) → score ${score}/100`,
  };
}

// ---------- Earnings consistency ----------
// 5yr EPS stability — low variance = quality
function earningsConsistencyScore(d: FundamentalData): { score: number; detail: string; redFlag?: boolean } {
  if (d.eps5yr.length < 4) {
    return { score: 50, detail: 'Insufficient EPS history (< 4 years)' };
  }
  const eps = d.eps5yr;
  const mean = eps.reduce((a, b) => a + b, 0) / eps.length;
  if (mean <= 0) {
    return { score: 10, detail: `Avg EPS ${mean.toFixed(2)} — loss-making over 5yr`, redFlag: true };
  }
  const variance = eps.reduce((s, v) => s + (v - mean) ** 2, 0) / eps.length;
  const cv = Math.sqrt(variance) / mean;  // coefficient of variation
  // CV < 0.2 = very stable, > 0.6 = very volatile
  const score = cv < 0.15 ? 95 : cv < 0.3 ? 80 : cv < 0.5 ? 60 : cv < 0.7 ? 40 : 20;
  return {
    score,
    detail: `5yr EPS mean=${mean.toFixed(2)}, CV=${cv.toFixed(2)} → score ${score}/100`,
  };
}

// ---------- Main entry point ----------
export function computeQualityScorecard(d: FundamentalData): QualityScorecard {
  const f1 = piotroskiFScore(d);
  const f2 = altmanZScore(d);
  const f3 = roeTrendScore(d);
  const f4 = debtToEquityScore(d);
  const f5 = promoterTrendScore(d);
  const f6 = fcfYieldScore(d);
  const f7 = earningsConsistencyScore(d);

  const factors: FactorScore[] = [
    { name: 'Piotroski F-Score', score: f1.score, raw: f1.score / 100 * 9, weight: 0.25, weighted: f1.score * 0.25, detail: f1.detail },
    { name: 'Altman Z-Score', score: f2.score, raw: f2.raw, weight: 0.20, weighted: f2.score * 0.20, detail: f2.detail, redFlag: f2.redFlag },
    { name: 'ROE 5yr Trend', score: f3.score, raw: d.roe, weight: 0.15, weighted: f3.score * 0.15, detail: f3.detail, redFlag: f3.redFlag },
    { name: 'Debt-to-Equity', score: f4.score, raw: d.totalEquity > 0 ? d.totalDebt / d.totalEquity : 0, weight: 0.15, weighted: f4.score * 0.15, detail: f4.detail, redFlag: f4.redFlag },
    { name: 'Promoter Holding Trend', score: f5.score, raw: d.promoterHoldingPct || 0, weight: 0.10, weighted: f5.score * 0.10, detail: f5.detail, redFlag: f5.redFlag },
    { name: 'FCF Yield', score: f6.score, raw: 0, weight: 0.10, weighted: f6.score * 0.10, detail: f6.detail },
    { name: 'Earnings Consistency', score: f7.score, raw: 0, weight: 0.05, weighted: f7.score * 0.05, detail: f7.detail, redFlag: f7.redFlag },
  ];

  const totalScore = Math.round(factors.reduce((s, f) => s + f.weighted, 0));
  const grade: QualityScorecard['grade'] =
    totalScore >= 90 ? 'A+' :
    totalScore >= 80 ? 'A' :
    totalScore >= 70 ? 'B+' :
    totalScore >= 60 ? 'B' :
    totalScore >= 45 ? 'C' :
    totalScore >= 30 ? 'D' : 'F';

  const redFlags = factors.filter(f => f.redFlag).map(f => `${f.name}: ${f.detail}`);
  const recommendations: string[] = [];
  if (totalScore >= 80) recommendations.push('✅ High-quality compounder — suitable for long-term core holding.');
  else if (totalScore >= 65) recommendations.push('🟡 Decent quality — hold but monitor red flags.');
  else if (totalScore >= 45) recommendations.push('🟠 Marginal — consider trimming / avoid adding more.');
  else recommendations.push('🚨 Low quality — high risk of permanent capital loss. Exit on rallies.');

  if (redFlags.length > 0) {
    recommendations.push(`⚠️ Critical issues: ${redFlags.length} red flag(s) detected.`);
  }

  return {
    symbol: d.symbol,
    market: d.market,
    totalScore,
    grade,
    factors,
    redFlags,
    recommendations,
    raw: d,
    fetchedAt: Date.now(),
  };
}

// ---------- Format for Telegram / chat ----------
export function formatScorecardForTelegram(s: QualityScorecard): string {
  const emoji = s.totalScore >= 80 ? '🟢' : s.totalScore >= 65 ? '🟡' : s.totalScore >= 45 ? '🟠' : '🔴';
  let msg = `${emoji} <b>QUALITY SCORECARD — ${s.symbol}</b> (${s.market})\n`;
  msg += `<code>━━━━━━━━━━━━━━━━━━━━━━━</code>\n`;
  msg += `<b>Score:</b> ${s.totalScore}/100 <b>Grade:</b> ${s.grade}\n\n`;
  msg += `<b>Factor Breakdown:</b>\n`;
  for (const f of s.factors) {
    const flag = f.redFlag ? ' ⚠️' : '';
    msg += `• <b>${f.name}</b> (${(f.weight * 100).toFixed(0)}%): ${f.score.toFixed(0)}/100${flag}\n`;
    msg += `  <i>${f.detail.split('\n')[0]}</i>\n`;
  }
  if (s.redFlags.length > 0) {
    msg += `\n🚨 <b>Red Flags:</b>\n`;
    for (const r of s.redFlags) msg += `• ${r}\n`;
  }
  msg += `\n<b>Verdict:</b> ${s.recommendations[0]}`;
  return msg;
}
