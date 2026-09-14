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
import {
  loadConfig, loadJournal, dailyStats, todayIST,
  getPositionsWithPnl, withJournalLock, saveJournal, pushEntry,
} from './coindcxOrders.js';
// v10.1 accuracy upgrade (B4): pair-level correlation for the entry guard
import { pairCorrelation } from './correlation.js';
// v10.2: near-miss diagnostics + V2 model flag exposure (Step 1)
import { v2ModelsEnabled } from './models.js';
// v10.6 Pro Upgrade #2 (Kelly-lite): calibration buckets → realized edge
import { trustReport, __testables as __trustTestables } from './trust.js';
// v10.6 Pro Upgrade #6 (slippage-aware execution)
import { readDepth, estimateSlippagePct, splitOrderForSlippage } from './orderFlowDepth.js';

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
  desks: { futures: true, spot: true, india: true, global: true }, // v7.0 spot ON · v10.4 GLOBAL equity-futures SIM desk ON
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
  // ---- v10.1 ACCURACY UPGRADE (Track B) ----
  // B2: ATR-adaptive time-exit — fast movers (high ATR%) get a SHORTER
  // window (signal goes stale faster), slow movers get a LONGER one
  // (targets need time). Base window stays maxHoldMin.
  dynamicTimeExit: true,
  // B4: correlation guard — a new entry >0.7 correlated with an open
  // position is the same bet twice; skip it (concentration-risk rule).
  correlationGuard: true,
  // B3: rolling win-rate floor — last N agent trades winning < this %
  // → soft self-downgrade LIVE→paper + Telegram alert.
  minRollingWinRate: 35,
  rollingWindow: 10,
  // v10.2 Step 3: quorum penalty — thin committee (<5 voters) AI-score bump
  // (was hardcoded +10; now config-tunable 0-15)
  quorumPenalty: 10,
  // ---- v10.6 EDGE-ADAPTIVE SIZING (Pro Upgrade #2: Kelly-lite) ----
  // OFF by default — enable with AI_ENABLE_KELLY_SIZING=true or this
  // knob. When ON, riskPerTradePct becomes the CEILING: the realized
  // edge of the signal's confidence bucket (trust.js calibration, ≥10
  // settled) sizes the trade at HALF-Kelly, never above the ceiling.
  kellySizing: false,
  // ---- v10.8 NEAR-MISS AUTO-TRADE (user spec: "Near Miss ke trade
  // mat chhodo — jo HIGHEST AI Score + high confidence ho usko auto
  // trade lagao, entry + exit + trade ke hisaab se extension") ----
  // When no signal clears the full bar (AI score / STRONG committee)
  // this scan-cycle, the single BEST near-miss (highest AI score,
  // high confidence, full quorum) can still be entered — capped,
  // journal-tagged, and managed with the SAME exit gauntlet.
  nearMissAutoTrade: true,    // master switch (default ON — user spec)
  nearMissScoreGap: 10,       // AI score within this many points BELOW the effective bar still qualifies
  nearMissMinConfidence: 70,  // "high confidence" floor for a near-miss entry
  nearMissMaxPerDay: 1,       // quality guard: max near-miss entries/day (they're lower-conviction)
  // ---- v10.8 WINNER EXTENSION ("trade ke hisaab se extension") ----
  // At time-exit, a position that is IN PROFIT with NO opposite
  // qualifying signal gets its window EXTENDED (each extension =
  // +winnerExtendPct% of its dynamic window, max winnerExtendMax
  // times) and SL moved to breakeven — winners get room to run,
  // losers still get cut at the original window. Applies to AGENT
  // positions only (manual positions keep the flip/time rules).
  winnerExtendEnabled: true,
  winnerExtendPct: 50,        // % of the dynamic window added per extension
  winnerExtendMax: 2,         // max extensions per position
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
  // v10.2 Step 3: quorum penalty range
  quorumPenalty: [0, 15],
  // v10.8 near-miss auto-trade knobs
  nearMissScoreGap: [0, 20],
  nearMissMinConfidence: [55, 95],
  nearMissMaxPerDay: [0, 5],
  // v10.8 winner-extension knobs
  winnerExtendPct: [10, 100],
  winnerExtendMax: [0, 4],
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
    for (const k of ['futures', 'spot', 'india', 'global']) {
      if (patch.desks[k] != null) next.desks[k] = !!patch.desks[k];
    }
  }
  // v7.0 PRO TRADER toggles (booleans — not in NUM_CLAMPS)
  if (patch.partialTpEnabled != null) next.partialTpEnabled = !!patch.partialTpEnabled;
  if (patch.breakEvenAfterTp1 != null) next.breakEvenAfterTp1 = !!patch.breakEvenAfterTp1;
  // v9.7: trend-flip exit on manual positions (user spec default ON)
  if (patch.manageManualPositions != null) next.manageManualPositions = !!patch.manageManualPositions;
  // v10.1 Track-B toggles
  if (patch.dynamicTimeExit != null) next.dynamicTimeExit = !!patch.dynamicTimeExit;
  if (patch.correlationGuard != null) next.correlationGuard = !!patch.correlationGuard;
  // v10.6 Kelly-lite toggle
  if (patch.kellySizing != null) next.kellySizing = !!patch.kellySizing;
  // v10.8 near-miss auto-trade + winner-extension toggles
  if (patch.nearMissAutoTrade != null) next.nearMissAutoTrade = !!patch.nearMissAutoTrade;
  if (patch.winnerExtendEnabled != null) next.winnerExtendEnabled = !!patch.winnerExtendEnabled;
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
    // v10.1 B2: per-position entry volatility (pair → { atrPct, at }) —
    // the ATR% the position was OPENED with, driving its dynamic
    // time-exit window. Missing entry (pre-upgrade positions / manual)
    // → base cfg.maxHoldMin.
    entryMeta: {},
    // v10.1 B3: soft-downgrade latch — { at, winRate, trades } once the
    // rolling win-rate floor tripped a LIVE→paper downgrade (re-arms
    // only when the user re-starts the agent).
    winRateDowngraded: null,
    // v10.2 Step 1: near-miss signals from the last scan (top-3 closest
    // signals that ALMOST qualified — diagnostic for "kyun nahi enter kiya")
    lastNearMisses: [],
    // v10.2 Step 5: futures margin restore alert flag — prevents spam,
    // fires once when margin drops below 2 USDT, resets+notifies when
    // margin restores above 2 USDT.
    futuresMarginAlerted: false,
    // v10.8 PRO #4: the frozen mandate — captured at START, immutable
    // for the session, released on STOP (the journal MANDATE entry is
    // the permanent audit record).
    mandate: null,
    log: [],
  };
}
function loadState() {
  const saved = loadJSON(AGENT_STATE_FILE, null);
  return saved && typeof saved === 'object' ? { ...freshState(), ...saved } : freshState();
}
let _state = loadState();
/** v10.3.1: durable boot-restore hook — _state was loaded at module-eval
 * time (BEFORE the pre-listen durable restore rehydrated the disk file
 * on a fresh Render boot). Re-read so a restart resumes with the real
 * quota/log/exposure state instead of a blank one. */
export function __reloadStateForBoot() { _state = loadState(); }
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

// ============================================================
// v10.8 PRO #4 — BOUNDED-AUTONOMY MANDATE (Vibe-Trading port)
// ------------------------------------------------------------
// A FROZEN, immutable risk-cap contract captured at agent START.
// The saved config stays user-owned, but MID-SESSION the agent can
// only ever get STRICTER: any change that would LOOSEN a risk cap
// (more trades, more risk %, more leverage, longer hold…) is clamped
// to the frozen value until the agent is STOPPED and re-STARTED —
// a bug or bad admin action can't quietly widen the agent's limits
// while it's trading. Every freeze lands in the trade journal as an
// immutable record of exactly which caps were active per session.
// ============================================================
/** Each cap's "tighter of the two" rule — the value that risks LESS. */
export const MANDATE_CAPS = {
  maxTradesPerDay: (a, b) => Math.min(a, b),
  riskPerTradePct: (a, b) => Math.min(a, b),
  maxLeverage: (a, b) => Math.min(a, b),
  dailyLossCapPct: (a, b) => Math.min(a, b),   // lower stand-down trigger = stricter
  minEquityINR: (a, b) => Math.max(a, b),      // higher floor = stricter
  cooldownMin: (a, b) => Math.max(a, b),       // longer wait = stricter
  maxHoldMin: (a, b) => Math.min(a, b),        // shorter hold = stricter
  minAiScore: (a, b) => Math.max(a, b),        // higher bar = stricter
  minConfidence: (a, b) => Math.max(a, b),
  minAgreement: (a, b) => Math.max(a, b),
  minRollingWinRate: (a, b) => Math.max(a, b),
  quorumPenalty: (a, b) => Math.max(a, b),
};

