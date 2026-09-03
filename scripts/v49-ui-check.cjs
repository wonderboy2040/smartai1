#!/usr/bin/env node
/**
 * v4.9 UI CHECK — Intraday TAB "India Market & Crypto desk" rework:
 *   • MarketDeskSwitcher (prominent INDIA MARKET / CRYPTO MARKET segments
 *     with venue, hours, feeds + live/closed status)
 *   • DeskInfoStrip (market-aware quick-facts chips)
 *   • Sectioned hierarchy 01 Signal Desk → 02 Market Pulse →
 *     03 India Research Desk (NSE only) → 04 Execution & Records
 *   • Signal desk moved ABOVE context panels (pro-desk order)
 *   • Old small NSE/CRYPTO toggle + status pill removed
 *   • NSE↔CRYPTO switch safety + zero JS page errors.
 * Runs against the live local server (APP_PIN=9201, PORT=9201).
 */
// Portable Playwright loader (v4.9 audit fix — no hardcoded-only path).
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

  const pageErrors = [];
  const consoleErrors = [];
  page.on('pageerror', (err) => pageErrors.push(String(err)));
  page.on('console', (msg) => {
    if (msg.type() === 'error' && !/Failed to load resource|net::ERR|ERR_NAME|ERR_CONNECTION|WebSocket|websocket/i.test(msg.text())) {
      consoleErrors.push(msg.text());
    }
  });

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
  check('U0 login with PIN', page.url().includes('localhost'), page.url());

  // ================= INTRADAY TAB =================
  await page.locator('button, a', { hasText: /Intraday/i }).first().click();
  await sleep(4500); // scanner fetch + render

  // -- U1: desk switcher --
  const t1 = await bodyText();
  check('U1a MarketDeskSwitcher renders both segments',
    t1.includes('INDIA MARKET') && t1.includes('CRYPTO MARKET'));
  check('U1b segments carry venue detail (NSE hours + CoinDCX)',
    t1.includes('09:15–15:30 IST') && t1.includes('CoinDCX INR pairs'));
  const indiaActive = await page.locator('[aria-pressed="true"]', { hasText: /INDIA MARKET/i }).first().textContent().catch(() => null);
  check('U1c India segment is the active desk (aria-pressed)', /INDIA/i.test(String(indiaActive)), String(indiaActive));

  // -- U2: desk info strip --
  check('U2a India quick-facts strip (session + sq-off + dead-zone)',
    t1.includes('Session 09:15–15:30') && t1.includes('Sq-off 15:10 IST') && t1.includes('Dead-zone 14:30–15:00'));
  check('U2b ORB window chip present', t1.includes('ORB 09:15–09:45'));
  check('U2c old duplicate status pill removed (no "🟢 NSE LIVE")', !t1.includes('🟢 NSE LIVE'));

  // -- U3: sectioned hierarchy --
  const idx01 = t1.indexOf('SIGNAL DESK');
  const idx02 = t1.indexOf('MARKET PULSE');
  const idx03 = t1.indexOf('INDIA RESEARCH DESK');
  const idx04 = t1.indexOf('EXECUTION & RECORDS');
  check('U3a all four section labels render',
    idx01 > -1 && idx02 > -1 && idx03 > -1 && idx04 > -1);
  check('U3b desk order: Signals → Market Pulse → India Research → Execution',
    idx01 < idx02 && idx02 < idx03 && idx03 < idx04,
    `01@${idx01} 02@${idx02} 03@${idx03} 04@${idx04}`);
  // Signal desk must come BEFORE Trending Movers (pro-desk order)
  const idxMovers = t1.indexOf('Trending Movers');
  check('U3c Signal Desk sits above Trending Movers', idx01 > -1 && idxMovers > -1 && idx01 < idxMovers);

  // -- U4: India desk panels --
  check('U4a Trending Movers (NSE Today) renders', t1.includes('Trending Movers') && t1.includes('NSE Today'));
  check('U4b Market Intel (global crypto context) renders', (await bt()).includes('global crypto intel'));
  check('U4c Tapetide India research desk renders (NSE only)', (await bt()).includes('tapetide'));
  check('U4d ProTrader agent panel renders (NSE only)', t1.includes('ProTrader'));
  await page.screenshot({ path: 'scripts/v49-intraday-india.png', fullPage: false });

  // -- U5: switch to CRYPTO --
  await page.locator('button', { hasText: /CRYPTO MARKET/i }).first().click();
  await sleep(5000); // crypto scanner fetch + re-render
  const t2 = await bodyText();
  check('U5a crypto desk active — 24/7 quick-facts swap in',
    t2.includes('24/7 session') && t2.includes('Fractional qty') && t2.includes('INR pairs (CoinDCX)'));
  check('U5b crypto slippage + BTC regime chips present',
    t2.includes('±12bps/side') && t2.includes('BTC regime gate'));
  check('U5c India Research Desk section hidden on crypto',
    !t2.includes('INDIA RESEARCH DESK') && !t2.toLowerCase().includes('tapetide'));
  check('U5d India-only quick-facts hidden (no Sq-off 15:10 chip)', !t2.includes('Sq-off 15:10 IST'));
  check('U5e Trending Movers switched to crypto list', t2.includes('Crypto 24h'));
  check('U5f Signal Desk section label still on top', t2.indexOf('SIGNAL DESK') < t2.indexOf('MARKET PULSE'));
  await page.screenshot({ path: 'scripts/v49-intraday-crypto.png', fullPage: false });

  // -- U6: switch back to INDIA --
  await page.locator('button', { hasText: /INDIA MARKET/i }).first().click();
  await sleep(5000);
  const t3 = await bodyText();
  check('U6a India desk restored (research section + chips back)',
    t3.includes('INDIA RESEARCH DESK') && t3.includes('Session 09:15–15:30'));
  check('U6b market choice persists in localStorage',
    await page.evaluate(() => localStorage.getItem('intraday_market')) === 'INDIA');

  // -- U7: bottom sections --
  const t4 = await bt();
  check('U7a Execution & Records: paper desk renders', t4.includes('paper') || t4.includes('virtual'));
  check('U7b track record + journal render', (t4.includes('track record') || t4.includes('track-record')) && t4.includes('journal'));

  // -- U8: error audit --
  check('U8 zero JS page errors', pageErrors.length === 0, pageErrors.slice(0, 3).join(' | '));
  check('U8b zero console errors (non-network)', consoleErrors.length === 0, consoleErrors.slice(0, 3).join(' | '));

  await browser.close();
  const failed = results.filter((r) => !r.ok);
  console.log(`\n===== v4.9 UI CHECK: ${results.length - failed.length}/${results.length} PASSED =====`);
  if (failed.length > 0) {
    console.log('FAILED:');
    failed.forEach((f) => console.log(`  ❌ ${f.name} ${f.extra}`));
    process.exit(1);
  }
})().catch((err) => { console.error('FATAL:', err); process.exit(1); });
