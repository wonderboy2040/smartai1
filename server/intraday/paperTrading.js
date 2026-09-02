// ============================================================
// intraday/paperTrading — virtual-trade simulator engine
// ------------------------------------------------------------
// Users open VIRTUAL positions from any scanner signal (or manual
// levels) with zero real money. The watcher in stream.js evaluates
// them against live prices and auto-manages them exactly like the
// site's published execution discipline:
//   • T1 hit  → book 50%, trail remaining to breakeven (entry)
//   • T2 hit  → close remaining (full target run)
//   • SL hit  → close remaining at stop
//   • 15:10 IST → hard square-off of whatever is left
// Manual close anytime at live LTP. All trades persist to
// server/data/paper-trades.json with realized + unrealized P&L.
// ============================================================
import { loadJSON, saveJSON } from './store.js';
import { istDayKey, istMinutes, dayKeyFor } from './time.js';
import { isCryptoSymbolBase } from './engine.js';
import { recordTradeClose } from './journal.js';
import { scheduleBackup, restoreBackup, backupConfigured } from './backup.js';

const FILE = 'paper-trades.json';
const MAX_TRADES = 500;
const PAPER_SQOFF_MIN = 15 * 60 + 10; // 15:10 IST hard square-off (NSE only)

// Per-trade market: CRYPTO trades 24/7 with fractional units (0.0027 BTC);
// INDIA stays whole-share with the 15:10 IST square-off.
const _marketOfTrade = (t) => {
  const m = String(t?.market || '').toUpperCase();
  if (m === 'CRYPTO') return 'CRYPTO';
  if (m === 'INDIA') return 'INDIA';
  return isCryptoSymbolBase(t?.symbol) ? 'CRYPTO' : 'INDIA';
};

// Fractional-safe qty normalizer: INDIA → integer shares; CRYPTO → 4dp units.
function _normQty(raw, market) {
  const n = typeof raw === 'number' ? raw : Number(raw);
  if (!Number.isFinite(n) || n <= 0) return 0;
  if (market === 'CRYPTO') return +n.toFixed(4);
  return Math.floor(n);
}

let _state = loadJSON(FILE, { trades: [], nextId: 1, dayKey: '' });
let _saveTimer = null;

function _persist() {
  if (_saveTimer) return;
  _saveTimer = setTimeout(() => {
    _saveTimer = null;
    saveJSON(FILE, _state);
    // DURABLE HISTORY: Render's free plan wipes server/data/ on every
    // restart — mirror the state to the GitHub backup branch so the
    // paper-trading track record survives (see backup.js).
    try { scheduleBackup(FILE, _state); } catch { /* backup optional */ }
  }, 1000);
  if (typeof _saveTimer.unref === 'function') _saveTimer.unref();
}

function _validateSym(sym) {
  return typeof sym === 'string' && /^[A-Z0-9&\-]{2,15}$/.test(sym.trim().toUpperCase());
}

