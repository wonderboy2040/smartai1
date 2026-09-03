// ============================================================
// server/ai/signals.js — ensemble ORCHESTRATOR
// ------------------------------------------------------------
// Wires data (data.js) → models (models.js) → aggregation
// (ensemble.js) → LLM verification (AI Council) → ranked signal
// board, with a short server-side cache (scanner calls cost).
//
//   getSignals(market)      full board  (India stocks + indices,
//                            crypto majors) — 60s/45s cache
//   getDeepSignal(sym,mkt)  ONE symbol, all model votes + AI note
//   getFreshSignalForExec   the execute gauntlet's data source —
//                           always a FRESH single-symbol run
// ============================================================
import { computeIndicatorsFromCandles } from './lib/indicators.js';
import {
  INDIA_UNIVERSE, CRYPTO_UNIVERSE, fetchTVIndiaBatch, fetchTVCryptoBatch,
  fetchCoinDcxCandles, fetchYahooQuotes, isNseOpen,
} from './data.js';
import { MODELS, runQuantModels, aiCouncilVoteFromVerdict } from './models.js';
import { aggregateVotes, buildTradePlan, buildSignal, DEFAULT_GATES } from './ensemble.js';

const r2 = (v) => (Number.isFinite(v) ? Math.round(v * 100) / 100 : null);

// ---------------- caches ----------------
const _cache = new Map(); // key → { at, payload }
const MAX_CACHE_KEYS = 80; // keys are user-influenced (deep/:symbol) — bound the map
function cacheGet(key, ttlMs) {
  const hit = _cache.get(key);
  if (hit && Date.now() - hit.at < ttlMs) return hit.payload;
  return null;
}
function cacheSet(key, payload) {
  _cache.set(key, { at: Date.now(), payload });
  // Evict the oldest inserted entry (Map preserves insertion order) so
  // repeated distinct deep-symbols can't grow the cache unboundedly.
  while (_cache.size > MAX_CACHE_KEYS) {
    const oldest = _cache.keys().next().value;
    if (oldest === undefined) break;
    _cache.delete(oldest);
  }
}

