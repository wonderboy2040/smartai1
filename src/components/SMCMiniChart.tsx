import { useMemo } from 'react';
import { SMCAnalysisResult } from '../utils/smcEngine';

interface SMCMiniChartProps {
  result: SMCAnalysisResult;
}

/** Generate simulated candle data from current price + indicators */
function generateCandles(price: number, change: number, rsi: number) {
  const candles: { o: number; h: number; l: number; c: number; signal?: 'buy' | 'sell' }[] = [];
  const atr = price * 0.012;
  let p = price * (1 - change / 100 * 3); // start ~3x change ago

  for (let i = 0; i < 30; i++) {
    const drift = (Math.random() - 0.48) * atr * 0.8;
    const wick = Math.random() * atr * 0.5;
    const o = p;
    const c = o + drift;
    const h = Math.max(o, c) + wick;
    const l = Math.min(o, c) - wick;
    candles.push({ o, h, l, c });
    p = c;
  }

  // Last candle = actual price
  const last = candles[candles.length - 1];
  const scale = price / last.c;
  candles.forEach(c => { c.o *= scale; c.h *= scale; c.l *= scale; c.c *= scale; });

  // Mark signals based on RSI extremes
  if (rsi < 35) candles[candles.length - 1].signal = 'buy';
  if (rsi > 65) candles[candles.length - 1].signal = 'sell';
  if (rsi < 30) { candles[candles.length - 3] && (candles[candles.length - 3].signal = 'buy'); }
  if (rsi > 70) { candles[candles.length - 3] && (candles[candles.length - 3].signal = 'sell'); }

  // Add historical signals at swing points
  let minIdx = 0, maxIdx = 0;
  candles.forEach((c, i) => {
    if (c.l < candles[minIdx].l) minIdx = i;
    if (c.h > candles[maxIdx].h) maxIdx = i;
  });
  if (minIdx > 2 && minIdx < 27) candles[minIdx].signal = 'buy';
  if (maxIdx > 2 && maxIdx < 27) candles[maxIdx].signal = 'sell';

  return candles;
}

