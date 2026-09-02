// ============================================================
// intraday/time — IST market-clock helpers (NSE hours) + market-aware
// session/dayKey/phase for the multi-market intraday engine
// (2026-09: CRYPTO joins NSE — it trades 24/7 on UTC days).
// ============================================================
// Single source of truth for "what time is it in IST" and
// "is the market session open". Every intraday module imports
// from here so the session definition can never drift apart.
// ============================================================

export function getISTParts(date = new Date()) {
  const fmt = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Kolkata', hour12: false,
    weekday: 'short', hour: '2-digit', minute: '2-digit',
  }).formatToParts(date);
  const get = t => fmt.find(p => p.type === t)?.value || '';
  const hour = parseInt(get('hour'), 10) % 24;
  const minute = parseInt(get('minute'), 10);
  const wd = get('weekday');
  return { hour, minute, weekday: wd };
}

// Minutes since IST midnight (e.g. 09:15 → 555).
export function istMinutes(date = new Date()) {
  const { hour, minute } = getISTParts(date);
  return hour * 60 + minute;
}

export function isNseMarketOpen(date = new Date()) {
  const { hour, minute, weekday } = getISTParts(date);
  if (weekday === 'Sat' || weekday === 'Sun') return false;
  const mins = hour * 60 + minute;
  return mins >= 9 * 60 + 15 && mins <= 15 * 60 + 30; // 09:15 - 15:30 IST
}

// YYYY-MM-DD in IST — day bucket key for persistence + counters.
export function istDayKey(date = new Date()) {
  return new Date(date).toLocaleDateString('sv-SE', { timeZone: 'Asia/Kolkata' });
}

// Session phase: 'early' (09:15–09:45 opening range), 'full', 'power-hour' (14:30+).
export function marketPhase(date = new Date()) {
  const m = istMinutes(date);
  if (m >= 9 * 60 + 15 && m < 9 * 60 + 45) return 'early';
  if (m >= 14 * 60 + 30) return 'power-hour';
  return 'full';
}

// ------------------------------------------------------------
// MARKET-AWARE HELPERS (2026-09 multi-market pass)
// market: 'INDIA' (default — NSE cash session) | 'CRYPTO' (24/7)
// ------------------------------------------------------------

/** Crypto trades 24×7 — the scanner/watcher never close for it. */
export function isCryptoMarketOpen() { return true; }

/** Market-keyed session gate: INDIA → NSE hours, CRYPTO → always. */
export function isMarketOpenFor(market = 'INDIA', date = new Date()) {
  if (String(market).toUpperCase() === 'CRYPTO') return isCryptoMarketOpen();
  return isNseMarketOpen(date);
}

/**
 * Day bucket per market: INDIA → IST calendar day (matches the NSE
 * session), CRYPTO → UTC calendar day (matches the Binance/UTC
 * candle day — avoids an IST-midnight "new day" reset mid-session).
 */
export function dayKeyFor(market = 'INDIA', date = new Date()) {
  if (String(market).toUpperCase() === 'CRYPTO') {
    return new Date(date).toLocaleDateString('sv-SE', { timeZone: 'UTC' });
  }
  return istDayKey(date);
}

/** Market-keyed session phase: crypto has no early/power-hour. */
export function marketPhaseFor(market = 'INDIA', date = new Date()) {
  if (String(market).toUpperCase() === 'CRYPTO') return 'full';
  return marketPhase(date);
}

/** Market-keyed fresh-entry window: crypto never blocks new entries. */
export function freshEntriesAllowedFor(market = 'INDIA') {
  if (String(market).toUpperCase() === 'CRYPTO') return true;
  return istMinutes() < 15 * 60;
}
