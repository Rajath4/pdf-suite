import { describe, expect, it } from 'vitest';
import { runTool } from './actions.js';

const prog = () => {};

function named(blob: Blob, name: string): File {
  return new File([blob], name, { type: 'application/pdf' });
}

describe('large-files tool end to end', () => {
  it('splits into chunks and rejoins byte-identical', async () => {
    const original = new Uint8Array(2500).map((_, i) => (i * 7) % 256);
    const file = named(new Blob([original], { type: 'application/pdf' }), 'giant.pdf');
    const outs = await runTool('large-files', {
      files: [file],
      opts: { mode: 'split', chunkMB: '5' },
      onProgress: prog,
    });
    // 2500 bytes with a 5 MB chunk -> single chunk path.
    expect(outs).toHaveLength(1);
    expect(outs[0].filename).toBe('giant.pdf.part001');

    // Force multi-chunk via the smallest allowed chunk on a bigger blob.
    const big = named(
      new Blob([new Uint8Array(6 * 1024 * 1024).map((_, i) => i % 251)], { type: 'application/pdf' }),
      'big.pdf',
    );
    const parts = await runTool('large-files', {
      files: [big],
      opts: { mode: 'split', chunkMB: '5' },
      onProgress: prog,
    });
    expect(parts.length).toBeGreaterThan(1);
    expect(parts[0].filename).toBe('big.pdf.part001');
    expect(parts[0].note).toContain('NOT valid PDFs');

    const rejoined = await runTool('large-files', {
      files: parts.map((p, i) => named(p.blob, parts[i].filename)),
      opts: { mode: 'join' },
      onProgress: prog,
    });
    expect(rejoined).toHaveLength(1);
    expect(rejoined[0].filename).toBe('big-rejoined.pdf');
    expect(rejoined[0].blob.size).toBe(big.size);
    // Buffer.equals = memcmp (vitest toEqual on MB-sized arrays takes seconds).
    const [a, b] = await Promise.all([
      rejoined[0].blob.arrayBuffer(),
      big.arrayBuffer(),
    ]);
    expect(Buffer.from(a).equals(Buffer.from(b))).toBe(true);
  });

  it('inspects without loading and reports structure', async () => {
    const bytes = new TextEncoder().encode(`%PDF-1.7 hello\n${'z'.repeat(500)}\nstartxref\n0\n%%EOF`);
    const file = named(new Blob([bytes]), 'huge.pdf');
    const outs = await runTool('large-files', {
      files: [file],
      opts: { mode: 'inspect', chunkMB: '100' },
      onProgress: prog,
    });
    expect(outs).toHaveLength(1);
    expect(outs[0].filename).toBe('huge-large-file-report.txt');
    expect(outs[0].previewText).toContain('v1.7');
  });

  it('rejects join with a single file', async () => {
    const file = named(new Blob(['a']), 'x.pdf.part001');
    await expect(
      runTool('large-files', { files: [file], opts: { mode: 'join' }, onProgress: prog }),
    ).rejects.toThrow(/at least 2/i);
  });
});
