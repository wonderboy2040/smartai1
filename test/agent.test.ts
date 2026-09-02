// ============================================================
// Pro Trader MCP Agent — unit tests (tool layer, no network)
// ============================================================
import { describe, it, expect, vi } from 'vitest';
import { PRO_TRADER_AGENT_TOOLS, buildProTraderSystemPrompt, __internals } from '../server/intraday/agent.js';

const { executeAgentTool } = __internals;

const baseDeps = {
  KEYS: { tavily: 'test-key' },
  getLastScan: () => null,
  triggerScan: vi.fn(async () => null),
  fetchGrowwNseQuote: vi.fn(async () => ({ price: 1234.5, change: 1.2, high: 1250, low: 1220, volume: 1e6 })),
  getTrackRecord: vi.fn(() => ({
    days: 7, totalTracked: 20, resolved: 14, wins: 8, losses: 6,
    winRate: 57.1, avgR: 0.42, disciplinedPnlPerLakh: 3200, openCount: 2,
    history: [{ symbol: 'RELIANCE', direction: 'LONG', dayKey: '2026-08-27', status: 'T2_HIT', confidence: 82, rMultiple: 2.6, pnl: 2600 }],
  })),
  getPaperSummary: vi.fn(() => ({
    stats: { openCount: 1, dayRealizedPnl: 500, dayUnrealizedPnl: -100, totalRealizedPnl: 4500, wins: 5, losses: 2 },
    open: [{ symbol: 'TCS', direction: 'LONG', entry: 3800, remainingQty: 10, stopLoss: 3750, target1: 3880, lastPrice: 3840, unrealizedPnl: 400, t1Hit: false }],
    closedToday: [{ symbol: 'INFY', direction: 'SHORT', realizedPnl: 500, closeReason: 'T1_HIT' }],
  })),
  analyzeSymbol: vi.fn(async (sym) => ({
    symbol: sym, ltp: 1234.5, changePct: 1.2, direction: 'LONG', quantConfidence: 78,
    entry: 1234.5, entryZoneLow: 1230, entryZoneHigh: 1236, stopLoss: 1210,
    target1: 1275, target2: 1320, trailingSL: 1220, rr: 1.6, effRR: 1.5,
    qtyPerLakh: 40, trendStrength: 'BUILDING', rsi: 58, adx: 24, vwap: 1230,
    vwapDist: 0.35, volumeRatio: 1.4, gapPct: 0.5, orbMode: 'PROXY',
    counterTrend: false, reasons: ['EMA10/20 bullish stack'],
    freshEntriesAllowed: true,
  })),
  getMarketRegime: vi.fn(async () => ({ regime: 'BULLISH', vix: 13.2, vixLevel: 'LOW', niftyChange: 0.55, niftyVwapDist: 0.3 })),
};

describe('PRO_TRADER_AGENT_TOOLS', () => {
  it('has all 9 intraday tools with unique names (v4: +get_detailed_signal_analysis)', () => {
    const names = PRO_TRADER_AGENT_TOOLS.map(t => t.function.name);
    expect(names).toHaveLength(9);
    expect(new Set(names).size).toBe(9);
    expect(names).toContain('get_live_intraday_signals');
    expect(names).toContain('analyze_setup');
    expect(names).toContain('get_detailed_signal_analysis');
    expect(names).toContain('calculate_position_size');
  });

  it('every tool has a description and parameters schema', () => {
    for (const t of PRO_TRADER_AGENT_TOOLS) {
      expect(t.function.description.length).toBeGreaterThan(40);
      expect(t.function.parameters).toBeDefined();
      expect(t.type).toBe('function');
    }
  });
});

describe('buildProTraderSystemPrompt', () => {
  it('injects live session context (time, phase, market status)', () => {
    const p = buildProTraderSystemPrompt({ istTime: '10:30 IST', phase: 'full', marketOpen: true, weekday: 'Fri' });
    expect(p).toContain('10:30 IST');
    expect(p).toContain('phase: full');
    expect(p).toContain('OPEN');
    // Risk discipline is baked in
    expect(p).toContain('15:00 IST');
    expect(p).toContain('15:10 IST');
    expect(p).toContain('1%');
  });
});

