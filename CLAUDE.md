# CLAUDE.md

## System Behavior: Strict Token Discipline
- Optimize for minimum token usage.
- Concise, direct, actionable replies.
- No filler, introductions, or summaries.
- Final answer first.
- Minimal explanation for code.

## Project Commands
- Development: `npm run dev`
- Build: `npm run build`
- Preview: `npm run preview`
- Start Bot: `npm run start`
- Install Bot Deps: `npm run postinstall`

## Tech Stack
- Frontend: React 19, Vite, Tailwind CSS 4, TypeScript
- Bot: Node.js (telegram-bot/bot.mjs)
- AI: @google/genai

## Key Project Context

### ALGO Auto-Trading (AngelOne SmartAPI)
- `server/autoTrader.js` — fully automatic entry/exit engine, runs on frontend 30s tick via `/api/trade/auto/tick`
- `server/angelTrade.js` — AngelOne order placement API (placeOrder, cancelOrder, getOrderBook, getTradeBook, getHoldings, getPositions, getRMS)
- `src/components/tabs/AlgoTradeTab.tsx` — ALGO trading UI with Smart Allocation + AUTO mode (START/STOP, config, trade log)
- Entry: LIMIT order (tag: `auto_entry`), Exit target: SELL LIMIT (tag: `auto_tp`), Exit SL: STOPLOSS_LIMIT (tag: `auto_sl`)
- Daily trade limit: default 3 (configurable 1-10), resets daily
- MARKET orders banned for algo from Apr 2026 — using LIMIT/SL-LIMIT only

### SEBI Compliance (as of Jun 2026)
- Static IP mandatory for SmartAPI order endpoints since Apr 1, 2026
- Render has dynamic IP — **pending issue**: test if current orders work, if IP error then fix with QuotaGuard Shield ($29/mo) or VPS ($6-12/mo)
- 9 orders/sec rate limit on SmartAPI
- Delivery (CNC) product only — 100% upfront margin, no short selling
- Token expires daily at 12:00 AM IST, auto-renewed on each tick

### Site Structure
- 7 tabs: Dashboard, Planner, Portfolio, Intraday Pro, ALGO Trade, Neural Chat, Macro
- DeepMind tab removed (replaced by Intraday Pro), DeepScanTab.tsx deleted
- Portfolio keys: `IN_<symbol>` for India, `US_<symbol>` for USA
- Live prices polled every 3s during market hours
- India market hours: 9:15 AM - 3:30 PM IST (`isIndiaMarketOpen()`)

### Pending Work
- Static IP fix: test current orders → if fails, implement QuotaGuard proxy + register IP with AngelOne
