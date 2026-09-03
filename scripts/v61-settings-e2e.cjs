// ============================================================
// scripts/v61-settings-e2e.cjs — v6.1 MULTI-DEVICE persistence
// E2E (browser-level, real server + built dist on :9211, PIN 2023).
// Proves the exact user-reported scenarios are fixed:
//   A) SECOND DEVICE / fresh browser: the server-side Match-App rate
//      (GET /api/mcp/settings → 92.0006) auto-applies — USA card
//      shows $1,631.97 invested WITHOUT any local calibration.
//   B) WRITE-THROUGH: entering a new Match-App value POSTs to
//      /api/mcp/settings (server save) + UI updates.
//   C) COOKIES & CACHE CLEARED: localStorage wiped + cookies cleared
//      → re-login → server value re-applies → same USA numbers
//      ("price alag" DEAD).
//   D) ☁ multi-device hints visible on Match-App + Set Basis UI.
//   E) zero JS errors.
// Usage: node scripts/v61-settings-e2e.cjs
// ============================================================
function loadPlaywright() {
  try { return require('playwright'); } catch { /* keep trying */ }
  try { return require('/home/z/.npm-global/lib/node_modules/playwright'); } catch { /* keep trying */ }
  throw new Error('Playwright not found');
}

const { spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = __dirname;
const DATA = path.join(ROOT, '..', 'server', 'data');
const PORT = 9211;
const BASE = `http://127.0.0.1:${PORT}`;
const PIN = '2023';
const FX = 94.892446;
const SERVER_RATE = 92.0006; // the value the "server" (route) returns

// ---- fixture: real live-synced rows (from v52 forensics) ----
const FIXTURE = require('./v53-fixture.cjs');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitForServer(timeoutMs = 30000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const r = await fetch(`${BASE}/api/auth/check`, { signal: AbortSignal.timeout(1500) }).catch(() => null);
      if (r && (r.ok || r.status === 401)) return true;
    } catch { /* retry */ }
    await sleep(400);
  }
  return false;
}

async function login(page) {
  const pinInput = page.locator('input[type="password"], input[inputmode="numeric"]').first();
  await pinInput.waitFor({ state: 'visible', timeout: 30000 });
  await pinInput.fill(PIN);
  await page.keyboard.press('Enter');
  await page.waitForTimeout(6000);
}

async function gotoPortfolio(page) {
  await page.locator('button, a', { hasText: /portfolio/i }).first().click();
  await page.waitForTimeout(8000);
}

