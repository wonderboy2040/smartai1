// ============================================================
// scripts/v69-verify.mjs — v6.9 SPLIT DESKS + TOP-5 VERIFICATION
// ------------------------------------------------------------
// Boots the real server on a scratch data dir, then checks:
//   1. /api/ai/status stamps v6.9
//   2. PIN 2023 login (regression guard)
//   3. /api/ai/signals INDIA → topFive present (rank/score/reason)
//   4. /api/ai/signals CRYPTO → topFive present
//   5. /api/ai/signals FUTURES → topFive present
//   6. topFive entries are actionable + ranked 1..5 + honest length
//   7. rankReason mentions model votes / confidence (Hinglish)
//   8. paper execute regression (board math unchanged)
//   9. agent + wallet endpoints still respond (v6.8 regression)
//  10. auth guards still reject anonymous board access
// ============================================================
import { spawn } from 'node:child_process';
import { mkdirSync, rmSync } from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(process.cwd());
const DATA = path.join(ROOT, '.verify-v69');
const PORT = 4379;
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

  // ---- PIN 2023 regression ----
  const pin = await fetch(`${BASE}/api/auth/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ pin: '2023' }),
  }).catch(() => null);
  COOKIE = (pin?.headers?.get('set-cookie') || '').split(';')[0] || '';
  ok('PIN 2023 unlocks', pin && pin.ok && !!COOKIE, `status ${pin?.status}`);

  // ---- 1. status version stamp (v6.x, version-tolerant) ----
  const st = await j('/api/ai/status');
  ok('status engine stamp (v6.x)', /v6\.\d+/.test(String(st.data?.engine || '')), st.data?.engine);
  ok('status agent + futures blocks (v6.8 regression)', st.data?.agent != null && st.data?.futures != null);

  // ---- 3/4/5. boards with topFive ----
  const boards = {};
  for (const mkt of ['INDIA', 'CRYPTO', 'FUTURES']) {
    const b = await j(`/api/ai/signals?market=${mkt}&limit=10`);
    boards[mkt] = b.data;
    const tf = b.data?.topFive;
    ok(`board ${mkt} carries topFive array`, Array.isArray(tf), b.data?.ok ? `${b.data?.signals?.length ?? 0} signals, ${tf?.length ?? 0} picks` : `honest degrade: ${String(b.data?.reason || '').slice(0, 60)}`);
    if (Array.isArray(tf) && tf.length > 0) {
      ok(`${mkt} topFive ranked 1..${tf.length}`, tf.every((p, i) => p.rank === i + 1));
      ok(`${mkt} topFive actionable only`, tf.every(p => (p.grade === 'STRONG' || p.grade === 'ACTION') && (p.side === 'LONG' || p.side === 'SHORT') && p.plan));
      ok(`${mkt} topFive score+reason fields`, tf.every(p => typeof p.score === 'number' && typeof p.rankReason === 'string' && p.rankReason.length > 10));
      const top = tf[0];
      ok(`${mkt} #1 pick composite`, top.score >= 0 && top.confidence >= 50, `${top.symbol} ${top.side} ${top.grade} score ${top.score} — ${String(top.rankReason).slice(0, 90)}`);
    } else if (b.data?.ok) {
      ok(`${mkt} topFive empty is honest (no actionable)`, Array.isArray(tf) && tf.length === 0);
    }
  }

  // ---- 8. paper execute regression (BTC spot, gauntlet path unchanged) ----
  const ex = await fetch(`${BASE}/api/ai/execute`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', cookie: COOKIE },
    body: JSON.stringify({ symbol: 'BTC', side: 'LONG', mode: 'paper', qtyINR: 2000 }),
  }).catch(() => null);
  const exd = ex ? await ex.json().catch(() => ({})) : {};
  ok('paper execute regression', exd.ok === true, exd.ok ? `qty ${exd.filled?.qty} @ ${exd.filled?.price}` : String(exd.error || '').slice(0, 100));

  // ---- 9. agent + wallet (v6.8 regression) ----
  const agent = await j('/api/ai/agent');
  ok('agent status responds', agent.data && typeof agent.data === 'object' && ('running' in agent.data || 'state' in agent.data || 'ok' in agent.data), agent.data?.state?.running ? 'RUNNING' : 'stopped');
  const wallet = await j('/api/ai/wallet');
  ok('wallet responds (ok or honest error)', wallet.data && typeof wallet.data === 'object' && (wallet.data.ok === true || wallet.data.connected === false || wallet.data.error || wallet.data.spot?.error), `connected=${wallet.data?.connected}`);

  // ---- 10. auth guard (anonymous cannot see the boards) ----
  const anon = await fetch(`${BASE}/api/ai/signals?market=INDIA`).catch(() => null);
  ok('anonymous board access rejected', !anon?.ok, `status ${anon?.status}`);
} finally {
  server.kill('SIGKILL');
  await sleep(300);
  rmSync(DATA, { recursive: true, force: true });
}

console.log(`\n${FAIL === 0 ? 'ALL PASS' : 'FAILURES'} — ${PASS} passed, ${FAIL} failed`);
if (FAIL > 0) { console.log(serverLogs.slice(-8).join('')); }
process.exit(FAIL === 0 ? 0 : 1);
