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
import { FUTURES_UNIVERSE, futuresPairFor, fetchFuturesPrices, fetchFuturesCandles } from './futures.js';
import { MODELS, runQuantModels, aiCouncilVoteFromVerdict } from './models.js';
// v6.7 self-correcting ensemble: live-outcome Bayesian weight multipliers
import { adaptiveMultipliers, applyAdaptiveWeights } from './adaptive.js';
import { modelStats as _ledgerModelStats } from './ledger.js';
import { explainTicker } from './narrative.js';
import { aggregateVotes, buildTradePlan, buildSignal, DEFAULT_GATES } from './ensemble.js';
// v6.12 PRO TRADER BRAIN — quality/honesty layer over the consensus
import { qualityVerdict, sessionPhase as sessionPhaseOf } from './probrain.js';
import { smcVote } from './lib/smc.js';
import { simulateSymbol } from './backtest.js';

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
async function fetchYahooCandles(key, range = '3mo', interval = '1d') {
  const t = YF_TICKER[key];
  if (!t) return null;
  try {
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(t)}?interval=${interval}&range=${range}`;
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
// v6.3: derive today's candlestick patterns from the scanner's OHLC +
// change% (prevClose = close/(1+chg/100)) — India stock rows previously
// had patterns:[] so PatternNeural almost always abstained on the whole
// NSE universe (one more silent vote missing from every consensus).
export function scannerPatterns(row) {
  const { open, high, low, ltp: close, changePct } = row;
  if (![open, high, low, close].every(v => typeof v === 'number' && v > 0)) return [];
  const prevClose = Number.isFinite(changePct) && changePct > -100
    ? close / (1 + changePct / 100) : null;
  const range = high - low;
  if (range <= 0) return [];
  const body = close - open;
  const bodyAbs = Math.abs(body);
  const bodyPct = bodyAbs / range;
  const upperWick = high - Math.max(open, close);
  const lowerWick = Math.min(open, close) - low;
  const out = [];
  if (bodyPct < 0.1) out.push({ name: 'Doji', bias: 0 });
  else if (bodyPct > 0.85) out.push({ name: body > 0 ? 'Bullish Marubozu' : 'Bearish Marubozu', bias: body > 0 ? 1 : -1 });
  if (lowerWick > bodyAbs * 2 && upperWick < bodyAbs * 0.8 && bodyPct < 0.4) out.push({ name: 'Hammer', bias: 1 });
  if (upperWick > bodyAbs * 2 && lowerWick < bodyAbs * 0.8 && bodyPct < 0.4) out.push({ name: 'Shooting Star', bias: -1 });
  if (prevClose != null) {
    const prevBody = close > open ? Math.max(prevClose - open, 0) : 0; // approx prior body via prevClose
    if (body > 0 && close > prevClose && open <= prevClose && bodyAbs > prevBody) out.push({ name: 'Bullish Engulfing (approx)', bias: 1 });
    if (body < 0 && close < prevClose && open >= prevClose && bodyAbs > prevBody) out.push({ name: 'Bearish Engulfing (approx)', bias: -1 });
    if (open > prevClose * 1.005) out.push({ name: 'Gap Up', bias: 1 });
    else if (open < prevClose * 0.995) out.push({ name: 'Gap Down', bias: -1 });
  }
  return out.slice(0, 3);
}

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
    patterns: scannerPatterns(row),
    high52w: row.high52w ?? null, low52w: row.low52w ?? null,
    pivot: row.pivot ?? null,
    recommend: row.recommend ?? null,
  };
}

// ---------------- v6.12: Yahoo intraday candles (LTF for MTF) ----------------
// India: <sym>.NS 15m bars (1mo ≈ 500 bars) — the intraday timing TF.
// Crypto: <base>-USD 1h bars (3mo ≈ 2000 bars, we keep the tail) —
// works even where CoinDCX public candles are blocked, so the MTF
// layer never silently dies. Cached 2 min per symbol (bounded map).
async function fetchYahooIntradayCandles(symbol, market) {
  const mkt = String(market || 'INDIA').toUpperCase();
  const key = `ltf:${mkt}:${symbol}`;
  const hit = cacheGet(key, 120_000);
  if (hit) return hit;
  // indices (^NSEI etc.) map via YF_TICKER; stocks get .NS; crypto -USD
  const t = YF_TICKER[symbol];
  const yh = t || (mkt === 'CRYPTO' || mkt === 'FUTURES' ? `${symbol}-USD` : `${symbol}.NS`);
  const interval = mkt === 'CRYPTO' || mkt === 'FUTURES' ? '1h' : '15m';
  const range = mkt === 'CRYPTO' || mkt === 'FUTURES' ? '3mo' : '1mo';
  let out = null;
  try {
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(yh)}?interval=${interval}&range=${range}`;
    const r = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (WealthAI probrain-mtf)' },
      signal: AbortSignal.timeout(8000),
    });
    if (r.ok) {
      const j = await r.json();
      const res = j?.chart?.result?.[0];
      const ts = res?.timestamp;
      const q = res?.indicators?.quote?.[0];
      if (Array.isArray(ts) && q) {
        const rows = [];
        for (let i = 0; i < ts.length; i++) {
          if (q.open?.[i] == null || q.close?.[i] == null) continue;
          rows.push({
            time: ts[i] * 1000,
            open: q.open[i], high: q.high?.[i] ?? q.close[i], low: q.low?.[i] ?? q.close[i],
            close: q.close[i], volume: q.volume?.[i] || 0,
          });
        }
        if (rows.length >= 60) out = rows;
      }
    }
  } catch { out = null; }
  cacheSet(key, out);
  return out;
}

