// ============================================================
// test/indmoneyMcp.test.ts — INDMoney MCP connector test suite
// Covers: PKCE correctness, SSE/JSON-RPC parsing, authorize URL,
// tool detection, schema-agnostic portfolio normalization,
// tool payload extraction, and the mocked end-to-end OAuth + MCP
// flow (register → authorize → token → initialize → tools/call).
// ============================================================
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const STORE_PATH = path.join(__dirname, '..', 'server', 'data', 'mcp-indmoney.json');

const {
  pkceGenerate, pkceChallengeFrom, buildAuthorizeUrl, detectPortfolioTool,
  normalizePortfolio, collectHoldings, extractToolPayload, parseSSEOrJSON,
  startConnect, completeConnect, getStatus, disconnect, listTools,
  fetchPortfolio, __resetForTests, IndmError, INDM,
} = await import('../server/mcp/indmoney.js');

// ---------------- helpers ----------------
function sseBody(frames) {
  return frames.map(f => `event: message\ndata: ${JSON.stringify(f)}\n\n`).join('');
}
function jsonRes(json, init = {}) {
  return {
    ok: (init.status ?? 200) >= 200 && (init.status ?? 200) < 300,
    status: init.status ?? 200,
    headers: new Map(Object.entries(init.headers || {})),
    text: async () => (typeof json === 'string' ? json : JSON.stringify(json)),
  };
}
function textBody(text, status = 200) {
  return { ok: status >= 200 && status < 300, status, headers: new Map(), text: async () => text };
}

// ---------------- PKCE ----------------
describe('PKCE (RFC 7636 S256)', () => {
  it('generates a valid verifier (43-128 chars, base64url charset)', () => {
    const { verifier, challenge } = pkceGenerate();
    expect(verifier.length).toBeGreaterThanOrEqual(43);
    expect(verifier.length).toBeLessThanOrEqual(128);
    expect(verifier).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(challenge).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(challenge).not.toBe(verifier);
  });

  it('challenge = BASE64URL(SHA256(verifier)) — matches independent node crypto', () => {
    const verifier = 'dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjsg';
    const expected = crypto.createHash('sha256').update(verifier).digest('base64url');
    expect(pkceChallengeFrom(verifier)).toBe(expected);
    // 43-char base64url output (SHA256 digest) — per RFC 7636 §4.2
    expect(pkceChallengeFrom(verifier)).toMatch(/^[A-Za-z0-9_-]{43}$/);
  });

  it('different verifiers → different challenges', () => {
    const a = pkceGenerate();
    const b = pkceGenerate();
    expect(a.challenge).not.toBe(b.challenge);
  });
});

// ---------------- MCP response parsing ----------------
describe('parseSSEOrJSON', () => {
  it('parses plain JSON objects', () => {
    const out = parseSSEOrJSON('{"jsonrpc":"2.0","id":1,"result":{"ok":true}}');
    expect(out).toHaveLength(1);
    expect(out[0].result.ok).toBe(true);
  });

  it('parses SSE frames and picks JSON-RPC messages', () => {
    const body = sseBody([
      { jsonrpc: '2.0', id: 7, result: { tools: [] } },
      { jsonrpc: '2.0', method: 'notifications/roots' },
    ]);
    const out = parseSSEOrJSON(body);
    expect(out).toHaveLength(2);
    expect(out.find(m => m.id === 7).result).toEqual({ tools: [] });
  });

  it('ignores [DONE] frames and empty payloads', () => {
    const body = 'data: [DONE]\n\ndata: {"jsonrpc":"2.0","id":3,"result":1}\n\n';
    const out = parseSSEOrJSON(body);
    expect(out).toHaveLength(1);
  });

  it('returns [] for garbage', () => {
    expect(parseSSEOrJSON('')).toEqual([]);
    expect(parseSSEOrJSON('not json at all')).toEqual([]);
  });
});

