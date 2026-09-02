// ============================================================
// server/mcp/symbols.js — exchange-symbol resolution for INDMoney holdings
// ------------------------------------------------------------
// INDMoney's MCP payload identifies holdings by NAME (and internal
// codes like INDS33035 / ISINs). To drive REAL-TIME prices in the
// SmartAI frontend we need tradeable symbols:
//   • India stocks/ETFs → NSE symbol   (Groww search v1, verified live)
//   • US stocks         → US ticker    (TradingView america scanner
//                                       description-equal filter, verified
//                                       live; + static mega-cap map)
//   • Crypto            → BTC/ETH/…    (static name map — the frontend
//                                       CoinDCX/Binance pollers use these)
// Mutual funds / FDs / bonds / EPF / NPS etc. have no live exchange
// price — they resolve to `noLive` and keep INDMoney's own unit price
// (NAV), refreshed on every portfolio sync.
//
// All remote lookups are cached in server/data/mcp-symbol-cache.json
// (name→symbol mappings are stable; cache TTL is generous).
// ============================================================
import { loadJSON, saveJSON } from '../intraday/store.js';

const SYMBOL_CACHE_FILE = 'mcp-symbol-cache.json';
const SYMBOL_CACHE_TTL = 14 * 24 * 60 * 60 * 1000; // 14 days
const LOOKUP_TIMEOUT = 6000;
const GROWW_SEARCH = 'https://groww.in/v1/api/search/v1/entity';
const TV_AMERICA_SCAN = 'https://scanner.tradingview.com/america/scan';

// ---------------- crypto name → exchange-agnostic symbol ----------------
// Frontend crypto pollers quote these against INR (CoinDCX) / USDT (Binance).
const CRYPTO_MAP = new Map(Object.entries({
  'bitcoin': 'BTC', 'btc': 'BTC', 'ethereum': 'ETH', 'ether': 'ETH', 'eth': 'ETH',
  'binance coin': 'BNB', 'bnb': 'BNB', 'binancecoin': 'BNB',
  'solana': 'SOL', 'sol': 'SOL', 'xrp': 'XRP', 'ripple': 'XRP',
  'cardano': 'ADA', 'ada': 'ADA', 'dogecoin': 'DOGE', 'doge': 'DOGE',
  'polkadot': 'DOT', 'dot': 'DOT', 'chainlink': 'LINK', 'link': 'LINK',
  'litecoin': 'LTC', 'ltc': 'LTC', 'avalanche': 'AVAX', 'avax': 'AVAX',
  'shiba inu': 'SHIB', 'shib': 'SHIB', 'shibainu': 'SHIB',
  'polygon': 'MATIC', 'matic': 'MATIC', 'uniswap': 'UNI', 'uni': 'UNI',
  'tether': 'USDT', 'usdt': 'USDT', 'usd coin': 'USDC', 'usdc': 'USDC',
  'wrapped bitcoin': 'WBTC', 'wbtc': 'WBTC', 'bitcoin cash': 'BCH', 'bch': 'BCH',
  'stellar': 'XLM', 'xlm': 'XLM', 'monero': 'XMR', 'xmr': 'XMR',
  'eos': 'EOS', 'tron': 'TRX', 'trx': 'TRX', 'cosmos': 'ATOM', 'atom': 'ATOM',
  'filecoin': 'FIL', 'fil': 'FIL', 'internet computer': 'ICP', 'icp': 'ICP',
  'near protocol': 'NEAR', 'near': 'NEAR', 'aptos': 'APT', 'apt': 'APT',
  'arbitrum': 'ARB', 'arb': 'ARB', 'optimism': 'OP', 'pepe': 'PEPE',
  'the graph': 'GRT', 'grt': 'GRT', 'aave': 'AAVE', 'maker': 'MKR',
  'injective': 'INJ', 'inj': 'INJ', 'sui': 'SUI', 'toncoin': 'TON',
}));

