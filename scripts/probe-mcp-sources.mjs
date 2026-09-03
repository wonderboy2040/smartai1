#!/usr/bin/env node
/**
 * Probe free MCP servers + keyless crypto REST sources for REAL reachability.
 * MCP = JSON-RPC initialize + tools/list handshake (streamable HTTP transport).
 * REST = plain GET status/shape check.
 * Each probe: 12s timeout, prints status + auth requirement + sample of body.
 */
const MCP_TARGETS = [
  { name: 'Tapetide MCP (India stocks)', url: 'https://mcp.tapetide.com/mcp' },
  { name: 'Upstox MCP demo (Render)', url: 'https://mcp-server-upstox.onrender.com/mcp' },
  { name: 'CoinLobster MCP (whales)', url: 'https://coinlobster.com/mcp' },
  { name: 'Bitget Signal MCP (noxiaohao)', url: 'https://datahub.noxiaohao.com/mcp' },
];

const REST_TARGETS = [
  { name: 'CoinGecko simple/price', url: 'https://api.coingecko.com/api/v3/simple/price?ids=bitcoin,ethereum&vs_currencies=inr,usd&include_24hr_change=true' },
  { name: 'CoinGecko search/trending', url: 'https://api.coingecko.com/api/v3/search/trending' },
  { name: 'CoinGecko global', url: 'https://api.coingecko.com/api/v3/global' },
  { name: 'CoinGecko markets (top5 inr)', url: 'https://api.coingecko.com/api/v3/coins/markets?vs_currency=inr&order=market_cap_desc&per_page=5&page=1&price_change_percentage=24h' },
  { name: 'Binance ticker/24hr', url: 'https://api.binance.com/api/v3/ticker/24hr?symbol=BTCUSDT' },
  { name: 'Binance klines 1m', url: 'https://api.binance.com/api/v3/klines?symbol=BTCUSDT&interval=1m&limit=2' },
];

const INIT_BODY = JSON.stringify({
  jsonrpc: '2.0', id: 1, method: 'initialize',
  params: {
    protocolVersion: '2024-11-05',
    capabilities: {},
    clientInfo: { name: 'smartai-probe', version: '1.0.0' },
  },
});

function parseSseOrJson(text) {
  // MCP streamable HTTP often replies as SSE frames: data: {...}
  const m = text.match(/data:\s*(\{[\s\S]*?\})\s*(?:\n\n|$)/);
  if (m) { try { return JSON.parse(m[1]); } catch { /* fallthrough */ } }
  try { return JSON.parse(text); } catch { return null; }
}

async function probeMcp(t) {
  const out = { name: t.name, url: t.url, type: 'MCP' };
  try {
    const ctl = AbortSignal.timeout(12000);
    const res = await fetch(t.url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json, text/event-stream',
      },
      body: INIT_BODY,
      signal: ctl,
    });
    out.httpStatus = res.status;
    out.sessionHeader = res.headers.get('mcp-session-id') ? 'yes' : 'no';
    const text = (await res.text()).slice(0, 1500);
    out.bodySample = text.replace(/\s+/g, ' ').slice(0, 300);
    const json = parseSseOrJson(text);
    if (json && json.result && json.result.serverInfo) {
      out.serverInfo = json.result.serverInfo;
      // try tools/list with session id if provided
      const sid = res.headers.get('mcp-session-id');
      if (sid) {
        try {
          const res2 = await fetch(t.url, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Accept': 'application/json, text/event-stream',
              'mcp-session-id': sid,
            },
            body: JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }),
            signal: AbortSignal.timeout(8000),
          });
          const res3 = await fetch(t.url, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Accept': 'application/json, text/event-stream',
              'mcp-session-id': sid,
            },
            body: JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/list' }),
            signal: AbortSignal.timeout(8000),
          });
          const t2 = (await res3.text()).slice(0, 4000);
          const j2 = parseSseOrJson(t2);
          if (j2 && j2.result && Array.isArray(j2.result.tools)) {
            out.toolsCount = j2.result.tools.length;
            out.toolNames = j2.result.tools.slice(0, 12).map(x => x.name);
          }
        } catch (e) { out.toolsListError = String(e.message || e).slice(0, 120); }
      }
      out.verdict = 'MCP-ALIVE';
    } else if (res.status === 401 || res.status === 403) {
      out.verdict = 'AUTH-REQUIRED';
    } else if (res.status === 404) {
      out.verdict = 'DEAD-404';
    } else {
      out.verdict = 'NOT-MCP-OR-ERROR';
    }
  } catch (e) {
    out.error = String(e.message || e).slice(0, 200);
    out.verdict = /timeout|aborted/i.test(String(e.message || e)) ? 'TIMEOUT' : 'UNREACHABLE';
  }
  return out;
}

async function probeRest(t) {
  const out = { name: t.name, url: t.url, type: 'REST' };
  try {
    const res = await fetch(t.url, {
      headers: { 'Accept': 'application/json' },
      signal: AbortSignal.timeout(12000),
    });
    out.httpStatus = res.status;
    const text = (await res.text()).slice(0, 600);
    out.bodySample = text.replace(/\s+/g, ' ').slice(0, 260);
    try {
      const j = JSON.parse(text);
      out.jsonKeys = Object.keys(j).slice(0, 10).join(',');
      out.verdict = res.status === 200 && j ? 'ALIVE' : `HTTP-${res.status}`;
    } catch {
      out.verdict = res.status === 200 ? 'NOT-JSON' : `HTTP-${res.status}`;
    }
  } catch (e) {
    out.error = String(e.message || e).slice(0, 200);
    out.verdict = /timeout|aborted/i.test(String(e.message || e)) ? 'TIMEOUT' : 'UNREACHABLE';
  }
  return out;
}

console.log('=== MCP SERVER PROBES ===');
const mcpResults = await Promise.all(MCP_TARGETS.map(probeMcp));
console.log(JSON.stringify(mcpResults, null, 1));

console.log('=== REST PROBES ===');
const restResults = await Promise.all(REST_TARGETS.map(probeRest));
console.log(JSON.stringify(restResults, null, 1));

console.log('=== SUMMARY ===');
for (const r of [...mcpResults, ...restResults]) {
  console.log(`${r.verdict.padEnd(18)} ${r.name}`);
}
