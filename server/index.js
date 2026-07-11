// ============================================================
// Wealth AI Pro — Backend API Proxy Server
// ------------------------------------------------------------
// Serves the built frontend (dist/) AND the /api/* proxy
// endpoints that the frontend expects. All AI provider API
// keys live ONLY on the server (never shipped to the browser).
//
// Run:   node server/index.js   (Render "Web Service" start cmd)
// Env:   PORT, GROQ_API_KEY, GEMINI_API_KEY, CLAUDE_API_KEY,
//        OPENROUTER_API_KEY, CEREBRAS_API_KEY, HF_API_KEY,
//        NVIDIA_API_KEY, TAVILY_API_KEY, API_URL (optional)
// ============================================================
import express from 'express';
import { subscribe as feedSubscribe, snapshot as feedSnapshot, feedStatus } from './liveFeed.js';
import { ensureUsSubscribed, usClientUp, usClientDown } from './usStream.js';
import { ensureCryptoSubscribed, cryptoClientUp, cryptoClientDown } from './cryptoStream.js';
import {
  getMLPrediction, getAllSignals, getRegime, getBacktest,
  getPricePoints, getHealth as mlHealth
} from './mlEngine.js';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { fork } from 'node:child_process';
import crypto from 'node:crypto';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = process.env.PORT || 8080;
const DEFAULT_USD_INR = 83.5;

app.use(express.json({ limit: '1mb' }));

// ============================================================
// AUTHENTICATION — Server-side PIN + httpOnly session cookie
// ============================================================
// The app PIN is stored ONLY on the server (APP_PIN env var) and is
// NEVER shipped to the browser. The frontend sends the user-entered
// PIN to /api/auth/login; on match, the server generates a random
// session token, stores it in an in-memory Set, and sets it as an
// httpOnly + SameSite=Strict cookie. All sensitive endpoints require
// this cookie via the requireAuth middleware.
//
// This replaces the previous client-side PIN check (which was trivially
// bypassable by setting localStorage.setItem('authDone', 'true')).
// ============================================================

// Server-side PIN — REQUIRED. No default, no VITE_ fallback.
const APP_PIN = process.env.APP_PIN || '';

// In-memory session store (single-user app, no persistence needed).
// Sessions expire after 24 hours of inactivity.
const _sessions = new Map(); // token → { lastSeen: number }
const SESSION_TTL = 24 * 60 * 60 * 1000; // 24 hours

// Clean up expired sessions periodically.
setInterval(() => {
  const now = Date.now();
  for (const [token, info] of _sessions) {
    if (now - info.lastSeen > SESSION_TTL) _sessions.delete(token);
  }
}, 60 * 60 * 1000).unref();

// Login rate limiter — 5 attempts per minute per IP (brute-force protection).
const _loginAttempts = new Map(); // ip → [timestamps]
function loginRateCheck(ip) {
  const now = Date.now();
  const arr = (_loginAttempts.get(ip) || []).filter(t => now - t < 60 * 1000);
  if (arr.length >= 5) return false;
  arr.push(now);
  _loginAttempts.set(ip, arr);
  return true;
}

// Cookie name for the session token.
const SESSION_COOKIE = 'wealthai_session';

// Paths that do NOT require authentication.
const PUBLIC_PATHS = new Set([
  '/health',
  '/api/auth/login',
  '/api/auth/check',
  '/api/config',
  '/api/ai-status',
  '/api/telegram-status',
  '/api/feed-status',
]);

// Auth middleware — checks for valid session cookie OR a ?session= query param.
// The query-param fallback is needed for EventSource (SSE stream), which cannot
// reliably send cookies in cross-origin mode (Vercel frontend → Render backend).
function requireAuth(req, res, next) {
  // Public paths skip auth.
  if (PUBLIC_PATHS.has(req.path)) return next();

  // Static assets (served by express.static) are public.
  if (req.path.startsWith('/assets/') || /\.(js|mjs|css|map|ico|svg|png|jpe?g|webp|woff2?|ttf|otf|json|wasm)$/i.test(req.path)) {
    return next();
  }

  // SPA fallback (index.html) is public — the login screen must load.
  if (req.method === 'GET' && !req.path.startsWith('/api/')) {
    return next();
  }

  // Check session cookie first (primary mechanism for fetch + XHR).
  let token = parseCookie(req.headers.cookie || '')[SESSION_COOKIE];

  // Fallback: ?session=<token> query param (for EventSource SSE stream, which
  // can't reliably send cookies cross-origin in some browsers).
  if (!token && req.query && typeof req.query.session === 'string') {
    token = req.query.session;
  }

  if (!token || !_sessions.has(token)) {
    return res.status(401).json({ error: { message: 'Authentication required. Please log in.' } });
  }

  // Refresh session activity.
  _sessions.get(token).lastSeen = Date.now();
  next();
}

// Simple cookie parser (avoids adding cookie-parser dependency).
function parseCookie(header) {
  const out = {};
  if (!header) return out;
  for (const pair of header.split(';')) {
    const idx = pair.indexOf('=');
    if (idx < 0) continue;
    const key = pair.substring(0, idx).trim();
    const val = pair.substring(idx + 1).trim();
    if (key) out[key] = val;
  }
  return out;
}

// --- CORS ---
// When the frontend is on a DIFFERENT origin (e.g. Vercel frontend calling
// Render backend), the browser sends `credentials: 'include'` for the session
// cookie. Browsers REJECT `Access-Control-Allow-Origin: *` when credentials
// are used — the server MUST echo the specific Origin header instead.
// We allowlist origins via the ALLOWED_ORIGINS env var; if not set, we echo
// any origin (safe for dev, restrict in production).
const ALLOWED_ORIGINS = process.env.ALLOWED_ORIGINS
  ? new Set(process.env.ALLOWED_ORIGINS.split(',').map(s => s.trim()).filter(Boolean))
  : null; // null = allow any (dev mode)

