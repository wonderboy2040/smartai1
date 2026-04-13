import React, { useMemo } from 'react';
import { PriceData } from '../types';

interface MLProps {
  symbol:      string;
  market:      'IN' | 'US';
  data:        PriceData | undefined;
  usdInrRate:  number;
}

interface Prediction {
  currentPrice:    number;
  expectedPrice:   number;
  expectedMovePct: number;
  rangeLow70:      number;
  rangeHigh70:     number;
  rangeLow90:      number;
  rangeHigh90:     number;
  targetBull:      number;
  stopBull:        number;
  targetBear:      number;
  stopBear:        number;
  fib618:          number;
  fib382:          number;
  atr:             number;
  atrPct:          number;
  momentumScore:   number;
  pUp:             number;
  confidence:      number;
  signal:          'BULLISH' | 'BEARISH' | 'NEUTRAL';
  rrBull:          number;
  factors:         string[];
}

function runMLEngine(data: PriceData | undefined): Prediction | null {
  if (!data || data.price <= 0) return null;

  const price  = data.price;
  const rsi    = data.rsi    ?? 50;
  const change = data.change ?? 0;
  const high   = data.high   ?? price * 1.02;
  const low    = data.low    ?? price * 0.98;
  const sma20  = data.sma20  ?? price;
  const sma50  = data.sma50  ?? price;
  const macd   = data.macd   ?? 0;

  // ── ATR (Average True Range) ────────────────────────
  const atr    = Math.max(high - low, price * 0.012);
  const atrPct = (atr / price) * 100;

  // ── Feature Engineering ─────────────────────────────
  let score = 50; // 0-100
  const factors: string[] = [];

  // RSI Signal
  if      (rsi < 30) { score += 22; factors.push('RSI Oversold (<30) — Strong bounce expected'); }
  else if (rsi < 40) { score += 12; factors.push('RSI Buy Zone (30-40) — Accumulation momentum'); }
  else if (rsi < 55) { score +=  0; factors.push('RSI Neutral (40-55) — No directional bias'); }
  else if (rsi < 65) { score -=  8; factors.push('RSI Elevated (55-65) — Momentum slowing'); }
  else if (rsi < 75) { score -= 15; factors.push('RSI Overbought (65-75) — Distribution zone'); }
  else               { score -= 22; factors.push('RSI Extreme (75+) — Reversal risk HIGH'); }

  // SMA Crossover (trend filter)
  const smaSignal = sma20 > sma50 ? 1 : -1;
  if (smaSignal > 0) { score += 10; factors.push('SMA20 > SMA50 — Uptrend confirmed'); }
  else               { score -= 10; factors.push('SMA20 < SMA50 — Downtrend active'); }

  // MACD
  const macdSignal = macd > 0.1 ? 1 : macd < -0.1 ? -1 : 0;
  if      (macdSignal > 0) { score +=  8; factors.push('MACD Bullish histogram — Momentum building'); }
  else if (macdSignal < 0) { score -=  8; factors.push('MACD Bearish histogram — Selling pressure'); }
  else                     { factors.push('MACD Flat — Consolidation phase'); }

  // Price vs SMA (valuation)
  const priceSMA20Ratio = price / sma20;
  if      (priceSMA20Ratio < 0.97) { score += 8; factors.push('Price below SMA20 — Deep value zone'); }
  else if (priceSMA20Ratio > 1.05) { score -= 8; factors.push('Price 5%+ above SMA20 — Extended, caution'); }

  // Momentum (1-day change)
  if      (change > 2.5)  { score +=  5; factors.push(`Strong intraday up ${change.toFixed(1)}% — Momentum play`); }
  else if (change < -2.5) { score -=  5; factors.push(`Sharp intraday drop ${change.toFixed(1)}% — Sell pressure`); }

  score = Math.max(5, Math.min(95, score));

  // ── Direction & Confidence ───────────────────────────
  const pUp     = score / 100;
  const signal: Prediction['signal'] = score > 60 ? 'BULLISH' : score < 40 ? 'BEARISH' : 'NEUTRAL';

  // Confidence: alignment of signals
  const alignedFactors = (smaSignal > 0 ? 1 : -1) + macdSignal + (rsi < 45 ? 1 : rsi > 65 ? -1 : 0);
  const confidence = Math.min(93, 48 + Math.abs(alignedFactors) * 14 + Math.abs(rsi - 50) * 0.4);

  // ── Price Targets ────────────────────────────────────
  const expectedMove     = (pUp - 0.5) * atr * 2;
  const expectedPrice    = price + expectedMove;
  const expectedMovePct  = (expectedMove / price) * 100;

  // Probability bands
  const rangeLow70  = price - atr * 0.75;
  const rangeHigh70 = price + atr * 0.75;
  const rangeLow90  = price - atr * 1.40;
  const rangeHigh90 = price + atr * 1.40;

  // ATR-based SL/TP
  const targetBull = price + atr * 2.5;
  const stopBull   = price - atr * 1.0;
  const targetBear = price - atr * 2.0;
  const stopBear   = price + atr * 1.2;
  const rrBull     = (targetBull - price) / (price - stopBull);

  // Fibonacci swing levels
  const swingRange = (high - low) * 1.618;
  const fib618     = low  + swingRange * 0.618;
  const fib382     = low  + swingRange * 0.382;

  return {
    currentPrice: price, expectedPrice, expectedMovePct,
    rangeLow70, rangeHigh70, rangeLow90, rangeHigh90,
    targetBull, stopBull, targetBear, stopBear,
    fib618, fib382,
    atr, atrPct, momentumScore: score,
    pUp: pUp * 100, confidence, signal, rrBull, factors,
  };
}

