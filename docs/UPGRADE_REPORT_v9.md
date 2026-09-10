# UPGRADE REPORT — v9.0 Superintelligence Pro Trader Engine (Signal Board)

**Scope:** Intraday TAB + CoinDCX TAB ke **Signal Board engine** ko "Superintelligence Pro Trader" level pe upgrade.

**Date:** 2026-09-10 · **Baseline:** v8.0.1 (Advance Pro Trader Engine) · **Result:** TypeScript clean · 874/874 tests (44 files) · build 4.8s · 0 npm audit vulnerabilities · live API + browser E2E verified on both tabs.

---

## 1. What was weak before v9

| # | Weakness | Symptom |
|---|----------|---------|
| 1 | Signal Board scanned a **static 12-coin list** (CRYPTO_UNIVERSE / FUTURES_UNIVERSE) | 33+ liquid CoinDCX coins never reached the board |
| 2 | Pass-2 revival (SMC + pattern/sr/volume/volatility) ran **only on the top-10 by pre-confidence** | The best setup at rank 11+ read NEUTRAL forever |
| 3 | Board signals had **no AI SCORE, no blueprint** — only committee confidence + entry/SL/T1/T2 | "80+ strong signals" filter impossible; kab entry / kitna leverage / kab exit missing |
| 4 | CoinDCX feed blocked (WAF/geo) → **candles failed → no revival → all-NEUTRAL board** | The original "koi trade signals nahi de raha" complaint |
| 5 | Intraday crypto scanner universe was **static 12 coins** and died completely when CoinDCX tickers were unreachable | Empty scan |
| 6 | ExpertPicksPanel (v8.0.1) was wired into `tabs/IntradayTab.tsx` — an **orphaned file** (dead since the v6.9 tab split; the live tab is `IndiaIntradayTab.tsx`) | India desk me Expert Picks kabhi dikha hi nahi |

## 2. The v9 engine — `server/ai/superIntel.js` (NEW, pure)

### 2.1 `computeSuperScore()` — the AI SCORE (0-100)
Three-source blend + honest quality adjustments:

```
with AI verdict:     0.45 × engineConf + 0.35 × expertScore(7-factor) + 0.20 × aiConf
without AI:          0.55 × engineConf + 0.45 × expertScore
without expert:      0.65 × engineConf + 0.35 × aiConf
neither:             engineConf

adjustments:  extension veto → cap 65  ·  MTF aligned +4 / conflict −4  ·  session gate −6
              quorum-capped −4  ·  counter-regime −6  ·  agreement ≥80% +3  ·  hard `cap` param
tier ladder:  85+ ELITE · 80+ STRONG · 65+ ACTION · 50+ WATCH · else NEUTRAL
```

The intraday B-grade (watch-only) passes `cap: 64` — a B-grade setup can never wear the STRONG/ELITE badge.

### 2.2 `buildSuperBlueprint()` — the complete ticket
- **Entry timing:** EMA-distance → IMMEDIATE (≤0.5 ATR) vs PULLBACK + limit zone
- **Leverage ladder:** futures = min(maxSaneLeverage(SL-dist), tier cap 6/5/3×) + liquidation estimate; spot = 1×; India = MIS 1× plan (honest note)
- **Staged exit:** 40% @T1 + breakeven · 40% @T2 + trail · 20% @T3 (T3 = 3R)
- **EXIT CLOCK:** India = hard 15:10 IST square-off; crypto = volatility-horizon wall-clock (ATR% > 2.2 → 8h INTRADAY else 72h SWING), IST-formatted
- **Invalidation:** SL break / regime flip, no averaging

### 2.3 `intradayExpertFactors()` — the 7-factor expert score for the intraday signal shape (trend 24% · momentum 20% · volume 16% · SMC 8% honest-neutral · volatility 12% · regime 10% · R:R 10%)

## 3. Engine A — `server/ai/signals.js` (10-model committee board)

1. **Dynamic universes:** CRYPTO = `discoverSpotUniverse(40)` (every liquid CoinDCX INR pair); FUTURES = `discoverFuturesUniverse(40)` (every liquid B-USDT perp); INDIA unchanged (full 44-stock TV batch). Static lists are now last-resort seeds only.
2. **Prices:** CoinDCX primary → Binance × live USDINR fallback (spot INR domain) / Binance futures (USDT domain).
3. **Universal pass-2 revival:** LTF candles load for EVERY coin (bounded 12-parallel waves); SMC + pattern/sr/volume/volatility second votes apply at pass-1 for the whole universe (top-10-only bias removed). Yahoo enrichment stays INDIA-only.
4. **Domain-safe candle fallback:** CoinDCX candles → Yahoo 1h candles **rescaled onto the trading currency** via `rescaleCandlesToLtp()` with a ±50% expected-domain-ratio guard (spot: ltp/tv.usdPrice ≈ live fx; futures ≈ 1). A stale series can never corrupt ATR/EMA domains.
5. **Ranking:** candidates sort by the pre-super AI score; final signals re-score with the council verdict + quality + blueprint, and the board sorts by `aiScore`.
6. **Payload:** every signal carries `superIntel { aiScore, tier, drivers, factors, blueprint }`; the board carries `superIntelMeta { engine, universeSize, universeMode, priceSource, strongCount, eliteCount, scored }`. Cache: 60s India / 90s crypto+futures.
7. **Execution semantics unchanged** — `evaluateExecutionGate`, grades, the execute gauntlet and `getFreshSignalForExec` all keep their contracts (superIntel is additive).

