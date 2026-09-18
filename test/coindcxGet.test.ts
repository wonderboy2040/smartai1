// ============================================================
// test/coindcxGet.test.ts — v10.3.2 GET transport for the 2025
// futures wallet routes
// ------------------------------------------------------------
// The derivatives wallet route is GET-only (POST dies [404]
// not_found). These tests pin the EXACT wire contract of the GET
// signed call: query-string params, seconds timestamp, HMAC over
// the compact JSON of the same params, and the error envelope.
// ============================================================
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import crypto from 'node:crypto';

const origFetch = globalThis.fetch;
const fetchMock = vi.fn();

// import AFTER the fetch stub is declared — the module reads
// globalThis.fetch at call time, not import time, so order is safe.
import { coindcxPrivateGET } from '../server/mcp/coindcx.js';

beforeEach(() => {
  fetchMock.mockReset();
  globalThis.fetch = fetchMock as unknown as typeof fetch;
});

afterEach(() => {
  globalThis.fetch = origFetch;
});

const okJson = (body: unknown) => ({
  ok: true, status: 200,
  json: async () => body,
  text: async () => JSON.stringify(body),
});

describe('coindcxPrivateGET (2025 futures GET auth)', () => {
  it('sends params as a query string with a SECONDS timestamp and HMAC-signs the compact JSON', async () => {
    fetchMock.mockImplementationOnce(async () => okJson([]));
    await coindcxPrivateGET('/exchange/v1/derivatives/futures/wallets', 'KEY', 'SECRET', {});

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, opts] = fetchMock.mock.calls[0];
    const u = new URL(String(url));
    expect(u.origin + u.pathname).toBe('https://api.coindcx.com/exchange/v1/derivatives/futures/wallets');
    expect(u.searchParams.get('timestamp')).toMatch(/^\d{10}$/); // seconds epoch, string
    expect(opts.method).toBe('GET');
    expect(opts.headers['X-AUTH-APIKEY']).toBe('KEY');
    // signature = HMAC-SHA256(SECRET, {"timestamp":"<ts>"})
    const ts = u.searchParams.get('timestamp');
    const expected = crypto.createHmac('sha256', 'SECRET').update(JSON.stringify({ timestamp: ts })).digest('hex');
    expect(opts.headers['X-AUTH-SIGNATURE']).toBe(expected);
    expect(opts.body).toBeUndefined(); // nothing in a GET body
  });

  it('signs extra params into the same compact JSON and the query string', async () => {
    fetchMock.mockImplementationOnce(async () => okJson({ wallets: [] }));
    await coindcxPrivateGET('/x/y', 'K', 'S', { page: '1' }, { unit: 's' });
    const [url, opts] = fetchMock.mock.calls[0];
    const u = new URL(String(url));
    const ts = u.searchParams.get('timestamp');
    expect(u.searchParams.get('page')).toBe('1');
    const expected = crypto.createHmac('sha256', 'S').update(JSON.stringify({ page: '1', timestamp: ts })).digest('hex');
    expect(opts.headers['X-AUTH-SIGNATURE']).toBe(expected);
  });

  it('unit ms sends the 13-digit epoch', async () => {
    fetchMock.mockImplementationOnce(async () => okJson([]));
    await coindcxPrivateGET('/x', 'K', 'S', {}, { unit: 'ms' });
    const [url] = fetchMock.mock.calls[0];
    const ts = new URL(String(url)).searchParams.get('timestamp');
    expect(ts).toMatch(/^\d{13}$/);
  });

  it('surfaces [status] message errors like the POST transport (the [404] not_found case)', async () => {
    fetchMock.mockImplementationOnce(async () => ({
      ok: false, status: 404,
      json: async () => ({ message: 'not_found' }),
      text: async () => JSON.stringify({ message: 'not_found' }),
    }));
    await expect(coindcxPrivateGET('/x', 'K', 'S', {})).rejects.toThrow('[404] not_found');
  });

  it('tolerates plain-text error bodies', async () => {
    fetchMock.mockImplementationOnce(async () => ({
      ok: false, status: 401,
      json: async () => { throw new Error('not json'); },
      text: async () => 'Unauthorized',
    }));
    await expect(coindcxPrivateGET('/x', 'K', 'S', {})).rejects.toThrow('[401] CoinDCX API 401');
  });
});
