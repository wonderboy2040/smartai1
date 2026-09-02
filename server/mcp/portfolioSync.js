// ============================================================
// server/mcp/portfolioSync.js — INDMoney → SmartAI assets pipeline
// ------------------------------------------------------------
// Turns the INDMoney MCP holdings snapshot into the app's ASSET
// TABLE source of truth:
//   1. syncNow()      — fetchPortfolio (MCP) → resolveSymbols →
//                       map to unified assets → persist snapshot
//                       (server/data/mcp-portfolio.json).
//   2. Scheduler      — auto-sync 2× daily (default 09:30 & 21:30
//                       IST; env INDM_SYNC_TIMES="HH:MM,HH:MM"),
//                       with boot catch-up for missed slots (Render
//                       free-tier cold starts) and a stale-trigger
//                       on GET /assets (>6h old → background sync).
//   3. Realtime       — exchange-listed assets (India stocks/ETFs,
//                       US stocks, crypto) carry tradeable symbols;
//                       the frontend pollers/SSE then tick them live.
//                       MF/FD/bond/gold/EPF/NPS assets keep
//                       INDMoney's own unit price (NAV) and are
//                       refreshed on each scheduled sync.
//
// A failed sync NEVER wipes the last good snapshot — the previous
// assets stay visible with a stale marker.
// ============================================================
import { loadJSON, saveJSON } from '../intraday/store.js';
import { fetchPortfolio, getStatus } from './indmoney.js';
import { resolveSymbolsForHoldings } from './symbols.js';

const SNAPSHOT_FILE = 'mcp-portfolio.json';
const FOREX_CACHE_MS = 10 * 60 * 1000;
const STALE_BG_MS = 6 * 60 * 60 * 1000;    // GET /assets triggers a bg sync past this age
const BG_MIN_GAP = 10 * 60 * 1000;         // …but never more often than this
const CATCHUP_WINDOW_MS = 4 * 60 * 60 * 1000; // a missed slot syncs up to 4h late
const DEFAULT_USD_INR = 84;

const FOREX_UPSTREAMS = [
  'https://open.er-api.com/v6/latest/USD',
  'https://api.frankfurter.app/latest?from=USD&to=INR',
];
let _fx = { rate: null, ts: 0 };

// ---------------- IST clock (UTC+5:30, no DST) ----------------
export function istParts(d = new Date()) {
  const ist = new Date(d.getTime() + 330 * 60 * 1000);
  return {
    y: ist.getUTCFullYear(), m: ist.getUTCMonth() + 1, d: ist.getUTCDate(),
    hh: ist.getUTCHours(), mm: ist.getUTCMinutes(),
  };
}
function istDayKey(ts) { const p = istParts(new Date(ts)); return `${p.y}-${String(p.m).padStart(2, '0')}-${String(p.d).padStart(2, '0')}`; }

// Parse "HH:MM" → minutes; invalid entries are dropped.
export function parseSlots(raw) {
  const out = [];
  for (const part of String(raw || '').split(',')) {
    const m = /^(\d{1,2}):(\d{2})$/.exec(part.trim());
    if (!m) continue;
    const hh = parseInt(m[1], 10), mm = parseInt(m[2], 10);
    if (hh > 23 || mm > 59) continue;
    out.push(`${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`);
  }
  return out.length ? out : ['09:30', '21:30'];
}
export function syncSlots() { return parseSlots(process.env.INDM_SYNC_TIMES); }

// Slot timestamp (epoch ms) for TODAY in IST. Pure — exported for tests.
export function slotTsToday(slot, now = Date.now()) {
  const [hh, mm] = slot.split(':').map(n => parseInt(n, 10));
  const p = istParts(new Date(now));
  // IST wall-clock → UTC epoch: build UTC fields from IST parts, then -5:30.
  const asUTC = Date.UTC(p.y, p.m - 1, p.d, hh, mm, 0);
  return asUTC - 330 * 60 * 1000;
}

// Pure scheduler decision: which slots are due at `now` given last runs.
export function computeDueSlots(now, lastRuns = {}, slots = syncSlots(), catchupMs = CATCHUP_WINDOW_MS) {
  const due = [];
  for (const slot of slots) {
    const ts = slotTsToday(slot, now);
    if (now < ts) continue;                              // slot not reached yet today
    if (now - ts > catchupMs) continue;                  // too late — skip missed slot
    const last = lastRuns[slot];
    if (last != null && istDayKey(last) === istDayKey(now)) continue; // already ran today
    due.push(slot);
  }
  return due;
}

// Next upcoming slot (epoch ms) strictly after `now` — for the UI countdown.
export function nextSlotTs(now = Date.now(), slots = syncSlots()) {
  let best = null;
  for (const slot of slots) {
    let ts = slotTsToday(slot, now);
    if (ts <= now) {
      // tomorrow's run of this slot
      const p = istParts(new Date(now));
      ts = Date.UTC(p.y, p.m - 1, p.d + 1, ...slot.split(':').map(n => parseInt(n, 10))) - 330 * 60 * 1000;
    }
    if (best == null || ts < best) best = ts;
  }
  return best;
}

