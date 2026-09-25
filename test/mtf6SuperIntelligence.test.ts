// ============================================================
// test/mtf6SuperIntelligence.test.ts — v13.3 MTF-6 LADDER
// ------------------------------------------------------------
// THE USER'S CORE SPEC LOCKED HERE: "1min/5min/15min/1hr/4hr/1d aisa
// full analysis karke hi final trade signal dedo."
//
//  1. tapeMTFFromBase6 — the pure builder: full 6-TF payload,
//     agreement math (active voters only, neutral = abstention),
//     HTF tide (weighted 1h/4h/1d majority) + htf/ltf sub-agreements,
//     honest degrade when legs are dark
//  2. mtfWirePayload — all 6 TFs forwarded on the wire
//  3. IntradayTapeMTF seat — 6-TF vote rules: FULL-LADDER boost,
//     conflict penalty, COUNTER-TIDE haircut, A/B shadow, and the
//     legacy 3-TF path stays byte-stable
//  4. aggregateVotes — the < 2/3 STRONG-ban generalizes to 6 voters
//  5. SVA — the mtf check now PASSES for crypto signals (the old
//     permanent WARN is gone — the desk finally carries the ladder)
//  6. fetchCryptoMTF6 — the crypto ladder builder (Binance legs,
//     INR rescale on spot)
//  7. Deep-signal integration — getDeepSignal('BTC','CRYPTO') stamps
//     sig.mtf with the 6-TF ladder
//  8. reversalAutoCut round-trip (the XRP loss-cap dead-wiring fix)
//  9. stateOfManualTrade — LOSS_CAP outranks TARGET_HIT
// 10. paper desk PARTIAL — the runner exits at the breakeven floor,
//     not the original SL (the trackRecord v11.4 fix, finally applied)
// Hermetic: data.js mocked, global fetch stubbed per-URL.
// ============================================================
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

process.env.SMARTAI_DATA_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '../.test-data-mtf6');
// THE FLAG — set BEFORE models.js is imported (registry is module-load).
process.env.AI_ENABLE_MTF_CONFLUENCE = 'true';

