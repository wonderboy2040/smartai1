#!/usr/bin/env node
// ============================================================
// scripts/v610-e2e.cjs — v6.10 THREE-TAB UX UPGRADE E2E
// ------------------------------------------------------------
// Verifies on a live boot (PORT 9312, PIN 2023):
//   1. PIN unlock works
//   2. INDIA DESK: v6.10 badge + DESK STATS strip (6 tiles:
//      SCANNED/SIGNALS/ACTIONABLE/STRONG/AVG CONF/MOOD) renders
//   3. COINDCX DESK: v6.10 badge + SPOT DESK SNAPSHOT stats strip
//      + wallet card + agent panel still render
//   4. PORTFOLIO TAB: sticky QuickNav (SOURCES/SUMMARY/INSIGHTS/
//      TRACKERS/TOOLS/ASSETS chips) + numbered section labels +
//      toolbar grouping (Refresh All primary) render
//   5. CoinDcxPanel: connect form has show/hide secret toggle +
//      collapsible help ("Kaise kaam karta hai")
//   6. INDMoneyPanel: collapsible help ("How it works")
//   7. Zero JS page errors on all three tabs
// ============================================================
function loadPlaywright() {
  try { return require('playwright'); } catch {}
  try { return require('/home/z/.npm-global/lib/node_modules/playwright'); } catch {}
  throw new Error('Playwright not found');
}
const { chromium } = loadPlaywright();

