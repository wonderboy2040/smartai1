// ============================================================
// test/council.test.ts — v11.0 PHASE 2 · GLOBAL MARKET COUNCIL
// ------------------------------------------------------------
// Locks: seat availability per market, the feature matrix's honest
// field mapping, verdict parsing/validation, the DETERMINISTIC
// fallback (LLM down → quant-only, tagged 'deterministic'), the
// batched persona flow, the 90s verdict cache, the deep debate +
// judge (bounded ±8 shift), partial-LLM degradation, and the wire
// STAMP shape both desks' UIs render.
// Hermetic: LLM chain, mesh, globalRisk, eventGuard, sentiment all
// mocked; store is in-memory.
// ============================================================
import { describe, it, expect, beforeEach, vi } from 'vitest';

const _disk = vi.hoisted(() => new Map());
vi.mock('../server/lib/store.js', () => ({
  loadJSON: (f, d) => (_disk.has(f) ? _disk.get(f) : d),
  saveJSON: (f, v) => { _disk.set(f, v); },
}));
vi.mock('../server/mcp/durable.js', () => ({
  durablePut: vi.fn(),
  durableStatus: () => ({}),
}));

// ---- controllable LLM chain ----
const _llm = vi.hoisted(() => ({ on: false, calls: 0, handler: null }));
vi.mock('../server/ai/llmChain.js', () => ({
  councilAsk: async (prompt) => {
    _llm.calls += 1;
    if (!_llm.on || !_llm.handler) return { json: null, model: null };
    return _llm.handler(prompt);
  },
  aiKeysPresent: () => _llm.on,
}));

// ---- controllable mesh (council only needs funding + price) ----
const _mesh = vi.hoisted(() => ({ bundle: {} }));
vi.mock('../server/mcp/mesh.js', () => ({
  meshQuery: async () => ({ ok: false, results: {}, gaps: [] }),
  crossValidatePrices: (pricesBySymbol) => {
    const out = [];
    for (const [symbol, list] of Object.entries(pricesBySymbol || {})) {
      const rows = (list || []).filter(p => Number.isFinite(Number(p.price)));
      if (rows.length < 2) continue;
      const prices = rows.map(r => Number(r.price));
      const mid = (Math.min(...prices) + Math.max(...prices)) / 2;
      const spreadPct = mid > 0 ? Math.round(((Math.max(...prices) - Math.min(...prices)) / mid) * 10000) / 100 : null;
      if (spreadPct != null && spreadPct > 1.5) out.push({ symbol, spreadPct, agents: rows.map(r => `${r.agent}:${r.price}`), degraded: true });
    }
    return out;
  },
}));

// ---- deterministic guards ----
vi.mock('../server/ai/globalRisk.js', () => ({
  globalRiskView: async () => ({ heatPct: 12, riskOff: { riskOff: false } }),
}));
vi.mock('../server/ai/eventGuard.js', () => ({
  eventGuardCheck: () => ({ action: 'allow', event: null }),
}));
vi.mock('../server/ai/sentiment.js', () => ({
  sentimentContextFor: () => null,
}));

import {
  availableRoles, buildFeatureMatrix, parseVerdict, deterministicVerdicts,
  runCouncilBoard, runCouncilDeep, councilStampOf, councilEnabled, priceDivergence,
  __resetCouncilForTests,
} from '../server/ai/council.js';

// A board signal with the RAW ctx fields the feature matrix reads.
const SIG = (over = {}) => ({
  symbol: 'BTC', market: 'CRYPTO', side: 'LONG', grade: 'STRONG',
  confidence: 82, agreement: 0.75, ltp: 68000, changePct: 1.2,
  ind: { rsi: 62, adx: { adx: 24 }, atr: 900, relVolume: 1.8, vwap: 67200, ema20: 67400 },
  votes: [{ name: 'momentum', dir: 1, conf: 80 }],
  plan: { entry: 68000, stopLoss: 66800, target1: 69200, target2: 70400, rewardRisk: 2 },
  ...over,
});

beforeEach(() => {
  __resetCouncilForTests();
  _disk.clear();
  _llm.on = false;
  _llm.calls = 0;
  _llm.handler = null;
  delete process.env.AI_ENABLE_GLOBAL_COUNCIL;
  delete process.env.AI_PRECISION_GATE_CONF;
});

