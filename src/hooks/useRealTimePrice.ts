import { useEffect, useRef, useState } from 'react';
import { PriceData } from '../types';
import { subscribeToPrices } from '../utils/tvWebsocket';

interface PriceSnapshot {
  price: number;
  change: number;
  high: number;
  low: number;
  volume: number;
  time: number;
  rsi: number;
}

interface UseRealTimePriceReturn {
  snapshot: PriceSnapshot | null;
  history: PriceSnapshot[];
  isConnected: boolean;
}

/**
 * Hook that streams real-time price updates for a specific symbol
 * using the existing TradingView WebSocket infrastructure.
 * Maintains a rolling history (last 60 ticks) for chart rendering.
 */
export function useRealTimePrice(
  symbol: string,
  market: 'IN' | 'US',
  maxHistory = 60,
): UseRealTimePriceReturn {
  const [snapshot, setSnapshot] = useState<PriceSnapshot | null>(null);
  const [history, setHistory] = useState<PriceSnapshot[]>([]);
  const [isConnected, setIsConnected] = useState(false);
  const historyRef = useRef<PriceSnapshot[]>([]);
  const key = `${market}_${symbol}`;

  useEffect(() => {
    if (!symbol || !market) return;

    setIsConnected(false);

    const onPriceUpdate = (updateKey: string, data: Partial<PriceData>) => {
      if (updateKey !== key) return;

      const snap: PriceSnapshot = {
        price: data.price ?? 0,
        change: data.change ?? 0,
        high: data.high ?? data.price ?? 0,
        low: data.low ?? data.price ?? 0,
        volume: data.volume ?? 0,
        time: data.time ?? Date.now(),
        rsi: data.rsi ?? 50,
      };

      setSnapshot(snap);
      setIsConnected(true);

      historyRef.current.push(snap);
      if (historyRef.current.length > maxHistory) {
        historyRef.current = historyRef.current.slice(-maxHistory);
      }
      setHistory([...historyRef.current]);
    };

    const unsub = subscribeToPrices([symbol], onPriceUpdate);

    return () => {
      unsub();
      setIsConnected(false);
    };
  }, [symbol, market, key, maxHistory]);

  return { snapshot, history, isConnected };
}

/**
 * Convert rolling PriceSnapshot history into candlestick data for TradingView chart.
 * Aggregates snapshots into 5-minute candles.
 */
export function snapshotsToCandles(
  snapshots: PriceSnapshot[],
  intervalMs = 300000,
): { candles: any[]; volumes: any[] } {
  if (snapshots.length === 0) return { candles: [], volumes: [] };

  const buckets: Map<number, PriceSnapshot[]> = new Map();

  for (const snap of snapshots) {
    const bucketTime = Math.floor(snap.time / intervalMs) * intervalMs;
    const existing = buckets.get(bucketTime) || [];
    existing.push(snap);
    buckets.set(bucketTime, existing);
  }

  const candles: any[] = [];
  const volumes: any[] = [];

  const sortedTimes = Array.from(buckets.keys()).sort((a, b) => a - b);

  for (const time of sortedTimes) {
    const snaps = buckets.get(time)!;
    const open = snaps[0].price;
    const close = snaps[snaps.length - 1].price;
    const high = Math.max(...snaps.map(s => s.price));
    const low = Math.min(...snaps.map(s => s.price));
    const volume = snaps.reduce((sum, s) => sum + s.volume, 0);

    const timeSec = Math.floor(time / 1000) as any;
    candles.push({ time: timeSec, open, high, low, close });
    volumes.push({
      time: timeSec,
      value: volume,
      color: close >= open ? 'rgba(34,197,94,0.4)' : 'rgba(239,68,68,0.4)',
    });
  }

  return { candles, volumes };
}
