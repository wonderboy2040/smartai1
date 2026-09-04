// ============================================================
// scripts/v65-verify.mjs — v6.5 live verification
// 1. boot real server (APP_PIN=2023)
// 2. login → session cookie
// 3. /api/ai/status → v6.5 engine + dhan + telegram blocks
// 4. /api/ai/backtest (crypto + india) → walk-forward stats
// 5. /api/ai/alerts/config (masked) + save/clear round-trip
// 6. /api/ai/dhan/status + invalid connect reject
// 7. /api/ai/india/execute PAPER (the new user flow) + positions
// 8. trading state exposes trailEnabled / indiaMode
// ============================================================
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const PIN = '2023';
const PORT = 8965;
const BASE = `http://127.0.0.1:${PORT}`;

// isolate this run's server-side files so the dev-box journal/config
// stays pristine (same pattern as v64)
const dataDir = mkdtempSync(join(tmpdir(), 'smartai-v65-'));
process.env.SMARTAI_DATA_DIR = dataDir;

const server = spawn('node', ['server/index.js'], {
  cwd: process.cwd(),
  env: { ...process.env, PORT: String(PORT), APP_PIN: PIN, SMARTAI_DATA_DIR: dataDir },
  stdio: ['ignore', 'pipe', 'pipe'],
});
let logs = '';
server.stdout.on('data', d => { logs += d; });
server.stderr.on('data', d => { logs += d; });

const sleep = ms => new Promise(r => setTimeout(r, ms));
const waitUp = async () => {
  for (let i = 0; i < 60; i++) {
    try { const r = await fetch(`${BASE}/api/health`, { signal: AbortSignal.timeout(1500) }); if (r.ok || r.status === 401 || r.status === 404) return true; }
    catch { /* retry */ }
    await sleep(500);
  }
  return false;
};

let failures = 0;
const check = (name, ok, extra = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'} · ${name}${extra ? ` — ${extra}` : ''}`);
  if (!ok) failures++;
};

