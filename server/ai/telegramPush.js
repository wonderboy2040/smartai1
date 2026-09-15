// ============================================================
// server/ai/telegramPush.js — v10.9 INSTANT TELEGRAM PUSH
// ------------------------------------------------------------
// THE GAP: SL/target hits and fresh STRONG signals reached Telegram
// only when a 60s watcher (server) or the legacy bot's 10-minute
// cron got around to them. A fast crypto move could hit your stop
// and report a minute late — or ten.
//
// THE FIX: a price-driven Telegram sink that polls the SAME
// position view the realtime SSE stream serves (getPositionsWithPnl
// — cached upstream chains, cheap) every 5 seconds while positions
// are open, and pushes the moment a level is TOUCHED:
//
//   ⚡ SL / TP1 / TP2 / liquidation level touch  → instant push
//   ⚡ fresh STRONG-grade board signal            → instant push
//     (30s board read — the board's own 60-90s cache + single-
//      flight keeps the underlying compute unchanged)
//
// The 60s watchers stay as the EXECUTORS (they own the actual
// close + the fill-confirmed message with realized P&L) and the
// legacy bot's 10-min cron becomes a backup heartbeat (it checks
// /api/ai/insta-push/status and only fires when this pipeline is
// stale). Instant push = the early warning; watcher = the truth.
//
// All sends go through ONE shared dedupe map so the 30s sink scan
// and the 60s backup alerter (routes.js) can never double-send.
// ============================================================
import { getPositionsWithPnl, loadConfig } from './coindcxOrders.js';
import { sendTelegramMessage, telegramConfig } from './secrets.js';
import { pairCorrelation } from './correlation.js';

const TICK_ACTIVE_MS = 5000;   // open positions on the book
const TICK_IDLE_MS = 15000;    // nothing open — watch for agent-opened entries
const TOUCH_COOLDOWN_MS = 30 * 60 * 1000;  // one push per position+level / 30 min
const STRONG_COOLDOWN_MS = 30 * 60 * 1000; // same as the legacy 60s alerter
const SIGNAL_SCAN_EVERY_N_TICKS = 6;        // ~30s at the active cadence
const CORRELATION_BUNDLE_R = 0.75;          // r ≥ this = one move in disguise (#7)

// ---------------- state ----------------
let _timer = null;
let _ticking = false;
let _tickN = 0;
let _deps = null;               // { getSignals, depsForSignals } — injected at registration
const _touchAlerts = new Map(); // "id:kind" → ts
const _strongAlerts = new Map(); // "mkt:sym:side" → ts
const _status = {
  started: false,
  enabled: true,
  startedAt: null,
  lastOkAt: null,     // last successful poll — the pipeline heartbeat
  lastPushAt: null,
  slTpPushes: 0,
  signalPushes: 0,
  lastError: null,
};

/** Feature flag — AI_INSTANT_PUSH=off reverts to watcher-only alerts. */
export function instantPushEnabled() {
  return String(process.env.AI_INSTANT_PUSH || '').toLowerCase() !== 'off';
}

// ---------------- pure detection (testable) ----------------
/**
 * Which protective levels are being touched RIGHT NOW by OPEN positions.
 * @param {Array} positions rows of getPositionsWithPnl (status 'OPEN')
 * @returns {Array<{id,pair,market,side,kind,level,ltp,unrealizedPnlINR,leverage}>}
 */
