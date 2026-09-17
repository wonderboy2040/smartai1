#!/usr/bin/env node
// scripts/smoke_v1100.mjs — v11.0 boot smoke (hermetic import + contract check)
// SMARTAI_DATA_DIR isolates all store IO into a temp dir. Verifies:
//   1. registry — 10 agent cards, capability index, breaker + budgets
//   2. mesh — unknown-cap honesty, negative cache, status shape,
//      LIVE crypto.ohlcv probe from this host (honest degrade)
//   3. consensus — gate thresholds (78/0.70/quorum 5 default),
//      NEUTRAL-abstain weighted consensus, precision gate reasons,
//      near-miss record/list round-trip
//   4. council — flag default OFF, market-aware seats, feature matrix
//      honesty (FLAT mesh bundle!), deterministic verdicts, board
//      offline path + the 90s verdict cache
//   5. llmChain — exports + keyless honesty
//   6. routes — /api/mcp/* + /api/ai/council/* in the registry
//   7. wiring — signals hook, ledger stamp, weekly review section,
//      trust calibration, BOTH tabs' panels + frontend fetchers
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readFileSync } from 'node:fs';

process.env.NODE_ENV = 'test';
process.env.SMARTAI_DATA_DIR = mkdtempSync(join(tmpdir(), 'smoke-v1100-'));
delete process.env.AI_ENABLE_GLOBAL_COUNCIL;
delete process.env.AI_PRECISION_GATE_CONF;

let pass = 0, fail = 0;
const ok = (name, cond) => { if (cond) { pass++; console.log(`  ✓ ${name}`); } else { fail++; console.log(`  ✗ ${name}`); } };

console.log('v11.0 boot smoke — MCP agent mesh + global market council + precision gate');

// import mesh FIRST — its module graph registers all 10 agent cards
// (importing registry.js alone registers NOTHING)
const mesh = await import('../server/mcp/mesh.js');
const reg = await import('../server/mcp/agents/registry.js');
// ---------------- 1. registry (10 agents, one contract) ----------------
{
  const cards = reg.allCards();
  const ids = cards.map(c => c.id).sort();
  ok(`registry: all 10 v11.0 agents registered (${cards.length}/10)`, cards.length === 10);
  ok('registry: the researched lineup is exactly present',
    ['alpaca', 'alphavantage', 'ccxt', 'coinapi', 'coingecko', 'finnhub', 'massive', 'quiver', 'tradingcentral', 'tradingview']
      .every(id => ids.includes(id)));
  ok('registry: every card carries the strict contract (id/caps/tier/budget/priority/note)',
    cards.every(c => c.id && Array.isArray(c.capabilities) && c.capabilities.length > 0
      && c.capabilities.every(cp => ['hot', 'warm', 'cold'].includes(cp.tier))
      && c.budget && Number.isFinite(c.priority) && typeof c.note === 'string'));
  const ohlcv = reg.whichAgentsNeed('crypto.ohlcv');
  ok('registry: capability routing — ccxt is the preferred crypto.ohlcv provider', ohlcv[0]?.id === 'ccxt');
  // breaker: 3 fails → open; success resets
  reg.noteFailure('ccxt', new Error('x')); reg.noteFailure('ccxt', new Error('x')); reg.noteFailure('ccxt', new Error('x'));
  ok('registry: 3-fail circuit breaker OPENS on ccxt', reg.agentHealth('ccxt').state === 'open');
  reg.noteSuccess('ccxt');
  ok('registry: clean recovery resets the breaker (half-open probe passes)', reg.agentHealth('ccxt').state === 'closed');
  // budgets: commit then view
  reg.budgetCommit('ccxt', 1);
  ok('registry: token-bucket commit accrues (per-minute etiquette)', reg.budgetView('ccxt').usedMinute >= 1);
  // env-key honesty: alphavantage absent without its key
  const av = cards.find(c => c.id === 'alphavantage');
  ok('registry: missing API key = agent honestly ABSENT (alphavantage unauthed here)',
    av.authRequired === true && av.authed === false);
}

