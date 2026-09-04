// ============================================================
// server/ai/indiaOrders.js — INDIA (Dhan) EXECUTION GAUNTLET
// ------------------------------------------------------------
// v6.5 — the India twin of coindcxOrders.js. Same journal, same
// lock, same daily caps — different venue and clock:
//
//   1. KILL SWITCH      shared (one switch, both venues)
//   2. MODE GATE        indiaMode paper|live (typed LIVE, separate
//                       from crypto arming)
//   3. MARKET GATE      NSE open + LIVE entry window 09:30–15:00 IST
//   4. SIGNAL GATE      fresh server-side ensemble (deep run),
//                       STRONG for LIVE, relaxed for PAPER
//   5. RISK GATE        shared daily trades/loss caps, one position
//                       per symbol, ₹ cap per order, risk auto-fit
//   6. VENUE GATE       Dhan HQ v2 (market entry + protective
//                       STOP_LOSS_MARKET at the broker)
//
// The watcher enforces the intraday discipline the slip teaches:
// trailing SL ratchet + SQUARE-OFF AT 15:15 IST. The broker-side SL
// order is the belt; the watcher is the suspenders (site-down
// protection vs. TP2/target exits the broker can't know).
// ============================================================
import crypto from 'node:crypto';
import { isNseOpen } from './data.js';
import { dhanConnected, dhanPlaceOrder, dhanCancelOrder } from './dhan.js';
import { fetchTVIndiaBatch } from './data.js';
import { computeTrailSl, evaluateExecutionGate, buildTradePlan, fitPlanToRiskCap } from './ensemble.js';
import {
  loadConfig, loadJournal, saveJournal, withJournalLock, pushEntry, todayIST, dailyStats,
} from './coindcxOrders.js';

const r2 = (v) => (Number.isFinite(v) ? Math.round(v * 100) / 100 : null);

// ---------------- IST clock helpers ----------------
function istHM(now = new Date()) {
  try {
    const f = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit', hour12: false }).format(now);
    const [h, m] = f.split(':').map(Number);
    return (h * 60) + m; // minutes since IST midnight
  } catch { // rough UTC+5:30 fallback (non-Intl environments)
    return (((now.getUTCHours() + 5) * 60) + now.getUTCMinutes() + 30) % 1440;
  }
}
export const IST_SQUAREOFF = 15 * 60 + 15;  // 15:15 — intraday discipline
const IST_ENTRY_LAST = 15 * 60;             // 15:00 — LIVE entries stop
const IST_ENTRY_FIRST = 9 * 60 + 30;        // 09:30 — opening chop avoided

/**
 * executeIndiaSignal({ symbol, side, mode, qtyINR, getFreshIndiaSignal })
 * getFreshIndiaSignal(symbol) MUST return a fresh deep-run India signal
 * (injected by routes.js — client payloads are never trusted).
 */