// ---------------- shared candle factories ----------------
// epoch-aligned steady-drift series — DEGENERATE on monotonic data
// (RSI pins at 0/100 and the tape read neutralizes), so every fixture
// here carries periodic counter-bars exactly like the repo's own
// falling15mWithPullbacks pattern: RSI lands inside the tradeable band
// and the tape read is deterministic.
function risingWithDips(minutes, n, period = 4) {
  const out = [];
  const align = minutes * 60_000;
  const t0 = Math.floor((Date.now() - n * align) / align) * align;
  let px = 1240;
  for (let i = 0; i < n; i++) {
    const dip = i % period === period - 1;
    px = px * (dip ? 0.996 : 1.004); // calibrated: dir +1, RSI ~72
    const c = +px.toFixed(2);
    out.push({
      time: t0 + i * align,
      open: c, high: +(px * 1.0015).toFixed(2),
      low: +(px * 0.9985).toFixed(2), close: c, volume: 120_000 + (i % 7) * 9_000,
    });
  }
  return out;
}
function fallingWithBounces(minutes, n, period = 4) {
  const out = [];
  const align = minutes * 60_000;
  const t0 = Math.floor((Date.now() - n * align) / align) * align;
  let px = 1290;
  for (let i = 0; i < n; i++) {
    const bounce = i % period === period - 1;
    px = px * (bounce ? 1.004 : 0.996); // calibrated: dir −1, RSI ~28
    const c = +px.toFixed(2);
    out.push({
      time: t0 + i * align,
      open: c, high: +(px * 1.0015).toFixed(2),
      low: +(px * 0.9985).toFixed(2), close: c, volume: 120_000 + (i % 7) * 9_000,
    });
  }
  return out;
}
// 1h-ROLE fixtures: 3-bar counter-moves every 9 bars — the structure
// SURVIVES the 4h resample (a plain net-drift series aggregates into a
// monotonic bucket-close sequence whose RSI pins ~3 and the tape
// neutralizes; the multi-bar rallies keep the resampled read live).
function risingWithPulls(minutes, n) {
  const out = [];
  const align = minutes * 60_000;
  const t0 = Math.floor((Date.now() - n * align) / align) * align;
  let px = 1240;
  for (let i = 0; i < n; i++) {
    const pull = i % 9 >= 6;
    px = px * (pull ? 0.995 : 1.004);
    const c = +px.toFixed(2);
    out.push({ time: t0 + i * align, open: c, high: +(px * 1.0015).toFixed(2), low: +(px * 0.9985).toFixed(2), close: c, volume: 120_000 + (i % 7) * 9_000 });
  }
  return out;
}
function fallingWithRallies(minutes, n) {
  const out = [];
  const align = minutes * 60_000;
  const t0 = Math.floor((Date.now() - n * align) / align) * align;
  let px = 1290;
  for (let i = 0; i < n; i++) {
    const rally = i % 9 >= 6;
    px = px * (rally ? 1.005 : 0.996);
    const c = +px.toFixed(2);
    out.push({ time: t0 + i * align, open: c, high: +(px * 1.0015).toFixed(2), low: +(px * 0.9985).toFixed(2), close: c, volume: 120_000 + (i % 7) * 9_000 });
  }
  return out;
}
// a TRUE coil: mild sine, then 25 flat bars at the mean — EMA10≈EMA20≈ltp,
// RSI ~50, last3Pct 0 → tapeVote lands dir 0 (the abstention read).
function flatCoil(minutes, n) {
  const out = [];
  const align = minutes * 60_000;
  const t0 = Math.floor((Date.now() - n * align) / align) * align;
  const flatFrom = Math.max(0, n - 25);
  for (let i = 0; i < n; i++) {
    const px = i >= flatFrom ? 1240 : 1240 * (1 + Math.sin(i / 6) * 0.0012);
    const c = +px.toFixed(2);
    out.push({
      time: t0 + i * align,
      open: c, high: +(px * 1.0008).toFixed(2), low: +(px * 0.9992).toFixed(2),
      close: c, volume: 100_000 + (i % 7) * 9_000,
    });
  }
  return out;
}

// compact tape snapshots good enough for tapeVote — WEAK by design
// (score ≈ ±2.1 → conf ≈ 80) so the +15/−20/−12 adjustments stay under
// the 100 clamp and the arithmetic is exact.
const weakBullTape = { ltp: 1258, ema10: 1250, ema20: 1244, ema50: 1230, rsi: 55, macdHist: 0.5, macdSlope: 0.2, vwap: null, last3Pct: null };
const weakBearTape = { ltp: 1240, ema10: 1250, ema20: 1256, ema50: 1262, rsi: 45, macdHist: -0.5, macdSlope: -0.2, vwap: null, last3Pct: null };

// ---------------- unit-level imports ----------------
const { MODELS, runQuantModels } = await import('../server/ai/models.js');
const { aggregateVotes } = await import('../server/ai/ensemble.js');
const { verifySignal } = await import('../server/ai/signalVerifier.js');

// ============================================================
// 1. tapeMTFFromBase6 — the pure 6-TF builder
// ============================================================
const { tapeMTFFromBase6, mtfWirePayload, fetchCryptoMTF6 } = await import('../server/ai/signals.js');

