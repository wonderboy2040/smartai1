// Probe the LIVE site's Portfolio TAB — capture exactly what the user sees:
// summary cards, group headers, rows (invested/cost/value/pnl fields).
// Usage: node scripts/v50-live-portfolio-probe.cjs
const BASE = process.env.PROBE_BASE || 'https://smartai-e954.onrender.com';
const PIN = process.env.PROBE_PIN || '2023';

function loadPlaywright() {
  try { return require('playwright'); } catch { /* keep trying */ }
  try { return require('/home/z/.npm-global/lib/node_modules/playwright'); } catch { /* keep trying */ }
  throw new Error('Playwright not found — npm i -g playwright && npx playwright install chromium');
}

(async () => {
  const { chromium } = loadPlaywright();
  const browser = await chromium.launch({ args: ['--no-sandbox'] });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });

  const errors = [];
  page.on('pageerror', e => errors.push('PAGEERROR: ' + e.message));

  await page.goto(BASE + '/', { waitUntil: 'domcontentloaded', timeout: 60000 });

  // Login with PIN
  const pinInput = page.locator('input[type="password"], input[inputmode="numeric"]').first();
  await pinInput.waitFor({ state: 'visible', timeout: 30000 });
  await pinInput.fill(PIN);
  await page.keyboard.press('Enter');
  await page.waitForTimeout(6000);

  // Go to Portfolio tab
  const portfolioBtn = page.locator('button, a', { hasText: /portfolio/i }).first();
  await portfolioBtn.click();
  await page.waitForTimeout(9000); // allow sync + prices

  const out = {};

  // 1. Summary cards (top 4)
  out.summaryCards = await page.locator('.quantum-stat').allInnerTexts();

  // 2. Group headers
  out.groupHeaders = await page.locator('button.w-full.flex.items-center.justify-between').allInnerTexts();

  // 3. Rows: symbol + all cells
  const rows = page.locator('div.grid.lg\\:grid-cols-\\[1\\.5fr_1fr_1fr_1fr_1fr_9\\.5rem\\], div.grid.grid-cols-\\[1\\.5fr_1fr_1fr_1fr_9\\.5rem\\]');
  out.rowCount = await rows.count();
  const rowTexts = [];
  for (let i = 0; i < Math.min(out.rowCount, 15); i++) {
    rowTexts.push(await rows.nth(i).innerText());
  }
  out.rows = rowTexts;

  // 4. The India-group table body (rows under India header)
  const bodyText = await page.locator('main, #root, body').first().innerText();
  out.fullTextExcerpt = bodyText.slice(0, 6000);

  console.log(JSON.stringify(out, null, 2));
  console.log('\nPAGE ERRORS:', errors.length ? errors.join('\n') : 'none');
  await page.screenshot({ path: 'scripts/v50-live-portfolio.png', fullPage: true });
  await browser.close();
})().catch(e => { console.error('FATAL:', e.message); process.exit(1); });
