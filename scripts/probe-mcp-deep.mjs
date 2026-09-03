#!/usr/bin/env node
/**
 * Deep probe: CoinLobster (stateless) + Bitget datahub (stateful) MCP servers.
 * Goals: full tools/list + one REAL tool call per server.
 */

function extractJson(text) {
  // Response may be SSE ("event: message data: {...}") possibly on one line.
  const idx = text.indexOf('data:');
  const raw = idx >= 0 ? text.slice(idx + 5).trim() : text.trim();
  try { return JSON.parse(raw); } catch {}
  // try line-by-line data: frames
  for (const line of text.split(/\r?\n/)) {
    if (line.startsWith('data:')) {
      try { return JSON.parse(line.slice(5).trim()); } catch {}
    }
  }
  return null;
}

const INIT = {
  jsonrpc: '2.0', id: 1, method: 'initialize',
  params: {
    protocolVersion: '2024-11-05',
    capabilities: {},
    clientInfo: { name: 'smartai-probe', version: '1.0.0' },
  },
};

const H = {
  'Content-Type': 'application/json',
  'Accept': 'application/json, text/event-stream',
};

async function post(url, body, extra = {}, timeoutMs = 15000) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { ...H, ...extra },
    body: typeof body === 'string' ? body : JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs),
  });
  const text = await res.text();
  return { status: res.status, sid: res.headers.get('mcp-session-id'), text };
}

// ---------- 1. CoinLobster (stateless, no session id) ----------
async function probeCoinLobster() {
  const out = { server: 'CoinLobster', url: 'https://coinlobster.com/mcp' };
  try {
    const init = await post(out.url, INIT);
    out.initStatus = init.status;
    // stateless: tools/list directly (initialize each request or none)
    const tl = await post(out.url, { jsonrpc: '2.0', id: 2, method: 'tools/list' });
    const j = extractJson(tl.text);
    if (j && j.result && Array.isArray(j.result.tools)) {
      out.toolsCount = j.result.tools.length;
      out.tools = j.result.tools.map(t => ({
        name: t.name,
        desc: (t.description || '').slice(0, 110),
      }));
    } else {
      out.toolsListRaw = tl.text.slice(0, 400);
    }
  } catch (e) { out.error = String(e.message || e); }
  return out;
}

// ---------- 2. Bitget datahub (stateful, session id) ----------
async function probeBitget() {
  const out = { server: 'Bitget datahub', url: 'https://datahub.noxiaohao.com/mcp' };
  try {
    const init = await post(out.url, INIT);
    out.initStatus = init.status;
    out.sid = init.sid ? 'session-ok' : 'none';
    const headers = init.sid ? { 'mcp-session-id': init.sid } : {};
    if (init.sid) {
      await post(out.url, { jsonrpc: '2.0', method: 'notifications/initialized' }, headers, 8000).catch(() => {});
    }
    const tl = await post(out.url, { jsonrpc: '2.0', id: 2, method: 'tools/list' }, headers);
    const j = extractJson(tl.text);
    if (j && j.result && Array.isArray(j.result.tools)) {
      out.toolsCount = j.result.tools.length;
      out.tools = j.result.tools.map(t => ({
        name: t.name,
        desc: (t.description || '').slice(0, 110),
      }));
    } else {
      out.toolsListRaw = tl.text.slice(0, 400);
    }
  } catch (e) { out.error = String(e.message || e); }
  return out;
}

const [cl, bg] = await Promise.all([probeCoinLobster(), probeBitget()]);
console.log(JSON.stringify([cl, bg], null, 1));
