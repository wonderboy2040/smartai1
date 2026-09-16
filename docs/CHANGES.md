# Changelog

## v10.15 — SUPERINTELLIGENCE UPGRADE + BINANCE FUT WS ACCELERATOR (2026-09-16)

**The deep-recheck #2 remaining gaps + the intraday/CoinDCX superintelligence upgrade plan, fully applied.** Both plans verified against `db1f5a9` first (TS 0 errors · 92 files/1666 tests · audit 0/0 — everything already shipped was deliberately excluded). Suite grew **1666 → 1747 tests, all passing** (+81 across 4 new files + 4 extended files); boot smoke 7/7 live-verified (`scripts/smoke_v1015.sh`); build clean; audit 0/0.

### SECTION 1 — Binance futures WS: the real remaining speed fix
- **NEW `server/ai/binanceFutWs.js`** — the FUT_ accelerator TIER between the CoinDCX socket and the Binance REST fallback, modeled directly on cryptoStream.js's proven Binance client (combined-stream subscription, 3-fail handshake circuit breaker, 5-min rapid-cycle backoff, geo-block 451 honesty, 1MB frame cap, 20-stream cap, 2s resub debounce). When CoinDCX's futures socket goes dark (WAF blip/403/cooldown), FUT_ now gets **SUB-SECOND pushes** from `wss://fstream.binance.com` instead of degrading to the 5s REST cache — the "ab pehle jaisa ultra-fast nahi lag raha" moment for BTC/ETH/SOL is gone. Priority chain: CoinDCX Socket.IO → **Binance futures WS (new)** → Binance REST 5s → stale-serve.
- **Hot-standby semantics:** the accelerator socket opens ONLY while the CoinDCX WS isn't proving ticks and closes the moment it recovers — normal operation is byte-identical to v10.14 with ZERO extra upstream connections. Opens/closes with the SSE client gate (Render idle-friendly).
- **Source-priority gate + no badge flapping:** a binance-fut-ws tick never overwrites a fresh `coindcx-fut-ws` (<3s) or `coindcx-fut-rt` (<2.5s) tick (CoinDCX is the desk's authoritative exchange); out-of-order guard on late frames; `binance-fut-ws` renders as its own emerald **Binance·WS** pill (distinct from the 5s sky `Binance·RT`); REST-cadence floor applies while the accelerator owns FUT (GLOB-subscribed sessions keep 2s — GLOB has no Binance path); the REST fallback skips WS-covered symbols; status frame + `/api/feed-status` + the CoinDcxTab honesty chip carry the tier's state ("· FUT Binance·WS⚡" while the CoinDCX socket cools).

### GAP 1 — Live Conviction Tracker (the ensemble now works DURING the trade)
- **NEW `server/ai/positionConviction.js`** — the 14-model ensemble that decided "LONG with 82% confidence" re-votes every open position each tick via the SAME 30s-cached deep path the boards use (zero new upstream calls). `convictionDelta = currentScore − entryScore` (sign-relative to the position's direction) → **STRENGTHENING / HOLDING / WEAKENING / FLIPPED**.
- Wired into BOTH agents' exit ticks (inside the existing gauntlet — kill-switch/daily-cap early-returns gate it; an exit can never bypass the caps): **FLIPPED** (opposite side WITH quorum — ≥5 voters or STRONG) → immediate `conviction-flip` exit BEFORE the stop (thesis invalidation); a flip without quorum is noise, not an exit. **WEAKENING + in-profit** → SL ratcheted toward breakeven (never a hard exit; losing positions are never tightened — no disguised early exits on noise). **STRENGTHENING** → earns winner-extension room even marginally red; **WEAKENING/FLIPPED never earn it** (`extensionEligible` gained the conviction param; absent = the exact v10.8 behavior — locked by tests).
- Live conviction bar on every open agent position in both panels (green ▲ STRENGTHENING → amber ▼ WEAKENING → red ⯅ FLIPPED, with entry→now score + delta). Entry-time conviction score recorded at every entry (the delta anchor; `Number(null)===0` trap fixed in the pure core). Gated behind `AI_ENABLE_CONVICTION_EXIT` or the agent knob — **OFF by default, flag-off = byte-identical**.

### GAP 2 — Event Guard (scheduled-event awareness)
- **NEW `server/ai/eventGuard.js`** — the one question a pro trader asks before entry that the system never did: "is anything scheduled?" Three GRADED responses: **T-30min blackout** (block new entries on the affected symbol/desk — existing positions untouched), **T-2h sizing haircut ×0.5** (multiplier into the risk path, both flat and kelly-capped), and NO auto-flattening by design (the partial-TP/breakeven ratchets already de-risk into events; flattening green runners on every CPI print is churn).
- Calendars (honesty first — every derived date labeled approximate): NSE/US earnings lifted from the frontend's own `earningsCalendar.ts` table and rolled FORWARD quarterly (stale dates never block); FOMC 2026–2027 published decisions; RBI MPC published 2026 H1 + `AI_EVENT_EXTRA_JSON` for additions (invented H2 dates = false blackouts — missing data degrades honestly); India CPI/IIP + US CPI as labeled monthly patterns. Desk scoping: FOMC/US-CPI hit ALL desks (crypto is macro-sensitive); RBI/India-CPI/IIP hit INDIA only; earnings hit the symbol's desk.
- Integrated into BOTH agents' entry gauntlets (veto reason lands in the journal + panel blockers like every other gate) + the **⚠ event chip on every signal card** (`⚠ FOMC 30m · ENTRY BLOCKED` / `⚠ Earnings in 2h · size ×0.5` — the manual trader sees the same warning the auto-agent vets against) + `GET /api/ai/event-guard` status route. `AI_DISABLE_EVENT_GUARD` kills it; tunables `AI_EVENT_BLACKOUT_MIN/HAIRCUT_MIN/HAIRCUT_MUL`.

### SECTION 3 — Direction-accuracy split (the standing "are directions right?" answer)
- `weeklyReview.computeAiDeskWeek` gains **byDirection** (LONG vs SHORT trades/wins/win-rate/net-P&L, from closed positions — the only journal rows carrying side) and **byEntryHour** (IST entry-hour buckets — the "first-15-min entries lose" / "post-lunch chop" pattern detector). Both reach the Telegram header + the LLM prompt block (new **Direction Read** section in the digest).
- `trustReport()` gains the settled-ledger **direction split** (n / win-rate / avg-R per side) — rendered as the Model Performance Panel's new **DIRECTION SPLIT** block with a side-gap read (≥15 pts gap flags "ek side systematically weak hai").

### GAP 4 — Global Risk Brain (the cross-desk portfolio view)
- **NEW `server/ai/globalRisk.js`** — ONE exposure view across both desks (per-position stop-distance risk with correct currency domains, net directional bias, unpriced count — never invented), ONE portfolio-level **heat cap** (`AI_GLOBAL_HEAT_CAP_PCT`, default 6%) consulted by BOTH entry gauntlets (combined deployed risk over the ceiling vetoes entries regardless of which desk asks — "max-long NIFTY IT + max-long crypto" is finally seen as ONE bet), the rolling **BTC↔NIFTY** correlation (reuses the 60d matrix), and **risk-off detection** (VIX spike ≥25 & +15% over 5d AND BTC >1.5% below its 20d SMA — TOGETHER; each leg alone ≠ risk-off) that down-weights new-entry sizing on BOTH desks at once (×`AI_RISKOFF_MUL`, default 0.5). Unreachable market data → riskOff false + dataOk false (missing data is not a signal). 5-min cache — the gauntlet reads it free. `AI_DISABLE_GLOBAL_RISK` kills it.

### GAP 3 — Patient Entry (execution patience)
- **NEW `server/ai/patientEntry.js`** — an EXTENDED signal (>1.5 ATR beyond its anchor) rests at a **depth-derived pullback level** (just above a detected bid wall for longs / below an ask wall for shorts — via the shipped order-flow depth module; no readable depth → the signal's own anchor, never an arbitrary ATR fraction) for a validity window (**15m crypto / 10m India**, `AI_PATIENT_WINDOW_MIN`) instead of chasing. At-anchor signals enter immediately, exactly as today.
- Both agents: the resting order comes FIRST each tick (touched level → execute the PLANNED entry if the board still backs the side; signal gone → cancel, no chase); unfilled expiry → journaled **`missed-pullback`** (a GOOD outcome — it didn't chase); one resting order at a time; waiting doesn't block other symbols. Every entry journals an **`ENTRY_MODE` marker**, and the weekly review gained the **patience A/B** (`byEntryMode`: immediate vs patient closed-position win-rates + missed-window count) — "did patience pay?" is now a number, not a belief. Gated behind `AI_ENABLE_PATIENT_ENTRY` or the knob — **OFF by default (ship-last, A/B-able)**.

### SECTION 2 — Telegram: the implementable triage steps
- `/fiidii` + `/ipo` now reply with a clear **"needs TAVILY_API_KEY"** message when the key is missing (was an opaque error) — key-missing ≠ dead command, per the evidence-first triage.
- `/coindcx` ↔ `/crypto` cross-referenced each way with explicit wording (account status vs market prices — deliberately NOT aliases; they are different data paths by design, the "dedupe" is the shared wording + pointers, killing the two-sources-of-truth confusion without deleting working functionality).
- `/selftest` footer now carries the **triage procedure** (⚠️ = add the key, don't remove; ❌ = re-run twice, delete only PERMANENTLY dead paths incl. their helpers; transient timeouts = keep). The actual deletion pass still waits for the user's LIVE `/selftest` run — by the plan's own "needs your live run before any deletion is safe" rule.

### Verification
- NEW `test/cxRtStream.test.ts` v10.15 suite (7: dark→WS sub-second & REST-bypassed · both-dark→REST tier · cx-recovers→stand-down · source-priority no-flapping · idle-close · 20-stream cap · out-of-order) · NEW `test/positionConviction.test.ts` (21: pure classification ×8 · quorum/flip bar · weakening-tighten policy · extension interplay + zero-regression flag-off · flag round-trips · status payload) · NEW `test/eventGuard.test.ts` (16: blackout/haircut/allow ×desk-scoping ×calendar honesty ×status/chip) · NEW `test/globalRisk.test.ts` (15: exposure math ×currency domains · risk-off legs · gate/veto · tunables · honest degrade) · NEW `test/patientEntry.test.ts` (18: at-anchor/extended · wall levels · fill/expire/wait · flag · patience A/B) · extended `weeklyReview.test.ts` (+5 direction/hour/A-B) · `liveSourceBadge.test.tsx` (+1 Binance·WS pill).
- **tsc CLEAN · 96 files / 1747 tests ALL PASS · vite build CLEAN (5.0s) · npm audit 0/0 both trees · `scripts/smoke_v1015.sh` boot smoke 7/7 LIVE** (modules import+exports · event-guard route carries the FOMC/RBI/CPI calendar · feed-status carries the accelerator tier · SSE 200 with the tier live · trust route alive).

### Deferred (documented, not forgotten)
- GLOB_ (AAPL/MU/SPCX) acceleration: no crypto exchange lists single-stock perps — Finnhub remains the correct shipped answer (by design, not omission).
- Section 2's command DELETION pass: blocked on the user's live `/selftest` evidence (the plan's own prerequisite); the triage procedure + needs-key messages are in place so the next session can act on data.
- India winner-extension: the India agent still has no extension system (the crypto agent's parity item the conviction tracker hooks into); conviction there is exit+tighten only, recorded honestly in the panel.
- All four GAP engines are flag-gated OFF by default (`AI_ENABLE_CONVICTION_EXIT` · `AI_ENABLE_PATIENT_ENTRY` · event-guard ON but `AI_DISABLE_EVENT_GUARD` exists · global-risk gate ON but `AI_DISABLE_GLOBAL_RISK` exists) — flip them one at a time and A/B against the v10.14 baseline.

## v10.13 — FULL-SITE DEEP RECHECK: SECURITY + RESILIENCE HARDENING (2026-09-15)

**The requested "deep advance pro-level" full-site code recheck.** Three parallel deep reviews (server core + security, realtime stream modules, frontend core) — every finding re-verified against source before fixing. **2 HIGH security issues, 9 MEDIUM bugs, 20+ LOW issues found; all HIGH/MEDIUM and the cheap LOWs fixed, each with regression tests.** Suite grew **1621 → 1655 tests, all passing**; boot smoke 7/7 with the new security layer live-verified.

### SECURITY (HIGH)
- **H-1 master-token bundle leak (config footgun chain):** `render.yaml` still declared `VITE_API_TOKEN`/`VITE_ENCRYPTION_KEY` (build-time VITE_* vars are INLINED into the public JS bundle) while `requireAuth` treats `API_TOKEN` as a master bearer for EVERY endpoint — setting both to the same value (the naming invites it) handed every anonymous visitor full auth. Removed from the blueprint, removed the `api.ts` build-time read (cloud sync auth = runtime localStorage override only), and `validateEnv()` now REFUSES TO BOOT when `VITE_API_TOKEN === API_TOKEN` (live-verified both refusal and warning paths).
- **H-2 CSRF on no-body mutations:** the `SameSite=None` session cookie rode along on cross-site "simple requests" — silently authenticating `POST /api/ai/orders/cancel-all`, `kill-switch {}` (= DISARM), broker/API-key disconnects. The logout route already had the discriminator; it is now a GLOBAL middleware for every state-changing request: **cross-site + session cookie + no Bearer → 403** (login exempt — nothing to hijack pre-login; bearer/service calls unaffected). Live-verified in the boot smoke: cookie+cross-site+no-bearer → **403** on kill-switch; same-site → 200; bearer+cross-site → 200 (the app's own Vercel→Render path).

### SECURITY (MEDIUM/LOW)
- Telegram webhook now **fails closed in every mode except explicit `NODE_ENV=development`** (the old gate only refused `NODE_ENV === 'production'` — the repo's own VPS/start_server.vbs paths run unset and accepted forged updates); secret-token compare is now constant-time.
- **Global PIN-failure lockout** (150 failed PINs / 15 min across ALL IPs → 5-min login lockout) — the per-IP limiter alone was bypassable by rotating IPs against a 4-digit PIN; short-PIN boot warning added (not enforced — no lockout of existing deployments).
- Public market-data endpoints (`/api/quote`, `/api/chart`, `/api/fundamentals/:symbol`) gained per-IP rate limits (900/300/240 per 10 min — far above the busiest legit tab); growwQuote's `_failStreaks`/`_backoffUntil` maps are now swept at >500 entries (random-symbol enumeration through the public quote endpoint could grow them forever).
- Compat AI proxies clamp `max_tokens` (≤8192) / `temperature` and strip `stream`; backtest/swing/whales symbol lists capped at 12 + charset-validated; `/api/vision-analysis` no longer forwards the raw upstream error body to the client; body-parser errors now 400 (was 500); graceful shutdown drains in-flight responses (`server.close()` + 2s deadline) before exit.

### REALTIME STREAMS (the honesty + liveness fixes)
- **Groww grossly-stale row guard:** while the NSE window is open, a `lastTradeTime` from before today's 09:15 IST session (the exact v10.12.1 garbage shape: Nov-2023 rows) or an absurd future clock → rejected → quick-retry → honest Yahoo fallback. Same-session old timestamps stay accepted (illiquid symbols still have an honest LTP); outside market hours nothing is gated.
- **Finnhub WS liveness:** ping every 30s + 90s idle watchdog — a half-open TCP (laptop sleep→resume, NAT rebind) previously left `readyState OPEN` forever, silently losing Priority-1 instant trades for the process lifetime while the Yahoo fallback masked the degradation.
- **Epoch UNIT normalization** in `cxRtStream._landWsTick` + `futures.js` + `globalFutures.js` (`ts < 1e12 → ×1000`): the WS out-of-order guard compared CoinDCX SECONDS against internal MILLISECONDS — correctness was luck-dependent, and a seconds value stored into liveFeed poisoned frontend freshness.
- **`setScanSymbols` per-market maps:** an India scan no longer wholesale-evicts the crypto scanner's signal symbols (and vice versa) — each market owns its set, the watch set unions both.
- inStream fresh-symbol fan-out bounded (semaphore 6, usStream pattern — was 60 parallel Groww round-trips at page-load); inStream + intraday `_tick` re-entrancy guards; `_latestQuotes` prunes departed symbols (>10 min off the watch set); intraday `INDEX_SYMBOLS` is now the 10-name union (NIFTY50/NIFTYBANK/CNXIT paper trades can no longer hit Groww's garbage index endpoint); Finnhub REST bootstrap honestly labeled `finnhub-rest` (`finnhub-stream` reserved for actual WS trades); `_fallbackPoll` re-entrancy guard (overlapping TV batch POSTs when TV is slow — the rate-limit vector); WS frame size caps (1MB) on all three sockets; Binance reconnect jitter + rapid-cycle backoff (5+ connect-drop cycles/5 min → 60s hold-off).

### FRONTEND
- **SSE client resilience (liveStream.ts):** `onerror` now immediately downgrades feed status (`onStatus({})` — pollers speed up honestly instead of trusting stale "live" flags while the header still shows every feed LIVE), and a sustained error streak (≥6, no open) takes over from the browser's tight default retry loop with a **capped manual backoff that rebuilds the URL — re-reading the session token** (an expired 30-day token no longer loops 401s forever; a re-login heals the stream). Same pattern in `useIntradayStream`.
- **ErrorBoundary `key={activeTab}`** — one crashed tab no longer bricks the whole `<main>` area ("switch tabs" recovery now actually works).
- **Badge honesty:** unknown/missing source renders a NEUTRAL slate pill (was green "LIVE" — a label sink laundering delayed/unknown feeds into realtime-looking pills); `yahoo-us-fallback` → amber Yahoo·delayed; `finnhub-stream`/`finnhub-rest`/`tv-us-batch` map distinctly.
- Dead-but-exported hooks fixed before they become landmines: `useWebSocket` (handlers via refs — stale closures gone; CONNECTING-state duplicate-socket guard; manual `connect()` resets the attempt counter; symbols subscribe keyed on a string), `useServerSentEvents` (`useStreamingAI` cross-read line buffer — SSE frames split mid-chunk were silently DROPPED; `useLiveUpdates` ring-buffered at 200).
- **txn_history ledger capped at 5,000** (record/persist/cloud-save/restore surfaces — unbounded growth silently killed persistence at the ~5MB quota); tvWebsocket's global kill now clears callbacks (a stray second subscriber can no longer ride a dead socket); `apiFetch` no longer mutates the caller's `init`; `batchFetchPrices` + both SSE clients resolve the proxy base LIVE (runtime backend switch no longer split-brains REST vs stream); caller-initiated aborts are not retried; IndexedDB rejected-open promise resets (a transient failure no longer pins the localStorage fallback for the session); cache cleanup timer lazy-starts; `secureStorage.setItem` degrades to plaintext on WebCrypto failure (matches `setItemAsync`) instead of an unhandled rejection; IST date keys via the formatter directly (weekly-report dedup + daily snapshot were off-by-one outside IST); tab hotkeys ignore Ctrl/Cmd/Alt combos + contentEditable; cloud-merge retry cancellable on logout.

### Verification
- NEW `test/deepRecheckV1013.server.test.ts` (19: stale-row guard 4 paths + inert-outside-hours + failure-map sweep + per-market scan sets + 8 static index.js security guards) · NEW `test/liveStreamResilience.test.ts` (7: honest downgrade, transient-vs-sustained streaks, fresh-token manual reconnect, teardown) · +2 normalization cases in `cxRtStream.test.ts`, +3 NODE_ENV fail-closed cases in `telegramWebhook.test.ts`, +6 badge-mapping cases in `liveSourceBadge.test.tsx`.
- **tsc clean · 92 files / 1655 tests ALL PASS · vite build clean · npm audit 0 vulns · boot smoke 7/7 live-verified** (CSRF 403/200 discrimination, login exemption, quote rate-limit 429, SSE `?session=` 200) · browser E2E: login + 3 tabs, SSE connected, ZERO JS errors. Bundle scan: no `VITE_API_TOKEN` reference remains in `dist/`.
- Known deferred (design-level, documented): short-lived SSE stream tickets to keep 30-day tokens out of URLs (nginx log scrubbing recommended meanwhile); backup-module consolidation; `uncaughtException` survival policy (deliberate free-tier tradeoff, kept).

## v10.12.1 — INDIA INTRADAY: DEEP-RECHECK FIX (2026-09-15)

**Full-site deep recheck (the agreed final step after Plan C) found one real bug — fixed + live-verified.**

### The bug (live on the wire, caught by the boot smoke)
- `server/inStream.js` (`/api/stream?in=` SSE writer) tried Groww FIRST for INDEX symbols too — but Groww's `CASH/<INDEX>` endpoint serves a **garbage STALE ltp** (live-observed: `19425.35` with `lastTradeTime` from Nov-2023 while Yahoo's `^NSEI` was current). That garbage passed the `price > 0` check and went out as **`IN_NIFTY` @ 19425.35 tagged `groww-live`** — a WRONG price with the WORST possible badge, the exact opposite of the v10.12 honest-source goal.
- `/api/quote` (INDIAN_INDICES skip) and `intraday/stream.js` (INDEX_SYMBOLS → Yahoo override) already handled this; the inStream poller was the one gap. The old test only mocked "Groww returns null for NIFTY" — reality returns garbage, so the gap was invisible to the hermetic suite.

### The fix
- `inStream.js`: `INDEX_SYMBOLS` (union of the other two modules' sets — every name has a YF_INDEX_MAP entry) now skips Groww **entirely**; indices go straight to the Yahoo fallback, honestly tagged **`yahoo-delayed`**. Stocks unchanged (Groww first).

### Verification
- NEW regression test in `streamFeeds.test.ts`: Groww mocked with the REAL garbage payload shape (ltp 19425.35) → asserts Yahoo's current spot is served `yahoo-delayed` AND Groww is never even asked for an index, while stocks still hit Groww first.
- Boot smoke (5/5 PASS, live upstreams): `IN_RELIANCE` 1235.3 `groww-live` · `IN_NIFTY` **23118.6 `yahoo-delayed`** (was 19425.35 `groww-live`) · `/api/feed-status` shows both sources live.
- Browser E2E: India Intraday board renders **Groww·live** emerald pills next to live LTPs (AXISBANK ₹1,222.9, SBIN ₹968 — VLM-verified screenshot), SSE 200, zero JS errors.
- Suite: **90 files / 1621 tests ALL PASS**; tsc clean; vite build clean.

## v10.12 — INDIA INTRADAY: PLAN C HARDENING (2026-09-15)

**The user's 2-part plan, implemented end-to-end** (source-transparency badge + faster retry/backoff on Groww; Groww REST + TradingView WS as-is, no broker account).

### #1: Source-transparency badge — Groww·live / TV·WS / Yahoo·delayed
- Every India live tick now says WHICH upstream served it, end-to-end:
  - `server/inStream.js` (the `/api/stream?in=` SSE writer): canonical labels **`groww-live`** (Groww NSE served it) / **`yahoo-delayed`** (Yahoo fallback — indices, which Groww doesn't cover, or a Groww miss); the old `groww-in-stream`/`yahoo-in-stream` labels are retired (App.tsx `NSE⚡` chip + `useAppState` India-SSE-health regex updated to match).
  - `server/intraday/stream.js` (the `/api/intraday-stream` quotes the intraday signal cards + paper P&L actually run on): every quote tagged — stocks `groww-live`, indices `yahoo-delayed` (Groww's CASH/NIFTY endpoint serves a garbage index ltp — verified live 19425 vs 23398), crypto watch symbols `coindcx-inr`.
  - `src/utils/tvWebsocket.ts`: every browser TradingView-socket update tagged **`src: 'tv-ws'`**.
  - `src/utils/liveStream.ts`: the SSE wire `source` field now passes through into `PriceData.src` (was dropped); `PriceData` + `LiveQuote` gain the optional `src` field (zero breakage — absent = neutral LIVE pill).
- `LiveSourceBadge` (the v10.11 CoinDCX pill, reused verbatim for visual consistency) maps the three India labels: **Groww·live** (emerald) / **TV·WS** (sky) / **Yahoo·delayed** (amber).
- UI wiring: the intraday `SignalCard` renders the pill next to `● LIVE` (only when a live LTP exists — a snapshot price shows no provenance pill); `IndiaIntradayTab`'s board cards now get a live LTP overlay + pill from the existing intraday SSE stream (`liveLtp`/`liveSrc` — the aitrading SignalCard's v10.11 props, so the AI desk gets the same live-price treatment as the CoinDCX desk; the stream stays connected in every view mode since the signal board consumes it).

### #2: Faster retry / backoff on Groww failures
- NEW **`server/ai/growwQuote.js`** — the Groww fetcher lifted out of `index.js` (same pattern as v10.11's `finnhubQuote.js`): the 3s micro-cache + in-flight promise sharing is byte-identical (N consumers — /api/quote, intraday scanner, SSE watcher, inStream poller — still cost ONE round-trip/symbol), plus:
  - **Quick jittered retry** — ONE immediate retry after ~300–500ms INSIDE the same fetch cycle; a transient network blip recovers in the same cycle instead of costing a full 3s poll interval (all concurrent consumers ride the one retry — no extra upstream cost).
  - **Per-symbol fail-streak backoff** — after 2 consecutive fully-failed cycles (4 upstream misses ≈ 6s of REAL failure — a blip the retry absorbs never reaches 1), that ONE symbol is skipped for one poll cycle (~4.5s): honest null returns instantly with ZERO upstream traffic (callers fall back to Yahoo), the probe resumes after the hold, and one success anywhere resets the state completely. Steady state for a dead symbol = half-rate probing — never hammering, never frozen, and the shared cache budget stays healthy for symbols that ARE working.

### Tests (v10.12)
- NEW `test/growwQuote.test.ts` (12 — cache/normalization/never-throws + retry-same-cycle + backoff arm/instant-null/per-symbol/expiry/reset/half-rate steady state), `test/indiaLiveSource.test.tsx` (11 — per-path src tagging: intraday stream groww-live/yahoo-delayed/coindcx-inr, tvWebsocket `tv-ws`, badge mapping, SignalCard render gating). UPDATED `test/streamFeeds.test.ts` (canonical inStream labels).
- Suite: **90 files / 1620 tests ALL PASS** (was 88/1597); tsc clean; vite build clean; npm audit 0 vulns; boot smoke clean.

## v10.11 — COINDCX REALTIME PRICES: 5-PART RELIABILITY PLAN (2026-09-15)

**The user's diagnosis-based plan, implemented end-to-end** ("wiring is correct; the EQUITY SIM (USDC stock-perp) domain's upstream source is unreliable — guessed params + 60s blackout + slow Yahoo fallback").

### #1: Source-transparency badge (trust fix)
- Every liveFeed tick already carries a `source` label on the SSE wire; the frontend now SURFACES it: new `src/components/aitrading/LiveSourceBadge.tsx` renders an 8px provenance pill next to every live price — **CoinDCX·RT** (emerald, direct feed REST or WS), **Finnhub·RT** (sky, fallback #1), **Yahoo·delayed** (amber, final fallback), **Binance·RT** (sky, honest CoinDCX-dark fallback), **SIM·synthetic** (slate, SPACEX). Unknown source → neutral LIVE pill — never a blank, never a wrong guess.
- `useCxLivePrices.ts` passes `src` through (`CxLiveTick.src`); `SignalCard` (+ deep modal), `TopPicksPanel`, `ExpertPicksPanel` all render it (new `liveSrc` / `liveSrcFor` props, optional → zero breakage); CoinDcxTab wires all 4 call sites.

### #2: Negative-cache blackout shrunk (60s → jittered exponential backoff)
- `globalFutures.js` `fetchGlobalFuturesRt`: first failed probe round now blacks out **~10s** (was a flat 60s), repeated failures double it (**20s → 40s cap**) with ±0–2s jitter; **one success resets the streak**. A WAF blip heals in 10s instead of a full minute of degraded prices.

### #3: Finnhub fallback for EQUITY SIM (replaces Yahoo as primary fallback)
- NEW **`server/ai/finnhubQuote.js`** — the US desk's inline fetcher lifted into a SHARED module: one 3s micro-cache with in-flight promise sharing (a symbol one desk just fetched is free for the other) + **one 55/min sliding-window rate limiter** (free tier is 60/min; neither desk can starve the other). The 2026-audit staleness gate survives the lift (open-market stale quotes are rejected → Yahoo), so Finnhub-first can never serve a frozen price during US hours.
- `fetchGlobalQuotes` fallback chain is now **CoinDCX RT → Finnhub → Yahoo** (was RT → Yahoo), rows tagged `source: 'finnhub'` → the badge in #1 shows exactly which upstream served each price. `server/index.js` imports the shared module (byte-parity behavior for /api/quote).

### #4: Endpoint contract confirmed (docs.coindcx.com research)
- The `/market_data/v3/current_prices/futures/rt` endpoint is **documented with NO query params** (sample response = USDT pairs only) — USDC-scoping stays best-effort, so the 3-variant probe stays, but now **array-style FIRST** (`margin_currency_short_name[]=USDC` — CoinDCX's documented multi-value convention on the derivatives family: `active_instruments`), then scalar, then combined. Response row shape (`ls/pc/h/l/v/mp/ts`) confirmed → the parser is docs-accurate.

### #5: CoinDCX futures WEBSOCKET (event-driven, no 2s ceiling)
- Docs confirm a futures socket: `wss://stream.coindcx.com` — **Socket.IO v2 / Engine.IO 3**, per-instrument channels `B-<PAIR>@prices-futures`, event `price-change`, app-level ping every 25s, market data needs **no auth**.
- NEW **`server/ai/cxSocketIo.js`** — a hand-rolled EIO=3 framing client over the existing `ws` dependency (~60 lines, factory-injectable, zero new npm packages — keeps `npm audit` clean; the legacy `socket.io-client@2.4.0` has known advisories).
- `cxRtStream.js` gains the **WS accelerator**: subscribes the refcounted symbol set (`B-<BASE>_USDT@…` + `B-<SYM>_USDC@…`), lands every attributable `price-change` in liveFeed **immediately** (labels `coindcx-fut-ws` / `coindcx-glob-ws`), tolerant to every plausible payload shape (channel-attributed single ticks, inline fields, book-style `prices` maps — the docs' own sample for this event is empty). **Tolerant parse + auto-detect health**: only an ACTUALLY-LANDED tick counts as proof —
  - WS healthy (tick < 30s old) → REST poller slows to a **10s floor** (event-driven freshness + a guaranteed floor for illiquid perp channels that can go minutes without events);
  - WS down / unproven / silent → REST stays at the full **2s** (v10.10 behavior — a docs mismatch can NEVER freeze or slow prices);
  - ns-connected but zero attributable ticks for 2 min → **watchdog kills the socket + 10-min cooldown** (the docs payload is best-effort; the REST poller owns the desks);
  - out-of-order guard (a late WS frame never regresses a newer tick), handshake watchdog 8s, fail-streak circuit breaker (3 → 10 min cooldown), reconnect backoff 3s→24s, idle-close with the SSE client count, engine.io ping→pong auto-answer.
- SPOT deliberately untouched: the spot WS channel (`currentPrices@spot@10s`) is SLOWER than the existing CoinDCX 2s REST anchor + ~1s Binance WS accelerator.

### Tests (v10.11)
- NEW `test/finnhubQuote.test.ts` (7 — shared contract, cache sharing, budget guard, staleness gate), `test/globalFuturesFinnhubFallback.test.ts` (5 — RT→Finnhub→Yahoo chain, per-symbol honesty), `test/cxSocketIo.test.ts` (8 — EIO=3 framing, join/leave exactness, lifecycle honesty), `test/liveSourceBadge.test.tsx` (10 — badge mapping + render gating).
- Extended `test/globalFuturesRt.test.ts` (14 — array-first probe order, backoff growth/cap/reset) and `test/cxRtStream.test.ts` (18 — Finnhub/Yahoo labels + the full WS contract: immediate tick, cadence transitions, degrade path, silent watchdog, out-of-order guard, book-style fan-out).

### BONUS FIX (deep-recheck find — fired live TODAY): expiry-day option-card degeneracy
- The full-suite recheck caught `optionSignalCards` failing at HEAD (pre-existing, untouched by the plan): on the expiry-day MORNING (2026-09-15, the real NIFTY Tuesday weekly, ~15:20 IST) the OTM candidate's BS premium collapses to the ₹0.05 tick → `roundToTick` clamping served a degenerate **0.05/0.05/0.05 card (SL == entry == target)** — meaningless numbers next to a fresh consensus, the exact "wrong call" experience.
- `optionsDesk.js` fix: sub-**₹1 collapsed-premium candidates are DROPPED** (below ~₹1 the bid-ask spread IS the premium — no honest card exists for that strike) + belt-and-suspenders **tick-separation guards** (SL ≥ entry or target ≤ entry can never ship, on any path). +2 regression tests (hand-built collapsed row + the runtime-clock expiry-morning case).

## v10.10 — COINDCX DIRECT 2s RT OVERLAY (2026-09-15)

**The original bug**: the CoinDCX tab's three desks (SPOT / GLOBAL FUTURES / EQUITY SIM USDC) rendered `signal.ltp` — a board-snapshot price that could be ~2.5 minutes old next to a "fresh" signal → "wrong call / wrong signal" experience.

- NEW `server/ai/cxRtStream.js` — the 2s DIRECT-from-CoinDCX poller for the two domains the SSE stream never covered: `FUT_<BASE>` (USDT perps, CoinDCX RT + Binance perp fallback, honest labels) and `GLOB_<SYM>` (USDC equity perps, CoinDCX RT + Yahoo fallback + SPACEX synthetic walk). Refcounted subscriptions, 90s eviction grace, idle-stop, single-flight shared with the board compute.
- `/api/stream` accepts `fut=` + `glob=` params; `signals.js` board TTL 90s→60s with ≤2s-fresh plan pricing; `futures.js` single-flight.
- NEW `src/components/aitrading/useCxLivePrices.ts` — ONE EventSource for all three desks, 800ms batched flush render-storm guard, visibility pause; `SignalCard` live LTP with tick flash + ⚡ LIVE badge + drift-vs-entry chip; CoinDcxTab/TopPicks/ExpertPicks live overlays + the honesty chip.

## v10.9 — TELEGRAM BOT 8-UPGRADE PLAN (2026-09-15)

### Feat #1: ONE SOURCE OF TRUTH — dual-bot unification
- **The problem**: the legacy polling bot (`telegram-bot/bot.mjs`, own `analysis.mjs`/`market.mjs`/`algo.mjs` pipelines) and the site webhook bot (`server/telegram/webhook.js`, site agents) could answer the SAME question DIFFERENTLY — "bot says BUY, site says HOLD".
- NEW `telegram-bot/siteAgents.mjs` bridge: `/scan`, `/screener`, `/consensus`, `/regime`, `/smartmoney` ab the SAME site backend routes chalate hain jo website tabs + webhook use karte hain (`/api/ai/deep/:symbol`, `/api/ai/signals`, `/api/crypto-agent`, `/api/intraday-agent`) over the 127.0.0.1 loopback with the server-only `API_TOKEN`.
- **Never goes dark**: site unreachable → every command falls back to its legacy local path (bot stays alive, just local). The bot keeps its genuinely bot-specific value (Gemini Vision chart photos, FII/DII via Tavily — prepended with the SITE's regime read so interpretations can't drift).

### Feat #2: INSTANT TELEGRAM PUSH (SL/TP touches in seconds)
- NEW `server/ai/telegramPush.js` — a price-driven sink polling `getPositionsWithPnl` (the same cached view the realtime SSE stream serves) every **5s while positions are open**: SL / TP1 / TP2 / liquidation level TOUCH → instant push (level-touch early warning; the 60s watcher stays the executor and sends the fill-confirmed truth).
- Fresh **STRONG signals** scanned every ~30s through the SAME board cache + single-flight (underlying compute cadence unchanged).
- The routes.js 60s alerter is DEMOTED to backup — both paths share ONE dedupe map, whichever sees it first wins. The legacy bot's 10-min algo cron is now a **backup heartbeat**: it checks `GET /api/ai/insta-push/status` and only fires when the pipeline is stale/unreachable. Flag `AI_INSTANT_PUSH=off` reverts to watcher-only.

### Feat #3: WEEKLY TRADE-PERFORMANCE DIGEST
- NEW `server/ai/weeklyReview.js` + `POST /api/ai/weekly-review`: the **quant-computes-numbers, LLM-narrates** pattern — AI desk journal closes (rolling 7 IST days), trust.js calibration (claimed vs realized win-rate, Brier, drift), NSE intraday paper week → ONE LLM narration (Week Scorecard / Calibration Read / Best & Worst / Discipline Audit / Next Week Plan / GREEN-AMBER-RED verdict). Quant header is ALWAYS visible (LLM or not).
- Sunday **19:00 IST auto-push** (`AI_WEEKLY_REVIEW_PUSH=off` disables); on demand: webhook `/weeklyreview` + legacy bot `/weeklyreview` (via the bridge).

### Feat #4: CONTROLLED TELEGRAM ORDER APPROVAL (opt-in, security-sensitive — done LAST as planned)
- NEW `server/ai/tradeApproval.js` + webhook `/trade` + inline **Approve/Reject callback buttons** + **PIN second factor**.
- Security contract (all test-locked): default **OFF** (`AI_TELEGRAM_APPROVALS=on` arms); admin-only (viewer chats blocked); PIN mandatory (`AI_APPROVAL_PIN`, 4–12 digits, 3 tries then dead); **daily hard cap** (default 3 EXECUTED/day IST); 5-min TTL + 3-min PIN window; ONE pending request at a time; approval only triggers the **existing `executeSignal` gauntlet** (`source: 'telegram-approval'`) — fresh-signal re-verification, kill switch, risk caps, mandate freeze, one-per-pair ALL still apply. The button is a manual trigger, it **bypasses nothing**.
- `/trade BTC LONG 5000 x3 paper` grammar is strict — no chat text ever becomes an order on its own. `GET /api/telegram/approval/status` for transparency.

### Feat #5: VOICE NOTES
- Both bots listen now: `bot.on('voice')` (legacy) and webhook voice messages → download → **Groq Whisper large-v3** (Gemini inline-audio fallback) → transcript shown → routed to the SAME desk agent (crypto/intraday inference + session memory) a text question would hit. Legacy bot falls back to its own 7-engine chat if the site is down. NEW `server/ai/voiceNotes.js` (site-side, reads groqApiKey/geminiApiKey from the secrets store).

### Feat #6: MULTI-USER ROLES
- `TELEGRAM_ROLES="<chatid>:admin,<chatid>:viewer"` — the configured chat is ALWAYS admin; viewers get read-only access (desk agents, /status, /weeklyreview, voice notes) and are blocked from every approval surface (`/trade` + the buttons + the PIN window are chat-owner-checked). Strangers stay silently ignored. `/whoami` shows the role.

### Feat #7: CORRELATION-AWARE ALERT BUNDLING
- telegramPush.js STRONG scan: simultaneous crypto STRONG signals with 60d Pearson r ≥ 0.75 (the existing `pairCorrelation`, 15-min cache) go out as **ONE bundled message** ("2 correlated moves — ek hi trade hai, diversify ka dhyan") instead of N pings. Unknown correlation = SEPARATE alerts (never a fake 0). INDIA stays per-signal. `GET /api/ai/pair-correlation?a=&b=` exposes the same read.

### Feat #8: SIGNAL FRESHNESS DECAY (CoinDCX tab)
- The Intraday tab's 5-min stale concept applied to the ensemble boards: `FreshnessBadge` (LIVE green pulse <2min → amber "Xm old" 2–5min → red pulsing "STALE Xm" >5min) + the signal grid **opacity ramp** (100% → 80% → 50%). Grades the SIGNAL COMPUTE freshness honestly — prices on cards may still be SSE-live; the badge says which is which.

### Validation
- tsc CLEAN; vitest **81 files / 1504 tests ALL PASS × 2 consecutive runs** (baseline 1394 + 110 new across 7 test files: tradeApproval 29, telegramWebhook 32 incl. the end-to-end approval + voice flows, telegramPush 21, boardFreshness 11, weeklyReview 11, siteAgents 9, voiceNotes 8); node --check on every touched bot/server module; import-smoke all 7 new/extended modules clean; route registry PASS with the 4 new routes (/api/ai/insta-push/status, /api/ai/weekly-review + status, /api/ai/pair-correlation, /api/telegram/approval/status).

## v10.8 — NEAR-MISS AUTO-TRADE + 4 VE-TRADING PRO PORTS (2026-09-15)

### Feat: NEAR-MISS AUTO-TRADE (user spec: "Near Miss ke trade mat chhodo — highest AI score + high conf wale ko auto trade lagao")
- `agent.js`: jab poora bar (AI score / STRONG committee) koi clear na kare us scan-cycle me, sabse **highest AI-score near-miss** (gap ≤ `nearMissScoreGap` pt below the effective bar, confidence ≥ `nearMissMinConfidence`, 5+ voters quorum-honest, STRONG/ACTION grade, executable plan) **auto-entry** lagta hai — same execution gauntlet, same 3-tier exits.
- Quality guards: `nearMissMaxPerDay` (default 1/day) — journal `NEAR_MISS` markers budget ka audit trail hain; full qualifiers HAMESHA priority rakhte hain; correlation guard + one-per-pair + risk-cap near-miss par bhi apply hote hain; per-day budget khatam → honest skip with reason.
- Panel: Decision Quality strip me near-miss chip (gap/budget live), NEAR-MISSES ab "(auto-traded · best one)" labeled, aur "NEAR-MISS AUTO-ENTRIES TODAY" audit strip; Agent Rules editor me NEAR-MISS AUTO toggle + gap/conf/per-day sliders.

### Feat: WINNER EXTENSION ("trade ke hisaab se extension ho na chahiye")
- Time-exit par jo agent position **profit me** hai aur board par koi qualifying **opposite signal nahi** hai — uski window extend hoti hai (each +`winnerExtendPct`% of the dynamic ATR window, max `winnerExtendMax`× = default 2) aur **SL breakeven lock** ho jaata hai (journal `SL` entry, watcher turant armed). Losers original window par hi cut. Trend-flip hamesha extension ko beat karta hai. Board scan ab time-exit sweep se PEHLE ek hi pass me opposite-qualifying map banata hai (flip-exit + extension veto ek hi truth se padhte hain).
- Panel: win-extend chip + Agent Rules toggle.

### Feat: PRO #4 — BOUNDED-AUTONOMY MANDATE (Vibe-Trading port)
- `agentStart` risk-caps ko **frozen mandate** me capture karta hai (deep-frozen, session-immutable) + journal `MANDATE` audit entry (exact caps ka immutable record). Mid-session config loosening (zyada trades/risk/leverage…) clamp ho jaati hai frozen value par — agent sirf STRICTER hi ho sakta hai; user config file untouched rehti hai; STOP+START fresh freeze. `agentStatus.accuracy.mandate` + panel chip.

### Feat: PRO #1 — BULL/BEAR DEBATE COUNCIL (Vibe-Trading investment-committee port)
- AICouncil ab 3-step chain hai: **Bull Advocate** (strongest honest LONG case, grounded in the same indicator data) → **Bear Advocate** (strongest honest SHORT case) → **PM Verdict** (MUST cite where bull/bear disagree + why it sides one way; same verdicts shape as before).
- Resilience: koi bhi step fail → legacy single-shot prompt fallback (never offline because the debate hiccuped). Flag `AI_COUNCIL_DEBATE` (default ON). SentimentPulse parity preserved. `aiNote.debate` carries both cases on the signal card.

### Feat: PRO #3 — LIGHTWEIGHT CHAT MEMORY (Vibe-Trading memory port)
- NEW `server/ai/agentMemory.js`: per-desk (crypto/protrade) ring of 60 Q&A turns, symbols + topics auto-extracted (whitelist + pair shapes), last 8 + recurring-focus tally system-prompt me feed hote hain — "pichhli baar SOL pe short view tha" continuity. Durable-backed, best-effort everywhere. Wired into cryptoAgent + ProTrader (india chat).

### Feat: PRO #2 — NL CUSTOM STRATEGY LAB (Vibe-Trading strategy-discovery port)
- NEW `server/ai/strategyLab.js` + `POST /api/ai/strategy-lab` + chat tool `backtest_custom_strategy` + Backtest Lab UI block: plain-English idea → LLM compiles a **bounded whitelist rule-expression** (10 indicators × 4 operators × sane value ranges, max 4 entry + 3 exit conditions, ATR-stop 0.5–5, TP 0.5–5R, hold 6–168 bars) → validator rejects ANYTHING outside → walk-forward replay on the SAME candle history (no look-ahead, SL-first, 10bps slippage) → same R-multiple stats shape as the ensemble backtest. Rules jo chale wahi UI pe echo hote hain (full transparency).
- `backtest.js`: `fetchHistoryFor` + `statsFromTrades` shared exports.

### Validation
- tsc CLEAN; vitest **75 files / 1394 tests ALL PASS × 2 consecutive runs** (baseline 1322 + 72 new: nearMissAutoTrade 17, mandateFreeze 9, councilDebate 11, agentMemory 13, strategyLab 22); ml-service pytest 11/11; import-smoke all modules clean; functional smoke of every new pure core.

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
