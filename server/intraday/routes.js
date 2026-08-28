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
//   GET  /api/intraday-universe       base + custom watchlist
//   POST /api/intraday-universe       { add: [], remove: [], restore: [] }
// ============================================================
import {
  BASE_UNIVERSE, INTRADAY_MIN_CONFIDENCE, INTRADAY_TOP_N,
  fetchIntradayDataBatch, analyzeIntradayFromScanner, aiVerifySignals,
} from './engine.js';
import { istMinutes, getISTParts, isNseMarketOpen } from './time.js';
import { getMarketRegime, freshEntriesAllowedNow } from './regime.js';
import { dispatchIntradayAlerts, dispatchOutcomeAlert, alertsStatus, setAlertsEnabled } from './alerts.js';
import { recordSignals, getTrackRecord, initTrackRecord } from './trackRecord.js';
import { openPaperTrade, closePaperTrade, getPaperSummary, initPaperTrading } from './paperTrading.js';
import { initIntradayStream, intradayStreamHandler, setScanSymbols, getLatestQuotes } from './stream.js';
import { loadJSON, saveJSON } from './store.js';

// ------------------------------------------------------------
// Custom universe / watchlist (persisted).
// effective = (BASE − removedBase) + custom   (cap: +50 custom)
// ------------------------------------------------------------
const UNIVERSE_FILE = 'intraday-universe.json';
const UNIVERSE_CUSTOM_MAX = 50;
let _universe = loadJSON(UNIVERSE_FILE, { removedBase: [], custom: [] });

function _validCustomSym(s) {
  return typeof s === 'string' && /^[A-Z0-9&\-]{2,15}$/.test(s.trim().toUpperCase());
}

function effectiveUniverse() {
  const removed = new Set(_universe.removedBase || []);
  const custom = (_universe.custom || []).filter(_validCustomSym);
  return [...new Set([...BASE_UNIVERSE.filter(s => !removed.has(s)), ...custom])];
}

function _saveUniverse() { saveJSON(UNIVERSE_FILE, _universe); }

export function getUniverseInfo() {
  const eff = effectiveUniverse();
  return {
    baseCount: BASE_UNIVERSE.length,
    removedBase: _universe.removedBase || [],
    custom: _universe.custom || [],
    effectiveCount: eff.length,
    effective: eff,
  };
}

