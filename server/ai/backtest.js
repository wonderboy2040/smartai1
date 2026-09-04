// ============================================================
// server/ai/backtest.js — WALK-FORWARD ENSEMBLE BACKTESTER
// ------------------------------------------------------------
// v6.5 — "would these signals have made money?" answered honestly.
//
// The SAME pipeline that runs live — indicators → quant models →
// aggregateVotes → buildTradePlan (risk-capped) — is replayed on
// historical candles bar-by-bar, and each generated trade is
// simulated with the SAME exit discipline the live watcher uses:
//
//   entry   = next bar's open + 0.1% slippage
//   exits   = SL (full close) · TP2 (runner target) · time-stop
//             (TP1 does NOT close — the live watcher lets winners
//             run to TP2; the backtest must mirror that or lie)
//   SL-first on ambiguous bars (conservative)
//
// Results are R-multiple-normalized (risk-based, capital-agnostic)
// plus a ₹ P&L at a fixed budget. Every number is derived from the
// exact models serving the live board — no look-ahead: bar i only
// ever sees candles[0..i].
// ============================================================
import { computeIndicatorsFromCandles } from './lib/indicators.js';
import { fetchCoinDcxCandles } from './data.js';
import { runQuantModels } from './models.js';
import { aggregateVotes, buildTradePlan } from './ensemble.js';

const r2 = (v) => (Number.isFinite(v) ? Math.round(v * 100) / 100 : null);
const SLIPPAGE = 0.001; // 10 bps each side
const WARMUP = 60;      // bars burned before the first signal

// ---------------- historical data ----------------
async function fetchYahooDailyCandles(symbol, range = '2y') {
  const yh = `${symbol.toUpperCase().replace(/[^A-Z0-9\-]/g, '')}.NS`;
  return fetchYahooChart(yh, '1d', range);
}

/** v6.5 fallback for crypto history when CoinDCX public candles are
 *  unreachable (e.g. sandboxed hosts): Yahoo 1h bars for <base>-USD.
 *  R-multiple stats are currency-agnostic; the ₹ P&L is computed on
 *  the same fixed budget, so USD prices stay comparable. */
async function fetchYahooHourlyCrypto(base) {
  return fetchYahooChart(`${base}-USD`, '1h', '3mo');
}

