#!/usr/bin/env bash
# ============================================================
# scripts/smoke_v1013.sh — v10.13 deep-recheck boot smoke.
# Boots the real server and LIVE-verifies the new security layer:
#   1. boot + /health (APP_PIN guard)
#   2. login → session cookie + bearer token
#   3. CSRF discriminator: cookie + sec-fetch-site:cross-site + NO bearer
#      on a state-changing POST → 403 (the H-2 fix)
#   4. same request WITH bearer → NOT blocked by CSRF (route may 400/401
#      for its own reasons — the assertion is "not the CSRF 403")
#   5. public /api/quote rate limit → 429 after the 900/10min budget
#   6. SSE /api/stream still serves ticks with the ?session= param
# ============================================================
set -u
cd "$(dirname "$0")/.."

PORT=3999
export PORT
BASE="http://127.0.0.1:$PORT"
PIN="9999xyz"
TOKEN_FILE=$(mktemp)
COOKIE_FILE=$(mktemp)

export APP_PIN="$PIN"
export NODE_ENV="test"

echo "[smoke] booting server on :$PORT ..."
node server/index.js > /tmp/smoke_v1013.log 2>&1 &
SERVER_PID=$!
trap 'kill $SERVER_PID 2>/dev/null; rm -f "$TOKEN_FILE" "$COOKIE_FILE"' EXIT

for i in $(seq 1 40); do
  sleep 0.5
  if curl -s -o /dev/null "$BASE/health"; then break; fi
done

PASS=0; FAIL=0
check() { # name, condition
  if [ "$2" = "1" ]; then PASS=$((PASS+1)); echo "  ✓ $1"; else FAIL=$((FAIL+1)); echo "  ✗ $1"; fi
}

# 1) health
H=$(curl -s "$BASE/health")
echo "$H" | grep -q '"ok":true' && check "boot + /health" 1 || check "boot + /health" 0

# 2) login (no cookie yet → CSRF guard must NOT block: nothing to hijack)
LOGIN=$(curl -s -c "$COOKIE_FILE" -X POST "$BASE/api/auth/login" \
  -H 'Content-Type: application/json' -H 'Origin: http://127.0.0.1:3999' \
  -H 'Sec-Fetch-Site: cross-site' \
  --data "{\"pin\":\"$PIN\"}")
TOKEN=$(echo "$LOGIN" | grep -o '"sessionToken":"[^"]*"' | cut -d'"' -f4)
[ -n "$TOKEN" ] && check "login returns sessionToken (cross-site login NOT blocked — no cookie yet)" 1 || check "login returns sessionToken" 0

# 3) CSRF: cookie + cross-site + no bearer → 403 on a state-changing POST
CSRF_CODE=$(curl -s -o /tmp/csrf_body.json -w '%{http_code}' -b "$COOKIE_FILE" \
  -X POST "$BASE/api/ai/trading/kill-switch" \
  -H 'Content-Type: text/plain' -H 'Sec-Fetch-Site: cross-site' \
  --data '{}')
[ "$CSRF_CODE" = "403" ] && check "CSRF: cookie + cross-site + no bearer → 403 (was silent kill-switch disable)" 1 \
  || check "CSRF: cookie + cross-site + no bearer → 403 (got $CSRF_CODE)" 0

# 3b) CSRF: same-site cookie request passes the discriminator (route-level auth applies)
SAME_CODE=$(curl -s -o /dev/null -w '%{http_code}' -b "$COOKIE_FILE" \
  -X POST "$BASE/api/ai/trading/kill-switch" \
  -H 'Content-Type: application/json' -H 'Sec-Fetch-Site: same-origin' \
  --data '{"enabled":true}')
[ "$SAME_CODE" != "403" ] && check "CSRF: same-site cookie mutation passes discriminator (got $SAME_CODE, not the CSRF 403)" 1 \
  || check "CSRF: same-site mutation wrongly blocked" 0

# 4) bearer + cross-site → CSRF guard passes (the app's own Vercel→Render path)
BEARER_CODE=$(curl -s -o /dev/null -w '%{http_code}' \
  -X POST "$BASE/api/ai/trading/kill-switch" \
  -H 'Content-Type: application/json' -H "Authorization: Bearer $TOKEN" \
  -H 'Sec-Fetch-Site: cross-site' \
  --data '{"enabled":true}')
[ "$BEARER_CODE" != "403" ] && check "CSRF: bearer + cross-site passes (app's own cross-origin path, got $BEARER_CODE)" 1 \
  || check "CSRF: bearer + cross-site wrongly blocked" 0

# 5) public /api/quote rate limit (900/10min) — hammer past the budget
echo "[smoke] hammering /api/quote x 905 (rate limit check) ..."
LAST_CODE=200
for i in $(seq 1 905); do
  LAST_CODE=$(curl -s -o /dev/null -w '%{http_code}' "$BASE/api/quote?symbols=RELIANCE&market=IN")
done
[ "$LAST_CODE" = "429" ] && check "public /api/quote rate limit → 429 past the budget" 1 \
  || check "public /api/quote rate limit (got $LAST_CODE)" 0

# 6) SSE still serves with ?session= (liveStream contract unchanged)
SSE_CODE=$(curl -s -o /dev/null -w '%{http_code}' --max-time 3 \
  "$BASE/api/stream?in=RELIANCE&session=$TOKEN")
[ "$SSE_CODE" = "200" ] && check "SSE /api/stream?session= still 200" 1 || check "SSE stream (got $SSE_CODE)" 0

echo ""
echo "[smoke] RESULT: $PASS passed, $FAIL failed"
[ "$FAIL" = "0" ] || { echo "[smoke] server log tail:"; tail -20 /tmp/smoke_v1013.log; exit 1; }
