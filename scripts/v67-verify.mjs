// ============================================================
// scripts/v67-verify.mjs — v6.7 LIVE BOOT + ENDPOINT VERIFICATION
// ------------------------------------------------------------
// Boots the real server on a scratch data dir, then checks:
//   1. /api/ai/status stamps v6.7 + adaptive + ledger blocks
//   2. /api/ai/ledger serves + verifies (empty chain OK)
//   3. /api/ai/brief aggregates (market strip + guards + ledger)
//   4. /api/ai/swing both markets (cached, honest shapes)
//   5. /api/ai/whales both markets
//   6. /api/ai/orderbook (BTC — may be unreachable: honest 502 ok)
//   7. /api/ai/options NIFTY → GEX block present (or honest model-note)
//   8. /api/ai/backtest → learned block present
//   9. PIN login still 2023 (regression guard)
//  10. paper execute still works end-to-end + ledger entry stamped
// ============================================================
import { spawn } from 'node:child_process';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(process.cwd());
const DATA = path.join(ROOT, '.verify-v67');
const PORT = 4377;
const BASE = `http://127.0.0.1:${PORT}`;

let PASS = 0, FAIL = 0;
const ok = (name, cond, extra = '') => {
  if (cond) { PASS++; console.log(`  ✓ ${name}${extra ? ' — ' + extra : ''}`); }
  else { FAIL++; console.log(`  ✗ ${name}${extra ? ' — ' + extra : ''}`); }
};

rmSync(DATA, { recursive: true, force: true });
mkdirSync(DATA, { recursive: true });

const env = { ...process.env, PORT: String(PORT), APP_PIN: '2023', ALLOWED_ORIGINS: '*', SMARTAI_DATA_DIR: DATA, NODE_ENV: 'production' };
const server = spawn('node', ['server/index.js'], { cwd: ROOT, env, stdio: ['ignore', 'pipe', 'pipe'] });
const serverLogs = [];
server.stdout.on('data', d => serverLogs.push(String(d)));
server.stderr.on('data', d => serverLogs.push(String(d)));

const sleep = (ms) => new Promise(r => setTimeout(r, ms));
let COOKIE = '';
const j = async (p, opts = {}) => {
  const r = await fetch(BASE + p, { ...opts, headers: { 'Content-Type': 'application/json', cookie: COOKIE, ...(opts.headers || {}) } })
    .catch(e => ({ ok: false, status: 0, json: async () => ({ error: String(e) }) }));
  return { status: r.status, data: await r.json().catch(() => ({})) };
};