export function detectLevelTouches(positions) {
  const out = [];
  for (const p of (Array.isArray(positions) ? positions : [])) {
    if (!p || p.status !== 'OPEN') continue;
    const long = p.side === 'LONG';
    const ltp = Number(p.ltp);
    if (!Number.isFinite(ltp) || ltp <= 0) continue;
    const fin = (v) => (v != null && Number.isFinite(Number(v)) && Number(v) > 0 ? Number(v) : null);

    const sl = fin(p.sl);
    if (sl != null && (long ? ltp <= sl : ltp >= sl)) {
      out.push(_touch(p, 'SL', sl, ltp));
    }
    const liq = fin(p.liquidation);
    if ((p.leverage || 1) > 1 && liq != null && (long ? ltp <= liq : ltp >= liq)) {
      out.push(_touch(p, 'LIQ', liq, ltp));
    }
    const tp = fin(p.tp);
    if (tp != null && !p.tp1Hit && (long ? ltp >= tp : ltp <= tp)) {
      out.push(_touch(p, 'TP1', tp, ltp));
    }
    const tp2 = fin(p.tp2);
    if (tp2 != null && !p.tp2Hit && (long ? ltp >= tp2 : ltp <= tp2)) {
      out.push(_touch(p, 'TP2', tp2, ltp));
    }
  }
  return out;
}

function _touch(p, kind, level, ltp) {
  return {
    id: p.id, pair: p.pair, market: p.market || null, side: p.side,
    kind, level, ltp,
    unrealizedPnlINR: Number.isFinite(Number(p.unrealizedPnlINR)) ? p.unrealizedPnlINR : null,
    leverage: p.leverage || 1,
  };
}

/** Cooldown gate — pure. */
export function cooldownOk(map, key, now = Date.now(), cooldownMs = TOUCH_COOLDOWN_MS) {
  const last = map.get(key) || 0;
  return now - last >= cooldownMs;
}

function _curOf(market) {
  return market === 'FUTURES' ? ' USDT' : market === 'GLOBALFUTURES' ? ' USDC ' : ' ₹';
}

function _fmt(v, market) {
  const n = Number(v);
  if (!Number.isFinite(n)) return '—';
  const sym = market === 'FUTURES' ? '' : market === 'GLOBALFUTURES' ? 'USDC ' : '₹';
  const num = market === 'INDIA' || !market || market === 'CRYPTO'
    ? n.toLocaleString('en-IN', { maximumFractionDigits: Math.abs(n) < 1 ? 6 : 2 })
    : n.toLocaleString('en-US', { maximumFractionDigits: 4 });
  return `${sym}${num}${market === 'FUTURES' ? ' USDT' : ''}`;
}

/** Format one level touch as the instant-push message (HTML). */
export function formatLevelTouch(t) {
  const EMOJI = { SL: '🛑', LIQ: '☠️', TP1: '🎯', TP2: '🏆' };
  const LABEL = { SL: 'STOP-LOSS TOUCHED', LIQ: 'LIQUIDATION ZONE', TP1: 'TARGET-1 TOUCHED', TP2: 'TARGET-2 TOUCHED' };
  const pnl = t.unrealizedPnlINR != null ? ` · unrealized ₹${Math.round(t.unrealizedPnlINR).toLocaleString('en-IN')}` : '';
  const lev = t.leverage > 1 ? ` · ${t.leverage}x` : '';
  return [
    `⚡${EMOJI[t.kind] || '⚠️'} <b>INSTANT — ${LABEL[t.kind] || 'LEVEL TOUCH'}</b>`,
    `<b>${t.pair || t.id}</b> ${t.side}${lev} · LTP <b>${_fmt(t.ltp, t.market)}</b> vs ${t.kind} ${_fmt(t.level, t.market)}${pnl}`,
    `🤖 executor watcher ka fill-confirmed message ≤60s me aayega — ye level-touch early warning hai.`,
  ].join('\n');
}

/** The STRONG-signal message — EXACTLY the legacy alerter's format
 *  (users see one format, whichever path fires first). */
export function formatStrongSignal(s, mkt) {
  return `🤖 <b>STRONG SIGNAL</b> — ${mkt === 'INDIA' ? '🇮🇳 NSE' : '₿ Crypto'} · ${s.symbol} ${s.side}\n` +
    `Confidence ${s.confidence}% · agreement ${Math.round((s.agreement || 0) * 100)}% · ${s.participating}/${s.totalModels} models\n` +
    (s.plan ? `Entry ₹${s.plan.entry} · SL ₹${s.plan.stopLoss} · T2 ₹${s.plan.target2} (R:R 1:${s.plan.rewardRisk})` : '');
}

