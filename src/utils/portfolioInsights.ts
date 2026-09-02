// ============================================================
// portfolioInsights — Portfolio TAB insight engine (v4.5)
// ------------------------------------------------------------
// PURE computations for the PortfolioInsights panel:
//   • today's biggest winners / losers (₹ impact on the day)
//   • all-time best / worst performers (unrealized P&L %)
//   • diversification analysis — HHI over allocation weights,
//     top-1 / top-3 concentration, market spread
//   • market split (India / USA / Crypto % of portfolio value)
// All inputs come from the PortfolioTab's already-computed
// GroupedAsset rows (sync-truth P&L engine — assetPnl.ts), so
// every number matches the table exactly. No server calls.
// ============================================================

export interface InsightAsset {
  /** Display label (ticker or trimmed name). */
  label: string;
  group: 'india' | 'usa' | 'crypto';
  /** Native-currency unrealized P&L. */
  pl: number;
  plPct: number;
  /** Native-currency Today's P&L ((live − prevClose) × qty). */
  todayPL: number;
  /** INR value of the position (live, FX-consistent). */
  valINR: number;
}

export interface PortfolioInsightsResult {
  todayWinners: InsightAsset[];
  todayLosers: InsightAsset[];
  bestPerformers: InsightAsset[];
  worstPerformers: InsightAsset[];
  /** Herfindahl-Hirschman Index over allocation weights (0..10000). */
  hhi: number;
  /** 0-100 diversification score (100 = perfectly spread). */
  diversificationScore: number;
  /** Top single holding weight (%). */
  topWeight: number;
  /** Combined weight of the 3 largest holdings (%). */
  top3Weight: number;
  /** Count of distinct markets with skin in the game. */
  markets: number;
  marketSplit: { india: number; usa: number; crypto: number };
  health: {
    grade: 'WELL-DIVERSIFIED' | 'BALANCED' | 'CONCENTRATED' | 'EGG-IN-ONE-BASKET';
    cls: string;
    note: string;
  };
}

/**
 * Health rubric (pro-advisor language):
 *   WELL-DIVERSIFIED  — top holding < 25% and 3+ markets
 *   BALANCED          — top holding < 40%
 *   CONCENTRATED      — top holding < 60% but > 40%
 *   EGG-IN-ONE-BASKET — top holding >= 60% (single point of failure)
 */
function healthFor(topWeight: number, markets: number): PortfolioInsightsResult['health'] {
  if (topWeight >= 60) {
    return {
      grade: 'EGG-IN-ONE-BASKET',
      cls: 'bg-red-500/15 text-red-300 border-red-500/30',
      note: `Sabse bada holding portfolio ka ${topWeight.toFixed(0)}% hai — ek hi asset ka ek din kharab = poora portfolio gir jayega. Gradually trim karein.`,
    };
  }
  if (topWeight >= 40) {
    return {
      grade: 'CONCENTRATED',
      cls: 'bg-amber-500/15 text-amber-300 border-amber-500/30',
      note: `Top holding ${topWeight.toFixed(0)}% — high conviction bet hai, lekin risk bhi utna hi concentrated. Aage add karte waqt dusre assets/market me lein.`,
    };
  }
  if (topWeight < 25 && markets >= 3) {
    return {
      grade: 'WELL-DIVERSIFIED',
      cls: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30',
      note: `Top holding sirf ${topWeight.toFixed(0)}% aur ${markets} markets — ek asset ka shock poora portfolio nahi gira sakta. Yahi allocation discipline profolios me hoti hai.`,
    };
  }
  return {
    grade: 'BALANCED',
    cls: 'bg-cyan-500/15 text-cyan-300 border-cyan-500/30',
    note: `Top holding ${topWeight.toFixed(0)}% — theek-thaak spread. Naya capital top-3 ke bahar wale ideas me daalein to score aur behtar hoga.`,
  };
}

const byTodayDesc = (a: InsightAsset, b: InsightAsset) => b.todayPL - a.todayPL;
const byPnlPctDesc = (a: InsightAsset, b: InsightAsset) => b.plPct - a.plPct;

/**
 * PURE — the full insight payload.
 * @param assets all visible GroupedAsset-mapped rows
 * @param totalValueINR total portfolio value in INR (live)
 */
export function computePortfolioInsights(assets: InsightAsset[], totalValueINR: number): PortfolioInsightsResult {
  const total = Math.max(0, totalValueINR);

  // --- Today's movers (₹ impact) — winners positive, losers negative ---
  const withToday = assets.filter(a => Number.isFinite(a.todayPL) && a.todayPL !== 0);
  const todayWinners = withToday.filter(a => a.todayPL > 0).sort(byTodayDesc).slice(0, 3);
  const todayLosers = withToday.filter(a => a.todayPL < 0).sort(byTodayDesc).reverse().slice(0, 3);

  // --- All-time performers (%, only rows with a real cost basis) ---
  const withBasis = assets.filter(a => Number.isFinite(a.plPct) && a.plPct !== 0);
  const bestPerformers = withBasis.filter(a => a.plPct > 0).sort(byPnlPctDesc).slice(0, 3);
  const worstPerformers = withBasis.filter(a => a.plPct < 0).sort(byPnlPctDesc).reverse().slice(0, 3);

  // --- Weights + HHI + market split ---
  const weights = assets.map(a => (total > 0 ? a.valINR / total : 0));
  const hhi = Math.round(weights.reduce((s, w) => s + w * w, 0) * 10000);
  const sorted = [...weights].sort((a, b) => b - a);
  const topWeight = total > 0 ? (sorted[0] ?? 0) * 100 : 0;
  const top3Weight = total > 0 ? (sorted[0] + (sorted[1] ?? 0) + (sorted[2] ?? 0)) * 100 : 0;

  const sumFor = (g: InsightAsset['group']) =>
    assets.filter(a => a.group === g).reduce((s, a) => s + a.valINR, 0);
  const splitINR = { india: sumFor('india'), usa: sumFor('usa'), crypto: sumFor('crypto') };
  const marketSplit = {
    india: total > 0 ? (splitINR.india / total) * 100 : 0,
    usa: total > 0 ? (splitINR.usa / total) * 100 : 0,
    crypto: total > 0 ? (splitINR.crypto / total) * 100 : 0,
  };
  const markets = (['india', 'usa', 'crypto'] as const).filter(g => marketSplit[g] > 0.5).length;

  // 0-100 score: HHI 10000 (one asset) → 0; HHI ~0 (spread across 10+) → ~100.
  const diversificationScore = assets.length > 1
    ? Math.max(0, Math.min(100, Math.round(100 - (hhi / 10000) * 100 - (assets.length < 4 ? 10 : 0))))
    : 0;

  return {
    todayWinners, todayLosers, bestPerformers, worstPerformers,
    hhi, diversificationScore, topWeight, top3Weight, markets, marketSplit,
    health: healthFor(topWeight, markets),
  };
}
