// ============================================================
// server/ai/agent.js — THE SUPERINTELLIGENCE AUTO-AGENT (v7.0 PRO)
// ------------------------------------------------------------
// A prop-desk style AUTONOMOUS trading agent living server-side.
// It does EXACTLY what the user asked:
//
//   • fetches the LIVE CoinDCX wallet (spot + futures margin)
//   • sizes every trade from that wallet (risk % of equity)
//   • AUTO-ENTRY: v9.6 — 75+ AI SCORE (superIntel blend) ya the old
//     STRONG-committee bar, jo bhi pehle qualify kare
//   • exactly N trades per day (default 3 — user's spec)
//   • v7.0 PRO 3-TIER EXIT: T1 → close 40% + SL→breakeven,
//     T2 → close 40% + SL→T1, RUNNER (20%) trails to time-exit/SL
//   • AUTO-EXIT: SL/TP/trailing via the watchers + native
//     exchange TP/SL + agent TIME-EXIT (max hold)
//   • daily loss cap → agent stands down for the day
//   • every decision lands in the agent log + Telegram
//
// Safety inheritance (NOT re-implemented — inherited):
//   kill switch · allowAuto · LIVE arming · daily caps ·
//   one-per-pair · concentration guard · leverage sanity —
//   every entry passes the SAME executeFuturesSignal/executeSignal
//   gauntlet a manual click passes. The agent has ZERO private
//   paths to money.
//
// Loop cadence: 30s (unref'd). Paper mode is the default; LIVE
// needs (1) typed LIVE in Risk settings, (2) allowAuto ON,
// (3) typed LIVE when starting the agent, (4) CoinDCX connected.
// ============================================================
import { loadJSON, saveJSON } from '../lib/store.js';
import { durablePut } from '../mcp/durable.js';
import { coindcxConnected } from '../mcp/coindcx.js';
import { walletSnapshot, executeFuturesSignal, closeFuturesPosition, fetchUsdInr, inrOfUsdt } from './futures.js';
import { loadConfig, loadJournal, dailyStats, todayIST } from './coindcxOrders.js';

const AGENT_CONFIG_FILE = 'ai-agent-config.json';
const AGENT_STATE_FILE = 'ai-agent-state.json';
const LOG_RING = 120;

// v9.7: the loop cadence — 30s (was 60s). Faster trend-flip reaction +
// quicker entry after a qualifying signal; wallet fetch is throttled
// to ~60s inside the tick so the exchange API load stays flat.
export const AGENT_TICK_SEC = 30;

const r2 = (v) => (Number.isFinite(v) ? Math.round(v * 100) / 100 : null);
const nowMin = () => Date.now() / 60000;

// ---------------- config (durable) ----------------
export const AGENT_DEFAULTS = {
  enabled: false,             // agent ON/OFF
  mode: 'paper',              // 'paper' | 'notify' | 'live' — execution mode
  desks: { futures: true, spot: true, india: true }, // v7.0: spot auto-trade desk ON (was false)
  maxTradesPerDay: 3,         // USER SPEC: daily ke 3 trades
  minAiScore: 75,             // v9.6 USER SPEC: 75+ AI score → auto entry
  minConfidence: 80,          // legacy STRONG-committee bar (AI-score path YA ye)
  minAgreement: 0.75,         // …and stricter agreement
  riskPerTradePct: 1.5,       // % of wallet EQUITY risked per trade (SL-based)
  maxLeverage: 3,             // futures leverage ceiling for the agent
  cooldownMin: 20,            // minutes between agent entries
  maxHoldMin: 90,             // agent time-exit (auto square-off)
  dailyLossCapPct: 3,         // −3% of equity → agent stands down today
  minEquityINR: 300,          // below this the agent refuses to trade (honest)
  // ---- v7.0 PRO TRADER: 3-tier partial take-profit ----
  partialTpEnabled: true,     // T1/T2/runner tiered exits on agent positions
  tp1ClosePct: 40,            // % of ORIGINAL qty closed at T1
  tp2ClosePct: 40,            // % of ORIGINAL qty closed at T2
  runnerPct: 20,              // % riding as the trailing runner (derived 100−T1−T2)
  breakEvenAfterTp1: true,    // SL → entry once T1 books (risk-free runner)
  // ---- v9.7 USER SPEC: "auto exit as per market trend" ----
  // TREND-FLIP exit (board prints a qualifying OPPOSITE-side signal →
  // position cut) applies to MANUAL positions too, not just the
  // agent's own. Time-exit/partial-TP stay agent-owned — a manual
  // swing holder sirf trend-flip se protect hota hai.
  manageManualPositions: true,
};

export function loadAgentConfig() {
  const saved = loadJSON(AGENT_CONFIG_FILE, {}) || {};
  return {
    ...AGENT_DEFAULTS,
    ...saved,
    desks: { ...AGENT_DEFAULTS.desks, ...(saved.desks || {}) },
  };
}
export function saveAgentConfig(cfg) {
  saveJSON(AGENT_CONFIG_FILE, cfg);
  try { durablePut(AGENT_CONFIG_FILE, cfg); } catch { /* best-effort */ }
  return cfg;
}

