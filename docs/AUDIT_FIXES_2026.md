# Deep Audit & Fix Report — 2026

**Scope:** Full codebase (React 19 + Vite 7 frontend, Express backend, Telegram bot, Python ML service, Docker/nginx/Render infra)
**Result:** 31 files changed · 880 insertions · 452 deletions · typecheck clean · 54/54 tests pass · production build OK

---

## 🔴 CRITICAL security fixes

| # | Issue | Fix |
|---|-------|-----|
| 1 | **CORS reflected ANY origin + credentials** when `ALLOWED_ORIGINS` unset — session cookie is `SameSite=None`, so any evil site could read the whole portfolio / overwrite cloud state / burn AI keys | `server/index.js` — CORS now **fails closed** in production (`NODE_ENV=production` + no allowlist ⇒ no ACAO header, loud warning logged) |
| 2 | **Hardcoded cloud-sync token** (`f53613…`) shipped in every browser bundle **and** committed in the public repo inside `Code.gs` | Removed from `api.ts` fallback and `Code.gs`; cloud sync now requires an explicit token (localStorage / `VITE_API_TOKEN` / server `API_TOKEN`) |
| 3 | **`WEALTH_AI_SYNC` universal public backdoor** in Apps Script auth + frontend fallback + bot `cloud.mjs` — anyone with the /exec URL could read the portfolio, read synced API keys, overwrite state | All bypasses removed (Apps Script, `api.ts`, `cloud.mjs`); mandatory ≥12-char strong token |
| 4 | **flushCache destroyed API keys / Telegram creds** — sync `getItem()` returns `null` for encrypted values, so the preserve-list captured nothing before `localStorage.clear()` | `flushCache` now async, reads sensitive keys via `getItemAsync`, restores after clear |
| 5 | **secureStorage DELETED undecryptable values** (combined with the never-loaded CryptoJS legacy path = silent key loss on upgrade) | Failed decryptions are preserved as `<key>_undecryptable` backups instead of deleted |
| 6 | **Docker images baked secrets** — `COPY . .` with no `.dockerignore`, compose ran the full-source `build` stage | `.dockerignore` added; dedicated non-root `server` runtime stage with `HEALTHCHECK`; ML Dockerfile non-root + healthcheck |
| 7 | **Unauthenticated LLM key relay** on the bot's Express server (standalone mode) | Per-IP rate limit (30/min) + optional `BOT_API_SECRET` bearer auth on all relay routes |
| 8 | **ML service had zero auth** (anyone could trigger hours-long `/train` DoS) | `ML_API_TOKEN` middleware on all routes (X-API-Key or Bearer), constant-time compare |
| 9 | **requireAuth extension bypass applied to all HTTP methods** — latent POST/PUT/DELETE auth bypass on `.json`-suffixed paths | Bypass restricted to GET/HEAD on non-`/api` paths |
| 10 | **Client-supplied `model` interpolated raw into Gemini URL** in `/api/chat/mcp` (URL injection) | Same `[^a-zA-Z0-9.\-]` sanitization as `/api/gemini` |

## 🟠 HIGH correctness fixes (wrong financial advice)

| # | Issue | Fix |
|---|-------|-----|
| 11 | **Tax holding period computed from the SELL date** — 2019-bought stock sold last month taxed as STCG @20% instead of LTCG @12.5% | FIFO lot ledger rebuilds each sell's acquisition date; `days = sellDate − acqDate` |
| 12 | **Tax-loss harvesting violated Sec 70/74 set-off rules** (LTCL offsetting STCG; saving computed at the loss's rate, not the gain's) | Correct pools (LTCL→LTCG only; STCL→STCG first then LTCG) and rates of the gain being offset |
| 13 | **Goal planner ignored existing corpus** — `monthlyNeeded` computed from scratch; `projectedWealth` was either SIP-FV or corpus, never both | `projectedWealth = corpus×(1+r)ⁿ + SIP-FV`; `monthlyNeeded = (target − corpus-FV)/annuityDueFactor` |
| 14 | **Daily P&L overstated by factor (1+change/100)** (+5% day → 5% too large; −20% crypto day → ~25% overstated loss) | `PL = qty × (price − prevClose)` with prevClose derived from change% |
| 15 | **"Backtests" ran on fabricated data** — TradingView scanner returns ONE snapshot, never OHLC; win-rate/Sharpe presented as real history | Real OHLC now fetched from our own `/api/chart` (Yahoo) first; `isSimulated` flag + unconditional Telegram disclaimer when synthetic; open position closed at last bar |
| 16 | **Fictional SPCX/"SpaceX" ETF** (delisted 2013, fabricated CAGR 35%/AUM $350B) drove screener STRONG_BUY + 15% rebalancing target | Replaced with real QQQ (Invesco Nasdaq-100) |
| 17 | **Screener printed US prices with ₹ symbol** (~83× understatement for Indian users) | Market-aware currency in Telegram formatter |
| 18 | **Combined buy-price score broken scale** (sentiment −100..+100 fed raw + constant +50 ⇒ range ~20–150; mediocre setups scored 85) | Sentiment mapped to 0–100, offset removed, clamped |
| 19 | **Daily P&L snapshot never fired during market hours** (3s debounce reset by every tick) | 60s throttle reading prices from refs |
| 20 | **All 5 engines (incl. Groq AI + backtest) re-fired on every price tick** in ExactBuyPricePanel | Volatile inputs via refs; re-run only on symbol/market change or >2% price move; stale-run guard |

