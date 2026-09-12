// ============================================================
// test/cryptoAgent.test.ts — CRYPTO DESK MCP AGENT (v10.1)
// ------------------------------------------------------------
// Pins the 8-tool registry, the FULL-TICKET prompt discipline
// (shared with the intraday agent), and the tool implementations
// that don't need network (sizing math + agent status). Live-data
// tools are shape-checked with their fetchers mocked.
// ============================================================
import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('../server/mcp/coindcx.js', () => ({
  coindcxConnected: () => false,
  coindcxPrivate: vi.fn(),
  coindcxStatus: () => ({ connected: false }),
}));

const mockGetSignals = vi.fn();
const mockGetDeepSignal = vi.fn();
vi.mock('../server/ai/signals.js', () => ({
  getSignals: (...a) => mockGetSignals(...a),
  getDeepSignal: (...a) => mockGetDeepSignal(...a),
  buildRegime: vi.fn(async () => ({ btcChange: 1.2, btcTrend: 'UP' })),
  getFreshSignalForExec: vi.fn(async () => null),
  getFreshFuturesSignalForExec: vi.fn(async () => null),
}));

const mockWalletSnapshot = vi.fn();
vi.mock('../server/ai/futures.js', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    walletSnapshot: (...a) => mockWalletSnapshot(...a),
    fetchUsdInr: vi.fn(async () => 84),
    executeFuturesSignal: vi.fn(),
    closeFuturesPosition: vi.fn(),
  };
});

const mockAgentStatus = vi.fn();
vi.mock('../server/ai/agent.js', () => ({
  loadAgentConfig: () => ({ enabled: true, mode: 'paper', minAiScore: 75, rollingWindow: 10, minRollingWinRate: 35, correlationGuard: true, dynamicTimeExit: true, maxHoldMin: 90 }),
  agentStatus: (...a) => mockAgentStatus(...a),
}));

import {
  CRYPTO_AGENT_TOOLS, buildCryptoSystemPrompt, runCryptoAgent, __internals,
} from '../server/ai/cryptoAgent.js';

const { executeCryptoTool, fullTicketRules } = __internals;

const DEPS = { KEYS: {}, OPENAI_COMPAT: {} };

// ============================================================
// the tool registry — 8 tools, OpenAI function format
// ============================================================
describe('crypto agent registry', () => {
  it('exposes exactly the 8 planned tools', () => {
    const names = CRYPTO_AGENT_TOOLS.map(t => t.function.name);
    expect(names).toEqual([
      'get_live_crypto_signals', 'analyze_coin', 'get_wallet', 'get_open_positions',
      'get_market_regime', 'get_track_record', 'calculate_position_size', 'get_agent_status',
    ]);
    for (const t of CRYPTO_AGENT_TOOLS) {
      expect(t.type).toBe('function');
      expect(t.function.description.length).toBeGreaterThan(30);
    }
  });

  it('sizing tool description mandates max-sane-leverage (plan Part 1.1)', () => {
    const t = CRYPTO_AGENT_TOOLS.find(x => x.function.name === 'calculate_position_size');
    expect(t.function.description).toMatch(/max SANE leverage/i);
  });
});

// ============================================================
// Part 2 — the FULL-TICKET discipline
// ============================================================
describe('full-ticket prompt discipline (Part 2)', () => {
  it('the rules demand every ticket component and reject incomplete tickets', () => {
    const r = fullTicketRules();
    for (const piece of ['Symbol + Direction', 'Entry zone', 'Stop-loss', 'Target 1, Target 2', 'Position size', 'Confidence', 'Time-window']) {
      expect(r).toContain(piece);
    }
    expect(r).toMatch(/INCOMPLETE TICKET/i);
  });

  it('crypto system prompt carries the full-ticket rules + live context', () => {
    const p = buildCryptoSystemPrompt({
      utcTime: '10:30 UTC', btcRegime: 'BTC +1.2% 24h (RISK-ON)', fng: 'Fear&Greed 56 (Greed)',
      funding: '0.34 bps/8h', connected: false, aiOnline: false,
    });
    expect(p).toContain('FULL-TICKET');
    expect(p).toContain('BTC +1.2% 24h (RISK-ON)');
    expect(p).toContain('Fear&Greed 56');
    expect(p).toMatch(/NOT CONNECTED/i); // honest wallet state
  });

  it('runCryptoAgent returns the session context + honest failure without keys', async () => {
    const out = await runCryptoAgent([{ role: 'user', content: 'test' }], { KEYS: {}, OPENAI_COMPAT: {} });
    expect(out.ok).toBe(false);
    expect(out.error).toMatch(/no AI keys configured/i);
    expect(out.session.utcTime).toBeTruthy();
  });
});

