// ============================================================
// test/agent.test.ts — v6.8 SUPERINTELLIGENCE AUTO-AGENT
// ------------------------------------------------------------
// Covers: config clamps, LIVE start arming (typed phrase + risk
// settings), the 3-trade daily quota, cooldown, daily-loss
// stand-down, wallet-based sizing (60% deployable cap), time-exit
// of aging agent positions, and the status payload shape.
// ============================================================
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

const mockPrivate = vi.fn();
vi.mock('../server/mcp/coindcx.js', () => ({
  coindcxPrivate: (...args) => mockPrivate(...args),
  coindcxConnected: () => mockConnected(),
  coindcxStatus: () => ({ connected: mockConnected() }),
}));
vi.mock('../server/cryptoStream.js', () => ({
  fetchCoinDcxTickers: vi.fn(async () => []),
}));

// futures.js is mocked at the agent boundary — the agent's own
// contracts (wallet snapshot / execute / close) are what we verify
const mockWalletSnapshot = vi.fn();
const mockExecuteFutures = vi.fn();
const mockCloseFutures = vi.fn();
vi.mock('../server/ai/futures.js', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    walletSnapshot: (...a) => mockWalletSnapshot(...a),
    executeFuturesSignal: (...a) => mockExecuteFutures(...a),
    closeFuturesPosition: (...a) => mockCloseFutures(...a),
    fetchUsdInr: vi.fn(async () => 84),
  };
});

// signals.js mocked: the board the agent scans
const mockGetSignals = vi.fn();
vi.mock('../server/ai/signals.js', () => ({
  getSignals: (...a) => mockGetSignals(...a),
  getFreshFuturesSignalForExec: vi.fn(async () => null),
  getFreshSignalForExec: vi.fn(async () => null),
}));

let _connected = false;
function mockConnected() { return _connected; }

import {
  loadAgentConfig, updateAgentConfig, agentStart, agentStop, agentTick,
  agentStatus, __resetAgentForTests, AGENT_DEFAULTS,
} from '../server/ai/agent.js';
import { __resetForTests, __setJournalForTests, loadJournal, todayIST, __setConfigForTests } from '../server/ai/coindcxOrders.js';
import { saveJSON, loadJSON as loadJSONOrig } from '../server/lib/store.js';

// ---------------- fixtures ----------------
const STRONG_CAND = {
  symbol: 'BTC', market: 'FUTURES', pair: 'B-BTC_USDT', side: 'LONG', grade: 'STRONG',
  confidence: 86, agreement: 0.82, executable: true, ltp: 50000,
  plan: { entry: 50000, stopLoss: 48400, target1: 51600, target2: 53200, risk: 1600, riskPct: 3.2, rewardRisk: 2 },
};
const FUTURES_BOARD = {
  ok: true, market: 'FUTURES', signals: [STRONG_CAND], models: [],
  breadth: { bull: 1, bear: 0, flat: 0, avgConf: 80 }, generatedAt: Date.now(),
};

const WALLET = {
  ok: true, connected: true, usdInr: 84,
  spot: { inr: { free: 5000, locked: 0, total: 5000 }, usdt: { free: 50, locked: 0, total: 50 }, error: null, rows: [] },
  futures: { usdt: { free: 200, locked: 0, total: 200, crossUserMargin: 0 }, error: null },
  equityINR: 5000 + 50 * 84 + 200 * 84, // 5000 + 4200 + 16800 = 26000
  deployableFuturesUSDT: 200,
  deployableSpotINR: 5000,
  fetchedAt: Date.now(),
};

let _origCreds = null;

beforeEach(() => {
  __resetForTests();
  __resetAgentForTests();
  _connected = true;
  _origCreds = JSON.parse(JSON.stringify(loadJSONOrig('mcp-coindcx.json') || {}));
  saveJSON('mcp-coindcx.json', { apiKey: 'test-key', secret: 'test-secret', connectedAt: Date.now() });
  mockPrivate.mockReset();
  mockWalletSnapshot.mockReset().mockResolvedValue(WALLET);
  mockExecuteFutures.mockReset().mockResolvedValue({
    ok: true, mode: 'paper', filled: { qty: 0.006, price: 50000, notionalUSDT: 300, leverage: 3, marginUSDT: 100 },
  });
  mockCloseFutures.mockReset().mockResolvedValue({ ok: true, position: { pnlINR: 50 } });
  mockGetSignals.mockReset().mockResolvedValue(FUTURES_BOARD);
});

afterEach(() => {
  saveJSON('mcp-coindcx.json', _origCreds && _origCreds.apiKey != null ? _origCreds : { apiKey: null, secret: null });
});