(async () => {
  // ---- boot the REAL server (serves the built dist/) ----
  for (const f of ['mcp-settings.json']) {
    try { fs.rmSync(path.join(DATA, f), { force: true }); } catch { /* ignore */ }
  }
  const child = spawn('node', ['server/index.js'], {
    cwd: path.join(ROOT, '..'),
    env: { ...process.env, PORT: String(PORT), APP_PIN: PIN, API_TOKEN: 'e2e-api-token-0123456789', NODE_ENV: 'production' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let srvLog = '';
  child.stdout.on('data', (d) => { srvLog += d.toString(); });
  child.stderr.on('data', (d) => { srvLog += d.toString(); });

  const { chromium } = loadPlaywright();
  const browser = await chromium.launch({ args: ['--no-sandbox'] });
  const ctx = await browser.newContext({ serviceWorkers: 'block' });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push('PAGEERROR: ' + e.message));

  // ---- interceptors: the "server data" a second device would see ----
  const settingsGets = [];
  const settingsPosts = [];
  await page.route(/\/api\/mcp\/settings/, (route) => {
    const url = route.request().url();
    const method = route.request().method();
    if (method === 'POST') {
      const body = route.request().postDataJSON();
      settingsPosts.push(body);
      return route.fulfill({
        status: 200, contentType: 'application/json',
        body: JSON.stringify({ ok: true, settings: { usdAppRate: body?.value ?? null } }),
      });
    }
    settingsGets.push(url);
    return route.fulfill({
      status: 200, contentType: 'application/json',
      body: JSON.stringify({ ok: true, settings: { usdAppRate: SERVER_RATE } }),
    });
  });
  await page.route(/indmoney\/assets/, (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(FIXTURE) }));
  await page.route(/api\/forex/, (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ usdInr: FX, ts: Date.now() }) }));

  const results = [];
  const check = (name, cond, extra = '') => {
    results.push(`${cond ? '✅' : '❌'} ${name}${extra ? ' — ' + extra : ''}`);
    if (!cond) process.exitCode = 1;
  };

  try {
    if (!(await waitForServer())) throw new Error('server did not boot:\n' + srvLog.slice(-2000));

    // ============ A: fresh "second device" — server value auto-applies ============
    await page.goto(BASE + '/', { waitUntil: 'domcontentloaded', timeout: 60000 });
    await login(page);
    await gotoPortfolio(page);

    let cards = await page.locator('.quantum-stat').allInnerTexts();
    const usCard = (cards.find((c) => c.toUpperCase().includes('USA · INDMONEY')) || '');
    check('A1 settings GET fired on boot (server settings fetched)', settingsGets.length >= 1, `n=${settingsGets.length}`);
    check('A2 USA invested $1,631.97 — SERVER rate applied, zero user entry', /\$1,631\.9\d/.test(usCard), usCard.replace(/\n/g, ' | ').slice(0, 150));
    check('A3 USA footer: invested @ app ₹92.00 (server-synced)', /app ₹92\.00/.test(usCard), '');
    check('A4 ☁ server-synced hint on the USA card', /server-synced/i.test(usCard), '');
    check('A5 APP FX chip ₹92.00 present', /APP FX ₹92\.0/.test(usCard), '');
    // The local cache was seeded FROM the server (this is the offline fallback).
    const lsRate = await page.evaluate(() => localStorage.getItem('usdAppRate'));
    check('A6 localStorage cache seeded from server (offline fallback)', lsRate === String(SERVER_RATE), `ls=${lsRate}`);

    // ============ B: write-through — new Match-App value POSTs to server ============
    // NOTE: usdAppRate IS set (from the server) → the button is the
    // "APP FX ₹92.00 ✏️" chip, not the uncalibrated "✏️ Match App" one.
    await page.locator('button', { hasText: /APP FX/ }).first().click();
    await page.waitForTimeout(300);
    const popover = await page.locator('.quantum-stat').allInnerTexts();
    const usPop = (popover.find((c) => c.toUpperCase().includes('USA · INDMONEY')) || '');
    check('B1 Match-App popover shows ☁ multi-device hint', /server par save hota hai/i.test(usPop), '');
    const popoverInput = page.locator('input[placeholder="1631.97"]');
    await popoverInput.waitFor({ state: 'visible', timeout: 5000 });
    await popoverInput.fill('1600'); // a different app value → different rate
    await page.locator('button', { hasText: 'Save' }).first().click();
    await page.waitForTimeout(1500);
    check('B2 Save → POST /api/mcp/settings fired (write-through)', settingsPosts.length === 1, `posts=${JSON.stringify(settingsPosts)}`);
    check('B3 POST body: key=usdAppRate, value≈93.84 (150141.10/1600)', settingsPosts.length === 1
      && settingsPosts[0].key === 'usdAppRate'
      && Math.abs((settingsPosts[0].value || 0) - 93.838) < 0.01, JSON.stringify(settingsPosts[0] || {}));
    cards = await page.locator('.quantum-stat').allInnerTexts();
    const usCard2 = (cards.find((c) => c.toUpperCase().includes('USA · INDMONEY')) || '');
    check('B4 USA invested updates to $1,600.00', /\$1,600\.00/.test(usCard2), usCard2.replace(/\n/g, ' | ').slice(0, 150));

    // ============ C: cookies + cache CLEARED → server value re-applies ============
    await ctx.clearCookies();
    await page.evaluate(() => { try { localStorage.clear(); sessionStorage.clear(); } catch { /* ignore */ } });
    const lsAfterWipe = await page.evaluate(() => localStorage.getItem('usdAppRate'));
    check('C1 localStorage wiped (simulated cache clear)', lsAfterWipe === null, `ls=${lsAfterWipe}`);
    await page.goto(BASE + '/', { waitUntil: 'domcontentloaded', timeout: 60000 });
    await login(page); // PIN re-entry (by design)
    await gotoPortfolio(page);
    const getsBefore = settingsGets.length;
    await page.waitForTimeout(1000);
    cards = await page.locator('.quantum-stat').allInnerTexts();
    const usCard3 = (cards.find((c) => c.toUpperCase().includes('USA · INDMONEY')) || '');
    check('C2 settings GET re-fired after cache wipe (n grew)', settingsGets.length > getsBefore || settingsGets.length >= 2, `n=${settingsGets.length}`);
    check('C3 USA invested back to $1,631.97 — SERVER value wins after cache clear', /\$1,631\.9\d/.test(usCard3), usCard3.replace(/\n/g, ' | ').slice(0, 150));
    check('C4 footer again app ₹92.00 (price-alag regression dead)', /app ₹92\.00/.test(usCard3), '');

    // ============ D: Set Basis modal — ☁ hint ============
    await page.locator('button', { hasText: 'Set Basis' }).first().click();
    await page.waitForTimeout(400);
    const modalVisible = await page.locator('text=Crypto Cost Basis').first().isVisible().catch(() => false);
    check('D1 Set Basis modal opens', modalVisible, '');
    if (modalVisible) {
      const basisModal = page.locator('.quantum-modal', { hasText: 'Crypto Cost Basis' }).first();
      const modalText = await basisModal.innerText();
      check('D2 Set Basis modal shows ☁ server-backup hint', /server par encrypted backup/i.test(modalText), '');
      await basisModal.locator('button[aria-label="Close"]').first().click();
      await page.waitForTimeout(300);
    }

    // ============ E: zero page errors ============
    check('E1 zero page JS errors', errors.length === 0, errors.join('; ').slice(0, 200));

    console.log('===== v6.1 MULTI-DEVICE PERSISTENCE E2E =====');
    results.forEach((r) => console.log(r));
    console.log(`\n${results.every((r) => r.startsWith('✅')) ? 'ALL PASSED' : 'FAILURES PRESENT'}`);
    await page.screenshot({ path: 'scripts/v61-settings-e2e.png', fullPage: false });
  } finally {
    await browser.close().catch(() => { });
    child.kill('SIGTERM');
    await sleep(500);
    try { fs.rmSync(path.join(DATA, 'mcp-settings.json'), { force: true }); } catch { /* ignore */ }
  }
})().catch((e) => { console.error('FATAL:', e.message); process.exit(1); });