describe('v13.3 tapeMTFFromBase6 — the 6-TF ladder builder', () => {
  it('all six aligned → agreement 1.0, __six, full htf/ltf agreement', () => {
    const m = tapeMTFFromBase6(
      risingWithDips(1, 300),
      risingWithDips(5, 1200),
      risingWithDips(15, 200),
      risingWithPulls(60, 300),     // the 1h-role fixture: its 4h resample stays healthy
      risingWithDips(1440, 120),
      null,
    );
    expect(m).toBeTruthy();
    expect(m.m1).toBeTruthy();
    expect(m.m5).toBeTruthy();
    expect(m.m15).toBeTruthy();
    expect(m.h1).toBeTruthy();
    expect(m.h4).toBeTruthy();   // resampled from the 1h native
    expect(m.d1).toBeTruthy();
    expect(m.agreement).toBe(1);
    expect(m.__six).toBe(true);
    expect(m.htfAgreement).toBe(1);
    expect(m.ltfAgreement).toBe(1);
    expect(m.__htfAligned).toBe(true);
    expect(m.__htfDir).toBe(1);
  });

  it('mixed ladder: 15m anchor LONG vs bearish HTF tide → agreement 3/6, counter-tide flagged', () => {
    const m = tapeMTFFromBase6(
      risingWithDips(1, 300),          // 1m bull
      risingWithDips(5, 1200),         // 5m bull
      risingWithDips(15, 200),        // 15m bull (anchor)
      fallingWithRallies(60, 300),    // 1h bear (1h-role fixture → healthy 4h resample)
      fallingWithBounces(1440, 120),   // 1d bear
      null,
    );
    expect(m.agreement).toBeCloseTo(3 / 6, 10); // m1+m5+m15 aligned, h1+h4+d1 against
    expect(m.__htfDir).toBe(-1);
    expect(m.__htfAligned).toBe(false);
    expect(m.htfAgreement).toBe(1);   // the 3 HTFs agree with each other (all bear)
    expect(m.ltfAgreement).toBe(1);   // the 3 LTFs agree with each other (all bull)
  });

  it('a NEUTRAL tape abstains — it never counts as disagreement', () => {
    const m = tapeMTFFromBase6(
      flatCoil(1, 300),             // 1m neutral coil → abstention
      risingWithDips(5, 1200),   // 5m bull
      risingWithDips(15, 200),   // 15m bull anchor
      risingWithDips(60, 300),    // 1h bull
      risingWithDips(1440, 120),  // 1d bull
      null,
    );
    // 5 active voters, all aligned → agreement 1.0 (NOT 5/6-penalized)
    expect(m.agreement).toBe(1);
    expect(m.m1).toBeTruthy();        // the tape exists on the payload…
  });

  it('degrades honestly: missing 1m/1h/1d legs still build the ladder', () => {
    const m = tapeMTFFromBase6(
      null,
      risingWithDips(5, 1200),
      risingWithDips(15, 200),
      null,                           // 1h dark → resampled from 5m
      null,                           // daily dark
      null,
    );
    expect(m.m1).toBeUndefined();
    expect(m.d1).toBeUndefined();
    expect(m.h1).toBeTruthy();        // 5m→60m resample fallback
    expect(m.__six).toBe(false);      // 3-TF-class payload (h4 may exist from 5m but no m1/d1)
    expect(m.agreement).toBeGreaterThan(0);
  });

  it('returns null without the 5m base (anchor prerequisites)', () => {
    expect(tapeMTFFromBase6(null, null, risingWithDips(15, 200), null, null, null)).toBeNull();
    expect(tapeMTFFromBase6(null, [1, 2, 3], risingWithDips(15, 200), null, null, null)).toBeNull();
  });

  it('neutral 15m anchor → agreement null (the v10.5 convention survives)', () => {
    const m = tapeMTFFromBase6(
      null,
      flatCoil(5, 1200),            // 5m coil
      flatCoil(15, 200),            // 15m coil → anchor neutral
      null, null, null,
    );
    expect(m).toBeTruthy();           // payload still built (m5+m15 exist)
    expect(m.agreement).toBeNull();
  });
});

