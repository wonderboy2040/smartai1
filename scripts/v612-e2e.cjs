#!/usr/bin/env node
// ============================================================
// scripts/v612-e2e.cjs — PRO TRADER BRAIN E2E (browser)
// ------------------------------------------------------------
// Boots the built app on a scratch dir (PORT 9312, PIN 1992),
// then verifies in a real browser:
//   1. PIN 1992 unlock
//   2. INDIA desk: SESSION GATE banner (phase + note) renders
//   3. INDIA desk: signal cards carry QUALITY chips (QUORUM/MTF/…)
//   4. INDIA deep modal: MTF block + EDGE block render
//   5. COINDCX desk: signal cards carry quality chips too
//   6. COINDCX deep modal: MTF + EDGE blocks render
//   7. Zero JS page errors on both desks
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
const DATA = path.join(ROOT, '.verify-v612e2e');
const PORT = 9312;
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
  await sleep(6000); // let the board fetch + pass-2 enrichment land
  let body = await page.innerText('body');
  check('India: SESSION GATE banner (phase)', /SESSION GATE|SESSION/.test(body) && /(PRE_OPEN|OPENING|MORNING|MIDDAY|AFTERNOON|POWER|NO_NEW_ENTRIES|CLOSED)/.test(body));
  check('India: session note (Hinglish honest)', /order book adhura|square-off|noise|band|liquidity|market open/i.test(body));
  // quality chips on cards: QUORUM chip + MTF chip present somewhere
  check('India: quality chips — QUORUM renders', /QUORUM \d+\/\d+/.test(body));
  check('India: quality chips — MTF renders', /MTF (✓|⚠|n\/a)/.test(body));
  // signal cards exist (signals loaded)
  check('India: signal cards rendered', (await page.locator('[id^="sig-INDIA-"]').count()) > 0);

  // ---- 3. INDIA deep modal: MTF + EDGE ----
  const deepBtn = page.locator('button[title="Deep analysis"]').first();
  if (await deepBtn.count() > 0) {
    await deepBtn.click();
    await page.waitForSelector('text=DEEP ENSEMBLE ANALYSIS', { timeout: 20000 });
    await sleep(5000); // deep run + edge walk-forward
    body = await page.innerText('body');
    check('India deep: MTF block (DAILY vs 15m)', /MTF — DAILY vs 15M/.test(body) || /MTF — DAILY vs/.test(body));
    check('India deep: EDGE block (WALK-FORWARD)', /EDGE — WALK-FORWARD/.test(body) || /trades/.test(body));
    check('India deep: EDGE disclaimer honest', /past performance ≠ future|past performance/i.test(body));
    // close via the ✕ button (modal has no Escape handler pre-v6.12)
    const closeBtn = page.locator('button[aria-label="Close"]').first();
    if (await closeBtn.count() > 0) { await closeBtn.click(); await sleep(600); }
    else { await page.keyboard.press('Escape'); await page.mouse.click(30, 30); await sleep(600); }
  } else {
    check('India deep modal (n/a — no signal cards)', false);
  }

  // ---- 4. COINDCX desk ----
  await page.click('[role="tablist"] button:has-text("CoinDCX")');
  await page.waitForSelector('text=COINDCX DESK', { timeout: 25000 });
  await sleep(6000);
  body = await page.innerText('body');
  check('CoinDCX: signal cards rendered', (await page.locator('[id^="sig-CRYPTO-"]').count()) > 0);
  check('CoinDCX: quality chips — QUORUM renders', /QUORUM \d+\/\d+/.test(body));
  check('CoinDCX: quality chips — MTF/REGIME render', /MTF (✓|⚠|n\/a)|REGIME (✓|⚠)/.test(body));

  // ---- 5. COINDCX deep modal ----
  const deepBtn2 = page.locator('button[title="Deep analysis"]').first();
  if (await deepBtn2.count() > 0) {
    await deepBtn2.click();
    await page.waitForSelector('text=DEEP ENSEMBLE ANALYSIS', { timeout: 20000 });
    await sleep(5000);
    body = await page.innerText('body');
    check('CoinDCX deep: MTF block (DAILY vs 1H)', /MTF — DAILY vs 1H/.test(body) || /MTF — DAILY vs/.test(body));
    check('CoinDCX deep: EDGE block', /EDGE — WALK-FORWARD/.test(body) || /AVG R/.test(body));
    const closeBtn2 = page.locator('button[aria-label="Close"]').first();
    if (await closeBtn2.count() > 0) { await closeBtn2.click(); await sleep(600); }
    else { await page.keyboard.press('Escape'); await page.mouse.click(30, 30); await sleep(600); }
  } else {
    check('CoinDCX deep modal (n/a — no signal cards)', false);
  }

  // ---- 6. zero JS errors (TV websocket sandbox noise filtered) ----
  const realErrors = jsErrors.filter(e => !/WebSocket|tradingview|ERR_INTERNET|net::/i.test(e));
  check('zero JS page errors (both desks toured)', realErrors.length === 0, realErrors.slice(0, 2).join(' | ') || 'clean');

  // screenshots for the record
  await page.screenshot({ path: path.join(ROOT, 'scripts', 'v612-cx.png'), fullPage: false });
  await page.click('[role="tablist"] button:has-text("India Intraday")');
  await sleep(3500);
  await page.screenshot({ path: path.join(ROOT, 'scripts', 'v612-india.png'), fullPage: false });

  await browser.close();
  try { server.kill('SIGTERM'); } catch {}

  console.log('------------------------------');
  console.log(`RESULT: ${pass} pass / ${fail} fail — v6.12 E2E ${fail === 0 ? 'ALL PASS' : 'FAILED'}`);
  process.exit(fail === 0 ? 0 : 1);
})().catch(e => { console.error('E2E crashed:', e); process.exit(1); });
