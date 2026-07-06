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

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = process.env.PORT || 8080;
const DEFAULT_USD_INR = 83.5;

app.use(express.json({ limit: '1mb' }));

// --- CORS (allow the SPA to call us from any origin) ---
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
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

// Telegram bot credentials (server-side env) — used by the /api/telegram proxy
// so the website can send notifications even if the browser has no local config.
const TG = {
  token: process.env.TG_TOKEN || process.env.VITE_TG_TOKEN || '',
  chatId: process.env.TG_CHAT_ID || process.env.VITE_TG_CHAT_ID || '',
};

// OpenAI-compatible providers — body is forwarded almost as-is.
const OPENAI_COMPAT = {
  groq: { url: 'https://api.groq.com/openai/v1/chat/completions', defModel: 'llama-3.3-70b-versatile' },
  openrouter: { url: 'https://openrouter.ai/api/v1/chat/completions', defModel: 'meta-llama/llama-3.3-70b-instruct:free' },
  cerebras: { url: 'https://api.cerebras.ai/v1/chat/completions', defModel: 'llama-3.3-70b' },
  huggingface: { url: 'https://router.huggingface.co/v1/chat/completions', defModel: 'Qwen/Qwen2.5-72B-Instruct' },
  nvidia: { url: 'https://integrate.api.nvidia.com/v1/chat/completions', defModel: 'meta/llama-3.3-70b-instruct' },
};

function jsonError(res, status, message) {
  return res.status(status).json({ error: { message } });
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
  const key = process.env.FINNHUB_API_KEY || process.env.VITE_FINNHUB_API_KEY || '';
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
    return jsonError(res, 502, `CoinDCX fetch failed: ${e?.message || e}`);
  }
});

