# 🚀 Advance Pro Intelligence v18.0

**Multi-Engine AI Portfolio Dashboard + Telegram Trading Bot**

AI-powered portfolio analytics for Indian and US markets, crypto tracking, risk analytics, ML signals, 7-engine AI chat with smart failover, cloud sync, broker connectors, and a full Telegram automation suite (53 commands).

---

## ⚡ v9.4 — F&O Option Signal Cards + realtime paper prices (Nifty50/Sensex)

- 🎯 **F&O OPTION SIGNAL CARDS — the exact trader format**: the Options Desk (both tabs that carry it) now opens with a cards strip for **NIFTY + SENSEX** that reads exactly like a broker ticket:
  ```
  STOCK NAME
  Nifty50 17Sep 23400 CE        ← display name + expiry + strike + CE/PE
  Target      : ₹145.10          ← premium at the index plan's target1
  Entry (Buy) : ₹129.00          ← live/model premium of the ATM contract
  Stop Loss   : ₹112.00          ← premium at the index plan's stopLoss
  ```
  LONG consensus → **BUY the ATM CE** · SHORT → **BUY the ATM PE**. Target/SL are not guessed — the ensemble's index plan levels are **re-priced through Black-Scholes into premium terms** (IV + days-to-expiry held constant), so the card says what the option is worth *if the index does what the desk expects*. Pro context rides along: strike, delta/IV, lot cost, per-lot risk:reward, R multiple, and the index levels the premiums came from. `GET /api/ai/option-signals` serves both desks in one request (30s server cache, 60s client refresh).
- 🗓️ **Weekly-expiry schedule fixed for the Sept-2026 exchange swap** — live-verified against ICICI's revised table + Groww's September 2026 F&O calendar: **NIFTY weekly = Thursday, SENSEX weekly = Tuesday** (the code had the old pre-swap days). When the real NSE chain loads, its own expiryDates stay ground truth; the map only drives the honest BS-model fallback — which is what SENSEX always rides (the BSE chain is datacenter-blocked, so its premiums are Black-Scholes estimates anchored to live ^BSESN spot + India VIX, **labelled** `BS MODEL PREMIUM`). **SENSEX joined the index selector** (100-point strikes, lot 20).
- 🛡️ **Pro discipline stays loud**: a card built on a NEUTRAL/WATCH-grade consensus renders with an amber *"Entry MAT karo — WATCHLIST card hai"* strip (the desk trades STRONG/ACTION only); BUY-premium semantics are hard-guarded — **SL < entry < target, every side, every basis** — with max premium loss capped at 65% and every level on the ₹0.05 NSE tick.
- 🩺 **Paper-trade realtime prices — root cause found and fixed**: the SSE watcher's symbol set was assembled **scan-first / paper-last** and then sliced to a 24-symbol cap, while tracked signal rows accumulate all session (up to 40/day). A few hours into the desk day, **open paper positions were the first symbols silently dropped** — the position card froze at entry while quotes ticked for everyone else. Now **paper symbols enter the watch set FIRST** (they can never be the dropped ones) and the cap rose 24 → 34 (the Groww micro-cache absorbs it).
- ✅ **Live-verified end-to-end during NSE hours (PIN 1992)**: F&O cards served `Nifty50 17Sep 23400 PE` + `Sensex 15Sep 74900 PE` with correct expiries and ATM strikes; a DESK PAPER click opened `LT SHORT @ ₹3925` and the panel ticked to `₹3926.0●` with live P&L `−₹1.00` (SHORT math correct); a separate desk run auto-booked a paper SHORT at T1 (`RELIANCE SHORT 1274 → 1266, +₹16`); SSE quote frames carried the paper symbol + all 5 scan symbols every 5s; CoinDCX regression clean (no dead panels, HBAR SHORT live-priced via TV fallback). Full matrix: **tsc 0 · 953/953 tests (51 files, +14 new guards: card format/direction lock/level-ordering invariants/expiry-schedule swap/watch-set priority) · build 5.2s · check:routes PASS · audit 0**.

---


> **Financial disclaimer:** Signals, projections, and AI/ML output are informational only. They are not investment advice. Verify market data before trading.

## What's New in v9.3 (Intraday Tape Alignment — the "strong signals wrong trend de rahe hai" fix)