// ------------------------------------------------------------
// Registration
// ------------------------------------------------------------
export function registerIntradayRoutes(app, deps) {
  const {
    fetchGrowwNseQuote, KEYS, OPENAI_COMPAT, TG, escapeHtml, jsonError,
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

  // Boot the watcher + reconcile stale persisted state.
  initTrackRecord();
  initPaperTrading();
  initIntradayStream({ fetchGrowwNseQuote, sendTelegramRaw, escapeHtml, dispatchOutcomeAlert });

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

  // ---------------- Universe / watchlist ----------------
  app.get('/api/intraday-universe', (_req, res) => {
    res.json(getUniverseInfo());
  });

  app.post('/api/intraday-universe', (req, res) => {
    const { add = [], remove = [], restore = [] } = req.body || {};
    if (!Array.isArray(add) || !Array.isArray(remove) || !Array.isArray(restore)) {
      return jsonError(res, 400, 'add/remove/restore must be arrays.');
    }
    const norm = (arr) => [...new Set(arr.map(s => String(s).trim().toUpperCase()).filter(Boolean))];

    // ADD custom symbols (validated, capped).
    for (const sym of norm(add).slice(0, 20)) {
      if (!_validCustomSym(sym)) continue;
      if (_universe.custom.length >= UNIVERSE_CUSTOM_MAX) break;
      if (!BASE_UNIVERSE.includes(sym) && !_universe.custom.includes(sym)) _universe.custom.push(sym);
    }
    // REMOVE — either a custom add or a base symbol.
    for (const sym of norm(remove).slice(0, 20)) {
      _universe.custom = _universe.custom.filter(s => s !== sym);
      if (BASE_UNIVERSE.includes(sym) && !_universe.removedBase.includes(sym)) {
        _universe.removedBase.push(sym);
      }
    }
    // RESTORE base symbols that were removed earlier.
    for (const sym of norm(restore).slice(0, 20)) {
      _universe.removedBase = _universe.removedBase.filter(s => s !== sym);
    }
    _saveUniverse();
    res.json({ ok: true, ...getUniverseInfo() });
  });

  // ---------------- MAIN SCANNER ----------------
  let _intradayCache = { data: null, ts: 0, inflight: null };

  app.get('/api/intraday-scanner', async (_req, res) => {
    // Market-hours gate — hard requirement for this feature.
    // INTRADAY_DEBUG=1 (owner-only env var) bypasses the gate for pipeline testing.
    const debugForce = process.env.INTRADAY_DEBUG === '1';
    if (!isNseMarketOpen() && !debugForce) {
      const { hour, minute, weekday } = getISTParts();
      return res.json({
        marketOpen: false,
        istTime: `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')} IST`,
        weekday,
        signals: [],
        message: 'NSE market band hai. Scanner sirf 09:15 - 15:30 IST (Mon-Fri) active rehta hai.',
      });
    }

    // 60s cache + in-flight dedupe so multiple clients share one scan.
    if (_intradayCache.data && Date.now() - _intradayCache.ts < 60 * 1000) {
      return res.json(_intradayCache.data);
    }
    if (_intradayCache.inflight) return res.json(await _intradayCache.inflight);

    _intradayCache.inflight = (async () => {
      try {
        const universe = effectiveUniverse();

        // Regime + market data in parallel (regime gates every analysis).
        const [regime, [tvData, growwData]] = await Promise.all([
          getMarketRegime(debugForce),
          fetchIntradayDataBatch(universe, fetchGrowwNseQuote),
        ]);
        const tvCount = Object.keys(tvData).length;
        const gwCount = Object.keys(growwData).length;
        console.log(`[intraday-scanner] Data: TV=${tvCount} symbols, Groww=${gwCount} symbols, regime=${regime?.regime || 'n/a'}`);

        const results = [];
        for (const sym of universe) {
          const r = analyzeIntradayFromScanner(sym, tvData[sym], growwData[sym], { regime });
          if (r) results.push(r);
        }
        console.log(`[intraday-scanner] Analyzed ${results.length}/${universe.length} symbols`);

        // Zero results → SMART DIAGNOSTICS, not a dead-end error wall.
        if (results.length === 0) {
          const feedsCold = tvCount === 0 && gwCount === 0;
          return {
            marketOpen: true,
            signals: [],
            scanned: 0,
            universe: universe.length,
            sources: { tradingView: tvCount, groww: gwCount },
            retryAfterSeconds: 30,
            error: feedsCold
              ? 'Live feeds connect ho rahe hain (market open ke turant baad ye normal hai) — 30s me auto re-scan chalega, page refresh ki zarurat nahi.'
              : 'Data warm-up me hai — scanner LIVE hai, 30s me auto re-scan se top setups yahin aa jayenge.',
          };
        }

        // Quant pre-filter: strong setups only go to AI verification.
        let pool = results.filter(r => r.quantConfidence >= 70);
        if (pool.length === 0) pool = results.sort((a, b) => b.quantConfidence - a.quantConfidence).slice(0, 8);
        pool = pool.sort((a, b) => b.quantConfidence - a.quantConfidence).slice(0, 10);

        // MCP AI verification layer — multi-model consensus.
        const ai = await aiVerifySignals(pool, { KEYS, OPENAI_COMPAT });
        let signals = pool.map(c => {
          let aiConfidence = null, aiNote = '', aiModel = '';
          const v = ai?.verdicts?.[c.symbol];
          if (v && typeof v.confidence === 'number') {
            const multiModel = (v.models?.length || 1) >= 2;
            if (v.verdict === 'AVOID') {
              aiConfidence = Math.round(v.confidence * 0.5);
              aiNote = v.note || 'AI avoid';
            } else if (v.verdict !== c.direction) {
              aiConfidence = Math.round(v.confidence * 0.5); // disagreement → heavy penalty
              aiNote = v.note || 'AI disagrees with direction';
            } else {
              // Agreement: blend engine + AI. More weight to AI when multiple models concur.
              const aiW = multiModel ? 0.6 : 0.55;
              aiConfidence = Math.round(c.quantConfidence * (1 - aiW) + v.confidence * aiW);
              // Dissenting AI vote caps conviction.
              if ((v.dissent || 0) > 0) aiConfidence -= 4;
              aiNote = v.note || '';
            }
            aiModel = (v.models || []).join('+') || (ai.models || []).join('+');
          }
          const confidence = aiConfidence != null ? Math.max(0, Math.min(100, aiConfidence)) : (c._rrOk ? c.quantConfidence : c.quantConfidence - 12);
          const { _rrOk, _momentumPct, ...clean } = c;
          return { ...clean, aiConfidence, aiModel, aiNote, confidence };
        });

        // Adaptive threshold: opening 30 min me quant engine cap 88 hota hai,
        // isliye min confidence 70 pe relax hota hai. Rest of the day 75.
        const _istMins = istMinutes();
        const minConf = (_istMins >= 9 * 60 + 15 && _istMins < 9 * 60 + 45)
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

        signals = filteredSignals.slice(0, INTRADAY_TOP_N);

        const payload = {
          marketOpen: true,
          asOf: new Date().toISOString(),
          scanned: results.length,
          universe: universe.length,
          minConfidence: minConf,
          aiVerified: !!ai,
          aiModel: (ai?.models || []).join('+'),
          aiConsensus: (ai?.models || []).length > 1 ? 'multi-model' : ((ai?.models || [])[0] || ''),
          aiEngine: 'NSE Intraday Realtime Market Expert (MCP)',
          engine: 'SUPER INTELLIGENCE INTRADAY v3 — TradingView+Groww dual feed • ORB-15 • NIFTY/VIX regime gate • MCP expert consensus',
          sources: { tradingView: tvCount, groww: gwCount },
          marketRegime: regime,
          freshEntriesAllowed: freshEntriesAllowedNow(),
          signals,
          disclaimer: 'Educational analysis only — not investment advice. Intraday trading me capital loss ka risk hai.',
        };
        _intradayCache.data = payload;
        _intradayCache.ts = Date.now();

        // OUTCOME ACCOUNTABILITY: persist + track the published signals,
        // and let the live watcher follow them to T1/T2/SL/EOD.
        try { recordSignals(payload.signals); } catch (e) { console.warn('[track-record]', e?.message); }
        setScanSymbols(payload.signals.map(s => s.symbol));

        // ALGO ALERT ENGINE — push new/reversed setups to Telegram.
        // Promise.resolve() wrapper = defense in depth: even if the dispatch
        // helper ever regresses to a non-async function (which can return
        // undefined on its early-exit paths), the scan response can never be
        // destroyed by a synchronous TypeError again.
        Promise.resolve(dispatchIntradayAlerts(payload.signals, { sendTelegramRaw, escapeHtml })).catch(e =>
          console.warn('[intraday-alerts]', e?.message || e));
        return payload;
      } catch (e) {
        console.error('[intraday-scanner]', e?.message || e);
        return { marketOpen: true, signals: [], error: 'Scanner temporarily unavailable.' };
      } finally {
        _intradayCache.inflight = null;
      }
    })();

    return res.json(await _intradayCache.inflight);
  });
}
