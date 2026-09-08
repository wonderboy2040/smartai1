// ============================================================
// server/ai/futures.js — CoinDCX GLOBAL FUTURES desk (v6.8)
// ------------------------------------------------------------
// CoinDCX's GLOBAL futures are USDT-margined perpetuals with
// instrument names like "B-BTC_USDT". This module owns EVERYTHING
// futures — data, wallets, execution gauntlet, position watching —
// so the spot path (coindcxOrders.js) stays untouched:
//
//  PUBLIC (no auth):
//   • fetchFuturesPrices()      RT prices (ls/mark/pc) — 20s cache
//   • fetchFuturesActiveInstruments() — ["B-BTC_USDT", …] — 6h cache
//   • fetchFuturesInstrumentMeta(pair) — max leverage / qty rules — 6h cache
//   • fetchFuturesCandles(pair)  candlesticks?…&pcode=f — TA source
//
//  PRIVATE (HMAC-signed, same coindcxPrivate transport):
//   • fetchFuturesWallets()     DF wallet balances (USDT margin)
//   • listFuturesPositions()    active_pos / avg_price / liquidation
//   • createFuturesOrder()      market/limit order (nested `order` body)
//   • exitFuturesPosition(id)   market exit by position id
//   • createFuturesTpsl()       NATIVE exchange TP/SL (survives server death)
//
//  EXECUTION:
//   • executeFuturesSignal()    the SAME gauntlet as spot: kill switch
//                               → auto policy → LIVE arming → fresh STRONG
//                               signal (venue FUTURES) → leverage sanity →
//                               wallet-margin sizing → journal caps
//   • watchFuturesPositions()   SL/TP/trailing/liquidation + exchange
//                               reconcile (native TP/SL closes detected)
//   • closeFuturesPosition()    manual close (market)
//
// Currency honesty: futures prices/margins are USDT; the shared journal
// and daily risk caps stay INR — every USDT amount carries its INR
// twin converted at the live USDINR rate (10-min cache, fallback 84).
// ============================================================
import crypto from 'node:crypto';
import { coindcxPrivate, coindcxConnected } from '../mcp/coindcx.js';
import { loadJSON, saveJSON } from '../lib/store.js';
import { durablePut } from '../mcp/durable.js';
import { recordExecution, settlePositionOutcome } from './ledger.js';
import { computeTrailSl, maxSaneLeverage, fitPlanToRiskCap, evaluateExecutionGate } from './ensemble.js';
import { withJournalLock, pushEntry, todayIST, dailyStats } from './coindcxOrders.js';

const r2 = (v) => (Number.isFinite(v) ? Math.round(v * 100) / 100 : null);
const num = (v) => { const n = typeof v === 'number' ? v : parseFloat(String(v ?? '')); return Number.isFinite(n) ? n : null; };
const ok = (r) => r && r.ok;

// ---------------- constants ----------------
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Safari/537.36';
const PRICES_URL = 'https://public.coindcx.com/market_data/v3/current_prices/futures/rt';
const CANDLES_URL = 'https://public.coindcx.com/market_data/candlesticks';
const INSTRUMENTS_URL = 'https://api.coindcx.com/exchange/v1/derivatives/futures/data/active_instruments';
const INSTRUMENT_URL = 'https://api.coindcx.com/exchange/v1/derivatives/futures/data/instrument';
const ORDERS_CREATE_PATH = '/exchange/v1/derivatives/futures/orders/create';
const POSITIONS_PATH = '/exchange/v1/derivatives/futures/positions';
const POSITIONS_EXIT_PATH = '/exchange/v1/derivatives/futures/positions/exit';
const POSITIONS_TPSL_PATH = '/exchange/v1/derivatives/futures/positions/create_tpsl';
const WALLETS_PATH = '/exchange/v1/derivatives/futures/wallets';

/** The futures universe we scan — liquid USDT perps matching the spot
 *  crypto universe (plus a couple of perp-only staples). */
export const FUTURES_UNIVERSE = [
  'BTC', 'ETH', 'BNB', 'SOL', 'XRP', 'DOGE', 'ADA', 'AVAX', 'LINK', 'DOT', 'TRX', 'MATIC',
];

export function futuresPairFor(base) {
  return `B-${String(base || '').toUpperCase()}_USDT`;
}
export function baseOfFuturesPair(pair) {
  const m = String(pair || '').match(/^B-([A-Z0-9]+)_USDT$/i);
  return m ? m[1].toUpperCase() : String(pair || '').toUpperCase();
}

// ---------------- USDINR (shared conversion, cached) ----------------
let _usdInr = null, _usdInrAt = 0;
export async function fetchUsdInr() {
  if (_usdInr && Date.now() - _usdInrAt < 10 * 60_000) return _usdInr;
  try {
    const { fetchYahooQuotes } = await import('./data.js');
    const q = await fetchYahooQuotes(['USDINR']);
    const v = num(q?.USDINR?.price);
    if (v > 40 && v < 150) { _usdInr = v; _usdInrAt = Date.now(); return v; }
  } catch { /* fall back to the static estimate */ }
  return _usdInr || 84;
}
const inrOfUsdt = (usdt, usdInr) => (Number.isFinite(usdt) ? Math.round(usdt * usdInr * 100) / 100 : null);

// ---------------- PUBLIC: RT prices ----------------
let _pricesCache = null, _pricesAt = 0;
/**
 * Live futures prices. Returns [{ pair, base, last, mark, changePct,
 * high, low, volume }] — one row per active USDT perp. 20s cache (the
 * SSE crypto stream pattern: one shared round-trip, nobody hits the
 * upstream per-request).
 */
export async function fetchFuturesPrices({ maxAgeMs = 20_000 } = {}) {
  if (_pricesCache && Date.now() - _pricesAt < maxAgeMs) return _pricesCache;
  const r = await fetch(PRICES_URL, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(8000) });
  if (!ok(r)) throw new Error(`futures prices HTTP ${r?.status}`);
  const j = await r.json();
  const map = j?.prices && typeof j.prices === 'object' ? j.prices : null;
  if (!map) throw new Error('futures prices: unexpected payload');
  const rows = [];
  for (const [pair, p] of Object.entries(map)) {
    if (!p || typeof p !== 'object') continue;
    const last = num(p.ls);
    if (!(last > 0)) continue; // dark/illiquid rows carry ls=0
    rows.push({
      pair: String(pair),
      base: baseOfFuturesPair(pair),
      last,
      mark: num(p.mp) || last,
      changePct: num(p.pc),
      high: num(p.h),
      low: num(p.l),
      volume: num(p.v),
      ts: num(j?.ts) || Date.now(),
    });
  }
  if (rows.length === 0) throw new Error('futures prices: empty');
  _pricesCache = rows; _pricesAt = Date.now();
  return rows;
}
export async function fetchFuturesLtpMap() {
  const rows = await fetchFuturesPrices().catch(() => []);
  return new Map((Array.isArray(rows) ? rows : []).map(x => [x.pair, x.last]));
}

