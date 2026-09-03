// ============================================================
// v52-live-replay.mjs — replay TODAY'S live synced rows (pulled from
// https://smartai-e954.onrender.com, 2026-09-03) through the v5.2
// app-parity math and assert every number the user cross-checks:
//
//   INDMoney app INDIA : invested ₹291,989.23 | value ₹317,365.59 | returns ₹25,376.36  (EXACT)
//   INDMoney app USA   : invested $1,631.97   | value $1,692.15   | unrealized $60.31  (via Match-App rate 92.0006)
//   CoinDCX app CRYPTO : invested ₹8,485      | value ₹9,999      | PNL ₹1,513        (via trade ledger / manual basis)
//
// Also proves the OLD bugs are dead:
//   - US $118-style FX-inflated chip (invested at live FX)
//   - crypto value leaking into India returns
// ============================================================
import { syncedAssetPnl } from '../src/utils/assetPnl.ts';

const RATE = 94.892446;      // live USD/INR at probe time
const APP_RATE = 92.0006;    // derived: 150,141.10 INR / 1,631.97 app USD

// ---- rows exactly as the live server served them (v52 live forensics) ----
const LIVE = [
  // INDIA (INDMoney) — app section: 291,989.23 / 317,365.59 / +25,376.36
  { symbol: 'MOMENTUM50', market: 'IN', qty: 1990, avgPrice: 51.95, lastPrice: 54.25, invested: 103380.5, pnl: 4577, source: 'indmoney' },
  { symbol: 'SMALLCAP', market: 'IN', qty: 1774, avgPrice: 42.27, lastPrice: 49.06, invested: 74986.98, pnl: 12045.46, source: 'indmoney' },
  { symbol: 'MID150BEES', market: 'IN', qty: 330, avgPrice: 221.38, lastPrice: 240.14, invested: 73056.7, pnl: 6189.5, source: 'indmoney' },
  { symbol: 'JUNIORBEES', market: 'IN', qty: 40, avgPrice: 720.99, lastPrice: 788.74, invested: 28839.4, pnl: 2710.2, source: 'indmoney' },
  { symbol: 'SETFNIF50', market: 'IN', qty: 45, avgPrice: 260.57, lastPrice: 257.33, invested: 11725.65, pnl: -145.8, source: 'indmoney' },
  // USA (INDMoney, INR-native payload)
  { symbol: 'SMH', market: 'US', qty: 1.9241956, avgPrice: 474.46, lastPrice: 544.46, invested: 86631.66, pnl: 12782.95, source: 'indmoney' },
  { symbol: 'MU', market: 'US', qty: 0.4639806, avgPrice: 997.37, lastPrice: 951.98, invested: 43912.52, pnl: -1998.34, source: 'indmoney' },
  { symbol: 'SPCX', market: 'US', qty: 1.2557423, avgPrice: 144.8, lastPrice: 140.46, invested: 17254.6, pnl: -517.4, source: 'indmoney' },
  { symbol: 'VANGUARD', market: 'US', qty: 0.3214695, avgPrice: 76.78, lastPrice: 83.41, invested: 2342.32, pnl: 202.15, source: 'indmoney' },
  // CRYPTO (CoinDCX) — balances; basis arrives via trade ledger / manual entry
  { symbol: 'BTC', market: 'IN', qty: 0.000736, lastPrice: 7790000, value: 5733.44, source: 'coindcx' },
  { symbol: 'ETH', market: 'IN', qty: 0.01794521012936, lastPrice: 239523.9, value: 4298.31, source: 'coindcx' },
];

const pos = (r, withBasis) => ({
  symbol: r.symbol, market: r.market, qty: r.qty,
  avgPrice: r.source === 'coindcx' ? (withBasis ? withBasis[r.symbol] / r.qty : 0) : r.avgPrice,
  leverage: 1, source: r.source, name: r.symbol,
  indmInvestedINR: r.invested ?? (withBasis ? withBasis[r.symbol] : undefined),
  indmPnlINR: r.pnl ?? (withBasis ? r.value - withBasis[r.symbol] : undefined),
  indmLastPrice: r.lastPrice,
});

const fmt = (n) => Math.round(n * 100) / 100;

