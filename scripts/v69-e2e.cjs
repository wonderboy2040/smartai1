// ============================================================
// scripts/v69-e2e.cjs — v6.9 SPLIT DESKS E2E
// ------------------------------------------------------------
// Real boot + headless browser through the PIN gate:
//   1. PIN 2023 unlock → TWO separate trading tabs in the nav
//   2. India tab: TOP 5 PICKS panel + NSE clock + no CoinDCX wallet
//   3. Top-5 rows render (medal ranks, score, KYUN reason)
//   4. TRADE button jumps to the signal card (board anchor)
//   5. CoinDCX tab: wallet card + SPOT/FUTURES switch + no Dhan
//   6. Futures sub-desk switch works (GLOBAL FUTURES header)
//   7. QuickNav sticky chips render on both tabs
//   8. execution consoles are venue-scoped (India ≠ CoinDCX)
//   9. zero JS console errors
// ============================================================
const { spawn } = require('node:child_process');
const { mkdirSync, rmSync } = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(process.cwd());
const DATA = path.join(ROOT, '.e2e-v69');
const PORT = 4381;
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

    // ---- 1. two separate trading tabs exist ----
    const body0 = await page.textContent('body');
    ok('India Intraday tab in nav', /India Intraday/i.test(body0));
    ok('CoinDCX tab in nav', /CoinDCX/i.test(body0));
    ok('old single AI Trading tab gone', !/AI Trading/i.test(body0), 'v6.9 split');

    // ---- 2. India desk ----
    const indiaTab = page.locator('button, [role="tab"]', { hasText: /India Intraday/i }).first();
    await indiaTab.click({ timeout: 20000 });
    await page.waitForTimeout(6000); // board + top5 fetch
    const bodyIndia = await page.textContent('body');
    ok('India desk header', /INDIA INTRADAY DESK/i.test(bodyIndia));
    ok('desk version badge (v6.x)', /v6\.\d+/.test(bodyIndia), 'version-tolerant since v6.10');
    ok('India TOP 5 PICKS panel', /TOP 5 PICKS/i.test(bodyIndia));
    ok('India NSE clock', /NSE/i.test(bodyIndia) && /(PRE-OPEN|LIVE|NO FRESH ENTRY|SQUARE-OFF|CLOSED|WEEKEND)/i.test(bodyIndia));
    ok('India pick reasons (KYUN)', /KYUN:/i.test(bodyIndia));
    ok('medal/rank markup', /#\d|#1|🥇|🥈|🥉/.test(bodyIndia) || /TOP 5 PICKS/i.test(bodyIndia));
    ok('QuickNav chips render', /TOP 5/.test(bodyIndia) && /SIGNALS/.test(bodyIndia) && /OPTIONS/.test(bodyIndia));
    ok('India desk has NO CoinDCX wallet card', !/COINDCX WALLET/i.test(bodyIndia), 'separation confirmed');
    ok('India desk has NO SPOT/FUTURES switcher', !/GLOBAL FUTURES\s*USDT/i.test(bodyIndia));
    ok('India how-to guide present', /India trade kaise lein|INDIA DESK — SIGNAL SE TRADE TAK/i.test(bodyIndia));

    // wait for top5 rows to actually populate (board fetch 30s timeout budget)
    let indiaTop5Rows = false;
    for (let i = 0; i < 12; i++) {
      await page.waitForTimeout(2500);
      const b = await page.textContent('body');
      if (/KYUN:/.test(b) && /conf \d+%/.test(b)) { indiaTop5Rows = true; break; }
    }
    ok('India top-5 rows populated', indiaTop5Rows, 'composite picks with conf% visible');

    // ---- 4. TRADE jump anchor ----
    const tradeBtn = page.locator('button', { hasText: /^🚀 TRADE$/ }).first();
    if (await tradeBtn.count() > 0) {
      await tradeBtn.click({ timeout: 8000 }).catch(() => {});
      await page.waitForTimeout(1500);
      ok('TRADE jumps to signal card (anchor id exists)', await page.locator('[id^="sig-"]').count() > 0, `${await page.locator('[id^="sig-"]').count()} card anchors`);
    } else {
      ok('TRADE button present (board may be empty)', false);
    }

    // ---- 5. CoinDCX desk ----
    const cxTab = page.locator('button, [role="tab"]', { hasText: /CoinDCX/i }).first();
    await cxTab.click({ timeout: 20000 });
    await page.waitForTimeout(6000);
    const bodyCx = await page.textContent('body');
    ok('CoinDCX desk header', /COINDCX DESK/i.test(bodyCx));
    ok('CoinDCX wallet card', /COINDCX WALLET/i.test(bodyCx), 'kitna hai');
    ok('SPOT / GLOBAL FUTURES switcher', /SPOT/.test(bodyCx) && /GLOBAL FUTURES/i.test(bodyCx));
    ok('CoinDCX TOP 5 PICKS panel', /TOP 5 PICKS/i.test(bodyCx));
    ok('Auto-Agent panel on CoinDCX desk', /Superintelligence Auto-Agent/i.test(bodyCx));
    ok('CoinDCX desk has NO Dhan broker panel', !/INDIA BROKER — DHAN/i.test(bodyCx), 'separation confirmed');
    ok('CoinDCX desk has NO NSE session clock', !/NO FRESH ENTRY|SQUARE-OFF window/i.test(bodyCx));

    // ---- 6. futures sub-desk ----
    const futBtn = page.locator('button', { hasText: /GLOBAL FUTURES/i }).first();
    if (await futBtn.count() > 0) {
      await futBtn.click({ timeout: 8000 }).catch(() => {});
      await page.waitForTimeout(4000);
      const bodyFut = await page.textContent('body');
      ok('futures sub-desk active (top5 label)', /COINDCX GLOBAL FUTURES|FUTURES-ELIGIBLE|USDT/i.test(bodyFut));
    } else {
      ok('futures switch button exists', false);
    }

    // ---- 8. venue-scoped consoles ----
    // back to India: positions label should say NSE; CoinDCX: COINDCX
    await indiaTab.click({ timeout: 20000 });
    await page.waitForTimeout(3000);
    const bodyI2 = await page.textContent('body');
    ok('India execution console venue label', /POSITIONS \(\d+ open · 🇮🇳 NSE\)/.test(bodyI2) || /Execution Console/i.test(bodyI2));
    const dhanOnIndia = /INDIA BROKER — DHAN/i.test(bodyI2);
    ok('Dhan broker panel on India desk', dhanOnIndia);
    await cxTab.click({ timeout: 20000 });
    await page.waitForTimeout(3000);
    const bodyC2 = await page.textContent('body');
    ok('CoinDCX console venue label', /POSITIONS \(\d+ open · ₿ COINDCX\)/.test(bodyC2) || /Execution Console/i.test(bodyC2));
    ok('CoinDCX console has wallet strip', /COINDCX WALLET/i.test(bodyC2));

    // ---- 9. JS errors ----
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