// Persona-shaped LLM JSON per role (detected from the prompt text).
function personaHandler(over = {}) {
  return (prompt) => {
    const role = ['TECHNICAL ANALYST', 'MACRO ECONOMIST', 'SENTIMENT ANALYST', 'OPTIONS FLOW', 'ON-CHAIN ANALYST', 'RISK GUARDIAN']
      .find(r => prompt.includes(r)) || 'TECHNICAL ANALYST';
    const key = role.split(' ')[0].toLowerCase();
    const dir = over[key]?.direction ?? 'LONG';
    const conf = over[key]?.confidence ?? 85;
    const isRisk = role === 'RISK GUARDIAN';
    const isDeepDebate = prompt.includes('BULL ADVOCATE') || prompt.includes('BEAR ADVOCATE') || prompt.includes('JUDGE');
    if (isDeepDebate) {
      if (prompt.includes('BULL ADVOCATE')) return { json: { case: 'bull case strong', strength: 80 }, model: 'gemini' };
      if (prompt.includes('BEAR ADVOCATE')) return { json: { case: 'bear case weak', strength: 35 }, model: 'gemini' };
      return { json: { disagreement: 'momentum vs crowding', favours: 'bull', judgeShift: 6, note: 'evidence favors bulls' }, model: 'gemini' };
    }
    return {
      json: {
        verdicts: {
          BTC: isRisk
            ? { direction: 'NEUTRAL', confidence: 70, veto: over.risk?.veto ?? null, reasons: ['guards nominal'] }
            : { direction: dir, confidence: conf, reasons: ['reason one', 'reason two'], levels: { entry: 68000, stop: 66800, t1: 69200 } },
        },
      },
      model: 'gemini',
    };
  };
}

describe('v11.0 council — seat availability + feature matrix', () => {
  it('India excludes the on-chain seat; crypto excludes options-flow (structural abstain)', () => {
    expect(availableRoles('INDIA')).toEqual(['technical', 'macro', 'sentiment', 'optionsflow', 'risk']);
    expect(availableRoles('CRYPTO')).toEqual(['technical', 'macro', 'sentiment', 'onchain', 'risk']);
    expect(availableRoles('FUTURES')).toContain('onchain');
    expect(availableRoles('FUTURES')).toContain('optionsflow');
  });

  it('feature matrix maps ctx honestly — every missing field is null, never guessed', () => {
    const f = buildFeatureMatrix({
      market: 'CRYPTO', symbol: 'BTC', sig: SIG(),
      regime: { btcChange: 1.5 }, mesh: { fundingRate: 0.0005, price: { price: 67900, agent: 'coingecko' } },
      sentCtx: null, eventCtx: { action: 'allow' }, riskCtx: { heatPct: 12, riskOff: false },
    });
    expect(f.symbol).toBe('BTC');
    expect(f.ltp).toBe(68000);
    expect(f.ta.rsi).toBe(62);
    expect(f.ta.atrPct).toBeCloseTo(1.32, 1);
    expect(f.ta.vwapDistPct).toBeCloseTo(1.19, 1);
    expect(f.macro.regimeChangePct).toBe(1.5);
    expect(f.onchain.fundingRate).toBe(0.0005);
    expect(f.sentiment).toBeNull();
    // missing-everything variant stays honest
    const f2 = buildFeatureMatrix({ market: 'CRYPTO', symbol: 'X', sig: {}, regime: {}, mesh: null, sentCtx: null, eventCtx: null, riskCtx: null });
    expect(f2.ta.rsi).toBeNull();
    expect(f2.ltp).toBeNull();
    expect(f2.ensemble.consensus.side).toBeNull();
  });

  it('priceDivergence flags >1.5% desk-vs-mesh mismatch', () => {
    const f = buildFeatureMatrix({ market: 'CRYPTO', symbol: 'BTC', sig: SIG({ ltp: 68000 }), regime: {}, mesh: { price: { price: 71000, agent: 'coingecko' } } });
    const d = priceDivergence(f);
    expect(d).toBeTruthy();
    expect(d.degraded).toBe(true);
    const f2 = buildFeatureMatrix({ market: 'CRYPTO', symbol: 'BTC', sig: SIG({ ltp: 68000 }), regime: {}, mesh: { price: { price: 68100, agent: 'coingecko' } } });
    expect(priceDivergence(f2)).toBeNull();
  });
});