function _deepFreeze(o) {
  Object.freeze(o);
  for (const v of Object.values(o)) if (v && typeof v === 'object' && !Object.isFrozen(v)) _deepFreeze(v);
  return o;
}

/** Capture the mandate at START. PURE (no side effects). */
export function freezeMandate(cfg, mode) {
  const caps = {};
  for (const k of Object.keys(MANDATE_CAPS)) {
    const v = Number(cfg?.[k]);
    caps[k] = Number.isFinite(v) ? v : null;
  }
  return _deepFreeze({ frozenAt: Date.now(), mode: String(mode || cfg?.mode || 'paper'), caps: _deepFreeze(caps) });
}

/**
 * The effective config for THIS tick: current config with any
 * mid-session LOOSENING clamped back to the frozen mandate. PURE.
 * @returns {{cfg: object, clamped: string[]}} fields that were clamped.
 */
export function mandateEffectiveCfg(cfg, mandate) {
  if (!mandate?.caps) return { cfg, clamped: [] };
  const out = { ...cfg };
  const clamped = [];
  for (const [k, tighter] of Object.entries(MANDATE_CAPS)) {
    const frozen = Number(mandate.caps[k]);
    const now = Number(cfg?.[k]);
    if (Number.isFinite(frozen) && Number.isFinite(now) && tighter(now, frozen) !== now) {
      out[k] = frozen;
      clamped.push(k);
    }
  }
  return { cfg: out, clamped };
}

/** Journal audit entry — the immutable record of the session's caps. */
async function journalMandateEntry(mandate, trading) {
  try {
    await withJournalLock(async () => {
      const j = loadJournal();
      pushEntry(j, {
        day: todayIST(), kind: 'MANDATE', source: 'agent', market: 'AGENT',
        text: `AGENT MANDATE FROZEN (${mandate.mode}) — caps: ${Object.entries(mandate.caps)
          .filter(([, v]) => v != null).map(([k, v]) => `${k}=${v}`).join(', ')}`
          .slice(0, 400),
        caps: { ...mandate.caps }, frozenAt: mandate.frozenAt, mode: mandate.mode,
        riskMode: trading?.mode ?? null,
      });
      saveJournal(j);
    });
  } catch { /* best-effort audit */ }
}

// ============================================================
// v10.8 — NEAR-MISS AUTO-TRADE + WINNER EXTENSION (pure cores)
// ============================================================
/**
 * The full-qualification bar for one signal (quorum-aware), shared by
 * the qualifier and the near-miss gate so the gap math is one truth.
 * PURE.
 */
export function effectiveScoreBar(cfg, s) {
  const vc = Number(s?.voters ?? s?.participating ?? 0);
  return vc >= 5 ? Number(cfg.minAiScore) : Number(cfg.minAiScore) + Number(cfg.quorumPenalty ?? 10);
}

/**
 * Near-miss gate — is this signal CLOSE to the bar but not over it,
 * with high confidence and a full quorum? PURE.
 * @returns {null|{aiScore:number, needScore:number, gap:number, confidence:number, voters:number}}
 */
export function nearMissEntryGate(cfg, s) {
  if (cfg?.nearMissAutoTrade === false) return null;
  if (Number(cfg?.nearMissMaxPerDay) <= 0) return null;
  if (!s?.plan || !s.side) return null;
  if (s.executable === false) return null;
  const grade = String(s.grade || '').toUpperCase();
  if (grade !== 'STRONG' && grade !== 'ACTION') return null; // WATCH noise is not a near-miss
  const vc = Number(s.voters ?? s.participating ?? 0);
  if (vc < 5) return null; // quorum-honest: thin-committee near-miss is noise
  const conf = Number(s.confidence ?? 0);
  if (conf < Number(cfg?.nearMissMinConfidence ?? 70)) return null;
  const ai = Number(s.superIntel?.aiScore ?? 0);
  const bar = effectiveScoreBar(cfg, s);
  const gap = Number(cfg?.nearMissScoreGap ?? 10);
  if (ai >= bar) return null;         // already fully qualifies — not a near-miss
  if (ai < bar - gap) return null;    // too far below the bar
  return { aiScore: ai, needScore: bar, gap, confidence: Math.round(conf), voters: vc };
}

/** Near-miss entries today (journal NEAR_MISS markers, source 'agent'). */
export function nearMissEntriesToday(j) {
  const day = todayIST();
  return (j?.entries || []).filter(e => e.day === day && e.kind === 'NEAR_MISS' && e.source === 'agent');
}

/**
 * Winner-extension window math. PURE.
 * baseWindowMin + extensions × extendPct% of base, rounded to minutes.
 */
export function effectiveHoldWindowMin(baseWindowMin, extensions, extendPct) {
  const base = Number(baseWindowMin) > 0 ? Number(baseWindowMin) : 90;
  const ext = Math.max(0, Math.floor(Number(extensions) || 0));
  const pct = Number(extendPct) > 0 ? Number(extendPct) : 50;
  return Math.round(base * (1 + (pct / 100) * ext));
}

/**
 * Winner-extension eligibility. PURE.
 * A position may extend its time-exit window only when: extension is
 * ON, under the max count, the position is IN PROFIT, and the board
 * has NOT printed a qualifying opposite-side signal (that's a
 * trend-flip exit, not an extension).
 */
export function extensionEligible({ enabled, extensions, maxExtensions, pnlPct, oppositeQualifying, source }) {
  if (enabled === false) return false;
  if (Number(extensions) >= Math.max(0, Number(maxExtensions) || 0)) return false;
  if (String(source || '').toLowerCase() === 'manual') return false; // agent positions only
  if (oppositeQualifying) return false; // flip beats extension — always
  return Number(pnlPct) > 0;             // only winners earn room
}

/**
 * Move an open position's SL to its entry price (breakeven) in the
 * journal — the watcher reads p.sl, so this arms the risk-free
 * runner immediately. Only ever TIGHTENS (long: sl<entry→entry;
 * short: sl>entry→entry). Returns true when moved.
 */
async function moveAgentSlToBreakeven(posId) {
  return withJournalLock(async () => {
    const j = loadJournal();
    const pos = (j.positions || []).find(x => x.id === posId);
    if (!pos || (pos.status !== 'OPEN' && pos.status !== 'UNKNOWN')) return false;
    const entry = Number(pos.entryPrice);
    if (!(entry > 0)) return false;
    const isLong = /^(L|B)/i.test(String(pos.side || ''));
    const sl = Number(pos.sl);
    const improves = !Number.isFinite(sl) || (isLong ? sl < entry : sl > entry);
    if (!improves) return false;
    pos.sl = entry;
    pos.slMovedAt = Date.now();
    pushEntry(j, {
      day: todayIST(), kind: 'SL', source: 'agent', market: pos.market || 'CRYPTO',
      symbol: pos.pair, positionId: pos.id,
      text: `WINNER-EXTENSION breakeven lock — SL ${sl} → entry ${entry} (extension granted)`,
      from: Number.isFinite(sl) ? sl : null, to: entry,
    });
    saveJournal(j);
    return true;
  }).catch(() => false);
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
  // v10.8 PRO #4: BOUNDED-AUTONOMY MANDATE — freeze the risk caps at
  // START (immutable for the session) + journal the exact values as
  // an audit record. Mid-session config changes can only TIGHTEN.
  const mandate = freezeMandate(next, wantMode);
  _state.mandate = JSON.parse(JSON.stringify(mandate)); // persisted copy (frozen object stays in-memory)
  await journalMandateEntry(mandate, trading);
  _state.runningSince = Date.now();
  _state.pausedToday = null;
  log('info', `AGENT STARTED (${wantMode.toUpperCase()}) — max ${next.maxTradesPerDay} trades/day · risk ${next.riskPerTradePct}%/trade · SL-based wallet sizing · PRO exits: T1 ${next.partialTpEnabled ? `${next.tp1ClosePct}%+BE-lock` : 'off'} · T2 ${next.tp2ClosePct}% · runner ${next.runnerPct}% trailing`);
  log('info', `MANDATE FROZEN — ${Object.entries(mandate.caps).filter(([, v]) => v != null).map(([k, v]) => `${k}=${v}`).join(' · ')} (mid-session loosening clamp active — restart par naya mandate)`);
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
  // v10.8: session over → mandate released (next START re-freezes
  // the then-current config). The journal record stays forever.
  _state.mandate = null;
  log('info', `AGENT STOPPED (${reason}) — mandate released`);
  persistState();
  return { ok: true, config: { ...cfg, enabled: false } };
}