app.use((req, res, next) => {
  const origin = req.headers.origin;
  if (origin) {
    if (ALLOWED_ORIGINS) {
      // Production allowlist — only echo if origin is allowed.
      if (ALLOWED_ORIGINS.has(origin)) {
        res.setHeader('Access-Control-Allow-Origin', origin);
        res.setHeader('Vary', 'Origin');
      }
      // Disallowed origins get NO ACAO header — browser blocks the response.
    } else {
      // Dev mode — echo any origin (no allowlist set).
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Vary', 'Origin');
    }
  }
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,DELETE,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

// Apply auth middleware to ALL requests.
app.use(requireAuth);

// ============================================================
// AUTH ENDPOINTS
// ============================================================

// POST /api/auth/login → { pin: string } → sets session cookie
app.post('/api/auth/login', (req, res) => {
  const ip = (req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').toString().split(',')[0].trim();
  if (!loginRateCheck(ip)) {
    return res.status(429).json({ error: { message: 'Too many login attempts. Please wait a minute.' } });
  }

  const { pin } = req.body || {};
  if (!APP_PIN) {
    return res.status(500).json({ error: { message: 'Server PIN not configured. Set APP_PIN env var.' } });
  }
  if (typeof pin !== 'string' || pin.length === 0) {
    return res.status(400).json({ error: { message: 'PIN required.' } });
  }

  // Constant-time comparison to prevent timing attacks.
  const a = Buffer.from(pin);
  const b = Buffer.from(APP_PIN);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    return res.status(401).json({ error: { message: 'Invalid PIN.' } });
  }

  // Generate session token and store it.
  const token = crypto.randomUUID();
  _sessions.set(token, { lastSeen: Date.now() });

  // Cookie SameSite policy:
  // - If ALLOWED_ORIGINS is set (cross-origin deployment like Vercel→Render),
  //   use SameSite=None; Secure so the browser sends the cookie cross-origin.
  // - If no allowlist (same-origin / dev), use SameSite=Strict for max security.
  // Browsers REQUIRE Secure when SameSite=None, so we always set it in production.
  const isCrossOrigin = !!process.env.ALLOWED_ORIGINS;
  const sameSite = isCrossOrigin ? 'None' : 'Strict';
  const secure = process.env.NODE_ENV === 'production' || isCrossOrigin ? '; Secure' : '';
  res.setHeader('Set-Cookie', `${SESSION_COOKIE}=${token}; HttpOnly; SameSite=${sameSite}; Path=/; Max-Age=${SESSION_TTL / 1000}${secure}`);
  return res.json({ ok: true, sessionToken: token }); // sessionToken used for EventSource ?session= param
});

// POST /api/auth/logout → clears session cookie
app.post('/api/auth/logout', (req, res) => {
  const token = parseCookie(req.headers.cookie || '')[SESSION_COOKIE];
  if (token) _sessions.delete(token);
  res.setHeader('Set-Cookie', `${SESSION_COOKIE}=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0`);
  res.json({ ok: true });
});

// GET /api/auth/check → returns whether the caller is authenticated
app.get('/api/auth/check', (req, res) => {
  const token = parseCookie(req.headers.cookie || '')[SESSION_COOKIE];
  res.json({ authenticated: !!(token && _sessions.has(token)) });
});

// ------------------------------------------------------------
// Provider key map (server-side env vars — NOT VITE_*)
// ------------------------------------------------------------
const KEYS = {
  groq: process.env.GROQ_API_KEY || '',
  gemini: process.env.GEMINI_API_KEY || '',
  claude: process.env.CLAUDE_API_KEY || process.env.ANTHROPIC_API_KEY || '',
  openrouter: process.env.OPENROUTER_API_KEY || '',
  cerebras: process.env.CEREBRAS_API_KEY || '',
  huggingface: process.env.HF_API_KEY || process.env.HUGGINGFACE_API_KEY || '',
  nvidia: process.env.NVIDIA_API_KEY || '',
  tavily: process.env.TAVILY_API_KEY || '',
};

// Telegram bot credentials (server-side env only).
// NEVER fall back to VITE_* vars — those are browser-exposed at build time.
const TG = {
  token: process.env.TG_TOKEN || '',
  chatId: process.env.TG_CHAT_ID || '',
};

// OpenAI-compatible providers — body is forwarded almost as-is.
const OPENAI_COMPAT = {
  groq: { url: 'https://api.groq.com/openai/v1/chat/completions', defModel: 'llama-3.3-70b-versatile' },
  openrouter: { url: 'https://openrouter.ai/api/v1/chat/completions', defModel: 'meta-llama/llama-3.3-70b-instruct:free' },
  cerebras: { url: 'https://api.cerebras.ai/v1/chat/completions', defModel: 'llama-3.3-70b' },
  huggingface: { url: 'https://router.huggingface.co/v1/chat/completions', defModel: 'Qwen/Qwen2.5-72B-Instruct' },
  nvidia: { url: 'https://integrate.api.nvidia.com/v1/chat/completions', defModel: 'meta/llama-3.3-70b-instruct' },
};

function jsonError(res, status, message, internalErr) {
  const correlationId = crypto.randomUUID();
  if (internalErr) {
    console.error(`[corr=${correlationId}] ${status} ${message}`, internalErr?.message || internalErr);
  }
  return res.status(status).json({ error: { message, correlationId } });
}

// ------------------------------------------------------------
// Input validation helpers
// ------------------------------------------------------------

// Validate a stock symbol: only letters, numbers, dots, hyphens, underscores.
// Prevents injection of HTML/SQL/script content via symbol parameters.
function isValidSymbol(sym) {
  if (typeof sym !== 'string') return false;
  const s = sym.trim().toUpperCase();
  if (s.length === 0 || s.length > 20) return false;
  return /^[A-Z0-9.\-_]+$/.test(s);
}

// Escape HTML special characters — used when forwarding user-controlled
// content to Telegram (which uses parse_mode: 'HTML').
function escapeHtml(str) {
  return String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// Strip ALL HTML tags — for maximum safety when forwarding user content
// to Telegram as HTML. Only plain text survives.
function stripHtml(str) {
  return String(str || '').replace(/<[^>]*>/g, '');
}

// Cap an array at a maximum length to prevent DoS via huge payloads.
function capArray(arr, maxLen) {
  if (!Array.isArray(arr)) return [];
  return arr.slice(0, maxLen);
}

// ------------------------------------------------------------
// GET /api/config  → optional runtime config for the frontend
// ------------------------------------------------------------
app.get('/api/config', (_req, res) => {
  res.json(process.env.API_URL ? { apiUrl: process.env.API_URL } : {});
});

// ------------------------------------------------------------
// GET /api/chart  → real OHLC candles for ANY symbol (incl. NSE/BSE)
// ------------------------------------------------------------
// The embeddable TradingView widget shows "This symbol is only available on
// TradingView" for NSE ETFs (e.g. NSE:JUNIORBEES) because their real-time data
// isn't licensed for the public widget. This proxy fetches real candles from
// Yahoo Finance server-side (no browser CORS issue) so the app can render the
// NSE chart itself with lightweight-charts.
// Query: ?symbol=JUNIORBEES&market=IN&interval=D   (interval: D | W | M)
// ------------------------------------------------------------
const YF_INDEX_MAP = {
  // Indian indices → Yahoo tickers
  NIFTY: '^NSEI', NIFTY50: '^NSEI', BANKNIFTY: '^NSEBANK', NIFTYBANK: '^NSEBANK',
  SENSEX: '^BSESN', INDIAVIX: '^INDIAVIX', CNXIT: '^CNXIT',
  // US indices
  SPX: '^GSPC', NDX: '^NDX', DJI: '^DJI', RUT: '^RUT', VIX: '^VIX',
};

function toYahooSymbol(symbol, market) {
  const clean = String(symbol || '').replace('.NS', '').replace('.BO', '').trim().toUpperCase();
  if (YF_INDEX_MAP[clean]) return YF_INDEX_MAP[clean];
  // Crypto → Yahoo uses e.g. BTC-USD
  const crypto = ['BTC', 'ETH', 'SOL', 'BNB', 'XRP', 'DOGE', 'ADA', 'AVAX', 'DOT', 'MATIC', 'LINK', 'UNI'];
  if (crypto.includes(clean)) return `${clean}-USD`;
  if ((market || '').toUpperCase() === 'IN') return `${clean}.NS`; // NSE listing on Yahoo
  return clean; // US tickers are plain on Yahoo
}

app.get('/api/chart', async (req, res) => {
  const { symbol = '', market = '', interval = 'D' } = req.query || {};
  if (!symbol) return jsonError(res, 400, 'symbol required');
  // SECURITY: validate symbol format to prevent injection / open-proxy abuse.
  if (!isValidSymbol(symbol)) return jsonError(res, 400, 'invalid symbol format');

  const ivMap = {
    D: { interval: '1d', range: '6mo' },
    W: { interval: '1wk', range: '2y' },
    M: { interval: '1mo', range: '5y' },
  };
  const cfg = ivMap[String(interval).toUpperCase()] || ivMap.D;
  const ysym = toYahooSymbol(symbol, market);

  // Try NSE then BSE for Indian symbols (some ETFs only list on one).
  const candidates = (String(market).toUpperCase() === 'IN' && !ysym.startsWith('^'))
    ? [ysym, ysym.replace('.NS', '.BO')]
    : [ysym];

  for (const ys of candidates) {
    try {
      const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ys)}?interval=${cfg.interval}&range=${cfg.range}`;
      const upstream = await fetch(url, {
        headers: { 'User-Agent': 'Mozilla/5.0 (WealthAI chart proxy)' },
        signal: AbortSignal.timeout(8000),
      });
      if (!upstream.ok) continue;
      const json = await upstream.json();
      const r = json?.chart?.result?.[0];
      const ts = r?.timestamp;
      const q = r?.indicators?.quote?.[0];
      if (!Array.isArray(ts) || !q) continue;

      const candles = [];
      for (let i = 0; i < ts.length; i++) {
        const o = q.open?.[i], h = q.high?.[i], l = q.low?.[i], c = q.close?.[i], v = q.volume?.[i];
        if (o == null || h == null || l == null || c == null) continue;
        candles.push({ time: ts[i], open: o, high: h, low: l, close: c, volume: v || 0 });
      }
      if (candles.length === 0) continue;
      return res.json({ symbol: ys, currency: r?.meta?.currency || '', candles });
    } catch (e) { /* try next candidate */ }
  }
  return jsonError(res, 502, 'chart data unavailable');
});

// ------------------------------------------------------------
// GET /api/quote  → REAL-TIME last-traded price for one or many symbols
// ------------------------------------------------------------
// Returns genuine real-time last prices via multiple sources:
//   1. Finnhub /quote (US stocks/ETFs, if key set)
//   2. Groww NSE live (India stocks/ETFs; SKIPPED for indices like NIFTY)
//   3. Yahoo Finance v7/v8 (fallback for everything)
// Query: ?symbols=SMH,SPCX,MU&market=US   (comma separated, max 50)
// Resp:  { quotes: { SMH: {price,change,high,low,volume,prevClose,time,source}, ... } }
// ------------------------------------------------------------
const INDIAN_INDICES = new Set(['NIFTY','BANKNIFTY','SENSEX','INDIAVIX','CNXIT','NIFTY50','NIFTYBANK']);
async function fetchFinnhubQuote(plainSym) {
  const key = process.env.FINNHUB_API_KEY || '';
  if (!key) return null;
  try {
    const url = `https://finnhub.io/api/v1/quote?symbol=${encodeURIComponent(plainSym)}&token=${key}`;
    const r = await fetch(url, { signal: AbortSignal.timeout(5000) });
    if (!r.ok) return null;
    const j = await r.json();
    // c=current, d=change, dp=percent, h=high, l=low, pc=prevClose, t=epoch(s)
    if (!j || typeof j.c !== 'number' || j.c <= 0) return null;
    return {
      price: j.c,
      change: typeof j.dp === 'number' ? j.dp : (j.pc ? ((j.c - j.pc) / j.pc) * 100 : 0),
      high: j.h || j.c,
      low: j.l || j.c,
      volume: 0,
      prevClose: j.pc || j.c,
      time: (j.t ? j.t * 1000 : Date.now()),
      source: 'finnhub-realtime',
    };
  } catch { return null; }
}

// REAL-TIME NSE quote (the India equivalent of the US realtime fix).
// NSE's own API blocks datacenter IPs (403), and Yahoo .NS is ~15-min delayed.
// Groww's public live-price endpoint serves the genuine NSE last-traded price
// (`ltp`, type LIVE_PRICE) for stocks AND ETFs, and works from cloud servers.
async function fetchGrowwNseQuote(plainSym) {
  const sym = String(plainSym || '').replace('.NS', '').replace('.BO', '').trim().toUpperCase();
  if (!sym) return null;
  try {
    const url = `https://groww.in/v1/api/stocks_data/v1/tr_live_prices/exchange/NSE/segment/CASH/${encodeURIComponent(sym)}/latest`;
    const r = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120 Safari/537.36',
        'Accept': 'application/json',
      },
      signal: AbortSignal.timeout(5000),
    });
    if (!r.ok) return null;
    const j = await r.json();
    const price = (typeof j.ltp === 'number' && j.ltp > 0) ? j.ltp
      : (typeof j.close === 'number' && j.close > 0) ? j.close : 0;
    if (!price) return null;
    return {
      price,
      change: typeof j.dayChangePerc === 'number' ? j.dayChangePerc : 0,
      high: j.high || price,
      low: j.low || price,
      volume: j.volume || 0,
      prevClose: (j.ltp && j.dayChange != null) ? (j.ltp - j.dayChange) : price,
      time: (j.lastTradeTime ? j.lastTradeTime * 1000 : Date.now()),
      source: 'groww-nse-realtime',
    };
  } catch { return null; }
}

