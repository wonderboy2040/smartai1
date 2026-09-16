// ============================================================
// server/ai/manualTrades.js — v10.16 SECTION 2: MANUAL TRADE TRACKER
// ------------------------------------------------------------
// THE GAP (superintelligence plan v2): a user takes a REAL trade off a
// signal card ("Maine ye trade liya hai") and the site immediately
// forgets it. Paper trades are tracked; agent trades are tracked; the
// user's OWN trades — the ones with real money on the line — had zero
// support. This module gives every manual entry the SAME intelligence
// the desk gives its own positions:
//
//   • the ORIGINATING SIGNAL SNAPSHOT is frozen at entry — the plan
//     (entry/SL/T1/T2), the 14-model vote breakdown, the regime label,
//     and the AI score. "Trend change" is measured AGAINST this
//     baseline; without it there is nothing to compare to.
//   • LIVE tracking: LTP (5s via the live tick store / cached quotes),
//     P&L in ₹/USDT and %, distance to SL and each target, time in
//     trade.
//   • LIVE CONVICTION BAR: reuses positionConviction.js — the ensemble
//     re-votes the symbol each ~30s (the cached getDeepSignal path,
//     zero new upstream calls) and the state banner escalates:
//       THESIS INTACT (green)  → ensemble still backs the original side
//       WEAKENING    (amber)   → conviction decaying, consider tightening
//       EXIT NOW     (red)     → ensemble FLIPPED to the opposite side
//       TARGET HIT   (blue)    → price reached T1/T2
//   • TELEGRAM: conviction flip = immediate highest-priority push with
//     the WHY (which models flipped, current vs entry score); SL
//     approach (within 0.3 ATR); each target hit; stagnant check-ins.
//     Commands: /manual (live list), /manualclose <id>.
//
// Instrument coverage: India equity + F&O options (BS-repriced premium,
// same as the paper desk), crypto spot/perps (live tick store), global
// equity SIM — because it keys off the signal snapshot every card
// already produces.
//
// Persistence: server/data/manual-trades.json (atomic writes, debounced,
// mirrored to the GitHub backup branch — the paper-desk pattern).
// ============================================================
import { loadJSON, saveJSON } from '../lib/store.js';
import { scheduleBackup } from '../intraday/backup.js';
import { getTick } from '../liveFeed.js';
import { bsPrice, yearsToExpiry } from './lib/blackScholes.js';
import { sideOf, classifyConviction, quorumOfSignal } from './positionConviction.js';

const FILE = 'manual-trades.json';
const MAX_TRADES = 300;
const RISK_FREE = 0.065; // matches optionsDesk.js / paperTrading.js

// ---------------- store (paper-desk pattern: debounce + backup) ----------------
let _state = loadJSON(FILE, { trades: [], nextId: 1 });
let _saveTimer = null;

function _persist() {
  if (_saveTimer) return;
  _saveTimer = setTimeout(() => {
    _saveTimer = null;
    saveJSON(FILE, _state);
    try { scheduleBackup(FILE, _state); } catch { /* backup optional */ }
  }, 1000);
  if (typeof _saveTimer.unref === 'function') _saveTimer.unref();
}

/** v9.1-parity: synchronous flush for graceful shutdown. */
export function flushManualState() {
  if (_saveTimer) { clearTimeout(_saveTimer); _saveTimer = null; }
  saveJSON(FILE, _state);
}

export function __resetManualStoreForTests() {
  _state = { trades: [], nextId: 1 };
  if (_saveTimer) { clearTimeout(_saveTimer); _saveTimer = null; }
}

// ---------------- pure helpers (tested) ----------------
const _num = (v) => (v == null || v === '' ? null : (Number.isFinite(Number(v)) ? Number(v) : null));
const _r2 = (v) => (Number.isFinite(v) ? Math.round(v * 100) / 100 : null);

/**
 * Entry-price sanity vs live LTP — a typo here silently corrupts every
 * downstream P&L number, so we WARN (never block: a genuine fill can be
 * legitimately away from LTP). PURE.
 * @returns {{warn:boolean, deviationPct:number|null}}
 */
export function validateEntryVsLtp({ entryPrice, ltp, tolerancePct = 15 }) {
  const e = _num(entryPrice);
  const l = _num(ltp);
  if (!(e > 0) || !(l > 0)) return { warn: false, deviationPct: null };
  const dev = Math.abs(e - l) / l * 100;
  return { warn: dev > tolerancePct, deviationPct: Math.round(dev * 10) / 10 };
}