async function fetchYahooChart(yhTicker, interval, range) {
  try {
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(yhTicker)}?interval=${interval}&range=${range}`;
    const r = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (WealthAI backtest)' },
      signal: AbortSignal.timeout(10_000),
    });
    if (!r.ok) return null;
    const j = await r.json();
    const res = j?.chart?.result?.[0];
    const ts = res?.timestamp;
    const q = res?.indicators?.quote?.[0];
    if (!Array.isArray(ts) || !q) return null;
    const out = [];
    for (let i = 0; i < ts.length; i++) {
      if (q.open?.[i] == null || q.close?.[i] == null) continue;
      out.push({
        time: ts[i] * 1000,
        open: q.open[i], high: q.high?.[i] ?? q.close[i], low: q.low?.[i] ?? q.close[i],
        close: q.close[i], volume: q.volume?.[i] || 0,
      });
    }
    return out.length >= 120 ? out : null;
  } catch { return null; }
}

// ---------------- the simulation core (pure, exported for tests) ----------------
/**
 * Simulate ONE symbol's history through the live ensemble.
 * @returns {{trades: [], stats: {}}|null} null when data is unusable.
 */
export function simulateSymbol({ symbol, market, candles, minGrade = 'ACTION', maxRiskPct = 5, capitalPerTradeINR = 1000, maxHoldBars = 48 }) {
  if (!Array.isArray(candles) || candles.length < WARMUP + 20) return null;
  const long = side => String(side).toUpperCase() !== 'SHORT';
  const trades = [];
  let i = WARMUP;
  let openTrade = null;

  const gradeFloor = { STRONG: 4, ACTION: 3, WATCH: 2, NEUTRAL: 1 }[String(minGrade).toUpperCase()] || 3;
  if (gradeFloor < 3) { /* WATCH/NEUTRAL floors are allowed for experimentation */ }

  while (i < candles.length - 1) {
    if (!openTrade) {
      // ---- signal evaluation at bar i close (no look-ahead) ----
      const hist = candles.slice(0, i + 1);
      const ind = computeIndicatorsFromCandles(hist);
      if (ind) {
        const prev = candles[i - 1]?.close;
        const ctx = {
          market, symbol,
          ltp: candles[i].close,
          changePct: prev > 0 ? ((candles[i].close / prev) - 1) * 100 : 0,
          volume: candles[i].volume || 0,
          ind, candles: hist, options: null,
          regime: market === 'CRYPTO' ? { btcChange: null } : { niftyChange: null, indiaVix: null },
        };
        const votes = runQuantModels(ctx);
        const consensus = aggregateVotes(votes);
        const gf = { STRONG: 4, ACTION: 3, WATCH: 2, NEUTRAL: 1 }[consensus.grade] || 1;
        if (consensus.dir !== 0 && gf >= gradeFloor) {
          const plan = buildTradePlan(consensus, ctx, market, { maxRiskPct });
          if (plan) {
            const next = candles[i + 1];
            const entry = next.open * (1 + (long(consensus.side) ? SLIPPAGE : -SLIPPAGE));
            const risk = Math.abs(entry - plan.stopLoss);
            if (risk > 0) {
              openTrade = {
                symbol, market, side: consensus.side, grade: consensus.grade, confidence: consensus.confidence,
                agreement: consensus.agreement, entryBar: i + 1, entry, sl: plan.stopLoss, tp: plan.target1, tp2: plan.target2,
                risk, qty: capitalPerTradeINR > 0 ? capitalPerTradeINR / entry : 0,
                planStyle: plan.planStyle + (plan.riskClamped ? ' (fitted)' : ''),
                modelsVoting: consensus.participating,
              };
              i += 1;
              continue;
            }
          }
        }
      }
      i += 1;
      continue;
    }

    // ---- manage the open trade bar-by-bar ----
    const bar = candles[i];
    const isLong = long(openTrade.side);
    // SL-first on ambiguous bars (conservative)
    if (isLong ? bar.low <= openTrade.sl : bar.high >= openTrade.sl) {
      const exit = openTrade.sl * (1 + (isLong ? -SLIPPAGE : SLIPPAGE));
      finish(openTrade, trades, exit, 'SL', i);
      openTrade = null;
      i += 1;
      continue;
    }
    if (isLong ? bar.high >= openTrade.tp2 : bar.low <= openTrade.tp2) {
      const exit = openTrade.tp2 * (1 + (isLong ? -SLIPPAGE : SLIPPAGE));
      finish(openTrade, trades, exit, 'TP2', i);
      openTrade = null;
      i += 1;
      continue;
    }
    if (i - openTrade.entryBar >= maxHoldBars) {
      finish(openTrade, trades, bar.close, 'TIME', i);
      openTrade = null;
      i += 1;
      continue;
    }
    i += 1;
  }

  if (openTrade) { // data ended mid-trade — mark-to-market close
    finish(openTrade, trades, candles[candles.length - 1].close, 'EOD', candles.length - 1);
  }
  return { trades, stats: statsFrom(trades) };
}

function finish(t, trades, exitPrice, reason, exitBar) {
  const isLong = String(t.side).toUpperCase() !== 'SHORT';
  const rMult = ((isLong ? exitPrice - t.entry : t.entry - exitPrice) / t.risk);
  const pnlINR = t.qty > 0 ? rMult * t.risk * t.qty : 0;
  trades.push({
    symbol: t.symbol, side: t.side, grade: t.grade, confidence: t.confidence,
    entry: r2(t.entry), exit: r2(exitPrice), sl: r2(t.sl), tp2: r2(t.tp2),
    risk: r2(t.risk), r: r2(rMult), pnlINR: r2(pnlINR), reason,
    entryBar: t.entryBar, exitBar, holdBars: exitBar - t.entryBar,
    planStyle: t.planStyle, modelsVoting: t.modelsVoting,
  });
}

function statsFrom(trades) {
  const n = trades.length;
  if (n === 0) return { trades: 0, wins: 0, losses: 0, winRate: null, avgR: null, totalR: 0, profitFactor: null, maxDDR: 0, avgHoldBars: null, pnlINR: 0 };
  const wins = trades.filter(t => t.r > 0);
  const losses = trades.filter(t => t.r <= 0);
  const totalR = trades.reduce((a, t) => a + t.r, 0);
  const grossWin = wins.reduce((a, t) => a + t.r, 0);
  const grossLoss = Math.abs(losses.reduce((a, t) => a + t.r, 0));
  // max drawdown in R on the cumulative equity curve
  let cum = 0, peak = 0, maxDD = 0;
  for (const t of trades) {
    cum += t.r;
    if (cum > peak) peak = cum;
    if (peak - cum > maxDD) maxDD = peak - cum;
  }
  return {
    trades: n,
    wins: wins.length,
    losses: losses.length,
    winRate: r2((wins.length / n) * 100),
    avgR: r2(totalR / n),
    totalR: r2(totalR),
    profitFactor: grossLoss > 0 ? r2(grossWin / grossLoss) : (grossWin > 0 ? Infinity : null),
    maxDDR: r2(maxDD),
    avgHoldBars: r2(trades.reduce((a, t) => a + t.holdBars, 0) / n),
    pnlINR: r2(trades.reduce((a, t) => a + (t.pnlINR || 0), 0)),
  };
}

// ---------------- multi-symbol runner (cached) ----------------
const DEFAULT_CRYPTO = ['BTC', 'ETH', 'BNB', 'SOL', 'XRP', 'DOGE'];
const DEFAULT_INDIA = ['RELIANCE', 'HDFCBANK', 'ICICIBANK', 'INFY', 'TCS', 'SBIN'];
const _cache = new Map();
const CACHE_TTL = 10 * 60_000;

export async function runBacktest({ market = 'CRYPTO', symbols, minGrade = 'ACTION', capitalPerTradeINR = 1000, maxRiskPct = 5 }) {
  const mkt = String(market).toUpperCase() === 'INDIA' ? 'INDIA' : 'CRYPTO';
  const syms = (Array.isArray(symbols) && symbols.length > 0 ? symbols : (mkt === 'CRYPTO' ? DEFAULT_CRYPTO : DEFAULT_INDIA))
    .map(s => String(s).toUpperCase().replace(/[^A-Z0-9\-]/g, '')).filter(Boolean).slice(0, 8);
  const key = `bt:${mkt}:${syms.join(',')}:${minGrade}:${capitalPerTradeINR}:${maxRiskPct}`;
  const hit = _cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_TTL) return hit.payload;

  const maxHoldBars = mkt === 'CRYPTO' ? 48 : 5; // 48h vs 5 trading days
  const results = await Promise.allSettled(syms.map(async (sym) => {
    let candles = null;
    let source = null;
    if (mkt === 'CRYPTO') {
      candles = await fetchCoinDcxCandles(sym, '1h').catch(() => null);
      if (candles) source = 'coindcx-1h';
      else {
        candles = await fetchYahooHourlyCrypto(sym).catch(() => null);
        if (candles) source = 'yahoo-1h-USD';
      }
    } else {
      candles = await fetchYahooDailyCandles(sym).catch(() => null);
      if (candles) source = 'yahoo-1d';
    }
    if (!candles) return { symbol: sym, ok: false, reason: 'no historical data (CoinDCX + Yahoo both unreachable)' };
    const sim = simulateSymbol({ symbol: sym, market: mkt, candles, minGrade, maxRiskPct, capitalPerTradeINR, maxHoldBars });
    if (!sim) return { symbol: sym, ok: false, reason: 'not enough bars' };
    return { symbol: sym, ok: true, source, ...sim };
  }));

  const perSymbol = results.map(r => r.status === 'fulfilled' ? r.value : { symbol: '?', ok: false, reason: 'failed' });
  const allTrades = perSymbol.filter(s => s.ok).flatMap(s => s.trades.map(t => ({ ...t, symbol: s.symbol })));
  allTrades.sort((a, b) => (a.entryTime - b.entryTime) || (a.symbol < b.symbol ? -1 : 1));
  // equity curve in cumulative R (chronological)
  let cum = 0;
  const equity = allTrades.map((t, idx) => { cum += t.r; return { i: idx + 1, cumR: r2(cum), symbol: t.symbol, r: t.r }; });
  const stats = statsFrom(allTrades);
  const gradeDist = {};
  for (const t of allTrades) gradeDist[t.grade] = (gradeDist[t.grade] || 0) + 1;
  const exitDist = {};
  for (const t of allTrades) exitDist[t.reason] = (exitDist[t.reason] || 0) + 1;

  const payload = {
    ok: allTrades.length > 0 || perSymbol.some(s => s.ok),
    market: mkt,
    params: { minGrade, capitalPerTradeINR, maxRiskPct, maxHoldBars, slippagePct: 0.1, warmupBars: WARMUP },
    scannedSymbols: perSymbol.filter(s => s.ok).length,
    dataSources: perSymbol.filter(s => s.ok).map(s => ({ symbol: s.symbol, source: s.source })),
    perSymbol,
    stats: { ...stats, symbols: perSymbol.filter(s => s.ok).length },
    gradeDist, exitDist,
    equity: equity.slice(-120), // cap the payload
    trades: allTrades.slice(-40).reverse(), // most recent first (display)
    barsInfo: perSymbol.map(s => ({ symbol: s.symbol, ok: s.ok, source: s.source || null })),
    disclaimer: 'Walk-forward replay of the SAME live ensemble on historical candles. Past performance ≠ future results. R = multiples of initial risk. No AI Council vote (offline in backtests).',
    generatedAt: Date.now(),
  };
  _cache.set(key, { at: Date.now(), payload });
  return payload;
}

export function __clearBacktestCache() { _cache.clear(); }