// ---------------- USD/INR (for US-asset unit conversion) ----------------
async function fetchUsdInr() {
  if (_fx.rate != null && Date.now() - _fx.ts < FOREX_CACHE_MS) return _fx.rate;
  for (const url of FOREX_UPSTREAMS) {
    try {
      const r = await fetch(url, { signal: AbortSignal.timeout(5000) });
      if (!r.ok) continue;
      const j = await r.json();
      const inr = j?.rates?.INR;
      if (typeof inr === 'number' && inr > 50 && inr < 150) {
        _fx = { rate: inr, ts: Date.now() };
        return inr;
      }
    } catch { /* next upstream */ }
  }
  return _fx.rate ?? DEFAULT_USD_INR;
}

// ---------------- holdings → assets mapper (PURE) ----------------
// holdings: normalized holdings from fetchPortfolio()
// resolutions: [{ market, kind, symbol, noLive }] (from resolveSymbolsForHoldings)
// usdInr: conversion rate for US assets (their INDMoney values are INR).
export function mapHoldingsToAssets(holdings, resolutions, usdInr = DEFAULT_USD_INR) {
  const rate = (typeof usdInr === 'number' && usdInr > 50 && usdInr < 150) ? usdInr : DEFAULT_USD_INR;
  const assets = [];
  const seenIds = new Set();
  for (let i = 0; i < (holdings || []).length; i++) {
    const h = holdings[i];
    const r = resolutions[i] || { market: 'IN', kind: 'other', symbol: null, noLive: true };

    const qty = (typeof h.qty === 'number' && h.qty > 0) ? h.qty : 1;
    const invested = typeof h.invested === 'number' ? h.invested
      : (typeof h.avgPrice === 'number' ? h.avgPrice * qty : null);
    const value = typeof h.value === 'number' ? h.value
      : (typeof h.currentPrice === 'number' ? h.currentPrice * qty : invested);
    if (invested == null && value == null) continue; // nothing usable

    // Per-unit prices. US assets: INDMoney reports INR — convert to USD so
    // the frontend's US price machinery (USD quotes × live FX) stays correct.
    const isUS = r.market === 'US';
    const lastPrice = value != null ? value / qty / (isUS ? rate : 1) : null;
    const avgPrice = invested != null ? invested / qty / (isUS ? rate : 1) : (lastPrice ?? 0);

    let id = `indm-${slug(h.name)}-${i}`;
    while (seenIds.has(id)) id += 'x';
    seenIds.add(id);

    assets.push({
      id,
      name: String(h.name || 'Unknown'),
      symbol: r.symbol || null,          // tradeable exchange symbol or null
      market: isUS ? 'US' : 'IN',
      kind: r.kind,                      // stock|etf|mf|crypto|bond|gold|retirement|fixed|other
      qty,
      avgPrice: round2(avgPrice),
      lastPrice: lastPrice != null ? round2(lastPrice) : null,
      value: value != null ? round2(value) : null,       // INR (INDMoney native)
      invested: invested != null ? round2(invested) : null, // INR
      pnl: h.pnl != null ? round2(h.pnl) : (value != null && invested != null ? round2(value - invested) : null),
      pnlPct: h.pnlPct != null ? h.pnlPct : (value != null && invested ? round2(((value - invested) / invested) * 100) : null),
      oneDayChangePct: h.oneDayChangePct != null ? h.oneDayChangePct : null,
      assetType: h.assetType || 'Other',
      assetEnum: h.assetEnum || null,
      noLive: !!r.noLive,                // no exchange price → seeded INDMoney price
    });
  }
  return assets;
}

function round2(n) { return Math.round(n * 100) / 100; }
function slug(name) {
  const s = String(name || 'asset').replace(/[^A-Za-z0-9]+/g, '').toUpperCase();
  return (s.slice(0, 12) || 'ASSET');
}

// ---------------- snapshot persistence ----------------
export function getAssetsSnapshot() {
  return loadJSON(SNAPSHOT_FILE, null);
}
function writeSnapshot(snap) {
  saveJSON(SNAPSHOT_FILE, snap);
  return snap;
}

// Sync status + scheduler info for the frontend (no MCP calls).
export function syncInfo() {
  const snap = getAssetsSnapshot();
  const slots = syncSlots();
  const lastRuns = snap?.slots || {};
  return {
    connected: getStatus().connected,
    ok: !!snap?.ok,
    syncedAt: snap?.syncedAt || null,
    stale: snap?.syncedAt ? Date.now() - snap.syncedAt > STALE_BG_MS : true,
    slots,
    lastRuns,
    nextSyncAt: nextSlotTs(),
    assetCount: Array.isArray(snap?.assets) ? snap.assets.length : 0,
    liveCount: Array.isArray(snap?.assets) ? snap.assets.filter(a => !a.noLive).length : 0,
    lastError: snap?.lastError || null,
  };
}