// ---------------- #7: correlation-aware bundling ----------------
/**
 * Union-find clusters of signals whose pairwise 60d correlation ≥
 * threshold (lookup returns r or null — UNKNOWN, never a fake 0 —
 * unknown pairs stay SEPARATE). Pure: the async lookup is injected.
 * @param {Array} signals STRONG signals from ONE scan pass
 * @param {(a:string,b:string) => Promise<number|null>} lookup
 * @returns {Promise<Array<{signals:Array, rMax:number}>>}
 */
export async function groupCorrelatedSignals(signals, { lookup, threshold = CORRELATION_BUNDLE_R } = {}) {
  const sigs = (Array.isArray(signals) ? signals : []).filter(s => s && s.symbol);
  const parent = new Map(sigs.map(s => [s.symbol, s.symbol]));
  const find = (x) => {
    let root = x;
    while (parent.get(root) !== root) root = parent.get(root);
    parent.set(x, root); // path compression
    return root;
  };
  const union = (a, b) => { parent.set(find(a), find(b)); };
  const pairR = []; // [a, b, r] — every correlated union
  for (let i = 0; i < sigs.length; i++) {
    for (let j = i + 1; j < sigs.length; j++) {
      if (find(sigs[i].symbol) === find(sigs[j].symbol)) continue;
      let r = null;
      try { r = await lookup(sigs[i].symbol, sigs[j].symbol); } catch { r = null; }
      if (r != null && Number.isFinite(r) && r >= threshold) {
        union(sigs[i].symbol, sigs[j].symbol);
        pairR.push([sigs[i].symbol, sigs[j].symbol, r]);
      }
    }
  }
  const clusters = new Map(); // root → signals[]
  for (const s of sigs) {
    const root = find(s.symbol);
    if (!clusters.has(root)) clusters.set(root, []);
    clusters.get(root).push(s);
  }
  const rMaxOf = (clusterSignals) => {
    const set = new Set(clusterSignals.map(s => s.symbol));
    let m = 0;
    for (const [a, b, r] of pairR) if (set.has(a) && set.has(b) && r > m) m = r;
    return m;
  };
  return [...clusters.values()].map(cs => ({ signals: cs, rMax: rMaxOf(cs) }));
}

/** A cluster of 2+ correlated STRONG signals as ONE message —
 *  'BTC + ETH breaking out together' is ONE notification, not three. */
export function formatStrongBundle(cluster, mkt, rMax) {
  const head = `🤖 <b>STRONG SIGNALS — ${cluster.length} correlated moves</b> ${mkt === 'INDIA' ? '🇮🇳' : '₿'} <i>(60d r ≥ ${Math.round(rMax * 100)}% — ek hi trade hai, diversify ka dhyan)</i>`;
  const rows = cluster.map(s =>
    `• <b>${s.symbol}</b> ${s.side} · conf ${s.confidence}% · ${s.participating}/${s.totalModels} models` +
    (s.plan ? `\n  Entry ₹${s.plan.entry} · SL ₹${s.plan.stopLoss} · T2 ₹${s.plan.target2}` : ''));
  return [head, ...rows].join('\n');
}

// ---------------- shared send path ----------------
/** Dedupe + send. @returns {Promise<boolean>} true when pushed. */
async function _pushIfFresh(map, key, text, cooldownMs, send) {
  if (!cooldownOk(map, key, Date.now(), cooldownMs)) return false;
  map.set(key, Date.now());
  // prune so the maps can't grow unbounded (same hygiene as routes.js)
  if (map.size > 200) {
    const cutoff = Date.now() - cooldownMs;
    for (const [k, ts] of map) if (ts < cutoff) map.delete(k);
  }
  const r = await send(text);
  return !!r?.ok;
}

