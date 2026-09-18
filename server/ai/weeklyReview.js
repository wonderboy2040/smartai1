// ============================================================
// server/ai/weeklyReview.js — v10.9 WEEKLY TRADE-PERFORMANCE DIGEST
// ------------------------------------------------------------
// /digest is a MARKET report (intel + prices + bond yields). This is
// the missing TRADE-PERFORMANCE review — YOUR week, not the market's:
//
//   • quant computes the numbers (zero LLM cost, zero hallucination):
//       - AI desk journal (crypto spot / futures / global / India
//         agent + manual executions) — CLOSE + PARTIAL_TP entries of
//         the rolling last 7 IST days
//       - calibration (trust.js — claimed confidence vs realized
//         win-rate, Brier, monthly drift)
//       - NSE intraday paper desk week (journal.js stats)
//   • ONE LLM call narrates the numbers (the "quant-computes,
//     LLM-narrates" pattern every other desk report here uses).
//
// Served at POST /api/ai/weekly-review, pushed by the Sunday 19:00
// IST cron (AI_WEEKLY_REVIEW_PUSH=off disables), and shown by the
// Telegram bot's /weeklyreview command.
// ============================================================
import { loadJournal } from './coindcxOrders.js';
import { trustReport } from './trust.js';
import { askLLM } from '../intraday/agent.js';
import { getJournal, getWeekKey } from '../intraday/journal.js';
import { sendTelegramMessage, telegramConfig } from './secrets.js';

const DAY_MS = 24 * 60 * 60 * 1000;

function istDayKey(date = new Date()) {
  return new Date(date).toLocaleDateString('sv-SE', { timeZone: 'Asia/Kolkata' });
}

// ---------------- quant layer (pure, testable) ----------------
/**
 * Aggregate the AI trading journal's closed trades for the rolling
 * last `days` IST days. CLOSE entries carry the realized P&L;
 * PARTIAL_TP entries are the staged profit bookings.
 * v10.15 (deep-recheck #2 S3): adds the DIRECTION + ENTRY-HOUR split —
 * a systematic "shorts are consistently wrong" or "first-15-min entries
 * lose" pattern hides inside a blended overall win-rate; the split
 * comes from closed POSITIONS (they carry side + openedAt; CLOSE
 * entries don't) — labeled honestly in the payload.
 */