// ---------------- PUBLIC: instruments ----------------
let _instrumentsCache = null, _instrumentsAt = 0;
export async function fetchFuturesActiveInstruments() {
  if (_instrumentsCache && Date.now() - _instrumentsAt > 0 && Date.now() - _instrumentsAt < 6 * 3600_000) return _instrumentsCache;
  const url = `${INSTRUMENTS_URL}?margin_currency_short_name[]=USDT`;
  const r = await fetch(url, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(8000) });
  if (!ok(r)) throw new Error(`futures instruments HTTP ${r?.status}`);
  const list = await r.json();
  if (!Array.isArray(list) || list.length === 0) throw new Error('futures instruments: empty');
  _instrumentsCache = list.map(String); _instrumentsAt = Date.now();
  return _instrumentsCache;
}

let _instrumentMetaCache = new Map();
/** Instrument rules for one pair (max leverage, qty precision, minimums).
 *  The endpoint shape is documented with max_leverage_long/short; qty
 *  precision/min-quantity keys vary by API revision — every plausible
 *  key is tried (the CoinDCX field-name lesson, learned twice). */
export async function fetchFuturesInstrumentMeta(pair) {
  const key = String(pair).toUpperCase();
  const hit = _instrumentMetaCache.get(key);
  if (hit && Date.now() - hit._at < 6 * 3600_000) return hit;
  try {
    const url = `${INSTRUMENT_URL}?pair=${encodeURIComponent(key.toLowerCase())}&margin_currency_short_name=USDT`;
    const r = await fetch(url, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(8000) });
    if (ok(r)) {
      const j = await r.json();
      const i = j?.instrument && typeof j.instrument === 'object' ? j.instrument : (j && typeof j === 'object' && !Array.isArray(j) ? j : null);
      if (i) {
        const meta = {
          pair: String(i.pair || key),
          maxLeverage: Math.max(1, Math.floor(Math.min(
            num(i.max_leverage) ?? num(i.max_leverage_long) ?? 10,
            num(i.max_leverage_short) ?? num(i.max_leverage_long) ?? 10,
          ))),
          qtyPrecision: Math.max(0, Math.min(8, Math.round(
            num(i.quantity_precision) ?? num(i.qty_precision) ?? num(i.precision) ?? guessPrecision(key)
          ))),
          minQty: num(i.min_qty) ?? num(i.min_quantity) ?? num(i.minimum_qty) ?? 0,
          status: String(i.status || 'active'),
          _at: Date.now(),
        };
        _instrumentMetaCache.set(key, meta);
        return meta;
      }
    }
  } catch { /* fall back to the conservative default */ }
  const meta = { pair: key, maxLeverage: 10, qtyPrecision: guessPrecision(key), minQty: 0, status: 'unknown', _at: Date.now() };
  _instrumentMetaCache.set(key, meta);
  return meta;
}
function guessPrecision(pair) {
  const base = baseOfFuturesPair(pair);
  const p = { BTC: 4, ETH: 3, BNB: 2, SOL: 1, XRP: 0, DOGE: 0, ADA: 0, AVAX: 1, LINK: 1, DOT: 1, TRX: 0, MATIC: 0 }[base];
  return p != null ? p : 3;
}
export function roundFuturesQty(pair, qty) {
  return Math.floor(Number(qty) * 10 ** guessPrecision(pair)) / 10 ** guessPrecision(pair);
}

// ---------------- PUBLIC: candlesticks (pcode=f) ----------------
/**
 * Futures candles — TA source for the futures board. Docs shape:
 *   GET /market_data/candlesticks?pair=B-MKR_USDT&from=…&to=…&resolution=60&pcode=f
 *   → { s: "ok", data: [{ open, high, low, volume, close, time (ms) }] }
 * (also tolerates the legacy bare-array shape).
 */
export async function fetchFuturesCandles(pair, resolution = '60', limit = 300) {
  const to = Math.floor(Date.now() / 1000);
  const from = to - Math.max(1, Math.ceil(limit * resolutionSeconds(resolution) * 1.2 / 60)) * 60;
  const url = `${CANDLES_URL}?pair=${encodeURIComponent(String(pair).toLowerCase())}&from=${from}&to=${to}&resolution=${resolution}&pcode=f`;
  const r = await fetch(url, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(8000) });
  if (!ok(r)) return null;
  const j = await r.json().catch(() => null);
  const raw = Array.isArray(j) ? j : (Array.isArray(j?.data) ? j.data : null);
  if (!raw || raw.length === 0) return null;
  const candles = raw.map(x => ({
    time: Number(x.time) < 1e12 ? Number(x.time) * 1000 : Number(x.time),
    open: num(x.open), high: num(x.high), low: num(x.low),
    close: num(x.close), volume: num(x.volume) || 0,
  })).filter(c => c.close > 0 && c.open > 0)
    .sort((a, b) => a.time - b.time);
  return candles.length >= 30 ? candles : null;
}
function resolutionSeconds(res) {
  const r = String(res);
  if (r === '1D') return 86400;
  return parseInt(r, 10) * 60 || 3600;
}

// ---------------- PRIVATE: wallets ----------------
function loadCredsForOrder() {
  const c = loadJSON('mcp-coindcx.json', {});
  return c?.apiKey && c?.secret ? { apiKey: c.apiKey, secret: c.secret } : null;
}
function credGuard() {
  if (!coindcxConnected()) { const e = new Error('CoinDCX not connected — connect an API key first'); e.status = 400; throw e; }
  const creds = loadCredsForOrder();
  if (!creds) { const e = new Error('CoinDCX credentials unreadable'); e.status = 400; throw e; }
  return creds;
}

/** DF (derivatives-futures) wallet rows: [{ currency, total, free, locked, crossMargin }] */
export async function fetchFuturesWallets() {
  const { apiKey, secret } = credGuard();
  const resp = await coindcxPrivate(WALLETS_PATH, apiKey, secret, {});
  const list = Array.isArray(resp) ? resp : (Array.isArray(resp?.wallets) ? resp.wallets : []);
  return list.map(w => {
    const total = num(w.balance) || 0;
    const locked = (num(w.locked_balance) || 0) + (num(w.cross_order_margin) || 0);
    const crossUser = num(w.cross_user_margin) || 0;
    return {
      currency: String(w.currency_short_name || '').toUpperCase(),
      total: r2(total),
      locked: r2(locked),
      free: r2(Math.max(0, total - locked - crossUser)),
      crossUserMargin: r2(crossUser),
    };
  }).filter(w => w.currency && w.total > 0);
}