// ---------------- Yahoo daily candles (for index/spot TA) ----------------
const YF_TICKER = {
  NIFTY: '^NSEI', BANKNIFTY: '^NSEBANK', FINNIFTY: 'NIFTY_FIN_SERVICE.NS',
  SENSEX: '^BSESN', INDIAVIX: '^INDIAVIX', BTC: 'BTC-USD',
};
async function fetchYahooCandles(key, range = '3mo') {
  const t = YF_TICKER[key];
  if (!t) return null;
  try {
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(t)}?interval=1d&range=${range}`;
    const r = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (WealthAI ai-signals)' },
      signal: AbortSignal.timeout(8000),
    });
    if (!r.ok) return null;
    const j = await r.json();
    const res = j?.chart?.result?.[0];
    const ts = res?.timestamp;
    const q = res?.indicators?.quote?.[0];
    if (!Array.isArray(ts) || !q) return null;
    const out = [];
    for (let i = 0; i < ts.length; i++) {
      if (q.open?.[i] == null || q.close?.[i] == null) continue;
      out.push({
        time: ts[i] * 1000,
        open: q.open[i], high: q.high?.[i] ?? q.close[i], low: q.low?.[i] ?? q.close[i],
        close: q.close[i], volume: q.volume?.[i] || 0,
      });
    }
    return out.length >= 30 ? out : null;
  } catch { return null; }
}

// ---------------- TV row → indicator context ----------------
function tvToInd(row, ltp) {
  const bb = row.bbUpper != null && row.bbLower != null && ltp ? {
    upper: row.bbUpper, lower: row.bbLower, mid: (row.bbUpper + row.bbLower) / 2,
    percentB: (ltp - row.bbLower) / Math.max(1e-9, row.bbUpper - row.bbLower),
    widthPct: ((row.bbUpper - row.bbLower) / ((row.bbUpper + row.bbLower) / 2)) * 100,
  } : null;
  const macdHist = (row.macd != null && row.macdSignal != null) ? row.macd - row.macdSignal : null;
  return {
    rsi: row.rsi ?? null,
    macd: macdHist != null ? { macd: row.macd, signal: row.macdSignal, hist: macdHist, histSlope: macdHist } : null,
    ema10: row.ema10 ?? null, ema20: row.ema20 ?? null, ema50: row.ema50 ?? null,
    sma20: row.sma20 ?? null, sma50: row.sma50 ?? null,
    atr: row.atr ?? null, atrPct: null,
    bollinger: bb,
    stochK: row.stochK ?? null, stochD: row.stochD ?? null,
    adx: (row.adx != null) ? { adx: row.adx, plusDI: row.adxPlus ?? null, minusDI: row.adxMinus ?? null } : null,
    obvSlope: null, mfi: null,
    vwap: row.vwap ?? null,
    supertrend: null, roc: null,
    relVolume: row.relVolume ?? null,
    patterns: [],
    high52w: row.high52w ?? null, low52w: row.low52w ?? null,
    pivot: row.pivot ?? null,
    recommend: row.recommend ?? null,
  };
}

// ---------------- regime (shared by all symbols of a market) ----------------
async function buildRegime(market) {
  if (market === 'CRYPTO') {
    const q = await fetchYahooQuotes(['BTC']).catch(() => ({}));
    return { btcChange: q?.BTC?.changePct ?? null };
  }
  const q = await fetchYahooQuotes(['NIFTY', 'INDIAVIX']).catch(() => ({}));
  return { niftyChange: q?.NIFTY?.changePct ?? null, indiaVix: q?.INDIAVIX?.price ?? null };
}

// ---------------- per-symbol context builders ----------------
async function buildIndiaStockCtx(row, regime) {
  const ltp = row.ltp;
  if (!(ltp > 0)) return null;
  return {
    market: 'INDIA', symbol: row.symbol, ltp, changePct: row.changePct ?? 0,
    volume: row.volume ?? 0, exchange: row.exchange || 'NSE',
    ind: tvToInd(row, ltp), candles: null, options: null, regime,
  };
}

async function buildCryptoCtx(base, tvRow, inrPrice, regime, candles) {
  const ltp = inrPrice ?? (tvRow?.usdPrice ? tvRow.usdPrice * 84 : null);
  if (!(ltp > 0)) return null;
  let ind = null;
  if (tvRow) {
    const scale = tvRow.usdPrice ? ltp / tvRow.usdPrice : 1;
    ind = tvToInd({
      ...tvRow,
      atr: tvRow.atr != null ? tvRow.atr * scale : null,
      ema10: tvRow.ema10 != null ? tvRow.ema10 * scale : null,
      ema20: tvRow.ema20 != null ? tvRow.ema20 * scale : null,
      ema50: tvRow.ema50 != null ? tvRow.ema50 * scale : null,
      sma20: tvRow.sma20 != null ? tvRow.sma20 * scale : null,
      sma50: tvRow.sma50 != null ? tvRow.sma50 * scale : null,
      bbUpper: tvRow.bbUpper != null ? tvRow.bbUpper * scale : null,
      bbLower: tvRow.bbLower != null ? tvRow.bbLower * scale : null,
      macd: tvRow.macd != null ? tvRow.macd * scale : null,
      macdSignal: tvRow.macdSignal != null ? tvRow.macdSignal * scale : null,
      vwap: null, pivot: null,
    }, ltp);
  }
  // CoinDCX 1h candles enrich: vwap / patterns / obv / mfi / supertrend / atrPct / roc.
  if (Array.isArray(candles) && candles.length >= 30) {
    const ci = computeIndicatorsFromCandles(candles);
    if (ci) ind = { ...(ind || {}), ...ci, relVolume: ind?.relVolume ?? (ci.avgVolume20 > 0 ? ci.volume / ci.avgVolume20 : null) };
  }
  if (!ind) return null;
  return {
    market: 'CRYPTO', symbol: base, ltp, changePct: tvRow?.changePct ?? 0,
    volume: tvRow?.volume ?? 0, pair: `${base}INR`,
    ind, candles: candles || null, options: null, regime,
    priceSource: inrPrice != null ? 'coindcx' : 'tv-usd-approx',
  };
}

async function buildIndexCtx(symbol, regime, optionsCtx) {
  const candles = await fetchYahooCandles(symbol, '6mo');
  if (!candles) return null;
  const ci = computeIndicatorsFromCandles(candles);
  if (!ci) return null;
  return {
    market: 'INDIA', symbol, ltp: ci.ltp, changePct: regime.niftyChange ?? 0,
    volume: 0, isIndex: true,
    ind: { ...ci, vwap: ci.vwap, recommend: null, high52w: Math.max(...candles.map(c => c.high)), low52w: Math.min(...candles.map(c => c.low)) },
    candles, options: optionsCtx, regime,
  };
}

// ---------------- AI COUNCIL (LLM chain) ----------------
function aiKeysPresent(KEYS) {
  return !!(KEYS && (KEYS.gemini || KEYS.groq || KEYS.cerebras || KEYS.openrouter));
}

async function askGemini(prompt, KEYS) {
  const models = ['gemini-2.5-flash', 'gemini-2.0-flash'];
  for (const model of models) {
    try {
      const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${KEYS.gemini}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ role: 'user', parts: [{ text: prompt }] }],
          generationConfig: { temperature: 0.2, maxOutputTokens: 2048 },
        }),
        signal: AbortSignal.timeout(15000),
      });
      if (!r.ok) continue;
      const j = await r.json();
      const text = j?.candidates?.[0]?.content?.parts?.map(p => p.text).join('') || '';
      const parsed = tryParseJson(text);
      if (parsed) return parsed;
    } catch { /* next model */ }
  }
  return null;
}

async function askOpenAICompat(prompt, KEYS, OPENAI_COMPAT, provider) {
  const cfg = OPENAI_COMPAT?.[provider];
  if (!cfg || !KEYS?.[provider]) return null;
  try {
    const r = await fetch(cfg.url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${KEYS[provider]}` },
      body: JSON.stringify({
        model: cfg.defModel,
        messages: [
          { role: 'system', content: 'You are an elite trading desk analyst. Respond with STRICT JSON only.' },
          { role: 'user', content: prompt },
        ],
        temperature: 0.2,
        max_tokens: 2048,
      }),
      signal: AbortSignal.timeout(15000),
    });
    if (!r.ok) return null;
    const j = await r.json();
    const text = j?.choices?.[0]?.message?.content || '';
    return tryParseJson(text);
  } catch { return null; }
}