async function fetchYahooQuote(ysym) {
  try {
    // Try the dedicated quote endpoint first (simpler, faster) — v7 is still live
    const qurl = `https://query1.finance.yahoo.com/v7/finance/quote?symbols=${encodeURIComponent(ysym)}`;
    const qr = await fetch(qurl, {
      headers: { 'User-Agent': 'Mozilla/5.0 (WealthAI quote proxy)' },
      signal: AbortSignal.timeout(5000),
    });
    if (qr.ok) {
      const qj = await qr.json();
      const qr2 = qj?.quoteResponse?.result?.[0];
      if (qr2 && typeof qr2.regularMarketPrice === 'number' && qr2.regularMarketPrice > 0) {
        return {
          price: qr2.regularMarketPrice,
          change: qr2.regularMarketChangePercent ?? 0,
          high: qr2.regularMarketDayHigh || qr2.regularMarketPrice,
          low: qr2.regularMarketDayLow || qr2.regularMarketPrice,
          volume: qr2.regularMarketVolume || 0,
          prevClose: qr2.regularMarketPreviousClose || qr2.regularMarketPrice,
          time: (qr2.regularMarketTime ? qr2.regularMarketTime * 1000 : Date.now()),
          source: 'yahoo-realtime',
        };
      }
    }
  } catch { /* fall through to chart endpoint */ }

  try {
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ysym)}?interval=5m&range=1d`;
    const r = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (WealthAI quote proxy)' },
      signal: AbortSignal.timeout(6000),
    });
    if (!r.ok) return null;
    const j = await r.json();
    const result = j?.chart?.result?.[0];
    const m = result?.meta;
    if (!m) return null;
    const price = m.regularMarketPrice;
    if (typeof price !== 'number' || price <= 0) return null;
    const prevClose = m.chartPreviousClose || m.previousClose || price;
    return {
      price,
      change: prevClose ? ((price - prevClose) / prevClose) * 100 : 0,
      high: m.regularMarketDayHigh || price,
      low: m.regularMarketDayLow || price,
      volume: m.regularMarketVolume || 0,
      prevClose,
      time: (m.regularMarketTime ? m.regularMarketTime * 1000 : Date.now()),
      source: 'yahoo-realtime',
    };
  } catch { return null; }
}

app.get('/api/quote', async (req, res) => {
  const raw = String(req.query.symbols || req.query.symbol || '').trim();
  const market = String(req.query.market || '').toUpperCase();
  if (!raw) return jsonError(res, 400, 'symbols required');

  const symbols = [...new Set(
    raw.split(',').map(s => s.trim().toUpperCase()).filter(Boolean)
  )].slice(0, 50);
  if (symbols.length === 0) return jsonError(res, 400, 'symbols required');
  // SECURITY: validate ALL symbols to prevent injection.
  for (const s of symbols) {
    if (!isValidSymbol(s)) return jsonError(res, 400, `invalid symbol: ${s}`);
  }

  const quotes = {};

  // India quotes — Groww NSE → Yahoo fallback
  // FIX H12: previously `const remaining = symbols.filter(s => !quotes[s])`
  // ran BEFORE any quotes were populated (quotes = {}) so `remaining ===
  // symbols` always — dead filter. Just iterate `symbols` directly.
  await Promise.allSettled(symbols.map(async (sym) => {
    // 1a) India real-time → Groww NSE live feed (datacenter-friendly, ETF-safe).
    // Indian indices (NIFTY etc.) skip Groww — Groww only has stock/ETF quotes
    if (market === 'IN' && !INDIAN_INDICES.has(sym)) {
      const gw = await fetchGrowwNseQuote(sym);
      if (gw) { quotes[sym] = gw; return; }
    }
    // 1b) Finnhub real-time (US only — Finnhub free tier is US equities/ETFs)
    if (market !== 'IN') {
      const fh = await fetchFinnhubQuote(sym.replace('.NS', '').replace('.BO', ''));
      if (fh) { quotes[sym] = fh; return; }
    }
    // 2) Yahoo real-time (no key, ~1-2s). Try NSE then BSE for Indian symbols.
    const ysym = toYahooSymbol(sym, market);
    const candidates = (market === 'IN' && !ysym.startsWith('^'))
      ? [ysym, ysym.replace('.NS', '.BO')]
      : [ysym];
    for (const ys of candidates) {
      const yq = await fetchYahooQuote(ys);
      if (yq) { quotes[sym] = yq; return; }
    }
  }));

  // no-cache so polling always gets the freshest tick
  res.set('Cache-Control', 'no-store, max-age=0');
  return res.json({ quotes, ts: Date.now() });
});

// ------------------------------------------------------------
// GET /api/crypto-prices → proxy CoinDCX ticker (CORS fix)
// ------------------------------------------------------------
// CoinDCX's public API does NOT serve Access-Control-Allow-Origin, so
// the browser blocks every direct fetch from the frontend. This thin
// server-side proxy fetches the ticker, caches it briefly (3s) to avoid
// hammering upstream, and returns the full JSON array the frontend expects.
// ------------------------------------------------------------
let _coinDcxCache = { data: null, ts: 0 };
const COINDCX_CACHE_MS = 3000;

app.get('/api/crypto-prices', async (_req, res) => {
  const now = Date.now();
  if (_coinDcxCache.data && (now - _coinDcxCache.ts) < COINDCX_CACHE_MS) {
    res.set('Cache-Control', 'no-store, max-age=0');
    return res.json(_coinDcxCache.data);
  }
  try {
    const upstream = await fetch(`https://api.coindcx.com/exchange/ticker?t=${now}`, {
      signal: AbortSignal.timeout(5000),
    });
    if (!upstream.ok) return jsonError(res, 502, 'CoinDCX upstream error');
    const tickers = await upstream.json();
    _coinDcxCache = { data: tickers, ts: now };
    res.set('Cache-Control', 'no-store, max-age=0');
    return res.json(tickers);
  } catch (e) {
    return jsonError(res, 502, 'Failed to fetch crypto prices.', e);
  }
});

// ------------------------------------------------------------
// GET /api/forex → USD/INR rate proxy with server-side caching
// ------------------------------------------------------------
// Multiple upstream fallbacks so the rate is always available even if
// one free API is down. Cached 10s server-side to reduce upstream load.
// ------------------------------------------------------------
let _forexCache = { rate: DEFAULT_USD_INR, ts: 0 };
// FIX OPT-6: increased from 10s to 30s — client polls at 60s+, so 10s
// cache was cold on most hits and hammered upstream free-tier APIs.
const FOREX_CACHE_MS = 30000;

const FOREX_UPSTREAMS = [
  'https://open.er-api.com/v6/latest/USD',
  'https://api.frankfurter.app/latest?from=USD&to=INR',
  'https://api.exchangerate-api.com/v4/latest/USD',
];

async function fetchForexUpstream() {
  for (const url of FOREX_UPSTREAMS) {
    try {
      const r = await fetch(url, { signal: AbortSignal.timeout(4000) });
      if (!r.ok) continue;
      const j = await r.json();
      const inr = j?.rates?.INR;
      if (typeof inr === 'number' && inr > 50 && inr < 150) return inr;
    } catch { /* try next */ }
  }
  return null;
}

app.get('/api/forex', async (_req, res) => {
  const now = Date.now();
  if (_forexCache.rate && (now - _forexCache.ts) < FOREX_CACHE_MS) {
    res.set('Cache-Control', 'no-store, max-age=0');
    return res.json({ usdInr: _forexCache.rate, ts: _forexCache.ts });
  }
  const rate = await fetchForexUpstream();
  if (rate) _forexCache = { rate, ts: now };
  res.set('Cache-Control', 'no-store, max-age=0');
  return res.json({ usdInr: rate || _forexCache.rate || DEFAULT_USD_INR, ts: Date.now() });
});

// ------------------------------------------------------------
// GET /api/stream  → Server-Sent Events: pushes live ticks to the browser.
// Query: ?in=RELIANCE,NIFTYBEES&us=SMH,VGT&crypto=BTC,ETH
// Events: `snapshot` (initial map), `tick` ({key,price,change,...}), `status`.
// Replaces 2s polling with real-time push (NSE, Finnhub US, Binance crypto).
// Per-key throttle keeps the stream light.
// ------------------------------------------------------------
function parseSyms(v) {
  return String(v || '').split(',').map(s => s.trim().toUpperCase()).filter(Boolean).slice(0, 60);
}

