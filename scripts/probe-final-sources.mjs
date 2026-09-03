#!/usr/bin/env node
/** Final source verification: Fear&Greed direct + CoinGecko trending/markets (sequential). */

async function jget(name, url, timeoutMs = 12000) {
  try {
    const res = await fetch(url, { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(timeoutMs) });
    const text = await res.text();
    try {
      const j = JSON.parse(text);
      console.log(`\n=== ${name}: HTTP ${res.status} OK ===`);
      console.log(JSON.stringify(j).slice(0, 700));
    } catch {
      console.log(`\n=== ${name}: HTTP ${res.status} (non-json) ===`);
      console.log(text.slice(0, 300));
    }
  } catch (e) {
    console.log(`\n=== ${name}: FAILED — ${e.message} ===`);
  }
}

await jget('Fear&Greed (alternative.me)', 'https://api.alternative.me/fng/?limit=2');
await new Promise(r => setTimeout(r, 2500));
await jget('CoinGecko trending', 'https://api.coingecko.com/api/v3/search/trending');
await new Promise(r => setTimeout(r, 2500));
await jget('CoinGecko markets top8 INR', 'https://api.coingecko.com/api/v3/coins/markets?vs_currency=inr&order=market_cap_desc&per_page=8&page=1&price_change_percentage=24h&sparkline=false');
