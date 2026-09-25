// ============================================================
// scripts/smoke_v133.mjs — v13.3 MTF-6 SUPER INTELLIGENCE smoke
// ------------------------------------------------------------
// Live-data sanity: the 6-TF ladder builds on REAL Yahoo India bars
// + REAL Binance crypto bars, the vote rules fire, and the wire
// payload carries all six timeframes. No keys needed.
// ============================================================
// THE FLAG first — the registry builds at module load, and ESM imports
// HOIST above any statement — so the flag is set BEFORE dynamic imports
// (render.yaml ships it ON in production; the smoke mirrors the deploy).
process.env.AI_ENABLE_MTF_CONFLUENCE = 'true';
const { tapeMTFFromBase6, mtfWirePayload, fetchCryptoMTF6 } = await import('../server/ai/signals.js');
const { MODELS, runQuantModels } = await import('../server/ai/models.js');
const { verifySignal } = await import('../server/ai/signalVerifier.js');
const { aggregateVotes } = await import('../server/ai/ensemble.js');

let pass = 0, fail = 0;
const ok = (name, cond, extra = '') => {
  if (cond) { pass++; console.log(`  ✓ ${name}${extra ? ' — ' + extra : ''}`); }
  else { fail++; console.log(`  ✗ ${name}${extra ? ' — ' + extra : ''}`); }
};

console.log('[S1] registry — the MTF-6 seat');
const seat = MODELS.find(m => m.id === 'tape-mtf');
ok('tape-mtf seat registered (w 1.6)', !!seat && seat.weight === 1.6);
ok('role names the 6-TF ladder', /1m\/5m\/15m\/1h\/4h\/1d/.test(seat?.role || ''));

console.log('[S2] India 6-TF ladder on REAL Yahoo bars (RELIANCE)');
const yq = async (interval, range) => {
  const r = await fetch(`https://query1.finance.yahoo.com/v8/finance/chart/RELIANCE.NS?interval=${interval}&range=${range}`, {
    headers: { 'User-Agent': 'Mozilla/5.0 (WealthAI smoke)' }, signal: AbortSignal.timeout(10000),
  });
  if (!r.ok) return null;
  const j = await r.json();
  const res = j?.chart?.result?.[0];
  const ts = res?.timestamp; const q = res?.indicators?.quote?.[0];
  if (!Array.isArray(ts) || !q) return null;
  const rows = [];
  for (let i = 0; i < ts.length; i++) {
    if (q.open?.[i] == null || q.close?.[i] == null) continue;
    rows.push({ time: ts[i] * 1000, open: q.open[i], high: q.high?.[i] ?? q.close[i], low: q.low?.[i] ?? q.close[i], close: q.close[i], volume: q.volume?.[i] || 0 });
  }
  return rows.length >= 60 ? rows : null;
};
try {
  const [c1, c5, c15, c1h, c1d] = await Promise.all([yq('1m', '1d'), yq('5m', '1mo'), yq('15m', '1mo'), yq('1h', '3mo'), yq('1d', '1y')]);
  const ladder = c5 ? tapeMTFFromBase6(c1, c5, c15, c1h, c1d, null) : null;
  ok('ladder built from live bars', !!ladder, c5 ? `legs: ${[c1, c15, c1h, c1d].map(x => x ? '✓' : '—').join('')} · agreement ${ladder?.agreement != null ? Math.round(ladder.agreement * 100) + '%' : 'null'}` : '5m dark');
  if (ladder) {
    const w = mtfWirePayload(ladder);
    ok('wire payload carries the 6 TFs', ['m1', 'm5', 'm15', 'h1', 'h4', 'd1'].filter(k => w[k] != null).length >= 4);
    const v = runQuantModels({ market: 'INDIA', symbol: 'RELIANCE', ltp: 1, tapeMTF: ladder }).find(x => x.id === 'tape-mtf');
    ok('seat votes on the live ladder', v.dir !== 0 || /abstains/.test(v.reasons.join(' ')), `dir ${v.dir} · ${String(v.reasons[0]).slice(0, 80)}`);
  }
} catch (e) { ok('Yahoo legs reachable', false, String(e?.message || e).slice(0, 60)); }

console.log('[S3] crypto 6-TF ladder on REAL Binance bars (BTC)');
try {
  const t = await fetchCryptoMTF6('BTC', 0, null, 'FUTURES');
  ok('crypto ladder built (USDT domain)', !!t?.tapeMTF, t?.tapeMTF ? `agreement ${t.tapeMTF.agreement != null ? Math.round(t.tapeMTF.agreement * 100) + '%' : 'null'} · tide ${t.tapeMTF.__htfDir}` : 'legs dark');
  if (t?.tapeMTF) {
    const w = mtfWirePayload(t.tapeMTF);
    ok('crypto wire payload 6 TFs', ['m1', 'm5', 'm15', 'h1', 'h4', 'd1'].filter(k => w[k] != null).length >= 4);
  }
} catch (e) { ok('Binance legs reachable', false, String(e?.message || e).slice(0, 60)); }

console.log('[S4] ensemble + SVA on a 6-TF agreement');
const c6 = aggregateVotes([
  { id: 'trend', name: 'T', weight: 1.4, dir: 1, conf: 80, reasons: [] },
  { id: 'momentum', name: 'M', weight: 1.3, dir: 1, conf: 80, reasons: [] },
  { id: 'volume', name: 'V', weight: 1.2, dir: 1, conf: 80, reasons: [] },
], { minConfidence: 70, minAgreement: 0.6 }, { mtfAgreement: 0.5 });
ok('6-voter 0.5 agreement → STRONG banned', c6.grade === 'ACTION' && c6.mtfCapped === true);
const v = verifySignal({
  symbol: 'BTC', market: 'FUTURES', side: 'LONG', ltp: 76000, confidence: 55, grade: 'ACTION',
  voters: 9, totalModels: 14, plan: { entry: 76000, stopLoss: 75200, target1: 77600, target2: 79200, riskPct: 1.05, rr: 2 },
  summary: 'smoke', quality: { mtf: { phase: 'n/a', aligned: true, available: true } },
  mtf: { m5: { dir: 1, conf: 60 }, m15: { dir: 1, conf: 60 }, h1: { dir: 1, conf: 60 }, m1: { dir: 1, conf: 55 }, h4: { dir: 1, conf: 55 }, d1: { dir: 0, conf: 40 }, agreement: 0.9 },
});
const mtfRow = v.checklist.find(c => c.id === 'mtf');
ok('SVA mtf check PASSES on the crypto ladder', mtfRow.status === 'PASS' && /1m\/5m\/15m\/1h\/4h\/1d/.test(mtfRow.detail), mtfRow.detail);

console.log(`\n===== SMOKE v13.3: ${pass} pass / ${fail} fail =====`);
process.exit(fail ? 1 : 0);