app.get('/api/stream', (req, res) => {
  const inSyms = parseSyms(req.query.in);
  const usSyms = parseSyms(req.query.us);
  const cryptoSyms = parseSyms(req.query.crypto);

  const keys = new Set([
    ...inSyms.map(s => `IN_${s}`),
    ...usSyms.map(s => `US_${s}`),
    ...cryptoSyms.map(s => `IN_${s}`),
  ]);

  // Kick off / refresh upstream subscriptions for the requested symbols.
  if (usSyms.length) ensureUsSubscribed(usSyms);
  ensureCryptoSubscribed(cryptoSyms);

  // Notify streams a client is now active — starts polling/WebSocket if idle
  usClientUp();
  cryptoClientUp();

  res.set({
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-store, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  if (res.flushHeaders) res.flushHeaders();
  res.write('retry: 3000\n\n');

  const snap = feedSnapshot([...keys]);
  if (Object.keys(snap).length) res.write(`event: snapshot\ndata: ${JSON.stringify(snap)}\n\n`);

  const lastSent = {};
  const unsub = feedSubscribe((key, tick) => {
    if (!keys.has(key)) return;
    const now = Date.now();
    if (lastSent[key] && (now - lastSent[key]) < 400) return; // ≤2.5 updates/sec/symbol
    lastSent[key] = now;
    try { res.write(`event: tick\ndata: ${JSON.stringify({ key, ...tick })}\n\n`); } catch { /* client gone */ }
  });

  const keepalive = setInterval(() => {
    try { res.write(`event: status\ndata: ${JSON.stringify(feedStatus())}\n\n`); } catch { /* noop */ }
  }, 15000);

  req.on('close', () => {
    clearInterval(keepalive);
    unsub();
    // Notify streams this client left — pauses polling when no clients remain
    usClientDown();
    cryptoClientDown();
    try { res.end(); } catch { /* noop */ }
  });
});

// GET /api/feed-status → which real-time sources are live (for the UI dot).
app.get('/api/feed-status', (_req, res) => {
  res.set('Cache-Control', 'no-store');
  res.json(feedStatus());
});

// ------------------------------------------------------------
// GET /api/ai-status → which providers have a key configured.
// The frontend skips any engine that is false here.
// ------------------------------------------------------------
app.get('/api/ai-status', (_req, res) => {
  res.json({
    gemini: !!KEYS.gemini,
    groq: !!KEYS.groq,
    claude: !!KEYS.claude,
    openrouter: !!KEYS.openrouter,
    cerebras: !!KEYS.cerebras,
    huggingface: !!KEYS.huggingface,
    nvidia: !!KEYS.nvidia,
    tavily: !!KEYS.tavily,
  });
});

// ------------------------------------------------------------
// Generic OpenAI-compatible proxy (groq/openrouter/cerebras/hf/nvidia)
// ------------------------------------------------------------
for (const [name, cfg] of Object.entries(OPENAI_COMPAT)) {
  app.post(`/api/${name}`, async (req, res) => {
    const key = KEYS[name];
    if (!key) return jsonError(res, 503, `${name} not configured`);
    try {
      const body = { ...req.body };
      if (!body.model) body.model = cfg.defModel;
      if (!Array.isArray(body.messages)) return jsonError(res, 400, 'messages[] required');
      const upstream = await fetch(cfg.url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${key}`,
          ...(name === 'openrouter' ? { 'HTTP-Referer': 'https://smartai11.onrender.com', 'X-Title': 'Wealth AI Pro' } : {}),
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(30000),
      });
      const text = await upstream.text();
      res.status(upstream.status).type('application/json').send(text || '{}');
    } catch (e) {
      return jsonError(res, 502, `${name} AI provider is temporarily unavailable.`, e);
    }
  });
}

// ------------------------------------------------------------
// POST /api/tavily → Tavily web search (for NeuralChat live news)
// Translates the OpenAI-style messages body into a Tavily search
// and returns the result in OpenAI-compatible format.
// ------------------------------------------------------------
app.post('/api/tavily', async (req, res) => {
  if (!KEYS.tavily) return jsonError(res, 503, 'tavily not configured');
  try {
    const { messages = [] } = req.body || {};
    const userMsg = messages.filter(m => m.role === 'user').map(m => m.content).join(' ').trim();
    if (!userMsg) return jsonError(res, 400, 'search query required');
    const query = userMsg.substring(0, 400); // Tavily max query length
    const upstream = await fetch('https://api.tavily.com/search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        api_key: KEYS.tavily,
        query,
        search_depth: 'basic',
        max_results: 5,
        include_answer: true,
      }),
      signal: AbortSignal.timeout(10000),
    });
    if (!upstream.ok) return jsonError(res, 502, 'tavily upstream error');
    const data = await upstream.json();
    // Package as OpenAI-compatible response so the frontend can consume it uniformly
    const answer = data.answer || '';
    const results = (data.results || []).map(r => `• ${r.title}: ${r.content?.substring(0, 200) || ''}`).join('\n');
    const content = answer ? `${answer}\n\nSources:\n${results}` : results || 'No results found.';
    res.json({
      choices: [{ message: { role: 'assistant', content } }],
    });
  } catch (e) {
    return jsonError(res, 502, 'Search service is temporarily unavailable.', e);
  }
});

// ------------------------------------------------------------
// POST /api/gemini → translate OpenAI-style messages → Gemini,
// return Gemini's native shape (candidates[0].content.parts[0].text)
// ------------------------------------------------------------
app.post('/api/gemini', async (req, res) => {
  if (!KEYS.gemini) return jsonError(res, 503, 'gemini not configured');
  try {
    const { messages = [], model = 'gemini-2.5-flash' } = req.body || {};
    const systemText = messages.filter(m => m.role === 'system').map(m => m.content).join('\n').trim();
    const contents = messages
      .filter(m => m.role !== 'system')
      .map(m => ({ role: m.role === 'assistant' || m.role === 'model' ? 'model' : 'user', parts: [{ text: String(m.content || '') }] }));
    const payload = { contents };
    if (systemText) payload.systemInstruction = { parts: [{ text: systemText }] };
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${KEYS.gemini}`;
    const upstream = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(30000),
    });
    const text = await upstream.text();
    res.status(upstream.status).type('application/json').send(text || '{}');
  } catch (e) {
    return jsonError(res, 502, 'Gemini AI provider is temporarily unavailable.', e);
  }
});

// ------------------------------------------------------------
// POST /api/claude → Anthropic Messages API,
// return native shape (content[0].text)
// ------------------------------------------------------------
app.post('/api/claude', async (req, res) => {
  if (!KEYS.claude) return jsonError(res, 503, 'claude not configured');
  try {
    const { messages = [], model = 'claude-sonnet-4-20250514', max_tokens = 1024 } = req.body || {};
    const system = messages.filter(m => m.role === 'system').map(m => m.content).join('\n').trim();
    const conv = messages
      .filter(m => m.role !== 'system')
      .map(m => ({ role: m.role === 'model' || m.role === 'assistant' ? 'assistant' : 'user', content: String(m.content || '') }));
    const payload = { model, max_tokens, messages: conv };
    if (system) payload.system = system;
    const upstream = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': KEYS.claude,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(30000),
    });
    const text = await upstream.text();
    res.status(upstream.status).type('application/json').send(text || '{}');
  } catch (e) {
    return jsonError(res, 502, 'Claude AI provider is temporarily unavailable.', e);
  }
});

// ------------------------------------------------------------
// POST /api/telegram → send a Telegram message using the SERVER's
// bot token + chat id (env). Lets the website push notifications
// even when the browser has no local Telegram config saved.
// Body: { message: string }
// FIX C11: Ignore any client-supplied chatId — otherwise any visitor could
// make the bot spam arbitrary chats. Always send to the server-configured
// TG_CHAT_ID. Simple per-IP rate limit (30 msgs / 10 min) prevents abuse.
// ------------------------------------------------------------
const _tgRateBucket = new Map(); // ip → [{ ts }]
const TG_RATE_LIMIT = { windowMs: 10 * 60 * 1000, max: 30 };

function tgRateCheck(ip) {
  const now = Date.now();
  const arr = (_tgRateBucket.get(ip) || []).filter(t => now - t < TG_RATE_LIMIT.windowMs);
  if (arr.length >= TG_RATE_LIMIT.max) return false;
  arr.push(now);
  _tgRateBucket.set(ip, arr);
  return true;
}

