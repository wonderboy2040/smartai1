// Smoke test: CoinDCX + hidden-assets endpoints on a live boot server.
const PORT = process.env.PORT || '8094';
const PIN = process.env.APP_PIN || '9201';
const BASE = `http://127.0.0.1:${PORT}`;
let token = '';
let pass = 0, fail = 0;

function check(name, cond, extra = '') {
  if (cond) { pass++; console.log(`  ✅ ${name}`); }
  else { fail++; console.log(`  ❌ ${name} ${extra}`); }
}

async function j(method, path, body) {
  const r = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(15000),
  });
  let data = null;
  try { data = await r.json(); } catch { /* non-json */ }
  return { status: r.status, data };
}

const run = async () => {
  // 1) auth-guard checks FIRST (token not yet set — j() sends no header)
  const noAuth = await j('GET', '/api/mcp/coindcx/status');
  check('coindcx/status 401 without auth', noAuth.status === 401, `(${noAuth.status})`);
  const noAuth2 = await j('GET', '/api/mcp/indmoney/assets');
  check('indmoney/assets 401 without auth', noAuth2.status === 401, `(${noAuth2.status})`);

  // 2) login
  const login = await j('POST', '/api/auth/login', { pin: PIN });
  check('login 200', login.status === 200, `(${login.status})`);
  token = login.data?.sessionToken || login.data?.token || '';
  check('session token', !!token);

  // 3) coindcx status — fresh state
  const st = await j('GET', '/api/mcp/coindcx/status');
  check('coindcx/status 200', st.status === 200, `(${st.status})`);
  check('coindcx status shape', st.data?.ok === true && st.data?.connected === false && 'lastSyncAt' in (st.data || {}));

  // 4) assets response carries the new fields
  const assets = await j('GET', '/api/mcp/indmoney/assets');
  check('assets 200', assets.status === 200, `(${assets.status})`);
  check('assets has sources/hidden fields',
    assets.data && Array.isArray(assets.data.assets) &&
    'hiddenAssets' in assets.data && 'hiddenCount' in assets.data &&
    'sources' in assets.data && 'coindcx' in assets.data,
    JSON.stringify(assets.data || {}).slice(0, 120));
  check('assets reason not-connected (fresh boot)', assets.data?.reason === 'not-connected' || assets.data?.reason === 'no-snapshot' || assets.data?.ok === true);

  // 5) hide without a snapshot → 404 (not a crash)
  const hide = await j('POST', '/api/mcp/indmoney/assets/hide', { key: 'indm:NOPE' });
  check('hide unknown → 404 (safe)', hide.status === 404 || hide.status === 400, `(${hide.status})`);

  // 6) unhide without anything hidden → 404
  const unh = await j('POST', '/api/mcp/indmoney/assets/unhide', { key: 'indm:NOPE' });
  check('unhide nothing → 404 (safe)', unh.status === 404 || unh.status === 400, `(${unh.status})`);

  // 7) coindcx connect with junk creds → clean 401/4xx error (CoinDCX API
  //    unreachable from the sandbox — must still return a friendly error)
  const conn = await j('POST', '/api/mcp/coindcx/connect', { apiKey: 'x', secret: 'y' });
  check('coindcx connect bad creds → clean 4xx', [400, 401, 429, 502].includes(conn.status), `(${conn.status}) ${JSON.stringify(conn.data || {}).slice(0, 100)}`);
  check('coindcx connect error message', !!(conn.data?.error?.message), JSON.stringify(conn.data || {}).slice(0, 100));
  // credentials must NOT be persisted after a failed connect
  const st2 = await j('GET', '/api/mcp/coindcx/status');
  check('bad creds not persisted', st2.data?.connected === false);

  // 7) disconnect while never connected → 200
  const dis = await j('POST', '/api/mcp/coindcx/disconnect', {});
  check('coindcx disconnect 200', dis.status === 200, `(${dis.status})`);

  // 8) old endpoints still fine
  const indSt = await j('GET', '/api/mcp/indmoney/status');
  check('indmoney/status 200', indSt.status === 200 && indSt.data?.ok === true);

  console.log(`\n${fail === 0 ? 'ALL PASS' : 'FAILURES'}: ${pass} pass / ${fail} fail`);
  process.exit(fail === 0 ? 0 : 1);
};

run().catch(e => { console.error('SMOKE CRASH:', e.message); process.exit(1); });