// ============================================================
// 2. mtfWirePayload — the 6-field wire
// ============================================================
describe('v13.3 mtfWirePayload — full ladder on the wire', () => {
  it('forwards all six TFs + agreement + htf/ltf sub-agreements', () => {
    const built = tapeMTFFromBase6(
      risingWithDips(1, 300),
      risingWithDips(5, 1200),
      risingWithDips(15, 200),
      risingWithDips(60, 300),
      risingWithDips(1440, 120),
      null,
    );
    const w = mtfWirePayload(built);
    expect(w.m1).toEqual({ dir: 1, conf: expect.any(Number) });
    expect(w.m5.dir).toBe(1);
    expect(w.m15.dir).toBe(1);
    expect(w.h1.dir).toBe(1);
    expect(w.h4.dir).toBe(1);
    expect(w.d1.dir).toBe(1);
    expect(w.agreement).toBe(1);
    expect(w.htfAgreement).toBe(1);
    expect(w.ltfAgreement).toBe(1);
  });

  it('legacy 3-TF payload still wires (m1/h4/d1 null, no crash)', () => {
    const w = mtfWirePayload({ m5: weakBullTape, m15: weakBullTape, h1: weakBearTape, agreement: 2 / 3 });
    expect(w.m1).toBeNull();
    expect(w.h4).toBeNull();
    expect(w.d1).toBeNull();
    expect(w.m5.dir).toBe(1);
    expect(w.agreement).toBeCloseTo(2 / 3, 10);
  });
});