const NUM_CLAMPS = {
  maxTradesPerDay: [1, 20],
  minAiScore: [55, 95],
  minConfidence: [55, 95],
  minAgreement: [0.5, 0.95],
  riskPerTradePct: [0.25, 10],
  maxLeverage: [1, 10],
  cooldownMin: [1, 240],
  maxHoldMin: [5, 1440],
  dailyLossCapPct: [0.5, 50],
  minEquityINR: [0, 100_000],
  // v7.0 PRO TRADER split knobs (T1% + T2% ≤ 90 enforced below)
  tp1ClosePct: [10, 80],
  tp2ClosePct: [10, 80],
};
export function updateAgentConfig(patch = {}) {
  const cfg = loadAgentConfig();
  const next = { ...cfg };
  for (const [key, [lo, hi]] of Object.entries(NUM_CLAMPS)) {
    if (patch[key] != null) {
      const n = Number(patch[key]);
      if (Number.isFinite(n)) next[key] = Math.round(Math.max(lo, Math.min(hi, n)) * 100) / 100;
    }
  }
  if (patch.desks && typeof patch.desks === 'object') {
    for (const k of ['futures', 'spot', 'india']) {
      if (patch.desks[k] != null) next.desks[k] = !!patch.desks[k];
    }
  }
  // v7.0 PRO TRADER toggles (booleans — not in NUM_CLAMPS)
  if (patch.partialTpEnabled != null) next.partialTpEnabled = !!patch.partialTpEnabled;
  if (patch.breakEvenAfterTp1 != null) next.breakEvenAfterTp1 = !!patch.breakEvenAfterTp1;
  // v9.7: trend-flip exit on manual positions (user spec default ON)
  if (patch.manageManualPositions != null) next.manageManualPositions = !!patch.manageManualPositions;
  // v7.0: keep the split honest — T1+T2 ≤ 90, runner ≥ 10, sums shown
  if (next.tp1ClosePct + next.tp2ClosePct > 90) {
    const scale = 90 / (next.tp1ClosePct + next.tp2ClosePct);
    next.tp1ClosePct = Math.round(next.tp1ClosePct * scale);
    next.tp2ClosePct = 90 - next.tp1ClosePct;
  }
  next.runnerPct = Math.max(10, Math.round(100 - next.tp1ClosePct - next.tp2ClosePct));
  if (patch.mode === 'paper' || patch.mode === 'notify') next.mode = patch.mode;
  return saveAgentConfig(next);
}

// ---------------- state (durable) ----------------
function freshState() {
  return {
    runningSince: null, lastScanAt: null, scans: 0,
    lastEntryAt: null, lastEntryPair: null,
    lastWallet: null,
    pausedToday: null, // { day, reason }
    lastSkip: null,   // v9.7: { key, text, at } — the CURRENT wait/blocker reason (panel strip)
    alerted: {},      // v9.7: stand-down telegram alerts already sent today (key → day)
    log: [],
  };
}
function loadState() {
  const saved = loadJSON(AGENT_STATE_FILE, null);
  return saved && typeof saved === 'object' ? { ...freshState(), ...saved } : freshState();
}
let _state = loadState();
function persistState() {
  saveJSON(AGENT_STATE_FILE, _state);
  try { durablePut(AGENT_STATE_FILE, _state); } catch { /* best-effort */ }
}

function log(level, text) {
  _state.log.push({ ts: Date.now(), level, text: String(text).slice(0, 240) });
  if (_state.log.length > LOG_RING) _state.log = _state.log.slice(-LOG_RING);
  const tag = level === 'entry' ? '🟢' : level === 'exit' ? '🔴' : level === 'error' ? '⚠️' : level === 'skip' ? '⋯' : 'ℹ️';
  console.log(`[agent] ${tag} ${text}`);
}

// ---------------- agent trade accounting (journal is truth) ----------------
/** Agent trades today = journal ORDER entries with source 'agent' (non-rejected). */
function agentTradesToday(j) {
  const day = todayIST();
  // v6.11: NOTIFIED = alert-only — the 3-per-day TRADE quota counts real entries.
  return (j?.entries || []).filter(e => e.day === day && e.kind === 'ORDER' && e.source === 'agent' && e.status !== 'REJECTED' && e.status !== 'NOTIFIED');
}
/** Realized P&L (INR) of agent-sourced closes today. v7.0: PARTIAL_TP
 *  legs count the moment they fill (a booked winner is real money —
 *  and a booked loss must respect the daily loss cap). */
function agentRealizedToday(j) {
  const day = todayIST();
  return (j?.entries || [])
    .filter(e => e.day === day && (e.kind === 'CLOSE' || e.kind === 'PARTIAL_TP') && e.source === 'agent')
    .reduce((a, e) => a + (e.pnlINR || 0), 0);
}
function openAgentPositions(j) {
  return (j?.positions || []).filter(p => p.source === 'agent' && (p.status === 'OPEN' || p.status === 'UNKNOWN'));
}
/**
 * v9.7 — positions the agent's TREND-FLIP exit protects. Own trades
 * always; MANUAL crypto/futures trades too when manageManualPositions
 * (user spec "auto exit as per market trend" — default ON). India
 * positions are the India watcher's job, never touched here.
 */
function openManagedPositions(j, cfg) {
  const open = (j?.positions || []).filter(p =>
    (p.status === 'OPEN' || p.status === 'UNKNOWN')
    && (p.market === 'FUTURES' || p.market === 'CRYPTO' || p.pair?.startsWith('B-') || /INR$/.test(String(p.pair || ''))));
  if (cfg?.manageManualPositions === false) return open.filter(p => p.source === 'agent');
  return open;
}

// ---------------- start / stop ----------------
export async function agentStart({ mode, liveConfirmPhrase } = {}) {
  const cfg = loadAgentConfig();
  const trading = loadConfig();
  // v6.11: notify = alert-only agent (telegram pings, no orders)
  const wantMode = mode === 'live' ? 'live' : mode === 'paper' ? 'paper' : mode === 'notify' ? 'notify' : cfg.mode;
  if (wantMode === 'live') {
    if (String(liveConfirmPhrase || '').trim().toUpperCase() !== 'LIVE') {
      const e = new Error('Starting the agent in LIVE requires liveConfirmPhrase="LIVE" (typed confirmation)');
      e.status = 400; throw e;
    }
    if (!coindcxConnected()) { const e = new Error('CoinDCX not connected — connect the API key first'); e.status = 400; throw e; }
    if (trading.mode !== 'live' || !trading.allowAuto) {
      const e = new Error('LIVE agent needs Risk settings: mode LIVE (typed) + Auto-execution ON');
      e.status = 400; throw e;
    }
  }
  const next = { ...cfg, enabled: true, mode: wantMode };
  saveAgentConfig(next);
  _state.runningSince = Date.now();
  _state.pausedToday = null;
  log('info', `AGENT STARTED (${wantMode.toUpperCase()}) — max ${next.maxTradesPerDay} trades/day · risk ${next.riskPerTradePct}%/trade · SL-based wallet sizing · PRO exits: T1 ${next.partialTpEnabled ? `${next.tp1ClosePct}%+BE-lock` : 'off'} · T2 ${next.tp2ClosePct}% · runner ${next.runnerPct}% trailing`);
  persistState();
  // v9.7: honest LIVE-start warning — the #1 "agent chal raha hai par
  // trade nahi karta" cause was a wallet below the equity floor. Tell
  // the user AT START, not 3 days later in a log they never open.
  let warning = null;
  if (wantMode === 'live' && coindcxConnected()) {
    const w = await Promise.race([
      walletSnapshot().catch(() => null),
      new Promise((r) => { const t = setTimeout(() => r(null), 3500); t.unref?.(); }),
    ]);
    const eq = w?.equityINR ?? _state.lastWallet?.equityINR ?? null;
    if (eq != null && eq < next.minEquityINR) {
      warning = `Wallet equity ₹${r2(eq)} agent floor (₹${next.minEquityINR}) se neeche hai — agent scan karega par entry TAB tak nahi karega jab tak CoinDCX wallet top-up nahi hota. 08/06 panel me AGENT BLOCKERS strip live reason dikhata hai.`;
    }
  }
  return { ok: true, config: next, ...(warning ? { warning } : {}) };
}
export function agentStop({ reason = 'user' } = {}) {
  const cfg = loadAgentConfig();
  saveAgentConfig({ ...cfg, enabled: false });
  log('info', `AGENT STOPPED (${reason})`);
  persistState();
  return { ok: true, config: { ...cfg, enabled: false } };
}

