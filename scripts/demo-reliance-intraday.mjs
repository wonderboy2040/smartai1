// Demo: India Intraday tab deterministic fallback (live NSE feed).
import { runProTraderAgent } from '../server/intraday/agent.js';

const deps = { KEYS: {}, OPENAI_COMPAT: {} };
const out = await runProTraderAgent([{ role: 'user', content: 'RELIANCE ka analysis do — entry, SL batao' }], deps);

console.log('ok       :', out.ok);
console.log('engine   :', out.engine);
console.log('toolsUsed:', (out.toolsUsed || []).join(', '));
console.log('---');
console.log(out.ok ? out.text : `ERROR: ${out.error}`);
