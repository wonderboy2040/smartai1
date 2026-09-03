// ============================================================
// v53-pnl-check.cjs — E2E verification of the v5.2 APP-PARITY fixes.
// Boots against the LOCAL server, intercepts /api/mcp/indmoney/assets
// + /api/forex and serves the REAL live-synced rows (today's capture,
// crypto rows WITH basis) — then asserts the Portfolio TAB renders:
//   • 🇮🇳 INDIA section card = app EXACT (₹291,989.23 / ₹317,365.59 / +₹25,376.36)
//   • 🦅 USA card: Match-App flow — $1,582.22 → click → 1631.97 → $1,631.97 / +$60.59
//   • 🪙 CRYPTO card = app numbers (₹8,485.07 / +₹1,546.68)
//   • Table: SMH Qty 1.9242 @ $489.35 (app-parity avg), BTC @ ₹7,145,470
//   • All-Markets bar + identity total
//   • Set Basis modal opens
//   • zero JS errors
// Usage: node scripts/v53-pnl-check.cjs  (server must run on :9211, PIN 2023)
// ============================================================
function loadPlaywright() {
  try { return require('playwright'); } catch { /* keep trying */ }
  try { return require('/home/z/.npm-global/lib/node_modules/playwright'); } catch { /* keep trying */ }
  throw new Error('Playwright not found');
}

const BASE = process.env.CHECK_BASE || 'http://localhost:9211';
const PIN = process.env.APP_PIN || '2023';
const FX = 94.892446;

// ---- TODAY'S real live rows (v52 live forensics, 2026-09-03) ----
const FIXTURE = {
  ok: true, reason: null, hiddenCount: 2,
  hiddenAssets: [
    { key: 'indm:MIRAEASSETNI:2', market: 'IN', value: 7742.79, invested: 7742.79 },
    { key: 'indm:USTOP100STOC', market: 'IN', value: 5181.76, invested: 5181.76 },
  ],
  counts: { assets: 11, live: 10, noLive: 1, resolved: 10, coindcx: 2, hidden: 2 },
  summary: { totalValue: 488007.8, totalInvested: 442130.33, totalPnl: 35845.72, totalPnlPct: 8.11, holdingCount: 11, withBasis: 9 },
  positions: [],
  sources: { indmoney: true, coindcx: true },
  coindcx: { connected: true, connectedAt: 1788373493989, lastSyncAt: Date.now(), balanceCount: 5, lastError: null },
  syncedAt: Date.now(), stale: false, slots: ['09:30', '21:30'], lastRuns: {}, nextSyncAt: null, lastError: null,
  assets: [
    { id: 'indm-MOTILALOSWAL-0', key: 'indm:MOTILALOSWAL', name: 'Motilal Oswal Nifty 500 Momentum 50 ETF', source: 'indmoney', symbol: 'MOMENTUM50', market: 'IN', kind: 'etf', qty: 1990, avgPrice: 51.95, lastPrice: 54.25, value: 107957.5, invested: 103380.5, pnl: 4577, pnlPct: 4.42, oneDayChangePct: 0.57, assetType: 'ETF', assetEnum: 'IND_STOCK', noLive: false },
    { id: 'indm-MIRAEASSETNI-1', key: 'indm:MIRAEASSETNI', name: 'Mirae Asset Nifty Smallcap 250 Momen.Quali. 100ETF', source: 'indmoney', symbol: 'SMALLCAP', market: 'IN', kind: 'etf', qty: 1774, avgPrice: 42.27, lastPrice: 49.06, value: 87032.44, invested: 74986.98, pnl: 12045.46, pnlPct: 16.06, oneDayChangePct: 1.18, assetType: 'ETF', assetEnum: 'IND_STOCK', noLive: false },
    { id: 'indm-NIPPONINDIAE-2', key: 'indm:NIPPONINDIAE', name: 'Nippon India ETF Nifty Midcap 150', source: 'indmoney', symbol: 'MID150BEES', market: 'IN', kind: 'etf', qty: 330, avgPrice: 221.38, lastPrice: 240.14, value: 79246.2, invested: 73056.7, pnl: 6189.5, pnlPct: 8.48, oneDayChangePct: 0.43, assetType: 'ETF', assetEnum: 'IND_STOCK', noLive: false },
    { id: 'indm-NIPPONINDIAE-3', key: 'indm:NIPPONINDIAE:2', name: 'Nippon India ETF Nifty Next 50 Junior BeES', source: 'indmoney', symbol: 'JUNIORBEES', market: 'IN', kind: 'etf', qty: 40, avgPrice: 720.99, lastPrice: 788.74, value: 31549.6, invested: 28839.4, pnl: 2710.2, pnlPct: 9.4, oneDayChangePct: 0.2, assetType: 'ETF', assetEnum: 'IND_STOCK', noLive: false },
    { id: 'indm-SBIETFNIFTY5-4', key: 'indm:SBIETFNIFTY5', name: 'SBI ETF Nifty 50', source: 'indmoney', symbol: 'SETFNIF50', market: 'IN', kind: 'etf', qty: 45, avgPrice: 260.57, lastPrice: 257.33, value: 11579.85, invested: 11725.65, pnl: -145.8, pnlPct: -1.24, oneDayChangePct: 0.16, assetType: 'ETF', assetEnum: 'IND_STOCK', noLive: false },
    { id: 'indm-VANECKSEMICO-7', key: 'indm:VANECKSEMICO', name: 'VanEck Semiconductor ETF', source: 'indmoney', symbol: 'SMH', market: 'US', kind: 'stock', qty: 1.9241956, avgPrice: 474.46, lastPrice: 544.46, value: 99414.61, invested: 86631.66, pnl: 12782.95, pnlPct: 14.76, oneDayChangePct: 0.05, assetType: 'ETF', assetEnum: 'US_STOCK', noLive: false },
    { id: 'indm-MICRONTECHNO-8', key: 'indm:MICRONTECHNO', name: 'Micron Technology Inc.', source: 'indmoney', symbol: 'MU', market: 'US', kind: 'stock', qty: 0.4639806, avgPrice: 997.37, lastPrice: 951.98, value: 41914.18, invested: 43912.52, pnl: -1998.34, pnlPct: -4.55, oneDayChangePct: -0.53, assetType: 'Stock', assetEnum: 'US_STOCK', noLive: false },
    { id: 'indm-SPACEX-9', key: 'indm:SPACEX', name: 'SpaceX', source: 'indmoney', symbol: 'SPCX', market: 'US', kind: 'stock', qty: 1.2557423, avgPrice: 144.8, lastPrice: 140.46, value: 16737.2, invested: 17254.6, pnl: -517.4, pnlPct: -3, oneDayChangePct: 0.13, assetType: 'Stock', assetEnum: 'US_STOCK', noLive: false },
    { id: 'indm-VANGUARDSP50-10', key: 'indm:VANGUARDSP50', name: 'Vanguard S&P 500 Growth ETF', source: 'indmoney', symbol: null, market: 'US', kind: 'stock', qty: 0.3214695, avgPrice: 76.78, lastPrice: 83.41, value: 2544.47, invested: 2342.32, pnl: 202.15, pnlPct: 8.63, oneDayChangePct: -0.12, assetType: 'ETF', assetEnum: 'US_STOCK', noLive: true },
    // CoinDCX rows WITH basis (ledger/manual — app: invested 8,485)
    { id: 'cdcx-BTC', key: 'cdcx:BTC', name: 'Bitcoin (CoinDCX)', symbol: 'BTC', market: 'IN', kind: 'crypto', source: 'coindcx', qty: 0.000736, avgPrice: 7145470.11, lastPrice: 7790000, value: 5733.44, invested: 5259.07, pnl: 474.37, pnlPct: 9.02, oneDayChangePct: 0.53, assetType: 'Crypto', assetEnum: 'CRYPTO', basisSource: 'ledger', noLive: false },
    { id: 'cdcx-ETH', key: 'cdcx:ETH', name: 'Ethereum (CoinDCX)', symbol: 'ETH', market: 'IN', kind: 'crypto', source: 'coindcx', qty: 0.01794521012936, avgPrice: 179770.5, lastPrice: 239523.9, value: 4298.31, invested: 3226.0, pnl: 1072.31, pnlPct: 33.23, oneDayChangePct: -0.27, assetType: 'Crypto', assetEnum: 'CRYPTO', basisSource: 'ledger', noLive: false },
  ],
};

