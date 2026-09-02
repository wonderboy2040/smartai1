// ============================================================
// server/mcp/coindcx.js — CoinDCX account integration
// ------------------------------------------------------------
// The crypto half of the synced ASSET TABLE. INDMoney MCP covers
// INDIA (stocks/ETF/MF) + USA + whatever crypto it tracks; this
// module connects the user's actual CoinDCX exchange account via
// its official REST API (HMAC-SHA256 signed) and merges the live
// balances into the same asset-table snapshot:
//
//   • coindcxConnect(apiKey, secret)  — validates the pair with a
//     real /users/balances call BEFORE persisting (server/data/
//     mcp-coindcx.json — gitignored, never sent to the browser).
//   • fetchCoinDcxBalances()          — signed private call.
//   • normalizeBalances()             — defensive field mapping
//     (CoinDCX field names vary between doc versions — the
//     INDMoney lesson: parse EVERY plausible key).
//   • mapBalancesToAssets()           — pure: balances + public
//     ticker → valued crypto assets (INR pair, or USDT pair ×
//     live USD/INR), INR fiat + dust skipped.
//
// Pricing uses the SAME shared ticker round-trip as the SSE crypto
// stream + /api/crypto-prices (one cached upstream fetch, see
// server/cryptoStream.js) — no extra load on the 0.1-vCPU box.
//
// NOTE: the user should create the API key in CoinDCX with
// view/balance (read-only) permissions — we never place orders.
// ============================================================
import crypto from 'node:crypto';
import { loadJSON, saveJSON } from '../intraday/store.js';
import { fetchCoinDcxTickers } from '../cryptoStream.js';

const CREDS_FILE = 'mcp-coindcx.json';
const API_BASE = 'https://api.coindcx.com';
const BALANCES_PATH = '/exchange/v1/users/balances';
const REQUEST_TIMEOUT_MS = 10000;
// Assets below this INR value are exchange dust — not portfolio rows.
const DUST_INR = 10;

// ---------------- credential store (server-side only) ----------------
function loadCreds() {
  return loadJSON(CREDS_FILE, null);
}
function saveCreds(creds) {
  return saveJSON(CREDS_FILE, creds);
}
export function coindcxConnected() {
  const c = loadCreds();
  return !!(c && typeof c.apiKey === 'string' && c.apiKey && typeof c.secret === 'string' && c.secret);
}
export function coindcxStatus() {
  const c = loadCreds();
  if (!c || !c.apiKey || !c.secret) {
    return { connected: false, connectedAt: null, lastSyncAt: null, balanceCount: 0, lastError: null };
  }
  return {
    connected: true,
    connectedAt: c.connectedAt || null,
    lastSyncAt: c.lastSyncAt || null,
    balanceCount: typeof c.balanceCount === 'number' ? c.balanceCount : 0,
    lastError: c.lastError || null,
  };
}

