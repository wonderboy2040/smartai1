# 🚀 Advance Pro Intelligence v18.0

**Multi-Engine AI Portfolio Dashboard + Telegram Trading Bot**

AI-powered portfolio analytics for Indian and US markets, crypto tracking, risk analytics, ML signals, 7-engine AI chat with smart failover, cloud sync, broker connectors, and a full Telegram automation suite (53 commands).

> **Financial disclaimer:** Signals, projections, and AI/ML output are informational only. They are not investment advice. Verify market data before trading.

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
