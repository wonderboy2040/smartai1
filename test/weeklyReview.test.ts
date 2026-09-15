// ============================================================
// test/weeklyReview.test.ts — v10.9 #3 WEEKLY DIGEST
// ------------------------------------------------------------
// Pins: the quant layer (rolling 7-IST-day closes, wins/losses, best/
// worst, byMode, topPairs, partials), the no-activity honesty, the
// LLM-narration contract (quant block in the prompt, header always
// visible even without an LLM), per-week caching, and the Sunday
// push flag.
// ============================================================
import { describe, it, expect, beforeEach, vi } from 'vitest';

const JOURNAL = {
  entries: [
    // in-window closes (rolling last 7 IST days from NOW)
    { kind: 'CLOSE', day: '2026-09-15', pair: 'BTCUSDT', pnlINR: 500, mode: 'paper', reason: 'target-2' },
    { kind: 'CLOSE', day: '2026-09-14', pair: 'ETHUSDT', pnlINR: -200, mode: 'live', reason: 'stop-loss' },
    { kind: 'CLOSE', day: '2026-09-12', pair: 'BTCUSDT', pnlINR: 150, mode: 'paper', reason: 'time-exit' },
    { kind: 'PARTIAL_TP', day: '2026-09-13', pair: 'SOLUSDT', pnlINR: 80, mode: 'paper' },
    // out-of-window
    { kind: 'CLOSE', day: '2026-08-30', pair: 'DOGEUSDT', pnlINR: 9999, mode: 'paper' },
    // noise
    { kind: 'ORDER', day: '2026-09-15', pair: 'X', pnlINR: 1 },
  ],
};
const mockLoadJournal = vi.fn(() => JOURNAL);
const mockTrust = vi.fn(() => ({
  settled: 42, sufficient: true, brier: 0.18, brierVerdict: 'good', drift: -2,
  overall: { winRate: 58, avgConfidence: 70 },
  calibration: [{ bucket: '60-70', claimed: 65, winRate: 55, n: 12 }],
}));
const mockAskLLM = vi.fn(async () => null); // default: no LLM
const mockGetJournal = vi.fn(() => ({ stats: { count: 3, wins: 2, losses: 1, netPnl: 310, avgR: 0.9 } }));
const mockSendTG = vi.fn(async () => ({ ok: true }));
const mockTGConfig = vi.fn(() => ({ token: 'T', chatId: 'C' }));

vi.mock('../server/ai/coindcxOrders.js', () => ({
  loadJournal: () => mockLoadJournal(),
}));
vi.mock('../server/ai/trust.js', () => ({
  trustReport: () => mockTrust(),
}));
vi.mock('../server/intraday/agent.js', () => ({
  askLLM: (...a) => mockAskLLM(...a),
}));
vi.mock('../server/intraday/journal.js', () => ({
  getJournal: () => mockGetJournal(),
  getWeekKey: () => '2026-W38',
}));
vi.mock('../server/ai/secrets.js', () => ({
  telegramConfig: () => mockTGConfig(),
  sendTelegramMessage: (...a) => mockSendTG(...a),
}));

import {
  computeAiDeskWeek, weeklyQuantView, quantHeaderBlock,
  runWeeklyPerformanceReview, weeklyAutoPushEnabled,
  __resetWeeklyReviewForTests,
} from '../server/ai/weeklyReview.js';

const NOW = new Date('2026-09-15T10:00:00+05:30').getTime(); // IST midday

beforeEach(() => {
  __resetWeeklyReviewForTests();
  mockAskLLM.mockReset().mockResolvedValue(null);
  mockLoadJournal.mockClear();
  mockSendTG.mockClear();
  mockTGConfig.mockClear().mockReturnValue({ token: 'T', chatId: 'C' });
});

// ============================================================
// quant layer (pure)
// ============================================================
describe('computeAiDeskWeek', () => {
  it('aggregates the rolling 7-IST-day window honestly', () => {
    const w = computeAiDeskWeek(JOURNAL, { now: NOW });
    expect(w.trades).toBe(3);        // the 3 in-window closes
    expect(w.wins).toBe(2);
    expect(w.losses).toBe(1);
    expect(w.winRate).toBe(66.7);
    expect(w.netPnlINR).toBe(450);   // 500 - 200 + 150
    expect(w.avgPnlINR).toBe(150);
    expect(w.partialBookings).toBe(1);
    expect(w.hadActivity).toBe(true);
  });
  it('excludes anything older than the window', () => {
    const w = computeAiDeskWeek(JOURNAL, { now: NOW });
    expect(w.best.pair).toBe('BTCUSDT');
    expect(w.worst.pair).toBe('ETHUSDT');
    expect(w.byMode).toEqual({ paper: 2, live: 1 });
    expect(w.topPairs[0]).toEqual({ pair: 'BTCUSDT', n: 2 });
  });
  it('empty journal → no activity, null win-rate (never a fake 0%)', () => {
    const w = computeAiDeskWeek({ entries: [] }, { now: NOW });
    expect(w.trades).toBe(0);
    expect(w.winRate).toBeNull();
    expect(w.hadActivity).toBe(false);
  });
});

