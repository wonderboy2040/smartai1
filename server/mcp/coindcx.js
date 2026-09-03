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
import { loadJSON, saveJSON } from '../lib/store.js';
import { fetchCoinDcxTickers } from '../cryptoStream.js';
import { durablePut } from './durable.js';

const CREDS_FILE = 'mcp-coindcx.json';
const API_BASE = 'https://api.coindcx.com';
const BALANCES_PATH = '/exchange/v1/users/balances';
const REQUEST_TIMEOUT_MS = 10000;
// Assets below this INR value are exchange dust — not portfolio rows.
const DUST_INR = 10;

// ---------------- trade history (cost basis) ----------------
// CoinDCX's app shows "Invested ₹X" per coin — that comes from the user's
// trade ledger, not the balances endpoint. We try the documented trade /
// order-history endpoints (whichever the API key's permission allows) and
// compute an avg-cost basis. A view-only key without trade permission
// simply yields no basis → the row honestly shows P&L n/a (the user can
// then enter a manual basis from the app's coin pages — see below).
//
// v5.2 endpoint fix: the DOCUMENTED trade-history endpoint is
// POST /exchange/v1/orders/trade_history (limit max 5000, from_id cursor).
// The previously-tried paths are kept as fallbacks — /exchange/v1/trades is
// the PUBLIC market-trades endpoint (signed calls fail), which is why
// basis never resolved with a valid key.
const TRADES_PATHS = [
  '/exchange/v1/orders/trade_history',         // DOCUMENTED: user's executed trades
  '/exchange/v1/trades',                        // list executed trades (page/size)
  '/exchange/v1/users/trades',                  // older docs variant
  '/exchange/v1/orders/fetch_order_history',    // order history (filled orders)
];
const TRADES_MAX_PAGES = 10; // 10 × 100 = 1000 trades — plenty for a real wallet
const TRADES_PAGE_LIMIT = 2000; // per-call limit for the documented endpoint

// ---------------- credential store (server-side only) ----------------
function loadCreds() {
  return loadJSON(CREDS_FILE, null);
}
function saveCreds(creds) {
  saveJSON(CREDS_FILE, creds);
  // Durable (encrypted GitHub) write-through — API keys survive Render's
  // ephemeral-disk restarts. Best-effort, never throws.
  try { durablePut(CREDS_FILE, creds); } catch { /* optional */ }
  return creds;
}

// ---------------- manual cost basis (fallback store) ----------------
// When the API key has no trade-history permission, the trade-ledger basis
// is unavailable. The user can enter per-coin invested amounts ONCE (from
// the CoinDCX app's coin pages) — they persist across syncs and server
// restarts, and are used ONLY when the ledger basis is missing. Rows then
// show app-parity Invested / Avg Price / P&L.
const MANUAL_BASIS_FILE = 'mcp-coindcx-basis.json';
// v6.1: the FILE shape is now { basis: {BTC: 123}, updatedAt } so the
// durable boot-restore can compare freshness (a legacy flat file/backup
// from <= v6.0 is normalized on load). The module's API (flat maps in/out)
// is unchanged — callers and tests are unaffected.
function loadManualBasis() {
  const raw = loadJSON(MANUAL_BASIS_FILE, {});
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  if (raw.basis && typeof raw.basis === 'object' && !Array.isArray(raw.basis)) {
    return raw.basis;
  }
  // Legacy flat shape { BTC: 123 } (pre-v6.1 file or durable backup) —
  // the whole object IS the basis map.
  const { updatedAt, ...coins } = raw;
  return coins;
}
function saveManualBasis(basis) {
  const store = { basis, updatedAt: Date.now() };
  saveJSON(MANUAL_BASIS_FILE, store);
  try { durablePut(MANUAL_BASIS_FILE, store); } catch { /* optional */ }
  return basis;
}
/** Set (or clear, when invested == null) one coin's manual invested amount. */
export function setManualBasis(coin, invested) {
  const key = String(coin || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (!key) throw Object.assign(new Error('coin is required'), { status: 400, code: 'BAD_REQUEST' });
  const basis = loadManualBasis();
  if (invested == null || !(Number(invested) > 0)) delete basis[key];
  else basis[key] = Math.round(Number(invested) * 100) / 100;
  saveManualBasis(basis);
  return basis;
}
/** Clear one coin (or the whole store when coin is omitted). */
export function clearManualBasis(coin) {
  if (!coin) { saveManualBasis({}); return {}; }
  return setManualBasis(coin, null);
}
export function getManualBasis() {
  return loadManualBasis();
}
// Merge rule: trade-ledger basis wins per coin; manual basis fills the
// coins the ledger couldn't price (or the whole set when there's no ledger).
function mergeBasis(ledgerBasis, manualBasis) {
  if (!ledgerBasis && !manualBasis) return null;
  const out = { ...(ledgerBasis || {}) };
  for (const [coin, inv] of Object.entries(manualBasis || {})) {
    if (typeof inv !== 'number' || !(inv > 0)) continue;
    const led = out[coin];
    if (!led || !(led.invested > 0)) out[coin] = { qty: null, invested: inv, avgPrice: null, manual: true };
  }
  return Object.keys(out).length ? out : null;
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
    // v5.2 diagnostics: WHY is crypto P&L n/a? costBasis = trade-ledger
    // result (source endpoint + trades count); manualBasis = user-entered
    // per-coin invested (the view-only-key fallback).
    costBasis: c.costBasis || null,
    manualBasis: loadManualBasis(),
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
    // Status prefix so a 404/401 is unmistakable in user-facing errors
    // ("[404] ..." = CoinDCX endpoint, vs a body-less route 404 = the app
    // is running on a static mirror — see StaticMirrorBanner).
    const err = new Error(`[${r.status}] ${String(msg).slice(0, 180)}`);
    err.status = r.status;
    throw err;
  }
  return json;
}