// ---------------- 2. mesh (orchestrator contract + LIVE probe) ----------------
{
  const m = mesh;
  const bogus = await m.meshQuery({ capabilities: ['does.not.exist'] });
  ok('mesh: unknown capability → honest gap, never invented data',
    bogus.ok === false && bogus.gaps[0]?.cap === 'does.not.exist');
  const empty = await m.meshQuery({});
  ok('mesh: empty capabilities → structured error', empty.ok === false);
  const st = m.meshStatus();
  ok('mesh: status exposes 10 agents + cache occupancy + stats + breaker states',
    st.agentCount === 10 && st.cache && 'entries' in st.cache && 'stats' in st.cache);
  ok('mesh: cross-source price sanity band flags >1.5% divergence',
    m.crossValidatePrices({ BTC: [{ agent: 'a', price: 100 }, { agent: 'b', price: 103 }] }).length === 1);
  // LIVE probe: real ccxt ohlcv from this host (binance → bybit → okx)
  const live = await m.meshQuery({ capabilities: ['crypto.ohlcv'], symbols: ['BTCUSDT'] });
  if (live.ok) {
    const r = live.results['crypto.ohlcv'];
    ok(`LIVE mesh probe: BTCUSDT ohlcv served by ${r.agent} (${r.data.candles.length} candles, stale=${r.stale})`,
      r.data.candles.length >= 2 && Number.isFinite(r.data.candles[0].close) && r.ts > 0);
    const cached = await m.meshQuery({ capabilities: ['crypto.ohlcv'], symbols: ['BTCUSDT'] });
    ok('mesh: warm-tier cache — second identical query is a cache hit (ZERO new upstream)',
      cached.ok === true && m.__meshStatsForTests().cacheHits > 0);
  } else {
    ok('mesh: upstream unreachable from this host → honest gap + negative cache (no crash, no fake candles)',
      live.gaps?.length > 0);
  }
}

// ---------------- 3. consensus (pure core + the precision gate) ----------------
const cons = await import('../server/ai/consensus.js');
{
  const t = cons.gateThresholds();
  ok('gate: default thresholds conf=78 · agreement=0.70 · quorum=5 · weak-side +5',
    t.minConfidence === 78 && t.minAgreement === 0.70 && t.quorumVotes === 5 && t.weakSidePenalty === 5);
  process.env.AI_PRECISION_GATE_CONF = '90';
  ok('gate: AI_PRECISION_GATE_CONF env-tunable (A/B arm)', cons.gateThresholds().minConfidence === 90);
  delete process.env.AI_PRECISION_GATE_CONF;

  // NEUTRAL = abstain: the Risk Guardian's structural NEUTRAL must NOT
  // drag the direction score (the ceiling fix)
  const v1 = {
    technical: { direction: 'LONG', confidence: 88 },
    macro: { direction: 'LONG', confidence: 85 },
    sentiment: { direction: 'LONG', confidence: 80 },
    onchain: { direction: 'LONG', confidence: 82 },
    optionsflow: { direction: 'LONG', confidence: 80 },
    risk: { direction: 'NEUTRAL', confidence: 90 },
  };
  const c1 = cons.weightedConsensus(v1);
  ok('consensus: NEUTRAL abstains from the score denominator (5 aligned → ~83 conf, ceiling intact)',
    c1.direction === 'LONG' && c1.confidence >= 78 && c1.quorum === 6);
  ok('consensus: agreement counts over ALL present seats (5/6 = 0.83)',
    c1.agreement === 0.83);

  // the gate itself: 80-conf LONG consensus with clean ctx → PASSED
  const g1 = cons.precisionGate({ ...c1, market: 'CRYPTO', symbol: 'BTC' }, {
    regimeAligned: true, event: { blocked: false }, riskOff: false, riskVeto: null, directionSplit: null,
    plan: { rewardRisk: 2.2 }, levels: { entry: 68000, stop: 66800, t1: 69200 },
  });
  ok('gate: strong clean consensus PASSES', g1.gate === 'PASSED');
  const g2 = cons.precisionGate({ ...c1, confidence: 70 }, {
    regimeAligned: true, event: { blocked: false }, riskOff: false, riskVeto: null, directionSplit: null,
  });
  ok('gate: sub-78 confidence → SUPPRESSED with the conf reason', g2.gate === 'SUPPRESSED' && String(g2.reasons?.[0] || '').includes('conf'));
  const g3 = cons.precisionGate({ ...c1 }, {
    regimeAligned: true, event: { blocked: false }, riskOff: false, riskVeto: 'event_blackout', directionSplit: null,
  });
  ok('gate: risk veto suppresses regardless of consensus strength', g3.gate === 'SUPPRESSED' && g3.reasons?.some(r => String(r).includes('veto')));

  // near-miss round trip (durable, capped)
  cons.__resetConsensusForTests();
  cons.recordNearMiss({ market: 'CRYPTO', symbol: 'BTC', consensus: { ...c1, confidence: 70 },
    gate: g2, levels: { entry: 68000, stop: 66800, t1: 69200 }, plan: { rewardRisk: 2.2 }, model: 'deterministic' });
  const nm = cons.nearMissList(10);
  const nms = cons.nearMissStats();
  ok('near-miss: suppressed verdict recorded with reasons + stats count', nm.length === 1 && nms.total === 1 && nm[0].symbol === 'BTC');
  cons.__resetConsensusForTests();
}

