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
import { indmoneyEnabled, getIndmoneyStatus, executeTradetronSignal, deployStrategy, toggleStrategy, getStrategyStatus, getTradeHistory, getPositions as getTradetronPositions } from './indmoneyTradetron.js';
import { coindcxEnabled, getCoindcxStatus, placeFuturesOrder, cancelFuturesOrder, getFuturesOrders, getFuturesPositions, getFuturesBalance, getFuturesTradeHistory } from './coindcxFutures.js';
import { getAutoConfig, setAutoConfig, autoTick } from './autoTrader.js';
import { subscribe as feedSubscribe, snapshot as feedSnapshot, feedStatus } from './liveFeed.js';
import { ensureUsSubscribed, usClientUp, usClientDown } from './usStream.js';
import { ensureCryptoSubscribed, cryptoClientUp, cryptoClientDown } from './cryptoStream.js';
import { getPublicIp } from './resolveIp.js';
import {
  getMLPrediction, getAllSignals, getRegime, getBacktest,
  getPricePoints, getHealth as mlHealth
} from './mlEngine.js';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = process.env.PORT || 8080;

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
// THE FIX for "prices 15 minutes behind".
// The frontend previously read US prices from TradingView's *anonymous*
// scanner, which tags its feed `delayed_streaming_900` (= 900s / 15-min
// delayed). Polling fast can't help when the SOURCE is delayed.
//
// This endpoint returns the genuine real-time last price:
//   1. Finnhub  /quote   (if FINNHUB_API_KEY is set) — true real-time US trades
//   2. Yahoo Finance v8 chart meta.regularMarketPrice — real-time (~1-2s),
//      no API key required, server-side so there's no browser CORS issue.
// Query: ?symbols=SMH,VGT,SPCX&market=US   (comma separated, max 50)
// Resp:  { quotes: { SMH: {price,change,high,low,volume,prevClose,time,source}, ... } }
// ------------------------------------------------------------
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

  // India quotes — Groww NSE → Yahoo fallback (AngelOne removed)

  const remaining = symbols.filter(s => !quotes[s]);
  await Promise.allSettled(remaining.map(async (sym) => {
    // 1a) India real-time → Groww NSE live feed (datacenter-friendly, ETF-safe).
    if (market === 'IN') {
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
// GET /api/stream  → Server-Sent Events: pushes live ticks to the browser.
// Query: ?in=RELIANCE,NIFTYBEES&us=SMH,VGT&crypto=BTC,ETH
// Events: `snapshot` (initial map), `tick` ({key,price,change,...}), `status`.
// Replaces 2s polling with real-time push (AngelOne NSE ws, Finnhub US ws,
// Binance crypto ws). Per-key throttle keeps the stream light.
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
// Body: { message: string, chatId?: string }
// ------------------------------------------------------------
app.post('/api/telegram', async (req, res) => {
  if (!TG.token) return jsonError(res, 503, 'telegram not configured on server');
  const { message, chatId } = req.body || {};
  const target = chatId || TG.chatId;
  if (!message || !target) return jsonError(res, 400, 'message and chatId required');
  try {
    const upstream = await fetch(`https://api.telegram.org/bot${TG.token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: target, text: message, parse_mode: 'HTML', disable_web_page_preview: true }),
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
// ALGO TRADING — INDMoney (Tradetron) + CoinDCX Futures
// ------------------------------------------------------------
// INDMoney trades are routed via Tradetron webhook.
// CoinDCX trades use direct HMAC-authenticated API.
// No static IP required for either!
// ------------------------------------------------------------

// --- INDMoney / Tradetron endpoints ---
app.post('/api/trade/place', async (req, res) => {
  if (!indmoneyEnabled()) return jsonError(res, 503, 'INDMoney/Tradetron not configured');
  const result = await executeTradetronSignal(req.body);
  return res.json(result);
});

app.post('/api/trade/deploy', async (req, res) => {
  const result = await deployStrategy(req.body || {});
  return res.json(result);
});

app.post('/api/trade/toggle', async (req, res) => {
  const { action } = req.body || {};
  const result = await toggleStrategy(action || 'pause');
  return res.json(result);
});

app.get('/api/trade/strategy-status', async (_req, res) => {
  const result = await getStrategyStatus();
  return res.json(result);
});

app.get('/api/trade/positions', async (_req, res) => {
  const result = await getTradetronPositions();
  return res.json(result);
});

app.get('/api/trade/history', async (_req, res) => {
  const result = await getTradeHistory();
  return res.json(result);
});

// --- CoinDCX Futures endpoints ---
app.post('/api/futures/place', async (req, res) => {
  if (!coindcxEnabled()) return jsonError(res, 503, 'CoinDCX not configured — API key/secret required');
  const result = await placeFuturesOrder(req.body);
  return res.json(result);
});

app.post('/api/futures/cancel', async (req, res) => {
  if (!coindcxEnabled()) return jsonError(res, 503, 'CoinDCX not configured');
  const { orderId } = req.body || {};
  if (!orderId) return jsonError(res, 400, 'orderId required');
  const result = await cancelFuturesOrder(orderId);
  return res.json(result);
});

app.get('/api/futures/orders', async (_req, res) => {
  const result = await getFuturesOrders();
  return res.json(result);
});

app.get('/api/futures/positions', async (_req, res) => {
  const result = await getFuturesPositions();
  return res.json(result);
});

app.get('/api/futures/balance', async (_req, res) => {
  const result = await getFuturesBalance();
  return res.json(result);
});

app.get('/api/futures/trades', async (_req, res) => {
  const result = await getFuturesTradeHistory();
  return res.json(result);
});

// Combined status: INDMoney + CoinDCX availability
app.get('/api/trade/status', (_req, res) => {
  res.set('Cache-Control', 'no-store');
  res.json({
    indmoney: getIndmoneyStatus(),
    coindcx: getCoindcxStatus(),
    publicIp: getPublicIp(),
  });
});

// ------------------------------------------------------------
// AUTO-TRADING — AI-driven entry/exit engine
// ------------------------------------------------------------
// Supports dual-broker: INDMoney (equity) + CoinDCX (crypto futures).
// The frontend drives the tick loop every ~30s.
// Config and state are kept in-memory.
// ------------------------------------------------------------
app.post('/api/trade/auto/config', async (req, res) => {
  const result = setAutoConfig(req.body || {});
  res.json(result);
});

app.get('/api/trade/auto/config', (_req, res) => {
  res.json(getAutoConfig());
});

app.post('/api/trade/auto/tick', async (req, res) => {
  const { signals } = req.body || {};
  const result = await autoTick(signals || []);
  res.json(result);
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

app.get('/api/ml/signals', (req, res) => {
  const portfolio = []; // These come from the frontend via body in practice
  const livePrices = {};
  const result = getAllSignals(portfolio, livePrices);
  res.json(result);
});

app.post('/api/ml/signals', (req, res) => {
  const { portfolio, livePrices } = req.body || {};
  const result = getAllSignals(portfolio || [], livePrices || {});
  res.json(result);
});

app.get('/api/ml/regime', (_req, res) => {
  // Uses best available market data for regime detection
  const regime = getRegime(
    { change: 0 }, { change: 0 },
    { price: 15 }, 18, 104, { change: 0 }
  );
  res.json(regime);
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

// SPA fallback for any non-/api route
app.get(/^(?!\/api\/).*/, (_req, res) => {
  res.sendFile(path.join(distDir, 'index.html'));
});

app.listen(PORT, () => {
  const ready = Object.entries(KEYS).filter(([, v]) => v).map(([k]) => k);
  console.log(`[wealth-ai] server on :${PORT} — providers ready: ${ready.join(', ') || 'NONE (set API keys!)'}`);
});
