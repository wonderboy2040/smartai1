// ============================================================
// liveFeed — central in-memory tick store + pub/sub for SSE
// ------------------------------------------------------------
// Every real-time source (NSE, Finnhub US, Binance crypto) writes the latest
// tick here, keyed exactly like the frontend price map:
//   IN_<symbol>  US_<symbol>   (crypto is stored as IN_<symbol> too)
// The /api/stream SSE endpoint reads/pushes from here.
// ============================================================
const _ticks = new Map();        // key -> { price, change, high, low, volume, time, source }
const _subscribers = new Set();  // fn(key, data)
const _sourceSeen = {};          // source -> last tick epoch (for feed-status)

export function setTick(key, data, source) {
  if (!key || !(data?.price > 0)) return;
  const tick = {
    price: data.price,
    change: typeof data.change === 'number' ? data.change : 0,
    high: data.high ?? data.price,
    low: data.low ?? data.price,
    volume: data.volume ?? 0,
    time: data.time ?? Date.now(),
    source: source || data.source || 'live',
  };
  _ticks.set(key, tick);
  if (source) _sourceSeen[source] = Date.now();
  for (const fn of _subscribers) {
    try { fn(key, tick); } catch { /* ignore subscriber errors */ }
  }
}

export function getTick(key) {
  return _ticks.get(key) || null;
}

export function snapshot(keys) {
  const out = {};
  (keys || []).forEach(k => { const t = _ticks.get(k); if (t) out[k] = t; });
  return out;
}

export function subscribe(fn) {
  _subscribers.add(fn);
  return () => _subscribers.delete(fn);
}

// Which sources have produced a tick in the last 60s (for the UI health dot).
export function feedStatus() {
  const now = Date.now();
  const live = {};
  for (const [src, at] of Object.entries(_sourceSeen)) {
    live[src] = (now - at) < 60000;
  }
  return live;
}

// Housekeeping (2026 perf audit M2): _ticks previously grew forever — every
// key ever ticked stayed in the map for the whole process lifetime. Snapshots
// only ever ask for keys an active client cares about, so anything stale
// (>30 min without an update, map larger than 300) is safely evictable.
setInterval(() => {
  if (_ticks.size <= 300) return;
  const cutoff = Date.now() - 30 * 60 * 1000;
  for (const [k, t] of _ticks) {
    if ((t.time || 0) < cutoff) _ticks.delete(k);
  }
}, 5 * 60 * 1000).unref?.();
