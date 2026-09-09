// ============================================================
// test/proTrader.test.ts — v7.0 SUPERINTELLIGENCE PRO TRADER
// ------------------------------------------------------------
// Tests:
//   1. computeSizingPreview — wallet-proportional sizing math
//   2. Agent config — v7.0 defaults, clamps, toggles
//   3. Spot Watcher Pro Partial TP:
//      - Stage 1: T1 hit -> 40% closed, SL moved to breakeven
//      - Stage 2: T2 hit -> 40% closed, 20% runner with SL at T1
//      - Stage 3: Runner close at SL / profit
//   4. Futures Watcher Pro Partial TP
//   5. agentStatus payload shape & sizing preview
// ============================================================
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

const mockPrivate = vi.fn();
vi.mock('../server/mcp/coindcx.js', () => ({
  coindcxPrivate: (...args: any[]) => mockPrivate(...args),
  coindcxConnected: () => true,
  coindcxStatus: () => ({ connected: true }),
  loadJSON: undefined, saveJSON: undefined,
}));
vi.mock('../server/ai/dhan.js', () => ({
  dhanConnected: () => false,
  dhanPlaceOrder: vi.fn(),
  dhanCancelOrder: vi.fn(),
}));

let _spotTickerPrice = 100;
vi.mock('../server/cryptoStream.js', () => ({
  fetchCoinDcxTickers: vi.fn(async () => [{ market: 'BTCINR', last_price: String(_spotTickerPrice) }]),
}));

let _futuresTickerPrice = 50000;

import {
  computeSizingPreview, loadAgentConfig, updateAgentConfig,
  agentStatus, __resetAgentForTests, AGENT_DEFAULTS,
} from '../server/ai/agent.js';
import {
  executeSignal, watchPositions, loadJournal, __resetForTests,
  loadConfig, updateConfig,
} from '../server/ai/coindcxOrders.js';
import {
  executeFuturesSignal, watchFuturesPositions,
} from '../server/ai/futures.js';

const STRONG_SPOT = {
  symbol: 'BTC', market: 'CRYPTO', side: 'LONG', grade: 'STRONG',
  confidence: 85, agreement: 0.8, generatedAt: Date.now(),
  ltp: 100, plan: {
    entry: 100, stopLoss: 95, target1: 105, target2: 110,
    risk: 5, riskPct: 5, rewardRisk: 2, atrUsed: 3, planStyle: 'atr-based',
  },
  votes: [], summary: 'Strong Bitcoin setup',
};

const STRONG_FUTURES = {
  symbol: 'BTC', market: 'FUTURES', pair: 'B-BTC_USDT', side: 'LONG', grade: 'STRONG',
  confidence: 88, agreement: 0.85, generatedAt: Date.now(),
  ltp: 50000, plan: {
    entry: 50000, stopLoss: 48000, target1: 52000, target2: 54000,
    risk: 2000, riskPct: 4, rewardRisk: 2, atrUsed: 1000, planStyle: 'atr-based',
  },
  votes: [], summary: 'Strong BTC Futures setup', executable: true,
};

const origFetch = globalThis.fetch;

beforeEach(() => {
  __resetForTests();
  __resetAgentForTests();
  mockPrivate.mockReset();
  _spotTickerPrice = 100;
  _futuresTickerPrice = 50000;
  globalThis.fetch = vi.fn(async (url: any) => {
    const u = String(url);
    if (u.includes('instrument')) {
      return {
        ok: true, status: 200,
        json: async () => ({ min_quantity: 0.0001, max_leverage: 10, quantity_precision: 4 }),
      };
    }
    if (u.includes('current_prices/futures/rt')) {
      return {
        ok: true, status: 200,
        json: async () => ({
          ts: Date.now(),
          prices: {
            'B-BTC_USDT': { ls: _futuresTickerPrice, pc: 2.5, h: 55000, l: 49000, v: 1000, mp: _futuresTickerPrice },
          },
        }),
      };
    }
    return { ok: true, status: 200, json: async () => ({}) };
  }) as any;
});

afterEach(() => {
  globalThis.fetch = origFetch;
});

