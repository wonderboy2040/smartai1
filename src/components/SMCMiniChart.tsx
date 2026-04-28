import { useMemo } from 'react';
import { SMCAnalysisResult } from '../utils/smcEngine';

interface SMCMiniChartProps {
  result: SMCAnalysisResult;
}

/** Seeded pseudo-random for deterministic charts per symbol */
function seededRandom(seed: number) {
  let s = seed;
  return () => { s = (s * 16807 + 0) % 2147483647; return (s & 0x7fffffff) / 0x7fffffff; };
}

function hashSymbol(sym: string): number {
  let h = 0;
  for (let i = 0; i < sym.length; i++) h = ((h << 5) - h + sym.charCodeAt(i)) | 0;
  return Math.abs(h);
}

/** Generate deterministic candle data from current price + SMC indicators */
function generateCandles(price: number, change: number, rsi: number, symbol: string, structure: SMCAnalysisResult['structure']) {
  const rand = seededRandom(hashSymbol(symbol));
  const candles: { o: number; h: number; l: number; c: number; vol: number; signal?: 'buy' | 'sell' }[] = [];
  const atr = price * 0.012;
  const trendBias = structure.trendBias * 0.001 * atr;
  let p = price * (1 - change / 100 * 2.5);

  for (let i = 0; i < 40; i++) {
    const drift = (rand() - 0.47) * atr * 0.7 + trendBias;
    const wick = rand() * atr * 0.4;
    const o = p;
    const c = o + drift;
    const h = Math.max(o, c) + wick;
    const l = Math.min(o, c) - wick * 0.8;
    const vol = 50 + rand() * 100;
    candles.push({ o, h, l, c, vol });
    p = c;
  }

  // Scale last candle to actual price
  const last = candles[candles.length - 1];
  const scale = price / last.c;
  candles.forEach(c => { c.o *= scale; c.h *= scale; c.l *= scale; c.c *= scale; });

  // Mark signals at swing extremes
  let minIdx = 5, maxIdx = 5;
  for (let i = 5; i < candles.length - 2; i++) {
    if (candles[i].l < candles[minIdx].l) minIdx = i;
    if (candles[i].h > candles[maxIdx].h) maxIdx = i;
  }
  if (minIdx > 3 && minIdx < candles.length - 3) candles[minIdx].signal = 'buy';
  if (maxIdx > 3 && maxIdx < candles.length - 3 && maxIdx !== minIdx) candles[maxIdx].signal = 'sell';

  // RSI-based signals on recent candles
  if (rsi < 35) candles[candles.length - 1].signal = 'buy';
  else if (rsi > 65) candles[candles.length - 1].signal = 'sell';

  return candles;
}

/** Compute EMA line from candle closes */
function computeEMA(candles: { c: number }[], period: number): number[] {
  const k = 2 / (period + 1);
  const ema: number[] = [candles[0].c];
  for (let i = 1; i < candles.length; i++) {
    ema.push(candles[i].c * k + ema[i - 1] * (1 - k));
  }
  return ema;
}