/** Spot wallet rows via the SAME /users/balances transport (free/locked). */
export async function fetchSpotWallets() {
  const { apiKey, secret } = credGuard();
  const resp = await coindcxPrivate('/exchange/v1/users/balances', apiKey, secret, { page: '1', size: '100' });
  const list = Array.isArray(resp) ? resp : [];
  const out = [];
  for (const w of list) {
    const base = String(w.currency_short_name ?? w.currency ?? '').toUpperCase();
    if (!base) continue;
    const free = num(w.available_balance ?? w.balance) || 0;
    const locked = num(w.locked_balance) || 0;
    if (free + locked <= 0) continue;
    out.push({ currency: base, free: r2(free), locked: r2(locked), total: r2(free + locked) });
  }
  return out;
}

/**
 * ONE wallet view for the UI + agent sizing:
 *   spot INR/USDT free+locked, futures USDT margin free+locked,
 *   USDINR, and INR-equivalent equity / deployable margin.
 * Never throws — a failed leg degrades to null with the reason kept.
 */
export async function walletSnapshot() {
  const usdInr = await fetchUsdInr();
  const [fut, spot] = await Promise.all([
    fetchFuturesWallets().catch(e => ({ error: String(e?.message || e).slice(0, 140) })),
    fetchSpotWallets().catch(e => ({ error: String(e?.message || e).slice(0, 140) })),
  ]);
  const futRows = Array.isArray(fut) ? fut : [];
  const spotRows = Array.isArray(spot) ? spot : [];
  const spotINR = spotRows.find(w => w.currency === 'INR') || { free: 0, locked: 0, total: 0 };
  const spotUSDT = spotRows.find(w => w.currency === 'USDT') || { free: 0, locked: 0, total: 0 };
  const futUSDT = futRows.find(w => w.currency === 'USDT') || { free: 0, locked: 0, total: 0, crossUserMargin: 0 };
  const equityINR = r2(
    (spotINR.total || 0)
    + (spotUSDT.total || 0) * usdInr
    + (futUSDT.total || 0) * usdInr,
  );
  return {
    ok: true,
    connected: coindcxConnected(),
    usdInr: r2(usdInr),
    spot: {
      inr: spotINR,
      usdt: spotUSDT,
      error: Array.isArray(spot) ? null : spot?.error || 'unavailable',
      rows: spotRows.filter(w => w.currency !== 'INR' && w.currency !== 'USDT' && w.total > 5).slice(0, 12),
    },
    futures: {
      usdt: futUSDT,
      error: Array.isArray(fut) ? null : fut?.error || 'unavailable',
    },
    equityINR,
    // what the AGENT may deploy right now (futures margin first, spot INR as the fallback venue)
    deployableFuturesUSDT: r2(Math.max(0, (futUSDT.free || 0))),
    deployableSpotINR: r2(Math.max(0, (spotINR.free || 0))),
    fetchedAt: Date.now(),
  };
}

// ---------------- PRIVATE: positions ----------------
/**
 * Exchange futures positions (USDT margin). [{ id, pair, activePos,
 * avgPrice, liquidationPrice, leverage, marginType, markPrice, tp, sl }]
 * side is derived: activePos > 0 → LONG, < 0 → SHORT, 0 → flat.
 */
export async function listFuturesPositions() {
  const { apiKey, secret } = credGuard();
  const resp = await coindcxPrivate(POSITIONS_PATH, apiKey, secret, {
    page: '1', size: '100', margin_currency_short_name: ['USDT'],
  });
  const list = Array.isArray(resp) ? resp : (Array.isArray(resp?.positions) ? resp.positions : []);
  return list.map(p => ({
    id: String(p.id || ''),
    pair: String(p.pair || ''),
    activePos: num(p.active_pos) || 0,
    avgPrice: num(p.avg_price) || 0,
    liquidationPrice: num(p.liquidation_price) || 0,
    leverage: num(p.leverage) || 1,
    marginType: String(p.margin_type || ''),
    markPrice: num(p.mark_price) || 0,
    tp: num(p.take_profit_trigger),
    sl: num(p.stop_loss_trigger),
    updatedAt: num(p.updated_at) || 0,
  })).filter(p => p.pair);
}

// ---------------- PRIVATE: orders ----------------
/** Build the nested create-order body (documented shape). */
export function futuresOrderBody({ pair, side, qty, leverage, price }) {
  const long = String(side).toUpperCase() !== 'SHORT';
  const limit = Number(price) > 0;
  return {
    timestamp: Date.now(),
    order: {
      side: long ? 'buy' : 'sell',
      pair: String(pair),
      order_type: limit ? 'limit_order' : 'market_order',
      ...(limit ? { price: String(price) } : {}),
      total_quantity: Number(qty),
      leverage: Math.max(1, Math.floor(Number(leverage) || 1)),
      notification: 'no_notification',
      time_in_force: 'good_till_cancel',
      hidden: false,
      post_only: false,
    },
  };
}
export async function createFuturesOrder({ pair, side, qty, leverage, price }) {
  const { apiKey, secret } = credGuard();
  const body = futuresOrderBody({ pair, side, qty, leverage, price });
  const resp = await coindcxPrivate(ORDERS_CREATE_PATH, apiKey, secret, body);
  return { orderId: resp?.order?.id ?? resp?.id ?? null, raw: resp };
}
export async function exitFuturesPosition(positionId) {
  const { apiKey, secret } = credGuard();
  return coindcxPrivate(POSITIONS_EXIT_PATH, apiKey, secret, { timestamp: Date.now(), id: String(positionId) });
}
/** NATIVE exchange TP/SL — the safety net that keeps working even when
 *  this server is down (Render free-tier sleeps between ticks). */
export async function createFuturesTpsl({ positionId, stopLoss, takeProfit }) {
  const { apiKey, secret } = credGuard();
  const body = {
    timestamp: Date.now(),
    id: String(positionId),
    ...(stopLoss != null && Number(stopLoss) > 0 ? {
      stop_loss: { stop_price: String(stopLoss), order_type: 'stop_market' },
    } : {}),
    ...(takeProfit != null && Number(takeProfit) > 0 ? {
      take_profit: { stop_price: String(takeProfit), order_type: 'take_profit_market' },
    } : {}),
  };
  if (!body.stop_loss && !body.take_profit) return { ok: false, error: 'no levels given' };
  const resp = await coindcxPrivate(POSITIONS_TPSL_PATH, apiKey, secret, body);
  return { ok: true, raw: resp };
}