describe('v7.0 Pro Trader — computeSizingPreview', () => {
  it('calculates risk and allocations proportionally from equity and risk %', () => {
    const preview = computeSizingPreview({
      equityINR: 50000,
      riskPerTradePct: 2.0,
      leverage: 3,
      usdInr: 84,
      deployableFuturesUSDT: 300,
      deployableSpotINR: 20000,
    });

    expect(preview.equityINR).toBe(50000);
    expect(preview.riskPerTradePct).toBe(2.0);
    expect(preview.riskINR).toBe(1000); // 2% of 50,000
    expect(preview.riskUSDT).toBeCloseTo(1000 / 84, 1); // ~11.9 USDT
    expect(preview.leverage).toBe(3);
    expect(preview.slotsPerDay).toBe(3);
    expect(preview.maxDailyRiskINR).toBe(3000); // 3 trades * 1000
    expect(preview.futuresCapUSDT).toBe(180); // 60% of 300
  });

  it('provides safe practice defaults when equity is zero or null', () => {
    const preview = computeSizingPreview({
      equityINR: 0,
      riskPerTradePct: 1.5,
      leverage: 3,
      usdInr: 84,
      deployableFuturesUSDT: 0,
      deployableSpotINR: 0,
    });
    expect(preview.equityINR).toBe(10000); // fallback practice equity
    expect(preview.riskINR).toBe(150);
  });
});

describe('v7.0 Pro Trader — Config & Defaults', () => {
  it('defaults to 40% T1, 40% T2, 20% runner with breakeven lock enabled', () => {
    const cfg = loadAgentConfig();
    expect(cfg.partialTpEnabled).toBe(true);
    expect(cfg.tp1ClosePct).toBe(40);
    expect(cfg.tp2ClosePct).toBe(40);
    expect(cfg.runnerPct).toBe(20);
    expect(cfg.breakEvenAfterTp1).toBe(true);
  });

  it('updates and clamps Pro Trader config values safely', () => {
    const updated = updateAgentConfig({
      tp1ClosePct: 50,
      tp2ClosePct: 30,
      runnerPct: 20,
      breakEvenAfterTp1: false,
    });
    expect(updated.tp1ClosePct).toBe(50);
    expect(updated.tp2ClosePct).toBe(30);
    expect(updated.runnerPct).toBe(20);
    expect(updated.breakEvenAfterTp1).toBe(false);

    // Test clamp out of bounds
    const clamped = updateAgentConfig({
      tp1ClosePct: 95, // max 80
      runnerPct: 80,   // max 50
    });
    expect(clamped.tp1ClosePct).toBe(80);
    expect(clamped.runnerPct).toBe(50);
  });
});

describe('v7.0 Pro Trader — Spot 3-Stage Auto Take-Profit Execution', () => {
  it('executes Stage 1: closes 40% at T1, moves SL to breakeven, and logs PARTIAL_TP', async () => {
    // Open paper position with source='agent' or partialTp=true
    const opened = await executeSignal({
      symbol: 'BTC',
      mode: 'paper',
      source: 'agent',
      qtyINR: 1000,
      getFreshSignal: async () => ({ ...STRONG_SPOT }),
    });
    expect(opened.ok).toBe(true);
    const initialQty = opened.position.qty; // 10 units at ₹100

    // Pass 1: price rises to 106 (Target 1 was 105)
    _spotTickerPrice = 106;
    const closures = await watchPositions({});
    expect(closures).toHaveLength(0); // position remains open with remaining qty!

    const j = loadJournal();
    const p = j.positions[0];
    expect(p.status).toBe('OPEN');
    expect(p.tp1Hit).toBe(true);
    expect(p.exitStage).toBe('TP1_BOOKED_BE_LOCKED');
    expect(p.sl).toBe(100); // moved to breakeven (entryPrice was 100)!
    expect(p.qty).toBeCloseTo(initialQty * 0.6, 2); // 40% sold -> 6 units left
    expect(p.bookedPnlINR).toBeGreaterThan(0); // 4 units * (106 - 100) = ₹24

    // Journal should have logged PARTIAL_TP entry
    const partialEntry = j.entries.find(e => e.kind === 'PARTIAL_TP' && e.stage === 'TP1');
    expect(partialEntry).toBeDefined();
    expect(partialEntry.sl).toBe(100);
    expect(partialEntry.pnlINR).toBeCloseTo(24, 0);

    // Pass 2: price rises to 111 (Target 2 was 110) -> Stage 2 triggers!
    _spotTickerPrice = 111;
    await watchPositions({});
    const j2 = loadJournal();
    const p2 = j2.positions[0];
    expect(p2.status).toBe('OPEN');
    expect(p2.tp2Hit).toBe(true);
    expect(p2.exitStage).toBe('RUNNER_ACTIVE');
    expect(p2.sl).toBe(105); // locked to T1 (105)!
    expect(p2.qty).toBeCloseTo(initialQty * 0.2, 2); // 20% runner remains!
    expect(p2.bookedPnlINR).toBeGreaterThan(24);

    const tp2Entry = j2.entries.find(e => e.kind === 'PARTIAL_TP' && e.stage === 'TP2');
    expect(tp2Entry).toBeDefined();
    expect(tp2Entry.sl).toBe(105);

    // Pass 3: price falls back to 104 -> hits locked SL @ 105 -> profitable close!
    _spotTickerPrice = 104;
    const finalClosures = await watchPositions({});
    expect(finalClosures).toHaveLength(1);

    const j3 = loadJournal();
    const p3 = j3.positions[0];
    expect(p3.status).toBe('CLOSED');
    expect(p3.closeReason).toContain('STOP-LOSS');
    expect(p3.pnlINR).toBeGreaterThan(0); // Entire trade ended with solid net profit!
  });
});

