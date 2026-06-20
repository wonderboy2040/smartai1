import { describe, it, expect } from 'vitest';
import { toCSV } from './exportData';

describe('exportData.toCSV', () => {
  it('builds a CSV with a UTF-8 BOM and header row', () => {
    const csv = toCSV(['A', 'B'], [[1, 2]]);
    expect(csv.startsWith('\uFEFF')).toBe(true);
    expect(csv).toContain('A,B');
    expect(csv).toContain('1,2');
  });

  it('escapes cells containing commas, quotes and newlines', () => {
    const csv = toCSV(['x'], [['a,b'], ['he said "hi"'], ['line\nbreak']]);
    expect(csv).toContain('"a,b"');
    expect(csv).toContain('"he said ""hi"""');
    expect(csv).toContain('"line\nbreak"');
  });

  it('renders empty cells for null/undefined', () => {
    const csv = toCSV(['x', 'y'], [[null, undefined]]);
    const lastLine = csv.trim().split('\r\n').pop();
    expect(lastLine).toBe(',');
  });
});