describe('executeAgentTool', () => {
  it('get_market_regime returns live regime', async () => {
    const r = await executeAgentTool('get_market_regime', {}, baseDeps);
    expect(r.regime).toBe('BULLISH');
    expect(r.vix).toBe(13.2);
  });

  it('analyze_setup returns full trade plan (symbol normalized to upper)', async () => {
    const r = await executeAgentTool('analyze_setup', { symbol: 'reliance' }, baseDeps);
    expect(r.symbol).toBe('RELIANCE');
    expect(r.direction).toBe('LONG');
    expect(r.stopLoss).toBe(1210);
    expect(r.target1).toBe(1275);
  });

  it('get_intraday_quote returns LTP', async () => {
    const r = await executeAgentTool('get_intraday_quote', { symbol: 'TCS' }, baseDeps);
    expect(r.ltp).toBe(1234.5);
    expect(r.changePct).toBe(1.2);
  });

  it('get_track_record returns win-rate accountability', async () => {
    const r = await executeAgentTool('get_track_record', { days: 7 }, baseDeps);
    expect(r.winRate).toBeCloseTo(57.1, 1);
    expect(r.recentHistory).toHaveLength(1);
  });

  it('get_paper_positions returns open + closed trades', async () => {
    const r = await executeAgentTool('get_paper_positions', {}, baseDeps);
    expect(r.open[0].symbol).toBe('TCS');
    expect(r.closedToday[0].closeReason).toBe('T1_HIT');
  });

  it('get_live_intraday_signals triggers scan when cache is cold', async () => {
    const r = await executeAgentTool('get_live_intraday_signals', {}, baseDeps);
    expect(baseDeps.triggerScan).toHaveBeenCalled();
    expect(r.error).toBeDefined(); // triggerScan mock returns null → honest error
  });

  it('get_live_intraday_signals serves cached scan when fresh', async () => {
    const deps = {
      ...baseDeps,
      getLastScan: () => ({
        marketOpen: true, asOf: new Date().toISOString(),
        marketRegime: { regime: 'NEUTRAL' }, freshEntriesAllowed: true,
        signals: [{ symbol: 'SBIN', direction: 'LONG', confidence: 84, ltp: 800, changePct: 0.9, entry: 800, entryZoneLow: 795, entryZoneHigh: 802, stopLoss: 780, target1: 832, target2: 852, rr: 1.6, effRR: 1.5, qtyPerLakh: 50, trendStrength: 'STRONG', rsi: 60, adx: 30, volumeRatio: 1.8, vwapDist: 0.4, counterTrend: false, aiNote: '', reasons: ['EMA stack'] }],
      }),
      triggerScan: vi.fn(),
    };
    const r = await executeAgentTool('get_live_intraday_signals', {}, deps);
    expect(deps.triggerScan).not.toHaveBeenCalled();
    expect(r.signals[0].symbol).toBe('SBIN');
    expect(r.signals[0].entryZone).toEqual([795, 802]);
  });

  it('calculate_position_size computes 1% risk sizing correctly', async () => {
    const r = await executeAgentTool('calculate_position_size', { entry: 100, stopLoss: 98, capital: 100000, riskPercent: 1 }, baseDeps);
    // risk/share = 2 → 1000/2 = 500 qty → 50k deployed = 50% → should note the 25% cap
    expect(r.recommendedQty).toBe(500);
    expect(r.riskAmount).toBe(1000);
    expect(r.note).toContain('capped');
  });

  it('calculate_position_size rejects invalid inputs', async () => {
    const r = await executeAgentTool('calculate_position_size', { entry: 0, stopLoss: 0 }, baseDeps);
    expect(r.error).toBeDefined();
  });

  it('search_market_news reports missing Tavily key honestly', async () => {
    const r = await executeAgentTool('search_market_news', { query: 'IT sector' }, { ...baseDeps, KEYS: {} });
    expect(r.error).toContain('Tavily');
  });

  it('unknown tool returns error', async () => {
    const r = await executeAgentTool('make_coffee', {}, baseDeps);
    expect(r.error).toContain('Unknown tool');
  });
});