export async function executeIndiaSignal(opts) {
  const { symbol, side, mode, qtyINR, getFreshIndiaSignal, source = 'manual' } = opts || {};
  const cfg = loadConfig();
  const sym = String(symbol || '').toUpperCase().replace(/[^A-Z0-9\-]/g, '');
  const wantMode = mode === 'live' ? 'live' : 'paper';
  const day = todayIST();
  const entry = { kind: 'ORDER', day, pair: sym, symbol: sym, market: 'INDIA', side, mode: wantMode, source };

  const reject = (reason, error, extra = {}) => withJournalLock(() => {
    const j = loadJournal();
    pushEntry(j, { ...entry, status: 'REJECTED', reason, ...extra });
    saveJournal(j);
  }).then(() => ({ ok: false, error: error || reason }));

  // --- gate 1: kill switch (shared) ---
  if (cfg.killSwitch) return reject('Kill switch ON — execution disabled');

  // --- gate 2: India mode (live) ---
  if (wantMode === 'live' && cfg.indiaMode !== 'live') {
    return reject('India LIVE mode is not enabled — type LIVE in the console first (India arming is separate from crypto)');
  }
  if (wantMode === 'live' && !dhanConnected()) {
    return reject('Dhan not connected — Client ID + Access Token required');
  }

  // --- gate 3: market clock (LIVE only; paper practice anytime) ---
  if (wantMode === 'live') {
    if (!isNseOpen()) return reject('NSE is closed — India LIVE orders only fire 09:15–15:30 IST on trading days');
    const mins = istHM();
    if (mins < IST_ENTRY_FIRST) return reject('Before 09:30 IST — opening chop window, LIVE entries blocked');
    if (mins > IST_ENTRY_LAST) return reject('After 15:00 IST — too late for a fresh intraday LIVE entry (square-off 15:15)');
  }

  // --- gate 4: fresh server-side India signal ---
  const signal = await getFreshIndiaSignal(sym);
  if (!signal) return reject('No fresh ensemble signal available for this symbol');

  // PAPER practice fallback — same honesty as the crypto path: synthesize
  // a practice plan at the live price, journal the real fresh grade.
  let effectiveSignal = signal;
  let synthNote = null;
  if (wantMode === 'paper' && (signal.side === 'FLAT' || !signal.plan)) {
    const reqSide = String(side || '').toUpperCase() === 'SHORT' ? 'SHORT' : 'LONG';
    const synthPlan = buildTradePlan({ side: reqSide, dir: reqSide === 'LONG' ? 1 : -1 }, { ltp: signal.ltp, ind: {} }, 'INDIA');
    if (synthPlan && signal.ltp > 0) {
      effectiveSignal = { ...signal, side: reqSide, plan: synthPlan };
      synthNote = `practice plan @ live price (fresh consensus: ${signal.side} ${signal.confidence}%)`;
    }
  }

  // --- gate 5: risk auto-fit (shared policy with crypto) ---
  const riskCap = Number(cfg.maxRiskPct) > 0 ? Number(cfg.maxRiskPct) : 5;
  let fitNote = null;
  const planRiskPct = Number(effectiveSignal?.plan?.riskPct);
  if (Number.isFinite(planRiskPct) && planRiskPct > riskCap) {
    if (wantMode === 'paper' || planRiskPct <= riskCap * 1.5) {
      const fitted = fitPlanToRiskCap(effectiveSignal, riskCap);
      if (fitted.note) {
        effectiveSignal = fitted.signal;
        fitNote = fitted.note;
      }
    }
  }

  const verdict = evaluateExecutionGate(effectiveSignal, {
    side: side || effectiveSignal.side,
    gates: { minConfidence: cfg.minConfidence, minAgreement: cfg.minAgreement },
    requireStrong: wantMode === 'live',
    maxAgeMs: wantMode === 'live' ? 90_000 : 600_000,
    maxRiskPct: cfg.maxRiskPct || 5,
    venue: 'INDIA',
  });
  if (!verdict.ok) {
    const hint = (Number(effectiveSignal?.plan?.riskPct) > riskCap)
      ? ` — widen "Max stop %" (currently ${riskCap}%) in Risk settings`
      : '';
    return reject(verdict.reason, `Signal gate: ${verdict.reason}${hint}`, {
      signal: { grade: signal.grade, conf: signal.confidence, agreement: signal.agreement },
    });
  }

  // --- sizing: whole shares, capped budget ---
  const price = Number(effectiveSignal.ltp);
  if (!(price > 0)) return { ok: false, error: 'No live price for sizing' };
  const budget = Math.min(Number(qtyINR) > 0 ? Number(qtyINR) : (cfg.indiaMaxOrderINR || 5000), cfg.indiaMaxOrderINR || 5000);
  if (budget < 100) return { ok: false, error: `Order size ₹${budget} below the ₹100 minimum` };
  let qty = Math.floor(budget / price);
  // v6.5 PRACTICE FALLBACK: many NIFTY names cost more than the budget
  // (MARUTI ₹12k, ULTRACEMCO ₹11k…). PAPER must never dead-end on share
  // price — it opens a 1-share practice position with an honest note.
  // LIVE honestly rejects: real money needs a real budget.
  let smallNote = null;
  if (qty < 1) {
    if (wantMode === 'paper') {
      qty = 1;
      smallNote = `practice 1-share position (₹${r2(price)}/share > budget ₹${budget} — raise "India Max ₹" for full sizing)`;
    } else {
      return { ok: false, error: `₹${budget} buys 0 shares of ${sym} @ ₹${r2(price)} — increase India Max ₹ in Risk settings` };
    }
  }
  const notional = qty * price;

  // --- FINAL MUTATION under the journal lock, FRESH caps re-check ---
  return withJournalLock(async () => {
    const j = loadJournal();
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
    if (j.positions.some(p => p.market === 'INDIA' && p.symbol === sym && p.status === 'OPEN')) {
      pushEntry(j, { ...entry, status: 'REJECTED', reason: 'India position already open for this symbol' });
      saveJournal(j);
      return { ok: false, error: `An open India position already exists for ${sym} (one-per-symbol rule)` };
    }

    // --- paper execution ---
    if (wantMode === 'paper') {
      const position = {
        id: crypto.randomUUID(), pair: sym, symbol: sym, side: effectiveSignal.side, mode: 'paper', market: 'INDIA', source,
        qty, entryPrice: price, notionalINR: r2(notional),
        sl: effectiveSignal.plan?.stopLoss ?? null, tp: effectiveSignal.plan?.target1 ?? null, tp2: effectiveSignal.plan?.target2 ?? null,
        initialRisk: r2(Math.abs(price - (effectiveSignal.plan?.stopLoss ?? price))),
        peakPrice: r2(price),
        signal: { grade: signal.grade, confidence: signal.confidence, agreement: signal.agreement, summary: synthNote || signal.summary },
        openedAt: Date.now(), status: 'OPEN',
      };
      j.positions.push(position);
      pushEntry(j, {
        ...entry, status: 'FILLED', qty, price: r2(price), notionalINR: r2(notional),
        signal: { grade: signal.grade, conf: signal.confidence, agreement: signal.agreement },
        reason: [verdict.reason, synthNote, fitNote, smallNote].filter(Boolean).join(' · '),
      });
      saveJournal(j);
      return { ok: true, mode: 'paper', position, filled: { qty, price: r2(price), notionalINR: r2(notional) }, ...(fitNote ? { fitted: fitNote } : {}), ...(smallNote ? { fitted: [fitNote, smallNote].filter(Boolean).join(' · ') } : {}) };
    }

    // --- LIVE: market entry + protective broker SL (SL-M at the plan stop) ---
    try {
      const entryOrder = await dhanPlaceOrder({ symbol: sym, side: effectiveSignal.side, quantity: qty, kind: 'ENTRY' });
      let slOrderId = null;
      if (entryOrder.orderId && effectiveSignal.plan?.stopLoss > 0) {
        try {
          const slOrder = await dhanPlaceOrder({
            symbol: sym, side: effectiveSignal.side, quantity: qty, kind: 'SL',
            triggerPrice: effectiveSignal.plan.stopLoss,
          });
          slOrderId = slOrder.orderId || null;
        } catch { /* protective SL failed → watcher still guards; journal it below */ }
      }
      const position = {
        id: crypto.randomUUID(), pair: sym, symbol: sym, side: effectiveSignal.side, mode: 'live', market: 'INDIA', source,
        exchangeOrderId: entryOrder.orderId, slOrderId,
        securityId: entryOrder.securityId || null,
        qty, entryPrice: price, notionalINR: r2(notional),
        sl: effectiveSignal.plan?.stopLoss ?? null, tp: effectiveSignal.plan?.target1 ?? null, tp2: effectiveSignal.plan?.target2 ?? null,
        initialRisk: r2(Math.abs(price - (effectiveSignal.plan?.stopLoss ?? price))),
        peakPrice: r2(price),
        signal: { grade: signal.grade, confidence: signal.confidence, agreement: signal.agreement, summary: signal.summary },
        openedAt: Date.now(), status: entryOrder.orderId ? 'OPEN' : 'UNKNOWN',
      };
      j.positions.push(position);
      pushEntry(j, {
        ...entry, status: entryOrder.orderId ? 'SUBMITTED' : 'SUBMITTED_UNKNOWN',
        qty, price: r2(price), notionalINR: r2(notional),
        exchangeOrderId: entryOrder.orderId, slOrderId,
        signal: { grade: signal.grade, conf: signal.confidence, agreement: signal.agreement },
        reason: [verdict.reason, fitNote, slOrderId ? `broker SL-M armed @ ₹${effectiveSignal.plan?.stopLoss}` : 'broker SL placement failed — watcher guarding only'].filter(Boolean).join(' · '),
      });
      saveJournal(j);
      return {
        ok: true, mode: 'live', orderId: entryOrder.orderId, slOrderId, position,
        filled: { qty, price: r2(price), notionalINR: r2(notional) },
        ...(fitNote ? { fitted: fitNote } : {}),
      };
    } catch (e) {
      pushEntry(j, { ...entry, status: 'FAILED', reason: String(e?.message || e).slice(0, 200) });
      saveJournal(j);
      return { ok: false, error: `Dhan order failed: ${e?.message || e}` };
    }
  });
}

