#!/usr/bin/env node
/**
 * REAL tool-call probe: CoinLobster + Bitget datahub MCP servers.
 * Verify the exact tools we want to wire into the Intraday TAB.
 */

function extractJson(text) {
  const idx = text.indexOf('data:');
  const raw = idx >= 0 ? text.slice(idx + 5).trim() : text.trim();
  try { return JSON.parse(raw); } catch {}
  for (const line of text.split(/\r?\n/)) {
    if (line.startsWith('data:')) {
      try { return JSON.parse(line.slice(5).trim()); } catch {}
    }
  }
  return null;
}

const H = {
  'Content-Type': 'application/json',
  'Accept': 'application/json, text/event-stream',
};

async function post(url, body, extra = {}, timeoutMs = 25000) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { ...H, ...extra },
    body: typeof body === 'string' ? body : JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs),
  });
  const text = await res.text();
  return { status: res.status, sid: res.headers.get('mcp-session-id'), text };
}

async function callTool(url, sessionId, id, name, args) {
  const extra = sessionId ? { 'mcp-session-id': sessionId } : {};
  const r = await post(url, { jsonrpc: '2.0', id, method: 'tools/call', params: { name, arguments: args } }, extra);
  const j = extractJson(r.text);
  let contentText = null;
  if (j && j.result && Array.isArray(j.result.content)) {
    contentText = j.result.content.map(c => c.text || '').join('\n');
  }
  return { status: r.status, isError: j?.result?.isError, raw: (contentText || r.text || '').slice(0, 1200) };
}

// ---- CoinLobster (stateless) ----
const CL = 'https://coinlobster.com/mcp';
console.log('=== CoinLobster tool calls ===');

console.log('\n--- my_access (free plan check) ---');
console.log((await callTool(CL, null, 10, 'my_access', {})).raw);

console.log('\n--- market_movers ---');
console.log((await callTool(CL, null, 11, 'market_movers', {})).raw.slice(0, 900));

console.log('\n--- whale_radar ---');
console.log((await callTool(CL, null, 12, 'whale_radar', {})).raw.slice(0, 700));

console.log('\n--- market_digest ---');
console.log((await callTool(CL, null, 13, 'market_digest', {})).raw.slice(0, 900));

// ---- Bitget datahub (stateful) ----
const BG = 'https://datahub.noxiaohao.com/mcp';
console.log('\n=== Bitget datahub tool calls ===');
const init = await post(BG, { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'smartai-probe', version: '1.0.0' } } });
const sid = init.sid;
if (sid) await post(BG, { jsonrpc: '2.0', method: 'notifications/initialized' }, { 'mcp-session-id': sid }, 8000).catch(() => {});

console.log('\n--- sentiment_index (Fear & Greed) ---');
console.log((await callTool(BG, sid, 20, 'sentiment_index', { mode: 'current' })).raw.slice(0, 700));

console.log('\n--- crypto_market trending ---');
console.log((await callTool(BG, sid, 21, 'crypto_market', { action: 'trending' })).raw.slice(0, 700));

console.log('\n--- derivatives_sentiment (long/short) ---');
console.log((await callTool(BG, sid, 22, 'derivatives_sentiment', { type: 'long_short_ratio', symbol: 'BTCUSDT' })).raw.slice(0, 700));

console.log('\n--- technical_analysis BTCUSDT ---');
console.log((await callTool(BG, sid, 23, 'technical_analysis', { symbol: 'BTC/USDT', exchange: 'binance' })).raw.slice(0, 900));
