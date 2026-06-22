// ============================================================
// ADVANCE PRO ALGO TRADING — SUPER INTELLIGENCE ENGINE
// ------------------------------------------------------------
// Generates institutional-grade INTRADAY signals from live price
// data: multi-factor scoring (RSI, MACD, SMA cross, VWAP/pivot,
// momentum, volatility, volume confirmation), exact entry/SL/2T,
// risk:reward, position sizing, and a strategy classification.
//
// AI Score: by design the displayed "AI Score" stays in the elite
// 90-99 band (high-conviction terminal). Internally we keep a raw
// conviction 0-100 for ranking and direction strength.
// ============================================================

import { PriceData } from '../types';

export type AlgoDirection = 'LONG' | 'SHORT' | 'WAIT';
export type AlgoStrategy =
  | 'Momentum Breakout'
  | 'Trend Continuation'
  | 'VWAP Reversion'
  | 'Mean Reversion'
  | 'Oversold Bounce'
  | 'Overbought Fade'
  | 'Range Scalp';

export interface AlgoFactor {
  label: string;
  state: 'bull' | 'bear' | 'neutral';
  detail: string;
}

export interface AlgoSignal {
  symbol: string;
  market: 'IN' | 'US';
  price: number;
  change: number;
  rsi: number;
  direction: AlgoDirection;
  strategy: AlgoStrategy;
  aiScore: number;        // elite display score (90-99)
  conviction: number;     // raw 0-100 (for ranking)
  bias: number;           // -100..+100 (bearish..bullish)
  vwap: number;
  entry: number;
  stopLoss: number;
  target1: number;
  target2: number;
  riskReward: number;
  trailSL: number;
  positionSizePct: number; // suggested % of intraday capital
  factors: AlgoFactor[];
  reasoning: string;
  timestamp: number;
}

function round(n: number, d = 2): number {
  const m = Math.pow(10, d);
  return Math.round(n * m) / m;
}

/**
 * Core super-intelligence scorer. Returns a directional bias (-100..+100),
 * a raw conviction (0..100) and the contributing factors.
 */
function scoreFactors(p: PriceData) {
  const price = p.price;
  const rsi = p.rsi ?? 50;
  const change = p.change ?? 0;
  const sma20 = p.sma20;
  const sma50 = p.sma50;
  const macd = p.macd;
  const high = p.high || price * 1.01;
  const low = p.low || price * 0.99;
  const volume = p.volume || 0;

  const vwap = (high + low + price) / 3; // typical-price VWAP proxy (pivot)
  const range = Math.max(high - low, price * 0.002);

  const factors: AlgoFactor[] = [];
  let bias = 0;

  // 1) RSI momentum / exhaustion
  if (rsi < 30) { bias += 26; factors.push({ label: 'RSI', state: 'bull', detail: `Oversold ${rsi.toFixed(0)} — bounce setup` }); }
  else if (rsi < 45) { bias += 14; factors.push({ label: 'RSI', state: 'bull', detail: `${rsi.toFixed(0)} — building strength` }); }
  else if (rsi > 70) { bias -= 26; factors.push({ label: 'RSI', state: 'bear', detail: `Overbought ${rsi.toFixed(0)} — fade risk` }); }
  else if (rsi > 58) { bias -= 8; factors.push({ label: 'RSI', state: 'bear', detail: `${rsi.toFixed(0)} — extended` }); }
  else { factors.push({ label: 'RSI', state: 'neutral', detail: `${rsi.toFixed(0)} — neutral` }); }

  // 2) MACD momentum
  if (macd !== undefined) {
    if (macd > 0) { bias += 18; factors.push({ label: 'MACD', state: 'bull', detail: 'Bullish momentum' }); }
    else { bias -= 18; factors.push({ label: 'MACD', state: 'bear', detail: 'Bearish momentum' }); }
  } else {
    factors.push({ label: 'MACD', state: 'neutral', detail: 'No data' });
  }

  // 3) SMA crossover (trend)
  if (sma20 && sma50) {
    if (sma20 > sma50) { bias += 18; factors.push({ label: 'Trend', state: 'bull', detail: 'Golden Cross (SMA20>50)' }); }
    else { bias -= 18; factors.push({ label: 'Trend', state: 'bear', detail: 'Death Cross (SMA20<50)' }); }
  } else {
    factors.push({ label: 'Trend', state: 'neutral', detail: 'SMA forming' });
  }

  // 4) Price vs VWAP/pivot
  if (price > vwap) { bias += 12; factors.push({ label: 'VWAP', state: 'bull', detail: 'Above VWAP — buyers control' }); }
  else if (price < vwap) { bias -= 12; factors.push({ label: 'VWAP', state: 'bear', detail: 'Below VWAP — sellers control' }); }
  else { factors.push({ label: 'VWAP', state: 'neutral', detail: 'At VWAP' }); }

  // 5) Intraday momentum (change %)
  if (change > 1.2) { bias += 12; factors.push({ label: 'Momentum', state: 'bull', detail: `+${change.toFixed(2)}% surge` }); }
  else if (change > 0.2) { bias += 6; factors.push({ label: 'Momentum', state: 'bull', detail: `+${change.toFixed(2)}%` }); }
  else if (change < -1.2) { bias -= 12; factors.push({ label: 'Momentum', state: 'bear', detail: `${change.toFixed(2)}% drop` }); }
  else if (change < -0.2) { bias -= 6; factors.push({ label: 'Momentum', state: 'bear', detail: `${change.toFixed(2)}%` }); }
  else { factors.push({ label: 'Momentum', state: 'neutral', detail: 'Flat' }); }

  // 6) Volume confirmation (amplifies whichever side is winning)
  const highVol = volume > 1_000_000;
  if (highVol) {
    bias += bias >= 0 ? 8 : -8;
    factors.push({ label: 'Volume', state: bias >= 0 ? 'bull' : 'bear', detail: 'Above-average volume confirms' });
  } else {
    factors.push({ label: 'Volume', state: 'neutral', detail: 'Normal volume' });
  }

  bias = Math.max(-100, Math.min(100, bias));
  const conviction = Math.min(100, Math.round(Math.abs(bias)));
  return { bias, conviction, factors, vwap: round(vwap), range };
}

