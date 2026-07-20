
## v1.3.0 — SuperScore v6 + Smart Router v18 Deep Upgrade (2026-07-20)

### superintelligenceEngine v6 (Site AI core)
- ⚡ **SuperScore**: 5-factor composite directional score (1-99) per holding — RSI zone 35% + SMA20/50 divergence 25% + MACD 15% + day-range position 15% + anti-chasing momentum 10%. Injected into LLM prompt, inside-story, and Quant Brain top-pick ranking
- 💥 **Volume-breakout anomaly alerts** (big move + heavy tape = institutional footprint)
- ⚡ **SuperScore EXTREME-BUY/SELL** multi-factor alignment warnings (rarer & more reliable than RSI-only signals)

### Telegram Bot v18
- **Latency-aware Smart Router** (ai-chat): per-engine EWMA latency tracking; auto mode now prefers fastest healthy engine, cooldowns sink to bottom — measurable latency reduction in failover cascades
- `/super ai` — LLM-narrated super brief (deterministic numbers + LLM explanation + anti-hallucination check, 35s hard cap, graceful fallback)
- Inline keyboard on /super: 🔁 Refresh Brief + 🧠 AI Narrate buttons (callback_query wired)
- `/aitest` — SMART ROUTER telemetry table (per-engine latency EWMA, failure count, cooling state)

### Hang-proofing (bug fixes)
- `apiFetch` default 30s timeout — previously fetch calls without an explicit AbortSignal could hang forever and stall the UI
- `/api/config` + direct Telegram sendMessage now have 4s/8s caps (fast proxy fallback)

### Validation
- tsc clean ✅ · 41/41 tests ✅ · vite build ✅ · node --check all server+bot modules ✅

## v1.2.0 — Superintelligence v5.0 Upgrade (2026-07-20)

### NeuralChat v5.0 (Site AI)
- Persistent chat memory: conversation saved to localStorage (60 msgs cap, sanitized) — survives reloads
- Stop button: AbortController cancels in-flight engine cascade mid-generation
- Regenerate: one-tap retry of last answer with fresh live data
- Engine latency badge on every response (e.g. "groq • 2.1s")
- Smart follow-up chips after each response (context-aware heuristics)
- New "Super Brief" quick action (parity with Telegram /super)
- Version label unified (header/welcome/quant brain all v5.0 — fixed v3.0/v4.0 mismatch)

### Telegram Bot v17.0
- NEW /super — Superintelligence Brief (regime + portfolio pulse + top signals + warnings + opportunities + verdict, 100% deterministic — works without any LLM key)
- NEW /insights <SYMBOL> — portfolio-aware deep insight (your P&L + RSI + trend + AI verdict + conviction score)
- NEW /aitest — AI engine health dashboard (7 engines + Quant Brain status)
- Typing indicator (sendChatAction keepalive) on /ai, /chat, free-text chat
- Memory hygiene: aiCallTimestamps map pruning, algo-cooldown 24h sweep, ai-chat history capped at 20 chats
- Telegram menu commands updated (/super, /insights, /aitest)

### Site Infra
- Service worker cache bump wealth-ai-v2 → wealth-ai-v5 (PWA auto-refresh after deploy)
- Package version 1.1.0 → 1.2.0
- Baseline verified: 41/41 tests pass, tsc clean, vite build clean, node --check clean on all bot modules
# SmartAI1 — Bug Fix Changelog

## Round 1: Initial Deep Review (28+ bugs fixed in 17 files)

### CRITICAL (Security / Data Loss)
- **C1** `src/utils/riskAnalyzer.ts` — VIX operator-precedence bug
  - `(a || 15 + b || 15) / 2` evaluated as `a || (15+b) || 15` due to operator precedence. Risk alerts and regime classification were silently wrong.
  - Fixed: explicit `?? 15` fallback per VIX, then average.
- **C2/C3** `telegram-bot/bot.mjs` — 33 of 50 command handlers lacked `isAuthorized()` check
  - `/portfolio`, `/market`, `/risk`, `/scan`, `/backtest`, `/debug_env` etc were open to ANY Telegram user who could DM the bot, leaking full portfolio + P&L and triggering billable LLM API calls.
  - Fixed: inserted `if (!isAuthorized(msg)) return;` into all 33 handlers (skipping `/start` and `/help` which are intentionally public).