try {
  const up = await waitUp();
  check('server boots with PIN auth', up);
  if (!up) throw new Error('server never came up\n' + logs.slice(-2000));

  const login = await fetch(`${BASE}/api/auth/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ pin: PIN }),
  });
  const cookie = (login.headers.get('set-cookie') || '').split(';')[0];
  check('PIN login → session cookie', login.ok && !!cookie);
  const H = { cookie, 'Content-Type': 'application/json' };

  // ---- status block ----
  const statusR = await fetch(`${BASE}/api/ai/status`, { headers: { cookie } });
  const status = await statusR.json();
  check('/api/ai/status ok', status.ok);
  check('engine stamps v6.5', /v6\.5/.test(status.engine || ''), status.engine);
  check('status carries dhan + telegram blocks', typeof status.dhan?.connected === 'boolean' && typeof status.telegram?.configured === 'boolean');

  // ---- trading state: trail + india fields ----
  const stateR = await fetch(`${BASE}/api/ai/trading/state`, { headers: { cookie } });
  const state = await stateR.json();
  check('state.config.trailEnabled present', state.config?.trailEnabled === true);
  check('state.config.indiaMode defaults to paper', state.config?.indiaMode === 'paper');
  check('trailArmR/trailOffsetR defaults', state.config?.trailArmR === 1 && state.config?.trailOffsetR === 1);

  // ---- backtest (crypto) ----
  const btR = await fetch(`${BASE}/api/ai/backtest?market=CRYPTO&minGrade=ACTION`, { headers: { cookie }, signal: AbortSignal.timeout(90000) });
  const bt = await btR.json();
  check('backtest crypto responds', btR.ok || bt.ok, bt.stats ? `${bt.stats.trades} trades` : String(bt.reason || '').slice(0, 80));
  if (bt.stats) {
    check('backtest has winRate/avgR/profitFactor', bt.stats.winRate != null || bt.stats.trades === 0,
      `trades=${bt.stats.trades} win=${bt.stats.winRate}% avgR=${bt.stats.avgR} PF=${bt.stats.profitFactor}`);
    check('backtest disclaimer present (honesty)', typeof bt.disclaimer === 'string' && bt.disclaimer.length > 20);
    check('backtest params mirror live policy', bt.params?.maxRiskPct > 0 && bt.params?.slippagePct > 0);
  }

  // ---- backtest (india) ----
  const btIR = await fetch(`${BASE}/api/ai/backtest?market=INDIA&symbols=RELIANCE,INFY`, { headers: { cookie }, signal: AbortSignal.timeout(90000) });
  const btI = await btIR.json();
  check('backtest india responds', btIR.ok || btI.ok, btI.stats ? `${btI.stats.trades} trades` : String(btI.reason || '').slice(0, 80));

  // ---- alerts config (masked round-trip) ----
  const alertsR = await fetch(`${BASE}/api/ai/alerts/config`, { headers: { cookie } });
  const alerts = await alertsR.json();
  check('alerts config masked status', alerts.ok && alerts.status?.telegramBotToken?.configured === false);
  const saveR = await fetch(`${BASE}/api/ai/alerts/config`, {
    method: 'POST', headers: H,
    body: JSON.stringify({ telegramBotToken: '123456789:AAEhBOweik6ad9r_QXMENQjcrGbqCr5U-tU', telegramChatId: '987654321' }),
  });
  const saved = await saveR.json();
  check('alerts save round-trip', saved.ok && saved.status.telegramBotToken.configured === true && saved.status.telegramBotToken.tail === '…U-tU');
  check('masked — raw token never returned', !JSON.stringify(saved).includes('AAEhBOweik'));
  const badR = await fetch(`${BASE}/api/ai/alerts/config`, { method: 'POST', headers: H, body: JSON.stringify({ telegramBotToken: 'garbage' }) });
  check('invalid telegram token → 400', badR.status === 400);
  const clearR = await fetch(`${BASE}/api/ai/alerts/config`, { method: 'POST', headers: H, body: JSON.stringify({ telegramBotToken: null, telegramChatId: null }) });
  check('clear secrets', (await clearR.json()).ok);

  // ---- dhan status + invalid connect ----
  const dhanR = await fetch(`${BASE}/api/ai/dhan/status`, { headers: { cookie } });
  const dhan = await dhanR.json();
  check('dhan status (disconnected by default)', dhan.ok && dhan.connected === false);
  const badConn = await fetch(`${BASE}/api/ai/dhan/connect`, { method: 'POST', headers: H, body: JSON.stringify({ clientId: 'abc', accessToken: 'x'.repeat(40) }) });
  check('dhan connect validates clientId shape → 400', badConn.status === 400);
  const badConn2 = await fetch(`${BASE}/api/ai/dhan/connect`, { method: 'POST', headers: H, body: JSON.stringify({ clientId: '110001234', accessToken: 'short' }) });
  check('dhan connect validates token shape → 400', badConn2.status === 400);
  // bad-but-well-formed creds → profile ping fails → auto-disconnect
  const badCreds = await fetch(`${BASE}/api/ai/dhan/connect`, { method: 'POST', headers: H, body: JSON.stringify({ clientId: '110001234', accessToken: 'x'.repeat(48) }) });
  check('dhan connect with dead token rejected (profile ping)', badCreds.status >= 400, String((await badCreds.json()).error || '').slice(0, 90));

  // ---- India gauntlet: PAPER execute (the new flow) ----
  const boardR = await fetch(`${BASE}/api/ai/signals?market=INDIA&limit=10`, { headers: { cookie } });
  const board = await boardR.json();
  check('india board ok', board.ok, `${board.signals?.length ?? 0} signals`);
  const target = (board.signals || []).find(s => s.side === 'LONG' || s.side === 'SHORT');
  if (target) {
    const exR = await fetch(`${BASE}/api/ai/india/execute`, {
      method: 'POST', headers: H,
      body: JSON.stringify({ symbol: target.symbol, side: target.side, mode: 'paper' }),
    });
    const ex = await exR.json();
    check('India PAPER execute', ex.ok, ex.ok ? `${target.symbol} ${ex.filled?.qty} shares @ ${ex.filled?.price}${ex.fitted ? ' (fitted)' : ''}` : String(ex.error).slice(0, 90));
    if (ex.ok) {
      const posR = await fetch(`${BASE}/api/ai/positions`, { headers: { cookie } });
      const pos = await posR.json();
      const india = (pos.positions || []).find(p => p.market === 'INDIA');
      check('India position in journal with market/symbol/initialRisk', !!india && !!india.symbol && india.initialRisk > 0 && india.peakPrice > 0);
      // LIVE must bounce (indiaMode=paper + no dhan)
      const liveR = await fetch(`${BASE}/api/ai/india/execute`, {
        method: 'POST', headers: H,
        body: JSON.stringify({ symbol: target.symbol, side: target.side, mode: 'live' }),
      });
      const live = await liveR.json();
      check('India LIVE bounces while disarmed (MODE GATE)', !live.ok, String(live.error || '').slice(0, 90));
    }
  } else {
    check('India PAPER execute', true, 'no directional signal right now (skipped)');
  }

  // ---- crypto PAPER still healthy (regression) ----
  const cexR = await fetch(`${BASE}/api/ai/execute`, {
    method: 'POST', headers: H,
    body: JSON.stringify({ symbol: 'BTC', side: 'LONG', mode: 'paper' }),
  });
  const cex = await cexR.json();
  check('crypto PAPER execute still healthy', cex.ok, cex.ok ? `qty ${cex.filled?.qty} @ ${cex.filled?.price}` : String(cex.error).slice(0, 90));

  // ---- unauth guards ----
  const unauth = await fetch(`${BASE}/api/ai/backtest?market=CRYPTO`);
  check('backtest requires auth', unauth.status === 401);
  const unauth2 = await fetch(`${BASE}/api/ai/alerts/config`);
  check('alerts config requires auth', unauth2.status === 401);

  console.log(failures === 0 ? '\nALL v6.5 LIVE CHECKS PASSED' : `\n${failures} CHECK(S) FAILED`);
  process.exitCode = failures === 0 ? 0 : 1;
} catch (e) {
  console.error('VERIFY ERROR:', e?.message || e);
  console.error(logs.slice(-1500));
  process.exitCode = 1;
} finally {
  server.kill('SIGTERM');
  await sleep(300);
  try { rmSync(dataDir, { recursive: true, force: true }); } catch { /* best-effort */ }
}
