// ============================================================
// Predictive Prefetching Hook — Wealth AI v18
// ------------------------------------------------------------
// Anticipates user actions based on navigation patterns, active
// tabs, and selected holdings. Pre-warms the cache using low-priority
// background requests so subsequent tab clicks render instantly.
// ============================================================

import { useEffect, useRef } from 'react';
import { TabType, Position } from '../types';
import { cachedFetch, generateCacheKey } from '../utils/cache';
import { queuedFetch, Priority } from '../utils/requestQueue';
import { apiFetch } from '../utils/api';

const PREFETCH_COOLDOWN = 3 * 60 * 1000; // 3 minutes

export function usePrefetch(
  activeTab: TabType,
  portfolio: Position[]
) {
  // v13.5 (full-site recheck): the third `currentSymbol` param was removed —
  // its fundamentals-prefetch block was unreachable (the only call site,
  // App.tsx, never passed it, and no app-level selected-symbol state exists
  // to pass). Dead path deleted instead of fake-wired.
  const lastPrefetchRef = useRef<Record<string, number>>({});
  const portfolioSymbolsKey = portfolio.map(p => p.symbol).join(',');
  const topAssetSymbol = portfolio[0]?.symbol;

  const shouldPrefetch = (key: string): boolean => {
    const last = lastPrefetchRef.current[key] || 0;
    if (Date.now() - last > PREFETCH_COOLDOWN) {
      lastPrefetchRef.current[key] = Date.now();
      return true;
    }
    return false;
  };

  useEffect(() => {
    // 1. If user is on Dashboard -> prefetch top holding news
    // (v5.0: the old `macro_intel` prefetch was removed — it called a
    // nonexistent /api/macro-regime (404 every 3 min) and NOBODY ever read
    // the cache entry; the client computes macro regime locally from
    // livePrices via detectMacroRegime().)
    if (activeTab === 'dashboard') {
      // Prefetch news for the largest holding
      if (topAssetSymbol) {
        const cacheKey = `prefetch_news_${topAssetSymbol}`;
        if (shouldPrefetch(cacheKey)) {
          queuedFetch(
            () =>
              cachedFetch(
                generateCacheKey('/api/tavily', { symbol: topAssetSymbol }),
                () =>
                  apiFetch('/api/tavily', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                      messages: [{ role: 'user', content: `${topAssetSymbol} stock latest news` }],
                      model: ''
                    })
                  }).then(r => r.json()).catch(() => null),
                10 * 60 * 1000
              ),
            Priority.LOW,
            cacheKey
          ).catch(() => {});
        }
      }
    }

    // 2. If user is on Portfolio -> prefetch screener & ML signal models
    if (activeTab === 'portfolio') {
      if (shouldPrefetch('ml_signals')) {
        // FIX (audit M-9): was GET /api/ml/signals — the server only exposes
        // POST (it takes the portfolio/livePrices payload). The prefetch
        // silently 404'd every time.
        queuedFetch(
          () =>
            cachedFetch(
              generateCacheKey('/api/ml/signals'),
              () => apiFetch('/api/ml/signals', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ portfolio: [], livePrices: {} }),
              }).then(r => r.json()).catch(() => null),
              5 * 60 * 1000
            ),
          Priority.LOW,
          'prefetch_ml'
        ).catch(() => {});
      }
    }
  }, [activeTab, portfolioSymbolsKey, topAssetSymbol]);
}