// ============================================================
// tool implementations (offline paths)
// ============================================================
describe('executeCryptoTool', () => {
  beforeEach(() => {
    mockGetSignals.mockReset().mockResolvedValue({ ok: true, market: 'CRYPTO', signals: [{
      symbol: 'SOL', side: 'LONG', grade: 'STRONG', confidence: 82, ltp: 9000, changePct: 2.1,
      voters: 9, totalModels: 11, agreement: 0.85, superIntel: { aiScore: 83 },
      plan: { entry: 9000, stopLoss: 8600, target1: 9400, target2: 9800, riskPct: 4.4, rewardRisk: 2 },
      aiNote: { note: 'strong tape' },
    }] });
    mockGetDeepSignal.mockReset().mockResolvedValue({
      ok: true, signal: {
        symbol: 'SOL', side: 'LONG', grade: 'STRONG', confidence: 82, agreement: 0.85,
        voters: 9, totalModels: 11, ltp: 9000, changePct: 2.1,
        superIntel: { aiScore: 83, tier: 'STRONG', drivers: ['trend'], blueprint: { entryTiming: 'NOW' } },
        plan: { entry: 9000, stopLoss: 8600, target1: 9400, target2: 9800, riskPct: 4.4, rewardRisk: 2, planStyle: 'atr-based' },
        quality: { veto: null, mtf: { phase: 'TRENDING', aligned: true }, session: { tradeable: true }, stopStyle: 'swing-structure' },
        votes: [{ name: 'TrendMatrix', dir: 1, conf: 80, reasons: ['stack up'] }],
        aiNote: { note: 'yes' },
      },
    });
    mockWalletSnapshot.mockReset();
    mockAgentStatus.mockReset().mockResolvedValue({
      ok: true, today: { tradesCount: 1, maxTrades: 3, realizedPnlINR: 40 }, accuracy: { rollingWinRate: null, rollingWindow: 10, correlationGuard: true, dynamicTimeExit: true },
      openPositions: [], blockers: [],
    });
  });

  it('get_live_crypto_signals maps the board into compact tickets', async () => {
    const out = await executeCryptoTool('get_live_crypto_signals', {}, DEPS);
    expect(out.SPOT[0]).toMatchObject({ symbol: 'SOL', side: 'LONG' });
    expect(out.SPOT[0].plan.entry).toBe(9000);
    expect(out.SPOT[0].aiScore).toBe(83);
  });

  it('analyze_coin deep-scans with votes + blueprint', async () => {
    const out = await executeCryptoTool('analyze_coin', { symbol: 'SOL' }, DEPS);
    expect(out.symbol).toBe('SOL');
    expect(out.votes[0].model).toBe('TrendMatrix');
    expect(out.blueprint.entryTiming).toBe('NOW');
  });

  it('get_wallet is honest when CoinDCX is not connected', async () => {
    const out = await executeCryptoTool('get_wallet', {}, DEPS);
    expect(out.connected).toBe(false);
    expect(out.note).toMatch(/not connected/i);
  });

  it('calculate_position_size computes qty, R-targets and MAX SANE LEVERAGE', async () => {
    const out = await executeCryptoTool('calculate_position_size', {
      entry: 50000, stopLoss: 48400, capital: 1000, riskPercent: 1.5,
    }, DEPS);
    // risk ₹15 at a ₹1600 stop distance → 0.009375 qty
    expect(out.riskAmount).toBe(15);
    expect(out.recommendedQty).toBeCloseTo(0.009375, 5);
    expect(out.target1_1R).toBe(51600);
    expect(out.target2_2R).toBe(53200);
    // stop distance 3.2% → 95/3.2 = 29.68 → capped at 10
    expect(out.maxSaneLeverage).toBe(10);
    expect(out.warning).toMatch(/liquidation/i);
  });

  it('calculate_position_size rejects junk inputs', async () => {
    expect((await executeCryptoTool('calculate_position_size', { entry: 0, stopLoss: 10 }, DEPS)).error).toBeTruthy();
    expect((await executeCryptoTool('calculate_position_size', { entry: 10, stopLoss: 10 }, DEPS)).error).toBeTruthy();
  });

  it('get_agent_status surfaces the accuracy-guard state (B1-B4 transparency)', async () => {
    const out = await executeCryptoTool('get_agent_status', {}, DEPS);
    expect(out.mode).toBe('paper');
    expect(out.correlationGuard).toBe(true);
    expect(out.rollingWinRate).toBeNull(); // honest: no sample yet
  });

  it('unknown tool → honest error', async () => {
    expect((await executeCryptoTool('make_money', {}, DEPS)).error).toMatch(/Unknown tool/i);
  });
});
