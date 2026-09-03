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

// ---------------- journal lock (serialize ALL writers) ----------------
// Every journal mutation path (executeSignal / watchPositions /
// closePosition) does load → await network → mutate → save. Node is
// single-threaded but the awaits yield to concurrent writers: two
// overlapping writers hold independent deep copies and the LAST save
// silently reverts the other (double market-sells of the same position,
// lost closures, live orders with no journal record). All mutating
// sections run through this promise queue; anything read BEFORE taking
// the lock must be re-loaded inside it.
let _journalChain = Promise.resolve();
export function withJournalLock(fn) {
  const run = _journalChain.then(fn);
  _journalChain = run.then(() => {}, () => {}); // chain never rejects
  return run;
}

function pushEntry(j, entry) {
  j.entries.push({ id: crypto.randomUUID(), ts: Date.now(), ...entry });
}

function todayIST() {
  // Daily caps reset at IST midnight REGARDLESS of the server's TZ
  // (Render is UTC, but docker/self-host deployments may not be — the
  // offset-arithmetic trick double-corrects on non-UTC servers).
  try { return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date()); }
  catch { return new Date().toISOString().slice(0, 10); }
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
  const pair = `${String(symbol || '').toUpperCase()}INR`;
  const wantMode = mode === 'live' ? 'live' : 'paper';
  const day = todayIST();
  const entry = { kind: 'ORDER', day, symbol: pair, side, mode: wantMode, source };

  // Rejections are journal writes too — run them under the lock so they
  // can never clobber a concurrent watcher/manual-close save.
  const reject = (reason, error, extra = {}) => withJournalLock(() => {
    const j = loadJournal();
    pushEntry(j, { ...entry, status: 'REJECTED', reason, ...extra });
    saveJournal(j);
  }).then(() => ({ ok: false, error: error || reason }));

  // --- gate 1: kill switch ---
  if (cfg.killSwitch) {
    return reject('Kill switch ON — execution disabled');
  }

  // --- gate 2: auto-mode policy ---
  if (wantAuto && !cfg.allowAuto) {
    return { ok: false, error: 'Auto-execution is OFF (enable it in Risk settings)' };
  }
  if (wantAuto && cfg.mode !== 'live') {
    return { ok: false, error: 'Auto-execution only runs in LIVE mode' };
  }

  // --- gate 3: MODE gate (live) ---
  // A LIVE order additionally requires the account to be ARMED for live
  // (typed "LIVE" confirmation in Risk settings). The request body's
  // mode field alone must NEVER be enough to move real money — the UI
  // toggle is not an enforcement layer.
  if (wantMode === 'live' && cfg.mode !== 'live') {
    return reject('LIVE mode is not enabled — type LIVE in Risk settings first');
  }

  // --- gate 4: connection (live) ---
  if (wantMode === 'live' && !coindcxConnected()) {
    return reject('CoinDCX not connected');
  }

  // --- gate 5: fresh STRONG signal (server-side, never client-trusted) ---
  const signal = await getFreshSignal(pair);
  if (!signal) {
    return reject('No fresh ensemble signal available for this pair');
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
    return reject(verdict.reason, `Signal gate: ${verdict.reason}`, {
      signal: { grade: signal.grade, conf: signal.confidence, agreement: signal.agreement },
    });
  }

  // --- sizing (exchange minimums included when products metadata is
  // reachable — rejecting locally is a clean REJECT instead of a FAILED
  // live round-trip that burns a daily-cap slot) ---
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
  if (meta.minQty > 0 && qty < meta.minQty) {
    return { ok: false, error: `Quantity ${qty} is below the exchange minimum (${meta.minQty}) for ${pair}` };
  }
  if (meta.minNotional > 0 && notional < meta.minNotional) {
    return { ok: false, error: `Order ₹${Math.round(notional)} is below the exchange minimum (₹${meta.minNotional}) for ${pair}` };
  }

  // --- FINAL MUTATION — under the journal lock with a FRESH copy ---
  // The caps + one-per-pair checks live HERE (not before the signal run,
  // which can take seconds) so a fill that lands while another writer
  // mutated the journal can never stack onto a breached day/pair state.
  // The LIVE order send is also inside the lock: a concurrent manual
  // close of the same pair cannot interleave with the send.
  return withJournalLock(async () => {
    const j = loadJournal(); // fresh copy under the lock
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

    // --- paper execution ---
    if (wantMode === 'paper') {
      const position = {
        id: crypto.randomUUID(), pair, side: effectiveSignal.side, mode: 'paper', source,
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
      // CoinDCX market orders report avg fill in list/status — entry price
      // starts at the signal LTP and the watcher reconciles UNKNOWN/
      // fill data on its next pass (see reconcileLivePosition).
      const position = {
        id: crypto.randomUUID(), pair, side: effectiveSignal.side, mode: 'live', source, exchangeOrderId: orderId,
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
  });
}

// ---------------- live-fill reconciliation ----------------
/**
 * Resolves a live position whose create response carried no orderId/
 * fill data (status UNKNOWN) by asking the exchange what happened to the
 * order. Best-effort — any parse/network failure returns null and the
 * watcher retries on its next pass. Defensive about CoinDCX's response
 * shapes (object | array | {orders:[...]}, average_price | avg_price,
 * filled_quantity | quantity).
 */
function mapOrderToPositionState(o) {
  const st = String(o?.status || '').toLowerCase();
  const avg = Number(o?.average_price ?? o?.avg_price ?? o?.averagePrice ?? NaN);
  const filled = Number(o?.filled_quantity ?? o?.filledQuantity ?? o?.quantity ?? NaN);
  const dead = ['cancelled', 'canceled', 'rejected', 'expired'];
  const alive = ['open', 'partially', 'filled', 'complete', 'init', 'active'];
  return {
    status: dead.some(d => st.includes(d)) ? 'CANCELLED'
      : alive.some(l => st.includes(l)) ? 'OPEN' : 'UNKNOWN',
    entryPrice: Number.isFinite(avg) && avg > 0 ? avg : null,
    qty: Number.isFinite(filled) && filled > 0 ? filled : null,
    raw: st || 'unknown',
  };
}

async function reconcileLivePosition(p) {
  const creds = loadCredsForOrder();
  if (!creds || !p?.exchangeOrderId) return null;
  const id = String(p.exchangeOrderId);
  const find = (resp) => {
    if (Array.isArray(resp)) return resp.find(o => String(o?.id) === id) || null;
    if (Array.isArray(resp?.orders)) return resp.orders.find(o => String(o?.id) === id) || null;
    return resp && String(resp.id) === id ? resp : null;
  };
  try {
    const resp = await coindcxPrivate('/exchange/v1/orders/status', creds.apiKey, creds.secret, { id });
    const order = find(resp);
    if (order) return mapOrderToPositionState(order);
  } catch { /* fall through to the list endpoint */ }
  try {
    const resp = await coindcxPrivate('/exchange/v1/orders/list', creds.apiKey, creds.secret, {
      page: '1', size: '50', statuses: ['open', 'partially_filled', 'filled', 'complete', 'cancelled', 'rejected'],
    });
    const order = find(resp);
    if (order) return mapOrderToPositionState(order);
  } catch { /* give up this pass — retry on the next tick */ }
  return null;
}

// ---------------- position watcher (SL/TP enforcement) ----------------
/**
 * Runs under the journal lock. First reconciles UNKNOWN live positions
 * (so real exchange fills get SL/TP enforcement and true entry prices),
 * then checks every OPEN position against live CoinDCX tickers:
 *   • price ≤ SL (LONG) / ≥ SL (SHORT) → close, record loss
 *   • price ≥ TP2 → close (runner), record win
 *   • TP1 → alert only (let winners run to TP2)
 * Live positions close via market order; paper closes simulated.
 * Watch errors are PERSISTED (a failing stop-loss must never be
 * indistinguishable from a healthy position) and alerted on Telegram.
 * Returns the list of closures for logging/alerting.
 */
export async function watchPositions({ sendTelegram } = {}) {
  return withJournalLock(async () => {
    const j = loadJournal();
    const closures = [];
    const watchErrors = [];
    let dirty = false;
    const cfg = loadConfig();

    // --- reconcile UNKNOWN live positions ---
    for (const p of j.positions) {
      if (p.status !== 'UNKNOWN' || p.mode !== 'live' || !p.exchangeOrderId) continue;
      if (cfg.killSwitch) break; // no exchange calls while killed
      const rec = await reconcileLivePosition(p).catch(() => null);
      if (!rec) continue;
      if (rec.status === 'OPEN') {
        if (rec.entryPrice != null && rec.entryPrice !== p.entryPrice) p.entryPrice = rec.entryPrice;
        if (rec.qty != null && rec.qty !== p.qty) p.qty = rec.qty;
        p.status = 'OPEN';
        p.reconciledAt = Date.now();
        dirty = true;
        pushEntry(j, {
          kind: 'WATCH_ERROR', day: todayIST(), pair: p.pair,
          reason: `Order ${p.exchangeOrderId} reconciled: ${rec.raw} @ ${rec.entryPrice ?? p.entryPrice} — position now tracked`,
        });
      } else if (rec.status === 'CANCELLED') {
        p.status = 'CANCELLED';
        p.closedAt = Date.now();
        p.closeReason = `Exchange reports order ${rec.raw}`;
        dirty = true;
        pushEntry(j, {
          kind: 'WATCH_ERROR', day: todayIST(), pair: p.pair,
          reason: `Order ${p.exchangeOrderId} ${rec.raw} — live position reconciled to CANCELLED (no coins moved)`,
        });
        watchErrors.push({ pair: p.pair, reason: `order ${rec.raw}` });
      }
      // rec.status UNKNOWN → keep trying next pass
    }

    const open = j.positions.filter(p => p.status === 'OPEN');
    if (open.length > 0) {
      const tickers = await fetchCoinDcxTickers().catch(() => []);
      const byPair = new Map((Array.isArray(tickers) ? tickers : []).map(t => [t.market, parseFloat(t.last_price)]));

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
            // Persist the failure: a dead stop-loss must never look healthy.
            pushEntry(j, { kind: 'WATCH_ERROR', day: todayIST(), pair: p.pair, reason: String(e?.message || e).slice(0, 200) });
            dirty = true;
            watchErrors.push({ pair: p.pair, reason: String(e?.message || e).slice(0, 120) });
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
        dirty = true;
        pushEntry(j, {
          kind: 'CLOSE', day: todayIST(), pair: p.pair, mode: p.mode,
          qty: p.qty, entryPrice: p.entryPrice, closePrice: price, pnlINR: r2(pnlINR), reason: close.reason,
        });
        closures.push({ pair: p.pair, mode: p.mode, pnlINR: p.pnlINR, reason: close.reason });
      }
    }

    if (dirty) saveJournal(j); // WATCH_ERROR entries + reconciliations persist too
    if (typeof sendTelegram === 'function') {
      if (closures.length > 0) {
        try {
          await sendTelegram(`🤖 <b>AI Trading</b> — position closed\n${closures.map(c => `• ${c.pair} (${c.mode}) — ${c.reason}: ₹${c.pnlINR > 0 ? '+' : ''}${c.pnlINR}`).join('\n')}`);
        } catch { /* best-effort */ }
      }
      if (watchErrors.length > 0) {
        try {
          await sendTelegram(`🤖 ⚠️ <b>AI Trading</b> — close/reconcile FAILED (will retry in 60s)\n${watchErrors.map(c => `• ${c.pair} — ${c.reason}`).join('\n')}\nCheck CoinDCX keys/balance — SL/TP cannot execute while this fails.`);
        } catch { /* best-effort */ }
      }
    }
    return closures;
  });
}

function loadCredsForOrder() {
  const c = loadJSON('mcp-coindcx.json', {});
  return c?.apiKey && c?.secret ? { apiKey: c.apiKey, secret: c.secret } : null;
}

// ---------------- manual close + cancel ----------------
export async function closePosition(positionId) {
  // Under the journal lock: a watcher pass closing the same position at
  // the same moment must not double-sell it (both writers re-load the
  // journal inside the lock; the loser sees status CLOSED and no-ops).
  return withJournalLock(async () => {
    const j = loadJournal();
    const p = j.positions.find(x => x.id === positionId || x.exchangeOrderId === positionId);
    if (!p || (p.status !== 'OPEN' && p.status !== 'UNKNOWN')) return { ok: false, error: 'Position not found / already closed' };
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
  });
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
