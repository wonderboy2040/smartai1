import React, { useEffect, useRef, useState } from 'react';
import {
  createChart, IChartApi, ISeriesApi,
  CandlestickSeries, HistogramSeries, CandlestickData, UTCTimestamp,
} from 'lightweight-charts';

interface Candle {
  time: number; // unix seconds
  open: number; high: number; low: number; close: number; volume: number;
}

interface LiveCandleChartProps {
  symbol: string;            // raw symbol, e.g. JUNIORBEES
  market: 'IN' | 'US' | string;
  interval: string;          // 'D' | 'W' | 'M'
  livePrice?: number;        // latest streamed price (realtime last-candle update)
  liveChange?: number;
  theme?: 'dark' | 'light';
  height?: number;
}

const PROXY = (import.meta.env.VITE_API_PROXY as string) || '';

/**
 * Data-driven candlestick chart for symbols the TradingView embed widget can't
 * display (notably NSE/BSE ETFs that error with "This symbol is only available
 * on TradingView"). Pulls real OHLC candles from our /api/chart proxy and
 * live-updates the last candle from the realtime price stream.
 */
export const LiveCandleChart = React.memo(function LiveCandleChart({
  symbol, market, interval, livePrice, theme = 'dark', height = 500,
}: LiveCandleChartProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const candleSeriesRef = useRef<ISeriesApi<'Candlestick'> | null>(null);
  const volSeriesRef = useRef<ISeriesApi<'Histogram'> | null>(null);
  const lastCandleRef = useRef<Candle | null>(null);

  const [status, setStatus] = useState<'loading' | 'ok' | 'error'>('loading');
  // FIX M23: when theme/height changes, the chart-build effect tears down and
  // rebuilds the chart, but the data-load effect (deps [symbol,market,interval])
  // does NOT re-run → the new series stays empty until the user changes symbol.
  // Track a `chartVersion` that increments on every rebuild so the data-load
  // effect re-fires too.
  const [chartVersion, setChartVersion] = useState(0);

  // --- Build chart once + bump version on rebuild ---
  useEffect(() => {
    if (!containerRef.current) return;
    const dark = theme !== 'light';
    const chart = createChart(containerRef.current, {
      width: containerRef.current.clientWidth,
      height,
      layout: {
        background: { color: 'transparent' },
        textColor: dark ? '#9CA3AF' : '#374151',
        fontSize: 11,
      },
      grid: {
        vertLines: { color: dark ? 'rgba(75,85,99,0.18)' : 'rgba(0,0,0,0.06)' },
        horzLines: { color: dark ? 'rgba(75,85,99,0.18)' : 'rgba(0,0,0,0.06)' },
      },
      crosshair: { mode: 0 },
      timeScale: { timeVisible: false, secondsVisible: false, borderColor: 'rgba(75,85,99,0.3)' },
      rightPriceScale: { borderColor: 'rgba(75,85,99,0.3)' },
    });
    const candleSeries = chart.addSeries(CandlestickSeries, {
      upColor: '#22C55E', downColor: '#EF4444',
      borderUpColor: '#22C55E', borderDownColor: '#EF4444',
      wickUpColor: '#22C55E', wickDownColor: '#EF4444',
    });
    const volSeries = chart.addSeries(HistogramSeries, {
      priceFormat: { type: 'volume' as const }, priceScaleId: '',
    });
    volSeries.priceScale().applyOptions({ scaleMargins: { top: 0.82, bottom: 0 } });

    chartRef.current = chart;
    candleSeriesRef.current = candleSeries;
    volSeriesRef.current = volSeries;
    // Signal to the data-load effect that a fresh chart is ready.
    setChartVersion(v => v + 1);

    const ro = new ResizeObserver(entries => {
      for (const e of entries) chart.applyOptions({ width: e.contentRect.width });
    });
    ro.observe(containerRef.current);

    return () => {
      ro.disconnect();
      chart.remove();
      chartRef.current = null;
      candleSeriesRef.current = null;
      volSeriesRef.current = null;
    };
  }, [height, theme]);

  // --- Load candles on symbol/interval change OR chart rebuild ---
  useEffect(() => {
    let cancelled = false;
    // Skip the very first invocation (chartVersion=0) — chart isn't built yet.
    if (chartVersion === 0) return;
    setStatus('loading');
    const load = async () => {
      try {
        const url = `${PROXY}/api/chart?symbol=${encodeURIComponent(symbol)}&market=${encodeURIComponent(market)}&interval=${encodeURIComponent(interval)}`;
        const res = await fetch(url, { signal: AbortSignal.timeout(10000) });
        if (!res.ok) throw new Error(`status ${res.status}`);
        const json = await res.json();
        const candles: Candle[] = json?.candles || [];
        if (cancelled) return;
        if (!candles.length) { setStatus('error'); return; }

        const cData: CandlestickData[] = candles.map(c => ({
          time: c.time as UTCTimestamp,
          open: c.open, high: c.high, low: c.low, close: c.close,
        }));
        const vData = candles.map(c => ({
          time: c.time as UTCTimestamp,
          value: c.volume,
          color: c.close >= c.open ? 'rgba(34,197,94,0.4)' : 'rgba(239,68,68,0.4)',
        }));
        candleSeriesRef.current?.setData(cData);
        volSeriesRef.current?.setData(vData);
        chartRef.current?.timeScale().fitContent();
        lastCandleRef.current = candles[candles.length - 1];
        setStatus('ok');
      } catch (e) {
        if (!cancelled) setStatus('error');
      }
    };
    load();
    return () => { cancelled = true; };
  }, [symbol, market, interval, chartVersion]);  // FIX M23: chartVersion added

  // --- Realtime: update last candle from the live price stream ---
  useEffect(() => {
    if (status !== 'ok' || !livePrice || livePrice <= 0) return;
    const last = lastCandleRef.current;
    if (!last || !candleSeriesRef.current) return;
    const updated: Candle = {
      ...last,
      close: livePrice,
      high: Math.max(last.high, livePrice),
      low: Math.min(last.low, livePrice),
    };
    lastCandleRef.current = updated;
    candleSeriesRef.current.update({
      time: updated.time as UTCTimestamp,
      open: updated.open, high: updated.high, low: updated.low, close: updated.close,
    });
  }, [livePrice, status]);

  return (
    <div className="relative w-full h-full">
      <div ref={containerRef} className="w-full h-full" />
      {status === 'loading' && (
        <div className="absolute inset-0 flex items-center justify-center text-slate-500 text-sm">
          <span className="animate-pulse">Loading live NSE chart…</span>
        </div>
      )}
      {status === 'error' && (
        <div className="absolute inset-0 flex flex-col items-center justify-center text-slate-500 text-sm gap-1">
          <span>📉 Chart data unavailable for {symbol}</span>
          <span className="text-[11px] text-slate-600">Live price still streaming in the dashboard.</span>
        </div>
      )}
    </div>
  );
});
