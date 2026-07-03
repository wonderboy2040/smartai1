# 🚀 SmartAI1 — Long-Term Investment Features (15-20 yr horizon)

## Overview

5 high-impact features added for long-term investors with a 15-20 year horizon. All features are integrated into the existing UI (Planner tab + Portfolio tab) and Telegram bot.

## Feature 1: Monte Carlo SIP Simulator 🎲

**Purpose:** Standard SIP calculators show ONE number based on fixed CAGR. Monte Carlo runs 10,000 randomized simulations to expose the realistic RANGE of outcomes — P10 (worst 10%), P50 (median), P90 (best 10%) — plus the probability that the user hits their target corpus.

**Why it matters for 15-20yr:** Sequence of returns is critical. Same average return can produce wildly different outcomes depending on whether crashes hit early or late. Monte Carlo prepares users for the worst case, not the median fantasy.

### Implementation
- **New file:** `src/utils/monteCarloEngine.ts` (~210 lines)
  - Deterministic mulberry32 PRNG (reproducible for same inputs)
  - Box-Muller transform for gaussian monthly returns
  - 6 volatility presets (conservative 10% → crypto 65%)
  - Returns: P10/P25/P50/P75/P90, mean, std-dev, min/max, histogram (20 buckets), percentile curve per year
  - Hit probability calculation vs target corpus
- **New component:** `src/components/MonteCarloSimulator.tsx`
  - Sliders: monthly SIP, years, step-up %, target corpus
  - 6 risk-preset buttons (auto-set CAGR + volatility)
  - Headline cards: P10 (red), P50 (amber), P90 (green)
  - Target hit probability progress bar (red/amber/green)
  - Histogram of 10,000 outcomes
  - Year-by-year percentile curve (SVG, P10/P50/P90 lines + shaded band)
  - Total invested + median multiplier
- **Integrated in:** PlannerTab (between What-If SIP and FIRE)

### Tech
- 10,000 simulations × 240 months = 2.4M iterations, completes in <100ms
- Deterministic seed=42 → same inputs always produce same outputs (UI stability)
- Year-end percentile curve sampled (every 4th sim) to bound memory

---

## Feature 3: Stock Quality Scorecard 📊

**Purpose:** Adds a fundamental layer on top of the existing technical-only analysis (RSI/MACD/SMA). Computes a 0-100 quality score using 7 weighted factors to filter out low-quality businesses that may permanently destroy capital (e.g. DHFL, Jet Airways, Yes Bank).

**Why it matters for 15-20yr:** Quality compounds. WIPRO/HDFC Bank/Asian Paints gave 100x+ over 20yr because fundamentals were strong. Low-quality stocks go to zero.

### The 7 Factors (weighted)
| Factor | Weight | What it checks |
|---|---|---|
| Piotroski F-Score (0-9) | 25% | Profitability, leverage, operating efficiency |
| Altman Z-Score | 20% | Bankruptcy risk (Z<1.81 = distress) |
| ROE 5yr trend | 15% | >15% and rising = moat |
| Debt-to-Equity | 15% | <0.5 = safe |
| Promoter holding trend | 10% | Rising = confidence (India only) |
| Free cash flow yield | 10% | FCF/MarketCap >5% = undervalued |
| Earnings consistency | 5% | 5yr EPS growth stability (coefficient of variation) |

### Implementation
- **New engine:** `src/utils/qualityScorecard.ts` (~370 lines)
  - Each factor returns `{score: 0-100, raw, detail, redFlag?}`
  - Weighted aggregate → grade A+/A/B+/B/C/D/F
  - Red flags auto-detected (Z<1.81, D/E>3, ROE<0, promoter decline >3pp)
  - Verdict recommendations based on score
  - `formatScorecardForTelegram()` for bot output
- **New API endpoint:** `GET /api/fundamentals/:symbol?market=IN|US`
  - Server-side proxy to Yahoo Finance `quoteSummary` (no CORS issue)
  - Normalises income statement / balance sheet / cash flow into `FundamentalData`
  - 24h server-side cache
- **New frontend API:** `src/utils/fundamentalsApi.ts` (6h client cache)
- **New component:** `src/components/QualityScorecard.tsx`
  - Score + grade headline cards
  - Red flags banner
  - Per-factor breakdown bars (color-coded by score)
  - Send-to-Telegram button
