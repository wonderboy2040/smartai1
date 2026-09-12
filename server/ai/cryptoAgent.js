// ============================================================
// server/ai/cryptoAgent.js — CRYPTO DESK MCP AGENT (v1)
// ------------------------------------------------------------
// The CoinDCX tab's conversational AI — the exact pattern of the
// proven intraday ProTraderAgent, mirrored for the crypto desk:
//   • 8 crypto-specialized MCP tools (live signals, deep coin
//     scan, wallet, positions, regime, track-record, sizing,
//     agent status) — ALL wiring to existing compute, zero new
//     data-fetch logic
//   • ReAct loop — up to 6 tool rounds
//   • Multi-provider fallback: Gemini → Groq → Cerebras
//   • FULL-TICKET answer discipline (Part 2): every buy/sell
//     recommendation must carry symbol/direction/entry zone/SL/
//     T1/T2/size/confidence+voters/time-window — an incomplete
//     ticket is REJECTED, the missing piece is asked for.
//
// Registered by routes.js as POST /api/crypto-agent.
// ============================================================
import { getSignals, getDeepSignal, buildRegime } from './signals.js';
import { walletSnapshot, fetchUsdInr } from './futures.js';
import { getPositionsWithPnl, loadConfig } from './coindcxOrders.js';
import { trustReport, governance } from './trust.js';
import { maxSaneLeverage } from './ensemble.js';
import { loadAgentConfig, agentStatus } from './agent.js';
import { coindcxConnected } from '../mcp/coindcx.js';
import { sentimentStatus } from './sentiment.js';

const MAX_TOOL_ROUNDS = 6;
const PER_ROUND_TIMEOUT_MS = 30000;
const r2 = (v) => (Number.isFinite(v) ? Math.round(v * 100) / 100 : null);