- 🎯 **Root cause: the India desk's committee was reading YESTERDAY, not the tape** — live-verified against the scanner itself: the TradingView India scanner serves **DAILY-timeframe indicators** (scanner EMA10 = 1288.40 vs Yahoo **daily** EMA10 = 1288.6 — exact match). A stock can sit in a multi-day downtrend (daily RSI 37, price below every daily EMA) while its **15-minute tape rips up** — and the old board voted "STRONG SHORT 75%" off the daily stack while the user watched their fresh short bleed on a climbing tape (the exact 4-position screenshot: RELIANCE / CIPLA / ITC / ASIANPAINT, all SHORT, all red). The 15m data the engine DID fetch only fed one SMC vote (w 1.1) and a −12 conf whisper with **no grade cap** on the MISALIGNED phase.
- 📺 **IntradayTape — the 11th model, the trading timeframe's committee seat (w 1.3)** — reads the 15m EMA10/20 stack + price position, 15m MACD histogram + slope, 15m RSI momentum zone (with exhaustion guards), the scanner's TRUE session VWAP, and the last-3-bar momentum. A rising tape now pulls the consensus toward LONG with real weight *inside* the vote — it can flip weak counter-tape signals, not just grumble afterwards. Crypto/futures desks: the model abstains with an honest reason (their `ctx.ind` already merges live 1h candle indicators at build time — a second tape vote would double-count the same timeframe). Verified live on the board: RELIANCE / CIPLA / SBIN / MARUTI carry `tape dir −1 conf 67–78` votes with readable reasons ("15m EMA10<20 stack · RSI 35.7 weakness zone · below session VWAP").
- 🛑 **Counter-tape gating (pro intraday discipline)** — a trade against the live tape can **never wear STRONG** again: a **DRIVING** tape (15m RSI in the momentum zone + MACD against the trade) vetoes to **WATCH** with a loud `🛑 COUNTER-TAPE` reason and a `counter-tape` veto flag; a merely **stalling** tape caps at **ACTION** (reversal practice stays possible). The moment the tape rolls over, the signal re-earns its grade — the desk stays alive, it just stops handing out STRONG badges against the tape the user is watching.
- 🔎 **Ranking fixed too** — the 15m enrichment widened from the top-10 to **2× the board (cap 24)** and the final cut now re-sorts AFTER the tape vote weighs in, so a tape-aligned setup can climb into the board and a counter-tape STRONG falls out of the top cut on its own post-tape score.
- 🐛 **Latent v6.12 bug found & fixed: the MTF MACD leg was DEAD in production** — `mtfAnalysis` read `ltf.macdHist`, but the board passes candle-derived indicators as `macd: {hist}` — the flat-field read silently missed it, so only the EMA20/50 line ever fired (unit tests passed because they hand the flat shape). Both shapes are now normalized once at the top of the function — the MACD confirmation (and the counter-tape strength read) works on real board data.
- 🖥️ **The card tells you WHY** — MISALIGNED signals render an explicit **COUNTER-TAPE chip** (red + loud for a driving tape, amber for a stalling one) instead of a generic "MTF ⚠ MISALIGNED" amber strip; the signal's `quality.reasons` carry the full Hinglish explanation.
- ✅ Verified end-to-end — **939/939 tests (49 files, +16 tape-alignment guards: model votes on rising/falling/coil tapes, crypto abstention, counter-tape strength classification, WATCH/ACTION/STRONG gating, ensemble conviction drag, and THE board regression — bearish daily + rising 15m can NEVER badge STRONG SHORT while the same daily data with a confirming 15m tape still earns STRONG/ACTION SHORT)**, tsc clean, live smoke on both desks (India board carries live tape votes; CoinDCX board healthy — 1h candles drive its committee, tape abstains, no double-count), deep endpoint serves the same tape read as the board.
- 🧭 **CoinDCX audit (the "wahan bhi same to nahi?" check)** — structurally clean: `buildCryptoCtxSync` merges the live 1h CoinDCX candle indicators INTO `ctx.ind` at build time (`{...ind, ...ci}` — candle values win), so that committee votes on the timeframe it trades, unlike the India desk that had to be fixed. Live crypto board: 8 signals, all 1h-driven, no daily-vs-tape inversion present.

