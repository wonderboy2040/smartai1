// ============================================================
// scripts/v64-verify.mjs — v6.4 live verification
// 1. boot real server (APP_PIN=2023)
// 2. login → session cookie
// 3. board carries riskCap + clamped-plan transparency
// 4. PAPER execute on a crypto symbol (the user flow) — must
//    never bounce on "plan risk X% > Y% max"; if the fresh plan
//    is over-cap it comes back FILLED with `fitted` note
// ============================================================
import { spawn } from 'node:child_process';

const PIN = '2023';
const PORT = 8964;
const BASE = `http://127.0.0.1:${PORT}`;

const server = spawn('node', ['server/index.js'], {
  cwd: process.cwd(),
  env: { ...process.env, PORT: String(PORT), APP_PIN: PIN },
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

  // login
  const login = await fetch(`${BASE}/api/auth/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ pin: PIN }),
  });
  const cookie = (login.headers.get('set-cookie') || '').split(';')[0];
  check('PIN login → session cookie', login.ok && !!cookie);

  // board carries riskCap
  const boardR = await fetch(`${BASE}/api/ai/signals?market=CRYPTO&limit=10`, { headers: { cookie } });
  const board = await boardR.json();
  check('crypto board ok', board.ok, board.reason || `${board.signals?.length ?? 0} signals`);
  check('board exposes riskCap (v6.4)', typeof board.riskCap === 'number' && board.riskCap > 0, `riskCap=${board.riskCap}`);
  const overCapSignals = (board.signals || []).filter(s => s.plan?.riskPct > board.riskCap);
  const clamped = (board.signals || []).filter(s => s.plan?.riskClamped);
  console.log(`      · ${board.signals?.length ?? 0} signals, ${overCapSignals.length} over-cap, ${clamped.length} pre-clamped at build time`);

  // THE user flow: paper execute an over-cap symbol if one exists, else any ACTION/STRONG symbol
  let target = overCapSignals[0] || (board.signals || []).find(s => s.side !== 'FLAT' && s.plan);
  if (!target) {
    // fall back to BTC deep signal
    const deep = await fetch(`${BASE}/api/ai/deep/BTC?market=CRYPTO`, { headers: { cookie } });
    const dj = await deep.json();
    target = dj.ok ? dj.signal : null;
  }
  if (target) {
    const planPct = target.plan?.riskPct;
    const exec = await fetch(`${BASE}/api/ai/execute`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', cookie },
      body: JSON.stringify({ symbol: target.symbol, side: target.side, mode: 'paper' }),
    });
    const out = await exec.json();
    if (out.ok) {
      check(`PAPER execute ${target.symbol} (${planPct}% plan vs ${board.riskCap}% cap) → FILLED`, true,
        `sl=${out.position?.sl}${out.fitted ? ' · ⚙️ ' + out.fitted : ''}`);
    } else {
      const isBounce = /plan risk .* > .* max/.test(out.error || '');
      check(`PAPER execute ${target.symbol} → must not bounce on risk gate`, !isBounce, out.error);
    }
  } else {
    console.log('SKIP · no crypto signal available right now (market data unreachable from this box)');
  }

  // India board sanity (slip data source)
  const iR = await fetch(`${BASE}/api/ai/signals?market=INDIA&limit=10`, { headers: { cookie } });
  const india = await iR.json();
  check('india board ok (trade-slip source)', india.ok, india.reason || `${india.signals?.length ?? 0} signals · riskCap=${india.riskCap}`);

  // cleanup: close any opened paper position
  const pos = await fetch(`${BASE}/api/ai/positions`, { headers: { cookie } });
  const pj = await pos.json();
  for (const p of (pj.positions || []).filter(p => p.status === 'OPEN' && p.mode === 'paper')) {
    await fetch(`${BASE}/api/ai/positions/close`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', cookie },
      body: JSON.stringify({ id: p.id }),
    });
    console.log(`      · cleaned paper position ${p.pair}`);
  }
} catch (e) {
  check('script crashed', false, String(e.message || e).slice(0, 300));
} finally {
  server.kill('SIGTERM');
  await sleep(300);
  process.exit(failures === 0 ? 0 : 1);
}