export function computeAiDeskWeek(journal, { days = 7, now = Date.now() } = {}) {
  const cutoff = istDayKey(new Date(now - (days - 1) * DAY_MS));
  const cutoffMs = Date.parse(`${cutoff}T00:00:00+05:30`) || (now - days * DAY_MS);
  const entries = Array.isArray(journal?.entries) ? journal.entries : [];
  const closes = entries.filter(e => e?.kind === 'CLOSE' && typeof e.day === 'string' && e.day >= cutoff);
  const partials = entries.filter(e => e?.kind === 'PARTIAL_TP' && typeof e.day === 'string' && e.day >= cutoff);

  const wins = closes.filter(e => (Number(e.pnlINR) || 0) > 0);
  const losses = closes.filter(e => (Number(e.pnlINR) || 0) < 0);
  const netPnlINR = +closes.reduce((s, e) => s + (Number(e.pnlINR) || 0), 0).toFixed(2);
  const sorted = [...closes].sort((a, b) => (Number(b.pnlINR) || 0) - (Number(a.pnlINR) || 0));
  const best = sorted[0] ? { pair: sorted[0].pair, pnlINR: sorted[0].pnlINR, reason: sorted[0].reason } : null;
  const worst = sorted.length ? { pair: sorted[sorted.length - 1].pair, pnlINR: sorted[sorted.length - 1].pnlINR, reason: sorted[sorted.length - 1].reason } : null;

  const byMode = {};
  for (const e of closes) {
    const m = String(e.mode || 'paper').toLowerCase();
    byMode[m] = (byMode[m] || 0) + 1;
  }
  const pairCount = new Map();
  for (const e of closes) pairCount.set(e.pair, (pairCount.get(e.pair) || 0) + 1);
  const topPairs = [...pairCount.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([pair, n]) => ({ pair, n }));

  // ---- v10.15 S3: the direction-accuracy breakdown (closed positions —
  // the only journal rows that carry side + openedAt) ----
  const closedPositions = (journal?.positions || []).filter(p =>
    p && String(p.status || '').toUpperCase() === 'CLOSED'
    && Number(p.closedAt || 0) >= cutoffMs);
  const totalPnlOf = (p) => (Number(p.pnlINR) || 0) + (Number(p.bookedPnlINR) || 0);
  const dirBucket = (list) => {
    if (!list.length) return { trades: 0, wins: 0, losses: 0, winRate: null, netPnlINR: 0 };
    const w = list.filter(p => totalPnlOf(p) > 0).length;
    return {
      trades: list.length, wins: w, losses: list.length - w,
      winRate: Math.round((w / list.length) * 1000) / 10,
      netPnlINR: +list.reduce((s, p) => s + totalPnlOf(p), 0).toFixed(2),
    };
  };
  const byDirection = {
    LONG: dirBucket(closedPositions.filter(p => /^(L|B)/i.test(String(p.side || '')))),
    SHORT: dirBucket(closedPositions.filter(p => /^(S|SELL)/i.test(String(p.side || '')) || String(p.side || '').toUpperCase() === 'SELL')),
  };
  // entry-hour buckets (IST hour of openedAt): 09-10, 10-11, … — the
  // "first-15-min entries lose" / "post-lunch chop" pattern detector
  const hourBuckets = new Map();
  for (const p of closedPositions) {
    if (!Number(p.openedAt || 0)) continue;
    const istHour = new Date(p.openedAt).toLocaleString('en-GB', { timeZone: 'Asia/Kolkata', hour: '2-digit', hour12: false });
    const h = parseInt(istHour, 10) % 24;
    const key = `${String(h).padStart(2, '0')}:00-${String((h + 1) % 24).padStart(2, '0')}:00`;
    if (!hourBuckets.has(key)) hourBuckets.set(key, []);
    hourBuckets.get(key).push(p);
  }
  const byEntryHour = [...hourBuckets.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([hour, list]) => ({ hour, ...dirBucket(list) }))
    .filter(b => b.trades > 0);

  // ---- v10.15 GAP 3: the PATIENCE A/B — ENTRY_MODE markers (immediate
  // vs patient, joined to closed positions by positionId) answer "did
  // patient entries beat immediate entries?" with numbers. ----
  const modeMarkers = new Map(); // positionId → 'patient' | 'immediate'
  for (const e of entries) {
    if (e?.kind === 'ENTRY_MODE' && e.positionId && (e.mode === 'patient' || e.mode === 'immediate')) {
      modeMarkers.set(e.positionId, e.mode);
    }
  }
  const modeLists = { immediate: [], patient: [] };
  for (const p of closedPositions) {
    const m = modeMarkers.get(p.id);
    if (m) modeLists[m].push(p);
  }
  const missedPullbacks = entries.filter(e => e?.kind === 'MISSED_PULLBACK' && typeof e.day === 'string' && e.day >= cutoff).length;
  const byEntryMode = {
    immediate: dirBucket(modeLists.immediate),
    patient: dirBucket(modeLists.patient),
    missedPullbacks,
    note: 'immediate vs patient closed-position win-rates + the unfilled-window count (a discipline win, not a loss)',
  };

  return {
    days,
    cutoff,
    trades: closes.length,
    wins: wins.length,
    losses: losses.length,
    winRate: closes.length ? Math.round((wins.length / closes.length) * 1000) / 10 : null,
    netPnlINR,
    avgPnlINR: closes.length ? +(netPnlINR / closes.length).toFixed(2) : null,
    best, worst, byMode, topPairs,
    partialBookings: partials.length,
    hadActivity: closes.length > 0 || partials.length > 0,
    // v10.15 S3: the standing answer to "kya sab trades ka direction sahi
    // de raha hai?" — computed from closed positions (n may differ from
    // `trades`: entries vs positions — both are honest counts).
    direction: {
      byDirection,
      byEntryHour,
      note: 'split computed from closed journal positions (side + entry hour); overall numbers above use CLOSE entries',
    },
    byEntryMode,
  };
}