/**
 * Live P&L of one manual trade. PURE. Direction-aware; option trades
 * multiply by lotSize (qty is LOTS there — same convention as the F&O
 * paper cards); crypto markets report USDT alongside INR.
 * @returns {{pnlINR:number, pnlPct:number, pnlUSDT:number|null, currency:'INR'|'USDT'}}
 */
export function manualPnlOf(trade, ltp, { usdInr = 84 } = {}) {
  const entry = _num(trade?.entryPrice);
  const px = _num(ltp);
  const isUsd = trade?.market === 'FUTURES' || trade?.market === 'GLOBALFUTURES';
  const dir = sideOf(trade?.side) === 'SELL' ? -1 : 1;
  if (!(entry > 0) || !(px > 0)) {
    return { pnlINR: 0, pnlPct: 0, pnlUSDT: isUsd ? 0 : null, currency: isUsd ? 'USDT' : 'INR' };
  }
  const lots = _num(trade?.lotSize) || 1; // equity/crypto: lotSize absent → 1
  const qty = _num(trade?.qty) || 0;
  const mult = qty * lots;
  const pnlPct = ((px - entry) / entry) * 100 * dir;
  const pnlNative = (px - entry) * mult * dir; // INR (India) or USDT (perps)
  const fx = isUsd ? (_num(usdInr) || 84) : 1;
  return {
    pnlINR: Math.round(pnlNative * fx * 100) / 100,
    pnlPct: Math.round(pnlPct * 100) / 100,
    pnlUSDT: isUsd ? Math.round(pnlNative * 1000) / 1000 : null,
    currency: isUsd ? 'USDT' : 'INR',
  };
}

/**
 * Distance to SL / T1 / T2 in % of entry (direction-aware). PURE.
 * Used by the monitor UI rows + the SL-approach alert (0.3×ATR check).
 */
export function manualLevelDistances(trade, ltp) {
  const entry = _num(trade?.entryPrice);
  const px = _num(ltp);
  if (!(entry > 0) || !(px > 0)) return {};
  const dir = sideOf(trade?.side) === 'SELL' ? -1 : 1;
  const pctTo = (level) => {
    const lv = _num(level);
    if (!(lv > 0)) return null;
    // signed distance FROM price TO level, in the trade's favor-frame:
    // negative = level is BEHIND the position (adverse), positive = ahead
    return Math.round((((lv - px) / px) * 100) * dir * 10) / 10;
  };
  const o = trade?.origin?.plan || trade?.plan || {};
  return { sl: pctTo(o.stopLoss ?? o.sl), t1: pctTo(o.target1 ?? o.t1), t2: pctTo(o.target2 ?? o.t2) };
}

/**
 * The STATE BANNER for one manual trade (escalating urgency). PURE.
 * Priority: EXIT NOW (conviction flip — thesis invalidated) >
 * TARGET HIT > WEAKENING > THESIS INTACT. UNKNOWN conviction (data
 * missing) is honest: banner falls back to price-only judgment.
 * @param {object} a { convictionState, ltp, trade }
 * @returns {'THESIS_INTACT'|'WEAKENING'|'EXIT_NOW'|'TARGET_HIT'|'STALE'}
 */
export function stateOfManualTrade({ convictionState, ltp, trade }) {
  const px = _num(ltp);
  const o = trade?.origin?.plan || trade?.plan || {};
  const dir = sideOf(trade?.side) === 'SELL' ? -1 : 1;
  if (px > 0) {
    const t1 = _num(o.target1 ?? o.t1);
    const t2 = _num(o.target2 ?? o.t2);
    const reached = (lv) => lv > 0 && ((px - lv) * dir >= 0);
    if (reached(t1) || reached(t2)) return 'TARGET_HIT';
  }
  if (convictionState === 'FLIPPED') return 'EXIT_NOW';
  if (convictionState === 'WEAKENING') return 'WEAKENING';
  if (convictionState === 'UNKNOWN' || convictionState == null) return 'STALE';
  return 'THESIS_INTACT';
}

/**
 * Conviction of a manual trade from a FRESH deep signal — the same
 * classifier the auto-agents use, pointed at the trade's side + entry
 * snapshot score. PURE.
 */
export function manualConvictionOf(trade, freshSignal, threshold) {
  return classifyConviction({
    posSide: sideOf(trade?.side),
    curSide: freshSignal?.side ? sideOf(freshSignal.side) : null,
    curScore: _num(freshSignal?.superIntel?.aiScore ?? freshSignal?.confidence),
    entryScore: _num(trade?.origin?.aiScore ?? trade?.origin?.score),
    quorumMet: quorumOfSignal(freshSignal),
    threshold,
  });
}