function tryParseJson(text) {
  const cleaned = String(text).replace(/```json|```/g, '').trim();
  const start = cleaned.indexOf('{'), end = cleaned.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  try { return JSON.parse(cleaned.slice(start, end + 1)); } catch { return null; }
}

/**
 * Normalize a council candidate to the FLAT shape the prompt builder
 * reads (symbol/side/confidence/ltp/changePct/ind/plan/votes). Both
 * call sites feed it differently:
 *   • the BOARD passes {ctx, votes, consensus, plan} — symbol/side/conf
 *     live on ctx/consensus, NOT on the candidate itself
 *   • the DEEP path passes {symbol, side, ctx, votes, ...}
 * Without this normalization the LLM was being prompted with
 * undefined symbol/side/ltp/indicators — the 9th model never actually
 * voted and its verdicts could never match a symbol key.
 */
export function toCouncilCandidate(c) {
  if (!c) return null;
  const ctx = c.ctx || {};
  const cons = c.consensus || {};
  return {
    symbol: c.symbol ?? ctx.symbol,
    side: c.side ?? cons.side,
    confidence: c.confidence ?? cons.confidence,
    ltp: c.ltp ?? ctx.ltp,
    changePct: c.changePct ?? ctx.changePct,
    ind: c.ind ?? ctx.ind,
    plan: c.plan ?? null,
    votes: c.votes || [],
  };
}

/**
 * AI Council: verify top candidates via LLM (Gemini → Groq → Cerebras
 * → OpenRouter). Returns { verdicts: {symbol: {verdict, confidence,
 * note, analysis}}, model: provider | null }.
 */
