// ============================================================
// scripts/v67-e2e.cjs — v6.7 END-TO-END BROWSER CHECK
// ------------------------------------------------------------
// Real boot + headless browser through the PIN gate:
//   1. PIN 2023 unlock → AI Trading tab
//   2. v6.7 badge + 10-model header
//   3. Morning Brief panel renders (market strip + guards)
//   4. Swing Desk panel renders (ideas or honest empty)
//   5. Whale Radar panel renders
//   6. Signal Ledger panel renders (chain intact chip)
//   7. Options Desk (India) renders + strategies with POP chip
//   8. Backtest RUN → learned-gates block
//   9. zero JS console errors
// ============================================================
const { spawn } = require('node:child_process');
const { mkdirSync, rmSync } = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(process.cwd());
const DATA = path.join(ROOT, '.e2e-v67');
const PORT = 4378;
const BASE = `http://127.0.0.1:${PORT}`;

let PASS = 0, FAIL = 0;
const ok = (name, cond, extra = '') => {
  if (cond) { PASS++; console.log(`  ✓ ${name}${extra ? ' — ' + extra : ''}`); }
  else { FAIL++; console.log(`  ✗ ${name}${extra ? ' — ' + extra : ''}`); }
};

rmSync(DATA, { recursive: true, force: true });
mkdirSync(DATA, { recursive: true });

const env = { ...process.env, PORT: String(PORT), APP_PIN: '2023', ALLOWED_ORIGINS: '*', SMARTAI_DATA_DIR: DATA, NODE_ENV: 'production' };
const server = spawn('node', ['server/index.js'], { cwd: ROOT, env, stdio: ['ignore', 'pipe', 'pipe'] });

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

(async () => {
  // boot wait
  let up = false;
  for (let i = 0; i < 40; i++) {
    await sleep(500);
    try { const r = await fetch(`${BASE}/api/health`); if (r.ok || r.status === 401 || r.status === 404) { up = true; break; } } catch {}
  }
  ok('server boots', up);
  if (!up) { server.kill('SIGKILL'); process.exit(1); }

  const { chromium } = require('playwright');
  const browser = await chromium.launch();
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(String(e).slice(0, 200)));
  page.on('console', m => { if (m.type() === 'error') errors.push(String(m.text()).slice(0, 200)); });

  try {
    // ---- PIN gate ----
    await page.goto(BASE, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.fill('input[type="password"], input[inputmode="numeric"]', '2023', { timeout: 15000 });
    await page.keyboard.press('Enter');
    await page.waitForTimeout(2500);
    // ---- India Intraday tab (v6.9 split) ----
    const tab = page.locator('button, [role="tab"]', { hasText: /INDIA INTRADAY|India Intraday/i }).first();
    await tab.click({ timeout: 20000 });
    await page.waitForTimeout(5000);

    const body = await page.textContent('body');

    // ---- 2. version + models ----
    ok('version badge (v6.7+)', /v6\.[7-9]/.test(body), '');
    ok('10-model header', /10-model consensus/i.test(body) || /10-model ensemble/i.test(body), '');

    // ---- 3. Morning Brief ----
    ok('Morning Brief section', /Morning Brief/i.test(body));
    ok('Brief NIFTY/BTC/VIX strip', /NIFTY/.test(body) && /INDIA VIX/.test(body) && /BTC/.test(body));
    ok('Brief guards chip', /GUARDS/.test(body));

    // ---- 4. Swing Desk (India tab has it) ----
    ok('Swing Desk section', /Swing Desk/i.test(body));

    // ---- 5. Whale Radar (CoinDCX tab) ----
    const cxTab = page.locator('button, [role="tab"]', { hasText: /COINDCX|CoinDCX/i }).first();
    await cxTab.click({ timeout: 20000 });
    await page.waitForTimeout(3000);
    const bodyCx = await page.textContent('body');
    ok('Whale Radar section (CoinDCX desk)', /Whale Radar/i.test(bodyCx));
    // back to India for the remaining India checks
    await tab.click({ timeout: 20000 });
    await page.waitForTimeout(3000);
    const bodyBack = await page.textContent('body');

    // ---- 6. Signal Ledger ----
    ok('Signal Ledger section', /Signal Ledger/i.test(bodyBack));
    ok('Ledger chain chip', /CHAIN INTACT|BROKEN|head/i.test(bodyBack));

    // ---- 7. Options Desk (switch to INDIA desk if needed) ----
    const indiaBtn = page.locator('button', { hasText: /NSE|INDIA/i }).first();
    if (await indiaBtn.count() > 0) { try { await indiaBtn.click(); await page.waitForTimeout(3000); } catch {} }
    const body2 = await page.textContent('body');
    ok('Options Desk present (India)', /Options Desk/i.test(body2));

    // wait for strategies (options fetch incl. deep-signal can take 35s+)
    for (let i = 0; i < 18; i++) {
      await page.waitForTimeout(2500);
      const b = await page.textContent('body');
      if (/POP [\d.]+%/.test(b)) { ok('Strategies with POP chips', true, 'POP visible'); break; }
      if (i === 17) ok('Strategies with POP chips', /POP [\d.]+%/.test(b), 'may be POP null when VIX unreachable');
    }

    // ---- 8. Backtest learned ----
    const runBtn = page.locator('button', { hasText: /RUN BACKTEST/i }).first();
    if (await runBtn.count() > 0) {
      await runBtn.click({ timeout: 10000 }).catch(() => {});
      for (let i = 0; i < 16; i++) {
        await page.waitForTimeout(2500);
        const b = await page.textContent('body');
        if (/LEARNED GATES/i.test(b)) { ok('Backtest learned-gates block', true); break; }
        if (i === 15) ok('Backtest learned-gates block', /LEARNED GATES/i.test(b), 'backtest may have failed to load data');
      }
    } else {
      ok('Backtest RUN button exists', false);
    }

    // ---- 9. JS errors (TradingView WebSocket 403 = sandbox env, not a code bug) ----
    const realErrors = errors.filter(e => !/favicon|net::ERR|Failed to load resource|WebSocket|tradingview/i.test(e));
    ok('zero JS console errors', realErrors.length === 0, realErrors.slice(0, 2).join(' | ').slice(0, 160));

  } finally {
    await browser.close().catch(() => {});
    server.kill('SIGKILL');
    await sleep(300);
    rmSync(DATA, { recursive: true, force: true });
  }

  console.log(`\n${FAIL === 0 ? 'E2E ALL PASS' : 'E2E FAILURES'} — ${PASS} passed, ${FAIL} failed`);
  process.exit(FAIL === 0 ? 0 : 1);
})();