export function SMCMiniChart({ result }: SMCMiniChartProps) {
  const { price, change, levels, signal, orderBlocks, fvgs, trendFilter, structure, symbol } = result;
  const rsi = 50 + (change > 0 ? Math.min(change * 5, 25) : Math.max(change * 5, -25));

  const candles = useMemo(() => generateCandles(price, change, rsi, symbol, structure), [price, change, rsi, symbol, structure]);
  const ema9 = useMemo(() => computeEMA(candles, 9), [candles]);
  const ema21 = useMemo(() => computeEMA(candles, 21), [candles]);

  const W = 360, H = 150, PAD = 14, VOL_H = 20;
  const chartH = H - VOL_H - PAD;
  const allPrices = candles.flatMap(c => [c.h, c.l]).concat([levels.stopLoss, levels.takeProfit]);
  const minP = Math.min(...allPrices);
  const maxP = Math.max(...allPrices);
  const range = maxP - minP || 1;
  const maxVol = Math.max(...candles.map(c => c.vol));

  const yOf = (p: number) => PAD + (1 - (p - minP) / range) * (chartH - PAD);
  const candleW = (W - PAD * 2) / candles.length;

  const slY = yOf(levels.stopLoss);
  const tpY = yOf(levels.takeProfit);
  const entryY = yOf(levels.entry);

  const obZone = orderBlocks[0];
  const fvgZone = fvgs[0];

  const isBullish = signal.signal.includes('BUY');
  const isBearish = signal.signal.includes('SELL');
  const accentColor = isBullish ? '#10b981' : isBearish ? '#ef4444' : '#64748b';

  // EMA path
  const emaPath = (ema: number[]) => ema.map((v, i) => {
    const x = PAD + i * candleW + candleW / 2;
    return `${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${yOf(v).toFixed(1)}`;
  }).join(' ');

  return (
    <div className="bg-black/30 rounded-xl p-3 border border-white/5 relative overflow-hidden">
      <div className="flex items-center justify-between mb-1">
        <span className="text-[9px] font-bold text-slate-500 uppercase tracking-wider">SMC Price Action • {symbol}</span>
        <div className="flex items-center gap-2 text-[7px] text-slate-600">
          <span className="flex items-center gap-0.5"><span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />Buy</span>
          <span className="flex items-center gap-0.5"><span className="w-1.5 h-1.5 rounded-full bg-red-400" />Sell</span>
          <span className="flex items-center gap-0.5"><span className="w-3 h-[1px] bg-amber-400" />EMA9</span>
          <span className="flex items-center gap-0.5"><span className="w-3 h-[1px] bg-purple-400" />EMA21</span>
        </div>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" style={{ height: 150 }}>
        <defs>
          <linearGradient id={`grad-${symbol}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={isBullish ? '#10b981' : '#ef4444'} stopOpacity={0.12} />
            <stop offset="100%" stopColor="transparent" stopOpacity={0} />
          </linearGradient>
        </defs>

        {/* SL Zone */}
        <rect x={PAD} y={Math.min(slY, chartH)} width={W - PAD * 2} height={Math.max(0, Math.abs(chartH - slY))} rx={2}
          fill="rgba(239,68,68,0.05)" />
        {/* TP Zone */}
        <rect x={PAD} y={PAD} width={W - PAD * 2} height={Math.max(0, tpY - PAD)} rx={2}
          fill="rgba(16,185,129,0.05)" />

        {/* FVG zone */}
        {fvgZone && (
          <rect x={W * 0.55} y={yOf(fvgZone.top)} width={W * 0.3}
            height={Math.max(2, Math.abs(yOf(fvgZone.bottom) - yOf(fvgZone.top)))} rx={1}
            fill={fvgZone.type === 'BULLISH' ? 'rgba(16,185,129,0.1)' : 'rgba(239,68,68,0.1)'}
            stroke={fvgZone.type === 'BULLISH' ? 'rgba(16,185,129,0.25)' : 'rgba(239,68,68,0.25)'}
            strokeWidth={0.5} />
        )}

        {/* Order Block zone */}
        {obZone && (
          <rect x={PAD} y={yOf(obZone.top)} width={W - PAD * 2}
            height={Math.max(2, Math.abs(yOf(obZone.bottom) - yOf(obZone.top)))} rx={2}
            fill={obZone.type === 'BULLISH' ? 'rgba(6,182,212,0.07)' : 'rgba(168,85,247,0.07)'}
            stroke={obZone.type === 'BULLISH' ? 'rgba(6,182,212,0.2)' : 'rgba(168,85,247,0.2)'}
            strokeWidth={0.5} strokeDasharray="3,2" />
        )}

        {/* SL / TP / Entry lines */}
        <line x1={PAD} y1={slY} x2={W - PAD} y2={slY} stroke="#ef4444" strokeWidth={0.6} strokeDasharray="4,3" opacity={0.5} />
        <text x={W - PAD - 1} y={slY - 2} fill="#ef4444" fontSize={6} textAnchor="end" opacity={0.6}>SL</text>
        <line x1={PAD} y1={tpY} x2={W - PAD} y2={tpY} stroke="#10b981" strokeWidth={0.6} strokeDasharray="4,3" opacity={0.5} />
        <text x={W - PAD - 1} y={tpY - 2} fill="#10b981" fontSize={6} textAnchor="end" opacity={0.6}>TP</text>
        <line x1={PAD} y1={entryY} x2={W - PAD} y2={entryY} stroke="#06b6d4" strokeWidth={0.4} strokeDasharray="2,2" opacity={0.3} />

        {/* EMA lines */}
        <path d={emaPath(ema9)} fill="none" stroke="#f59e0b" strokeWidth={1} opacity={0.6} />
        <path d={emaPath(ema21)} fill="none" stroke="#a855f7" strokeWidth={1} opacity={0.5} />

        {/* Candles */}
        {candles.map((c, i) => {
          const x = PAD + i * candleW + candleW * 0.12;
          const w = candleW * 0.76;
          const bull = c.c >= c.o;
          const bodyTop = yOf(Math.max(c.o, c.c));
          const bodyBot = yOf(Math.min(c.o, c.c));
          const bodyH = Math.max(0.8, bodyBot - bodyTop);
          const wickX = x + w / 2;
          const color = bull ? '#10b981' : '#ef4444';
          const isLast = i === candles.length - 1;

          return (
            <g key={i}>
              <line x1={wickX} y1={yOf(c.h)} x2={wickX} y2={yOf(c.l)} stroke={color} strokeWidth={0.7} opacity={isLast ? 1 : 0.6} />
              <rect x={x} y={bodyTop} width={w} height={bodyH} rx={0.3}
                fill={color} opacity={isLast ? 1 : 0.7}
                stroke={isLast ? '#fff' : 'none'} strokeWidth={isLast ? 0.6 : 0} />

              {/* Volume bars */}
              <rect x={x} y={chartH + 4} width={w} height={(c.vol / maxVol) * VOL_H * 0.8} rx={0.5}
                fill={bull ? 'rgba(16,185,129,0.25)' : 'rgba(239,68,68,0.25)'} />

              {/* Buy signal */}
              {c.signal === 'buy' && (
                <g>
                  <polygon points={`${wickX},${yOf(c.l) + 10} ${wickX - 3.5},${yOf(c.l) + 16} ${wickX + 3.5},${yOf(c.l) + 16}`}
                    fill="#10b981" opacity={0.9} />
                  <text x={wickX} y={yOf(c.l) + 22} fill="#10b981" fontSize={5.5} textAnchor="middle" fontWeight="bold">BUY</text>
                </g>
              )}
              {/* Sell signal */}
              {c.signal === 'sell' && (
                <g>
                  <polygon points={`${wickX},${yOf(c.h) - 10} ${wickX - 3.5},${yOf(c.h) - 16} ${wickX + 3.5},${yOf(c.h) - 16}`}
                    fill="#ef4444" opacity={0.9} />
                  <text x={wickX} y={yOf(c.h) - 18} fill="#ef4444" fontSize={5.5} textAnchor="middle" fontWeight="bold">SELL</text>
                </g>
              )}
            </g>
          );
        })}

        {/* Current price badge */}
        <rect x={W - PAD - 42} y={entryY - 7} width={41} height={14} rx={4} fill={accentColor} opacity={0.95} />
        <text x={W - PAD - 21} y={entryY + 2.5} fill="white" fontSize={7} textAnchor="middle" fontWeight="bold">
          {price.toFixed(price > 1000 ? 0 : 2)}
        </text>

        {/* Trend label */}
        <text x={PAD + 2} y={PAD + 8} fill={trendFilter.label === 'Bullish' ? '#10b981' : trendFilter.label === 'Bearish' ? '#ef4444' : '#f59e0b'} fontSize={7} fontWeight="bold" opacity={0.7}>
          {trendFilter.label.toUpperCase()}
        </text>
      </svg>
    </div>
  );
}
