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
//   GET  /api/ai/positions/stream        SSE: realtime LTP/PnL diff-push (v10.5.3)
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
import { getSignals, getDeepSignal, getFreshSignalForExec, getFreshFuturesSignalForExec, getFreshGlobalSignalForExec, buildRegime } from './signals.js';
// v2 signal-accuracy upgrade (sentiment / instflow / fundamentals desks)
import { v2ModelsEnabled } from './models.js';
import { sentimentStatus } from './sentiment.js';
import { instFlowStatus } from './instFlow.js';
import { fundamentalsStatus } from './fundamentals.js';
// v10.1 crypto desk AI chatbot (mirror of the intraday ProTrader agent)
import { runCryptoAgent } from './cryptoAgent.js';
import { getExpertPicks } from './expertPicks.js';
import { getOptionsDesk, buildStrategies, getOptionSignalsView } from './optionsDesk.js';
import {
  loadConfig, updateConfig, getRiskState, executeSignal, getPositionsWithPnl,
  closePosition, listExchangeOrders, cancelExchangeOrder, cancelAllExchangeOrders,
  watchPositions, loadJournal, dailyStats, clearClosedPositions,
} from './coindcxOrders.js';
import {
  executeFuturesSignal, watchFuturesPositions, closeFuturesPosition,
  walletSnapshot, futuresMarketsView, fetchUsdInr,
} from './futures.js';
import {
  executeGlobalSignal, watchGlobalPositions, closeGlobalPosition,
  globalFuturesMarketsView,
} from './globalFutures.js';
// v10.5.3 REALTIME POSITIONS — SSE diff-push of open-position LTP/PnL
// (replaces the 5s REST poll the console used to call "ULTRA STREAM").
import { positionsStreamHandler } from './positionsStream.js';
import {
  agentTick, agentStatus, agentStart, agentStop, updateAgentConfig, loadAgentConfig, AGENT_TICK_SEC,
} from './agent.js';
import { executeIndiaSignal, watchIndiaPositions, closeIndiaPosition } from './indiaOrders.js';
// v10.3: NSE SUPERINTELLIGENCE AUTO-AGENT — the India twin of agent.js
import {
  indiaAgentTick, indiaAgentStatus, indiaAgentStart, indiaAgentStop,
  updateIndiaAgentConfig, INDIA_AGENT_TICK_SEC,
} from './indiaAgent.js';
import { runBacktest } from './backtest.js';
// v10.8 PRO #2: NL Custom Strategy Lab — description → bounded rules → replay
import { runCustomStrategyBacktest } from './strategyLab.js';
// v10.9 INSTANT TELEGRAM PUSH — the price-driven sink (SL/TP touches +
// STRONG signals) + the shared dedupe the 60s backup alerter reuses.
import {
  startInstaPushSink, scanStrongSignalsBackup, instaPushStatus, instantPushEnabled,
} from './telegramPush.js';
// v10.9 WEEKLY REVIEW — journal + calibration → one LLM narration
import { runWeeklyPerformanceReview, weeklyReviewStatus, scheduleWeeklyReviewPush } from './weeklyReview.js';
// v10.16 SECTION 2: MANUAL TRADE TRACKER — user's own trades get the
// same live tracking + conviction intelligence the desk gives its own.
import {
  recordManualTrade, listManualTrades, getManualTrade, closeManualTrade,
  ltpForManualTrade, manualTradeView, manualConvictionOf,
  startManualTradeMonitor, manualMonitorStatus, flushManualState,
} from './manualTrades.js';
import { getSwingBoard, scanWhales, getOrderbook } from './swing.js';
import { readDepth, depthStatus } from './orderFlowDepth.js';
import { wickFilterStatus } from './wickFilter.js';
import { ledgerStatus, recentEntries, verifyLedger } from './ledger.js';
import { adaptiveStatus } from './adaptive.js';
import { regimeReweightView } from './ensemble.js';
import { trustReport, governance, modelPerformanceWindows, councilCalibration } from './trust.js';
import { perfReport } from './perf.js';
import { correlationMatrix, pairCorrelation } from './correlation.js';
// v10.15 GAP 2: Event Guard — the board attaches the next scheduled
// event per signal (the signal-card ⚠ chip a manual trader sees).
import { eventGuardStatus } from './eventGuard.js';
// v11.0 GLOBAL MARKET COUNCIL — status/deep-verdict/near-miss routes.
import { councilStatus, runCouncilDeep, councilStampOf } from './council.js';
import { nearMissList, nearMissStats } from './consensus.js';
import { sectorDesk } from './sectors.js';
import { rankIncomeSetups } from './optionsDesk.js';
// v10.17 OPTIONS SCANNER — multi-underlying chain scan (indices + top
// F&O stocks), deterministic direction reads + GEX zones, one ranked view.
import { scanOptionsUniverse } from './optionsScan.js';
import {
  secretsStatus, setSecret, getSecrets, telegramConfig, sendTelegramMessage,
} from './secrets.js';
import { dhanConnect, dhanDisconnect, dhanConnected, dhanProfile, scripMasterStatus } from './dhan.js';
import { isNseOpen, fetchYahooQuotes, fetchTVIndiaBatch } from './data.js';