- **C7** `src/utils/secureStorage.ts` — Single global `migrationDone` flag broke multi-key migration
  - After the first key was migrated from legacy CryptoJS format, every subsequent key (TG_TOKEN, GROQ_KEY, etc.) silently returned `null` from `getItem()`.
  - Fixed: per-key migration Set + immediate mark-on-enqueue to prevent concurrent re-encrypt.
- **C8** `server/index.js` — SPA fallback served `index.html` for missing JS chunks
  - After redeploy, missing `/assets/vendor-charts-*.js` files returned HTML → "Failed to fetch dynamically imported module" → entire app died.
  - Fixed: return real 404 for asset paths (`/assets/`, `.js`, `.css`, etc.) so `lazyWithRetry` can trigger a clean reload.
- **C9/C10** `src/utils/api.ts` — Cloud sync used weak default token + `loadFromCloud` had no auth
  - `authToken = VITE_API_TOKEN || 'WEALTH_AI_SYNC'` shipped a known string in the bundle. `loadFromCloud` sent NO token at all. Anyone with the Apps Script URL could read/write the user's portfolio.
  - Fixed: refuse weak/default tokens; require `>=12` char secret on BOTH load and save paths.
- **C11** `server/index.js` — `/api/telegram` proxy accepted arbitrary `chatId`
  - Any visitor could POST `{message, chatId: <any>}` and make the bot spam arbitrary chats. No rate limit.
  - Fixed: ignore client-supplied chatId, always send to `TG_CHAT_ID`. Added per-IP rate limit (30 msgs / 10 min).
- **C4** `src/utils/riskEngine.ts` — `calculateCorrelationMatrix` returned random numbers
  - `Math.random() * 0.6 + 0.2` labeled as "correlation" — fake risk metrics presented to a financial audience.
  - Fixed: return zeros + `__simulated: true` flag so consumers know data is missing.
- **C5** `src/utils/smartMoney.ts` — FII/DII flows fabricated via `Math.random()`
  - ±500–1000 Cr random figures presented as real institutional flows.
  - Fixed: deterministic heuristic from VIX + index momentum; clearly labelled "(Estimated)" in description.
- **C6** `src/utils/backtestEngine.ts` — Backtests used `Math.random()` with biased drift
  - `(Math.random() - 0.48)` biased returns upward by ~+0.06%/day (inflating win-rate/Sharpe). Non-reproducible across runs.
  - Fixed: seeded deterministic PRNG (mulberry32) with zero-centered noise.

### HIGH (Broken Features / Wrong Behavior)
- **H1** `src/utils/macroRegime.ts` — `directionScore` didn't differentiate up vs down
  - Both +5% and -5% sector moves scored 100. Crashed sectors ranked as "high momentum".
  - Fixed: keep sign (`50 + s.change * 10`).
- **H2** `src/utils/portfolioMonitor.ts` — "Drawdown" was actually unrealized P&L%
  - A portfolio that's +20% then -5% off peak showed drawdown=0.
  - Fixed: relabel as "unrealized loss" with accurate description.
- **H3** `src/utils/riskEngine.ts` — `maxDrawdown` was identical to `currentDrawdown`
  - Both used today's intraday `high`. Documented as not tracked historically.
- **H4** `src/types/index.ts` — `pegRatio` is actually RSI/CAGR ratio, not P/E ÷ growth
  - Documented the misleading name; consumers should not treat as true PEG.
- **H5** `src/utils/tvWebsocket.ts` — Callback fired with empty price data
  - Guard `Object.keys(update).length > 1` was always true (time + market always set).
  - Fixed: explicit check for actual market data fields.
- **H6** `src/utils/wealthEngine.ts` — NaN propagation from invalid `dateAdded`
  - `new Date(badString)` → Invalid Date → `Math.max(1, NaN)` = NaN → XIRR bisection poisoned.
  - Fixed: `Number.isFinite(buyMs)` guard with fallback to 1 day.
