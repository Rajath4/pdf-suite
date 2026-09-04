import { describe, expect, it } from 'vitest';
import { baseName, formatBytes, parseProgress, pushRecent, withExt } from './fileUtils.js';

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

describe('parseProgress', () => {
  it('extracts done/total from engine messages', () => {
    expect(parseProgress('Rendering 3/12…')).toEqual({ done: 3, total: 12 });
    expect(parseProgress('Page 1/1…')).toEqual({ done: 1, total: 1 });
    expect(parseProgress('Batch 2/5: file.pdf…')).toEqual({ done: 2, total: 5 });
  });

  it('returns null when there is no fraction', () => {
    expect(parseProgress('Working…')).toBeNull();
    expect(parseProgress('Merging…')).toBeNull();
    expect(parseProgress('Page 0/0')).toBeNull();
  });
});

describe('pushRecent', () => {
  it('dedupes, prepends and caps length', () => {
    expect(pushRecent([], 'merge')).toEqual(['merge']);
    expect(pushRecent(['a', 'b'], 'c')).toEqual(['c', 'a', 'b']);
    expect(pushRecent(['a', 'b'], 'a')).toEqual(['a', 'b']);
    expect(pushRecent(['a', 'b', 'c', 'd', 'e'], 'f')).toEqual(['f', 'a', 'b', 'c', 'd']);
  });
});
