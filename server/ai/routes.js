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
import { getSignals, getDeepSignal, getFreshSignalForExec, getFreshFuturesSignalForExec } from './signals.js';
import { getOptionsDesk, buildStrategies } from './optionsDesk.js';
import {
  loadConfig, updateConfig, getRiskState, executeSignal, getPositionsWithPnl,
  closePosition, listExchangeOrders, cancelExchangeOrder, cancelAllExchangeOrders,
  watchPositions, loadJournal, dailyStats,
} from './coindcxOrders.js';
import {
  executeFuturesSignal, watchFuturesPositions, closeFuturesPosition,
  walletSnapshot, futuresMarketsView,
} from './futures.js';
import {
  agentTick, agentStatus, agentStart, agentStop, updateAgentConfig, loadAgentConfig,
} from './agent.js';
import { executeIndiaSignal, watchIndiaPositions, closeIndiaPosition } from './indiaOrders.js';
import { runBacktest } from './backtest.js';
import { getSwingBoard, scanWhales, getOrderbook } from './swing.js';
import { ledgerStatus, recentEntries, verifyLedger } from './ledger.js';
import { adaptiveStatus } from './adaptive.js';
import { trustReport, governance } from './trust.js';
import { perfReport } from './perf.js';
import { correlationMatrix } from './correlation.js';
import { sectorDesk } from './sectors.js';
import { rankIncomeSetups } from './optionsDesk.js';
import {
  secretsStatus, setSecret, getSecrets, telegramConfig, sendTelegramMessage,
} from './secrets.js';
import { dhanConnect, dhanDisconnect, dhanConnected, dhanProfile, scripMasterStatus } from './dhan.js';
import { isNseOpen, fetchYahooQuotes } from './data.js';

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

  const normMarket = (raw) => {
    const m = String(raw || 'INDIA').toUpperCase();
    return m === 'CRYPTO' ? 'CRYPTO' : m === 'FUTURES' ? 'FUTURES' : 'INDIA';
  };

  // ---------------- status ----------------
  app.get('/api/ai/status', async (_req, res) => {
    try {
      const risk = getRiskState();
      const [board, cryptoBoard, futuresBoard] = await Promise.all([
        getSignals('INDIA', depsForSignals()).catch(() => null),
        getSignals('CRYPTO', depsForSignals()).catch(() => null),
        getSignals('FUTURES', depsForSignals()).catch(() => null),
      ]);
      res.json({
        ok: true,
        engine: 'SUPERINTELLIGENCE ENSEMBLE v6.11',
        models: board?.models || cryptoBoard?.models || [],
        aiCouncilOnline: (board?.models || []).some(m => m.id === 'aicouncil' && m.online),
        risk,
        // v6.7: self-correcting ensemble + tamper-evident ledger status
        adaptive: adaptiveStatus(),
        ledger: ledgerStatus(),
        dhan: { connected: dhanConnected() },
        telegram: { configured: !!telegramConfig(TG || {}) },
        agent: { enabled: loadAgentConfig().enabled, mode: loadAgentConfig().mode },
        india: board ? { ok: board.ok, signals: board.signals?.length || 0, marketOpen: board.marketOpen } : null,
        crypto: cryptoBoard ? { ok: cryptoBoard.ok, signals: cryptoBoard.signals?.length || 0 } : null,
        futures: futuresBoard ? { ok: futuresBoard.ok, signals: futuresBoard.signals?.length || 0 } : null,
      });
    } catch (e) {
      jsonError(res, 500, 'ai status failed', e);
    }
  });

  // ---------------- signal board ----------------
  app.get('/api/ai/signals', async (req, res) => {
    try {
      const market = normMarket(req.query.market);
      const limit = Math.min(15, Math.max(3, parseInt(req.query.limit, 10) || 10));
      const board = await getSignals(market, depsForSignals(), { limit });
      res.json(board);
    } catch (e) {
      jsonError(res, 500, 'ai signals failed', e);
    }
  });

  // ---------------- deep single-symbol analysis ----------------
  app.get('/api/ai/deep/:symbol', async (req, res) => {
    try {
      const market = normMarket(req.query.market);
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
      const { symbol, side, mode, qtyINR, leverage } = req.body || {};
      if (!symbol) return res.status(400).json({ ok: false, error: 'symbol required' });
      const result = await executeSignal({
        symbol: String(symbol).toUpperCase(),
        side: side ? String(side).toUpperCase() : undefined,
        // v6.11: notify = alert-only gauntlet (telegram + journal audit)
        mode: mode === 'live' ? 'live' : mode === 'notify' ? 'notify' : 'paper',
        qtyINR: qtyINR != null ? Number(qtyINR) : undefined,
        // v6.6: leverage is CLAMPED server-side to config.cryptoLeverage —
        // a client payload can never widen the ceiling
        leverage: leverage != null ? Number(leverage) : undefined,
        getFreshSignal: (pair) => getFreshSignalForExec(pair, depsForSignals()),
        wantAuto: false,
        source: 'manual',
        sendTelegram, // v6.11: notify-mode alert sender
      });
      return res.status(result.ok ? 200 : 400).json(result);
    } catch (e) {
      return res.status(500).json({ ok: false, error: String(e?.message || e) });
    }
  });

  // ---------------- THE EXECUTION GAUNTLET (GLOBAL FUTURES, v6.8) ----------------
  app.post('/api/ai/futures/execute', async (req, res) => {
    try {
      const { symbol, side, mode, qtyINR, marginUSDT, leverage } = req.body || {};
      if (!symbol) return res.status(400).json({ ok: false, error: 'symbol required' });
      const result = await executeFuturesSignal({
        symbol: String(symbol).toUpperCase().replace(/^B-/, '').replace(/_USDT$/, ''),
        side: side ? String(side).toUpperCase() : undefined,
        mode: mode === 'live' ? 'live' : mode === 'notify' ? 'notify' : 'paper',
        qtyINR: qtyINR != null ? Number(qtyINR) : undefined,
        marginUSDT: marginUSDT != null ? Number(marginUSDT) : undefined,
        leverage: leverage != null ? Number(leverage) : undefined,
        getFreshSignal: (pair) => getFreshFuturesSignalForExec(pair, depsForSignals()),
        wantAuto: false,
        source: 'manual',
        sendTelegram, // v6.11: notify-mode alert sender
      });
      return res.status(result.ok ? 200 : 400).json(result);
    } catch (e) {
      return res.status(500).json({ ok: false, error: String(e?.message || e) });
    }
  });

  // ---------------- CoinDCX WALLET (spot + futures, v6.8) ----------------
  app.get('/api/ai/wallet', async (_req, res) => {
    try {
      res.json(await walletSnapshot());
    } catch (e) {
      const status = e?.status || 502;
      res.status(status).json({ ok: false, error: String(e?.message || e) });
    }
  });

  // ---------------- GLOBAL FUTURES markets view (v6.8) ----------------
  app.get('/api/ai/futures/markets', async (_req, res) => {
    try {
      const out = await futuresMarketsView();
      if (!out?.ok) return res.status(502).json(out);
      res.json(out);
    } catch (e) {
      jsonError(res, 500, 'futures markets failed', e);
    }
  });

  // ---------------- SUPERINTELLIGENCE AGENT (v6.8) ----------------
  app.get('/api/ai/agent', async (_req, res) => {
    try {
      res.json(await agentStatus(depsForSignals()));
    } catch (e) {
      jsonError(res, 500, 'agent status failed', e);
    }
  });

  app.post('/api/ai/agent/start', async (req, res) => {
    try {
      const { mode, liveConfirmPhrase } = req.body || {};
      res.json(await agentStart({ mode, liveConfirmPhrase }));
    } catch (e) {
      const status = e?.status || 400;
      res.status(status).json({ ok: false, error: String(e?.message || e) });
    }
  });

  app.post('/api/ai/agent/stop', (_req, res) => {
    try { res.json(agentStop({ reason: 'user (panel)' })); }
    catch (e) { return res.status(400).json({ ok: false, error: String(e?.message || e) }); }
  });

  app.post('/api/ai/agent/config', (req, res) => {
    try {
      // mode changes NEVER pass through this endpoint — start/stop own it
      const { mode, enabled, ...patch } = req.body || {};
      const cfg = updateAgentConfig(patch);
      res.json({ ok: true, config: cfg });
    } catch (e) {
      return res.status(400).json({ ok: false, error: String(e?.message || e) });
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
        mode: mode === 'live' ? 'live' : mode === 'notify' ? 'notify' : 'paper',
        qtyINR: qtyINR != null ? Number(qtyINR) : undefined,
        getFreshIndiaSignal: async (sym) => {
          const deep = await getDeepSignal(sym, 'INDIA', depsForSignals()).catch(() => null);
          return deep?.ok ? deep.signal : null;
        },
        source: 'manual',
        sendTelegram, // v6.11: notify-mode alert sender
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
      // v6.8: FUTURES positions close through the futures exit API.
      const j = loadJournal();
      const p = j.positions.find(x => x.id === id || x.exchangeOrderId === id);
      const out = p && p.market === 'INDIA'
        ? await closeIndiaPosition(String(id))
        : p && p.market === 'FUTURES'
          ? await closeFuturesPosition(String(id))
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

  // ---------------- backtest (v6.5 + v6.7 learned gates) ----------------
  app.get('/api/ai/backtest', async (req, res) => {
    try {
      const market = String(req.query.market || 'CRYPTO').toUpperCase();
      const symbols = String(req.query.symbols || '').split(',').map(s => s.trim()).filter(Boolean);
      const minGrade = ['STRONG', 'ACTION', 'WATCH'].includes(String(req.query.minGrade).toUpperCase())
        ? String(req.query.minGrade).toUpperCase() : 'ACTION';
      const capital = Math.min(1_000_000, Math.max(100, parseInt(req.query.capital, 10) || 1000));
      const cfg = (() => { try { return loadConfig(); } catch { return {}; } })();
      const riskCap = Number(cfg.maxRiskPct) > 0 ? cfg.maxRiskPct : 5;
      const out = await runBacktest({ market, symbols, minGrade, capitalPerTradeINR: capital, maxRiskPct: riskCap, currentMinConfidence: Number(cfg.minConfidence) > 0 ? Number(cfg.minConfidence) : 75 });
      res.json(out);
    } catch (e) {
      jsonError(res, 500, 'backtest failed', e);
    }
  });

  // ---------------- v6.7: swing desk (read-only ideas) ----------------
  app.get('/api/ai/swing', async (req, res) => {
    try {
      const market = String(req.query.market || 'INDIA').toUpperCase();
      const symbols = String(req.query.symbols || '').split(',').map(s => s.trim()).filter(Boolean);
      res.json(await getSwingBoard(market === 'CRYPTO' ? 'CRYPTO' : 'INDIA', symbols.length ? symbols : undefined));
    } catch (e) {
      jsonError(res, 500, 'swing board failed', e);
    }
  });

  // ---------------- v6.7: whale radar ----------------
  app.get('/api/ai/whales', async (req, res) => {
    try {
      const market = String(req.query.market || 'CRYPTO').toUpperCase();
      const symbols = String(req.query.symbols || '').split(',').map(s => s.trim()).filter(Boolean);
      res.json(await scanWhales(market === 'INDIA' ? 'INDIA' : 'CRYPTO', symbols.length ? symbols : undefined));
    } catch (e) {
      jsonError(res, 500, 'whale radar failed', e);
    }
  });

  // ---------------- v6.7: tamper-evident signal ledger ----------------
  app.get('/api/ai/ledger', (req, res) => {
    try {
      const limit = Math.min(50, Math.max(5, parseInt(req.query.limit, 10) || 20));
      res.json({ ...ledgerStatus(), verify: verifyLedger(), recent: recentEntries(limit) });
    } catch (e) {
      jsonError(res, 500, 'ledger failed', e);
    }
  });

  // ---------------- v6.7: CoinDCX public orderbook ----------------
  app.get('/api/ai/orderbook', async (req, res) => {
    try {
      const symbol = String(req.query.symbol || 'BTC').toUpperCase();
      const out = await getOrderbook(symbol);
      if (!out?.ok) return res.status(502).json(out);
      res.json(out);
    } catch (e) {
      jsonError(res, 500, 'orderbook failed', e);
    }
  });

  // ---------------- v6.7: morning brief (one-call desk overview) ----------------
  app.get('/api/ai/brief', async (_req, res) => {
    try {
      const [indiaBoard, cryptoBoard, whales, positions, quotes] = await Promise.all([
        getSignals('INDIA', depsForSignals(), { limit: 5 }).catch(() => null),
        getSignals('CRYPTO', depsForSignals(), { limit: 5 }).catch(() => null),
        scanWhales('CRYPTO').catch(() => null),
        getPositionsWithPnl().catch(() => ({ positions: [], entries: [] })),
        fetchYahooQuotes(['NIFTY', 'INDIAVIX', 'BTC']).catch(() => ({})),
      ]);
      const risk = getRiskState();
      const swing = await getSwingBoard('INDIA').catch(() => null);
      const top = (b) => (b?.signals || []).filter(s => s.grade === 'STRONG' || s.grade === 'ACTION').slice(0, 3)
        .map(s => ({ symbol: s.symbol, side: s.side, grade: s.grade, confidence: s.confidence, ltp: s.ltp,
          plan: s.plan ? { entry: s.plan.entry, stopLoss: s.plan.stopLoss, target2: s.plan.target2 } : null }));
      const openPositions = (positions?.positions || []).filter(p => p.status === 'OPEN' || p.status === 'UNKNOWN');
      // v6.11 (glama oneqaz next-actions): morning brief ke saath "ab kya
      // karein" — brief ke hi data se derive, no extra board fetch.
      const briefActions = [];
      if (risk?.config?.killSwitch) briefActions.push({ id: 'kill', label: 'Kill switch ON — trading band hai.', kind: 'warning' });
      briefActions.push(isNseOpen()
        ? { id: 'nse-open', label: 'NSE OPEN — intraday window live hai.', kind: 'info' }
        : { id: 'nse-closed', label: 'NSE CLOSED — swing/crypto desk dekho ya 09:15 wapas aao.', kind: 'info' });
      if (openPositions.length > 0) briefActions.push({ id: 'book', label: `${openPositions.length} open — console me SL/trailing check karo.`, kind: 'book' });
      const si = top(indiaBoard)[0], sc = top(cryptoBoard)[0];
      if (si) briefActions.push({ id: 'india-top', label: `🇮🇳 top: ${si.symbol} ${si.side} ${si.confidence}%`, kind: 'signal', market: 'INDIA', symbol: si.symbol });
      if (sc) briefActions.push({ id: 'crypto-top', label: `₿ top: ${sc.symbol} ${sc.side} ${sc.confidence}%`, kind: 'signal', market: 'CRYPTO', symbol: sc.symbol });
      res.json({
        ok: true,
        asOf: new Date().toISOString(),
        nseOpen: isNseOpen(),
        nextActions: briefActions,
        market: {
          nifty: quotes['NIFTY']?.price ?? null,
          niftyChangePct: quotes['NIFTY']?.changePct ?? null,
          indiaVix: quotes['INDIAVIX']?.price ?? null,
          btc: quotes['BTC']?.price ?? null,
          btcChangePct: quotes['BTC']?.changePct ?? null,
        },
        topSignals: { india: top(indiaBoard), crypto: top(cryptoBoard) },
        swingTop: (swing?.ideas || []).slice(0, 3).map(i => ({ symbol: i.symbol, side: i.side, grade: i.grade, score: i.score, ltp: i.ltp })),
        whales: (whales?.whales || []).slice(0, 3),
        book: {
          openPositions: openPositions.map(p => ({ market: p.market, symbol: p.symbol, side: p.side, mode: p.mode, qty: p.qty,
            uPnl: p.uPnlINR ?? p.pnlINR ?? null, sl: p.sl ?? null })),
          todayRealized: risk.stats?.realizedPnlINR ?? null,
          tradesToday: risk.stats?.tradesCount ?? 0,
          caps: {
            dailyMaxTrades: risk.config?.dailyMaxTrades, dailyMaxLossINR: risk.config?.dailyMaxLossINR,
            maxOpenPositions: risk.config?.maxOpenPositions, blocked: risk.blocked,
          },
        },
        ledger: ledgerStatus(),
        adaptive: adaptiveStatus(),
        note: 'Morning brief — one call, the whole desk. Data is cached at the source boards; nothing here is an order.',
      });
    } catch (e) {
      jsonError(res, 500, 'brief failed', e);
    }
  });

  // ---------------- v6.11: trust layer (calibration + governance) ----------------
  app.get('/api/ai/trust', (_req, res) => {
    try {
      res.json({ ok: true, calibration: trustReport(), governance: governance() });
    } catch (e) {
      jsonError(res, 500, 'trust report failed', e);
    }
  });

  // ---------------- v6.11: portfolio performance analytics ----------------
  app.get('/api/ai/perf', (_req, res) => {
    try { res.json(perfReport()); } catch (e) { jsonError(res, 500, 'perf report failed', e); }
  });

  // ---------------- v6.11: cross-asset correlation matrix ----------------
  app.get('/api/ai/correlations', async (_req, res) => {
    try { res.json(await correlationMatrix()); } catch (e) { jsonError(res, 500, 'correlations failed', e); }
  });

  // ---------------- v6.11: sector map + context chain + F-Score ----------------
  app.get('/api/ai/sectors', async (_req, res) => {
    try { res.json(await sectorDesk()); } catch (e) { jsonError(res, 500, 'sector desk failed', e); }
  });

  // ---------------- v6.11: income setup ranker (NSE indices) ----------------
  app.get('/api/ai/income', async (_req, res) => {
    try { res.json(await rankIncomeSetups()); } catch (e) { jsonError(res, 500, 'income ranker failed', e); }
  });

  // ---------------- v6.11: next-actions + followup hooks ----------------
  // Context-aware "ab kya karna chahiye" — the oneqaz conversational
  // layer: suggested actions + followup questions the UI shows as chips.
  app.get('/api/ai/next-actions', async (_req, res) => {
    try {
      const [indiaBoard, cryptoBoard, positions, risk] = await Promise.all([
        getSignals('INDIA', depsForSignals(), { limit: 5 }).catch(() => null),
        getSignals('CRYPTO', depsForSignals(), { limit: 5 }).catch(() => null),
        getPositionsWithPnl().catch(() => ({ positions: [] })),
        Promise.resolve(getRiskState()),
      ]);
      const actions = [];
      const followups = [];

      if (risk?.config?.killSwitch) {
        actions.push({ id: 'kill', label: '⚠️ Kill switch ON hai — trading band. Wapas karna ho to Risk settings me toggle karo.', kind: 'warning' });
      }
      const open = (positions?.positions || []).filter(p => p.status === 'OPEN' || p.status === 'UNKNOWN');
      const nseOpenNow = isNseOpen();
      actions.push(nseOpenNow
        ? { id: 'nse-open', label: 'NSE OPEN hai (09:15–15:30) — India intraday window live, Top-5 picks refresh ho rahe hain.', kind: 'info' }
        : { id: 'nse-closed', label: 'NSE CLOSED — India entries LIVE-blocked hain; swing setups + crypto desk dekho, ya subah 09:15 wapas aao.', kind: 'info' });
      if (open.length > 0) {
        const losing = open.filter(p => (p.uPnlINR ?? p.pnlINR ?? 0) < 0).length;
        actions.push({ id: 'book', label: `${open.length} open position${open.length > 1 ? 's' : ''} (${losing} red) — Execution Console me trailing/SL state check karo.`, kind: 'book' });
        followups.push(`${open[0]?.symbol} ka abhi SL/T2 kahan hai?`);
      }
      const strong = (b) => (b?.signals || []).find(s => s.grade === 'STRONG');
      const si = strong(indiaBoard), sc = strong(cryptoBoard);
      if (si) actions.push({ id: 'india-strong', label: `🇮🇳 STRONG: ${si.symbol} ${si.side} ${si.confidence}% — deep scan chala ke plan dekho.`, kind: 'signal', market: 'INDIA', symbol: si.symbol });
      if (sc) actions.push({ id: 'crypto-strong', label: `₿ STRONG: ${sc.symbol} ${sc.side} ${sc.confidence}% — deep scan + orderbook ek saath dekho.`, kind: 'signal', market: 'CRYPTO', symbol: sc.symbol });
      if (si || sc) followups.push((si || sc).symbol + ' par kya invalidate hoga?');

      const led = ledgerStatus();
      if (led?.open > 0) actions.push({ id: 'ledger-open', label: `Ledger me ${led.open} entries abhi settle nahi hue — positions close hone par outcome hash-chain me lock hoga.`, kind: 'ledger' });
      const tgCfg = telegramConfig(TG || {});
      if (!tgCfg) {
        actions.push({ id: 'tg-setup', label: 'Telegram configured nahi — Alerts & AI Keys me bot-token/chat-id daalo, STRONG signals + fills wahan pingen.', kind: 'setup' });
      }
      if (risk?.blocked && Object.values(risk.blocked || {}).some(Boolean)) {
        actions.push({ id: 'caps', label: 'Koi risk-cap breached hai aaj — guards panel dekho, naya entry block ho sakta hai.', kind: 'warning' });
      }
      followups.push(
        'Sector rotation me kaunsa sector strongest hai?',
        'NIFTY ka GEX / gamma-flip level kya hai?',
        'BTC aur NIFTY ka correlation abhi kya hai?',
        'Engine ki calibration kitni sahi hai?',
      );
      res.json({
        ok: true,
        asOf: Date.now(),
        nseOpen: nseOpenNow,
        actions,
        followups: followups.slice(0, 6),
        note: 'Next-actions = desk state se derive kiye gaye suggestions. Followup chips = existing panels ka shortcut. Read-only.',
      });
    } catch (e) {
      jsonError(res, 500, 'next-actions failed', e);
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
  // Crypto position watcher — SPOT SL/TP + trailing every 60s.
  const watcher = setInterval(async () => {
    try {
      const closures = await watchPositions({ sendTelegram });
      if (closures.length > 0) {
        console.log(`[ai] watcher closed ${closures.length} position(s): ${closures.map(c => `${c.pair} ${c.pnlINR}`).join(', ')}`);
      }
    } catch { /* non-fatal */ }
  }, 60_000);
  if (watcher.unref) watcher.unref();

  // v6.8: GLOBAL FUTURES watcher — SL/TP/trailing/liquidation + exchange
  // reconcile (native TP/SL closes) + paper simulation, every 60s.
  const futuresWatcher = setInterval(async () => {
    try {
      const closures = await watchFuturesPositions({ sendTelegram });
      if (closures.length > 0) {
        console.log(`[ai] futures watcher closed ${closures.length} position(s): ${closures.map(c => `${c.pair} ${c.pnlINR}`).join(', ')}`);
      }
    } catch { /* non-fatal */ }
  }, 60_000);
  if (futuresWatcher.unref) futuresWatcher.unref();

  // v6.8: SUPERINTELLIGENCE AGENT loop — wallet scan → auto entry/exit,
  // 3 trades/day, every 60s. Every entry passes the same gauntlet.
  const agentLoop = setInterval(async () => {
    try {
      await agentTick(depsForSignals(), sendTelegram);
    } catch { /* non-fatal — agent logs its own errors */ }
  }, 60_000);
  if (agentLoop.unref) agentLoop.unref();

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

  console.log('[ai] Superintelligence Ensemble v6.10 — DUAL DESKS + 3-TAB UX UPGRADE (India | CoinDCX) · topFive ranking ·  10 models · SMC/ICT · GEX desk · swing · whales · ledger · adaptive weights · trailing SL · backtests · Telegram · Dhan + CoinDCX gauntlets · crypto leverage · GLOBAL FUTURES (USDT perps) · SUPERINTELLIGENCE AUTO-AGENT (3 trades/day, wallet-sized)');
}
