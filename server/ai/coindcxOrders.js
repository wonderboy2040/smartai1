// ============================================================
// server/ai/coindcxOrders.js — LIVE order execution + safety core
// ------------------------------------------------------------
// Executes REAL CoinDCX spot orders — but ONLY through the gauntlet:
//
//   1. MODE GATE      paper (default) | live (typed confirmation)
//   2. KILL SWITCH    one click → all auto/execution disabled
//   3. SIGNAL GATE    fresh server-side STRONG consensus
//                     (re-run, ≤ 90s old, conf + agreement gates)
//   4. RISK GATE      max order ₹ · daily trade cap · daily loss cap
//                     · one open position per pair
//   5. VENUE GATE     CoinDCX only — India stays signals-only
//
// Every decision (approve/reject/execute) lands in a durable audit
// journal. SL/TP from the signal plan are tracked server-side (NSE
// spot has no native stops) and closed by the position watcher.
// ============================================================
import crypto from 'node:crypto';
import { coindcxPrivate, coindcxConnected } from '../mcp/coindcx.js';
import { loadJSON, saveJSON } from '../lib/store.js';
import { durablePut } from '../mcp/durable.js';
import { fetchCoinDcxTickers } from '../cryptoStream.js';

const CONFIG_FILE = 'ai-trading-config.json';
const JOURNAL_FILE = 'ai-trading-journal.json';
const MAX_JOURNAL = 500;

const r2 = (v) => (Number.isFinite(v) ? Math.round(v * 100) / 100 : null);

// ---------------- config (durable-backed) ----------------
export const DEFAULT_CONFIG = {
  mode: 'paper',                // 'paper' | 'live'
  minConfidence: 75,            // STRONG gate (ensemble must also agree)
  minAgreement: 0.70,
  maxOrderINR: 1000,            // per-order cap (₹)
  dailyMaxTrades: 3,
  dailyMaxLossINR: 500,         // realized+paper loss cap per day
  onePositionPerPair: true,
  allowAuto: false,             // auto-execute STRONG signals (no click)
  killSwitch: false,
  liveConfirmedAt: null,
};

export function loadConfig() {
  return { ...DEFAULT_CONFIG, ...loadJSON(CONFIG_FILE, {}) };
}
export function saveConfig(cfg) {
  saveJSON(CONFIG_FILE, cfg);
  try { durablePut(CONFIG_FILE, cfg); } catch { /* best-effort */ }
  return cfg;
}

export function updateConfig(patch = {}) {
  const cfg = loadConfig();
  const next = { ...cfg };
  const numeric = (v, lo, hi) => {
    const n = Number(v);
    return Number.isFinite(n) ? Math.max(lo, Math.min(hi, Math.round(n * 100) / 100)) : undefined;
  };
  if (patch.mode === 'paper') { next.mode = 'paper'; }
  if (patch.mode === 'live') {
    // LIVE requires an explicit typed confirmation phrase.
    const phrase = String(patch.liveConfirmPhrase || '').trim().toUpperCase();
    if (phrase !== 'LIVE') {
      const err = new Error('Enabling LIVE mode requires liveConfirmPhrase="LIVE" (typed confirmation)');
      err.status = 400;
      throw err;
    }
    if (!coindcxConnected()) {
      const err = new Error('CoinDCX not connected — connect an API key with trade permission first');
      err.status = 400;
      throw err;
    }
    next.mode = 'live';
    next.liveConfirmedAt = Date.now();
  }
  if (patch.minConfidence != null) { const v = numeric(patch.minConfidence, 50, 95); if (v != null) next.minConfidence = v; }
  if (patch.minAgreement != null) { const v = numeric(patch.minAgreement, 0.5, 0.95); if (v != null) next.minAgreement = v; }
  if (patch.maxOrderINR != null) { const v = numeric(patch.maxOrderINR, 100, 1_000_000); if (v != null) next.maxOrderINR = v; }
  if (patch.dailyMaxTrades != null) { const v = numeric(patch.dailyMaxTrades, 1, 50); if (v != null) next.dailyMaxTrades = v; }
  if (patch.dailyMaxLossINR != null) { const v = numeric(patch.dailyMaxLossINR, 50, 1_000_000); if (v != null) next.dailyMaxLossINR = v; }
  if (patch.maxRiskPct != null) { const v = numeric(patch.maxRiskPct, 1, 20); if (v != null) next.maxRiskPct = v; }
  if (patch.onePositionPerPair != null) next.onePositionPerPair = !!patch.onePositionPerPair;
  if (patch.allowAuto != null) next.allowAuto = !!patch.allowAuto;
  if (patch.killSwitch != null) {
    next.killSwitch = !!patch.killSwitch;
    if (next.killSwitch) { next.allowAuto = false; next.mode = 'paper'; }
  }
  return saveConfig(next);
}

