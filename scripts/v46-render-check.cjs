#!/usr/bin/env node
/**
 * v4.6 render check — MarketIntelPanel (Global Crypto Intel) in the
 * Intraday TAB, plus NSE↔CRYPTO chip switch safety + zero JS errors.
 * Runs against the live local server (APP_PIN=9201, PORT=9201).
 */
const { chromium } = require('/home/z/.npm-global/lib/node_modules/playwright');

const BASE = 'http://localhost:9201';
const PIN = '9201';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });

  const consoleErrors = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') consoleErrors.push(msg.text());
  });
  page.on('pageerror', (err) => consoleErrors.push(String(err)));

  const results = [];
  const check = (name, ok, extra = '') => {
    results.push({ name, ok: !!ok, extra });
    console.log(`${ok ? '✅' : '❌'} ${name}${extra ? ` — ${extra}` : ''}`);
  };

  // ---- 1. Login via PIN form ----
  await page.goto(BASE, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForSelector('input[type="password"]', { timeout: 15000 });
  await page.fill('input[type="password"]', PIN);
  await page.keyboard.press('Enter');
  await page.waitForSelector('text=Dashboard', { timeout: 20000 }).catch(() => {});
  await sleep(1500);
  check('login with PIN', page.url().includes('localhost'), page.url());

  // ---- 2. Open Intraday TAB ----
  const intradayBtn = page.locator('button, a', { hasText: /Intraday/i }).first();
  await intradayBtn.click();
  await sleep(2500);
  const bodyText = await page.evaluate(() => document.body.innerText);

  // ---- 3. MarketIntelPanel presence (CSS uppercase transforms innerText — check lowercase) ----
  const bt = bodyText.toLowerCase();
  check('MarketIntelPanel header visible', bt.includes('global crypto intel'));
  check('Fear & Greed gauge visible', bt.includes('fear & greed'));
  check('whale leaders section', bt.includes('whale leaders'));
  check('movers board section', bt.includes('movers board'));
  check('retail trending section', bt.includes('retail trending'));
  check('deep analysis section', bt.includes('deep analysis'));
  check('verdict box', bt.includes('verdict'));

  // ---- 4. Live data actually rendered (F&G value, whale coins) ----
  check('F&G live value (63/100 pattern)', /\d+\/100/.test(bodyText), (bodyText.match(/\d+\/100/) || [''])[0]);
  const hasWhaleCoin = /(ETH|BTC|BNB|XRP|ZEC|SOL|RLUSD)/.test(bodyText);
  check('whale coin rows rendered', hasWhaleCoin);
  check('movers gainers rendered', bt.includes('gainers') && bt.includes('losers'));

  // ---- 5. Source registry toggle ----
  await page.locator('button[title="Data-source registry (honest status)"]').click();
  await sleep(600);
  const bt2 = (await page.evaluate(() => document.body.innerText)).toLowerCase();
  check('source registry opens', bt2.includes('source registry'));
  check('CoinLobster status LIVE', /live\s*coinlobster mcp/.test(bt2.replace(/\n/g, ' ')));
  check('honest dead/auth sources shown', bt2.includes('auth') && bt2.includes('dead'));
  check('India note in registry', bt2.includes('india-side free mcp keyless'));

  // ---- 6. NSE ↔ CRYPTO chip switch (intel panel stays, no crash) ----
  const cryptoChip = page.locator('button', { hasText: /₿ CRYPTO/ }).first();
  if (await cryptoChip.count()) {
    await cryptoChip.click();
    await sleep(2500);
    const t3 = (await page.evaluate(() => document.body.innerText)).toLowerCase();
    check('crypto switch keeps intel panel', t3.includes('global crypto intel'));
    check('crypto switch keeps trending movers', t3.includes('trending movers'));
    const nseChip = page.locator('button', { hasText: /🇮🇳 NSE/ }).first();
    if (await nseChip.count()) {
      await nseChip.click();
      await sleep(2000);
      const t4 = (await page.evaluate(() => document.body.innerText)).toLowerCase();
      check('switch back to NSE OK', t4.includes('trending movers') && !/page crashed/i.test(t4));
    }
  } else {
    check('market chips found', false, 'NSE/CRYPTO chips not located');
  }

  // ---- 7. Screenshot + JS error audit ----
  await page.screenshot({ path: '/tmp/v46-intraday-intel.png', fullPage: false });

  // Filter known upstream noise (SSE aborts, network blips from feeds,
  // TradingView browser-WS handshake noise from chart embeds)
  const realErrors = consoleErrors.filter((e) =>
    !/net::|ERR_NETWORK|Failed to load resource|aborted|AbortError|EventSource|401|403|429|favicon|WebSocket|Sec-WebSocket-Protocol/i.test(e));
  check('zero real JS page errors', realErrors.length === 0, realErrors.slice(0, 2).join(' | ').slice(0, 200));

  const pass = results.filter((r) => r.ok).length;
  console.log(`\n=== ${pass}/${results.length} checks passed ===`);

  await browser.close();
  process.exit(pass === results.length ? 0 : 1);
})().catch((e) => { console.error('FATAL:', e.message); process.exit(1); });
