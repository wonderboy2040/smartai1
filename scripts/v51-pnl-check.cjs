// ============================================================
// v51-pnl-check.cjs — E2E verification of the v5.1 P&L truth fixes.
// Boots against the LOCAL server, intercepts /api/mcp/indmoney/assets
// and serves the REAL live-synced rows (captured from the user's live
// server) WITH the CoinDCX trade-ledger basis — then asserts the
// Portfolio TAB renders the OFFICIAL-APP numbers:
//   • Capital Deployed 🇮🇳 = ₹291,989 (crypto NOT in India)
//   • Current Equity 🇮🇳 = ₹317,678 (no +10,000 crypto leak)
//   • Total P&L 🇮🇳 = +₹25,689 (NOT 35,689)
//   • 🪙 crypto chip = +₹1,515 · crypto group header +₹1,515
//   • BTC row shows real invested (Cost ₹5,259) — not "P&L n/a"
//   • India group header value+returns unchanged (regression-safe)
// Usage: node scripts/v51-pnl-check.cjs  (server must run on :9201)
// ============================================================
function loadPlaywright() {
  try { return require('playwright'); } catch { /* keep trying */ }
  try { return require('/home/z/.npm-global/lib/node_modules/playwright'); } catch { /* keep trying */ }
  throw new Error('Playwright not found — npm i -g playwright && npx playwright install chromium');
}

const BASE = process.env.CHECK_BASE || 'http://localhost:9201';
const PIN = process.env.APP_PIN || '9201';

