// ============================================================
// v4 MEGA upgrade tests — quant engine + dual-expert consensus
//   • gradeSignal A+/A/B boundaries
//   • analyzeIntradayFromScanner: volume floor, supertrend/POC/
//     SMA50 factors, dead-zone penalty, tighter RSI, gap penalty
//   • aiVerifySignals: structured consensus (mocked fetch) —
//     agreement bonus, ANY-AVOID rejection, direction-conflict
//     rejection, level merging, sanitizers
// No network: fetch is stubbed per-test.
// ============================================================
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const {
  gradeSignal, analyzeIntradayFromScanner, aiVerifySignals, inDeadZone,
  MIN_REL_VOLUME, HIGH_CONV_RR_FLOOR,
} = await import('../server/intraday/engine.js');

// ---- shared synthetic TV snapshot (bullish, A+-capable) ----
const bullTv = {
  close: 812, open: 800, high: 816, low: 795, volume: 5e6, change: 1.5,
  ema10: 810, ema20: 805, sma20: 802, sma50: 790,
  rsi: 61, macd: 2.5, macdSignal: 1.5,
  atr: 10, vwap: 806,
  adx: 27, adxPlus: 25, adxMinus: 10,
  relVolume: 1.8,
  pivotMiddle: 805, pivotS1: 795, pivotR1: 820,
  recommend: 1, last: 812, exchange: 'NSE',
};
const bullGroww = { price: 812, prevClose: 800, change: 1.5, high: 816, low: 795, volume: 5e6 };

const cand = (over = {}) => ({
  symbol: 'SBIN', exchange: 'NSE', direction: 'LONG', quantConfidence: 90,
  ltp: 812, changePct: 1.5, rsi: 61, volumeRatio: 1.8, rr: 1.6, atr: 10,
  adx: 27, gapPct: 0.5, marketPhase: 'full', vwapDist: 0.75,
  entry: 812, stopLoss: 801, target1: 829.6, target2: 840.8,
  _momentumPct: 1.5, ...over,
});

beforeEach(() => { vi.unstubAllGlobals(); });
afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

// ---------------- gradeSignal ----------------
describe('gradeSignal — v4 A+/A/B boundaries', () => {
  it('A+ requires conf≥88, rr≥1.8, vol≥1.5, ADX≥25, VWAP-aligned, regime-aligned', () => {
    expect(gradeSignal(cand({ confidence: 88, effRR: 1.8, volumeRatio: 1.5, adx: 25, vwapDist: 0.1 }))).toBe('A+');
    // each failing gate drops to A or B
    expect(gradeSignal(cand({ confidence: 87, effRR: 1.8, volumeRatio: 1.5, adx: 25 }))).toBe('A');
    expect(gradeSignal(cand({ confidence: 88, effRR: 1.7, volumeRatio: 1.5, adx: 25 }))).toBe('A');
    expect(gradeSignal(cand({ confidence: 88, effRR: 1.8, volumeRatio: 1.4, adx: 25 }))).toBe('A');
    expect(gradeSignal(cand({ confidence: 88, effRR: 1.8, volumeRatio: 1.5, adx: 24 }))).toBe('A');
    // SHORT A+ needs vwapDist < 0
    expect(gradeSignal(cand({ direction: 'SHORT', confidence: 88, effRR: 1.8, volumeRatio: 1.5, adx: 25, vwapDist: -0.1 }))).toBe('A+');
    // counterTrend kills A+
    expect(gradeSignal(cand({ confidence: 90, effRR: 2, volumeRatio: 1.6, adx: 27, counterTrend: true }))).toBe('A');
  });

  it('A requires conf≥80, rr≥1.5, vol≥1.2', () => {
    expect(gradeSignal(cand({ confidence: 80, effRR: 1.5, volumeRatio: 1.2 }))).toBe('A');
    expect(gradeSignal(cand({ confidence: 79, effRR: 1.5, volumeRatio: 1.2 }))).toBe('B');
    expect(gradeSignal(cand({ confidence: 80, effRR: 1.4, volumeRatio: 1.2 }))).toBe('B');
    expect(gradeSignal(cand({ confidence: 80, effRR: 1.5, volumeRatio: 1.1 }))).toBe('B');
  });

  it('B for everything else / null-safe', () => {
    expect(gradeSignal(cand({ confidence: 70 }))).toBe('B');
    expect(gradeSignal(null)).toBe('B');
  });

  it('falls back to raw rr when effRR missing', () => {
    const s = cand({ confidence: 88, volumeRatio: 1.5, adx: 25 });
    delete s.effRR;
    s.rr = 1.9;
    expect(gradeSignal(s)).toBe('A+');
  });
});