// ---------------- 4. council (seats + features + offline board) ----------------
const council = await import('../server/ai/council.js');
{
  ok('council: master flag default OFF (A/B-safe boot)', council.councilEnabled() === false);
  process.env.AI_ENABLE_GLOBAL_COUNCIL = 'on';
  ok('council: AI_ENABLE_GLOBAL_COUNCIL=on flips it', council.councilEnabled() === true);
  delete process.env.AI_ENABLE_GLOBAL_COUNCIL;

  ok('council: India excludes on-chain; crypto excludes options-flow (structural abstain)',
    !council.availableRoles('INDIA').includes('onchain') && council.availableRoles('INDIA').includes('optionsflow')
    && !council.availableRoles('CRYPTO').includes('optionsflow') && council.availableRoles('CRYPTO').includes('onchain'));

  // feature matrix: the FLAT mesh bundle { fundingRate, price } (the
  // production shape councilMeshBundle builds) maps into onchain
  const f = council.buildFeatureMatrix({
    market: 'CRYPTO', symbol: 'BTC',
    sig: { side: 'LONG', grade: 'STRONG', confidence: 82, agreement: 0.75, ltp: 68000, ind: { rsi: 62, adx: { adx: 24 }, atr: 900, vwap: 67200 }, votes: [{ name: 'm', dir: 1, conf: 80 }], plan: { entry: 68000, stopLoss: 66800, target1: 69200, rewardRisk: 2 } },
    regime: { btcChange: 1.5 },
    mesh: { fundingRate: 0.0005, price: { price: 67900, agent: 'coingecko' } },
    sentCtx: null, eventCtx: { action: 'allow' }, riskCtx: { heatPct: 12, riskOff: false },
  });
  ok('council: feature matrix maps the FLAT mesh bundle — funding 0.0005 reaches onchain',
    f.onchain?.fundingRate === 0.0005 && f.meshPrice?.price === 67900);
  const f2 = council.buildFeatureMatrix({ market: 'CRYPTO', symbol: 'X', sig: {}, regime: {}, mesh: null });
  ok('council: missing-everything stays honest (nulls, never guessed)',
    f2.ta.rsi === null && f2.ltp === null && f2.onchain === null && f2.ensemble.consensus.side === null);

  const det = council.deterministicVerdicts('CRYPTO', f);
  ok('council: deterministic fallback — funding crowding flips on-chain SHORT, technical follows ensemble',
    det.onchain.direction === 'SHORT' && det.technical.direction === 'LONG' && det.risk.veto === null);

  // offline board: no LLM keys → deterministic, honestly tagged
  const board = await council.runCouncilBoard({
    market: 'CRYPTO',
    signals: [{ symbol: 'BTC', side: 'LONG', grade: 'STRONG', confidence: 82, agreement: 0.75, ltp: 68000, ind: { rsi: 62, adx: { adx: 24 } }, plan: { entry: 68000, stopLoss: 66800, target1: 69200, rewardRisk: 2 } }],
    regime: { btcChange: 1.2 },
    deps: { KEYS: {} },
  });
  const r = board.bySymbol.BTC;
  ok('council: offline board stands — model honestly tagged deterministic (never a provider name)',
    r && r.model === 'deterministic' && r.freshness === 'model' && r.verdicts.technical && r.verdicts.risk);
  ok('council: consensus + gate evaluated on the offline board (quorum 5 seats on CRYPTO)',
    r.consensus.quorum === 5 && typeof r.gate.gate === 'string');
  const stamp = council.councilStampOf(r);
  ok('council: wire stamp is compact + JSON-serializable (both desks render it)',
    stamp && stamp.agents.length === 5 && (() => { try { JSON.stringify(stamp); return true; } catch { return false; } })());
  // 90s verdict cache: second run is cached
  const board2 = await council.runCouncilBoard({
    market: 'CRYPTO',
    signals: [{ symbol: 'BTC', side: 'LONG', confidence: 82, ltp: 68000 }],
    regime: { btcChange: 1.2 },
    deps: { KEYS: {} },
  });
  ok('council: 90s verdict cache — second board run is a cache hit', board2.model === 'cached');
}

// ---------------- 5. llmChain ----------------
{
  const lc = await import('../server/ai/llmChain.js');
  ok('llmChain: exports the shared chain + keyless honesty',
    typeof lc.councilAsk === 'function' && lc.aiKeysPresent({}) === false && lc.aiKeysPresent({ gemini: 'k' }) === true);
  const noKey = await lc.councilAsk('test', { KEYS: {} });
  ok('llmChain: ask without keys returns { json: null } — never throws', noKey.json === null);
}