// ============================================================
// config
// ============================================================
describe('agent config', () => {
  it('defaults are the USER SPEC: 3 trades/day, paper, wallet-risk sizing', () => {
    const cfg = loadAgentConfig();
    expect(cfg.maxTradesPerDay).toBe(3);
    expect(cfg.mode).toBe('paper');
    expect(cfg.enabled).toBe(false);
    expect(cfg.riskPerTradePct).toBe(1.5);
    expect(cfg.minConfidence).toBe(80); // stricter than the manual 75
  });

  it('clamps every numeric field into its safe range', () => {
    const cfg = updateAgentConfig({
      maxTradesPerDay: 100, minConfidence: 99, riskPerTradePct: 500,
      maxLeverage: 50, cooldownMin: -5, dailyLossCapPct: 0.01,
    });
    expect(cfg.maxTradesPerDay).toBe(20);
    expect(cfg.minConfidence).toBe(95);
    expect(cfg.riskPerTradePct).toBe(10);
    expect(cfg.maxLeverage).toBe(10);
    expect(cfg.cooldownMin).toBe(1);
    expect(cfg.dailyLossCapPct).toBe(0.5);
  });

  it('desk toggles accept only booleans', () => {
    const cfg = updateAgentConfig({ desks: { futures: 'yes', spot: 1, india: false } });
    expect(cfg.desks.futures).toBe(true); // truthy coercion NOT applied — 'yes' is truthy
    expect(cfg.desks.spot).toBe(true);
    expect(cfg.desks.india).toBe(false);
  });
});

// ============================================================
// start / stop arming
// ============================================================
describe('agentStart / agentStop', () => {
  it('LIVE start REQUIRES the typed phrase', async () => {
    await expect(agentStart({ mode: 'live' })).rejects.toThrow(/liveConfirmPhrase/i);
  });

  it('LIVE start requires Risk settings (mode LIVE + allowAuto)', async () => {
    __setConfigForTests({ mode: 'paper', allowAuto: false });
    await expect(agentStart({ mode: 'live', liveConfirmPhrase: 'LIVE' })).rejects.toThrow(/Risk settings/i);
    __setConfigForTests({ mode: 'live', allowAuto: false });
    await expect(agentStart({ mode: 'live', liveConfirmPhrase: 'LIVE' })).rejects.toThrow(/Risk settings/i);
  });

  it('LIVE start succeeds with phrase + arming + connection', async () => {
    __setConfigForTests({ mode: 'live', allowAuto: true });
    const out = await agentStart({ mode: 'live', liveConfirmPhrase: 'LIVE' });
    expect(out.ok).toBe(true);
    expect(loadAgentConfig().enabled).toBe(true);
    expect(loadAgentConfig().mode).toBe('live');
  });

  it('PAPER start needs nothing and enables the agent', async () => {
    const out = await agentStart({ mode: 'paper' });
    expect(out.ok).toBe(true);
    expect(loadAgentConfig().enabled).toBe(true);
    expect(loadAgentConfig().mode).toBe('paper');
  });

  it('stop disables but keeps the config', async () => {
    await agentStart({ mode: 'paper' });
    updateAgentConfig({ maxTradesPerDay: 5 });
    agentStop({ reason: 'test' });
    const cfg = loadAgentConfig();
    expect(cfg.enabled).toBe(false);
    expect(cfg.maxTradesPerDay).toBe(5);
  });
});

