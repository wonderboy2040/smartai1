// ============================================================
// test/durable.test.ts — restart-safe MCP state (durable.js)
// Covers: AES-256-GCM envelope round-trip + tamper detection, key
// resolution (explicit / derived / disabled), durablePut no-op when
// unconfigured, and the boot-restore hydration logic (missing local
// file, older local file, fresh local file) with the GitHub backup
// layer fully mocked.
// ============================================================
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA = path.join(__dirname, '..', 'server', 'data');

// ---- mock the GitHub backup layer BEFORE durable.js loads ----
const pushMock = vi.fn();
const restoreMock = vi.fn();
vi.mock('../server/lib/backup.js', () => ({
  scheduleBackup: (...args) => pushMock(...args),
  restoreBackup: (...args) => restoreMock(...args),
  backupConfigured: () => !!(process.env.GITHUB_BACKUP_TOKEN && process.env.GITHUB_BACKUP_REPO),
}));

const durable = await import('../server/mcp/durable.js');
const {
  encryptJSON, decryptJSON, durableConfigured, durableStatus,
  durablePut, durableBootRestore, durableBootRestoreAll,
  __resetDurableForTests,
} = durable;

const CREDS_PATH = path.join(DATA, 'mcp-coindcx.json');
const INDM_PATH = path.join(DATA, 'mcp-indmoney.json');
const SNAP_PATH = path.join(DATA, 'mcp-portfolio.json');
const SYM_PATH = path.join(DATA, 'mcp-symbol-cache.json');
const BASIS_PATH = path.join(DATA, 'mcp-coindcx-basis.json');
const SETTINGS_PATH = path.join(DATA, 'mcp-settings.json');

function setDurableEnv() {
  process.env.GITHUB_BACKUP_TOKEN = 'ghp_testtoken';
  process.env.GITHUB_BACKUP_REPO = 'someone/smartai1';
  process.env.DURABLE_KEY = 'test-durable-key-16ch';
}

beforeEach(() => {
  __resetDurableForTests();
  setDurableEnv();
  for (const p of [CREDS_PATH, INDM_PATH, SNAP_PATH, SYM_PATH, BASIS_PATH, SETTINGS_PATH]) {
    try { fs.rmSync(p, { force: true }); } catch { /* ignore */ }
  }
});

afterEach(() => {
  delete process.env.GITHUB_BACKUP_TOKEN;
  delete process.env.GITHUB_BACKUP_REPO;
  delete process.env.DURABLE_KEY;
  delete process.env.APP_PIN;
  delete process.env.API_TOKEN;
  vi.clearAllMocks();
});

// ---------------- crypto envelope ----------------
describe('AES-256-GCM envelope', () => {
  it('round-trips an arbitrary state object', () => {
    const state = { tokens: { accessToken: 'AT', refreshToken: 'RT' }, connectedAt: 123 };
    const env = encryptJSON(state);
    expect(env).toBeTruthy();
    expect(env.alg).toBe('aes-256-gcm');
    expect(env.ct).toBeTruthy();
    // ciphertext must not contain the plaintext
    expect(JSON.stringify(env)).not.toContain('AT');
    const back = decryptJSON(env);
    expect(back).toEqual(state);
  });

  it('rejects tampered ciphertext (auth tag mismatch)', () => {
    const env = encryptJSON({ secret: 'coinDCX-key' });
    const tampered = { ...env, ct: Buffer.from('evil-payload-here').toString('base64') };
    expect(decryptJSON(tampered)).toBeNull();
  });

  it('rejects a blob encrypted with a DIFFERENT key', () => {
    const env = encryptJSON({ secret: 'x' });
    process.env.DURABLE_KEY = 'another-16-char-key';
    __resetDurableForTests();
    expect(decryptJSON(env)).toBeNull();
  });

  it('returns null for malformed envelopes', () => {
    expect(decryptJSON(null)).toBeNull();
    expect(decryptJSON({ alg: 'aes-256-gcm' })).toBeNull();
    expect(decryptJSON('string')).toBeNull();
  });
});

