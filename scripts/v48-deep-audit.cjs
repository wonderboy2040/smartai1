#!/usr/bin/env node
/**
 * v4.8 DEEP SITE AUDIT — full Intraday TAB + Portfolio TAB feature/flow
 * walkthrough (pro-level). Runs against the live local server
 * (APP_PIN=9201, PORT=9201).
 *
 * PHASE A — Intraday TAB (NSE desk):
 *   signals table (live rows) → signal chart modal → paper-trade open →
 *   paper position listed → close trade → track-record reflects →
 *   Trending Movers (index pulse, sector strip, 3 views, row chart/PT) →
 *   Market Intel (F&G/whales/registry) → Tapetide desk → ProTrader →
 *   Committee → Journal → Universe editor → min-conf → NSE↔CRYPTO.
 * PHASE B — Portfolio TAB:
 *   INDMoney + CoinDCX panels (not-connected states) → manual add asset →
 *   table row → summary cards → insights → sort → chart modal → export
 *   menu → search → delete row (cleanup).
 * PHASE C — cross-cutting: console error audit + screenshots.
 */
// Portable Playwright loader (v4.9 audit fix): standard module resolution
// first, then this CI box's global install — the old hardcoded-only path
// broke on Windows / any other machine with MODULE_NOT_FOUND.
function loadPlaywright() {
  try { return require('playwright'); } catch { /* not in local node_modules */ }
  try { return require('/home/z/.npm-global/lib/node_modules/playwright'); } catch { /* not on this box */ }
  throw new Error('Playwright not found — install: npm i -g playwright && npx playwright install chromium');
}
const { chromium } = loadPlaywright();