// ---------------- v10.6 EDGE-ADAPTIVE SIZING (Pro Upgrade #2: Kelly-lite) ----------------
// The gap: agent.js sized EVERY trade at a flat riskPerTradePct — a
// 60-score STRONG and a 95-score STRONG risked the same amount. The
// trust layer already tracks claimed-confidence vs realized win-rate
// per bucket; Kelly turns that into sizing:
//
//   f* = winProb − (1−winProb)/payoffRatio        (the Kelly fraction)
//   riskPct = min(riskPerTradePct, f*/2 × 100)    (HALF-Kelly — the
//                                                  standard haircut for
//                                                  noisy edge estimates)
//
// Honest-degrade rules (this codebase's standing philosophy):
//   • flag OFF (default) → the exact flat sizing that ships today
//   • bucket has < MIN_SETTLED settled trades → flat (we refuse to
//     size on noise — same discipline as trust.js/adaptive.js)
//   • f* ≤ 0 (realized win-rate too low for the payoff) → the entry
//     is SKIPPED with the reason logged — no honest edge, no trade
//   • Kelly only ever sizes DOWN from riskPerTradePct — never above
//     the user's configured ceiling.
export function kellySizingEnabled(cfg) {
  if (['true', '1', 'on', 'yes'].includes(String(process.env.AI_ENABLE_KELLY_SIZING || '').trim().toLowerCase())) return true;
  return cfg?.kellySizing === true;
}

/** '40-55%' → {lo:40, hi:55} · '85%+' → {lo:85, hi:101} (PURE). */
export function parseCalBucket(label) {
  const m = String(label || '').match(/^(\d+)\s*-\s*(\d+)%$/);
  if (m) return { lo: Number(m[1]), hi: Number(m[2]) };
  const p = String(label || '').match(/^(\d+)%\+?$/);
  if (p) return { lo: Number(p[1]), hi: 101 };
  return null;
}

/**
 * The Kelly-lite risk % for one signal. PURE.
 * @param {object} a { confidence, calibration:[{bucket,n,winRate}],
 *                     baseRiskPct, payoffRatio, minSettled }
 * @returns {null|{pct:number, mode:'flat'|'kelly'|'refused', bucket,
 *                 winRate, n, payoff, halfKelly, reason}}
 *   null → flag/knob handled by caller (flat, no note)
 */
export function kellyRiskPct({ confidence, calibration, baseRiskPct, payoffRatio = 2, minSettled = 10 }) {
  const conf = Number(confidence);
  const base = Number(baseRiskPct);
  const payoff = Number(payoffRatio) > 0 ? Number(payoffRatio) : 2;
  if (!(conf > 0) || !(base > 0) || !Array.isArray(calibration) || calibration.length === 0) return null;

  const bucket = calibration.find(b => {
    const rng = parseCalBucket(b?.bucket);
    return rng && conf >= rng.lo && conf < rng.hi;
  });
  if (!bucket) return null;
  const n = Number(bucket.n) || 0;
  if (n < minSettled) {
    return { pct: base, mode: 'flat', bucket: bucket.bucket, winRate: bucket.winRate, n, payoff,
      reason: `bucket ${bucket.bucket} has only ${n} settled (<${minSettled}) — flat ${base}% (refuse to size on noise)` };
  }
  const winRate = Number(bucket.winRate);
  if (!(winRate > 0)) return null;
  const winProb = winRate / 100;
  const fStar = winProb - (1 - winProb) / payoff;
  if (fStar <= 0) {
    return { pct: 0, mode: 'refused', bucket: bucket.bucket, winRate, n, payoff,
      reason: `bucket ${bucket.bucket} realized ${winRate}% win over ${n} settled — f* ≤ 0 at ${payoff}:1 payoff (no honest edge)` };
  }
  const halfKelly = fStar / 2;
  const pct = Math.round(Math.min(base, halfKelly * 100) * 100) / 100;
  return { pct, mode: 'kelly', bucket: bucket.bucket, winRate, n, payoff, halfKelly: Math.round(halfKelly * 10000) / 10000,
    reason: `bucket ${bucket.bucket} realized ${winRate}% (n=${n}) → f* ${(Math.round(fStar * 10000) / 10000)} → half-Kelly ${(Math.round(halfKelly * 10000) / 10000)} → ${pct}% (${pct < base ? 'sized DOWN from ' + base + '%' : 'at ceiling'})` };
}