export async function aiCouncilVerify(candidates, deps, market) {
  if (!candidates?.length || !aiKeysPresent(deps?.KEYS)) return { verdicts: {}, model: null, online: false };
  const norm = candidates.map(toCouncilCandidate).filter(c => c && c.symbol);
  if (norm.length === 0) return { verdicts: {}, model: null, online: false };
  const compact = norm.map(c => ({
    sym: c.symbol, side: c.side, conf: c.confidence, ltp: r2(c.ltp),
    chg: c.changePct, rsi: r2(c.ind?.rsi), adx: r2(c.ind?.adx?.adx),
    relVol: r2(c.ind?.relVolume), vwapDist: c.ind?.vwap && c.ltp ? r2(((c.ltp - c.ind.vwap) / c.ind.vwap) * 100) : null,
    atrPct: c.ltp && c.ind?.atr ? r2((c.ind.atr / c.ltp) * 100) : null,
    plan: c.plan ? { e: c.plan.entry, sl: c.plan.stopLoss, t1: c.plan.target1, t2: c.plan.target2 } : null,
    votes: (c.votes || []).filter(v => v.dir !== 0).map(v => `${v.name}:${v.dir > 0 ? '+' : '-'}${v.conf}`).join(', '),
  }));
  const venue = market === 'CRYPTO'
    ? 'CoinDCX spot (INR pairs, 24/7). Penalize extreme 24h moves, thin books, counter-BTC-regime calls.'
    : 'NSE India (options-led desk). Penalize RSI exhaustion, low ADX, thin relative volume, and VIX spikes.';
  const prompt = `You are the AI COUNCIL — the final verification layer of a 9-model superintelligence ensemble for a ${venue}.

Below are pre-scored consensus candidates. For EACH, analyze deeply and either CONFIRM or VETO. Be strict: an edge must be confluence-driven, not single-factor.

${JSON.stringify(compact, null, 1)}

Respond STRICT JSON only (no markdown):
{"verdicts":{"SYMBOL":{"verdict":"LONG"|"SHORT"|"AVOID","confidence":0-100,"note":"max 12 words","analysis":"2 sentences: your reasoning chain — indicator state, timing quality, risk"}}}`;

  let verdicts = null, model = null;
  if (deps?.KEYS?.gemini) { verdicts = await askGemini(prompt, deps.KEYS); model = verdicts ? 'gemini' : null; }
  if (!verdicts && deps?.KEYS?.groq) { verdicts = await askOpenAICompat(prompt, deps.KEYS, deps.OPENAI_COMPAT, 'groq'); model = verdicts ? 'groq' : null; }
  if (!verdicts && deps?.KEYS?.cerebras) { verdicts = await askOpenAICompat(prompt, deps.KEYS, deps.OPENAI_COMPAT, 'cerebras'); model = verdicts ? 'cerebras' : null; }
  if (!verdicts && deps?.KEYS?.openrouter) { verdicts = await askOpenAICompat(prompt, deps.KEYS, deps.OPENAI_COMPAT, 'openrouter'); model = verdicts ? 'openrouter' : null; }

  const out = verdicts?.verdicts && typeof verdicts.verdicts === 'object' ? verdicts.verdicts : {};
  return { verdicts: out, model, online: model != null };
}