## What's New in v9.2.1 (CoinDCX Tab Resilience — the "Agent status unavailable / Expert engine unavailable" fix)

- 🩺 **Root cause: stacked cold computes, not a broken API** — the Agent panel polls `/api/ai/agent` every 15s and the old handler ran **THREE full board scans inline** (INDIA + FUTURES + CRYPTO) whenever the caches were cold; Expert Picks ran a whole-universe scan per request and the 65+ red-day fallback re-scanned from zero. On a slow host (free-tier containers, WAF-blocked feeds, cold network) every poll started ANOTHER scan, latency multiplied until every request blew the client's 45s timeout — and the panels read "Agent status unavailable — API/proxy issue" / "Expert engine unavailable — data feed unreachable" forever. Live repro before the fix: agent status cold = **10.4s** on a warm sandbox.
- ⚡ **Single-flight boards** (`signals.js`) — concurrent `getSignals` callers now JOIN the one running compute instead of stacking N of them; measured effect: agent status cold **43ms** (was 10,443ms — 243×), warm 8–11ms.
- 🤖 **`agentStatus` latency contract** — the status call NEVER computes a board inline (`warmOnly` reads the cached/stale board and warms in the background) and NEVER blocks on the wallet (serve last view, refresh behind; first-ever fetch bounded to 3.5s). A cold panel answers in milliseconds and fills picks on the next 15s poll.
- 🧠 **Expert Picks stale-while-revalidate + single-flight + budget** (`expertPicks.js`) — the scan is now **market-keyed** (minScore/limit are pure view filters, so the 65+ fallback reuses the same scan), a ≤10-min-old scan is served instantly with an honest `stale` flag while a refresh runs in the background, a cold scan that can't finish in ~25s returns the picks scored so far flagged `partial`, and if the feed outright dies the last good scan keeps the panel alive for 45 min (flagged with its age).
- 🔥 **Boot warm-up** (`routes.js`) — free-tier hosts sleep the process; ~2s after boot the server pre-heats the three boards and both expert scans (boards first, picks after; disable with `WARM_ON_BOOT=0`), so the first poll after a cold wake lands on warm caches instead of a 40s wall.
- 🖥️ **Frontend degrades honestly, never dies** — a failed Expert Picks fetch keeps the last good picks on screen with an amber "purana scan dikh raha hai, auto-retry" strip (the hard red error now appears only when nothing was ever loaded, and it has a Retry-now button); stale/partial server flags render as honest chips; the Agent panel flags a failed poll as "live update fail — purana status" instead of pretending the desk is dead.
- ✅ Verified end-to-end — **923/923 tests (48 files, +13 resilience guards: single-flight joins, warmOnly instant-serve/stale-serve, market-keyed scan views, budget-partial answers, feed-dead fallback windows)**, tsc clean, check:routes PASS, build 5.1s, live API timing (agent cold 43ms/warm 11ms; expert cold bounded/warm 13ms), browser E2E on the CoinDCX tab (COLD+WARM: no "Agent status unavailable", no "Expert engine unavailable", agent console + expert panel render real states, 0 console errors).
- 🚀 **Deploy note** — if your frontend and backend live on different origins, set `ALLOWED_ORIGINS` on the backend (comma-separated) or every cross-origin API call fails closed at CORS; and on Render free tier, keep `WARM_ON_BOOT` on (default) so wake-up latency lands on the server, not the user's panels.

## What's New in v9.2 (Direction Accuracy & Precision Audit — the "SHORT lagaya LONG gaya" fix)