(async () => {
  const { chromium } = loadPlaywright();
  const browser = await chromium.launch({ args: ['--no-sandbox'] });
  const ctx = await browser.newContext({ serviceWorkers: 'block' });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push('PAGEERROR: ' + e.message));

  await page.route(/indmoney\/assets/, route =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(FIXTURE) }));
  await page.route(/api\/forex/, route =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ usdInr: FX, ts: Date.now() }) }));

  await page.goto(BASE + '/', { waitUntil: 'domcontentloaded', timeout: 60000 });
  const pinInput = page.locator('input[type="password"], input[inputmode="numeric"]').first();
  await pinInput.waitFor({ state: 'visible', timeout: 30000 });
  await pinInput.fill(PIN);
  await page.keyboard.press('Enter');
  await page.waitForTimeout(6000);

  await page.locator('button, a', { hasText: /portfolio/i }).first().click();
  await page.waitForTimeout(8000);

  const results = [];
  const check = (name, cond, extra = '') => {
    results.push(`${cond ? '✅' : '❌'} ${name}${extra ? ' — ' + extra : ''}`);
    if (!cond) process.exitCode = 1;
  };

  const cards = await page.locator('.quantum-stat').allInnerTexts();
  const card = label => cards.find(c => c.toUpperCase().includes(label)) || '';

  // A: INDIA section card — APP EXACT (2 decimals like the app)
  const inCard = card('INDIA · INDMONEY');
  check('A1 INDIA card invested ₹2,91,989.23 (app exact, 2dp)', /2,91,989\.23/.test(inCard), inCard.replace(/\n/g, ' | ').slice(0, 130));
  check('A2 INDIA card value ₹3,17,365.59', /3,17,365\.59/.test(inCard), '');
  check('A3 INDIA card returns +₹25,376.36', /\+₹25,376\.36/.test(inCard), '');
  check('A4 INDIA card carries APP EXACT badge', /APP EXACT/.test(inCard), '');

  // B: USA card — uncalibrated (live-FX invested = the old-world $1,582)
  const usCard = card('USA · INDMONEY');
  check('B1 USA card shows $1,582.22 invested (live FX, pre-calibration)', /\$1,582\.22/.test(usCard), usCard.replace(/\n/g, ' | ').slice(0, 130));
  check('B2 USA card has ✏️ Match App button', /Match App/.test(usCard), '');

  // C: the Match-App flow → calibrate to the app's $1,631.97
  await page.locator('button', { hasText: 'Match App' }).first().click();
  await page.waitForTimeout(300);
  const popoverInput = page.locator('input[placeholder="1631.97"]');
  await popoverInput.waitFor({ state: 'visible', timeout: 5000 });
  await popoverInput.fill('1631.97');
  await page.locator('button', { hasText: 'Save' }).first().click();
  await page.waitForTimeout(1500);
  const cards2 = await page.locator('.quantum-stat').allInnerTexts();
  const usCard2 = cards2.find(c => c.toUpperCase().includes('USA · INDMONEY')) || '';
  check('C1 USA invested becomes $1,631.97 (app parity)', /\$1,631\.9\d/.test(usCard2), usCard2.replace(/\n/g, ' | ').slice(0, 150));
  check('C2 USA unrealized ≈ +$55–65 (app 60.31 ± live drift — prices tick live)', /\+\$(5[5-9]|6\d)\.\d\d/.test(usCard2), (usCard2.match(/UNREALIZED[^$]*\+\$[\d.]+/) || [''])[0]);
  check('C3 USA card shows APP FX rate chip', /APP FX ₹92\.0/.test(usCard2), '');

  // D: CRYPTO card — app numbers via basis
  const crCard = cards2.find(c => c.toUpperCase().includes('CRYPTO · COINDCX')) || '';
  check('D1 CRYPTO invested ₹8,485.07', /8,485\.07/.test(crCard), crCard.replace(/\n/g, ' | ').slice(0, 130));
  check('D2 CRYPTO value ≈ ₹10,03x', /10,03\d\.\d\d/.test(crCard), '');
  check('D3 CRYPTO P&L +₹1,54x (app 1,513 + live drift)', /\+₹1,5[45]\d\.\d\d/.test(crCard), '');

  // E: All-Markets bar present with identity total
  const bar = (await page.locator('.quantum-panel').allInnerTexts()).find(t => /inv ₹/.test(t)) || '';
  check('E1 All-Markets bar renders', /ALL MARKETS/i.test(bar), bar.replace(/\n/g, ' | ').slice(0, 130));
  check('E2 bar total P&L ≈ +₹37,xxx (INR-native identity, live drift ok)', /\+₹37,\d{3}/.test(bar), (bar.match(/\+₹37,\d{3}/) || ['(none)'])[0]);

  // F: table rows — app-parity Qty @ Avg
  const body = await page.locator('#root').innerText();
  check('F1 SMH row: Qty 1.9242 @ $489.35 (calibrated avg — was $474.46 live-FX)', /Qty: 1\.9242 @ \$489\.3\d/.test(body), (body.match(/Qty: 1\.9242[^\n]*/) || ['(none)'])[0]);
  check('F2 BTC row: Qty 0.000736 @ ₹7145470 (micro-qty precision + basis avg = invested/qty)', /Qty: 0\.000736 @ ₹71454\d\d\.\d\d/.test(body), (body.match(/Qty: 0\.000736[^\n]*/) || ['(none)'])[0]);

  // G: Set Basis modal opens
  await page.locator('button', { hasText: 'Set Basis' }).first().click();
  await page.waitForTimeout(400);
  const modalVisible = await page.locator('text=Crypto Cost Basis').first().isVisible().catch(() => false);
  check('G1 Set Basis modal opens with per-coin inputs', modalVisible, '');
  // close via ✕
  if (modalVisible) {
    await page.locator('.quantum-modal button[aria-label="Close"]').first().click();
    await page.waitForTimeout(300);
  }

  // H: zero page errors
  check('H1 zero page JS errors', errors.length === 0, errors.join('; ').slice(0, 200));

  console.log('===== v5.2 APP-PARITY CHECK =====');
  results.forEach(r => console.log(r));
  console.log(`\n${results.every(r => r.startsWith('✅')) ? 'ALL PASSED' : 'FAILURES PRESENT'}`);
  await page.screenshot({ path: 'scripts/v53-portfolio-app-parity.png', fullPage: true });
  await browser.close();
})().catch(e => { console.error('FATAL:', e.message); process.exit(1); });