app.post('/api/telegram', async (req, res) => {
  if (!TG.token || !TG.chatId) return jsonError(res, 503, 'telegram not configured on server');
  const { message } = req.body || {};
  if (!message || typeof message !== 'string') return jsonError(res, 400, 'message required');
  const ip = (req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').toString().split(',')[0].trim();
  if (!tgRateCheck(ip)) return jsonError(res, 429, 'rate limit exceeded — try again later');

  // SECURITY: strip ALL HTML tags from the client-supplied message.
  // Without this, anyone who can call /api/telegram can inject arbitrary
  // HTML (phishing links, fake system messages) into the user's Telegram
  // chat. The message is forwarded with parse_mode: 'HTML', so any tags
  // would be rendered. We also escape the remaining text so it displays
  // as plain text even under HTML parse mode.
  const safeMessage = escapeHtml(stripHtml(message)).slice(0, 4096);

  try {
    const upstream = await fetch(`https://api.telegram.org/bot${TG.token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: TG.chatId, text: safeMessage, parse_mode: 'HTML', disable_web_page_preview: true }),
      signal: AbortSignal.timeout(10000),
    });
    const text = await upstream.text();
    res.status(upstream.status).type('application/json').send(text || '{}');
  } catch (e) {
    return jsonError(res, 502, 'telegram upstream error', e);
  }
});

// Tell the frontend whether server-side Telegram is available
app.get('/api/telegram-status', (_req, res) => {
  res.json({ configured: !!(TG.token && TG.chatId) });
});

// ------------------------------------------------------------
// SUPER INTELLIGENCE ML ENGINE (Pure JS — No Python service)
// ------------------------------------------------------------
// Replaces the Python FastAPI ML service entirely. All ML
// inference runs IN-PROCESS in this Node.js server — no extra
// service needed. This is critical for Render free tier since
// 2 services would exceed 750 hrs/month limit.
// ------------------------------------------------------------
app.get('/api/ml/health', (_req, res) => { res.json(mlHealth()); });

app.post('/api/ml/predict', (req, res) => {
  const { symbol, market, price, change, candles } = req.body || {};
  if (!symbol) return res.status(400).json({ error: 'symbol required' });
  const result = getMLPrediction(symbol, market || 'IN', price || 100, change || 0, candles);
  res.json(result);
});

// FIX H6/H7: removed misleading GET stubs for /api/ml/signals and /api/ml/regime
// that returned empty/hardcoded data. POST routes below remain (frontend uses
// those). GET /api/ml/regime is kept (defaults to safe regime for callers
// that don't have live data).
app.get('/api/ml/regime', (_req, res) => {
  // Returns a default NEUTRAL regime — callers needing live data should POST.
  const regime = getRegime(
    { change: 0 }, { change: 0 },
    { price: 15 }, 18, 104, { change: 0 }
  );
  res.json(regime);
});

app.post('/api/ml/signals', (req, res) => {
  const { portfolio, livePrices } = req.body || {};
  const result = getAllSignals(portfolio || [], livePrices || {});
  res.json(result);
});

app.post('/api/ml/regime', (req, res) => {
  const { nifty, bankNifty, vix, usVix, dxy, gold } = req.body || {};
  const regime = getRegime(nifty, bankNifty, vix, usVix, dxy, gold);
  res.json(regime);
});

app.get('/api/ml/backtest', (req, res) => {
  const { symbol } = req.query || {};
  const result = getBacktest(symbol, []);
  res.json(result);
});

app.post('/api/ml/backtest', (req, res) => {
  const { symbol, candles } = req.body || {};
  const result = getBacktest(symbol || '', candles || []);
  res.json(result);
});

app.get('/api/ml/pricepoints/:symbol', (req, res) => {
  const { symbol } = req.params;
  const price = parseFloat(req.query.price) || 100;
  const result = getPricePoints(symbol, price, []);
  res.json(result);
});

app.post('/api/ml/train', (_req, res) => {
  res.json({ status: 'ok', message: 'Training simulated — pure JS engine uses instant inference' });
});

app.post('/api/ml/refresh', (_req, res) => {
  res.json({ status: 'ok', message: 'Data state refreshed' });
});

app.post('/api/ml/analyze', (req, res) => {
  const { symbol, market, price, change, candles } = req.body || {};
  if (!symbol) return res.status(400).json({ error: 'symbol required' });
  const prediction = getMLPrediction(symbol, market || 'IN', price || 100, change || 0, candles);
  res.json({
    symbol: prediction.symbol,
    market: prediction.market,
    current_price: prediction.price,
    signal: prediction.signal,
    confidence: prediction.confidence,
    price_points: prediction.price_points,
    price_targets: prediction.price_targets,
    timestamp: prediction.timestamp,
    analysis: [
      { step: 1, name: 'Regime Detection', result: prediction.direction === 'bullish' ? 'Favorable' : 'Caution' },
      { step: 2, name: 'Trend Analysis', result: prediction.direction },
      { step: 3, name: 'Momentum Check', result: `RSI ${prediction.rsi}` },
      { step: 4, name: 'Support/Demand', result: prediction.price_points ? `Entry ${prediction.price_points.entry}` : 'N/A' },
      { step: 5, name: 'Risk Assessment', result: prediction.price_points ? `R:R ${prediction.price_points.risk_reward}` : 'N/A' },
      { step: 6, name: 'Conviction Score', result: `${prediction.confidence}/100` },
      { step: 7, name: 'Action', result: prediction.signal },
    ],
  });
});

// ------------------------------------------------------------
// GET /api/fundamentals/:symbol → fundamental data for Quality Scorecard
// ------------------------------------------------------------
// Proxies Yahoo Finance quoteSummary server-side (no CORS issue) and
// normalises the response into the shape expected by qualityScorecard.ts.
// Cached 24h because fundamentals change slowly.
// ------------------------------------------------------------
const _fundamentalsCache = new Map();  // symbol → { data, ts }
const FUNDAMENTALS_TTL = 24 * 60 * 60 * 1000;

app.get('/api/fundamentals/:symbol', async (req, res) => {
  const rawSymbol = String(req.params.symbol || '').trim().toUpperCase();
  if (!rawSymbol) return jsonError(res, 400, 'symbol required');
  // SECURITY: validate symbol format.
  if (!isValidSymbol(rawSymbol)) return jsonError(res, 400, 'invalid symbol format');
  const market = String(req.query.market || '').toUpperCase();

  const cached = _fundamentalsCache.get(rawSymbol);
  if (cached && Date.now() - cached.ts < FUNDAMENTALS_TTL) {
    return res.json(cached.data);
  }

  // Map to Yahoo ticker (same logic as /api/chart)
  const ysym = toYahooSymbol(rawSymbol, market);

  try {
    // FIX: Yahoo v10 quoteSummary is now rate-limited/blocked for many IPs.
    // Use v8 chart API (more reliable) for price + meta, then try v10 for
    // fundamentals. If v10 fails, use v8 data to compute what we can.
    const chartUrl = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ysym)}?interval=1d&range=1y`;
    const chartR = await fetch(chartUrl, {
      headers: { 'User-Agent': 'Mozilla/5.0 (WealthAI fundamentals proxy)' },
      signal: AbortSignal.timeout(6000),
    });
    if (!chartR.ok) return jsonError(res, 502, `Yahoo chart ${chartR.status}`);
    const chartJ = await chartR.json();
    const result = chartJ?.chart?.result?.[0];
    if (!result) return jsonError(res, 502, 'No chart result');
    const meta = result.meta || {};

    // Try v10 quoteSummary for fundamentals (may fail)
    let qs = null;
    try {
      const modules = 'incomeStatementHistory,balanceSheetHistory,defaultKeyStatistics,financialData,summaryDetail,price';
      const qsUrl = `https://query1.finance.yahoo.com/v10/finance/quoteSummary/${encodeURIComponent(ysym)}?modules=${modules}`;
      const qsR = await fetch(qsUrl, {
        headers: { 'User-Agent': 'Mozilla/5.0 (WealthAI fundamentals proxy)' },
        signal: AbortSignal.timeout(5000),
      });
      if (qsR.ok) {
        const qsJ = await qsR.json();
        qs = qsJ?.quoteSummary?.result?.[0];
      }
    } catch { /* v10 failed — use chart data only */ }

    // ---- Build FundamentalData from whatever we have ----
    const toNum = (v) => {
      if (v == null) return 0;
      if (typeof v === 'number') return v;
      if (typeof v === 'object' && 'raw' in v) return v.raw || 0;
      return parseFloat(v) || 0;
    };

    const price = meta.regularMarketPrice || 0;
    const prevClose = meta.chartPreviousClose || meta.previousClose || price;
    const marketCap = meta.marketCap || 0;

    // Extract historical closes from chart for 5yr approximation
    const timestamps = result.timestamp || [];
    const quoteClose = result.indicators?.quote?.[0]?.close || [];
    const closes = timestamps.map((t, i) => ({ date: new Date(t * 1000).toISOString().split('T')[0], close: quoteClose[i] })).filter(c => c.close != null);

    // Compute approximate revenue/earnings from market cap + P/E (if available)
    const peRatio = qs?.summaryDetail?.trailingPE ? toNum(qs.summaryDetail.trailingPE) : 0;
    const pbRatio = qs?.defaultKeyStatistics?.priceToBook ? toNum(qs.defaultKeyStatistics.priceToBook) : 0;
    const eps = qs?.defaultKeyStatistics?.trailingEps ? toNum(qs.defaultKeyStatistics.trailingEps) : (peRatio > 0 ? price / peRatio : 0);
    const bookValuePerShare = qs?.defaultKeyStatistics?.bookValuePerShare ? toNum(qs.defaultKeyStatistics.bookValuePerShare) : (pbRatio > 0 ? price / pbRatio : 0);
    const divYield = qs?.summaryDetail?.dividendYield ? toNum(qs.summaryDetail.dividendYield) * 100 : 0;
    const beta = qs?.summaryDetail?.beta ? toNum(qs.summaryDetail.beta) : 1.0;

    // From v10 (if available)
    const income = qs?.incomeStatementHistory?.incomeStatementHistory || [];
    const balance = qs?.balanceSheetHistory?.balanceSheetStatements || [];
    const fin = qs?.financialData || {};
    const ks = qs?.defaultKeyStatistics || {};

    const latest = income[0] || {};
    const bs = balance[0] || {};

    const revenue5yr = income.length > 0 ? income.map(i => toNum(i.totalRevenue)).reverse() : [marketCap / (peRatio || 15)];
    const netIncome5yr = income.length > 0 ? income.map(i => toNum(i.netIncome)).reverse() : [eps * (marketCap / price || 1)];
    const eps5yr = income.length > 0 ? income.map(i => toNum(i.dilutedEPS)).reverse() : [eps];

    const totalAssets = toNum(bs.totalAssets);
    const totalLiabilities = toNum(bs.totalLiab);
    const totalEquity = toNum(bs.totalStockholderEquity);
    const totalDebt = toNum(bs.totalDebt || bs.shortLongTermDebt);
    const retainedEarnings = toNum(bs.retainedEarnings);
    const currentAssets = toNum(bs.totalCurrentAssets);
    const currentLiab = toNum(bs.totalCurrentLiabilities);
    const workingCapital = currentAssets - currentLiab;
    const ebit = toNum(latest.operatingIncome) || toNum(latest.ebit) || (netIncome5yr[netIncome5yr.length - 1] || 0) * 1.3;
    const operatingCashFlow = toNum(fin.operatingCashflow || fin.totalCashFromOperatingActivities) || (netIncome5yr[netIncome5yr.length - 1] || 0) * 1.2;
    const capex = Math.abs(toNum(fin.capex || fin.capitalExpenditures)) || operatingCashFlow * 0.3;
    const promoterHoldingPct = ks.heldPercentInsiders != null ? ks.heldPercentInsiders * 100 : undefined;
    const grossMargin = latest.grossProfit && latest.totalRevenue ? (toNum(latest.grossProfit) / toNum(latest.totalRevenue)) * 100 : (peRatio > 0 ? 30 : 0);
    const netMargin = netIncome5yr[netIncome5yr.length - 1] && revenue5yr[revenue5yr.length - 1] ? (netIncome5yr[netIncome5yr.length - 1] / revenue5yr[revenue5yr.length - 1]) * 100 : (peRatio > 0 ? 10 : 0);
    const roe = totalEquity > 0 ? (netIncome5yr[netIncome5yr.length - 1] / totalEquity) * 100 : (eps > 0 && bookValuePerShare > 0 ? (eps / bookValuePerShare) * 100 : 0);
    const isBank = !bs.inventory || (totalDebt > totalEquity * 5 && totalAssets > 0);

    const data = {
      symbol: rawSymbol,
      market: market === 'IN' ? 'IN' : 'US',
      revenue5yr,
      netIncome5yr,
      eps5yr,
      totalAssets,
      totalLiabilities,
      totalEquity,
      totalDebt,
      retainedEarnings,
      workingCapital,
      ebit,
      marketCap,
      salesOrRevenue: revenue5yr[revenue5yr.length - 1] || 0,
      operatingCashFlow,
      capex,
      bookValuePerShare,
      promoterHoldingPct,
      grossMargin,
      netMargin,
      roe,
      isBank,
      currentRatio: currentLiab > 0 ? currentAssets / currentLiab : 1,
      // Extra fields from chart data
      price,
      peRatio,
      pbRatio,
      divYield,
      beta,
      source: qs ? 'yahoo-v10+v8' : 'yahoo-v8-only',
    };

    _fundamentalsCache.set(rawSymbol, { data, ts: Date.now() });
    res.set('Cache-Control', 'public, max-age=86400');
    return res.json(data);
  } catch (e) {
    return jsonError(res, 502, 'Failed to fetch fundamentals data.', e);
  }
});

// ------------------------------------------------------------
// POST /api/superintelligence/news → fetch portfolio-specific news
// ------------------------------------------------------------
// Calls Tavily with a portfolio-aware query (top holdings + macro),
// returns classified news items the frontend can render.
// Body: { symbols: string[], macroQuery?: string }
// ------------------------------------------------------------
app.post('/api/superintelligence/news', async (req, res) => {
  if (!KEYS.tavily) return jsonError(res, 503, 'tavily not configured');
  try {
    const { symbols = [], macroQuery } = req.body || {};
    const topSyms = (Array.isArray(symbols) ? symbols : []).slice(0, 5).map(s => String(s).replace('.NS', '').replace('.BO', ''));
    const portfolioQuery = topSyms.length > 0
      ? `${topSyms.join(' ')} stock news latest quarterly results insider trading institutional moves today`
      : 'India stock market NIFTY today top news';
    const macroQ = macroQuery || 'India NIFTY SENSEX US Fed RBI inflation crude oil gold market today';

    const runTavily = async (query) => {
      const upstream = await fetch('https://api.tavily.com/search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          api_key: KEYS.tavily,
          query,
          search_depth: 'basic',
          max_results: 6,
          include_answer: true,
        }),
        signal: AbortSignal.timeout(10000),
      });
      if (!upstream.ok) return { answer: '', results: [] };
      return await upstream.json();
    };

    const [pData, mData] = await Promise.all([runTavily(portfolioQuery), runTavily(macroQ)]);

    const classify = (text) => {
      const pos = /\b(beat|surge|rally|gain|profit|growth|upgrade|buy|bullish|record|high|jump|rise|boost|strong|outperform)\b/i;
      const neg = /\b(miss|fall|drop|decline|loss|downgrade|sell|bearish|low|crash|plunge|weak|underperform|fraud|scam|investigation|default)\b/i;
      if (pos.test(text) && !neg.test(text)) return 'positive';
      if (neg.test(text) && !pos.test(text)) return 'negative';
      return 'neutral';
    };

    const mapResults = (data, fallbackSymbol) => (data?.results || []).slice(0, 6).map(r => ({
      symbol: fallbackSymbol,
      headline: r.title || '',
      summary: (r.content || '').substring(0, 250),
      url: r.url,
      publishedDate: r.published_date || new Date().toISOString().split('T')[0],
      sentiment: classify(`${r.title || ''} ${r.content || ''}`),
    }));

    const portfolioNews = mapResults(pData, 'PORTFOLIO').map(n => {
      // Try to tag with the matching holding symbol.
      const match = topSyms.find(s => (n.headline + n.summary).toUpperCase().includes(s));
      return { ...n, symbol: match || n.symbol };
    });
    const macroNews = mapResults(mData, 'MACRO');

    res.json({
      portfolioNews,
      macroNews,
      answer: pData.answer || '',
      fetchedAt: Date.now(),
    });
  } catch (e) {
    return jsonError(res, 502, 'Failed to fetch market news.', e);
  }
});

