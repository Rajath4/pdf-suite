import { describe, expect, it } from 'vitest';
import {
  chooseCompressPath,
  chunkFileName,
  inspectLargeFile,
  parseChunkMB,
  parsePagesPerFile,
  planBatches,
  planChunks,
  rejoinFileName,
  shrinkPresetCfg,
  sniffHeader,
  sniffTail,
  stripPartSuffix,
} from './largeFiles.js';

describe('parseChunkMB', () => {
  it('clamps to the 5–2000 MB guardrail', () => {
    expect(parseChunkMB('100')).toBe(100);
    expect(parseChunkMB('1')).toBe(5);
    expect(parseChunkMB('99999')).toBe(2000);
    expect(parseChunkMB('nope')).toBe(100);
    expect(parseChunkMB(undefined)).toBe(100);
  });
});

describe('planChunks', () => {
  it('covers the byte range exactly once with no gaps', () => {
    const plans = planChunks(250, 100);
    expect(plans).toHaveLength(3);
    expect(plans[0]).toMatchObject({ index: 1, start: 0, end: 100 });
    expect(plans[2]).toMatchObject({ index: 3, start: 200, end: 250 });
    // Contiguity: each chunk starts where the previous ended.
    for (let i = 1; i < plans.length; i++) {
      expect(plans[i].start).toBe(plans[i - 1].end);
    }
    expect(plans[plans.length - 1].end).toBe(250);
  });

  it('returns a single chunk when the file fits', () => {
    expect(planChunks(50, 100)).toHaveLength(1);
  });

  it('rejects empty input', () => {
    expect(planChunks(0, 100)).toEqual([]);
  });
});

describe('shrink batching', () => {
  it('clamps pages-per-file to 10–200', () => {
    expect(parsePagesPerFile('50')).toBe(50);
    expect(parsePagesPerFile('1')).toBe(10);
    expect(parsePagesPerFile('9999')).toBe(200);
    expect(parsePagesPerFile('nope')).toBe(50);
  });

  it('covers every page exactly once', () => {
    const batches = planBatches(125, 50);
    expect(batches).toHaveLength(3);
    expect(batches[0]).toMatchObject({ index: 1, startPage: 1, endPage: 50 });
    expect(batches[2]).toMatchObject({ index: 3, startPage: 101, endPage: 125 });
    for (let i = 1; i < batches.length; i++) {
      expect(batches[i].startPage).toBe(batches[i - 1].endPage + 1);
    }
  });

  it('maps presets to scale/quality', () => {
    expect(shrinkPresetCfg('light')).toEqual({ scale: 2.0, q: 0.85 });
    expect(shrinkPresetCfg('heavy')).toEqual({ scale: 1.0, q: 0.55 });
    expect(shrinkPresetCfg('medium')).toEqual({ scale: 1.5, q: 0.72 });
    expect(shrinkPresetCfg('bogus')).toEqual({ scale: 1.5, q: 0.72 });
  });
});

describe('chooseCompressPath', () => {
  const MB = 1024 * 1024;
  it('routes small files fast, big lossy files to stream', () => {
    expect(chooseCompressPath(50 * MB, 200 * MB, 'medium', 1024 * MB)).toBe('fast');
    expect(chooseCompressPath(200 * MB, 200 * MB, 'medium', 1024 * MB)).toBe('fast');
    expect(chooseCompressPath(500 * MB, 200 * MB, 'heavy', 1024 * MB)).toBe('stream');
    expect(chooseCompressPath(500 * MB, 200 * MB, 'target', 1024 * MB)).toBe('stream');
  });

  it('refuses lossless over the fast cap and giants over the ceiling', () => {
    expect(chooseCompressPath(500 * MB, 200 * MB, 'lossless', 1024 * MB)).toBe('reject');
    expect(chooseCompressPath(5 * 1024 * MB, 200 * MB, 'medium', 1024 * MB)).toBe('reject');
  });
});

describe('pdf sniffers', () => {
  it('detects version from the header', () => {
    expect(sniffHeader('%PDF-1.7 rest')).toEqual({ isPdf: true, version: '1.7' });
    expect(sniffHeader('garbage')).toEqual({ isPdf: false, version: null });
  });

  it('checks the trailer markers', () => {
    expect(sniffTail('startxref\n123\n%%EOF')).toEqual({ hasStartxref: true, hasEof: true });
    expect(sniffTail('truncated')).toEqual({ hasStartxref: false, hasEof: false });
  });
});

describe('chunk naming', () => {
  it('round-trips part names back to the original', () => {
    expect(chunkFileName('big.pdf', 2)).toBe('big.pdf.part002');
    expect(stripPartSuffix('big.pdf.part002')).toBe('big.pdf');
    expect(rejoinFileName('big.pdf.part001')).toBe('big-rejoined.pdf');
    expect(rejoinFileName('data.bin.part007')).toBe('data.bin-rejoined');
  });
});

describe('inspectLargeFile', () => {
  it('reads head + tail only and reports structure', async () => {
    const body = 'x'.repeat(1000);
    const bytes = new TextEncoder().encode(`%PDF-1.4 head\n${body}\nstartxref\n0\n%%EOF`);
    const blob = new Blob([bytes], { type: 'application/pdf' });
    const file = Object.assign(blob, { name: 'big.pdf' });
    const out = await inspectLargeFile(file, 100);
    expect(out.reportText).toContain('Looks like PDF: yes (v1.4)');
    expect(out.reportText).toContain('%%EOF found');
    expect(out.note).toContain('never entered memory');
  });

  it('flags a truncated trailer', async () => {
    const blob = new Blob(['%PDF-1.4 head\nno trailer here'], { type: 'application/pdf' });
    const out = await inspectLargeFile(Object.assign(blob, { name: 'cut.pdf' }), 100);
    expect(out.reportText).toContain('MISSING');
    expect(out.reportText).toContain('Repair PDF');
  });
});

describe('split → rejoin round-trip', () => {
  it('reassembles byte-identical content from slices', async () => {
    const original = new Uint8Array(1000).map((_, i) => i % 256);
    const file = new Blob([original], { type: 'application/pdf' });
    const plans = planChunks(file.size, 300);
    expect(plans).toHaveLength(4);
    const parts = plans.map((p) => file.slice(p.start, p.end));
    const rejoined = new Blob(parts, { type: 'application/pdf' });
    expect(rejoined.size).toBe(file.size);
    const [a, b] = await Promise.all([rejoined.arrayBuffer(), file.arrayBuffer()]);
    expect(Buffer.from(a).equals(Buffer.from(b))).toBe(true);
  });
});