// ---------------- THE FUTURES EXECUTION GAUNTLET ----------------
/**
 * executeFuturesSignal({ symbol, side, mode, marginUSDT | qtyINR,
 * leverage, getFreshSignal, wantAuto, source })
 *
 * Same gate ladder as the spot gauntlet (coindcxOrders.executeSignal),
 * venue-switched to the GLOBAL FUTURES desk:
 *   1. kill switch    2. auto policy (allowAuto + LIVE)
 *   3. LIVE arming    4. connection
 *   5. fresh STRONG signal (venue FUTURES, ≤90s for LIVE)
 *   6. leverage sanity (liquidation OUTSIDE the SL)
 *   7. margin sizing vs the DF wallet (live) — never over-commit
 *   8. journal caps under the lock (daily trades / loss / one-per-pair
 *      / concentration) — same journal, same lock, same INR caps
 *
 * LIVE orders additionally arm the NATIVE exchange TP/SL so the stop
 * exists even if this server never wakes up again.
 */
export async function executeFuturesSignal(opts) {
  const {
    symbol, side, mode, qtyINR, marginUSDT, leverage,
    getFreshSignal, wantAuto = false, source = 'manual', sendTelegram,
  } = opts || {};
  const cfg = await import('./coindcxOrders.js').then(m => m.loadConfig());
  const pair = futuresPairFor(symbol);
  const base = baseOfFuturesPair(pair);
  // v6.11: NOTIFY mode — full gauntlet, Telegram alert, no order/position.
  const wantMode = mode === 'live' ? 'live' : mode === 'notify' ? 'notify' : 'paper';
  const day = todayIST();
  const entry = { kind: 'ORDER', day, symbol: pair, side, mode: wantMode, market: 'FUTURES', source };

  const reject = (reason, error, extra = {}) => withJournalLock(() => {
    const j = loadJournalFresh();
    pushEntry(j, { ...entry, status: 'REJECTED', reason, ...extra });
    saveJournalFresh(j);
  }).then(() => ({ ok: false, error: error || reason }));

  // --- gate 1: kill switch ---
  if (cfg.killSwitch) return reject('Kill switch ON — execution disabled');

  // --- gate 2: auto policy ---
  if (wantAuto && !cfg.allowAuto) return { ok: false, error: 'Auto-execution is OFF (enable it in Risk settings)' };
  if (wantAuto && cfg.mode !== 'live') return { ok: false, error: 'Auto-execution only runs in LIVE mode' };

  // --- gate 3: LIVE arming (typed "LIVE" in Risk settings) ---
  if (wantMode === 'live' && cfg.mode !== 'live') {
    return reject('LIVE mode is not enabled — type LIVE in Risk settings first');
  }
  // --- gate 4: connection ---
  if (wantMode === 'live' && !coindcxConnected()) return reject('CoinDCX not connected');

  // --- gate 5: fresh STRONG futures signal ---
  const signal = await getFreshSignal(pair);
  if (!signal) return reject('No fresh ensemble signal available for this futures pair');

  const gates = { minConfidence: cfg.minConfidence, minAgreement: cfg.minAgreement };
  const riskCap = Number(cfg.maxRiskPct) > 0 ? Number(cfg.maxRiskPct) : 5;

  // PAPER practice fallback (same honesty model as the spot path).
  let effectiveSignal = signal;
  let synthNote = null;
  if (wantMode !== 'live' && (signal.side === 'FLAT' || !signal.plan)) {
    const reqSide = String(side || '').toUpperCase() === 'SHORT' ? 'SHORT' : 'LONG';
    const { buildTradePlan } = await import('./ensemble.js');
    const synthPlan = buildTradePlan(
      { side: reqSide, dir: reqSide === 'LONG' ? 1 : -1 },
      { ltp: signal.ltp, ind: {} }, 'FUTURES',
    );
    if (synthPlan && signal.ltp > 0) {
      effectiveSignal = { ...signal, side: reqSide, plan: synthPlan };
      synthNote = `practice plan @ live futures price (fresh consensus: ${signal.side} ${signal.confidence}%)`;
    }
  }

  // risk auto-fit (paper always; live mild overshoot ≤ 1.5×)
  let fitNote = null;
  const planRiskPct = Number(effectiveSignal?.plan?.riskPct);
  if (Number.isFinite(planRiskPct) && planRiskPct > riskCap) {
    if (wantMode !== 'live' || planRiskPct <= riskCap * 1.5) {
      const fitted = fitPlanToRiskCap(effectiveSignal, riskCap);
      if (fitted.note) { effectiveSignal = fitted.signal; fitNote = fitted.note; }
    }
  }
  const verdict = evaluateExecutionGate(effectiveSignal, {
    side: side || effectiveSignal.side, gates,
    requireStrong: wantMode === 'live',
    maxAgeMs: wantMode === 'live' ? 90_000 : 600_000,
    maxRiskPct: riskCap, venue: 'FUTURES',
  });
  if (!verdict.ok) {
    return reject(verdict.reason, `Signal gate: ${verdict.reason}`, {
      signal: { grade: signal.grade, conf: signal.confidence, agreement: signal.agreement },
    });
  }

  // v6.11 NOTIFY: gauntlet pass — Telegram alert + journal audit, NO order.
  // Position-creation caps deliberately don't block a notification.
  if (wantMode === 'notify') {
    const alertPrice = Number(effectiveSignal.ltp) > 0 ? Number(effectiveSignal.ltp) : null;
    return withJournalLock(async () => {
      const j = loadJournalFresh();
      const stats = dailyStats(j);
      const plan = effectiveSignal.plan;
      const capsNote = `trades ${stats.tradesCount}/${cfg.dailyMaxTrades} · realized ₹${r2(stats.realizedPnlINR)}`;
      const lines = [
        `🔔 <b>SmartAI NOTIFY (Futures)</b> — ${base} PERP ${effectiveSignal.side}`,
        `<b>${signal.grade || '—'}</b> · conf ${signal.confidence ?? '—'}% · agreement ${Math.round((signal.agreement ?? 0) * 100)}%`,
        plan ? `Entry ${r2(plan.entry)} · SL ${r2(plan.stopLoss)} · T1 ${r2(plan.target1)} · T2 ${r2(plan.target2)} · risk ${r2(plan.riskPct)}%` : 'plan nahi bana',
        `Book: ${capsNote}`,
        [synthNote, fitNote].filter(Boolean).join(' · ') || undefined,
        '— notify-only: koi order place NAHI hua.',
      ].filter(Boolean);
      let telegramSent = false;
      if (typeof sendTelegram === 'function') {
        try { telegramSent = !!(await sendTelegram(lines.join('\n'))).ok; } catch { /* best-effort */ }
      }
      pushEntry(j, {
        ...entry, status: 'NOTIFIED', ...(alertPrice ? { price: r2(alertPrice) } : {}),
        signal: { grade: signal.grade, conf: signal.confidence, agreement: signal.agreement },
        reason: [synthNote, fitNote, verdict.reason].filter(Boolean).join(' · ') || 'gauntlet pass',
        telegramSent,
      });
      saveJournalFresh(j);
      return {
        ok: true, mode: 'notify', notified: true, telegramSent,
        alert: { pair: base, side: effectiveSignal.side, grade: signal.grade, confidence: signal.confidence,
          plan: plan ? { entry: r2(plan.entry), stopLoss: r2(plan.stopLoss), target2: r2(plan.target2) } : null,
          caps: capsNote },
        note: telegramSent ? 'Telegram alert bhej diya (journal AUDIT: NOTIFIED). Koi futures order nahi laga.'
          : 'Gauntlet pass + journal AUDIT likha, par Telegram configured nahi — Alerts & AI Keys me token daalo.',
      };
    });
  }

  // --- sizing (USDT margin domain) ---
  const price = effectiveSignal.ltp;
  if (!(price > 0)) return { ok: false, error: 'No live futures price for sizing' };
  const usdInr = await fetchUsdInr();
  const meta = await fetchFuturesInstrumentMeta(pair).catch(() => null);
  const levCapInstrument = meta?.maxLeverage || 10;
  const levCapConfig = Number(cfg.cryptoLeverage) >= 1 ? Math.floor(Number(cfg.cryptoLeverage)) : 1;
  let lev = Math.max(1, Math.floor(Number(leverage) || 1));
  if (lev > levCapConfig) lev = levCapConfig;
  if (lev > levCapInstrument) lev = levCapInstrument;

  // margin budget: direct USDT wins; else the INR budget converted; else the INR cap
  let margin = Number(marginUSDT) > 0 ? Number(marginUSDT)
    : (Number(qtyINR) > 0 ? Number(qtyINR) / usdInr : Math.min(cfg.maxOrderINR, 1000) / usdInr);
  margin = Math.round(margin * 1000) / 1000;

  // leverage sanity — liquidation must sit OUTSIDE the SL
  const slDistPct = Math.abs(price - (effectiveSignal.plan?.stopLoss ?? price)) / price * 100;
  const saneLev = maxSaneLeverage(slDistPct, Math.min(levCapConfig, levCapInstrument));
  let levNote = null;
  if (lev > 1 && lev > saneLev) {
    if (wantMode === 'paper') {
      levNote = `leverage auto-reduced ${lev}x → ${saneLev}x (liquidation est. would fire before the ${r2(slDistPct)}% SL)`;
      lev = saneLev;
    } else {
      return reject(`leverage ${lev}x puts liquidation (~${r2(95 / lev)}% away) inside the ${r2(slDistPct)}% stop — reduce leverage to ≤${saneLev}x`,
        `Leverage gate: ${lev}x liquidates before the SL — use ≤ ${saneLev}x`);
    }
  }

  // live margin must exist in the DF wallet (USDT first; auto-deposit
  // from spot USDT, else from spot INR at the live FX rate)
  let walletNote = null;
  if (wantMode === 'live') {
    try {
      const wallets = await fetchFuturesWallets();
      const futUSDT = wallets.find(w => w.currency === 'USDT');
      const free = futUSDT?.free || 0;
      if (margin > free) {
        // try auto-transfer from the spot wallet (documented transfer API)
        const spotWallets = await fetchSpotWallets();
        const spotUSDT = spotWallets.find(w => w.currency === 'USDT')?.free || 0;
        const spotINR = spotWallets.find(w => w.currency === 'INR')?.free || 0;
        const need = margin - free;
        if (spotUSDT >= need) {
          await transferSpotToFutures({ amount: r2(need + 0.5), currency: 'USDT' });
          walletNote = `auto-moved ${r2(need + 0.5)} USDT spot → futures margin`;
        } else if (spotINR / usdInr >= need) {
          const usdtNeed = r2((need + 0.5));
          await transferSpotToFutures({ amount: r2(usdtNeed * usdInr), currency: 'INR' });
          walletNote = `auto-moved ₹${r2(usdtNeed * usdInr)} spot → futures (≈ ${usdtNeed} USDT margin)`;
        } else {
          return reject(`futures wallet short: need ${r2(margin)} USDT margin, ${r2(free)} free + spot ₹${r2(spotINR)} insufficient`,
            `Wallet gate: ${r2(margin)} USDT margin needed — futures free ${r2(free)} USDT, spot ₹${r2(spotINR)} — transfer margin in the CoinDCX app`);
        }
      }
    } catch (e) {
      return reject(`futures wallet check failed: ${String(e?.message || e).slice(0, 140)}`,
        `Wallet gate: ${String(e?.message || e).slice(0, 140)}`);
    }
  }

  const rawQty = (margin * lev) / price;
  const qty = roundFuturesQty(pair, rawQty);
  if (!(qty > 0)) return { ok: false, error: `Quantity rounds to 0 for ${pair} — increase the margin` };
  if (meta?.minQty > 0 && qty < meta.minQty) {
    return { ok: false, error: `Quantity ${qty} below the futures minimum (${meta.minQty}) for ${pair}` };
  }
  const notionalUSDT = r2(qty * price);
  const marginUsed = r2(notionalUSDT / lev);
  if (marginUsed < 2) return { ok: false, error: `Margin ₹${inrOfUsdt(marginUsed, usdInr)} too small for ${pair} — increase the order size` };
  const liquidation = lev > 1 && effectiveSignal.plan?.stopLoss != null
    ? r2(effectiveSignal.side !== 'SHORT' ? price * (1 - 0.95 / lev) : price * (1 + 0.95 / lev))
    : null;

  // --- FINAL MUTATION under the journal lock (fresh copy) ---
  return withJournalLock(async () => {
    const j = loadJournalFresh();
    const stats = dailyStats(j);
    if (stats.tradesCount >= cfg.dailyMaxTrades) {
      pushEntry(j, { ...entry, status: 'REJECTED', reason: `Daily trade cap (${cfg.dailyMaxTrades}) hit` });
      saveJournalFresh(j);
      return { ok: false, error: `Daily trade cap (${cfg.dailyMaxTrades}) reached — resets at IST midnight` };
    }
    if (stats.realizedPnlINR <= -cfg.dailyMaxLossINR) {
      pushEntry(j, { ...entry, status: 'REJECTED', reason: `Daily loss cap (₹${cfg.dailyMaxLossINR}) hit` });
      saveJournalFresh(j);
      return { ok: false, error: `Daily loss cap (₹${cfg.dailyMaxLossINR}) breached — trading paused for today` };
    }
    if (j.positions.some(p => p.pair === pair && (p.status === 'OPEN' || p.status === 'UNKNOWN'))) {
      pushEntry(j, { ...entry, status: 'REJECTED', reason: 'Position already open for this futures pair' });
      saveJournalFresh(j);
      return { ok: false, error: `An open position already exists for ${pair} (one-per-pair rule)` };
    }
    const openCount = j.positions.filter(p => p.status === 'OPEN' || p.status === 'UNKNOWN').length;
    if (openCount >= (cfg.maxOpenPositions || 5)) {
      pushEntry(j, { ...entry, status: 'REJECTED', reason: `Max open positions (${cfg.maxOpenPositions || 5}) hit` });
      saveJournalFresh(j);
      return { ok: false, error: `Concentration guard: ${openCount} positions already open (max ${cfg.maxOpenPositions || 5})` };
    }

    const mkPosition = (extra) => ({
      id: crypto.randomUUID(), pair, symbol: base, market: 'FUTURES', side: effectiveSignal.side, mode: wantMode, source,
      qty, entryPrice: price, notionalUSDT, notionalINR: inrOfUsdt(notionalUSDT, usdInr),
      marginUSDT: marginUsed, marginINR: inrOfUsdt(marginUsed, usdInr),
      leverage: lev, ...(lev > 1 ? { liquidation } : {}),
      sl: effectiveSignal.plan?.stopLoss ?? null, tp: effectiveSignal.plan?.target1 ?? null, tp2: effectiveSignal.plan?.target2 ?? null,
      initialRisk: r2(Math.abs(price - (effectiveSignal.plan?.stopLoss ?? price))),
      peakPrice: r2(price),
      signal: { grade: signal.grade, confidence: signal.confidence, agreement: signal.agreement, summary: synthNote || signal.summary },
      openedAt: Date.now(), status: 'OPEN', ...extra,
    });

    // --- PAPER execution ---
    if (wantMode === 'paper') {
      let ledgerEntryId = null;
      try { ledgerEntryId = recordExecution(signal, { mode: 'paper', market: 'FUTURES', source })?.id || null; } catch { /* best-effort */ }
      const position = mkPosition(ledgerEntryId ? { ledgerEntryId } : {});
      j.positions.push(position);
      pushEntry(j, {
        ...entry, status: 'FILLED', qty, price: r2(price), notionalUSDT, notionalINR: inrOfUsdt(notionalUSDT, usdInr),
        leverage: lev, marginUSDT: marginUsed,
        signal: { grade: signal.grade, conf: signal.confidence, agreement: signal.agreement },
        reason: [verdict.reason, synthNote, fitNote, levNote].filter(Boolean).join(' · '),
      });
      saveJournalFresh(j);
      return {
        ok: true, mode: 'paper', position,
        filled: { qty, price: r2(price), notionalUSDT, notionalINR: inrOfUsdt(notionalUSDT, usdInr), leverage: lev, marginUSDT: marginUsed },
        ...(walletNote || fitNote || levNote ? { fitted: [walletNote, fitNote, levNote].filter(Boolean).join(' · ') } : {}),
      };
    }

    // --- LIVE execution ---
    try {
      const { orderId } = await createFuturesOrder({ pair, side: effectiveSignal.side, qty, leverage: lev });
      // Resolve the exchange position id (needed for exit + native TP/SL).
      let exchangePositionId = null, exchangeLiq = null;
      for (let i = 0; i < 3 && !exchangePositionId; i++) {
        await new Promise(r => setTimeout(r, 1200));
        const positions = await listFuturesPositions().catch(() => []);
        const row = positions.find(p => p.pair === pair && p.activePos !== 0);
        if (row) { exchangePositionId = row.id; exchangeLiq = row.liquidationPrice > 0 ? row.liquidationPrice : null; }
      }
      // Native TP/SL — belt + suspenders (works while this server sleeps).
      let tpslNote = null;
      if (exchangePositionId) {
        const tp = effectiveSignal.plan?.target2 ?? null;
        const sl = effectiveSignal.plan?.stopLoss ?? null;
        const tpsl = await createFuturesTpsl({ positionId: exchangePositionId, stopLoss: sl, takeProfit: tp }).catch(e => ({ ok: false, error: String(e?.message || e) }));
        tpslNote = tpsl?.ok ? `native TP/SL armed on the exchange (SL ${sl} · TP ${tp})` : `native TP/SL NOT armed (${String(tpsl?.error || '').slice(0, 80)}) — server watcher guards the exit`;
      }
      let ledgerEntryId = null;
      try { ledgerEntryId = recordExecution(signal, { mode: 'live', market: 'FUTURES', source })?.id || null; } catch { /* best-effort */ }
      const position = mkPosition({
        exchangeOrderId: orderId ?? null,
        ...(exchangePositionId ? { exchangePositionId } : {}),
        ...(exchangeLiq ? { liquidation: exchangeLiq, liquidationSource: 'exchange' } : {}),
        ...(ledgerEntryId ? { ledgerEntryId } : {}),
        status: 'OPEN',
      });
      j.positions.push(position);
      pushEntry(j, {
        ...entry, status: orderId || exchangePositionId ? 'SUBMITTED' : 'SUBMITTED_UNKNOWN',
        qty, price: r2(price), notionalUSDT, notionalINR: inrOfUsdt(notionalUSDT, usdInr),
        leverage: lev, marginUSDT: marginUsed, exchangeOrderId: orderId ?? null,
        signal: { grade: signal.grade, conf: signal.confidence, agreement: signal.agreement },
        reason: [verdict.reason, fitNote, levNote, walletNote, tpslNote].filter(Boolean).join(' · '),
      });
      saveJournalFresh(j);
      return {
        ok: true, mode: 'live', orderId, position,
        filled: { qty, price: r2(price), notionalUSDT, notionalINR: inrOfUsdt(notionalUSDT, usdInr), leverage: lev, marginUSDT: marginUsed },
        ...(walletNote || fitNote || levNote || tpslNote ? { fitted: [walletNote, fitNote, levNote, tpslNote].filter(Boolean).join(' · ') } : {}),
      };
    } catch (e) {
      pushEntry(j, { ...entry, status: 'FAILED', reason: String(e?.message || e).slice(0, 200) });
      saveJournalFresh(j);
      return { ok: false, error: `CoinDCX futures order failed: ${e?.message || e}` };
    }
  });
}

