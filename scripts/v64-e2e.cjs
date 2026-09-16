#!/usr/bin/env node
/** v6.4 E2E — India trade slip + how-to guide + crypto order preview + risk-fit chip. */
function loadPlaywright() {
  try { return require('playwright'); } catch { /* not local */ }
  try { return require('/home/z/.npm-global/lib/node_modules/playwright'); } catch { /* not global */ }
  throw new Error('playwright missing');
}
const { chromium } = loadPlaywright();
const { spawn } = require('node:child_process');

const PORT = 8965;
const BASE = `http://127.0.0.1:${PORT}`;
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

const server = spawn('node', ['server/index.js'], {
  cwd: process.cwd(),
  env: { ...process.env, PORT: String(PORT), APP_PIN: '2023' },
  stdio: ['ignore', 'pipe', 'pipe'],
});
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

(async () => {
  // Deterministic gauntlet state: today's earlier probe runs already
  // burned the daily-3 cap (journal persists server-side). Reset BOTH
  // journal and config — this dev-box journal is test residue only
  // (production journal lives on the Render deploy).
  try {
    const { saveJSON } = require('../server/lib/store.js');
    saveJSON('ai-trading-journal.json', { entries: [], positions: [] });
    const { DEFAULT_CONFIG } = require('../server/ai/coindcxOrders.js');
    saveJSON('ai-trading-config.json', { ...DEFAULT_CONFIG });
    console.log('      · journal + config reset (deterministic caps)');
  } catch (e) { console.log('warn: reset skipped —', e.message); }

  const browser = await chromium.launch();
  const context = await browser.newContext({ viewport: { width: 1500, height: 950 }, serviceWorkers: 'block' });
  const page = await context.newPage();
  const errs = [];
  page.on('pageerror', e => errs.push(String(e)));
  // External-data noise (this box can't reach TV scanner/NSE sometimes):
  // network-layer "Failed to load resource" 503s are environmental — our
  // own /api endpoints all return 200 (verified separately). Filter them,
  // keep genuine JS exceptions (pageerror) strict.
  page.on('console', m => {
    if (m.type() !== 'error') return;
    if (/Failed to load resource.*(503|502|403|429)/i.test(m.text())) return;
    if (/tradingview|ws:|websocket/i.test(m.text())) return;
    errs.push(m.text());
  });

  try {
    check('server boot', await waitUp());
    await page.goto(BASE, { waitUntil: 'domcontentloaded' });
    await page.fill('input[type="password"]', '2023');
    await page.click('button:has-text("Unlock Terminal")');
    await page.waitForSelector('[role="tablist"]', { timeout: 20000 });
    await page.click('[role="tablist"] button:has-text("AI Trading")');
    await page.waitForSelector('text=SUPERINTELLIGENCE AI TRADING TERMINAL', { timeout: 20000 });

    // ---------- INDIA DESK ----------
    await page.waitForSelector('button:has-text("INDIA MARKET")', { timeout: 10000 });
    check('India 3-step how-to guide visible (v6.4)', await page.locator('text=INDIA DESK — SIGNAL SE TRADE TAK').count() > 0);
    check('guide mentions broker flow (slip → broker / Dhan LIVE)', (await page.locator('text=COPY SLIP').count()) + (await page.locator('text=DHAN LIVE').count()) > 0); // v6.5: India gained direct Dhan execution

    await sleep(9000); // board load
    const slipBtns = await page.locator('button:has-text("Slip")').count();
    check('India cards show 📋 Slip buttons', slipBtns > 0, `${slipBtns} cards`);
    if (slipBtns > 0) {
      await page.locator('button:has-text("📋 Slip")').first().click();
      await sleep(600);
      const slipVisible = await page.locator('text=TRADE SLIP — MANUAL BROKER FLOW').count() > 0;
      check('trade slip opens with sizing grid', slipVisible);
      check('slip shows RISK / TRADE budget input', await page.locator('input[aria-label="risk per trade in rupees"]').count() > 0);
      const hasQty = await page.locator('text=QTY (RISK-SIZED)').count() > 0 || await page.locator('text=budget is too small').count() > 0;
      check('slip computes qty / warns on small budget', hasQty);
      check('COPY FULL ORDER SLIP button present', await page.locator('button:has-text("COPY FULL ORDER SLIP")').count() > 0);
      check('SL-M trigger guidance in slip', (await page.locator('text=SL-M').count()) > 0);
      // close slip
      await page.locator('button:has-text("▲ Slip")').first().click();
    }

    // guide dismiss + re-open
    await page.click('button:has-text("Got it")');
    await sleep(400);
    check('guide collapses to a re-openable chip', await page.locator('button:has-text("India trade kaise lein")').count() > 0);
    await page.locator('button:has-text("India trade kaise lein")').click();
    await sleep(300);
    check('guide re-opens from chip', await page.locator('text=INDIA DESK — SIGNAL SE TRADE TAK').count() > 0);

    // ---------- CRYPTO DESK ----------
    await page.click('button:has-text("₿ CRYPTO")');
    await sleep(9000);
    check('crypto ORDER PREVIEW strip on cards', await page.locator('text=ORDER PREVIEW').count() > 0);
    const fittedChip = await page.locator('text=Auto-fitted').count();
    const capChip = await page.locator('text=/cap — PAPER pe click/').count();
    console.log(`      · risk-fit chips: ${fittedChip} pre-clamped + ${capChip} will-fit notices`);
    check('risk-cap transparency visible (fitted or will-fit)', fittedChip + capChip > 0);

    // THE user flow: click PAPER TRADE — must never bounce on the risk gate
    const btns = page.locator('button:has-text("PAPER TRADE")');
    const n = await btns.count();
    let paperOk = false, lastToast = '';
    for (let attempt = 0; attempt < 4 && !paperOk; attempt++) {
      await btns.nth(attempt % n).click();
      await sleep(5000);
      const body = await page.innerText('body');
      const riskBounce = /Signal gate: plan risk .* > .* max/.test(body);
      const okToast = /Paper trade opened|LIVE order placed/.test(body);
      if (okToast) paperOk = true;
      if (riskBounce) { lastToast = 'RISK-GATE BOUNCE'; break; }
      lastToast = (body.match(/⛔[^\n]*/) || [''])[0].slice(0, 120);
    }
    check('PAPER TRADE click → opens (never risk-gate bounce)', paperOk, paperOk ? 'position opened' : lastToast);

    check('zero JS errors', errs.length === 0, errs.slice(0, 2).join(' | ').slice(0, 200));

    // cleanup opened paper positions
    const login = await fetch(`${BASE}/api/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ pin: '2023' }) });
    const cookie = (login.headers.get('set-cookie') || '').split(';')[0];
    const pj = await (await fetch(`${BASE}/api/ai/positions`, { headers: { cookie } })).json();
    for (const p of (pj.positions || []).filter(p => p.status === 'OPEN' && p.mode === 'paper')) {
      await fetch(`${BASE}/api/ai/positions/close`, { method: 'POST', headers: { 'Content-Type': 'application/json', cookie }, body: JSON.stringify({ id: p.id }) });
      console.log(`      · cleaned paper position ${p.pair}`);
    }
  } catch (e) {
    check('script crashed', false, String(e.message || e).slice(0, 300));
  } finally {
    await browser.close().catch(() => {});
    server.kill('SIGTERM');
    await sleep(300);
    process.exit(failures === 0 ? 0 : 1);
  }
})();
