import { describe, expect, it } from 'vitest';
import { baseName, classifyMergeFile, fileLimitBytes, fmtMonth, formatBytes, isPdfName, pageWeight, pageWeightHint, parseProgress, pushRecent, readMinutes, withExt } from './fileUtils.js';

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

describe('classifyMergeFile', () => {
  it('routes by mime first, extension as fallback', () => {
    expect(classifyMergeFile('a.pdf', 'application/pdf')).toBe('pdf');
    expect(classifyMergeFile('a.PDF', '')).toBe('pdf');
    expect(classifyMergeFile('photo.jpg', 'image/jpeg')).toBe('image');
    expect(classifyMergeFile('scan.png', '')).toBe('image');
    expect(classifyMergeFile('notes.txt', 'text/plain')).toBe('text');
    expect(classifyMergeFile('doc.md', '')).toBe('text');
    expect(classifyMergeFile('r.docx', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document')).toBe('word');
    expect(classifyMergeFile('s.xlsx', '')).toBe('sheet');
    expect(classifyMergeFile('s.csv', 'text/csv')).toBe('sheet');
    expect(classifyMergeFile('deck.pptx', 'application/vnd.openxmlformats-officedocument.presentationml.presentation')).toBe('unsupported');
    expect(classifyMergeFile('noext', '')).toBe('unsupported');
  });

  it('flags pdfs for range support', () => {
    expect(isPdfName('a.pdf', 'application/pdf')).toBe(true);
    expect(isPdfName('a.jpg', 'image/jpeg')).toBe(false);
  });
});

describe('readMinutes', () => {
  it('estimates minutes with a floor of one', () => {
    expect(readMinutes(0)).toBe(1);
    expect(readMinutes(-50)).toBe(1);
    expect(readMinutes(199)).toBe(1);
    expect(readMinutes(200)).toBe(1);
    expect(readMinutes(201)).toBe(2);
    expect(readMinutes(1200)).toBe(6);
  });
});

describe('fmtMonth', () => {
  it('renders ISO dates as Mon YYYY', () => {
    expect(fmtMonth('2026-09-04')).toBe('Sep 2026');
    expect(fmtMonth('2025-01-31')).toBe('Jan 2025');
    expect(fmtMonth('garbage')).toBe('garbage');
    expect(fmtMonth('2026-13-01')).toBe('2026-13-01');
  });
});

describe('fileLimitBytes', () => {
  // Node has no deviceMemory → unknown-device branch (250 MB base).
  it('caps raster-heavy tools lower than shuffling tools', () => {
    expect(fileLimitBytes('merge')).toBe(250 * 1024 * 1024);
    expect(fileLimitBytes('compress')).toBe(200 * 1024 * 1024);
    expect(fileLimitBytes('ocr')).toBe(200 * 1024 * 1024);
    expect(fileLimitBytes('')).toBe(250 * 1024 * 1024);
  });
});

describe('pageWeight', () => {
  it('classifies lean, mixed, and photo pages', () => {
    expect(pageWeight(100 * 1024, 1)?.kind).toBe('lean');
    expect(pageWeight(500 * 1024, 1)?.kind).toBe('mixed');
    expect(pageWeight(2 * 1024 * 1024, 1)?.kind).toBe('photo');
    expect(pageWeight(10 * 1024 * 1024, 20)?.kind).toBe('mixed');
  });

  it('rejects nonsense input', () => {
    expect(pageWeight(0, 5)).toBeNull();
    expect(pageWeight(1000, 0)).toBeNull();
    expect(pageWeight(NaN, 3)).toBeNull();
  });

  it('explains what each class means for compression', () => {
    expect(pageWeightHint('photo')).toMatch(/dramatically/);
    expect(pageWeightHint('lean')).toMatch(/modest/);
  });
});
