// ============================================================
// SUPERSCORE BACKTESTER v1.0 (deterministic, offline-capable)
// ------------------------------------------------------------
// Replays daily OHLC candles and computes the EXACT production
// SuperScore (shared pure function from superintelligenceEngine)
// for every day, then measures:
//   1. Trade simulation: enter on BUY-LEAN (score >= 65), exit on
//      score <= 40 or max 20 holding-days.
//   2. Score-band accuracy: bucket days into [>=78, 65-77, 35-64, <35]
//      and compute 10-day forward-return hit rate per band. This
//      validates the production "EXTREME" (78/22) thresholds.
//
// Seeded/offline candle generation comes from backtestEngine, so
// results are deterministic — same symbol ⇒ same numbers, always.
// ============================================================

import { computeSuperScoreFromIndicators } from './superintelligenceEngine';
import { fetchHistoricalData } from './backtestEngine';

export interface Candle { date: string; open: number; high: number; low: number; close: number; volume: number; }

export interface SbTrade {
  entryDate: string; exitDate: string;
  entryPrice: number; exitPrice: number;
  returnPct: number; holdingDays: number;
  entryScore: number; exitScore: number;
  result: 'WIN' | 'LOSS' | 'BREAKEVEN';
}

export interface ScoreBandStat {
  band: string;
  samples: number;
  winRate: number;         // % of samples where 10d fwd return > 0
  avgFwdReturn: number;    // average 10-day forward return %
}

export interface SuperScoreBacktestResult {
  symbol: string;
  market: 'IN' | 'US';
  days: number;
  totalTrades: number;
  winRate: number;
  avgReturn: number;
  totalReturn: number;
  profitFactor: number;
  maxWin: number;
  maxLoss: number;
  bandStats: ScoreBandStat[];
  trades: SbTrade[];
  timestamp: number;
}

// ---------- rolling indicator helpers (pure, private) ----------
function sma(closes: number[], end: number, period: number): number | undefined {
  if (end + 1 < period) return undefined;
  let sum = 0;
  for (let i = end - period + 1; i <= end; i++) sum += closes[i];
  return sum / period;
}

function wilderRsi(closes: number[], end: number, period = 14): number {
  if (end < period) return 50;
  let avgGain = 0, avgLoss = 0;
  // Seed with simple average of first `period` deltas
  for (let i = 1; i <= period; i++) {
    const d = closes[i] - closes[i - 1];
    if (d >= 0) avgGain += d; else avgLoss -= d;
  }
  avgGain /= period; avgLoss /= period;
  for (let i = period + 1; i <= end; i++) {
    const d = closes[i] - closes[i - 1];
    avgGain = (avgGain * (period - 1) + Math.max(d, 0)) / period;
    avgLoss = (avgLoss * (period - 1) + Math.max(-d, 0)) / period;
  }
  if (avgLoss === 0) return 100;
  const rs = avgGain / avgLoss;
  return 100 - 100 / (1 + rs);
}

function emaSeries(closes: number[], period: number): number[] {
  const k = 2 / (period + 1);
  const out: number[] = [];
  let prev = closes[0];
  for (let i = 0; i < closes.length; i++) {
    prev = i === 0 ? closes[0] : closes[i] * k + prev * (1 - k);
    out.push(prev);
  }
  return out;
}

/** MACD line (EMA12 − EMA26); compared against 0, matching production behaviour. */
function macdLine(closes: number[], end: number): number | undefined {
  if (end < 35) return undefined; // warm-up so EMA26 is meaningful
  const e12 = emaSeries(closes.slice(0, end + 1), 12);
  const e26 = emaSeries(closes.slice(0, end + 1), 26);
  return e12[end] - e26[end];
}