export const MLPricePredictor = React.memo(({ symbol, market, data }: MLProps) => {
  const pred = useMemo(() => runMLEngine(data), [data]);
  const cur  = market === 'IN' ? '₹' : '$';

  if (!pred) {
    return (
      <div className="glass-card rounded-2xl p-5">
        <div className="flex items-center gap-2 mb-3">
          <span className="w-7 h-7 rounded-lg bg-violet-500/10 flex items-center justify-center text-sm">🤖</span>
          <span className="text-base font-bold text-white">ML Deep AI — Price Predictor</span>
        </div>
        <div className="text-center py-6 text-slate-600 text-sm">
          Symbol select karo — price data load hone ke baad AI prediction dikhega
        </div>
      </div>
    );
  }

  const { signal, confidence, pUp, expectedPrice, expectedMovePct,
    rangeLow70, rangeHigh70, rangeLow90, rangeHigh90,
    targetBull, stopBull, targetBear, stopBear,
    fib618, fib382, momentumScore, atrPct, rrBull, factors } = pred;

  const sigColor = signal === 'BULLISH' ? 'text-emerald-400' : signal === 'BEARISH' ? 'text-red-400' : 'text-amber-400';
  const sigBg    = signal === 'BULLISH' ? 'bg-emerald-500/10 border-emerald-500/25' : signal === 'BEARISH' ? 'bg-red-500/10 border-red-500/25' : 'bg-amber-500/10 border-amber-500/25';
  const sigEmoji = signal === 'BULLISH' ? '📈' : signal === 'BEARISH' ? '📉' : '↔️';

  // For gauge arc
  const arc = (confidence / 100) * 100;
  const arcColor = signal === 'BULLISH' ? '#10b981' : signal === 'BEARISH' ? '#ef4444' : '#f59e0b';

  return (
    <div className="glass-card rounded-2xl p-5 animate-fade-in-up">
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-base font-bold text-white flex items-center gap-2">
          <span className="w-7 h-7 rounded-lg bg-violet-500/10 flex items-center justify-center text-sm">🤖</span>
          ML Deep AI — Price Predictor
          <span className="badge bg-violet-500/10 text-violet-400 border border-violet-500/20 text-[10px]">QUANTUM ENGINE</span>
        </h2>
        <span className="text-xs font-bold text-slate-500 font-mono">{symbol.replace('.NS', '')}</span>
      </div>

      {/* Main Signal Row */}
      <div className={`rounded-xl p-4 border ${sigBg} mb-4 flex items-center justify-between`}>
        <div>
          <div className="text-[10px] text-slate-400 font-bold uppercase tracking-wider">AI Direction Signal</div>
          <div className={`text-2xl font-black mt-1 ${sigColor}`}>{sigEmoji} {signal}</div>
          <div className="text-[10px] text-slate-500 mt-1.5">
            Upside prob: <span className={`font-black ${pUp > 55 ? 'text-emerald-400' : pUp < 45 ? 'text-red-400' : 'text-amber-400'}`}>{pUp.toFixed(1)}%</span>
            &nbsp;│&nbsp;
            Downside: <span className="font-bold text-slate-400">{(100 - pUp).toFixed(1)}%</span>
          </div>
        </div>
        {/* Circular Confidence Gauge */}
        <div className="relative w-16 h-16 flex-shrink-0">
          <svg viewBox="0 0 36 36" className="w-full h-full -rotate-90">
            <circle cx="18" cy="18" r="15.9" fill="none" stroke="rgba(255,255,255,0.05)" strokeWidth="3.5" />
            <circle
              cx="18" cy="18" r="15.9" fill="none"
              stroke={arcColor}
              strokeWidth="3.5"
              strokeDasharray={`${arc} ${100 - arc}`}
              strokeLinecap="round"
              style={{ transition: 'stroke-dasharray 0.6s ease' }}
            />
          </svg>
          <div className="absolute inset-0 flex flex-col items-center justify-center">
            <span className={`text-[11px] font-black ${sigColor}`}>{confidence.toFixed(0)}%</span>
            <span className="text-[7px] text-slate-600">CONF</span>
          </div>
        </div>
      </div>

      <div className="grid md:grid-cols-2 gap-3 mb-3">
        {/* Next Session Forecast */}
        <div className="bg-black/20 rounded-xl p-3 border border-white/5">
          <div className="text-[9px] text-slate-500 font-bold uppercase tracking-wider mb-2">📊 Next Session Forecast</div>
          <div className="flex justify-between items-end">
            <div>
              <div className="text-[8px] text-slate-600">AI Target Price</div>
              <div className="text-base font-black text-white font-mono">{cur}{expectedPrice.toFixed(2)}</div>
            </div>
            <div className={`text-sm font-black ${expectedMovePct >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
              {expectedMovePct >= 0 ? '+' : ''}{expectedMovePct.toFixed(2)}%
            </div>
          </div>
        </div>

        {/* Fibonacci Levels */}
        <div className="bg-black/20 rounded-xl p-3 border border-white/5">
          <div className="text-[9px] text-slate-500 font-bold uppercase tracking-wider mb-2">📐 Fibonacci Levels</div>
          <div className="space-y-1">
            <div className="flex justify-between">
              <span className="text-[9px] text-amber-400">0.618 Fib</span>
              <span className="text-[9px] font-mono text-white">{cur}{fib618.toFixed(2)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-[9px] text-cyan-400">0.382 Fib</span>
              <span className="text-[9px] font-mono text-white">{cur}{fib382.toFixed(2)}</span>
            </div>
            <div className="text-[8px] text-slate-600 mt-1">Based on today's range × 1.618 extension</div>
          </div>
        </div>
      </div>

      {/* Probability Bands */}
      <div className="bg-black/20 rounded-xl p-3 border border-white/5 mb-3">
        <div className="text-[9px] text-slate-500 font-bold uppercase tracking-wider mb-3">🎯 Statistical Probability Bands</div>
        <div className="space-y-3">
          {/* 70% band */}
          <div>
            <div className="flex justify-between mb-1">
              <span className="text-[9px] text-emerald-400 font-bold">70% Zone</span>
              <span className="text-[9px] text-slate-400 font-mono">{cur}{rangeLow70.toFixed(2)} — {cur}{rangeHigh70.toFixed(2)}</span>
            </div>
            <div className="relative h-3 w-full bg-slate-800/60 rounded-full overflow-hidden">
              <div className="absolute inset-0">
                <div className="h-full bg-gradient-to-r from-transparent via-emerald-500/40 to-transparent" style={{ width: '60%', marginLeft: '20%' }} />
              </div>
              <div className="absolute top-0 bottom-0 left-1/2 w-0.5 bg-white/40" />
            </div>
          </div>
          {/* 90% band */}
          <div>
            <div className="flex justify-between mb-1">
              <span className="text-[9px] text-cyan-400/80 font-bold">90% Zone</span>
              <span className="text-[9px] text-slate-500 font-mono">{cur}{rangeLow90.toFixed(2)} — {cur}{rangeHigh90.toFixed(2)}</span>
            </div>
            <div className="relative h-3 w-full bg-slate-800/60 rounded-full overflow-hidden">
              <div className="h-full bg-gradient-to-r from-transparent via-cyan-500/25 to-transparent" style={{ width: '80%', marginLeft: '10%' }} />
            </div>
          </div>
        </div>
      </div>

      {/* Bull/Bear Scenarios */}
      <div className="grid grid-cols-2 gap-2 mb-3">
        <div className="bg-emerald-500/5 border border-emerald-500/20 rounded-xl p-3">
          <div className="text-[9px] text-emerald-400 font-bold uppercase mb-2">🟢 Bull Scenario</div>
          <div className="text-[10px] text-slate-400">Target: <span className="text-emerald-400 font-mono font-bold">{cur}{targetBull.toFixed(2)}</span></div>
          <div className="text-[10px] text-slate-400">Stop: <span className="text-red-400 font-mono font-bold">{cur}{stopBull.toFixed(2)}</span></div>
          <div className="text-[9px] text-slate-500 mt-1">R:R {rrBull.toFixed(1)}:1</div>
        </div>
        <div className="bg-red-500/5 border border-red-500/20 rounded-xl p-3">
          <div className="text-[9px] text-red-400 font-bold uppercase mb-2">🔴 Bear Scenario</div>
          <div className="text-[10px] text-slate-400">Target: <span className="text-red-400 font-mono font-bold">{cur}{targetBear.toFixed(2)}</span></div>
          <div className="text-[10px] text-slate-400">Stop: <span className="text-emerald-400 font-mono font-bold">{cur}{stopBear.toFixed(2)}</span></div>
          <div className="text-[9px] text-slate-500 mt-1">ATR {atrPct.toFixed(2)}% risk</div>
        </div>
      </div>

      {/* Momentum Gauge */}
      <div className="bg-black/20 rounded-xl p-3 border border-white/5 mb-3">
        <div className="flex items-center justify-between mb-2">
          <div className="text-[9px] text-slate-500 font-bold uppercase tracking-wider">ML Momentum Score</div>
          <div className={`text-sm font-black ${momentumScore > 60 ? 'text-emerald-400' : momentumScore < 40 ? 'text-red-400' : 'text-amber-400'}`}>
            {momentumScore.toFixed(0)}/100
          </div>
        </div>
        <div className="relative h-3 w-full bg-gradient-to-r from-red-600 via-amber-500 to-emerald-500 rounded-full">
          <div
            className="absolute top-1/2 -translate-y-1/2 w-3.5 h-3.5 bg-white rounded-full shadow-lg transition-all duration-500"
            style={{ left: `calc(${momentumScore}% - 7px)` }}
          />
        </div>
        <div className="flex justify-between text-[8px] text-slate-600 mt-1">
          <span>SELL ZONE</span><span>NEUTRAL</span><span>BUY ZONE</span>
        </div>
      </div>

      {/* AI Factor Analysis */}
      <div className="bg-black/20 rounded-xl p-3 border border-white/5">
        <div className="text-[9px] text-violet-400/80 font-bold uppercase tracking-wider mb-2">🧬 ML Factor Analysis</div>
        <div className="space-y-1">
          {factors.slice(0, 4).map((f, i) => (
            <div key={i} className="flex items-start gap-2">
              <span className="text-[8px] text-slate-600 mt-0.5">{i + 1}.</span>
              <span className="text-[9px] text-slate-400 leading-relaxed">{f}</span>
            </div>
          ))}
        </div>
      </div>

      <div className="mt-3 text-[8px] text-slate-700 text-center">
        ⚠️ AI prediction engine — educational reference only. Always apply risk management.
      </div>
    </div>
  );
});