// ---------------- static US mega-cap fallback map ----------------
// Used only when INDMoney's payload carries no ticker and the TV
// description lookup fails (rare). Name keys are lowercase full names.
const US_NAME_MAP = new Map(Object.entries({
  'apple': 'AAPL', 'apple inc': 'AAPL', 'microsoft': 'MSFT', 'microsoft corp': 'MSFT',
  'alphabet': 'GOOGL', 'google': 'GOOGL', 'alphabet inc': 'GOOGL', 'amazon': 'AMZN',
  'amazon com inc': 'AMZN', 'meta platforms': 'META', 'meta': 'META', 'facebook': 'META',
  'nvidia': 'NVDA', 'nvidia corp': 'NVDA', 'tesla': 'TSLA', 'tesla inc': 'TSLA',
  'netflix': 'NFLX', 'netflix inc': 'NFLX', 'intel': 'INTC', 'intel corp': 'INTC',
  'amd': 'AMD', 'advanced micro devices': 'AMD', 'qualcomm': 'QCOM',
  'broadcom': 'AVGO', 'salesforce': 'CRM', 'oracle': 'ORCL', 'adobe': 'ADBE',
  'cisco': 'CSCO', 'ibm': 'IBM', 'international business machines': 'IBM',
  'johnson & johnson': 'JNJ', 'johnson and johnson': 'JNJ', 'jpmorgan chase': 'JPM',
  'jpmorgan': 'JPM', 'visa': 'V', 'mastercard': 'MA', 'walmart': 'WMT',
  'wells fargo': 'WFC', 'bank of america': 'BAC', 'goldman sachs': 'GS',
  'morgan stanley': 'MS', 'coca cola': 'KO', 'coca-cola': 'KO', 'pepsico': 'PEP',
  'mcdonald': 'MCD', 'mcdonalds': 'MCD', 'starbucks': 'SBUX', 'nike': 'NKE',
  'disney': 'DIS', 'walt disney': 'DIS', 'boeing': 'BA', 'lockheed martin': 'LMT',
  'exxon mobil': 'XOM', 'exxonmobil': 'XOM', 'chevron': 'CVX', 'pfizer': 'PFE',
  'merck': 'MRK', 'abbvie': 'ABBV', 'eli lilly': 'LLY', 'unitedhealth': 'UNH',
  'verizon': 'VZ', 'at&t': 'T', 'comcast': 'CMCSA', 'paypal': 'PYPL',
  'uber': 'UBER', 'airbnb': 'ABNB', 'shopify': 'SHOP', 'snowflake': 'SNOW',
  'palantir': 'PLTR', 'crowdstrike': 'CRWD', 'cloudflare': 'NET',
  'spdr s&p 500 etf trust': 'SPY', 'vanguard s&p 500 etf': 'VOO',
  'invesco qqq trust': 'QQQ', 'ishares core s&p 500 etf': 'IVV',
  'financial select sector spdr fund': 'XLF', 'energy select sector spdr fund': 'XLE',
  'smh etf': 'SMH', 'vanEck semiconductor ETF': 'SMH', 'vanguard total stock market etf': 'VTI',
  'ark innovation etf': 'ARKK', 'vanguard growth etf': 'VUG',
  'vanguard information technology etf': 'VGT', 'brown advisory sustainable growth': 'BASGX',
}));

// NSE symbol shape: 2-20 chars, letters/digits/-& (e.g. M&M, BSE-A).
const NSE_SYM_RE = /^[A-Z0-9][A-Z0-9&-]{1,19}$/;
// US ticker shape: 1-5 letters (occasionally with . or - for share classes).
const US_TICKER_RE = /^[A-Z][A-Z.\-]{0,5}$/;

function normName(s) {
  return String(s || '').toLowerCase().replace(/[^a-z0-9&\s]/g, ' ').replace(/\s+/g, ' ').trim();
}

// ---------------- persistent name→symbol cache ----------------
let _symCache = null;
function symbolCache() {
  if (_symCache) return _symCache;
  _symCache = loadJSON(SYMBOL_CACHE_FILE, { map: {} });
  if (!_symCache.map || typeof _symCache.map !== 'object') _symCache.map = {};
  return _symCache;
}
function cacheGet(key) {
  const rec = symbolCache().map[key];
  if (!rec || typeof rec !== 'object') return undefined; // unresolved marker is {miss:1}
  if (Date.now() - (rec.ts || 0) > SYMBOL_CACHE_TTL) return undefined;
  return rec.symbol != null ? rec.symbol : null;
}
function cachePut(key, symbol) {
  const c = symbolCache();
  c.map[key] = { symbol, ts: Date.now() };
  // keep the cache bounded
  const keys = Object.keys(c.map);
  if (keys.length > 400) {
    keys.sort((a, b) => c.map[a].ts - c.map[b].ts);
    for (const k of keys.slice(0, keys.length - 400)) delete c.map[k];
  }
  saveJSON(SYMBOL_CACHE_FILE, c);
}