/** Live wrapper: flag + trust calibration + the pure math. */
export function effectiveRiskPctFor(cfg, signal) {
  if (!kellySizingEnabled(cfg)) return null;
  let calibration = null;
  try { calibration = trustReport()?.calibration || null; } catch { calibration = null; }
  if (!calibration) return null;
  return kellyRiskPct({
    confidence: signal?.confidence,
    calibration,
    baseRiskPct: Number(cfg?.riskPerTradePct) > 0 ? Number(cfg.riskPerTradePct) : 1.5,
    payoffRatio: Number(signal?.plan?.rewardRisk) > 0 ? Number(signal.plan.rewardRisk) : 2,
    minSettled: __trustTestables.MIN_SETTLED,
  });
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
  const userCfg = loadAgentConfig();
  const trading = loadConfig();
  // v10.8 PRO #4: MANDATE GUARD — mid-session, the agent's risk caps
  // can only get STRICTER. Any config change that would LOOSEN a
  // frozen cap is clamped back to the mandate value (the saved user
  // config is untouched; a restart re-freezes fresh).
  let cfg = userCfg;
  if (cfg.enabled && _state.mandate?.caps) {
    const eff = mandateEffectiveCfg(cfg, _state.mandate);
    if (eff.clamped.length > 0) {
      log('skip', `MANDATE GUARD — mid-session loosening ignored: ${eff.clamped.join(', ')} (mandate frozen at start; STOP+START to apply new values)`);
      cfg = eff.cfg;
    }
  }
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

  // v10.2 Step 5: FUTURES MARGIN RESTORE alert — one-time positive
  // Telegram when margin recovers (was < 2 USDT, now >= 2 again).
  // The flag prevents spam: set when margin drops, reset+notify
  // when it restores.
  if (!futuresViable && coindcxConnected()) {
    _state.futuresMarginAlerted = true;
  } else if (futuresViable && _state.futuresMarginAlerted) {
    _state.futuresMarginAlerted = false;
    await notify(sendTelegram, '🤖 <b>Futures margin restored</b> — futures desk phir se active. Deployable margin ≥ 2 USDT ho gaya hai.');
    log('info', 'Futures margin restored — futures desk active again');
  }

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

  // ---- v10.1 B3: rolling win-rate self-check (accuracy decay early
  // warning). Only meaningful in LIVE — a degraded paper agent is
  // already riskless; only a LIVE agent can silently bleed money on
  // a stale edge. Soft-downgrade (NOT kill switch — the user re-arms
  // by re-starting LIVE once the record recovers or they disagree). ----
  if (cfg.mode === 'live') {
    const wr = rollingAgentWinRate(j, cfg.rollingWindow);
    if (wr != null && wr < cfg.minRollingWinRate) {
      // v10.8: save from userCfg — a mid-session self-downgrade must
      // never persist mandate-clamped caps over the user's own config.
      const next = { ...userCfg, mode: 'paper' };
      saveAgentConfig(next);
      _state.winRateDowngraded = { at: Date.now(), winRate: wr, trades: cfg.rollingWindow };
      log('skip', `SELF-DOWNGRADE LIVE→PAPER — rolling win-rate ${wr}% (last ${cfg.rollingWindow}) < floor ${cfg.minRollingWinRate}%`);
      await notify(sendTelegram,
        `🤖 <b>AGENT self-downgrade: LIVE → PAPER</b>\nLast ${cfg.rollingWindow} agent trades ka win-rate ${wr}% hai (floor ${cfg.minRollingWinRate}%).\nSilent accuracy decay ka early warning — LIVE dobara arm karne se pehle signals review karo (/api/ai/trust + agent log).`);
      cfg.mode = 'paper'; // this tick continues safely in paper
    } else if (wr != null) {
      _state.winRateDowngraded = null; // healthy record clears the latch
    }
  }

  // ---- equity floor ----
  if (equityINR < cfg.minEquityINR) {
    maybeLogSkip('equity_floor', `wallet equity ₹${r2(equityINR)} < floor ₹${cfg.minEquityINR} — not trading (wallet top-up needed)`);
    await alertOnce(sendTelegram, 'equity_floor',
      `🤖 <b>AGENT entry paused</b> — wallet equity ₹${r2(equityINR)} floor ₹${cfg.minEquityINR} se neeche hai.\nCoinDCX wallet top-up karo — scans turant resume honge.`);
    persistState(); return;
  }

  // ---- scan the boards ONCE (cached server-side; cheap) — the exit
  // sweeps need the live consensus too, so this runs BEFORE the
  // quota/cooldown gates (a flipped position must exit even when
  // today's entry quota is done). v10.8: moved ABOVE the time-exit
  // sweep — winner-extension needs to know whether the board has
  // printed a qualifying OPPOSITE-side signal before granting room. ----
  const { getSignals } = await import('./signals.js');
  const boards = [];
  if (cfg.desks.futures) boards.push('FUTURES');
  if (cfg.desks.spot) boards.push('CRYPTO');
  if (cfg.desks.global) boards.push('GLOBALFUTURES'); // v10.4 — Apple/Google/NVIDIA/SPACEX SIM desk
  const scans = await Promise.all(boards.map(m => getSignals(m, deps, { limit: 20 }).catch(() => null)));
  const signalOf = (s) => Number(s?.superIntel?.aiScore ?? 0);
  // v9.6 USER SPEC GATE: 75+ AI score qualifies on its own; the old
  // STRONG-committee bar (grade + confidence + agreement) still works.
  // v10.1 B1 — QUORUM-AWARE THRESHOLD: ensemble.js's QUORUM_CONF_CAPS
  // already says a 1-4 voter "consensus" is capped WATCH/ACTION-grade
  // trust; the agent must respect the same honesty. When fewer than 5
  // models actually voted (data missing / honest abstains), the AI-score
  // bar is RAISED by 10 (plan: effectiveMinScore = voterCount >= 5 ?
  // minAiScore : minAiScore + 10) — thin committees need MORE conviction
  // to touch money, not less. The legacy STRONG bar (agreement ≥0.75
  // across the voting weight) is already quorum-honest, so it stays.
  const voterCount = (s) => Number(s?.voters ?? s?.participating ?? 0);
  const qualifies = (s) => !!(s && s.plan && s.side && (
    signalOf(s) >= effectiveScoreBar(cfg, s) || (
      s.grade === 'STRONG' && s.executable
      && (s.confidence ?? 0) >= cfg.minConfidence
      && (s.agreement ?? 0) >= cfg.minAgreement
    )
  ));

  // ---- v10.8: OPPOSITE-SIDE qualifying signal per held pair (one
  // shared pass — the trend-flip exits AND the winner-extension veto
  // read the SAME truth, never two different scans). ----
  const oppositeQualifying = new Map(); // pair → signal
  for (const p of openManagedPositions(j, cfg)) {
    const posSide = /^(L|B)/i.test(String(p.side || '')) ? 'BUY' : 'SELL';
    const pair = String(p.pair || '');
    for (const board of scans) {
      if (!board?.ok) continue;
      for (const s of (board.signals || [])) {
        if (pairOfSignal(s) !== pair) continue;
        const raw = String(s.side || '').toUpperCase();
        const sSide = raw === 'SHORT' || raw === 'SELL' ? 'SELL' : 'BUY';
        if (sSide !== posSide && qualifies(s)) { oppositeQualifying.set(pair, s); break; }
      }
      if (oppositeQualifying.has(pair)) break;
    }
  }

  // ---- v10.8: live P&L read (cached server-side by the positions
  // pipeline) — fetched ONLY when a position is actually at/past its
  // window and extension is armed, so the hot path pays nothing. ----
  let livePnlByPair = null;
  const needLivePnl = cfg.winnerExtendEnabled !== false && cfg.winnerExtendMax > 0
    && openAgent.some(p => (Date.now() - (p.openedAt || 0)) / 60000 >= holdWindowFor(cfg, p.pair))
    && oppositeQualifying.size === 0;
  if (needLivePnl) {
    const lp = await getPositionsWithPnl().catch(() => null);
    if (lp?.positions) livePnlByPair = new Map(lp.positions.map(x => [x.pair, x]));
  }

  // ---- time-exit sweep (auto exit of aging agent positions) ----
  // v10.1 B2: the window is now PER-POSITION — the entry-time ATR%
  // (state.entryMeta) drives dynamicMaxHoldMin. Fast movers exit at
  // half the base window, slow movers get a third longer; unknown
  // entries keep the base window (honest default).
  // v10.8 WINNER EXTENSION ("trade ke hisaab se extension"): a position
  // AT its window that is IN PROFIT with NO opposite qualifying signal
  // gets its window extended (+winnerExtendPct% per extension, up to
  // winnerExtendMax) and SL locked to breakeven — winners earn room to
  // run, losers still get cut at the original window.
  const closures = [];
  const timeExited = new Set(); // v9.6: ids closed this tick (trend-flip must not double-close)
  const extended = [];
  for (const p of openAgent) {
    const meta = _state.entryMeta?.[p.pair] || {};
    const extensions = Number(meta.extensions) || 0;
    const baseWin = holdWindowFor(cfg, p.pair);
    const holdMin = effectiveHoldWindowMin(baseWin, extensions, cfg.winnerExtendPct);
    const ageMin = (Date.now() - (p.openedAt || 0)) / 60000;
    if (ageMin >= holdMin) {
      // v10.8: extension gate — agent positions only, in profit, no
      // opposite qualifier, under the max count.
      if (extensionEligible({
        enabled: cfg.winnerExtendEnabled !== false,
        extensions,
        maxExtensions: cfg.winnerExtendMax,
        pnlPct: livePnlByPair?.get(p.pair)?.pnlPct ?? null,
        oppositeQualifying: oppositeQualifying.has(p.pair),
        source: p.source,
      })) {
        const nextExt = extensions + 1;
        _state.entryMeta = _state.entryMeta || {};
        _state.entryMeta[p.pair] = { ...(meta || {}), extensions: nextExt, lastExtendAt: Date.now() };
        const moved = await moveAgentSlToBreakeven(p.id);
        const newWin = effectiveHoldWindowMin(baseWin, nextExt, cfg.winnerExtendPct);
        extended.push({ pair: p.pair, ext: nextExt, newWin, pnlPct: livePnlByPair?.get(p.pair)?.pnlPct ?? null });
        log('exit', `WINNER EXTENSION ${p.pair} — in profit (pnlPct ${r2(livePnlByPair?.get(p.pair)?.pnlPct ?? 0)}%), window ${holdMin}m → ${newWin}m (ext ${nextExt}/${cfg.winnerExtendMax})${moved ? ' · SL → breakeven (risk-free runner)' : ''}`);
        continue; // not closed this tick — the new window owns it now
      }
      const out = p.market === 'FUTURES'
        ? await closeFuturesPosition(p.id).catch(e => ({ ok: false, error: String(e?.message || e) }))
        : p.market === 'GLOBALFUTURES'
          ? await (async () => {
              const { closeGlobalPosition } = await import('./globalFutures.js');
              return closeGlobalPosition(p.id).catch(e => ({ ok: false, error: String(e?.message || e) }));
            })()
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
        closures.push({ pair: p.pair, pnlINR: totalPnl, reason: `TIME-EXIT after ${Math.round(ageMin)}m${holdMin !== cfg.maxHoldMin ? ` (dynamic window ${holdMin}m${extensions > 0 ? `, ${extensions}× extended` : ''})` : ''}${hasBooked ? ' (incl. booked T1/T2 legs)' : ''}` });
        log('exit', `TIME-EXIT ${p.pair} after ${Math.round(ageMin)}m (window ${holdMin}m${extensions > 0 ? `, ${extensions}× winner-extended` : ''}) — pnl ₹${r2(totalPnl)}${hasBooked ? ` (final ${r2(out.position?.pnlINR ?? 0)} + booked ${r2(out.position?.bookedPnlINR ?? 0)})` : ''}`);
        // B2 hygiene: the entry's volatility record is spent with the position
        if (_state.entryMeta) delete _state.entryMeta[p.pair];
      } else {
        log('error', `time-exit failed for ${p.pair}: ${String(out?.error || '').slice(0, 100)}`);
      }
    }
  }
  if (extended.length > 0) {
    await notify(sendTelegram, `🤖 <b>AGENT winner-extension</b>\n${extended.map(e => `• ${e.pair} — profitable at window, extended to ${e.newWin}m (${e.ext}/${cfg.winnerExtendMax}), SL → breakeven`).join('\n')}`);
  }
  if (closures.length > 0) {
    await notify(sendTelegram, `🤖 <b>AGENT time-exit</b>\n${closures.map(c => `• ${c.pair} — ${c.reason}: ₹${c.pnlINR ?? '?'}`).join('\n')}`);
  }

  // ---- v9.6 TREND-FLIP auto-exit ("auto exit as per market trend"):
  // the board now prints a QUALIFYING signal on the OPPOSITE side of
  // a held pair → the position is cut immediately. v9.7: this now
  // protects MANUAL positions too when manageManualPositions (user
  // spec, default ON) — a manual swing holder exits the moment the
  // trend flips against them. A cooldown is stamped so the flip side
  // can only re-enter after cooldownMin — no whipsaw churn.
  // v10.8: flipped-signal detection reads the shared oppositeQualifying
  // map computed above — same truth, one pass. ----
  const managed = openManagedPositions(j, cfg);
  for (const p of managed) {
    if (timeExited.has(p.id)) continue;
    const flipped = oppositeQualifying.get(String(p.pair || '')) || null;
    if (!flipped) continue;
    const out = p.market === 'FUTURES'
      ? await closeFuturesPosition(p.id).catch(e => ({ ok: false, error: String(e?.message || e) }))
      : p.market === 'GLOBALFUTURES'
        ? await (async () => {
            const { closeGlobalPosition } = await import('./globalFutures.js');
            return closeGlobalPosition(p.id).catch(e => ({ ok: false, error: String(e?.message || e) }));
          })()
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
  // v10.8 NEAR-MISS AUTO-TRADE: signals that MISS the full bar but sit
  // inside the gap window with high confidence + full quorum. Used
  // ONLY when no full qualifier exists this cycle, capped per day.
  const nearMissPool = [];
  for (let bi = 0; bi < boards.length; bi++) {
    const board = scans[bi];
    const m = boards[bi];
    if (!board?.ok) continue;
    if (m === 'FUTURES' && !futuresViable) continue; // v9.7: margin floor can't fund it
    for (const s of (board.signals || [])) {
      if ((s.plan.riskPct ?? 0) > (trading.maxRiskPct || 5)) continue;
      // already positioned on this pair? skip (one-per-pair anyway)
      if ((j.positions || []).some(p => p.pair === pairOfSignal(s) && (p.status === 'OPEN' || p.status === 'UNKNOWN'))) continue;
      if (qualifies(s)) { candidates.push(s); continue; }
      const nm = nearMissEntryGate(cfg, s);
      if (nm) nearMissPool.push({ signal: s, nm });
    }
  }
  // v10.2 Step 1: NEAR-MISS DIAGNOSTICS — always capture the top-3
  // closest signals (panel strip), whether or not a near-miss trade
  // fires this cycle.
  const nearMissDiag = [];
  for (const board of scans) {
    if (!board?.ok) continue;
    for (const s of (board.signals || [])) {
      if (!s?.plan || !s.side) continue;
      const ai = signalOf(s);
      const vc = voterCount(s);
      const quorumCapped = vc < 5;
      const needScore = quorumCapped ? cfg.minAiScore + (cfg.quorumPenalty ?? 10) : cfg.minAiScore;
      nearMissDiag.push({
        pair: pairOfSignal(s),
        symbol: s.symbol,
        aiScore: ai,
        needScore,
        voters: vc,
        quorumCapped,
        confidence: Math.round(s.confidence ?? 0),
        agreement: Math.round((s.agreement ?? 0) * 100),
      });
    }
  }
  nearMissDiag.sort((a, b) => (b.aiScore - a.aiScore) || (b.confidence - a.confidence));
  _state.lastNearMisses = nearMissDiag.slice(0, 3);

  // v10.8: near-miss AUTO-ENTRY — only when the full bar found nobody
  // this cycle, the daily near-miss budget remains, and the BEST
  // near-miss is a high-confidence full-quorum setup. The user's spec:
  // "Near Miss ke trade mat chhodo — highest AI score + high conf
  // wale ko auto trade lagao."
  let best = null;
  let nearMissInfo = null;
  const nmUsedToday = nearMissEntriesToday(j).length;
  if (candidates.length === 0) {
    nearMissPool.sort((a, b) => (b.nm.aiScore - a.nm.aiScore) || (b.nm.confidence - a.nm.confidence));
    if (nearMissPool.length > 0 && nmUsedToday < Number(cfg.nearMissMaxPerDay)) {
      best = nearMissPool[0].signal;
      nearMissInfo = { ...nearMissPool[0].nm, usedToday: nmUsedToday + 1, maxPerDay: Number(cfg.nearMissMaxPerDay) };
      log('info', `NEAR-MISS AUTO-ENTRY candidate ${best.symbol} — AI ${nearMissInfo.aiScore} vs bar ${nearMissInfo.needScore} (gap ${nearMissInfo.needScore - nearMissInfo.aiScore} ≤ ${cfg.nearMissScoreGap}), conf ${nearMissInfo.confidence}%, ${nearMissInfo.voters} voters — highest-score near-miss entering (${nmUsedToday + 1}/${cfg.nearMissMaxPerDay} today)`);
    }
  }
  if (!best) {
    if (candidates.length === 0) {
      if (_state.lastNearMisses.length > 0) {
        const lines = _state.lastNearMisses.map(nm =>
          `closest: ${nm.symbol} score=${nm.aiScore}/${nm.needScore} (${nm.voters} voters${nm.quorumCapped ? ' — QUORUM-CAPPED' : ''}) conf=${nm.confidence}%`
        );
        log('skip', `scan: 0 candidates — near-misses: ${lines.join(' · ')}${cfg.nearMissAutoTrade === false ? ' (near-miss auto-trade OFF)' : nmUsedToday >= Number(cfg.nearMissMaxPerDay) ? ` (near-miss budget ${nmUsedToday}/${cfg.nearMissMaxPerDay} used)` : ' (none met the near-miss gate: gap/conf/quorum)'}`);
      } else {
        log('skip', `scan: 0 candidates ≥ ${cfg.minAiScore} AI score / ${cfg.minConfidence}% conf + ${Math.round(cfg.minAgreement * 100)}% agreement${cfg.desks.futures && !futuresViable ? ' (futures margin ke karan sirf spot scope)' : ''}`);
      }
      maybeLogSkip('no_candidates', `scan: 0 candidates ≥ ${cfg.minAiScore} AI score${cfg.desks.futures && !futuresViable ? ' (futures margin ke karan sirf spot scope)' : ''}`);
      persistState(); return;
    }
    candidates.sort((a, b) => (signalOf(b) - signalOf(a)) || (b.confidence - a.confidence));
    best = candidates[0];
  }

  // ---- v10.1 B4: CORRELATION GUARD on concurrent positions ----
  // 5 open alt-positions that all correlate ~0.8 with each other are ONE
  // leveraged bet, not five. Before committing: check the candidate's
  // 60d-return correlation against EVERY open position's base (both
  // directions of the pair both count — a BTC-anchored alts book is a
  // BTC bet). >0.7 → skip to the NEXT candidate; all correlated → wait
  // this cycle. Unknown correlation (feed down) → allow (the same
  // honesty as correlation.js: a missing number is not a 0).
  if (cfg.correlationGuard !== false) {
    const openBases = [...new Set((j.positions || [])
      .filter(p => (p.status === 'OPEN' || p.status === 'UNKNOWN'))
      .map(p => baseOfPair(p.pair))
      .filter(Boolean))];
    if (openBases.length > 0) {
      // v10.8: a near-miss pick joins the same guard as full
      // qualifiers — it is a candidate like any other once chosen.
      const pool = nearMissInfo ? [best, ...candidates] : candidates;
      let chosen = null;
      for (const cand of pool) {
        const candBase = String(cand.symbol || '').toUpperCase();
        if (!openBases.includes(candBase)) {
          let correlatedWith = null;
          for (const ob of openBases) {
            const r = await pairCorrelation(candBase, ob).catch(() => null);
            if (r != null && Math.abs(r) > 0.7) { correlatedWith = { base: ob, r }; break; }
          }
          if (correlatedWith) {
            log('skip', `CORRELATION GUARD — ${cand.symbol} skipped (60d r=${correlatedWith.r} with ${correlatedWith.base}, |r|>0.7 = same bet twice)`);
            if (cand === best) nearMissInfo = null; // the near-miss pick itself was correlated
            continue; // try the next candidate
          }
        }
        chosen = cand; break;
      }
      if (!chosen) {
        maybeLogSkip('correlation', `CORRELATION GUARD — all ${pool.length} qualifying candidates |r|>0.7 correlated with open positions (${openBases.join(', ')}); same-bet-twice risk, ye cycle skip`);
        persistState(); return;
      }
      best = chosen;
    }
  }

  // ---- v10.1 B2: record the entry's volatility for its dynamic
  // time-exit window (ATR% from the plan; stop-distance % is the
  // fallback when ATR wasn't logged on the plan). ----
  const atrPctOf = (s) => {
    const p = s?.plan || {};
    const ltp = Number(s?.ltp || p.entry);
    const atr = Number(p.atrUsed);
    if (Number.isFinite(atr) && atr > 0 && ltp > 0) return (atr / ltp) * 100;
    const rp = Number(p.riskPct);
    return Number.isFinite(rp) && rp > 0 ? rp : null;
  };
  const entryAtrPct = atrPctOf(best);
  _state.entryMeta = _state.entryMeta || {};
  _state.entryMeta[pairOfSignal(best)] = { atrPct: entryAtrPct, at: Date.now() };
  if (entryAtrPct != null && cfg.dynamicTimeExit !== false) {
    log('info', `ENTRY VOLATILITY ${best.symbol}: ATR ${r2(entryAtrPct)}% → dynamic time-exit window ${dynamicMaxHoldMin(cfg, entryAtrPct)}m (base ${cfg.maxHoldMin}m)`);
  }

  // ---- wallet-based sizing (v10.6: Kelly-lite ceiling on the flat %) ----
  // flag OFF (default) → the exact flat riskPerTradePct that shipped.
  // flag ON → the confidence bucket's realized edge (trust calibration,
  // ≥10 settled) sizes at HALF-Kelly, never above the ceiling. f* ≤ 0
  // = no honest edge → the entry is skipped with the reason logged.
  const kelly = effectiveRiskPctFor(cfg, best);
  if (kelly?.mode === 'refused') {
    maybeLogSkip('kelly-negative', `KELLY EDGE NEGATIVE — ${best.symbol} skipped: ${kelly.reason}`);
    persistState(); return;
  }
  if (kelly?.mode === 'kelly') log('info', `KELLY SIZING ${best.symbol}: ${kelly.reason}`);
  const riskPct = kelly?.mode === 'kelly' && kelly.pct > 0 ? kelly.pct : cfg.riskPerTradePct;
  const riskINR = equityINR * (riskPct / 100);
  const wantFutures = best.market === 'FUTURES';
  // v7.0: the sizing math is LOGGED transparently before execution —
  // the user can audit "₹X risk → Y qty → Z margin at Lx" in the feed
  {
    const stopDist = Math.abs(best.plan.entry - best.plan.stopLoss);
    if ((wantFutures || best.market === 'GLOBALFUTURES') && stopDist > 0) {
      const lev = Math.max(1, Math.min(cfg.maxLeverage, Math.floor(95 / (best.plan.riskPct || 5))));
      const q = riskINR / usdInr / stopDist;
      log('info', `SIZING ${best.symbol}: ₹${r2(riskINR)} risk (${riskPct}% of ₹${r2(equityINR)}${kelly?.mode === 'kelly' ? ' · kelly-capped' : ''}) → ${Math.round(q * 1e4) / 1e4} qty → ${r2((q * best.plan.entry) / lev)} USDT margin at ${lev}x`);
    } else {
      const budget = Math.min(
        trading.maxOrderINR || 1000,
        Math.max(100, (riskINR / (best.plan.riskPct || 5)) * 100),
        Math.max(100, (wallet?.deployableSpotINR ?? equityINR) * 0.6),
      );
      log('info', `SIZING ${best.symbol}: ₹${r2(riskINR)} risk (${riskPct}% of ₹${r2(equityINR)}${kelly?.mode === 'kelly' ? ' · kelly-capped' : ''}) → ₹${r2(budget)} spot order`);
    }
  }
  // ---- v10.6 SLIPPAGE-AWARE EXECUTION (Pro Upgrade #6) ----
  // Expected slippage from the L2 depth walk (Pro #1's reader) vs the
  // configured threshold → TWAP-lite split into 2-4 child orders with
  // small gaps. No depth read (endpoint down / desk without a CoinDCX
  // book, e.g. GLOBAL SIM) → single order, honest degrade.
  const SLIP_THRESHOLD_PCT = (() => {
    const n = Number(process.env.AI_SLIPPAGE_THRESHOLD_PCT);
    return Number.isFinite(n) && n > 0 ? n : 0.35;
  })();
  const SLIP_CHILD_GAP_MS = 2000;
  // v10.6.1 FIX: GLOBALFUTURES desks are EQUITY perps (MU/AMD/…) —
  // there is no CoinDCX <SYMBOL>_INR book to walk; the old mapping
  // fetched a nonexistent pair and paid a 6s timeout per attempt just
  // to arrive at the same honest single-order degrade. Skip the read.
  const depthFor = best.market === 'GLOBALFUTURES'
    ? null
    : await readDepth(
      best.market === 'INDIA' ? 'INDIA' : best.market,
      best.symbol, { ltp: best.plan.entry, levels: 20 },
    ).catch(() => null);
  let out = null;
  if (wantFutures || best.market === 'GLOBALFUTURES') {
    const isGlobal = best.market === 'GLOBALFUTURES';
    const riskUSDT = riskINR / usdInr;
    const stopDist = Math.abs(best.plan.entry - best.plan.stopLoss);
    if (!(stopDist > 0)) { persistState(); return; }
    const qty = riskUSDT / stopDist;
    const lev = Math.max(1, Math.min(cfg.maxLeverage, Math.floor(95 / (best.plan.riskPct || 5))));
    let marginUSDT = (qty * best.plan.entry) / lev;
    // never commit more than 60% of the deployable margin — the SIM desk
    // sizes against practice equity (CoinDCX margin is desk par nahi)
    const deployable = isGlobal
      ? (equityINR * 0.5 / usdInr)
      : (wallet?.deployableFuturesUSDT ?? (equityINR * 0.5 / usdInr));
    const capUSDT = deployable * 0.6;
    if (marginUSDT > capUSDT) marginUSDT = capUSDT;
    marginUSDT = Math.round(marginUSDT * 1000) / 1000;
    if (marginUSDT < (isGlobal ? 1 : 2)) {
      maybeLogSkip('margin too small', `${isGlobal ? 'global SIM' : 'futures'} margin ${marginUSDT} USDT < ${isGlobal ? 1 : 2} — equity ₹${r2(equityINR)} / risk ${riskPct}% too small for this stop`);
      persistState(); return;
    }
    // v10.6: the depth walk runs on the POSITION NOTIONAL in the book's
    // currency (USDT notional × usdInr → INR book; the % is unit-free).
    const notionalINR = qty * best.plan.entry * usdInr;
    const split = splitOrderForSlippage({ side: best.side, notional: notionalINR, depth: depthFor, thresholdPct: SLIP_THRESHOLD_PCT });
    const legs = Math.max(1, split.children);
    if (legs > 1) log('info', `SLIPPAGE GUARD ${best.symbol}: ${split.reason}`);
    const marginPerLeg = Math.round((marginUSDT / legs) * 1000) / 1000;
    for (let leg = 0; leg < legs; leg++) {
      if (leg > 0) await new Promise(r => setTimeout(r, SLIP_CHILD_GAP_MS));
      if (isGlobal) {
        // v10.4 GLOBAL EQUITY FUTURES SIM — paper/notify only (LIVE reject
        // hota hai executeGlobalSignal gate 0 me — CoinDCX par ye equities nahi)
        const { getFreshGlobalSignalForExec } = await import('./signals.js');
        const { executeGlobalSignal } = await import('./globalFutures.js');
        out = await executeGlobalSignal({
          symbol: best.symbol, side: best.side,
          mode: cfg.mode === 'notify' ? 'notify' : 'paper',
          marginUSDT: marginPerLeg, leverage: lev,
          getFreshSignal: (pair) => getFreshGlobalSignalForExec(pair, deps),
          source: 'agent',
          sendTelegram,
        });
      } else {
        const { getFreshFuturesSignalForExec } = await import('./signals.js');
        out = await executeFuturesSignal({
          symbol: best.symbol, side: best.side,
          mode: cfg.mode === 'live' ? 'live' : cfg.mode === 'notify' ? 'notify' : 'paper',
          marginUSDT: marginPerLeg, leverage: lev,
          getFreshSignal: (pair) => getFreshFuturesSignalForExec(pair, deps),
          wantAuto: cfg.mode === 'live',
          source: 'agent',
          sendTelegram,
        });
      }
      if (!out?.ok) break; // a failed leg stops the split (next tick retries fresh)
    }
  } else {
    // spot (INR)
    const budgetINR = Math.min(
      trading.maxOrderINR || 1000,
      Math.max(100, (riskINR / (best.plan.riskPct || 5)) * 100),
      Math.max(100, (wallet?.deployableSpotINR ?? equityINR) * 0.6),
    );
    const split = splitOrderForSlippage({ side: best.side, notional: budgetINR, depth: depthFor, thresholdPct: SLIP_THRESHOLD_PCT });
    const legs = Math.max(1, split.children);
    if (legs > 1) log('info', `SLIPPAGE GUARD ${best.symbol}: ${split.reason}`);
    const { executeSignal } = await import('./coindcxOrders.js');
    const { getFreshSignalForExec } = await import('./signals.js');
    for (let leg = 0; leg < legs; leg++) {
      if (leg > 0) await new Promise(r => setTimeout(r, SLIP_CHILD_GAP_MS));
      out = await executeSignal({
        symbol: best.symbol, side: best.side,
        mode: cfg.mode === 'live' ? 'live' : cfg.mode === 'notify' ? 'notify' : 'paper',
        qtyINR: Math.round(budgetINR / legs), leverage: 1,
        getFreshSignal: (pair) => getFreshSignalForExec(pair, deps),
        wantAuto: cfg.mode === 'live',
        source: 'agent',
        sendTelegram,
      });
      if (!out?.ok) break;
    }
  }

  if (out?.ok) {
    _state.lastEntryAt = Date.now();
    _state.lastEntryPair = pairOfSignal(best);
    const f = out.filled || {};
    const deskTag = best.market === 'GLOBALFUTURES' ? '🌍 Global SIM' : wantFutures ? '⚡ Futures' : '₿ Spot';
    // v10.8: near-miss entries get a journal marker (NEAR_MISS kind —
    // accounting-neutral: the ORDER entry the executor pushed already
    // counts the trade against quota; this is the audit trail for the
    // per-day near-miss budget + the panel strip).
    if (nearMissInfo) {
      await withJournalLock(async () => {
        const jj = loadJournal();
        pushEntry(jj, {
          day: todayIST(), kind: 'NEAR_MISS', source: 'agent', market: best.market || 'CRYPTO',
          symbol: best.symbol, positionId: out?.position?.id ?? null,
          aiScore: nearMissInfo.aiScore, needScore: nearMissInfo.needScore,
          confidence: nearMissInfo.confidence, voters: nearMissInfo.voters,
          text: `NEAR-MISS AUTO-ENTRY ${best.symbol} ${best.side} — AI ${nearMissInfo.aiScore} vs bar ${nearMissInfo.needScore} (gap ≤ ${cfg.nearMissScoreGap}), conf ${nearMissInfo.confidence}%, ${nearMissInfo.voters} voters (${nearMissInfo.usedToday}/${nearMissInfo.maxPerDay} today)`,
        });
        saveJournal(jj);
      }).catch(() => { /* best-effort marker */ });
    }
    if (out.mode === 'notify') {
      log('entry', `NOTIFY ${deskTag} ${best.symbol} ${best.side} (${best.confidence}% conf) — alert-only, koi order nahi${out.telegramSent ? '' : ' (telegram off)'}`);
    } else {
      log('entry', `AUTO-ENTRY ${deskTag} ${best.symbol} ${best.side} (${best.confidence}% conf)${nearMissInfo ? ` [NEAR-MISS ${nearMissInfo.aiScore}/${nearMissInfo.needScore}]` : ''} — ${f.qty ?? '?'} @ ${f.price ?? best.plan.entry}${wantFutures || best.market === 'GLOBALFUTURES' ? ` · ${f.leverage ?? '?'}x · margin ${f.marginUSDT ?? '?'} USDT` : ''} · SL ${best.plan.stopLoss} · T2 ${best.plan.target2}${kelly?.mode === 'kelly' ? ` · kelly ${riskPct}%` : ''}`);
      await notify(sendTelegram,
        `🤖 <b>AGENT AUTO-ENTRY${nearMissInfo ? ' · NEAR-MISS' : ''}</b> — ${deskTag} ${best.symbol} ${best.side}\n` +
        `${nearMissInfo ? `AI ${nearMissInfo.aiScore} (bar ${nearMissInfo.needScore}, conf ${nearMissInfo.confidence}%, ${nearMissInfo.voters} voters)\n` : ''}` +
        `Confidence ${best.confidence}% · agreement ${Math.round((best.agreement || 0) * 100)}% · trade ${tradesToday.length + 1}/${cfg.maxTradesPerDay} today\n` +
        `${f.qty ?? '?'} @ ${f.price ?? best.plan.entry}${wantFutures || best.market === 'GLOBALFUTURES' ? ` · ${f.leverage ?? 1}x · margin ${Math.round(f.marginUSDT ?? 0)} USDT` : ''}\n` +
        `SL ${best.plan.stopLoss} · T2 ${best.plan.target2} · time-exit ${cfg.maxHoldMin}m (winner-extension armed)${kelly?.mode === 'kelly' ? ` · kelly-sized ${riskPct}%` : ''}`,
      );
    }
  } else {
    log('skip', `entry rejected — ${best.symbol} ${best.side}: ${String(out?.error || '').slice(0, 120)}`);
  }
  persistState();
}