// ---------------- v7.0 PRO TRADER: wallet-based sizing preview ----------------
/**
 * The sizing math the agent WILL use on its next STRONG entry — the
 * same formula _tick() runs, surfaced for the UI so the user sees
 * "agent will invest ₹X on next signal" BEFORE it happens:
 *
 *   FUTURES: riskINR = equity × riskPct → riskUSDT = riskINR / usdInr
 *            → qty = riskUSDT / |entry − SL|
 *            → marginUSDT = (qty × entry) / leverage (60% deployable cap)
 *   SPOT:    budgetINR = min(maxOrderINR, (riskINR / riskPct) × 100,
 *            60% of deployable spot INR)
 *
 * Pure function — no wallet fetch (callers pass a snapshot/stale view
 * and it degrades to the practice ₹10,000 equity when unconnected).
 */
export function agentSizingPreview({ cfg, equityINR, usdInr, plan, market, wallet, trading }) {
  const c = cfg || loadAgentConfig();
  const t = trading || loadConfig();
  const eq = Number(equityINR) > 0 ? Number(equityINR) : 10_000;
  const fx = Number(usdInr) > 0 ? Number(usdInr) : 84;
  const p = plan || null;
  const wantFutures = market != null
    ? String(market).toUpperCase() === 'FUTURES'
    : true; // legacy default: plan with a stop distance prices like futures
  const entry = Number(p?.entry);
  const sl = Number(p?.stopLoss);
  const stopDist = Number.isFinite(entry) && Number.isFinite(sl) ? Math.abs(entry - sl) : null;
  const riskINR = r2(eq * (c.riskPerTradePct / 100));

  if (p && wantFutures && stopDist > 0) {
    // futures math (SL-distance qty + leveraged margin + deployable cap)
    const riskUSDT = riskINR / fx;
    const qty = riskUSDT / stopDist;
    const lev = Math.max(1, Math.min(c.maxLeverage, Math.floor(95 / Math.max(0.5, (p.riskPct || 5)))));
    let marginUSDT = (qty * entry) / lev;
    const deployable = Number(wallet?.deployableFuturesUSDT) > 0 ? Number(wallet.deployableFuturesUSDT) : (eq * 0.5 / fx);
    const capped = marginUSDT > deployable * 0.6;
    if (capped) marginUSDT = deployable * 0.6;
    return {
      desk: 'FUTURES', riskINR, riskPct: c.riskPerTradePct, equityINR: r2(eq), usdInr: r2(fx),
      entry: r2(entry), stopLoss: r2(sl), stopDist: r2(stopDist),
      qty: Math.round(qty * 1e4) / 1e4,
      leverage: lev,
      marginUSDT: Math.round(marginUSDT * 1000) / 1000,
      marginINR: r2(marginUSDT * fx),
      deployableUSDT: r2(deployable), capped: !!capped,
      note: `₹${r2(riskINR)} risk (${c.riskPerTradePct}% of ₹${r2(eq)}) → ${Math.round(qty * 1e4) / 1e4} qty → ${Math.round(marginUSDT * 1000) / 1000} USDT margin at ${lev}x${capped ? ' (60% deployable cap applied)' : ''}`,
    };
  }

  if (p && (p.riskPct || 0) > 0) {
    // spot math (risk budget → notional at the plan's risk %)
    const deployableSpotINR = Number(wallet?.deployableSpotINR) > 0 ? Number(wallet.deployableSpotINR) : eq;
    const budgetINR = Math.min(
      t.maxOrderINR || 1000,
      Math.max(100, (riskINR / (p.riskPct || 5)) * 100),
      Math.max(100, deployableSpotINR * 0.6),
    );
    return {
      desk: 'SPOT', riskINR, riskPct: c.riskPerTradePct, equityINR: r2(eq), usdInr: r2(fx),
      entry: r2(entry), stopLoss: r2(sl),
      budgetINR: r2(budgetINR), deployableSpotINR: r2(deployableSpotINR),
      note: `₹${r2(riskINR)} risk (${c.riskPerTradePct}% of ₹${r2(eq)}) → ₹${r2(budgetINR)} spot order @ ₹${r2(entry)}`,
    };
  }

  return {
    desk: null, riskINR, riskPct: c.riskPerTradePct, equityINR: r2(eq), usdInr: r2(fx),
    note: `₹${r2(riskINR)} risk budget ready (${c.riskPerTradePct}% of ₹${r2(eq)}) — plan ka intezaar next STRONG signal se`,
  };
}

// ---------------- the agent loop ----------------
let _ticking = false;
/**
 * One agent cycle. routes.js calls this every 60s (unref'd interval).
 * `deps` = the same depsForSignals() the boards use; `sendTelegram` best-effort.
 */