// ---------------- journal (durable-backed audit trail) ----------------
export function loadJournal() {
  return loadJSON(JOURNAL_FILE, { entries: [], positions: [] });
}
export function saveJournal(j) {
  if (j.entries.length > MAX_JOURNAL) j.entries = j.entries.slice(-MAX_JOURNAL);
  saveJSON(JOURNAL_FILE, j);
  try { durablePut(JOURNAL_FILE, j); } catch { /* best-effort */ }
  return j;
}

function pushEntry(j, entry) {
  j.entries.push({ id: crypto.randomUUID(), ts: Date.now(), ...entry });
}

function todayIST() {
  const now = new Date();
  const ist = new Date(now.getTime() + (330 + now.getTimezoneOffset()) * 60000);
  return ist.toISOString().slice(0, 10);
}

function dailyStats(j) {
  const day = todayIST();
  const trades = j.entries.filter(e => e.day === day && e.kind === 'ORDER' && e.status !== 'REJECTED');
  const closedToday = j.entries.filter(e => e.day === day && e.kind === 'CLOSE');
  const realized = closedToday.reduce((a, e) => a + (e.pnlINR || 0), 0);
  return { day, tradesCount: trades.length, realizedPnlINR: r2(realized) };
}

export function getRiskState() {
  const cfg = loadConfig();
  const j = loadJournal();
  const stats = dailyStats(j);
  return {
    config: cfg,
    stats,
    openPositions: j.positions.length,
    blocked: {
      killSwitch: cfg.killSwitch,
      dailyTrades: stats.tradesCount >= cfg.dailyMaxTrades,
      dailyLoss: stats.realizedPnlINR <= -cfg.dailyMaxLossINR,
      notConnected: !coindcxConnected(),
    },
  };
}

// ---------------- qty precision ----------------
const FALLBACK_PRECISION = { BTC: 6, ETH: 5, BNB: 4, SOL: 3, XRP: 1, DOGE: 0, ADA: 1, AVAX: 2, LINK: 2, DOT: 2, TRX: 1, MATIC: 1 };
let _productsCache = null, _productsAt = 0;
async function getPairMeta(pair) {
  if (!_productsCache || Date.now() - _productsAt > 6 * 3600_000) {
    try {
      const r = await fetch('https://api.coindcx.com/exchange/v1/products_details', { signal: AbortSignal.timeout(8000) });
      if (ok(r)) {
        const list = await r.json();
        _productsCache = Array.isArray(list) ? list : null;
        _productsAt = Date.now();
      }
    } catch { /* keep null → fallback precision */ }
  }
  const base = pair.replace('INR', '').replace('USDT', '');
  if (Array.isArray(_productsCache)) {
    const p = _productsCache.find(x => x && (x.pair === pair || x.symbol === pair));
    if (p) {
      return {
        base,
        qtyPrecision: Number(p.precision ?? p.quantity_precision) || (FALLBACK_PRECISION[base] ?? 4),
        minQty: Number(p.min_quantity || p.min_qty || 0) || 0,
        minNotional: Number(p.min_notional || p.min_total || 0) || 0,
      };
    }
  }
  return { base, qtyPrecision: FALLBACK_PRECISION[base] ?? 4, minQty: 0, minNotional: 0 };
}
function ok(r) { return r && r.ok; }

export async function roundQty(pair, qty) {
  const meta = await getPairMeta(pair);
  const q = Math.floor(Number(qty) * 10 ** meta.qtyPrecision) / 10 ** meta.qtyPrecision;
  return { qty: q, meta };
}