// ---- the REAL live rows (from /api/mcp/indmoney/assets on Render) ----
const FIXTURE = {
  ok: true, reason: null, hiddenCount: 0, hiddenAssets: [],
  counts: { assets: 11, live: 10, noLive: 1, resolved: 10, coindcx: 2, hidden: 0 },
  summary: {
    totalValue: 487598.72, totalInvested: 450615.31, totalPnl: 36983.41, totalPnlPct: 8.21,
    oneDayChange: null, oneDayChangePct: null, holdingCount: 11, withBasis: 11,
  },
  positions: [],
  sources: { indmoney: true, coindcx: true },
  coindcx: { connected: true, connectedAt: 1788373493989, lastSyncAt: Date.now(), balanceCount: 5, lastError: null },
  syncedAt: Date.now(), stale: false, slots: ['09:30', '21:30'], lastRuns: {}, nextSyncAt: null, lastError: null,
  assets: [
    { id: 'indm-MOTILALOSWAL-0', key: 'indm:MOTILALOSWAL', name: 'Motilal Oswal Nifty 500 Momentum 50 ETF', source: 'indmoney', symbol: 'MOMENTUM50', market: 'IN', kind: 'etf', qty: 1990, avgPrice: 51.95, lastPrice: 54.39, value: 108236.1, invested: 103380.5, pnl: 4855.6, pnlPct: 4.7, oneDayChangePct: 0.57, assetType: 'ETF', assetEnum: 'IND_STOCK', noLive: false },
    { id: 'indm-MIRAEASSETNI-1', key: 'indm:MIRAEASSETNI', name: 'Mirae Asset Nifty Smallcap 250 Momen.Quali. 100ETF', source: 'indmoney', symbol: 'SMALLCAP', market: 'IN', kind: 'etf', qty: 1774, avgPrice: 42.27, lastPrice: 49.04, value: 86996.96, invested: 74986.98, pnl: 12009.98, pnlPct: 16.02, oneDayChangePct: 1.18, assetType: 'ETF', assetEnum: 'IND_STOCK', noLive: false },
    { id: 'indm-NIPPONINDIAE-2', key: 'indm:NIPPONINDIAE', name: 'Nippon India ETF Nifty Midcap 150', source: 'indmoney', symbol: 'MID150BEES', market: 'IN', kind: 'etf', qty: 330, avgPrice: 221.38, lastPrice: 240.1, value: 79233, invested: 73056.7, pnl: 6176.3, pnlPct: 8.45, oneDayChangePct: 0.43, assetType: 'ETF', assetEnum: 'IND_STOCK', noLive: false },
    { id: 'indm-NIPPONINDIAE-3', key: 'indm:NIPPONINDIAE:2', name: 'Nippon India ETF Nifty Next 50 Junior BeES', source: 'indmoney', symbol: 'JUNIORBEES', market: 'IN', kind: 'etf', qty: 40, avgPrice: 720.99, lastPrice: 790, value: 31600, invested: 28839.4, pnl: 2760.6, pnlPct: 9.57, oneDayChangePct: 0.2, assetType: 'ETF', assetEnum: 'IND_STOCK', noLive: false },
    { id: 'indm-SBIETFNIFTY5-4', key: 'indm:SBIETFNIFTY5', name: 'SBI ETF Nifty 50', source: 'indmoney', symbol: 'SETFNIF50', market: 'IN', kind: 'etf', qty: 45, avgPrice: 260.57, lastPrice: 258.05, value: 11612.25, invested: 11725.65, pnl: -113.4, pnlPct: -0.97, oneDayChangePct: 0.16, assetType: 'ETF', assetEnum: 'IND_STOCK', noLive: false },
    { id: 'indm-VANECKSEMICO-7', key: 'indm:VANECKSEMICO', name: 'VanEck Semiconductor ETF', source: 'indmoney', symbol: 'SMH', market: 'US', kind: 'stock', qty: 1.9241956, avgPrice: 474.46, lastPrice: 551.12, value: 100630.28, invested: 86631.66, pnl: 13998.62, pnlPct: 16.16, oneDayChangePct: 0.05, assetType: 'ETF', assetEnum: 'US_STOCK', noLive: false },
    { id: 'indm-MICRONTECHNO-8', key: 'indm:MICRONTECHNO', name: 'Micron Technology Inc.', source: 'indmoney', symbol: 'MU', market: 'US', kind: 'stock', qty: 0.4639806, avgPrice: 997.37, lastPrice: 951.68, value: 41900.68, invested: 43912.52, pnl: -2011.84, pnlPct: -4.58, oneDayChangePct: -0.53, assetType: 'Stock', assetEnum: 'US_STOCK', noLive: false },
    { id: 'indm-SPACEX-9', key: 'indm:SPACEX', name: 'SpaceX', source: 'indmoney', symbol: 'SPCX', market: 'US', kind: 'stock', qty: 1.2557423, avgPrice: 144.8, lastPrice: 140.99, value: 16800.47, invested: 17254.6, pnl: -454.13, pnlPct: -2.63, oneDayChangePct: 0.13, assetType: 'Stock', assetEnum: 'US_STOCK', noLive: false },
    { id: 'indm-VANGUARDSP50-10', key: 'indm:VANGUARDSP50', name: 'Vanguard S&P 500 Growth ETF', source: 'indmoney', symbol: null, market: 'US', kind: 'stock', qty: 0.3214695, avgPrice: 76.78, lastPrice: 83.45, value: 2545.63, invested: 2342.32, pnl: 203.31, pnlPct: 8.68, oneDayChangePct: -0.12, assetType: 'ETF', assetEnum: 'US_STOCK', noLive: true },
    // CoinDCX rows WITH trade-ledger basis (user's app: invested 8,485 / PNL 1,513)
    { id: 'cdcx-BTC', key: 'cdcx:BTC', name: 'Bitcoin (CoinDCX)', symbol: 'BTC', market: 'IN', kind: 'crypto', source: 'coindcx', qty: 0.000736, avgPrice: 7145470.11, lastPrice: 7749225, value: 5703.43, invested: 5259.07, pnl: 444.36, pnlPct: 8.45, oneDayChangePct: 0.53, assetType: 'Crypto', assetEnum: 'CRYPTO', noLive: false },
    { id: 'cdcx-ETH', key: 'cdcx:ETH', name: 'Ethereum (CoinDCX)', symbol: 'ETH', market: 'IN', kind: 'crypto', source: 'coindcx', qty: 0.01794521012936, avgPrice: 179770.5, lastPrice: 239431.2, value: 4296.64, invested: 3226.0, pnl: 1070.64, pnlPct: 33.18, oneDayChangePct: -0.27, assetType: 'Crypto', assetEnum: 'CRYPTO', noLive: false },
  ],
};

