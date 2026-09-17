// ============================================================
// server/mcp/agents/finnhubAgent.js — v11.0 PHASE 1
// ------------------------------------------------------------
// Finnhub — wrap of the repo's OWN shared finnhubQuote.js (the
// v10.11 shared module with its micro-cache + sliding-window budget
// that BOTH desks already ride). ZERO duplicate upstream calls: the
// wrap re-exports the same function through the agent-card contract.
// Capabilities:
//   stocks.usquote   shared Finnhub REST quote (stale-gated)
// ============================================================
import { registerAgent } from './registry.js';
import { fetchFinnhubQuote } from '../../ai/finnhubQuote.js';

registerAgent({
  id: 'finnhub',
  name: 'Finnhub US Quotes (shared)',
  kind: 'wrap',
  envKey: 'FINNHUB_API_KEY',
  authRequired: true,
  priority: 35,
  budget: { perDay: 0, perMinute: 55 }, // mirrors the shared module's own 55/min guard
  note: 'US/global quotes through the repo-shared Finnhub module (one key, one budget, stale-gated)',
  caps: {
    'stocks.usquote': {
      tier: 'hot', cost: 1,
      fn: async ({ symbols }) => {
        const syms = (symbols || []).map(s => String(s || '').toUpperCase()).filter(Boolean);
        if (syms.length === 0) return null;
        const out = {};
        for (const sym of syms.slice(0, 5)) {
          const q = await fetchFinnhubQuote(sym);
          if (q) out[sym] = q;
        }
        if (Object.keys(out).length === 0) return null;
        return { quotes: out, source: 'finnhub' };
      },
    },
  },
});

export default 'finnhub';
