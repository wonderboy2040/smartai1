// ============================================================
// FUNDAMENTALS API CLIENT
// ------------------------------------------------------------
// Tiny wrapper around the /api/fundamentals/:symbol endpoint
// that returns the normalised FundamentalData shape used by
// qualityScorecard.ts.
// ============================================================

import type { FundamentalData } from './qualityScorecard';
// v13.5 (full-site recheck): build-time PROXY_BASE const removed —
// getProxyBase() resolves per call (runtime override honored) and the
// raw fetch() switched to apiFetch (session token rides along).
import { apiFetch, getProxyBase } from './api';

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
    const url = `${getProxyBase()}/api/fundamentals/${encodeURIComponent(symbol)}?market=${market}`;
    const res = await apiFetch(url, { signal: AbortSignal.timeout(10000) });
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
