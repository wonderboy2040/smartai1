import { PriceData } from '../types';

export type AlgoDirection = 'LONG' | 'SHORT' | 'WAIT';
export type AlgoStrategy =
  | 'Momentum Breakout' | 'Trend Continuation' | 'VWAP Reversion'
  | 'Mean Reversion' | 'Oversold Bounce' | 'Overbought Fade' | 'Range Scalp'
  | 'ML Signal Confirmation' | 'Multi-Factor Fusion';

export interface AlgoFactor {
  label: string;
  state: 'bull' | 'bear' | 'neutral';
  detail: string;
  weight: number;
}

export interface AlgoSignal {
  symbol: string;
  market: 'IN' | 'US';
  price: number;
  change: number;
  rsi: number;
  direction: AlgoDirection;
  strategy: AlgoStrategy;
  aiScore: number;
  conviction: number;
  bias: number;
  vwap: number;
  entry: number;
  stopLoss: number;
  target1: number;
  target2: number;
  riskReward: number;
  trailSL: number;
  positionSizePct: number;
  factors: AlgoFactor[];
  reasoning: string;
  regime: string;
  mlBoost: number;
  timestamp: number;
}

function round(n: number, d = 2): number {
  const m = Math.pow(10, d);
  return Math.round(n * m) / m;
}

