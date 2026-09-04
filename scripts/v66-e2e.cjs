#!/usr/bin/env node
/** v6.6 E2E — SIMPLE TRADE TICKET (both desks) + crypto leverage chips + liquidation display + leveraged paper execute. */
function loadPlaywright() {
  try { return require('playwright'); } catch { /* not local */ }
  try { return require('/home/z/.npm-global/lib/node_modules/playwright'); } catch { /* not global */ }
  throw new Error('playwright missing');
}
const { chromium } = loadPlaywright();
const { spawn } = require('node:child_process');
const { mkdtempSync, rmSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');

const PORT = 8966;
const BASE = `http://127.0.0.1:${PORT}`;
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

// v6.6: store.js now honors SMARTAI_DATA_DIR → the E2E runs on a pristine
// temp data dir (fresh config with cryptoLeverage=3, empty journal — no
// dev-box residue, no daily-cap surprises).
const dataDir = mkdtempSync(join(tmpdir(), 'smartai-v66e2e-'));

const server = spawn('node', ['server/index.js'], {
  cwd: process.cwd(),
  env: { ...process.env, PORT: String(PORT), APP_PIN: '2023', SMARTAI_DATA_DIR: dataDir },
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
  const browser = await chromium.launch();
  const context = await browser.newContext({ viewport: { width: 1500, height: 950 }, serviceWorkers: 'block' });
  const page = await context.newPage();
  const errs = [];
  page.on('pageerror', e => errs.push(String(e)));
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
    check('v6.6 badge in header', await page.locator('.quantum-badge:has-text("v6.6")').count() > 0);

    // ---------- INDIA DESK: the TRADE ticket ----------
    await page.waitForSelector('button:has-text("INDIA MARKET")', { timeout: 10000 });
    await sleep(9000); // board load
    let tradeBtns = await page.locator('button:has-text("🚀 TRADE")').count();
    check('India cards show 🚀 TRADE buttons', tradeBtns > 0, `${tradeBtns} cards`);
    if (tradeBtns > 0) {
      await page.locator('button:has-text("🚀 TRADE")').first().click();
      await sleep(700);
      check('SIMPLE TRADE TICKET opens', await page.locator('[aria-label="simple trade ticket"]').count() > 0);
      check('ticket shows pre-computed grid (QTY / RISK / PROFIT)', (await page.locator('text=₹ RISK @ SL').count()) > 0 && (await page.locator('text=₹ PROFIT @ T2').count()) > 0);
      check('ticket budget input present', await page.locator('input[aria-label="capital budget in rupees"]').count() > 0);
      check('India ticket has NO leverage chips (equity desk)', await page.locator('[aria-label="leverage selector"]').count() === 0);
      check('PAPER EXECUTE button in ticket', await page.locator('button:has-text("PAPER EXECUTE")').count() > 0);
      check('how-it-runs 3-step strip', (await page.locator('text=Kaise chalega').count()) > 0);

      // take the India paper trade THROUGH the ticket
      await page.locator('button:has-text("PAPER EXECUTE")').first().click();
      await sleep(6000);
      const body = await page.innerText('body');
      const indiaOk = /Paper trade opened|paper position khula|practice 1-share/i.test(body);
      check('India PAPER EXECUTE via ticket → position opens', indiaOk, indiaOk ? 'opened' : (body.match(/⛔[^\n]*/) || ['no toast'])[0].slice(0, 120));

      // close ticket
      await page.locator('button:has-text("▲ Ticket")').first().click().catch(() => {});
      await sleep(400);
    }

    // ---------- CRYPTO DESK: leverage ----------
    await page.click('button:has-text("₿ CRYPTO")');
    await sleep(9000);
    tradeBtns = await page.locator('button:has-text("🚀 TRADE")').count();
    check('crypto cards show 🚀 TRADE buttons', tradeBtns > 0, `${tradeBtns} cards`);
    if (tradeBtns > 0) {
      await page.locator('button:has-text("🚀 TRADE")').first().click();
      await sleep(700);
      check('crypto ticket opens', await page.locator('[aria-label="simple trade ticket"]').count() > 0);
      check('margin input present', await page.locator('input[aria-label="margin in rupees"]').count() > 0);
      const chips = await page.locator('[aria-label="leverage selector"] button').count();
      check('leverage chips render (default ceiling 3 → 1x/2x/3x)', chips === 3, `${chips} chips`);

      // select 2x → liquidation estimate must appear
      await page.locator('[aria-label="leverage selector"] button:has-text("2x")').click();
      await sleep(500);
      check('2x selected → liquidation estimate + honesty block', (await page.locator('text≈ LIQUIDATION').count()) > 0 || (await page.locator('text=/LIQUIDATION/i').count()) > 0);
      check('liquidation sanity verdict line (✅ or ⚠️)', (await page.locator('text=SL pehle fire hoga').count()) + (await page.locator('text=PEHLE').count()) > 0);

      // leveraged paper execute through the ticket
      await page.locator('button:has-text("PAPER EXECUTE")').first().click();
      await sleep(6000);
      const body = await page.innerText('body');
      const cryptoOk = /Paper trade opened|paper position khula/i.test(body);
      check('crypto PAPER EXECUTE with 2x → leveraged position opens', cryptoOk, cryptoOk ? 'opened (2x)' : (body.match(/⛔[^\n]*/) || ['no toast'])[0].slice(0, 120));

      // the position must carry the leverage in the console (journal)
      const login = await fetch(`${BASE}/api/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ pin: '2023' }) });
      const cookie = (login.headers.get('set-cookie') || '').split(';')[0];
      const pj = await (await fetch(`${BASE}/api/ai/positions`, { headers: { cookie } })).json();
      const levPos = (pj.positions || []).find(p => p.leverage != null && p.leverage > 1);
      check('journal position carries leverage/margin/liquidation', !!levPos && levPos.liquidation != null,
        levPos ? `${levPos.pair} ${levPos.leverage}x margin ₹${Math.round(levPos.marginINR || 0)} liq ${levPos.liquidation}` : 'none');

      // OrderConsole: Max leverage field
      check('OrderConsole shows MAX LEVERAGE × field', await page.locator('text=MAX LEVERAGE × (CRYPTO)').count() > 0);
      // position row badge
      check('position row shows 2x MARGIN badge', await page.locator('text=MARGIN').count() > 0 || await page.locator('text=/\\d+x MARGIN/').count() > 0);

      // cleanup opened paper positions
      for (const p of (pj.positions || []).filter(p => p.status === 'OPEN' && p.mode === 'paper')) {
        await fetch(`${BASE}/api/ai/positions/close`, { method: 'POST', headers: { 'Content-Type': 'application/json', cookie }, body: JSON.stringify({ id: p.id }) });
        console.log(`      · cleaned paper position ${p.pair}${p.leverage ? ` (${p.leverage}x)` : ''}`);
      }
    }

    check('zero JS errors', errs.length === 0, errs.slice(0, 2).join(' | ').slice(0, 200));
  } catch (e) {
    check('script crashed', false, String(e.message || e).slice(0, 300));
  } finally {
    await browser.close().catch(() => {});
    server.kill('SIGTERM');
    await sleep(300);
    try { rmSync(dataDir, { recursive: true, force: true }); } catch { /* best-effort */ }
    process.exit(failures === 0 ? 0 : 1);
  }
})();