// ---------------- shared STRONG scan (sink + backup, one code path) ----------------
/**
 * Scan ONE market's board for fresh STRONG signals and push them —
 * correlated clusters (r ≥ 0.75, #7) go out as ONE bundled message
 * so "BTC + ETH together" pings once, not twice. Used by BOTH the
 * 30s instant sink and the 60s backup alerter through the SAME
 * dedupe map — whichever sees it first wins, the other no-ops.
 * @returns {Promise<number>} pushes sent
 */
async function _scanAndPushStrongs(mkt, { getSignals, depsForSignals }, send) {
  const board = await getSignals(mkt, depsForSignals(), { limit: 5 }).catch(() => null);
  const strongs = (board?.signals || []).filter(s => s.grade === 'STRONG');
  const fresh = strongs.filter(s => cooldownOk(_strongAlerts, `${mkt}:${s.symbol}:${s.side}`));
  if (!fresh.length) return 0;

  // #7 bundling — crypto bases are what pairCorrelation knows; INDIA
  // symbols stay per-signal (no honest r without a mapping).
  if (mkt === 'CRYPTO' && fresh.length >= 2) {
    const clusters = await groupCorrelatedSignals(fresh, { lookup: pairCorrelation });
    let pushed = 0;
    for (const { signals: cluster, rMax } of clusters) {
      const keys = cluster.map(s => `${mkt}:${s.symbol}:${s.side}`);
      if (cluster.length >= 2) {
        // mark EVERY member first — a later singleton must not re-ping
        const now = Date.now();
        for (const k of keys) _strongAlerts.set(k, now);
        const r = await send(formatStrongBundle(cluster, mkt, rMax));
        if (r?.ok) pushed++;
      } else {
        if (await _pushIfFresh(_strongAlerts, keys[0], formatStrongSignal(cluster[0], mkt), STRONG_COOLDOWN_MS, send)) pushed++;
      }
    }
    return pushed;
  }

  let pushed = 0;
  for (const s of fresh) {
    if (await _pushIfFresh(_strongAlerts, `${mkt}:${s.symbol}:${s.side}`, formatStrongSignal(s, mkt), STRONG_COOLDOWN_MS, send)) pushed++;
  }
  return pushed;
}

// ---------------- the sink loop ----------------
async function _tick() {
  if (_ticking) return;
  _ticking = true;
  let nextDelay = TICK_ACTIVE_MS;
  try {
    const cfgTG = telegramConfig({});
    if (!cfgTG) { nextDelay = 60_000; return; } // park cheaply; re-check for runtime key config

    const send = (text) => sendTelegramMessage(text, { token: cfgTG.token, chatId: cfgTG.chatId });

    // --- 1) SL/TP/LIQ level touches (the 5s price-driven win) ---
    const view = await getPositionsWithPnl();
    const positions = Array.isArray(view?.positions) ? view.positions : [];
    const open = positions.filter(p => p.status === 'OPEN');
    for (const t of detectLevelTouches(open)) {
      const pushed = await _pushIfFresh(_touchAlerts, `${t.id}:${t.kind}`, formatLevelTouch(t), TOUCH_COOLDOWN_MS, send);
      if (pushed) {
        _status.slTpPushes++;
        _status.lastPushAt = Date.now();
        console.log(`[insta-push] ${t.kind} touch ${t.pair} @ ${t.ltp}`);
      }
    }
    nextDelay = open.length > 0 ? TICK_ACTIVE_MS : TICK_IDLE_MS;

    // --- 2) fresh STRONG signals (every ~30s; board cache + single-
    //     flight keeps the underlying compute at its own cadence) ---
    _tickN++;
    if (_tickN % SIGNAL_SCAN_EVERY_N_TICKS === 0 && _deps?.getSignals) {
      const cfg = loadConfig();
      if (!cfg.killSwitch) { // parity with the legacy alerter
        for (const mkt of ['CRYPTO', 'INDIA']) {
          const pushed = await _scanAndPushStrongs(mkt, _deps, send);
          if (pushed) {
            _status.signalPushes += pushed;
            _status.lastPushAt = Date.now();
          }
        }
      }
    }
    _status.lastOkAt = Date.now();
    _status.lastError = null;
  } catch (e) {
    _status.lastError = String(e?.message || e).slice(0, 160);
  } finally {
    _ticking = false;
    if (_timer) {
      _timer = setTimeout(_tick, nextDelay);
      if (typeof _timer.unref === 'function') _timer.unref();
    }
  }
}