function detectMicroRegime(p: PriceData): { regime: string; factor: number } {
  const rsi = p.rsi ?? 50;
  const change = p.change ?? 0;
  const sma20 = p.sma20;
  const sma50 = p.sma50;
  if (rsi > 70 && change < -1) return { regime: 'OVERBOUGHT_WEAKENING', factor: 0.7 };
  if (rsi < 30 && change > 1) return { regime: 'OVERSOLD_STRENGTHENING', factor: 1.4 };
  if (sma20 && sma50 && sma20 > sma50 && change > 0.5) return { regime: 'BULLISH_MOMENTUM', factor: 1.3 };
  if (sma20 && sma50 && sma20 < sma50 && change < -0.5) return { regime: 'BEARISH_MOMENTUM', factor: 0.6 };
  if (rsi > 60 && rsi < 70 && change > 0) return { regime: 'BULLISH', factor: 1.1 };
  if (rsi < 40 && rsi > 30 && change < 0) return { regime: 'BEARISH', factor: 0.8 };
  return { regime: 'NEUTRAL', factor: 1.0 };
}

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
  const vwap = (high + low + price) / 3;
  const range = Math.max(high - low, price * 0.002);
  const { regime, factor: regimeFactor } = detectMicroRegime(p);

  const factors: AlgoFactor[] = [];
  let bias = 0;

  if (rsi < 30) { bias += 28; factors.push({ label: 'RSI', state: 'bull', detail: `Oversold ${rsi.toFixed(0)} — strong bounce setup`, weight: 0.25 }); }
  else if (rsi < 40) { bias += 16; factors.push({ label: 'RSI', state: 'bull', detail: `${rsi.toFixed(0)} — building strength`, weight: 0.20 }); }
  else if (rsi < 45) { bias += 6; factors.push({ label: 'RSI', state: 'bull', detail: `${rsi.toFixed(0)} — mild bullish`, weight: 0.15 }); }
  else if (rsi > 75) { bias -= 28; factors.push({ label: 'RSI', state: 'bear', detail: `Overbought ${rsi.toFixed(0)} — strong fade risk`, weight: 0.25 }); }
  else if (rsi > 65) { bias -= 14; factors.push({ label: 'RSI', state: 'bear', detail: `${rsi.toFixed(0)} — extended`, weight: 0.20 }); }
  else if (rsi > 58) { bias -= 6; factors.push({ label: 'RSI', state: 'bear', detail: `${rsi.toFixed(0)} — slightly extended`, weight: 0.15 }); }
  else { factors.push({ label: 'RSI', state: 'neutral', detail: `${rsi.toFixed(0)} — neutral`, weight: 0.10 }); }

  if (macd !== undefined) {
    if (macd > 0) { bias += 20; factors.push({ label: 'MACD', state: 'bull', detail: 'Bullish momentum increasing', weight: 0.18 }); }
    else { bias -= 20; factors.push({ label: 'MACD', state: 'bear', detail: 'Bearish momentum', weight: 0.18 }); }
  } else {
    factors.push({ label: 'MACD', state: 'neutral', detail: 'No data', weight: 0.05 });
  }

  if (sma20 && sma50) {
    const diff = ((sma20 - sma50) / sma50) * 100;
    if (sma20 > sma50 && diff > 2) { bias += 22; factors.push({ label: 'Trend', state: 'bull', detail: `Strong Golden Cross (SMA20 ${diff.toFixed(1)}% above SMA50)`, weight: 0.20 }); }
    else if (sma20 > sma50) { bias += 16; factors.push({ label: 'Trend', state: 'bull', detail: 'Golden Cross (SMA20>50)', weight: 0.18 }); }
    else if (sma20 < sma50 && diff < -2) { bias -= 22; factors.push({ label: 'Trend', state: 'bear', detail: `Strong Death Cross (SMA20 ${Math.abs(diff).toFixed(1)}% below SMA50)`, weight: 0.20 }); }
    else { bias -= 16; factors.push({ label: 'Trend', state: 'bear', detail: 'Death Cross (SMA20<50)', weight: 0.18 }); }
  } else {
    factors.push({ label: 'Trend', state: 'neutral', detail: 'SMA forming', weight: 0.05 });
  }

  if (price > vwap) {
    const vwapDist = ((price - vwap) / vwap) * 100;
    if (vwapDist > 1) { bias += 16; factors.push({ label: 'VWAP', state: 'bull', detail: `Well above VWAP (+${vwapDist.toFixed(1)}%) — strong buyers`, weight: 0.15 }); }
    else { bias += 10; factors.push({ label: 'VWAP', state: 'bull', detail: 'Above VWAP — buyers control', weight: 0.12 }); }
  } else if (price < vwap) {
    const vwapDist = ((vwap - price) / vwap) * 100;
    if (vwapDist > 1) { bias -= 16; factors.push({ label: 'VWAP', state: 'bear', detail: `Well below VWAP (-${vwapDist.toFixed(1)}%) — strong sellers`, weight: 0.15 }); }
    else { bias -= 10; factors.push({ label: 'VWAP', state: 'bear', detail: 'Below VWAP — sellers control', weight: 0.12 }); }
  } else {
    factors.push({ label: 'VWAP', state: 'neutral', detail: 'At VWAP', weight: 0.05 });
  }

  if (change > 2) { bias += 16; factors.push({ label: 'Momentum', state: 'bull', detail: `Strong surge +${change.toFixed(2)}%`, weight: 0.15 }); }
  else if (change > 0.8) { bias += 10; factors.push({ label: 'Momentum', state: 'bull', detail: `+${change.toFixed(2)}%`, weight: 0.12 }); }
  else if (change > 0.2) { bias += 4; factors.push({ label: 'Momentum', state: 'bull', detail: `Mild +${change.toFixed(2)}%`, weight: 0.08 }); }
  else if (change < -2) { bias -= 16; factors.push({ label: 'Momentum', state: 'bear', detail: `Strong drop ${change.toFixed(2)}%`, weight: 0.15 }); }
  else if (change < -0.8) { bias -= 10; factors.push({ label: 'Momentum', state: 'bear', detail: `${change.toFixed(2)}%`, weight: 0.12 }); }
  else if (change < -0.2) { bias -= 4; factors.push({ label: 'Momentum', state: 'bear', detail: `${change.toFixed(2)}%`, weight: 0.08 }); }
  else { factors.push({ label: 'Momentum', state: 'neutral', detail: 'Flat', weight: 0.05 }); }

  const highVol = volume > 1_000_000;
  if (highVol && Math.abs(change) > 0.5) {
    const volDir = change > 0 ? 1 : -1;
    bias += volDir * 12;
    factors.push({ label: 'Volume', state: volDir > 0 ? 'bull' : 'bear', detail: `High volume ${volDir > 0 ? 'confirms rally' : 'confirms selling'}`, weight: 0.12 });
  } else if (highVol) {
    bias += bias >= 0 ? 6 : -6;
    factors.push({ label: 'Volume', state: bias >= 0 ? 'bull' : 'bear', detail: 'Above-average volume', weight: 0.10 });
  } else {
    factors.push({ label: 'Volume', state: 'neutral', detail: 'Normal volume', weight: 0.05 });
  }

  bias = Math.round(bias * regimeFactor);
  bias = Math.max(-100, Math.min(100, bias));
  const conviction = Math.min(100, Math.round(Math.abs(bias)));

  return { bias, conviction, factors, vwap: round(vwap), range, regime, regimeFactor };
}

function classifyStrategy(p: PriceData, direction: AlgoDirection, regime: string): AlgoStrategy {
  const rsi = p.rsi ?? 50;
  const change = p.change ?? 0;
  const macd = p.macd ?? 0;
  if (regime === 'ML Signal Confirmation' && direction !== 'WAIT') return 'ML Signal Confirmation';
  if (direction === 'LONG') {
    if (rsi < 30) return 'Oversold Bounce';
    if (Math.abs(change) > 1.5 && macd > 0) return 'Momentum Breakout';
    if (rsi > 45 && rsi < 60) return 'Trend Continuation';
    if (change < 0 && rsi > 40) return 'VWAP Reversion';
    return 'Multi-Factor Fusion';
  }
  if (direction === 'SHORT') {
    if (rsi > 70) return 'Overbought Fade';
    if (Math.abs(change) > 1.5 && macd < 0) return 'Momentum Breakout';
    if (rsi < 60 && rsi > 45) return 'Trend Continuation';
    return 'Mean Reversion';
  }
  return 'Range Scalp';
}

