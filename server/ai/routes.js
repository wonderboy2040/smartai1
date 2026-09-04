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
//   POST /api/ai/execute                 THE gauntlet — crypto (paper | live)
//   POST /api/ai/india/execute           THE gauntlet — India Dhan (v6.5)
//   GET  /api/ai/positions               journal positions + uPnL + entries
//   POST /api/ai/positions/close         { id } (routes by market)
//   GET  /api/ai/orders                  CoinDCX exchange open orders
//   POST /api/ai/orders/cancel           { id }
//   POST /api/ai/orders/cancel-all       emergency flatten
//   GET  /api/ai/backtest?market=        v6.5 walk-forward ensemble replay
//   GET  /api/ai/alerts/config           v6.5 masked telegram + AI key status
//   POST /api/ai/alerts/config           v6.5 save secrets (masked read-back)
//   POST /api/ai/alerts/test             v6.5 send a test telegram message
//   POST /api/ai/dhan/connect            v6.5 { clientId, accessToken }
//   POST /api/ai/dhan/disconnect         v6.5
//   GET  /api/ai/dhan/status             v6.5 connected + scrip master + profile
//
// Background loops (unref'd, non-fatal):
//   • position watcher (60s)   — crypto SL/TP + trailing
//   • India watcher (60s)      — India SL/TP + trailing + 15:15 square-off
//   • STRONG-signal alerter (60s) — telegram on fresh STRONG consensus
//   • auto-executor  (90s)     — STRONG-only auto trading when enabled
// ============================================================
import { getSignals, getDeepSignal, getFreshSignalForExec } from './signals.js';
import { getOptionsDesk, buildStrategies } from './optionsDesk.js';
import {
  loadConfig, updateConfig, getRiskState, executeSignal, getPositionsWithPnl,
  closePosition, listExchangeOrders, cancelExchangeOrder, cancelAllExchangeOrders,
  watchPositions, loadJournal,
} from './coindcxOrders.js';
import { executeIndiaSignal, watchIndiaPositions, closeIndiaPosition } from './indiaOrders.js';
import { runBacktest } from './backtest.js';
import {
  secretsStatus, setSecret, getSecrets, telegramConfig, sendTelegramMessage,
} from './secrets.js';
import { dhanConnect, dhanDisconnect, dhanConnected, dhanProfile, scripMasterStatus } from './dhan.js';
import { isNseOpen } from './data.js';

const ALERT_COOLDOWN_MS = 30 * 60_000; // same symbol+side re-alerts after 30 min

