import { describe, expect, it } from 'vitest';
import { baseName, formatBytes, withExt } from './fileUtils.js';

describe('formatBytes', () => {
  it('formats bytes, KB and MB', () => {
    expect(formatBytes(0)).toBe('0 B');
    expect(formatBytes(512)).toBe('512 B');
    expect(formatBytes(1024)).toBe('1.0 KB');
    expect(formatBytes(1536)).toBe('1.5 KB');
    expect(formatBytes(5 * 1024 * 1024)).toBe('5.0 MB');
  });

  it('handles invalid input gracefully', () => {
    expect(formatBytes(NaN)).toBe('—');
    expect(formatBytes(-1)).toBe('—');
  });
});

describe('file names', () => {
  it('strips the last extension', () => {
    expect(baseName('report.pdf')).toBe('report');
    expect(baseName('archive.tar.gz')).toBe('archive.tar');
    expect(baseName('noext')).toBe('noext');
  });

  it('swaps extensions', () => {
    expect(withExt('report.pdf', 'txt')).toBe('report.txt');
    expect(withExt('scan.PDF', 'zip')).toBe('scan.zip');
  });
});