/**
 * The "WHY" for a conviction push — which named models switched sides
 * vs the frozen entry votes, and the score move. PURE (judgment aid,
 * not a command: "so you can judge rather than obey").
 * @returns {{flipped:string[], abstainedNew:string[], entryScore:number|null, curScore:number|null}}
 */
export function flipSummary(trade, freshSignal) {
  const posSide = sideOf(trade?.side);
  const entryVotes = Array.isArray(trade?.origin?.votes) ? trade.origin.votes : [];
  const curVotes = Array.isArray(freshSignal?.votes) ? freshSignal.votes : [];
  const curById = new Map(curVotes.map(v => [v.id, v]));
  const flipped = [];
  const abstainedNew = [];
  for (const ev of entryVotes) {
    const dirNum = Number(ev.dir) || 0;
    if (dirNum === 0) continue; // was already abstaining at entry
    const votedSide = dirNum > 0 ? 'BUY' : 'SELL';
    if (votedSide !== posSide) continue; // it OPPOSED the entry — not "our" model
    const cv = curById.get(ev.id);
    if (!cv) continue;
    const curDir = Number(cv.dir) || 0;
    if (curDir !== 0 && (curDir > 0 ? 'BUY' : 'SELL') !== posSide) flipped.push(cv.name || ev.name || ev.id);
    else if (curDir === 0) abstainedNew.push(cv.name || ev.name || ev.id);
  }
  return {
    flipped,
    abstainedNew,
    entryScore: _num(trade?.origin?.aiScore),
    curScore: _num(freshSignal?.superIntel?.aiScore ?? freshSignal?.confidence),
  };
}

/** Level-touch-compatible rows (the telegramPush detectLevelTouches
 *  shape) so SL/T1/T2 touches reuse the SAME 5s pipeline. PURE.
 *
 *  Contract notes (v10.16 wiring): detectLevelTouches requires
 *  `status === 'OPEN'` and LONG/SHORT sides — sideOf's BUY/SELL is
 *  translated here, or a BUY trade would be level-checked INVERTED.
 *  P&L: INR-domain markets (India equity + CoinDCX INR spot) carry
 *  native ₹ uP&L; USDT/USDC-domain rows stay null — the push omits
 *  the number rather than showing a fixed-fx guess (the monitor's own
 *  pushes carry the exact $ P&L). */
export function manualTradesToPositionRows(trades) {
  const out = [];
  for (const t of (trades || [])) {
    if (t?.status === 'CLOSED') continue;
    const o = t?.origin?.plan || t?.plan || {};
    const entry = _num(t.entryPrice);
    if (!(entry > 0)) continue;
    const ltp = _num(t.__ltp);
    const mkt = String(t.market || 'INDIA').toUpperCase();
    const inrDomain = mkt === 'INDIA' || mkt === 'CRYPTO';
    out.push({
      id: `MAN-${t.id}`,
      pair: String(t.symbol || '?'),
      symbol: String(t.symbol || '?'),
      side: sideOf(t.side) === 'SELL' ? 'SHORT' : 'LONG',
      status: 'OPEN',
      market: mkt,
      entryPrice: entry,
      sl: _num(o.stopLoss ?? o.sl) ?? null,
      tp: _num(o.target1 ?? o.t1) ?? null,
      tp2: _num(o.target2 ?? o.t2) ?? null,
      tp1Hit: false,
      tp2Hit: false,
      ltp,
      qty: _num(t.qty) || 0,
      liquidation: null,
      leverage: 1,
      unrealizedPnlINR: ltp != null && inrDomain ? manualPnlOf(t, ltp).pnlINR : null,
      manual: true,
    });
  }
  return out;
}

// ---------------- CRUD ----------------
/**
 * Record a manual trade. The ORIGINATING SIGNAL SNAPSHOT is frozen
 * verbatim (plan, votes, regime, aiScore) — the baseline every later
 * "trend change" is measured against.
 * @param {object} input { market, symbol, side, entryPrice, qty, lots?,
 *   lotSize?, strike?, expiry?, optType?, iv?, entryTime?, ltp?, signal? }
 */