export function openPaperTrade(input) {
  const {
    symbol, direction, entry, qty,
    stopLoss, target1, target2, market,
  } = input || {};

  if (!_validateSym(symbol)) return { error: 'Invalid symbol format.' };
  const sym = symbol.trim().toUpperCase();
  const mkt = (['INDIA', 'CRYPTO'].includes(String(market || '').toUpperCase())
    ? String(market).toUpperCase()
    : (isCryptoSymbolBase(sym) ? 'CRYPTO' : 'INDIA'));
  const dir = direction === 'SHORT' ? 'SHORT' : 'LONG';
  const n = (v) => (typeof v === 'number' && isFinite(v) && v > 0) ? v : null;
  const e = n(entry), sl = n(stopLoss);
  const t1 = n(target1), t2 = n(target2);
  const q = _normQty(n(qty) || 0, mkt);
  if (!e) return { error: 'Valid entry price required.' };
  if (!q || q < (mkt === 'CRYPTO' ? 0.0001 : 1) || q > 100000) {
    return { error: mkt === 'CRYPTO'
      ? 'Qty must be ≥0.0001 (max 100000, 4dp).' 
      : 'Qty must be 1..100000.' };
  }
  if (!sl) return { error: 'Valid stop-loss required.' };
  // Level sanity — direction-consistent ordering.
  if (dir === 'LONG' && (sl >= e || (t1 && t1 <= e) || (t2 && t2 <= e))) {
    return { error: 'LONG levels must satisfy SL < entry < T1 < T2.' };
  }
  if (dir === 'SHORT' && (sl <= e || (t1 && t1 >= e) || (t2 && t2 >= e))) {
    return { error: 'SHORT levels must satisfy SL > entry > T1 > T2.' };
  }
  // Risk guard: max 1 lakh units / trade and max 10 concurrent open trades.
  const today = dayKeyFor(mkt);
  if (_state.dayKey !== today) _state.dayKey = today;
  const openNow = _state.trades.filter(t => t.status === 'OPEN' || t.status === 'PARTIAL');
  if (openNow.length >= 10) return { error: 'Max 10 open paper trades.' };
  if (openNow.some(t => t.symbol === sym && t.direction === dir && _marketOfTrade(t) === mkt)) {
    return { error: `Paper trade already open for ${sym} ${dir}.` };
  }

  const trade = {
    id: _state.nextId++,
    symbol: sym, market: mkt, direction: dir,
    entry: +e.toFixed(2), qty: q,
    stopLoss: +sl.toFixed(2),
    target1: t1 ? +t1.toFixed(2) : null,
    target2: t2 ? +t2.toFixed(2) : null,
    remainingQty: q,
    t1Hit: false,
    status: 'OPEN',           // OPEN | PARTIAL | CLOSED
    openedAt: Date.now(),
    closedAt: null, closeReason: null,
    realizedPnl: 0,
    unrealizedPnl: 0,
    lastPrice: +e.toFixed(2),
    parts: [],                // [{qty, exitPrice, ts, reason}]
    dayKey: today,
    capital: +(q * e).toFixed(2), // notionally deployed
  };
  _state.trades.push(trade);
  if (_state.trades.length > MAX_TRADES) {
    _state.trades = _state.trades.slice(_state.trades.length - MAX_TRADES);
  }
  _persist();
  return { ok: true, trade };
}

function _closePart(trade, qty, price, reason) {
  const use = Math.min(qty, trade.remainingQty);
  if (use <= 0) return;
  const sign = trade.direction === 'LONG' ? 1 : -1;
  trade.remainingQty -= use;
  trade.realizedPnl += use * (price - trade.entry) * sign;
  trade.parts.push({ qty: use, exitPrice: +(+price).toFixed(2), ts: Date.now(), reason });
  if (trade.remainingQty <= 0) {
    trade.status = 'CLOSED';
    trade.closedAt = Date.now();
    trade.closeReason = reason;
    trade.unrealizedPnl = 0;
    // AUTO TRADE JOURNAL — every close path (SL/T1/T2/trail/EOD/
    // manual/stale) lands here exactly once. Pure data capture;
    // the AI review runs later (EOD cron / on-demand endpoint).
    try { recordTradeClose(trade); } catch { /* journal optional */ }
  }
}