describe('v11.0 council — verdict parsing + deterministic fallback', () => {
  it('parseVerdict normalizes direction vocabulary, clamps confidence, gate vetoes to the risk seat', () => {
    const v = parseVerdict('technical', { direction: 'buy', confidence: 130, reasons: ['a', 'b', 'c', 'd'], levels: { entry: 'x' } });
    expect(v.direction).toBe('LONG');
    expect(v.confidence).toBe(100);
    expect(v.reasons).toHaveLength(3);
    expect(v.levels.entry).toBeNull(); // non-finite level → null, never NaN
    const r = parseVerdict('risk', { direction: 'NEUTRAL', confidence: 70, veto: 'event_blackout' });
    expect(r.veto).toBe('event_blackout');
    const notRisk = parseVerdict('macro', { direction: 'LONG', confidence: 70, veto: 'event_blackout' });
    expect(notRisk.veto).toBeNull(); // veto power is the Risk Guardian's alone
    const bogus = parseVerdict('technical', { direction: 'SIDEWAYS', confidence: 'high' });
    expect(bogus.direction).toBe('NEUTRAL');
    expect(bogus.confidence).toBe(0);
  });

  it('deterministicVerdicts: technical follows the ensemble consensus; funding crowding flips on-chain SHORT', () => {
    const f = buildFeatureMatrix({
      market: 'CRYPTO', symbol: 'BTC', sig: SIG(),
      regime: { btcChange: 1.0 }, mesh: { fundingRate: 0.0009 }, riskCtx: { riskOff: false },
    });
    const v = deterministicVerdicts('CRYPTO', f);
    expect(v.technical.direction).toBe('LONG');
    expect(v.technical.confidence).toBeGreaterThan(50);
    expect(v.onchain.direction).toBe('SHORT'); // crowded longs = fragile
    expect(v.risk.veto).toBeNull();
    expect(v.optionsflow).toBeUndefined(); // structural abstain on CRYPTO
    // event blackout → risk veto fires in the deterministic path too
    const f2 = buildFeatureMatrix({ market: 'CRYPTO', symbol: 'BTC', sig: SIG(), regime: {}, riskCtx: { riskOff: false } });
    f2.risk.event = { kind: 'FOMC', inMin: 20, action: 'blackout' };
    const v2 = deterministicVerdicts('CRYPTO', f2);
    expect(v2.risk.veto).toBe('event_blackout');
  });
});

describe('v11.0 council — runCouncilBoard (the board hook path)', () => {
  it('LLM offline → deterministic verdicts, honestly tagged model=deterministic / freshness=model', async () => {
    _llm.on = false;
    const out = await runCouncilBoard({ market: 'CRYPTO', signals: [SIG()], regime: { btcChange: 1.2 }, deps: { KEYS: {} } });
    const r = out.bySymbol.BTC;
    expect(r).toBeTruthy();
    expect(r.model).toBe('deterministic');
    expect(r.freshness).toBe('model');
    expect(r.verdicts.technical.direction).toBe('LONG');
    expect(r.consensus.quorum).toBe(5); // CRYPTO seats
    expect(_llm.calls).toBe(0);
  });

  it('LLM online → exactly ONE batched call per available seat (5 for CRYPTO, NOT 5×N)', async () => {
    _llm.on = true;
    _llm.handler = personaHandler();
    const syms = [SIG(), SIG({ symbol: 'ETH', ltp: 3200, plan: { entry: 3200, stopLoss: 3100, target1: 3300, target2: 3400, rewardRisk: 2 } })];
    const out = await runCouncilBoard({ market: 'CRYPTO', signals: syms, regime: { btcChange: 0.8 }, deps: { KEYS: { gemini: 'k' } } });
    expect(_llm.calls).toBe(5); // 5 seats × 1 batched prompt each
    expect(out.bySymbol.BTC.verdicts.technical.direction).toBe('LONG');
    expect(out.bySymbol.ETH.verdicts.technical.direction).toBe('LONG');
    expect(out.bySymbol.BTC.model).toBe('gemini');
  });

  it('verdict cache: a second board run within 90s makes ZERO LLM calls', async () => {
    _llm.on = true;
    _llm.handler = personaHandler();
    await runCouncilBoard({ market: 'CRYPTO', signals: [SIG()], regime: {}, deps: { KEYS: { gemini: 'k' } } });
    const first = _llm.calls;
    const out2 = await runCouncilBoard({ market: 'CRYPTO', signals: [SIG()], regime: {}, deps: { KEYS: { gemini: 'k' } } });
    expect(_llm.calls).toBe(first);
    expect(out2.model).toBe('cached');
    expect(out2.bySymbol.BTC.verdicts.technical.direction).toBe('LONG');
  });

  it('partial LLM failure → failed seats fall back to quant votes, the council still stands', async () => {
    _llm.on = true;
    _llm.handler = (prompt) => {
      // technical + macro answer; every other seat fails JSON
      if (prompt.includes('TECHNICAL ANALYST') || prompt.includes('MACRO ECONOMIST')) return personaHandler()(prompt);
      return { json: { garbage: true }, model: 'gemini' };
    };
    const out = await runCouncilBoard({ market: 'CRYPTO', signals: [SIG()], regime: { btcChange: 1.2 }, deps: { KEYS: { gemini: 'k' } } });
    const v = out.bySymbol.BTC.verdicts;
    expect(v.technical.direction).toBe('LONG');           // LLM verdict
    expect(v.sentiment.direction).toBeDefined();          // quant fallback seat present
    expect(out.bySymbol.BTC.model).toBe('gemini');
  });

  it('risk veto (LLM) suppresses the gate even with a strong majority', async () => {
    _llm.on = true;
    _llm.handler = personaHandler({ risk: { veto: 'heat_cap' } });
    const out = await runCouncilBoard({ market: 'CRYPTO', signals: [SIG({ confidence: 90 })], regime: { btcChange: 1.2 }, deps: { KEYS: { gemini: 'k' } } });
    expect(out.bySymbol.BTC.gate.gate).toBe('SUPPRESSED');
    expect(out.bySymbol.BTC.gate.reasons.join(' ')).toContain('risk veto');
    expect(out.bySymbol.BTC.nearMissRecorded).toBe(true);
  });
});