/** The full quant payload both the route and the cron narrate. */
export function weeklyQuantView({ now = Date.now() } = {}) {
  const ai = computeAiDeskWeek(loadJournal(), { now });
  const calibration = trustReport();
  let intraday = null;
  try {
    const j = getJournal(7);
    intraday = j?.stats || null;
  } catch { /* intraday journal optional */ }
  return { ai, calibration, intraday, weekKey: getWeekKey(new Date(now)), asOf: now };
}

const WEEKLY_SYSTEM = `You are the DESK PERFORMANCE COACH writing the WEEKLY trade-performance digest for a multi-desk retail trader (crypto spot/futures + NSE intraday paper + global desks). Use ONLY the numbers below — never invent trades. Be brutally specific, name pairs, credit repeatable wins.

Output (STRICT, Hinglish, max 250 words):
**Week Scorecard** — trades, win-rate, net P&L across the AI desk
**Direction Read** — LONG vs SHORT win-rate split + entry-hour buckets (agar ek side systematically galat hai, naam lo)
**Calibration Read** — claimed confidence vs realized win-rate, Brier verdict, monthly drift (kya keh raha hai)
**Best & Worst** — name the trades and why
**Discipline Audit** — SL discipline, booking behaviour, overtrading check
**Next Week Ka Plan** — 3 concrete, measurable rules
End with: "Week Verdict: GREEN/AMBER/RED" (green = profitable + disciplined).`;

function _quantPromptBlock(q) {
  const { ai, calibration, intraday } = q;
  const lines = [];
  lines.push(`AI DESK (rolling ${ai.days}d, since ${ai.cutoff}):`);
  lines.push(`closed trades ${ai.trades} (${ai.wins}W/${ai.losses}L${ai.winRate != null ? `, win-rate ${ai.winRate}%` : ''}), net ₹${ai.netPnlINR}, avg ₹${ai.avgPnlINR ?? '—'}, partial bookings ${ai.partialBookings}`);
  lines.push(`by mode: ${Object.entries(ai.byMode).map(([m, n]) => `${m} ${n}`).join(', ') || 'none'}`);
  if (ai.best) lines.push(`best: ${ai.best.pair} ₹${ai.best.pnlINR} (${ai.best.reason || '?'})`);
  if (ai.worst) lines.push(`worst: ${ai.worst.pair} ₹${ai.worst.pnlINR} (${ai.worst.reason || '?'})`);
  if (ai.topPairs.length) lines.push(`most traded: ${ai.topPairs.map(p => `${p.pair} x${p.n}`).join(', ')}`);
  // v10.15 S3: the direction-accuracy read — "kya SHORT side systematically
  // galat hai?" gets a number, not a vibe.
  const d = ai.direction?.byDirection || {};
  if ((d.LONG?.trades || 0) + (d.SHORT?.trades || 0) > 0) {
    lines.push(`direction split: LONG ${d.LONG.trades} trades ${d.LONG.winRate != null ? `${d.LONG.winRate}% WR` : ''} net ₹${d.LONG.netPnlINR} · SHORT ${d.SHORT.trades} trades ${d.SHORT.winRate != null ? `${d.SHORT.winRate}% WR` : ''} net ₹${d.SHORT.netPnlINR}`);
  }
  const hours = (ai.direction?.byEntryHour || []).filter(b => b.trades >= 2).slice(0, 4);
  for (const b of hours) {
    lines.push(`entry-hour ${b.hour}: ${b.trades} trades ${b.winRate != null ? `${b.winRate}% WR` : ''} net ₹${b.netPnlINR}`);
  }
  // v10.15 GAP 3: the patience A/B — did resting at pullbacks beat chasing?
  const em = ai.byEntryMode;
  if (em && ((em.immediate?.trades || 0) + (em.patient?.trades || 0)) > 0) {
    lines.push(`patience A/B: immediate ${em.immediate.trades} trades ${em.immediate.winRate != null ? `${em.immediate.winRate}% WR` : ''} · patient ${em.patient.trades} trades ${em.patient.winRate != null ? `${em.patient.winRate}% WR` : ''} · missed-pullback windows ${em.missedPullbacks}`);
  }
  lines.push('');
  lines.push(`CALIBRATION (ledger, all-time settled ${calibration.settled}):`);
  if (calibration.sufficient) {
    lines.push(`overall win-rate ${calibration.overall?.winRate}% vs avg claimed confidence ${calibration.overall?.avgConfidence}%; Brier ${calibration.brier} (${calibration.brierVerdict}); monthly drift ${calibration.drift ?? 'n/a'}`);
    const buckets = (calibration.calibration || []).slice(0, 5)
      .map(b => `${b.bucket}: claimed ${Math.round(b.claimed)}% → real ${b.winRate}% (n=${b.n})`).join('; ');
    if (buckets) lines.push(`buckets: ${buckets}`);
  } else {
    lines.push(calibration.note || 'insufficient settled signals for calibration');
  }
  lines.push('');
  lines.push('NSE INTRADAY PAPER DESK (this week):');
  if (intraday && intraday.count > 0) {
    lines.push(`${intraday.count} trades, ${intraday.wins}W/${intraday.losses}L, net ₹${intraday.netPnl}, avg ${intraday.avgR ?? 'n/a'}R`);
  } else {
    lines.push('no closed paper trades this week');
  }
  return lines.join('\n');
}

