// Response cache with TTL and size limits

interface CacheEntry<T> {
  data: T;
  timestamp: number;
  expiresAt: number;
}

class ResponseCache {
  private cache = new Map<string, CacheEntry<any>>();
  private maxSize = 100; // Max 100 entries
  private defaultTTL = 5 * 60 * 1000; // 5 minutes

  set<T>(key: string, data: T, ttl?: number): void {
    // Enforce size limit (LRU eviction)
    if (this.cache.size >= this.maxSize) {
      const firstKey = this.cache.keys().next().value;
      if (firstKey !== undefined) {
        this.cache.delete(firstKey);
      }
    }

    const timestamp = Date.now();
    const expiresAt = timestamp + (ttl || this.defaultTTL);

    this.cache.set(key, { data, timestamp, expiresAt });
  }

  get<T>(key: string): T | null {
    const entry = this.cache.get(key);

    if (!entry) return null;

    // Check if expired
    if (Date.now() > entry.expiresAt) {
      this.cache.delete(key);
      return null;
    }

    return entry.data as T;
  }

  has(key: string): boolean {
    const entry = this.cache.get(key);
    if (!entry) return false;

    // Check expiration
    if (Date.now() > entry.expiresAt) {
      this.cache.delete(key);
      return false;
    }

    return true;
  }

  delete(key: string): void {
    this.cache.delete(key);
  }

  clear(): void {
    this.cache.clear();
  }

  // Invalidate all entries matching a pattern
  invalidatePattern(pattern: RegExp): number {
    let count = 0;
    for (const key of this.cache.keys()) {
      if (pattern.test(key)) {
        this.cache.delete(key);
        count++;
      }
    }
    return count;
  }

  // Get cache stats
  getStats() {
    const now = Date.now();
    const entries = Array.from(this.cache.values());
    const expired = entries.filter(e => now > e.expiresAt).length;
    const valid = entries.length - expired;

    return {
      total: this.cache.size,
      valid,
      expired,
      maxSize: this.maxSize
    };
  }

  // Cleanup expired entries
  cleanup(): number {
    const now = Date.now();
    let count = 0;

    for (const [key, entry] of this.cache.entries()) {
      if (now > entry.expiresAt) {
        this.cache.delete(key);
        count++;
      }
    }

    return count;
  }
}

// Global cache instance
export const responseCache = new ResponseCache();

// Auto-cleanup every 60 seconds — v10.13 (deep-recheck L1): LAZY-started on
// the first set() instead of firing forever from module import (the old
// module-scope setInterval ran in every test/SSR context that merely
// imported the module, and never stopped).
let _cleanupTimer: ReturnType<typeof setInterval> | null = null;
function _ensureCleanupTimer() {
  if (_cleanupTimer || typeof setInterval === 'undefined') return;
  _cleanupTimer = setInterval(() => {
    const cleaned = responseCache.cleanup();
    if (cleaned > 0) {
      console.log(`[Cache] Cleaned ${cleaned} expired entries`);
    }
  }, 60000);
}
const _origSet = responseCache.set.bind(responseCache);
responseCache.set = <T,>(key: string, data: T, ttl?: number) => {
  _ensureCleanupTimer();
  return _origSet(key, data, ttl);
};

// Helper to generate cache keys
export function generateCacheKey(
  endpoint: string,
  params?: Record<string, any>
): string {
  if (!params) return endpoint;

  const sortedParams = Object.keys(params)
    .sort()
    .map(k => `${k}=${params[k]}`)
    .join('&');

  return `${endpoint}?${sortedParams}`;
}

// Cached fetch wrapper
export async function cachedFetch<T>(
  key: string,
  fetcher: () => Promise<T>,
  ttl?: number
): Promise<T> {
  // Check cache first
  const cached = responseCache.get<T>(key);
  if (cached !== null) {
    console.log(`[Cache] HIT: ${key}`);
    return cached;
  }

  console.log(`[Cache] MISS: ${key}`);

  // Fetch and cache
  const data = await fetcher();
  responseCache.set(key, data, ttl);

  return data;
}

// Cache decorator for async functions
// Preload cache with common queries