// ------------------------------------------------------------
// v10.9 CONTROLLED TRADE APPROVAL — the Telegram webhook's SINGLE
// execution path. Wired at registration to the EXACT same
// executeSignal gauntlet POST /api/ai/execute runs (fresh-signal
// re-verification, kill switch, risk caps, mandate freeze). The
// approval button only ADDS a manual trigger — it bypasses none
// of the safety layers.
// ------------------------------------------------------------
let _approvedExec = null;
export async function runApprovedExecution(opts = {}) {
  if (!_approvedExec) throw new Error('AI trading routes not registered yet');
  return _approvedExec(opts);
}

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
    return m === 'CRYPTO' ? 'CRYPTO' : m === 'FUTURES' ? 'FUTURES' : m === 'GLOBALFUTURES' ? 'GLOBALFUTURES' : 'INDIA';
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
        engine: 'SUPERINTELLIGENCE ENSEMBLE v6.13 · ORDER TICKET + SIMPLE VIEW',
        models: board?.models || cryptoBoard?.models || [],
        aiCouncilOnline: (board?.models || []).some(m => m.id === 'aicouncil' && m.online),
        risk,
        // v2 signal-accuracy upgrade — 3 new models behind AI_ENABLE_V2_MODELS
        v2Models: {
          enabled: v2ModelsEnabled(),
          flag: 'AI_ENABLE_V2_MODELS',
          newModels: ['sentiment (SentimentPulse)', 'instflow (InstFlow)', 'fundamentals (FundaCheck)'],
          sentiment: sentimentStatus(),
          instFlow: instFlowStatus(),
          fundamentals: fundamentalsStatus(),
        },
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

  // ---------------- v8.0 EXPERT PICKS (Advance Pro Trader Engine) ----
  // Whole-universe scan (all liquid CoinDCX spot INR pairs / B-USDT
  // perpetuals / NSE names) → composite 0-100 expert score → only
  // 80+ STRONG picks (default) with a full trade blueprint: entry
  // zone, SL, T1/T2/T3, leverage ladder, staged exit plan, timing
  // window, invalidation.
  app.get('/api/ai/expert-picks', async (req, res) => {
    try {
      const market = normMarket(req.query.market);
      const minScore = Math.min(99, Math.max(1, parseInt(req.query.minScore, 10) || 80));
      const limit = Math.min(15, Math.max(1, parseInt(req.query.limit, 10) || 12));
      const picks = await getExpertPicks(market, { minScore, limit });
      res.set('Cache-Control', 'no-store');
      res.json(picks);
    } catch (e) {
      jsonError(res, 500, 'expert picks failed', e);
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
  // v9.4: combined NIFTY + SENSEX option SIGNAL CARDS (one request,
  // 30s cached) — the "Nifty50 17Sep 23400 CE · Target · Entry (Buy)
  // · Stop Loss" strip on the Options Desk.
  app.get('/api/ai/option-signals', async (_req, res) => {
    try {
      const view = await getOptionSignalsView(depsForSignals());
      res.json(view);
    } catch (e) {
      jsonError(res, 500, 'option signals failed', e);
    }
  });

  // ---------------- v10.17: OPTIONS SCANNER ----------------
  // Whole-F&O chain scan in one view: 3 indices + top stock-option
  // underlyings (from the full-universe discovery), each with a
  // deterministic direction read, GEX pin/flip zone and expected-move
  // band, ranked by the transparent scan score. 90s cached.
  app.get('/api/ai/options-scan', async (req, res) => {
    try {
      const force = req.query.fresh === '1';
      res.set('Cache-Control', 'no-store');
      res.json(await scanOptionsUniverse({ force }));
    } catch (e) {
      jsonError(res, 500, 'options scan failed', e);
    }
  });

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

  // ---------------- GLOBAL EQUITY FUTURES desk (v10.4 — AAPL/GOOGL/NVDA/…/SPACEX SIM) ----------------
  app.post('/api/ai/global/execute', async (req, res) => {
    try {
      const { symbol, side, mode, qtyINR, marginUSDT, leverage } = req.body || {};
      if (!symbol) return res.status(400).json({ ok: false, error: 'symbol required' });
      const result = await executeGlobalSignal({
        symbol: String(symbol).toUpperCase().replace(/-USD$/, ''),
        side: side ? String(side).toUpperCase() : undefined,
        mode: mode === 'live' ? 'live' : mode === 'notify' ? 'notify' : 'paper', // 'live' passes through — gate 0 rejects it honestly (SIM desk)
        qtyINR: qtyINR != null ? Number(qtyINR) : undefined,
        marginUSDT: marginUSDT != null ? Number(marginUSDT) : undefined,
        leverage: leverage != null ? Number(leverage) : undefined,
        getFreshSignal: (pair) => getFreshGlobalSignalForExec(pair, depsForSignals()),
        wantAuto: false,
        source: 'manual',
        sendTelegram,
      });
      return res.status(result.ok ? 200 : 400).json(result);
    } catch (e) {
      return res.status(500).json({ ok: false, error: String(e?.message || e) });
    }
  });

  app.get('/api/ai/global/markets', async (_req, res) => {
    try {
      const out = await globalFuturesMarketsView();
      if (!out?.ok) return res.status(502).json(out);
      res.json(out);
    } catch (e) {
      jsonError(res, 500, 'global futures markets failed', e);
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

  // ---------------- NSE SUPERINTELLIGENCE AGENT (v10.3) ----------------
  // The India desk's autonomous agent — same contract as /api/ai/agent/*
  // but scoped to market INDIA + source 'india-agent' (cross-agent
  // hygiene: the crypto agent's accounting can never see these trades).
  app.get('/api/india/agent', async (_req, res) => {
    try {
      res.json(await indiaAgentStatus(depsForSignals()));
    } catch (e) {
      jsonError(res, 500, 'india agent status failed', e);
    }
  });

  app.post('/api/india/agent/start', async (req, res) => {
    try {
      const { mode, liveConfirmPhrase } = req.body || {};
      res.json(await indiaAgentStart({ mode, liveConfirmPhrase }));
    } catch (e) {
      const status = e?.status || 400;
      res.status(status).json({ ok: false, error: String(e?.message || e) });
    }
  });

  app.post('/api/india/agent/stop', (_req, res) => {
    try { res.json(indiaAgentStop({ reason: 'user (panel)' })); }
    catch (e) { return res.status(400).json({ ok: false, error: String(e?.message || e) }); }
  });

  app.post('/api/india/agent/config', (req, res) => {
    try {
      // mode changes NEVER pass through this endpoint — start/stop own it
      const { mode, enabled, ...patch } = req.body || {};
      const cfg = updateIndiaAgentConfig(patch);
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

  // ---------------- v10.16 SECTION 2: MANUAL TRADE TRACKER ----------------
  // The user's OWN trades — recorded off any signal card with the full
  // originating snapshot frozen at entry, tracked live (5s LTP · 30s
  // conviction re-vote via the monitor), closable here or via Telegram
  // /manualclose. Instrument coverage: India equity + F&O options +
  // crypto spot/perps + global SIM.
  app.post('/api/manual-trade', async (req, res) => {
    try {
      const b = req.body || {};
      const out = recordManualTrade(b);
      if (!out.ok) return res.status(400).json(out);
      // confirmation push (best-effort) — the baseline is now frozen
      sendTelegram(`📝 <b>MANUAL TRADE recorded</b>\n<b>${out.trade.symbol}</b> ${out.trade.side === 'BUY' ? 'LONG' : 'SHORT'} @ ${out.trade.entryPrice} · qty ${out.trade.qty}${out.trade.assetKind === 'OPTION' ? ` (${out.trade.optType} ${out.trade.strike} exp ${out.trade.expiry})` : ''}\n${out.trade.origin?.aiScore != null ? `Entry AI score: ${out.trade.origin.aiScore} · conviction tracking ON` : 'Conviction tracking ON'}\n<i>Flip ho gaya to EXIT NOW push aa jayega — WHY ke saath.</i>`).catch(() => {});
      return res.json(out);
    } catch (e) {
      return res.status(500).json({ ok: false, error: String(e?.message || e) });
    }
  });

  app.get('/api/manual-trades', async (req, res) => {
    try {
      const trades = listManualTrades(req.query.status ? { status: String(req.query.status).toUpperCase() } : {});
      const open = trades.filter(t => t.status === 'OPEN');
      // LTP sweep for the OPEN rows (tick store first — free; TV batch
      // for India fallback, BS re-price for options). One batched call,
      // not per-trade.
      let indiaQuotes = null;
      const indiaSyms = open.filter(t => t.market === 'INDIA' && t.assetKind !== 'OPTION').map(t => t.symbol);
      if (indiaSyms.length > 0) {
        indiaQuotes = await fetchTVIndiaBatch([...new Set(indiaSyms)]).catch(() => null);
      }
      const fetchIndiaQuotes = indiaQuotes ? async () => indiaQuotes : null;
      const fetchIndexSpot = async (sym) => {
        const q = await fetchYahooQuotes([sym]).catch(() => ({}));
        return q?.[sym] || null;
      };
      let usdInr = 84;
      try { usdInr = (await fetchUsdInr()) || 84; } catch { /* default */ }
      const views = [];
      for (const t of trades) {
        if (t.status !== 'OPEN') { views.push(t); continue; }
        const ltp = await ltpForManualTrade(t, { fetchIndiaQuotes, fetchIndexSpot });
        // conviction: the monitor's fresh re-vote if present; on-demand
        // (cached deep path) when stale — the UI never shows a dead bar.
        let conviction = (Date.now() - (t.__conviction?.at || 0) < 90_000) ? t.__conviction : null;
        if (!conviction) {
          try {
            const deep = await getDeepSignal(t.symbol, t.market === 'GLOBALFUTURES' ? 'GLOBALFUTURES' : t.market, depsForSignals());
            if (deep?.ok && deep.signal) {
              const c = manualConvictionOf(t, deep.signal);
              conviction = { ...c, side: String(deep.signal.side || '').toUpperCase(), at: Date.now() };
              t.__conviction = conviction;
            }
          } catch { /* honest null — banner falls back to STALE */ }
        }
        views.push(manualTradeView(t, { ltp, usdInr, conviction }));
      }
      return res.json({
        ok: true,
        trades: views,
        monitor: manualMonitorStatus(),
        counts: {
          open: open.length,
          closed: trades.filter(t => t.status === 'CLOSED').length,
          exitNow: views.filter(v => v.__view?.banner === 'EXIT_NOW').length,
        },
      });
    } catch (e) {
      return jsonError(res, 500, 'manual-trades failed', e);
    }
  });

  app.post('/api/manual-trade/:id/close', async (req, res) => {
    try {
      const out = closeManualTrade(req.params.id, {
        exitPrice: req.body?.exitPrice != null ? Number(req.body.exitPrice) : undefined,
        reason: req.body?.reason,
      });
      if (!out.ok) return res.status(400).json(out);
      sendTelegram(`✅ <b>MANUAL TRADE closed</b>\n<b>${out.trade.symbol}</b> ${out.trade.side === 'BUY' ? 'LONG' : 'SHORT'} @ ${out.trade.entryPrice} → ${out.trade.exitPrice}\nP&L: ${out.pnl.pnlPct >= 0 ? '+' : ''}${out.pnl.pnlPct}% (${out.pnl.currency === 'USDT' ? '$' + out.pnl.pnlUSDT : '₹' + out.pnl.pnlINR}) · reason: ${out.trade.closeReason}`).catch(() => {});
      return res.json(out);
    } catch (e) {
      return res.status(500).json({ ok: false, error: String(e?.message || e) });
    }
  });

  // ---------------- positions / journal ----------------
  app.get('/api/ai/positions', async (_req, res) => {
    try { res.json({ ok: true, ...(await getPositionsWithPnl()) }); }
    catch (e) { jsonError(res, 500, 'positions failed', e); }
  });

  // v10.5.3 REALTIME POSITIONS SSE — same auth as every /api/ai/* route
  // (EventSource appends ?session= per requireAuth). Push protocol:
  // `positions` (full snapshot on connect + structural changes) and
  // `tick` (per-position LTP/PnL deltas, price-driven). The REST GET
  // above stays as the fallback + reconciliation path.
  app.get('/api/ai/positions/stream', positionsStreamHandler);

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
          : p && p.market === 'GLOBALFUTURES'
            ? await closeGlobalPosition(String(id)) // v10.4 SIM desk — live quote se close
            : await closePosition(String(id));
      return res.status(out.ok ? 200 : 400).json(out);
    } catch (e) {
      return res.status(500).json({ ok: false, error: String(e?.message || e) });
    }
  });

  // v10.17 — CLEAR CLOSED POSITIONS (the console's 🧹 CLEAR CLOSED
  // button). Purges CLOSED rows from the journal (ledger keeps the
  // permanent audit trail; a HOUSEKEEP entry stamps the sweep). Only
  // CLOSED rows are removed — OPEN/UNKNOWN untouched, no-live-effects.
  app.post('/api/ai/positions/clear-closed', async (_req, res) => {
    try {
      const out = await clearClosedPositions();
      return res.json(out);
    } catch (e) {
      return jsonError(res, 500, 'clear-closed failed', e);
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
      // v10.13 (deep-recheck L-3): cap + validate the client symbol list — a
      // 500-symbol comma list drove a 500-symbol backtest per request (same
      // treatment strategy-lab already had: cap 6, 12 chars, charset filter).
      const symbols = String(req.query.symbols || '').split(',').map(s => s.trim().toUpperCase())
        .filter(Boolean).filter(s => /^[A-Z0-9._-]{1,20}$/.test(s)).slice(0, 12);
      const minGrade = ['STRONG', 'ACTION', 'WATCH'].includes(String(req.query.minGrade).toUpperCase())
        ? String(req.query.minGrade).toUpperCase() : 'ACTION';
      const capital = Math.min(1_000_000, Math.max(100, parseInt(req.query.capital, 10) || 1000));
      // v10.6 (Pro Upgrade #4): strategy=regime_weighted → the SAME replay
      // with the regime multiplier layer forced on + a side-by-side plain
      // leg per symbol (identical folds) — the A/B that decides whether
      // AI_ENABLE_REGIME_WEIGHTS goes live.
      const strategy = String(req.query.strategy || '').toLowerCase() === 'regime_weighted' ? 'regime_weighted' : 'weighted';
      const cfg = (() => { try { return loadConfig(); } catch { return {}; } })();
      const riskCap = Number(cfg.maxRiskPct) > 0 ? cfg.maxRiskPct : 5;
      const out = await runBacktest({ market, symbols, minGrade, capitalPerTradeINR: capital, maxRiskPct: riskCap, currentMinConfidence: Number(cfg.minConfidence) > 0 ? Number(cfg.minConfidence) : 75, strategy });
      res.json(out);
    } catch (e) {
      jsonError(res, 500, 'backtest failed', e);
    }
  });

  // ---------------- v10.8: NL Custom Strategy Lab (Pro Upgrade #2) ----------------
  // Natural-language strategy idea → LLM compiles a BOUNDED whitelist
  // rule-expression (never free-form code) → validated → walk-forward
  // replay on the SAME candle history the ensemble backtest uses.
  app.post('/api/ai/strategy-lab', async (req, res) => {
    try {
      const { description, market, symbols, capital } = req.body || {};
      if (!description || String(description).trim().length < 8) {
        return jsonError(res, 400, 'description required (min 8 chars — describe the entry/exit idea)');
      }
      const mkt = String(market || 'CRYPTO').toUpperCase() === 'INDIA' ? 'INDIA' : 'CRYPTO';
      const syms = Array.isArray(symbols) ? symbols.slice(0, 6).map(s => String(s).slice(0, 12)) : undefined;
      const cap = Math.min(1_000_000, Math.max(100, parseInt(capital, 10) || 1000));
      const out = await runCustomStrategyBacktest({
        description: String(description).slice(0, 800),
        market: mkt,
        symbols: syms,
        capitalPerTradeINR: cap,
        deps: depsForSignals(),
      });
      if (!out?.ok && out?.stage === 'compile') return jsonError(res, 422, out.error);
      res.set('Cache-Control', 'no-store');
      res.json(out);
    } catch (e) {
      jsonError(res, 500, 'strategy lab failed', e);
    }
  });

  // ---------------- v6.7: swing desk (read-only ideas) ----------------
  app.get('/api/ai/swing', async (req, res) => {
    try {
      const market = String(req.query.market || 'INDIA').toUpperCase();
      // v10.13 (L-3): same cap/validate treatment as backtest.
      const symbols = String(req.query.symbols || '').split(',').map(s => s.trim().toUpperCase())
        .filter(Boolean).filter(s => /^[A-Z0-9._-]{1,20}$/.test(s)).slice(0, 12);
      res.json(await getSwingBoard(market === 'CRYPTO' ? 'CRYPTO' : 'INDIA', symbols.length ? symbols : undefined));
    } catch (e) {
      jsonError(res, 500, 'swing board failed', e);
    }
  });

  // ---------------- v6.7: whale radar ----------------
  app.get('/api/ai/whales', async (req, res) => {
    try {
      const market = String(req.query.market || 'CRYPTO').toUpperCase();
      // v10.13 (L-3): same cap/validate treatment as backtest.
      const symbols = String(req.query.symbols || '').split(',').map(s => s.trim().toUpperCase())
        .filter(Boolean).filter(s => /^[A-Z0-9._-]{1,20}$/.test(s)).slice(0, 12);
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

  // ---------------- v10.1: crypto desk AI agent (chat) ----------------
  // The CoinDCX tab's conversational agent — same pattern as
  // POST /api/intraday-agent (messages[] in, tool-calling ReAct loop,
  // Gemini→Groq→Cerebras chain). Auth required (AI cost).
  app.post('/api/crypto-agent', async (req, res) => {
    try {
      const { messages = [] } = req.body || {};
      if (!Array.isArray(messages) || messages.length === 0) {
        return jsonError(res, 400, 'messages[] required');
      }
      // Bound token cost: last 24 turns, 6k chars per message (same
      // contract as the intraday agent route).
      const trimmed = messages.slice(-24).map(m => ({
        role: ['user', 'assistant', 'system'].includes(m?.role) ? m.role : 'user',
        content: String(m?.content || '').slice(0, 6000),
      }));
      const result = await runCryptoAgent(trimmed, depsForSignals());
      if (!result.ok) return jsonError(res, 502, result.error);
      res.set('Cache-Control', 'no-store');
      res.json(result);
    } catch (e) {
      jsonError(res, 500, 'crypto agent failed', e);
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

  // ---------------- v10.6: L2 depth ladder (order-flow reader) ----------------
  // Pro Upgrade #1 — the depth-ladder mini-widget's feed: top-5 ladder
  // + two-band imbalance + walls + spoof velocity. 2s server cache
  // (positionsStream fast tier) so N viewers share ONE upstream call.
  app.get('/api/ai/depth', async (req, res) => {
    try {
      const market = ['CRYPTO', 'FUTURES', 'INDIA'].includes(String(req.query.market || '').toUpperCase())
        ? String(req.query.market).toUpperCase() : 'CRYPTO';
      const symbol = String(req.query.symbol || 'BTC').toUpperCase().slice(0, 12);
      const ltpNum = Number(req.query.ltp);
      const out = await readDepth(market, symbol, { ltp: Number.isFinite(ltpNum) && ltpNum > 0 ? ltpNum : null });
      res.set('Cache-Control', 'no-store');
      res.json(out);
    } catch (e) {
      jsonError(res, 500, 'depth failed', e);
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
  app.get('/api/ai/trust', async (_req, res) => {
    try {
      // v10.6 (Pro Upgrades #4/#5): the walk-forward dashboard's data —
      // per-model 30/90d windows + the live regime reweight state.
      const [regimeIndia, regimeCrypto] = await Promise.all([
        buildRegime('INDIA').catch(() => null),
        buildRegime('CRYPTO').catch(() => null),
      ]);
      res.json({
        ok: true,
        calibration: trustReport(),
        governance: governance(),
        windows: modelPerformanceWindows(),
        regimeReweight: {
          INDIA: regimeReweightView(regimeIndia, 'INDIA'),
          CRYPTO: regimeReweightView(regimeCrypto, 'CRYPTO'),
        },
      });
    } catch (e) {
      jsonError(res, 500, 'trust report failed', e);
    }
  });

  // ---------------- v10.6: order-flow + price-validation status ----------------
  app.get('/api/ai/orderflow-status', (_req, res) => {
    try {
      res.json({ ok: true, depth: depthStatus(), wickFilter: wickFilterStatus() });
    } catch (e) {
      jsonError(res, 500, 'orderflow status failed', e);
    }
  });

  // ---------------- v10.15 GAP 2: scheduled-event guard status ----------------
  // The upcoming-events view (FOMC/RBI/CPI/IIP/earnings + the graded
  // blackout/haircut tunables) — the panels' event strip + the bot's
  // future /events command read this. Pure snapshot, no side effects.
  app.get('/api/ai/event-guard', (req, res) => {
    try {
      const desk = typeof req.query.desk === 'string' ? req.query.desk : undefined;
      res.json(eventGuardStatus({ desk }));
    } catch (e) {
      jsonError(res, 500, 'event guard status failed', e);
    }
  });

  // ---------------- v11.0: GLOBAL MARKET COUNCIL ----------------
  //  GET /api/ai/council/status           flag + seats + gate + cache
  //  GET /api/ai/council/near-miss        suppressed verdicts (learning)
  //  GET /api/ai/council/calibration      per-agent track records + weights
  //  GET /api/ai/council/verdict/:symbol  DEEP verdict (6 seats + debate
  //                                      + judge, 90s-cached; user-initiated)
  app.get('/api/ai/council/status', (_req, res) => {
    try {
      res.json({ ...councilStatus(), nearMiss: nearMissStats() });
    } catch (e) {
      jsonError(res, 500, 'council status failed', e);
    }
  });

  app.get('/api/ai/council/near-miss', (req, res) => {
    try {
      const limit = Math.min(60, Math.max(5, parseInt(req.query.limit, 10) || 25));
      res.json({ ok: true, entries: nearMissList(limit), stats: nearMissStats() });
    } catch (e) {
      jsonError(res, 500, 'council near-miss failed', e);
    }
  });

  app.get('/api/ai/council/calibration', (_req, res) => {
    try { res.json(councilCalibration()); } catch (e) { jsonError(res, 500, 'council calibration failed', e); }
  });

  app.get('/api/ai/council/verdict/:symbol', async (req, res) => {
    try {
      const symbol = String(req.params.symbol || '').toUpperCase().slice(0, 16);
      const market = normMarket(req.query.market);
      const force = req.query.fresh === '1' || req.query.fresh === 'true';
      if (!symbol) return jsonError(res, 400, 'symbol required');
      // v11.0.1: route-level 25s deadline — the deep path chains a fresh
      // single-symbol ensemble run + 6 personas + debate + judge, and a
      // slow provider chain used to hang the HTTP handler for minutes.
      // On timeout the verdict KEEPS warming in the 90s council cache
      // (single-flight — a retry joins the in-flight run, never
      // double-spends), so the honest 503 says "try again", not "lost".
      // runCouncilDeep returns null when there is no signal context →
      // the honest 502 (never a verdict built on an empty matrix).
      const out = await Promise.race([
        (async () => {
          // the deep council rides a FRESH single-symbol ensemble run so the
          // feature matrix is honest (getDeepSignal is 30s-cached itself)
          const deep = await getDeepSignal(symbol, market, depsForSignals()).catch(() => null);
          const verdict = await runCouncilDeep({
            market, symbol, sig: deep?.signal || null,
            regime: await buildRegime(market).catch(() => ({})),
            deps: depsForSignals(), force,
          });
          return verdict;
        })(),
        new Promise((resolve) => { const t = setTimeout(() => resolve('timeout'), 25_000); t.unref?.(); }),
      ]);
      if (out === 'timeout') {
        return jsonError(res, 503, 'council verdict still computing — retry in a few seconds (result caches for 90s)');
      }
      if (!out) return jsonError(res, 502, 'council verdict unavailable (no signal context)');
      return res.json({
        ok: true,
        stamp: councilStampOf(out),
        verdict: out,
      });
    } catch (e) {
      jsonError(res, 500, 'council verdict failed', e);
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

  // ---------------- v10.9: instant-push pipeline status ----------------
  // The legacy bot's 10-min backup cron consults this — healthy pipeline
  // means the cron stays silent.
  app.get('/api/ai/insta-push/status', (_req, res) => {
    try { res.json(instaPushStatus()); } catch (e) { jsonError(res, 500, 'insta-push status failed', e); }
  });

  // v10.9: the approval flow's execution path — same gauntlet as
  // POST /api/ai/execute, source-tagged for the journal audit.
  _approvedExec = async ({ symbol, side, mode, qtyINR, leverage } = {}) => executeSignal({
    symbol: String(symbol || '').toUpperCase(),
    side: side ? String(side).toUpperCase() : undefined,
    mode: mode === 'live' ? 'live' : mode === 'notify' ? 'notify' : 'paper',
    qtyINR: qtyINR != null ? Number(qtyINR) : undefined,
    leverage: leverage != null ? Number(leverage) : undefined,
    getFreshSignal: (pair) => getFreshSignalForExec(pair, depsForSignals()),
    wantAuto: false,
    source: 'telegram-approval',
    sendTelegram,
  });

  // ---------------- v10.9: pair correlation (alert bundling) ----------------
  // The price-alert watcher calls this to decide whether two alerts that
  // fired in the same 20s window are really ONE correlated move (BTC + ETH
  // breaking out together = one notification, not two).
  app.get('/api/ai/pair-correlation', async (req, res) => {
    try {
      const a = String(req.query.a || '').toUpperCase().slice(0, 12);
      const b = String(req.query.b || '').toUpperCase().slice(0, 12);
      if (!/^[A-Z0-9]{1,12}$/.test(a) || !/^[A-Z0-9]{1,12}$/.test(b) || a === b) {
        return res.status(400).json({ ok: false, error: 'a and b required (distinct symbols)' });
      }
      const r = await pairCorrelation(a, b);
      res.json({ ok: true, a, b, r, note: '60d daily-return Pearson. null = data unavailable (never a fake 0).' });
    } catch (e) { jsonError(res, 500, 'pair correlation failed', e); }
  });

  // ---------------- v10.9: weekly trade-performance review ----------------
  // /weeklyreview — journal + calibration → quant numbers → one LLM
  // narration. Same compute the Sunday auto-push uses.
  app.post('/api/ai/weekly-review', async (_req, res) => {
    try {
      const out = await runWeeklyPerformanceReview({ KEYS: effectiveKeys(), OPENAI_COMPAT });
      if (!out.ok) return res.status(400).json(out);
      res.set('Cache-Control', 'no-store');
      res.json(out);
    } catch (e) { jsonError(res, 500, 'weekly review failed', e); }
  });
  app.get('/api/ai/weekly-review/status', (_req, res) => {
    try { res.json(weeklyReviewStatus()); } catch (e) { jsonError(res, 500, 'weekly review status failed', e); }
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

  // v10.4: GLOBAL EQUITY FUTURES watcher — SL/TP/trailing/partial-TP/
  // liquidation sweep on the Yahoo-quote (or SIM) price, every 60s.
  const globalWatcher = setInterval(async () => {
    try {
      const out = await watchGlobalPositions({ sendTelegram });
      const closures = out?.closures || out || [];
      if (Array.isArray(closures) && closures.length > 0) {
        console.log(`[ai] global-futures watcher closed ${closures.length} position(s): ${closures.map(c => `${c.pair} ${c.pnlINR}`).join(', ')}`);
      }
    } catch { /* non-fatal */ }
  }, 60_000);
  if (globalWatcher.unref) globalWatcher.unref();

  // v6.8: SUPERINTELLIGENCE AGENT loop — wallet scan → auto entry/exit,
  // 3 trades/day. v9.7: 30s cadence (faster trend-flip reaction; the
  // wallet fetch inside the tick is throttled to ~60s). Every entry
  // still passes the same gauntlet.
  const agentLoop = setInterval(async () => {
    try {
      await agentTick(depsForSignals(), sendTelegram);
    } catch { /* non-fatal — agent logs its own errors */ }
  }, AGENT_TICK_SEC * 1000);
  if (agentLoop.unref) agentLoop.unref();

  // v10.3: NSE SUPERINTELLIGENCE AGENT loop — the India twin. Same 30s
  // cadence; the tick itself gates on the NSE clock (09:30–15:00
  // entries, 15:15 EOD square-off sweep, idle outside market hours),
  // so after-hours ticks are cheap no-ops. Every entry passes the SAME
  // executeIndiaSignal gauntlet a manual click passes.
  const indiaAgentLoop = setInterval(async () => {
    try {
      await indiaAgentTick(depsForSignals(), sendTelegram);
    } catch { /* non-fatal — agent logs its own errors */ }
  }, INDIA_AGENT_TICK_SEC * 1000);
  if (indiaAgentLoop.unref) indiaAgentLoop.unref();

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
  // v10.9: DEMOTED to backup — the instant-push sink (telegramPush.js)
  // scans the same boards every ~30s through the SAME dedupe map, so
  // whichever path sees the signal first wins and this loop no-ops.
  // Flag off → the sink is not running and this loop IS the cadence
  // (exactly the pre-v10.9 behaviour, 60s).
  const alerter = setInterval(async () => {
    try {
      await scanStrongSignalsBackup({ getSignals, depsForSignals });
    } catch { /* non-fatal */ }
  }, 60_000);
  if (alerter.unref) alerter.unref();

  // v10.9: the instant-push sink — 5s SL/TP level touches + 30s STRONG
  // scan, one shared dedupe with the backup alerter above.
  startInstaPushSink({ getSignals, depsForSignals });

  // v10.16 SECTION 2: the MANUAL TRADE monitor — 5s LTP sweep + 30s
  // conviction re-vote (cached deep path) + telegram pushes on flip /
  // SL-approach / target-hits / stagnant check-ins. Parks at 60s idle
  // when no manual trades are open (free).
  startManualTradeMonitor({
    getDeepSignal,
    depsForSignals,
    send: sendTelegram,
    fetchIndiaQuotes: async (syms) => fetchTVIndiaBatch(syms),
    fetchIndexSpot: async (sym) => {
      const q = await fetchYahooQuotes([sym]).catch(() => ({}));
      return q?.[sym] || null;
    },
    usdInrOf: async () => { try { return (await fetchUsdInr()) || 84; } catch { return 84; } },
  });

  // v10.9: weekly trade-performance digest — Sunday 19:00 IST Telegram
  // push (AI_WEEKLY_REVIEW_PUSH=off). /weeklyreview runs it on demand.
  scheduleWeeklyReviewPush(() => ({ KEYS: effectiveKeys(), OPENAI_COMPAT }));

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

  // ---------------- v9.2.1 BOOT WARM-UP ----------------
  // Free-tier hosts (Render etc.) put the process to sleep; the first
  // user polls after wake hit COLD caches and used to time out behind
  // three full board scans ("Agent status unavailable" / "Expert
  // engine unavailable"). Pre-heat the boards ~2s after boot so the
  // first poll is warm. Boards first (parallel), expert scans after —
  // single-flight joins any request that arrives mid-warm. Disable
  // with WARM_ON_BOOT=0.
  if (process.env.WARM_ON_BOOT !== '0') {
    const warmBoards = () => Promise.allSettled([
      getSignals('CRYPTO', depsForSignals()).catch(() => null),
      getSignals('FUTURES', depsForSignals()).catch(() => null),
      getSignals('INDIA', depsForSignals()).catch(() => null),
    ]);
    const warmPicks = () => Promise.allSettled([
      getExpertPicks('CRYPTO', {}).catch(() => null),
      getExpertPicks('FUTURES', {}).catch(() => null),
    ]);
    const warmer = setTimeout(() => {
      warmBoards()
        .then(() => warmPicks())
        .catch(() => { /* best-effort warm */ });
    }, 2000);
    if (warmer.unref) warmer.unref();
  }

  console.log('[ai] Superintelligence Ensemble v6.13 — ORDER TICKET + SIMPLE VIEW (options trade guide: session/expiry/limit/exit · 4-step signal order guide · simple/pro desk view · v6.12 pro-trader brain: quorum caps · MTF · session phases · extension veto · swing-structure SL · trust/perf/correlation/sector desks) · 11 models + AI Council (v9.3: IntradayTape 15m seat) + V2 upgrade: SentimentPulse/InstFlow/FundaCheck behind AI_ENABLE_V2_MODELS (14 models when on) · topFive ranking · Dhan + CoinDCX + GLOBAL FUTURES gauntlets · SUPERINTELLIGENCE AUTO-AGENT');
}