export function recordManualTrade(input = {}) {
  const market = ['INDIA', 'CRYPTO', 'FUTURES', 'GLOBALFUTURES'].includes(String(input.market || '').toUpperCase())
    ? String(input.market).toUpperCase() : 'INDIA';
  const symbol = String(input.symbol || '').trim().toUpperCase();
  const side = sideOf(input.side);
  const entryPrice = _num(input.entryPrice);
  const qty = _num(input.qty);
  const assetKind = input.strike != null || input.optType ? 'OPTION' : null;
  if (!/^[A-Z0-9&\-]{2,15}$/.test(symbol)) return { ok: false, error: 'symbol invalid' };
  if (!side) return { ok: false, error: 'side must be BUY/LONG or SELL/SHORT' };
  if (!(entryPrice > 0)) return { ok: false, error: 'entryPrice must be > 0' };
  if (!(qty > 0)) return { ok: false, error: 'qty must be > 0' };
  if (assetKind === 'OPTION') {
    const strike = _num(input.strike);
    const optType = String(input.optType || '').toUpperCase();
    if (!(strike > 0) || !['CE', 'PE'].includes(optType)) {
      return { ok: false, error: 'F&O trades need strike + optType (CE/PE)' };
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(input.expiry || ''))) {
      return { ok: false, error: 'F&O trades need expiry (YYYY-MM-DD)' };
    }
  }
  const ltp = _num(input.ltp);
  const check = validateEntryVsLtp({ entryPrice, ltp: ltp ?? null });
  if (check.warn) {
    // honest warn — recorded anyway (a real fill can be legitimately off)
    console.warn(`[manual-trades] entry ${entryPrice} is ${check.deviationPct}% away from live ${ltp} (${symbol}) — recorded with warning`);
  }
  const sig = input.signal || {};
  const plan = sig.plan || input.plan || null;
  const t = {
    id: _state.nextId++,
    createdAt: Date.now(),
    openedAt: _num(input.entryTime) > 0 ? Number(input.entryTime) : Date.now(),
    entryTime: _num(input.entryTime) > 0 ? Number(input.entryTime) : Date.now(),
    market, symbol, side,
    assetKind,
    entryPrice,
    qty: assetKind === 'OPTION' ? Math.max(1, Math.floor(qty)) : Math.round(qty * 1e4) / 1e4,
    ...(assetKind === 'OPTION' ? {
      strike: _num(input.strike),
      expiry: String(input.expiry),
      optType: String(input.optType).toUpperCase(),
      iv: _num(input.iv) ?? 13,
      lotSize: _num(input.lotSize) || 75,
      underlying: String(input.underlying || symbol),
    } : {}),
    status: 'OPEN',
    lastState: null,
    // ---- THE SNAPSHOT (Section 2B: the baseline) ----
    origin: {
      aiScore: _num(sig.superIntel?.aiScore) ?? _num(sig.confidence) ?? null,
      confidence: _num(sig.confidence) ?? null,
      agreement: _num(sig.agreement) ?? null,
      voters: _num(sig.voters ?? sig.participating) ?? null,
      grade: sig.grade || null,
      regime: sig.regime || sig.quality?.regime?.label || null,
      side: sig.side || side,
      symbol, market,
      generatedAt: sig.generatedAt || Date.now(),
      plan: plan ? {
        entry: _num(plan.entry),
        stopLoss: _num(plan.stopLoss ?? plan.sl),
        target1: _num(plan.target1 ?? plan.t1),
        target2: _num(plan.target2 ?? plan.t2),
        riskPct: _num(plan.riskPct),
        atr: _num(plan.atrUsed ?? plan.atr),
      } : null,
      votes: (Array.isArray(sig.votes) ? sig.votes : []).map(v => ({
        id: v.id, name: v.name, dir: Number(v.dir) || 0, conf: _num(v.conf),
      })),
      summary: sig.summary || null,
    },
    ...(input.note ? { note: String(input.note).slice(0, 200) } : {}),
    ...(check.warn ? { entryWarn: `entry ${check.deviationPct}% off live ${ltp}` } : {}),
  };
  _state.trades.push(t);
  if (_state.trades.length > MAX_TRADES) _state.trades.splice(0, _state.trades.length - MAX_TRADES);
  _persist();
  return { ok: true, trade: t, warn: check.warn ? `Entry price is ${check.deviationPct}% away from live LTP ${ltp} — typo check karo (recorded anyway).` : null };
}

/** Raw list (open first, newest first). */
export function listManualTrades({ status } = {}) {
  const trades = [...(_state.trades || [])];
  trades.sort((a, b) => (a.status === b.status ? (b.createdAt || 0) - (a.createdAt || 0) : a.status === 'OPEN' ? -1 : 1));
  return status ? trades.filter(t => t.status === status) : trades;
}