export function SMCMiniChart({ result }: SMCMiniChartProps) {
  const { price, change, levels, signal, orderBlocks, trendFilter } = result;
  const rsi = 50 + (change > 0 ? Math.min(change * 5, 25) : Math.max(change * 5, -25));

  const candles = useMemo(() => generateCandles(price, change, rsi), [price, change, rsi]);

  const W = 320, H = 120, PAD = 12;
  const allPrices = candles.flatMap(c => [c.h, c.l]).concat([levels.stopLoss, levels.takeProfit]);
  const minP = Math.min(...allPrices);
  const maxP = Math.max(...allPrices);
  const range = maxP - minP || 1;

  const yOf = (p: number) => PAD + (1 - (p - minP) / range) * (H - PAD * 2);
  const candleW = (W - PAD * 2) / candles.length;

  const slY = yOf(levels.stopLoss);
  const tpY = yOf(levels.takeProfit);
  const entryY = yOf(levels.entry);
  const kalmanY = yOf(trendFilter.kalmanLine);

  // OB zone
  const obZone = orderBlocks[0];

  const isBullish = signal.signal.includes('BUY');
  const isBearish = signal.signal.includes('SELL');
  const accentColor = isBullish ? '#10b981' : isBearish ? '#ef4444' : '#64748b';

  return (
    <div className="bg-black/30 rounded-xl p-3 border border-white/5 relative overflow-hidden">
      <div className="flex items-center justify-between mb-1.5">
        <span className="text-[9px] font-bold text-slate-500 uppercase tracking-wider">Price Action & Signals</span>
        <div className="flex items-center gap-2 text-[8px]">
          <span className="flex items-center gap-0.5"><span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />Buy</span>
          <span className="flex items-center gap-0.5"><span className="w-1.5 h-1.5 rounded-full bg-red-400" />Sell</span>
          <span className="flex items-center gap-0.5"><span className="w-4 h-[1px] bg-cyan-500" />Kalman</span>
        </div>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" style={{ height: 120 }}>
        {/* SL Zone */}
        <rect x={PAD} y={Math.min(slY, H - PAD)} width={W - PAD * 2} height={Math.abs(H - PAD - slY)} rx={2}
          fill="rgba(239,68,68,0.06)" />
        {/* TP Zone */}
        <rect x={PAD} y={PAD} width={W - PAD * 2} height={Math.max(0, tpY - PAD)} rx={2}
          fill="rgba(16,185,129,0.06)" />

        {/* Order Block zone */}
        {obZone && (
          <rect x={PAD} y={yOf(obZone.top)} width={W - PAD * 2}
            height={Math.abs(yOf(obZone.bottom) - yOf(obZone.top))} rx={2}
            fill={obZone.type === 'BULLISH' ? 'rgba(6,182,212,0.08)' : 'rgba(168,85,247,0.08)'}
            stroke={obZone.type === 'BULLISH' ? 'rgba(6,182,212,0.2)' : 'rgba(168,85,247,0.2)'}
            strokeWidth={0.5} strokeDasharray="3,2" />
        )}

        {/* SL line */}
        <line x1={PAD} y1={slY} x2={W - PAD} y2={slY} stroke="#ef4444" strokeWidth={0.7} strokeDasharray="4,3" opacity={0.6} />
        <text x={W - PAD - 1} y={slY - 2} fill="#ef4444" fontSize={7} textAnchor="end" opacity={0.7}>SL</text>

        {/* TP line */}
        <line x1={PAD} y1={tpY} x2={W - PAD} y2={tpY} stroke="#10b981" strokeWidth={0.7} strokeDasharray="4,3" opacity={0.6} />
        <text x={W - PAD - 1} y={tpY - 2} fill="#10b981" fontSize={7} textAnchor="end" opacity={0.7}>TP</text>

        {/* Entry line */}
        <line x1={PAD} y1={entryY} x2={W - PAD} y2={entryY} stroke="#06b6d4" strokeWidth={0.5} strokeDasharray="2,2" opacity={0.4} />

        {/* Kalman trend line */}
        <line x1={PAD} y1={kalmanY + 3} x2={W - PAD} y2={kalmanY - 3} stroke="#06b6d4" strokeWidth={1} opacity={0.5} />

        {/* Candles */}
        {candles.map((c, i) => {
          const x = PAD + i * candleW + candleW * 0.15;
          const w = candleW * 0.7;
          const bull = c.c >= c.o;
          const bodyTop = yOf(Math.max(c.o, c.c));
          const bodyBot = yOf(Math.min(c.o, c.c));
          const bodyH = Math.max(1, bodyBot - bodyTop);
          const wickX = x + w / 2;
          const color = bull ? '#10b981' : '#ef4444';

          return (
            <g key={i}>
              {/* Wick */}
              <line x1={wickX} y1={yOf(c.h)} x2={wickX} y2={yOf(c.l)} stroke={color} strokeWidth={0.8} opacity={0.7} />
              {/* Body */}
              <rect x={x} y={bodyTop} width={w} height={bodyH} rx={0.5}
                fill={bull ? color : color} opacity={i === candles.length - 1 ? 1 : 0.7}
                stroke={i === candles.length - 1 ? '#fff' : 'none'} strokeWidth={i === candles.length - 1 ? 0.5 : 0} />

              {/* Buy signal arrow */}
              {c.signal === 'buy' && (
                <g>
                  <polygon points={`${wickX},${yOf(c.l) + 14} ${wickX - 4},${yOf(c.l) + 20} ${wickX + 4},${yOf(c.l) + 20}`}
                    fill="#10b981" />
                  <text x={wickX} y={yOf(c.l) + 27} fill="#10b981" fontSize={6} textAnchor="middle" fontWeight="bold">B</text>
                </g>
              )}
              {/* Sell signal arrow */}
              {c.signal === 'sell' && (
                <g>
                  <polygon points={`${wickX},${yOf(c.h) - 14} ${wickX - 4},${yOf(c.h) - 20} ${wickX + 4},${yOf(c.h) - 20}`}
                    fill="#ef4444" />
                  <text x={wickX} y={yOf(c.h) - 22} fill="#ef4444" fontSize={6} textAnchor="middle" fontWeight="bold">S</text>
                </g>
              )}
            </g>
          );
        })}

        {/* Current price label */}
        <rect x={W - PAD - 38} y={entryY - 7} width={37} height={14} rx={3} fill={accentColor} opacity={0.9} />
        <text x={W - PAD - 20} y={entryY + 3} fill="white" fontSize={7} textAnchor="middle" fontWeight="bold">
          {price.toFixed(price > 1000 ? 0 : 2)}
        </text>
      </svg>
    </div>
  );
}
