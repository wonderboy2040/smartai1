// FIX M14: previously hardcoded `/api/ml` and ignored VITE_API_PROXY, so any
// cross-origin deployment (frontend on a different host than the Node proxy)
// got 404s for ML calls. Use the same PROXY_BASE convention as the rest of api.ts.
const ML_SERVICE_URL = `${(import.meta.env.VITE_API_PROXY as string) || ''}/api/ml`;

export interface MLPrediction {
  symbol: string;
  market: string;
  price: number;
  change: number;
  rsi: number;
  volume: number;
  signal: string;
  confidence: number;
  direction?: string;
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
      signal: AbortSignal.timeout(15000),
      headers: { 'Content-Type': 'application/json', ...options?.headers },
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ detail: res.statusText }));
      throw new Error(err.detail || err.error || `ML API error: ${res.status}`);
    }
    return res.json();
  } catch (e: any) {
    if (e.name === 'AbortError' || e.name === 'TimeoutError') {
      throw new Error('ML service timeout');
    }
    throw e;
  }
}

export async function fetchMLPrediction(symbol: string, market: string, price?: number, change?: number): Promise<MLPrediction> {
  return mlFetch('/predict', {
    method: 'POST',
    body: JSON.stringify({ symbol, market, price, change }),
  });
}

export async function fetchAllMLSignals(portfolio?: any[], livePrices?: Record<string, any>): Promise<{ signals: MLPrediction[]; count: number }> {
  return mlFetch('/signals', {
    method: 'POST',
    body: JSON.stringify({ portfolio: portfolio || [], livePrices: livePrices || {} }),
  });
}

export async function fetchMLBacktest(symbol?: string, candles?: any[]): Promise<MLBacktestResult> {
  return mlFetch('/backtest', {
    method: 'POST',
    body: JSON.stringify({ symbol, candles: candles || [] }),
  });
}

export async function fetchMLPricePoints(symbol: string, price?: number): Promise<any> {
  const params = price ? `?price=${price}` : '';
  return mlFetch(`/pricepoints/${encodeURIComponent(symbol)}${params}`);
}

export async function triggerMLTraining(): Promise<any> {
  return mlFetch('/train', { method: 'POST', body: '{}' });
}

export async function refreshMLData(): Promise<any> {
  return mlFetch('/refresh', { method: 'POST', body: '{}' });
}

export async function fetchMLRegime(nifty?: any, bankNifty?: any, vix?: any): Promise<{
  regime: string;
  probability: number;
  sip_multiplier: number;
  state_sequence: string[];
  timestamp: string;
}> {
  return mlFetch('/regime', {
    method: 'POST',
    body: JSON.stringify({ nifty, bankNifty, vix }),
  });
}
