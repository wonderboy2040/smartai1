// ============================================================
// server/mcp/agents/coinapi.js — v11.0 PHASE 1
// ------------------------------------------------------------
// CoinAPI — tick-level crypto trade data (REST). Fallback role in
// the mesh (priority last for crypto quotes; primary for nothing —
// the 100/day free tier is precious). Same agent-card contract.
// Capabilities:
//   crypto.tick      latest trade ticks (fallback role)
// ============================================================
import { registerAgent, fetchJSON } from './registry.js';

const BASE = 'https://rest.coinapi.io/v1';
const key = () => String(process.env.COINAPI_API_KEY || '').trim();

function normSymbol(s) {
  const t = String(s || '').toUpperCase();
  if (t.endsWith('INR')) return `${t.slice(0, -3)}/INR`;
  return t.endsWith('USDT') ? `${t.slice(0, -4)}/USDT` : t;
}

registerAgent({
  id: 'coinapi',
  name: 'CoinAPI Tick Data',
  kind: 'rest',
  envKey: 'COINAPI_API_KEY',
  authRequired: true,
  priority: 60, // explicit fallback role — everyone else first
  budget: { perDay: 60, perMinute: 5 },
  note: 'Tick-level crypto trades — fallback source (100/day free tier, budget 60)',
  caps: {
    'crypto.tick': {
      tier: 'hot', cost: 1,
      fn: async ({ symbols }) => {
        const s = normSymbol(Array.isArray(symbols) ? symbols[0] : symbols);
        if (!s || s === '/') return null;
        const j = await fetchJSON(`${BASE}/trades/${encodeURIComponent(s)}?limit=10`, { headers: { 'X-CoinAPI-Key': key() } });
        if (!Array.isArray(j) || j.length === 0) return null;
        return {
          symbol: s,
          trades: j.slice(0, 10).map(t => ({
            price: Number(t.price), qty: Number(t.size),
            ts: t.time || null,
          })),
          lastPrice: Number(j[j.length - 1]?.price) || null,
          source: 'coinapi',
        };
      },
    },
  },
});

export default 'coinapi';