// ------------------------------------------------------------
// GET /api/forex → USD/INR rate proxy with server-side caching
// ------------------------------------------------------------
// Multiple upstream fallbacks so the rate is always available even if
// one free API is down. Cached 10s server-side to reduce upstream load.
// ------------------------------------------------------------
let _forexCache = { rate: DEFAULT_USD_INR, ts: 0 };
const FOREX_CACHE_MS = 10000;

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
      return jsonError(res, 502, `${name} upstream error: ${e?.message || e}`);
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
    return jsonError(res, 502, `tavily upstream error: ${e?.message || e}`);
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
    return jsonError(res, 502, `gemini upstream error: ${e?.message || e}`);
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
    return jsonError(res, 502, `claude upstream error: ${e?.message || e}`);
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
  try {
    const upstream = await fetch(`https://api.telegram.org/bot${TG.token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: TG.chatId, text: message.slice(0, 4096), parse_mode: 'HTML', disable_web_page_preview: true }),
      signal: AbortSignal.timeout(10000),
    });
    const text = await upstream.text();
    res.status(upstream.status).type('application/json').send(text || '{}');
  } catch (e) {
    return jsonError(res, 502, `telegram upstream error: ${e?.message || e}`);
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
  const market = String(req.query.market || '').toUpperCase();

  const cached = _fundamentalsCache.get(rawSymbol);
  if (cached && Date.now() - cached.ts < FUNDAMENTALS_TTL) {
    return res.json(cached.data);
  }

  // Map to Yahoo ticker (same logic as /api/chart)
  const ysym = toYahooSymbol(rawSymbol, market);

  try {
    // Yahoo quoteSummary endpoint — fetch multiple modules in one call.
    const modules = 'incomeStatementHistory,balanceSheetHistory,defaultKeyStatistics,financialData,summaryDetail,price';
    const url = `https://query1.finance.yahoo.com/v10/finance/quoteSummary/${encodeURIComponent(ysym)}?modules=${modules}`;
    const r = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (WealthAI fundamentals proxy)' },
      signal: AbortSignal.timeout(8000),
    });
    if (!r.ok) return jsonError(res, 502, `Yahoo upstream ${r.status}`);
    const j = await r.json();
    const qs = j?.quoteSummary?.result?.[0];
    if (!qs) return jsonError(res, 502, 'No quoteSummary result');

    // ---- Normalise into FundamentalData shape ----
    const income = qs.incomeStatementHistory?.incomeStatementHistory || [];
    const balance = qs.balanceSheetHistory?.balanceSheetStatements || [];
    const fin = qs.financialData || {};
    const ks = qs.defaultKeyStatistics || {};
    const sd = qs.summaryDetail || {};
    const px = qs.price || {};

    const latest = income[0] || {};
    const prev = income[1] || {};
    const bs = balance[0] || {};

    const toNum = (v) => {
      if (v == null) return 0;
      if (typeof v === 'number') return v;
      if (typeof v === 'object' && 'raw' in v) return v.raw || 0;
      return parseFloat(v) || 0;
    };

    const revenue5yr = income.map(i => toNum(i.totalRevenue)).reverse();
    const netIncome5yr = income.map(i => toNum(i.netIncome)).reverse();
    const eps5yr = (qs.incomeStatementHistory?.incomeStatementHistory || []).map(i => toNum(i.dilutedEPS)).reverse();

    const totalAssets = toNum(bs.totalAssets);
    const totalLiabilities = toNum(bs.totalLiab);
    const totalEquity = toNum(bs.totalStockholderEquity);
    const totalDebt = toNum(bs.totalDebt || bs.shortLongTermDebt);
    const retainedEarnings = toNum(bs.retainedEarnings);
    const currentAssets = toNum(bs.totalCurrentAssets);
    const currentLiab = toNum(bs.totalCurrentLiabilities);
    const workingCapital = currentAssets - currentLiab;
    const ebit = toNum(latest.operatingIncome) || toNum(latest.ebit);
    const marketCap = toNum(px.marketCap) || toNum(ks.marketCap);
    const salesOrRevenue = toNum(latest.totalRevenue);
    const operatingCashFlow = toNum(fin.operatingCashflow || fin.totalCashFromOperatingActivities);
    const capex = Math.abs(toNum(fin.capex || fin.capitalExpenditures));
    const bookValuePerShare = toNum(ks.bookValuePerShare);
    const promoterHoldingPct = ks.heldPercentInsiders != null
      ? ks.heldPercentInsiders * 100
      : undefined;

    const grossMargin = latest.grossProfit && latest.totalRevenue
      ? (latest.grossProfit.raw / latest.totalRevenue.raw) * 100 : 0;
    const netMargin = netIncome5yr[netIncome5yr.length - 1] && revenue5yr[revenue5yr.length - 1]
      ? (netIncome5yr[netIncome5yr.length - 1] / revenue5yr[revenue5yr.length - 1]) * 100 : 0;
    const roe = totalEquity > 0
      ? (netIncome5yr[netIncome5yr.length - 1] / totalEquity) * 100 : 0;

    // Heuristic: bank if balance sheet has no inventory AND no retained earnings flag typical of banks
    const isBank = !bs.inventory || (ks.beta && sd.beta && ks.forwardPE == null && totalDebt > totalEquity * 5);

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
      salesOrRevenue,
      operatingCashFlow,
      capex,
      bookValuePerShare,
      promoterHoldingPct,
      grossMargin,
      netMargin,
      roe,
      isBank,
      currentRatio: currentLiab > 0 ? currentAssets / currentLiab : 1,
    };

    _fundamentalsCache.set(rawSymbol, { data, ts: Date.now() });
    res.set('Cache-Control', 'public, max-age=86400');
    return res.json(data);
  } catch (e) {
    return jsonError(res, 502, `fundamentals fetch failed: ${e?.message || e}`);
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
    return jsonError(res, 502, `superintelligence news fetch failed: ${e?.message || e}`);
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

app.listen(PORT, () => {
  const ready = Object.entries(KEYS).filter(([, v]) => v).map(([k]) => k);
  console.log(`[wealth-ai] server on :${PORT} — providers ready: ${ready.join(', ') || 'NONE (set API keys!)'}`);

  // Start the Telegram bot as a background child process
  if (TG.token) {
    try {
      const botPath = path.resolve(__dirname, '..', 'telegram-bot', 'bot.mjs');
      console.log(`[wealth-ai] Starting Telegram Bot in background process: ${botPath}`);
      const botProcess = fork(botPath, [], {
        env: {
          ...process.env,
          BOT_ONLY: 'true'
        }
      });
      botProcess.on('error', (err) => {
        console.error('[wealth-ai] Telegram Bot process error:', err);
      });
      botProcess.on('exit', (code) => {
        console.warn(`[wealth-ai] Telegram Bot process exited with code ${code}`);
      });
    } catch (e) {
      console.error('[wealth-ai] Failed to start Telegram Bot process:', e);
    }
  } else {
    console.log('[wealth-ai] TG_TOKEN not configured. Telegram Bot not started.');
  }
});