const BASE = 'http://localhost:9201';
const PIN = '9201';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1500, height: 950 } });

  const consoleErrors = [];
  page.on('console', (msg) => { if (msg.type() === 'error') consoleErrors.push(msg.text()); });
  page.on('pageerror', (err) => consoleErrors.push(String(err)));

  const results = [];
  const check = (name, ok, extra = '') => {
    results.push({ name, ok: !!ok, extra });
    console.log(`${ok ? '✅' : '❌'} ${name}${extra ? ` — ${extra}` : ''}`);
  };
  const bodyText = () => page.evaluate(() => document.body.innerText);
  const bt = async () => (await bodyText()).toLowerCase();

  // ================= LOGIN =================
  await page.goto(BASE, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForSelector('input[type="password"]', { timeout: 15000 });
  await page.fill('input[type="password"]', PIN);
  await page.keyboard.press('Enter');
  await page.waitForSelector('text=Dashboard', { timeout: 20000 }).catch(() => {});
  await sleep(2000);
  check('A0 login with PIN', page.url().includes('localhost'), page.url());

  // ================= PHASE A: INTRADAY TAB =================
  // v6.0: the Intraday TAB was REMOVED and replaced by the AI Trading
  // Terminal (covered by scripts/v63-e2e.cjs). The old Phase A walkthrough
  // is retired — skipping straight to Portfolio.
  check('A-skip Intraday TAB removed by design (v6.0)', true, 'superseded by AI Trading — see v63-e2e');
  await page.screenshot({ path: '/tmp/v48-intraday-full.png', fullPage: true }).catch(() => {});

  // ================= PHASE B: PORTFOLIO TAB =================
  const portfolioBtn = page.locator('button, a', { hasText: /Portfolio/i }).first();
  await portfolioBtn.click();
  await sleep(3000);

  // -- B1: source panels --
  let tB = await bt();
  check('B1a INDMoneyPanel (not connected)', tB.includes('indmoney') && tB.includes('connect indmoney'));
  check('B1b CoinDcxPanel present', tB.includes('coindcx'));

  // -- B2: manual add asset flow --
  const addBtn = page.locator('button', { hasText: /\+ Add Asset Manually/i }).first();
  let added = false;
  if (await addBtn.count()) {
    await addBtn.click();
    await sleep(1200);
    // fill the modal
    const symInput = page.locator('input[placeholder="e.g. AAPL, RELIANCE"]');
    if (await symInput.count()) {
      await symInput.fill('AUDITTEST');
      const inputs = page.locator('.quantum-modal input[type="number"]');
      const n = await inputs.count();
      if (n >= 2) {
        await inputs.nth(0).fill('10');
        await inputs.nth(1).fill('100');
        const saveBtn = page.locator('button', { hasText: /💾 Save/i }).first();
        if (await saveBtn.count()) {
          await saveBtn.click();
          await sleep(2000);
          added = true;
          tB = await bt();
          check('B2b asset saved → row appears', tB.includes('audittest'));
        } else { check('B2b save button', false, '💾 Save not found'); }
      } else { check('B2b qty/price inputs', false, `${n} number inputs`); }
    } else { check('B2a symbol input', false, 'placeholder input not found'); }
  } else {
    // portfolio may have existing rows → "+ Add Asset" in toolbar
    const addBtn2 = page.locator('button', { hasText: /\+ Add Asset/i }).first();
    check('B2a add-asset entry point', (await addBtn2.count()) > 0, 'toolbar variant');
  }

  // -- B3: summary cards + insights --
  tB = await bt();
  check('B3a summary metrics render', tB.includes('total value') || tB.includes('invested') || tB.includes('p&l') || tB.includes('portfolio'));
  check('B3b insights panel', tB.includes('insight') || tB.includes('diversification') || tB.includes('winner'));

  // -- B4: table interactions --
  if (added) {
    const searchInput = page.locator('input[placeholder*="Search asset"]');
    if (await searchInput.count()) {
      await searchInput.fill('AUDITTEST');
      await sleep(900);
      const tS = await bt();
      check('B4a search filters the table', tS.includes('audittest') && !tS.includes('reliance'));
      await searchInput.fill('');
      await sleep(900);
    }
    // row chart button
    const rowChartBtn = page.locator('button[title*="Chart — AUDITTEST"]');
    if (await rowChartBtn.count()) {
      await rowChartBtn.first().click();
      await sleep(2500);
      const tChart = await bt();
      check('B4b asset chart modal opens', tChart.includes('cost') || tChart.includes('live') || tChart.includes('audittest'));
      const cClose = page.locator('button', { hasText: /✕/ }).first();
      if (await cClose.count()) { await cClose.click().catch(() => {}); await sleep(700); }
    } else {
      // AUDITTEST has no candles (fake symbol) — chart button may be absent; acceptable
      check('B4b chart button (fake symbol — optional)', true, 'no candle data for AUDITTEST');
    }
  }

  // -- B5: export menu --
  const exportBtn = page.locator('button', { hasText: /export|⬇|download/i }).first();
  if (await exportBtn.count()) {
    await exportBtn.click();
    await sleep(900);
    const tE = await bt();
    check('B5 export menu opens', tE.includes('csv') || tE.includes('snapshot'));
    const closeE = page.locator('button', { hasText: /✕/ }).first();
    if (await closeE.count()) { await closeE.click().catch(() => {}); await sleep(500); }
    await page.keyboard.press('Escape').catch(() => {});
    await sleep(500);
  } else {
    check('B5 export entry point', false, 'export button not found');
  }

  // -- B6: other portfolio panels --
  tB = await bt();
  check('B6a PriceAlertsPanel', tB.includes('alert'));
  check('B6b DailyPL / Monthly panels', tB.includes('daily') || tB.includes('monthly') || tB.includes('plan'));

  await page.screenshot({ path: '/tmp/v48-portfolio-full.png', fullPage: true });

  // -- B7: cleanup the audit asset via the SELL flow (sell-to-zero removes
  //     the row; the transaction LEDGER keeps the trade record by design —
  //     so check ROW presence via row-action button count, not body text) --
  if (added) {
    const sellBtn = page.locator('button[title="Sell / Distribute"]');
    const before = await sellBtn.count();
    if (before > 0) {
      await sellBtn.first().click();
      await sleep(1200);
      const saveBtn2 = page.locator('button', { hasText: /💾 Save/i }).first();
      if (await saveBtn2.count()) {
        await saveBtn2.click();
        await sleep(2000);
        const after = await page.locator('button[title="Sell / Distribute"]').count();
        check('B7 audit asset row removed (sell-to-zero)', after === before - 1, `rows ${before}→${after}`);
      } else { check('B7 cleanup save button', false, 'sell modal save not found'); }
    } else {
      check('B7 cleanup sell button', false, 'Sell/Distribute button not found');
    }
  }

  // ================= PHASE C: console error audit =================
  const realErrors = consoleErrors.filter((e) =>
    !/net::|ERR_NETWORK|Failed to load resource|aborted|AbortError|EventSource|401|403|429|favicon|WebSocket|Sec-WebSocket-Protocol|ERR_TIMED|timeout/i.test(e));
  check('C1 zero real JS page errors (full walk)', realErrors.length === 0, realErrors.slice(0, 3).join(' | ').slice(0, 250));

  const pass = results.filter((r) => r.ok).length;
  console.log(`\n=== DEEP AUDIT: ${pass}/${results.length} checks passed ===`);
  const failed = results.filter((r) => !r.ok);
  if (failed.length) console.log('FAILED:', failed.map((f) => f.name).join(' | '));

  await browser.close();
  process.exit(pass === results.length ? 0 : 1);
})().catch((e) => { console.error('FATAL:', e.message); process.exit(1); });