// ------------------------------------------------------------
// Live evaluation — called by the watcher with fresh quotes.
// ------------------------------------------------------------
export function evaluatePaper(quotes, events) {
  const m = istMinutes();
  let changed = false;

  for (const t of _state.trades) {
    if (t.status === 'CLOSED') continue;
    const mkt = _marketOfTrade(t);
    // NSE hard square-off 15:10 IST — crypto is 24/7, no EOD (it rolls
    // at the UTC day boundary via the boot/restore stale checks).
    const afterSqOff = mkt !== 'CRYPTO' && m >= PAPER_SQOFF_MIN;
    const q = quotes[t.symbol];
    const price = q?.price;
    if (price > 0) t.lastPrice = +price.toFixed(2);
    const p = t.lastPrice;
    if (!(p > 0)) continue;

    const isLong = t.direction === 'LONG';
    const hitSL = isLong ? p <= t.stopLoss : p >= t.stopLoss;
    const hitT1 = t.target1 && !t.t1Hit && (isLong ? p >= t.target1 : p <= t.target1);
    const hitT2 = t.target2 && (isLong ? p >= t.target2 : p <= t.target2);

    if (t.status === 'OPEN') {
      if (hitSL) {
        _closePart(t, t.remainingQty, t.stopLoss, 'SL_HIT');
        events.push({ type: 'PAPER_CLOSE', symbol: t.symbol, direction: t.direction, price: t.stopLoss, pnl: t.realizedPnl, note: 'Paper trade SL hit' });
        changed = true; continue;
      }
      if (hitT2) {
        _closePart(t, t.remainingQty, t.target2, 'T2_HIT');
        events.push({ type: 'PAPER_CLOSE', symbol: t.symbol, direction: t.direction, price: t.target2, pnl: t.realizedPnl, note: 'Paper trade T2 hit' });
        changed = true; continue;
      }
      if (hitT1) {
        t.t1Hit = true;
        // Fractional-safe T1 booking: half the position (4dp for crypto).
        const half = _marketOfTrade(t) === 'CRYPTO'
          ? +((t.qty / 2).toFixed(4))
          : Math.ceil(t.qty / 2);
        _closePart(t, half, t.target1, 'T1_BOOK');
        if (t.status !== 'CLOSED') t.status = 'PARTIAL';
        events.push({ type: 'PAPER_CLOSE', symbol: t.symbol, direction: t.direction, price: t.target1, pnl: t.realizedPnl, note: 'Paper: booked 50% at T1, trail to entry' });
        changed = true; continue;
      }
    } else if (t.status === 'PARTIAL') {
      if (hitSL) {
        _closePart(t, t.remainingQty, t.stopLoss, 'SL_TRAIL_HIT');
        events.push({ type: 'PAPER_CLOSE', symbol: t.symbol, direction: t.direction, price: t.stopLoss, pnl: t.realizedPnl, note: 'Paper trade trail-stop hit' });
        changed = true; continue;
      }
      if (hitT2) {
        _closePart(t, t.remainingQty, t.target2, 'T2_HIT');
        events.push({ type: 'PAPER_CLOSE', symbol: t.symbol, direction: t.direction, price: t.target2, pnl: t.realizedPnl, note: 'Paper trade T2 hit' });
        changed = true; continue;
      }
      const hitTrail = isLong ? p <= t.entry : p >= t.entry;
      if (hitTrail) {
        _closePart(t, t.remainingQty, t.entry, 'BE_TRAIL');
        events.push({ type: 'PAPER_CLOSE', symbol: t.symbol, direction: t.direction, price: t.entry, pnl: t.realizedPnl, note: 'Paper: breakeven trail exit' });
        changed = true; continue;
      }
    }

    if (afterSqOff && t.status !== 'CLOSED') {
      _closePart(t, t.remainingQty, p, 'EOD_SQOFF');
      events.push({ type: 'PAPER_CLOSE', symbol: t.symbol, direction: t.direction, price: p, pnl: t.realizedPnl, note: 'Paper: 15:10 auto square-off' });
      changed = true;
    }
  }

  // Refresh unrealized P&L for still-open trades.
  for (const t of _state.trades) {
    if (t.status === 'CLOSED') continue;
    const sign = t.direction === 'LONG' ? 1 : -1;
    t.unrealizedPnl = +(t.remainingQty * (t.lastPrice - t.entry) * sign).toFixed(2);
  }
  if (changed) _persist();
  return changed;
}

export function closePaperTrade(id, quotes) {
  const t = _state.trades.find(x => x.id === id && x.status !== 'CLOSED');
  if (!t) return { error: 'Open paper trade not found.' };
  const q = quotes?.[t.symbol];
  const price = (q?.price > 0) ? q.price : t.lastPrice;
  if (!(price > 0)) return { error: 'No live price available — try again shortly.' };
  _closePart(t, t.remainingQty, price, 'MANUAL');
  _persist();
  return { ok: true, trade: t };
}

export function paperSymbolsForWatcher() {
  return [...new Set(
    _state.trades.filter(t => t.status === 'OPEN' || t.status === 'PARTIAL').map(t => t.symbol)
  )];
}

// 2026-09 multi-market: watch set classified per market so the watcher
// routes INDIA → Groww and CRYPTO → CoinDCX quotes.
export function paperSymbolsByMarket() {
  const india = [];
  const crypto = [];
  for (const t of _state.trades) {
    if (t.status !== 'OPEN' && t.status !== 'PARTIAL') continue;
    (_marketOfTrade(t) === 'CRYPTO' ? crypto : india).push(t.symbol);
  }
  return { india: [...new Set(india)], crypto: [...new Set(crypto)] };
}