// ---------------- key resolution ----------------
describe('key resolution', () => {
  it('prefers DURABLE_KEY', () => {
    const st = durableStatus();
    expect(st.configured).toBe(true);
    expect(st.keySource).toBe('DURABLE_KEY');
  });

  it('derives from APP_PIN + API_TOKEN when DURABLE_KEY is absent', () => {
    delete process.env.DURABLE_KEY;
    process.env.APP_PIN = '9201';
    process.env.API_TOKEN = 'long-random-service-token-value';
    __resetDurableForTests();
    const st = durableStatus();
    expect(st.configured).toBe(true);
    expect(st.keySource).toBe('derived(APP_PIN+API_TOKEN)');
    // Round-trip still works with the derived key.
    const env = encryptJSON({ a: 1 });
    expect(decryptJSON(env)).toEqual({ a: 1 });
  });

  it('is disabled without any key material', () => {
    delete process.env.DURABLE_KEY;
    __resetDurableForTests();
    expect(durableConfigured()).toBe(false);
    expect(encryptJSON({ a: 1 })).toBeNull();
    expect(durablePut('mcp-coindcx.json', { a: 1 })).toBe(false);
    expect(pushMock).not.toHaveBeenCalled();
  });

  it('is disabled when the backup repo env is missing', () => {
    delete process.env.GITHUB_BACKUP_REPO;
    __resetDurableForTests();
    expect(durableConfigured()).toBe(false);
  });
});

// ---------------- durablePut ----------------
describe('durablePut', () => {
  it('encrypts and schedules the remote push', () => {
    const ok = durablePut('mcp-coindcx.json', { apiKey: 'KEY', secret: 'SEC' });
    expect(ok).toBe(true);
    expect(pushMock).toHaveBeenCalledTimes(1);
    const [file, envelope] = pushMock.mock.calls[0];
    expect(file).toBe('mcp-coindcx.json');
    expect(envelope.alg).toBe('aes-256-gcm');
    expect(JSON.stringify(envelope)).not.toContain('KEY');
    expect(decryptJSON(envelope)).toEqual({ apiKey: 'KEY', secret: 'SEC' });
  });
});

// ---------------- boot restore ----------------
describe('durableBootRestore', () => {
  it('hydrates the local file when it is missing', async () => {
    const creds = { apiKey: 'KEY', secret: 'SEC', connectedAt: 1000 };
    restoreMock.mockResolvedValue(encryptJSON(creds));
    const out = await durableBootRestore('mcp-coindcx.json', {
      isUsable: (s) => !!(s && s.apiKey && s.secret),
    });
    expect(out).toEqual(creds);
    expect(JSON.parse(fs.readFileSync(CREDS_PATH, 'utf8'))).toEqual(creds);
  });

  it('keeps the local file when it is fresher than the remote', async () => {
    fs.writeFileSync(CREDS_PATH, JSON.stringify({ apiKey: 'LOCAL', secret: 'L', connectedAt: 2000 }));
    restoreMock.mockResolvedValue(encryptJSON({ apiKey: 'REMOTE', secret: 'R', connectedAt: 1000 }));
    const out = await durableBootRestore('mcp-coindcx.json', {
      isUsable: (s) => !!(s && s.apiKey && s.secret),
      localTs: (s) => s?.connectedAt || 0,
      remoteTs: (s) => s?.connectedAt || 0,
    });
    expect(out).toBeNull();
    expect(JSON.parse(fs.readFileSync(CREDS_PATH, 'utf8')).apiKey).toBe('LOCAL');
  });

  it('ignores undecryptable remote blobs (key rotation)', async () => {
    restoreMock.mockResolvedValue({ v: 1, alg: 'aes-256-gcm', iv: 'x', tag: 'y', ct: 'zz' });
    const out = await durableBootRestore('mcp-coindcx.json');
    expect(out).toBeNull();
    expect(fs.existsSync(CREDS_PATH)).toBe(false);
  });

  it('is a no-op when unconfigured', async () => {
    delete process.env.GITHUB_BACKUP_TOKEN;
    __resetDurableForTests();
    restoreMock.mockResolvedValue(encryptJSON({ a: 1 }));
    expect(await durableBootRestore('mcp-coindcx.json')).toBeNull();
    expect(restoreMock).not.toHaveBeenCalled();
  });
});

