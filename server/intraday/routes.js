// ============================================================
// intraday/routes — registers every /api/intraday-* endpoint
// ------------------------------------------------------------
// Endpoints:
//   GET  /api/intraday-scanner        top-N signals (regime-gated, ORB-15,
//                                     slippage-aware, AI consensus)
//   GET  /api/intraday-stream         SSE live quotes + outcomes + regime
//   GET  /api/intraday-alerts         alert engine status
//   POST /api/intraday-alerts         { enabled: boolean }
//   GET  /api/intraday-track-record   win-rate / avg-R / history (?days=30)
//   GET  /api/intraday-paper          virtual-trade summary
//   POST /api/intraday-paper          open a virtual trade
//   POST /api/intraday-paper/close    close a virtual trade at LTP
//   GET  /api/intraday-paper/history  cross-day closed-trade history
//                                     + win-rate accuracy stats (?days=90)
//   POST /api/intraday-paper/restore  rebuild wiped history from the
//                                     client's device mirror
//   GET  /api/intraday-universe       base + custom watchlist
//   POST /api/intraday-universe       { add: [], remove: [], restore: [] }
//   POST /api/intraday-agent          PRO TRADER MCP AGENT chat
//                                     (agentic tool loop — 8 intraday
//                                     tools, Gemini→Groq→Cerebras chain)
// ============================================================
import {
  BASE_UNIVERSE, CRYPTO_UNIVERSE, INTRADAY_MIN_CONFIDENCE, INTRADAY_TOP_N, gradeSignal, inDeadZone,
  fetchIntradayDataBatch, analyzeIntradayFromScanner, aiVerifySignals,
} from './engine.js';
import { runProTraderAgent } from './agent.js';
import { runCommitteeDebate, clearCommitteeCache } from './committee.js';
import { generateDailyBriefing, pushMorningBriefingToTelegram, getLastBriefing } from './briefing.js';
import { getJournal, runEodReview, runWeeklyReport, initJournal } from './journal.js';
import cron from 'node-cron';
import { istMinutes, getISTParts, isNseMarketOpen, isMarketOpenFor, freshEntriesAllowedFor } from './time.js';
import { getMarketRegime, getCryptoRegime, freshEntriesAllowedNow } from './regime.js';
import { dispatchIntradayAlerts, dispatchOutcomeAlert, alertsStatus, setAlertsEnabled } from './alerts.js';
import { recordSignals, getTrackRecord, initTrackRecord } from './trackRecord.js';
import { openPaperTrade, closePaperTrade, getPaperSummary, getPaperHistory, restorePaperTrades, initPaperTrading } from './paperTrading.js';
import { initIntradayStream, intradayStreamHandler, setScanSymbols, getLatestQuotes } from './stream.js';
import { buildMoversRows } from './movers.js';
import { loadJSON, saveJSON } from './store.js';

// ------------------------------------------------------------
// Custom universe / watchlist (persisted) — PER MARKET (2026-09):
//   INDIA  → intraday-universe.json      (NSE BASE_UNIVERSE)
//   CRYPTO → intraday-universe-crypto.json (CRYPTO_UNIVERSE)
// effective = (BASE − removedBase) + custom   (cap: +50 custom)
// ------------------------------------------------------------
const UNIVERSE_FILE = 'intraday-universe.json';
const UNIVERSE_CRYPTO_FILE = 'intraday-universe-crypto.json';
const UNIVERSE_CUSTOM_MAX = 50;
let _universe = loadJSON(UNIVERSE_FILE, { removedBase: [], custom: [] });
let _cryptoUniverse = loadJSON(UNIVERSE_CRYPTO_FILE, { removedBase: [], custom: [] });

function _validCustomSym(s) {
  return typeof s === 'string' && /^[A-Z0-9&\-]{2,15}$/.test(s.trim().toUpperCase());
}

const _normMarket = (m) => (String(m || '').toUpperCase() === 'CRYPTO' ? 'CRYPTO' : 'INDIA');

function _universeStateFor(market) {
  return market === 'CRYPTO' ? _cryptoUniverse : _universe;
}
function _baseUniverseFor(market) {
  return market === 'CRYPTO' ? CRYPTO_UNIVERSE : BASE_UNIVERSE;
}

function effectiveUniverse(market = 'INDIA') {
  const mkt = _normMarket(market);
  const state = _universeStateFor(mkt);
  const removed = new Set(state.removedBase || []);
  const custom = (state.custom || []).filter(_validCustomSym);
  return [...new Set([..._baseUniverseFor(mkt).filter(s => !removed.has(s)), ...custom])];
}

function _saveUniverse(market) {
  saveJSON(market === 'CRYPTO' ? UNIVERSE_CRYPTO_FILE : UNIVERSE_FILE, _universeStateFor(market));
}

