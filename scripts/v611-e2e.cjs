#!/usr/bin/env node
// ============================================================
// scripts/v611-e2e.cjs — GLAMA TIER-2/3 FEATURES E2E (browser)
// ------------------------------------------------------------
// Boots the built app on a scratch dir (PORT 9313, PIN 1992),
// then verifies in a real browser:
//   1. PIN 1992 unlock (new pin)
//   2. INDIA desk: 01c SECTOR MAP section + F-SCORE BOARD +
//      context chain (MACRO chips) render
//   3. INDIA desk: Options Desk INCOME SETUP RANKER renders
//   4. Both desks: 07b TRUST LAYER + PERFORMANCE LAB sections
//   5. Morning Brief NEXT ACTIONS block renders
//   6. COINDCX desk: 02c CROSS-ASSET CORRELATIONS + matrix
//   7. COINDCX desk: trade ticket has 🔔 NOTIFY button (3rd mode)
//   8. COINDCX desk: agent panel has 🔔 START NOTIFY
//   9. Zero JS page errors on both desks
// ============================================================
const { spawn } = require('node:child_process');
const { mkdirSync, rmSync } = require('node:fs');
const path = require('node:path');

function loadPlaywright() {
  try { return require('playwright'); } catch {}
  try { return require('/home/z/.npm-global/lib/node_modules/playwright'); } catch {}
  throw new Error('Playwright not found');
}
const { chromium } = loadPlaywright();

const ROOT = path.resolve(process.cwd());
const DATA = path.join(ROOT, '.verify-v611e2e');
const PORT = 9313;
const BASE = `http://127.0.0.1:${PORT}`;

let pass = 0, fail = 0;
const check = (name, cond, extra = '') => {
  if (cond) { pass++; console.log(`  ✅ ${name}${extra ? ' — ' + extra : ''}`); }
  else { fail++; console.log(`  ❌ ${name}${extra ? ' — ' + extra : ''}`); }
};
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

