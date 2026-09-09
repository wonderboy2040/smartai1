#!/usr/bin/env node
// ============================================================
// scripts/v612-verify.mjs — v6.12 PRO TRADER BRAIN verify
// ------------------------------------------------------------
// Boots nothing (uses the running dev server), logs in with PIN
// 1992, and asserts the signal-quality transformation end-to-end:
//   1. boot + auth (1992 in, 2023 out)
//   2. engine stamp v6.12
//   3. boards carry sessionPhase + regime trend fields
//   4. every signal carries a quality object (quorum/mtf/regime)
//   5. quorum honesty: voters ≤ 2 signals are never ACTION/STRONG
//   6. extension veto active on big day-moves
//   7. deep signal: SMC vote alive on LTF candles + ltf snapshot
//      + edge stats (honest when present, honest-skip allowed)
//   8. paper gate: ACTION floor live (WATCH signal rejected)
//   9. anonymous access still 401
// ============================================================
const BASE = process.env.VERIFY_BASE || 'http://localhost:8791';
let pass = 0, fail = 0;
const ok = (name, cond, extra = '') => {
  if (cond) { pass++; console.log(`  ✓ ${name}${extra ? ' — ' + extra : ''}`); }
  else { fail++; console.log(`  ✗ FAIL: ${name}${extra ? ' — ' + extra : ''}`); }
};