// ---------------- test hook ----------------
let _fetchImpl = null; // injected in tests
export function __setFetchForTests(fn) { _fetchImpl = fn; }
function uf(url, opts) { return (_fetchImpl || fetch)(url, opts); }

// ---------------- Groww (India) ----------------
// GET /v1/api/search/v1/entity?q=<name> → content[] with title,
// entity_type (Stocks/ETF/Scheme/Future/Option…), nse_scrip_code,
// company_short_name. Verified live: resolves both the user's ETFs
// ("Motilal Oswal Nifty 500 Momentum 50 ETF" → MOMENTUM50,
//  "Nippon India ETF Nifty Midcap 150" → MID150BEES).
async function growwSearch(name) {
  try {
    const r = await uf(`${GROWW_SEARCH}?q=${encodeURIComponent(name)}`, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120 Safari/537.36',
        'Accept': 'application/json',
      },
      signal: AbortSignal.timeout(LOOKUP_TIMEOUT),
    });
    if (!r.ok) return null;
    const j = await r.json();
    return Array.isArray(j?.content) ? j.content : null;
  } catch { return null; }
}

function nseSymbolFrom(item) {
  if (!item || typeof item !== 'object') return null;
  const et = String(item.entity_type || '').toUpperCase();
  if (et === 'FUTURE' || et === 'OPTION' || et === 'OPTION_CHAIN' || et === 'DERIVATIVE') return null;
  // Mutual-fund schemes are NAV-priced — NOT exchange symbols.
  if (et === 'SCHEME' || et === 'MUTUAL_FUND' || et === 'MF') return null;
  let sym = item.nse_scrip_code || item.company_short_name || item.symbol;
  if (typeof sym !== 'string') return null;
  sym = sym.replace(/\s+/g, '').toUpperCase();
  // Rights entitlements / odd scrips should not become live symbols.
  if (sym.includes('-RE') || sym.includes('-BE') || sym.length > 20) return null;
  return NSE_SYM_RE.test(sym) ? sym : null;
}

// Best-match Groww entry for a holding name. Prefers an exact title match;
// else the first Stocks/ETF entry whose title shares ≥3 significant words.
export function pickGrowwMatch(name, content) {
  if (!Array.isArray(content) || content.length === 0) return null;
  const want = normName(name);
  if (!want) return null;
  const scored = [];
  for (const item of content) {
    const sym = nseSymbolFrom(item);
    if (!sym) continue;
    const title = normName(item.title);
    const et = String(item.entity_type || '').toUpperCase();
    if (title === want) return { symbol: sym, exact: true };
    const wantWords = want.split(' ').filter(w => w.length > 2);
    const titleWords = new Set(title.split(' ').filter(w => w.length > 2));
    const overlap = wantWords.filter(w => titleWords.has(w)).length;
    if (wantWords.length >= 2 && overlap >= Math.min(3, wantWords.length)) {
      scored.push({ symbol: sym, score: overlap + (et === 'ETF' || et === 'STOCKS' ? 1 : 0) });
    }
  }
  scored.sort((a, b) => b.score - a.score);
  return scored.length ? { symbol: scored[0].symbol, exact: false } : null;
}

export async function resolveIndSymbol(name) {
  const key = `IN:${normName(name)}`;
  const cached = cacheGet(key);
  if (cached !== undefined) return cached;
  const match = pickGrowwMatch(name, await growwSearch(name));
  const symbol = match ? match.symbol : null;
  cachePut(key, symbol);
  return symbol;
}

// ---------------- US ticker ----------------
async function tvAmericaDescriptionLookup(name) {
  try {
    const r = await uf(TV_AMERICA_SCAN, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=UTF-8' },
      body: JSON.stringify({
        filter: [{ left: 'description', operation: 'equal', right: String(name) }],
        columns: ['name', 'description'],
      }),
      signal: AbortSignal.timeout(LOOKUP_TIMEOUT),
    });
    if (!r.ok) return null;
    const j = await r.json();
    const first = Array.isArray(j?.data) ? j.data[0] : null;
    if (!first) return null;
    // j.data[0].s = "NASDAQ:AAPL" → AAPL
    const ticker = String(first.s || '').split(':')[1] || '';
    return /^[A-Z][A-Z.\-]{0,5}$/.test(ticker) ? ticker : null;
  } catch { return null; }
}