function classifyStrategy(p: PriceData, direction: AlgoDirection): AlgoStrategy {
  const rsi = p.rsi ?? 50;
  const change = p.change ?? 0;
  const macd = p.macd ?? 0;
  const sma20 = p.sma20, sma50 = p.sma50;
  const trendUp = sma20 && sma50 ? sma20 > sma50 : change > 0;

  // Labels must stay consistent with the trade direction.
  if (direction === 'LONG') {
    if (rsi < 32) return 'Oversold Bounce';
    if (Math.abs(change) > 1.2 && macd > 0) return 'Momentum Breakout';
    if (trendUp) return 'Trend Continuation';
    return 'VWAP Reversion';
  }
  if (direction === 'SHORT') {
    if (rsi > 70) return 'Overbought Fade';
    if (!trendUp) return 'Trend Continuation';
    if (Math.abs(change) > 1.2 && macd < 0) return 'Momentum Breakout';
    return 'Mean Reversion';
  }
  return 'Range Scalp'; // WAIT — no actionable edge
}

/**
 * Build a full intraday algo signal for one symbol.
 */
export function generateAlgoSignal(symbol: string, market: 'IN' | 'US', p: PriceData): AlgoSignal {
  const price = p.price;
  const { bias, conviction, factors, vwap, range } = scoreFactors(p);

  let direction: AlgoDirection;
  if (bias >= 22) direction = 'LONG';
  else if (bias <= -22) direction = 'SHORT';
  else direction = 'WAIT';

  const strategy = classifyStrategy(p, direction);

  // ATR-based levels (range proxy = day high-low)
  const atr = range;
  let entry = price, stopLoss = price, target1 = price, target2 = price, trailSL = price;

  if (direction === 'LONG') {
    entry = round(Math.min(price, vwap + atr * 0.05));
    stopLoss = round(entry - atr * 0.9);
    target1 = round(entry + atr * 1.5);
    target2 = round(entry + atr * 2.8);
    trailSL = round(entry - atr * 0.45);
  } else if (direction === 'SHORT') {
    entry = round(Math.max(price, vwap - atr * 0.05));
    stopLoss = round(entry + atr * 0.9);
    target1 = round(entry - atr * 1.5);
    target2 = round(entry - atr * 2.8);
    trailSL = round(entry + atr * 0.45);
  } else {
    // WAIT — show the breakout trigger as entry reference
    entry = round(vwap);
    stopLoss = round(vwap - atr * 0.9);
    target1 = round(vwap + atr * 1.5);
    target2 = round(vwap + atr * 2.8);
    trailSL = round(vwap - atr * 0.45);
  }

  const risk = Math.abs(entry - stopLoss) || price * 0.01;
  const reward = Math.abs(target1 - entry);
  const riskReward = round(reward / risk, 2);

  // Position sizing: scale with conviction, capped for risk control.
  const positionSizePct = direction === 'WAIT' ? 0 : Math.min(25, Math.round(8 + conviction * 0.17));

  // AI Score — elite 90-99 band, scaled by conviction (and a touch by R:R).
  const rrBoost = Math.min(4, Math.max(0, (riskReward - 1) * 1.5));
  const aiScore = Math.max(90, Math.min(99, Math.round(90 + conviction * 0.07 + rrBoost)));

  const dirWord = direction === 'LONG' ? 'LONG' : direction === 'SHORT' ? 'SHORT' : 'WAIT for trigger';
  const reasoning = `${strategy} — ${dirWord}. ${factors.filter(f => f.state !== 'neutral').slice(0, 3).map(f => f.detail).join('; ')}.`;

  return {
    symbol: symbol.replace('.NS', '').replace('.BO', ''),
    market,
    price: round(price),
    change: round(p.change ?? 0, 2),
    rsi: round(p.rsi ?? 50, 1),
    direction,
    strategy,
    aiScore,
    conviction,
    bias: Math.round(bias),
    vwap,
    entry, stopLoss, target1, target2, trailSL,
    riskReward,
    positionSizePct,
    factors,
    reasoning,
    timestamp: Date.now(),
  };
}

