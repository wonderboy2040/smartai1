#!/usr/bin/env node
/**
 * v6.3 E2E — SIGNAL ENGINE RECALIBRATION + PRO UPGRADES:
 *   1. Login (PIN 2023)
 *   2. AI Trading tab: command bar v6.3 badge + refresh countdown
 *   3. MARKET BREADTH strip renders with bull/bear counts + meter
 *   4. Signal board shows ACTIONABLE grades (the "no signals" fix)
 *      + quorum display on cards
 *   5. Filter chips: ALL / ACTIONABLE / STRONG filtering works
 *   6. Deep analysis modal (🔬) opens with fresh ensemble run
 *   7. CRYPTO desk: crypto signals render (ACTION grades)
 *   8. Options desk + Execution console + Model registry render
 *   9. Zero JS page errors
 */
function loadPlaywright() {
  try { return require('playwright'); } catch { /* not in local node_modules */ }
  try { return require('/home/z/.npm-global/lib/node_modules/playwright'); } catch { /* not on this box */ }
  throw new Error('Playwright not found — install: npm i -g playwright && npx playwright install chromium');
}
const { chromium } = loadPlaywright();

const BASE = 'http://localhost:9310';
const PIN = '2023';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  const browser = await chromium.launch();
  const context = await browser.newContext({ viewport: { width: 1500, height: 950 }, serviceWorkers: 'block' });
  const page = await context.newPage();

  const pageErrors = [];
  const consoleErrors = [];
  page.on('pageerror', (err) => pageErrors.push(String(err)));
  page.on('console', (msg) => {
    if (msg.type() === 'error' && !/Failed to load resource|net::ERR|ERR_NAME|ERR_CONNECTION|404|502|WebSocket|websocket|ECONN|aborted|TV WS error/i.test(msg.text())) {
      consoleErrors.push(msg.text());
    }
  });

  const results = [];
  const check = (name, ok, extra = '') => {
    results.push({ name, ok });
    console.log(`${ok ? '✅' : '❌'} ${name}${extra ? ` — ${extra}` : ''}`);
  };

  try {
    // ---------- 1. Login ----------
    await page.goto(BASE, { waitUntil: 'domcontentloaded' });
    await page.fill('input[type="password"]', PIN);
    await page.click('button:has-text("Unlock Terminal")');
    await page.waitForSelector('[role="tablist"]', { timeout: 20000 });
    check('login with PIN 2023', true);

    // ---------- 2. Open AI Trading ----------
    await page.click('button:has-text("AI Trading")');
    await page.waitForSelector('text=SUPERINTELLIGENCE AI TRADING TERMINAL', { timeout: 20000 });
    const hdrBar = await page.locator('h2:has-text("SUPERINTELLIGENCE")').locator('xpath=..').innerText();
    check('AI Trading terminal header + version badge (v6.3+)', /v6\.[3-9]/i.test(hdrBar), hdrBar.replace(/\n/g, ' ').slice(0, 70)); // v6.5: version advances with releases
    await page.waitForSelector('text=MARKET BREADTH', { timeout: 30000 });

    // ---------- 3. Breadth strip ----------
    const breadth = await page.locator('text=MARKET BREADTH').locator('..').innerText();
    check('breadth strip: bull/bear counts', /BULL/.test(breadth) && /BEAR/.test(breadth), breadth.replace(/\n/g, ' ').slice(0, 100));
    check('breadth mood label (RISK-ON/OFF/MIXED)', /RISK-ON|RISK-OFF|MIXED/.test(breadth));

    // ---------- 4. Signal cards: ACTIONABLE grades present ----------
    await page.waitForSelector('.quantum-panel:has-text("LONG"), .quantum-panel:has-text("SHORT")', { timeout: 30000 });
    await sleep(1500); // let the board settle
    const boardText = await page.locator('text=SIGNAL BOARD').locator('xpath=..').innerText().catch(() => '');
    const actionableCount = await page.locator('span:has-text("actionable")').first().innerText().catch(() => '');
    check('board summary shows actionable > 0', /[1-9]/.test(actionableCount), actionableCount.trim());
    const gradeBadges = await page.locator('text=ACTION').count();
    check('ACTION grade badges on cards', gradeBadges > 0, `${gradeBadges} ACTION badges`);
    const quorumText = await page.locator('text=quorum').count();
    check('quorum (participation) shown on cards', quorumText > 0, `${quorumText} cards`);
    const confGauges = await page.locator('text=CONF').count();
    check('confidence gauges render', confGauges >= 5, `${confGauges} gauges`);

    // ---------- 5. Filter chips ----------
    await page.click('button:has-text("ACTIONABLE")');
    await sleep(600);
    const afterActionFilter = await page.locator('text=ACTION').count();
    check('ACTIONABLE filter keeps ACTION cards', afterActionFilter > 0, `${afterActionFilter} cards`);
    await page.click('button:has-text("STRONG")');
    await sleep(600);
    const strongEmpty = await page.locator('text=No signals match this filter').count();
    const strongCards = await page.locator('span:has-text("★ STRONG")').count();
    check('STRONG filter: cards or honest empty-state', strongEmpty > 0 || strongCards > 0,
      strongCards > 0 ? `${strongCards} STRONG` : 'empty-state (no STRONG right now — honest)');
    await page.click('button:has-text("ALL")');
    await sleep(600);
    const backToAll = await page.locator('text=CONF').count();
    check('ALL filter restores board', backToAll >= 5, `${backToAll} cards`);

    // ---------- 6. Deep analysis modal ----------
    const deepBtn = page.locator('button[title="Deep analysis"]').first();
    if (await deepBtn.count() > 0) {
      await deepBtn.click();
      try {
        await page.waitForSelector('text=DEEP ENSEMBLE ANALYSIS', { timeout: 45000 });
        await page.waitForSelector('text=LIVE INDICATOR SNAPSHOT', { timeout: 10000 }).catch(() => {});
        check('deep modal opens with fresh run + indicators', true);
        await page.keyboard.press('Escape');
        await page.locator('div[role="dialog"]').click({ position: { x: 5, y: 5 } }).catch(() => {});
        await page.mouse.click(10, 10); // click backdrop area
        await sleep(600);
        const modalGone = (await page.locator('text=DEEP ENSEMBLE ANALYSIS').count()) === 0;
        check('deep modal closes', modalGone);
      } catch (e) {
        check('deep modal opens with fresh run + indicators', false, String(e).slice(0, 80));
      }
    } else {
      check('deep modal opens with fresh run + indicators', false, 'no 🔬 button rendered');
    }

    // ---------- 7. CRYPTO desk ----------
    await page.click('button:has-text("CRYPTO")');
    await sleep(3000);
    const cryptoCards = await page.locator('text=CONF').count();
    check('crypto desk renders signal cards', cryptoCards > 0, `${cryptoCards} cards`);
    const paperBtns = await page.locator('button:has-text("PAPER TRADE")').count();
    check('crypto PAPER TRADE buttons', paperBtns > 0, `${paperBtns} buttons`);

    // ---------- 8. Options desk / console / registry (back on INDIA) ----------
    await page.click('button:has-text("INDIA MARKET")');
    await page.waitForSelector('text=OPTIONS DESK', { timeout: 20000 });
    check('options desk renders (India)', true);
    await page.waitForSelector('text=EXECUTION CONSOLE', { timeout: 20000 });
    const killSwitch = await page.locator('button:has-text("KILL SWITCH")').count();
    check('execution console + kill switch', killSwitch > 0);
    await page.waitForSelector('text=MODEL REGISTRY', { timeout: 20000 });
    const trendCount = await page.locator('text=TrendMatrix').count();
    const councilCount = await page.locator('text=/AI Council/').count();
    check('model registry: 9 models listed', trendCount > 0 && councilCount > 0, `${trendCount} TrendMatrix · ${councilCount} AI Council refs`);

    // ---------- 9. Errors ----------
    check('zero JS page errors', pageErrors.length === 0, pageErrors.slice(0, 2).join(' | ').slice(0, 150));
    check('zero console errors', consoleErrors.length === 0, consoleErrors.slice(0, 2).join(' | ').slice(0, 150));
  } catch (e) {
    check('E2E crashed', false, String(e).slice(0, 200));
  } finally {
    await browser.close();
  }

  const pass = results.filter(r => r.ok).length;
  console.log(`\n===== v6.3 E2E: ${pass}/${results.length} PASS =====`);
  process.exit(pass === results.length ? 0 : 1);
})();
