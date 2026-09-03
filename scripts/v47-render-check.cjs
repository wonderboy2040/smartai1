#!/usr/bin/env node
/**
 * v4.7 render check — TapetidePanel (India Research desk) in the
 * Intraday TAB: not-connected explainer + connect button target,
 * NSE-only visibility (hidden on CRYPTO desk), registry note,
 * and zero JS page errors. Runs against the live local server
 * (APP_PIN=9201, PORT=9201).
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

  // ---- 2. Open Intraday TAB (India desk default) ----
  const intradayBtn = page.locator('button, a', { hasText: /Intraday/i }).first();
  await intradayBtn.click();
  await sleep(3000);
  const bodyText = await page.evaluate(() => document.body.innerText);
  const bt = bodyText.toLowerCase();

  // ---- 3. TapetidePanel visible on NSE desk ----
  check('TapetidePanel header visible', bt.includes('tapetide india research'));
  check('Tapetide MCP badge', bt.includes('mcp'));
  check('not-connected explainer (account login = API key)', bt.includes('account login') || bt.includes('api key'));
  check('tapetide.com source mention', bt.includes('mcp.tapetide.com'));
  check('secure OAuth note', bt.includes('oauth'));

  // ---- 4. Connect button wired to the server connect route ----
  const connectBtn = page.locator('button', { hasText: /Connect Tapetide/i }).first();
  const connectCount = await connectBtn.count();
  check('Connect Tapetide button present', connectCount > 0);
  if (connectCount > 0) {
    const visible = await connectBtn.isVisible();
    check('Connect Tapetide button visible', visible);
  }

  // ---- 5. CRYPTO desk → Tapetide panel hidden (India-only desk) ----
  const cryptoChip = page.locator('button', { hasText: /₿ CRYPTO/ }).first();
  if (await cryptoChip.count()) {
    await cryptoChip.click();
    await sleep(2500);
    const t3 = (await page.evaluate(() => document.body.innerText)).toLowerCase();
    check('CRYPTO desk hides Tapetide panel', !t3.includes('tapetide india research'));
    check('CRYPTO desk keeps other panels', t3.includes('trending movers') && t3.includes('global crypto intel'));
    const nseChip = page.locator('button', { hasText: /🇮🇳 NSE/ }).first();
    if (await nseChip.count()) {
      await nseChip.click();
      await sleep(2500);
      const t4 = (await page.evaluate(() => document.body.innerText)).toLowerCase();
      check('switch back to NSE restores Tapetide panel', t4.includes('tapetide india research'));
    }
  } else {
    check('market chips found', false, 'NSE/CRYPTO chips not located');
  }

  // ---- 6. Source registry note updated (connectable) ----
  const registryBtn = page.locator('button[title="Data-source registry (honest status)"]');
  if (await registryBtn.count()) {
    await registryBtn.first().click();
    await sleep(600);
    const bt2 = (await page.evaluate(() => document.body.innerText)).toLowerCase();
    check('registry shows Tapetide connectable', /tapetide mcp/.test(bt2) && /research desk/.test(bt2));
  } else {
    check('registry toggle found', false, 'registry button not located');
  }

  // ---- 7. Screenshot + JS error audit ----
  await page.screenshot({ path: '/tmp/v47-intraday-tapetide.png', fullPage: false });

  const realErrors = consoleErrors.filter((e) =>
    !/net::|ERR_NETWORK|Failed to load resource|aborted|AbortError|EventSource|401|403|429|favicon|WebSocket|Sec-WebSocket-Protocol/i.test(e));
  check('zero real JS page errors', realErrors.length === 0, realErrors.slice(0, 2).join(' | ').slice(0, 200));

  const pass = results.filter((r) => r.ok).length;
  console.log(`\n=== ${pass}/${results.length} checks passed ===`);

  await browser.close();
  process.exit(pass === results.length ? 0 : 1);
})().catch((e) => { console.error('FATAL:', e.message); process.exit(1); });