// ---------------- signed private REST call ----------------
// CoinDCX auth: JSON body MUST include `timestamp` (ms epoch);
// signature = HMAC-SHA256(secret, exact request body string) hex;
// headers X-AUTH-APIKEY / X-AUTH-SIGNATURE. Body is sent byte-for-byte
// as signed — any reordering breaks the signature.
export async function coindcxPrivate(path, apiKey, secret, body = {}) {
  const payload = JSON.stringify({ ...body, timestamp: Date.now() });
  const signature = crypto.createHmac('sha256', secret).update(payload).digest('hex');
  const r = await fetch(`${API_BASE}${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-AUTH-APIKEY': apiKey,
      'X-AUTH-SIGNATURE': signature,
    },
    body: payload,
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  const text = await r.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* error body may be plain */ }
  if (!r.ok) {
    const msg = (json && (json.message || json.error || json.error_description)) || `CoinDCX API ${r.status}`;
    const err = new Error(String(msg).slice(0, 200));
    err.status = r.status;
    throw err;
  }
  return json;
}

// ---------------- balances (defensive normalizer) ----------------
// CoinDCX /users/balances returns per-currency records. Documented
// fields: currency_short_name / currency_name / balance /
// locked_balance / available_balance — but versions differ, so every
// plausible key is tried (lesson from the INDMoney schema hunt).
export function normalizeBalances(raw) {
  const list = Array.isArray(raw) ? raw : [];
  const out = [];
  for (const item of list) {
    if (!item || typeof item !== 'object') continue;
    const base = String(
      item.currency_short_name ?? item.currencyShortName ?? item.currency ?? item.short_name ?? item.symbol ?? ''
    ).trim().toUpperCase();
    if (!base) continue;
    const free = numOrNull(
      item.available_balance ?? item.availableBalance ?? item.balance ?? item.free ?? item.available ?? 0
    );
    const locked = numOrNull(
      item.locked_balance ?? item.lockedBalance ?? item.locked ?? item.in_order ?? 0
    );
    const total = (free ?? 0) + (locked ?? 0);
    if (total <= 0) continue;
    out.push({
      base,
      name: String(item.currency_name ?? item.currencyName ?? item.currency_full_name ?? item.full_name ?? base),
      qty: total,
      free: free ?? 0,
      locked: locked ?? 0,
    });
  }
  return out;
}
function numOrNull(v) {
  const n = typeof v === 'number' ? v : parseFloat(String(v ?? '').replace(/[^0-9.eE+-]/g, ''));
  return Number.isFinite(n) ? n : null;
}

// ---------------- connect / disconnect ----------------
export async function coindcxConnect(apiKey, secret) {
  if (!apiKey || !secret || typeof apiKey !== 'string' || typeof secret !== 'string') {
    const err = new Error('apiKey and secret are required');
    err.status = 400;
    throw err;
  }
  // Validate BEFORE persisting — a bad pair must never be stored.
  const raw = await coindcxPrivate(BALANCES_PATH, apiKey.trim(), secret.trim(), { page: 1, size: 200 });
  const balances = normalizeBalances(raw);
  saveCreds({
    apiKey: apiKey.trim(),
    secret: secret.trim(),
    connectedAt: Date.now(),
    lastSyncAt: Date.now(),
    balanceCount: balances.length,
    lastError: null,
    // preserve nothing else — fresh credentials
  });
  return { connected: true, balanceCount: balances.length, validated: true };
}

export function coindcxDisconnect() {
  const had = coindcxConnected();
  try { saveCreds({ apiKey: null, secret: null, connectedAt: null }); } catch { /* non-fatal */ }
  return { connected: false, wasConnected: had };
}

// ---------------- balances → assets (PURE) ----------------
// tickers: raw CoinDCX /exchange/ticker array (shared upstream).
// usdInr: used only when a coin has no INR pair but does have a
// USDT pair.
export function mapBalancesToAssets(balances, tickers, usdInr = 84) {
  const byMarket = new Map();
  for (const t of (Array.isArray(tickers) ? tickers : [])) {
    if (t && typeof t.market === 'string') byMarket.set(t.market, t);
  }
  const assets = [];
  for (const b of (Array.isArray(balances) ? balances : [])) {
    // INR is fiat cash on the exchange, not a crypto holding — skip.
    if (b.base === 'INR') continue;

    const inrT = byMarket.get(`${b.base}INR`);
    const usdT = !inrT ? byMarket.get(`${b.base}USDT`) : null;
    let price = null;
    let pair = null;
    if (inrT) {
      price = parseFloat(inrT.last_price);
      pair = `${b.base}INR`;
    } else if (usdT) {
      const usd = parseFloat(usdT.last_price);
      if (Number.isFinite(usd) && usd > 0) { price = usd * usdInr; pair = `${b.base}USDT`; }
    }
    if (!(price > 0)) continue; // unpriceable coin — skip rather than lie

    const value = price * b.qty;
    if (value < DUST_INR) continue; // dust filter

    assets.push({
      id: `cdcx-${b.base}`,
      key: `cdcx:${b.base}`,
      name: cryptoName(b.base),
      symbol: b.base,
      market: 'IN',               // CoinDCX trades INR pairs → IN market pricing
      kind: 'crypto',
      source: 'coindcx',
      qty: b.qty,
      avgPrice: null,             // no trade history pulled — P&L stays null
      lastPrice: round2(price),
      value: round2(value),
      invested: null,
      pnl: null,
      pnlPct: null,
      oneDayChangePct: pair && inrT ? (parseFloat(inrT.change_24_hour) || 0) : null,
      assetType: 'Crypto',
      assetEnum: 'CRYPTO',
      noLive: false,              // crypto ticks live via SSE/poller
    });
  }
  return assets;
}

const COIN_NAMES = new Map(Object.entries({
  BTC: 'Bitcoin', ETH: 'Ethereum', BNB: 'BNB', SOL: 'Solana', XRP: 'XRP', ADA: 'Cardano',
  DOGE: 'Dogecoin', TRX: 'TRON', DOT: 'Polkadot', MATIC: 'Polygon (MATIC)', POL: 'Polygon (POL)',
  LTC: 'Litecoin', LINK: 'Chainlink', AVAX: 'Avalanche', SHIB: 'Shiba Inu', WBTC: 'Wrapped Bitcoin',
  BCH: 'Bitcoin Cash', UNI: 'Uniswap', ATOM: 'Cosmos', XLM: 'Stellar', NEAR: 'NEAR Protocol',
  APT: 'Aptos', ARB: 'Arbitrum', OP: 'Optimism', FIL: 'Filecoin', ICP: 'Internet Computer',
  AAVE: 'Aave', MKR: 'Maker', INJ: 'Injective', SUI: 'Sui', SEI: 'Sei', TIA: 'Celestia',
  PEPE: 'Pepe', FLOKI: 'Floki', USDT: 'Tether (USDT)', USDC: 'USD Coin (USDC)',
  QNT: 'Quant', EGLD: 'MultiversX', ALGO: 'Algorand', VET: 'VeChain', HT: 'Huobi Token',
}));
function cryptoName(base) {
  const known = COIN_NAMES.get(base);
  return known ? `${known} (CoinDCX)` : `${base} (CoinDCX)`;
}

function round2(n) { return Math.round(n * 100) / 100; }

// ---------------- fetch + record one balance sync ----------------
// Called from portfolioSync.syncNow(). Throws on hard failure (creds
// invalid / API unreachable) so the sync engine can keep the previous
// CoinDCX assets (degraded-tolerant).
export async function fetchCoinDcxAssets(usdInr) {
  const creds = loadCreds();
  if (!creds?.apiKey || !creds?.secret) return null; // not connected
  const [raw, tickers] = await Promise.all([
    coindcxPrivate(BALANCES_PATH, creds.apiKey, creds.secret, { page: 1, size: 200 }),
    fetchCoinDcxTickers(),
  ]);
  const balances = normalizeBalances(raw);
  const assets = mapBalancesToAssets(balances, tickers, usdInr);
  saveCreds({
    ...creds,
    lastSyncAt: Date.now(),
    balanceCount: balances.length,
    lastError: null,
  });
  return { assets, balanceCount: balances.length };
}

// ---------------- test hooks ----------------
export function __resetCoinDcxForTests() {
  try { saveCreds({ apiKey: null, secret: null }); } catch { /* ignore */ }
}
export function __setCredsForTests(apiKey, secret, extra = {}) {
  saveCreds({ apiKey, secret, connectedAt: Date.now(), ...extra });
}
export function __coindcxPrivateForTests() { return coindcxPrivate; }