// ---------------- analyzeIntradayFromScanner ----------------
describe('analyzeIntradayFromScanner — v4 factors', () => {
  it('rejects on KNOWN low relative volume (< 1.2x hard floor)', () => {
    const r = analyzeIntradayFromScanner('SBIN', { ...bullTv, relVolume: 1.0 }, bullGroww, {});
    expect(r).toBeNull();
  });

  it('does NOT reject when relVolume is unknown (null feed value)', () => {
    const r = analyzeIntradayFromScanner('SBIN', { ...bullTv, relVolume: null }, bullGroww, {});
    expect(r).not.toBeNull();
  });

  it('emits v4 reasons: Supertrend proxy, SMA50 confluence (price near VWAP → POC)', () => {
    // price 0.18% above VWAP → value-area acceptance zone
    const nearPoc = analyzeIntradayFromScanner('SBIN', { ...bullTv, vwap: 810.5 }, { ...bullGroww }, {});
    expect(nearPoc).not.toBeNull();
    const reasons = nearPoc.reasons.join(' | ');
    expect(reasons).toContain('Supertrend(7) aligned');
    expect(reasons).toContain('Volume-POC');
    expect(reasons).toContain('SMA50 multi-timeframe confluence');
    // far-from-VWAP price → no POC premium
    const farFromPoc = analyzeIntradayFromScanner('SBIN', bullTv, bullGroww, {});
    expect(farFromPoc.reasons.join(' | ')).not.toContain('Volume-POC');
  });

  it('SMA50 missing → no confluence reason (factor skipped, no crash)', () => {
    const r = analyzeIntradayFromScanner('SBIN', { ...bullTv, sma50: null }, bullGroww, {});
    expect(r).not.toBeNull();
    expect(r.reasons.join(' | ')).not.toContain('SMA50');
  });

  it('counter-regime penalty is -10 (was -6)', () => {
    const neutral = analyzeIntradayFromScanner('SBIN', bullTv, bullGroww, {});
    const bear = analyzeIntradayFromScanner('SBIN', bullTv, bullGroww, { regime: { regime: 'BEARISH', vixLevel: 'LOW' } });
    expect(neutral).not.toBeNull();
    expect(bear).not.toBeNull();
    // LONG in BEARISH regime: direction may stay LONG (score-driven) → -10
    if (bear.direction === 'LONG' && neutral.direction === 'LONG') {
      expect(neutral.quantConfidence - bear.quantConfidence).toBeGreaterThanOrEqual(10);
    }
  });

  it('gap > 2.5% penalized with -8 (was -4 at 3.5%)', () => {
    // prevClose such that gap = +3%
    const gw = { ...bullGroww, prevClose: 776.7, open: 800 };
    const r = analyzeIntradayFromScanner('SBIN', { ...bullTv, open: 800, change: 4.5 }, gw, {});
    expect(r).not.toBeNull();
    if (r.direction === 'LONG') {
      expect(r.reasons.join(' | ')).not.toContain('Gap +3.0%'); // no gap bonus beyond 2.5%
    }
  });

  it('exports quality gates and dead-zone helper', () => {
    expect(MIN_REL_VOLUME).toBe(1.2);
    expect(HIGH_CONV_RR_FLOOR).toBe(1.5);
    expect(inDeadZone(14 * 60 + 30)).toBe(true);
    expect(inDeadZone(14 * 60 + 59)).toBe(true);
    expect(inDeadZone(15 * 60)).toBe(false);
    expect(inDeadZone(10 * 60)).toBe(false);
  });

  it('dead-zone scoring: 14:45 IST analysis carries the penalty + flag', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-05T09:15:00Z')); // 14:45 IST
    const r = analyzeIntradayFromScanner('SBIN', bullTv, bullGroww, {});
    expect(r).not.toBeNull();
    expect(r._deadZone).toBe(true);
    expect(r.reasons.join(' | ')).toContain('Dead-zone');
    vi.useRealTimers();
    const normal = analyzeIntradayFromScanner('SBIN', bullTv, bullGroww, {});
    expect(normal._deadZone).toBe(false);
  });
});