export async function agentTick(deps, sendTelegram) {
  if (_ticking) return; // never overlap cycles
  _ticking = true;
  try {
    await _tick(deps, sendTelegram);
  } catch (e) {
    log('error', `cycle error: ${String(e?.message || e).slice(0, 160)}`);
    persistState();
  } finally {
    _ticking = false;
  }
}

async function _tick(deps, sendTelegram) {
  const cfg = loadAgentConfig();
  const trading = loadConfig();
  _state.scans++;
  _state.lastScanAt = Date.now();
  if (_state.runningSince == null) _state.runningSince = _state.lastScanAt;

  // ---- hard stops (v9.7: each records its blocker for the panel strip) ----
  if (!cfg.enabled) return;
  if (trading.killSwitch) {
    maybeLogSkip('kill_switch', 'kill switch ON — agent idle');
    await alertOnce(sendTelegram, 'kill_switch', '🤖 <b>AGENT idle</b> — kill switch ON hai (Risk settings).');
    persistState(); return;
  }
  if (cfg.mode === 'live' && (!coindcxConnected() || trading.mode !== 'live' || !trading.allowAuto)) {
    maybeLogSkip('live_preconditions', 'LIVE preconditions lost (connection/arming/auto) — agent idle');
    await alertOnce(sendTelegram, 'live_preconditions', '🤖 <b>AGENT idle</b> — LIVE preconditions toot gayi (CoinDCX connect / Risk mode LIVE / Auto-execution ON check karo).');
    persistState(); return;
  }

  // ---- day rollover ----
  const day = todayIST();
  if (_state.pausedToday && _state.pausedToday.day !== day) _state.pausedToday = null;

  // ---- journal state ----
  const j = loadJournal();
  const tradesToday = agentTradesToday(j);
  const openAgent = openAgentPositions(j);

  // ---- wallet (the sizing source of truth; v9.7 throttled to ~60s
  // now that the loop runs at 30s — exchange API load stays flat) ----
  let wallet = null;
  if (coindcxConnected()) {
    const lw = _state.lastWallet;
    if (lw && Date.now() - (lw.at || 0) < 55_000) {
      wallet = { equityINR: lw.equityINR, usdInr: lw.usdInr, deployableFuturesUSDT: lw.deployableFuturesUSDT, deployableSpotINR: lw.deployableSpotINR };
    } else {
      wallet = await walletSnapshot().catch(e => { log('error', `wallet fetch failed: ${String(e?.message || e).slice(0, 120)}`); return null; });
      if (wallet) _state.lastWallet = { equityINR: wallet.equityINR, usdInr: wallet.usdInr, deployableFuturesUSDT: wallet.deployableFuturesUSDT, deployableSpotINR: wallet.deployableSpotINR, at: wallet.fetchedAt };
    }
  }
  const equityINR = wallet?.equityINR > 0 ? wallet.equityINR
    : (_state.lastWallet?.equityINR > 0 ? _state.lastWallet.equityINR : 10_000); // paper practice equity
  const usdInr = wallet?.usdInr || (await fetchUsdInr());
  // v9.7: FUTURES viability — a connected wallet with <2 USDT free
  // margin can NEVER fund a futures entry (margin floor). Filter those
  // candidates BEFORE picking best, so spot candidates aren't starved
  // by a futures pick that dies at the margin gate every cycle.
  const futuresViable = !coindcxConnected()
    ? true // practice-equity fallback keeps paper futures alive
    : ((wallet?.deployableFuturesUSDT ?? _state.lastWallet?.deployableFuturesUSDT ?? 0) >= 2);

  // ---- daily loss cap (agent's own, on top of the global ₹ cap) ----
  if (_state.pausedToday) {
    persistState(); return;
  }
  const agentPnl = agentRealizedToday(j);
  const lossCapINR = equityINR * (cfg.dailyLossCapPct / 100);
  if (tradesToday.length > 0 && agentPnl <= -lossCapINR) {
    _state.pausedToday = { day, reason: `daily loss cap hit: ₹${r2(agentPnl)} ≤ −₹${r2(lossCapINR)} (${cfg.dailyLossCapPct}% of equity)` };
    log('skip', `STANDING DOWN for today — ${_state.pausedToday.reason}`);
    await notify(sendTelegram, `🤖 <b>AGENT stood down</b> — ${_state.pausedToday.reason}\nKal phir se 3 fresh trades.`);
    persistState(); return;
  }

  // ---- equity floor ----
  if (equityINR < cfg.minEquityINR) {
    maybeLogSkip('equity_floor', `wallet equity ₹${r2(equityINR)} < floor ₹${cfg.minEquityINR} — not trading (wallet top-up needed)`);
    await alertOnce(sendTelegram, 'equity_floor',
      `🤖 <b>AGENT entry paused</b> — wallet equity ₹${r2(equityINR)} floor ₹${cfg.minEquityINR} se neeche hai.\nCoinDCX wallet top-up karo — scans turant resume honge.`);
    persistState(); return;
  }

  // ---- time-exit sweep (auto exit of aging agent positions) ----
  const closures = [];
  const timeExited = new Set(); // v9.6: ids closed this tick (trend-flip must not double-close)
  for (const p of openAgent) {
    const ageMin = (Date.now() - (p.openedAt || 0)) / 60000;
    if (ageMin >= cfg.maxHoldMin) {
      const out = p.market === 'FUTURES'
        ? await closeFuturesPosition(p.id).catch(e => ({ ok: false, error: String(e?.message || e) }))
        : await (async () => {
          const { closePosition } = await import('./coindcxOrders.js');
          return closePosition(p.id).catch(e => ({ ok: false, error: String(e?.message || e) }));
        })();
      if (out?.ok) {
        timeExited.add(p.id);
        // v7.0.2: honest TOTAL pnl — booked partial legs + the final leg
        // (p.pnlINR alone is only the remaining runner's leg).
        const totalPnl = (out.position?.pnlINR ?? 0) + (out.position?.bookedPnlINR ?? 0);
        const hasBooked = (out.position?.bookedPnlINR ?? 0) !== 0;
        closures.push({ pair: p.pair, pnlINR: totalPnl, reason: `TIME-EXIT after ${Math.round(ageMin)}m${hasBooked ? ' (incl. booked T1/T2 legs)' : ''}` });
        log('exit', `TIME-EXIT ${p.pair} after ${Math.round(ageMin)}m — pnl ₹${r2(totalPnl)}${hasBooked ? ` (final ${r2(out.position?.pnlINR ?? 0)} + booked ${r2(out.position?.bookedPnlINR ?? 0)})` : ''}`);
      } else {
        log('error', `time-exit failed for ${p.pair}: ${String(out?.error || '').slice(0, 100)}`);
      }
    }
  }
  if (closures.length > 0) {
    await notify(sendTelegram, `🤖 <b>AGENT time-exit</b>\n${closures.map(c => `• ${c.pair} — ${c.reason}: ₹${c.pnlINR ?? '?'}`).join('\n')}`);
  }

  // ---- scan the boards ONCE (cached server-side; cheap) — the exit
  // sweeps need the live consensus too, so this runs BEFORE the
  // quota/cooldown gates (a flipped position must exit even when
  // today's entry quota is done). ----
  const { getSignals } = await import('./signals.js');
  const boards = [];
  if (cfg.desks.futures) boards.push('FUTURES');
  if (cfg.desks.spot) boards.push('CRYPTO');
  const scans = await Promise.all(boards.map(m => getSignals(m, deps, { limit: 20 }).catch(() => null)));
  const signalOf = (s) => Number(s?.superIntel?.aiScore ?? 0);
  // v9.6 USER SPEC GATE: 75+ AI score qualifies on its own; the old
  // STRONG-committee bar (grade + confidence + agreement) still works.
  const qualifies = (s) => !!(s && s.plan && s.side && (
    signalOf(s) >= cfg.minAiScore || (
      s.grade === 'STRONG' && s.executable
      && (s.confidence ?? 0) >= cfg.minConfidence
      && (s.agreement ?? 0) >= cfg.minAgreement
    )
  ));

  // ---- v9.6 TREND-FLIP auto-exit ("auto exit as per market trend"):
  // the board now prints a QUALIFYING signal on the OPPOSITE side of
  // a held pair → the position is cut immediately. v9.7: this now
  // protects MANUAL positions too when manageManualPositions (user
  // spec, default ON) — a manual swing holder exits the moment the
  // trend flips against them. A cooldown is stamped so the flip side
  // can only re-enter after cooldownMin — no whipsaw churn. ----
  const managed = openManagedPositions(j, cfg);
  for (const p of managed) {
    if (timeExited.has(p.id)) continue;
    const posSide = /^(L|B)/i.test(String(p.side || '')) ? 'BUY' : 'SELL';
    const pair = String(p.pair || '');
    let flipped = null;
    for (const board of scans) {
      if (!board?.ok) continue;
      for (const s of (board.signals || [])) {
        if (pairOfSignal(s) !== pair) continue;
        const raw = String(s.side || '').toUpperCase();
        const sSide = raw === 'SHORT' || raw === 'SELL' ? 'SELL' : 'BUY';
        if (sSide !== posSide && qualifies(s)) { flipped = s; break; }
      }
      if (flipped) break;
    }
    if (!flipped) continue;
    const out = p.market === 'FUTURES'
      ? await closeFuturesPosition(p.id).catch(e => ({ ok: false, error: String(e?.message || e) }))
      : await (async () => {
          const { closePosition } = await import('./coindcxOrders.js');
          return closePosition(p.id).catch(e => ({ ok: false, error: String(e?.message || e) }));
        })();
    if (out?.ok) {
      _state.lastEntryAt = Date.now(); // the flip side re-enters only after cooldown
      const totalPnl = (out.position?.pnlINR ?? 0) + (out.position?.bookedPnlINR ?? 0);
      const manual = p.source !== 'agent';
      log('exit', `TREND-FLIP EXIT${manual ? ' (manual-held)' : ''} ${p.pair} — board flipped ${flipped.side} (AI ${signalOf(flipped) || flipped.confidence}%) → cut at ₹${r2(totalPnl)} total`);
      await notify(sendTelegram, `🤖 <b>AGENT trend-flip exit</b>${manual ? ' (manual position)' : ''} — ${p.pair}\nBoard ab ${flipped.side} side pe ${signalOf(flipped) || flipped.confidence}% conviction: position ₹${r2(totalPnl)} pe cut. Re-entry cooldown (${cfg.cooldownMin}m) ke baad.`);
    } else {
      log('error', `trend-flip close failed for ${p.pair}: ${String(out?.error || '').slice(0, 100)}`);
    }
  }

  // ---- 3-trade daily cap ----
  if (tradesToday.length >= cfg.maxTradesPerDay) {
    maybeLogSkip('quota', `quota ${tradesToday.length}/${cfg.maxTradesPerDay} used — waiting for IST midnight`);
    persistState(); return;
  }

  // ---- cooldown between entries ----
  if (_state.lastEntryAt && (Date.now() - _state.lastEntryAt) / 60000 < cfg.cooldownMin) {
    const left = Math.max(1, Math.ceil(cfg.cooldownMin - (Date.now() - _state.lastEntryAt) / 60000));
    maybeLogSkip('cooldown', `entry cooldown — ${left}m baaki (flip-side re-entry guard)`);
    persistState(); return;
  }

  // ---- candidates (boards already scanned above) ----
  if (cfg.desks.futures && !futuresViable && coindcxConnected()) {
    maybeLogSkip('futures_margin', `futures wallet margin < 2 USDT — futures candidates skip, sirf spot scan (${cfg.desks.spot ? 'spot ON' : 'spot OFF — kuch trade nahi hoga'})`);
  }
  let candidates = [];
  for (let bi = 0; bi < boards.length; bi++) {
    const board = scans[bi];
    const m = boards[bi];
    if (!board?.ok) continue;
    if (m === 'FUTURES' && !futuresViable) continue; // v9.7: margin floor can't fund it
    for (const s of (board.signals || [])) {
      if (!qualifies(s)) continue;
      if ((s.plan.riskPct ?? 0) > (trading.maxRiskPct || 5)) continue;
      // already positioned on this pair? skip (one-per-pair anyway)
      if ((j.positions || []).some(p => p.pair === pairOfSignal(s) && (p.status === 'OPEN' || p.status === 'UNKNOWN'))) continue;
      candidates.push(s);
    }
  }
  if (candidates.length === 0) {
    maybeLogSkip('no_candidates', `scan: 0 candidates ≥ ${cfg.minAiScore} AI score / ${cfg.minConfidence}% conf + ${Math.round(cfg.minAgreement * 100)}% agreement${cfg.desks.futures && !futuresViable ? ' (futures margin ke karan sirf spot scope)' : ''}`);
    persistState(); return;
  }
  candidates.sort((a, b) => (signalOf(b) - signalOf(a)) || (b.confidence - a.confidence));
  const best = candidates[0];

  // ---- wallet-based sizing ----
  const riskINR = equityINR * (cfg.riskPerTradePct / 100);
  const wantFutures = best.market === 'FUTURES';
  // v7.0: the sizing math is LOGGED transparently before execution —
  // the user can audit "₹X risk → Y qty → Z margin at Lx" in the feed
  {
    const stopDist = Math.abs(best.plan.entry - best.plan.stopLoss);
    if (wantFutures && stopDist > 0) {
      const lev = Math.max(1, Math.min(cfg.maxLeverage, Math.floor(95 / (best.plan.riskPct || 5))));
      const q = riskINR / usdInr / stopDist;
      log('info', `SIZING ${best.symbol}: ₹${r2(riskINR)} risk (${cfg.riskPerTradePct}% of ₹${r2(equityINR)}) → ${Math.round(q * 1e4) / 1e4} qty → ${r2((q * best.plan.entry) / lev)} USDT margin at ${lev}x`);
    } else {
      const budget = Math.min(
        trading.maxOrderINR || 1000,
        Math.max(100, (riskINR / (best.plan.riskPct || 5)) * 100),
        Math.max(100, (wallet?.deployableSpotINR ?? equityINR) * 0.6),
      );
      log('info', `SIZING ${best.symbol}: ₹${r2(riskINR)} risk (${cfg.riskPerTradePct}% of ₹${r2(equityINR)}) → ₹${r2(budget)} spot order`);
    }
  }
  let out = null;
  if (wantFutures) {
    const riskUSDT = riskINR / usdInr;
    const stopDist = Math.abs(best.plan.entry - best.plan.stopLoss);
    if (!(stopDist > 0)) { persistState(); return; }
    const qty = riskUSDT / stopDist;
    const lev = Math.max(1, Math.min(cfg.maxLeverage, Math.floor(95 / (best.plan.riskPct || 5))));
    let marginUSDT = (qty * best.plan.entry) / lev;
    // never commit more than 60% of the deployable futures margin
    const deployable = wallet?.deployableFuturesUSDT ?? (equityINR * 0.5 / usdInr);
    const capUSDT = deployable * 0.6;
    if (marginUSDT > capUSDT) marginUSDT = capUSDT;
    marginUSDT = Math.round(marginUSDT * 1000) / 1000;
    if (marginUSDT < 2) {
      maybeLogSkip('margin too small', `futures margin ${marginUSDT} USDT < 2 — equity ₹${r2(equityINR)} / risk ${cfg.riskPerTradePct}% too small for this stop`);
      persistState(); return;
    }
    const { getFreshFuturesSignalForExec } = await import('./signals.js');
    out = await executeFuturesSignal({
      symbol: best.symbol, side: best.side,
      mode: cfg.mode === 'live' ? 'live' : cfg.mode === 'notify' ? 'notify' : 'paper',
      marginUSDT, leverage: lev,
      getFreshSignal: (pair) => getFreshFuturesSignalForExec(pair, deps),
      wantAuto: cfg.mode === 'live',
      source: 'agent',
      sendTelegram,
    });
  } else {
    // spot (INR)
    const budgetINR = Math.min(
      trading.maxOrderINR || 1000,
      Math.max(100, (riskINR / (best.plan.riskPct || 5)) * 100),
      Math.max(100, (wallet?.deployableSpotINR ?? equityINR) * 0.6),
    );
    const { executeSignal } = await import('./coindcxOrders.js');
    const { getFreshSignalForExec } = await import('./signals.js');
    out = await executeSignal({
      symbol: best.symbol, side: best.side,
      mode: cfg.mode === 'live' ? 'live' : cfg.mode === 'notify' ? 'notify' : 'paper',
      qtyINR: budgetINR, leverage: 1,
      getFreshSignal: (pair) => getFreshSignalForExec(pair, deps),
      wantAuto: cfg.mode === 'live',
      source: 'agent',
      sendTelegram,
    });
  }

  if (out?.ok) {
    _state.lastEntryAt = Date.now();
    _state.lastEntryPair = pairOfSignal(best);
    const f = out.filled || {};
    if (out.mode === 'notify') {
      log('entry', `NOTIFY ${wantFutures ? 'FUTURES' : 'SPOT'} ${best.symbol} ${best.side} (${best.confidence}% conf) — alert-only, koi order nahi${out.telegramSent ? '' : ' (telegram off)'}`);
    } else {
      log('entry', `AUTO-ENTRY ${wantFutures ? 'FUTURES' : 'SPOT'} ${best.symbol} ${best.side} (${best.confidence}% conf) — ${f.qty ?? '?'} @ ${f.price ?? best.plan.entry}${wantFutures ? ` · ${f.leverage ?? '?'}x · margin ${f.marginUSDT ?? '?'} USDT` : ''} · SL ${best.plan.stopLoss} · T2 ${best.plan.target2}`);
      await notify(sendTelegram,
        `🤖 <b>AGENT AUTO-ENTRY</b> — ${wantFutures ? '⚡ Global Futures' : '₿ Spot'} ${best.symbol} ${best.side}\n` +
        `Confidence ${best.confidence}% · agreement ${Math.round((best.agreement || 0) * 100)}% · trade ${tradesToday.length + 1}/${cfg.maxTradesPerDay} today\n` +
        `${f.qty ?? '?'} @ ${f.price ?? best.plan.entry}${wantFutures ? ` · ${f.leverage ?? 1}x · margin ${Math.round(f.marginUSDT ?? 0)} USDT` : ''}\n` +
        `SL ${best.plan.stopLoss} · T2 ${best.plan.target2} · time-exit ${cfg.maxHoldMin}m`,
      );
    }
  } else {
    log('skip', `entry rejected — ${best.symbol} ${best.side}: ${String(out?.error || '').slice(0, 120)}`);
  }
  persistState();
}

