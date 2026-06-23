// ============================================================
// AngelOne SmartAPI — REAL-TIME NSE market data (broker-grade)
// ------------------------------------------------------------
// Gives the genuine exchange last-traded price for NSE equities & ETFs,
// the same feed INDmoney/brokers use — far better than Groww scraping or
// the 15-min-delayed TradingView scanner.
//
// Credentials live ONLY in env (never in the repo):
//   SMARTAPI_KEY, SMARTAPI_CLIENT_CODE, SMARTAPI_MPIN, SMARTAPI_TOTP_SECRET
//
// Flow: loginByPassword (TOTP) -> searchScrip (symbol->token, cached)
//       -> market/quote FULL (batched, real-time).
// US markets are NOT covered by AngelOne (Indian broker) — those stay on
// Yahoo/Finnhub in index.js.
// ============================================================
import crypto from 'node:crypto';
import { ensureSubscribed } from './angelStream.js';
import { getTick as feedGetTick } from './liveFeed.js';

const BASE = 'https://apiconnect.angelone.in';
const LOGIN_URL  = `${BASE}/rest/auth/angelbroking/user/v1/loginByPassword`;
const SEARCH_URL = `${BASE}/rest/secure/angelbroking/order/v1/searchScrip`;
const QUOTE_URL  = `${BASE}/rest/secure/angelbroking/market/v1/quote/`;

const KEY    = process.env.SMARTAPI_KEY || '';
const CLIENT = process.env.SMARTAPI_CLIENT_CODE || '';
const MPIN   = process.env.SMARTAPI_MPIN || '';
const SECRET = (process.env.SMARTAPI_TOTP_SECRET || '').replace(/\s+/g, '');

export function angelOneEnabled() {
  return !!(KEY && CLIENT && MPIN && SECRET);
}

// ---------------- TOTP (RFC 6238, no external dep) ----------------
function base32Decode(b32) {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  let bits = 0, value = 0;
  const out = [];
  for (const ch of String(b32).replace(/=+$/, '').toUpperCase()) {
    const idx = alphabet.indexOf(ch);
    if (idx < 0) continue;
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) { out.push((value >>> (bits - 8)) & 0xff); bits -= 8; }
  }
  return Buffer.from(out);
}
function genTotp(secret) {
  const key = base32Decode(secret);
  const counter = Math.floor(Date.now() / 1000 / 30);
  const buf = Buffer.alloc(8);
  buf.writeBigInt64BE(BigInt(counter));
  const hmac = crypto.createHmac('sha1', key).update(buf).digest();
  const offset = hmac[hmac.length - 1] & 0x0f;
  const code = ((hmac[offset] & 0x7f) << 24)
    | ((hmac[offset + 1] & 0xff) << 16)
    | ((hmac[offset + 2] & 0xff) << 8)
    | (hmac[offset + 3] & 0xff);
  return String(code % 1000000).padStart(6, '0');
}

function baseHeaders(extra = {}) {
  return {
    'Content-Type': 'application/json',
    'Accept': 'application/json',
    'X-UserType': 'USER',
    'X-SourceID': 'WEB',
    'X-ClientLocalIP': '192.168.1.1',
    'X-ClientPublicIP': '106.193.147.98',
    'X-MACAddress': 'AA:BB:CC:DD:EE:FF',
    'X-PrivateKey': KEY,
    ...extra,
  };
}

// ---------------- session (jwt) cache ----------------
let _jwt = null;
let _feedToken = null;
let _jwtAt = 0;
let _loginPromise = null;
const SESSION_TTL = 6 * 60 * 60 * 1000; // re-login every 6h

