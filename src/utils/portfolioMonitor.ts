// ============================================
// PORTFOLIO HEALTH MONITOR
// Health score, alert conditions, daily digest
// ============================================

import { Position, PriceData, PortfolioHealth } from '../types';
import { getAssetCagrProxy } from './constants';
import { analyzeAsset } from './telegram';

/**
 * Compute portfolio health score (0-100)
 */
export function computeHealthScore(
  portfolio: Position[],
  livePrices: Record<string, PriceData>,
  metrics: { totalValue: number; totalPL: number; plPct: number }
): PortfolioHealth {
  let score = 100;
  const warnings: string[] = [];
  const buyOpportunities: string[] = [];
  const trendReversals: string[] = [];
  let rsiExtremeCount = 0;

  // 1. Drawdown penalty
  const drawdownFromHigh = metrics.plPct < 0 ? Math.abs(metrics.plPct) : 0;
  if (drawdownFromHigh > 20) { score -= 40; warnings.push(`Heavy drawdown: ${drawdownFromHigh.toFixed(1)}%`); }
  else if (drawdownFromHigh > 10) { score -= 25; warnings.push(`Moderate drawdown: ${drawdownFromHigh.toFixed(1)}%`); }
  else if (drawdownFromHigh > 5) { score -= 10; }

  // 2. RSI extremes
  portfolio.forEach(pos => {
    const key = `${pos.market}_${pos.symbol}`;
    const pd = livePrices[key];
    if (!pd) return;

    if (pd.rsi < 30) {
      rsiExtremeCount++;
      buyOpportunities.push(`${pos.symbol}: RSI ${pd.rsi} — deep oversold, BUY`);
    } else if (pd.rsi < 40) {
      buyOpportunities.push(`${pos.symbol}: RSI ${pd.rsi} — approaching oversold`);
    }

    if (pd.rsi > 75) {
      rsiExtremeCount++;
      score -= 5;
      warnings.push(`${pos.symbol}: RSI ${pd.rsi} — extremely overbought`);
    }

    // Trend reversal detection
    if (pd.sma20 && pd.sma50 && pd.sma20 < pd.sma50) {
      const cagr = getAssetCagrProxy(pos.symbol, pos.market);
      if (cagr > 15) {
        trendReversals.push(pos.symbol);
        score -= 5;
      }
    }
  });

  // 3. VIX penalty (approximate from livePrices)
  const vixUS = livePrices['VIX']?.price || 0;
  const vixIN = livePrices['INDIAVIX']?.price || 0;
  const avgVix = (vixUS + vixIN) / 2;
  let vixStatus: PortfolioHealth['vixStatus'] = 'NORMAL';
  if (avgVix > 30) { score -= 25; vixStatus = 'SPIKE'; warnings.push(`VIX spike: ${avgVix.toFixed(1)} — extreme fear`); }
  else if (avgVix > 22) { score -= 15; vixStatus = 'ELEVATED'; warnings.push(`VIX elevated: ${avgVix.toFixed(1)}`); }
  else if (avgVix > 0 && avgVix < 15) { score += 5; }

  // 4. Concentration penalty
  if (portfolio.length > 0) {
    const totalValue = portfolio.reduce((s, p) => {
      const price = livePrices[`${p.market}_${p.symbol}`]?.price || p.avgPrice;
      return s + price * p.qty;
    }, 0);
    portfolio.forEach(pos => {
      const price = livePrices[`${pos.market}_${pos.symbol}`]?.price || pos.avgPrice;
      const weight = totalValue > 0 ? (price * pos.qty / totalValue) * 100 : 0;
      if (weight > 35) {
        score -= 10;
        warnings.push(`${pos.symbol}: ${weight.toFixed(0)}% concentration — overconcentrated`);
      }
    });
  }

  // 5. Buy signal bonus
  const buySignals = portfolio.filter(pos => {
    const signal = analyzeAsset(pos, livePrices[`${pos.market}_${pos.symbol}`]);
    return signal.signal === 'STRONG_BUY' || signal.signal === 'BUY';
  });
  if (buySignals.length >= 3) score += 5;

  // Clamp score
  score = Math.max(0, Math.min(100, score));

  // Alert level
  let alertLevel: PortfolioHealth['alertLevel'];
  if (score >= 70) alertLevel = 'GREEN';
  else if (score >= 45) alertLevel = 'YELLOW';
  else alertLevel = 'RED';

  return { score, drawdownFromHigh, rsiExtremeCount, trendReversals, vixStatus, alertLevel, buyOpportunities, warnings };
}

/**
 * Check alert conditions for background monitoring
 */