export function getPaperSummary() {
  const today = istDayKey();
  const open = _state.trades.filter(t => t.status === 'OPEN' || t.status === 'PARTIAL');
  const closedToday = _state.trades.filter(t => t.dayKey === today && t.status === 'CLOSED');
  const allClosed = _state.trades.filter(t => t.status === 'CLOSED');
  const sum = (arr, f) => arr.reduce((s, t) => s + (f(t) || 0), 0);

  return {
    open: open.map(_publicTrade),
    closedToday: closedToday.slice(-15).reverse().map(_publicTrade),
    stats: {
      openCount: open.length,
      dayRealizedPnl: +sum(closedToday, t => t.realizedPnl).toFixed(2),
      dayUnrealizedPnl: +sum(open, t => t.unrealizedPnl).toFixed(2),
      totalRealizedPnl: +sum(allClosed, t => t.realizedPnl).toFixed(2),
      wins: allClosed.filter(t => t.realizedPnl > 0).length,
      losses: allClosed.filter(t => t.realizedPnl < 0).length,
    },
  };
}

function _publicTrade(t) {
  return {
    id: t.id, symbol: t.symbol, market: _marketOfTrade(t), direction: t.direction,
    entry: t.entry, qty: t.qty, remainingQty: t.remainingQty,
    stopLoss: t.stopLoss, target1: t.target1, target2: t.target2,
    status: t.status, t1Hit: t.t1Hit, dayKey: t.dayKey,
    openedAt: t.openedAt, closedAt: t.closedAt, closeReason: t.closeReason,
    lastPrice: t.lastPrice, realizedPnl: +(+t.realizedPnl).toFixed(2),
    unrealizedPnl: +(+t.unrealizedPnl).toFixed(2),
    parts: t.parts, capital: t.capital,
  };
}

// Boot-time cleanup: anything left open from a previous day (per-market
// day key) gets squared off at its last known price. Crypto rolls at
// UTC midnight; NSE at IST midnight.
export function initPaperTrading() {
  const events = [];
  for (const t of _state.trades) {
    if (t.dayKey !== dayKeyFor(_marketOfTrade(t)) && t.status !== 'CLOSED') {
      _closePart(t, t.remainingQty, t.lastPrice || t.entry, 'STALE_SQOFF');
      events.push({ type: 'PAPER_CLOSE', symbol: t.symbol, direction: t.direction, price: t.lastPrice || t.entry, pnl: t.realizedPnl, note: 'Stale paper trade squared off on restart' });
    }
  }
  _persist();

  // DURABLE HISTORY — Render free plan wipes server/data/ on restart.
  // If local state came up empty, pull the last remote backup and
  // merge it back BEFORE the first client sees a wiped history.
  if (_state.trades.length === 0 && backupConfigured()) {
    _bootRestore();
  }
  return events;
}

let _bootRestoring = false;
async function _bootRestore() {
  if (_bootRestoring) return;
  _bootRestoring = true;
  try {
    const remote = await restoreBackup(FILE);
    const remoteTrades = Array.isArray(remote?.trades) ? remote.trades : [];
    if (remoteTrades.length > _state.trades.length) {
      _mergeRestoredState(remote);
      _persist();
      console.log(`[paper] boot-restore: recovered ${remoteTrades.length} trades from remote backup`);
    }
  } catch (e) {
    console.warn('[paper] boot-restore failed:', e?.message || e);
  } finally {
    _bootRestoring = false;
  }
}