// ---------- core run ----------
export function runSuperScoreBacktestFromCandles(
  symbol: string,
  market: 'IN' | 'US',
  candles: Candle[]
): SuperScoreBacktestResult {
  const closes = candles.map(c => c.close);
  const days = candles.length;

  // ---------- 1) trade simulation ----------
  const trades: SbTrade[] = [];
  let open: { entryIdx: number; entryPrice: number; entryScore: number } | null = null;

  // ---------- 2) score-band forward-return accuracy ----------
  const bands: Record<string, { wins: number; ret: number; n: number }> = {
    '≥78 EXTREME-BUY': { wins: 0, ret: 0, n: 0 },
    '65–77 BUY-LEAN': { wins: 0, ret: 0, n: 0 },
    '35–64 NEUTRAL': { wins: 0, ret: 0, n: 0 },
    '<35 SELL-LEAN': { wins: 0, ret: 0, n: 0 },
  };
  const bandKey = (s: number) =>
    s >= 78 ? '≥78 EXTREME-BUY' : s >= 65 ? '65–77 BUY-LEAN' : s >= 35 ? '35–64 NEUTRAL' : '<35 SELL-LEAN';

  const FWD = 10; // 10 trading-days forward return

  let prevScore = 50;
  for (let i = 50; i < days; i++) {
    const c = candles[i];
    const score = computeSuperScoreFromIndicators({
      rsi: wilderRsi(closes, i),
      price: c.close,
      change: i > 0 ? ((closes[i] - closes[i - 1]) / closes[i - 1]) * 100 : 0,
      sma20: sma(closes, i, 20),
      sma50: sma(closes, i, 50),
      macd: macdLine(closes, i),
      high: c.high,
      low: c.low,
    });

    // Band accuracy (needs FWD more candles)
    if (i + FWD < days) {
      const fwdRet = ((closes[i + FWD] - closes[i]) / closes[i]) * 100;
      const b = bands[bandKey(score)];
      b.n += 1; b.ret += fwdRet;
      if (fwdRet > 0) b.wins += 1;
    }

    // Trade sim — act on SCORE TRANSITIONS (enter on score crossing up to
    // BUY-LEAN, exit when it crosses into SELL side or holding cap).
    if (!open && score >= 65 && prevScore < 65) {
      const entryIdx = Math.min(i + 1, days - 1); // next-candle open entry
      open = { entryIdx, entryPrice: candles[entryIdx].open, entryScore: score };
    } else if (open && (score <= 40 || i - open.entryIdx >= 20)) {
      const exitIdx = Math.min(i + 1, days - 1); // next-candle open exit
      const exitPrice = candles[exitIdx].open;
      const returnPct = ((exitPrice - open.entryPrice) / open.entryPrice) * 100;
      trades.push({
        entryDate: candles[open.entryIdx].date,
        exitDate: candles[exitIdx].date,
        entryPrice: open.entryPrice,
        exitPrice,
        returnPct,
        holdingDays: exitIdx - open.entryIdx,
        entryScore: open.entryScore,
        exitScore: score,
        result: returnPct > 0.5 ? 'WIN' : returnPct < -0.5 ? 'LOSS' : 'BREAKEVEN',
      });
      open = null;
    }
    prevScore = score;
  }

  // ---------- aggregate ----------
  const wins = trades.filter(t => t.result === 'WIN').length;
  const grossWin = trades.filter(t => t.returnPct > 0).reduce((a, t) => a + t.returnPct, 0);
  const grossLoss = Math.abs(trades.filter(t => t.returnPct < 0).reduce((a, t) => a + t.returnPct, 0));
  const totalReturn = trades.reduce((a, t) => a + t.returnPct, 0);

  const bandStats: ScoreBandStat[] = Object.entries(bands).map(([band, b]) => ({
    band,
    samples: b.n,
    winRate: b.n > 0 ? (b.wins / b.n) * 100 : 0,
    avgFwdReturn: b.n > 0 ? b.ret / b.n : 0,
  }));

  return {
    symbol, market, days,
    totalTrades: trades.length,
    winRate: trades.length > 0 ? (wins / trades.length) * 100 : 0,
    avgReturn: trades.length > 0 ? totalReturn / trades.length : 0,
    totalReturn,
    profitFactor: grossLoss > 0 ? grossWin / grossLoss : grossWin > 0 ? 99 : 0,
    maxWin: trades.length > 0 ? Math.max(...trades.map(t => t.returnPct)) : 0,
    maxLoss: trades.length > 0 ? Math.min(...trades.map(t => t.returnPct)) : 0,
    bandStats,
    trades,
    timestamp: Date.now(),
  };
}

/** Live-data path — fetches candles (deterministic seeded fallback offline). */
export async function runSuperScoreBacktest(
  symbol: string,
  market: 'IN' | 'US' = 'IN',
  period: '3M' | '6M' | '1Y' | '2Y' = '1Y'
): Promise<SuperScoreBacktestResult> {
  const clean = symbol.toUpperCase().replace('.NS', '').replace('.BO', '');
  const candles: Candle[] = await fetchHistoricalData(clean, market, period);
  return runSuperScoreBacktestFromCandles(clean, market, candles);
}

/** Compact chat-friendly report (fits a WhatsApp/Telegram bubble). */
export function formatSuperScoreReport(r: SuperScoreBacktestResult): string {
  let out = `📉 **SUPERSCORE BACKTEST — ${r.symbol}**\n`;
  out += `━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`;
  out += `Period: ${r.days} trading days | Trades simulated: ${r.totalTrades}\n\n`;

  out += `**⚡ SCORE-BAND ACCURACY (10-day forward return):**\n`;
  for (const b of r.bandStats) {
    if (b.samples === 0) continue;
    const emoji = b.band.startsWith('≥') || b.band.startsWith('65') ? '🟢' : b.band.startsWith('<') ? '🔴' : '⚪';
    out += `${emoji} **${b.band}**: ${b.winRate.toFixed(0)}% hit-rate (${b.samples} samples, avg ${b.avgFwdReturn >= 0 ? '+' : ''}${b.avgFwdReturn.toFixed(1)}%/10d)\n`;
  }

  out += `\n**🎯 TRADE SIMULATION (enter ≥65, exit ≤40/20d):**\n`;
  out += `Win rate: **${r.winRate.toFixed(0)}%** | Avg/trade: ${r.avgReturn >= 0 ? '+' : ''}${r.avgReturn.toFixed(2)}%\n`;
  out += `Total return: ${r.totalReturn >= 0 ? '+' : ''}${r.totalReturn.toFixed(1)}% | Profit factor: ${r.profitFactor.toFixed(2)}\n`;
  out += `Best: +${r.maxWin.toFixed(1)}% | Worst: ${r.maxLoss.toFixed(1)}%\n`;

  const extreme = r.bandStats.find(b => b.band.startsWith('≥'));
  if (extreme && extreme.samples >= 5) {
    out += `\n💡 **Verdict:** ${r.symbol} ke EXTREME-BUY signals historically ${extreme.winRate >= 60 ? '**RELIABLE** ✅' : extreme.winRate >= 50 ? '**DECENT** 🟡' : '**WEAK** ⚠️'} — 10-day horizon pe ${extreme.winRate.toFixed(0)}% win-rate.`;
  }
  out += `\n\n_Seeded deterministic data when live feed unavailable — same input, same output._`;
  return out;
}