// small helpers ------------------------------------------------
let _lastSkip = { key: '', at: 0 };
function maybeLogSkip(key, text) {
  // v9.7: EVERY skip records the reason in state — the status view's
  // BLOCKERS strip shows the user WHY the agent isn't entering (the
  // old flow logged to console where nobody looked).
  _state.lastSkip = { key, text: String(text).slice(0, 200), at: Date.now() };
  // dedupe repeated skip reasons to once per 10 minutes (console/log ring)
  if (_lastSkip.key === key && Date.now() - _lastSkip.at < 10 * 60_000) return;
  _lastSkip = { key, at: Date.now() };
  log('skip', text);
}
/** v9.7: one Telegram ping per stand-down-class reason per day (no spam). */
async function alertOnce(sendTelegram, key, text) {
  try {
    const day = todayIST();
    _state.alerted = _state.alerted || {};
    if (_state.alerted[key] === day) return;
    _state.alerted[key] = day;
    await notify(sendTelegram, text);
  } catch { /* best-effort */ }
}
async function notify(sendTelegram, text) {
  try { if (typeof sendTelegram === 'function') await sendTelegram(text); } catch { /* best-effort */ }
}

/** Normalize a signal's journal pair (one-per-pair check parity). */
function pairOfSignal(s) {
  if (s.market === 'FUTURES') return `B-${s.symbol}_USDT`;
  if (s.market === 'CRYPTO') return `${s.symbol}INR`;
  return s.symbol;
}