/** Spot ↔ futures margin transfer ("deposit" moves spot → futures). */
export async function transferSpotToFutures({ amount, currency = 'USDT' }) {
  const { apiKey, secret } = credGuard();
  const body = { timestamp: Date.now(), transfer_type: 'deposit', amount: Number(amount), currency_short_name: String(currency).toUpperCase() };
  return coindcxPrivate('/exchange/v1/derivatives/futures/wallets/transfer', apiKey, secret, body);
}

// ---------------- journal helpers (same files as coindcxOrders) ----------------
const JOURNAL_FILE = 'ai-trading-journal.json';
function loadJournalFresh() {
  return loadJSON(JOURNAL_FILE, { entries: [], positions: [] });
}
function saveJournalFresh(j) {
  try { durablePut(JOURNAL_FILE, j); } catch { /* best-effort */ }
  saveJSON(JOURNAL_FILE, j);
  return j;
}

// ---------------- FUTURES POSITION WATCHER ----------------
/**
 * Runs under the journal lock every 60s (routes.js interval):
 *   • LIVE reconcile: the exchange position list is truth — if the
 *     exchange closed the position (native TP/SL, app close, liq),
 *     ours closes with an honest reason. avg/trigger prices approximate
 *     the exit (CoinDCX doesn't expose the fill price here).
 *   • SL / TP2 / trailing / liquidation on the RT futures price
 *     (paper closes simulated, live exits via /positions/exit).
 *   • watch errors persist — a dead stop never looks healthy.
 */