// ------------------------------------------------------------
// GET /api/inflation → India CPI + US CPI for real-returns calc
// ------------------------------------------------------------
// Fetches India CPI YoY from World Bank API (free, no key) and US CPI
// from BLS-style endpoint. Cached 24h because CPI is monthly.
// ------------------------------------------------------------
let _inflationCache = { data: null, ts: 0 };
const INFLATION_TTL = 24 * 60 * 60 * 1000;

app.get('/api/inflation', async (_req, res) => {
  if (_inflationCache.data && Date.now() - _inflationCache.ts < INFLATION_TTL) {
    return res.json(_inflationCache.data);
  }
  // World Bank API: indicator FP.CPI.TOTL.ZG (inflation, consumer prices %)
  // Latest value per country. Returns array of observations.
  async function fetchWB(country) {
    try {
      const url = `https://api.worldbank.org/v2/country/${country}/indicator/FP.CPI.TOTL.ZG?format=json&per_page=5&date=2023:2024`;
      const r = await fetch(url, { signal: AbortSignal.timeout(5000) });
      if (!r.ok) return null;
      const j = await r.json();
      const obs = j?.[1];
      if (Array.isArray(obs) && obs.length > 0) {
        // First entry is most recent.
        const v = obs[0]?.value;
        if (typeof v === 'number' && v > -50 && v < 200) return v;
      }
    } catch { /* fall through */ }
    return null;
  }
  const [india, us] = await Promise.all([fetchWB('IN'), fetchWB('US')]);
  const data = {
    india: india ?? 6,    // fallback to typical long-run avg
    us: us ?? 3,
    source: 'World Bank CPI (FP.CPI.TOTL.ZG)',
    fetchedAt: new Date().toISOString(),
  };
  _inflationCache = { data, ts: Date.now() };
  res.set('Cache-Control', 'public, max-age=86400');
  return res.json(data);
});

// Market Intelligence — Snapshot of market regime, top picks, risk
// ------------------------------------------------------------
const marketIntelligence = (() => {
  // Simple cache so we don't re-analyze every request
  let cache = { data: null, ts: 0 };
  return (req, res) => {
    const now = Date.now();
    if (cache.data && now - cache.ts < 30000) return res.json(cache.data);
    const regime = getRegime();
    const insight = {
      regime: regime.regime,
      regimeConfidence: regime.confidence,
      recommendation: regime.regime === 'bullish' ? 'aggressive' : regime.regime === 'bearish' ? 'defensive' : 'neutral',
      marketCondition: getMarketCondition(regime.regime),
      riskLevel: regime.regime === 'bearish' ? 'high' : regime.regime === 'volatile' ? 'elevated' : 'normal',
      timestamp: new Date().toISOString(),
    };
    cache = { data: insight, ts: now };
    res.json(insight);
  };
})();
app.get('/api/ml/market-intelligence', marketIntelligence);

function getMarketCondition(regime) {
  const map = { bullish: 'Bull market — favorable for long positions', bearish: 'Bear market — favor cash or hedges', volatile: 'High volatility — reduce position size', sideways: 'Range-bound — trade the edges' };
  return map[regime] || 'Neutral market';
}

// Static frontend (built by `vite build` → dist/)
// ------------------------------------------------------------
const distDir = path.resolve(__dirname, '..', 'dist');
app.use(express.static(distDir));

// SPA fallback for any non-/api route.
// FIX C8: When a code-split chunk (e.g. /assets/vendor-charts-abc.js) is
// missing after a redeploy, the previous catch-all served index.html for the
// JS file, the browser tried to parse HTML as JS, and the entire app died
// with "Failed to fetch dynamically imported module". Return a real 404 for
// asset paths so the browser surfaces the error and the lazy-retry logic in
// App.tsx (lazyWithRetry) can force a clean reload.
app.get(/^(?!\/api\/).*/, (req, res) => {
  const isAsset = req.path.startsWith('/assets/')
    || /\.(js|mjs|css|map|ico|svg|png|jpe?g|webp|woff2?|ttf|otf|json|wasm)$/i.test(req.path);
  if (isAsset) return res.status(404).send('Not found');
  res.sendFile(path.join(distDir, 'index.html'));
});

// ============================================================
// DHAN + SHOONYA BROKER CONNECTORS (read-only, server-side)
// ============================================================
// Dhan API: https://dhanhq.co/docs/v2/ (REST, access token)
// Shoonya API: https://shoonya.finvasia.com/ (REST + WebSocket, free)
// Both are read-only here — no order placement (free tier safe).
// ============================================================

// GET /api/broker/status → which broker is configured
app.get('/api/broker/status', (_req, res) => {
  res.json({
    dhan: !!(process.env.DHAN_CLIENT_ID && process.env.DHAN_ACCESS_TOKEN),
    shoonya: !!(process.env.SHOONYA_USER_ID && process.env.SHOONYA_PASSWORD && process.env.SHOONYA_VENDOR_CODE),
  });
});

// GET /api/broker/dhan/positions → live positions from Dhan
app.get('/api/broker/dhan/positions', async (_req, res) => {
  const clientId = process.env.DHAN_CLIENT_ID;
  const token = process.env.DHAN_ACCESS_TOKEN;
  if (!clientId || !token) return jsonError(res, 503, 'Dhan not configured');
  try {
    const r = await fetch('https://api.dhan.co/v2/positions', {
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
        'access-token': token,
        'client-id': clientId,
      },
      signal: AbortSignal.timeout(8000),
    });
    if (!r.ok) return jsonError(res, 502, 'Broker API error.');
    const data = await r.json();
    res.json(data);
  } catch (e) {
    return jsonError(res, 502, 'Failed to fetch broker positions.', e);
  }
});

// GET /api/broker/dhan/holdings → long-term holdings from Dhan
app.get('/api/broker/dhan/holdings', async (_req, res) => {
  const clientId = process.env.DHAN_CLIENT_ID;
  const token = process.env.DHAN_ACCESS_TOKEN;
  if (!clientId || !token) return jsonError(res, 503, 'Dhan not configured');
  try {
    const r = await fetch('https://api.dhan.co/v2/holdings', {
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
        'access-token': token,
        'client-id': clientId,
      },
      signal: AbortSignal.timeout(8000),
    });
    if (!r.ok) return jsonError(res, 502, 'Broker API error.');
    const data = await r.json();
    res.json(data);
  } catch (e) {
    return jsonError(res, 502, 'Failed to fetch broker positions.', e);
  }
});

// GET /api/broker/shoonya/holdings → holdings from Shoonya (Finvasia)
// Shoonya uses a session-based API. For simplicity, we do a login + fetch
// in one request. Token is cached for the session.
let _shoonyaToken = null;
let _shoonyaTokenTs = 0;
const SHOONYA_TOKEN_TTL = 5 * 60 * 1000; // 5 min

