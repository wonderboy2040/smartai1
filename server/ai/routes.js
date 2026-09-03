// ============================================================
// server/ai/routes.js — AI TRADING TERMINAL endpoints
// ------------------------------------------------------------
//   GET  /api/ai/status                  models + risk + connections
//   GET  /api/ai/signals?market=&limit=  ensemble signal board
//   GET  /api/ai/deep/:symbol?market=    one symbol, every model vote
//   GET  /api/ai/options?symbol=NIFTY    chain + analytics + strategies
//   GET  /api/ai/trading/state           config + daily risk state
//   POST /api/ai/trading/config          update (LIVE needs typed phrase)
//   POST /api/ai/trading/kill-switch     { enabled }
//   POST /api/ai/execute                 THE gauntlet (paper | live)
//   GET  /api/ai/positions               journal positions + uPnL + entries
//   POST /api/ai/positions/close         { id }
//   GET  /api/ai/orders                  exchange open orders
//   POST /api/ai/orders/cancel           { id }
//   POST /api/ai/orders/cancel-all       emergency flatten
//
// Background loops (unref'd, non-fatal):
//   • position watcher (60s)  — SL/TP enforcement
//   • auto-executor  (90s)    — STRONG-only auto trading when enabled
// ============================================================
import { getSignals, getDeepSignal, getFreshSignalForExec } from './signals.js';
import { getOptionsDesk, buildStrategies } from './optionsDesk.js';
import {
  loadConfig, updateConfig, getRiskState, executeSignal, getPositionsWithPnl,
  closePosition, listExchangeOrders, cancelExchangeOrder, cancelAllExchangeOrders,
  watchPositions, loadJournal,
} from './coindcxOrders.js';