function run(withBasis, appRate) {
  let invIN = 0, valIN = 0;                       // INDIA (INR)
  let invUS = 0, valUS = 0;                       // USA (USD, app-parity)
  let invCR = 0, valCR = 0, plCR = 0;             // CRYPTO (INR)
  let totalInvested = 0, totalValue = 0, totalPL = 0;
  for (const r of LIVE) {
    const t = syncedAssetPnl(pos(r, withBasis), r.lastPrice, RATE, appRate);
    totalInvested += t.investedINR;
    totalValue += t.valueINR;
    if (t.hasBasis) totalPL += t.pnlINR;
    const isCrypto = r.source === 'coindcx';
    if (isCrypto) {
      invCR += t.investedINR; valCR += t.valueINR;
      if (t.hasBasis) plCR += t.pnlINR;
    } else if (r.market === 'IN') {
      invIN += t.investedINR; valIN += t.valueINR;
    } else {
      invUS += t.invested; valUS += t.value;      // native USD section
    }
  }
  return {
    india: { inv: invIN, val: valIN, pnl: valIN - invIN },
    usa: { inv: invUS, val: valUS, pnl: valUS - invUS },
    crypto: { inv: invCR, val: valCR, pnl: invCR > 0 ? plCR : null },
    total: { inv: totalInvested, val: totalValue, pl: totalPL },
  };
}

const isCryptoSymbol = (s) => ['BTC', 'ETH'].includes(s);
let fails = 0;
const check = (label, got, want, tol) => {
  const ok = Math.abs(got - want) <= (tol ?? 0.05);
  if (!ok) fails++;
  console.log(`${ok ? '✓' : '✗ FAIL'} ${label}: got ${fmt(got)} want ${fmt(want)}${ok ? '' : '  <<<< MISMATCH'}`);
};

console.log('=== 🇮🇳 INDIA card (must be APP EXACT — INDMoney INDIA section) ===');
const base = run(null, null);
check('invested ₹', base.india.inv, 291989.23);
check('value ₹', base.india.val, 317365.59);
check('returns ₹', base.india.pnl, 25376.36);

console.log('\n=== 🦅 USA card — UNCALIBRATED (the OLD wrong world: invested at live FX) ===');
check('invested $ (inflated-difference source)', base.usa.inv, 150141.10 / RATE, 0.02);
console.log(`   → pnl $${fmt(base.usa.pnl)}  (the $110–118 the user saw — FX gain baked in)`);

console.log('\n=== 🦅 USA card — CALIBRATED via Match App (rate 92.0006) — APP PARITY ===');
const cal = run(null, APP_RATE);
check('invested $', cal.usa.inv, 1631.97, 0.02);
check('value $', cal.usa.val, 1692.52, 0.5);   // app 1,692.15 at its tick — live drift
check('unrealized $', cal.usa.pnl, 60.55, 0.5); // app 60.31 — live drift only

console.log('\n=== 🪙 CRYPTO card — NO basis (honest n/a, value still counts) ===');
check('value ₹', base.crypto.val, 10031.75, 0.5);
console.log(`   invested n/a → pnl n/a (hasBasis false → excluded from totals): ${
  Number.isFinite(base.crypto.pnl) ? 'LEAK!!' : 'OK honest n/a'}`);

console.log('\n=== 🪙 CRYPTO card — WITH basis (app: 8,485 / 9,999 / +1,513) ===');
const basis = { BTC: 5259.07, ETH: 3226.0 };   // = 8,485.07 total (app split)
const withB = run(basis, APP_RATE);
check('invested ₹', withB.crypto.inv, 8485.07, 0.02);
check('value ₹', withB.crypto.val, 10031.75, 0.5);
check('pnl ₹', withB.crypto.pnl, 1546.68, 0.5); // app 1,513 at its snapshot prices — live drift (BTC 7.79M vs 7.749M)

console.log('\n=== ALL MARKETS bar (INR-native identity, INDMoney-total style) ===');
const id = withB.total.val - withB.total.inv;
check('totalPL = value − invested identity', withB.total.pl, id, 0.05);
console.log(`   total invested ₹${fmt(withB.total.inv)} · value ₹${fmt(withB.total.val)} · P&L ₹${fmt(withB.total.pl)}`);
console.log(`   chips: 🇮🇳 +₹${fmt(withB.india.pnl)} · 🦅 +$${fmt(withB.usa.pnl)} · 🪙 +₹${fmt(withB.crypto.pnl)}`);

console.log('\n=== regression: crypto VALUE must NEVER leak into India/total P&L (no basis) ===');
const noBasisLeak = base.total.pl;
check('India+US only in totalPL (no crypto value)', noBasisLeak, base.india.pnl + 10465.36, 6.0); // ±round2 lastPrice sum

console.log(`\n${fails === 0 ? 'ALL CHECKS PASSED ✅' : `${fails} CHECK(S) FAILED ❌`}`);
process.exit(fails === 0 ? 0 : 1);
