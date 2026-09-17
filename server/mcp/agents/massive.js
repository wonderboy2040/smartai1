// ============================================================
// server/mcp/agents/massive.js — v11.0 PHASE 1
// ------------------------------------------------------------
// Massive — market + fundamental + alt data with built-in quant
// helpers (BS Greeks, Sharpe/Sortino, MAs). REST adapter on the same
// agent-card contract; complements our own blackScholes.js without
// duplicating it (the mesh treats it as an INDEPENDENT second
// opinion — cross-validation, not replacement).
// Capabilities:
//   fundamentals.profile    company profile + key stats
//   quant.greeks            Black-Scholes Greeks (independent check)
// ============================================================
import { registerAgent, fetchJSON } from './registry.js';

const BASE = 'https://api.massive.dev/v1';
const key = () => String(process.env.MASSIVE_API_KEY || '').trim();

const normSym = (s) => String(s || '').toUpperCase();

registerAgent({
  id: 'massive',
  name: 'Massive Market Data MCP',
  kind: 'rest',
  envKey: 'MASSIVE_API_KEY',
  authRequired: true,
  priority: 46,
  budget: { perDay: 30, perMinute: 5 },
  note: 'Fundamentals + independent BS-Greeks/Sharpe quant checks (free tier)',
  caps: {
    'fundamentals.profile': {
      tier: 'cold', cost: 1,
      fn: async ({ symbols }) => {
        const sym = normSym(Array.isArray(symbols) ? symbols[0] : symbols);
        if (!sym) return null;
        // v11.0.1: encode the PATH segment — raw '/'-bearing tickers
        // (BRK/A style) used to traverse to other endpoints
        const j = await fetchJSON(`${BASE}/company/${encodeURIComponent(sym)}`, { headers: { 'X-API-Key': key() } });
        if (!j || (!j.symbol && !j.ticker)) return null;
        return {
          symbol: j.symbol || j.ticker || sym,
          name: j.name || null,
          sector: j.sector || null,
          marketCap: Number(j.marketCap) || null,
          peRatio: Number(j.peRatio) || null,
          dividendYield: Number(j.dividendYield) || null,
          beta: Number(j.beta) || null,
          source: 'massive',
        };
      },
    },
    'quant.greeks': {
      tier: 'warm', cost: 1,
      fn: async ({ spot, strike, rate, vol, expiryDays, kind = 'call' }) => {
        const S = Number(spot), K = Number(strike), r = Number(rate), v = Number(vol), T = Number(expiryDays) / 365;
        if (![S, K, r, v, T].every(Number.isFinite) || S <= 0 || K <= 0 || v <= 0 || T <= 0) return null;
        // v11.0.1: whitelist `kind` — it used to flow into the URL raw
        const k = kind === 'put' ? 'put' : 'call';
        const j = await fetchJSON(`${BASE}/quant/greeks?spot=${S}&strike=${K}&rate=${r}&vol=${v}&expiry=${T}&kind=${k}`, { headers: { 'X-API-Key': key() } });
        if (!j || j.delta == null) return null;
        // v11.0.1: NaN guard — a non-numeric delta used to leak NaN
        const delta = Number(j.delta);
        if (!Number.isFinite(delta)) return null;
        return {
          delta, gamma: Number(j.gamma) || null,
          theta: Number(j.theta) || null, vega: Number(j.vega) || null,
          source: 'massive',
        };
      },
    },
  },
});

export default 'massive';
