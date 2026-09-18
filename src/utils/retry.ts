// Exponential backoff retry utility

interface RetryOptions {
  maxRetries?: number;
  baseDelay?: number;
  maxDelay?: number;
  backoffFactor?: number;
  retryableStatuses?: number[];
  onRetry?: (attempt: number, error: Error) => void;
}

const DEFAULT_OPTIONS: Required<RetryOptions> = {
  maxRetries: 3,
  baseDelay: 1000,
  maxDelay: 30000,
  backoffFactor: 2,
  retryableStatuses: [408, 429, 500, 502, 503, 504],
  onRetry: () => {}
};

class RetryError extends Error {
  constructor(
    message: string,
    public readonly lastError: Error,
    public readonly attempts: number
  ) {
    super(message);
    this.name = 'RetryError';
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function calculateDelay(
  attempt: number,
  baseDelay: number,
  maxDelay: number,
  backoffFactor: number
): number {
  const exponentialDelay = baseDelay * Math.pow(backoffFactor, attempt);
  const jitter = Math.random() * 0.3 * exponentialDelay; // Add 0-30% jitter
  return Math.min(exponentialDelay + jitter, maxDelay);
}

function isRetryableError(error: any, retryableStatuses: number[]): boolean {
  // Network errors
  if (error.name === 'TypeError' && error.message.includes('fetch')) {
    return true;
  }

  // Timeout errors
  if (error.name === 'AbortError' || error.message.includes('timeout')) {
    return true;
  }

  // HTTP status codes
  if (error.status && retryableStatuses.includes(error.status)) {
    return true;
  }

  return false;
}

export async function fetchWithRetry<T>(
  fetcher: () => Promise<T>,
  options: RetryOptions = {}
): Promise<T> {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  let lastError: Error | null = null;

  for (let attempt = 0; attempt <= opts.maxRetries; attempt++) {
    try {
      return await fetcher();
    } catch (error) {
      lastError = error as Error;

      // Don't retry if not retryable
      if (!isRetryableError(error, opts.retryableStatuses)) {
        throw error;
      }

      // Don't retry on last attempt
      if (attempt === opts.maxRetries) {
        break;
      }

      // Calculate delay
      const delay = calculateDelay(
        attempt,
        opts.baseDelay,
        opts.maxDelay,
        opts.backoffFactor
      );

      console.warn(
        `[Retry] Attempt ${attempt + 1}/${opts.maxRetries + 1} failed. Retrying in ${delay.toFixed(0)}ms...`,
        error
      );

      opts.onRetry(attempt + 1, lastError);

      await sleep(delay);
    }
  }

  throw new RetryError(
    `Request failed after ${opts.maxRetries + 1} attempts`,
    lastError!,
    opts.maxRetries + 1
  );
}

// Retry wrapper for fetch API
export async function retryFetch(
  input: RequestInfo | URL,
  init?: RequestInit,
  options?: RetryOptions
): Promise<Response> {
  return fetchWithRetry(async () => {
    const response = await fetch(input, init);

    // Check if response status is retryable
    if (!response.ok) {
      const error = new Error(`HTTP ${response.status}: ${response.statusText}`) as any;
      error.status = response.status;
      error.response = response;
      throw error;
    }

    return response;
  }, options);
}

// Circuit breaker pattern
class CircuitBreaker {
  private failures = 0;
  private lastFailureTime = 0;
  private state: 'CLOSED' | 'OPEN' | 'HALF_OPEN' = 'CLOSED';

  constructor(
    private threshold = 5,
    private timeout = 60000 // 1 minute
  ) {}

  async execute<T>(fn: () => Promise<T>): Promise<T> {
    // Check if circuit is open
    if (this.state === 'OPEN') {
      const timeSinceLastFailure = Date.now() - this.lastFailureTime;

      if (timeSinceLastFailure < this.timeout) {
        throw new Error('Circuit breaker is OPEN - request blocked');
      }

      // Try to recover
      this.state = 'HALF_OPEN';
      console.log('[CircuitBreaker] Transitioning to HALF_OPEN state');
    }

    try {
      const result = await fn();

      // Success - reset
      if (this.state === 'HALF_OPEN') {
        console.log('[CircuitBreaker] Recovery successful - CLOSED');
        this.state = 'CLOSED';
        this.failures = 0;
      }

      return result;
    } catch (error) {
      this.failures++;
      this.lastFailureTime = Date.now();

      // Open circuit if threshold reached
      if (this.failures >= this.threshold) {
        this.state = 'OPEN';
        console.error(
          `[CircuitBreaker] Threshold reached (${this.failures}/${this.threshold}) - OPEN`
        );
      }

      throw error;
    }
  }

  reset(): void {
    this.failures = 0;
    this.state = 'CLOSED';
    this.lastFailureTime = 0;
  }

  getState() {
    return {
      state: this.state,
      failures: this.failures,
      lastFailureTime: this.lastFailureTime
    };
  }
}

// Global circuit breakers for different services
export const circuitBreakers = {
  api: new CircuitBreaker(5, 60000),
  prices: new CircuitBreaker(3, 30000),
  ai: new CircuitBreaker(5, 120000)
};

// Enhanced fetch with retry + circuit breaker
export async function resilientFetch(
  input: RequestInfo | URL,
  init?: RequestInit,
  options?: RetryOptions & { circuitBreaker?: CircuitBreaker }
): Promise<Response> {
  const breaker = options?.circuitBreaker || circuitBreakers.api;

  return breaker.execute(() => retryFetch(input, init, options));
}