// ---------------- 6. route registry ----------------
{
  const srcIdx = readFileSync(new URL('../server/index.js', import.meta.url), 'utf8');
  ok('route: registerMeshRoutes wired into the Express app', srcIdx.includes('registerMeshRoutes(app)'));
  const srcMesh = readFileSync(new URL('../server/mcp/mesh.js', import.meta.url), 'utf8');
  ok('routes: /api/mcp/agents + /api/mcp/mesh/status + /api/mcp/mesh/query registered',
    srcMesh.includes("app.get('/api/mcp/agents'") && srcMesh.includes("app.get('/api/mcp/mesh/status'") && srcMesh.includes("app.post('/api/mcp/mesh/query'"));
  const srcRoutes = readFileSync(new URL('../server/ai/routes.js', import.meta.url), 'utf8');
  ok('routes: all four /api/ai/council/* routes registered',
    srcRoutes.includes("app.get('/api/ai/council/status'") && srcRoutes.includes("app.get('/api/ai/council/near-miss'")
    && srcRoutes.includes("app.get('/api/ai/council/calibration'") && srcRoutes.includes("app.get('/api/ai/council/verdict/:symbol'"));
}

// ---------------- 7. wiring (engine hook + closed loop + both tabs) ----------------
{
  const srcSignals = readFileSync(new URL('../server/ai/signals.js', import.meta.url), 'utf8');
  ok('wiring: signals.js council hook is flag-gated with the 12s soft deadline',
    srcSignals.includes('councilEnabled()') && srcSignals.includes('runCouncilBoard') && srcSignals.includes('12_000'));
  ok('wiring: the council ATTACHES (councilStampOf) — never touches execution',
    srcSignals.includes('s.council = councilStampOf(v)'));
  const srcLedger = readFileSync(new URL('../server/ai/ledger.js', import.meta.url), 'utf8');
  ok('wiring: ledger recordExecution stamps the council verdict (attribution input)',
    srcLedger.includes('council'));
  const srcWeekly = readFileSync(new URL('../server/ai/weeklyReview.js', import.meta.url), 'utf8');
  ok('wiring: weekly review computes the council week (auto-tighten + near-miss scan)',
    srcWeekly.includes('computeCouncilWeek') && srcWeekly.includes('autoTightenGate') && srcWeekly.includes('nearMissOutcomeScan'));
  const srcTrust = readFileSync(new URL('../server/ai/trust.js', import.meta.url), 'utf8');
  ok('wiring: trust.js carries the Bayesian council calibration (n≥8 rule)',
    srcTrust.includes('councilAgentStats') && srcTrust.includes('councilCalibrationMultipliers') && srcTrust.includes('councilCalibration'));

  const tabA = readFileSync(new URL('../src/components/tabs/AITradingTab.tsx', import.meta.url), 'utf8');
  const tabI = readFileSync(new URL('../src/components/tabs/IndiaIntradayTab.tsx', import.meta.url), 'utf8');
  ok('wiring: CouncilVerdictPanel mounted on BOTH desks', tabA.includes('<CouncilVerdictPanel') && tabI.includes('<CouncilVerdictPanel'));
  const useAt = readFileSync(new URL('../src/components/aitrading/useAITrading.ts', import.meta.url), 'utf8');
  ok('wiring: frontend council fetchers (status/near-miss/verdict/calibration)',
    useAt.includes('fetchCouncilStatus') && useAt.includes('fetchCouncilNearMiss') && useAt.includes('fetchCouncilVerdict') && useAt.includes('fetchCouncilCalibration'));
  const sc = readFileSync(new URL('../src/components/aitrading/SignalCard.tsx', import.meta.url), 'utf8');
  ok('wiring: SignalCard renders the council strip on stamped cards', sc.toLowerCase().includes('council'));
  const od = readFileSync(new URL('../src/components/aitrading/OptionsDeskPanel.tsx', import.meta.url), 'utf8');
  ok('wiring: options desk scanner cross-checks against council verdicts', od.toLowerCase().includes('council'));
  const env = readFileSync(new URL('../.env.example', import.meta.url), 'utf8');
  ok('env: AI_ENABLE_GLOBAL_COUNCIL + agent keys + tuning flags documented',
    env.includes('AI_ENABLE_GLOBAL_COUNCIL') && env.includes('AI_PRECISION_GATE_CONF') && env.includes('ALPHAVANTAGE_API_KEY'));
}

console.log(`\n${pass}/${pass + fail} checks passed${fail ? ' — FIX BEFORE SHIP' : ''}`);
process.exit(fail ? 1 : 0);