## 🟡 MEDIUM reliability/perf fixes

- **Crypto poller**: in-flight guard (2s interval < 5s timeout previously piled up requests) + Binance fallback circuit breaker (was 12 parallel req/2s into an India-geo-blocked endpoint)
- **Forex failure** no longer overwrites the last good rate with hardcoded 83.5
- **usStream reconnect**: WS drop previously left SSE clients with frozen US prices until a NEW client connected — reconnect is now actually scheduled
- **MCP tool-loop**: follow-up request re-sent the ORIGINAL payload (tool results never reached Gemini) — fixed with updated contents
- **botAlive** health: `exitCode === null` (was `!killed` — dead bot reported alive after a crash)
- **Bot restart**: exponential backoff to 5 min (was infinite 5s fork/exit loop)
- **usePrefetch**: fixed 2 broken contracts (GET vs POST `/api/ml/signals`; fundamentals path-param) — prefetches silently 404'd before
- **render.yaml**: added missing `API_TOKEN` (cloud sync returned 503 out-of-the-box)
- **Service worker**: sensitive responses (cloud/auth/telegram) never cached; SSE `/api/stream` passed through (tee-buffering breaker); offline returns 503 instead of fake 200; cache keys normalized (no `?session=` tokens); no token in CacheStorage; message handler wrapped in `waitUntil`
- **Widget token**: URL fragment `#token=` + immediate purge (was `?token=` query → history/referrer/access-log leakage)
- **secureStorage**: PBKDF2 (600k iterations) key cache — was re-deriving on every read/write (~100–300ms CPU each)
- **nginx.conf**: CSP, X-Frame-Options DENY, nosniff, Referrer-Policy, Permissions-Policy
- **Dead code removed**: `analyzeIntradaySymbol`/`fetchIntradayCandles`/helpers (never called; contained a guaranteed `ReferenceError: reasons is not defined` if revived)
- `.claude/settings.local.json` untracked; `.gitignore` expanded (`.env.*`, IDE dirs); `.env.example` documents all new vars (`API_TOKEN`, `BOT_API_SECRET`, `ML_API_TOKEN`)

---

## ⚠️ MANUAL ACTIONS REQUIRED (cannot be fixed by code)

The git **history** contains live secrets (commit `6076ed8` and 10+ later commits re-leak them):

1. **Revoke the Telegram bot token NOW** via @BotFather (`/revoke`) — the leaked token `8561229979:AAH24…` gives full bot control to anyone who reads the public repo.
2. **Re-deploy the Apps Script** (new URL) and set a fresh `AUTH_TOKEN` in `Code.gs` (generate with `openssl rand -hex 24`). The old URL + old token are burned.
3. **Change `APP_PIN`** — the leaked PIN was `2023`.
4. **Rotate all AI provider keys** (Groq/Gemini/Claude/OpenRouter/Cerebras/HF/NVIDIA/Tavily) and Finnhub.
5. **Purge git history** (`git filter-repo` or BFG Repo-Cleaner) and force-push — deleting the file in one commit does not remove it from history. Then invalidate GitHub caches/forks.
6. Deploy the updated `Code.gs` + set `API_TOKEN` / `ALLOWED_ORIGINS` / `BOT_API_SECRET` / `ML_API_TOKEN` in the Render/GitHub environment.

## ✅ Verification

- `tsc --noEmit` — clean
- `vitest run` — 54/54 tests pass
- `vite build` — successful; leaked token string confirmed **absent** from the new bundle
- `node --check` on every modified JS file — OK
- `py_compile` on `ml-service/app/main.py` — OK