describe('v11.0 council — runCouncilDeep (debate + judge) + the wire stamp', () => {
  it('deep mode: debate + judge run; the judge shift rides the technical seat, bounded ±8', async () => {
    _llm.on = true;
    _llm.handler = personaHandler();
    const out = await runCouncilDeep({ market: 'CRYPTO', symbol: 'BTC', sig: SIG(), regime: { btcChange: 1.0 }, deps: { KEYS: { gemini: 'k' } }, force: true });
    expect(out.debate).toBeTruthy();
    expect(out.debate.bull.case).toContain('bull');
    expect(out.debate.judge.favours).toBe('bull');
    expect(out.debate.judgeShift).toBe(6);
    expect(out.verdicts.technical.reasons.join(' ')).toContain('judge shift');
    // 5 seats + 3 debate calls = 8 (crypto: no optionsflow seat)
    expect(_llm.calls).toBe(8);
  });

  it('councilStampOf: the compact wire shape both desks render (bounded, UI-safe)', async () => {
    _llm.on = true;
    _llm.handler = personaHandler();
    const out = await runCouncilBoard({ market: 'CRYPTO', signals: [SIG()], regime: { btcChange: 1.0 }, deps: { KEYS: { gemini: 'k' } } });
    const stamp = councilStampOf(out.bySymbol.BTC);
    expect(stamp.model).toBe('gemini');
    expect(stamp.freshness).toBe('live');
    expect(stamp.agents).toHaveLength(5);
    expect(stamp.agents[0]).toEqual(expect.objectContaining({ role: 'technical', direction: 'LONG', confidence: 85 }));
    expect(stamp.agentReasons[0].reasons).toHaveLength(2);
    expect(stamp.levels).toEqual(expect.objectContaining({ entry: 68000, stop: 66800 }));
    expect(stamp.gate).toBe('PASSED');
    expect(stamp.generatedAt).toBeGreaterThan(0);
    expect(councilStampOf(null)).toBeNull();
    // JSON-serializable (the wire payload + ledger stamp constraint)
    expect(() => JSON.stringify(stamp)).not.toThrow();
  });

  it('councilEnabled flag: default OFF, =on flips it (the A/B master switch)', () => {
    expect(councilEnabled()).toBe(false);
    process.env.AI_ENABLE_GLOBAL_COUNCIL = 'on';
    expect(councilEnabled()).toBe(true);
    process.env.AI_ENABLE_GLOBAL_COUNCIL = '0';
    expect(councilEnabled()).toBe(false);
  });
});