// ---------------- the signal board ----------------
export async function getSignals(market, deps, opts = {}) {
  const mkt = String(market || 'INDIA').toUpperCase() === 'CRYPTO' ? 'CRYPTO' : 'INDIA';
  const cacheKey = `board:${mkt}`;
  const cached = cacheGet(cacheKey, mkt === 'CRYPTO' ? 45_000 : 60_000);
  if (cached && !opts.noCache) return cached;

  const depsSafe = deps || {};
  const regime = await buildRegime(mkt);

  const contexts = [];
  if (mkt === 'INDIA') {
    // Stocks (TV scanner, one batch request) — parallel with the index contexts.
    const [tv, indexCandleJobs] = await Promise.all([
      fetchTVIndiaBatch(INDIA_UNIVERSE).catch(() => ({})),
      Promise.allSettled(['NIFTY', 'BANKNIFTY'].map(async (idx) => {
        const candles = await fetchYahooCandles(idx, '6mo');
        if (!candles) return null;
        const ci = computeIndicatorsFromCandles(candles);
        if (!ci) return null;
        return {
          market: 'INDIA', symbol: idx, ltp: ci.ltp, changePct: 0,
          isIndex: true, volume: 0,
          ind: { ...ci, recommend: null, high52w: Math.max(...candles.map(c => c.high)), low52w: Math.min(...candles.map(c => c.low)) },
          candles, options: opts.indexOptions?.[idx] ?? null, regime,
        };
      })),
    ]);
    for (const row of Object.values(tv)) {
      const ctx = await buildIndiaStockCtx(row, regime);
      if (ctx) contexts.push(ctx);
    }
    for (const r of indexCandleJobs) if (r.status === 'fulfilled' && r.value) contexts.push(r.value);
  } else {
    // Crypto: TV crypto batch + CoinDCX INR prices + candles.
    const { fetchCoinDcxTickers } = await import('../cryptoStream.js');
    const [tv, tickers] = await Promise.all([
      fetchTVCryptoBatch(CRYPTO_UNIVERSE).catch(() => ({})),
      fetchCoinDcxTickers().catch(() => []),
    ]);
    const inrMap = new Map((Array.isArray(tickers) ? tickers : [])
      .filter(t => t && typeof t.market === 'string' && t.market.endsWith('INR'))
      .map(t => [t.market.replace('INR', ''), parseFloat(t.last_price)]));
    const candleJobs = await Promise.allSettled(
      CRYPTO_UNIVERSE.map(b => inrMap.has(b) ? fetchCoinDcxCandles(b, '1h').catch(() => null) : Promise.resolve(null)),
    );
    CRYPTO_UNIVERSE.forEach((base, i) => {
      const candles = candleJobs[i].status === 'fulfilled' ? candleJobs[i].value : null;
      const ctx = buildCryptoCtxSync(base, tv[base], inrMap.get(base), regime, candles);
      if (ctx) contexts.push(ctx);
    });
  }

  if (contexts.length === 0) {
    const payload = {
      ok: false, market: mkt, reason: mkt === 'CRYPTO'
        ? 'No crypto data reachable right now (TV + CoinDCX both unavailable)'
        : 'No India market data reachable right now (TV scanner unavailable)',
      marketOpen: mkt === 'INDIA' ? isNseOpen() : true,
      signals: [], models: modelStatus(null, depsSafe), regime, generatedAt: Date.now(),
    };
    cacheSet(cacheKey, payload);
    return payload;
  }

  // Run quant models per symbol → aggregate → rank.
  const candidates = [];
  for (const ctx of contexts) {
    const votes = runQuantModels(ctx);
    const consensus = aggregateVotes(votes, gatesFor(depsSafe));
    if (consensus.dir === 0) continue;
    const plan = buildTradePlan(consensus, ctx, mkt);
    candidates.push({ ctx, votes, consensus, plan });
  }
  candidates.sort((a, b) => b.consensus.confidence - a.consensus.confidence);

  // AI Council on the top candidates (toCouncilCandidate normalizes the
  // {ctx, votes, consensus, plan} board shape into the flat candidate
  // shape — symbol/side/confidence/ltp/indicators/plan).
  const top = candidates.slice(0, 6);
  let council = { verdicts: {}, model: null, online: false };
  try { council = await aiCouncilVerify(top, depsSafe, mkt); } catch { /* offline */ }

  // Merge AI Council as the 9th vote + final signals.
  const signals = [];
  for (const c of candidates.slice(0, opts.limit || 10)) {
    const votes = c.votes;
    let aiNote = null;
    const verdict = council.verdicts[c.ctx.symbol];
    if (verdict) {
      const av = aiCouncilVoteFromVerdict(verdict);
      if (av) {
        votes.push({
          id: 'aicouncil', name: 'AI Council (LLM)', role: MODELS.find(m => m.id === 'aicouncil').role,
          weight: MODELS.find(m => m.id === 'aicouncil').weight, ...av,
        });
        aiNote = { verdict: verdict.verdict, note: verdict.note, analysis: verdict.analysis, model: council.model };
      }
    }
    const consensus2 = aggregateVotes(votes, gatesFor(depsSafe));
    // Rebuild the plan from the POST-council consensus: the council vote
    // can flip the final side, and a SHORT signal carrying a long-style
    // plan (SL below entry, TP2 above) would invert every alert level.
    const plan2 = buildTradePlan(consensus2, c.ctx, mkt) ?? c.plan;
    signals.push(buildSignal({
      symbol: c.ctx.symbol, market: mkt, ctx: c.ctx, votes, consensus: consensus2, plan: plan2, aiNote,
    }));
  }
  signals.sort((a, b) => b.confidence - a.confidence);

  const payload = {
    ok: true, market: mkt,
    marketOpen: mkt === 'INDIA' ? isNseOpen() : true,
    regime,
    scanned: contexts.length,
    signals,
    models: modelStatus(council, depsSafe),
    generatedAt: Date.now(),
  };
  cacheSet(cacheKey, payload);
  return payload;
}