## 4. Engine B — `server/intraday/*` (dual-AI scanner)

1. **Dynamic crypto universe:** `effectiveCryptoUniverse()` merges `discoverSpotUniverse(30)` + static + user watchlist (removals honoured), 5-min cached.
2. **`registerCryptoBases()`** (engine.js) — every scanned base registers into the crypto routing set so paper trades / track records / the SSE stream keep routing new coins correctly.
3. **Fallback INR anchors:** when the CoinDCX ticker feed is unreachable, `fallbackCryptoPrices()` supplies Binance spot × live USDINR anchors — the scan stays alive (INR domain preserved, TV rescale chain unchanged).
4. **Superintelligence layer:** every published signal gets the AI SCORE (engine × 7-factor × dual-AI, B-grade capped) + the full blueprint; signals re-rank by aiScore; payload gets `superIntelMeta`; engine label → `SUPERINTELLIGENCE PRO TRADER v9`.

## 5. Frontend

| File | Change |
|------|--------|
| `aitrading/types.ts` | `SuperIntel`, `SuperIntelBlueprint`, `SuperIntelFactor`, `SuperIntelMeta`; `AISignal.superIntel`; `SignalBoard.superIntelMeta` |
| `aitrading/SignalCard.tsx` | **AI SCORE ring** (ELITE gold glow / STRONG emerald / ACTION cyan) beside the confidence gauge + **SuperIntelStrip**: ⏱ ENTRY WINDOW · ⚡ LEVERAGE (liq) · 🎯 EXIT PLAN 40/40/20 · ⏰ EXIT BY + invalidation |
| `aitrading/deskShared.tsx` | 🔥 **80+ filter chip** (`SUPER`) on both desks + counts |
| `tabs/CoinDcxTab.tsx` | Section 01 → "Superintelligence Signal Board" + engine meta strip (universe / price chain / strong+elite counts) |
| `tabs/IndiaIntradayTab.tsx` | Same section rebrand + meta strip + **ExpertPicksPanel (market=INDIA) added** — the v8.0.1 integration had landed in the orphaned `IntradayTab.tsx`, the live India desk never had it |
| `intraday/types.ts` | `superIntel` + `superIntelMeta` (re-exported SuperIntel types) |
| `intraday/SignalCard.tsx` | AI SCORE badge under the confidence ring + blueprint panel |

## 6. Verification

- **API (live boot):**
  - `/api/ai/signals?market=CRYPTO` — ok, 39/41 scanned, dynamic universe, price chain `binance-usdt-x-inr` (sandbox WAF), signals with aiScore + blueprint (ACTION 63-70 conf / 73-78 aiScore in a red market; all-NEUTRAL pre-fix)
  - `/api/ai/signals?market=FUTURES` — dynamic (41), leverage ladder live (3×-5× + liquidation estimates)
  - `/api/intraday-scanner?market=CRYPTO` — **alive with fallback anchors** (was 0 scanned): `BCH SHORT grade=A aiScore=86 ELITE`, ETHFI A 70, IOST B 64 (capped WATCH)
  - `/api/intraday-scanner?market=INDIA` — 5 signals, B-grade honest at 64 WATCH, exitBy 15:10 IST
  - `/api/ai/expert-picks` — regression pass (40 scanned, 6 picks)
- **Browser E2E (agent-browser):** login → 🇮🇳 India Intraday tab: heading + AI SCORE rings + ENTRY WINDOW + EXIT BY + EXPERT PICKS + engine meta + 80+ chip + 10 cards, 0 JS errors → ₿ CoinDCX tab: 10 crypto cards + all blueprint elements + engine meta, 0 JS errors. Screenshots: `download/superintel-india-intraday.png`, `download/superintel-coindcx-board.png`.
- **Matrix:** `tsc --noEmit` clean · `vitest run` **874/874** (44 files; +23 new `test/superIntel.test.ts`: tier boundaries, blend redistribution, veto/hard caps, adjustment math, leverage ladder, liquidation side, 40/40/20, timing modes, exit clock, intraday factors) · `vite build` 4.8s · `npm audit` 0.

## 7. Files touched

**New:** `server/ai/superIntel.js`, `test/superIntel.test.ts`
**Server:** `server/ai/signals.js`, `server/ai/expertPicks.js` (exports), `server/intraday/engine.js`, `server/intraday/routes.js`
**Frontend:** `src/components/aitrading/types.ts`, `src/components/aitrading/SignalCard.tsx`, `src/components/aitrading/deskShared.tsx`, `src/components/tabs/CoinDcxTab.tsx`, `src/components/tabs/IndiaIntradayTab.tsx`, `src/components/intraday/types.ts`, `src/components/intraday/SignalCard.tsx`, `src/components/tabs/IntradayTab.tsx` (kept in sync — the file is currently orphaned but stays consistent)
**Docs:** `README.md`, this report.