// ---------------- authorize URL ----------------
describe('buildAuthorizeUrl', () => {
  it('contains all required OAuth + PKCE params', () => {
    const url = buildAuthorizeUrl({
      clientId: 'cid-123',
      redirectUri: 'https://app.example.com/api/mcp/indmoney/callback',
      state: 'st4te',
      codeChallenge: 'ch-abc',
      scope: 'portfolio:read',
    });
    const u = new URL(url);
    expect(u.origin + u.pathname).toBe('https://mcp.indmoney.com/authorize');
    expect(u.searchParams.get('client_id')).toBe('cid-123');
    expect(u.searchParams.get('redirect_uri')).toBe('https://app.example.com/api/mcp/indmoney/callback');
    expect(u.searchParams.get('response_type')).toBe('code');
    expect(u.searchParams.get('scope')).toBe('portfolio:read');
    expect(u.searchParams.get('state')).toBe('st4te');
    expect(u.searchParams.get('code_challenge')).toBe('ch-abc');
    expect(u.searchParams.get('code_challenge_method')).toBe('S256');
  });

  it('defaults scope when omitted', () => {
    const url = buildAuthorizeUrl({ clientId: 'x', redirectUri: 'https://a/cb', state: 's', codeChallenge: 'c' });
    expect(new URL(url).searchParams.get('scope')).toBe(INDM.SCOPES);
  });
});

// ---------------- portfolio tool detection ----------------
describe('detectPortfolioTool', () => {
  it('prefers portfolio/holdings tools over market/price tools', () => {
    const tools = [
      { name: 'get_stock_price', description: 'Get live stock price' },
      { name: 'get_portfolio', description: 'User portfolio holdings' },
      { name: 'market_news', description: 'Latest market news' },
    ];
    expect(detectPortfolioTool(tools)?.name).toBe('get_portfolio');
  });

  it('returns null when nothing looks like a portfolio tool', () => {
    const tools = [
      { name: 'get_price', description: 'price' },
      { name: 'get_news', description: 'news' },
    ];
    expect(detectPortfolioTool(tools)).toBeNull();
    expect(detectPortfolioTool([])).toBeNull();
    expect(detectPortfolioTool(null)).toBeNull();
  });
});