function gatesFor(deps) {
  try {
    const cfg = deps?.getTradingConfig?.();
    return { minConfidence: cfg?.minConfidence ?? 75, minAgreement: cfg?.minAgreement ?? 0.70 };
  } catch { return DEFAULT_GATES; }
}

function modelStatus(council, deps) {
  return MODELS.map(m => ({
    id: m.id, name: m.name, role: m.role, weight: m.weight,
    online: m.id === 'aicouncil' ? !!council?.online : true,
    engine: m.id === 'aicouncil' ? (council?.model || 'offline') : 'quant',
  }));
}

// sync variant used in the crypto branch (buildCryptoCtx is promise-free
// apart from nothing — kept separate to avoid an await in a loop).
function buildCryptoCtxSync(base, tvRow, inrPrice, regime, candles) {
  const ltp = inrPrice ?? (tvRow?.usdPrice ? tvRow.usdPrice * 84 : null);
  if (!(ltp > 0)) return null;
  let ind = null;
  if (tvRow) {
    const scale = tvRow.usdPrice ? ltp / tvRow.usdPrice : 1;
    ind = tvToInd({
      rsi: tvRow.rsi, macd: tvRow.macd != null ? tvRow.macd * scale : null, macdSignal: tvRow.macdSignal != null ? tvRow.macdSignal * scale : null,
      ema10: tvRow.ema10 != null ? tvRow.ema10 * scale : null,
      ema20: tvRow.ema20 != null ? tvRow.ema20 * scale : null,
      ema50: tvRow.ema50 != null ? tvRow.ema50 * scale : null,
      sma20: tvRow.sma20 != null ? tvRow.sma20 * scale : null,
      sma50: tvRow.sma50 != null ? tvRow.sma50 * scale : null,
      atr: tvRow.atr != null ? tvRow.atr * scale : null,
      adx: tvRow.adx, adxPlus: tvRow.adxPlus, adxMinus: tvRow.adxMinus,
      bbUpper: tvRow.bbUpper != null ? tvRow.bbUpper * scale : null,
      bbLower: tvRow.bbLower != null ? tvRow.bbLower * scale : null,
      stochK: tvRow.stochK, stochD: tvRow.stochD,
      relVolume: tvRow.relVolume, recommend: tvRow.recommend,
      vwap: null, pivot: null, high52w: null, low52w: null,
    }, ltp);
  }
  if (Array.isArray(candles) && candles.length >= 30) {
    const ci = computeIndicatorsFromCandles(candles);
    if (ci) ind = { ...(ind || {}), ...ci, relVolume: ind?.relVolume ?? (ci.avgVolume20 > 0 ? ci.volume / ci.avgVolume20 : null) };
  }
  if (!ind) return null;
  return {
    market: 'CRYPTO', symbol: base, ltp, changePct: tvRow?.changePct ?? 0,
    volume: tvRow?.volume ?? 0, pair: `${base}INR`,
    ind, candles: candles || null, options: null, regime,
    priceSource: inrPrice != null ? 'coindcx' : 'tv-usd-approx',
  };
}