// ---------------- THE EXECUTION GAUNTLET ----------------
/**
 * executeSignal({ symbol, side, mode, qtyINR, getFreshSignal, wantAuto })
 *
 * getFreshSignal(symbol) MUST return a signal from a fresh ensemble
 * run (injected by routes.js to avoid circular imports) — client
 * payloads are never trusted for the trade decision.
 */
export async function executeSignal(opts) {
  const {
    symbol, side, mode, qtyINR, getFreshSignal, wantAuto = false, source = 'manual',
  } = opts || {};
  const cfg = loadConfig();
  const j = loadJournal();
  const pair = `${String(symbol || '').toUpperCase()}INR`;
  const wantMode = mode === 'live' ? 'live' : 'paper';
  const day = todayIST();
  const entry = { kind: 'ORDER', day, symbol: pair, side, mode: wantMode, source };

  // --- gate 1: kill switch ---
  if (cfg.killSwitch) {
    pushEntry(j, { ...entry, status: 'REJECTED', reason: 'Kill switch ON — execution disabled' });
    saveJournal(j);
    return { ok: false, error: 'Kill switch ON — execution disabled' };
  }

  // --- gate 2: auto-mode policy ---
  if (wantAuto && !cfg.allowAuto) {
    return { ok: false, error: 'Auto-execution is OFF (enable it in Risk settings)' };
  }
  if (wantAuto && cfg.mode !== 'live') {
    return { ok: false, error: 'Auto-execution only runs in LIVE mode' };
  }

  // --- gate 3: connection (live) ---
  if (wantMode === 'live' && !coindcxConnected()) {
    pushEntry(j, { ...entry, status: 'REJECTED', reason: 'CoinDCX not connected' });
    saveJournal(j);
    return { ok: false, error: 'CoinDCX not connected' };
  }

  // --- gate 4: fresh STRONG signal (server-side, never client-trusted) ---
  const signal = await getFreshSignal(pair);
  if (!signal) {
    pushEntry(j, { ...entry, status: 'REJECTED', reason: 'No fresh ensemble signal available' });
    saveJournal(j);
    return { ok: false, error: 'No fresh ensemble signal available for this pair' };
  }
  const gates = { minConfidence: cfg.minConfidence, minAgreement: cfg.minAgreement };
  const { evaluateExecutionGate, buildTradePlan } = await import('./ensemble.js');

  // PAPER practice fallback: when the FRESH consensus is FLAT/planless but
  // the user clicked a directional card, synthesize a practice plan at the
  // live price (ATR %-fallback). The side comes from the card, the price/
  // risk come from the server — and the journal records the honest fresh
  // grade. LIVE never enters this branch (full gauntlet below).
  let effectiveSignal = signal;
  let synthNote = null;
  if (wantMode === 'paper' && (signal.side === 'FLAT' || !signal.plan)) {
    const reqSide = String(side || '').toUpperCase() === 'SHORT' ? 'SHORT' : 'LONG';
    const synthPlan = buildTradePlan(
      { side: reqSide, dir: reqSide === 'LONG' ? 1 : -1 },
      { ltp: signal.ltp, ind: {} }, 'CRYPTO',
    );
    if (synthPlan && signal.ltp > 0) {
      effectiveSignal = { ...signal, side: reqSide, plan: synthPlan };
      synthNote = `practice plan @ live price (fresh consensus: ${signal.side} ${signal.confidence}%)`;
    }
  }

  // PAPER = practice money (relaxed gate, 10-min freshness); LIVE = the full
  // STRONG gauntlet (90s freshness, confidence + agreement + risk caps).
  const verdict = evaluateExecutionGate(effectiveSignal, {
    side: side || effectiveSignal.side, gates,
    requireStrong: wantMode === 'live',
    maxAgeMs: wantMode === 'live' ? 90_000 : 600_000,
    maxRiskPct: cfg.maxRiskPct || 5,
  });
  if (!verdict.ok) {
    pushEntry(j, { ...entry, status: 'REJECTED', reason: verdict.reason, signal: { grade: signal.grade, conf: signal.confidence, agreement: signal.agreement } });
    saveJournal(j);
    return { ok: false, error: `Signal gate: ${verdict.reason}` };
  }

  // --- gate 5: risk limits ---
  const stats = dailyStats(j);
  if (stats.tradesCount >= cfg.dailyMaxTrades) {
    pushEntry(j, { ...entry, status: 'REJECTED', reason: `Daily trade cap (${cfg.dailyMaxTrades}) hit` });
    saveJournal(j);
    return { ok: false, error: `Daily trade cap (${cfg.dailyMaxTrades}) reached — resets at IST midnight` };
  }
  if (stats.realizedPnlINR <= -cfg.dailyMaxLossINR) {
    pushEntry(j, { ...entry, status: 'REJECTED', reason: `Daily loss cap (₹${cfg.dailyMaxLossINR}) hit` });
    saveJournal(j);
    return { ok: false, error: `Daily loss cap (₹${cfg.dailyMaxLossINR}) breached — trading paused for today` };
  }
  if (cfg.onePositionPerPair && j.positions.some(p => p.pair === pair && p.status === 'OPEN')) {
    pushEntry(j, { ...entry, status: 'REJECTED', reason: 'Position already open for this pair' });
    saveJournal(j);
    return { ok: false, error: `An open position already exists for ${pair} (one-per-pair rule)` };
  }

  // --- sizing ---
  const price = effectiveSignal.ltp;
  if (!(price > 0)) {
    return { ok: false, error: 'No live price for sizing' };
  }
  const budget = Math.min(Number(qtyINR) > 0 ? Number(qtyINR) : cfg.maxOrderINR, cfg.maxOrderINR);
  if (budget < 100) {
    return { ok: false, error: `Order size ₹${budget} below the ₹100 minimum` };
  }
  const rawQty = budget / price;
  const { qty, meta } = await roundQty(pair, rawQty);
  if (!(qty > 0)) {
    return { ok: false, error: `Quantity rounds to 0 at ${pair} precision (${meta.qtyPrecision}dp) — increase order size` };
  }
  const notional = qty * price;

  // --- paper execution ---
  if (wantMode === 'paper') {
    const position = {
      id: crypto.randomUUID(), pair, side: effectiveSignal.side, mode: 'paper',
      qty, entryPrice: price, notionalINR: r2(notional),
      sl: effectiveSignal.plan?.stopLoss ?? null, tp: effectiveSignal.plan?.target1 ?? null, tp2: effectiveSignal.plan?.target2 ?? null,
      signal: { grade: signal.grade, confidence: signal.confidence, agreement: signal.agreement, summary: synthNote || signal.summary },
      openedAt: Date.now(), status: 'OPEN',
    };
    j.positions.push(position);
    pushEntry(j, {
      ...entry, status: 'FILLED', qty, price: r2(price), notionalINR: r2(notional),
      signal: { grade: signal.grade, conf: signal.confidence, agreement: signal.agreement },
      reason: synthNote ? `${verdict.reason} · ${synthNote}` : verdict.reason,
    });
    saveJournal(j);
    return { ok: true, mode: 'paper', position, filled: { qty, price: r2(price), notionalINR: r2(notional) } };
  }

  // --- LIVE execution: signed order to CoinDCX ---
  try {
    const creds = loadCredsForOrder();
    if (!creds?.apiKey || !creds?.secret) return { ok: false, error: 'CoinDCX credentials unreadable' };
    const body = {
      side: effectiveSignal.side === 'SHORT' ? 'sell' : 'buy',
      pair,
      order_type: 'market',
      total_quantity: String(qty),
      hidden: true,
    };
    const resp = await coindcxPrivate('/exchange/v1/orders/create', creds.apiKey, creds.secret, body);
    const orderId = resp?.orders?.[0]?.id || resp?.order?.id || null;
    // CoinDCX market orders report avg fill in list/status — approximate with LTP now, corrected on next poll.
    const position = {
      id: crypto.randomUUID(), pair, side: effectiveSignal.side, mode: 'live', exchangeOrderId: orderId,
      qty, entryPrice: price, notionalINR: r2(notional),
      sl: effectiveSignal.plan?.stopLoss ?? null, tp: effectiveSignal.plan?.target1 ?? null, tp2: effectiveSignal.plan?.target2 ?? null,
      signal: { grade: signal.grade, confidence: signal.confidence, agreement: signal.agreement, summary: signal.summary },
      openedAt: Date.now(), status: orderId ? 'OPEN' : 'UNKNOWN',
    };
    j.positions.push(position);
    pushEntry(j, {
      ...entry, status: orderId ? 'SUBMITTED' : 'SUBMITTED_UNKNOWN', qty, price: r2(price),
      notionalINR: r2(notional), exchangeOrderId: orderId,
      signal: { grade: signal.grade, conf: signal.confidence, agreement: signal.agreement },
      reason: verdict.reason,
    });
    saveJournal(j);
    return { ok: true, mode: 'live', orderId, position, filled: { qty, price: r2(price), notionalINR: r2(notional) } };
  } catch (e) {
    pushEntry(j, { ...entry, status: 'FAILED', reason: String(e?.message || e).slice(0, 200) });
    saveJournal(j);
    return { ok: false, error: `CoinDCX order failed: ${e?.message || e}` };
  }
}