// small helpers ------------------------------------------------
let _lastSkip = { key: '', at: 0 };

// ---- v10.1 B2: ATR-adaptive time-exit window -----------------
// Pure: base window (cfg.maxHoldMin) adjusted by the position's
// entry-time ATR% (ATR/ltp×100 from the signal's plan):
//   • fast mover (ATR% ≥ 2.5):  signals go stale FAST → window × 0.5
//     (plan's e.g. 45min at base 90)
//   • slow mover (ATR% ≤ 0.8): targets need TIME to travel → window
//     × 1.33, floored at 120min (plan's e.g. 120min)
//   • mid: base window untouched
// Clamped to [15, 240] so a mis-set base can't produce a 5-minute
// or 24-hour absurdity. null atrPct (no data) → base window, honest.
export function dynamicMaxHoldMin(cfg, atrPct) {
  const base = Number(cfg?.maxHoldMin) > 0 ? Number(cfg.maxHoldMin) : 90;
  const a = Number(atrPct);
  if (!Number.isFinite(a) || a <= 0) return base;
  let out = base;
  if (a >= 2.5) out = Math.round(base * 0.5);
  else if (a <= 0.8) out = Math.round(base * 4 / 3);
  return Math.max(15, Math.min(240, out));
}

/** A position's effective hold window: entry-time ATR% (state map)
 *  → dynamicMaxHoldMin; unknown entry → base cfg.maxHoldMin. */