export async function resolveUsSymbol(name, rawSymbol) {
  // 1) INDMoney often carries the ticker directly (A-Z, ≤5-6 chars).
  const sym = typeof rawSymbol === 'string' ? rawSymbol.trim().toUpperCase() : '';
  if (US_TICKER_RE.test(sym)) return sym;
  const key = `US:${normName(name)}`;
  const cached = cacheGet(key);
  if (cached !== undefined) return cached;
  let out = US_NAME_MAP.get(normName(name)) || null;
  if (!out) out = await tvAmericaDescriptionLookup(name);
  cachePut(key, out);
  return out;
}

// ---------------- crypto ----------------
export function resolveCryptoSymbol(name, rawSymbol) {
  // Case-insensitive map lookup (names/symbols arrive in mixed case).
  const tryKey = (s) => {
    const k = String(s || '').trim().toLowerCase();
    return k && CRYPTO_MAP.has(k) ? CRYPTO_MAP.get(k) : null;
  };
  const bySym = tryKey(rawSymbol);
  if (bySym) return bySym;
  const byName = tryKey(name);
  if (byName) return byName;
  // "Bitcoin (BTC)" or "BTC — Bitcoin"
  const paren = /\(([^)]{2,6})\)\s*$/.exec(String(name || ''));
  if (paren) {
    const p = tryKey(paren[1]);
    if (p) return p;
  }
  return null;
}

// ---------------- decision engine ----------------
// Holding (from fetchPortfolio) + its stamped assetEnum → market/kind/live.
// Exported pure so tests can drive it without any network.
export function classifyHolding(h) {
  const enumv = String(h?.assetEnum || '').toUpperCase();
  const label = String(h?.assetType || '');
  const name = String(h?.name || '');

  if (enumv === 'CRYPTO' || /crypto/i.test(label)) {
    return { market: 'IN', kind: 'crypto', tryResolve: 'crypto' };
  }
  if (enumv === 'US_STOCK') {
    return { market: 'US', kind: 'stock', tryResolve: 'us' };
  }
  if (enumv === 'IND_STOCK' || enumv === '' && /stock|etf/i.test(label)) {
    // ETFs from INDMoney arrive under IND_STOCK with "ETF" in the name.
    const kind = /etf/i.test(name) || /etf/i.test(label) ? 'etf' : 'stock';
    return { market: 'IN', kind, tryResolve: 'ind' };
  }
  if (enumv === 'MF' || /mutual fund/i.test(label)) {
    return { market: 'IN', kind: 'mf', tryResolve: null }; // NAV-based, no exchange symbol
  }
  // BOND/EPF/NPS/SA/FD/INSURANCE/VEHICLE/RE + anything else: INR, not live.
  const kind = /gold/i.test(label) ? 'gold'
    : /bond/i.test(label) ? 'bond'
    : /retirement|epf|nps|ppf/i.test(`${enumv} ${label}`) ? 'retirement'
    : /fixed income|fd/i.test(`${enumv} ${label}`) ? 'fixed'
    : 'other';
  return { market: 'IN', kind, tryResolve: null };
}

// Resolve ONE holding → { market, kind, symbol, noLive }.
export async function resolveHoldingSymbol(h) {
  const cls = classifyHolding(h);
  if (cls.tryResolve === 'crypto') {
    const sym = resolveCryptoSymbol(h?.name, h?.symbol);
    return { ...cls, symbol: sym, noLive: !sym };
  }
  if (cls.tryResolve === 'us') {
    const sym = await resolveUsSymbol(h?.name, h?.symbol);
    return { ...cls, symbol: sym, noLive: !sym };
  }
  if (cls.tryResolve === 'ind') {
    // A payload-provided ticker-ish symbol wins if it is NSE-shaped.
    const raw = typeof h?.symbol === 'string' ? h.symbol.trim().toUpperCase() : '';
    if (raw.length >= 2 && raw.length <= 20 && NSE_SYM_RE.test(raw) && !/^INDS?\d/.test(raw)) {
      return { ...cls, symbol: raw, noLive: false };
    }
    const sym = await resolveIndSymbol(h?.name);
    return { ...cls, symbol: sym, noLive: !sym };
  }
  return { ...cls, symbol: null, noLive: true };
}

// Resolve a batch (sequential, cached; a few ms per uncached name).
export async function resolveSymbolsForHoldings(holdings) {
  const out = [];
  for (const h of Array.isArray(holdings) ? holdings : []) {
    try { out.push(await resolveHoldingSymbol(h)); }
    catch { const cls = classifyHolding(h); out.push({ ...cls, symbol: null, noLive: true }); }
  }
  return out;
}

export function __resetSymbolCacheForTests() {
  _symCache = null;
}