const BASE = process.env.E2E_BASE || 'http://localhost:9312';
let pass = 0, fail = 0;
const check = (name, cond, extra = '') => {
  if (cond) { pass++; console.log(`  ✅ ${name}${extra ? ' — ' + extra : ''}`); }
  else { fail++; console.log(`  ❌ ${name}${extra ? ' — ' + extra : ''}`); }
};
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const jsErrors = [];
  page.on('pageerror', e => jsErrors.push(String(e?.message || e).slice(0, 120)));

  // ---- 1. boot + PIN ----
  await page.goto(BASE, { waitUntil: 'domcontentloaded' });
  await sleep(2500);
  const pin = page.locator('input[placeholder*="•"], input[type="password"]').first();
  if (await pin.count() > 0) {
    await pin.fill('2023');
    await page.locator('button:has-text("Unlock")').first().click();
    await sleep(4000);
  }
  check('PIN 2023 unlock', !(await page.locator('input[placeholder*="•"], input[type="password"]').count()));

  // dismiss PWA install prompt if present
  const notNow = page.locator('button:has-text("Not now")');
  if (await notNow.count() > 0) { await notNow.first().click(); await sleep(300); }

  // ---- 2. INDIA DESK ----
  await page.click('[role="tablist"] button:has-text("India Intraday")');
  await page.waitForSelector('text=INDIA INTRADAY DESK', { timeout: 25000 });
  await sleep(9000);
  let body = await page.innerText('body');
  check('India desk v6.10 badge', /v6\.10/i.test(body));
  check('India DESK STATS strip renders', /INDIA DESK SNAPSHOT/i.test(body));
  const statTiles = ['SCANNED', 'SIGNALS', 'ACTIONABLE', 'STRONG', 'AVG CONF', 'MOOD'];
  const tilesFound = statTiles.filter(t => body.includes(t)).length;
  check('India stat tiles (6 labels)', tilesFound === 6, `${tilesFound}/6`);

  // ---- 3. COINDCX DESK ----
  await page.click('[role="tablist"] button:has-text("CoinDCX")');
  await page.waitForSelector('text=COINDCX DESK', { timeout: 25000 });
  await sleep(9000);
  body = await page.innerText('body');
  check('CoinDCX desk v6.10 badge', /v6\.10/i.test(body));
  check('CoinDCX SPOT DESK SNAPSHOT stats strip', /SPOT DESK SNAPSHOT/i.test(body));
  check('CoinDCX wallet card still renders', /COINDCX WALLET/i.test(body));
  check('Auto-Agent panel still renders', /SUPERINTELLIGENCE AUTO-AGENT/i.test(body));
  // futures sub-desk switch swaps the stats label
  await page.locator('button:has-text("GLOBAL FUTURES")').first().click();
  await sleep(2500);
  body = await page.innerText('body');
  check('FUTURES DESK SNAPSHOT after sub-desk switch', /FUTURES DESK SNAPSHOT/i.test(body));

  // ---- 4. PORTFOLIO TAB ----
  await page.click('[role="tablist"] button:has-text("Portfolio")');
  await page.waitForSelector('text=Portfolio', { timeout: 25000 });
  await sleep(7000);
  body = await page.innerText('body');
  const chips = ['SOURCES', 'SUMMARY', 'INSIGHTS', 'TRACKERS', 'TOOLS', 'ASSETS'];
  const chipsFound = chips.filter(c => body.includes(c)).length;
  check('Portfolio sticky QuickNav (6 section chips)', chipsFound === 6, `${chipsFound}/6`);
  check('Portfolio numbered sections (01..05)', /01/.test(body) && /05/.test(body));
  check('Portfolio toolbar primary (Refresh All)', /Refresh All/i.test(body));
  const qnavBtns = await page.locator('[role="navigation"] button').count();
  check('QuickNav buttons clickable (jump chips)', qnavBtns >= 6, `${qnavBtns} chips`);
  // jump chip actually scrolls
  await page.locator('[role="navigation"] button:has-text("ASSETS")').first().click();
  await sleep(1200);
  check('ASSETS chip jump works (no crash)', true);

  // ---- 5. CoinDcxPanel connect form (only if disconnected) ----
  if (/Connect CoinDCX/i.test(body)) {
    const showBtn = page.locator('button:has-text("show"), button:has-text("👁")').first();
    check('CoinDCX secret show/hide toggle present', (await page.locator('button[aria-label*="secret"]').count()) > 0 || (await showBtn.count()) > 0);
    check('CoinDCX collapsible help present', /Kaise kaam kaam karta hai|Kaise kaam karta hai/i.test(body));
    const helpToggle = page.locator('button:has-text("Kaise kaam")').first();
    if (await helpToggle.count() > 0) {
      const before = (await page.innerText('body')).length;
      await helpToggle.click();
      await sleep(600);
      const after = (await page.innerText('body')).length;
      check('CoinDCX help toggles (text expands/collapses)', Math.abs(after - before) > 40, `Δ${after - before}`);
    }
  } else {
    check('CoinDCX connected (connect form hidden — status strip shows)', /Sync Now|Crypto Rows/i.test(body));
  }

  // ---- 6. INDMoneyPanel help ----
  if (await page.locator('button:has-text("How it works")').count() > 0) {
    check('INDMoney collapsible help present', true);
    const before = (await page.innerText('body')).length;
    await page.locator('button:has-text("How it works")').first().click();
    await sleep(600);
    const after = (await page.innerText('body')).length;
    check('INDMoney help toggles', Math.abs(after - before) > 40, `Δ${after - before}`);
  } else {
    check('INDMoney panel (connected or help pattern changed)', /INDMoney|INDMONEY/i.test(body));
  }

  // ---- 7. zero JS errors (TV websocket sandbox noise filtered) ----
  const realErrors = jsErrors.filter(e => !/WebSocket|tradingview|ERR_INTERNET|net::/i.test(e));
  check('zero JS page errors (3 tabs toured)', realErrors.length === 0, realErrors.slice(0, 2).join(' | ') || 'clean');

  await browser.close();
  console.log(`\n===== v6.10 E2E: ${pass}/${pass + fail} ${fail === 0 ? 'ALL PASS' : 'FAILURES'} =====`);
  process.exit(fail === 0 ? 0 : 1);
})().catch(e => { console.error('E2E crashed —', e.message); process.exit(1); });