export async function watchFuturesPositions({ sendTelegram } = {}) {
  return withJournalLock(async () => {
    const j = loadJournalFresh();
    const closures = [];
    const watchErrors = [];
    let dirty = false;
    const cfg = await import('./coindcxOrders.js').then(m => m.loadConfig());

    let openFut = j.positions.filter(p => p.market === 'FUTURES' && (p.status === 'OPEN' || p.status === 'UNKNOWN'));
    if (openFut.length === 0) return closures;

    const prices = await fetchFuturesPrices().catch(() => null);
    const byPair = new Map((prices || []).map(p => [p.pair, p.last]));

    // --- LIVE reconcile against the exchange's own position list ---
    if (coindcxConnected() && openFut.some(p => p.mode === 'live')) {
      const exch = await listFuturesPositions().catch(() => null);
      if (exch) {
        const byExchPair = new Map(exch.map(p => [p.pair, p]));
        for (const p of openFut.filter(x => x.mode === 'live')) {
          if (cfg.killSwitch) break;
          const row = byExchPair.get(p.pair);
          if (!row) continue; // pair absent this page — retry next pass
          if (row.activePos !== 0) {
            // still open — refresh the exchange's own numbers
            if (row.avgPrice > 0 && row.avgPrice !== p.entryPrice) { p.entryPrice = row.avgPrice; dirty = true; }
            if (row.liquidationPrice > 0 && row.liquidation !== row.liquidationPrice) { p.liquidation = row.liquidationPrice; p.liquidationSource = 'exchange'; dirty = true; }
            continue;
          }
          // exchange says flat → it closed out from under us (native TP/SL
          // or app close). Exit price ≈ the trigger level we armed.
          const long = p.side === 'LONG';
          let exitPrice = null, reason = 'Exchange closed (reconciled)';
          const ltp = byPair.get(p.pair);
          if (row.sl != null && row.sl > 0) { exitPrice = row.sl; reason = 'Exchange SL (native)'; }
          else if (row.tp != null && row.tp > 0) { exitPrice = row.tp; reason = 'Exchange TP (native)'; }
          else if (ltp > 0) { exitPrice = ltp; reason = 'Exchange closed (app/manual)'; }
          const usdInr = await fetchUsdInr();
          const pnlUSDT = exitPrice != null ? (long ? exitPrice - p.entryPrice : p.entryPrice - exitPrice) * p.qty : 0;
          p.status = 'CLOSED'; p.closedAt = Date.now();
          if (exitPrice != null) p.closePrice = exitPrice;
          p.pnlUSDT = r2(pnlUSDT);
          p.pnlINR = inrOfUsdt(pnlUSDT, usdInr);
          p.closeReason = reason;
          try { settlePositionOutcome(p, reason); } catch { /* best-effort */ }
          dirty = true;
          pushEntry(j, { kind: 'CLOSE', day: todayIST(), pair: p.pair, market: 'FUTURES', mode: p.mode, qty: p.qty, entryPrice: p.entryPrice, closePrice: exitPrice, pnlUSDT: p.pnlUSDT, pnlINR: p.pnlINR, reason });
          closures.push({ pair: p.pair, mode: p.mode, pnlINR: p.pnlINR, reason });
        }
      }
    }

    openFut = j.positions.filter(p => p.market === 'FUTURES' && p.status === 'OPEN');

    for (const p of openFut) {
      const price = byPair.get(p.pair);
      if (!(price > 0)) continue;
      const long = p.side === 'LONG';

      // liquidation estimate first (paper sim + live backstop)
      if (p.leverage > 1 && p.liquidation != null && p.liquidation > 0) {
        if (long ? price <= p.liquidation : price >= p.liquidation) {
          let closed = false;
          if (p.mode === 'live' && p.exchangePositionId && coindcxConnected()) {
            try { await exitFuturesPosition(p.exchangePositionId); closed = true; }
            catch (e) {
              pushEntry(j, { kind: 'WATCH_ERROR', day: todayIST(), pair: p.pair, reason: `futures liq exit failed: ${String(e?.message || e).slice(0, 160)}` });
              dirty = true; watchErrors.push({ pair: p.pair, reason: String(e?.message || e).slice(0, 120) });
            }
          } else { closed = true; }
          if (closed) {
            const usdInr = await fetchUsdInr();
            const liq = p.liquidation;
            const pnlUSDT = (long ? liq - p.entryPrice : p.entryPrice - liq) * p.qty;
            p.status = 'CLOSED'; p.closedAt = Date.now(); p.closePrice = liq;
            p.pnlUSDT = r2(pnlUSDT); p.pnlINR = inrOfUsdt(pnlUSDT, usdInr);
            p.closeReason = 'LIQUIDATED (est.)';
            try { settlePositionOutcome(p, 'LIQUIDATED (est.)'); } catch { /* best-effort */ }
            dirty = true;
            pushEntry(j, { kind: 'CLOSE', day: todayIST(), pair: p.pair, market: 'FUTURES', mode: p.mode, qty: p.qty, entryPrice: p.entryPrice, closePrice: liq, pnlUSDT: p.pnlUSDT, pnlINR: p.pnlINR, reason: 'LIQUIDATED (est. — price crossed the liquidation level)' });
            closures.push({ pair: p.pair, mode: p.mode, pnlINR: p.pnlINR, reason: 'LIQUIDATED (est.)' });
          }
          continue;
        }
      }

      // trailing SL (USDT domain, same ratchet math)
      if (cfg.trailEnabled && p.sl != null && p.sl > 0) {
        const prevPeak = Number(p.peakPrice);
        const peak = long
          ? Math.max(Number.isFinite(prevPeak) && prevPeak > 0 ? prevPeak : price, price)
          : Math.min(Number.isFinite(prevPeak) && prevPeak > 0 ? prevPeak : price, price);
        p.peakPrice = r2(peak);
        const risk = Number(p.initialRisk) > 0 ? Number(p.initialRisk) : Math.abs(p.entryPrice - p.sl);
        if (risk > 0) {
          const trail = computeTrailSl({ side: p.side, entryPrice: p.entryPrice, peakPrice: peak, currentSl: p.sl, initialRisk: risk, price, armR: cfg.trailArmR, offsetR: cfg.trailOffsetR });
          if (trail) {
            pushEntry(j, { kind: 'TRAIL', day: todayIST(), pair: p.pair, market: 'FUTURES', reason: `SL ${trail.stage}: ${p.sl} → ${trail.sl} (peak ${r2(peak)})`, from: p.sl, to: trail.sl });
            p.sl = trail.sl; p.trailing = trail.stage;
            // LIVE: nudge the native stop too (ratchet-only on the exchange)
            if (p.mode === 'live' && p.exchangePositionId && coindcxConnected()) {
              try { await createFuturesTpsl({ positionId: p.exchangePositionId, stopLoss: trail.sl }); } catch { /* watcher remains the guard */ }
            }
          }
        }
        dirty = true;
      }

      let close = null;
      if (p.sl != null && (long ? price <= p.sl : price >= p.sl)) close = { reason: 'STOP-LOSS hit', price, kind: 'SL' };
      else if (p.tp2 != null && (long ? price >= p.tp2 : price <= p.tp2)) close = { reason: 'TARGET-2 hit', price, kind: 'TP2' };
      if (!close) continue;

      let closed = false;
      if (p.mode === 'live' && p.exchangePositionId && coindcxConnected()) {
        try { await exitFuturesPosition(p.exchangePositionId); closed = true; }
        catch (e) {
          pushEntry(j, { kind: 'WATCH_ERROR', day: todayIST(), pair: p.pair, reason: `futures exit failed: ${String(e?.message || e).slice(0, 160)}` });
          dirty = true; watchErrors.push({ pair: p.pair, reason: String(e?.message || e).slice(0, 120) });
          continue;
        }
      } else { closed = true; }
      if (!closed) continue;

      const usdInr = await fetchUsdInr();
      const pnlUSDT = (long ? price - p.entryPrice : p.entryPrice - price) * p.qty;
      p.status = 'CLOSED'; p.closedAt = Date.now(); p.closePrice = price;
      p.pnlUSDT = r2(pnlUSDT); p.pnlINR = inrOfUsdt(pnlUSDT, usdInr);
      p.closeReason = close.reason;
      try { settlePositionOutcome(p, close.reason); } catch { /* best-effort */ }
      dirty = true;
      pushEntry(j, { kind: 'CLOSE', day: todayIST(), pair: p.pair, market: 'FUTURES', mode: p.mode, qty: p.qty, entryPrice: p.entryPrice, closePrice: price, pnlUSDT: p.pnlUSDT, pnlINR: p.pnlINR, reason: close.reason });
      closures.push({ pair: p.pair, mode: p.mode, pnlINR: p.pnlINR, reason: close.reason });
    }

    if (dirty) saveJournalFresh(j);
    if (typeof sendTelegram === 'function' && (closures.length > 0 || watchErrors.length > 0)) {
      try {
        await sendTelegram(`🤖 <b>AI Trading · Futures</b>\n${[
          ...closures.map(c => `• ${c.pair} (${c.mode}) — ${c.reason}: ₹${c.pnlINR > 0 ? '+' : ''}${c.pnlINR}`),
          ...watchErrors.map(c => `⚠️ ${c.pair} — ${c.reason}`),
        ].join('\n')}`);
      } catch { /* best-effort */ }
    }
    return closures;
  });
}