export function registerAITradingRoutes(app, deps) {
  const { KEYS, OPENAI_COMPAT, TG, jsonError } = deps || {};

  // v6.5: AI Council keys — secrets (typed in the app) WIN over env.
  // Built fresh on every call so a key saved mid-flight engages on the
  // next board run without a restart.
  const effectiveKeys = () => {
    try {
      const sec = getSecrets();
      return {
        ...(KEYS || {}),
        gemini: sec.geminiApiKey || (KEYS?.gemini || ''),
        groq: sec.groqApiKey || (KEYS?.groq || ''),
      };
    } catch { return KEYS || {}; }
  };

  const depsForSignals = () => ({
    KEYS: effectiveKeys(),
    OPENAI_COMPAT,
    getTradingConfig: () => { try { return loadConfig(); } catch { return {}; } },
  });

  // v6.5: telegram — secrets WIN over env; one resolver, one sender.
  const sendTelegram = (text) => sendTelegramMessage(text, { token: TG?.token || '', chatId: TG?.chatId || '' });

  // ---------------- status ----------------
  app.get('/api/ai/status', async (_req, res) => {
    try {
      const risk = getRiskState();
      const [board, cryptoBoard] = await Promise.all([
        getSignals('INDIA', depsForSignals()).catch(() => null),
        getSignals('CRYPTO', depsForSignals()).catch(() => null),
      ]);
      res.json({
        ok: true,
        engine: 'SUPERINTELLIGENCE ENSEMBLE v6.5',
        models: board?.models || cryptoBoard?.models || [],
        aiCouncilOnline: (board?.models || []).some(m => m.id === 'aicouncil' && m.online),
        risk,
        dhan: { connected: dhanConnected() },
        telegram: { configured: !!telegramConfig(TG || {}) },
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
      const board = await getSignals(market === 'CRYPTO' ? 'CRYPTO' : 'INDIA', depsForSignals(), { limit });
      res.json(board);
    } catch (e) {
      jsonError(res, 500, 'ai signals failed', e);
    }
  });

  // ---------------- deep single-symbol analysis ----------------
  app.get('/api/ai/deep/:symbol', async (req, res) => {
    try {
      const market = String(req.query.market || 'INDIA').toUpperCase();
      const out = await getDeepSignal(req.params.symbol, market, depsForSignals());
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
      const deep = await getDeepSignal(symbol, 'INDIA', depsForSignals(), { optionsCtx: desk.optionsCtx }).catch(() => null);
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

  // ---------------- THE EXECUTION GAUNTLET (crypto) ----------------
  app.post('/api/ai/execute', async (req, res) => {
    try {
      const { symbol, side, mode, qtyINR } = req.body || {};
      if (!symbol) return res.status(400).json({ ok: false, error: 'symbol required' });
      const result = await executeSignal({
        symbol: String(symbol).toUpperCase(),
        side: side ? String(side).toUpperCase() : undefined,
        mode: mode === 'live' ? 'live' : 'paper',
        qtyINR: qtyINR != null ? Number(qtyINR) : undefined,
        getFreshSignal: (pair) => getFreshSignalForExec(pair, depsForSignals()),
        wantAuto: false,
        source: 'manual',
      });
      return res.status(result.ok ? 200 : 400).json(result);
    } catch (e) {
      return res.status(500).json({ ok: false, error: String(e?.message || e) });
    }
  });

  // ---------------- THE EXECUTION GAUNTLET (India, v6.5) ----------------
  app.post('/api/ai/india/execute', async (req, res) => {
    try {
      const { symbol, side, mode, qtyINR } = req.body || {};
      if (!symbol) return res.status(400).json({ ok: false, error: 'symbol required' });
      const result = await executeIndiaSignal({
        symbol: String(symbol).toUpperCase(),
        side: side ? String(side).toUpperCase() : undefined,
        mode: mode === 'live' ? 'live' : 'paper',
        qtyINR: qtyINR != null ? Number(qtyINR) : undefined,
        getFreshIndiaSignal: async (sym) => {
          const deep = await getDeepSignal(sym, 'INDIA', depsForSignals()).catch(() => null);
          return deep?.ok ? deep.signal : null;
        },
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
      // v6.5: India positions close through the Dhan path (market order +
      // broker-SL cancel); crypto positions through the CoinDCX path.
      const j = loadJournal();
      const p = j.positions.find(x => x.id === id || x.exchangeOrderId === id);
      const out = p && p.market === 'INDIA'
        ? await closeIndiaPosition(String(id))
        : await closePosition(String(id));
      return res.status(out.ok ? 200 : 400).json(out);
    } catch (e) {
      return res.status(500).json({ ok: false, error: String(e?.message || e) });
    }
  });

  // ---------------- exchange orders (CoinDCX) ----------------
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

  // ---------------- backtest (v6.5) ----------------
  app.get('/api/ai/backtest', async (req, res) => {
    try {
      const market = String(req.query.market || 'CRYPTO').toUpperCase();
      const symbols = String(req.query.symbols || '').split(',').map(s => s.trim()).filter(Boolean);
      const minGrade = ['STRONG', 'ACTION', 'WATCH'].includes(String(req.query.minGrade).toUpperCase())
        ? String(req.query.minGrade).toUpperCase() : 'ACTION';
      const capital = Math.min(1_000_000, Math.max(100, parseInt(req.query.capital, 10) || 1000));
      const riskCap = (() => { try { const cfg = loadConfig(); return Number(cfg.maxRiskPct) > 0 ? cfg.maxRiskPct : 5; } catch { return 5; } })();
      const out = await runBacktest({ market, symbols, minGrade, capitalPerTradeINR: capital, maxRiskPct: riskCap });
      res.json(out);
    } catch (e) {
      jsonError(res, 500, 'backtest failed', e);
    }
  });

  // ---------------- alerts + AI council keys (v6.5) ----------------
  app.get('/api/ai/alerts/config', (_req, res) => {
    try {
      const tg = telegramConfig(TG || {});
      res.json({ ok: true, status: secretsStatus(), telegram: { configured: !!tg, source: tg?.source || null } });
    } catch (e) { jsonError(res, 500, 'alerts config failed', e); }
  });

  app.post('/api/ai/alerts/config', (req, res) => {
    try {
      const body = req.body || {};
      const applied = [];
      for (const key of ['telegramBotToken', 'telegramChatId', 'geminiApiKey', 'groqApiKey']) {
        if (key in body) {
          setSecret(key, body[key] == null || body[key] === '' ? null : String(body[key]));
          applied.push(key);
        }
      }
      if (applied.length === 0) return res.status(400).json({ ok: false, error: 'nothing to save (send telegramBotToken / telegramChatId / geminiApiKey / groqApiKey)' });
      res.json({ ok: true, applied, status: secretsStatus() });
    } catch (e) {
      const status = e?.status || 400;
      return res.status(status).json({ ok: false, error: String(e?.message || e) });
    }
  });

  app.post('/api/ai/alerts/test', async (_req, res) => {
    try {
      const out = await sendTelegram(
        '🤖 <b>SmartAI AI Trading</b> — test message\nAlerts are LIVE. STRONG signals, fills and SL/TP closes will ping you here.',
      );
      if (!out.ok) return res.status(400).json(out);
      res.json(out);
    } catch (e) { jsonError(res, 500, 'alerts test failed', e); }
  });

  // ---------------- Dhan connect (v6.5) ----------------
  app.post('/api/ai/dhan/connect', async (req, res) => {
    try {
      const { clientId, accessToken } = req.body || {};
      if (clientId == null || accessToken == null) {
        return res.status(400).json({ ok: false, error: 'clientId and accessToken required (Dhan app → Profile → API/Apps)' });
      }
      dhanConnect(clientId, accessToken);
      // Validate with a profile ping — bad creds fail HERE, not on an order.
      let profile = null;
      try { profile = await dhanProfile(); } catch (e) {
        dhanDisconnect();
        return res.status(400).json({ ok: false, error: `Dhan rejected the token: ${String(e?.message || e).slice(0, 150)}` });
      }
      const scrips = await scripMasterStatus().catch(() => ({ cached: false, symbols: 0 }));
      res.json({ ok: true, profile: { name: profile?.name || null, clientId: profile?.clientId || null }, scrips });
    } catch (e) {
      const status = e?.status || 400;
      return res.status(status).json({ ok: false, error: String(e?.message || e) });
    }
  });

  app.post('/api/ai/dhan/disconnect', (_req, res) => {
    try { dhanDisconnect(); res.json({ ok: true }); }
    catch (e) { return res.status(400).json({ ok: false, error: String(e?.message || e) }); }
  });

  app.get('/api/ai/dhan/status', async (_req, res) => {
    try {
      const scrips = await scripMasterStatus().catch(() => ({ cached: false, symbols: 0, updatedAt: null }));
      let profile = null;
      if (dhanConnected()) profile = await dhanProfile().catch(() => null);
      res.json({ ok: true, connected: dhanConnected(), scrips, profile: profile ? { name: profile.name || null, clientId: profile.clientId || null } : null });
    } catch (e) { jsonError(res, 500, 'dhan status failed', e); }
  });

  // ---------------- background loops ----------------
  // Crypto position watcher — SL/TP + trailing every 60s.
  const watcher = setInterval(async () => {
    try {
      const closures = await watchPositions({ sendTelegram });
      if (closures.length > 0) {
        console.log(`[ai] watcher closed ${closures.length} position(s): ${closures.map(c => `${c.pair} ${c.pnlINR}`).join(', ')}`);
      }
    } catch { /* non-fatal */ }
  }, 60_000);
  if (watcher.unref) watcher.unref();

  // India watcher — SL/TP + trailing + 15:15 square-off (NSE hours only).
  const indiaWatcher = setInterval(async () => {
    try {
      if (!isNseOpen()) return;
      const closures = await watchIndiaPositions({ sendTelegram });
      if (closures.length > 0) {
        console.log(`[ai] India watcher closed ${closures.length} position(s): ${closures.map(c => `${c.pair} ${c.pnlINR}`).join(', ')}`);
      }
    } catch { /* non-fatal */ }
  }, 60_000);
  if (indiaWatcher.unref) indiaWatcher.unref();

  // v6.5 STRONG-signal alerter — telegram ping when a fresh STRONG
  // consensus appears on either desk (deduped per symbol+side, 30 min).
  const lastAlerts = new Map(); // key → ts
  const alerter = setInterval(async () => {
    try {
      const tg = telegramConfig(TG || {});
      if (!tg) return;
      const cfg = loadConfig();
      if (cfg.killSwitch) return;
      for (const mkt of ['CRYPTO', 'INDIA']) {
        const board = await getSignals(mkt, depsForSignals(), { limit: 5 }).catch(() => null);
        const strongs = (board?.signals || []).filter(s => s.grade === 'STRONG');
        for (const s of strongs) {
          const key = `${mkt}:${s.symbol}:${s.side}`;
          const last = lastAlerts.get(key) || 0;
          if (Date.now() - last < ALERT_COOLDOWN_MS) continue;
          lastAlerts.set(key, Date.now());
          await sendTelegram(
            `🤖 <b>STRONG SIGNAL</b> — ${mkt === 'INDIA' ? '🇮🇳 NSE' : '₿ Crypto'} · ${s.symbol} ${s.side}\n` +
            `Confidence ${s.confidence}% · agreement ${Math.round((s.agreement || 0) * 100)}% · ${s.participating}/${s.totalModels} models\n` +
            (s.plan ? `Entry ₹${s.plan.entry} · SL ₹${s.plan.stopLoss} · T2 ₹${s.plan.target2} (R:R 1:${s.plan.rewardRisk})` : ''),
          );
        }
      }
      // prune the dedupe map so it can't grow unboundedly
      if (lastAlerts.size > 100) {
        const cutoff = Date.now() - ALERT_COOLDOWN_MS;
        for (const [k, ts] of lastAlerts) if (ts < cutoff) lastAlerts.delete(k);
      }
    } catch { /* non-fatal */ }
  }, 60_000);
  if (alerter.unref) alerter.unref();

  // Auto-executor — only when the user explicitly enabled it in LIVE
  // mode. executeSignal re-runs every gate; caps/kill switch apply.
  const auto = setInterval(async () => {
    try {
      const cfg = loadConfig();
      if (!cfg.allowAuto || cfg.killSwitch || cfg.mode !== 'live') return;
      const j = loadJournal();
      // one auto position at a time — UNKNOWN (unreconciled live fills)
      // counts as open: never stack auto orders onto an uncertain fill
      if (j.positions.some(p => (p.status === 'OPEN' || p.status === 'UNKNOWN') && p.source === 'auto')) return;
      const board = await getSignals('CRYPTO', depsForSignals(), { limit: 5 });
      const strong = (board?.signals || []).find(s => s.grade === 'STRONG' && s.executable);
      if (!strong) return;
      const out = await executeSignal({
        symbol: strong.symbol, side: strong.side, mode: 'live',
        getFreshSignal: (pair) => getFreshSignalForExec(pair, depsForSignals()),
        wantAuto: true, source: 'auto',
      });
      if (out.ok) {
        await sendTelegram(`🤖 <b>AI AUTO-EXECUTED</b> — ${strong.symbol} ${strong.side} (${strong.confidence}% conf)\nQty: ${out.filled?.qty} @ ₹${out.filled?.price}\nSL ₹${strong.plan?.stopLoss} · TP ₹${strong.plan?.target2}`);
        console.log(`[ai] auto-executed ${strong.symbol} ${strong.side}`);
      }
    } catch { /* non-fatal */ }
  }, 90_000);
  if (auto.unref) auto.unref();

  console.log('[ai] Superintelligence Ensemble v6.5 — 9 models online · trailing SL · backtests · Telegram alerts · India Dhan gauntlet');
}