async function login() {
  if (_jwt && (Date.now() - _jwtAt) < SESSION_TTL) return _jwt;
  if (_loginPromise) return _loginPromise;
  _loginPromise = (async () => {
    try {
      const totp = genTotp(SECRET);
      const r = await fetch(LOGIN_URL, {
        method: 'POST',
        headers: baseHeaders(),
        body: JSON.stringify({ clientcode: CLIENT, password: MPIN, totp }),
        signal: AbortSignal.timeout(10000),
      });
      const j = await r.json();
      const jwt = j?.data?.jwtToken;
      if (!jwt) throw new Error(j?.message || 'AngelOne login failed');
      _jwt = jwt;
      _feedToken = j?.data?.feedToken || null;
      _jwtAt = Date.now();
      return _jwt;
    } finally {
      _loginPromise = null;
    }
  })();
  return _loginPromise;
}

// Expose the live session (jwt + feedToken + creds) for the websocket streamer.
export async function getSession() {
  const jwt = await login();
  return { jwt, feedToken: _feedToken, apiKey: KEY, clientCode: CLIENT };
}

// ---------------- symbol -> NSE token cache ----------------
// searchScrip is aggressively rate-limited (~3 calls then it returns non-JSON),
// so we resolve tokens SEQUENTIALLY through a global mutex, space the calls out,
// and cache forever (instrument tokens don't change intraday). After a brief
// warm-up every poll is served entirely from cache with zero searchScrip calls.
const _tokenCache = new Map(); // CLEANSYM -> token string ('' = confirmed-missing)
const MAX_LOOKUPS_PER_CALL = 3;
const LOOKUP_SPACING_MS = 450;
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

let _lookupChain = Promise.resolve();
function queueLookup(fn) {
  const run = _lookupChain.then(fn, fn);
  // keep the chain alive regardless of individual outcomes
  _lookupChain = run.then(() => {}, () => {});
  return run;
}

async function searchScrip(jwt, cleanSym) {
  try {
    const r = await fetch(SEARCH_URL, {
      method: 'POST',
      headers: baseHeaders({ Authorization: `Bearer ${jwt}` }),
      body: JSON.stringify({ exchange: 'NSE', searchscrip: cleanSym }),
      signal: AbortSignal.timeout(8000),
    });
    const text = await r.text();
    let j;
    try { j = JSON.parse(text); } catch { return undefined; } // rate-limited (non-JSON) → retry later
    if (j?.status !== true && j?.message !== 'SUCCESS') return undefined; // transient → don't cache
    const rows = Array.isArray(j?.data) ? j.data : [];
    // Prefer the cash-equity (-EQ) listing, else exact, else first dash-variant.
    const eq = rows.find(x => x.tradingsymbol === `${cleanSym}-EQ`)
      || rows.find(x => x.tradingsymbol === cleanSym)
      || rows.find(x => String(x.tradingsymbol).startsWith(`${cleanSym}-`))
      || rows[0];
    return eq?.symboltoken ? String(eq.symboltoken) : ''; // '' = genuinely not on NSE
  } catch {
    return undefined; // transient → retry on a later poll
  }
}

// ---------------- short result cache (dedupe concurrent polls) ----------------
let _quoteCache = { key: '', at: 0, data: {} };
const QUOTE_CACHE_TTL = 1200; // ms

function parseFeedTime(s) {
  // "23-Jun-2026 16:07:34" (IST) -> epoch ms; fall back to now.
  if (!s || typeof s !== 'string') return Date.now();
  const m = s.match(/(\d{2})-([A-Za-z]{3})-(\d{4})\s+(\d{2}):(\d{2}):(\d{2})/);
  if (!m) return Date.now();
  const months = { Jan:0,Feb:1,Mar:2,Apr:3,May:4,Jun:5,Jul:6,Aug:7,Sep:8,Oct:9,Nov:10,Dec:11 };
  const [, d, mon, y, hh, mm, ss] = m;
  const utc = Date.UTC(+y, months[mon] ?? 0, +d, +hh, +mm, +ss) - (5.5 * 3600 * 1000);
  return Number.isFinite(utc) ? utc : Date.now();
}

/**
 * Real-time NSE quotes for a list of clean symbols (e.g. ['RELIANCE','NIFTYBEES']).
 * Returns { SYM: {price,change,high,low,volume,prevClose,time,source} }.
 * Never throws — returns {} on any failure so callers fall back to Groww/Yahoo.
 */
