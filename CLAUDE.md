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

### Site Structure
- 5 tabs: Dashboard, Planner, Portfolio, Risk (Macro), Guide
- Neural Chat is a floating chat widget (not a tab)
- Portfolio keys: `IN_<symbol>` for India, `US_<symbol>` for USA
- Live prices polled every 3s during market hours
- India market hours: 9:15 AM - 3:30 PM IST (`isIndiaMarketOpen()`)

## Approach
- Read existing files before writing. Don't re-read unless changed.
- Thorough in reasoning, concise in output.
- Skip files over 100KB unless required.
- No sycophantic openers or closing fluff.
- No emojis or em-dashes.
- Do not guess APIs, versions, flags, commit SHAs, or package names. Verify by reading code or docs before asserting.