export function checkAlertConditions(
  portfolio: Position[],
  livePrices: Record<string, PriceData>,
  previousHighs: Record<string, number>
): { type: string; symbol: string; message: string; severity: 'INFO' | 'WARNING' | 'CRITICAL' }[] {
  const alerts: { type: string; symbol: string; message: string; severity: 'INFO' | 'WARNING' | 'CRITICAL' }[] = [];

  portfolio.forEach(pos => {
    const key = `${pos.market}_${pos.symbol}`;
    const pd = livePrices[key];
    if (!pd) return;

    // Price drop from previous high
    const prevHigh = previousHighs[key];
    if (prevHigh && pd.price > 0) {
      const dropPct = ((prevHigh - pd.price) / prevHigh) * 100;
      if (dropPct > 10) {
        alerts.push({ type: 'PRICE_DROP', symbol: pos.symbol, message: `${pos.symbol} dropped ${dropPct.toFixed(1)}% from high — DEEP DIP BUY SIGNAL`, severity: 'CRITICAL' });
      } else if (dropPct > 5) {
        alerts.push({ type: 'PRICE_DROP', symbol: pos.symbol, message: `${pos.symbol} dropped ${dropPct.toFixed(1)}% from high — mild dip`, severity: 'WARNING' });
      }
    }

    // RSI extreme
    if (pd.rsi < 30) {
      alerts.push({ type: 'RSI_OVERSOLD', symbol: pos.symbol, message: `${pos.symbol} RSI ${pd.rsi} — deeply oversold, strong buy signal`, severity: 'CRITICAL' });
    }

    // Trend reversal (SMA20 crosses below SMA50)
    if (pd.sma20 && pd.sma50 && pd.sma20 < pd.sma50 * 0.99) {
      alerts.push({ type: 'TREND_REVERSAL', symbol: pos.symbol, message: `${pos.symbol} SMA20 crossed below SMA50 — bearish trend`, severity: 'WARNING' });
    }
  });

  // VIX spike
  const vixUS = livePrices['VIX']?.price || 0;
  const vixIN = livePrices['INDIAVIX']?.price || 0;
  const avgVix = (vixUS + vixIN) / 2;
  if (avgVix > 30) {
    alerts.push({ type: 'VIX_SPIKE', symbol: 'VIX', message: `VIX spike to ${avgVix.toFixed(1)} — extreme fear, buy deep dips only`, severity: 'CRITICAL' });
  } else if (avgVix > 25) {
    alerts.push({ type: 'VIX_ELEVATED', symbol: 'VIX', message: `VIX elevated at ${avgVix.toFixed(1)} — caution`, severity: 'WARNING' });
  }

  return alerts;
}

/**
 * Generate daily digest message for Telegram
 */
export function generateDailyDigest(
  _portfolio: Position[],
  _livePrices: Record<string, PriceData>,
  health: PortfolioHealth,
  metrics: { totalValue: number; totalPL: number; plPct: number; todayPL: number }
): string {
  const emoji = health.alertLevel === 'GREEN' ? '🟢' : health.alertLevel === 'YELLOW' ? '🟡' : '🔴';
  const plEmoji = metrics.totalPL >= 0 ? '📈' : '📉';

  let msg = `<b>PORTFOLIO HEALTH DIGEST</b>\n`;
  msg += `━━━━━━━━━━━━━━━━━━━━━━━\n`;
  msg += `Health Score: <b>${health.score}/100</b> ${emoji}\n`;
  msg += `Portfolio: ₹${formatNum(metrics.totalValue)}\n`;
  msg += `${plEmoji} P&L: ₹${formatNum(metrics.totalPL)} (${metrics.plPct >= 0 ? '+' : ''}${metrics.plPct.toFixed(1)}%)\n`;
  msg += `Today: ₹${formatNum(metrics.todayPL)}\n\n`;

  if (health.buyOpportunities.length > 0) {
    msg += `<b>🎯 BUY OPPORTUNITIES:</b>\n`;
    health.buyOpportunities.slice(0, 5).forEach(b => { msg += `• ${b}\n`; });
    msg += `\n`;
  }

  if (health.warnings.length > 0) {
    msg += `<b>⚠️ WARNINGS:</b>\n`;
    health.warnings.slice(0, 5).forEach(w => { msg += `• ${w}\n`; });
    msg += `\n`;
  }

  if (health.trendReversals.length > 0) {
    msg += `<b>🔄 TREND REVERSALS:</b> ${health.trendReversals.join(', ')}\n\n`;
  }

  const vixMsg = health.vixStatus === 'SPIKE' ? '🔴 VIX SPIKE — extreme caution'
    : health.vixStatus === 'ELEVATED' ? '🟡 VIX elevated — mild caution'
    : '🟢 VIX normal';
  msg += `${vixMsg}\n`;
  msg += `<i>💎 Wealth AI Pro Terminal</i>`;

  return msg;
}

function formatNum(n: number): string {
  if (Math.abs(n) >= 10000000) return (n / 10000000).toFixed(2) + ' Cr';
  if (Math.abs(n) >= 100000) return (n / 100000).toFixed(2) + ' L';
  return n.toLocaleString('en-IN', { maximumFractionDigits: 0 });
}