describe('weeklyQuantView + header', () => {
  it('assembles desk + calibration + intraday in one payload', () => {
    const q = weeklyQuantView({ now: NOW });
    expect(q.ai.trades).toBe(3);
    expect(q.calibration.sufficient).toBe(true);
    expect(q.intraday.count).toBe(3);
    expect(q.weekKey).toBe('2026-W38');
  });
  it('quant header always carries the numbers', () => {
    const h = quantHeaderBlock(weeklyQuantView({ now: NOW }));
    expect(h).toMatch(/WEEKLY TRADE-PERFORMANCE REVIEW/);
    expect(h).toMatch(/3 closed \(2W\/1L/);
    expect(h).toMatch(/net <b>₹450<\/b>/);
    expect(h).toMatch(/Brier 0\.18/);
  });
});

// ============================================================
// orchestration
// ============================================================
describe('runWeeklyPerformanceReview', () => {
  it('no settled activity → honest refusal', async () => {
    mockLoadJournal.mockReturnValueOnce({ entries: [] });
    mockGetJournal.mockReturnValueOnce({ stats: { count: 0 } });
    const out = await runWeeklyPerformanceReview({}, { now: NOW });
    expect(out.ok).toBe(false);
    expect(out.error).toMatch(/koi settled trade nahi/i);
  });
  it('NO LLM → still returns the quant view with the honest note', async () => {
    const out = await runWeeklyPerformanceReview({}, { now: NOW });
    expect(out.ok).toBe(true);
    expect(out.engine).toBeNull();
    expect(out.text).toMatch(/WEEKLY TRADE-PERFORMANCE REVIEW/);
    expect(out.text).toMatch(/LLM narration unavailable/);
  });
  it('LLM narrates — and the PROMPT it gets carries the quant numbers', async () => {
    mockAskLLM.mockResolvedValueOnce({ engine: 'gemini', text: 'WEEK VERDICT: GREEN' });
    const out = await runWeeklyPerformanceReview({}, { now: NOW });
    expect(out.ok).toBe(true);
    expect(out.engine).toBe('gemini');
    expect(out.text).toContain('WEEK VERDICT: GREEN');
    const prompt = mockAskLLM.mock.calls[0][1];
    expect(prompt).toMatch(/WEEK OF: 2026-W38/);
    expect(prompt).toMatch(/closed trades 3 \(2W\/1L, win-rate 66\.7%\), net ₹450/);
    expect(prompt).toMatch(/Brier 0\.18/);
    expect(prompt).toMatch(/NSE INTRADAY PAPER DESK/);
    // system prompt pins the sections + verdict
    expect(mockAskLLM.mock.calls[0][0]).toMatch(/Week Scorecard/);
    expect(mockAskLLM.mock.calls[0][0]).toMatch(/GREEN\/AMBER\/RED/);
  });
  it('per-week cache: second call is cached, force recomputes', async () => {
    mockAskLLM.mockResolvedValue({ engine: 'x', text: 't' });
    const a = await runWeeklyPerformanceReview({}, { now: NOW });
    const b = await runWeeklyPerformanceReview({}, { now: NOW });
    expect(b.cached).toBe(true);
    expect(mockAskLLM).toHaveBeenCalledTimes(1);
    const c = await runWeeklyPerformanceReview({}, { now: NOW, force: true });
    expect(c.cached).toBe(false);
    expect(mockAskLLM).toHaveBeenCalledTimes(2);
  });
});

describe('auto-push flag', () => {
  it('default ON; off disables', () => {
    expect(weeklyAutoPushEnabled()).toBe(true);
    const prev = process.env.AI_WEEKLY_REVIEW_PUSH;
    process.env.AI_WEEKLY_REVIEW_PUSH = 'off';
    expect(weeklyAutoPushEnabled()).toBe(false);
    process.env.AI_WEEKLY_REVIEW_PUSH = prev;
  });
});