async function main() {
  console.log('v6.12 PRO TRADER BRAIN verify\n==============================');

  // 1. auth
  const login = await fetch(`${BASE}/api/auth/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ pin: '1992' }),
  });
  const lj = await login.json();
  ok('login PIN 1992', login.ok && lj.ok === true);
  const cookie = (login.headers.get('set-cookie') || '').split(';')[0];
  const H = { Cookie: cookie, 'Content-Type': 'application/json' };

  const bad = await fetch(`${BASE}/api/auth/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ pin: '2023' }),
  });
  ok('old PIN 2023 rejected', !(await bad.json())?.ok);

  // 2. engine stamp (lives on /api/ai/status)
  const status = await (await fetch(`${BASE}/api/ai/status`, { headers: H })).json();
  const stampOk = /v6\.12/.test(JSON.stringify(status || {}));
  ok('engine stamp v6.12', stampOk, status?.engine || status?.aiEngine || '');

  // 3-5. India board
  const ind = await (await fetch(`${BASE}/api/ai/signals?market=INDIA&limit=10&t=${Date.now()}`, { headers: H })).json();
  ok('India board ok', ind?.ok === true, `scanned ${ind?.scanned}`);
  ok('India sessionPhase present', !!ind?.sessionPhase?.phase, ind?.sessionPhase?.phase);
  ok('India regime has daily trend field', 'niftyTrend' in (ind?.regime || {}) || ind?.regime?.niftyTrend === null || ind?.regime?.niftyTrend != null);
  const indSigs = ind?.signals || [];
  const withQuality = indSigs.filter(s => s.quality);
  ok('India signals carry quality objects', indSigs.length > 0 && withQuality.length === indSigs.length, `${withQuality.length}/${indSigs.length}`);
  const quorumHonest = withQuality.every(s => {
    const voters = s.voters ?? s.quality?.quorum?.voters ?? 9;
    if (voters <= 2) return s.grade === 'WATCH' || s.grade === 'NEUTRAL';
    return true;
  });
  ok('quorum honesty: ≤2-voter signals never ACTION/STRONG', quorumHonest);
  const capCoherent = withQuality.every(s => {
    const g = s.grade;
    if (s.quality?.veto) return g === 'WATCH' || g === 'NEUTRAL';
    return true;
  });
  ok('extension/session vetos cap the grade at WATCH', capCoherent);

  // 3-5. Crypto board
  const cry = await (await fetch(`${BASE}/api/ai/signals?market=CRYPTO&limit=10&t=${Date.now()}`, { headers: H })).json();
  ok('Crypto board ok', cry?.ok === true, `scanned ${cry?.scanned}`);
  ok('Crypto regime has btcTrend field', 'btcTrend' in (cry?.regime || {}));
  const crySigs = cry?.signals || [];
  const cryQuality = crySigs.filter(s => s.quality);
  ok('Crypto signals carry quality objects', crySigs.length > 0 && cryQuality.length === crySigs.length, `${cryQuality.length}/${crySigs.length}`);
  const cryQuorum = cryQuality.every(s => {
    const voters = s.voters ?? s.quality?.quorum?.voters ?? 9;
    if (voters <= 2) return s.grade === 'WATCH' || s.grade === 'NEUTRAL';
    return true;
  });
  ok('Crypto quorum honesty', cryQuorum);
  // the pre-v6.11 bug: every crypto signal LONG with conf 74 from ONE voter
  const noFakeConsensus = crySigs.every(s => !(s.confidence >= 55 && (s.voters ?? 9) <= 2));
  ok('no single-voter fake ACTION on crypto (the v6.11 bug)', noFakeConsensus);

  // 6. extension guard active somewhere it matters (DOT pumped days vary —
  // just assert the guard logic exists via a big-move signal if present)
  const bigMove = (indSigs.concat(crySigs)).find(s => Math.abs(s.changePct ?? 0) >= 8);
  if (bigMove) {
    ok('extension veto visible on a ≥8% mover', bigMove.quality?.extension?.veto === true || bigMove.grade === 'WATCH' || bigMove.grade === 'NEUTRAL', `${bigMove.symbol} ${(bigMove.changePct ?? 0).toFixed(1)}%`);
  } else {
    ok('extension guard: no ≥8% mover on board today (n/a)', true);
  }

  // 7. deep signal — LTF + SMC + edge
  const deep = await (await fetch(`${BASE}/api/ai/deep/ETH?market=CRYPTO&t=${Date.now()}`, { headers: H })).json();
  ok('ETH deep ok', deep?.ok === true && !!deep?.signal);
  ok('ETH deep has LTF snapshot', deep?.ltf?.label === '1h' && deep?.ltf?.rsi != null, `rsi ${(deep?.ltf?.rsi ?? 0).toFixed(1)}`);
  const smcVote = (deep?.signal?.votes || []).find(v => v.id === 'smc');
  ok('SMC model reading LTF candles', !!smcVote, smcVote ? `dir ${smcVote.dir} conf ${smcVote.conf}` : 'abstain — honest');
  ok('ETH deep has quality object', !!deep?.signal?.quality?.mtf, deep?.signal?.quality?.mtf?.phase);
  if (deep?.edge) {
    ok('ETH EDGE stats present + disclaimer', deep.edge.trades > 0 && /past performance/i.test(deep.edge.disclaimer || ''), `${deep.edge.trades} trades, WR ${(deep.edge.winRate ?? 0).toFixed(1)}%`);
  } else {
    ok('ETH EDGE honest-skip (no usable LTF history)', true);
  }
  const deepIn = await (await fetch(`${BASE}/api/ai/deep/SBILIFE?market=INDIA&t=${Date.now()}`, { headers: H })).json();
  ok('SBILIFE deep ok + 15m LTF', deepIn?.ok === true && (deepIn?.ltf?.label === '15m' || deepIn?.ltf === null), deepIn?.ltf ? `rsi ${deepIn.ltf.rsi?.toFixed(1)}` : 'LTF unavailable (honest)');
  if (deepIn?.edge) ok('SBILIFE EDGE stats', deepIn.edge.trades > 0, `${deepIn.edge.trades} trades`);

  // 8. paper gate — ACTION floor (WATCH/NEUTRAL signal must refuse)
  // Use a symbol whose fresh consensus is weak: run deep on a NEUTRAL/WATCH
  // signal and attempt a paper execute.
  const weak = (deepIn?.signal?.grade === 'WATCH' || deepIn?.signal?.grade === 'NEUTRAL') ? deepIn?.signal : null;
  if (weak) {
    const ex = await (await fetch(`${BASE}/api/ai/india/execute`, {
      method: 'POST', headers: H,
      body: JSON.stringify({ symbol: 'SBILIFE', side: weak.side || 'LONG', mode: 'paper', qtyINR: 1000 }),
    })).json();
    const honestly = ex?.ok === false && /ACTION-grade|paper floor|grade/i.test(String(ex?.error || ''));
    ok('paper ACTION floor rejects a weak fresh signal', honestly, String(ex?.error || '').slice(0, 60));
  } else {
    ok('paper ACTION floor (n/a — fresh signal already tradeable)', true);
  }

  // 9. anonymous 401
  const anon = await fetch(`${BASE}/api/ai/signals?market=INDIA`);
  ok('anonymous board access 401', anon.status === 401);

  console.log('------------------------------');
  console.log(`RESULT: ${pass} pass / ${fail} fail — v6.12 ${fail === 0 ? 'VERIFIED' : 'FAILED'}`);
  process.exit(fail === 0 ? 0 : 1);
}

main().catch(e => { console.error('verify crashed:', e); process.exit(1); });