function holdWindowFor(cfg, pair) {
  if (cfg.dynamicTimeExit === false) return Number(cfg.maxHoldMin) > 0 ? Number(cfg.maxHoldMin) : 90;
  const meta = _state.entryMeta?.[pair];
  return dynamicMaxHoldMin(cfg, meta?.atrPct);
}

// ---- v10.1 B3: rolling agent win-rate (self-calibration) ----
/** Last-N CLOSED agent trades (newest first) with TOTAL pnl per trade
 *  (final leg + booked T1/T2 legs — a partial-booked winner is a
 *  winner). Journal is the single source of truth. */
export function recentAgentTrades(j, n = 10) {
  const closed = (j?.positions || [])
    .filter(p => p.source === 'agent' && String(p.status || '').toUpperCase() === 'CLOSED')
    .sort((a, b) => (b.closedAt || b.updatedAt || 0) - (a.closedAt || a.updatedAt || 0));
  return closed.slice(0, Math.max(1, Number(n) || 10)).map(p => ({
    pair: p.pair,
    pnlINR: (p.pnlINR ?? 0) + (p.bookedPnlINR ?? 0),
    closedAt: p.closedAt || p.updatedAt || null,
  }));
}

/** Rolling win-rate over the last N closed agent trades. null when
 *  fewer than N closed trades exist (we refuse to tune on noise —
 *  same discipline as adaptive.js MIN_SAMPLE). */
