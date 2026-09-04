import { describe, expect, it } from 'vitest';
import { PDFDocument } from 'pdf-lib';

// Local Node 20 lacks Promise.withResolvers (pdf.js 4.x needs it); all
// supported browsers ship it, so this shim lives in the test env only.
if (typeof (Promise as unknown as { withResolvers?: unknown }).withResolvers !== 'function') {
  (Promise as unknown as Record<string, unknown>).withResolvers = function <T>() {
    let resolve!: (v: T) => void;
    let reject!: (e: unknown) => void;
    const promise = new Promise<T>((res, rej) => {
      resolve = res;
      reject = rej;
    });
    return { promise, resolve, reject };
  };
}

const { openRangedDoc } = await import('./pdfRender.js');
const pdfjs = await import('pdfjs-dist');
const { pathToFileURL } = await import('node:url');
const { createRequire } = await import('node:module');
// Point the fake worker at the real file: pdf.js mis-resolves the path when
// the project dir contains a space (browser builds are unaffected — Vite
// bundles the worker as an asset there).
const require = createRequire(import.meta.url);
pdfjs.GlobalWorkerOptions.workerSrc = pathToFileURL(
  require.resolve('pdfjs-dist/build/pdf.worker.min.mjs'),
).href;

describe('openRangedDoc', () => {
  it('reads page count via on-demand ranges, not a full copy', async () => {
    const { StandardFonts } = await import('pdf-lib');
    const doc = await PDFDocument.create();
    const font = await doc.embedFont(StandardFonts.Helvetica);
    // Unique random text per page defeats Flate, pushing the trailer past the
    // 512 KB initial window — with valid xref offsets throughout.
    const rand = (n: number) =>
      Array.from(crypto.getRandomValues(new Uint8Array(n)), (b) => (b % 36).toString(36)).join('');
    for (let i = 0; i < 700; i++) {
      const page = doc.addPage([300, 300]);
      page.drawText(rand(60) + rand(60) + rand(60) + rand(60) + rand(60) + rand(60), {
        x: 10,
        y: 150,
        size: 6,
        font,
      });
    }
    const bytes = await doc.save({ useObjectStreams: false });
    expect(bytes.length).toBeGreaterThan(512 * 1024);
    const file = new Blob([new Uint8Array(bytes)], { type: 'application/pdf' });
    let rangedBytes = 0;
    const counting = {
      size: file.size,
      slice: (s: number, e: number) => {
        if (s > 0) rangedBytes += Math.max(0, e - s);
        return file.slice(s, e);
      },
    };
    const ranged = await openRangedDoc(counting);
    try {
      expect(ranged.numPages).toBe(700);
      expect(rangedBytes).toBeGreaterThan(0); // trailer came via range fetch
      expect(rangedBytes).toBeLessThan(file.size); // …but most bytes never moved
    } finally {
      await ranged.destroy();
    }
  });
});