// ---------------- regime (shared by all symbols of a market) ----------------
// v6.12: daily EMA trend tie-break (btcTrend / niftyTrend) — a -1.4%
// BTC day inside a daily UPTREND is a pullback; inside a DOWNTREND it
// is continuation. The regime model + probrain gate both read it.
const _regimeTrendCache = { at: 0, crypto: null, india: null };
async function dailyTrend(candles) {
  if (!Array.isArray(candles) || candles.length < 60) return null;
  const closes = candles.map(c => c.close);
  const ema = (period) => {
    const k = 2 / (period + 1);
    let e = closes[0];
    for (let i = 1; i < closes.length; i++) e = closes[i] * k + e * (1 - k);
    return e;
  };
  const e20 = ema(20), e50 = ema(50);
  const last = closes[closes.length - 1];
  if (!(e50 > 0) || !(last > 0)) return null;
  const spread = (e20 - e50) / e50 * 100;
  if (Math.abs(spread) < 0.5) return { trend: 'FLAT', spread };
  return { trend: spread > 0 ? 'UP' : 'DOWN', spread: Math.round(spread * 100) / 100 };
}
async function buildRegime(market) {
  const mkt = String(market || 'INDIA').toUpperCase();
  const useTrendCache = Date.now() - _regimeTrendCache.at < 15 * 60_000;
  if (mkt === 'CRYPTO' || mkt === 'FUTURES') {
    const q = await fetchYahooQuotes(['BTC']).catch(() => ({}));
    let btcTrend = useTrendCache ? _regimeTrendCache.crypto : null;
    if (!btcTrend) {
      const d = await fetchYahooCandles('BTC', '6mo').catch(() => null);
      btcTrend = dailyTrend(d);
      _regimeTrendCache.crypto = btcTrend; _regimeTrendCache.at = Date.now();
    }
    return {
      btcChange: q?.BTC?.changePct ?? null,
      btcTrend: btcTrend?.trend ?? null,
      btcTrendSpread: btcTrend?.spread ?? null,
    };
  }
  const q = await fetchYahooQuotes(['NIFTY', 'INDIAVIX']).catch(() => ({}));
  let niftyTrend = useTrendCache ? _regimeTrendCache.india : null;
  if (!niftyTrend) {
    const d = await fetchYahooCandles('NIFTY', '6mo').catch(() => (null));
    niftyTrend = dailyTrend(d);
    _regimeTrendCache.india = niftyTrend; _regimeTrendCache.at = Date.now();
  }
  return {
    niftyChange: q?.NIFTY?.changePct ?? null,
    indiaVix: q?.INDIAVIX?.price ?? null,
    niftyTrend: niftyTrend?.trend ?? null,
    niftyTrendSpread: niftyTrend?.spread ?? null,
  };
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

// (v6.3: the async buildCryptoCtx + buildIndexCtx duplicates were removed —
// the board uses buildCryptoCtxSync and inlines its index contexts.)

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
    : market === 'FUTURES'
      ? 'CoinDCX GLOBAL FUTURES (USDT-margined perpetuals, 24/7, leveraged). Penalize extreme 24h moves, funding-fighting continuation calls, thin books, counter-BTC-regime calls.'
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
// ---------------- v6.9 TOP-5 COMPOSITE RANKING ----------------
// The user's "full universe analyze karke top 5 accurate signals" —
// a transparent composite score over the FINAL board signals. Every
// factor is normalized to 0-100 so weights are honest:
//   0.40 × confidence        — the committee's conviction
//   0.20 × agreement×100     — how many voting models align
//   0.15 × min(R:R,3)/3×100  — reward:risk (capped at 3, diminishing)
//   0.10 × participation×100 — quorum: how many models actually voted
//   0.10 × regime alignment  — trade direction with the market regime
//   0.05 × momentum          — |24h change| tiebreak (capped at 3%)
// Only actionable signals (STRONG/ACTION, non-neutral side, plan present)
// are eligible. Fewer than 5 eligible → shorter list (honest, never padded).
export function computeTopFive(signals, regime, market = 'INDIA', limit = 5) {
  if (!Array.isArray(signals) || signals.length === 0) return [];
  const mkt = String(market || 'INDIA').toUpperCase();
  const rawRegime = mkt === 'INDIA' ? regime?.niftyChange : regime?.btcChange;
  const regimeChange = rawRegime == null ? null : Number(rawRegime);
  const regimeLabel = mkt === 'INDIA' ? 'NIFTY' : 'BTC';
  const eligible = signals.filter(s =>
    s && (s.grade === 'STRONG' || s.grade === 'ACTION')
    && (s.side === 'LONG' || s.side === 'SHORT')
    && s.plan && Number.isFinite(s.plan.entry));
  const scored = eligible.map(s => {
    const conf = Math.max(0, Math.min(100, Number(s.confidence) || 0));
    const agree = Math.max(0, Math.min(100, (Number(s.agreement) || 0) * 100));
    const rr = Math.max(0, Math.min(3, Number(s.plan?.rewardRisk) || 0));
    const part = Math.max(0, Math.min(1, Number(s.participation ?? 1) || 0));
    const sideIsLong = s.side === 'LONG';
    const aligned = regimeChange != null && Number.isFinite(regimeChange)
      ? (regimeChange > 0.1 && sideIsLong) || (regimeChange < -0.1 && !sideIsLong)
      : null; // null = regime unknown → neutral 50 (neither reward nor penalty)
    const regScore = aligned == null ? 50 : aligned ? 100 : 0;
    const chg = Math.max(0, Math.min(3, Math.abs(Number(s.changePct) || 0)));
    const score =
      0.40 * conf +
      0.20 * agree +
      0.15 * (rr / 3) * 100 +
      0.10 * part * 100 +
      0.10 * regScore +
      0.05 * (chg / 3) * 100;
    const votesFor = (s.votes || []).filter(v => v.dir === (sideIsLong ? 1 : -1)).length;
    const totalVoted = (s.votes || []).length;
    const regTxt = aligned == null ? `${regimeLabel} regime nahi mila`
      : aligned ? `${regimeLabel} ${regimeChange >= 0 ? '+' : ''}${regimeChange.toFixed(1)}% trend se ALIGNED`
      : `${regimeLabel} ke against (counter-trend)`;
    const rrTxt = Number.isFinite(s.plan?.rewardRisk) ? `R:R 1:${s.plan.rewardRisk.toFixed(1)}` : 'plan ready';
    const reason = `${totalVoted} models me se ${votesFor} ${s.side} side pe · conf ${Math.round(conf)}% · ${rrTxt} · ${regTxt} · ${s.grade === 'STRONG' ? 'FULL committee STRONG grade' : 'ACTION grade (tradeable)'}`;
    return { ...s, rank: 0, score: Math.round(score * 10) / 10, rankReason: reason };
  });
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, Math.max(1, limit)).map((s, i) => ({ ...s, rank: i + 1 }));
}