// ---------------- balances fetch with pagination ----------------
// CoinDCX docs use STRING page/size values; one page holds at most
// `size` records. Loop until a short page arrives (max 5 pages —
// far beyond any real wallet's distinct-currency count).
export async function fetchBalancesSigned(apiKey, secret) {
  const PAGE_SIZE = 100;
  const MAX_PAGES = 5;
  let merged = [];
  for (let page = 1; page <= MAX_PAGES; page++) {
    const raw = await coindcxPrivate(BALANCES_PATH, apiKey, secret, {
      page: String(page),
      size: String(PAGE_SIZE),
    });
    const list = Array.isArray(raw) ? raw : [];
    merged = merged.concat(list);
    if (list.length < PAGE_SIZE) break; // last page reached
  }
  return merged;
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
  const raw = await fetchBalancesSigned(apiKey.trim(), secret.trim());
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
// basis: { BTC: { qty, invested, avgPrice }, ... } from the trade
// ledger (computeCostBasis). Rows with a basis get invested/pnl/pnlPct
// exactly like the CoinDCX app shows; without one they stay null and
// the frontend marks them P&L n/a (never fake a number).
export function mapBalancesToAssets(balances, tickers, usdInr = 84, basis = null) {
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

    const binfo = basis && basis[b.base] && basis[b.base].invested > 0 ? basis[b.base] : null;
    // avg price: ledger avg when present; manual basis → invested/qty.
    const bAvg = binfo ? (binfo.avgPrice ?? (binfo.qty > 0 ? binfo.invested / binfo.qty : binfo.invested / b.qty)) : null;

    assets.push({
      id: `cdcx-${b.base}`,
      key: `cdcx:${b.base}`,
      name: cryptoName(b.base),
      symbol: b.base,
      market: 'IN',               // CoinDCX trades INR pairs → IN market pricing
      kind: 'crypto',
      source: 'coindcx',
      qty: b.qty,
      avgPrice: binfo ? round2(bAvg) : null, // avg INR cost per unit
      lastPrice: round2(price),
      value: round2(value),
      invested: binfo ? round2(binfo.invested) : null, // INR cost basis (trade ledger)
      pnl: binfo ? round2(value - binfo.invested) : null,
      pnlPct: binfo ? round2(((value - binfo.invested) / binfo.invested) * 100) : null,
      oneDayChangePct: pair && inrT ? (parseFloat(inrT.change_24_hour) || 0) : null,
      assetType: 'Crypto',
      assetEnum: 'CRYPTO',
      basisSource: binfo ? (binfo.manual ? 'manual' : 'ledger') : null,
      noLive: false,              // crypto ticks live via SSE/poller
    });
  }
  return assets;
}