export function getUniverseInfo(market = 'INDIA') {
  const mkt = _normMarket(market);
  const state = _universeStateFor(mkt);
  const base = _baseUniverseFor(mkt);
  const eff = effectiveUniverse(mkt);
  return {
    market: mkt,
    baseCount: base.length,
    removedBase: state.removedBase || [],
    custom: state.custom || [],
    effectiveCount: eff.length,
    effective: eff,
  };
}

// ------------------------------------------------------------
// Registration
// ------------------------------------------------------------
export function registerIntradayRoutes(app, deps) {
  const {
    fetchGrowwNseQuote, fetchCoinDcxTickers, KEYS, OPENAI_COMPAT, TG, escapeHtml, jsonError,
  } = deps;

  // Telegram raw sender (from TG env — server-side only).
  const sendTelegramRaw = async (html) => {
    if (!TG?.token || !TG?.chatId) return false;
    const r = await fetch(`https://api.telegram.org/bot${TG.token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: TG.chatId, text: html, parse_mode: 'HTML', disable_web_page_preview: true }),
      signal: AbortSignal.timeout(10000),
    });
    return r.ok;
  };

  // Boot the watcher + reconcile stale persisted state. The watcher gets
  // BOTH quote sources (Groww NSE + CoinDCX INR) so it serves India and
  // crypto symbols 24/7.
  initTrackRecord();
  initPaperTrading();
  initIntradayStream({ fetchGrowwNseQuote, fetchCoinDcxTickers, sendTelegramRaw, escapeHtml, dispatchOutcomeAlert });
  initJournal();

  // ----------------------------------------------------------
  // SCHEDULED AI FEATURES (node-cron, Asia/Kolkata timezone):
  //   • 09:10 Mon-Fri — Morning desk briefing → Telegram
  //   • 15:45 Mon-Fri — EOD journal AI review (auto, stored)
  //   • Fri 16:30     — Weekly improvement report (stored)
  // Crons are guards-wrapped: no AI keys / no TG → silent skip.
  // ----------------------------------------------------------
  const agentDeps = () => ({
    KEYS, OPENAI_COMPAT,
    getLastScan: () => _intradayCache.data,
    triggerScan: async () => (isNseMarketOpen() ? runScanner(process.env.INTRADAY_DEBUG === '1') : _intradayCache.data),
    getMarketRegime,
    getTrackRecord,
    getPaperSummary,
  });

  try {
    const tz = { timezone: 'Asia/Kolkata' };

    // 09:10 IST Mon-Fri — morning briefing push.
    cron.schedule('10 9 * * 1-5', async () => {
      if (!TG?.token || !TG?.chatId) return;
      try { await pushMorningBriefingToTelegram({ ...agentDeps(), sendTelegramRaw, escapeHtml }); }
      catch (e) { console.warn('[cron-briefing]', e?.message); }
    }, tz);

    // 15:45 IST Mon-Fri — EOD journal review (batched, ONE AI call).
    cron.schedule('45 15 * * 1-5', async () => {
      try { await runEodReview(agentDeps()); }
      catch (e) { console.warn('[cron-eod-review]', e?.message); }
    }, tz);

    // Fri 16:30 IST — weekly improvement report.
    cron.schedule('30 16 * * 5', async () => {
      try { await runWeeklyReport(agentDeps()); }
      catch (e) { console.warn('[cron-weekly]', e?.message); }
    }, tz);

    console.log('[intraday-cron] Briefing 09:10 • EOD review 15:45 • Weekly Fri 16:30 (IST) scheduled');
  } catch (e) {
    console.warn('[intraday-cron] node-cron unavailable — scheduled AI features disabled:', e?.message);
  }

  // ---------------- Alerts status / toggle ----------------
  app.get('/api/intraday-alerts', (_req, res) => {
    res.json({
      ...alertsStatus(),
      telegramConfigured: !!(TG?.token && TG?.chatId),
    });
  });

  app.post('/api/intraday-alerts', (req, res) => {
    const { enabled } = req.body || {};
    if (typeof enabled !== 'boolean') return jsonError(res, 400, 'boolean "enabled" required.');
    setAlertsEnabled(enabled);
    res.json({ ok: true, enabled });
  });

  // ---------------- SSE live stream ----------------
  app.get('/api/intraday-stream', intradayStreamHandler);

  // ---------------- Track record ----------------
  app.get('/api/intraday-track-record', (req, res) => {
    const days = Math.max(1, Math.min(90, parseInt(req.query.days, 10) || 30));
    res.set('Cache-Control', 'no-store');
    res.json(getTrackRecord(days));
  });

  // ---------------- Paper trading ----------------
  app.get('/api/intraday-paper', (_req, res) => {
    res.set('Cache-Control', 'no-store');
    res.json(getPaperSummary());
  });

  app.post('/api/intraday-paper', (req, res) => {
    const result = openPaperTrade(req.body || {});
    if (result.error) return jsonError(res, 400, result.error);
    res.json({ ok: true, trade: result.trade });
  });

  app.post('/api/intraday-paper/close', (req, res) => {
    const id = Number(req.body?.id);
    if (!Number.isInteger(id)) return jsonError(res, 400, 'integer "id" required.');
    const result = closePaperTrade(id, getLatestQuotes().data);
    if (result.error) return jsonError(res, 400, result.error);
    res.json({ ok: true, trade: result.trade });
  });

  // Full cross-day history + accuracy stats. Survives server restarts
  // via the GitHub durable backup + client device-mirror auto-restore.
  app.get('/api/intraday-paper/history', (req, res) => {
    const days = Math.max(1, Math.min(365, parseInt(req.query.days, 10) || 90));
    res.set('Cache-Control', 'no-store');
    res.json(getPaperHistory(days));
  });

  // Device-mirror restore: the browser keeps a full copy of the trade
  // history in IndexedDB; when a Render restart wipes server/data/, the
  // client POSTs its mirror back here and the engine merges it in.
  app.post('/api/intraday-paper/restore', (req, res) => {
    const result = restorePaperTrades(req.body || {});
    if (result.error) return jsonError(res, 400, result.error);
    res.set('Cache-Control', 'no-store');
    res.json(result);
  });

  // ---------------- Universe / watchlist ----------------
  app.get('/api/intraday-universe', (req, res) => {
    res.json(getUniverseInfo(_normMarket(req.query.market)));
  });

  app.post('/api/intraday-universe', (req, res) => {
    const market = _normMarket(req.query.market);
    const state = _universeStateFor(market);
    const base = _baseUniverseFor(market);
    const { add = [], remove = [], restore = [] } = req.body || {};
    if (!Array.isArray(add) || !Array.isArray(remove) || !Array.isArray(restore)) {
      return jsonError(res, 400, 'add/remove/restore must be arrays.');
    }
    const norm = (arr) => [...new Set(arr.map(s => String(s).trim().toUpperCase()).filter(Boolean))];

    // ADD custom symbols (validated, capped).
    for (const sym of norm(add).slice(0, 20)) {
      if (!_validCustomSym(sym)) continue;
      if (state.custom.length >= UNIVERSE_CUSTOM_MAX) break;
      if (!base.includes(sym) && !state.custom.includes(sym)) state.custom.push(sym);
    }
    // REMOVE — either a custom add or a base symbol.
    for (const sym of norm(remove).slice(0, 20)) {
      state.custom = state.custom.filter(s => s !== sym);
      if (base.includes(sym) && !state.removedBase.includes(sym)) {
        state.removedBase.push(sym);
      }
    }
    // RESTORE base symbols that were removed earlier.
    for (const sym of norm(restore).slice(0, 20)) {
      state.removedBase = state.removedBase.filter(s => s !== sym);
    }
    _saveUniverse(market);
    res.json({ ok: true, ...getUniverseInfo(market) });
  });

  // ---------------- Trending Movers (India + Crypto, 2026-09) ----------------
  // Top gainers / losers + MOST-ACTIVE + sector pulse + index pulse +
  // per-row deep analysis off the SAME indicator batch the scanner uses
  // (TV + Groww/CoinDCX). 60s cache per market; public (market data only).
  // NOT market-hours gated: after NSE hours the list shows the session's
  // final movers (marked marketOpen).

  // INDIA index pulse (v4.5): one extra TV request per 60s cache window →
  // NIFTY 50 / BANK NIFTY / SENSEX / INDIA VIX snapshot chips. Fully
  // degradable (absent on any upstream failure — never blocks movers).
  const _INDEX_TV = { 'NSE:NIFTY': 'NIFTY 50', 'NSE:BANKNIFTY': 'BANK NIFTY', 'BSE:SENSEX': 'SENSEX', 'NSE:INDIAVIX': 'INDIA VIX' };
  let _idxCache = { data: null, ts: 0 };
  async function fetchIndiaIndexPulse() {
    if (_idxCache.data && Date.now() - _idxCache.ts < 60 * 1000) return _idxCache.data;
    try {
      const res = await fetch(`https://scanner.tradingview.com/india/scan?t=${Date.now()}`, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain;charset=UTF-8' },
        body: JSON.stringify({
          symbols: { tickers: Object.keys(_INDEX_TV) },
          columns: ['close', 'change', 'VWAP', 'RSI'],
        }),
        signal: AbortSignal.timeout(8000),
      });
      if (!res.ok) return _idxCache.data || [];
      const data = await res.json();
      const pf = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
      const indices = [];
      for (const item of data?.data || []) {
        const name = _INDEX_TV[item.s];
        if (!name || !item.d) continue;
        const close = pf(item.d[0]);
        if (!(close > 0)) continue;
        const vwap = pf(item.d[2]);
        indices.push({
          symbol: item.s.split(':')[1],
          name,
          ltp: Math.round(close * 100) / 100,
          changePct: pf(item.d[1]) ?? 0,
          vwapDist: vwap > 0 ? Math.round(((close - vwap) / vwap * 100) * 100) / 100 : null,
          rsi: pf(item.d[3]) != null ? Math.round(pf(item.d[3])) : null,
        });
      }
      // Preserve the canonical display order (NIFTY, BANKNIFTY, SENSEX, VIX).
      const order = Object.keys(_INDEX_TV);
      indices.sort((a, b) => order.indexOf(order.find(k => k.endsWith(`:${a.symbol}`)) ?? '') - order.indexOf(order.find(k => k.endsWith(`:${b.symbol}`)) ?? ''));
      _idxCache = { data: indices, ts: Date.now() };
      return indices;
    } catch {
      return _idxCache.data || [];
    }
  }

  const _moversCache = { INDIA: { data: null, ts: 0, inflight: null }, CRYPTO: { data: null, ts: 0, inflight: null } };
  app.get('/api/intraday-movers', async (req, res) => {
    try {
      const mkt = _normMarket(req.query.market);
      const cache = _moversCache[mkt];
      res.set('Cache-Control', 'no-store');
      if (cache.data && Date.now() - cache.ts < 60 * 1000) {
        return res.json(cache.data);
      }
      if (cache.inflight) return res.json(await cache.inflight);
      cache.inflight = (async () => {
        try {
          const universe = effectiveUniverse(mkt);
          const [tvData, quoteData] = mkt === 'CRYPTO'
            ? await fetchIntradayDataBatch(universe, fetchGrowwNseQuote, { market: 'CRYPTO', fetchCoinDcxTickers })
            : await fetchIntradayDataBatch(universe, fetchGrowwNseQuote);
          const built = buildMoversRows(universe, tvData, quoteData, mkt);
          const payload = {
            ok: true,
            market: mkt,
            asOf: new Date().toISOString(),
            marketOpen: isMarketOpenFor(mkt),
            ...built,
            // INDIA: NIFTY/BANKNIFTY/SENSEX/VIX chips; CRYPTO: BTC/ETH already
            // in built.indices — merge whichever is non-empty.
            indices: (built.indices && built.indices.length) ? built.indices : (mkt === 'INDIA' ? await fetchIndiaIndexPulse() : []),
          };
          cache.data = payload;
          cache.ts = Date.now();
          return payload;
        } finally {
          cache.inflight = null;
        }
      })();
      return res.json(await cache.inflight);
    } catch (e) {
      console.warn('[intraday-movers]', e?.message || e);
      return res.json({ ok: false, market: _normMarket(req.query.market), gainers: [], losers: [], mostActive: [], sectors: [], indices: [], breadth: null, error: 'Movers feed temporarily unavailable.' });
    }
  });

  // ---------------- MAIN SCANNER (per-market) ----------------
  const _intradayCache = { data: null, ts: 0, inflight: null };      // INDIA
  const _cryptoCache = { data: null, ts: 0, inflight: null };        // CRYPTO
  const _cacheFor = (market) => (market === 'CRYPTO' ? _cryptoCache : _intradayCache);

  // Core scan execution — shared by the GET route AND the Pro Trader
  // Agent's get_live_intraday_signals tool (single code path, single cache
  // PER MARKET: NSE and CRYPTO never share cache entries).
  const executeScan = async (debugForce, market = 'INDIA') => {
    const mkt = _normMarket(market);
    const cache = _cacheFor(mkt);
    try {
        const universe = effectiveUniverse(mkt);
        const isCrypto = mkt === 'CRYPTO';

        // Regime + market data in parallel (regime gates every analysis).
        // CRYPTO regime = BTC-based (getCryptoRegime).
        const [regime, [tvData, quoteData]] = await Promise.all([
          isCrypto ? getCryptoRegime(debugForce) : getMarketRegime(debugForce),
          isCrypto
            ? fetchIntradayDataBatch(universe, fetchGrowwNseQuote, { market: 'CRYPTO', fetchCoinDcxTickers })
            : fetchIntradayDataBatch(universe, fetchGrowwNseQuote),
        ]);
        const tvCount = Object.keys(tvData).length;
        const gwCount = Object.keys(quoteData).length;
        console.log(`[intraday-scanner:${mkt}] Data: TV=${tvCount} symbols, ${isCrypto ? 'CoinDCX' : 'Groww'}=${gwCount} symbols, regime=${regime?.regime || 'n/a'}`);

        const results = [];
        for (const sym of universe) {
          const r = analyzeIntradayFromScanner(sym, tvData[sym], quoteData[sym], { regime, market: mkt });
          if (r) results.push(r);
        }
        console.log(`[intraday-scanner:${mkt}] Analyzed ${results.length}/${universe.length} symbols`);

        // v4: dead-zone hard gate — 14:30–15:00 IST setups are statistically
        // weak; nothing new is published in that window (open positions still
        // auto-manage normally). N/A for CRYPTO (24/7).
        const deadZone = !isCrypto && inDeadZone();

        // Zero results → SMART DIAGNOSTICS, not a dead-end error wall.
        if (results.length === 0) {
          const feedsCold = tvCount === 0 && gwCount === 0;
          return {
            market: mkt,
            marketOpen: true,
            signals: [],
            scanned: 0,
            universe: universe.length,
            sources: { tradingView: tvCount, [isCrypto ? 'coindcx' : 'groww']: gwCount },
            retryAfterSeconds: 30,
            error: feedsCold
              ? 'Live feeds connect ho rahe hain (scanner warm-up) — 30s me auto re-scan chalega, page refresh ki zarurat nahi.'
              : 'Data warm-up me hai — scanner LIVE hai, 30s me auto re-scan se top setups yahin aa jayenge.',
          };
        }

        // Quant pre-filter: strong setups only go to AI verification.
        // (v4: dead-zone signals never reach the AI — saves tokens too.)
        let pool = (!deadZone ? results : []).filter(r => r.quantConfidence >= 70);
        if (pool.length === 0 && !deadZone) pool = results.sort((a, b) => b.quantConfidence - a.quantConfidence).slice(0, 8);
        pool = pool.sort((a, b) => b.quantConfidence - a.quantConfidence).slice(0, 10);

        // MCP AI verification layer — v4 structured dual-expert consensus
        // (crypto scans get the crypto-expert system prompt).
        const ai = pool.length > 0 ? await aiVerifySignals(pool, { KEYS, OPENAI_COMPAT, market: mkt }) : null;

        // v4: merge AI-adjusted levels into the engine plan (tighter SL,
        // better entry) and rebuild the R-geometry off the new risk.
        const applyAiLevels = (sig, v) => {
          const isLong = sig.direction === 'LONG';
          const atr = sig.atr > 0 ? sig.atr : Math.abs(sig.entry - sig.stopLoss);
          // SL bounds: engine discipline 0.7–1.8 ATR from entry, and only
          // TIGHTER than the engine stop (never widen risk).
          const aiSl = typeof v?.slAdjust === 'number' && isFinite(v.slAdjust) ? +v.slAdjust.toFixed(2) : null;
          if (aiSl != null) {
            const lo = isLong ? sig.entry - 1.3 * atr : sig.entry + 0.7 * atr;
            const hi = isLong ? sig.entry - 0.7 * atr : sig.entry + 1.3 * atr;
            const valid = isLong ? (aiSl > lo && aiSl < hi && aiSl > sig.stopLoss) : (aiSl > lo && aiSl < hi && aiSl < sig.stopLoss);
            if (valid) {
              sig.aiAdjustedSL = aiSl;
              sig.stopLoss = aiSl;
              // Rebuild R-geometry: same 1.6R/2.6R discipline on the new risk.
              const risk = Math.abs(sig.entry - sig.stopLoss);
              if (risk > 0) {
                sig.target1 = +(isLong ? sig.entry + 1.6 * risk : sig.entry - 1.6 * risk).toFixed(2);
                sig.target2 = +(isLong ? sig.entry + 2.6 * risk : sig.entry - 2.6 * risk).toFixed(2);
                sig.trailingSL = +(isLong ? sig.entry - 0.8 * atr : sig.entry + 0.8 * atr).toFixed(2);
                sig.rr = +((Math.abs(sig.target1 - sig.entry) / risk)).toFixed(2);
                const slip = sig.entry * (isCrypto ? 0.12 : 0.07) / 100; // CRYPTO 12bps / NSE 7bps
                sig.effRR = +(((Math.abs(sig.target1 - sig.entry) - 2 * slip) / (risk + 2 * slip))).toFixed(2);
                const qtyRisk = Math.floor(1000 / (risk + 2 * slip));
                const qtyCap = Math.floor(25000 / sig.entry);
                const qtyRaw = Math.max(0, Math.min(qtyRisk, qtyCap));
                sig.qtyPerLakh = isCrypto
                  ? (qtyRaw >= 1 ? Math.floor(qtyRaw) : Math.max(0.0001, +qtyRaw.toFixed(4)))
                  : qtyRaw;
              }
            }
          }
          // Entry adjustment: only within the engine entry zone ± 0.35 ATR.
          const aiEntry = typeof v?.entryAdjust === 'number' && isFinite(v.entryAdjust) ? +v.entryAdjust.toFixed(2) : null;
          if (aiEntry != null) {
            const lo = (sig.entryZoneLow ?? sig.entry) - 0.35 * atr;
            const hi = (sig.entryZoneHigh ?? sig.entry) + 0.35 * atr;
            if (aiEntry > lo && aiEntry < hi && aiEntry > 0) {
              sig.aiAdjustedEntry = aiEntry;
            }
          }
          return sig;
        };

        let signals = pool.map(c => {
          let aiConfidence = null, aiNote = '', aiModel = '';
          const v = ai?.verdicts?.[c.symbol];
          if (v && typeof v.confidence === 'number') {
            const multiModel = (v.models?.length || 1) >= 2;
            if (v.verdict === 'AVOID') {
              // v4 STRICT: AI-rejected setups never publish (was: halved conf).
              return null;
            } else if (v.verdict !== c.direction) {
              // Single-model disagreement — halve confidence (multi-model
              // conflicts were already rejected inside aiVerifySignals).
              aiConfidence = Math.round(v.confidence * 0.5);
              aiNote = v.note || 'AI disagrees with direction';
            } else {
              // Agreement: blend engine + AI. More weight to AI when multiple models concur.
              const aiW = multiModel ? 0.6 : 0.55;
              aiConfidence = Math.round(c.quantConfidence * (1 - aiW) + v.confidence * aiW);
              // Dissenting AI vote caps conviction.
              if ((v.dissent || 0) > 0) aiConfidence -= 4;
              aiNote = v.note || '';
              // v4: merge structured expert fields + adjusted levels.
              applyAiLevels(c, v);
            }
            aiModel = (v.models || []).join('+') || (ai.models || []).join('+');
          }
          const confidence = aiConfidence != null ? Math.max(0, Math.min(100, aiConfidence)) : (c._rrOk ? c.quantConfidence : c.quantConfidence - 12);
          const { _rrOk, _momentumPct, _deadZone, ...clean } = c;
          const v2 = ai?.verdicts?.[c.symbol];
          return {
            ...clean, aiConfidence, aiModel, aiNote, confidence,
            // v4 dual-expert fields
            tradeType: v2?.tradeType || null,
            entryQuality: v2?.entryQuality ?? null,
            aiReasoning: v2?.analysis || '',
            riskFactors: v2?.riskFactors || [],
            geminiVerdict: v2?.perModel?.gemini ? { confidence: v2.perModel.gemini.confidence, note: v2.perModel.gemini.note } : null,
            groqVerdict: v2?.perModel?.groq ? { confidence: v2.perModel.groq.confidence, note: v2.perModel.groq.note } : null,
          };
        }).filter(Boolean); // v4: drop AVOID-rejected setups

        // Adaptive threshold: opening 30 min me quant engine cap 88 hota hai,
        // isliye min confidence 70 pe relax hota hai. Rest of the day 75.
        // CRYPTO: no IST opening window — always the standard threshold.
        const _istMins = istMinutes();
        const minConf = !isCrypto && (_istMins >= 9 * 60 + 15 && _istMins < 9 * 60 + 45)
          ? Math.min(70, INTRADAY_MIN_CONFIDENCE)
          : INTRADAY_MIN_CONFIDENCE;

        let filteredSignals = signals
          .filter(s => s.confidence >= minConf)
          .sort((a, b) => b.confidence - a.confidence);

        // If market is choppy and rigid filter yields 0, pick top best setups (confidence >= 65)
        if (filteredSignals.length === 0 && signals.length > 0) {
          filteredSignals = signals
            .filter(s => s.confidence >= 65)
            .sort((a, b) => b.confidence - a.confidence);
        }

        signals = filteredSignals.slice(0, INTRADAY_TOP_N)
          // v4: quality grade (A+/A/B) — B is watch-only (frontend flags it)
          .map(s => ({ ...s, grade: gradeSignal(s) }));

        const payload = {
          market: mkt,
          marketOpen: true,
          asOf: new Date().toISOString(),
          scanned: results.length,
          universe: universe.length,
          minConfidence: minConf,
          aiVerified: !!ai,
          aiModel: (ai?.models || []).join('+'),
          aiConsensus: (ai?.models || []).length > 1 ? 'multi-model' : ((ai?.models || [])[0] || ''),
          aiEngine: isCrypto ? 'Crypto Intraday Realtime Market Expert (MCP)' : 'NSE Intraday Realtime Market Expert (MCP)',
          engine: isCrypto
            ? 'SUPER INTELLIGENCE INTRADAY v4 CRYPTO — DUAL-AI EXPERT (Gemini+Groq) • Supertrend/POC/SMA50 confluence • BTC regime gate • CoinDCX INR pricing • 24/7 session • A+/A/B grading'
            : 'SUPER INTELLIGENCE INTRADAY v4 — DUAL-AI EXPERT (Gemini+Groq) • Supertrend/POC/SMA50 confluence • ORB-15 • NIFTY/VIX regime gate • A+/A/B signal grading',
          sources: { tradingView: tvCount, [isCrypto ? 'coindcx' : 'groww']: gwCount },
          marketRegime: regime,
          freshEntriesAllowed: isCrypto ? true : freshEntriesAllowedNow(),
          deadZone,
          signals,
          disclaimer: 'Educational analysis only — not investment advice. Crypto 24/7 me volatility risk rehta hai.'
        };
        cache.data = payload;
        cache.ts = Date.now();

        // OUTCOME ACCOUNTABILITY: persist + track the published signals,
        // and let the live watcher follow them to T1/T2/SL/EOD.
        try { recordSignals(payload.signals); } catch (e) { console.warn('[track-record]', e?.message); }
        setScanSymbols(payload.signals.map(s => s.symbol), mkt);

        // ALGO ALERT ENGINE — push new/reversed setups to Telegram.
        // Promise.resolve() wrapper = defense in depth: even if the dispatch
        // helper ever regresses to a non-async function (which can return
        // undefined on its early-exit paths), the scan response can never be
        // destroyed by a synchronous TypeError again.
        Promise.resolve(dispatchIntradayAlerts(payload.signals, { sendTelegramRaw, escapeHtml })).catch(e =>
          console.warn('[intraday-alerts]', e?.message || e));
        return payload;
      } catch (e) {
        console.error(`[intraday-scanner:${_normMarket(market)}]`, e?.message || e);
        return { market: _normMarket(market), marketOpen: true, signals: [], error: 'Scanner temporarily unavailable.' };
      } finally {
        cache.inflight = null;
      }
  };

  // 60s cache + in-flight dedupe so multiple clients share one scan
  // (per market).
  const runScanner = async (debugForce, market = 'INDIA') => {
    const cache = _cacheFor(_normMarket(market));
    if (cache.data && Date.now() - cache.ts < 60 * 1000) {
      return cache.data;
    }
    if (cache.inflight) return cache.inflight;
    cache.inflight = executeScan(debugForce, market);
    return cache.inflight;
  };

  app.get('/api/intraday-scanner', async (req, res) => {
    const market = _normMarket(req.query.market);
    const debugForce = process.env.INTRADAY_DEBUG === '1';
    // Market-hours gate — hard requirement for the NSE feature.
    // CRYPTO trades 24/7 — its scanner is always live.
    // INTRADAY_DEBUG=1 (owner-only env var) bypasses the gate for pipeline testing.
    if (!isMarketOpenFor(market) && !debugForce) {
      const { hour, minute, weekday } = getISTParts();
      return res.json({
        market,
        marketOpen: false,
        istTime: `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')} IST`,
        weekday,
        signals: [],
        message: 'NSE market band hai. Scanner sirf 09:15 - 15:30 IST (Mon-Fri) active rehta hai.',
      });
    }

    return res.json(await runScanner(debugForce, market));
  });

  // ----------------------------------------------------------
  // v4 — SIGNAL DETAIL: full dual-expert analysis for one symbol.
  // Serves the last scan's structured AI reasoning (Gemini + Groq),
  // grade, entry-quality, risk factors and adjusted levels.
  // ----------------------------------------------------------
  app.get('/api/intraday-signal-detail/:symbol', (req, res) => {
    const sym = String(req.params.symbol || '').trim().toUpperCase();
    if (!/^[A-Z0-9&\-]{2,15}$/.test(sym)) return jsonError(res, 400, 'Valid symbol required.');
    const scan = _intradayCache.data?.signals?.find(x => x.symbol === sym)
      ? _intradayCache.data
      : _cryptoCache.data;
    const s = scan?.signals?.find(x => x.symbol === sym);
    if (!s) {
      return jsonError(res, 404, `No live signal for ${sym} — scanner cache me nahi hai (market band / filtered out ho sakta hai).`);
    }
    res.set('Cache-Control', 'no-store');
    res.json({
      ok: true,
      asOf: scan.asOf,
      signal: {
        symbol: s.symbol, direction: s.direction, grade: s.grade,
        confidence: s.confidence, quantConfidence: s.quantConfidence,
        aiConfidence: s.aiConfidence, aiModel: s.aiModel, aiNote: s.aiNote,
        tradeType: s.tradeType ?? null,
        entryQuality: s.entryQuality ?? null,
        aiReasoning: s.aiReasoning || '',
        riskFactors: s.riskFactors || [],
        geminiVerdict: s.geminiVerdict ?? null,
        groqVerdict: s.groqVerdict ?? null,
        entry: s.entry, stopLoss: s.stopLoss, target1: s.target1, target2: s.target2,
        aiAdjustedSL: s.aiAdjustedSL ?? null,
        aiAdjustedEntry: s.aiAdjustedEntry ?? null,
        rr: s.rr, effRR: s.effRR, adx: s.adx, rsi: s.rsi,
        volumeRatio: s.volumeRatio, vwapDist: s.vwapDist,
        counterTrend: !!s.counterTrend, reasons: s.reasons || [],
      },
    });
  });

  // ----------------------------------------------------------
  // PRO TRADER MCP AGENT — POST /api/intraday-agent
  // Agentic chat with live tool access (auth required — AI cost).
  // ----------------------------------------------------------
  const debugScan = () => process.env.INTRADAY_DEBUG === '1';

  const analyzeSymbol = async (symbol) => {
    try {
      const [tvData, growwData] = await fetchIntradayDataBatch([symbol], fetchGrowwNseQuote);
      if (!tvData[symbol] && !growwData[symbol]) return null;
      let regime = null;
      try { regime = await getMarketRegime(debugScan()); } catch { /* regime optional */ }
      return analyzeIntradayFromScanner(symbol, tvData[symbol], growwData[symbol], { regime });
    } catch {
      return null;
    }
  };

  app.post('/api/intraday-agent', async (req, res) => {
    try {
    const { messages = [] } = req.body || {};
    if (!Array.isArray(messages) || messages.length === 0) {
      return jsonError(res, 400, 'messages[] required');
    }
    // Bound token cost: last 24 turns, 6k chars per message.
    const trimmed = messages.slice(-24).map(m => ({
      role: ['user', 'assistant', 'system'].includes(m?.role) ? m.role : 'user',
      content: String(m?.content || '').slice(0, 6000),
    }));

    const result = await runProTraderAgent(trimmed, {
      KEYS,
      OPENAI_COMPAT,
      fetchGrowwNseQuote,
      getLastScan: () => _intradayCache.data,
      triggerScan: async () => {
        // Respect market hours — outside the session serve the last scan
        // (stale context is still useful: "last scan was 14:55 IST").
        if (!isNseMarketOpen() && !debugScan()) return _intradayCache.data;
        return runScanner(debugScan());
      },
      getTrackRecord,
      getPaperSummary,
      analyzeSymbol,
      getMarketRegime,
    });

    if (!result.ok) return jsonError(res, 502, result.error);
    res.set('Cache-Control', 'no-store');
    res.json(result);
    } catch (e) {
      // 2026 perf audit (L3): Express 4 does not route async rejections to
      // the terminal error middleware — without this a future regression
      // would hang the socket forever (silent spinner, leaked connection).
      return jsonError(res, 500, 'agent route error', e);
    }
  });

  // ----------------------------------------------------------
  // COMMITTEE DEBATE — POST /api/intraday-committee
  // 3 persona debate (Scalper/Momentum/Risk Guardian) + judge
  // synthesis on the current top setups. 10-min cached.
  // ----------------------------------------------------------
  app.post('/api/intraday-committee', async (_req, res) => {
    try {
      const result = await runCommitteeDebate(agentDeps());
      if (!result.ok) return jsonError(res, 400, result.error);
      res.set('Cache-Control', 'no-store');
      res.json(result);
    } catch (e) {
      return jsonError(res, 500, 'committee route error', e);
    }
  });

  // ----------------------------------------------------------
  // DAILY BRIEFING — GET /api/intraday-briefing
  // ?fresh=1 forces regeneration; else today's cached briefing
  // is served if present. Powers the in-app VOICE briefing.
  // ----------------------------------------------------------
  app.get('/api/intraday-briefing', async (req, res) => {
    const fresh = req.query.fresh === '1';
    if (!fresh) {
      const last = getLastBriefing();
      if (last?.fresh) return res.set('Cache-Control', 'no-store').json({ ok: true, briefing: last, cached: true });
    }
    const result = await generateDailyBriefing(agentDeps());
    if (!result.ok) {
      // Fall back to the last stored briefing (even if stale).
      const last = getLastBriefing();
      if (last) return res.json({ ok: true, briefing: last, cached: true, stale: true });
      return jsonError(res, 502, result.error);
    }
    res.set('Cache-Control', 'no-store');
    res.json({ ...result, cached: false });
  });

  // Manual Telegram push of the briefing (owner action).
  app.post('/api/intraday-briefing/push', async (_req, res) => {
    if (!TG?.token || !TG?.chatId) return jsonError(res, 503, 'Telegram not configured on server');
    const ok = await pushMorningBriefingToTelegram({ ...agentDeps(), sendTelegramRaw, escapeHtml });
    if (!ok) return jsonError(res, 502, 'Briefing push failed — AI engines ya Telegram unavailable.');
    res.json({ ok: true });
  });

  // ----------------------------------------------------------
  // TRADE JOURNAL — GET /api/intraday-journal (?days=14)
  // POST /api/intraday-journal/eod    → run EOD AI review NOW
  // POST /api/intraday-journal/weekly → run weekly report NOW
  // ----------------------------------------------------------
  app.get('/api/intraday-journal', (req, res) => {
    const days = Math.max(1, Math.min(90, parseInt(req.query.days, 10) || 14));
    res.set('Cache-Control', 'no-store');
    res.json(getJournal(days));
  });

  app.post('/api/intraday-journal/eod', async (_req, res) => {
    try {
      const result = await runEodReview(agentDeps());
      if (!result.ok) return jsonError(res, 400, result.error);
      res.json(result);
    } catch (e) {
      return jsonError(res, 500, 'EOD review failed unexpectedly.', e);
    }
  });

  app.post('/api/intraday-journal/weekly', async (_req, res) => {
    try {
      const result = await runWeeklyReport(agentDeps());
      if (!result.ok) return jsonError(res, 400, result.error);
      res.json(result);
    } catch (e) {
      return jsonError(res, 500, 'Weekly report failed unexpectedly.', e);
    }
  });
}