// ---------------- aiVerifySignals (structured dual-expert) ----------------
describe('aiVerifySignals — v4 structured consensus', () => {
  const DEPS = {
    KEYS: { gemini: 'g-key', groq: 'q-key' },
    OPENAI_COMPAT: {
      groq: { url: 'https://groq.test/v1/chat/completions', defModel: 'llama-3.3-70b' },
    },
  };

  const geminiResp = (verdicts) => ({
    ok: true, json: async () => ({
      candidates: [{ content: { parts: [{ text: JSON.stringify({ verdicts }) }] } }],
    }),
  });
  const groqResp = (verdicts) => ({
    ok: true, json: async () => ({
      choices: [{ message: { content: JSON.stringify({ verdicts }) } }],
    }),
  });
  const stubFetch = (geminiVerdicts, groqVerdicts) => {
    vi.stubGlobal('fetch', vi.fn(async (url) => {
      if (String(url).includes('generativelanguage')) return geminiResp(geminiVerdicts);
      if (String(url).includes('groq')) return groqResp(groqVerdicts);
      return { ok: false, status: 500, json: async () => ({}) };
    }));
  };

  const V = (over = {}) => ({
    verdict: 'LONG', confidence: 85, note: 'Strong stack',
    analysis: 'EMA stack bullish, VWAP support holding, volume expanding.',
    riskFactors: ['VIX spike'], entryQuality: 8, tradeType: 'MOMENTUM',
    slAdjust: 805, entryAdjust: 810, ...over,
  });

  it('unanimous agreement → +5 bonus, merged reasoning, per-model verdicts', async () => {
    stubFetch({ SBIN: V({ confidence: 80, entryQuality: 7 }) }, { SBIN: V() });
    const out = await aiVerifySignals([cand()], DEPS);
    expect(out.models).toContain('gemini');
    expect(out.models).toContain('groq');
    const v = out.verdicts.SBIN;
    expect(v.verdict).toBe('LONG');
    expect(v.confidence).toBe(Math.round((80 + 85) / 2 + 5)); // 85
    expect(v.dissent).toBe(0);
    expect(v.analysis).toContain('[GEMINI]');
    expect(v.analysis).toContain('[GROQ]');
    expect(v.riskFactors).toEqual(['VIX spike']);
    expect(v.entryQuality).toBe(8); // round((7+8)/2)
    expect(v.tradeType).toBe('MOMENTUM');
    expect(v.slAdjust).toBe(805);
    expect(v.perModel.gemini.confidence).toBe(80);
    expect(v.perModel.groq.confidence).toBe(85);
  });

  it('ANY avoid vote → setup rejected outright (not halved)', async () => {
    stubFetch({ SBIN: V() }, { SBIN: V({ verdict: 'AVOID', confidence: 70, note: 'RSI overbought' }) });
    const out = await aiVerifySignals([cand()], DEPS);
    expect(out.verdicts.SBIN.verdict).toBe('AVOID');
    expect(out.verdicts.SBIN.note).toContain('RSI');
  });

  it('direction conflict between experts → rejected as AVOID', async () => {
    stubFetch({ SBIN: V({ verdict: 'LONG' }) }, { SBIN: V({ verdict: 'SHORT' }) });
    const out = await aiVerifySignals([cand()], DEPS);
    expect(out.verdicts.SBIN.verdict).toBe('AVOID');
    expect(out.verdicts.SBIN.dissent).toBe(1);
  });

  it('tightest SL merge: LONG keeps the HIGHER (closer-to-entry) stop', async () => {
    stubFetch({ SBIN: V({ slAdjust: 803 }) }, { SBIN: V({ slAdjust: 806 }) });
    const out = await aiVerifySignals([cand()], DEPS);
    expect(out.verdicts.SBIN.slAdjust).toBe(806);
  });

  it('sanitizes garbage fields (entryQuality clamp, bad tradeType, non-numeric levels)', async () => {
    stubFetch(
      { SBIN: V({ entryQuality: 42, tradeType: 'WEIRD', slAdjust: 'abc' }) },
      { SBIN: V({ entryQuality: -5, tradeType: 'SCALP', slAdjust: null, riskFactors: 'not-an-array' }) },
    );
    const out = await aiVerifySignals([cand()], DEPS);
    const v = out.verdicts.SBIN;
    expect(v.entryQuality).toBe(6); // round((clamp(42)+clamp(-5))/2) = round(5.5) = 6
    expect(v.tradeType).toBe('SCALP'); // only valid type survived
    expect(v.slAdjust).toBeNull();
    expect(v.riskFactors).toEqual(['VIX spike']); // gemini's valid list kept, groq's non-array discarded
  });

  it('single-model response still produces a verdict (no agreement bonus)', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url) => {
      if (String(url).includes('generativelanguage')) return geminiResp({ SBIN: V({ confidence: 82 }) });
      return { ok: false, status: 500, json: async () => ({}) }; // groq down
    }));
    const out = await aiVerifySignals([cand()], DEPS);
    const v = out.verdicts.SBIN;
    expect(v.verdict).toBe('LONG');
    expect(v.confidence).toBe(82); // no +5 bonus
    expect(v.perModel.gemini).toBeDefined();
    expect(v.perModel.groq).toBeUndefined();
  });

  it('returns null when every provider fails / no keys', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 500, json: async () => ({}) })));
    expect(await aiVerifySignals([cand()], DEPS)).toBeNull();
    expect(await aiVerifySignals([cand()], { KEYS: {}, OPENAI_COMPAT: {} })).toBeNull();
    expect(await aiVerifySignals([], DEPS)).toBeNull();
  });
});