/** The quant header Telegram gets ABOVE the narration — the numbers
 *  themselves are always visible, LLM or not. */
export function quantHeaderBlock(q) {
  const { ai, calibration } = q;
  const lines = [
    `📊 <b>WEEKLY TRADE-PERFORMANCE REVIEW</b>`,
    `━━━━━━━━━━━━━━━━━━━━━━━`,
    `🤖 <b>AI desk (${ai.days}d)</b>: ${ai.trades} closed (${ai.wins}W/${ai.losses}L${ai.winRate != null ? ` · ${ai.winRate}%` : ''}) · net <b>₹${ai.netPnlINR.toLocaleString('en-IN')}</b>${ai.partialBookings ? ` · ${ai.partialBookings} partial bookings` : ''}`,
  ];
  const d = ai.direction?.byDirection || null;
  if (d && (d.LONG?.trades || 0) + (d.SHORT?.trades || 0) > 0) {
    lines.push(`🧭 <b>Direction split</b>: LONG ${d.LONG.trades}${d.LONG.winRate != null ? ` · ${d.LONG.winRate}% WR` : ''} · SHORT ${d.SHORT.trades}${d.SHORT.winRate != null ? ` · ${d.SHORT.winRate}% WR` : ''}`);
  }
  if (calibration.sufficient) {
    lines.push(`🎯 <b>Calibration</b>: claimed ${calibration.overall?.avgConfidence}% → realized ${calibration.overall?.winRate}% · Brier ${calibration.brier}`);
  }
  return lines.join('\n');
}

// ---------------- orchestration ----------------
const _cache = new Map(); // weekKey → result
let _inflight = null;

export async function runWeeklyPerformanceReview(deps = {}, { now = Date.now(), force = false } = {}) {
  const weekKey = getWeekKey(new Date(now));
  if (!force && _cache.has(weekKey)) return { ok: true, ..._cache.get(weekKey), cached: true };
  if (_inflight) return _inflight;
  _inflight = _runWeekly(deps, weekKey, now).finally(() => { _inflight = null; });
  return _inflight;
}