// ============================================================
// 3. IntradayTapeMTF — the 6-TF seat vote
// ============================================================
describe('v13.3 IntradayTapeMTF — 6-TF vote rules', () => {
    it('FULL LADDER aligned → +15 boost vs the anchor conf', () => {
    const mtf = { m1: weakBullTape, m5: weakBullTape, m15: weakBullTape, h1: weakBullTape, h4: weakBullTape, d1: weakBullTape };
    const v = runQuantModels({ market: 'CRYPTO', symbol: 'BTC', ltp: 100, tapeMTF: mtf }).find(x => x.id === 'tape-mtf');
    const anchor15 = runQuantModels({ market: 'CRYPTO', symbol: 'BTC', ltp: 100, tape: weakBullTape }).find(x => x.id === 'tape-mtf');
    expect(v.dir).toBe(1);
    expect(v.conf).toBe(anchor15.conf + 15);
    expect(v.reasons.join(' ')).toContain('FULL LADDER');
  });

  it('conflict (< 2/3 aligned) → −20 penalty + honest reason', () => {
    // m1 bull, m5 bull, m15 bull(anchor) vs h1/h4/d1 bear → 3/6 = 0.5
    const mtf = { m1: weakBullTape, m5: weakBullTape, m15: weakBullTape, h1: weakBearTape, h4: weakBearTape, d1: weakBearTape };
    const v = runQuantModels({ market: 'CRYPTO', symbol: 'BTC', ltp: 100, tapeMTF: mtf }).find(x => x.id === 'tape-mtf');
    const anchor15 = runQuantModels({ market: 'CRYPTO', symbol: 'BTC', ltp: 100, tape: weakBullTape }).find(x => x.id === 'tape-mtf');
    expect(v.dir).toBe(1);
    expect(v.conf).toBe(anchor15.conf - 20 - 12); // conflict + counter-tide stack
    expect(v.reasons.join(' ')).toContain('Timeframe conflict');
    expect(v.reasons.join(' ')).toContain('COUNTER-TIDE');
  });

  it('2/3+ aligned BUT against the tide → only the −12 counter-tide haircut', () => {
    // m1 bear(abstain-ish? no — bear votes), m5 bull, m15 bull anchor, h1 bull, h4 bear, d1 bear:
    // voters: m1(-1), m5(+1), m15(+1), h1(+1), h4(-1), d1(-1) → aligned = 3/6 = 0.5 — not 2/3.
    // Use: m1 neutral-missing (undefined → abstain) so voters = 5: m5(+), m15(+), h1(+), h4(−), d1(−) → 3/5 = 0.6 — still <2/3.
    // Cleanest 2/3-with-opposing-tide case: 4 of 6 aligned, tide opposed:
    // m1(+), m5(+), m15(+ anchor), h1(+), h4(−), d1(−) → 4/6 = 0.667 → passes the 2/3 gate,
    // HTF tide = weighted(1·+1, 1.2·−1, 1.5·−1) = 1 − 2.7 = −1.7 → bear → againstTide.
    const mtf = { m1: weakBullTape, m5: weakBullTape, m15: weakBullTape, h1: weakBullTape, h4: weakBearTape, d1: weakBearTape };
    const v = runQuantModels({ market: 'CRYPTO', symbol: 'BTC', ltp: 100, tapeMTF: mtf }).find(x => x.id === 'tape-mtf');
    const anchor15 = runQuantModels({ market: 'CRYPTO', symbol: 'BTC', ltp: 100, tape: weakBullTape }).find(x => x.id === 'tape-mtf');
    expect(v.conf).toBe(anchor15.conf - 12);
    expect(v.reasons.join(' ')).toContain('COUNTER-TIDE');
    expect(v.reasons.join(' ')).not.toContain('Timeframe conflict');
  });

  it('A/B shadow arm rides every 6-TF vote (the calibration ledger)', () => {
    const mtf = { m1: weakBullTape, m5: weakBullTape, m15: weakBullTape, h1: weakBullTape, h4: weakBullTape, d1: weakBullTape };
    const v = runQuantModels({ market: 'CRYPTO', symbol: 'BTC', ltp: 100, tapeMTF: mtf }).find(x => x.id === 'tape-mtf');
    expect(v.__abShadow).toEqual({ id: 'ab_tape15m', dir: 1, conf: expect.any(Number), weight: 1.3 });
  });

  it('legacy 3-TF payload → the v10.5 path, byte-stable (no 6-TF rules fire)', () => {
    const mtf = { m5: weakBullTape, m15: weakBullTape, h1: weakBearTape };
    const v = runQuantModels({ market: 'CRYPTO', symbol: 'BTC', ltp: 100, tapeMTF: mtf }).find(x => x.id === 'tape-mtf');
    expect(v.dir).toBe(1);
    expect(v.reasons.join(' ')).toContain('2 of 3 timeframes aligned');
    expect(v.reasons.join(' ')).not.toContain('MTF-6 read');
    expect(v.reasons.join(' ')).not.toContain('COUNTER-TIDE');
  });

  it('neutral anchor → honest abstain (both paths)', () => {
    const coil = { ltp: 1240, ema10: 1240, ema20: 1240, ema50: 1240, rsi: 50, macdHist: 0, macdSlope: 0, vwap: 1240, last3Pct: 0 };
    const v6 = runQuantModels({ market: 'CRYPTO', symbol: 'BTC', ltp: 100, tapeMTF: { m1: weakBullTape, m5: weakBullTape, m15: coil, h1: weakBullTape, h4: weakBullTape, d1: weakBullTape } }).find(x => x.id === 'tape-mtf');
    expect(v6.dir).toBe(0);
    expect(v6.reasons.join(' ')).toContain('abstains');
  });
});

// ============================================================
// 4. aggregateVotes — the STRONG-ban generalizes to 6 voters
// ============================================================
describe('v13.3 aggregateVotes — the < 2/3 STRONG-ban over 6 voters', () => {
  const votes = (dir) => [
    { id: 'trend', name: 'T', weight: 1.4, dir, conf: 80, reasons: [] },
    { id: 'momentum', name: 'M', weight: 1.3, dir, conf: 80, reasons: [] },
    { id: 'volume', name: 'V', weight: 1.2, dir, conf: 80, reasons: [] },
  ];
  const gates = { minConfidence: 70, minAgreement: 0.6 };

  it('6-TF agreement 0.5 (3/6) → STRONG banned, mtfCapped stamped', () => {
    const c = aggregateVotes(votes(1), gates, { mtfAgreement: 0.5 });
    expect(c.grade).toBe('ACTION');
    expect(c.mtfCapped).toBe(true);
  });

  it('6-TF agreement 0.833 (5/6) → STRONG reachable', () => {
    const c = aggregateVotes(votes(1), gates, { mtfAgreement: 5 / 6 });
    expect(c.grade).toBe('STRONG');
    expect(c.mtfCapped).toBeUndefined();
  });

  it('exactly 4/6 (0.667) PASSES (the 2/3 boundary, integer-exact)', () => {
    const c = aggregateVotes(votes(1), gates, { mtfAgreement: 4 / 6 });
    expect(c.grade).toBe('STRONG');
  });
});