export function registerAITradingRoutes(app, deps) {
  const { KEYS, OPENAI_COMPAT, TG, jsonError } = deps || {};
  const depsForSignals = {
    KEYS, OPENAI_COMPAT,
    getTradingConfig: () => { try { return loadConfig(); } catch { return {}; } },
  };

  const sendTelegram = async (text) => {
    if (!TG?.token || !TG?.chatId) return false;
    try {
      const r = await fetch(`https://api.telegram.org/bot${TG.token}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat_id: TG.chatId, text, parse_mode: 'HTML', disable_web_page_preview: true }),
        signal: AbortSignal.timeout(10_000),
      });
      return r.ok;
    } catch { return false; }
  };

  // ---------------- status ----------------
  app.get('/api/ai/status', async (_req, res) => {
    try {
      const risk = getRiskState();
      const board = await getSignals('INDIA', depsForSignals).catch(() => null);
      const cryptoBoard = await getSignals('CRYPTO', depsForSignals).catch(() => null);
      res.json({
        ok: true,
        engine: 'SUPERINTELLIGENCE ENSEMBLE v6.0',
        models: board?.models || cryptoBoard?.models || [],
        aiCouncilOnline: (board?.models || []).some(m => m.id === 'aicouncil' && m.online),
        risk,
        india: board ? { ok: board.ok, signals: board.signals?.length || 0, marketOpen: board.marketOpen } : null,
        crypto: cryptoBoard ? { ok: cryptoBoard.ok, signals: cryptoBoard.signals?.length || 0 } : null,
      });
    } catch (e) {
      jsonError(res, 500, 'ai status failed', e);
    }
  });

  // ---------------- signal board ----------------
  app.get('/api/ai/signals', async (req, res) => {
    try {
      const market = String(req.query.market || 'INDIA').toUpperCase();
      const limit = Math.min(15, Math.max(3, parseInt(req.query.limit, 10) || 10));
      const board = await getSignals(market === 'CRYPTO' ? 'CRYPTO' : 'INDIA', depsForSignals, { limit });
      res.json(board);
    } catch (e) {
      jsonError(res, 500, 'ai signals failed', e);
    }
  });

  // ---------------- deep single-symbol analysis ----------------
  app.get('/api/ai/deep/:symbol', async (req, res) => {
    try {
      const market = String(req.query.market || 'INDIA').toUpperCase();
      const out = await getDeepSignal(req.params.symbol, market, depsForSignals);
      if (!out?.ok) return res.status(404).json(out);
      res.json(out);
    } catch (e) {
      jsonError(res, 500, 'deep signal failed', e);
    }
  });

  // ---------------- India options desk ----------------
  app.get('/api/ai/options', async (req, res) => {
    try {
      const symbol = String(req.query.symbol || 'NIFTY').toUpperCase();
      const desk = await getOptionsDesk(symbol);
      if (!desk?.ok) return res.status(502).json(desk);
      // Index consensus (daily-candle TA + regime) drives strategy choice.
      const deep = await getDeepSignal(symbol, 'INDIA', depsForSignals, { optionsCtx: desk.optionsCtx }).catch(() => null);
      const consensus = deep?.ok ? {
        side: deep.signal.side, confidence: deep.signal.confidence,
        agreement: deep.signal.agreement, grade: deep.signal.grade,
      } : { side: 'FLAT', confidence: 0, agreement: 0, grade: 'NEUTRAL' };
      res.json({
        ...desk,
        consensus,
        strategies: buildStrategies(desk, consensus),
      });
    } catch (e) {
      jsonError(res, 500, 'options desk failed', e);
    }
  });

  // ---------------- trading state / config ----------------
  app.get('/api/ai/trading/state', (_req, res) => {
    try { res.json({ ok: true, ...getRiskState() }); } catch (e) { jsonError(res, 500, 'state failed', e); }
  });

  app.post('/api/ai/trading/config', (req, res) => {
    try {
      const cfg = updateConfig(req.body || {});
      res.json({ ok: true, config: cfg });
    } catch (e) {
      const status = e?.status || 400;
      return res.status(status).json({ ok: false, error: String(e?.message || e) });
    }
  });

  app.post('/api/ai/trading/kill-switch', (req, res) => {
    try {
      const enabled = !!(req.body || {}).enabled;
      const cfg = updateConfig({ killSwitch: enabled });
      if (enabled) {
        cancelAllExchangeOrders().catch(() => { /* best-effort */ });
      }
      res.json({ ok: true, config: cfg });
    } catch (e) {
      return res.status(400).json({ ok: false, error: String(e?.message || e) });
    }
  });

  // ---------------- THE EXECUTION GAUNTLET ----------------
  app.post('/api/ai/execute', async (req, res) => {
    try {
      const { symbol, side, mode, qtyINR } = req.body || {};
      if (!symbol) return res.status(400).json({ ok: false, error: 'symbol required' });
      const result = await executeSignal({
        symbol: String(symbol).toUpperCase(),
        side: side ? String(side).toUpperCase() : undefined,
        mode: mode === 'live' ? 'live' : 'paper',
        qtyINR: qtyINR != null ? Number(qtyINR) : undefined,
        getFreshSignal: (pair) => getFreshSignalForExec(pair, depsForSignals),
        wantAuto: false,
        source: 'manual',
      });
      return res.status(result.ok ? 200 : 400).json(result);
    } catch (e) {
      return res.status(500).json({ ok: false, error: String(e?.message || e) });
    }
  });

  // ---------------- positions / journal ----------------
  app.get('/api/ai/positions', async (_req, res) => {
    try { res.json({ ok: true, ...(await getPositionsWithPnl()) }); }
    catch (e) { jsonError(res, 500, 'positions failed', e); }
  });

  app.post('/api/ai/positions/close', async (req, res) => {
    try {
      const { id } = req.body || {};
      if (!id) return res.status(400).json({ ok: false, error: 'id required' });
      const out = await closePosition(String(id));
      return res.status(out.ok ? 200 : 400).json(out);
    } catch (e) {
      return res.status(500).json({ ok: false, error: String(e?.message || e) });
    }
  });

  // ---------------- exchange orders ----------------
  app.get('/api/ai/orders', async (_req, res) => {
    try { res.json(await listExchangeOrders(['open', 'partially_filled'])); }
    catch (e) { jsonError(res, 500, 'orders failed', e); }
  });

  app.post('/api/ai/orders/cancel', async (req, res) => {
    try {
      const { id } = req.body || {};
      if (!id) return res.status(400).json({ ok: false, error: 'id required' });
      res.json(await cancelExchangeOrder(String(id)));
    } catch (e) { jsonError(res, 500, 'cancel failed', e); }
  });

  app.post('/api/ai/orders/cancel-all', async (_req, res) => {
    try { res.json(await cancelAllExchangeOrders()); }
    catch (e) { jsonError(res, 500, 'cancel-all failed', e); }
  });

  // ---------------- background loops ----------------
  // Position watcher — SL/TP enforcement every 60s.
  const watcher = setInterval(async () => {
    try {
      const closures = await watchPositions({ sendTelegram });
      if (closures.length > 0) {
        console.log(`[ai] watcher closed ${closures.length} position(s): ${closures.map(c => `${c.pair} ${c.pnlINR}`).join(', ')}`);
      }
    } catch { /* non-fatal */ }
  }, 60_000);
  if (watcher.unref) watcher.unref();

  // Auto-executor — only when the user explicitly enabled it in LIVE
  // mode. executeSignal re-runs every gate; caps/kill switch apply.
  const auto = setInterval(async () => {
    try {
      const cfg = loadConfig();
      if (!cfg.allowAuto || cfg.killSwitch || cfg.mode !== 'live') return;
      const j = loadJournal();
      if (j.positions.some(p => p.status === 'OPEN' && p.source === 'auto')) return; // one auto position at a time
      const board = await getSignals('CRYPTO', depsForSignals, { limit: 5 });
      const strong = (board?.signals || []).find(s => s.grade === 'STRONG' && s.executable);
      if (!strong) return;
      const out = await executeSignal({
        symbol: strong.symbol, side: strong.side, mode: 'live',
        getFreshSignal: (pair) => getFreshSignalForExec(pair, depsForSignals),
        wantAuto: true, source: 'auto',
      });
      if (out.ok) {
        await sendTelegram(`🤖 <b>AI AUTO-EXECUTED</b> — ${strong.symbol} ${strong.side} (${strong.confidence}% conf)\nQty: ${out.filled?.qty} @ ₹${out.filled?.price}\nSL ₹${strong.plan?.stopLoss} · TP ₹${strong.plan?.target2}`);
        console.log(`[ai] auto-executed ${strong.symbol} ${strong.side}`);
      }
    } catch { /* non-fatal */ }
  }, 90_000);
  if (auto.unref) auto.unref();

  console.log('[ai] Superintelligence Ensemble v6.0 — 9 models online, AI Trading Terminal registered');
}