async function _runWeekly(deps, weekKey, now) {
  const { KEYS, OPENAI_COMPAT } = deps || {};
  const q = weeklyQuantView({ now });

  if (!q.ai.hadActivity && !(q.intraday?.count > 0)) {
    return { ok: false, error: 'Is hafte koi settled trade nahi — AI desk bhi, intraday paper desk bhi. Review ke liye data hi nahi. Trades hone do, phir /weeklyreview.' };
  }

  const r = await askLLM(WEEKLY_SYSTEM, `WEEK OF: ${weekKey}\n\n${_quantPromptBlock(q)}`, { KEYS, OPENAI_COMPAT }, { temperature: 0.4, maxTokens: 1600, timeout: 45000 });
  if (!r) {
    // No LLM → still return the QUANT view (numbers need no engine).
    const out = {
      ok: true, weekKey, engine: null, ts: Date.now(),
      quant: q, text: `${quantHeaderBlock(q)}\n\n<i>LLM narration unavailable — quant numbers upar hain (engine keys check karo).</i>`,
    };
    _cache.set(weekKey, out);
    return { ...out, cached: false };
  }

  const out = {
    ok: true, weekKey, engine: r.engine, ts: Date.now(),
    quant: q, text: `${quantHeaderBlock(q)}\n\n${r.text}`,
  };
  _cache.set(weekKey, out);
  // keep the last 8 weeks
  if (_cache.size > 8) {
    for (const k of [..._cache.keys()].sort().slice(0, _cache.size - 8)) _cache.delete(k);
  }
  return { ...out, cached: false };
}

/** Telegram push (the Sunday cron + the bot's /weeklyreview use it). */
export async function pushWeeklyReview(deps = {}) {
  const cfgTG = telegramConfig({});
  if (!cfgTG) return { ok: false, error: 'telegram not configured' };
  const out = await runWeeklyPerformanceReview(deps);
  if (!out.ok) return out;
  const r = await sendTelegramMessage(out.text, { token: cfgTG.token, chatId: cfgTG.chatId });
  return { ...out, pushed: !!r?.ok, pushError: r?.ok ? null : r?.error };
}

/** Sunday 19:00 IST auto-push (AI_WEEKLY_REVIEW_PUSH=off disables). */
export function weeklyAutoPushEnabled() {
  return String(process.env.AI_WEEKLY_REVIEW_PUSH || '').toLowerCase() !== 'off';
}

export function scheduleWeeklyReviewPush(deps) {
  if (!weeklyAutoPushEnabled()) return false;
  try {
    // lazy import pattern would be cleaner, but node-cron is already a
    // hard dependency of the intraday routes on the same server.
    import('node-cron').then(({ default: cron }) => {
      cron.schedule('0 19 * * 0', async () => {
        try {
          const out = await pushWeeklyReview(deps());
          console.log(`[weekly-review] Sunday push: ${out.ok ? (out.pushed ? 'sent' : (out.error || 'computed')) : (out.error || 'skip')}`);
        } catch (e) { console.warn('[weekly-review] Sunday push failed:', e?.message); }
      }, { timezone: 'Asia/Kolkata' });
      console.log('[weekly-review] Sunday 19:00 IST auto-push scheduled');
    }).catch(() => { /* cron unavailable — manual /weeklyreview still works */ });
    return true;
  } catch { return false; }
}

export function weeklyReviewStatus() {
  return {
    ok: true,
    autoPush: weeklyAutoPushEnabled(),
    cachedWeeks: [..._cache.keys()].sort().slice(-4),
    last: _cache.size ? _cache.get([..._cache.keys()].sort().slice(-1)[0])?.ts ?? null : null,
    note: 'Quant-computed numbers + one LLM narration. POST /api/ai/weekly-review computes; Sunday 19:00 IST pushes.',
  };
}

// ---------------- test hooks ----------------
export function __weeklyCacheForTests() { return _cache; }
export function __resetWeeklyReviewForTests() { _cache.clear(); _inflight = null; }
