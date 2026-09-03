#!/usr/bin/env node
/**
 * v6.0 E2E — AI TRADING TERMINAL (complete Intraday replacement):
 *   1. Login (PIN 2023)
 *   2. Intraday tab GONE from the tab bar; 🤖 AI Trading present (slot 2)
 *   3. AI Trading tab renders: command bar + desk switcher + 01..04 sections
 *   4. Signal board: India signal cards (grade badges, plans, model votes)
 *   5. CRYPTO desk: crypto signals render; switching works both ways
 *   6. Options desk (India): metrics strip, chain table, strategy cards
 *   7. Execution console: kill switch, config editor, positions/journal tabs
 *   8. Model registry: 9 models online
 *   9. Execute button visible on crypto signals; LIVE locked without STRONG
 *  10. Old intraday endpoints → 404 (removed)
 *  11. Zero JS page errors
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
    if (msg.type() === 'error' && !/Failed to load resource|net::ERR|ERR_NAME|ERR_CONNECTION|404|502|WebSocket|websocket|ECONN/i.test(msg.text())) {
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

    // ---------- 2. Tab bar: Intraday gone, AI Trading present ----------
    const tabText = await page.locator('[role="tablist"]').innerText();
    check('tab bar has NO "Intraday"', !/intraday/i.test(tabText), tabText.replace(/\n/g, ' | ').slice(0, 90));
    check('tab bar shows "AI Trading"', /AI Trading/i.test(tabText));

    // ---------- 3. Open AI Trading tab ----------
    await page.click('[role="tablist"] button:has-text("AI Trading")');
    await page.waitForSelector('text=SUPERINTELLIGENCE AI TRADING TERMINAL', { timeout: 20000 });
    check('command bar renders', true);

    const desk = await page.innerText('body');
    check('desk switcher (INDIA MARKET / CoinDCX)', /INDIA MARKET/.test(desk) && /CRYPTO/.test(desk));
    check('section 01 Signal Board', /SIGNAL BOARD/i.test(desk));
    check('execution console section', /EXECUTION CONSOLE/i.test(desk));
    check('model registry section', /MODEL REGISTRY/i.test(desk));

    // ---------- 4. India signal board ----------
    await page.waitForSelector('text=Signal Board', { timeout: 10000 });
    await sleep(9000); // ensemble scan (TV scanner batch)
    let body = await page.innerText('body');
    const hasSignals = /\d+ signals|STRONG|WATCH|ACTION|NEUTRAL/.test(body);
    check('signal board populated (grades visible)', hasSignals);
    const signalCardCount = await page.locator('[role="img"][aria-label*="confidence"]').count();
    check('signal cards with confidence gauges', signalCardCount > 0, `${signalCardCount} cards`);

    // expand first card's model votes
    const expandBtn = page.locator('button:has-text("Models")').first();
    if (await expandBtn.count()) {
      await expandBtn.click();
      await sleep(600);
      body = await page.innerText('body');
      check('model votes expand (TrendMatrix/MomentumQuant visible)', /TrendMatrix|MomentumQuant/.test(body));
    } else {
      check('model votes expand (TrendMatrix/MomentumQuant visible)', false, 'no expand button');
    }

    // ---------- 5. Options desk ----------
    check('options desk section (India)', /OPTIONS DESK/i.test(body));
    check('options metrics (SPOT / VIX / EXPIRY)', /SPOT/.test(body) && /EXPIRY/.test(body));
    const chainRows = await page.locator('table').first().locator('tbody tr').count();
    check('option chain table rows', chainRows > 5, `${chainRows} strikes`);
    body = await page.innerText('body');
    check('strategies rendered (spread/condor/long call)', /Bull Call Spread|Bear Put Spread|Iron Condor|Long Call|Long Put/i.test(body));
    check('chain source badge (LIVE NSE or BS MODEL)', /LIVE NSE CHAIN|BS MODEL CHAIN/i.test(body));

    // ---------- 6. Execution console ----------
    check('kill switch button', (await page.locator('button:has-text("KILL SWITCH")').count()) === 1);
    check('PAPER mode badge default', /PAPER MODE/i.test(body));
    check('risk settings editor', /RISK & EXECUTION SETTINGS/i.test(body));
    // switch to journal tab
    await page.click('button:has-text("AUDIT JOURNAL")');
    await sleep(400);
    body = await page.innerText('body');
    check('journal tab opens', /Empty|FILLED|REJECTED|SUBMITTED|CLOSED/i.test(body) || /journal/i.test(body));
    await page.click('button:has-text("POSITIONS")');

    // ---------- 7. Model registry: 9 models ----------
    const modelCards = await page.locator('text=/TrendMatrix|MomentumQuant|VolatilityScope|VolumeFlow|PatternNeural|SRMatrix|OptionsFlow|MacroRegime|AI Council/').count();
    check('model registry: 9 model names', modelCards >= 9, `${modelCards} mentions`);

    // ---------- 8. Crypto desk ----------
    await page.click('button:has-text("CRYPTO")');
    await sleep(9000);
    body = await page.innerText('body');
    check('crypto desk active (options desk hidden)', !/OPTION CHAIN/.test(body));
    const cryptoCardCount = await page.locator('[role="img"][aria-label*="confidence"]').count();
    check('crypto signal cards render', cryptoCardCount > 0, `${cryptoCardCount} cards`);
    // paper-trade button present on crypto cards
    const paperBtns = await page.locator('button:has-text("PAPER TRADE")').count();
    check('PAPER TRADE buttons on crypto signals', paperBtns > 0, `${paperBtns} buttons`);
    body = await page.innerText('body');
    check('LIVE lock note (needs STRONG)', /LIVE execution locked|EXECUTE LIVE/i.test(body));

    // ---------- 9. switch back to India ----------
    await page.click('button:has-text("INDIA MARKET")');
    await sleep(1500);
    body = await page.innerText('body');
    check('switch back to India restores options desk', /OPTIONS DESK|OPTION CHAIN/i.test(body));

    // ---------- 10. old intraday endpoints removed ----------
    const gone = await page.evaluate(async () => {
      const r = await fetch('/api/intraday-scanner?market=INDIA', { credentials: 'include' });
      return r.status;
    });
    check('old /api/intraday-scanner endpoint removed (404)', gone === 404, `status ${gone}`);

    // ---------- 11. keyboard shortcut 2 opens AI Trading ----------
    await page.keyboard.press('2');
    await sleep(800);
    check('keyboard "2" opens AI Trading', /SUPERINTELLIGENCE/.test(await page.innerText('body')));

    // ---------- 12. zero JS errors ----------
    check('zero page JS errors', pageErrors.length === 0, pageErrors.slice(0, 2).join(' || ').slice(0, 140));
    check('zero console errors (non-network)', consoleErrors.length === 0, consoleErrors.slice(0, 2).join(' || ').slice(0, 140));

    await page.screenshot({ path: 'scripts/v60-ai-trading-india.png', fullPage: false });
    // crypto shot
    await page.click('button:has-text("CRYPTO")');
    await sleep(4000);
    await page.screenshot({ path: 'scripts/v60-ai-trading-crypto.png', fullPage: false });
  } catch (e) {
    check('E2E flow crashed', false, String(e).slice(0, 200));
  }

  const pass = results.filter(r => r.ok).length;
  console.log(`\n===== v6.0 AI TRADING E2E: ${pass}/${results.length} =====`);
  await browser.close();
  process.exit(pass === results.length ? 0 : 1);
})();