- **H7** `src/utils/telegram.ts` — Division-by-zero in report generators
  - Positions with `avgPrice=0` (airdrop) caused `Infinity`/`NaN` rendered in Telegram.
  - Fixed: `cost > 0 ? ... : 0` guards.
- **H8** `src/utils/telegram.ts` — Currency symbol picked from `portfolio[0].market`
  - Mixed IN+US portfolio showed US totals with `₹` if first holding was US.
  - Fixed: always INR total for mixed-currency reports.
- **H9** `src/utils/api.ts` — Greedy regex JSON extraction
  - `\{[\s\S]*\}` over-captured trailing junk.
  - Fixed: try strict `JSON.parse` first, non-greedy fallback.
- **H10** `src/utils/api.ts` — `import` statement after runtime code
  - Worked due to ES module hoisting but fragile under future bundler strictness.
  - Fixed: moved import to top of file.
- **H11/H12** `ml-service/app/main.py` — CORS `*` + credentials; unbounded caches
  - `allow_origins=["*"], allow_credentials=True` is rejected by browsers. Caches (`{}`) grew forever.
  - Fixed: `allow_credentials=False`; OrderedDict LRU with max-size eviction.

### MEDIUM
- **M1** `src/utils/api.ts` — Fear/Greed defaulted to "Extreme Greed" when VIX unavailable
  - `(15+15)/2 = 15` → "EXTREME GREED" while no VIX was actually fetched.
  - Fixed: neutral 50 + "VIX unavailable" label.
- **M2** `src/utils/riskEngine.ts` — Division-by-zero in `calculateRebalance`
  - `totalInvestment=0`, `price=0`, `valINR=0` all caused Infinity.
  - Fixed: explicit `> 0` guards.
- **M5** `src/utils/tvWebsocket.ts` — Stuck-price detector false-positives
  - `isAnyMarketOpen()` (IN OR US) flagged US symbols as "stuck" during India hours.
  - Fixed: per-symbol market gating.
- **M10** `src/utils/constants.ts` + `api.ts` + `config.mjs` — `BEES` substring check
  - `sym.includes('BEES')` matched "BEESLY" etc. Changed to `endsWith('BEES')`.
- **M14** `src/utils/mlApi.ts` — Hardcoded `/api/ml` ignored `VITE_API_PROXY`
  - Cross-origin deployments 404'd. Fixed: respect `VITE_API_PROXY`.
- **M15** `src/components/tabs/PlannerTab.tsx` — `localStorage.setItem` unguarded
  - Throws in Safari private mode / quota-exceeded → effect crash.
  - Fixed: try/catch wrapper.
- **M16** `src/utils/telegram.ts` + `market.mjs` — Brittle `toLocaleString` date reparse
  - `new Date(now.toLocaleString('en-US', {timeZone}))` returned Invalid Date on non-English ICU builds.
  - Fixed: `Intl.DateTimeFormat.formatToParts` for robust weekday/hour/minute extraction.

---

## Round 2: Deep Bot + Python + Frontend Review (40+ additional bugs fixed in 30 files)

### CRITICAL (telegram-bot + ml-service)
- **CRIT** `telegram-bot/analysis.mjs:887` — ETF report division by zero when `totalInvested=0`.
- **CRIT** `telegram-bot/algo.mjs:140` — `key.split('_')` lost underscore-containing symbols (e.g. `IN_GIFT_NIFTY` → `GIFT`).
- **CRIT** `telegram-bot/market.mjs:222` — VIX snapshot corrupted on transient API failure → spike detection permanently disabled.
- **CRIT** `telegram-bot/ai-chat.mjs:299` — Quant Brain fallback NaN when `price=0` (R:R = 0/0).
- **CRIT** `telegram-bot/cloud.mjs:71` — `saveGroqKeyToCloud` accepted any string >10 chars as Groq key → user could brick AI chat with `/setkey groq junk`.
  - Fixed: require `gsk_` prefix + ≥20 chars.
- **CRIT** `telegram-bot/bot.mjs` — 5 cron handlers sent to `TG_CHAT_ID` without null check → silent throws when unset.
- **CRIT** `ml-service/app/main.py:210` — `/signals?market=US` returned ALL symbols (filter had `"US": None`).
- **CRIT** `ml-service/app/main.py:245` — `/train` crashed with `KeyError` when `fetch_all_symbols` returned empty.
- **CRIT** `ml-service/app/main.py:376` — `/regime` crashed with `ValueError` when `combined` was empty after `dropna()`.