// ---------------- India watcher: trailing + SL/TP + 15:15 square-off ----------------
/**
 * Runs under the journal lock (every 60s from routes.js — only while
 * NSE is open; outside hours nothing can move but the square-off pass
 * which routes runs once at 15:16). Closes via Dhan MARKET order for
 * live positions, simulated for paper. Cancels the leftover broker SL
 * when closing for a non-SL reason (TP2 / square-off / manual).
 */
export async function watchIndiaPositions({ sendTelegram } = {}) {
  return withJournalLock(async () => {
    const j = loadJournal();
    const cfg = loadConfig();
    const open = j.positions.filter(p => p.market === 'INDIA' && p.status === 'OPEN');
    if (open.length === 0) return [];
    const closures = [];
    let dirty = false;

    // prices: one TV batch for all open India symbols
    const rows = await fetchTVIndiaBatch([...new Set(open.map(p => p.symbol))]).catch(() => ({}));
    const ltpOf = (sym) => {
      const v = Number(rows[sym]?.ltp);
      return Number.isFinite(v) && v > 0 ? v : null;
    };

    const mins = istHM();
    const squareOffNow = mins >= IST_SQUAREOFF;

    for (const p of open) {
      const price = ltpOf(p.symbol);
      if (price == null) continue;
      const long = p.side === 'LONG';

      // v6.5 trailing ratchet — same math as the crypto watcher
      if (cfg.trailEnabled && p.sl != null && p.sl > 0) {
        const prevPeak = Number(p.peakPrice);
        const peak = long
          ? Math.max(Number.isFinite(prevPeak) && prevPeak > 0 ? prevPeak : price, price)
          : Math.min(Number.isFinite(prevPeak) && prevPeak > 0 ? prevPeak : price, price);
        p.peakPrice = r2(peak);
        const risk = Number(p.initialRisk) > 0 ? Number(p.initialRisk) : Math.abs(p.entryPrice - p.sl);
        if (risk > 0) {
          const trail = computeTrailSl({
            side: p.side, entryPrice: p.entryPrice, peakPrice: peak, currentSl: p.sl,
            initialRisk: risk, price, armR: cfg.trailArmR, offsetR: cfg.trailOffsetR,
          });
          if (trail) {
            // live positions: the broker SL-M follows the trail (cancel +
            // replace) — awaited INSIDE the lock so no journal write can
            // escape the mutex discipline.
            if (p.mode === 'live' && p.slOrderId) {
              await dhanCancelOrder(p.slOrderId).catch(() => { /* best-effort */ });
            }
            if (p.mode === 'live' && trail.sl > 0) {
              try {
                const o = await dhanPlaceOrder({ symbol: p.symbol, side: p.side, quantity: p.qty, kind: 'SL', triggerPrice: trail.sl });
                if (o?.orderId) p.slOrderId = o.orderId;
              } catch { /* watcher still guards even if broker SL replace failed */ }
            }
            pushEntry(j, {
              kind: 'TRAIL', day: todayIST(), pair: p.pair, symbol: p.symbol, market: 'INDIA',
              reason: `SL ${trail.stage}: ₹${p.sl} → ₹${trail.sl} (peak ₹${r2(peak)})`, from: p.sl, to: trail.sl,
            });
            p.sl = trail.sl;
            p.trailing = trail.stage;
          }
        }
        dirty = true;
      }

      let close = null;
      if (squareOffNow) close = { reason: 'Intraday square-off 15:15 IST', price, kind: 'TIME' };
      else if (p.sl != null && (long ? price <= p.sl : price >= p.sl)) close = { reason: 'STOP-LOSS hit', price, kind: 'SL' };
      else if (p.tp2 != null && (long ? price >= p.tp2 : price <= p.tp2)) close = { reason: 'TARGET-2 hit', price, kind: 'TP2' };
      if (!close) continue;

      let closed = false;
      if (p.mode === 'live' && dhanConnected()) {
        try {
          const exit = await dhanPlaceOrder({ symbol: p.symbol, side: long ? 'SELL' : 'BUY', quantity: p.qty, kind: 'ENTRY' });
          closed = !!exit.orderId;
        } catch (e) {
          pushEntry(j, { kind: 'WATCH_ERROR', day: todayIST(), pair: p.pair, symbol: p.symbol, market: 'INDIA', reason: String(e?.message || e).slice(0, 200) });
          dirty = true;
          continue; // retry next tick
        }
      } else {
        closed = true; // paper close always executable
      }
      if (!closed) continue;

      // non-SL closes: the protective broker SL order must not linger
      if (p.mode === 'live' && p.slOrderId && close.kind !== 'SL') {
        dhanCancelOrder(p.slOrderId).catch(() => { /* best-effort */ });
      }

      const pnlINR = (long ? price - p.entryPrice : p.entryPrice - price) * p.qty;
      p.status = 'CLOSED';
      p.closedAt = Date.now();
      p.closePrice = price;
      p.pnlINR = r2(pnlINR);
      p.closeReason = close.reason;
      dirty = true;
      pushEntry(j, {
        kind: 'CLOSE', day: todayIST(), pair: p.pair, symbol: p.symbol, market: 'INDIA', mode: p.mode,
        qty: p.qty, entryPrice: p.entryPrice, closePrice: price, pnlINR: r2(pnlINR), reason: close.reason,
      });
      closures.push({ pair: p.pair, mode: p.mode, pnlINR: p.pnlINR, reason: close.reason });
    }

    if (dirty) saveJournal(j);
    if (typeof sendTelegram === 'function' && closures.length > 0) {
      try {
        await sendTelegram(`🇮🇳 <b>AI Trading India</b> — position closed\n${closures.map(c => `• ${c.pair} (${c.mode}) — ${c.reason}: ₹${c.pnlINR > 0 ? '+' : ''}${c.pnlINR}`).join('\n')}`);
      } catch { /* best-effort */ }
    }
    return closures;
  });
}

