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
  portfolio: Position[],
  currentSymbol?: string
) {
  const lastPrefetchRef = useRef<Record<string, number>>({});

  const shouldPrefetch = (key: string): boolean => {
    const last = lastPrefetchRef.current[key] || 0;
    if (Date.now() - last > PREFETCH_COOLDOWN) {
      lastPrefetchRef.current[key] = Date.now();
      return true;
    }
    return false;
  };

  useEffect(() => {
    // 1. If user is on Dashboard -> prefetch top holdings news & macro data
    if (activeTab === 'dashboard') {
      if (shouldPrefetch('macro_intel')) {
        queuedFetch(
          () =>
            cachedFetch(
              generateCacheKey('/api/macro-regime'),
              () => apiFetch('/api/macro-regime').then(r => r.json()).catch(() => null),
              5 * 60 * 1000
            ),
          Priority.LOW,
          'prefetch_macro'
        ).catch(() => {});
      }

      // Prefetch news for the largest holding
      if (portfolio.length > 0) {
        const topAsset = portfolio[0];
        const cacheKey = `prefetch_news_${topAsset.symbol}`;
        if (shouldPrefetch(cacheKey)) {
          queuedFetch(
            () =>
              cachedFetch(
                generateCacheKey('/api/tavily', { symbol: topAsset.symbol }),
                () =>
                  apiFetch('/api/tavily', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                      messages: [{ role: 'user', content: `${topAsset.symbol} stock latest news` }],
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

    // 3. If user is inspecting a specific symbol -> prefetch fundamentals
    if (currentSymbol && shouldPrefetch(`symbol_${currentSymbol}`)) {
      // FIX (audit M-9): was /api/fundamentals?symbol=X — the server route is
      // /api/fundamentals/:symbol (path segment, not query param).
      queuedFetch(
        () =>
          cachedFetch(
            generateCacheKey('/api/fundamentals', { symbol: currentSymbol }),
            () => apiFetch(`/api/fundamentals/${encodeURIComponent(currentSymbol)}`).then(r => r.json()).catch(() => null),
            15 * 60 * 1000
          ),
        Priority.LOW,
        `prefetch_${currentSymbol}`
      ).catch(() => {});
    }
  }, [activeTab, portfolio, currentSymbol]);
}
