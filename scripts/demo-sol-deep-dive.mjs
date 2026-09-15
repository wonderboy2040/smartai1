// Demo: run the v10.10 deterministic SUPER-INTEL path on SOL with LIVE feeds
// (the exact code path the CoinDCX tab takes when the LLM chain is down).
import { runCryptoAgent } from '../server/ai/cryptoAgent.js';

const q = 'SOL ka deep analysis karo — entry, SL, leverage sab exact numbers me';
const out = await runCryptoAgent([{ role: 'user', content: q }], { KEYS: {}, OPENAI_COMPAT: {} });

console.log('ok       :', out.ok);
console.log('engine   :', out.engine);
console.log('toolsUsed:', (out.toolsUsed || []).join(', '));
console.log('---');
console.log(out.ok ? out.text : `ERROR: ${out.error}`);
