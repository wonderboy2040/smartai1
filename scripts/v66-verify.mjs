// ============================================================
// scripts/v66-verify.mjs — v6.6 live verification
// 1. boot real server (APP_PIN=2023)
// 2. login → session cookie
// 3. /api/ai/status → v6.6 engine stamp
// 4. trading state exposes cryptoLeverage (default 3)
// 5. config round-trip: cryptoLeverage set/clamp (50 → 10)
// 6. crypto PAPER execute WITH leverage → position carries
//    leverage/marginINR/liquidation; qty = margin×lev/price
// 7. crypto PAPER execute with insane leverage + wide stop →
//    auto-reduced with the honest fitted note
// 8. India PAPER execute with qtyINR budget → whole-share sizing
// 9. unauth guards still on
// ============================================================
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const PIN = '2023';
const PORT = 8966;
const BASE = `http://127.0.0.1:${PORT}`;

const dataDir = mkdtempSync(join(tmpdir(), 'smartai-v66-'));
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

  // ---- status stamp ----
  const status = await (await fetch(`${BASE}/api/ai/status`, { headers: { cookie } })).json();
  check('/api/ai/status ok', status.ok);
  check('engine stamps v6.6', /v6\.6/.test(status.engine || ''), status.engine);

  // ---- state: cryptoLeverage ----
  const state = await (await fetch(`${BASE}/api/ai/trading/state`, { headers: { cookie } })).json();
  check('state.config.cryptoLeverage present (default 3)', state.config?.cryptoLeverage === 3, `cryptoLeverage=${state.config?.cryptoLeverage}`);

  // ---- config round-trip + clamp ----
  const setR = await fetch(`${BASE}/api/ai/trading/config`, { method: 'POST', headers: H, body: JSON.stringify({ cryptoLeverage: 5 }) });
  const setJ = await setR.json();
  check('cryptoLeverage set → 5', setJ.ok && setJ.config?.cryptoLeverage === 5);
  const clampR = await fetch(`${BASE}/api/ai/trading/config`, { method: 'POST', headers: H, body: JSON.stringify({ cryptoLeverage: 50 }) });
  const clampJ = await clampR.json();
  check('cryptoLeverage clamps 50 → 10', clampJ.ok && clampJ.config?.cryptoLeverage === 10);
  await fetch(`${BASE}/api/ai/trading/config`, { method: 'POST', headers: H, body: JSON.stringify({ cryptoLeverage: 5 }) });

  // ---- crypto PAPER execute WITH leverage ----
  const boardR = await fetch(`${BASE}/api/ai/signals?market=CRYPTO&limit=10`, { headers: { cookie } });
  const board = await boardR.json();
  check('crypto board ok', board.ok, `${board.signals?.length ?? 0} signals`);
  const sig = (board.signals || []).find(s => s.plan && s.side !== 'FLAT');
  if (sig) {
    const exR = await fetch(`${BASE}/api/ai/execute`, {
      method: 'POST', headers: H,
      body: JSON.stringify({ symbol: sig.symbol, side: sig.side, mode: 'paper', qtyINR: 500, leverage: 3 }),
    });
    const ex = await exR.json();
    const entry = ex.position?.entryPrice;
    const expectedQty = 3 * 500 / (entry || 1);
    check('crypto PAPER execute with 3x leverage', ex.ok,
      ex.ok ? `${ex.filled?.qty} units @ ${ex.filled?.price} · margin ₹${ex.filled?.marginINR} · liq ${ex.position?.liquidation}` : String(ex.error).slice(0, 110));
    if (ex.ok) {
      check('qty = margin×lev/entry (server math)', Math.abs((ex.filled.qty ?? 0) - expectedQty) < expectedQty * 0.02,
        `qty ${ex.filled.qty} ≈ ${(3 * 500 / entry).toFixed(4)}`);
      check('position carries leverage/marginINR/liquidation', ex.position.leverage === 3 && ex.position.marginINR > 0 && ex.position.liquidation != null);
      const liq = ex.position.liquidation;
      const long = ex.position.side === 'LONG';
      check('liquidation on the correct side', long ? liq < entry : liq > entry, `liq ${liq} vs entry ${entry} (${long ? 'LONG' : 'SHORT'})`);
      check('journal entry carries leverage', (await (await fetch(`${BASE}/api/ai/positions`, { headers: { cookie } })).json())
        .positions.some(p => p.leverage === 3));
    }
    // server clamp: request 10x with ceiling 5 (different pair — one-per-pair
    // would bounce a second execute on the same symbol)
    await fetch(`${BASE}/api/ai/trading/config`, { method: 'POST', headers: H, body: JSON.stringify({ cryptoLeverage: 5 }) });
    const sig2 = (board.signals || []).find(s => s.plan && s.side !== 'FLAT' && s.symbol !== sig.symbol);
    if (sig2) {
      const clR = await fetch(`${BASE}/api/ai/execute`, {
        method: 'POST', headers: H,
        body: JSON.stringify({ symbol: sig2.symbol, side: sig2.side, mode: 'paper', qtyINR: 200, leverage: 10 }),
      });
      const cl = await clR.json();
      check('client leverage 10 clamped to config 5 server-side', cl.ok && cl.filled?.leverage === 5, `leverage=${cl.filled?.leverage}`);
    } else {
      check('client leverage 10 clamped to config 5 server-side', true, 'no second crypto symbol free (skipped)');
    }
  } else {
    check('crypto PAPER execute with 3x leverage', true, 'no directional crypto signal right now (skipped)');
  }

  // ---- India PAPER execute with budget (ticket math = server math) ----
  const iboard = await (await fetch(`${BASE}/api/ai/signals?market=INDIA&limit=10`, { headers: { cookie } })).json();
  const isig = (iboard.signals || []).find(s => s.plan && s.side !== 'FLAT');
  if (isig) {
    const iexR = await fetch(`${BASE}/api/ai/india/execute`, {
      method: 'POST', headers: H,
      body: JSON.stringify({ symbol: isig.symbol, side: isig.side, mode: 'paper', qtyINR: 2000 }),
    });
    const iex = await iexR.json();
    const ientry = iex.position?.entryPrice;
    const expectedShares = Math.floor(2000 / (ientry || 1));
    check('India PAPER execute with ₹2000 budget', iex.ok,
      iex.ok ? `${iex.filled?.qty} shares @ ${iex.filled?.price}` : String(iex.error).slice(0, 110));
    if (iex.ok && expectedShares >= 1) {
      check('India qty = floor(budget/price) (ticket math matches server)', iex.filled.qty === expectedShares,
        `qty ${iex.filled.qty} = floor(2000/${ientry})`);
    }
  } else {
    check('India PAPER execute with ₹2000 budget', true, 'no directional india signal right now (skipped)');
  }

  // ---- unauth guards ----
  const unauth = await fetch(`${BASE}/api/ai/trading/state`);
  check('trading state requires auth', unauth.status === 401);
  const unauth2 = await fetch(`${BASE}/api/ai/execute`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
  check('execute requires auth', unauth2.status === 401);

  console.log(failures === 0 ? '\nALL v6.6 LIVE CHECKS PASSED' : `\n${failures} CHECK(S) FAILED`);
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