// ---------------- manual close ----------------
export async function closeFuturesPosition(positionId) {
  return withJournalLock(async () => {
    const j = loadJournalFresh();
    const p = j.positions.find(x => x.id === positionId || x.exchangePositionId === positionId);
    if (!p || (p.status !== 'OPEN' && p.status !== 'UNKNOWN')) return { ok: false, error: 'Position not found / already closed' };
    const prices = await fetchFuturesPrices().catch(() => null);
    const ltp = (prices || []).find(x => x.pair === p.pair)?.last || p.entryPrice;
    if (p.mode === 'live' && p.exchangePositionId && coindcxConnected()) {
      try { await exitFuturesPosition(p.exchangePositionId); }
      catch (e) { return { ok: false, error: `Exchange close failed: ${e?.message || e}` }; }
    }
    const long = p.side === 'LONG';
    const usdInr = await fetchUsdInr();
    const pnlUSDT = (long ? ltp - p.entryPrice : p.entryPrice - ltp) * p.qty;
    p.status = 'CLOSED'; p.closedAt = Date.now(); p.closePrice = ltp;
    p.pnlUSDT = r2(pnlUSDT); p.pnlINR = inrOfUsdt(pnlUSDT, usdInr);
    p.closeReason = 'Manual close';
    try { settlePositionOutcome(p, 'Manual close'); } catch { /* best-effort */ }
    pushEntry(j, { kind: 'CLOSE', day: todayIST(), pair: p.pair, market: 'FUTURES', mode: p.mode, qty: p.qty, entryPrice: p.entryPrice, closePrice: ltp, pnlUSDT: p.pnlUSDT, pnlINR: p.pnlINR, reason: 'Manual close' });
    saveJournalFresh(j);
    return { ok: true, position: p };
  });
}