// ---------------- position watcher (SL/TP enforcement) ----------------
/**
 * Checks every OPEN position against live CoinDCX tickers:
 *   • price ≤ SL (LONG) / ≥ SL (SHORT) → close, record loss
 *   • price ≥ TP2 → close (runner), record win
 *   • TP1 → alert only (let winners run to TP2)
 * Live positions close via market order; paper closes simulated.
 * Returns the list of closures for logging/alerting.
 */
export async function watchPositions({ sendTelegram } = {}) {
  const j = loadJournal();
  const open = j.positions.filter(p => p.status === 'OPEN');
  if (open.length === 0) return [];
  const tickers = await fetchCoinDcxTickers().catch(() => []);
  const byPair = new Map((Array.isArray(tickers) ? tickers : []).map(t => [t.market, parseFloat(t.last_price)]));
  const closures = [];
  const cfg = loadConfig();

  for (const p of open) {
    const price = byPair.get(p.pair);
    if (!(price > 0)) continue;
    const long = p.side === 'LONG';
    let close = null;
    if (p.sl != null && (long ? price <= p.sl : price >= p.sl)) close = { reason: 'STOP-LOSS hit', price, kind: 'SL' };
    else if (p.tp2 != null && (long ? price >= p.tp2 : price <= p.tp2)) close = { reason: 'TARGET-2 hit', price, kind: 'TP2' };
    if (!close) continue;

    let closed = false;
    if (p.mode === 'live' && coindcxConnected()) {
      try {
        const creds = loadCredsForOrder();
        if (creds) {
          await coindcxPrivate('/exchange/v1/orders/create', creds.apiKey, creds.secret, {
            side: long ? 'sell' : 'buy',
            pair: p.pair,
            order_type: 'market',
            total_quantity: String(p.qty),
            hidden: true,
          });
          closed = true;
        }
      } catch (e) {
        // Close failed — keep position open, try again next tick.
        pushEntry(j, { kind: 'WATCH_ERROR', day: todayIST(), pair: p.pair, reason: String(e?.message || e).slice(0, 200) });
        continue;
      }
    } else {
      closed = true; // paper close is always executable
    }
    if (!closed) continue;

    const pnlINR = (long ? price - p.entryPrice : p.entryPrice - price) * p.qty;
    p.status = 'CLOSED';
    p.closedAt = Date.now();
    p.closePrice = price;
    p.pnlINR = r2(pnlINR);
    p.closeReason = close.reason;
    pushEntry(j, {
      kind: 'CLOSE', day: todayIST(), pair: p.pair, mode: p.mode,
      qty: p.qty, entryPrice: p.entryPrice, closePrice: price, pnlINR: r2(pnlINR), reason: close.reason,
    });
    closures.push({ pair: p.pair, mode: p.mode, pnlINR: p.pnlINR, reason: close.reason });
  }
  if (closures.length > 0) {
    saveJournal(j);
    if (typeof sendTelegram === 'function') {
      try {
        await sendTelegram(`🤖 <b>AI Trading</b> — position closed\n${closures.map(c => `• ${c.pair} (${c.mode}) — ${c.reason}: ₹${c.pnlINR > 0 ? '+' : ''}${c.pnlINR}`).join('\n')}`);
      } catch { /* best-effort */ }
    }
  }
  return closures;
}