export async function getSignals(market, deps, opts = {}) {
  const raw = String(market || 'INDIA').toUpperCase();
  const mkt = raw === 'CRYPTO' ? 'CRYPTO' : raw === 'FUTURES' ? 'FUTURES' : 'INDIA';
  const cacheKey = `board:${mkt}`;
  const cached = cacheGet(cacheKey, mkt === 'INDIA' ? 60_000 : 45_000);
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
  } else if (mkt === 'FUTURES') {
    // v6.8 GLOBAL FUTURES: TV crypto USD indicators (USD ≈ USDT 1:1) +
    // CoinDCX futures RT prices + pcode=f candlesticks. Everything stays
    // in the USDT domain — the plan prices ARE the prices you trade.
    const [tv, futRows] = await Promise.all([
      fetchTVCryptoBatch(FUTURES_UNIVERSE).catch(() => ({})),
      fetchFuturesPrices().catch(() => []),
    ]);
    const futMap = new Map((Array.isArray(futRows) ? futRows : []).map(x => [x.base, x]));
    const candleJobs = await Promise.allSettled(
      FUTURES_UNIVERSE.map(b => futMap.has(b) ? fetchFuturesCandles(futuresPairFor(b), '60').catch(() => null) : Promise.resolve(null)),
    );
    FUTURES_UNIVERSE.forEach((base, i) => {
      const row = futMap.get(base);
      const candles = candleJobs[i].status === 'fulfilled' ? candleJobs[i].value : null;
      const ctx = buildFuturesCtxSync(base, tv[base], row, candles, regime);
      if (ctx) contexts.push(ctx);
    });
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
        : mkt === 'FUTURES'
          ? 'No futures data reachable right now (TV + CoinDCX futures RT unavailable)'
          : 'No India market data reachable right now (TV scanner unavailable)',
      marketOpen: mkt === 'INDIA' ? isNseOpen() : true,
      topFive: [],
      signals: [], models: modelStatus(null, depsSafe), regime, generatedAt: Date.now(),
    };
    cacheSet(cacheKey, payload);
    return payload;
  }

  // Run quant models per symbol → aggregate → rank.
  // v6.7: each vote's weight is scaled by its LIVE hit-rate multiplier
  // (ledger outcomes → Beta posterior; n<8 keeps the base weight —
  // we refuse to tune on noise). Computed ONCE per board run.
  const adaptiveMul = adaptiveMultipliers(_ledgerModelStats());
  const candidates = [];
  const breadth = { bull: 0, bear: 0, flat: 0, avgConf: 0 };
  let confSum = 0;
  for (const ctx of contexts) {
    const votes = applyAdaptiveWeights(runQuantModels(ctx), adaptiveMul);
    const consensus = aggregateVotes(votes, gatesFor(depsSafe));
    if (consensus.dir > 0) breadth.bull++;
    else if (consensus.dir < 0) breadth.bear++;
    else breadth.flat++;
    confSum += consensus.confidence;
    if (consensus.dir === 0) continue;
    const plan = buildTradePlan(consensus, ctx, mkt, { maxRiskPct: riskCapFor(depsSafe) });
    candidates.push({ ctx, votes, consensus, plan });
  }
  breadth.avgConf = contexts.length > 0 ? Math.round(confSum / contexts.length) : 0;
  candidates.sort((a, b) => b.consensus.confidence - a.consensus.confidence);

  // ---------------- v6.12 PASS 2: pro-trader verification ----------------
  // The top candidates get the LTF (15m India / 1h crypto) candles:
  //   • SMC model comes ALIVE on intraday structure (it abstained
  //     on the whole India board pre-v6.12 — no candles)
  //   • mtfAnalysis: daily HTF vs LTF alignment
  //   • structureStop: swing-aware SL for the plan
  // Yahoo intraday works even where CoinDCX candles are blocked.
  // Everything degrades HONESTLY (mtf: UNAVAILABLE, no penalty).
  const enrichN = Math.min(10, opts.limit || 10);
  const enriched = new Map();
  await Promise.all(candidates.slice(0, enrichN).map(async (c) => {
    const key = `${mkt}:${c.ctx.symbol}`;
    if (enriched.has(key)) return;
    try {
      const candles = await fetchYahooIntradayCandles(c.ctx.symbol, mkt);
      if (Array.isArray(candles) && candles.length >= 60) {
        const ltfInd = computeIndicatorsFromCandles(candles);
        enriched.set(key, { candles, ltfInd });
      }
    } catch { /* honest degrade — quality layer skips MTF */ }
  }));

  // AI Council on the top candidates (toCouncilCandidate normalizes the
  // {ctx, votes, consensus, plan} board shape into the flat candidate
  // shape — symbol/side/confidence/ltp/indicators/plan).
  const top = candidates.slice(0, 6);
  let council = { verdicts: {}, model: null, online: false };
  try { council = await aiCouncilVerify(top, depsSafe, mkt); } catch { /* offline */ }

  // Merge AI Council as the 9th vote + final signals.
  const signals = [];
  for (const c of candidates.slice(0, opts.limit || 10)) {
    const votes = [...c.votes];
    const enrKey = `${mkt}:${c.ctx.symbol}`;
    const enr = enriched.get(enrKey) || null;
    // v6.12: inject the LTF-alive SMC vote (replace the pass-1 abstain)
    if (enr) {
      const smcV = smcVote(enr.candles);
      if (smcV && smcV.dir !== 0 && (smcV.conf || 0) > 0) {
        const reg = MODELS.find(m => m.id === 'smc');
        const idx = votes.findIndex(v => v.id === 'smc');
        if (idx >= 0) votes.splice(idx, 1);
        votes.push({ id: 'smc', name: reg.name, role: reg.role, weight: reg.weight, ...smcV });
      }
    }
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
    let consensus2 = aggregateVotes(votes, gatesFor(depsSafe));
    // Rebuild the plan from the POST-council consensus: the council vote
    // can flip the final side, and a SHORT signal carrying a long-style
    // plan (SL below entry, TP2 above) would invert every alert levels.
    // v6.12: the plan also takes the swing-structure stop when the
    // probrain layer found one on the LTF candles.
    let plan2 = null, quality = null;
    if (consensus2.dir !== 0) {
      const qv = qualityVerdict({
        market: mkt, side: consensus2.side, consensus: consensus2, votes,
        ltp: c.ctx.ltp, changePct: c.ctx.changePct,
        rsi: c.ctx.ind?.rsi, adx: c.ctx.ind?.adx, atr: enr?.ltfInd?.atr ?? c.ctx.ind?.atr,
        candles: enr?.candles, regime, htf: c.ctx.ind, ltf: enr?.ltfInd,
        ltfLabel: mkt === 'INDIA' ? '15m' : '1h', now: Date.now(),
      });
      plan2 = buildTradePlan(consensus2, c.ctx, mkt, {
        maxRiskPct: riskCapFor(depsSafe),
        ...(qv.stop && !qv.stop.rejected && qv.stop.sl ? { structureStop: qv.stop } : {}),
      }) ?? c.plan;
      // v6.12 finalization: honest confidence (quorum caps already in
      // aggregateVotes) + probrain adjustments + grade cap ladder.
      const finalConf = Math.max(5, Math.min(99, consensus2.confidence + qv.confAdj));
      const gates = gatesFor(depsSafe);
      let finalGrade;
      if (finalConf >= gates.minConfidence && consensus2.agreement >= gates.minAgreement) finalGrade = 'STRONG';
      else if (finalConf >= 55) finalGrade = 'ACTION';
      else if (finalConf >= 35) finalGrade = 'WATCH';
      else finalGrade = 'NEUTRAL';
      const capRank = { NEUTRAL: 0, WATCH: 1, ACTION: 2, STRONG: 3 };
      if (capRank[qv.gradeCap] < capRank[finalGrade]) finalGrade = qv.gradeCap;
      quality = {
        ...qv.flags,
        confAdj: qv.confAdj,
        veto: qv.flags.veto || null,
        reasons: qv.reasons,
        mtf: { phase: qv.mtf.phase, aligned: qv.mtf.aligned, available: qv.mtf.available },
        session: { phase: qv.session.phase, tradeable: qv.session.tradeable },
        stopStyle: qv.stop && !qv.stop.rejected ? (qv.stop.style || 'swing-structure') : null,
      };
      consensus2 = {
        ...consensus2,
        confidence: finalConf,
        grade: finalGrade,
        summary: `${consensus2.summary}${qv.flags.veto ? ` · ${qv.flags.veto.toUpperCase()} VETO` : ''}`,
      };
    } else {
      plan2 = c.plan;
    }
    signals.push(buildSignal({
      symbol: c.ctx.symbol, market: mkt, ctx: c.ctx, votes, consensus: consensus2, plan: plan2, aiNote, quality,
    }));
  }
  signals.sort((a, b) => b.confidence - a.confidence);

  // v6.9: full-universe composite TOP-5 (transparent score + Hinglish
  // rank reason — the board payload carries it so the desks get the
  // SAME ranking the server would execute against).
  const topFive = computeTopFive(signals, regime, mkt, 5);

  // v6.12: session phase — the intraday desk must KNOW when it is
  // safe to fire (opening noise / square-off window / market closed).
  const ses = sessionPhaseOf(mkt, Date.now());
  const payload = {
    ok: true, market: mkt,
    marketOpen: mkt === 'INDIA' ? isNseOpen() : true,
    sessionPhase: { phase: ses.phase, tradeable: ses.tradeable, note: ses.note },
    regime,
    breadth,
    topFive,
    riskCap: riskCapFor(depsSafe),
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

/** v6.4: the user's configured max-stop% — board plans are BUILT inside
 *  the cap (riskClamped flag + originalRiskPct on the plan) so the cards
 *  honestly show a fitted plan instead of one the execute-gate would
 *  bounce. Paper execute additionally auto-fits server-side. */
function riskCapFor(deps) {
  try {
    const cfg = deps?.getTradingConfig?.();
    const cap = Number(cfg?.maxRiskPct);
    return Number.isFinite(cap) && cap > 0 ? cap : 5;
  } catch { return 5; }
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

// v6.8: futures context — the USDT twin of buildCryptoCtxSync. TV crypto
// indicators are already USD-denominated (USD ≈ USDT 1:1 on these majors)
// so NO scaling happens: entry/SL/targets land in the exact quote currency
// the futures contract trades. Candles come from the pcode=f endpoint.
function buildFuturesCtxSync(base, tvRow, futRow, candles, regime) {
  const ltp = futRow?.last ?? (tvRow?.usdPrice ?? null);
  if (!(ltp > 0)) return null;
  let ind = null;
  if (tvRow) {
    ind = tvToInd({
      rsi: tvRow.rsi, macd: tvRow.macd, macdSignal: tvRow.macdSignal,
      ema10: tvRow.ema10, ema20: tvRow.ema20, ema50: tvRow.ema50,
      sma20: tvRow.sma20, sma50: tvRow.sma50,
      atr: tvRow.atr, adx: tvRow.adx, adxPlus: tvRow.adxPlus, adxMinus: tvRow.adxMinus,
      bbUpper: tvRow.bbUpper, bbLower: tvRow.bbLower,
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
    market: 'FUTURES', symbol: base, ltp, changePct: futRow?.changePct ?? tvRow?.changePct ?? 0,
    volume: futRow?.volume ?? 0, pair: futuresPairFor(base),
    ind, candles: candles || null, options: null, regime,
    priceSource: futRow?.last != null ? 'coindcx-futures-rt' : 'tv-usd-approx',
  };
}

// ---------------- deep single-symbol signal ----------------
export async function getDeepSignal(symbol, market, deps, opts = {}) {
  const raw = String(market || 'INDIA').toUpperCase();
  const mkt = raw === 'CRYPTO' ? 'CRYPTO' : raw === 'FUTURES' ? 'FUTURES' : 'INDIA';
  const sym = String(symbol || '').toUpperCase().replace(/[^A-Z0-9\-]/g, '');
  if (!sym) return { ok: false, reason: 'symbol required' };
  // optionsCtx changes which models participate (OptionsFlow) — cache
  // the two flavors separately so /api/ai/options doesn't serve the
  // board flavor's consensus (or vice versa) within the 30s TTL.
  const cacheKey = `deep:${mkt}:${sym}${opts?.optionsCtx ? ':opt' : ''}`;
  const cached = cacheGet(cacheKey, 30_000);
  if (cached) return cached;

  const regime = await buildRegime(mkt === 'INDIA' ? 'INDIA' : 'CRYPTO');
  let ctx = null;
  if (mkt === 'FUTURES') {
    const [tv, futRows, candles] = await Promise.all([
      fetchTVCryptoBatch([sym]).catch(() => ({})),
      fetchFuturesPrices().catch(() => []),
      fetchFuturesCandles(futuresPairFor(sym), '60').catch(() => null),
    ]);
    const row = (Array.isArray(futRows) ? futRows : []).find(x => x.base === sym);
    ctx = buildFuturesCtxSync(sym, tv[sym], row, candles, regime);
  } else if (mkt === 'CRYPTO') {
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

  const votes = applyAdaptiveWeights(runQuantModels(ctx), adaptiveMultipliers(_ledgerModelStats()));
  // ---------------- v6.12 pass-2 deep enrichment ----------------
  // LTF candles: 15m (India) / 1h (crypto) — SMC + MTF + structure
  // stop + edge stats. Tries the ctx candles first (crypto deep path
  // already fetched CoinDCX 1h), then the Yahoo intraday fallback.
  let ltfCandles = Array.isArray(ctx.candles) && ctx.candles.length >= 60 ? ctx.candles : null;
  let ltfInd = null;
  if (!ltfCandles) {
    ltfCandles = await fetchYahooIntradayCandles(sym, mkt).catch(() => null) || null;
  }
  if (Array.isArray(ltfCandles) && ltfCandles.length >= 60) {
    ltfInd = computeIndicatorsFromCandles(ltfCandles);
    // SMC revival on the LTF structure (replace the abstained vote)
    const smcV = smcVote(ltfCandles);
    if (smcV && smcV.dir !== 0 && (smcV.conf || 0) > 0) {
      const reg = MODELS.find(m => m.id === 'smc');
      const idx = votes.findIndex(v => v.id === 'smc');
      if (idx >= 0) votes.splice(idx, 1);
      votes.push({ id: 'smc', name: reg.name, role: reg.role, weight: reg.weight, ...smcV });
    }
  }
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
    plan: buildTradePlan(preConsensus, ctx, mkt, { maxRiskPct: riskCapFor(deps) }),
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
  let consensus = aggregateVotes(votes, gatesFor(deps));
  // ---------------- v6.12: quality verdict + EDGE stats ----------------
  let quality = null, edge = null, structureStopOpt = null;
  if (consensus.dir !== 0) {
    const qv = qualityVerdict({
      market: mkt, side: consensus.side, consensus, votes,
      ltp: ctx.ltp, changePct: ctx.changePct,
      rsi: ctx.ind?.rsi, adx: ctx.ind?.adx, atr: ltfInd?.atr ?? ctx.ind?.atr,
      candles: ltfCandles, regime, htf: ctx.ind, ltf: ltfInd,
      ltfLabel: mkt === 'INDIA' ? '15m' : '1h', now: Date.now(),
    });
    quality = {
      ...qv.flags,
      confAdj: qv.confAdj,
      veto: qv.flags.veto || null,
      reasons: qv.reasons,
      mtf: { phase: qv.mtf.phase, aligned: qv.mtf.aligned, available: qv.mtf.available },
      session: { phase: qv.session.phase, tradeable: qv.session.tradeable },
      stopStyle: qv.stop && !qv.stop.rejected ? (qv.stop.style || 'swing-structure') : null,
    };
    if (qv.stop && !qv.stop.rejected && qv.stop.sl) structureStopOpt = qv.stop;
    const finalConf = Math.max(5, Math.min(99, consensus.confidence + qv.confAdj));
    const gates = gatesFor(deps);
    let finalGrade;
    if (finalConf >= gates.minConfidence && consensus.agreement >= gates.minAgreement) finalGrade = 'STRONG';
    else if (finalConf >= 55) finalGrade = 'ACTION';
    else if (finalConf >= 35) finalGrade = 'WATCH';
    else finalGrade = 'NEUTRAL';
    const capRank = { NEUTRAL: 0, WATCH: 1, ACTION: 2, STRONG: 3 };
    if (capRank[qv.gradeCap] < capRank[finalGrade]) finalGrade = qv.gradeCap;
    consensus = {
      ...consensus,
      confidence: finalConf,
      grade: finalGrade,
      summary: `${consensus.summary}${qv.flags.veto ? ` · ${qv.flags.veto.toUpperCase()} VETO` : ''}`,
    };
    // EDGE: walk-forward replay of THIS symbol through the same
    // ensemble + plan discipline (the v6.5 backtester). Honest sample
    // size + disclaimer — past ≠ future, ye context hai guarantee nahi.
    try {
      const simCandles = Array.isArray(ltfCandles) ? ltfCandles.slice(-400) : null;
      if (simCandles && simCandles.length >= 120) {
        const sim = simulateSymbol({
          symbol: sym, market: mkt, candles: simCandles,
          minGrade: 'ACTION', maxRiskPct: riskCapFor(deps),
          maxHoldBars: mkt === 'INDIA' ? 26 : 48,
        });
        if (sim?.stats && sim.stats.trades > 0) {
          edge = {
            ...sim.stats,
            timeframe: mkt === 'INDIA' ? '15m' : '1h',
            bars: simCandles.length,
            disclaimer: 'Walk-forward replay of the SAME ensemble on recent bars — past performance ≠ future results',
          };
        }
      }
    } catch { /* edge stats are optional context */ }
  }
  const plan = buildTradePlan(consensus, ctx, mkt, {
    maxRiskPct: riskCapFor(deps),
    ...(structureStopOpt && consensus.dir !== 0 ? { structureStop: structureStopOpt } : {}),
  });
  const built = buildSignal({ symbol: sym, market: mkt, ctx, votes, consensus, plan, aiNote: verdict ? { verdict: verdict.verdict, note: verdict.note, analysis: verdict.analysis, model: council.model } : null, quality });
  // v6.11 (glama explain_ticker): rule-based regime narrative — the
  // indicator stack translated into a Hinglish story for the deep modal.
  const narrative = explainTicker(built, ctx.ind);
  const payload = {
    ok: true,
    signal: built,
    indicators: ctx.ind,
    narrative,
    ltf: ltfInd ? {
      label: mkt === 'INDIA' ? '15m' : '1h',
      rsi: ltfInd.rsi ?? null, macdHist: ltfInd.macd?.hist ?? null,
      ema20: ltfInd.ema20 ?? null, ema50: ltfInd.ema50 ?? null,
      atr: ltfInd.atr ?? null,
    } : null,
    edge,
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

/** v6.8: the FUTURES gauntlet's fresh signal source ("B-BTC_USDT" | "BTC"). */
export async function getFreshFuturesSignalForExec(pairOrSymbol, deps) {
  const sym = String(pairOrSymbol || '').toUpperCase()
    .replace(/^B-/, '').replace(/_USDT$/, '').replace(/USDT$/, '');
  const deep = await getDeepSignal(sym, 'FUTURES', deps);
  return deep?.ok ? deep.signal : null;
}

// ---------------- test hooks ----------------
export function __clearSignalCaches() { _cache.clear(); }
