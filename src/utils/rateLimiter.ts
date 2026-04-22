/**
 * Rate Limiter for API calls
 * Prevents abuse and manages API quotas
 */

interface RateLimitConfig {
  maxCalls: number;
  windowMs: number;
}

interface CallRecord {
  timestamps: number[];
}

class RateLimiter {
  private records: Map<string, CallRecord>;
  private config: RateLimitConfig;

  constructor(config: RateLimitConfig = { maxCalls: 10, windowMs: 60000 }) {
    this.records = new Map();
    this.config = config;
  }

  /**
   * Check if call is allowed
   */
  checkLimit(key: string): { allowed: boolean; remaining: number; resetIn: number } {
    const now = Date.now();
    const { maxCalls, windowMs } = this.config;
    
    let record = this.records.get(key);
    if (!record) {
      record = { timestamps: [] };
      this.records.set(key, record);
    }

    // Remove old timestamps outside window
    record.timestamps = record.timestamps.filter(
      ts => now - ts < windowMs
    );

    const remaining = Math.max(0, maxCalls - record.timestamps.length);
    const resetIn = record.timestamps.length > 0 
      ? windowMs - (now - record.timestamps[0])
      : 0;

    if (record.timestamps.length >= maxCalls) {
      return { allowed: false, remaining: 0, resetIn };
    }

    // Record this call
    record.timestamps.push(now);
    return { allowed: true, remaining: remaining - 1, resetIn };
  }

  /**
   * Get current usage stats
   */
  getUsage(key: string): { used: number; remaining: number; total: number } {
    const now = Date.now();
    const record = this.records.get(key);
    
    if (!record) {
      return { used: 0, remaining: this.config.maxCalls, total: this.config.maxCalls };
    }

    const used = record.timestamps.filter(ts => now - ts < this.config.windowMs).length;
    return {
      used,
      remaining: Math.max(0, this.config.maxCalls - used),
      total: this.config.maxCalls
    };
  }

  /**
   * Reset limiter for a key
   */
  reset(key: string): void {
    this.records.delete(key);
  }

  /**
   * Reset all limits
   */
  resetAll(): void {
    this.records.clear();
  }
}

// Global rate limiters for different API types
export const rateLimiters = {
  groq: new RateLimiter({ maxCalls: 20, windowMs: 60000 }), // 20 calls/min
  tradingView: new RateLimiter({ maxCalls: 100, windowMs: 60000 }), // 100 calls/min
  telegram: new RateLimiter({ maxCalls: 30, windowMs: 60000 }), // 30 calls/min
  forex: new RateLimiter({ maxCalls: 60, windowMs: 60000 }), // 1 call/sec
};

// Rate limit error
export class RateLimitError extends Error {
  resetIn: number;
  
  constructor(message: string, resetIn: number) {
    super(message);
    this.name = 'RateLimitError';
    this.resetIn = resetIn;
  }
}

/**
 * Execute function with rate limiting
 */
export async function withRateLimit<T>(
  key: 'groq' | 'tradingView' | 'telegram' | 'forex',
  fn: () => Promise<T>
): Promise<T> {
  const limiter = rateLimiters[key];
  const result = limiter.checkLimit(key);

  if (!result.allowed) {
    throw new RateLimitError(
      `Rate limit exceeded for ${key}. Try again in ${Math.ceil(result.resetIn / 1000)}s`,
      result.resetIn
    );
  }

  return fn();
}

/**
 * Retry with exponential backoff
 */
export async function retryWithBackoff<T>(
  fn: () => Promise<T>,
  options: {
    maxRetries?: number;
    initialDelay?: number;
    maxDelay?: number;
    backoffFactor?: number;
  } = {}
): Promise<T> {
  const {
    maxRetries = 3,
    initialDelay = 1000,
    maxDelay = 10000,
    backoffFactor = 2
  } = options;

  let lastError: Error;
  let delay = initialDelay;

  for (let i = 0; i <= maxRetries; i++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
      
      if (i === maxRetries) break;
      
      // Don't retry on rate limit errors
      if (error instanceof RateLimitError) {
        throw error;
      }

      await new Promise(resolve => setTimeout(resolve, delay));
      delay = Math.min(delay * backoffFactor, maxDelay);
    }
  }

  throw lastError;
}