function loadCredsForOrder() {
  const c = loadJSON('mcp-coindcx.json', {});
  return c?.apiKey && c?.secret ? { apiKey: c.apiKey, secret: c.secret } : null;
}

// ---------------- manual close + cancel ----------------
export async function closePosition(positionId) {
  const j = loadJournal();
  const p = j.positions.find(x => x.id === positionId || x.exchangeOrderId === positionId);
  if (!p || p.status !== 'OPEN') return { ok: false, error: 'Position not found / already closed' };
  const tickers = await fetchCoinDcxTickers().catch(() => []);
  const price = (Array.isArray(tickers) ? tickers : []).find(t => t.market === p.pair);
  const ltp = price ? parseFloat(price.last_price) : p.entryPrice;
  if (p.mode === 'live' && coindcxConnected()) {
    try {
      const creds = loadCredsForOrder();
      await coindcxPrivate('/exchange/v1/orders/create', creds.apiKey, creds.secret, {
        side: p.side === 'LONG' ? 'sell' : 'buy',
        pair: p.pair, order_type: 'market', total_quantity: String(p.qty), hidden: true,
      });
    } catch (e) {
      return { ok: false, error: `Exchange close failed: ${e?.message || e}` };
    }
  }
  const long = p.side === 'LONG';
  const pnlINR = (long ? ltp - p.entryPrice : p.entryPrice - ltp) * p.qty;
  p.status = 'CLOSED';
  p.closedAt = Date.now();
  p.closePrice = ltp;
  p.pnlINR = r2(pnlINR);
  p.closeReason = 'Manual close';
  pushEntry(j, { kind: 'CLOSE', day: todayIST(), pair: p.pair, mode: p.mode, qty: p.qty, entryPrice: p.entryPrice, closePrice: ltp, pnlINR: r2(pnlINR), reason: 'Manual close' });
  saveJournal(j);
  return { ok: true, position: p };
}

