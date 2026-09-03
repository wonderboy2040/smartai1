#!/usr/bin/env node
/** Retry Bitget datahub tool calls with longer timeout + backoff. */

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

const BG = 'https://datahub.noxiaohao.com/mcp';
const H = {
  'Content-Type': 'application/json',
  'Accept': 'application/json, text/event-stream',
};

async function post(body, extra = {}, timeoutMs = 45000) {
  const res = await fetch(BG, {
    method: 'POST', headers: { ...H, ...extra },
    body: JSON.stringify(body), signal: AbortSignal.timeout(timeoutMs),
  });
  return { status: res.status, sid: res.headers.get('mcp-session-id'), text: await res.text() };
}

const t0 = Date.now();
const init = await post({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'smartai-probe', version: '1.0.0' } } });
console.log(`init: ${init.status} sid=${init.sid ? 'yes' : 'no'} in ${Date.now() - t0}ms`);
const sid = init.sid;
if (sid) await post({ jsonrpc: '2.0', method: 'notifications/initialized' }, { 'mcp-session-id': sid }, 8000).catch(() => {});

async function callTool(id, name, args) {
  const t = Date.now();
  try {
    const r = await post({ jsonrpc: '2.0', id, method: 'tools/call', params: { name, arguments: args } }, sid ? { 'mcp-session-id': sid } : {});
    const j = extractJson(r.text);
    const txt = j?.result?.content?.map(c => c.text || '').join('\n') || r.text;
    console.log(`\n--- ${name} (${Date.now() - t}ms, http ${r.status}) ---`);
    console.log(txt.slice(0, 800));
  } catch (e) {
    console.log(`\n--- ${name} FAILED after ${Date.now() - t}ms: ${e.message} ---`);
  }
}

await callTool(20, 'sentiment_index', { mode: 'current' });
await callTool(21, 'crypto_market', { action: 'trending' });
await callTool(23, 'technical_analysis', { symbol: 'BTC/USDT', exchange: 'binance' });
