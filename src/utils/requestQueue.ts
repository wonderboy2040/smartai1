// ============================================================
// Priority Request Queue & Rate Limiter — Wealth AI v18
// ------------------------------------------------------------
// Manages concurrent network requests with priority levels,
// prevents HTTP 429 rate limit spikes, and ensures critical
// user actions (buy/sell/alerts) take precedence over prefetching.
// ============================================================

export type RequestPriority = 10 | 8 | 5 | 1;

export const Priority = {
  CRITICAL: 10 as RequestPriority, // User buy/sell, unlock, urgent refresh
  HIGH: 8 as RequestPriority,     // Live price feeds, health monitor
  NORMAL: 5 as RequestPriority,   // ML predictions, market intelligence, scans
  LOW: 1 as RequestPriority,      // Background predictive prefetch, news
} as const;

interface QueueItem<T> {
  id: string;
  fn: () => Promise<T>;
  priority: number;
  resolve: (value: T) => void;
  reject: (reason: any) => void;
  enqueuedAt: number;
}

class PriorityRequestQueue {
  private queue: Array<QueueItem<any>> = [];
  private activeCount = 0;
  private maxConcurrent = 4;
  private minIntervalMs = 20; // 20ms pacing between dispatches
  private lastDispatchTime = 0;
  private totalProcessed = 0;

  constructor(maxConcurrent = 4) {
    this.maxConcurrent = maxConcurrent;
  }

  /**
   * Enqueue an async task with designated priority
   */
  async enqueue<T>(
    fn: () => Promise<T>,
    priority: RequestPriority = Priority.NORMAL,
    id = `req_${Math.random().toString(36).slice(2, 8)}`
  ): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const item: QueueItem<T> = {
        id,
        fn,
        priority,
        resolve,
        reject,
        enqueuedAt: Date.now()
      };

      this.queue.push(item);
      // Sort highest priority first; if equal priority, FIFO (earlier enqueuedAt first)
      this.queue.sort((a, b) => b.priority - a.priority || a.enqueuedAt - b.enqueuedAt);

      this.processNext();
    });
  }

  private async processNext() {
    if (this.activeCount >= this.maxConcurrent || this.queue.length === 0) {
      return;
    }

    const now = Date.now();
    const elapsed = now - this.lastDispatchTime;
    if (elapsed < this.minIntervalMs) {
      setTimeout(() => this.processNext(), this.minIntervalMs - elapsed);
      return;
    }

    const item = this.queue.shift();
    if (!item) return;

    this.activeCount++;
    this.lastDispatchTime = Date.now();

    try {
      const result = await item.fn();
      item.resolve(result);
    } catch (err) {
      item.reject(err);
    } finally {
      this.activeCount--;
      this.totalProcessed++;
      // Process remaining in next microtask
      Promise.resolve().then(() => this.processNext());
    }
  }

  /**
   * Cancel pending requests matching an ID prefix or priority filter
   */
  cancel(predicate: (id: string, priority: number) => boolean): number {
    const initial = this.queue.length;
    this.queue = this.queue.filter(item => {
      const shouldCancel = predicate(item.id, item.priority);
      if (shouldCancel) {
        item.reject(new Error('Request cancelled by queue manager'));
      }
      return !shouldCancel;
    });
    return initial - this.queue.length;
  }

  /**
   * Cancel all low-priority background prefetch requests
   */
  cancelPrefetches(): number {
    return this.cancel((_, priority) => priority <= Priority.LOW);
  }

  /**
   * Get queue statistics
   */
  getStats() {
    return {
      pending: this.queue.length,
      active: this.activeCount,
      totalProcessed: this.totalProcessed,
      maxConcurrent: this.maxConcurrent,
      topPriority: this.queue[0]?.priority || 0
    };
  }
}

export const requestQueue = new PriorityRequestQueue(4);

/**
 * Helper to execute a fetch request via priority queue
 */
export async function queuedFetch<T>(
  fetcher: () => Promise<T>,
  priority: RequestPriority = Priority.NORMAL,
  id?: string
): Promise<T> {
  return requestQueue.enqueue(fetcher, priority, id);
}