// ---------------- deep single-symbol signal ----------------
export async function getDeepSignal(symbol, market, deps, opts = {}) {
  const mkt = String(market || 'INDIA').toUpperCase() === 'CRYPTO' ? 'CRYPTO' : 'INDIA';
  const sym = String(symbol || '').toUpperCase().replace(/[^A-Z0-9\-]/g, '');
  if (!sym) return { ok: false, reason: 'symbol required' };
  // optionsCtx changes which models participate (OptionsFlow) — cache
  // the two flavors separately so /api/ai/options doesn't serve the
  // board flavor's consensus (or vice versa) within the 30s TTL.
  const cacheKey = `deep:${mkt}:${sym}${opts?.optionsCtx ? ':opt' : ''}`;
  const cached = cacheGet(cacheKey, 30_000);
  if (cached) return cached;

  const regime = await buildRegime(mkt);
  let ctx = null;
  if (mkt === 'CRYPTO') {
    const { fetchCoinDcxTickers } = await import('../cryptoStream.js');
    const [tv, tickers, candles] = await Promise.all([
      fetchTVCryptoBatch([sym]).catch(() => ({})),
      fetchCoinDcxTickers().catch(() => []),
      fetchCoinDcxCandles(sym, '1h').catch(() => null),
    ]);
    const t = (Array.isArray(tickers) ? tickers : []).find(x => x?.market === `${sym}INR`);
    ctx = buildCryptoCtxSync(sym, tv[sym], t ? parseFloat(t.last_price) : null, regime, candles);
  } else {
    const tv = await fetchTVIndiaBatch([sym]).catch(() => ({}));
    if (tv[sym]) {
      ctx = await buildIndiaStockCtx(tv[sym], regime);
    } else {
      // Index fallback (NIFTY/BANKNIFTY or unknown symbol → Yahoo daily candles).
      ctx = await (async () => {
        const candles = await fetchYahooCandles(sym, '6mo');
        if (!candles) return null;
        const ci = computeIndicatorsFromCandles(candles);
        if (!ci) return null;
        return {
          market: 'INDIA', symbol: sym, ltp: ci.ltp, changePct: 0, isIndex: true, volume: 0,
          ind: { ...ci, recommend: null, high52w: Math.max(...candles.map(c => c.high)), low52w: Math.min(...candles.map(c => c.low)) },
          candles, options: opts?.optionsCtx ?? null, regime,
        };
      })();
    }
  }
  if (!ctx) {
    const payload = { ok: false, reason: `No data for ${sym} on ${mkt}` };
    cacheSet(cacheKey, payload);
    return payload;
  }

  const votes = runQuantModels(ctx);
  // Pre-council consensus: the deep path feeds the council the same flat
  // candidate shape as the board path (side/confidence/ltp/ind/plan) so
  // the LLM actually sees the symbol, price and indicator state it is
  // being asked to verify — 'PENDING'/conf 0 starved the prompt.
  const preConsensus = aggregateVotes(votes, gatesFor(deps));
  const council = await aiCouncilVerify([{
    symbol: sym,
    side: preConsensus.side,
    confidence: preConsensus.confidence,
    ltp: ctx.ltp,
    changePct: ctx.changePct,
    ind: ctx.ind,
    plan: buildTradePlan(preConsensus, ctx, mkt),
    votes,
  }], deps, mkt).catch(() => ({ verdicts: {}, online: false }));
  const verdict = council?.verdicts?.[sym];
  if (verdict) {
    const av = aiCouncilVoteFromVerdict(verdict);
    if (av) votes.push({
      id: 'aicouncil', name: 'AI Council (LLM)', role: MODELS.find(m => m.id === 'aicouncil').role,
      weight: MODELS.find(m => m.id === 'aicouncil').weight, ...av,
    });
  }
  const consensus = aggregateVotes(votes, gatesFor(deps));
  const plan = buildTradePlan(consensus, ctx, mkt);
  const payload = {
    ok: true,
    signal: buildSignal({ symbol: sym, market: mkt, ctx, votes, consensus, plan, aiNote: verdict ? { verdict: verdict.verdict, note: verdict.note, analysis: verdict.analysis, model: council.model } : null }),
    indicators: ctx.ind,
    priceSource: ctx.priceSource || null,
  };
  cacheSet(cacheKey, payload);
  return payload;
}

/**
 * The execute-gauntlet's fresh signal source — a single-symbol ensemble
 * run with a STRICT 90s freshness (no board cache reuse).
 */
export async function getFreshSignalForExec(pairOrSymbol, deps) {
  // Accept "BTCINR" or "BTC".
  const sym = String(pairOrSymbol || '').toUpperCase().replace(/INR$/, '').replace(/USDT$/, '');
  const deep = await getDeepSignal(sym, 'CRYPTO', deps);
  return deep?.ok ? deep.signal : null;
}

// ---------------- test hooks ----------------
export function __clearSignalCaches() { _cache.clear(); }
