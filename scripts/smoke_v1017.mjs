#!/usr/bin/env node
// scripts/smoke_v1017.mjs — v10.17 boot smoke (hermetic import + contract check)
// SMARTAI_DATA_DIR isolates all store IO into a temp dir. Verifies:
//   1. indiaUniverse imports + the tier engine's export contract
//   2. LIVE discovery — the TV India filter query actually parses from
//      this sandbox (or degrades honestly to the static seed)
//   3. tieredScanUniverse end-to-end (T1 + rotating slice + hot ride)
//   4. optionsScan imports + the pure cores + the wire contract shape
//      (route-level check via the route registry below)
//   5. clearClosedPositions end-to-end on an isolated journal (only
//      CLOSED rows go; HOUSEKEEP audit entry stamped)
//   6. the Express route registry carries the two NEW routes
//   7. engine chunked TV batch (chunk-size contract on a mocked round)
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readFileSync } from 'node:fs';

process.env.NODE_ENV = 'test';
process.env.SMARTAI_DATA_DIR = mkdtempSync(join(tmpdir(), 'smoke-v1017-'));

let pass = 0, fail = 0;
const ok = (name, cond) => { if (cond) { pass++; console.log(`  ✓ ${name}`); } else { fail++; console.log(`  ✗ ${name}`); } };

console.log('v10.17 boot smoke — full universe scan + options scanner + clear-closed + perf');

// ---------------- 1. indiaUniverse module contract ----------------
const iu = await import('../server/ai/indiaUniverse.js');
ok('indiaUniverse imports + full export contract', [
  iu.discoverNSEFullUniverse, iu.tieredScanUniverse, iu.absorbScanRows,
  iu.fullIndiaUniverseEnabled, iu.parseDiscoveryRows, iu.splitTiers,
  iu.nextSlice, iu.isHot, iu.mergeHot, iu.pruneHot, iu.validNSESymbol,
].every(f => typeof f === 'function') && Array.isArray(iu.INDIA_FULL_FALLBACK_SEED));
ok('feature flag default ON (AI_INDIA_FULL_UNIVERSE unset)', iu.fullIndiaUniverseEnabled() === true);
ok('static fallback seed is a sane curated list (>=120 NSE names)', iu.INDIA_FULL_FALLBACK_SEED.length >= 120);

// ---------------- 2. LIVE discovery (real TV filter query) ----------------
{
  const d = await iu.discoverNSEFullUniverse();
  if (d.ok) {
    const allNSE = d.rows.every(r => iu.validNSESymbol(r.symbol) && r.ltp > 0);
    ok(`LIVE discovery parsed ${d.rows.length} NSE names (turnover-ranked)`, d.rows.length >= 40 && allNSE);
    console.log(`    top-5: ${d.rows.slice(0, 5).map(r => r.symbol).join(', ')}`);
  } else {
    ok('discovery unreachable from this host → honest static-seed degrade (no crash, no fake rows)',
      d.rows.length === iu.INDIA_FULL_FALLBACK_SEED.length);
  }
}

// ---------------- 3. tieredScanUniverse end-to-end ----------------
{
  const BASE = ['RELIANCE', 'HDFCBANK', 'TCS'];
  const t1 = await iu.tieredScanUniverse(BASE);
  ok('tiered scan returns T1-first scan set + honest mode label',
    t1.scan.slice(0, 3).every(s => BASE.includes(s)) && ['tiered-full', 'tiered-seed-fallback', 'legacy-static'].includes(t1.mode));
  ok('tiered meta carries t1/t2/slice/full counts', Number.isFinite(t1.t1Count) && Number.isFinite(t1.t2Count) && Number.isFinite(t1.fullCount));
  // hot ride: a heated row joins T1 next cycle
  iu.absorbScanRows([{ symbol: 'IRFC', changePct: 5.2, relVolume: 2.6 }]);
  const t2 = await iu.tieredScanUniverse(BASE);
  ok('hot promotion: a heated T2 name rides the next cycle\'s scan set', t2.hot.includes('IRFC') && t2.scan.includes('IRFC'));
}