// ---------------- status view (the panel's single call) ----------------
/**
 * Everything the Superintelligence Agent panel needs in ONE payload:
 * config + live state + today's agent trades + wallet + top picks per
 * desk + open agent positions. Never throws; boards degrade to null.
 *
 * v9.2.1 LATENCY CONTRACT — the panel polls this every 15s, so the
 * status must answer in milliseconds even on a cold/slow host:
 *   • wallet: serve the last full view instantly; refresh in the
 *     background (first-ever fetch is bounded to 3.5s).
 *   • picks: boards are read warmOnly — never computed inline; a cold
 *     board is warmed in the background and appears on the next poll.
 * This kills the old failure mode where a cold status call ran THREE
 * full board scans (>45s on slow hosts) and every panel poll timed
 * out behind it ("Agent status unavailable — API/proxy issue").
 */
let _lastWalletView = null; // in-memory only — serve-while-refreshing

export async function agentStatus(deps) {
  const cfg = loadAgentConfig();
  const trading = loadConfig();
  const j = loadJournal();
  const tradesToday = agentTradesToday(j);
  const openAgent = openAgentPositions(j);
  const agentPnl = r2(agentRealizedToday(j));

  const rememberWallet = (w) => {
    if (!w) return;
    _lastWalletView = w;
    _state.lastWallet = { equityINR: w.equityINR, usdInr: w.usdInr, deployableFuturesUSDT: w.deployableFuturesUSDT, deployableSpotINR: w.deployableSpotINR, at: w.fetchedAt };
  };

  let wallet = null;
  if (coindcxConnected()) {
    const job = walletSnapshot().catch(() => null);
    if (_lastWalletView) {
      wallet = _lastWalletView; // instant — refresh lands in background
      job.then(rememberWallet).catch(() => {});
    } else {
      // first fetch after boot: bounded wait, late-fill in background
      wallet = await Promise.race([job, new Promise((r) => { setTimeout(() => r(null), 3500).unref?.(); })]);
      if (wallet) rememberWallet(wallet);
      else job.then(rememberWallet).catch(() => {});
    }
  }
  // v9.7: freshest view wins (served wallet > last persisted snapshot)
  const equityINR = wallet?.equityINR ?? _state.lastWallet?.equityINR ?? null;

  // top picks per desk — v9.2.1 warmOnly: read the cached boards only.
  // A cold board triggers a background warm and shows up on the next
  // 15s poll instead of stalling this response for tens of seconds.
  const picks = {};
  if (deps) {
    const { getSignals } = await import('./signals.js').catch(() => ({ getSignals: null }));
    if (getSignals) {
      const wantMarkets = ['INDIA', 'FUTURES', 'CRYPTO'];
      await Promise.all(wantMarkets.map(async (m) => {
        const b = await getSignals(m, deps, { limit: 6, warmOnly: true }).catch(() => null);
        if (b?.ok) {
          picks[m] = (b.signals || []).filter(s => s.grade === 'STRONG' || s.grade === 'ACTION').slice(0, 3)
            .map(s => ({ symbol: s.symbol, side: s.side, grade: s.grade, confidence: s.confidence, aiScore: s.superIntel?.aiScore ?? null, ltp: s.ltp, pair: pairOfSignal(s),
              plan: s.plan ? { entry: s.plan.entry, stopLoss: s.plan.stopLoss, target2: s.plan.target2, riskPct: s.plan.riskPct } : null }));
        }
      }));
    }
  }

  // v7.0 PRO TRADER: what the agent WOULD invest on the next STRONG
  // signal — the top pick across the ENABLED desks, sized against the
  // live wallet (falls back to the last-known/practice equity).
  let preview = null;
  try {
    const deskOrder = [];
    if (cfg.desks.futures && picks.FUTURES?.length) deskOrder.push({ market: 'FUTURES', pick: picks.FUTURES[0] });
    if (cfg.desks.spot && picks.CRYPTO?.length) deskOrder.push({ market: 'CRYPTO', pick: picks.CRYPTO[0] });
    const top = deskOrder.find(x => x?.pick?.plan) || null;
    preview = agentSizingPreview({
      cfg,
      equityINR: wallet?.equityINR ?? (_state.lastWallet?.equityINR ?? null),
      usdInr: wallet?.usdInr ?? (_state.lastWallet?.usdInr ?? null),
      plan: top?.pick?.plan ?? null,
      market: top?.market ?? null,
      wallet,
      trading,
    });
    if (top?.pick) preview.symbol = top.pick.symbol;
  } catch { preview = null; }

  const day = todayIST();
  const lossCapINR = (equityINR ?? 10_000) * (cfg.dailyLossCapPct / 100);
  const paused = _state.pausedToday && _state.pausedToday.day === day ? _state.pausedToday : null;

  // ---- v9.7 AGENT BLOCKERS — the "entry kyun nahi ho raha" strip.
  // Live-computed hard blockers + the latest soft skip reason, so the
  // panel never again leaves the user guessing while the agent waits.
  const blockers = [];
  if (!cfg.enabled) {
    blockers.push({ key: 'disabled', text: 'Agent STOPPED hai — START button dabao' });
  } else {
    if (trading.killSwitch) blockers.push({ key: 'kill_switch', text: '🛑 Kill switch ON (Risk settings) — agent idle' });
    if (cfg.mode === 'live' && (!coindcxConnected() || trading.mode !== 'live' || !trading.allowAuto)) {
      blockers.push({ key: 'live_preconditions', text: '🔴 LIVE preconditions missing — CoinDCX connect + Risk mode LIVE + Auto-execution ON' });
    }
    if (paused) blockers.push({ key: 'loss_cap', text: `🩹 Stood down — ${paused.reason}` });
    const eq = equityINR ?? _state.lastWallet?.equityINR ?? null;
    if (eq != null && eq < cfg.minEquityINR) {
      blockers.push({ key: 'equity_floor', text: `💰 Wallet equity ₹${r2(eq)} < floor ₹${cfg.minEquityINR} — CoinDCX top-up karo, tab tak entry nahi` });
    }
    if (tradesToday.length >= cfg.maxTradesPerDay) {
      blockers.push({ key: 'quota', text: `🎯 Daily quota done ${tradesToday.length}/${cfg.maxTradesPerDay} — IST midnight reset` });
    } else if (_state.lastEntryAt && (Date.now() - _state.lastEntryAt) / 60000 < cfg.cooldownMin) {
      const left = Math.max(1, Math.ceil(cfg.cooldownMin - (Date.now() - _state.lastEntryAt) / 60000));
      blockers.push({ key: 'cooldown', text: `⏳ Cooldown — ${left}m baadi next entry try` });
    }
    if (coindcxConnected() && ((_state.lastWallet?.deployableFuturesUSDT ?? 0) < 2)) {
      blockers.push({ key: 'futures_margin', soft: true, text: '⚡ Futures margin < 2 USDT — sirf SPOT desk se entry hoga' });
    }
    // soft: latest wait reason (usually "no qualifying signal") — info, not a fault
    const ls = _state.lastSkip;
    if (ls && Date.now() - (ls.at || 0) < 10 * 60_000 && !blockers.some(b => b.key === ls.key)) {
      blockers.push({ key: ls.key, soft: true, text: `ℹ️ ${ls.text}` });
    }
  }
  const nextScanInSec = _state.lastScanAt
    ? Math.max(0, AGENT_TICK_SEC - (Math.floor((Date.now() - _state.lastScanAt) / 1000) % AGENT_TICK_SEC))
    : null;

  return {
    ok: true,
    engine: 'SUPERINTELLIGENCE AGENT v7.0 PRO',
    config: cfg,
    trading: { mode: trading.mode, allowAuto: trading.allowAuto, killSwitch: trading.killSwitch, connected: coindcxConnected() },
    state: {
      running: cfg.enabled,
      runningSince: _state.runningSince,
      lastScanAt: _state.lastScanAt,
      scans: _state.scans,
      lastEntryAt: _state.lastEntryAt,
      lastEntryPair: _state.lastEntryPair,
      pausedToday: paused,
      lastWallet: _state.lastWallet,
      // v9.7: loop transparency — cadence + countdown + wait reason
      tickSec: AGENT_TICK_SEC,
      nextScanInSec,
      lastSkip: _state.lastSkip,
      log: (_state.log || []).slice(-40).reverse(),
    },
    today: {
      day,
      trades: tradesToday.map(e => ({
        ts: e.ts, pair: e.symbol || e.pair, side: e.side, mode: e.mode, market: e.market,
        status: e.status, qty: e.qty ?? null, price: e.price ?? null,
        leverage: e.leverage ?? null, marginUSDT: e.marginUSDT ?? null, reason: e.reason ?? null,
      })),
      tradesCount: tradesToday.length,
      maxTrades: cfg.maxTradesPerDay,
      realizedPnlINR: agentPnl,
      lossCapINR: r2(lossCapINR),
      paused,
    },
    openPositions: openAgent.map(p => ({
      id: p.id, pair: p.pair, market: p.market, side: p.side, mode: p.mode, qty: p.qty,
      entryPrice: p.entryPrice, sl: p.sl, tp: p.tp ?? null, tp2: p.tp2, leverage: p.leverage ?? null,
      marginUSDT: p.marginUSDT ?? null, openedAt: p.openedAt,
      ageMin: p.openedAt ? Math.round((Date.now() - p.openedAt) / 60000) : null,
      maxHoldMin: cfg.maxHoldMin,
      // v7.0 PRO TRADER exit-stage state
      tp1Hit: !!p.tp1Hit, tp2Hit: !!p.tp2Hit,
      bookedPnlINR: p.bookedPnlINR ?? null,
      bookedPnlUSDT: p.bookedPnlUSDT ?? null,
      remainingQty: p.qty ?? null,
      originalQty: p.originalQty ?? null,
      exitStage: p.exitStage || 'ENTRY',
    })),
    wallet,
    picks,
    sizingPreview: preview,
    // v9.7: the panel's AGENT BLOCKERS strip — why the agent is (not) entering
    blockers,
  };
}

// ---------------- test hooks ----------------
export function __resetAgentForTests() {
  _state = freshState();
  persistState();
  saveAgentConfig({ ...AGENT_DEFAULTS });
  _lastSkip = { key: '', at: 0 };
  _lastWalletView = null;
}
export function __setAgentStateForTests(s) { _state = { ...freshState(), ...s }; }
export function __agentLogForTests() { return _state.log; }
export { pairOfSignal };