export function getManualTrade(id) {
  const n = Number(id);
  return _state.trades.find(t => t.id === n) || null;
}

/** Close a manual trade at the given price (or live when omitted). */
export function closeManualTrade(id, { exitPrice, reason } = {}) {
  const t = getManualTrade(id);
  if (!t) return { ok: false, error: 'trade not found' };
  if (t.status === 'CLOSED') return { ok: false, error: 'already closed' };
  const px = _num(exitPrice) ?? _num(t.__ltp);
  if (!(px > 0)) return { ok: false, error: 'exit price unavailable — live LTP pass karo ya price type karo' };
  const pnl = manualPnlOf(t, px);
  t.status = 'CLOSED';
  t.closedAt = Date.now();
  t.exitPrice = px;
  t.closeReason = String(reason || 'manual').slice(0, 60);
  t.exitPnlINR = pnl.pnlINR;
  t.exitPnlPct = pnl.pnlPct;
  _persist();
  return { ok: true, trade: t, pnl };
}

// ---------------- live view (LTP resolution) ----------------
function _tickKeyFor(market, symbol) {
  if (market === 'FUTURES') return `FUT_${symbol}`;
  if (market === 'GLOBALFUTURES') return `GLOB_${symbol}`;
  return `IN_${symbol}`;
}

/**
 * Resolve the live LTP for one open manual trade. Injected fetchers keep
 * this PURE-testable: crypto/global read the in-memory tick store (free);
 * India equities use the cached TV batch; OPTION trades re-price the
 * premium via Black-Scholes on the live underlying spot (entry IV held
 * fixed — the same basis as the F&O paper cards).
 */
export async function ltpForManualTrade(t, { fetchIndiaQuotes, fetchIndexSpot } = {}) {
  if (!t || t.status === 'CLOSED') return null;
  if (t.assetKind === 'OPTION') {
    try {
      if (typeof fetchIndexSpot === 'function') {
        const spot = _num((await fetchIndexSpot(t.underlying || t.symbol))?.price);
        if (spot > 0) {
          const T = Math.max(0, yearsToExpiry(`${t.expiry}T15:30:00+05:30`));
          const sigma = Math.min(0.60, Math.max(0.06, (_num(t.iv) || 13) / 100));
          const intrinsic = t.optType === 'CE'
            ? Math.max(0, spot - t.strike)
            : Math.max(0, t.strike - spot);
          const prem = T > 0
            ? Math.max(0.05, bsPrice(spot, t.strike, T, RISK_FREE, sigma, t.optType))
            : intrinsic;
          return Math.round(prem * 100) / 100;
        }
      }
    } catch { /* fall through */ }
    return null;
  }
  // crypto / global / india: live tick store first (free, 5s fresh)
  const tick = getTick(_tickKeyFor(t.market, t.symbol));
  const px = _num(tick?.price);
  if (px > 0) return px;
  // India fallback: the cached TV batch (Yahoo) — only when injected
  if (t.market === 'INDIA' && typeof fetchIndiaQuotes === 'function') {
    try {
      const q = await fetchIndiaQuotes([t.symbol]);
      const px2 = _num(q?.[t.symbol]?.price);
      if (px2 > 0) return px2;
    } catch { /* honest null */ }
  }
  return null;
}

/**
 * Build the LIVE monitor view for the UI: per trade — LTP, P&L (₹/USDT
 * + %), level distances, conviction state + delta, the state banner.
 * Conviction comes from the caller (the monitor loop or an on-demand
 * deep re-vote) so this stays cheap per request.
 */
export function manualTradeView(t, { ltp, usdInr, conviction } = {}) {
  const pnl = manualPnlOf(t, ltp, { usdInr });
  const dist = manualLevelDistances(t, ltp);
  const banner = stateOfManualTrade({ convictionState: conviction?.state, ltp, trade: t });
  const ageMin = t.openedAt ? Math.round((Date.now() - t.openedAt) / 60000) : null;
  return {
    ...t,
    __ltp: ltp,
    __view: {
      ltp, ageMin,
      pnl,
      distances: dist,
      conviction: conviction ? {
        state: conviction.state, delta: conviction.delta ?? null,
        currentScore: conviction.currentScore ?? null,
        entryScore: conviction.entryScore ?? _num(t.origin?.aiScore),
      } : { state: null, delta: null, currentScore: null, entryScore: _num(t.origin?.aiScore) },
      banner,
    },
  };
}