export async function getAngelOneQuotes(cleanSyms) {
  if (!angelOneEnabled()) return {};
  const syms = [...new Set((cleanSyms || []).map(s => String(s).trim().toUpperCase()).filter(Boolean))];
  if (syms.length === 0) return {};

  const cacheKey = syms.slice().sort().join(',');
  if (_quoteCache.key === cacheKey && (Date.now() - _quoteCache.at) < QUOTE_CACHE_TTL) {
    return _quoteCache.data;
  }

  try {
    const jwt = await login();

    // Resolve a few uncached tokens per call (rate-safe, sequential, global mutex).
    // Cached symbols are used immediately; the rest warm up over the next polls.
    const uncached = syms.filter(s => !_tokenCache.has(s)).slice(0, MAX_LOOKUPS_PER_CALL);
    for (const sym of uncached) {
      // eslint-disable-next-line no-await-in-loop
      await queueLookup(async () => {
        if (_tokenCache.has(sym)) return;
        const tok = await searchScrip(jwt, sym);
        if (tok !== undefined) _tokenCache.set(sym, tok); // cache hits & confirmed-missing
        await sleep(LOOKUP_SPACING_MS);
      });
    }

    // Build the token list from whatever is cached right now.
    const tokenToSym = {};
    const tokens = [];
    for (const sym of syms) {
      const tok = _tokenCache.get(sym);
      if (tok) { tokens.push(tok); tokenToSym[tok] = sym; }
    }
    if (tokens.length === 0) return {};

    // Keep the websocket subscribed to everything we're asked about.
    ensureSubscribed(tokens.map(t => ({ token: t, symbol: tokenToSym[t] })));

    const out = {};
    const now = Date.now();
    const missing = [];

    // 1) Serve from the live tick stream first (millisecond-fresh, no REST call).
    //    A tick older than 30s (e.g. market closed) is treated as stale → REST.
    for (const tok of tokens) {
      const sym = tokenToSym[tok];
      const tk = feedGetTick(`IN_${sym}`);
      if (tk && tk.price > 0 && (now - tk.time) < 30000) {
        out[sym] = {
          price: tk.price,
          change: typeof tk.change === 'number' ? tk.change : 0,
          high: tk.high || tk.price,
          low: tk.low || tk.price,
          volume: tk.volume || 0,
          prevClose: tk.price,
          time: tk.time,
          source: 'angelone-stream',
        };
      } else {
        missing.push(tok);
      }
    }

    // 2) REST snapshot for whatever the stream hasn't delivered yet (warm-up /
    //    off-hours). FULL quote, up to 50 tokens per call.
    if (missing.length > 0) {
      const chunks = [];
      for (let i = 0; i < missing.length; i += 50) chunks.push(missing.slice(i, i + 50));
      await Promise.allSettled(chunks.map(async (chunk) => {
        const r = await fetch(QUOTE_URL, {
          method: 'POST',
          headers: baseHeaders({ Authorization: `Bearer ${jwt}` }),
          body: JSON.stringify({ mode: 'FULL', exchangeTokens: { NSE: chunk } }),
          signal: AbortSignal.timeout(8000),
        });
        const j = await r.json();
        const fetched = j?.data?.fetched || [];
        fetched.forEach((f) => {
          const sym = tokenToSym[String(f.symbolToken)];
          if (!sym) return;
          const price = Number(f.ltp);
          if (!(price > 0)) return;
          out[sym] = {
            price,
            change: typeof f.percentChange === 'number' ? f.percentChange : 0,
            high: f.high || price,
            low: f.low || price,
            volume: f.tradeVolume || 0,
            prevClose: f.close || price,
            time: parseFeedTime(f.exchFeedTime),
            source: 'angelone-realtime',
          };
        });
      }));
    }

    if (Object.keys(out).length > 0) {
      _quoteCache = { key: cacheKey, at: Date.now(), data: out };
    }
    return out;
  } catch {
    // On auth failure, drop the session so the next call re-logs in.
    _jwt = null;
    return {};
  }
}