// ------------------------------------------------------------
// HISTORY — full cross-day track record for the accuracy audit.
// Day-grouped closed trades + win-rate stats, so the user can see
// whether the paper-trading signal testing was actually accurate.
// ------------------------------------------------------------
export function getPaperHistory(days = 90) {
  const windowDays = Math.max(1, Math.min(365, Math.floor(days) || 90));
  const cutoff = Date.now() - windowDays * 24 * 60 * 60 * 1000;

  const closed = _state.trades
    .filter(t => t.status === 'CLOSED' && (t.closedAt || t.openedAt) >= cutoff)
    .sort((a, b) => (b.closedAt || b.openedAt) - (a.closedAt || a.openedAt));

  // Day buckets (newest first).
  const byDay = new Map();
  for (const t of closed) {
    const key = t.dayKey || istDayKey(new Date(t.openedAt || Date.now()));
    if (!byDay.has(key)) byDay.set(key, []);
    byDay.get(key).push(t);
  }

  const groups = [...byDay.entries()].map(([dayKey, list]) => {
    const wins = list.filter(t => t.realizedPnl > 0).length;
    const losses = list.filter(t => t.realizedPnl < 0).length;
    return {
      dayKey,
      trades: list.length,
      wins, losses,
      winRate: list.length ? +((wins / list.length) * 100).toFixed(1) : 0,
      realizedPnl: +list.reduce((s, t) => s + (t.realizedPnl || 0), 0).toFixed(2),
    };
  }).sort((a, b) => (a.dayKey < b.dayKey ? 1 : -1));

  const wins = closed.filter(t => t.realizedPnl > 0);
  const losses = closed.filter(t => t.realizedPnl < 0);
  const grossWin = wins.reduce((s, t) => s + t.realizedPnl, 0);
  const grossLoss = Math.abs(losses.reduce((s, t) => s + t.realizedPnl, 0));
  const totalPnl = +(grossWin - grossLoss).toFixed(2);

  let bestDay = null, worstDay = null;
  for (const g of groups) {
    if (!bestDay || g.realizedPnl > bestDay.pnl) bestDay = { dayKey: g.dayKey, pnl: g.realizedPnl };
    if (!worstDay || g.realizedPnl < worstDay.pnl) worstDay = { dayKey: g.dayKey, pnl: g.realizedPnl };
  }

  return {
    days: windowDays,
    totalClosed: closed.length,
    groups,
    overall: {
      totalTrades: closed.length,
      wins: wins.length,
      losses: losses.length,
      winRate: closed.length ? +((wins.length / closed.length) * 100).toFixed(1) : 0,
      avgWin: wins.length ? +(grossWin / wins.length).toFixed(2) : 0,
      avgLoss: losses.length ? +(-grossLoss / losses.length).toFixed(2) : 0,
      profitFactor: grossLoss > 0 ? +(grossWin / grossLoss).toFixed(2) : (grossWin > 0 ? null : 0),
      totalPnl,
      bestDay, worstDay,
    },
    // Full closed-trade list (newest first) — the client mirrors this
    // into IndexedDB so a wiped server can be auto-restored from it.
    trades: closed.map(_publicTrade),
  };
}

