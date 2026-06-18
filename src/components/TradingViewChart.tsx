import React, { useEffect, useRef } from 'react';
import { createChart, IChartApi, ISeriesApi, CandlestickSeries, HistogramSeries, CandlestickData, HistogramData } from 'lightweight-charts';

interface TradingViewChartProps {
  data: CandlestickData[];
  volume?: HistogramData[];
  symbol: string;
  height?: number;
  gridLines?: boolean;
  priceLines?: { price: number; label: string; color: string }[];
}

export const TradingViewChart = React.memo(function TradingViewChart({
  data,
  volume,
  symbol,
  height = 300,
  gridLines = true,
  priceLines = [],
}: TradingViewChartProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const candleSeriesRef = useRef<ISeriesApi<'Candlestick'> | null>(null);
  const volumeSeriesRef = useRef<ISeriesApi<'Histogram'> | null>(null);

  useEffect(() => {
    if (!containerRef.current) return;

    const chart = createChart(containerRef.current, {
      width: containerRef.current.clientWidth,
      height,
      layout: {
        background: { color: 'transparent' },
        textColor: '#9CA3AF',
        fontSize: 11,
      },
      grid: {
        vertLines: { visible: gridLines, color: 'rgba(75,85,99,0.2)' },
        horzLines: { visible: gridLines, color: 'rgba(75,85,99,0.2)' },
      },
      crosshair: {
        mode: 0,
        vertLine: { color: 'rgba(99,102,241,0.4)', width: 1, style: 2, labelBackgroundColor: '#6366F1' },
        horzLine: { color: 'rgba(99,102,241,0.4)', width: 1, style: 2, labelBackgroundColor: '#6366F1' },
      },
      timeScale: {
        timeVisible: true,
        secondsVisible: false,
        borderColor: 'rgba(75,85,99,0.3)',
      },
      rightPriceScale: {
        borderColor: 'rgba(75,85,99,0.3)',
      },
    });

    const candleSeries = chart.addSeries(CandlestickSeries, {
      upColor: '#22C55E',
      downColor: '#EF4444',
      borderDownColor: '#EF4444',
      borderUpColor: '#22C55E',
      wickDownColor: '#EF4444',
      wickUpColor: '#22C55E',
    });
    candleSeriesRef.current = candleSeries;

    if (data && data.length > 0) {
      candleSeries.setData(data);
      chart.timeScale().fitContent();
    }

    if (volume && volume.length > 0) {
      const volumeSeries = chart.addSeries(HistogramSeries, {
        priceFormat: { type: 'volume' as const },
        priceScaleId: '',
      });
      volumeSeries.priceScale().applyOptions({
        scaleMargins: { top: 0.8, bottom: 0 },
      });
      volumeSeries.setData(volume);
      volumeSeriesRef.current = volumeSeries;
    }

    priceLines.forEach(({ price, label, color }) => {
      candleSeries.createPriceLine({
        price,
        title: label,
        color,
        lineWidth: 1,
        lineStyle: 2,
        axisLabelVisible: true,
      });
    });

    const resizeObserver = new ResizeObserver((entries) => {
      for (const entry of entries) {
        chart.applyOptions({ width: entry.contentRect.width });
      }
    });
    resizeObserver.observe(containerRef.current);

    chartRef.current = chart;

    return () => {
      resizeObserver.disconnect();
      chart.remove();
      chartRef.current = null;
      candleSeriesRef.current = null;
      volumeSeriesRef.current = null;
    };
  }, [data?.length]);

  useEffect(() => {
    if (candleSeriesRef.current && data && data.length > 0) {
      const last = data[data.length - 1];
      candleSeriesRef.current.update(last);
    }
  }, [data]);

  useEffect(() => {
    if (volumeSeriesRef.current && volume && volume.length > 0) {
      volumeSeriesRef.current.update(volume[volume.length - 1]);
    }
  }, [volume]);

  const lastClose = data && data.length > 0 ? data[data.length - 1].close : 0;
  const prevClose = data && data.length > 1 ? data[data.length - 2].close : lastClose;
  const change = prevClose > 0 ? ((lastClose - prevClose) / prevClose) * 100 : 0;

  return (
    <div className="relative">
      <div className="flex items-center gap-2 mb-1 px-1">
        <span className="text-xs font-semibold text-white/80">{symbol}</span>
        <span className={`text-xs font-bold ${change >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
          {lastClose.toFixed(2)} {change >= 0 ? '+' : ''}{change.toFixed(2)}%
        </span>
      </div>
      <div ref={containerRef} className="rounded-lg overflow-hidden" />
    </div>
  );
});
