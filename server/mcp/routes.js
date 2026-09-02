// ============================================================
// server/mcp/routes.js — Express routes for the INDMoney MCP
// portfolio integration. All routes sit behind the global
// requireAuth middleware (Bearer token / session cookie).
//
//   GET  /api/mcp/indmoney/status      → connection status
//   GET  /api/mcp/indmoney/connect     → 302 → INDMoney OAuth (PKCE)
//   GET  /api/mcp/indmoney/callback    → OAuth redirect target
//   POST /api/mcp/indmoney/disconnect  → revoke + forget tokens
//   GET  /api/mcp/indmoney/tools       → list MCP tools
//   GET  /api/mcp/indmoney/portfolio   → normalized portfolio
//   POST /api/mcp/indmoney/portfolio   → force re-sync (bypass cache)
//   POST /api/mcp/indmoney/call        → generic MCP tool call (debug)
// ============================================================
import { Router } from 'express';
import {
  startConnect, completeConnect, disconnect, getStatus,
  listTools, callTool, fetchPortfolio, extractToolPayload,
  getPendingOrigin, IndmError,
} from './indmoney.js';

const router = Router();

// --- tiny in-memory rate limit for outbound MCP calls (60/min) ---
const RL_WINDOW = 60_000;
const RL_MAX = 60;
const _hits = new Map();
function rateLimited(key) {
  const now = Date.now();
  const rec = _hits.get(key);
  if (!rec || now - rec.start > RL_WINDOW) { _hits.set(key, { start: now, n: 1 }); return false; }
  rec.n += 1;
  return rec.n > RL_MAX;
}
// GC occasionally so the map never grows unbounded.
if (typeof setInterval === 'function') {
  const t = setInterval(() => {
    const now = Date.now();
    for (const [k, v] of _hits) if (now - v.start > RL_WINDOW * 2) _hits.delete(k);
  }, 5 * 60_000);
  t.unref?.();
}

// Uniform error mapping → JSON shape used across this codebase.
function fail(res, err) {
  if (err instanceof IndmError) {
    return res.status(err.status).json({ error: { message: err.message, code: err.code } });
  }
  console.error('[mcp/indmoney] Unexpected error:', err?.message || err);
  return res.status(500).json({ error: { message: 'INDMoney MCP internal error', code: 'INTERNAL' } });
}

// Derive the public origin of THIS deployment (Render proxy aware).
function requestOrigin(req) {
  const proto = (req.headers['x-forwarded-proto'] || req.protocol || 'https').toString().split(',')[0].trim();
  const host = (req.headers['x-forwarded-host'] || req.headers.host || '').toString().split(',')[0].trim();
  if (!host) return null;
  return `${proto}://${host}`;
}

// ------------------------------------------------------------
// GET /status — is INDMoney connected?
// ------------------------------------------------------------
router.get('/api/mcp/indmoney/status', (_req, res) => {
  try {
    res.json({ ok: true, ...getStatus() });
  } catch (err) { return fail(res, err); }
});

// ------------------------------------------------------------
// GET /connect — full-page redirect that starts the OAuth flow.
// ------------------------------------------------------------
router.get('/api/mcp/indmoney/connect', async (req, res) => {
  try {
    const origin = requestOrigin(req);
    if (!origin) throw new IndmError('Could not determine site origin', 400, 'NO_ORIGIN');
    const { authorizeUrl } = await startConnect(origin);
    return res.redirect(302, authorizeUrl);
  } catch (err) { return fail(res, err); }
});

// ------------------------------------------------------------
// GET /callback — INDMoney redirects the browser back here.
// Auth: the user's session cookie rides along on this top-level
// navigation (SameSite=None/Lax both allow it), so requireAuth
// has already validated them before we reach this handler.
// ------------------------------------------------------------
router.get('/api/mcp/indmoney/callback', async (req, res) => {
  const { code, state, error, error_description: errDesc } = req.query;
  let origin = requestOrigin(req);

  try {
    // Prefer the origin captured when /connect was hit (robust to proxy
    // header quirks on the callback leg).
    const saved = typeof state === 'string' ? getPendingOrigin(state) : null;
    if (saved) origin = saved;
    if (!origin) throw new IndmError('Missing site origin for redirect', 400, 'NO_ORIGIN');

    await completeConnect({ code, state, error, errorDescription: errDesc });
    return res.redirect(302, `${origin}/?tab=portfolio&indm=ok`);
  } catch (err) {
    const reason = encodeURIComponent(String(err?.message || err?.code || 'unknown_error'));
    const base = origin || '';
    return res.redirect(302, `${base}/?tab=portfolio&indm=error&reason=${reason}`);
  }
});

// ------------------------------------------------------------
// POST /disconnect — revoke tokens + clear stored state.
// ------------------------------------------------------------
router.post('/api/mcp/indmoney/disconnect', async (_req, res) => {
  try {
    const out = await disconnect();
    return res.json(out);
  } catch (err) { return fail(res, err); }
});

// ------------------------------------------------------------
// GET /tools — list tools exposed by the INDMoney MCP server.
// ------------------------------------------------------------
router.get('/api/mcp/indmoney/tools', async (req, res) => {
  try {
    if (rateLimited('tools')) throw new IndmError('Too many requests — try again shortly', 429, 'RATE_LIMITED');
    const force = req.query.force === '1' || req.query.force === 'true';
    const { tools, cached } = await listTools({ force });
    return res.json({
      ok: true, cached,
      tools: (tools || []).map(t => ({
        name: t.name,
        description: t.description || null,
        inputSchema: t.inputSchema ? { type: t.inputSchema.type, properties: Object.keys(t.inputSchema.properties || {}) } : null,
      })),
    });
  } catch (err) { return fail(res, err); }
});

// ------------------------------------------------------------
// GET/POST /portfolio — normalized INDMoney portfolio.
// POST (or ?force=1) bypasses the 60s cache.
// ------------------------------------------------------------
router.get('/api/mcp/indmoney/portfolio', handlePortfolio);
router.post('/api/mcp/indmoney/portfolio', handlePortfolio);
async function handlePortfolio(req, res) {
  try {
    if (rateLimited('portfolio')) throw new IndmError('Too many requests — try again shortly', 429, 'RATE_LIMITED');
    const force = req.method === 'POST' || req.query.force === '1' || req.query.force === 'true';
    const data = await fetchPortfolio({ force });
    return res.json({ ok: true, ...data });
  } catch (err) { return fail(res, err); }
}

// ------------------------------------------------------------
// POST /call — generic MCP tool invocation (debug/power use).
// Body: { tool: string, args?: object }
// ------------------------------------------------------------
router.post('/api/mcp/indmoney/call', async (req, res) => {
  try {
    if (rateLimited('call')) throw new IndmError('Too many requests — try again shortly', 429, 'RATE_LIMITED');
    const { tool, args } = req.body || {};
    if (!tool || typeof tool !== 'string') {
      throw new IndmError('`tool` (string) is required', 400, 'BAD_REQUEST');
    }
    const safeArgs = (args && typeof args === 'object' && !Array.isArray(args)) ? args : {};
    const result = await callTool(tool, safeArgs);
    return res.json({ ok: true, tool, payload: extractToolPayload(result) ?? result });
  } catch (err) { return fail(res, err); }
});

export default router;