// ------------------------------------------------------------
// 1. TOOL DEFINITIONS (OpenAI function-calling format)
// ------------------------------------------------------------
export const CRYPTO_AGENT_TOOLS = [
  {
    type: 'function',
    function: {
      name: 'get_live_crypto_signals',
      description: 'Live top high-conviction CoinDCX spot + futures setups from the 14-model superintelligence ensemble (superIntel AI Score ranking). Each setup carries side, confidence, AI score, entry/SL/T1/T2, R:R, leverage view and model votes. Use this FIRST for desk briefings, "kya buy karu", or market overview questions.',
      parameters: {
        type: 'object',
        properties: {
          market: { type: 'string', description: 'Which desk: "SPOT" (CoinDCX INR spot) or "FUTURES" (USDT perpetuals). Default returns both.' },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'analyze_coin',
      description: 'Deep single-coin ensemble scan: all model votes (trend/momentum/volume/SMC/tape/AI Council...), consensus side + confidence + agreement, complete trade plan (entry, ATR-based SL, T1/T2, R:R), superIntel AI score, quality flags and the staged-exit blueprint. Use when the user asks about a SPECIFIC coin.',
      parameters: {
        type: 'object',
        properties: {
          symbol: { type: 'string', description: 'Coin base symbol, e.g. BTC, SOL, ETH' },
          market: { type: 'string', description: '"SPOT" or "FUTURES" (default SPOT)' },
        },
        required: ['symbol'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_wallet',
      description: 'Live CoinDCX wallet snapshot: spot INR + futures USDT balances, deployable margin, equity in INR, USDINR rate used. Use when the user asks about capital, margin or "kitna paisa hai".',
      parameters: { type: 'object', properties: {} },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_open_positions',
      description: 'Open spot + futures positions with entry, qty, leverage, live P&L (INR + USDT), SL/TP state, age and exit stage. Use for position reviews and risk checks.',
      parameters: { type: 'object', properties: {} },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_market_regime',
      description: 'Crypto market regime: BTC 24h change + trend read, risk-on/off label, plus the Fear&Greed index and perp funding bias from the sentiment desk. Use before recommending counter-regime trades.',
      parameters: { type: 'object', properties: {} },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_track_record',
      description: 'Engine accountability from the tamper-evident ledger: calibration buckets (claimed confidence vs actual win-rate), Brier score, monthly trend, per-model governance verdicts. Use when the user asks "engine kitna accurate hai" or performance review.',
      parameters: { type: 'object', properties: {} },
    },
  },
  {
    type: 'function',
    function: {
      name: 'calculate_position_size',
      description: 'Position-sizing calculator for crypto: entry + stop-loss + capital + risk% → exact qty, capital deployed, risk amount, R-multiple targets AND the max SANE leverage for that stop distance (liquidation stays outside the SL). ALWAYS use before recommending a size or leverage.',
      parameters: {
        type: 'object',
        properties: {
          entry: { type: 'number', description: 'Entry price' },
          stopLoss: { type: 'number', description: 'Stop-loss price' },
          capital: { type: 'number', description: 'Capital to deploy (INR for spot / USDT for futures, default 1000)' },
          riskPercent: { type: 'number', description: 'Risk per trade as % of capital (default 1.5, max 5)' },
        },
        required: ['entry', 'stopLoss'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_agent_status',
      description: 'The auto-trade agent state: enabled, mode (paper/notify/live), today\u2019s trades count, rolling win-rate, open agent positions with their dynamic time-exit windows, and current blockers (why it is/isn\u2019t entering). Use for "agent kya kar raha hai" questions.',
      parameters: { type: 'object', properties: {} },
    },
  },
];

function geminiTools() {
  return [{
    functionDeclarations: CRYPTO_AGENT_TOOLS.map(t => ({
      name: t.function.name,
      description: t.function.description,
      parameters: t.function.parameters,
    })),
  }];
}

// ------------------------------------------------------------
// 2. SYSTEM PROMPT — CoinDCX desk persona + FULL-TICKET format
// ------------------------------------------------------------
export function buildCryptoSystemPrompt(ctx) {
  const { utcTime, btcRegime, fng, funding, connected, aiOnline } = ctx;
  return `You are "CRYPTO DESK PRO" — an elite crypto trading desk head (15+ years, CoinDCX India + global perps) running a 14-model superintelligence ensemble with an AI Council (LLM) verification layer.

CURRENT DESK CONTEXT (auto-injected, always trust this over assumptions):
- UTC time: ${utcTime} (crypto trades 24/7 — no market-closed excuses)
- BTC regime: ${btcRegime} | Sentiment: ${fng} | Perp funding: ${funding}
- CoinDCX API: ${connected ? 'CONNECTED (live wallet/positions available)' : 'NOT CONNECTED (paper-context only — say so if asked to trade)'} | AI Council: ${aiOnline ? 'online' : 'offline'}

HOW YOU WORK (agentic protocol):
- ALWAYS call tools for live data — NEVER guess or hallucinate prices, levels or P&L
- Briefings / "kya buy karu" → get_live_crypto_signals + get_market_regime first
- Specific coin → analyze_coin (add get_market_regime if counter-trend)
- Before ANY size or leverage recommendation → calculate_position_size (it returns the max SANE leverage)
- Track-record / accuracy questions → get_track_record
- "Agent kya kar raha hai" → get_agent_status

${fullTicketRules()}

RISK DISCIPLINE (NON-NEGOTIABLE):
1. Max 1-2% capital risk per trade (stop-distance based, never "feel" based)
2. Leverage only up to calculate_position_size's max-sane number — above it, liquidation sits INSIDE the stop and the plan is fiction
3. Funding-fighting continuation calls get penalized — a crowded-long perp chart is not a long signal
4. Never recommend an entry |r|>0.7-correlated with the user's OPEN positions (same bet twice) — check get_open_positions
5. Stablecoin/inactive coins: honest NO-TRADE call, no setups manufactured

RESPONSE STYLE (user is an Indian crypto trader, speaks Hinglish):
- Natural Hinglish (Roman script), technical terms in English
- DIRECT desk-trader tone — no disclaimer-stacking, no waffle
- Bullets > paragraphs; every level an exact number, never "around"
- Honest NO-TRADE calls when conviction is thin — the best trade is often skipping
- End with the one-line key risk note`;
}

/** Part 2 — the strict FULL-TICKET format, shared by both desk agents. */
export function fullTicketRules() {
  return `FULL-TICKET ANSWER DISCIPLINE (non-negotiable):
Jab bhi buy/sell recommend karo, HAMESHA yeh poora ticket do:
 - Symbol + Direction (LONG/SHORT)
 - Entry zone (exact price range)
 - Stop-loss (exact price + one-line WHY it's there — structure/ATR/volatility)
 - Target 1, Target 2 (with R-multiples)
 - Position size (qty or % of capital, from the risk% — call calculate_position_size first)
 - Confidence / AI Score + kitne models voted vs agreed (honesty: thin committee = say so, demand more conviction)
 - Time-window (setup kab tak valid / exit-by — futures ke liye funding + max-hold dono bolo)
Kabhi bhi bina in sab ke sirf "BUY kar do" mat bolo — an INCOMPLETE TICKET is always rejected: instead, missing piece clearly maango (e.g. "capital batao to exact qty dunga"). Spot vs FUTURES hamesha label karo — INR spot prices and USDT perp prices are different books.`;
}

// ------------------------------------------------------------
// 3. TOOL EXECUTION — wired to the live crypto stack
// ------------------------------------------------------------
async function executeCryptoTool(name, args, deps) {
  const { KEYS } = deps || {};
  try {
    switch (name) {
      case 'get_live_crypto_signals': {
        const want = String(args.market || '').toUpperCase();
        const markets = want === 'SPOT' ? ['CRYPTO'] : want === 'FUTURES' ? ['FUTURES'] : ['CRYPTO', 'FUTURES'];
        const out = {};
        for (const m of markets) {
          const b = await getSignals(m, deps, { limit: 8 }).catch(() => null);
          if (!b?.ok) { out[m === 'CRYPTO' ? 'SPOT' : 'FUTURES'] = { error: 'board unavailable (feeds unreachable — retry in a minute)' }; continue; }
          out[m === 'CRYPTO' ? 'SPOT' : 'FUTURES'] = (b.signals || []).slice(0, 5).map(s => ({
            symbol: s.symbol, side: s.side, grade: s.grade, confidence: s.confidence,
            aiScore: s.superIntel?.aiScore ?? null, ltp: s.ltp, changePct: s.changePct,
            voters: s.voters ?? s.participating ?? null, totalModels: s.totalModels ?? null,
            agreement: s.agreement, plan: s.plan ? {
              entry: s.plan.entry, stopLoss: s.plan.stopLoss,
              target1: s.plan.target1, target2: s.plan.target2, riskPct: s.plan.riskPct, rewardRisk: s.plan.rewardRisk,
            } : null,
            aiNote: s.aiNote?.note ?? null,
          }));
        }
        return out;
      }

      case 'analyze_coin': {
        const symbol = String(args.symbol || '').trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
        if (!symbol) return { error: 'symbol required (e.g. BTC, SOL)' };
        const market = String(args.market || '').toUpperCase() === 'FUTURES' ? 'FUTURES' : 'CRYPTO';
        const d = await getDeepSignal(symbol, market, deps, {}).catch(() => null);
        if (!d?.ok) return { error: `No data for ${symbol} — check the symbol (BTC/ETH/SOL...) or the feed is down.` };
        const s = d.signal || d;
        return {
          symbol, market,
          side: s.side, grade: s.grade, confidence: s.confidence, agreement: s.agreement,
          voters: s.voters ?? s.participating ?? null, totalModels: s.totalModels ?? null,
          ltp: s.ltp, changePct: s.changePct,
          aiScore: s.superIntel?.aiScore ?? null, tier: s.superIntel?.tier ?? null,
          drivers: s.superIntel?.drivers ?? null,
          plan: s.plan ? {
            entry: s.plan.entry, stopLoss: s.plan.stopLoss, target1: s.plan.target1, target2: s.plan.target2,
            riskPct: s.plan.riskPct, rewardRisk: s.plan.rewardRisk, planStyle: s.plan.planStyle,
          } : null,
          quality: s.quality ? { veto: s.quality.veto, mtf: s.quality.mtf, session: s.quality.session, stopStyle: s.quality.stopStyle } : null,
          blueprint: s.superIntel?.blueprint ?? null,
          votes: (s.votes || []).map(v => ({ model: v.name, dir: v.dir > 0 ? 'BULL' : v.dir < 0 ? 'BEAR' : 'NEUTRAL', conf: v.conf, why: (v.reasons || []).slice(0, 2) })),
          aiNote: s.aiNote || null,
        };
      }

      case 'get_wallet': {
        if (!coindcxConnected()) {
          return { connected: false, note: 'CoinDCX API not connected — live wallet unavailable. Practice-context: paper equity default ₹10,000.', usdInr: await fetchUsdInr().catch(() => 84) };
        }
        const w = await walletSnapshot().catch(e => ({ error: String(e?.message || e) }));
        if (w?.error) return { error: w.error };
        return {
          connected: true, equityINR: w.equityINR, usdInr: w.usdInr,
          spot: { balanceINR: w.spotINR ?? null, deployableINR: w.deployableSpotINR ?? null },
          futures: { balanceUSDT: w.futuresUSDT ?? null, deployableUSDT: w.deployableFuturesUSDT ?? null, marginUsedUSDT: w.marginUsedUSDT ?? null },
          fetchedAt: w.fetchedAt ?? null,
        };
      }

      case 'get_open_positions': {
        const p = await getPositionsWithPnl().catch(() => null);
        if (!p) return { error: 'positions unavailable (CoinDCX API down?)' };
        return {
          count: (p.positions || []).length,
          positions: (p.positions || []).map(x => ({
            pair: x.pair, market: x.market, side: x.side, qty: x.qty ?? null,
            entryPrice: x.entryPrice, lastPrice: x.lastPrice ?? null,
            pnlINR: x.pnlINR ?? null, pnlPct: x.pnlPct ?? null,
            leverage: x.leverage ?? null, marginUSDT: x.marginUSDT ?? null,
            sl: x.sl ?? null, tp2: x.tp2 ?? null, ageMin: x.openedAt ? Math.round((Date.now() - x.openedAt) / 60000) : null,
            source: x.source ?? null, exitStage: x.exitStage ?? null, bookedPnlINR: x.bookedPnlINR ?? null,
          })),
        };
      }

      case 'get_market_regime': {
        const reg = await buildRegime('CRYPTO').catch(() => ({}));
        const sent = sentimentStatus().markets?.CRYPTO || null;
        const btc = reg?.btcChange;
        const label = btc == null ? 'UNKNOWN' : btc > 0.75 ? 'RISK-ON' : btc < -0.75 ? 'RISK-OFF' : 'NEUTRAL';
        return {
          btcChangePct24h: btc ?? null,
          btcTrend: reg?.btcTrend ?? null,
          regime: label,
          fearGreed: sent ? { value: sent.fng, label: sent.fngLabel, compositeScore: sent.score } : 'unreachable',
          fundingBias: sent?.fundingBps8h != null ? `${sent.fundingBps8h} bps/8h ${sent.fundingBps8h > 10 ? '(crowded longs)' : sent.fundingBps8h < -3 ? '(shorts paying — squeeze fuel)' : '(balanced)'}` : 'unreachable',
          note: 'Regime gates every alt call — counter-regime trades need the FULL ticket with extra conviction.',
        };
      }

      case 'get_track_record': {
        const t = trustReport();
        const g = governance();
        return {
          settledSignals: t.settled,
          sufficient: t.sufficient,
          brier: t.brier, brierVerdict: t.brierVerdict,
          overall: t.overall ?? null,
          calibration: (t.calibration || []).map(c => ({ bucket: c.bucket, claimed: c.claimed, actual: c.winRate, n: c.n })),
          monthly: t.monthly ?? [],
          modelGovernance: (g.models || []).slice(0, 8).map(m => ({ model: m.model, n: m.n, hitRate: m.hitRate, verdict: m.verdict })),
          note: t.note,
        };
      }

      case 'calculate_position_size': {
        const entry = parseFloat(args.entry);
        const stopLoss = parseFloat(args.stopLoss);
        if (!(entry > 0) || !(stopLoss > 0) || entry === stopLoss) {
          return { error: 'valid entry and stopLoss required (both > 0, different)' };
        }
        const capital = parseFloat(args.capital) > 0 ? parseFloat(args.capital) : 1000;
        const riskPercent = parseFloat(args.riskPercent) > 0 && parseFloat(args.riskPercent) <= 5 ? parseFloat(args.riskPercent) : 1.5;
        const riskPerUnit = Math.abs(entry - stopLoss);
        const stopDistPct = (riskPerUnit / entry) * 100;
        const riskAmount = (capital * riskPercent) / 100;
        const qty = riskAmount / riskPerUnit;
        const long = stopLoss < entry;
        const t1 = entry + 1 * riskPerUnit * (long ? 1 : -1);
        const t2 = entry + 2 * riskPerUnit * (long ? 1 : -1);
        // ensemble.js's sanity: liquidation must sit OUTSIDE the stop
        const maxLev = maxSaneLeverage(stopDistPct, 10);
        return {
          entry, stopLoss, capital, riskPercent,
          stopDistancePct: r2(stopDistPct),
          riskAmount: r2(riskAmount),
          recommendedQty: Math.round(qty * 1e6) / 1e6,
          capitalDeployed: r2(qty * entry),
          target1_1R: r2(t1), target2_2R: r2(t2),
          maxSaneLeverage: maxLev,
          warning: `Liquidation ${maxLev}x leverage ke andar stop ke BAHAR rehti hai — ${maxLev}x se upar plan fiction hai.`,
          note: `Risk ₹${r2(riskAmount)} (${riskPercent}% of ${capital}) at ${r2(stopDistPct)}% stop distance.`,
        };
      }

      case 'get_agent_status': {
        const cfg = loadAgentConfig();
        const st = await agentStatus(null).catch(() => null);
        if (!st) return { error: 'agent status unavailable' };
        return {
          enabled: cfg.enabled, mode: cfg.mode,
          todayTrades: st.today?.tradesCount ?? 0, maxTrades: st.today?.maxTrades ?? null,
          realizedPnlINR: st.today?.realizedPnlINR ?? null,
          rollingWinRate: st.accuracy?.rollingWinRate ?? null,
          rollingWindow: st.accuracy?.rollingWindow ?? null,
          correlationGuard: st.accuracy?.correlationGuard ?? null,
          dynamicTimeExit: st.accuracy?.dynamicTimeExit ?? null,
          openAgentPositions: (st.openPositions || []).map(p => ({
            pair: p.pair, side: p.side, ageMin: p.ageMin, maxHoldMin: p.maxHoldMin,
            bookedPnlINR: p.bookedPnlINR, exitStage: p.exitStage,
          })),
          blockers: (st.blockers || []).map(b => b.text),
        };
      }

      default:
        return { error: `Unknown tool: ${name}` };
    }
  } catch (err) {
    return { error: `Tool ${name} failed: ${err?.message || err}` };
  }
}

// ------------------------------------------------------------
// 4. AGENTIC LOOP — Gemini → Groq → Cerebras (intraday pattern)
// ------------------------------------------------------------
async function runGeminiAgent({ systemPrompt, messages, deps, toolTrace }) {
  const { KEYS } = deps;
  if (!KEYS?.gemini) return null;
  const models = ['gemini-3.5-flash', 'gemini-2.5-flash'];
  let lastErr = null;
  for (const model of models) {
    try {
      return await _runGeminiLoop(model, { systemPrompt, messages, deps, toolTrace });
    } catch (e) {
      lastErr = e;
      if (!/\b(404|400)\b/.test(String(e?.message))) break;
    }
  }
  throw lastErr || new Error('gemini failed');
}

async function _runGeminiLoop(model, { systemPrompt, messages, deps, toolTrace }) {
  const { KEYS } = deps;
  const contents = messages
    .filter(m => m.role !== 'system')
    .map(m => ({ role: m.role === 'assistant' ? 'model' : 'user', parts: [{ text: String(m.content || '') }] }));

  const payload = {
    contents,
    systemInstruction: { parts: [{ text: systemPrompt }] },
    tools: geminiTools(),
    generationConfig: { temperature: 0.4, maxOutputTokens: 4000 },
  };

  let data = null;
  for (let round = 0; round <= MAX_TOOL_ROUNDS; round++) {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${KEYS.gemini}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(PER_ROUND_TIMEOUT_MS),
      },
    );
    if (!res.ok) throw new Error(`gemini ${res.status}`);
    data = await res.json();

    const parts = data.candidates?.[0]?.content?.parts || [];
    const fnCalls = parts.filter(p => p.functionCall).map(p => p.functionCall);
    if (fnCalls.length === 0) break;

    contents.push({ role: 'model', parts: parts.map(p => p.functionCall ? { functionCall: p.functionCall } : { text: p.text }).filter(p => p.functionCall || p.text) });
    const responseParts = [];
    for (const fn of fnCalls) {
      toolTrace.push({ tool: fn.name, ts: Date.now() });
      const result = await executeCryptoTool(fn.name, fn.args || {}, deps);
      responseParts.push({ functionResponse: { name: fn.name, response: { result } } });
    }
    contents.push({ role: 'user', parts: responseParts });
    payload.contents = contents.map(c => ({ ...c, parts: [...c.parts] }));
  }

  const text = (data?.candidates?.[0]?.content?.parts || []).map(p => p.text).filter(Boolean).join('\n').trim();
  if (!text) throw new Error('gemini empty response');
  return { text, engine: model };
}

async function runOpenAICompatAgent({ systemPrompt, messages, deps, toolTrace, provider }) {
  const { KEYS, OPENAI_COMPAT } = deps;
  if (!KEYS?.[provider] || !OPENAI_COMPAT?.[provider]) return null;
  const cfg = OPENAI_COMPAT[provider];
  const modelChain = provider === 'groq' ? [cfg.defModel, 'llama-3.3-70b-versatile'] : [cfg.defModel];
  let lastErr = null;
  for (const model of modelChain) {
    try {
      return await _runOpenAICompatLoop(model, cfg, { systemPrompt, messages, deps, toolTrace, provider });
    } catch (e) {
      lastErr = e;
      if (!/\b(404|400|422)\b/.test(String(e?.message))) break;
    }
  }
  throw lastErr || new Error(`${provider} failed`);
}

async function _runOpenAICompatLoop(model, cfg, { systemPrompt, messages, deps, toolTrace, provider }) {
  const { KEYS } = deps;
  if (!KEYS?.[provider]) return null;
  const reqMessages = [
    { role: 'system', content: systemPrompt },
    ...messages.filter(m => m.role !== 'system').map(m => ({ role: m.role, content: String(m.content || '') })),
  ];

  let data = null;
  for (let round = 0; round <= MAX_TOOL_ROUNDS; round++) {
    const body = { model, messages: reqMessages, temperature: 0.4, max_completion_tokens: 4000 };
    if (round === 0) body.tools = CRYPTO_AGENT_TOOLS;

    const res = await fetch(cfg.url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${KEYS[provider]}` },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(PER_ROUND_TIMEOUT_MS),
    });
    if (!res.ok) throw new Error(`${provider} ${res.status}`);
    data = await res.json();

    const choice = data.choices?.[0];
    const toolCalls = choice?.message?.tool_calls || [];
    if (toolCalls.length === 0) break;

    reqMessages.push(choice.message);
    for (const tc of toolCalls) {
      let parsed = {};
      try { parsed = JSON.parse(tc.function?.arguments || '{}'); } catch { /* keep {} */ }
      toolTrace.push({ tool: tc.function?.name, ts: Date.now() });
      const result = await executeCryptoTool(tc.function?.name, parsed, deps);
      reqMessages.push({ role: 'tool', tool_call_id: tc.id, name: tc.function?.name, content: JSON.stringify(result) });
    }
  }

  const text = data?.choices?.[0]?.message?.content?.trim();
  if (!text) throw new Error(`${provider} empty response`);
  return { text, engine: `${provider}:${model}` };
}

// ------------------------------------------------------------
// 5. PUBLIC ENTRY — runCryptoAgent(messages, deps)
// ------------------------------------------------------------
export async function runCryptoAgent(messages, deps) {
  const d = deps || {};
  // Live desk context for the system prompt (all best-effort — a dead
  // feed must never block the chat, it just shows as UNKNOWN).
  const [reg, sent] = await Promise.all([
    buildRegime('CRYPTO').catch(() => ({})),
    Promise.resolve(sentimentStatus().markets?.CRYPTO || null),
  ]);
  const now = new Date();
  const ctx = {
    utcTime: `${String(now.getUTCHours()).padStart(2, '0')}:${String(now.getUTCMinutes()).padStart(2, '0')} UTC`,
    btcRegime: reg?.btcChange != null ? `BTC ${reg.btcChange > 0 ? '+' : ''}${reg.btcChange}% 24h (${reg.btcChange > 0.75 ? 'RISK-ON' : reg.btcChange < -0.75 ? 'RISK-OFF' : 'NEUTRAL'})` : 'UNKNOWN',
    fng: sent?.fng != null ? `Fear&Greed ${sent.fng} (${sent.fngLabel || '?'})` : 'unreachable',
    funding: sent?.fundingBps8h != null ? `${sent.fundingBps8h} bps/8h` : 'unreachable',
    connected: coindcxConnected(),
    aiOnline: !!(d.KEYS?.gemini || d.KEYS?.groq || d.KEYS?.cerebras),
  };

  const systemPrompt = buildCryptoSystemPrompt(ctx);
  const toolTrace = [];

  const chain = [
    { run: () => runGeminiAgent({ systemPrompt, messages, deps: d, toolTrace }) },
    { run: () => runOpenAICompatAgent({ systemPrompt, messages, deps: d, toolTrace, provider: 'groq' }) },
    { run: () => runOpenAICompatAgent({ systemPrompt, messages, deps: d, toolTrace, provider: 'cerebras' }) },
  ];

  const errors = [];
  for (const step of chain) {
    try {
      const result = await step.run();
      if (result) {
        return {
          ok: true,
          text: result.text,
          engine: result.engine,
          toolsUsed: [...new Set(toolTrace.map(t => t.tool))],
          toolCalls: toolTrace.length,
          session: ctx,
        };
      }
    } catch (e) {
      errors.push(`${e?.message || e}`);
    }
  }

  return {
    ok: false,
    error: `Agent engines unavailable: ${errors.join(' | ') || 'no AI keys configured'}`,
    toolsUsed: [...new Set(toolTrace.map(t => t.tool))],
    session: ctx,
  };
}

// test hooks
export const __internals = { executeCryptoTool, buildCryptoSystemPrompt, fullTicketRules };
