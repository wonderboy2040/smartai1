// ============================================================
// FUNDAMENTALS API CLIENT
// ------------------------------------------------------------
// Tiny wrapper around the /api/fundamentals/:symbol endpoint
// that returns the normalised FundamentalData shape used by
// qualityScorecard.ts.
// ============================================================

import type { FundamentalData } from './qualityScorecard';

const PROXY_BASE = (import.meta.env.VITE_API_PROXY as string) || '';

const _cache = new Map<string, { data: FundamentalData | null; ts: number }>();
const CACHE_TTL = 6 * 60 * 60 * 1000;  // 6h client-side (server is 24h)

export async function fetchFundamentals(
  symbol: string,
  market: 'IN' | 'US' = 'IN'
): Promise<FundamentalData | null> {
  const key = `${market}_${symbol}`.toUpperCase();
  const cached = _cache.get(key);
  if (cached && Date.now() - cached.ts < CACHE_TTL) {
    return cached.data;
  }

  try {
    const url = `${PROXY_BASE}/api/fundamentals/${encodeURIComponent(symbol)}?market=${market}&t=${Date.now()}`;
    const res = await fetch(url, { signal: AbortSignal.timeout(10000) });
    if (!res.ok) {
      _cache.set(key, { data: null, ts: Date.now() });
      return null;
    }
    const data = (await res.json()) as FundamentalData;
    _cache.set(key, { data, ts: Date.now() });
    return data;
  } catch (e) {
    console.warn('Fundamentals fetch failed:', e);
    return null;
  }
}

export function clearFundamentalsCache() {
  _cache.clear();
}
