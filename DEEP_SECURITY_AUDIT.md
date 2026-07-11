# Deep Security Audit Report — Critical Paths
**Date:** 2026-07-11
**Project:** Wealth AI Pro (smartai1)
**Scope:** Authentication & Authorization, Payment/Financial Logic, Input Handling

---

## Executive Summary

A deep security audit was performed on all critical paths. **9 vulnerabilities** were found across authentication, financial data access, and input handling. All have been **FIXED**.

| # | Vulnerability | Severity | Status |
|---|--------------|----------|--------|
| VULN-1 | No auth on ANY server endpoint | CRITICAL | FIXED |
| VULN-2 | IDOR on thesis/schedule endpoints | HIGH | FIXED |
| VULN-3 | Client-side PIN bypassable | MEDIUM | FIXED |
| VULN-4 | Unauthenticated broker endpoints | CRITICAL | FIXED |
| VULN-5 | /api/telegram HTML injection | HIGH | FIXED |
| VULN-6 | HTML injection in bot messages | MEDIUM | FIXED |
| VULN-7 | No input size limits (DoS) | MEDIUM | FIXED |
| VULN-8 | No symbol validation (open proxy) | LOW | FIXED |
| VULN-9 | Error messages leak internals | LOW | FIXED |

---

## AUTHENTICATION & AUTHORIZATION

### VULN-1: No authentication on ANY server API endpoint (CRITICAL)

**What:** Every `/api/*` endpoint was publicly accessible with no authentication. Anyone who knew the server URL could call any endpoint.

**Where:** `server/index.js` — ALL 40+ routes had zero auth middleware.

**How an attacker would exploit it:**
```
curl https://smartai1.onrender.com/api/thesis        → read all investment theses
curl https://smartai1.onrender.com/api/schedule      → read all scheduled jobs
curl https://smartai1.onrender.com/api/broker/dhan/holdings → read real stock holdings
```

**Fix:** Added server-side PIN authentication system:
- `APP_PIN` env var (server-side only, never exposed to browser)
- `POST /api/auth/login` — verifies PIN using `crypto.timingSafeEqual()` (prevents timing attacks), sets httpOnly + SameSite=Strict session cookie
- `POST /api/auth/logout` — clears session
- `GET /api/auth/check` — returns auth status
- `requireAuth` middleware — applied to ALL requests; checks session cookie
- Login rate limiter: 5 attempts/minute per IP (brute-force protection)
- Session TTL: 24 hours of inactivity
- Server refuses to start if `APP_PIN` is not set
- Public paths (health, login, config, ai-status) are exempt

**Verified:** Unauthenticated requests now return `401 Authentication required`. Authenticated requests work normally.

---

### VULN-2: IDOR on thesis and schedule endpoints (HIGH)

**What:** The `POST /api/thesis` and `POST /api/schedule` endpoints accepted an `id` field from the client body. If the ID matched an existing record, it was overwritten (via `...existing` spread).

**Where:** `server/index.js` lines 1417 (thesis POST), 1458 (schedule POST)

**How an attacker would exploit it:**
```bash
# Overwrite any thesis by guessing/enumerating IDs
POST /api/thesis
{"id":"thesis_12345_abcde","symbol":"HACK","thesis":"malicious content"}
```

**Fix:**
- `POST /api/thesis` now ALWAYS generates a new server-side ID using `crypto.randomBytes()`. Client-supplied `id` is ignored.
- Added `PUT /api/thesis/:id` for updates (must exist).
- Same fix applied to `POST /api/schedule`.
- All string fields are capped (symbol: 20 chars, thesis: 10,000 chars, prompt: 5,000 chars).

**Verified:** Creating a thesis with an existing ID now generates a NEW ID — the existing thesis is not touched.

---

### VULN-3: Client-side PIN auth bypassable (MEDIUM)

**What:** The PIN was checked entirely in the browser: `pinInput === import.meta.env.VITE_SECURE_PIN || '2023'`. The `authDone` flag was stored in localStorage.

**Where:** `src/hooks/useAppState.ts` line 1188

**How an attacker would exploit it:**
1. Open browser devtools → `localStorage.setItem('authDone', 'true')` → PIN bypassed
2. Read the built JS bundle → find `VITE_SECURE_PIN` value

**Fix:**
- PIN verification moved to the server (`/api/auth/login` with `APP_PIN` env var)
- PIN is never shipped to the browser
- Session is managed via httpOnly cookie (JavaScript cannot read it)
- Frontend calls `/api/auth/login` with `credentials: 'include'`
- The hardcoded fallback `'2023'` is removed

---

### VULN-4: Unauthenticated broker endpoints expose real holdings (CRITICAL)

**What:** `/api/broker/dhan/holdings`, `/api/broker/dhan/positions`, and `/api/broker/shoonya/holdings` had no auth. Anyone could see the user's real stock portfolio.

**Where:** `server/index.js` lines 1072-1178

**How an attacker would exploit it:**
```bash
curl https://smartai1.onrender.com/api/broker/dhan/holdings
→ Returns actual stock holdings, quantities, and values from the user's Dhan account
```