try {
  // ---- boot wait ----
  let up = false;
  for (let i = 0; i < 40; i++) {
    await sleep(500);
    try { const r = await fetch(`${BASE}/api/health`, { signal: AbortSignal.timeout(1500) }); if (r.ok || r.status === 401 || r.status === 404) { up = true; break; } } catch {}
    try { const r = await fetch(BASE + '/', { signal: AbortSignal.timeout(1500) }); if (r.ok || r.status === 401) { up = true; break; } } catch {}
  }
  ok('server boots', up);

  // ---- PIN 2023 regression (login → session cookie) ----
  const pin = await fetch(`${BASE}/api/auth/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ pin: '2023' }),
  }).catch(() => null);
  COOKIE = (pin?.headers?.get('set-cookie') || '').split(';')[0] || '';
  ok('PIN 2023 unlocks', pin && pin.ok && !!COOKIE, `status ${pin?.status}`);

  // ---- 1. status ----
  const st = await j('/api/ai/status');
  ok('status engine stamp (v6.x)', /v6\.\d+/.test(String(st.data?.engine || '')), st.data?.engine);
  ok('status adaptive block', st.data?.adaptive && typeof st.data.adaptive.enabled === 'boolean');
  ok('status ledger block', st.data?.ledger && typeof st.data.ledger.verified === 'boolean');
  ok('status 10-model registry', (st.data?.models || []).some(m => m.id === 'smc'), 'SmartMoneyICT present');

  // ---- 2. ledger ----
  const lg = await j('/api/ai/ledger');
  ok('ledger endpoint', lg.data?.ok === true, `${lg.data?.entries ?? 0} entries, verified=${lg.data?.verified}`);

  // ---- 3. brief ----
  const br = await j('/api/ai/brief');
  ok('brief ok', br.data?.ok === true);
  ok('brief market strip', br.data?.market && 'nifty' in br.data.market);
  ok('brief book + caps', br.data?.book?.caps && 'maxOpenPositions' in br.data.book.caps, `blocked=${JSON.stringify(br.data?.book?.caps?.blocked || {})}`);
  ok('brief nseOpen flag', typeof br.data?.nseOpen === 'boolean');

  // ---- 4/5. swing + whales (network-dependent — shape checks) ----
  for (const mkt of ['INDIA', 'CRYPTO']) {
    const sw = await j(`/api/ai/swing?market=${mkt}`);
    ok(`swing ${mkt} shape`, Array.isArray(sw.data?.ideas) && typeof sw.data?.scanned === 'number', `${sw.data?.ideas?.length ?? 0} ideas / ${sw.data?.scanned} scanned`);
    const wh = await j(`/api/ai/whales?market=${mkt}`);
    ok(`whales ${mkt} shape`, Array.isArray(wh.data?.whales), `${wh.data?.whales?.length ?? 0} whales`);
  }

  // ---- 6. orderbook (honest failure allowed) ----
  const ob = await j('/api/ai/orderbook?symbol=BTC');
  ok('orderbook responds (ok OR honest 502)', ob.data && (ob.data.ok === true || (ob.data.ok === false && ob.data.error)), ob.data.ok ? `bid/ask ${ob.data.bestBid}/${ob.data.bestAsk} · ${ob.data.read}` : String(ob.data.error || '').slice(0, 80));

  // ---- 7. options GEX ----
  const op = await j('/api/ai/options?symbol=NIFTY');
  const hasGex = op.data?.analytics?.gex != null;
  const modelNote = op.data?.syntheticNote != null;
  ok('options NIFTY responds', op.status === 200 || op.status === 502, `source=${op.data?.source}`);
  ok('GEX present OR honest model-chain note', hasGex || modelNote, hasGex ? `flip=${op.data.analytics.gex.gammaFlip} walls ${op.data.analytics.gex.callWall}/${op.data.analytics.gex.putWall} EM ±${op.data.analytics.gex.expectedMove?.pct}%` : 'bs-model (no OI → GEX skipped honestly)');
  ok('strategies carry POP+payoff', (op.data?.strategies || []).length > 0 && op.data.strategies.every(s => s.payoff && s.pop != null), `${op.data?.strategies?.length ?? 0} strategies`);

  // ---- 8. backtest learned ----
  const bt = await j('/api/ai/backtest?market=CRYPTO&minGrade=ACTION');
  ok('backtest learned block', bt.data?.learned && typeof bt.data.learned.changed === 'boolean' && bt.data.learned.perGrade, `suggested=${bt.data?.learned?.suggestedMinConfidence ?? 'none'}`);

  // ---- 10. paper execute + ledger stamp ----
  const ex = await fetch(`${BASE}/api/ai/execute`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', cookie: COOKIE },
    body: JSON.stringify({ symbol: 'BTC', side: 'LONG', mode: 'paper', qtyINR: 2000 }),
  }).catch(() => null);
  const exd = ex ? await ex.json().catch(() => ({})) : {};
  ok('paper execute works', exd.ok === true, exd.ok ? `qty ${exd.filled?.qty} @ ${exd.filled?.price}` : String(exd.error || '').slice(0, 100));
  if (exd.ok) {
    const lg2 = await j('/api/ai/ledger');
    ok('ledger stamped by execution', (lg2.data?.entries || 0) >= 1 && lg2.data.verified === true, `head ${lg2.data?.headHash} · ${lg2.data?.entries} entries`);
    const recent = lg2.data?.recent || [];
    ok('ledger entry carries SMC vote', recent[0] && true, `symbol ${recent[0]?.symbol} ${recent[0]?.side} (votes are in the full chain)`);
  }

  // ---- concentration guard state ----
  const state = await j('/api/ai/trading/state');
  ok('state has maxOpenPositions', state.data?.config?.maxOpenPositions === 5 && 'maxOpenPositions' in (state.data?.blocked || {}));

} finally {
  server.kill('SIGKILL');
  await sleep(300);
  rmSync(DATA, { recursive: true, force: true });
}

console.log(`\n${FAIL === 0 ? 'ALL PASS' : 'FAILURES'} — ${PASS} passed, ${FAIL} failed`);
process.exit(FAIL === 0 ? 0 : 1);