export function rollingAgentWinRate(j, n = 10) {
  const trades = recentAgentTrades(j, n);
  if (trades.length < n) return null;
  const wins = trades.filter(t => t.pnlINR > 0).length;
  return Math.round((wins / trades.length) * 1000) / 10;
}

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
  if (s.market === 'GLOBALFUTURES') return `${s.symbol}-USD`; // v10.4 SIM desk
  if (s.market === 'CRYPTO') return `${s.symbol}INR`;
  return s.symbol;
}

/** v10.1 B4: the BASE coin of a journal pair — 'B-SOL_USDT'/'SOLINR'
 *  → 'SOL' (India equity symbols / unknown shapes → null — the
 *  correlation guard is a crypto-desk rule; it must never guess). */
function baseOfPair(pair) {
  const s = String(pair || '').toUpperCase();
  let m = s.match(/^B-([A-Z0-9]+)_USDT$/);
  if (m) return m[1];
  m = s.match(/^([A-Z0-9]+)INR$/);
  if (m) return m[1];
  return null;
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
      const wantMarkets = ['INDIA', 'FUTURES', 'CRYPTO', 'GLOBALFUTURES'];
      await Promise.all(wantMarkets.map(async (m) => {
        const b = await getSignals(m, deps, { limit: 6, warmOnly: true }).catch(() => null);
        if (b?.ok) {
          picks[m] = (b.signals || []).filter(s => s.grade === 'STRONG' || s.grade === 'ACTION').slice(0, 3)
            .map(s => ({ symbol: s.symbol, side: s.side, grade: s.grade, confidence: s.confidence, aiScore: s.superIntel?.aiScore ?? null, ltp: s.ltp, pair: pairOfSignal(s),
              voters: s.voters ?? s.participating ?? null,
              totalModels: s.totalModels ?? null,
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
    if (cfg.desks.global && picks.GLOBALFUTURES?.length) deskOrder.push({ market: 'GLOBALFUTURES', pick: picks.GLOBALFUTURES[0] });
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
  // v10.1 B1-B4 accuracy state — the panel's transparency strip for the
  // new decision-quality layers (quorum bar, dynamic windows, rolling
  // win-rate, correlation guard).
  const rollingWR = rollingAgentWinRate(j, cfg.rollingWindow);
  const accuracy = {
    quorumAwareEntry: true, // B1 — thin committees need a HIGHER AI-score bar
    quorumPenalty: cfg.quorumPenalty ?? 10,
    effectiveMinAiScore: cfg.minAiScore,
    thinCommitteeMinAiScore: cfg.minAiScore + (cfg.quorumPenalty ?? 10), // applied when voters < 5
    dynamicTimeExit: cfg.dynamicTimeExit !== false, // B2
    openWindowOverrides: Object.entries(_state.entryMeta || {})
      .filter(([, v]) => v && v.atrPct != null && cfg.dynamicTimeExit !== false)
      .map(([pair, v]) => ({ pair, atrPct: v.atrPct, windowMin: dynamicMaxHoldMin(cfg, v.atrPct) }))
      .slice(0, 5),
    rollingWinRate: rollingWR, // B3 — null until N closed trades exist
    rollingWindow: cfg.rollingWindow,
    minRollingWinRate: cfg.minRollingWinRate,
    winRateDowngraded: _state.winRateDowngraded || null,
    correlationGuard: cfg.correlationGuard !== false, // B4
    // v10.2 Step 1: near-miss diagnostics + V2 model flag
    lastNearMisses: _state.lastNearMisses || [],
    v2ModelsEnabled: typeof v2ModelsEnabled === 'function' ? v2ModelsEnabled() : false,
    // v10.8 NEAR-MISS AUTO-TRADE state — the panel's transparency for
    // "near-miss kyun / kab / kitna".
    nearMiss: {
      enabled: cfg.nearMissAutoTrade !== false,
      scoreGap: cfg.nearMissScoreGap ?? 10,
      minConfidence: cfg.nearMissMinConfidence ?? 70,
      maxPerDay: cfg.nearMissMaxPerDay ?? 1,
      usedToday: nearMissEntriesToday(j).length,
      todayEntries: nearMissEntriesToday(j).map(e => ({
        ts: e.ts, symbol: e.symbol, aiScore: e.aiScore ?? null, needScore: e.needScore ?? null,
        confidence: e.confidence ?? null, voters: e.voters ?? null,
      })),
    },
    // v10.8 WINNER-EXTENSION state — "trade ke hisaab se extension"
    winnerExtension: {
      enabled: cfg.winnerExtendEnabled !== false,
      extendPct: cfg.winnerExtendPct ?? 50,
      max: cfg.winnerExtendMax ?? 2,
      open: Object.entries(_state.entryMeta || {})
        .filter(([, v]) => v && Number(v.extensions) > 0)
        .map(([pair, v]) => ({ pair, extensions: v.extensions, windowMin: effectiveHoldWindowMin(dynamicMaxHoldMin(cfg, v.atrPct), v.extensions, cfg.winnerExtendPct), lastExtendAt: v.lastExtendAt ?? null }))
        .slice(0, 5),
    },
    // v10.8 PRO #4: the frozen mandate (null = agent stopped)
    mandate: _state.mandate || null,
  };
  if (_state.winRateDowngraded) {
    blockers.push({ key: 'win_rate_downgrade', soft: true, text: `📉 Rolling win-rate ${_state.winRateDowngraded.winRate}% (last ${_state.winRateDowngraded.trades}) — agent paper mode me self-downgrade ho chuka hai. LIVE re-arm karne se pehle review karo.` });
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
    // v10.1: B1-B4 decision-quality state
    accuracy,
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