**Fix:** All broker endpoints are now protected by `requireAuth` middleware (via the global auth middleware). Unauthenticated requests return `401`.

**Verified:** `curl /api/broker/dhan/holdings` without cookie → `401 Authentication required`.

---

## PAYMENT / FINANCIAL LOGIC

**Note:** This app has no payment processing (no Stripe/Razorpay, no order placement). The broker connectors are **read-only** (positions/holdings only, no trade execution). However:

### VULN-5: /api/telegram allows arbitrary HTML injection to user's chat (HIGH)

**What:** The `/api/telegram` endpoint forwarded the client-supplied `message` string directly to Telegram with `parse_mode: 'HTML'`. No auth, no sanitization.

**Where:** `server/index.js` lines 627-645

**How an attacker would exploit it:**
```bash
curl -X POST https://smartai1.onrender.com/api/telegram \
  -H 'Content-Type: application/json' \
  -d '{"message":"<a href=\"http://evil.com\">🔔 Important: Update your broker credentials</a>"}'
```
The user's Telegram receives a clickable phishing link that appears to come from the trusted bot.

**Fix:**
- `stripHtml()` removes ALL HTML tags from the message
- `escapeHtml()` escapes remaining special characters
- Result: only plain text reaches Telegram, even under HTML parse mode
- Also protected by `requireAuth` middleware (must be logged in)

---

### Broker Connector Security (No client manipulation possible)

**Audit result:** The broker endpoints (`/api/broker/dhan/*`, `/api/broker/shoonya/*`) do NOT accept any client-controlled parameters. They use only server-side env vars (`DHAN_CLIENT_ID`, `DHAN_ACCESS_TOKEN`, `SHOONYA_USER_ID`, etc.) to make read-only API calls. An authenticated user cannot manipulate what the server sends to the broker — the server always fetches the same data. **No fix needed** (beyond the auth fix in VULN-1/4).

---

## INPUT HANDLING

### VULN-6: HTML injection in Telegram bot messages (MEDIUM)

**What:** User-provided symbols were interpolated directly into HTML messages sent via `safeSend()` with `parse_mode: 'HTML'`.

**Where:** `telegram-bot/bot.mjs` — `/scan`, `/compare`, `/exact`, `/setkey` commands

**How an attacker would exploit it:**
```
/scan <b>SYSTEM ALERT: Sell everything immediately!</b>
```
The bot echoes this as formatted HTML in the chat.

**Fix:**
- Added `escapeHtml()` helper function
- Applied to all user-provided content in HTML messages:
  - `/scan`: `escapeHtml(symbol)` in 3 locations (scanning message, not-found error, error message)
  - `/compare`: `escapeHtml(args[0])`, `escapeHtml(args[1])`, `escapeHtml(missing)`, `escapeHtml(e.message)`
  - `/exact`: `escapeHtml(symbol)` in 2 locations
  - `/setkey`: `escapeHtml(keyName)` in error message
- Also removed HTML from `isAuthorized()` messages (switched to plain text)

---

### VULN-7: No input size limits on data-processing endpoints (MEDIUM — DoS)

**What:** `/api/journal/analyze`, `/api/patterns/detect`, `/api/ml/signals`, `/api/ml/analyze` accepted arrays with no size limit.

**Where:** `server/index.js` — journal/analyze (line 1185), patterns/detect (line 1307)

**How an attacker would exploit it:**
```bash
POST /api/patterns/detect {"candles": [/* 1 million items — exhausts server memory */]}
```

**Fix:**
- `/api/journal/analyze`: capped at 10,000 trades
- `/api/patterns/detect`: capped at 5,000 candles
- Trade symbols capped at 20 chars
- Express body limit already set to 1MB (`express.json({ limit: '1mb' })`)

---

### VULN-8: No symbol validation on market data endpoints (LOW — open proxy)

**What:** `/api/chart`, `/api/quote`, `/api/fundamentals/:symbol` accepted arbitrary strings as symbols with no validation.

**Where:** `server/index.js` — chart (line 110), quote (line 275), fundamentals (line 756)

**How an attacker would exploit it:**
```bash
curl "https://smartai1.onrender.com/api/chart?symbol=<script>alert(1)</script>"
# Or use the server as an open proxy to scrape Yahoo Finance with arbitrary parameters
```

**Fix:**
- Added `isValidSymbol()` helper: allows only `[A-Z0-9.-_]`, max 20 chars
- Applied to `/api/chart`, `/api/quote` (all symbols), `/api/fundamentals/:symbol`
- Invalid symbols return `400 invalid symbol format`

**Verified:** `curl "/api/chart?symbol=<script>"` → `400 invalid symbol format`

---

### VULN-9: Error messages leak internal details (LOW)

**What:** Error responses included raw `e.message`, HTTP status codes, and API-specific error details.

**Where:** `server/index.js` — 15+ locations; `telegram-bot/bot.mjs` — 7 API routes

**How an attacker would exploit it:** Error messages reveal internal architecture (upstream API names, HTTP status codes, file paths in stack traces), making targeted attacks easier.

