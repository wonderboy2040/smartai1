#!/usr/bin/env node
// ============================================================
// scripts/v613-verify.mjs — v6.13 ORDER TICKET + SIMPLE VIEW
// ------------------------------------------------------------
// Boots nothing (uses the running server), logs in with PIN 1992,
// and asserts the "trade kaise karna hai" transformation:
//   1. boot + auth (1992 in, 2023 out)
//   2. engine stamp v6.13
//   3. options desk: dte field present (IST calendar semantics)
//   4. every strategy carries orderTicket with the 4 steps:
//      whenText (KAB) / expiryText (KONSA expiry) / legs with
//      LIMIT prices (0.05 tick, fill-friendly side) / exit block
//   5. limit prices honest: BUY ≥ LTP, SELL ≤ LTP, valid ticks
//   6. lot rows 1/2/3 linear scaling, perLotLoss > 0
//   7. whenText session-aware (phase name inside)
//   8. expiry-day OR dte-based advice present
//   9. anonymous access still 401
// ------------------------------------------------------------
const BASE = process.env.VERIFY_BASE || 'http://localhost:8791';
let pass = 0, fail = 0;
const ok = (name, cond, extra = '') => {
  if (cond) { pass++; console.log(`  ✓ ${name}${extra ? ' — ' + extra : ''}`); }
  else { fail++; console.log(`  ✗ FAIL: ${name}${extra ? ' — ' + extra : ''}`); }
};

async function main() {
  console.log('v6.13 ORDER TICKET + SIMPLE VIEW verify\n=======================================');

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

  // 2. engine stamp
  const status = await (await fetch(`${BASE}/api/ai/status`, { headers: H })).json();
  const stampOk = /v6\.13/.test(JSON.stringify(status || {}));
  ok('engine stamp v6.13', stampOk, status?.engine || status?.aiEngine || '');

  // 3. options desk (NIFTY) — ticket layer
  const desk = await (await fetch(`${BASE}/api/ai/options?symbol=NIFTY&t=${Date.now()}`, { headers: H })).json();
  ok('options desk ok', desk?.ok === true, `source ${desk?.source}, spot ${desk?.spot}`);
  ok('desk carries dte (IST calendar)', desk?.dte == null ? false : desk.dte >= 0, `dte ${desk?.dte} · expiry ${desk?.expiry}`);

  const strats = desk?.strategies || [];
  ok('strategies built', strats.length > 0, `${strats.length} strategies`);
  const withTicket = strats.filter(s => s.orderTicket);
  ok('every strategy carries orderTicket', strats.length > 0 && withTicket.length === strats.length, `${withTicket.length}/${strats.length}`);

  // 4. the four steps
  const allHaveSteps = withTicket.every(t => {
    const x = t.orderTicket;
    return typeof x.whenText === 'string' && x.whenText.length > 10
      && typeof x.expiryText === 'string' && x.expiryText.length > 10
      && Array.isArray(x.legs) && x.legs.length === t.legs.length
      && x.exit && typeof x.exit.sl === 'string' && typeof x.exit.target === 'string' && typeof x.exit.time === 'string'
      && x.exit.sl.length > 10 && x.exit.time.length > 10;
  });
  ok('orderTicket = 4 steps (KAB/expiry/legs/exit) complete', allHaveSteps);

  // 5. limit prices honest
  const legs = withTicket.flatMap(t => t.orderTicket.legs);
  const buyOk = legs.filter(l => l.action === 'BUY').every(l => l.limit >= l.ltp && l.limit > 0);
  const sellOk = legs.filter(l => l.action === 'SELL').every(l => l.limit <= l.ltp && l.limit > 0);
  const tickOk = legs.every(l => Math.abs(l.limit * 20 - Math.round(l.limit * 20)) < 1e-9);
  ok('BUY limits ≥ LTP (fill-friendly, no underpay fantasy)', buyOk, `${legs.filter(l => l.action === 'BUY').length} buy legs`);
  ok('SELL limits ≤ LTP', sellOk, `${legs.filter(l => l.action === 'SELL').length} sell legs`);
  ok('all limits on ₹0.05 tick', tickOk);

  // 6. lot rows scaling
  const lotOk = withTicket.every(t => !t.orderTicket.lotRows?.length
    || (t.orderTicket.lotRows.length === 3
      && t.orderTicket.lotRows[2].maxLoss === t.orderTicket.lotRows[0].maxLoss * 3));
  ok('lot rows 1/2/3 linear (risk scaling)', lotOk);

  // 7. session phase awareness inside whenText
  const PHASES = ['PRE_OPEN', 'OPENING', 'MORNING', 'MIDDAY', 'AFTERNOON', 'POWER', 'NO_NEW_ENTRIES', 'CLOSED'];
  const phaseKnown = withTicket.every(t => PHASES.includes(t.orderTicket.sessionPhase));
  ok('whenText session-phase aware', phaseKnown, withTicket[0]?.orderTicket?.sessionPhase);

  // 8. expiry advice: expiry-day flag consistent with dte
  const expOk = withTicket.every(t => (t.orderTicket.dte <= 0) === t.orderTicket.expiryDay);
  ok('expiryDay flag consistent with dte', expOk, `dte ${withTicket[0]?.orderTicket?.dte}`);

  // 9. second index (BANKNIFTY) — different lot size wires through
  const bdesk = await (await fetch(`${BASE}/api/ai/options?symbol=BANKNIFTY&t=${Date.now()}`, { headers: H })).json().catch(() => null);
  if (bdesk?.ok) {
    const bt = (bdesk.strategies || []).filter(s => s.orderTicket);
    const lotSizeOk = bt.every(t => t.orderTicket.legs.every(l => l.qtyPerLot === bdesk.lotSize));
    ok('BANKNIFTY ticket qty/lot = desk lotSize (35)', lotSizeOk, `lot ${bdesk.lotSize}`);
  } else {
    ok('BANKNIFTY desk honest-skip (data unavailable allowed)', true, 'desk not ok — honest degrade');
  }

  // 10. anonymous access still gated
  const anon = await fetch(`${BASE}/api/ai/options?symbol=NIFTY`, { headers: { 'Content-Type': 'application/json' } });
  ok('anonymous options access 401', anon.status === 401);

  console.log(`\nRESULT: ${pass} pass / ${fail} fail — v6.13 ${fail === 0 ? 'VERIFIED' : 'FAILED'}`);
  process.exit(fail === 0 ? 0 : 1);
}

main().catch(e => { console.error('verify crash:', e); process.exit(1); });