app.get('/api/broker/shoonya/holdings', async (_req, res) => {
  const userId = process.env.SHOONYA_USER_ID;
  const password = process.env.SHOONYA_PASSWORD;
  const vendor = process.env.SHOONYA_VENDOR_CODE;
  const apiKey = process.env.SHOONYA_API_KEY || '';
  const imei = process.env.SHOONYA_IMEI || '100001';  // dummy IMEI

  if (!userId || !password || !vendor) {
    return jsonError(res, 503, 'Shoonya not configured');
  }

  try {
    // Login if token is stale
    if (!_shoonyaToken || Date.now() - _shoonyaTokenTs > SHOONYA_TOKEN_TTL) {
      const loginRes = await fetch('https://api.shoonya.com/NorenWClientTP/QuickAuth', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          source: 'API',
          apiversion: '1.0.0',
          imei,
          uid: userId,
          pwd: password,
          factor2: apiKey,
          vc: vendor,
          appkey: Buffer.from(JSON.stringify({ appkey: apiKey, secret: process.env.SHOONYA_API_KEY ? 'api' : 'shoonya' })).toString('base64'),
        }),
        signal: AbortSignal.timeout(6000),
      });
      const loginData = await loginRes.json();
      if (loginData?.stat !== 'Ok') {
        return jsonError(res, 401, 'Broker authentication failed. Check credentials.');
      }
      _shoonyaToken = loginData.susertoken;
      _shoonyaTokenTs = Date.now();
    }

    // Fetch holdings
    const holdRes = await fetch('https://api.shoonya.com/NorenWClientTP/Holdings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        uid: userId,
        actid: userId,
        token: _shoonyaToken,
      }),
      signal: AbortSignal.timeout(6000),
    });
    const holdData = await holdRes.json();
    res.json({ holdings: Array.isArray(holdData) ? holdData : [], source: 'shoonya' });
  } catch (e) {
    _shoonyaToken = null;  // force re-login on next call
    return jsonError(res, 502, 'Failed to fetch broker holdings.', e);
  }
});

// ============================================================
// TRADE JOURNAL ANALYZER (server-side CSV parse + behavior diagnostics)
// ============================================================
// POST /api/journal/analyze → { trades: CSV rows } → { roundtrips, diagnostics }
// ============================================================
app.post('/api/journal/analyze', (req, res) => {
  const { trades } = req.body || {};
  if (!Array.isArray(trades) || trades.length === 0) {
    return jsonError(res, 400, 'trades[] required');
  }
  // SECURITY: cap input size to prevent DoS via huge payloads.
  const MAX_TRADES = 10000;
  const cappedTrades = trades.slice(0, MAX_TRADES);
  try {
    // FIFO pairing: match buys to sells per symbol
    const bySymbol = {};
    for (const t of cappedTrades) {
      const sym = String(t.symbol || '').toUpperCase().trim().slice(0, 20);
      if (!sym) continue;
      if (!bySymbol[sym]) bySymbol[sym] = [];
      bySymbol[sym].push(t);
    }

    const roundtrips = [];
    for (const [sym, symTrades] of Object.entries(bySymbol)) {
      // Sort by date
      symTrades.sort((a, b) => (a.date || '').localeCompare(b.date || ''));
      const buyQueue = [];
      for (const t of symTrades) {
        const qty = parseFloat(t.qty) || 0;
        const price = parseFloat(t.price) || 0;
        const type = (t.type || '').toLowerCase();
        if (type === 'buy') {
          buyQueue.push({ qty, price, date: t.date });
        } else if (type === 'sell' && buyQueue.length > 0) {
          let remaining = qty;
          while (remaining > 0 && buyQueue.length > 0) {
            const buy = buyQueue[0];
            const matched = Math.min(remaining, buy.qty);
            const pnl = (price - buy.price) * matched;
            const holdDays = buy.date ?
              Math.round((new Date(t.date) - new Date(buy.date)) / 86400000) : 0;
            roundtrips.push({
              symbol: sym,
              buyDate: buy.date,
              sellDate: t.date,
              qty: matched,
              buyPrice: buy.price,
              sellPrice: price,
              pnl,
              pnlPct: buy.price > 0 ? (pnl / (buy.price * matched)) * 100 : 0,
              holdDays,
            });
            buy.qty -= matched;
            remaining -= matched;
            if (buy.qty <= 0) buyQueue.shift();
          }
        }
      }
    }

    // Behavior diagnostics
    const wins = roundtrips.filter(r => r.pnl > 0);
    const losses = roundtrips.filter(r => r.pnl < 0);
    const winRate = roundtrips.length > 0 ? (wins.length / roundtrips.length) * 100 : 0;
    const avgWinHold = wins.length > 0 ? wins.reduce((s, r) => s + r.holdDays, 0) / wins.length : 0;
    const avgLossHold = losses.length > 0 ? losses.reduce((s, r) => s + r.holdDays, 0) / losses.length : 0;
    const dispositionRatio = avgLossHold > 0 && avgWinHold > 0 ? avgLossHold / avgWinHold : 0;

    // Disposition effect: holding losers longer than winners
    let dispositionSeverity = 'none';
    if (dispositionRatio > 1.5) dispositionSeverity = 'high';
    else if (dispositionRatio > 1.2) dispositionSeverity = 'medium';

    // Overtrading: trades per week
    const tradesPerWeek = roundtrips.length > 0 && trades.length > 0 ?
      roundtrips.length / Math.max(1, Math.ceil((new Date(trades[trades.length - 1].date) - new Date(trades[0].date)) / (7 * 86400000))) : 0;
    let overtradingSeverity = 'none';
    if (tradesPerWeek > 10) overtradingSeverity = 'high';
    else if (tradesPerWeek > 5) overtradingSeverity = 'medium';

    // Chasing momentum: buys after >3% run-up (approximated)
    const chasingCount = trades.filter(t => {
      const change = parseFloat(t.change || 0);
      return t.type?.toLowerCase() === 'buy' && change > 3;
    }).length;
    const chasingPct = trades.length > 0 ? (chasingCount / trades.length) * 100 : 0;
    let chasingSeverity = 'none';
    if (chasingPct > 30) chasingSeverity = 'high';
    else if (chasingPct > 15) chasingSeverity = 'medium';

    res.json({
      roundtrips: roundtrips.slice(-100),  // last 100
      summary: {
        totalTrades: trades.length,
        totalRoundtrips: roundtrips.length,
        winRate: Math.round(winRate * 10) / 10,
        avgWinHoldDays: Math.round(avgWinHold),
        avgLossHoldDays: Math.round(avgLossHold),
        totalPnL: Math.round(roundtrips.reduce((s, r) => s + r.pnl, 0)),
        tradesPerWeek: Math.round(tradesPerWeek * 10) / 10,
      },
      diagnostics: {
        disposition: {
          severity: dispositionSeverity,
          ratio: Math.round(dispositionRatio * 100) / 100,
          detail: `Losses held ${Math.round(avgLossHold)}d vs wins ${Math.round(avgWinHold)}d (${Math.round(dispositionRatio * 100) / 100}x)`,
        },
        overtrading: {
          severity: overtradingSeverity,
          tradesPerWeek: Math.round(tradesPerWeek * 10) / 10,
          detail: `${Math.round(tradesPerWeek * 10) / 10} trades/week`,
        },
        chasing: {
          severity: chasingSeverity,
          pct: Math.round(chasingPct),
          detail: `${chasingCount}/${trades.length} buys after >3% run-up`,
        },
      },
    });
  } catch (e) {
    return jsonError(res, 500, 'Journal analysis failed.', e);
  }
});

// ============================================================
// PATTERN RECOGNITION (server-side, pure JS)
// ============================================================
// POST /api/patterns/detect → { candles: OHLCV[] } → { patterns: [] }
// ============================================================
app.post('/api/patterns/detect', (req, res) => {
  const { candles } = req.body || {};
  if (!Array.isArray(candles) || candles.length < 10) {
    return jsonError(res, 400, 'candles[] (min 10) required');
  }
  // SECURITY: cap input size to prevent DoS via huge payloads.
  const MAX_CANDLES = 5000;
  const cappedCandles = candles.slice(0, MAX_CANDLES);
  try {
    const patterns = [];
    const closes = cappedCandles.map(c => c.close);
    const highs = cappedCandles.map(c => c.high);
    const lows = cappedCandles.map(c => c.low);
    const n = closes.length;

    // 1. Support/Resistance (peak/valley clustering)
    const peaks = [], valleys = [];
    for (let i = 2; i < n - 2; i++) {
      if (highs[i] > highs[i-1] && highs[i] > highs[i-2] && highs[i] > highs[i+1] && highs[i] > highs[i+2]) {
        peaks.push({ idx: i, price: highs[i] });
      }
      if (lows[i] < lows[i-1] && lows[i] < lows[i-2] && lows[i] < lows[i+1] && lows[i] < lows[i+2]) {
        valleys.push({ idx: i, price: lows[i] });
      }
    }
    if (peaks.length >= 2) {
      const resistance = peaks[peaks.length - 1].price;
      patterns.push({ type: 'resistance', price: resistance, strength: peaks.length, note: `Resistance at ${resistance.toFixed(2)}` });
    }
    if (valleys.length >= 2) {
      const support = valleys[valleys.length - 1].price;
      patterns.push({ type: 'support', price: support, strength: valleys.length, note: `Support at ${support.toFixed(2)}` });
    }

    // 2. Double Top / Bottom (last 30 candles)
    const recentPeaks = peaks.slice(-2);
    if (recentPeaks.length === 2) {
      const diff = Math.abs(recentPeaks[0].price - recentPeaks[1].price) / recentPeaks[0].price;
      if (diff < 0.02) {
        patterns.push({ type: 'double_top', price: recentPeaks[0].price, note: `Double top at ${recentPeaks[0].price.toFixed(2)} — bearish reversal signal` });
      }
    }
    const recentValleys = valleys.slice(-2);
    if (recentValleys.length === 2) {
      const diff = Math.abs(recentValleys[0].price - recentValleys[1].price) / recentValleys[0].price;
      if (diff < 0.02) {
        patterns.push({ type: 'double_bottom', price: recentValleys[0].price, note: `Double bottom at ${recentValleys[0].price.toFixed(2)} — bullish reversal signal` });
      }
    }

    // 3. Trend line slope (linear regression on last 20 closes)
    if (n >= 20) {
      const recent = closes.slice(-20);
      const x = recent.map((_, i) => i);
      const xMean = x.reduce((a, b) => a + b, 0) / x.length;
      const yMean = recent.reduce((a, b) => a + b, 0) / recent.length;
      const num = x.reduce((s, xi, i) => s + (xi - xMean) * (recent[i] - yMean), 0);
      const den = x.reduce((s, xi) => s + (xi - xMean) ** 2, 0);
      const slope = den !== 0 ? num / den : 0;
      const slopePct = (slope / yMean) * 100;
      if (slopePct > 0.5) {
        patterns.push({ type: 'uptrend', slope: slopePct, note: `Strong uptrend (${slopePct.toFixed(2)}%/bar)` });
      } else if (slopePct < -0.5) {
        patterns.push({ type: 'downtrend', slope: slopePct, note: `Strong downtrend (${slopePct.toFixed(2)}%/bar)` });
      }
    }

    // 4. Candlestick patterns (last candle)
    const last = candles[n - 1];
    const body = Math.abs(last.close - last.open);
    const range = last.high - last.low;
    const upperWick = last.high - Math.max(last.close, last.open);
    const lowerWick = Math.min(last.close, last.open) - last.low;

    if (range > 0 && body / range < 0.1) {
      patterns.push({ type: 'doji', note: 'Doji — indecision, potential reversal' });
    }
    if (lowerWick > body * 2 && upperWick < body * 0.5) {
      patterns.push({ type: 'hammer', note: 'Hammer — bullish reversal at support' });
    }
    if (upperWick > body * 2 && lowerWick < body * 0.5) {
      patterns.push({ type: 'shooting_star', note: 'Shooting Star — bearish reversal at resistance' });
    }

    // 5. Head and Shoulders (last 60 bars)
    if (peaks.length >= 3 && n >= 60) {
      const last3 = peaks.slice(-3);
      if (last3[1].price > last3[0].price && last3[1].price > last3[2].price &&
          Math.abs(last3[0].price - last3[2].price) / last3[0].price < 0.03) {
        patterns.push({ type: 'head_shoulders', note: 'Head & Shoulders — major bearish reversal pattern' });
      }
    }

    res.json({ patterns, candleCount: n });
  } catch (e) {
    return jsonError(res, 500, 'Pattern detection failed.', e);
  }
});