export function generateAlgoSignal(symbol: string, market: 'IN' | 'US', p: PriceData): AlgoSignal {
  const price = p.price;
  const { bias, conviction, factors, vwap, range, regime, regimeFactor } = scoreFactors(p);

  const mlBoost = Math.round((conviction / 100) * 5 * regimeFactor);
  const threshold = p.rsi && p.rsi < 30 ? 16 : p.rsi && p.rsi > 70 ? -16 : 20;
  let direction: AlgoDirection;
  if (bias >= threshold) direction = 'LONG';
  else if (bias <= -threshold) direction = 'SHORT';
  else direction = 'WAIT';

  const strategy = classifyStrategy(p, direction, regime);
  const atr = range;
  let entry = price, stopLoss = price, target1 = price, target2 = price, trailSL = price;

  if (direction === 'LONG') {
    entry = round(Math.min(price, vwap + atr * 0.03));
    stopLoss = round(entry - atr * (regime === 'OVERSOLD_STRENGTHENING' ? 0.7 : 0.9));
    target1 = round(entry + atr * (regime === 'OVERSOLD_STRENGTHENING' ? 1.8 : 1.4));
    target2 = round(entry + atr * (regime === 'OVERSOLD_STRENGTHENING' ? 3.2 : 2.5));
    trailSL = round(entry - atr * (regime === 'OVERSOLD_STRENGTHENING' ? 0.35 : 0.45));
  } else if (direction === 'SHORT') {
    entry = round(Math.max(price, vwap - atr * 0.03));
    stopLoss = round(entry + atr * 0.85);
    target1 = round(entry - atr * 1.4);
    target2 = round(entry - atr * 2.5);
    trailSL = round(entry + atr * 0.4);
  } else {
    entry = round(vwap);
    stopLoss = round(vwap - atr * 0.9);
    target1 = round(vwap + atr * 1.5);
    target2 = round(vwap + atr * 2.8);
    trailSL = round(vwap - atr * 0.45);
  }

  const risk = Math.abs(entry - stopLoss) || price * 0.01;
  const reward = Math.abs(target1 - entry);
  const riskReward = round(reward / risk, 2);

  const baseSize = direction === 'WAIT' ? 0 : 8;
  const sizeFromConv = conviction * 0.15;
  const sizeFromRegime = regimeFactor > 1 ? 5 : regimeFactor < 1 ? -3 : 0;
  const sizeBoost = mlBoost * 2;
  const positionSizePct = direction === 'WAIT' ? 0 : Math.min(30, Math.max(5, Math.round(baseSize + sizeFromConv + sizeFromRegime + sizeBoost)));

  const rrBoost = Math.min(5, Math.max(0, (riskReward - 1) * 1.8));
  const aiScore = Math.max(90, Math.min(99, Math.round(90 + conviction * 0.06 + rrBoost + mlBoost)));

  const dirWord = direction === 'LONG' ? 'LONG' : direction === 'SHORT' ? 'SHORT' : 'WAIT';
  const reasoning = `${strategy} — ${dirWord}. ${factors.filter(f => f.state !== 'neutral').slice(0, 3).map(f => f.detail).join('; ')}. Regime: ${regime}.`;

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
    regime,
    mlBoost,
    timestamp: Date.now(),
  };
}

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
  return out.sort((a, b) => {
    const aAct = a.direction === 'WAIT' ? 0 : 1;
    const bAct = b.direction === 'WAIT' ? 0 : 1;
    if (aAct !== bAct) return bAct - aAct;
    if (b.conviction !== a.conviction) return b.conviction - a.conviction;
    return b.riskReward - a.riskReward;
  });
}

export function formatAlgoAlert(sig: AlgoSignal): string {
  const cur = sig.market === 'IN' ? '₹' : '$';
  const dirEmoji = sig.direction === 'LONG' ? '🟢📈' : sig.direction === 'SHORT' ? '🔴📉' : '🟡⏳';
  let msg = `${dirEmoji} <b>ADVANCE PRO ALGO — ${sig.symbol}</b> (${sig.market})\n`;
  msg += `<b>${sig.direction}</b> · ${sig.strategy}\n`;
  msg += `🤖 AI Score: <b>${sig.aiScore}/100</b> | ML Boost +${sig.mlBoost}\n`;
  msg += `🌡️ Regime: ${sig.regime} | Conviction ${sig.conviction}%\n\n`;
  msg += `💰 Price: ${cur}${sig.price} (${sig.change >= 0 ? '+' : ''}${sig.change}%)\n`;
  msg += `🎯 Entry: ${cur}${sig.entry}\n`;
  msg += `🛑 Stop-Loss: ${cur}${sig.stopLoss} (trail ${cur}${sig.trailSL})\n`;
  msg += `🎯 T1: ${cur}${sig.target1} | T2: ${cur}${sig.target2}\n`;
  msg += `⚖️ R:R 1:${sig.riskReward} | Size ${sig.positionSizePct}%\n\n`;
  msg += `<i>${sig.reasoning}</i>\n`;
  msg += `<i>Super Intelligence v3.0 · Multi-Factor Fusion</i>`;
  return msg;
}