// ============================================================
// 5. SVA — crypto signals finally carry the ladder
// ============================================================
describe('v13.3 signalVerifier — the mtf check on crypto signals', () => {
  const baseSignal = {
    symbol: 'XRP', market: 'FUTURES', side: 'LONG', ltp: 1.62,
    confidence: 55, grade: 'ACTION', voters: 9, totalModels: 14,
    plan: { entry: 1.62, stopLoss: 1.58, target1: 1.70, target2: 1.78, riskPct: 2.4, rr: 2 },
    summary: 'test', quality: { mtf: { phase: 'n/a', aligned: true, available: true } },
  };

  it('agreement 0.9 → mtf check PASSES with the 6-TF ladder text (no more permanent WARN)', () => {
    const v = verifySignal({ ...baseSignal, mtf: { m5: { dir: 1, conf: 60 }, m15: { dir: 1, conf: 60 }, h1: { dir: 1, conf: 60 }, m1: { dir: 1, conf: 60 }, h4: { dir: 1, conf: 60 }, d1: { dir: 0, conf: 40 }, agreement: 0.9 } });
    const mtfRow = v.checklist.find(c => c.id === 'mtf');
    expect(mtfRow.status).toBe('PASS');
    expect(mtfRow.detail).toContain('1m/5m/15m/1h/4h/1d');
  });

  it('agreement 0.33 → mtf check FAILS (timeframes disagree)', () => {
    const v = verifySignal({ ...baseSignal, mtf: { m5: { dir: -1, conf: 60 }, m15: { dir: 1, conf: 60 }, h1: { dir: -1, conf: 60 }, agreement: 1 / 3 } });
    const mtfRow = v.checklist.find(c => c.id === 'mtf');
    expect(mtfRow.status).toBe('FAIL');
  });

  it('mtf absent → honest WARN (unchanged degrade)', () => {
    const v = verifySignal({ ...baseSignal });
    const mtfRow = v.checklist.find(c => c.id === 'mtf');
    expect(mtfRow.status).toBe('WARN');
  });
});

// ============================================================
// 6. fetchCryptoMTF6 — the crypto ladder (mocked legs)
// ============================================================
const FAKE_FX = 85.9;
const fakeKlines = (lastClose, tfMinutes) => Array.from({ length: 300 }, (_, i) => {
  const drift = Math.sin(i / 17) * 0.012 + (i / 300) * 0.06 - 0.03;
  const close = lastClose * (1 + drift);
  return {
    time: Math.floor(Date.now() / (tfMinutes * 60_000)) * tfMinutes * 60_000 - i * tfMinutes * 60_000,
    open: close * 0.998, high: close * 1.004, low: close * 0.996,
    close, volume: 100 + (i % 7) * 10,
  };
}).reverse();