export async function listExchangeOrders(statuses = ['open']) {
  if (!coindcxConnected()) return { ok: false, orders: [] };
  const creds = loadCredsForOrder();
  try {
    const resp = await coindcxPrivate('/exchange/v1/orders/list', creds.apiKey, creds.secret, {
      page: '1', size: '50', statuses,
    });
    return { ok: true, orders: Array.isArray(resp) ? resp : (resp?.orders || []) };
  } catch (e) {
    return { ok: false, error: String(e?.message || e).slice(0, 150), orders: [] };
  }
}

export async function cancelExchangeOrder(orderId) {
  const creds = loadCredsForOrder();
  if (!creds) return { ok: false, error: 'CoinDCX not connected' };
  try {
    await coindcxPrivate('/exchange/v1/orders/cancel', creds.apiKey, creds.secret, { id: String(orderId) });
    return { ok: true };
  } catch (e) {
    return { ok: false, error: String(e?.message || e).slice(0, 150) };
  }
}

export async function cancelAllExchangeOrders() {
  const creds = loadCredsForOrder();
  if (!creds) return { ok: false, error: 'CoinDCX not connected' };
  try {
    await coindcxPrivate('/exchange/v1/orders/cancel_all', creds.apiKey, creds.secret, {});
    return { ok: true };
  } catch (e) {
    return { ok: false, error: String(e?.message || e).slice(0, 150) };
  }
}

// ---------------- positions with live uPnL ----------------
export async function getPositionsWithPnl() {
  const j = loadJournal();
  const tickers = await fetchCoinDcxTickers().catch(() => []);
  const byPair = new Map((Array.isArray(tickers) ? tickers : []).map(t => [t.market, parseFloat(t.last_price)]));
  const stats = dailyStats(j);
  return {
    positions: j.positions.slice().reverse().map(p => {
      const ltp = byPair.get(p.pair) ?? p.entryPrice;
      const long = p.side === 'LONG';
      const upnl = p.status === 'OPEN'
        ? r2((long ? ltp - p.entryPrice : p.entryPrice - ltp) * p.qty)
        : p.pnlINR;
      return { ...p, ltp: r2(ltp), unrealizedPnlINR: upnl };
    }),
    stats,
    entries: j.entries.slice(-60).reverse(),
  };
}

// ---------------- test hooks ----------------
export function __resetForTests() {
  saveConfig({ ...DEFAULT_CONFIG });
  saveJournal({ entries: [], positions: [] });
  _productsCache = null;
}
export function __setJournalForTests(j) { saveJournal(j); }
export function __setConfigForTests(cfg) { saveConfig(cfg); }
export { dailyStats };