// ---------------- futures markets view (UI) ----------------
/** Top futures markets by 24h volume + our universe rows first. */
export async function futuresMarketsView(limit = 24) {
  const rows = await fetchFuturesPrices().catch(() => []);
  if (!Array.isArray(rows) || rows.length === 0) {
    return { ok: false, error: 'Futures market data unreachable right now', markets: [] };
  }
  const universeSet = new Set(FUTURES_UNIVERSE);
  const sorted = rows.slice().sort((a, b) => {
    const au = universeSet.has(a.base) ? 1 : 0, bu = universeSet.has(b.base) ? 1 : 0;
    if (au !== bu) return bu - au;
    return (b.volume || 0) - (a.volume || 0);
  }).slice(0, limit);
  return {
    ok: true, count: rows.length,
    markets: sorted.map(m => ({
      pair: m.pair, base: m.base, last: m.last, mark: m.mark, changePct: m.changePct,
      high: m.high, low: m.low, volumeUSDT: m.volume,
    })),
    fetchedAt: Date.now(),
  };
}

// ---------------- test hooks ----------------
export function __resetFuturesForTests() {
  _pricesCache = null; _pricesAt = 0;
  _instrumentsCache = null; _instrumentsAt = 0;
  _instrumentMetaCache = new Map();
  _usdInr = null; _usdInrAt = 0;
}
export function __setUsdInrForTests(v) { _usdInr = v; _usdInrAt = Date.now(); }
export { inrOfUsdt };