// ---------------- normalization ----------------
describe('normalizePortfolio / collectHoldings', () => {
  it('normalizes a nested INDMoney-style payload (stocks + MFs)', () => {
    const payload = {
      data: {
        stocks: [
          { stockName: 'Reliance Industries', symbol: 'RELIANCE', assetType: 'EQUITY', quantity: 10, avgPrice: 2400, currentPrice: 2900 },
          { stockName: 'TCS', symbol: 'TCS', assetType: 'EQUITY', quantity: 5, avgPrice: 3500, currentPrice: 3900 },
        ],
        mutualFunds: [
          { scheme_name: 'Parag Parikh Flexi Cap', assetType: 'MF', units: 120.5, nav: 78.4, investedAmount: 8500 },
        ],
      },
    };
    const out = normalizePortfolio(payload);
    expect(out.ok).toBe(true);
    expect(out.holdings).toHaveLength(3);

    const reli = out.holdings.find(h => h.name === 'Reliance Industries');
    expect(reli.qty).toBe(10);
    expect(reli.invested).toBe(24000);
    expect(reli.value).toBe(29000);
    expect(reli.pnl).toBe(5000);
    expect(reli.pnlPct).toBeCloseTo(20.83, 1);
    expect(reli.assetType).toBe('Stock');

    const ppfc = out.holdings.find(h => h.name === 'Parag Parikh Flexi Cap');
    expect(ppfc.assetType).toBe('Mutual Fund');
    expect(ppfc.value).toBeCloseTo(9447.2, 0);

    expect(out.summary.holdingCount).toBe(3);
    expect(out.summary.totalInvested).toBe(50000);
    expect(out.summary.totalValue).toBeCloseTo(57947.2, 0);
    expect(out.summary.totalPnl).toBeCloseTo(7947.2, 0);
  });

  it('uses explicit pnl fields when value/invested are absent', () => {
    const payload = { holdings: [{ name: 'Infosys', qty: 8, pnl: 1200, pnlPct: 12.5 }] };
    const out = normalizePortfolio(payload);
    const infy = out.holdings[0];
    expect(infy.pnl).toBe(1200);
    // summary math: value 0 + invested 0 → pnl falls back to raw
    expect(out.summary).not.toBeNull();
  });

  it('dedups repeated holdings (summary + detail sections)', () => {
    const h = { name: 'HDFC Bank', qty: 20, avgPrice: 1500, currentPrice: 1600 };
    const out = normalizePortfolio({ summary: { holdings: [h] }, detail: { holdings: [h] } });
    expect(out.holdings).toHaveLength(1);
  });

  it('classifies FD/gold/ETF asset types', () => {
    const out = collectHoldings([
      { name: 'SBI Fixed Deposit', qty: 1, invested: 100000, currentValue: 107500 },
      { name: 'Nippon ETF Nifty BeES', symbol: 'NIFTYBEES', qty: 100, avgPrice: 200, currentPrice: 210 },
      { name: 'Sovereign Gold Bond', qty: 5, invested: 25000, currentValue: 31000 },
    ]);
    const types = out.map(h => h.assetType);
    expect(types).toContain('Fixed Income / Gold');
    expect(types).toContain('ETF');
  });

  it('handles string ₹ amounts with commas', () => {
    const out = collectHoldings([{ name: 'Wipro', qty: '25', avgPrice: '₹400', currentPrice: '500.50' }]);
    expect(out[0].qty).toBe(25);
    expect(out[0].avgPrice).toBe(400);
    expect(out[0].currentPrice).toBeCloseTo(500.5, 2);
  });

  it('flags unknown/empty payloads gracefully', () => {
    expect(normalizePortfolio(null).ok).toBe(false);
    expect(normalizePortfolio('some text').reason).toBe('text-only');
    expect(normalizePortfolio({ foo: 'bar' }).ok).toBe(false);
    expect(normalizePortfolio({ foo: 'bar' }).reason).toBe('no-holdings-found');
  });

  it('walks reasonably-nested trees; depth guard stops pathological nesting', () => {
    // 5 levels deep — inside the guard, must be found.
    let node = { name: 'Deep Co', qty: 1 };
    for (let i = 0; i < 5; i++) node = { nested: node };
    const found = collectHoldings(node);
    expect(found).toHaveLength(1);
    expect(found[0].name).toBe('Deep Co');
    // 12 levels deep — beyond the depth guard, ignored (no crash).
    let deep = { name: 'Too Deep Co', qty: 1 };
    for (let i = 0; i < 12; i++) deep = { nested: deep };
    expect(collectHoldings(deep)).toHaveLength(0);
  });
});

// ---------------- tool payload extraction ----------------
describe('extractToolPayload', () => {
  it('parses JSON text content', () => {
    const result = { content: [{ type: 'text', text: '{"data":{"stocks":[]}}' }] };
    expect(extractToolPayload(result)).toEqual({ data: { stocks: [] } });
  });
  it('returns plain text as-is', () => {
    const result = { content: [{ type: 'text', text: 'Portfolio: ₹12,34,567' }] };
    expect(extractToolPayload(result)).toBe('Portfolio: ₹12,34,567');
  });
  it('uses structuredContent when present', () => {
    const result = { structuredContent: { total: 5 }, content: [] };
    expect(extractToolPayload(result)).toEqual({ total: 5 });
  });
  it('passes through when nothing else matches', () => {
    expect(extractToolPayload({ weird: true })).toEqual({ weird: true });
    expect(extractToolPayload(null)).toBeNull();
  });
});

