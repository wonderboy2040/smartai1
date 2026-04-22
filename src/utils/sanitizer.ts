/**
 * Input Sanitization & Validation Utilities
 * Prevents XSS and injection attacks
 */

/**
 * Sanitize user input to prevent XSS
 */
export function sanitizeInput(input: string): string {
  return input
    .replace(/[<>]/g, '') // Remove angle brackets
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
    .trim();
}

/**
 * Validate API key format
 */
export function validateApiKey(key: string, prefix: string = 'gsk_'): boolean {
  if (!key || key.length < 10) return false;
  return key.startsWith(prefix);
}

/**
 * Validate symbol format (basic)
 */
export function validateSymbol(symbol: string): boolean {
  if (!symbol || symbol.length > 20) return false;
  // Allow alphanumeric, dots, underscores, hyphens
  return /^[A-Z0-9._-]+$/.test(symbol.toUpperCase());
}

/**
 * Safe JSON parse with error handling
 */
export function safeJsonParse<T>(json: string, fallback: T): T {
  try {
    return JSON.parse(json) as T;
  } catch {
    return fallback;
  }
}

/**
 * Debounce function
 */
export function debounce<T extends (...args: any[]) => any>(
  func: T,
  wait: number
): (...args: Parameters<T>) => void {
  let timeout: NodeJS.Timeout | null = null;
  
  return (...args: Parameters<T>) => {
    if (timeout) clearTimeout(timeout);
    timeout = setTimeout(() => func(...args), wait);
  };
}

/**
 * Throttle function
 */
export function throttle<T extends (...args: any[]) => any>(
  func: T,
  limit: number
): (...args: Parameters<T>) => void {
  let inThrottle = false;
  
  return (...args: Parameters<T>) => {
    if (!inThrottle) {
      func(...args);
      inThrottle = true;
      setTimeout(() => (inThrottle = false), limit);
    }
  };
}

/**
 * Check if string is likely HTML
 */
export function isLikelyHTML(str: string): boolean {
  return /<[a-z][\s\S]*>/i.test(str);
}

/**
 * Escape HTML entities
 */
export function escapeHtml(str: string): string {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

/**
 * Validate URL (basic)
 */
export function isValidUrl(url: string): boolean {
  try {
    new URL(url);
    return true;
  } catch {
    return false;
  }
}

/**
 * Create safe object from user input
 */
export function createSafeObject<T extends Record<string, any>>(
  obj: T,
  validators: { [K in keyof T]?: (value: any) => boolean }
): Partial<T> {
  const safe: Partial<T> = {};
  
  for (const key in obj) {
    const validator = validators[key];
    if (!validator || validator(obj[key])) {
      safe[key] = obj[key];
    }
  }
  
  return safe;
}