vi.mock('../server/ai/data.js', () => ({
  INDIA_UNIVERSE: ['RELIANCE'],
  CRYPTO_UNIVERSE: ['BTC'],
  FUTURES_UNIVERSE: ['B-BTC_USDT'],
  fetchTVIndiaBatch: async () => ({}),
  fetchTVIndiaBatchChunked: async () => ({}),
  fetchTVCryptoBatch: async () => ({}),
  fetchCoinDcxCandles: async () => null,          // CoinDCX candles dark → Binance legs
  fetchBinanceKlines: async (base, tf = '1h') => /^[A-Z0-9]{2,15}$/.test(String(base || '')) ? fakeKlines(base === 'BTC' ? 76_300 : 2_430, { '1m': 1, '5m': 5, '15m': 15, '1h': 60, '4h': 240, '1d': 1440 }[tf] || 60) : null,
  fetchYahooQuotes: async () => ({}),
  isNseOpen: () => false,
}));
vi.stubGlobal('fetch', vi.fn(async (url) => {
  const u = String(url);
  if (u.includes('api.coindcx.com/exchange/ticker')) {
    return new Response(JSON.stringify([
      { market: 'BTCINR', last_price: '6540000', volume_24_hour: '42' },
    ]), { status: 200, headers: { 'content-type': 'application/json' } });
  }
  if (u.includes('USDINR=X')) {
    return new Response(JSON.stringify({
      chart: { result: [{ meta: { regularMarketPrice: FAKE_FX } }] },
    }), { status: 200, headers: { 'content-type': 'application/json' } });
  }
  if (u.includes('api.binance.com/api/v3/ticker/price')) {
    return new Response(JSON.stringify([{ symbol: 'BTCUSDT', price: '76300.5' }]), { status: 200, headers: { 'content-type': 'application/json' } });
  }
  throw new Error('offline (test)');
}));

const { getDeepSignal, __clearSignalCaches } = await import('../server/ai/signals.js');

beforeEach(() => { __clearSignalCaches(); });

describe('v13.3 fetchCryptoMTF6 — the crypto 6-TF ladder', () => {
  it('builds the full ladder from Binance legs (spot INR domain rescale)', async () => {
    const t = await fetchCryptoMTF6('BTC', 6_540_000, { usdPrice: 76_300 }, 'CRYPTO');
    expect(t).toBeTruthy();
    expect(t.tapeMTF).toBeTruthy();
    expect(t.tapeMTF.m5).toBeTruthy();
    expect(t.tapeMTF.m15).toBeTruthy();
    expect(t.tapeMTF.h1).toBeTruthy();
    expect(t.tapeMTF.d1).toBeTruthy();
    // the tapes stay in the desk's INR domain (rescaled onto the ltp anchor)
    expect(t.tapeMTF.m15.ltp).toBeGreaterThan(1_000_000);
    expect(t.tapeMTF.m15.ltp).toBeLessThan(7_000_000);
    expect(typeof t.tapeMTF.agreement).toBe('number');
  });

  it('all legs dark → honest null (seat abstains)', async () => {
    // dark: pass ltp=0 → no rescale reference AND mocked CoinDCX candles null
    // (Binance legs still answer, so force darkness by symbol mangling)
    const t = await fetchCryptoMTF6('', 0, null, 'CRYPTO');
    expect(t).toBeNull();
  });
});

// ============================================================
// 7. Deep-signal integration — the crypto card carries sig.mtf
// ============================================================
describe('v13.3 deep signal — crypto card carries the 6-TF ladder', () => {
  it("getDeepSignal('BTC','CRYPTO') stamps built.mtf + a tape-mtf vote", async () => {
    const deep = await getDeepSignal('BTC', 'CRYPTO', {});
    expect(deep.ok).toBe(true);
    expect(deep.signal.mtf).toBeTruthy();
    expect(deep.signal.mtf.m5).toBeTruthy();
    expect(deep.signal.mtf.m15).toBeTruthy();
    expect(deep.signal.mtf.h1).toBeTruthy();
    expect(['m1', 'h4', 'd1'].some(k => deep.signal.mtf[k] != null)).toBe(true);
    expect(typeof deep.signal.mtf.agreement).toBe('number');
    // the 6-TF seat actually VOTED (not an abstain)
    const tapeVoteRow = (deep.signal.votes || []).find(v => v.id === 'tape-mtf' || v.id === 'tape');
    expect(tapeVoteRow).toBeTruthy();
    expect(tapeVoteRow.dir).not.toBe(0);
  });
});

