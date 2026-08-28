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
import { istDayKey, istMinutes } from './time.js';
import { recordTradeClose } from './journal.js';

const FILE = 'paper-trades.json';
const MAX_TRADES = 500;
const PAPER_SQOFF_MIN = 15 * 60 + 10; // 15:10 IST hard square-off

let _state = loadJSON(FILE, { trades: [], nextId: 1, dayKey: '' });
let _saveTimer = null;

function _persist() {
  if (_saveTimer) return;
  _saveTimer = setTimeout(() => {
    _saveTimer = null;
    saveJSON(FILE, _state);
  }, 1000);
  if (typeof _saveTimer.unref === 'function') _saveTimer.unref();
}

function _validateSym(sym) {
  return typeof sym === 'string' && /^[A-Z0-9&\-]{2,15}$/.test(sym.trim().toUpperCase());
}

export function openPaperTrade(input) {
  const {
    symbol, direction, entry, qty,
    stopLoss, target1, target2,
  } = input || {};

  if (!_validateSym(symbol)) return { error: 'Invalid symbol format.' };
  const sym = symbol.trim().toUpperCase();
  const dir = direction === 'SHORT' ? 'SHORT' : 'LONG';
  const n = (v) => (typeof v === 'number' && isFinite(v) && v > 0) ? v : null;
  const e = n(entry), q = Math.floor(n(qty) || 0), sl = n(stopLoss);
  const t1 = n(target1), t2 = n(target2);
  if (!e) return { error: 'Valid entry price required.' };
  if (!q || q < 1 || q > 100000) return { error: 'Qty must be 1..100000.' };
  if (!sl) return { error: 'Valid stop-loss required.' };
  // Level sanity — direction-consistent ordering.
  if (dir === 'LONG' && (sl >= e || (t1 && t1 <= e) || (t2 && t2 <= e))) {
    return { error: 'LONG levels must satisfy SL < entry < T1 < T2.' };
  }
  if (dir === 'SHORT' && (sl <= e || (t1 && t1 >= e) || (t2 && t2 >= e))) {
    return { error: 'SHORT levels must satisfy SL > entry > T1 > T2.' };
  }
  // Risk guard: max 1 lakh shares / trade and max 10 concurrent open trades.
  const today = istDayKey();
  if (_state.dayKey !== today) _state.dayKey = today;
  const openNow = _state.trades.filter(t => t.status === 'OPEN' || t.status === 'PARTIAL');
  if (openNow.length >= 10) return { error: 'Max 10 open paper trades.' };
  if (openNow.some(t => t.symbol === sym && t.direction === dir)) {
    return { error: `Paper trade already open for ${sym} ${dir}.` };
  }

  const trade = {
    id: _state.nextId++,
    symbol: sym, direction: dir,
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
  const afterSqOff = m >= PAPER_SQOFF_MIN;
  let changed = false;

  for (const t of _state.trades) {
    if (t.status === 'CLOSED') continue;
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
        _closePart(t, Math.ceil(t.qty / 2), t.target1, 'T1_BOOK');
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
    id: t.id, symbol: t.symbol, direction: t.direction,
    entry: t.entry, qty: t.qty, remainingQty: t.remainingQty,
    stopLoss: t.stopLoss, target1: t.target1, target2: t.target2,
    status: t.status, t1Hit: t.t1Hit,
    openedAt: t.openedAt, closedAt: t.closedAt, closeReason: t.closeReason,
    lastPrice: t.lastPrice, realizedPnl: +(+t.realizedPnl).toFixed(2),
    unrealizedPnl: +(+t.unrealizedPnl).toFixed(2),
    parts: t.parts, capital: t.capital,
  };
}

// Boot-time cleanup: anything left open from a previous day gets
// squared off at its last known price (market was closed meanwhile).
export function initPaperTrading() {
  const today = istDayKey();
  const events = [];
  for (const t of _state.trades) {
    if (t.dayKey !== today && t.status !== 'CLOSED') {
      _closePart(t, t.remainingQty, t.lastPrice || t.entry, 'STALE_SQOFF');
      events.push({ type: 'PAPER_CLOSE', symbol: t.symbol, direction: t.direction, price: t.lastPrice || t.entry, pnl: t.realizedPnl, note: 'Stale paper trade squared off on restart' });
    }
  }
  _persist();
  return events;
}