// ============================================================
// THE MONITOR — 5s live tracking + ~30s conviction re-vote + telegram
// ------------------------------------------------------------
// Only runs while (a) open manual trades exist AND (b) telegram is
// configured; otherwise it parks at a 60s idle poll (free). The
// conviction re-vote rides getDeepSignal()'s 30s cache — zero new
// upstream calls (the auto-agents' cost contract, kept).
// ============================================================
const MONITOR_ACTIVE_MS = 5_000;
const MONITOR_IDLE_MS = 60_000;
const CONVICTION_EVERY_MS = 30_000;
const SL_ALERT_COOLDOWN_MS = 5 * 60_000;   // re-nudge at most every 5m while inside the zone
const STAGNANT_EVERY_MS = 45 * 60_000;     // time-based check-in on quiet trades

let _mon = null;      // { timer, deps, send, ticking, lastTickAt, status }
const _alerts = new Map(); // `${kind}:${id}` -> last push epoch

function _monStatus() {
  return {
    ok: true,
    running: !!(_mon?.timer),
    openTrades: (_state.trades || []).filter(t => t.status === 'OPEN').length,
    lastTickAt: _mon?.lastTickAt || null,
    lastPushAt: _mon?.status?.lastPushAt || null,
    pushes: _mon?.status?.pushes || 0,
    lastError: _mon?.status?.lastError || null,
  };
}
export function manualMonitorStatus() { return _monStatus(); }

function _curOf(market) { return market === 'FUTURES' || market === 'GLOBALFUTURES' ? '$' : '₹'; }
function _fmtPx(v, market) {
  const n = _num(v);
  if (n == null) return '—';
  return `${_curOf(market)}${n >= 1000 ? Math.round(n).toLocaleString('en-IN') : Math.round(n * 100) / 100}`;
}

/** Cooldown-guarded push (the insta-push pattern, self-contained).
 *  Guards: _mon may be null when alerts are evaluated outside the
 *  monitor (tests / future callers) — never crash on bookkeeping. */
async function _push(kind, id, text, cooldownMs, send) {
  const key = `${kind}:${id}`;
  const now = Date.now();
  const last = _alerts.get(key) || 0;
  if (now - last < cooldownMs) return false;
  _alerts.set(key, now);
  const r = typeof send === 'function'
    ? await send(text).catch(() => ({ ok: false }))
    : { ok: false };
  if (r?.ok !== false && _mon) {
    _mon.status.pushes++;
    _mon.status.lastPushAt = now;
  }
  return true;
}

/**
 * The alert evaluation for ONE trade — PURE-ish (send injected), tested
 * through the loop. Exported for tests.
 */
