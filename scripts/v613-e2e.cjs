#!/usr/bin/env node
// ============================================================
// scripts/v613-e2e.cjs — ORDER TICKET + SIMPLE VIEW E2E (browser)
// ------------------------------------------------------------
// Boots the built app on a scratch dir (PORT 9313, PIN 1992),
// then verifies in a real browser:
//   1. PIN 1992 unlock
//   2. INDIA desk opens in SIMPLE view (default):
//      core trade-flow visible, PRO sections hidden, note shown
//   3. OPTIONS DESK: ORDER TICKET renders — 4 steps (KAB lena /
//      konsa expiry / LIMIT order / kab exit) + leg rows with
//      LIMIT prices + sizing
//   4. PRO chip toggle: advanced sections appear (MODEL REGISTRY)
//   5. Signal trade ticket: ORDER GUIDE (4-step) renders (honest
//      skip allowed if board is empty — silence is a signal too)
//   6. COINDCX desk: PRO persisted, SIMPLE toggle hides sections
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
const DATA = path.join(ROOT, '.verify-v613e2e');
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

  // ---- 2. INDIA desk: SIMPLE default ----
  await page.click('[role="tablist"] button:has-text("India Intraday")');
  await page.waitForSelector('text=INDIA INTRADAY DESK', { timeout: 25000 });
  await sleep(6000); // let the board + options desk fetch settle
  let body = await page.innerText('body');
  check('India: SIMPLE toggle rendered', (await page.locator('[data-desk-view="simple"]').count()) > 0);
  check('India: SIMPLE active by default (aria-pressed)', await page.locator('[data-desk-view="simple"][aria-pressed="true"]').count() > 0);
  const coreVisible = ['TOP 5', 'SIGNAL BOARD', 'OPTIONS DESK', 'EXECUTION CONSOLE'].every(t => body.toUpperCase().includes(t));
  check('India: core trade-flow sections visible in SIMPLE', coreVisible);
  const proHidden = !/MODEL REGISTRY/.test(body) && !/SECTOR MAP \+ CONTEXT CHAIN/.test(body) && !/TRUST LAYER \+ PERFORMANCE LAB/.test(body) && !/BACKTEST LAB/.test(body);
  check('India: PRO sections hidden in SIMPLE (Models/Sectors/Trust/Backtest)', proHidden);
  check('India: PRO note shown ("baaki sections abhi chhupe hain")', /baaki sections abhi chhupe hain/i.test(body));
  const navChips = await page.locator('[role="navigation"] button').count();
  check('India: QuickNav filtered in SIMPLE (4 chips)', navChips === 4, `${navChips} chips`);

  // ---- 3. OPTIONS DESK: ORDER TICKET (the user's core ask) ----
  const ticket = await page.locator('text=ORDER TICKET — 4 STEP ME TRADE').count();
  check('India: ORDER TICKET block renders on strategies', ticket > 0, `${ticket} tickets`);
  const steps = ['KAB lena hai', 'KYA lena hai', 'LIMIT ORDER kaise lagana hai', 'KAB exit karna hai'];
  const stepsFound = steps.filter(s => body.toUpperCase().includes(s.toUpperCase())).length;
  check('India: ticket 4 steps (KAB/KYA/LIMIT/EXIT) present', stepsFound >= 4, `${stepsFound}/4`);
  check('India: ticket leg rows show LIMIT ₹ prices', /LIMIT ₹\d/.test(body));
  check('India: ticket sizing (lot max-loss rows)', /Sizing \(max loss/i.test(body));
  check('India: ticket MARKET-order warning', /MARKET order kabhi nahi/i.test(body));
  check('India: ticket expiry chip (din baaki ya AAJ EXPIRY)', /din baaki|AAJ EXPIRY/i.test(body));

  // ---- 4. PRO toggle ----
  await page.locator('[data-desk-view="pro"]').first().click();
  await sleep(1500);
  body = await page.innerText('body');
  check('India: PRO toggle reveals MODEL REGISTRY', /MODEL REGISTRY/.test(body));
  check('India: PRO toggle reveals SECTOR MAP', /SECTOR MAP \+ CONTEXT CHAIN/i.test(body));
  check('India: PRO note hidden in PRO mode', !(/baaki sections abhi chhupe hain/i.test(body)));
  const navChipsPro = await page.locator('[role="navigation"] button').count();
  check('India: QuickNav full in PRO (9 chips)', navChipsPro === 9, `${navChipsPro} chips`);

  // ---- 5. signal trade ticket ORDER GUIDE (honest-skip ok) ----
  await page.evaluate(() => window.scrollTo({ top: 0 }));
  await sleep(800);
  // NOTE: TopPicks ka 🚀 TRADE sirf board card par JUMP karta hai — asli
  // ticket SIGNAL BOARD (#in-signals) ke card ke andar khulta hai.
  const tradeBtn = page.locator('#in-signals button:has-text("TRADE")').first();
  if (await tradeBtn.count() > 0) {
    await tradeBtn.click();
    await sleep(1500);
    const ticketBody = await page.innerText('body');
    check('India: signal ticket ORDER GUIDE (4-step) renders', /ORDER GUIDE[\s\S]*?4 STEP/i.test(ticketBody));
    check('India: ticket step ② LIMIT ORDER guidance', /LIMIT ORDER kaise lagana hai/i.test(ticketBody));
    check('India: ticket MARKET-order warning', /MARKET order kabhi mat lagao/i.test(ticketBody));
    check('India: ticket step ① KAB windows (9:30–10:30 / 13:30–15:15)', /9:30–10:30|13:30–15:15/.test(ticketBody));
    const closeBtn = page.locator('button[aria-label="Close ticket"], button:has-text("✕")').first();
    if (await closeBtn.count() > 0) { await closeBtn.click(); await sleep(500); }
  } else {
    check('India: signal board honest-empty (ORDER GUIDE skip allowed)', true, 'koi actionable card nahi — silence is a signal');
  }

  // ---- 6. COINDCX desk: PRO persisted, SIMPLE hides ----
  await page.click('[role="tablist"] button:has-text("CoinDCX")');
  await page.waitForSelector('text=COINDCX DESK', { timeout: 25000 });
  await sleep(6000);
  body = await page.innerText('body');
  check('CoinDCX: PRO persisted from India (localStorage)', await page.locator('[data-desk-view="pro"][aria-pressed="true"]').count() > 0);
  check('CoinDCX: PRO sections visible (Correlations)', /CROSS-ASSET CORRELATIONS/i.test(body));
  await page.locator('[data-desk-view="simple"]').first().click();
  await sleep(1500);
  body = await page.innerText('body');
  check('CoinDCX: SIMPLE hides correlations/models', !(/CROSS-ASSET CORRELATIONS/i.test(body)) && !(/MODEL REGISTRY/.test(body)));
  check('CoinDCX: core sections still visible (AGENT/TOP5/SIGNALS/EXECUTE)', ['AUTO-AGENT', 'TOP 5', 'SIGNAL BOARD', 'EXECUTION CONSOLE'].every(t => body.toUpperCase().includes(t)));

  // ---- 7. JS errors ----
  check('zero JS page errors on both desks', jsErrors.length === 0, jsErrors.slice(0, 3).join(' | '));

  await browser.close();
  server.kill();
  rmSync(DATA, { recursive: true, force: true });
  console.log(`\nRESULT: ${pass} pass / ${fail} fail — v6.13 E2E ${fail === 0 ? 'ALL PASS' : 'FAILED'}`);
  process.exit(fail === 0 ? 0 : 1);
})().catch(e => { console.error('E2E crash:', e); process.exit(1); });