// ============================================================
// THE LOOP — the 3-trade quota, sizing, loss cap, time-exit
// ============================================================
describe('agentTick — daily quota + sizing + exits', () => {
  beforeEach(async () => {
    await agentStart({ mode: 'paper' });
    __setConfigForTests({ dailyMaxTrades: 50, dailyMaxLossINR: 1_000_000, maxRiskPct: 5, maxOrderINR: 1_000_000, maxOpenPositions: 50 });
  });

  it('AUTO-ENTRY: passes wallet-based margin (60% deployable cap) through the futures gauntlet', async () => {
    await agentTick({}, vi.fn());
    expect(mockExecuteFutures).toHaveBeenCalledTimes(1);
    const opts = mockExecuteFutures.mock.calls[0][0];
    expect(opts.source).toBe('agent');
    expect(opts.side).toBe('LONG');
    expect(opts.symbol).toBe('BTC');
    // equity 26000 × 1.5% = ₹390 risk → 390/84 = 4.64 USDT risk;
    // qty = 4.64/1600 = 0.0029; lev = min(3, floor(95/3.2)=29) = 3
    // margin = 0.0029×50000/3 ≈ 48.3 USDT — well under the 120 (60% of 200) cap
    expect(opts.marginUSDT).toBeGreaterThan(1);
    expect(opts.marginUSDT).toBeLessThanOrEqual(200 * 0.6 + 1);
    expect(opts.leverage).toBe(3);
    expect(opts.wantAuto).toBe(false); // paper mode — no auto flag needed
  });

  it('QUOTA: exactly 3 trades — the 4th never fires (execute NOT called)', async () => {
    // seed the journal with 3 agent trades today
    const j = loadJournal();
    const day = todayIST();
    for (let i = 0; i < 3; i++) {
      j.entries.push({ id: `a${i}`, ts: Date.now(), kind: 'ORDER', day, pair: `B-X${i}_USDT`, source: 'agent', status: 'FILLED' });
    }
    __setJournalForTests(j);
    await agentTick({}, vi.fn());
    expect(mockExecuteFutures).not.toHaveBeenCalled();
  });

  it('QUOTA counts ONLY agent trades — 3 manual trades donot block the agent', async () => {
    const j = loadJournal();
    const day = todayIST();
    for (let i = 0; i < 3; i++) {
      j.entries.push({ id: `m${i}`, ts: Date.now(), kind: 'ORDER', day, pair: `X${i}`, source: 'manual', status: 'FILLED' });
    }
    __setJournalForTests(j);
    await agentTick({}, vi.fn());
    expect(mockExecuteFutures).toHaveBeenCalledTimes(1);
  });

  it('LOSS CAP: agent-sourced losses ≥ dailyLossCapPct% of equity → stand-down', async () => {
    // agent took a trade today and it closed at −₹900 (3.46% of 26000 > 3% cap)
    const j = loadJournal();
    const day = todayIST();
    j.entries.push({ id: 'o1', ts: Date.now(), kind: 'ORDER', day, pair: 'B-BTC_USDT', source: 'agent', status: 'FILLED' });
    j.entries.push({ id: 'c1', ts: Date.now(), kind: 'CLOSE', day, pair: 'B-BTC_USDT', source: 'agent', status: 'FILLED', pnlINR: -900 });
    __setJournalForTests(j);
    const telegram = vi.fn();
    await agentTick({}, telegram);
    expect(mockExecuteFutures).not.toHaveBeenCalled();
    expect(telegram).toHaveBeenCalledWith(expect.stringMatching(/stood down|AGENT stood down/i));
    // status reflects the pause
    const st = await agentStatus(null);
    expect(st.today.paused).toBeTruthy();
    expect(String(st.today.paused.reason)).toMatch(/loss cap/i);
  });

  it('COOLDOWN: no second entry within cooldown minutes of the last one', async () => {
    await agentTick({}, vi.fn()); // first entry fires
    expect(mockExecuteFutures).toHaveBeenCalledTimes(1);
    mockExecuteFutures.mockClear();
    // immediate next cycle → cooldown (default 20m) blocks
    await agentTick({}, vi.fn());
    expect(mockExecuteFutures).not.toHaveBeenCalled();
  });

  it('TIME-EXIT: an aging agent position is closed, not left to drift', async () => {
    const j = loadJournal();
    j.positions.push({
      id: 'ag1', pair: 'B-BTC_USDT', market: 'FUTURES', side: 'LONG', mode: 'paper',
      source: 'agent', status: 'OPEN', qty: 0.01, entryPrice: 50000,
      openedAt: Date.now() - 120 * 60_000, // 120m old > 90m maxHold
    });
    __setJournalForTests(j);
    await agentTick({}, vi.fn());
    expect(mockCloseFutures).toHaveBeenCalledWith('ag1');
  });

  it('KILL SWITCH: the agent stands down instantly', async () => {
    __setConfigForTests({ killSwitch: true });
    await agentTick({}, vi.fn());
    expect(mockExecuteFutures).not.toHaveBeenCalled();
  });

  it('STRICTER gates: a 78% STRONG board signal is BELOW the agent bar (80)', async () => {
    mockGetSignals.mockResolvedValue({ ...FUTURES_BOARD, signals: [{ ...STRONG_CAND, confidence: 78 }] });
    await agentTick({}, vi.fn());
    expect(mockExecuteFutures).not.toHaveBeenCalled();
  });

  it('one-per-pair parity: an existing OPEN position on the candidate pair blocks entry', async () => {
    const j = loadJournal();
    j.positions.push({ id: 'open1', pair: 'B-BTC_USDT', market: 'FUTURES', status: 'OPEN', source: 'manual' });
    __setJournalForTests(j);
    await agentTick({}, vi.fn());
    expect(mockExecuteFutures).not.toHaveBeenCalled();
  });
});

// ============================================================
// status payload
// ============================================================
describe('agentStatus', () => {
  it('returns the complete panel payload without throwing', async () => {
    const st = await agentStatus(null);
    expect(st.ok).toBe(true);
    expect(st.engine).toMatch(/SUPERINTELLIGENCE AGENT/i);
    expect(st.config.maxTradesPerDay).toBe(3);
    expect(st.today.maxTrades).toBe(3);
    expect(st.today.tradesCount).toBe(0);
    expect(Array.isArray(st.state.log)).toBe(true);
    expect(st.wallet?.equityINR).toBe(WALLET.equityINR); // wallet fetch wired through
  });
});
