# UPGRADE REPORT — v8.0.1 Advance Pro Trader Engine (2026-09-10)

User complaint: *"CoinDCX tab me koi trade signals nahi de raha — crypto ke sabhi spot
aur futures me scan karo, expert picks ke trade signals chahiye 80+ AI score ke saath:
kab entry lena hai, kitna leverage lagana hai, kab exit karna hai. Intraday TAB aur
CoinDCX TAB ko upgrade karo."*

## 1. Root-cause diagnosis (why the CoinDCX tab showed no signals)

Live debugging of `/api/ai/signals?market=CRYPTO|FUTURES` showed the board WAS
working (11/12 coins scanned, plans built) — but **every signal graded NEUTRAL with
confidence 5-13%**, and `topFive` was always empty. Chain of causes:

1. **Abstain-heavy crypto consensus**: the TradingView crypto rows carry
   `patterns: []`, `pivot: null`, `vwap: null`, `obvSlope: null`, `mfi: null` —
   so the pattern / sr / volume / volatility models abstained on the whole board
   (4-5 of 9 models). Participation ≈ 47% → the v6.3 confidence formula
   `score × (0.60+0.40·agreement) × (0.70+0.30·participation)` crushed every
   signal to NEUTRAL. Nothing was ever STRONG/ACTION → "no trade signals".
2. **Stale 12-coin hardcoded universe** (MATIC already delisted → 11 scanned);
   the user asked for "sabhi spot and futures" scanning.
3. **No dedicated high-conviction layer** — the consensus board is honest but
   deliberately conservative (split-factor days read NEUTRAL).

## 2. What was built

### 2.1 NEW ENGINE — `server/ai/expertPicks.js` (Advance Pro Trader Engine)

| Part | What it does |
|---|---|
| `discoverSpotUniverse()` / `discoverFuturesUniverse()` | LIVE universe from the CoinDCX feed (top ~45 by 24h turnover). Fallback chain: CoinDCX → Binance 24h tickers (intersected with a 100-coin CoinDCX-listed seed list so tokenized stocks/ETFs like AAPL/EWY/SNXX never appear) → static majors. 10-min cache, stale-serve on refresh failure. |
| `fetchUsdInr()` | Live USD→INR (Yahoo) with 1h cache for the Binance USDT→INR fallback path. |
| `expertScoreFactors()` (PURE) | 7-factor composite 0-100: trend structure (25%) · momentum (20%) · SMC/ICT from 1h candles (15%) · volume flow (10%) · volatility fit (10%) · market regime (10%) · R:R quality (10%). Side decided first (trend+momentum majority), then every factor graded FOR that side (SHORT reads grade the short). MACD normalised across BOTH data shapes (TV numbers vs candle-object). |
| `buildExpertBlueprint()` (PURE) | The complete trade plan: entry zone (±0.35/0.10 ×ATR limit band), 1.6×ATR stop (floor 0.4%), T1/T2/T3 = 1R/2R/3R, **leverage ladder** (spot 1×; futures min(maxSaneLeverage, 6× for 88+ / 5× for 80+ / 3× below), liquidation estimate 0.95/L — always BEYOND the SL), **staged exit plan 40/40/20** (T1 book + SL→breakeven, T2 book + trail, T3 runner), IMMEDIATE vs PULLBACK timing (EMA20 distance in ATR units), hold horizon (ATR%-driven INTRADAY vs SWING), invalidation note. Adaptive price precision (DOGE 0.084 / SHIB-class 6-8 decimals). |
| `getExpertPicks()` | Orchestrator: universe → TV scanner (40-ticker chunks) → CoinDCX/Yahoo 1h candles (bounded 12-coin parallel batches) → score → filter ≥ minScore (default 80 = STRONG) → 60s cache. |
| Route | `GET /api/ai/expert-picks?market=CRYPTO|FUTURES|INDIA&minScore=&limit=` |

### 2.2 Signal Board confidence fix — `server/ai/signals.js` pass-2 revival

Pass-2 already fetched LTF candles for SMC. It now ALSO re-runs the abstained
pattern / sr / volume / volatility models on the LTF indicator snapshot (only
abstained slots replaced — no double counting; adaptive multipliers applied).
This is what fixed the "no signals" symptom at its source.

### 2.3 CRITICAL login bug — `src/App.tsx`

The PIN input had **`maxLength={4}`** — a strong PIN (5+ chars, exactly what
`.env.example` recommends) could never be typed, so the terminal locked the
user out permanently with a misleading "Invalid PIN" 401. Found via browser E2E
(fill was silently truncated to "test"). Now `maxLength={32}` +
`autoComplete="current-password"`.

### 2.4 Frontend — `src/components/aitrading/ExpertPicksPanel.tsx`

New panel (shared by both tabs): score badge (80+ emerald glow), side chip,
leverage chip (futures), horizon chip, timing chip (IMMEDIATE vs PULLBACK),
6-cell levels strip (entry zone / SL / T1 / T2 / T3 / risk-R:R), expandable
FULL PLAN (7 factor bars, staged exit plan, timing/horizon/invalidation cards,
leverage guidance with liquidation, SMC reads). 60s poll, honest degrade.

- **CoinDcxTab**: new `🧠 EXPERT` quick-nav section above Top-5, desk-aware
  (SPOT INR / FUTURES USDT), DEEP button wired to the existing deep modal.
- **IntradayTab**: same panel above the Signal Desk, market-aware
  (INDIA NSE / CRYPTO 24-7).

## 3. Verification matrix

```
npm run typecheck   → PASS (0 errors)
npm test            → PASS 851/851 (43 files; +18 new expert-picks tests)
npm run build       → PASS (~5s)
npm audit (prod+dev)→ 0 vulnerabilities
Live API            → CRYPTO: 45/46 scanned, 9 STRONG picks (80-83 score)
                      FUTURES: 45 scanned, 8 STRONG picks, 5× leverage
Browser E2E         → login OK (post PIN fix) → CoinDCX tab → EXPERT PICKS
                      panel rendered with 6 live cards (DOGE 82, FIL 86…),
                      GET /api/ai/expert-picks 200, zero JS errors.
                      Screenshot: expert-picks-ui.png
```

## 4. Notes & honest limits

- Pick scores are composite TA + SMC reads — **informational only, not
  investment advice**; levels are live-price-derived, verify on CoinDCX
  before executing (the panel footer says this too).
- On the day of verification the market was broadly red (BTC −2.2%) — the
  engine correctly returned only SHORT picks; a green day flips the side
  mix. The board itself stays honest (NEUTRAL when factors split).
- In restricted networks (this sandbox) the CoinDCX public API 403s — the
  engine transparently falls back to Binance-sourced prices (labelled
  `binance-usdt-x-inr` in the response `priceSource`). In production the
  CoinDCX feed is primary (true INR-domain prices).
