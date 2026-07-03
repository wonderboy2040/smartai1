// ============================================================
// INFLATION ENGINE — Real Returns Layer
// ------------------------------------------------------------
// Provides India CPI + US CPI inflation rates fetched from the
// server (cached) and converts nominal returns to real returns.
//
// Real return formula (Fisher equation, exact):
//   real_return = (1 + nominal) / (1 + inflation) - 1
//
// Real value of a future corpus in today's purchasing power:
//   real_value = nominal_value / (1 + inflation) ^ years
// ============================================================

const PROXY_BASE = (import.meta.env.VITE_API_PROXY as string) || '';

let _cached: { india: number; us: number; ts: number } | null = null;
const CACHE_TTL = 24 * 60 * 60 * 1000;  // 24h

/**
 * Fetch latest India + US inflation rates. Falls back to sensible
 * defaults (India 6%, US 3%) if the API is unreachable.
 */
export async function fetchInflationRates(): Promise<{ india: number; us: number }> {
  if (_cached && Date.now() - _cached.ts < CACHE_TTL) {
    return { india: _cached.india, us: _cached.us };
  }

  // Try our server-side endpoint (added below in server/index.js).
  try {
    const res = await fetch(`${PROXY_BASE}/api/inflation?t=${Date.now()}`, {
      signal: AbortSignal.timeout(5000),
    });
    if (res.ok) {
      const j = await res.json();
      if (typeof j.india === 'number' && typeof j.us === 'number') {
        _cached = { india: j.india, us: j.us, ts: Date.now() };
        return { india: j.india, us: j.us };
      }
    }
  } catch { /* fall back to defaults */ }

  // Defaults — typical long-run averages.
  _cached = { india: 6, us: 3, ts: Date.now() };
  return { india: 6, us: 3 };
}

/**
 * Convert nominal annual CAGR to real CAGR (Fisher equation).
 * Both inputs in percentage points (e.g. 12.0 for 12%).
 */
export function realCagr(nominalCagrPct: number, inflationPct: number): number {
  if (nominalCagrPct <= -100) return -100;  // avoid div-by-zero edge
  const real = (1 + nominalCagrPct / 100) / (1 + inflationPct / 100) - 1;
  return real * 100;
}

/**
 * Discount a future nominal corpus back to today's purchasing power.
 *   real_value = nominal / (1 + inflation)^years
 */
export function realValue(nominalValue: number, inflationPct: number, years: number): number {
  if (years <= 0) return nominalValue;
  return nominalValue / Math.pow(1 + inflationPct / 100, years);
}

/**
 * Inflation-adjusted monthly expense projection.
 *   expense_in_year_n = today_expense * (1 + inflation)^n
 */
export function inflateExpense(todayExpense: number, inflationPct: number, yearsAhead: number): number {
  return todayExpense * Math.pow(1 + inflationPct / 100, yearsAhead);
}

/**
 * Inflation-adjusted FIRE number.
 * Standard 4% rule assumes today's expenses. Real FIRE number in n years:
 *   fire_real = today_expense * 12 * 25 * (1 + inflation)^n
 */
export function inflateFireNumber(
  todayMonthlyExpense: number,
  inflationPct: number,
  yearsToRetirement: number,
  multiplier: number = 25  // 25x = 4% rule
): number {
  return todayMonthlyExpense * 12 * multiplier * Math.pow(1 + inflationPct / 100, yearsToRetirement);
}

/**
 * Calculate the "hidden tax" of inflation on a portfolio.
 * Returns the rupee amount of purchasing power lost per year.
 */
export function inflationDrag(portfolioValueINR: number, inflationPct: number): number {
  return portfolioValueINR * (inflationPct / 100);
}

/**
 * Format a real-vs-nominal comparison string for UI display.
 */
export function realVsNominalSummary(
  nominalValue: number,
  inflationPct: number,
  years: number
): { nominal: number; real: number; lost: number; lostPct: number } {
  const real = realValue(nominalValue, inflationPct, years);
  const lost = nominalValue - real;
  const lostPct = nominalValue > 0 ? (lost / nominalValue) * 100 : 0;
  return { nominal: nominalValue, real, lost, lostPct };
}