(async () => {
  rmSync(DATA, { recursive: true, force: true });
  mkdirSync(DATA, { recursive: true });
  const env = { ...process.env, PORT: String(PORT), APP_PIN: '1992', ALLOWED_ORIGINS: '*', SMARTAI_DATA_DIR: DATA, NODE_ENV: 'production' };
  const server = spawn('node', ['server/index.js'], { cwd: ROOT, env, stdio: ['ignore', 'ignore', 'ignore'] });
  let booted = false;
  for (let i = 0; i < 40; i++) {
    await sleep(500);
    try { const r = await fetch(BASE + '/health'); booted = r.ok; } catch {}
    if (booted) break;
  }
  check('server boots (PIN 1992)', booted);

  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const jsErrors = [];
  page.on('pageerror', e => jsErrors.push(String(e?.message || e).slice(0, 120)));

  // ---- 1. unlock ----
  await page.goto(BASE, { waitUntil: 'domcontentloaded' });
  await sleep(2500);
  const pin = page.locator('input[placeholder*="•"], input[type="password"]').first();
  if (await pin.count() > 0) {
    await pin.fill('1992');
    await page.locator('button:has-text("Unlock")').first().click();
    await sleep(4000);
  }
  check('PIN 1992 unlock', !(await page.locator('input[placeholder*="•"], input[type="password"]').count()));
  const notNow = page.locator('button:has-text("Not now")');
  if (await notNow.count() > 0) { await notNow.first().click(); await sleep(300); }

  // ---- 2. INDIA desk ----
  await page.click('[role="tablist"] button:has-text("India Intraday")');
  await page.waitForSelector('text=INDIA INTRADAY DESK', { timeout: 25000 });
  // scroll through so lazy sections render
  for (const anchor of ['#in-brief', '#in-sectors', '#in-options', '#in-ledger', '#in-trust']) {
    await page.evaluate(a => { const el = document.querySelector(a); if (el) el.scrollIntoView({ block: 'center' }); }, anchor);
    await sleep(1200);
  }
  await sleep(4000);
  let body = await page.innerText('body');
  check('India: 01c Sector Map section', /SECTOR MAP \+ CONTEXT CHAIN/i.test(body));
  check('India: F-SCORE BOARD renders', /F-SCORE BOARD/i.test(body));
  check('India: macro chain chips (MACRO → RISK)', /MACRO/.test(body) && /(RISK-ON|RISK-OFF|FLAT)/.test(body));
  check('India: Morning Brief NEXT ACTIONS', /NEXT ACTIONS/i.test(body));
  check('India: INCOME SETUP RANKER (options desk)', /INCOME SETUP RANKER/i.test(body));
  check('India: 07b Trust Layer section', /TRUST LAYER \+ PERFORMANCE LAB/i.test(body));
  // trust panel: either honest-insufficient note or calibration content
  check('India: Trust panel body (calibration or honest-empty)', /Insufficient data|CALIBRATION|BRIER/i.test(body));

  // ---- 3. COINDCX desk ----
  await page.click('[role="tablist"] button:has-text("CoinDCX")');
  await page.waitForSelector('text=COINDCX DESK', { timeout: 25000 });
  for (const anchor of ['#cx-brief', '#cx-corr', '#cx-ledger', '#cx-trust']) {
    await page.evaluate(a => { const el = document.querySelector(a); if (el) el.scrollIntoView({ block: 'center' }); }, anchor);
    await sleep(1200);
  }
  await sleep(4000);
  body = await page.innerText('body');
  check('CoinDCX: 02c Cross-Asset Correlations section', /CROSS-ASSET CORRELATIONS/i.test(body));
  check('CoinDCX: correlation matrix rows (NIFTY/BTC keys)', /NIFTY/.test(body) && /BTC/.test(body));
  check('CoinDCX: risk-link read present', /diversifier|risk-on\/off|hedg/i.test(body));
  check('CoinDCX: 07b Trust Layer section', /TRUST LAYER \+ PERFORMANCE LAB/i.test(body));
  check('CoinDCX: Morning Brief NEXT ACTIONS', /NEXT ACTIONS/i.test(body));
  check('CoinDCX: agent START NOTIFY button', (await page.locator('button:has-text("START NOTIFY")').count()) > 0);

  // ---- 4. NOTIFY button on a signal ticket ----
  // scroll to the signal board and expand the first actionable card's ticket
  await page.evaluate(() => window.scrollTo({ top: 0 }));
  await sleep(800);
  const tradeBtn = page.locator('button:has-text("TRADE")').first();
  if (await tradeBtn.count() > 0) {
    await tradeBtn.click();
    await sleep(1500);
  }
  body = await page.innerText('body');
  const notifyBtn = await page.locator('button:has-text("NOTIFY")').first();
  check('trade ticket: 🔔 NOTIFY third-mode button', (await page.locator('button:has-text("NOTIFY")').count()) > 0);

  // ---- 5. zero JS errors (TV websocket sandbox noise filtered) ----
  const realErrors = jsErrors.filter(e => !/WebSocket|tradingview|ERR_INTERNET|net::/i.test(e));
  check('zero JS page errors (both desks toured)', realErrors.length === 0, realErrors.slice(0, 2).join(' | ') || 'clean');

  // screenshot for the record
  await page.screenshot({ path: path.join(ROOT, 'scripts', 'v611-cx.png'), fullPage: false });
  await page.click('[role="tablist"] button:has-text("India Intraday")');
  await sleep(1500);
  await page.screenshot({ path: path.join(ROOT, 'scripts', 'v611-india.png'), fullPage: false });

  await browser.close();
  server.kill('SIGTERM');
  await sleep(800);
  rmSync(DATA, { recursive: true, force: true });
  console.log(`\n===== v6.11 E2E: ${pass}/${pass + fail} ${fail === 0 ? 'ALL PASS' : 'FAILURES'} =====`);
  process.exit(fail === 0 ? 0 : 1);
})().catch(e => { console.error('E2E crashed —', e.message); process.exit(1); });