// ---------------- end-to-end (mocked network) ----------------
describe('OAuth + MCP flow (mocked fetch)', () => {
  const ORIGIN = 'https://smartai.example.com';
  let calls; // record of { url, body }

  beforeEach(() => {
    __resetForTests();
    calls = [];
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    // never leave token state on disk after tests
    try { fs.rmSync(STORE_PATH, { force: true }); } catch { /* ignore */ }
  });

  function stubFetch(handler) {
    vi.stubGlobal('fetch', async (url, init = {}) => {
      const body = init.body ? JSON.parse(init.body) : null;
      calls.push({ url: String(url), body, headers: init.headers || {} });
      if (process.env.DEBUG_INDM) console.log('[stub]', String(url), body?.method, 'calls=', calls.length);
      return handler(String(url), body, init);
    });
  }

  it('register → authorize URL → token exchange → connected status', async () => {
    stubFetch((url, body) => {
      if (url === INDM.REGISTER_URL) return jsonRes({ client_id: 'client-e2e-1' });
      if (url === INDM.TOKEN_URL) {
        expect(body.grant_type).toBe('authorization_code');
        expect(body.code).toBe('auth-code-xyz');
        expect(body.code_verifier).toBeTruthy();
        return jsonRes({ access_token: 'AT-1', refresh_token: 'RT-1', expires_in: 3600, scope: 'portfolio:read' });
      }
      throw new Error(`unexpected url ${url}`);
    });

    const { authorizeUrl, state } = await startConnect(ORIGIN);
    const u = new URL(authorizeUrl);
    expect(u.searchParams.get('client_id')).toBe('client-e2e-1');
    expect(u.searchParams.get('redirect_uri')).toBe(`${ORIGIN}/api/mcp/indmoney/callback`);
    expect(u.searchParams.get('code_challenge')).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(u.searchParams.get('state')).toBe(state);

    // second startConnect reuses the registered client (no re-register)
    await startConnect(ORIGIN);
    const registerCalls = calls.filter(c => c.url === INDM.REGISTER_URL);
    expect(registerCalls).toHaveLength(1);

    const done = await completeConnect({ code: 'auth-code-xyz', state });
    expect(done.ok).toBe(true);
    const st = getStatus();
    expect(st.connected).toBe(true);
    expect(st.hasRefreshToken).toBe(true);
    expect(st.registeredOrigins).toContain(ORIGIN);

    // replaying the same state must fail (single-use)
    await expect(completeConnect({ code: 'x', state })).rejects.toMatchObject({ code: 'BAD_STATE' });
  });

  it('initialize (SSE + session id) → tools/list → tools/call → normalized portfolio', async () => {
    // 1) OAuth exchange first
    stubFetch((url, body) => {
      if (url === INDM.REGISTER_URL) return jsonRes({ client_id: 'client-e2e-2' });
      if (url === INDM.TOKEN_URL) return jsonRes({ access_token: 'AT-2', refresh_token: 'RT-2', expires_in: 3600 });
      if (url === INDM.MCP_URL) {
        if (body.method === 'initialize') {
          return jsonRes(
            { jsonrpc: '2.0', id: body.id, result: { protocolVersion: '2025-06-18', serverInfo: { name: 'indmoney', version: '1' } } },
            { headers: { 'mcp-session-id': 'sess-abc-123' } }
          );
        }
        if (body.method === 'notifications/initialized') return jsonRes('', { status: 202 });
        if (body.method === 'tools/list') {
          return new Response(sseBody([{ jsonrpc: '2.0', id: body.id, result: { tools: [
            { name: 'get_portfolio', description: 'User portfolio holdings and P&L' },
            { name: 'get_price', description: 'live price' },
          ] } }]), { headers: { 'content-type': 'text/event-stream' } });
        }
        if (body.method === 'tools/call') {
          expect(body.params.name).toBe('get_portfolio');
          return jsonRes({ jsonrpc: '2.0', id: body.id, result: { content: [{ type: 'text', text: JSON.stringify({
            data: { stocks: [{ stockName: 'IRFC', quantity: 100, avgPrice: 100, currentPrice: 150 }] },
          }) }] } });
        }
        throw new Error(`unexpected MCP method ${body.method}`);
      }
      throw new Error(`unexpected url ${url}`);
    });

    const { state } = await startConnect(ORIGIN);
    await completeConnect({ code: 'c1', state });

    const { tools } = await listTools({ force: true });
    expect(tools.map(t => t.name)).toEqual(['get_portfolio', 'get_price']);

    const pf = await fetchPortfolio({ force: true });
    expect(pf.ok).toBe(true);
    expect(pf.tool).toBe('get_portfolio');
    expect(pf.holdings[0].name).toBe('IRFC');
    expect(pf.holdings[0].pnl).toBe(5000);
    expect(pf.summary.totalValue).toBe(15000);
    expect(pf.summary.totalInvested).toBe(10000);
    // cached second read
    const pf2 = await fetchPortfolio({ force: false });
    expect(pf2.cached).toBe(true);

    // session id + bearer must be echoed on the tools/call request
    const mcpCalls = calls.filter(c => c.url === INDM.MCP_URL && c.body.method === 'tools/call');
    expect(mcpCalls).toHaveLength(1);
    expect(mcpCalls[0].headers['Mcp-Session-Id']).toBe('sess-abc-123');
    expect(mcpCalls[0].headers['Authorization']).toBe('Bearer AT-2');

    const st = getStatus();
    expect(st.connected).toBe(true);
    expect(st.toolCount).toBe(2);
    expect(st.lastSyncAt).toBeGreaterThan(0);

    await disconnect();
    expect(getStatus().connected).toBe(false);
  });

  it('401 mid-session triggers one refresh + retry, then succeeds', async () => {
    let mcp401Once = false;
    let tokenCalls = 0;
    stubFetch((url, body) => {
      if (url === INDM.REGISTER_URL) return jsonRes({ client_id: 'client-e2e-3' });
      if (url === INDM.TOKEN_URL) {
        tokenCalls += 1;
        if (body.grant_type === 'authorization_code') return jsonRes({ access_token: 'AT-A', refresh_token: 'RT-A', expires_in: 3600 });
        return jsonRes({ access_token: 'AT-B', refresh_token: 'RT-A', expires_in: 3600 });
      }
      if (url === INDM.MCP_URL) {
        if (body.method === 'initialize') return jsonRes({ jsonrpc: '2.0', id: body.id, result: { serverInfo: { name: 'x' } } }, { headers: { 'mcp-session-id': 's1' } });
        if (body.method === 'notifications/initialized') return jsonRes('', { status: 202 });
        if (body.method === 'tools/list') {
          if (!mcp401Once) { mcp401Once = true; return jsonRes({ error: 'invalid_token' }, { status: 401 }); }
          return jsonRes({ jsonrpc: '2.0', id: body.id, result: { tools: [{ name: 'get_portfolio', description: 'portfolio' }] } });
        }
        throw new Error(`unexpected ${body.method}`);
      }
      throw new Error(`unexpected url ${url}`);
    });

    const { state } = await startConnect(ORIGIN);
    await completeConnect({ code: 'c', state });
    const { tools } = await listTools({ force: true });
    expect(tools[0].name).toBe('get_portfolio');
    expect(tokenCalls).toBe(2); // initial + refresh
    // retry used the refreshed bearer
    const retryCall = calls.find(c => c.url === INDM.MCP_URL && c.body.method === 'tools/list' && c.headers['Authorization'] === 'Bearer AT-B');
    expect(retryCall).toBeTruthy();
  });

  it('failed refresh revokes the connection (REFRESH_FAILED → NOT_CONNECTED)', async () => {
    stubFetch((url, body) => {
      if (url === INDM.REGISTER_URL) return jsonRes({ client_id: 'client-e2e-4' });
      if (url === INDM.TOKEN_URL) {
        if (body.grant_type === 'authorization_code') return jsonRes({ access_token: 'AT-C', refresh_token: 'RT-C', expires_in: 3600 });
        return jsonRes({ error: 'invalid_grant' }, { status: 400 });
      }
      if (url === INDM.REVOKE_URL) return jsonRes({});
      if (url === INDM.MCP_URL) {
        if (body.method === 'initialize') return jsonRes({ jsonrpc: '2.0', id: body.id, result: {} }, { headers: { 'mcp-session-id': 's' } });
        if (body.method === 'notifications/initialized') return jsonRes('', { status: 202 });
        if (body.method === 'tools/list') return jsonRes({ error: 'invalid_token' }, { status: 401 });
      }
      throw new Error(`unexpected url ${url}`);
    });

    const { state } = await startConnect(ORIGIN);
    await completeConnect({ code: 'c', state });
    // 401 on tools/list → refresh fails (invalid_grant) → connection revoked.
    await expect(listTools({ force: true })).rejects.toMatchObject({ code: 'REFRESH_FAILED' });
    expect(getStatus().connected).toBe(false);
  });

  it('IndmError carries status + code for route mapping', () => {
    const e = new IndmError('boom', 401, 'TEST');
    expect(e.status).toBe(401);
    expect(e.code).toBe('TEST');
    expect(e instanceof Error).toBe(true);
  });
});