- 🎯 **Deep Pro Trader direction audit (both tabs, end-to-end)** — a full code trace of every direction decision (10 models → ensemble aggregation → plan geometry → order-side mapping → paper desks → UI badges) found the direction LOGIC correct everywhere; a live 30-signal audit across CRYPTO/FUTURES/INDIA confirmed **0 vote-side mismatches, 0 reason-word mismatches, 0 plan-geometry violations**. Paper fills open on the exact side clicked (SHORT card → SHORT position, manual SHORT/LONG desk trades → same side). What actually broke the trades was precision, not direction:
- 🔢 **Adaptive price precision everywhere (the real "wrong direction" bug)** — every plan level was rounded to a FIXED 2 decimals. On sub-₹1/USDT instruments — DOGE 0.0848, OP 0.0961, VIRTUAL, WLD, SEI (Indian retail's most-traded perps) — that collapsed the plan onto itself: DOGE served `entry 0.08 · SL 0.09 · T1 0.08 · T2 0.08` (targets AT the entry, 12% visual stop on a 1.4% real one) and OP served **SL = entry** — an instant stop-out the moment the paper watcher ran. New shared `server/ai/lib/priceRound.js` (2dp ≥ 1 · 4dp ≥ 0.01 · 6dp ≥ 0.0001 · 8dp below) now rounds every plan level, liquidation estimate, trail stop, peak price and paper-desk tick — DOGE now serves `0.0841 · SL 0.0853 · T1 0.0829 · T2 0.0817`, all distinct, geometry-correct. The AI-card ticket strips, plan strip and Paper Desk rows got the same adaptive formatter in the UI (no more "₹0.0" rows).
- 🛑 **Absurd-ATR stop cap (30%)** — a meme-coin ATR wider than its own price (JUP: 283% of price) produced a SHORT blueprint with a **NEGATIVE target** (`t1 = −0.0000161`) and LONG stops below zero. Both plan engines (ensemble `buildTradePlan` + expert `buildExpertBlueprint`) now cap the stop distance at 30% of price — every level including the 3R runner stays positive — and entry zones are floored at 50% of price. Extreme-ATR coins also take a −35 R:R factor penalty in the expert score.
- 🧠 **TrendMatrix price-confirmation guard** — the HTF EMA stack lags an intraday reversal for hours; the model used to vote full-size "EMA 10>20>50 bullish" on a coin already dumping (the XRP case: bullish stack vote at c100 while everything else screamed SHORT). When price closes under EMA10 the stack term is halved and the reason honestly says "EMA stack bullish but price < EMA10 — flip watch".
- 🧪 **Expert Picks red-day fallback** — on heavily one-sided days the 80+ STRONG filter can honestly return zero picks, leaving the pro panel empty while broken-looking main-board cards got the clicks. The panel now retries once at 65+ (ACTION grade) with an amber "no 80+ STRONG setups today — showing ACTION-grade" banner (every card still carries its honest grade chip).
- ✅ Verified end-to-end — **910/910 tests (46 files, +19 direction-integrity guard: precision boundaries, sub-1 plan distinctness, vote-sum↔side invariant, flip-watch behaviour, JUP-class positive-target blueprint)**, tsc clean, check:routes PASS, build 5.1s, live re-audit (30 signals: 0 mismatches; DOGE/OP/VIRTUAL/WLD levels distinct + geometry OK; JUP all-positive; SHORT-card paper → SHORT position), browser E2E on both tabs (cards render, 4-decimal prices visible, 0 collapsed ₹0.00, 0 console errors).

## What's New in v9.1 (Paper Desk Merged — the orphaned intraday tree lives again)

- 📋 **The whole Paper Desk is finally REACHABLE** — the v4 "Super Intelligence" intraday tree (PaperTradePanel · TrackRecordPanel · JournalPanel · CommitteePanel · UniverseEditor + the entire `/api/intraday-*` backend) was fully built and tested but **never imported by the shipped UI** — the live tab switched to `IndiaIntradayTab.tsx` in v6.9 and the old file silently died, which is why Paper Trading "never started". All 5 panels are now wired into the live India desk as the **08 · PAPER DESK & AI JOURNAL** section (PRO view), with a PAPER nav chip and the ⚙ UNIVERSE scanner-watchlist modal.
- 📈 **DESK PAPER button on every India signal card** — the Superintelligence board's signals now open server-managed virtual positions (`POST /api/intraday-paper`) via a new `adaptAISignal` bridge: T1 par 50% book → breakeven trail → SL/T2 watcher → 15:10 EOD square-off, live SSE P&L, durable day-grouped history with win-rate stats. The button flips to **✓ PAPER OPEN** when the symbol already has a position (the never-lit badge from the orphaned tab is fixed by design — the open-symbol set now lifts up from the panel to the cards).
- 🔐 **SSE stream auth fixed** — `useIntradayStream` opened `/api/intraday-stream` with NO session token; that route is auth-gated, so a cross-origin deployment (Vercel → Render, where EventSource can't send cookies) 401'd and the Paper Desk live P&L never ticked. It now appends `?session=` (the same pattern as `/api/stream`) and resolves the backend via the same `getProxyBase()` chain as every REST call.
- 🗓️ **Committee/briefing/agent can trigger scans with INTRADAY_DEBUG=1** — their `triggerScan` gate ignored the owner debug flag, so out-of-hours debates always died with "Live setups nahi mil rahe". Production behaviour unchanged (market-hours gate intact).
- ⚡ **Graceful-shutdown flush** — the paper-trade/track-record/journal writers are debounced (1–1.5s); a deploy/restart landing inside the window could lose the last state change. SIGTERM/SIGINT now synchronously flush all three (verified: trade opened → SIGTERM 200ms later → on disk).
- 🔍 **`npm run check:routes`** — new endpoint↔route regression guard (the exact manual check that found the orphaned tree): walks every `apiFetch`/EventSource call in `src/` and cross-checks it against registered backend routes (+ verb sanity). First run immediately caught a SECOND orphan: `ResearchLabTab.tsx` (unimported, backend never built — allowlisted as known debt).
- ✅ Verified end-to-end — 891/891 tests (45 files, +9 adaptAISignal bridge tests), tsc clean, routes PASS, build OK, live lifecycle verified (open → duplicate-block → SSE quotes → manual close → history), browser E2E on both tabs (India DESK PAPER → MARUTI opened + badge; CoinDCX paper regression XRP SHORT opened; 0 JS errors).

## What's New in v9.0.2 (Paper Trading Always Starts)

- 🧪 **PAPER/NOTIFY clicks never dead-end** — the execution gauntlet re-runs a FRESH ensemble at click time, and any disagreement with the card you clicked used to hard-reject the trade ("signal side is SHORT, requested LONG", "grade WATCH", "confidence < 55% paper floor"). Since the board is a 30s-polled snapshot, a fast market flipped sides between render and click constantly — Paper Trading literally would not start. Now ALL three desks (₿ CoinDCX spot · ⚡ global futures · 🇮🇳 India Dhan) open the practice trade anyway with an honest disclosure note (toast + journal): "practice plan @ live price (fresh consensus FLIPPED: SHORT 5%)" or "practice floor relaxed (fresh WATCH · 38% — journaled)".
- 🎯 **Side-flip synthesis** — requested side + live price + ATR-fallback plan (risk-capped, leverage sanity intact) replaces the mismatched consensus for PAPER/NOTIFY. LIVE keeps the full strict gauntlet 100% untouched (typed arming, STRONG grade, 90s freshness, connection + caps).
- 🔓 **India PAPER button unhidden** — the Intraday TAB's India cards hid the entire 🧪 PAPER TRADE button below ACTION grade (while the helper text said "PAPER hamesha open"). The button now shows on every India card; B-grade scanner cards get an amber "PAPER (B)" practice button too (LIVE-grade watch-only rule stays in the badge/titles).
- ⚡ **Futures quick PAPER button added** — futures cards had NO one-click paper button (only the sized ticket). Now every FUTURES card has the same one-click 🧪 PAPER TRADE as spot.
- 🛡️ **Nothing safety-critical changed** — kill switch, daily trade/loss caps, one-per-pair, concentration guard, ₹100 minimum, leverage clamp + liquidation sanity, LIVE arming all still enforced; the fresh signal's honest grade/conf/side is journaled on every practice fill.
- ✅ Verified end-to-end — 882/882 tests (+8 new: side-flip synth, FLAT synth revival, floor-relaxed disclosure, practice-flag gate boundaries, LIVE-still-strict), tsc clean, build OK, live API repro (4/4 paper paths open), browser E2E (CoinDCX tab crypto card → position opened · India Intraday tab card → position opened, 0 JS errors).

## What's New in v9.0 (Superintelligence Pro Trader Engine — Signal Board Upgrade)

- 🧠 **AI SCORE on EVERY Signal Board signal (both tabs)** — the Intraday TAB (🇮🇳 India desk) and the CoinDCX TAB (₿ spot + ⚡ futures desks) now score every signal 0-100 via a three-source blend: engine conviction × 7-factor expert score × AI verdict, with honest quality adjustments (extension veto cap, MTF ±4, session gate −6, quorum −4, counter-regime −6, agreement +3). Tier ladder: **85+ ELITE · 80+ STRONG · 65+ ACTION · 50+ WATCH**.
- 📋 **Full trade blueprint on every signal card** — entry TIMING window (IMMEDIATE vs PULLBACK + limit zone), liquidation-aware LEVERAGE ladder (spot 1× / futures tier-capped ≤6× with liquidation estimate), staged 40/40/20 EXIT PLAN with breakeven+trail, and the EXIT CLOCK (India: hard 15:10 IST square-off; crypto: horizon-based wall-clock 8h/72h). "Kab entry · kitna leverage · kab exit" — every card par.
- 🌐 **Whole-market scan on the Signal Board itself** — the board's static 12-coin list is gone: CRYPTO spot scans every liquid CoinDCX INR pair, FUTURES scans every liquid B-USDT perp (live discovery, 40 coins), India keeps the full 44-stock NSE universe. Universal pass-2 revival: EVERY coin gets the SMC + pattern/sr/volume/volatility LTF second vote (top-10-only bias removed).
- 🔌 **WAF-proof data chain** — CoinDCX blocked? Binance × live USDINR anchors + Yahoo 1h candles (domain-rescaled onto the trading currency) keep the boards ALIVE; the intraday crypto scanner gets the same fallback anchors. Delistings/listings flow automatically.
- 🔥 **80+ filter chip** — one click isolates the STRONG/ELITE signals on the board; the engine meta strip shows universe size, price chain and the 80+/85+ counts.
- ✅ All checks pass — TypeScript clean, 874/874 tests (44 files, +23 new superIntel tests), build OK, live API + browser E2E verified on both tabs.

## What's New in v8.0.1 (Advance Pro Trader Engine)

- 🧠 **EXPERT PICKS (80+ AI SCORE)** — whole-universe CoinDCX scan on both desks: every liquid SPOT INR pair + every GLOBAL FUTURES USDT perp. 7-factor composite score (trend 25% · momentum 20% · SMC 15% · volume 10% · volatility 10% · regime 10% · R:R 10%); only 80+ = STRONG picks shown.
- 📋 **Complete trade blueprint per pick** — entry zone (limit band), ATR stop-loss, T1/T2/T3 targets, recommended leverage (liquidation-aware ladder: spot 1×, futures ≤6× by score), staged 40/40/20 exit plan with breakeven+trail, IMMEDIATE vs PULLBACK timing window, hold horizon, invalidation note.
- 🌐 **Dynamic universe discovery** — LIVE from the CoinDCX feed (no stale hardcoded coin lists; delistings/new listings flow automatically). Resilient fallback chain: CoinDCX → Binance top-listing (CoinDCX-seed filtered) → static majors, with live USDINR conversion.
- 🔧 **CoinDCX Signal Board fix** — pass-2 now revives the pattern/sr/volume/volatility model votes from 1h LTF candles (previously 4-5 of 9 models abstained on crypto → confidence collapsed to NEUTRAL and no trade signals showed).
- 🔓 **CRITICAL login fix** — the PIN input had `maxLength={4}`: any strong PIN (5+ chars, as `.env.example` recommends) could NEVER be entered and the terminal stayed permanently locked. Now 4-32 chars.
- ✅ All checks pass — TypeScript clean, 851/851 tests (43 files), build OK, 0 npm audit vulnerabilities, live API + browser E2E verified.

See [`docs/UPGRADE_REPORT_v18.md`](docs/UPGRADE_REPORT_v18.md) for the v18 audit & fix list.

## What's New in v18.0 (Advance Pro Intelligence)

- 🚀 **`/pro`** — Flagship Advance Pro Intelligence Dashboard (regime + portfolio + market + smart money + AI verdict in one)
- 🌍 **`/sentiment`** — Real-time market sentiment via Tavily news (Fear/Greed score)
- 🐋 **`/whale`** — Whale activity tracker (portfolio big movers + block/bulk deal news)
- 📅 **`/earnings`** — Upcoming earnings calendar (India NSE/BSE)
- 💰 **`/smartmoney` fixed** — Now fetches REAL FII/DII data (previously showed random numbers)
- 📰 **`/news` fixed** — Now fetches REAL headlines from Tavily (previously hallucinated)
- 🎯 **`/dip` fixed** — Proper $ vs ₹ currency for US positions
- 🔧 **`/quality` fixed** — Env-based URL (no more localhost hardcode)
- 📋 **Telegram menu** expanded from 37 → 53 commands (16 were missing)
- 🧠 **Unified branding** — All version strings now consistent (`v18.0`)
- ✅ **All checks pass** — TypeScript clean, 54/54 tests pass, build OK

See [`docs/UPGRADE_REPORT_v18.md`](docs/UPGRADE_REPORT_v18.md) for the full audit & fix list.

## Requirements

- Node.js 20 or newer (Node 22 recommended)
- npm 10+
- Optional: Python 3.11 and Docker for the separate ML service

## Quick start

```bash
git clone https://github.com/wonderboy2040/smartai1.git
cd smartai1
cp .env.example .env
# Edit .env and set at minimum APP_PIN.
npm ci
npm run dev
```

The Vite development frontend runs on `http://localhost:5173` and proxies `/api` to the Node server on port 8080. In another terminal, start the backend:

```bash
npm start
```

For a production build:

```bash
npm run check
npm start
```

`npm start` serves both the generated `dist/` frontend and API from `http://localhost:8080`.

## Required configuration

Copy `.env.example` to `.env`. Do not commit `.env`.

- `APP_PIN`: required server-side login PIN. Use a strong, non-default value.
- `VITE_API_TOKEN`: strong 12+ character secret used by cloud sync.
- `VITE_ENCRYPTION_KEY`: strong key used by browser-side secure storage.
- `ALLOWED_ORIGINS`: comma-separated frontend origins when frontend/backend are cross-origin.
- AI provider, Telegram, broker, and market-data keys are optional; their related features remain unavailable until configured.
- `TG_TOKEN` and `TG_CHAT_ID` must be configured together.

## Validation commands

```bash
npm run typecheck   # strict TypeScript check
npm test            # Vitest suite
npm run build       # optimized production bundle
npm run check       # all three commands above
npm run audit:all   # production dependency audit for app + Telegram bot
```

## Docker Compose

```bash
cp .env.example .env
# Configure .env first
docker compose up --build
```

- Frontend/Nginx: `http://localhost:3000`
- Node API: `http://localhost:8080`
- Health endpoint: `http://localhost:3000/health` or `http://localhost:8080/health`

The Compose setup builds the `node-server` from the Node build stage and the frontend from the final Nginx stage. Nginx proxies API, WebSocket/SSE, and health requests to the backend.

## ML engine

The ML engine runs in-process (`server/mlEngine.js`, pure JS) and serves all
`/api/ml/*` routes. The old standalone Python FastAPI service was removed —
the Node server replaces it entirely (no second deployment needed).

## Telegram bot (optional)

The main Node server starts the bot automatically when both `TG_TOKEN` and `TG_CHAT_ID` exist. It can also run independently:

```bash
npm --prefix telegram-bot ci
npm run start:telegram
```

## Deployment

`render.yaml` contains the Render web-service definition. Configure secrets in the host dashboard rather than checking them into source control. The deployment health check is `/health`.

## Upgrade status

See [`docs/UPGRADE_REPORT.md`](docs/UPGRADE_REPORT.md) for the checks performed, fixes applied, dependency/security status, and known environment-dependent limitations.

## v18.0.1 patch (audit & fix)

- Fixed 6 TypeScript errors in `src/components/tabs/AITradingTab.tsx` — the three `onExecute*` wrappers now accept the `notify` mode that `SignalCard` dispatches (`npm run check` passes again).
- Security: `qs` pinned to `^6.16.0` via npm `overrides` (express transitive dep, GHSA-x5fp-wj9c-mxmx / GHSA-4mjr-xmp4-gh2g); dev-dep + telegram-bot advisories patched. `npm audit` → 0 vulnerabilities.
- Full audit details: [`docs/AUDIT_FIX_REPORT_v1801.md`](docs/AUDIT_FIX_REPORT_v1801.md)