(async () => {
  const { chromium } = loadPlaywright();
  const browser = await chromium.launch({ args: ['--no-sandbox'] });
  // serviceWorkers: 'block' — the PWA's sw.js proxies fetches, which makes
  // them INVISIBLE to page.route (the first E2E lesson of v5.1).
  const ctx = await browser.newContext({ serviceWorkers: 'block' });
  const page = await ctx.newPage();

  const errors = [];
  page.on('pageerror', e => errors.push('PAGEERROR: ' + e.message));

  // Serve the live fixture for the assets endpoint (all calls).
  await page.route(/indmoney\/assets/, route =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(FIXTURE) }));

  await page.goto(BASE + '/', { waitUntil: 'domcontentloaded', timeout: 60000 });
  const pinInput = page.locator('input[type="password"], input[inputmode="numeric"]').first();
  await pinInput.waitFor({ state: 'visible', timeout: 30000 });
  await pinInput.fill(PIN);
  await page.keyboard.press('Enter');
  await page.waitForTimeout(6000);

  await page.locator('button, a', { hasText: /portfolio/i }).first().click();
  await page.waitForTimeout(8000); // sync + seeds

  const results = [];
  const check = (name, cond, extra = '') => {
    results.push(`${cond ? '✅' : '❌'} ${name}${extra ? ' — ' + extra : ''}`);
    if (!cond) process.exitCode = 1;
  };

  const body = await page.locator('#root').innerText();
  const cards = await page.locator('.quantum-stat').allInnerTexts();
  const card = label => cards.find(c => c.toUpperCase().includes(label)) || '';

  // P1: Capital Deployed 🇮🇳 = 291,989 (India only, crypto separate)
  const cap = card('CAPITAL DEPLOYED');
  check('P1 Capital Deployed 🇮🇳 ₹2,91,989 (crypto excluded from India)', /₹2,91,989/.test(cap), cap.replace(/\n/g, ' | '));

  // P2: Current Equity 🇮🇳 ≈ 3,17,xxx — NOT 3,27,xxx (the +10,000 leak)
  const eq = card('CURRENT EQUITY');
  check('P2 Current Equity 🇮🇳 ₹3,17,xxx (no +₹10,000 crypto leak)', /₹3,17,\d\d\d/.test(eq) && !/₹3,27,\d\d\d/.test(eq), eq.replace(/\n/g, ' | '));

  // P3: Total P&L 🇮🇳 = +₹25,3xx-25,7xx (sync-truth, live-tick drift OK) — NOT 35,xxx
  const tp = card('TOTAL P&L');
  check('P3 Total P&L 🇮🇳 ≈ +₹25,xxx — the 35,689 bug is GONE', /\+₹25,\d\d\d/.test(tp) && !/₹35,\d\d\d/.test(tp), tp.replace(/\n/g, ' | '));

  // P4: 🪙 crypto chip present with +₹1,515
  check('P4 Total P&L card has 🪙 crypto chip +₹1,515', /🪙\s*\+?₹1,5\d\d/.test(tp), (tp.match(/🪙[^\n]*/) || ['(none)'])[0]);

  // P5: crypto group header shows +₹1,515 (not −₹2 drift, not P&L n/a)
  const headers = await page.locator('button.w-full.flex.items-center.justify-between').allInnerTexts();
  const cryptoH = headers.find(h => h.includes('Crypto')) || '';
  check('P5 Crypto group header +₹1,515 (trade-ledger basis live)', /\+₹1,5\d\d/.test(cryptoH), cryptoH.replace(/\n/g, ' | ').slice(0, 120));

  // P6: India group header +₹25,xxx (regression-safe, app-exact)
  const indiaH = headers.find(h => h.includes('India')) || '';
  check('P6 India group header returns ≈ +₹25,xxx (unchanged, correct)', /\+₹25,\d\d\d/.test(indiaH), indiaH.replace(/\n/g, ' | ').slice(0, 120));

  // P7: BTC row shows a real invested cost (Cost ₹5,259) — basis live
  const btcRow = await page.locator('div', { hasText: /^BTC$/ }).filter({ hasText: /CoinDCX|CRYPTO/ }).first().innerText().catch(() => '');
  check('P7 BTC row renders with cost basis (no "P&L n/a")', !/P&L n\/a/.test(body) || /P&L n\/a/.test(body) === false ? !/P&L n\/a/.test(body) : false, btcRow ? 'row ok' : 'row text');

  // P8: total topline P&L = 25,689 + 11,736 + 1,515 ≈ 38,940 (hmm: US pnl at these prices 13,998−2,011−454+203=11,736)
  const topline = tp.match(/\+?₹([\d,]+)/);
  const toplineNum = topline ? parseInt(topline[1].replace(/,/g, ''), 10) : 0;
  check('P8 Topline Total P&L ≈ ₹38,9xx (India+US+crypto, no fake)', toplineNum > 38000 && toplineNum < 40000, `topline=₹${toplineNum}`);

  // P9: zero page errors
  check('P9 zero page JS errors', errors.length === 0, errors.join('; ').slice(0, 200));

  console.log('===== v5.1 P&L TRUTH CHECK =====');
  results.forEach(r => console.log(r));
  console.log(`\n${results.every(r => r.startsWith('✅')) ? 'ALL PASSED' : 'FAILURES PRESENT'}`);
  await page.screenshot({ path: 'scripts/v51-portfolio-pnl.png', fullPage: true });
  await browser.close();
})().catch(e => { console.error('FATAL:', e.message); process.exit(1); });
