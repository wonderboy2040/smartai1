let cached = process.env.SMARTAPI_PUBLIC_IP || '';

async function detectPublicIp() {
  if (cached) return cached;
  try {
    const r = await fetch('https://api.ipify.org?format=json', { signal: AbortSignal.timeout(5000) });
    if (r.ok) { const j = await r.json(); if (j.ip) cached = j.ip; }
  } catch {}
  return cached || '106.193.147.98';
}

// Warm on import so it's ready by first API call
const promise = detectPublicIp();

export function getPublicIp() { return cached || '106.193.147.98'; }
export async function waitForIp() { await promise; return cached; }