export async function evaluateManualTradeAlerts(t, { send, conviction, freshSignal, usdInr }) {
  const pushed = [];
  const ltp = _num(t.__ltp);
  const plan = t.origin?.plan || {};
  const o = plan.entry ?? t.entryPrice;
  const dir = sideOf(t.side) === 'SELL' ? -1 : 1;
  const banner = stateOfManualTrade({ convictionState: conviction?.state, ltp, trade: t });
  const pnl = manualPnlOf(t, ltp, { usdInr });
  const dist = manualLevelDistances(t, ltp);
  const why = freshSignal ? flipSummary(t, freshSignal) : null;

  // ---- 1) EXIT NOW — conviction flip: IMMEDIATE, highest priority ----
  if (banner === 'EXIT_NOW') {
    const whyLines = [];
    if (why) {
      if (why.flipped.length > 0) whyLines.push(`${why.flipped.length} models flipped: ${why.flipped.slice(0, 5).join(', ')}${why.flipped.length > 5 ? '…' : ''}`);
      if (why.abstainedNew.length > 0) whyLines.push(`${why.abstainedNew.length} models ab abstain kar rahe (data missing)`);
      if (why.entryScore != null && why.curScore != null) whyLines.push(`AI score: entry ${why.entryScore} → ab ${why.curScore} (opposite side)`);
    }
    const text = [
      `🚨 <b>MANUAL TRADE — EXIT NOW</b>`,
      `<b>${t.symbol}</b> ${t.side === 'BUY' ? 'LONG' : 'SHORT'} @ ${_fmtPx(o, t.market)} → live <b>${_fmtPx(ltp, t.market)}</b> (${pnl.pnlPct >= 0 ? '+' : ''}${pnl.pnlPct}%)`,
      `Ensemble ab <b>${conviction?.side === 'BUY' ? 'LONG' : 'SHORT'}</b> side par hai — thesis invalid ho chuki hai.`,
      ...whyLines.map(l => `• ${l}`),
      plan.stopLoss ? `SL ${_fmtPx(plan.stopLoss, t.market)} hai${dist.sl != null ? ` (${Math.abs(dist.sl)}% away)` : ''} — judge karo, obey mat karo.` : '',
      `<i>/manualclose ${t.id} se site se close kar sakte ho.</i>`,
    ].filter(Boolean).join('\n');
    if (await _push('flip', t.id, text, 30 * 60_000, send)) pushed.push('flip');
  }

  // ---- 2) SL approach — within 0.3×ATR (or 0.5% of entry when ATR
  //      unknown — labeled honestly as a proxy) ----
  if (ltp > 0 && plan.stopLoss > 0 && banner !== 'EXIT_NOW') {
    const atr = _num(plan.atr) || (o > 0 ? o * 0.005 : null); // proxy when ATR missing
    if (atr > 0) {
      const distAbs = Math.abs(ltp - plan.stopLoss);
      if (distAbs <= atr * 0.3) {
        const text = [
          `⚠️ <b>MANUAL TRADE — SL approach</b>`,
          `<b>${t.symbol}</b> ${t.side === 'BUY' ? 'LONG' : 'SHORT'} @ ${_fmtPx(o, t.market)} → live ${_fmtPx(ltp, t.market)}`,
          `SL ${_fmtPx(plan.stopLoss, t.market)} sirf ${Math.round(distAbs / atr * 100) / 100}×ATR away hai (${Math.abs(dist.sl ?? 0)}%)`,
          `P&L: ${pnl.pnlPct >= 0 ? '+' : ''}${pnl.pnlPct}% (${pnl.currency === 'USDT' ? `$${pnl.pnlUSDT}` : `₹${pnl.pnlINR}`})`,
        ].join('\n');
        if (await _push('sl', t.id, text, SL_ALERT_COOLDOWN_MS, send)) pushed.push('sl');
      }
    }
  }

  // ---- 3) target hits (once each) ----
  if (ltp > 0) {
    for (const [lvKey, lv] of [['t1', plan.target1], ['t2', plan.target2]]) {
      if (!(lv > 0)) continue;
      if ((ltp - lv) * dir >= 0) {
        const text = [
          `🎯 <b>MANUAL TRADE — ${lvKey.toUpperCase()} HIT</b>`,
          `<b>${t.symbol}</b> ${t.side === 'BUY' ? 'LONG' : 'SHORT'} @ ${_fmtPx(o, t.market)} → live <b>${_fmtPx(ltp, t.market)}</b>`,
          `${lvKey.toUpperCase()} ${_fmtPx(lv, t.market)} touch ho gaya · P&L: ${pnl.pnlPct >= 0 ? '+' : ''}${pnl.pnlPct}% (${pnl.currency === 'USDT' ? `$${pnl.pnlUSDT}` : `₹${pnl.pnlINR}`})`,
          `Runner ka SL breakeven shift karna mat bhoolna.`,
        ].join('\n');
        if (await _push(lvKey, t.id, text, 6 * 60 * 60_000, send)) pushed.push(lvKey);
      }
    }
  }

  // ---- 4) stagnant check-in — quiet trade, time-based nudge ----
  const ageMin = t.openedAt ? (Date.now() - t.openedAt) / 60000 : 0;
  if (ageMin > 0 && banner === 'THESIS_INTACT' && Math.abs(pnl.pnlPct) < 0.6) {
    const nth = Math.floor(ageMin / (STAGNANT_EVERY_MS / 60000));
    if (nth > 0) {
      const text = [
        `⏱ <b>MANUAL TRADE — check-in</b> (${Math.round(ageMin)}m in)`,
        `<b>${t.symbol}</b> ${t.side === 'BUY' ? 'LONG' : 'SHORT'} @ ${_fmtPx(o, t.market)} → live ${_fmtPx(ltp, t.market)} (${pnl.pnlPct >= 0 ? '+' : ''}${pnl.pnlPct}%)`,
        `Thesis intact hai lekin trade stagnant hai — ${plan.target1 ? `T1 ${_fmtPx(plan.target1, t.market)}` : 'target'} ${dist.t1 != null ? `${Math.abs(dist.t1)}% away` : ''}.`,
      ].filter(Boolean).join('\n');
      if (await _push(`stag${nth}`, t.id, text, STAGNANT_EVERY_MS * 2, send)) pushed.push('stag');
    }
  }
  return pushed;
}