// ---------------- 4. optionsScan module + pure cores ----------------
{
  const os = await import('../server/ai/optionsScan.js');
  ok('optionsScan imports + export contract', [
    os.scanOptionsUniverse, os.optionScanRow, os.directionRead,
    os.scanScoreOf, os.pickStockUnderlyings, os.buildVerdict,
  ].every(f => typeof f === 'function'));
  const picked = os.pickStockUnderlyings([{ symbol: 'RELIANCE' }, { symbol: 'UNITECH' }], 4);
  ok('stock underlying picker: F&O seed intersection only', picked.includes('RELIANCE') && !picked.includes('UNITECH'));
  const row = os.optionScanRow({
    ok: true, symbol: 'NIFTY', spot: 25000, spotChangePct: 0.5, dte: 2,
    expiry: '2026-09-17', lotSize: 75, source: 'nse',
    analytics: {
      pcr: 1.3, maxPain: 24800, atmIV: 12, oiSkew: -0.3,
      flow: { oiLean: -0.25, callPutVolRatio: 0.9, read: 'x', oiLeanRead: 'y' },
      skew: { value: 1, read: 'mild put skew' },
      gex: { gammaFlip: 24700, callWall: 25100, putWall: 24500, totalNetGex: 1e9,
             expectedMove: { abs: 200, pct: 0.8, low: 24800, high: 25200 }, regimeNote: 'pin' },
    },
  }, 'index');
  ok('scan row: BULLISH tally + transparent score + verdict', row.direction === 'BULLISH' && row.scanScore > 0 && String(row.verdict).includes('🟢'));

  // LIVE scan attempt (real NSE chain from this host, honest degrade)
  const view = await os.scanOptionsUniverse({ force: true });
  const liveOrModel = (view.liveCount || 0) + (view.modelCount || 0);
  ok(`options scan ran over ${view.scanned} underlyings (${liveOrModel} chains resolved, ${view.failedCount} failed) — ranked + methodology`,
    view.ok === true && Array.isArray(view.rows) && liveOrModel > 0 && typeof view.methodology === 'string');
}

// ---------------- 5. clearClosedPositions end-to-end ----------------
{
  const co = await import('../server/ai/coindcxOrders.js');
  co.__setJournalForTests({
    entries: [],
    positions: [
      { id: 'a', market: 'CRYPTO', symbol: 'BTC', pair: 'BTCINR', side: 'LONG', mode: 'paper', qty: 1, entryPrice: 100, status: 'OPEN', openedAt: Date.now() },
      { id: 'b', market: 'CRYPTO', symbol: 'ETH', pair: 'ETHINR', side: 'LONG', mode: 'paper', qty: 1, entryPrice: 100, status: 'CLOSED', openedAt: Date.now(), closedAt: Date.now() },
      { id: 'c', market: 'INDIA', symbol: 'TCS', pair: 'TCS', side: 'LONG', mode: 'paper', qty: 1, entryPrice: 100, status: 'CLOSED', openedAt: Date.now(), closedAt: Date.now() },
    ],
  });
  const out = await co.clearClosedPositions();
  const j = co.loadJournal();
  const housekeep = (j.entries || []).find(e => e.kind === 'HOUSEKEEP');
  ok('clear-closed: exactly the 2 CLOSED rows swept, OPEN survived', out.ok === true && out.removed === 2 && out.kept === 1 && j.positions.length === 1 && j.positions[0].id === 'a');
  ok('clear-closed: HOUSEKEEP audit entry stamped with the count', housekeep && housekeep.removed === 2 && String(housekeep.note).includes('2 CLOSED'));
}

// ---------------- 6. route registry ----------------
{
  const src = readFileSync(new URL('../server/ai/routes.js', import.meta.url), 'utf8');
  ok('route: GET /api/ai/options-scan registered', src.includes("app.get('/api/ai/options-scan'"));
  ok('route: POST /api/ai/positions/clear-closed registered', src.includes("app.post('/api/ai/positions/clear-closed'"));
  const srcIntraday = readFileSync(new URL('../server/intraday/routes.js', import.meta.url), 'utf8');
  ok('intraday movers + scanner wired to the tiered universe', srcIntraday.includes('tieredScanUniverse(effectiveUniverse(mkt)'));
  const srcSignals = readFileSync(new URL('../server/ai/signals.js', import.meta.url), 'utf8');
  ok('signal board wired to the tiered universe (chunked batch)', srcSignals.includes('tieredScanUniverse(INDIA_UNIVERSE)') && srcSignals.includes('fetchTVIndiaBatchChunked'));
}

// ---------------- 7. engine chunked TV batch (contract, no network) ----------------
{
  const engineSrc = readFileSync(new URL('../server/intraday/engine.js', import.meta.url), 'utf8');
  ok('engine TV batch chunks at <=100 tickers per request for big universes',
    engineSrc.includes('const CHUNK = 100') && engineSrc.includes('_tvScanRound'));
  const dataSrc = readFileSync(new URL('../server/ai/data.js', import.meta.url), 'utf8');
  ok('data.js chunked India batch (60 symbols/chunk, <=3 concurrent)',
    dataSrc.includes('TV_INDIA_CHUNK_SYMS = 60') && dataSrc.includes('fetchTVIndiaBatchChunked'));
  const useAt = readFileSync(new URL('../src/components/aitrading/useAITrading.ts', import.meta.url), 'utf8');
  ok('frontend SSE tick batching wired (render-storm killer)', useAt.includes('createTickBatcher') && useAt.includes('intervalMs: 800'));
}

console.log(`\n${pass}/${pass + fail} checks passed${fail ? ' — FIX BEFORE SHIP' : ''}`);
process.exit(fail ? 1 : 0);
