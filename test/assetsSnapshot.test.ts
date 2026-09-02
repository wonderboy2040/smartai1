// ============================================================
// assetsSnapshot.test — Export menu CSV builder (v4.5)
// buildAssetsSnapshotCSV is pure (no download trigger) so the
// vitest suite can assert the exact grid + totals footer.
// ============================================================
import { describe, it, expect, vi, afterEach } from 'vitest';
import { buildAssetsSnapshotCSV, exportAssetsSnapshotCSV, type AssetSnapshotRow } from '../src/utils/exportData';

const R = (over: Partial<AssetSnapshotRow> = {}): AssetSnapshotRow => ({
  symbol: 'RELIANCE', name: 'Reliance Industries', market: 'IN',
  qty: 10, avgPrice: 2500, ltp: 2600, changePct: 1.2,
  investedNative: 25000, valueNative: 26000, pnlNative: 1000, pnlPct: 4,
  todayPLNative: 300, valueINR: 26000,
  ...over,
});

// jsdom: stub the blob-download side effects so exportAssetsSnapshotCSV
// can be invoked without a real browser download.
describe('buildAssetsSnapshotCSV', () => {
  it('emits headers + one row per asset + INR totals footer', () => {
    const csv = buildAssetsSnapshotCSV([R(), R({ symbol: 'AAPL', market: 'US', pnlPct: null })], 83.5);
    const lines = csv.split('\r\n');
    expect(lines[0]).toContain('Symbol,Name,Market,Qty');
    expect(lines[0]).toContain("Today's P&L (native)");
    // data rows
    expect(lines[1]).toContain('RELIANCE');
    expect(lines[1]).toContain('IN');
    expect(lines[1]).toContain('26000');       // value native
    expect(lines[1]).toContain('+300'.slice(1)); // 300.00 today P&L
    expect(lines[2]).toContain('AAPL');
    // no-basis row → empty P&L % cell (trailing comma pair)
    expect(lines[2]).toMatch(/,,\d+/);
    // totals footer
    expect(lines[3]).toContain('TOTAL');
    expect(lines[3]).toContain('52000');
    // audit comment
    expect(csv).toContain('# USD/INR at export: 83.50');
  });

  it('strips .NS/.BO suffixes from symbols like the other exports', () => {
    const csv = buildAssetsSnapshotCSV([R({ symbol: 'TCS.NS' })], 83);
    expect(csv).toContain('TCS,');
    expect(csv).not.toContain('TCS.NS');
  });

  it('BOM prefix present so Excel detects UTF-8 (₹ columns)', () => {
    const csv = buildAssetsSnapshotCSV([R()], 83);
    expect(csv.charCodeAt(0)).toBe(0xFEFF);
  });

  it('empty list still yields headers + 0 total', () => {
    const csv = buildAssetsSnapshotCSV([], 83);
    const lines = csv.split('\r\n');
    expect(lines[0]).toContain('Symbol');
    expect(lines[1]).toContain('TOTAL');
    expect(lines[1]).toContain('0');
  });
});

describe('exportAssetsSnapshotCSV (download trigger)', () => {
  afterEach(() => vi.restoreAllMocks());

  it('creates a blob URL, clicks an anchor, and revokes after a tick', () => {
    const clickSpy = vi.fn();
    const anchor = { click: clickSpy, href: '', download: '' } as unknown as HTMLAnchorElement;
    const urlSpy = vi.fn(() => 'blob:mock');
    const revokeSpy = vi.fn();
    vi.stubGlobal('URL', Object.assign(URL, { createObjectURL: urlSpy, revokeObjectURL: revokeSpy }));
    const createSpy = vi.spyOn(document, 'createElement').mockReturnValue(anchor);
    const appendSpy = vi.spyOn(document.body, 'appendChild').mockImplementation(((n: Node) => n) as typeof document.body.appendChild);
    const removeSpy = vi.spyOn(document.body, 'removeChild').mockImplementation(((n: Node) => n) as typeof document.body.removeChild);
    try {
      exportAssetsSnapshotCSV([R()], 83.2);
    } finally {
      vi.unstubAllGlobals();
      createSpy.mockRestore(); appendSpy.mockRestore(); removeSpy.mockRestore();
    }

    expect(urlSpy).toHaveBeenCalled();
    expect(clickSpy).toHaveBeenCalled();
    // async revoke scheduled for Safari — flush it
    return new Promise<void>(resolve => setTimeout(() => {
      expect(revokeSpy).toHaveBeenCalled();
      resolve();
    }, 1100));
  }, 4000);
});