async function _monitorTick() {
  if (!_mon || _mon.ticking) return;
  _mon.ticking = true;
  let nextDelay = MONITOR_IDLE_MS;
  try {
    const open = (_state.trades || []).filter(t => t.status === 'OPEN');
    if (open.length === 0) { _mon.lastTickAt = Date.now(); return; }
    nextDelay = MONITOR_ACTIVE_MS;
    // v10.16 wiring fix: the injected deps live on _mon.deps — reading
    // them off _mon directly left getDeepSignal/fetchers undefined and
    // the conviction re-vote (and with it EVERY alert) silently dead.
    const { getDeepSignal, depsForSignals, fetchIndiaQuotes, fetchIndexSpot, usdInrOf } = _mon.deps || {};
    const { send } = _mon;
    const usdInr = typeof usdInrOf === 'function' ? (_num(await usdInrOf()) || 84) : 84;
    // 1) LTP sweep (tick store first — free; injected fetchers fallback)
    for (const t of open) {
      const px = await ltpForManualTrade(t, { fetchIndiaQuotes, fetchIndexSpot });
      if (px > 0) t.__ltp = px;
    }
    // 2) conviction re-vote (30s throttle per trade; cached deep path)
    for (const t of open) {
      const now = Date.now();
      if (now - (t.__convictionAt || 0) < CONVICTION_EVERY_MS) continue;
      t.__convictionAt = now;
      if (typeof getDeepSignal !== 'function') continue;
      try {
        const deep = await getDeepSignal(t.symbol, t.market === 'GLOBALFUTURES' ? 'GLOBALFUTURES' : t.market, depsForSignals ? depsForSignals() : {});
        if (deep?.ok && deep.signal) {
          const c = manualConvictionOf(t, deep.signal);
          t.__conviction = { ...c, side: sideOf(deep.signal.side), at: now };
          await evaluateManualTradeAlerts(t, { send, conviction: t.__conviction, freshSignal: deep.signal, usdInr });
          if (t.lastState !== c.state) { t.lastState = c.state; _persist(); }
        } else {
          t.__conviction = { state: 'UNKNOWN', delta: null, currentScore: null, side: null, at: now };
        }
      } catch (e) {
        _mon.status.lastError = String(e?.message || e).slice(0, 140);
        // a THROWN deep call degrades exactly like an ok:false one —
        // UNKNOWN conviction (honest STALE banner), never a stale bar.
        t.__conviction = { state: 'UNKNOWN', delta: null, currentScore: null, side: null, at: now };
      }
    }
    _mon.lastTickAt = Date.now();
  } catch (e) {
    if (_mon) _mon.status.lastError = String(e?.message || e).slice(0, 140);
  } finally {
    if (_mon) {
      _mon.ticking = false;
      _mon.timer = setTimeout(_monitorTick, nextDelay);
      if (typeof _mon.timer.unref === 'function') _mon.timer.unref();
    }
  }
}

/**
 * Boot the manual-trade monitor (idempotent — same contract as
 * startInstaPushSink). Called from ai/routes.js registration.
 * @param {object} deps { getDeepSignal, depsForSignals, send, fetchIndiaQuotes, fetchIndexSpot, usdInrOf }
 */
export function startManualTradeMonitor(deps = {}) {
  if (_mon && _mon.timer) return;
  _mon = {
    timer: null, ticking: false, lastTickAt: null,
    deps,
    send: deps.send || (async () => ({ ok: false, error: 'no sender' })),
    status: { pushes: 0, lastPushAt: null, lastError: null },
  };
  _mon.timer = setTimeout(_monitorTick, 8_000);
  if (typeof _mon.timer.unref === 'function') _mon.timer.unref();
  console.log(`[manual-trades] monitor armed (5s LTP · 30s conviction re-vote · telegram on flip/SL/target) — ${(_state.trades || []).filter(t => t.status === 'OPEN').length} open`);
}

export function stopManualTradeMonitor() {
  if (_mon?.timer) { clearTimeout(_mon.timer); _mon.timer = null; }
}

export async function __monitorTickForTests() { await _monitorTick(); }
export function __monitorStateForTests() { return { alerts: _alerts, mon: _mon }; }
export function __setManualStateForTests(trades, nextId) {
  _state = { trades: trades || [], nextId: nextId || (trades?.length || 0) + 1 };
}