// ------------------------------------------------------------
// RESTORE — rebuild state after a server filesystem wipe, from the
// client's device mirror (POST /api/intraday-paper/restore) or the
// remote GitHub backup (boot path). Merge-by-id keeps any trades
// the still-running instance already knows about.
// ------------------------------------------------------------
function _num(v, fallback = 0) {
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function _sanitizeRestoredTrade(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const id = Number.isInteger(raw.id) ? raw.id : parseInt(raw.id, 10);
  if (!Number.isInteger(id) || id < 1 || id > 1e9) return null;
  const symbol = typeof raw.symbol === 'string' ? raw.symbol.trim().toUpperCase() : '';
  if (!/^[A-Z0-9&\-]{2,15}$/.test(symbol)) return null;
  const direction = raw.direction === 'SHORT' ? 'SHORT' : 'LONG';
  const market = (['INDIA', 'CRYPTO'].includes(String(raw.market || '').toUpperCase())
    ? String(raw.market).toUpperCase()
    : (isCryptoSymbolBase(symbol) ? 'CRYPTO' : 'INDIA'));
  const entry = _num(raw.entry); if (!(entry > 0)) return null;
  const qty = _normQty(_num(raw.qty), market); if (!(qty >= (market === 'CRYPTO' ? 0.0001 : 1)) || qty > 100000) return null;
  const status = ['OPEN', 'PARTIAL', 'CLOSED'].includes(raw.status) ? raw.status : 'CLOSED';
  const openedAt = _num(raw.openedAt, Date.now());
  const parts = Array.isArray(raw.parts)
    ? raw.parts.slice(0, 20).map(p => ({
        qty: _normQty(_num(p?.qty, 1), market) || (market === 'CRYPTO' ? 0.0001 : 1),
        exitPrice: +_num(p?.exitPrice, entry).toFixed(2),
        ts: _num(p?.ts, openedAt),
        reason: String(p?.reason || 'RESTORE').slice(0, 20),
      }))
    : [];
  const remainingQty = status === 'CLOSED'
    ? 0
    : Math.min(qty, _normQty(_num(raw.remainingQty, qty), market));
  const realizedPnl = +_num(raw.realizedPnl).toFixed(2);
  return {
    id, symbol, market, direction,
    entry: +entry.toFixed(2), qty,
    stopLoss: +_num(raw.stopLoss, entry).toFixed(2),
    target1: _num(raw.target1) > 0 ? +_num(raw.target1).toFixed(2) : null,
    target2: _num(raw.target2) > 0 ? +_num(raw.target2).toFixed(2) : null,
    remainingQty,
    t1Hit: !!raw.t1Hit,
    status,
    openedAt,
    closedAt: status === 'CLOSED' ? _num(raw.closedAt, openedAt) : null,
    closeReason: status === 'CLOSED' ? String(raw.closeReason || 'RESTORED').slice(0, 20) : null,
    realizedPnl,
    unrealizedPnl: status === 'CLOSED' ? 0 : +_num(raw.unrealizedPnl).toFixed(2),
    lastPrice: +_num(raw.lastPrice, entry).toFixed(2),
    parts,
    dayKey: /^\d{4}-\d{2}-\d{2}$/.test(String(raw.dayKey)) ? raw.dayKey : dayKeyFor(market, new Date(openedAt)),
    capital: +_num(raw.capital, qty * entry).toFixed(2),
  };
}

function _mergeRestoredState(remote) {
  const incoming = (Array.isArray(remote?.trades) ? remote.trades : [])
    .map(_sanitizeRestoredTrade)
    .filter(Boolean)
    .sort((a, b) => a.openedAt - b.openedAt)
    .slice(0, MAX_TRADES);

  const known = new Map(_state.trades.map(t => [t.id, t])); // server copy wins
  let restored = 0;
  for (const t of incoming) {
    if (!known.has(t.id)) { known.set(t.id, t); restored++; }
  }
  _state.trades = [...known.values()].sort((a, b) => a.openedAt - b.openedAt);
  if (_state.trades.length > MAX_TRADES) {
    _state.trades = _state.trades.slice(_state.trades.length - MAX_TRADES);
  }
  const maxId = _state.trades.reduce((m, t) => Math.max(m, t.id), 0);
  _state.nextId = Math.max(_state.nextId || 1, maxId + 1);
  return restored;
}

export function restorePaperTrades(input) {
  const incoming = Array.isArray(input?.trades) ? input.trades : [];
  if (incoming.length === 0) return { error: 'trades[] required (device mirror payload).' };
  if (incoming.length > MAX_TRADES + 100) return { error: `Too many trades (max ${MAX_TRADES}).` };

  // Nothing to do? A wiped-and-restarted server should accept, but a
  // server that already knows MORE than the mirror is the source of
  // truth — ignore stale mirrors (idempotent client retry safety).
  const knownIds = new Set(_state.trades.map(t => t.id));
  const missing = incoming.filter(t => {
    const id = Number.isInteger(t?.id) ? t.id : parseInt(t?.id, 10);
    return Number.isInteger(id) && !knownIds.has(id);
  });
  if (missing.length === 0) {
    return { ok: true, restored: 0, alreadyKnown: _state.trades.length, summary: getPaperSummary() };
  }

  const restored = _mergeRestoredState({ trades: incoming });

  // Restored trades left "open" from a PREVIOUS day are stale by the
  // same per-market rule as boot-time — square them off at last price.
  for (const t of _state.trades) {
    if (t.dayKey !== dayKeyFor(_marketOfTrade(t)) && t.status !== 'CLOSED') {
      _closePart(t, t.remainingQty, t.lastPrice || t.entry, 'STALE_SQOFF');
    }
  }
  _persist();
  return { ok: true, restored, summary: getPaperSummary() };
}

// Test-only: swap in a clean/seeded state (vitest).
export function _resetForTests(seed) {
  if (_saveTimer) { clearTimeout(_saveTimer); _saveTimer = null; }
  _state = structuredClone(seed || { trades: [], nextId: 1, dayKey: istDayKey() });
}