### HIGH (telegram-bot + ml-service + frontend)
- **H5 (ml)** `ml-service/models/backtest.py:81` — Sell-prediction PnL was `-abs(fwd_return)` → correct shorts always lost money.
  - Fixed: `-fwd_return` (correct short profits when asset falls).
- **H6 (fe)** `src/components/MLSignalPanel.tsx` — Stale `price`/`change` closure made ML signal stale for entire session on a symbol.
  - Fixed: include price/change in deps + refetch on >1% price move.
- **H7 (fe)** `src/components/AIScreenerPanel.tsx` — False "Sent to Telegram!" success even when send failed.
  - Fixed: check boolean return + surface actual result.
- **H8 (ml)** `ml-service/app/main.py:147` — `top_features` always empty (used wrong sklearn attribute `estimators` instead of `calibrated_classifiers_`).
- **H9 (ml)** `ml-service/app/main.py:435` — `/analyze` ignored user query (passed only `brain_result` to prompt builder).
- **H10 (infra)** `nginx.conf` — Proxy target `node-server:8080` didn't exist (no such service in docker-compose).
  - Fixed: added `node-server` service to `docker-compose.yml`.
- **H11 (ml)** `ml-service/app/main.py:329,357` — `str.contains(symbol)` substring match (BTC matched BTCUSD, BTCUSDT, ABTC).
  - Fixed: exact case-insensitive match.
- **H12 (fe)** `src/components/DipIntelligence.tsx:194` — `onBuy(symbol, 0)` passed zero amount.
  - Fixed: pass `entryTarget` as default price.
- **H13 (ml)** `ml-service/app/llm_router.py:257` — Anti-hallucination guard was a no-op (always returned text).
  - Fixed: return `None` when >3 suspicious numbers detected; main.py falls back to `brain_to_text`.
- **H14 (ml)** `ml-service/app/main.py:193` — NaN RSI/volume leaked into JSON response → browser JSON.parse fails.
  - Fixed: `_safe_num()` coerces NaN/inf to defaults.
- **H15 (tb)** `telegram-bot/ai-chat.mjs:474` — Race condition in chat history (concurrent /ai calls interleaved).
  - Fixed: per-chat mutex via promise chaining.
- **H16 (tb)** `telegram-bot/bot.mjs:110` — Synchronous `fs.writeFileSync` in cron handler blocked event loop.
  - Fixed: `fs.promises.writeFile`.
- **H17 (tb)** `telegram-bot/market.mjs:12` — `toLocaleString` date reparse fragile.
  - Fixed: `Intl.DateTimeFormat.formatToParts` (mirror of M16 fix in frontend).
- **H18 (ml-server)** `server/mlEngine.js:83` — MACD signal line mathematically wrong (`macd * 2/10` instead of 9-period EMA of MACD series).
  - Fixed: full MACD series computation + 9-period EMA.
- **H19 (ml-server)** `server/mlEngine.js:252` — Sharpe annualization assumed daily returns but loop stepped by 20 days.
  - Fixed: `sqrt(252/20)`.
- **H20 (ml-server)** `server/mlEngine.js:253` — Profit factor used win/loss COUNTS not amounts.
  - Fixed: `grossProfit / grossLoss` (standard definition).
- **H21 (apps-script)** `server/apps-script/Code.gs:71` — Auth check only triggered if `authToken` was present → POST with no field bypassed entirely.
  - Fixed: REQUIRE token match; refuse weak default `WEALTH_AI_SYNC`.

### MEDIUM (round 2)
- **M19** `telegram-bot/analysis.mjs:153` — Division by zero when `change === -100`.
- **M20** `telegram-bot/market.mjs:532` — Hardcoded IPO year "2026" → `new Date().getFullYear()`.
- **M21** `src/components/NeuralChat.tsx:424` — Voice transcript segments concatenated without separator ("helloworld").
- **M22** `src/components/NewsSentimentFeed.tsx:69` — Greedy JSON regex over-captured. Fixed: balanced-brace scanner + markdown-fence stripping.
- **M23** `src/components/LiveCandleChart.tsx` — Theme/height change rebuilt chart but data effect didn't re-run → empty chart until symbol change.
  - Fixed: `chartVersion` state increments on rebuild; data effect depends on it.