describe('v7.0 Pro Trader — Futures 3-Stage Auto Take-Profit Execution', () => {
  it('executes futures partial closes, locks breakeven, and maintains runner in USDT', async () => {
    const opened = await executeFuturesSignal({
      symbol: 'BTC',
      side: 'LONG',
      mode: 'paper',
      source: 'agent',
      marginUSDT: 100,
      leverage: 3,
      getFreshSignal: async () => ({ ...STRONG_FUTURES }),
    });
    expect(opened.ok).toBe(true);
    const initialQty = opened.position.qty;

    // Price crosses T1 (52,000)
    _futuresTickerPrice = 52500;
    await watchFuturesPositions({ maxAgeMs: 0 });

    let j = loadJournal();
    let p = j.positions.find(x => x.market === 'FUTURES');
    expect(p.status).toBe('OPEN');
    expect(p.tp1Hit).toBe(true);
    expect(p.exitStage).toBe('TP1_BOOKED_BE_LOCKED');
    expect(p.sl).toBe(50000); // Breakeven locked!
    expect(p.qty).toBeCloseTo(initialQty * 0.6, 4);

    const tp1Entry = j.entries.find(e => e.kind === 'PARTIAL_TP' && e.stage === 'TP1');
    expect(tp1Entry).toBeDefined();
    expect(tp1Entry.sl).toBe(50000);

    // Price crosses T2 (54,000)
    _futuresTickerPrice = 54500;
    await watchFuturesPositions({ maxAgeMs: 0 });

    j = loadJournal();
    p = j.positions.find(x => x.market === 'FUTURES');
    expect(p.tp2Hit).toBe(true);
    expect(p.exitStage).toBe('RUNNER_ACTIVE');
    expect(p.sl).toBe(52000); // Locked to T1!
    expect(p.qty).toBeCloseTo(initialQty * 0.2, 4); // 20% runner

    // Price reverses to 51,500 (below 52,000 locked stop)
    _futuresTickerPrice = 51500;
    const closures = await watchFuturesPositions({ maxAgeMs: 0 });
    expect(closures).toHaveLength(1);

    j = loadJournal();
    p = j.positions.find(x => x.market === 'FUTURES');
    expect(p.status).toBe('CLOSED');
    expect(p.pnlUSDT).toBeGreaterThan(0);
    expect(p.pnlINR).toBeGreaterThan(0);
  });
});

describe('v7.0 Pro Trader — agentStatus Integration', () => {
  it('returns SUPERINTELLIGENCE AGENT v7.0 PRO with sizing preview', async () => {
    const st = await agentStatus(null);
    expect(st.ok).toBe(true);
    expect(st.engine).toBe('SUPERINTELLIGENCE AGENT v7.0 PRO');
    expect(st.sizingPreview).toBeDefined();
    expect(st.sizingPreview?.equityINR).toBeGreaterThan(0);
    expect(st.sizingPreview?.riskINR).toBeGreaterThan(0);
    expect(st.sizingPreview?.slotsPerDay).toBe(3);
    expect(st.config.partialTpEnabled).toBe(true);
  });
});