// ---------------- trade history → avg-cost basis (PURE) ----------------
// Normalize either shape (executed trades list OR order history):
//   trades:   { side, market, quantity, price, fee, timestamp }
//   orders:   { side, market, total_quantity, remaining_quantity,
//               price, average_price, fee, status, timestamp }
// Only FILLED quantity counts (order history mixes open/cancelled).
export function normalizeTrades(raw) {
  const list = Array.isArray(raw) ? raw
    : (Array.isArray(raw?.orders) ? raw.orders
      : (Array.isArray(raw?.data) ? raw.data : []));
  const out = [];
  for (const t of list) {
    if (!t || typeof t !== 'object') continue;
    const side = String(t.side || '').toLowerCase();
    if (side !== 'buy' && side !== 'sell') continue;
    const market = String(t.market || t.pair || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
    if (!market || market.length < 5) continue;
    // Base = market minus quote suffix (BTCINR → BTC).
    const quote = market.endsWith('USDT') ? 'USDT'
      : (market.endsWith('INR') ? 'INR' : null);
    if (!quote) continue; // unknown quote currency — skip rather than guess
    const base = market.slice(0, market.length - quote.length);
    if (!base || base === 'INR' || base === 'USDT') continue;

    const filledQty = typeof t.quantity === 'number'
      ? t.quantity
      : numOrNull(t.filled_quantity ?? t.quantity);
    let qty = filledQty;
    let price = numOrNull(t.price ?? t.price_per_unit ?? t.average_price ?? t.avg_price ?? t.avgPrice);
    if (qty == null && typeof t.total_quantity === 'number') {
      // order-history: filled = total − remaining
      const rem = numOrNull(t.remaining_quantity) ?? 0;
      qty = Math.max(0, t.total_quantity - rem);
      price = price ?? numOrNull(t.average_price);
    }
    if (qty == null || !(qty > 0)) continue;

    // Order history: skip anything not (partially) filled.
    const status = String(t.status || '').toLowerCase();
    if (status && !/fill|complete|partial|execut/.test(status)) continue;

    if (!(price > 0)) continue;
    const fee = numOrNull(t.fee ?? t.fees ?? t.fee_amount) ?? 0;
    const ts = numOrNull(t.timestamp ?? t.created_at ?? t.time) ?? 0;
    out.push({ side, base, quote, qty, price, fee, ts });
  }
  return out;
}

// Avg-cost walk over the ledger:
//   buy  → qty += q, cost += q·price + fee   (fees are part of cost)
//   sell → qty −= q at avg cost (realized)   (sell fees hit realized, not basis)
// Result: per-coin { qty, invested, avgPrice } for the REMAINING balance.
// USDT-quote trades are converted at the CURRENT usdInr (approximation —
// historical per-trade FX is not exposed by the API).
export function computeCostBasis(trades, usdInr = 84) {
  const rate = (typeof usdInr === 'number' && usdInr > 50 && usdInr < 150) ? usdInr : 84;
  const coins = new Map(); // base → { qty, cost }
  const sorted = [...(Array.isArray(trades) ? trades : [])].sort((a, b) => (a.ts || 0) - (b.ts || 0));
  for (const t of sorted) {
    if (!t || typeof t !== 'object') continue;
    const fx = t.quote === 'USDT' ? rate : 1; // INR-quote trades are native
    const c = coins.get(t.base) || { qty: 0, cost: 0 };
    const q = Math.abs(Number(t.qty) || 0);
    if (!(q > 0)) continue;
    if (t.side === 'buy') {
      c.qty += q;
      c.cost += q * (Number(t.price) || 0) * fx + (Number(t.fee) || 0) * fx;
    } else { // sell at average cost
      const avg = c.qty > 0 ? c.cost / c.qty : 0;
      const sold = Math.min(q, c.qty);
      c.qty -= sold;
      c.cost -= avg * sold;
      if (c.qty <= 1e-10) { c.qty = 0; c.cost = 0; } // fully closed → reset
    }
    coins.set(t.base, c);
  }
  const out = {};
  for (const [base, c] of coins) {
    if (c.qty > 0 && c.cost > 0) {
      out[base] = { qty: c.qty, invested: c.cost, avgPrice: c.cost / c.qty };
    }
  }
  return out;
}

// Try each trades endpoint with the user's key; return { trades, endpoint }
// or null when none is reachable/allowed (view-only key without trade
// permission is a legitimate outcome — the caller then runs basis-less).
export async function fetchCoinDcxTrades(apiKey, secret) {
  for (const path of TRADES_PATHS) {
    try {
      const merged = [];
      if (path === '/exchange/v1/orders/trade_history') {
        // Documented endpoint: cursor pagination via from_id (older-than),
        // limit max 5000. Loop until a short page arrives.
        let fromId = null;
        for (let i = 0; i < TRADES_MAX_PAGES; i++) {
          const body = { limit: String(TRADES_PAGE_LIMIT) };
          if (fromId != null) body.from_id = String(fromId);
          const raw = await coindcxPrivate(path, apiKey, secret, body);
          const list = Array.isArray(raw) ? raw
            : (Array.isArray(raw?.orders) ? raw.orders
              : (Array.isArray(raw?.data) ? raw.data : []));
          if (!Array.isArray(list) || list.length === 0) break;
          merged.push(...list);
          // Cursor = the smallest numeric id in this batch (responses are
          // newest-first); stop when the page is short or no ids exist.
          const ids = list.map(t => Number(t?.id)).filter(n => Number.isFinite(n) && n > 0);
          if (list.length < TRADES_PAGE_LIMIT || ids.length === 0) break;
          fromId = Math.min(...ids);
        }
      } else {
        // Legacy endpoints: classic page/size pagination.
        for (let page = 1; page <= TRADES_MAX_PAGES; page++) {
          const raw = await coindcxPrivate(path, apiKey, secret, {
            page: String(page),
            size: '100',
          });
          const list = Array.isArray(raw) ? raw
            : (Array.isArray(raw?.orders) ? raw.orders
              : (Array.isArray(raw?.data) ? raw.data : []));
          merged.push(...list);
          if (!Array.isArray(list) || list.length < 100) break; // last page
        }
      }
      // An endpoint that answers with a list we can parse wins — even an
      // empty one (a wallet funded by transfers, not trades).
      return { trades: normalizeTrades(merged), endpoint: path };
    } catch (err) {
      const status = err?.status;
      if (status === 401 || status === 403 || status === 404 || status === 400) continue; // not allowed here → next
      throw err; // network/auth-level failure — let the caller degrade
    }
  }
  return null;
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
// CoinDCX assets (degraded-tolerant). Trade-history fetch is best-effort:
// a key without trade permission simply leaves rows basis-less (honest).
export async function fetchCoinDcxAssets(usdInr) {
  const creds = loadCreds();
  if (!creds?.apiKey || !creds?.secret) return null; // not connected
  const [raw, tickers, tradesOut] = await Promise.all([
    fetchBalancesSigned(creds.apiKey, creds.secret),
    fetchCoinDcxTickers(),
    fetchCoinDcxTrades(creds.apiKey, creds.secret).catch(() => null),
  ]);
  const balances = normalizeBalances(raw);
  const ledgerBasis = tradesOut ? computeCostBasis(tradesOut.trades, usdInr) : null;
  const manualBasis = loadManualBasis();
  const basis = mergeBasis(ledgerBasis, manualBasis);
  const assets = mapBalancesToAssets(balances, tickers, usdInr, basis);
  // Write-back: merge the sync metadata onto the CURRENT creds file. The
  // awaits above can span a concurrent reconnect (user rotating keys via
  // /connect) — spreading the STALE `creds` snapshot here would silently
  // revert the fresh keys (and durable-back the dead ones), killing every
  // later sync with [401] until the next manual reconnect. If the keys
  // changed mid-flight, skip the write-back entirely.
  const freshCreds = loadCreds();
  if (freshCreds?.apiKey === creds.apiKey && freshCreds?.secret === creds.secret) {
    saveCreds({
      ...freshCreds,
      lastSyncAt: Date.now(),
      balanceCount: balances.length,
      lastError: null,
      costBasis: {
        source: tradesOut?.endpoint || null,
        trades: tradesOut?.trades?.length ?? 0,
        coins: ledgerBasis ? Object.keys(ledgerBasis) : [],
        manualCoins: Object.keys(manualBasis || {}),
        computedAt: Date.now(),
      },
    });
  }
  return { assets, balanceCount: balances.length, basis };
}

// ---------------- test hooks ----------------
export function __resetCoinDcxForTests() {
  try { saveCreds({ apiKey: null, secret: null }); } catch { /* ignore */ }
}
export function __setCredsForTests(apiKey, secret, extra = {}) {
  saveCreds({ apiKey, secret, connectedAt: Date.now(), ...extra });
}
export function __coindcxPrivateForTests() { return coindcxPrivate; }
export function __fetchBalancesSignedForTests() { return fetchBalancesSigned; }
export function __fetchCoinDcxTradesForTests() { return (...args) => fetchCoinDcxTrades(...args); }
