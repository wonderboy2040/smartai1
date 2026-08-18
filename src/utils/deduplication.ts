// Request deduplication - prevent duplicate in-flight requests

type RequestKey = string;
type PendingRequest<T> = Promise<T>;

class RequestDeduplicator {
  private inflightRequests = new Map<RequestKey, PendingRequest<any>>();
  private requestCounts = new Map<RequestKey, number>();

  async dedupe<T>(
    key: RequestKey,
    fetcher: () => Promise<T>
  ): Promise<T> {
    // Check if request is already in-flight
    if (this.inflightRequests.has(key)) {
      const count = (this.requestCounts.get(key) || 0) + 1;
      this.requestCounts.set(key, count);

      console.log(`[Dedupe] Reusing in-flight request: ${key} (${count} duplicates)`);

      return this.inflightRequests.get(key)! as Promise<T>;
    }

    // Start new request
    console.log(`[Dedupe] Starting new request: ${key}`);
    this.requestCounts.set(key, 0);

    const promise = fetcher()
      .finally(() => {
        // Clean up after request completes
        const dupes = this.requestCounts.get(key) || 0;
        if (dupes > 0) {
          console.log(`[Dedupe] Request completed: ${key} (prevented ${dupes} duplicates)`);
        }

        this.inflightRequests.delete(key);
        this.requestCounts.delete(key);
      });

    this.inflightRequests.set(key, promise);

    return promise;
  }

  // Cancel an in-flight request
  cancel(key: RequestKey): boolean {
    if (this.inflightRequests.has(key)) {
      this.inflightRequests.delete(key);
      this.requestCounts.delete(key);
      console.log(`[Dedupe] Cancelled request: ${key}`);
      return true;
    }
    return false;
  }

  // Cancel all in-flight requests
  cancelAll(): void {
    const count = this.inflightRequests.size;
    this.inflightRequests.clear();
    this.requestCounts.clear();
    console.log(`[Dedupe] Cancelled ${count} in-flight requests`);
  }

  // Get stats
  getStats() {
    const inFlight = Array.from(this.requestCounts.entries());
    const totalDuplicates = inFlight.reduce((sum, [_, count]) => sum + count, 0);

    return {
      activeRequests: this.inflightRequests.size,
      totalDuplicatesPrevented: totalDuplicates,
      requests: inFlight.map(([key, count]) => ({ key, duplicates: count }))
    };
  }
}

// Global deduplicator instance
export const deduplicator = new RequestDeduplicator();

// Helper to generate request keys
export function generateRequestKey(
  url: string,
  options?: RequestInit
): RequestKey {
  const method = options?.method || 'GET';
  const body = options?.body ? JSON.stringify(options.body) : '';

  return `${method}:${url}:${body}`;
}

// Deduplicated fetch wrapper
export async function deduplicatedFetch(
  input: RequestInfo | URL,
  init?: RequestInit
): Promise<Response> {
  const url = input.toString();
  const key = generateRequestKey(url, init);

  return deduplicator.dedupe(key, () => fetch(input, init));
}

// React hook for deduplicated requests
export function useDedupedFetch() {
  return {
    fetch: deduplicatedFetch,
    cancel: (key: string) => deduplicator.cancel(key),
    cancelAll: () => deduplicator.cancelAll(),
    getStats: () => deduplicator.getStats()
  };
}

// Decorator for class methods
export function deduplicate(keyGenerator?: (...args: any[]) => string) {
  return function (
    _target: any,
    propertyKey: string,
    descriptor: PropertyDescriptor
  ) {
    const originalMethod = descriptor.value;
    const dedup = new RequestDeduplicator();

    descriptor.value = async function (...args: any[]) {
      const key = keyGenerator
        ? keyGenerator(...args)
        : `${propertyKey}:${JSON.stringify(args)}`;

      return dedup.dedupe(key, () => originalMethod.apply(this, args));
    };

    return descriptor;
  };
}

// Batch deduplicator for GraphQL-style batching
class BatchDeduplicator<T> {
  private queue: Array<{
    key: string;
    resolve: (value: T) => void;
    reject: (reason: any) => void;
  }> = [];
  private timer: NodeJS.Timeout | null = null;
  private batchDelay = 50; // 50ms batching window

  request(key: string, fetcher: (keys: string[]) => Promise<T[]>): Promise<T> {
    return new Promise((resolve, reject) => {
      this.queue.push({ key, resolve, reject });

      // Clear existing timer
      if (this.timer) {
        clearTimeout(this.timer);
      }

      // Set new timer
      this.timer = setTimeout(() => {
        this.flush(fetcher);
      }, this.batchDelay);
    });
  }

  private async flush(fetcher: (keys: string[]) => Promise<T[]>) {
    if (this.queue.length === 0) return;

    const batch = [...this.queue];
    this.queue = [];
    this.timer = null;

    const keys = batch.map(item => item.key);
    const uniqueKeys = [...new Set(keys)];

    console.log(`[Batch] Fetching ${uniqueKeys.length} unique keys from ${keys.length} requests`);

    try {
      const results = await fetcher(uniqueKeys);

      // Map results back to original requests
      const resultMap = new Map(uniqueKeys.map((key, i) => [key, results[i]]));

      batch.forEach(item => {
        const result = resultMap.get(item.key);
        if (result !== undefined) {
          item.resolve(result);
        } else {
          item.reject(new Error(`No result for key: ${item.key}`));
        }
      });
    } catch (error) {
      // Reject all
      batch.forEach(item => item.reject(error));
    }
  }
}

// Example: Batch price fetcher
export const priceBatcher = new BatchDeduplicator<number>();

export async function fetchPriceDeduped(symbol: string): Promise<number> {
  return priceBatcher.request(symbol, async (symbols) => {
    // Fetch all symbols in one request
    const response = await fetch('/api/prices', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ symbols })
    });

    const data = await response.json();
    return symbols.map(sym => data[sym]?.price || 0);
  });
}
