#!/usr/bin/env node
// ============================================================
// scripts/v611-verify.mjs — GLAMA TIER-2/3 FEATURES VERIFICATION
// ------------------------------------------------------------
// Boots the real server on a scratch data dir (PIN 1992 — the
// user's NEW pin; 2023 must now be REJECTED), then checks:
//   1. /api/ai/status stamps v6.11
//   2. PIN 1992 login + old 2023 rejected (the pin change is real)
//   3. /api/ai/trust → calibration + governance (honest-insufficient
//      on a fresh ledger is the CORRECT result)
//   4. /api/ai/perf → perf analytics (same honesty)
//   5. /api/ai/correlations → matrix + assets + riskLink shape
//   6. /api/ai/sectors → 10 sectors + context chain + F-Score board
//   7. /api/ai/income → income ranker (bs-model honest note on
//      CF-blocked dev boxes)
//   8. /api/ai/next-actions → actions + followups arrays
//   9. /api/ai/brief → nextActions block present (v6.11)
//  10. /api/ai/deep/SBIN?market=INDIA → narrative (explain ticker)
//  11. NOTIFY gauntlet: mode notify → ok + NOTIFIED journal entry
//      + ZERO positions + daily quota NOT consumed
//  12. crypto PAPER execute regression (v6.x math unchanged)
//  13. anonymous access still 401 (auth guard regression)
// ============================================================
import { spawn } from 'node:child_process';
import { mkdirSync, rmSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(process.cwd());
const DATA = path.join(ROOT, '.verify-v611');
const PORT = 4383;
const BASE = `http://127.0.0.1:${PORT}`;

let PASS = 0, FAIL = 0;
const ok = (name, cond, extra = '') => {
  if (cond) { PASS++; console.log(`  ✓ ${name}${extra ? ' — ' + extra : ''}`); }
  else { FAIL++; console.log(`  ✗ ${name}${extra ? ' — ' + extra : ''}`); }
};

rmSync(DATA, { recursive: true, force: true });
mkdirSync(DATA, { recursive: true });

const env = { ...process.env, PORT: String(PORT), APP_PIN: '1992', ALLOWED_ORIGINS: '*', SMARTAI_DATA_DIR: DATA, NODE_ENV: 'production' };
const server = spawn('node', ['server/index.js'], { cwd: ROOT, env, stdio: ['ignore', 'pipe', 'pipe'] });
server.stderr.on('data', d => process.stderr.write(d));

const j = async (p, opts) => {
  const r = await fetch(BASE + p, opts);
  let body = null;
  try { body = await r.json(); } catch { /* non-json */ }
  return { status: r.status, body, cookies: r.headers.getSetCookie?.() || [] };
};
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const loginCookie = async (pin) => {
  const r = await j('/api/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ pin }) });
  return { status: r.status, body: r.body, cookie: r.cookies.map(c => c.split(';')[0]).join('; ') };
};
const auth = (cookie) => ({ cookie: 'x', headers: { cookie } });

// ---- boot ----
let booted = false;
for (let i = 0; i < 40; i++) {
  await sleep(500);
  try { const r = await fetch(BASE + '/health'); booted = r.ok; } catch { /* retry */ }
  if (booted) break;
}
ok('server boots', booted);

// ---- 1. version stamp ----
{
  const { cookie } = await loginCookie('1992');
  const st = await j('/api/ai/status', auth(cookie));
  ok('status: v6.11 engine stamp', /v6\.11/.test(st.body?.engine || ''), st.body?.engine);
}

// ---- 2. PIN 1992 works; 2023 rejected ----
{
  const good = await loginCookie('1992');
  ok('PIN 1992 login accepted', good.body?.ok === true);
  const old = await loginCookie('2023');
  ok('old PIN 2023 rejected (pin change is real)', old.body?.ok !== true && (old.status === 400 || old.status === 401 || old.body?.error), `status ${old.status}`);
}

const { cookie: COOKIE } = await loginCookie('1992');
const A = auth(COOKIE);

// ---- 3. trust layer ----
{
  const r = await j('/api/ai/trust', A);
  ok('trust: endpoint responds', r.body?.ok === true);
  ok('trust: calibration honest-insufficient on fresh ledger', r.body?.calibration?.sufficient === false && (r.body?.calibration?.settled ?? 1) === 0);
  ok('trust: governance has method + minN', typeof r.body?.governance?.method === 'string' && r.body?.governance?.minN === 10);
}

// ---- 4. perf analytics ----
{
  const r = await j('/api/ai/perf', A);
  ok('perf: endpoint responds + honest-insufficient', r.body?.ok === true && r.body?.sufficient === false && typeof r.body?.note === 'string');
}

// ---- 5. correlations ----
{
  const r = await j('/api/ai/correlations', A);
  ok('correlations: matrix responds', r.body?.ok === true && Array.isArray(r.body?.matrix));
  ok('correlations: 10+ live assets (Yahoo reachable from this host)', (r.body?.assets || []).length >= 10, `${r.body?.assets?.length ?? 0} assets`);
  ok('correlations: riskLink BTC↔NIFTY present', !!r.body?.riskLink, r.body?.riskLink?.read?.slice(0, 60) || '');
  ok('correlations: top pairs both sides', (r.body?.top?.mostPositive || []).length >= 1 && (r.body?.top?.mostNegative || []).length >= 1);
}

// ---- 6. sector desk ----
{
  const r = await j('/api/ai/sectors', A);
  ok('sectors: desk responds', r.body?.ok === true);
  ok('sectors: 10 sector rows', (r.body?.sectors || []).length === 10, `${r.body?.sectors?.length ?? 0} sectors`);
  ok('sectors: sane avg change (|x| < 15%)', (r.body?.sectors || []).every(s => Math.abs(s.avgChangePct ?? 0) < 15), 'no double-scaling');
  ok('sectors: context chain macro+strongest', !!r.body?.chain?.macro?.bias && (r.body?.chain?.strongest || []).length > 0);
  ok('sectors: F-Score board top+bottom+distribution', (r.body?.fscore?.top || []).length > 0 && !!r.body?.fscore?.distribution);
  ok('sectors: F-Score disclaimer honest (Piotroski-style proxy)', /Piotroski-STYLE|balance-sheet/i.test(r.body?.fscore?.disclaimer || ''));
}

// ---- 7. income ranker ----
{
  const r = await j('/api/ai/income', A);
  ok('income: ranker responds', r.body?.ok === true && typeof r.body?.count === 'number');
  ok('income: setups ranked (or honest empty with note)', r.body?.count === 0 ? typeof r.body?.note === 'string' : (r.body?.top || []).length > 0, `count ${r.body?.count}`);
  if ((r.body?.top || []).length > 0) {
    ok('income: rows carry score+pop+source', r.body.top.every(x => x.score != null && x.pop != null && typeof x.source === 'string'));
  }
}

// ---- 8. next-actions ----
{
  const r = await j('/api/ai/next-actions', A);
  ok('next-actions: responds', r.body?.ok === true);
  ok('next-actions: has an nse state action', (r.body?.actions || []).some(a => /NSE (OPEN|CLOSED)/.test(a.label)));
  ok('next-actions: followup chips present', (r.body?.followups || []).length >= 3);
}

// ---- 9. brief carries nextActions ----
{
  const r = await j('/api/ai/brief', A);
  ok('brief: nextActions block present', Array.isArray(r.body?.nextActions) && (r.body?.nextActions || []).length >= 1, `${r.body?.nextActions?.length ?? 0} items`);
}

// ---- 10. deep narrative (explain ticker) ----
{
  const r = await j('/api/ai/deep/SBIN?market=INDIA', A);
  ok('deep: narrative present', r.body?.ok === true && !!r.body?.narrative, r.body?.narrative?.title || '');
  ok('deep: story has 3+ lines + watch line', (r.body?.narrative?.story || []).length >= 3 && /Kya dekhna hai/.test(r.body?.narrative?.watch || ''));
}

// ---- 11. NOTIFY gauntlet ----
{
  // prime a STRONG-ish fresh signal via the real engine: BTC crypto
  const r = await j('/api/ai/execute', {
    method: 'POST', headers: { 'content-type': 'application/json', cookie: COOKIE },
    body: JSON.stringify({ symbol: 'BTC', side: 'LONG', mode: 'notify' }),
  });
  const out = r.body;
  const accepted = out?.ok === true && out?.mode === 'notify';
  ok('notify: gauntlet pass → ok + mode notify', accepted, accepted ? (out.alert?.pair || '') : String(out?.error || '').slice(0, 90));
  if (accepted) {
    ok('notify: telegram honestly reported (unconfigured here)', typeof out.telegramSent === 'boolean');
    ok('notify: alert carries plan', !!out.alert?.plan?.entry);
    // journal audit: NOTIFIED entry, no position, quota intact
    const jr = await j('/api/ai/trading/state', A);
    ok('notify: daily quota NOT consumed by notifications', (jr.body?.stats?.tradesCount ?? 0) === 0, `trades ${jr.body?.stats?.tradesCount}`);
    const pr = await j('/api/ai/positions', A);
    ok('notify: NO position created', (pr.body?.positions || []).length === 0);
    const journalPath = path.join(DATA, 'ai-trading-journal.json');
    const raw = existsSync(journalPath) ? JSON.parse(readFileSync(journalPath, 'utf8')) : { entries: [] };
    ok('notify: journal NOTIFIED audit entry written', (raw.entries || []).some(e => e.status === 'NOTIFIED'));
  }
}

// ---- 12. paper execute regression ----
{
  const r = await j('/api/ai/execute', {
    method: 'POST', headers: { 'content-type': 'application/json', cookie: COOKIE },
    body: JSON.stringify({ symbol: 'ETH', side: 'LONG', mode: 'paper' }),
  });
  const out = r.body;
  const paperOk = out?.ok === true && out?.mode === 'paper' && !!out?.position;
  ok('paper execute regression (position opens)', paperOk, paperOk ? `qty ${out.filled?.qty}` : String(out?.error || '').slice(0, 90));
  if (paperOk) {
    const st = await j('/api/ai/trading/state', A);
    ok('paper: quota consumed (1 real trade)', (st.body?.stats?.tradesCount ?? 0) >= 1, `trades ${st.body?.stats?.tradesCount}`);
  }
}

// ---- 13. auth guard regression ----
{
  const anon = await j('/api/ai/trust');
  ok('anonymous trust access → 401', anon.status === 401, `status ${anon.status}`);
  const anon2 = await j('/api/ai/next-actions');
  ok('anonymous next-actions access → 401', anon2.status === 401, `status ${anon2.status}`);
}

// ---- teardown ----
server.kill('SIGTERM');
await sleep(800);
rmSync(DATA, { recursive: true, force: true });
console.log(`\n===== v6.11 VERIFY: ${PASS}/${PASS + FAIL} ${FAIL === 0 ? 'ALL PASS' : 'FAILURES'} =====`);
process.exit(FAIL === 0 ? 0 : 1);