// ============================================================
// 8. reversalAutoCut round-trip (the XRP loss-cap dead-wiring fix)
// ============================================================
describe('v13.3 updateAgentConfig — reversalAutoCut actually saves', () => {
  it('PUT /reversal/config whitelisted key round-trips through the config store', async () => {
    const { updateAgentConfig, loadAgentConfig } = await import('../server/ai/agent.js');
    const before = loadAgentConfig().reversalAutoCut;
    expect(before).toBe(false); // documented default OFF
    const saved = updateAgentConfig({ reversalAutoCut: true });
    expect(saved.reversalAutoCut).toBe(true);
    expect(loadAgentConfig().reversalAutoCut).toBe(true); // persisted, not just echoed
    updateAgentConfig({ reversalAutoCut: false });
    expect(loadAgentConfig().reversalAutoCut).toBe(false);
  });
});

// ============================================================
// 9. stateOfManualTrade — the ₹ loss-cap banner actually fires
// ============================================================
describe('v13.3 stateOfManualTrade — reversal ₹-state on a collapsed trade', () => {
  it('price collapsed under the cap (target NOT currently reached) → LOSS_CAP', async () => {
    const { stateOfManualTrade } = await import('../server/ai/manualTrades.js');
    const trade = { side: 'BUY', entryPrice: 1.62, origin: { plan: { target1: 1.70, target2: 1.78 } } };
    expect(stateOfManualTrade({
      convictionState: 'HOLDING',
      ltp: 1.55, // under entry — reached(T1) false → the reversal ₹-state decides
      trade,
      reversal: { enabled: true, state: 'ACTIVE', pnlINR: -260, lossCapINR: 150 },
    })).toBe('LOSS_CAP');
  });

  it('no reversal cycle → the conviction ladder maps straight through', async () => {
    const { stateOfManualTrade } = await import('../server/ai/manualTrades.js');
    const trade = { side: 'BUY', entryPrice: 1.62, origin: { plan: { target1: 1.70, target2: 1.78 } } };
    expect(stateOfManualTrade({ convictionState: 'WEAKENING', ltp: 1.60, trade })).toBe('WEAKENING');
    expect(stateOfManualTrade({ convictionState: 'FLIPPED', ltp: 1.55, trade })).toBe('EXIT_NOW');
  });
});

// ============================================================
// 10. Paper desk PARTIAL — the breakeven floor wins
// ============================================================
describe('v13.3 paper desk PARTIAL — runner exits at the breakeven floor', () => {
  it('tick under entry AND under the original SL → BE_TRAIL close at entry (not SL_TRAIL_HIT at stopLoss)', async () => {
    const { openPaperTrade, evaluatePaper, _resetForTests } = await import('../server/intraday/paperTrading.js');
    _resetForTests();
    // LONG @100, SL 92, T1 108. Drive to T1 first (→ PARTIAL, trail armed at entry)
    const open = openPaperTrade({ symbol: 'XYZ', direction: 'LONG', entry: 100, qty: 10, stopLoss: 92, target1: 108, target2: 112, market: 'INDIA' });
    expect(open.ok).toBe(true);
    evaluatePaper({ XYZ: { price: 108 } }, []); // T1 books 50% → PARTIAL
    // now a collapse THROUGH entry (90 < entry 100 AND < old SL 92) —
    // the breakeven trail must fire FIRST at entry
    const events = [];
    evaluatePaper({ XYZ: { price: 90 } }, events);
    const beEvent = events.find(e => e.type === 'PAPER_CLOSE' && /breakeven/i.test(String(e.note || '')));
    const slEvent = events.find(e => e.type === 'PAPER_CLOSE' && /trail-stop/i.test(String(e.note || '')));
    expect(beEvent).toBeTruthy();   // the breakeven trail fired…
    expect(slEvent).toBeUndefined(); // …and the old full-risk SL close did NOT
    expect(beEvent.price).toBe(100); // closed AT entry (the floor)
  });
});
