#!/usr/bin/env bash
# ============================================================
# scripts/smoke_v1015.sh — v10.15 boot smoke
# ------------------------------------------------------------
# Boots the REAL server (test env) and verifies the v10.15 wiring
# end-to-end on the live process:
#   1. /api/ai/event-guard answers with the FOMC/RBI/CPI calendar
#   2. /api/feed-status carries the Binance futures WS accelerator tier
#   3. the new modules import + register (binanceFutWs / eventGuard /
#      positionConviction / globalRisk / patientEntry)
#   4. /api/stream?session= still 200 (cxRtStream regression guard)
# Zero external credentials needed — public endpoints only.
# ============================================================
set -u
PORT="${SMOKE_PORT:-4599}"
BASE="http://127.0.0.1:${PORT}"
API_TOKEN="${API_TOKEN:-smoke-test-token}"
PASS=0; FAIL=0

note() { printf '%s\n' "$*"; }
ok()   { PASS=$((PASS+1)); note "✅ $*"; }
bad()  { FAIL=$((FAIL+1)); note "❌ $*"; }

cd "$(dirname "$0")/.."

# module import smoke (no server needed)
node --input-type=module -e "
import('./server/ai/binanceFutWs.js').then(async (m1) => {
  const m2 = await import('./server/ai/eventGuard.js');
  const m3 = await import('./server/ai/positionConviction.js');
  const m4 = await import('./server/ai/globalRisk.js');
  const m5 = await import('./server/ai/patientEntry.js');
  const has = (m, k) => typeof m[k] === 'function';
  const checks = [
    ['binanceFutWs.syncBinanceFutAccelerator', has(m1, 'syncBinanceFutAccelerator')],
    ['binanceFutWs.binanceFutStatus', has(m1, 'binanceFutStatus')],
    ['eventGuard.eventGuardCheck', has(m2, 'eventGuardCheck')],
    ['eventGuard.eventGuardStatus', has(m2, 'eventGuardStatus')],
    ['positionConviction.classifyConviction', has(m3, 'classifyConviction')],
    ['globalRisk.globalRiskGate', has(m4, 'globalRiskGate')],
    ['patientEntry.classifyEntry', has(m5, 'classifyEntry')],
  ];
  const bad = checks.filter(([, v]) => !v).map(([k]) => k);
  if (bad.length) { console.error('MISSING: ' + bad.join(', ')); process.exit(1); }
  console.log('modules OK: ' + checks.length + ' exports');
}).catch((e) => { console.error('IMPORT FAIL: ' + e.message); process.exit(1); });
" && ok "v10.15 modules import + exports" || bad "v10.15 modules failed to import"

# hermetic sanity of the graded guard (no clock dependency beyond "today")
GUARD_JSON=$(node --input-type=module -e "
import('./server/ai/eventGuard.js').then((m) => {
  const st = m.eventGuardStatus({});
  console.log(JSON.stringify({ enabled: st.enabled, upcoming: st.upcoming.length }));
});")
GUARD_N=$(echo "$GUARD_JSON" | grep -o '"upcoming":[0-9]*' | grep -o '[0-9]*$')
echo "$GUARD_JSON" | grep -q '\"enabled\":true' && ok "eventGuard enabled + ${GUARD_N} upcoming events listed" || bad "eventGuard status: $GUARD_JSON"

# boot the server
API_TOKEN="$API_TOKEN" SESSION_SECRET=smoke PORT="$PORT" NODE_ENV=production APP_PIN=0000 ALLOWED_ORIGINS="http://127.0.0.1:${PORT}" \
  node server/index.js > /tmp/smoke_v1015.log 2>&1 &
SRV=$!
trap 'kill $SRV 2>/dev/null || true' EXIT
sleep 6

# 1. event-guard route
EG=$(curl -s -m 5 -H "Authorization: Bearer $API_TOKEN" "$BASE/api/ai/event-guard")
echo "$EG" | grep -q '"ok":true' && ok "GET /api/ai/event-guard → ok" || bad "event-guard route: $(echo "$EG" | head -c 120)"
echo "$EG" | grep -qE 'FOMC|RBI|CPI' && ok "event-guard carries the macro calendar" || bad "event-guard calendar empty"

# 2. feed-status carries the accelerator tier
FS=$(curl -s -m 5 -H "Authorization: Bearer $API_TOKEN" "$BASE/api/feed-status")
echo "$FS" | grep -q 'binanceFut' && ok "/api/feed-status carries the Binance FUT WS accelerator tier" || bad "feed-status missing binanceFut: $(echo "$FS" | head -c 160)"

# 3. SSE still healthy (cxRtStream regression guard)
SESS=$(curl -s -m 5 -X POST -H "Authorization: Bearer $API_TOKEN" -H 'Content-Type: application/json' \
  -d '{"pin":"0000"}' "$BASE/api/auth/login" | grep -o '"token":"[^"]*"' | head -1 | cut -d'"' -f4)
if [ -n "$SESS" ]; then
  CODE=$(curl -s -m 4 -o /dev/null -w '%{http_code}' "$BASE/api/stream?session=$SESS&fut=BTC&glob=AAPL")
  [ "$CODE" = "200" ] && ok "SSE /api/stream?session= → 200 (cxRtStream + accelerator tier live)" || bad "SSE → $CODE"
else
  # session-token fallback path (older smoke style): bearer alone
  CODE=$(curl -s -m 4 -o /dev/null -w '%{http_code}' -H "Authorization: Bearer $API_TOKEN" "$BASE/api/stream?fut=BTC")
  [ "$CODE" = "200" ] && ok "SSE /api/stream (bearer) → 200" || bad "SSE bearer → $CODE"
fi

# 4. trust view carries the direction split payload shape
TR=$(curl -s -m 6 -H "Authorization: Bearer $API_TOKEN" "$BASE/api/ai/trust")
echo "$TR" | grep -q '"calibration"' && ok "GET /api/ai/trust alive (direction split rides on calibration)" || bad "trust route: $(echo "$TR" | head -c 120)"

note "────"
note "SMOKE v10.15: $PASS passed · $FAIL failed"
[ "$FAIL" = "0" ]
