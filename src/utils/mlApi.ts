const ML_SERVICE_URL = import.meta.env.VITE_ML_SERVICE_URL || '/ml';

export interface MLPrediction {
  symbol: string;
  market: string;
  price: number;
  change: number;
  rsi: number;
  volume: number;
  signal: string;
  confidence: number;
  probabilities?: Record<string, number>;
  top_features?: { feature: string; importance: number }[];
  price_targets?: {
    P10?: { expected_return: number; target_price: number };
    P50?: { expected_return: number; target_price: number };
    P90?: { expected_return: number; target_price: number };
  };
  price_points?: {
    entry: number;
    stop_loss: number;
    tp1: number;
    tp2: number;
    tp3: number;
    risk_reward: number;
    atr: number;
    dip_ladder: { price: number; pct_budget: number; label: string }[];
  };
  timestamp: number;
}

export interface MLBacktestResult {
  total_periods: number;
  total_return_pct: number;
  avg_hit_rate: number;
  avg_return_per_period: number;
  avg_f1_weighted: number;
  period_win_rate: number;
  sharpe_ratio: number;
  profit_factor: number;
  equity_curve: { equity: number; return: number; hit_rate: number }[];
}

async function mlFetch<T>(path: string, options?: RequestInit): Promise<T> {
  try {
    const res = await fetch(`${ML_SERVICE_URL}${path}`, {
      ...options,
      signal: AbortSignal.timeout(30000),
      headers: { 'Content-Type': 'application/json', ...options?.headers },
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ detail: res.statusText }));
      throw new Error(err.detail || `ML API error: ${res.status}`);
    }
    return res.json();
  } catch (e: any) {
    if (e.name === 'AbortError' || e.name === 'TimeoutError') {
      throw new Error('ML service timeout');
    }
    throw e;
  }
}

export async function fetchMLPrediction(symbol: string, market: string): Promise<MLPrediction> {
  return mlFetch('/predict', {
    method: 'POST',
    body: JSON.stringify({ symbol, market }),
  });
}

export async function fetchAllMLSignals(market?: string): Promise<{ signals: MLPrediction[]; count: number }> {
  const params = market ? `?market=${market}` : '';
  return mlFetch(`/signals${params}`);
}

export async function fetchMLBacktest(symbol?: string): Promise<MLBacktestResult> {
  const params = symbol ? `?symbol=${symbol}` : '';
  return mlFetch(`/backtest${params}`);
}

export async function fetchMLPricePoints(symbol: string): Promise<any> {
  return mlFetch(`/pricepoints/${encodeURIComponent(symbol)}`);
}

export async function triggerMLTraining(): Promise<any> {
  return mlFetch('/train', { method: 'POST', body: '{}' });
}

export async function refreshMLData(): Promise<any> {
  return mlFetch('/refresh', { method: 'POST', body: '{}' });
}

export async function fetchMLRegime(): Promise<{
  regime: string;
  probability: number;
  sip_multiplier: number;
  state_sequence: string[];
  timestamp: string;
}> {
  return mlFetch('/regime');
}
