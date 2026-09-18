## v10.7 — COINDCX GLOBAL FUTURES APP-PARITY PRICING (USDC RT feed) + realtime positions fix (2026-09-14)

### Fix: Equity SIM prices never matched the CoinDCX app (AAPL 332.27 site vs 333.62 USDC app)
- **Root cause** (the user's live report): the Global Equity SIM desk priced every symbol from **Yahoo stock spot** (`regularMarketPrice`) — but CoinDCX's Global Futures are **USDC-margined perpetuals that trade 24/7**. Two consequences: (a) the number itself differed (perp premium/discount + delayed Yahoo print), and (b) outside US market hours the Yahoo spot is FROZEN while the perp keeps trading — positions LTP/P&L/SL/TP never moved during IST daytime
- New `fetchGlobalFuturesRt()` (`server/ai/globalFutures.js`) — prices this desk from **CoinDCX's own public derivatives RT feed** (`public.coindcx.com/market_data/v3/current_prices/futures/rt`, the same market_data family the crypto perp desk uses), scoped to the USDC margin domain:
  - the USDC-scoping param is probed in every plausible shape (scalar → array-style → combined-feed scan); a variant is accepted ONLY with ≥ 3 live `B-<EQUITY>_USDC` rows and becomes **sticky**
  - 5s cache (positions SSE stream polls at 1s), single-flight probe (board + stream + watcher share ONE round-trip), 60s negative cache, and a **6s probe-deadline race** so a hung/blocked upstream can never stall the board or the positions stream
- `fetchGlobalQuotes()` — RT first (source `coindcx-usdc`, the feed's own 24h change), **Yahoo fills ONLY the uncovered symbols** (fallback, honestly labeled), SPACEX stays the sim walk
- `buildGlobalCtxSync` / `getPositionsWithPnl` carry the true source (`coindcx-usdc` / `coindcx-gf-rt` / `yahoo` / `global-sim`); markets view exposes the CoinDCX pair (`B-AAPL_USDC`)
- **Realtime positions fixed**: `watchGlobalPositions` SL/TP/trailing and the SSE positions stream now tick on the live perp LTP (24/7 — US hours no longer a freeze window)
- Currency display parity: the GLOBALFUTURES desk labels **USDC** everywhere (ticket, plan strip, toasts, position rows) — exactly the unit the app shows; FUTURES stays USDT, INDIA stays ₹

### Fix: the "full universe scan" was discovering COMMODITIES, not stocks
- The USDT book lists XAU (gold) / XAG (silver) / NATGAS / INX / COPPER / ROBO / SLX / RAYSOL perps — they pass every crypto filter yet are NOT stocks; they crowded the discovered tail with names that have no Yahoo equity ticker
- `fetchGlobalFuturesInstruments()` (`server/mcp/coindcx.js`): explicit `COMMODITY_INDEX_BASES` exclusion + a **USDC instrument scan** (`margin_currency_short_name[]=USDC`, both param shapes, ≥ 3 rows validation) that finds the app's actual Global Futures stock list (AAPL/TSLA/NVDA/TSM/SKHX/SMSN/CRWV/HOOD…) and merges it with the USDT scan (deduped by symbol; rows carry `margin`)

### Tests
- NEW `test/globalFuturesRt.test.ts` (11): variant probing + stickiness, ≥ 3-row validation, negative-cache one-probe-per-minute, dark-row skip, RT-first quotes merge (the stale-Yahoo AAPL case), feed-down full fallback, ctx source honesty, markets-view dcxPair, single-flight, **hung-feed deadline**
- `test/globalInstruments.test.ts` +4 (USDC discovery + merge/dedup, < 3-row USDC ignored, commodity/index exclusion, USDC-only honest partial) → 7 tests
- `test/signalCardCurrency.test.tsx` updated to the USDC contract (GLOBALFUTURES renders USDC + ZERO ₹ / USDT; FUTURES renders USDT + never USDC)
- **1322/1322 tests passing (70 files), tsc clean** — zero regressions across the indiaAgent / ensemble / wick / depth / regime / kelly / positions-stream suites

## v10.4 — GLOBAL EQUITY FUTURES SIM DESK + futures-wallet GET transport + ultra-stream (2026-09-14)

### Fix: CoinDCX futures wallet `[404] not_found` — the route is GET-only
- **Root cause** (the live "futures USDT 3.01 dikhta hi nahi" bug): the derivatives wallets route is a **GET** endpoint — the old POST died with `[404] not_found` (Express routes by METHOD), so the futures margin tile showed 0 while the CoinDCX app showed balance
- New `coindcxPrivateGET()` in `server/mcp/coindcx.js` — query-param auth for the 2025 derivatives wallet routes (params in the query string, HMAC over the compact JSON of the same params, seconds timestamp; ms variant kept as fallback)
- `fetchFuturesWallets()` transport chain: **GET(s) → GET(ms) → legacy POST** — first transport that answers sticks for the process lifetime (no per-poll probing); wrapper tolerance unchanged (`[]` / `{wallets}` / `{data}` / `{balances}`)
- With the wallet live, the agent's futures-viability gate (`deployableFuturesUSDT ≥ 2`) works again — the "scan: 0 candidates (futures margin ke karan sirf spot scope)" state clears automatically when margin exists

### New: GLOBAL EQUITY FUTURES SIM desk (Apple/Google/NVIDIA/SpaceX…)
- New `server/ai/globalFutures.js` — CFD-style SIM futures on the world's biggest companies:
  - **AAPL, MSFT, GOOGL, AMZN, NVDA, TSLA, META** — REAL Yahoo Finance quotes (live) + REAL 1h candles (3mo, the same feed the crypto LTF layer uses)
  - **SPACEX** — private company, koi public price NAHI: a deterministic synthetic walk (seeded per-hour random walk, anchored near the tender-valuation per-share equivalent), clearly labeled **SIM** on every surface
- The SAME 10-model superintelligence committee votes on these — full plans (entry/SL/T1/T2/R:R), AI score, regime (NASDAQ-100 + USVIX)
- **Trading honesty**: CoinDCX par ye contracts listed NAHI hain — the desk is PAPER/NOTIFY only; a LIVE click is rejected with the honest reason (gate 0)
- Same gauntlet as every desk: kill switch → auto policy → fresh signal → leverage sanity → journal caps (daily cap / loss cap / one-per-pair / concentration)
- `watchGlobalPositions()` (60s) — SL / TP2 / trailing / partial-TP / liquidation sweep on the desk's own quotes
- Agent integration: `desks.global` (default ON) — the auto-agent scans + enters/exits the GLOBAL desk through the same time-exit / trend-flip / correlation-guard discipline
- Ask-AI (crypto desk agent): new `analyze_global_stock` tool + `market: "GLOBAL"` in the signals tool (9 tools now)
- Endpoints: `GET /api/ai/signals?market=GLOBALFUTURES`, `GET /api/ai/global/markets`, `POST /api/ai/global/execute`, `?market=GLOBALFUTURES` on deep
- Frontend: third desk tab 🌍 EQUITY SIM in the CoinDCX desk, position rows with the GLOBAL/SIM chip, ticket in the USD margin domain

### Upgrade: positions ultra stream
- Open positions now poll **every 5s** (was 10s) — live LTP + avg-buy-price + uPnL with the pulse dot (server-side quote caches keep it cheap); flat stays at 45s
- GLOBALFUTURES positions price from the desk feed (`yahoo` / `global-sim` sources, USD-domain P&L with INR twins)

### Fixes caught live (smoke-tested against the running server)
- `getPositionsWithPnl`: an open GLOBALFUTURES position hit "Assignment to constant variable" (the quote map was re-assigned over a `const`) — route 500'd; fixed + regression test pinned
- `/api/ai/global/execute` now passes `mode: 'live'` through to the gauntlet (gate 0 rejects honestly) instead of silently converting to paper

### Tests
- 28 new tests (wallet GET transport chain + wire contract, global desk gauntlet/watcher/close, board integration on the real model loop, agent desks.global config, positions pricing regression) → **1146/1146 passing**

## v6.8 — GLOBAL FUTURES + SUPERINTELLIGENCE AUTO-AGENT (2026-09-07)

### New: CoinDCX GLOBAL FUTURES desk (USDT-margined perpetuals)
- New `server/ai/futures.js` — the complete futures stack: RT prices (`market_data/v3/current_prices/futures/rt`), pcode=f candlesticks, instrument rules, DF wallets, positions, order create / **position-id** exit / **native exchange TP/SL** (`create_tpsl`), spot→futures margin auto-transfer
- **executeFuturesSignal()** — the SAME gauntlet ladder as spot, venue-switched: kill switch → auto policy → LIVE arming → fresh STRONG signal (venue FUTURES) → leverage sanity (liquidation OUTSIDE the SL) → wallet-margin sizing → journal caps (daily 3 / loss / one-per-pair / concentration)
- **watchFuturesPositions()** (60s loop) — SL/TP/trailing on RT prices, liquidation backstop, LIVE reconcile against the exchange's own position list (native TP/SL closes detected), USDT↔INR honest twins
- FUTURES signal board (10-model consensus, TV USD indicators ≈ USDT 1:1, plans in the exact quote currency), third desk tab, futures trade ticket (margin USDT, leverage, liquidation honesty)
- Currency honesty: futures P&L carries both USDT and INR (live USDINR, 10-min cache); the shared journal + daily caps stay INR

### New: SUPERINTELLIGENCE AUTO-AGENT (server-side, 60s loop)
- New `server/ai/agent.js` + `AgentPanel.tsx` — the autonomous prop-desk agent:
  - **Wallet-fetch**: live CoinDCX spot + futures margin balances (`/api/ai/wallet`); every trade sized from EQUITY (risk %/trade, SL-based; ≤60% of deployable margin)
  - **Auto Entry**: only ≥80% confidence + 75% agreement STRONG signals (stricter than the manual 75/70)
  - **Auto Exit**: watcher SL/TP/trailing + native exchange TP/SL + agent TIME-EXIT (default 90m)
  - **Exactly 3 trades/day** (user spec; agent-scoped, manual trades don't count) + daily loss-cap stand-down (−3% equity) + cooldown between entries
  - LIVE needs the full chain: typed LIVE in Risk settings + Auto-execution ON + typed LIVE at agent start + CoinDCX connected — no private path to money
  - Agent log (every scan decision), Telegram pings on entry/exit, India intraday picks + futures picks strip
- Endpoints: `GET /api/ai/agent`, `POST /api/ai/agent/start|stop|config`, `GET /api/ai/wallet`, `GET /api/ai/futures/markets`, `POST /api/ai/futures/execute`, `?market=FUTURES` on signals/deep

### Site
- OrderConsole: live wallet strip + futures position rows (USDT pricing, agent badge, exchange-reported liquidation)
- engine string → `SUPERINTELLIGENCE ENSEMBLE v6.8`

### Tests
- 43 new tests (futures gauntlet math/parsing/wallets/watcher + agent quota/sizing/loss-cap/time-exit) → **572/572 passing**



## v1.4.0 — SuperScore Backtester + AI Follow-ups (2026-07-20)

### New: SuperScore Backtester (site)
- New util `src/utils/superScoreBacktest.ts` — replays daily candles with the SHARED production SuperScore math (extracted into `computeSuperScoreFromIndicators`, single source of truth, zero formula duplication)
- Trade simulation: enter ≥65 BUY-LEAN, exit ≤40 or 20-day cap, next-open fills
- **Score-band accuracy validation**: ≥78 / 65–77 / 35–64 / <35 buckets with 10-day forward-return hit rates — verifies the production EXTREME thresholds against history
- NeuralChat local command: `/superscore RELIANCE` — deterministic, zero LLM cost, instant chat report with 📉 badge

### New: AI-Generated Follow-ups (NeuralChat)
- Follow-up chips first extract real '?' questions from the AI's own answer (most relevant next steps), falling back to deterministic heuristics

### Tests
- 13 new tests (SuperScore math bounds/direction/determinism + backtester arithmetic/bands/determinism) → **54/54 passing**

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
