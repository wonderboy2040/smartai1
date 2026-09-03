// v5.2 live forensics — pull the REAL deployed rows and replay every metric
// path (server summarizeAssets + frontend calculateMetrics/syncedAssetPnl)
// to pinpoint the exact origin of the user's mismatched numbers.
// Usage: node scripts/v52-live-forensics.mjs
const BASE = process.env.PROBE_BASE || 'https://smartai-e954.onrender.com';
const PIN = process.env.PROBE_PIN || '2023';

const j = (r) => r.json();

async function main() {
  // ---- login ----
  const loginRes = await fetch(`${BASE}/api/auth/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ pin: PIN }),
  });
  if (!loginRes.ok) throw new Error('login failed: ' + loginRes.status);
  const cookie = (loginRes.headers.get('set-cookie') || '').split(';')[0];
  console.log('LOGIN OK, cookie:', cookie.slice(0, 20) + '...');

  const H = { Cookie: cookie, 'Content-Type': 'application/json' };

  // ---- assets + forex ----
  const [assets, forex, cdcxStatus] = await Promise.all([
    fetch(`${BASE}/api/mcp/indmoney/assets`, { headers: H }).then(j),
    fetch(`${BASE}/api/forex`, { headers: H }).then(j).catch(() => null),
    fetch(`${BASE}/api/mcp/coindcx/status`, { headers: H }).then(j).catch(() => null),
  ]);
  const rate = forex?.rate || forex?.usdInr || forex?.usd_inr || 94.89;
  console.log('\n=== FOREX rate:', rate, '===');
  console.log('=== sources:', JSON.stringify(assets.sources), ' coindcx:', JSON.stringify(assets.coindcx));
  console.log('=== syncedAt:', assets.syncedAt, ' counts:', JSON.stringify(assets.counts));
  console.log('=== SERVER summary (visible):', JSON.stringify(assets.summary));
  console.log('=== SERVER summaryAll:', JSON.stringify(assets.summaryAll));
  console.log('=== cdcx status:', JSON.stringify(cdcxStatus)?.slice(0, 400));

  const rows = assets.assets || [];
  console.log(`\n=== ${rows.length} VISIBLE rows ===`);
  const byMarket = { IN: [], US: [] };
  for (const a of rows) {
    byMarket[a.market] = byMarket[a.market] || [];
    byMarket[a.market].push(a);
  }

  // ---- replay SERVER summarizeAssets ----
  let sVal = 0, sInv = 0, sPnl = 0;
  for (const a of rows) {
    if (typeof a.value === 'number') sVal += a.value;
    if (typeof a.invested === 'number') {
      sInv += a.invested;
      if (typeof a.pnl === 'number') sPnl += a.pnl;
      else if (typeof a.value === 'number') sPnl += a.value - a.invested;
    }
  }
  console.log('\n=== REPLAYED server summary: invested', sInv.toFixed(2), 'value', sVal.toFixed(2), 'pnl', sPnl.toFixed(2));

  // ---- replay FRONTEND calculateMetrics (assetPnl semantics) ----
  // isCryptoSymbol equivalent (frontend): crypto kind or cdcx source
  const isCrypto = (p) => p.source === 'coindcx' || /BTC|ETH|XRP|SOL|DOGE|ADA|BNB|USDT|MATIC|TRX|DOT|LTC|LINK|BCH|SHIB/i.test(p.symbol || '');
  let totalInvested = 0, totalValue = 0, totalPL = 0;
  let invINR = 0, valINR = 0, invUSD = 0, valUSD = 0;
  let invCRY = 0, valCRY = 0, plCRY = 0;
  const detail = [];
  for (const a of rows) {
    const isUS = a.market === 'US';
    const fx = isUS ? rate : 1;
    const qty = a.qty > 0 ? a.qty : 1;
    const hasSyncPnl = typeof a.pnl === 'number' && Number.isFinite(a.pnl);
    const hasSyncInv = typeof a.invested === 'number' && a.invested > 0;
    let pnl, invested, value, hasBasis;
    if ((hasSyncPnl || hasSyncInv) && typeof a.lastPrice === 'number' && a.lastPrice > 0) {
      const basePnl = hasSyncPnl ? a.pnl / fx : null;
      const inv2 = hasSyncInv ? a.invested / fx : null;
      const delta = 0; // right-after-sync (live prices == seeds == sync price)
      pnl = basePnl != null ? basePnl + delta : (inv2 != null ? (a.lastPrice * qty - inv2) : delta);
      invested = inv2 ?? 0;
      value = inv2 != null ? inv2 + pnl : a.lastPrice * qty;
      hasBasis = hasSyncInv || hasSyncPnl;
    } else if (a.source === 'coindcx' && typeof a.lastPrice === 'number' && a.lastPrice > 0) {
      pnl = 0; invested = 0; value = a.lastPrice * qty; hasBasis = false;
    } else {
      // manual
      const posSize = (a.avgPrice ?? 0) * qty;
      invested = posSize; value = a.lastPrice * qty; pnl = value - posSize; hasBasis = posSize > 0;
    }
    const pnlINR = pnl * fx, invINRr = invested * fx, valINRr = value * fx;
    totalInvested += invINRr; totalValue += valINRr;
    if (isCrypto(a)) { invCRY += invINRr; valCRY += valINRr; if (hasBasis) plCRY += pnlINR; }
    else if (a.market === 'IN') { invINR += invested; valINR += value; }
    else { invUSD += invested; valUSD += value; }
    if (hasBasis) totalPL += pnlINR;
    detail.push({
      sym: a.symbol || a.name, mkt: a.market, src: a.source, qty, avg: a.avgPrice, last: a.lastPrice,
      inv: a.invested, val: a.value, pnl: a.pnl, hasBasis,
      calc: { pnlINR: +pnlINR.toFixed(1), valINR: +valINRr.toFixed(1) },
    });
  }
  console.log('\n=== REPLAYED frontend metrics (sync-time prices, live FX %.2f) ===', rate);
  console.log('totalInvested ₹%s  totalValue ₹%s  totalPL ₹%s', totalInvested.toFixed(2), totalValue.toFixed(2), totalPL.toFixed(2));
  console.log('INDIA  invested ₹%s  value ₹%s  pnl ₹%s', invINR.toFixed(2), valINR.toFixed(2), (valINR - invINR).toFixed(2));
  console.log('USA    invested $%s  value $%s  chip-pnl $%s  (pnlINR ₹%s)', invUSD.toFixed(2), valUSD.toFixed(2), (valUSD - invUSD).toFixed(2), ((valUSD - invUSD) * rate).toFixed(1));
  console.log('CRYPTO invested ₹%s  value ₹%s  pnl ₹%s', invCRY.toFixed(2), valCRY.toFixed(2), plCRY.toFixed(2));

  // ---- per-row table ----
  console.log('\n=== ROWS (qty / avg / last / invested / value / pnl) ===');
  for (const d of detail) {
    console.log(
      `${String(d.mkt).padEnd(3)} ${String(d.src || '-').padEnd(8)} ${String(d.sym).slice(0, 18).padEnd(18)} qty=${String(d.qty).padEnd(10)} avg=${String(d.avg).padEnd(10)} last=${String(d.last).padEnd(10)} inv=${String(d.inv).padEnd(11)} val=${String(d.val).padEnd(11)} pnl=${String(d.pnl).padEnd(10)} hasBasis=${d.hasBasis}`
    );
  }

  // ---- what the user's APP says, for comparison ----
  console.log('\n=== USER APP TRUTH: India 291,989.23 / 317,365.59 / +25,376.36 · US $1,631.97 / $1,692.15 / $60.31 · Crypto 8,485 / 9,999 / +1,513 ===');
  console.log('India diff (replayed pnl vs app):', (valINR - invINR - 25376.36).toFixed(2));
  console.log('US chip $ diff vs app $60.31:', ((valUSD - invUSD) - 60.31).toFixed(2));
  console.log('Crypto diff vs app +1,513:', (plCRY - 1513).toFixed(2));

  // hidden rows too — do they leak anywhere?
  console.log('\n=== HIDDEN rows:', (assets.hiddenAssets || []).length, JSON.stringify((assets.hiddenAssets || []).map(h => ({ k: h.key, m: h.market, src: h.source, val: h.value, inv: h.invested }))));
}

main().catch((e) => { console.error('FATAL:', e); process.exit(1); });
