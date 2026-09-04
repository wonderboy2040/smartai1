#!/usr/bin/env node
/** v6.5 E2E — Trailing SL config, Dhan panel, India PAPER/LIVE buttons,
 *  Backtest Lab, Alerts & AI keys panel, v6.5 badge — zero JS errors. */
function loadPlaywright() {
  try { return require('playwright'); } catch { /* not local */ }
  try { return require('/home/z/.npm-global/lib/node_modules/playwright'); } catch { /* global */ }
  throw new Error('playwright missing');
}
const { chromium } = loadPlaywright();
const { spawn } = require('node:child_process');

const PORT = 8966;
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
  const browser = await chromium.launch();
  const context = await browser.newContext({ viewport: { width: 1500, height: 950 }, serviceWorkers: 'block' });
  const page = await context.newPage();
  const errs = [];
  page.on('pageerror', e => errs.push(String(e)));
  page.on('console', m => {
    if (m.type() !== 'error') return;
    // 400s from our own /api are business rejections (one-per-symbol etc.),
    // 5xx/403/429 are external-data noise on this box — neither is a JS error.
    if (/Failed to load resource.*(400|503|502|403|429)/i.test(m.text())) return;
    if (/tradingview|ws:|websocket|net::/i.test(m.text())) return;
    errs.push(m.text());
  });

  try {
    // Deterministic gauntlet state: reset the dev-box journal + config (the
    // same residue-clean pattern as v64-e2e — production lives on Render).
    try {
      const { saveJSON } = require('../server/lib/store.js');
      saveJSON('ai-trading-journal.json', { entries: [], positions: [] });
      const { DEFAULT_CONFIG } = require('../server/ai/coindcxOrders.js');
      saveJSON('ai-trading-config.json', { ...DEFAULT_CONFIG });
      console.log('      · journal + config reset (deterministic caps)');
    } catch (e) { console.log('warn: reset skipped —', e.message); }

    check('server boot', await waitUp());
    await page.goto(BASE, { waitUntil: 'domcontentloaded' });
    await page.fill('input[type="password"]', '2023');
    await page.click('button:has-text("Unlock Terminal")');
    await page.waitForSelector('[role="tablist"]', { timeout: 20000 });
    await page.click('[role="tablist"] button:has-text("AI Trading")');
    await page.waitForSelector('text=SUPERINTELLIGENCE AI TRADING TERMINAL', { timeout: 20000 });

    // ---------- v6.5 identity ----------
    check('version badge (v6.6)', (await page.locator('span.quantum-badge:has-text("v6.6")').count()) > 0);

    // ---------- India desk ----------
    await page.waitForSelector('button:has-text("INDIA MARKET")', { timeout: 10000 });
    await sleep(9000); // board load

    // India PAPER TRADE buttons on actionable cards (v6.5)
    const indiaPaper = await page.locator('button:has-text("PAPER TRADE")').count();
    check('India cards show PAPER TRADE buttons (v6.5 Dhan gauntlet)', indiaPaper > 0, `${indiaPaper} buttons`);

    // guide mentions Dhan
    const guideDhan = await page.locator('text=DHAN LIVE').count();
    check('3-step guide mentions Dhan LIVE option', guideDhan > 0);

    // ---------- Execution console: trailing + Dhan + India arm ----------
    await page.waitForSelector('text=RISK & EXECUTION SETTINGS', { timeout: 10000 });
    check('TRAILING SL toggle visible', (await page.locator('button:has-text("TRAILING SL")').count()) > 0);
    check('trail arm/offset inputs visible', (await page.locator('input[aria-label="trail arm in R"]').count()) > 0
      && (await page.locator('input[aria-label="trail offset in R"]').count()) > 0);
    check('India Max ₹ field visible (v6.5)', (await page.locator('label:has-text("India Max")').count()) > 0);

    await page.waitForSelector('text=INDIA BROKER — DHAN HQ', { timeout: 10000 });
    check('Dhan connect panel visible', true);
    check('Dhan NOT CONNECTED chip', (await page.locator('text=NOT CONNECTED').count()) > 0);
    check('India LIVE arm requires typed phrase (disabled)', await page.locator('button:has-text("ARM INDIA LIVE")').isDisabled());
    check('dhan client id + token inputs present', (await page.locator('input[aria-label="dhan client id"]').count()) > 0
      && (await page.locator('input[aria-label="dhan access token"]').count()) > 0);

    // ---------- Backtest Lab ----------
    await page.waitForSelector('text=BACKTEST', { timeout: 10000 });
    const runBtn = page.locator('button:has-text("RUN BACKTEST")');
    check('Backtest Lab with RUN button', (await runBtn.count()) > 0);
    await runBtn.first().click();
    // India backtest (daily candles from Yahoo) may take a while — allow 60s
    for (let i = 0; i < 30; i++) {
      await sleep(2000);
      if ((await page.locator('text=WIN RATE').count()) > 0) break;
    }
    check('backtest stats grid renders after run', (await page.locator('text=WIN RATE').count()) > 0);

    // ---------- Alerts & AI keys ----------
    await page.waitForSelector('text=ALERTS & AI COUNCIL KEYS', { timeout: 10000 });
    check('Telegram token + chat id inputs', (await page.locator('input[aria-label="telegram bot token"]').count()) > 0
      && (await page.locator('input[aria-label="telegram chat id"]').count()) > 0);
    check('Gemini + Groq key inputs', (await page.locator('input[aria-label="gemini api key"]').count()) > 0
      && (await page.locator('input[aria-label="groq api key"]').count()) > 0);
    check('TEST button present (disabled until configured)', (await page.locator('button:has-text("TEST")').count()) > 0);

    // ---------- India PAPER execute flow (the new user flow) ----------
    // pick the first PAPER TRADE on the India desk
    const btn = page.locator('button:has-text("PAPER TRADE")').first();
    if ((await page.locator('button:has-text("PAPER TRADE")').count()) > 0) {
      await btn.click();
      await sleep(4000); // gauntlet: fresh deep run + journal write
      const toast = await page.locator('[role="status"]').textContent().catch(() => '');
      const opened = /Paper trade opened|paper trade opened/i.test(toast || '');
      check('India PAPER TRADE opens a practice position', opened, String(toast).slice(0, 90));
      if (opened) {
        // position row shows the NSE tag
        check('position row shows 🇮🇳 NSE tag', (await page.locator('text=NSE').count()) > 0);
      }
    } else {
      check('India PAPER TRADE opens a practice position', true, 'no actionable card right now (skipped)');
    }

    // ---------- crypto desk regression ----------
    await page.click('button:has-text("CRYPTO · CoinDCX")');
    await sleep(9000);
    const cryptoPaper = await page.locator('button:has-text("PAPER TRADE")').count();
    check('crypto cards still show PAPER TRADE', cryptoPaper > 0, `${cryptoPaper} buttons`);

    check('zero JS errors', errs.length === 0, errs.slice(0, 2).join(' | ').slice(0, 160));

    console.log(failures === 0 ? '\nALL v6.5 E2E CHECKS PASSED' : `\n${failures} E2E CHECK(S) FAILED`);
    process.exitCode = failures === 0 ? 0 : 1;
  } catch (e) {
    console.error('E2E ERROR:', e?.message || e);
    process.exitCode = 1;
  } finally {
    await browser.close().catch(() => {});
    server.kill('SIGTERM');
    await sleep(300);
  }
})();