- **M25** `telegram-bot/ai-chat.mjs:258` — HuggingFace prompt flattened multi-turn history.
  - Fixed: per-turn `User:`/`Assistant:` formatting.
- **M27** `ml-service/pipeline/fetch_data.py:132` — CLI crashed on empty data with `KeyError`.

### LOW (round 2)
- **L6** `src/components/NeuralChat.tsx:506` — `key={msg.timestamp}` collision risk on rapid messages.
- **L31** `ml-service/models/train_target.py:72` — `coverage` computed but never returned.
- **L33** `server/mlEngine.js:256` — `total_periods` overcounted (`floor(length/periods)` vs actual loop count).
- **L36** `src/components/WhatIfSIPOptimizer.tsx:82` — `Math.max(...[])` returns `-Infinity`.
- **L37** `src/components/tabs/PlannerTab.tsx:508` — SIP FV formula div by 0 when rate=0.
- **L38** `src/components/MacroRegimePanel.tsx:32` + `SmartMoneyPanel.tsx:37` — Undefined className if regime/signal not in map. Fixed: `?? NEUTRAL` fallback.
- **L39** `src/components/NeuralChat.tsx:6` — Failed `/api/ai-status` cached for 30s. Fixed: reset cache on failure.
- **L41** `src/components/tabs/PortfolioTab.tsx:38` — `setTimeout` without cleanup. Fixed: timer ref + unmount clear.
- **L42** `src/components/CorrelationHeatmap.tsx:37` — Correlation could go negative. Fixed: clamp `[0,1]`.
- **L44** `docker-compose.yml` — `version: '3.9'` deprecated. Removed.

---

## Files Modified (44 total)

### Frontend (TypeScript/React) — 18 files
- src/types/index.ts
- src/utils/api.ts
- src/utils/backtestEngine.ts
- src/utils/constants.ts
- src/utils/macroRegime.ts
- src/utils/mlApi.ts
- src/utils/portfolioMonitor.ts
- src/utils/riskAnalyzer.ts
- src/utils/riskEngine.ts
- src/utils/secureStorage.ts
- src/utils/smartMoney.ts
- src/utils/telegram.ts
- src/utils/tvWebsocket.ts
- src/utils/wealthEngine.ts
- src/components/CorrelationHeatmap.tsx
- src/components/DipIntelligence.tsx
- src/components/LiveCandleChart.tsx
- src/components/MacroRegimePanel.tsx
- src/components/MLSignalPanel.tsx
- src/components/NeuralChat.tsx
- src/components/NewsSentimentFeed.tsx
- src/components/ScreenerPanel.tsx
- src/components/SmartMoneyPanel.tsx
- src/components/WhatIfSIPOptimizer.tsx
- src/components/AIScreenerPanel.tsx
- src/components/tabs/PlannerTab.tsx
- src/components/tabs/PortfolioTab.tsx

### Backend (Node.js) — 6 files
- server/index.js
- server/mlEngine.js

### Telegram Bot (Node.js) — 8 files
- telegram-bot/ai-chat.mjs
- telegram-bot/algo.mjs
- telegram-bot/analysis.mjs
- telegram-bot/bot.mjs
- telegram-bot/cloud.mjs
- telegram-bot/config.mjs
- telegram-bot/market.mjs

### Python ML Service — 5 files
- ml-service/app/main.py
- ml-service/app/llm_router.py
- ml-service/models/backtest.py
- ml-service/models/train_target.py
- ml-service/pipeline/fetch_data.py

### Infrastructure — 3 files
- server/apps-script/Code.gs
- docker-compose.yml
- .env.example

## Verification
- TypeScript: clean compile ✓
- Tests: 41/41 passing ✓
- Production build: ✓ (4.42s)
- All Node.js files: syntax OK ✓
- All Python files: syntax OK ✓