// ---------------- manual close ----------------
export async function closeIndiaPosition(positionId) {
  return withJournalLock(async () => {
    const j = loadJournal();
    const p = j.positions.find(x => x.id === positionId || x.exchangeOrderId === positionId);
    if (!p || p.market !== 'INDIA' || (p.status !== 'OPEN' && p.status !== 'UNKNOWN')) {
      return { ok: false, error: 'India position not found / already closed' };
    }
    const rows = await fetchTVIndiaBatch([p.symbol]).catch(() => ({}));
    const ltp = Number(rows[p.symbol]?.ltp);
    const price = Number.isFinite(ltp) && ltp > 0 ? ltp : p.entryPrice;
    if (p.mode === 'live' && dhanConnected()) {
      try {
        const exit = await dhanPlaceOrder({ symbol: p.symbol, side: p.side === 'LONG' ? 'SELL' : 'BUY', quantity: p.qty, kind: 'ENTRY' });
        if (!exit.orderId) return { ok: false, error: 'Dhan close failed: no orderId returned' };
      } catch (e) {
        return { ok: false, error: `Dhan close failed: ${e?.message || e}` };
      }
      if (p.slOrderId) dhanCancelOrder(p.slOrderId).catch(() => { /* best-effort */ });
    }
    const long = p.side === 'LONG';
    const pnlINR = (long ? price - p.entryPrice : p.entryPrice - price) * p.qty;
    p.status = 'CLOSED';
    p.closedAt = Date.now();
    p.closePrice = price;
    p.pnlINR = r2(pnlINR);
    p.closeReason = 'Manual close';
    pushEntry(j, { kind: 'CLOSE', day: todayIST(), pair: p.pair, symbol: p.symbol, market: 'INDIA', mode: p.mode, qty: p.qty, entryPrice: p.entryPrice, closePrice: price, pnlINR: r2(pnlINR), reason: 'Manual close' });
    saveJournal(j);
    return { ok: true, position: p };
  });
}