// ---------------- the sync engine ----------------
let _inFlight = false;
let _lastBgAttempt = 0;

export async function syncNow({ force = true, reason = 'manual' } = {}) {
  if (_inFlight) return { ...syncInfo(), busy: true };
  if (!getStatus().connected) {
    const info = syncInfo();
    return { ...info, ok: false, reason: 'not-connected', assets: [] };
  }
  _inFlight = true;
  try {
    let pf;
    try {
      pf = await fetchPortfolio({ force });
    } catch (err) {
      // hard failure (network / token revoked) — keep last good assets
      const prev = getAssetsSnapshot() || {};
      writeSnapshot({
        ...prev,
        ok: false,
        lastError: String(err?.message || err).slice(0, 200),
        failedAt: Date.now(),
        slots: prev.slots || {},
      });
      return { ...syncInfo(), ok: false, error: String(err?.message || err) };
    }
    if (!pf.ok) {
      const prev = getAssetsSnapshot() || {};
      writeSnapshot({
        ...prev,
        ok: false,
        lastError: `no holdings (${pf.reason || 'unknown'})`,
        failedAt: Date.now(),
        slots: prev.slots || {},
      });
      return { ...syncInfo(), ok: false, error: `no holdings (${pf.reason})` };
    }

    const usdInr = await fetchUsdInr();
    const resolutions = await resolveSymbolsForHoldings(pf.holdings);
    const assets = mapHoldingsToAssets(pf.holdings, resolutions, usdInr);

    const prev = getAssetsSnapshot() || {};
    // Mark scheduler slots as run (scheduler passes its slot; manual marks none).
    let slots = prev.slots || {};
    if (reason && reason !== 'manual') slots = { ...slots, [reason]: Date.now() };

    writeSnapshot({
      ok: true,
      source: 'indmoney',
      syncedAt: Date.now(),
      assets,
      summary: pf.summary || null,
      officialSummary: !!pf.officialSummary,
      positions: pf.positions || [],
      counts: {
        assets: assets.length,
        live: assets.filter(a => !a.noLive).length,
        noLive: assets.filter(a => a.noLive).length,
        resolved: assets.filter(a => a.symbol).length,
      },
      lastError: null,
      failedAt: null,
      slots,
    });
    return syncInfo();
  } finally {
    _inFlight = false;
  }
}

// Background sync guard used by GET /assets: fire-and-forget when stale.
export function maybeBackgroundSync() {
  if (!getStatus().connected) return false;
  if (Date.now() - _lastBgAttempt < BG_MIN_GAP) return false;
  const snap = getAssetsSnapshot();
  const stale = !snap?.ok || !snap?.syncedAt || Date.now() - snap.syncedAt > STALE_BG_MS;
  if (!stale || _inFlight) return false;
  _lastBgAttempt = Date.now();
  void syncNow({ force: true, reason: 'stale-trigger' }).catch(() => { });
  return true;
}

// ---------------- daily 2× scheduler ----------------
let _schedTimer = null;
let _lastSchedFail = 0;      // failure backoff — never hammer INDMoney
const SCHED_FAIL_BACKOFF_MS = 10 * 60 * 1000;
export function startScheduler() {
  if (_schedTimer) return _schedTimer;
  const tick = () => {
    try {
      if (!getStatus().connected) return;
      const snap = getAssetsSnapshot() || {};
      const due = computeDueSlots(Date.now(), snap.slots || {});
      if (due.length === 0) return;
      if (Date.now() - _lastSchedFail < SCHED_FAIL_BACKOFF_MS) return; // retry later, not every tick
      const run = syncNow({ force: true, reason: due[0] });
      run.then(out => {
        _lastSchedFail = out?.ok === false ? Date.now() : 0;
      }).catch(() => { _lastSchedFail = Date.now(); });
    } catch { /* scheduler must never crash the server */ }
  };
  tick(); // boot catch-up for slots missed while the dyno slept
  _schedTimer = setInterval(tick, 60 * 1000);
  _schedTimer.unref?.();
  return _schedTimer;
}
export function __stopSchedulerForTests() {
  if (_schedTimer) { clearInterval(_schedTimer); _schedTimer = null; }
  _lastSchedFail = 0;
}

// Disconnect must drop the synced assets with it.
export function clearSnapshot() {
  writeSnapshot({
    ok: false, source: 'indmoney', syncedAt: null, assets: [], slots: {},
    clearedAt: Date.now(),
  });
}

// ---------------- test hooks ----------------
export function __resetSyncForTests() {
  _inFlight = false;
  _lastBgAttempt = 0;
  _fx = { rate: null, ts: 0 };
}
export function __setFetchForTests(fn) {
  globalThis.fetch = fn; // forex upstreams use global fetch
}