describe('durableBootRestoreAll', () => {
  it('restores credentials + snapshot + symbol cache and reloads indmoney state', async () => {
    // Empty local files → everything comes back from the encrypted backup.
    restoreMock.mockImplementation(async (file) => {
      if (file === 'mcp-indmoney.json') {
        return encryptJSON({ tokens: { accessToken: 'AT', refreshToken: 'RT', obtainedAt: 123 }, connectedAt: 123, clients: {}, pending: {} });
      }
      if (file === 'mcp-coindcx.json') return encryptJSON({ apiKey: 'K', secret: 'S', connectedAt: 1 });
      if (file === 'mcp-portfolio.json') return encryptJSON({ assets: [{ id: 'a' }], syncedAt: 5, hidden: [] });
      if (file === 'mcp-symbol-cache.json') return encryptJSON({ map: { 'USv2:spacex': { symbol: 'SPCX', ts: 1 } } });
      return null;
    });

    const restored = await durableBootRestoreAll();
    expect(restored).toMatchObject({ indmoney: true, coindcx: true, portfolio: true, symbols: true });
    // Files hydrated on disk
    expect(JSON.parse(fs.readFileSync(INDM_PATH, 'utf8')).tokens.accessToken).toBe('AT');
    expect(JSON.parse(fs.readFileSync(CREDS_PATH, 'utf8')).apiKey).toBe('K');
    expect(JSON.parse(fs.readFileSync(SNAP_PATH, 'utf8')).assets).toHaveLength(1);
    expect(JSON.parse(fs.readFileSync(SYM_PATH, 'utf8')).map['USv2:spacex'].symbol).toBe('SPCX');
    // restoreBackup called once per state file, in credential-first order
    const files = restoreMock.mock.calls.map((c) => c[0]);
    expect(files.indexOf('mcp-indmoney.json')).toBeLessThan(files.indexOf('mcp-portfolio.json'));
  });

  it('v6.1: restores the coindcx manual basis + app settings (the multi-device fix)', async () => {
    restoreMock.mockImplementation(async (file) => {
      if (file === 'mcp-coindcx-basis.json') {
        return encryptJSON({ basis: { BTC: 5259.07, ETH: 3226 }, updatedAt: 42 });
      }
      if (file === 'mcp-settings.json') {
        return encryptJSON({ settings: { usdAppRate: { value: 92.0006, updatedAt: 42 } }, updatedAt: 42 });
      }
      return null;
    });

    const restored = await durableBootRestoreAll();
    expect(restored).toMatchObject({ coindcxBasis: true, settings: true });
    expect(JSON.parse(fs.readFileSync(BASIS_PATH, 'utf8')).basis).toEqual({ BTC: 5259.07, ETH: 3226 });
    expect(JSON.parse(fs.readFileSync(SETTINGS_PATH, 'utf8')).settings.usdAppRate.value).toBe(92.0006);
  });

  it('v6.1: restores a LEGACY flat basis backup (<= v6.0 shape) verbatim', async () => {
    restoreMock.mockImplementation(async (file) => {
      if (file === 'mcp-coindcx-basis.json') return encryptJSON({ BTC: 1234.5 });
      return null;
    });
    const restored = await durableBootRestoreAll();
    expect(restored).toMatchObject({ coindcxBasis: true });
    expect(JSON.parse(fs.readFileSync(BASIS_PATH, 'utf8'))).toEqual({ BTC: 1234.5 });
  });

  it('v6.1: basis restore is skipped when local is FRESHER (recent save survived)', async () => {
    fs.writeFileSync(BASIS_PATH, JSON.stringify({ basis: { BTC: 999 }, updatedAt: Date.now() }));
    restoreMock.mockImplementation(async (file) => {
      if (file === 'mcp-coindcx-basis.json') {
        return encryptJSON({ basis: { BTC: 111 }, updatedAt: 1000 });
      }
      return null;
    });
    const restored = await durableBootRestoreAll();
    expect(restored.coindcxBasis).toBeUndefined();
    expect(JSON.parse(fs.readFileSync(BASIS_PATH, 'utf8')).basis).toEqual({ BTC: 999 });
  });

  it('logs a setup hint (and returns {}) when not configured', async () => {
    delete process.env.GITHUB_BACKUP_TOKEN;
    __resetDurableForTests();
    const restored = await durableBootRestoreAll();
    expect(restored).toEqual({});
    expect(restoreMock).not.toHaveBeenCalled();
  });
});
