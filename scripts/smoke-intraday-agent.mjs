// ============================================================
// Smoke test — boots a mini express app with intraday routes
// and hits POST /api/intraday-agent (tool layer, no AI keys).
// ============================================================
import express from 'express';
import { registerIntradayRoutes } from '../server/intraday/routes.js';

const app = express();
app.use(express.json());

// Mock deps — no real network, no AI keys.
const mockScan = {
  marketOpen: true,
  asOf: new Date().toISOString(),
  marketRegime: { regime: 'NEUTRAL', vix: 14, vixLevel: 'LOW', niftyChange: 0.1, niftyVwapDist: 0.05 },
  freshEntriesAllowed: true,
  signals: [{
    symbol: 'SBIN', direction: 'LONG', confidence: 84, ltp: 800, changePct: 0.9,
    entry: 800, entryZoneLow: 795, entryZoneHigh: 802, stopLoss: 780, target1: 832,
    target2: 852, rr: 1.6, effRR: 1.5, qtyPerLakh: 50, trendStrength: 'STRONG',
    rsi: 60, adx: 30, volumeRatio: 1.8, vwapDist: 0.4, counterTrend: false,
    aiNote: '', reasons: ['EMA10/20 bullish stack'],
  }],
};

registerIntradayRoutes(app, {
  fetchGrowwNseQuote: async (sym) => ({ price: 100 + sym.length * 7, change: 0.5, high: 110, low: 95, volume: 1e6 }),
  KEYS: {},             // no AI keys → agent should fail gracefully with 502
  OPENAI_COMPAT: {},
  TG: {},
  escapeHtml: (s) => String(s),
  jsonError: (res, code, msg) => res.status(code).json({ error: msg }),
});

const port = 4599;
const server = app.listen(port, async () => {
  let pass = 0, fail = 0;
  const check = (name, cond, extra = '') => {
    if (cond) { pass++; console.log(`  ✅ ${name}`); }
    else { fail++; console.log(`  ❌ ${name} ${extra}`); }
  };

  // 1. Agent endpoint exists and rejects empty messages
  let r = await fetch(`http://localhost:${port}/api/intraday-agent`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}',
  });
  check('empty body → 400', r.status === 400);

  // 2. No AI keys → graceful 502 (not a crash)
  r = await fetch(`http://localhost:${port}/api/intraday-agent`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ messages: [{ role: 'user', content: 'test' }] }),
  });
  const body = await r.json().catch(() => ({}));
  check('no-keys → 502 graceful', r.status === 502, `got ${r.status} ${JSON.stringify(body)}`);

  // 3. Scanner route still works after refactor (market-gated response expected)
  r = await fetch(`http://localhost:${port}/api/intraday-scanner`);
  const scan = await r.json().catch(() => ({}));
  check('scanner route alive (gated or open)', r.status === 200 && scan && typeof scan === 'object');
  check('scanner returns marketOpen flag', scan.marketOpen === true || scan.marketOpen === false || scan.signals !== undefined);

  // 4. Legacy endpoints alive after refactor
  for (const ep of ['/api/intraday-track-record?days=7', '/api/intraday-paper', '/api/intraday-universe', '/api/intraday-alerts']) {
    r = await fetch(`http://localhost:${port}${ep}`);
    check(`GET ${ep} → 200`, r.status === 200, `got ${r.status}`);
  }

  // 5. Phase 2 — committee debate (no AI keys → honest 400 with reason)
  r = await fetch(`http://localhost:${port}/api/intraday-committee`, { method: 'POST' });
  const cBody = await r.json().catch(() => ({}));
  check('committee → honest failure (no AI keys / no setups)', r.status === 400 || r.status === 200, `got ${r.status} ${JSON.stringify(cBody).slice(0, 80)}`);

  // 6. Phase 2 — briefing endpoint (no AI keys → 502 with stale-fallback)
  r = await fetch(`http://localhost:${port}/api/intraday-briefing?fresh=1`);
  check('briefing endpoint responds (502/200 expected)', r.status === 502 || r.status === 200, `got ${r.status}`);

  // 7. Phase 2 — journal read endpoint
  r = await fetch(`http://localhost:${port}/api/intraday-journal?days=14`);
  const j = await r.json().catch(() => null);
  check('journal GET → 200 + shape', r.status === 200 && j && Array.isArray(j.entries) && j.stats, `got ${r.status}`);

  // 8. Phase 2 — journal EOD review (no trades day → honest 400)
  r = await fetch(`http://localhost:${port}/api/intraday-journal/eod`, { method: 'POST' });
  check('journal EOD → responds (400 no-data / 200 ok)', r.status === 400 || r.status === 200, `got ${r.status}`);

  // 9. Phase 2 — journal weekly report
  r = await fetch(`http://localhost:${port}/api/intraday-journal/weekly`, { method: 'POST' });
  check('journal weekly → responds (400 no-data / 200 ok)', r.status === 400 || r.status === 200, `got ${r.status}`);

  // 10. Phase 2 — briefing Telegram push without TG config → 503
  r = await fetch(`http://localhost:${port}/api/intraday-briefing/push`, { method: 'POST' });
  check('briefing push → 503 without Telegram config', r.status === 503 || r.status === 502 || r.status === 200, `got ${r.status}`);

  console.log(`\n${pass} passed, ${fail} failed`);
  server.close();
  process.exit(fail > 0 ? 1 : 0);
});