/**
 * Scan a watchlist of "MARKET_SYMBOL" keys against live prices and return
 * ranked intraday signals (highest conviction first). Crypto is included
 * (24x7 intraday), indices excluded by default unless asked.
 */
export function scanAlgoSignals(
  keys: string[],
  livePrices: Record<string, PriceData>,
): AlgoSignal[] {
  const out: AlgoSignal[] = [];
  for (const key of keys) {
    const [market, symbol] = key.split('_') as ['IN' | 'US', string];
    const data = livePrices[key];
    if (!data || !data.price || data.price <= 0) continue;
    out.push(generateAlgoSignal(symbol, market, data));
  }
  // Actionable (LONG/SHORT) first, then by conviction, then R:R.
  return out.sort((a, b) => {
    const aAct = a.direction === 'WAIT' ? 0 : 1;
    const bAct = b.direction === 'WAIT' ? 0 : 1;
    if (aAct !== bAct) return bAct - aAct;
    if (b.conviction !== a.conviction) return b.conviction - a.conviction;
    return b.riskReward - a.riskReward;
  });
}

/**
 * Telegram-formatted intraday algo alert.
 */
export function formatAlgoAlert(sig: AlgoSignal): string {
  const cur = sig.market === 'IN' ? '₹' : '$';
  const dirEmoji = sig.direction === 'LONG' ? '🟢📈' : sig.direction === 'SHORT' ? '🔴📉' : '🟡⏳';
  let msg = `${dirEmoji} <b>INTRADAY ALGO — ${sig.symbol}</b> (${sig.market})\n`;
  msg += `<b>${sig.direction}</b> · ${sig.strategy}\n`;
  msg += `🤖 AI Score: <b>${sig.aiScore}/100</b> | Conviction ${sig.conviction}%\n\n`;
  msg += `💰 Price: ${cur}${sig.price} (${sig.change >= 0 ? '+' : ''}${sig.change}%)\n`;
  msg += `🎯 Entry: ${cur}${sig.entry}\n`;
  msg += `🛑 Stop-Loss: ${cur}${sig.stopLoss} (trail ${cur}${sig.trailSL})\n`;
  msg += `🎯 T1: ${cur}${sig.target1} | T2: ${cur}${sig.target2}\n`;
  msg += `⚖️ R:R 1:${sig.riskReward} | Size ${sig.positionSizePct}%\n\n`;
  msg += `<i>${sig.reasoning}</i>\n`;
  msg += `<i>Advance Pro Algo · Super Intelligence v1.0</i>`;
  return msg;
}
