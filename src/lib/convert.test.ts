import { describe, expect, it } from 'vitest';
import { parseCsv, tableToCsv, tableToXlsxBlob } from './convert.js';

describe('parseCsv', () => {
  it('parses headers and rows', () => {
    const t = parseCsv('a,b,c\n1,2,3\n4,5,6');
    expect(t.headers).toEqual(['a', 'b', 'c']);
    expect(t.rows).toEqual([
      ['1', '2', '3'],
      ['4', '5', '6'],
    ]);
  });

  it('handles quoted commas, escaped quotes and CRLF', () => {
    const t = parseCsv('name,note\r\n"Doe, Jane","said ""hi"""\r\nBob,plain');
    expect(t.rows[0]).toEqual(['Doe, Jane', 'said "hi"']);
    expect(t.rows[1]).toEqual(['Bob', 'plain']);
  });

  it('rejects empty input', () => {
    expect(() => parseCsv('')).toThrow();
    expect(() => parseCsv('\n\n')).toThrow();
  });
});

describe('tableToCsv', () => {
  it('escapes commas, quotes and newlines', () => {
    const csv = tableToCsv({ headers: ['a'], rows: [['x,y'], ['q"q'], ['l1\nl2']] });
    expect(csv).toBe('a\n"x,y"\n"q""q"\n"l1\nl2"');
  });

  it('round-trips through parseCsv', () => {
    const table = { headers: ['a', 'b'], rows: [['1,2', 'x'], ['y', 'z']] };
    expect(parseCsv(tableToCsv(table))).toEqual(table);
  });

  it('produces a non-empty xlsx workbook', () => {
    const blob = tableToXlsxBlob({ headers: ['a'], rows: [['1']] });
    expect(blob.size).toBeGreaterThan(1000);
    expect(blob.type).toContain('spreadsheetml');
  });
});