/**
 * Boot the sink (idempotent). Called from ai/routes.js registration with
 * the SAME getSignals + deps the boards use — no second pipeline.
 */
export function startInstaPushSink({ getSignals, depsForSignals } = {}) {
  if (_deps == null && getSignals) _deps = { getSignals, depsForSignals };
  if (_timer) return; // already running
  if (!instantPushEnabled()) { _status.enabled = false; return; }
  _status.started = true;
  _status.startedAt = Date.now();
  _timer = setTimeout(_tick, 3_000);
  if (typeof _timer.unref === 'function') _timer.unref();
  console.log('[insta-push] Telegram instant-push sink armed (5s levels · 30s STRONG scan · watchers stay executors)');
}

/** The backup alerter's scan — SAME dedupe map so nothing double-sends.
 *  routes.js's 60s loop calls this; whichever path sees the signal first
 *  wins, the other no-ops. */
export async function scanStrongSignalsBackup({ getSignals, depsForSignals, markets = ['CRYPTO', 'INDIA'] } = {}) {
  const cfgTG = telegramConfig({});
  if (!cfgTG) return { ok: false, pushed: 0 };
  const send = (text) => sendTelegramMessage(text, { token: cfgTG.token, chatId: cfgTG.chatId });
  let pushed = 0;
  const cfg = loadConfig();
  if (cfg.killSwitch) return { ok: true, pushed };
  for (const mkt of markets) {
    const n = await _scanAndPushStrongs(mkt, { getSignals, depsForSignals }, send);
    if (n) {
      pushed += n;
      _status.signalPushes += n;
      _status.lastPushAt = Date.now();
    }
  }
  return { ok: true, pushed };
}

/** Pipeline health — the legacy bot's backup cron consults this. */
export function instaPushStatus() {
  return {
    ok: true,
    enabled: _status.enabled && instantPushEnabled(),
    started: _status.started,
    startedAt: _status.startedAt,
    lastOkAt: _status.lastOkAt,
    lastPushAt: _status.lastPushAt,
    slTpPushes: _status.slTpPushes,
    signalPushes: _status.signalPushes,
    lastError: _status.lastError,
    // healthy = a poll succeeded within the last 3 minutes. The legacy
    // bot's 10-min cron uses this to decide backup vs silence.
    healthy: !!(_status.lastOkAt && Date.now() - _status.lastOkAt < 3 * 60 * 1000 && instantPushEnabled()),
    note: 'Instant push = early warning (level touch). Watcher = executor + fill truth. Legacy cron = backup heartbeat only.',
  };
}

// ---------------- test hooks ----------------
export async function __tickForTests() { await _tick(); }
export function __statusForTests() { return _status; }
export function __mapsForTests() { return { _touchAlerts, _strongAlerts }; }
export function __depsForTests() { return _deps; }
export function __setDepsForTests(d) { _deps = d; }
export function __resetInstaPushForTests() {
  if (_timer) { clearTimeout(_timer); _timer = null; }
  _ticking = false;
  _tickN = 0;
  _touchAlerts.clear();
  _strongAlerts.clear();
  Object.assign(_status, {
    started: false, enabled: true, startedAt: null, lastOkAt: null,
    lastPushAt: null, slTpPushes: 0, signalPushes: 0, lastError: null,
  });
}