// ============================================================
// THESIS TRACKER (server-side, in-memory + localStorage on client)
// ============================================================
// POST /api/thesis → create/update thesis
// GET /api/thesis → list theses
// DELETE /api/thesis/:id → delete
// ============================================================
const _theses = new Map();  // id → thesis object

app.get('/api/thesis', (_req, res) => {
  const list = Array.from(_theses.values()).sort((a, b) => b.updatedAt - a.updatedAt);
  res.json(list);
});

app.post('/api/thesis', (req, res) => {
  const { symbol, thesis, criteria, status, evidence } = req.body || {};
  if (!symbol || !thesis) return jsonError(res, 400, 'symbol + thesis required');

  // SECURITY: IDOR fix — always generate a NEW server-side ID on create.
  // The client can no longer supply an `id` to overwrite an existing thesis.
  // To update an existing thesis, use PUT /api/thesis/:id (below).
  const tid = `thesis_${Date.now()}_${crypto.randomBytes(5).toString('hex')}`;
  const updated = {
    id: tid,
    symbol: String(symbol).toUpperCase().slice(0, 20),
    thesis: String(thesis).slice(0, 10000),
    criteria: Array.isArray(criteria) ? criteria.slice(0, 50) : [],
    status: status || 'active',
    evidence: Array.isArray(evidence) ? evidence.slice(0, 50) : [],
    updatedAt: Date.now(),
    createdAt: Date.now(),
  };
  _theses.set(tid, updated);
  res.json(updated);
});

// PUT /api/thesis/:id → update an existing thesis (must exist)
app.put('/api/thesis/:id', (req, res) => {
  const tid = req.params.id;
  const existing = _theses.get(tid);
  if (!existing) return jsonError(res, 404, 'thesis not found');
  const { symbol, thesis, criteria, status, evidence } = req.body || {};
  const updated = {
    ...existing,
    symbol: symbol ? String(symbol).toUpperCase().slice(0, 20) : existing.symbol,
    thesis: thesis ? String(thesis).slice(0, 10000) : existing.thesis,
    criteria: Array.isArray(criteria) ? criteria.slice(0, 50) : existing.criteria,
    status: status || existing.status,
    evidence: Array.isArray(evidence) ? evidence.slice(0, 50) : existing.evidence,
    updatedAt: Date.now(),
  };
  _theses.set(tid, updated);
  res.json(updated);
});

app.delete('/api/thesis/:id', (req, res) => {
  _theses.delete(req.params.id);
  res.json({ ok: true });
});

// ============================================================
// SCHEDULED RESEARCH (server-side cron)
// ============================================================
// POST /api/schedule → create scheduled job
// GET /api/schedule → list jobs
// DELETE /api/schedule/:id → delete job
// ============================================================
// FIX: Render free tier has ephemeral filesystem — cron state is in-memory only.
// Jobs must be re-created on each deploy. Client-side localStorage backup.
const _scheduledJobs = new Map();

app.get('/api/schedule', (_req, res) => {
  const list = Array.from(_scheduledJobs.values());
  res.json(list);
});

app.post('/api/schedule', (req, res) => {
  const { prompt, cron, enabled } = req.body || {};
  if (!prompt || !cron) return jsonError(res, 400, 'prompt + cron required');

  // SECURITY: IDOR fix — always generate a NEW server-side ID.
  const jid = `job_${Date.now()}_${crypto.randomBytes(5).toString('hex')}`;
  const job = {
    id: jid,
    prompt: String(prompt).slice(0, 5000),
    cron: String(cron).slice(0, 100),
    enabled: enabled !== false,
    createdAt: Date.now(),
    lastRunAt: null,
    nextRunAt: null,
  };
  _scheduledJobs.set(jid, job);
  res.json(job);
});

app.delete('/api/schedule/:id', (req, res) => {
  _scheduledJobs.delete(req.params.id);
  res.json({ ok: true });
});

// ============================================================
// HEALTH ENDPOINT — used by Render health check + uptime monitors
// ============================================================
app.get('/health', (_req, res) => {
  res.json({
    ok: true,
    uptime: process.uptime(),
    botAlive: _botProcess && !_botProcess.killed,
    providers: Object.entries(KEYS).filter(([, v]) => v).map(([k]) => k),
    timestamp: Date.now(),
  });
});

// ============================================================
// START SERVER + BOT
// ============================================================
let _botProcess = null;
let _botRestartTimer = null;

// ------------------------------------------------------------
// Startup environment validation.
// APP_PIN is REQUIRED — without it, the app has no authentication
// and all endpoints are public. The server refuses to start.
// ------------------------------------------------------------
function validateEnv() {
  const errors = [];
  const warnings = [];

  if (!APP_PIN) {
    errors.push(
      'APP_PIN is not set. The server requires a PIN for authentication. ' +
      'Set APP_PIN in your environment variables (e.g. APP_PIN=1234).'
    );
  }

  // TG_TOKEN + TG_CHAT_ID must be set TOGETHER (or both absent).
  if (!!TG.token !== !!TG.chatId) {
    errors.push(
      `TG_TOKEN and TG_CHAT_ID must both be set (or both empty). ` +
      `TG_TOKEN=${TG.token ? 'set' : 'empty'}, TG_CHAT_ID=${TG.chatId ? 'set' : 'empty'}.`
    );
  }

  // Warn if no AI provider keys are set.
  const anyAiKey = Object.values(KEYS).some(v => v);
  if (!anyAiKey) {
    warnings.push('No AI provider keys configured — NeuralChat and AI features will be unavailable.');
  }

  for (const w of warnings) console.warn(`[wealth-ai] WARNING: ${w}`);
  for (const e of errors) console.error(`[wealth-ai] ERROR: ${e}`);
  if (errors.length > 0) {
    console.error('[wealth-ai] Refusing to start due to configuration errors.');
    process.exit(1);
  }
}

function startBot() {
  if (!TG.token) {
    console.log('[wealth-ai] TG_TOKEN not configured. Telegram Bot not started.');
    return;
  }
  try {
    const botPath = path.resolve(__dirname, '..', 'telegram-bot', 'bot.mjs');
    console.log('[wealth-ai] Starting Telegram Bot (server-side child process).');
    _botProcess = fork(botPath, [], {
      env: { ...process.env, BOT_ONLY: 'true' },
    });
    _botProcess.on('error', (err) => {
      console.error('[wealth-ai] Bot process error:', err.message);
    });
    _botProcess.on('exit', (code) => {
      console.warn(`[wealth-ai] Bot exited code=${code} — auto-restart in 5s`);
      clearTimeout(_botRestartTimer);
      _botRestartTimer = setTimeout(() => {
        console.log('[wealth-ai] Restarting bot...');
        startBot();
      }, 5000);
    });
  } catch (e) {
    console.error('[wealth-ai] Failed to start bot:', e.message);
    clearTimeout(_botRestartTimer);
    _botRestartTimer = setTimeout(startBot, 10000);
  }
}

// Run env validation before binding the port.
validateEnv();

app.listen(PORT, () => {
  const ready = Object.entries(KEYS).filter(([, v]) => v).map(([k]) => k);
  console.log(`[wealth-ai] server on :${PORT} — providers: ${ready.join(', ') || 'NONE'}`);
  console.log('[wealth-ai] Authentication: enabled (server-side PIN + httpOnly session cookie)');

  // No self-ping keepalive (Render ToS violation).
  // For 24x7 uptime on free tier, use an EXTERNAL uptime monitor
  // (e.g. UptimeRobot) that pings /health every 5 min.

  // Start Telegram bot with auto-restart
  startBot();
});