- **Integrated in:** PortfolioTab (dropdown to pick any holding for scoring)
- **New Telegram command:** `/quality RELIANCE` or `/quality AAPL US`
  - Inline JS port of the scoring logic (bot can't import TS)
  - Full factor breakdown + verdict

### Data caveats
- Yahoo Finance may have incomplete data for some Indian stocks
- Bank detection is heuristic (Z-Score invalid for financials — different capital structure)
- Cross-check with company annual reports before large allocations

---

## Feature 6: Step-Up SIP Optimizer (UPGRADED) 📈

**Purpose:** The existing WhatIfSIPOptimizer compared flat SIP scenarios. Now adds a powerful side-by-side step-up comparison (Flat / +5% / +10% / +15% / +20% per year) proving that step-up SIP can 2-4x the corpus vs flat.

**Why it matters:** India salary growth ~8-12% — flat SIP means lifestyle inflation eats compounding. Step-up SIP scales with salary AND benefits from early-years compounding.

### What's New
- **Step-Up Power Comparison strip** at top of optimizer:
  - 5 columns: Flat / +5% / +10% / +15% / +20%
  - Each shows: future value, multiplier (x), final-year SIP, real value
  - Visual bars + headline "X.Xx vs Flat (Y.Yx) — step-up can Z.Zx your corpus!"
- **Inflation toggle** (Feature 9 hook):
  - Checkbox "Inflation-Adjusted (Real Value)"
  - Custom inflation % input (defaults to India 6%)
  - Each scenario now shows BOTH nominal AND real future value
- **projectSIP() upgraded** to return `{fv, invested, wealthGain, realFv, realMultiplier}`
- **Existing functionality preserved**: regime-tilted scenarios, custom scenarios, ML regime button

### Math
- FV formula with step-up: `FV = Σ SIP × (1+g)^(t-1) × (1+r)^(n-t)`
- Real FV (Fisher discount): `realFV = nominal / (1 + inflation)^years`
- Example: ₹15K SIP × 15yr @ 14% = ₹1.13 Cr (flat) vs ₹2.93 Cr (+10% step-up) = **2.6x**

---

## Feature 7: Tax Optimization Suite 💰

**Purpose:** Scans portfolio + transaction ledger for opportunities to reduce capital-gains tax burden. Covers FY2024-25 India rules (Budget 2024).

**Why it matters:** 15-20yr me tax drag 1-2% annually ho sakta hai without optimization. 12% nominal CAGR → 10% post-tax. This feature makes compounding tax-efficient → effective CAGR 11.5%+ possible.

### Tax Rules Implemented (Budget 2024)
| Asset Class | LTCG (>1yr) | STCG (<1yr) |
|---|---|---|
| Equity (stocks/ETFs) | 12.5% on gains > ₹1.25L/yr | 20% on full gain |
| Debt (held any period) | 12.5% w/o indexation | per slab (30%) |
| Crypto | 30% flat (no LT/ST) | 30% flat + 1% TDS |

### 4 Opportunity Types Detected
1. **harvest_loss** — sell loss-making holdings to offset realized gains (saves tax on offset portion)
2. **harvest_ltcg** — sell+rebuy appreciated equity to use the ₹1.25L LTCG exemption each year (effectively "free" ₹15,625/yr tax saving)
3. **elss_window** — remaining 80C capacity → suggest ELSS (₹1.5L deduction, 3yr lock-in)
4. **withdrawal_order** — retirement guidance: sell debt first, equity last (let equity compound tax-free longer)

### Implementation
- **New engine:** `src/utils/taxOptimizer.ts` (~390 lines)
  - `computeRealizedGains()` — from transaction ledger, per FY
  - `computeUnrealizedGains()` — current price − avg price × qty, per holding
  - `scanTaxOpportunities()` — produces prioritized list with tax saving estimates
  - Loss offset rules: equity↔equity, debt↔debt; crypto losses CANNOT offset non-crypto (post-Budget 2022)
  - `formatTaxSummaryForTelegram()` for bot output
- **New component:** `src/components/TaxOptimizationSuite.tsx`
  - Headline: estimated tax liability (red) + potential saving (green)
  - Realized vs Unrealized gains breakdown (per asset class)
  - ELSS 80C invested-this-year input (with remaining capacity)
  - Opportunities list (color-coded by type, priority badges)
  - Send-to-Telegram button
- **Integrated in:** PlannerTab (after Inflation widget, before FIRE)

### Example opportunities
- "Sell YESBANK (loss ₹45,000) to offset realized gains → saves ₹5,625 tax"
- "Harvest ₹1.25L of LTCG using annual exemption → saves ₹15,625 tax"
- "Invest ₹1.5L in ELSS (80C) → saves ₹45,000 tax at 30% slab"

---

## Feature 9: Inflation-Adjusted Real Returns 💎

**Purpose:** Existing dashboard shows nominal returns. 12% CAGR sounds great but India inflation ~6% → real return = 6%. 20yr me ₹1 Cr nominal = ₹31L real (today's purchasing power).

**Why it matters:** Long-term me inflation sabse bada enemy. User ko "mera ₹5 Cr retirement corpus" ka real value pata hona chahiye — today's ₹1.5L/month expense 2045 me ₹5L/month honge.

### Implementation
- **New engine:** `src/utils/inflationEngine.ts` (~110 lines)
  - `fetchInflationRates()` — pulls India + US CPI from World Bank API (via server proxy), 24h cache
  - `realCagr()` — Fisher equation: `(1+nominal)/(1+inflation) - 1`
  - `realValue()` — discount future value to today's purchasing power
  - `inflateExpense()` — project today's expense N years forward
  - `inflateFireNumber()` — inflation-adjusted FIRE target
  - `inflationDrag()` — purchasing power lost per year on current portfolio
  - `realVsNominalSummary()` — for UI display
- **New server endpoint:** `GET /api/inflation`
  - Proxies World Bank CPI indicator `FP.CPI.TOTL.ZG` for IN + US
  - 24h server cache, falls back to 6%/3% defaults
- **New component:** `src/components/InflationAdjustedReturns.tsx`
  - Headline: Nominal CAGR / Inflation / Real CAGR (3 cards)
  - Future value comparison: nominal vs real (today's purchasing power)
  - Future monthly expense + inflated FIRE target
  - Inflation drag (₹ lost per year on current portfolio)
  - Custom inflation override input
- **Integrated in:** PlannerTab (between Monte Carlo and Tax Suite)
- **Also integrated in:** WhatIfSIPOptimizer (Feature 6 upgrade) — every scenario shows real value line

### Fisher Equation
```
real_return = (1 + nominal) / (1 + inflation) - 1
```
Example: 12% nominal / 6% inflation = 5.66% real (not 6% as commonly mis-stated).

---

## Verification

| Check | Status |
|---|---|
| TypeScript compile (`tsc --noEmit`) | ✅ Clean |
| Unit tests (vitest) | ✅ 41/41 passing |
| Production build (`vite build`) | ✅ 4.51s, no warnings |
| Server syntax (`node --check`) | ✅ All files |
| Bot syntax (`node --check bot.mjs`) | ✅ |
| Python ml-service syntax | ✅ (unchanged in this round) |

## Files Added/Modified

### NEW (8 files)
- `src/utils/monteCarloEngine.ts` (~210 lines)
- `src/utils/qualityScorecard.ts` (~370 lines)
- `src/utils/fundamentalsApi.ts` (~45 lines)
- `src/utils/taxOptimizer.ts` (~390 lines)
- `src/utils/inflationEngine.ts` (~110 lines)
- `src/components/MonteCarloSimulator.tsx` (~250 lines)
- `src/components/QualityScorecard.tsx` (~190 lines)
- `src/components/TaxOptimizationSuite.tsx` (~170 lines)
- `src/components/InflationAdjustedReturns.tsx` (~140 lines)

### MODIFIED (4 files)
- `src/components/WhatIfSIPOptimizer.tsx` — added step-up comparison + inflation toggle (~80 lines added)
- `src/components/tabs/PlannerTab.tsx` — integrated 4 new components (~30 lines added)
- `src/components/tabs/PortfolioTab.tsx` — integrated Quality Scorecard (~30 lines added)
- `server/index.js` — added `/api/fundamentals/:symbol` + `/api/inflation` endpoints (~110 lines added)
- `telegram-bot/bot.mjs` — added `/quality` command (~110 lines added)

## How to Use

### On the Website
1. **Planner tab** → scroll to see 4 new sections in order:
   - What-If SIP Optimizer (now with step-up comparison + inflation toggle)
   - Monte Carlo SIP Simulator (10,000 simulations + histogram + percentile curve)
   - Inflation-Adjusted Real Returns (Fisher equation + inflation drag)
   - Tax Optimization Suite (4 opportunity types)

2. **Portfolio tab** → after Monthly Return Report, dropdown to pick any holding → see Quality Scorecard with 7-factor breakdown

### On Telegram Bot
- `/quality RELIANCE` → full fundamental scorecard with grade + verdict
- `/quality AAPL US` → US stock analysis
- Existing `/taxloss` command still works (this feature adds the website UI equivalent)

## Future Enhancements (not in this round)
- Goal-Based Portfolio Buckets (multiple goals with time-horizon-based allocation)
- Sequence of Returns Risk Analyzer (retirement withdrawal simulator)
- Historical Stress Testing (apply 2008/2020/2022 crises to current portfolio)
- Behavioral Discipline Tracker (SIP consistency + panic/FOMO detection)
- Strategic Rebalancing Engine (drift detection + tax-aware suggestions)

These are documented in the FEATURES_DISCUSSION.md (this file's source).