**Fix:**
- All error messages replaced with generic user-facing messages
- Internal details logged server-side only via `jsonError(res, status, message, internalErr)`
- Every error includes a `correlationId` (UUID) for support tracing
- Bot API routes return generic `'AI provider is temporarily unavailable.'`
- `Dhan API error: ${r.status}` → `'Broker API error.'`
- `Shoonya login failed: ${loginData?.emsg}` → `'Broker authentication failed.'`
- `Yahoo chart ${chartR.status}` → `'Market data temporarily unavailable.'`

---

## XSS in Frontend (NeuralChat) — SAFE

The `NeuralChat.tsx` component uses `dangerouslySetInnerHTML` but **correctly escapes HTML first** (`&`, `<`, `>` are replaced before markdown formatting is applied). The markdown replacements only add `<strong>`, `<em>`, `<code>` tags with no user-controlled attributes. **No fix needed.**

---

## SQL Injection — N/A

The app does not use SQL. The "database" is Google Sheets via Google Apps Script, which uses key-value cell lookups (no query strings). **No fix needed.**

---

## File Uploads — N/A

The app has no file upload functionality. **No fix needed.**

---

## Additional Hardening Applied

Alongside the deep security fixes, the following from the previous pre-deploy audit were also applied:

1. **Removed `/debug-keys` endpoint** (bot.mjs) — leaked API key prefixes
2. **Removed `/debug_env` command** (bot.mjs) — leaked env var names
3. **Removed self-ping keepalive** (bot.mjs) — Render ToS violation
4. **Removed token-prefix logging** (bot.mjs) — `console.log(TG_TOKEN.substring(0, 10))`
5. **Removed env var scanning** (config.mjs) — scanned ALL env values for `gsk_` pattern
6. **Removed VITE_ fallbacks** for server secrets — TG_TOKEN, GROQ_KEY, etc.
7. **Fixed hardcoded `nvidia: true`** in `/api/ai-status`
8. **Fixed CORS** to use allowlist instead of reflecting arbitrary origins
9. **Strengthened Code.gs auth** — rejects `WEALTH_AI_SYNC` default, requires >=12 chars
10. **Removed `WEALTH_AI_SYNC` default token** from api.ts (4 locations), cloud.mjs, Code.gs
11. **Deleted `oldcode.gs`** duplicate file

---

## Files Modified

| File | Changes |
|------|---------|
| `server/index.js` | Added server-side PIN auth system, httpOnly session cookies, requireAuth middleware, input validation (symbol format, array size limits), HTML sanitization on /api/telegram, IDOR fix on thesis/schedule, error message sanitization with correlation IDs, startup env validation |
| `src/hooks/useAppState.ts` | Replaced client-side PIN check with server-side `/api/auth/login` call, removed hardcoded `2023` fallback |
| `telegram-bot/bot.mjs` | Added escapeHtml() helper, escaped all user-provided content in HTML messages, removed /debug-keys endpoint, removed /debug_env command, removed self-ping keepalive, removed token-prefix logging, fixed CORS to allowlist, fixed hardcoded nvidia:true, sanitized all error responses |
| `telegram-bot/config.mjs` | Complete rewrite: removed env var scanning, removed key prefix logging, removed VITE_ fallbacks |
| `telegram-bot/cloud.mjs` | Removed WEALTH_AI_SYNC default token, added isCloudSyncConfigured() guard |
| `src/utils/api.ts` | Removed all WEALTH_AI_SYNC default tokens, added centralized getCloudAuthToken() helper |
| `server/apps-script/Code.gs` | AUTH_TOKEN now empty by default, rejects tokens <12 chars, rejects WEALTH_AI_SYNC |
| `server/apps-script/oldcode.gs` | DELETED (duplicate with weak token) |
| `.env.example` | Added APP_PIN, removed hardcoded PIN 2023, removed VITE_ prefixed secrets |
| `render.yaml` | Added APP_PIN, VITE_API_TOKEN, VITE_ENCRYPTION_KEY env vars |

## Build & Test Verification

- ✅ `npm run build` — succeeds, no errors
- ✅ `npm test` — all 41 tests pass
- ✅ Server starts with auth enabled
- ✅ Unauthenticated requests return 401
- ✅ Login with correct PIN works, wrong PIN rejected
- ✅ IDOR fixed (new IDs generated on create)
- ✅ Symbol validation rejects injection attempts
- ✅ Server refuses to start without APP_PIN

## Deployment Checklist

Set these environment variables in your host dashboard:

**REQUIRED (server refuses to start without these):**
- `APP_PIN` — your app PIN (e.g. `1234`), verified server-side
- `VITE_API_TOKEN` — strong secret (>=12 chars), `openssl rand -hex 24`
- `VITE_ENCRYPTION_KEY` — strong secret (>=32 chars), `openssl rand -hex 32`

**Also set in `server/apps-script/Code.gs`:**
- `AUTH_TOKEN` — the SAME value as `VITE_API_TOKEN`

**For AI features:** `GROQ_API_KEY`, `GEMINI_API_KEY`, etc.
**For Telegram bot:** `TG_TOKEN` + `TG_CHAT_ID` (must be set together)
