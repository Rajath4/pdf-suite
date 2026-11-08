import { test, expect } from '@playwright/test';
import JSZip from 'jszip';
import { readFileSync } from 'node:fs';
import {
  fixture, openTool, upload, uploadBuffers, runForDownload, runForDownloads, runForError,
  pdfInfo, pdfText, expectPdfMagic, setSelect,
} from './helpers';

test.describe('Merge', () => {
  test('merges two PDFs honouring per-file page ranges', async ({ page }) => {
    await openTool(page, 'merge-pdf');
    await upload(page, [fixture('sample.pdf'), fixture('sample2.pdf')]);
    await page.locator('.range-inline').first().fill('1-2');
    const out = await runForDownload(page, 'merged.pdf');
    const { pages, doc } = await pdfInfo(out);
    expect(pages).toBe(4);
    expect(doc.getTitle()).toBe('Quarterly Report');
  });

  test('merges mixed formats: PDF + image + text file', async ({ page }) => {
    await openTool(page, 'merge-pdf');
    await upload(page, [fixture('sample.pdf'), fixture('photo.png'), fixture('sample.txt')]);
    const out = await runForDownload(page, 'mixed-merged.pdf');
    const { pages } = await pdfInfo(out);
    expect(pages).toBe(5);
    await expect(page.locator('.result')).toContainText('converted with simplified layout');
  });

  test('converts a Word document while merging', async ({ page }) => {
    await openTool(page, 'merge-pdf');
    await upload(page, [fixture('sample.pdf'), fixture('sample.docx')]);
    const out = await runForDownload(page, 'docx-merged.pdf');
    expect((await pdfInfo(out)).pages).toBe(4);
  });
});

test.describe('Split', () => {
  test('extracts a range into a single PDF', async ({ page }) => {
    await openTool(page, 'split-pdf');
    await upload(page, fixture('sample.pdf'));
    await page.locator('label.field', { hasText: 'Pages — which ones' }).locator('input').fill('1-2');
    const out = await runForDownload(page, 'split.pdf');
    expect((await pdfInfo(out)).pages).toBe(2);
    const texts = await pdfText(out);
    expect(texts[0]).toContain('PDF Haven test page 1');
    expect(texts[1]).toContain('PDF Haven test page 2');
  });

  test('rejects page numbers beyond the document', async ({ page }) => {
    await openTool(page, 'split-pdf');
    await upload(page, fixture('sample.pdf'));
    await page.locator('label.field', { hasText: 'Pages — which ones' }).locator('input').fill('5');
    await runForError(page, /between 1 and 3/);
  });

  test('keeps only the selected pages', async ({ page }) => {
    await openTool(page, 'split-pdf');
    await upload(page, fixture('sample.pdf'));
    await setSelect(page, 'Mode', 'keep');
    await page.locator('label.field', { hasText: 'Pages — which ones' }).locator('input').fill('2');
    const out = await runForDownload(page, 'kept.pdf');
    expect((await pdfInfo(out)).pages).toBe(1);
    expect((await pdfText(out))[0]).toContain('PDF Haven test page 2');
  });

  test('exports every page as its own PDF in a ZIP', async ({ page }) => {
    await openTool(page, 'split-pdf');
    await upload(page, fixture('sample.pdf'));
    await setSelect(page, 'Mode', 'each');
    const out = await runForDownload(page, 'pages.zip');
    const zip = await JSZip.loadAsync(readFileSync(out));
    const pdfs = Object.values(zip.files).filter((f) => f.name.endsWith('.pdf'));
    expect(pdfs).toHaveLength(3);
    for (const entry of pdfs) {
      const buf = await entry.async('nodebuffer');
      expectPdfMagic(buf);
    }
  });

  test('chunks every N pages into a ZIP', async ({ page }) => {
    await openTool(page, 'split-pdf');
    await upload(page, fixture('sample.pdf'));
    await setSelect(page, 'Mode', 'chunks');
    await page.locator('label.field', { hasText: 'Pages per file' }).locator('input').fill('2');
    const out = await runForDownload(page, 'chunks.zip');
    const zip = await JSZip.loadAsync(readFileSync(out));
    const pdfs = Object.values(zip.files).filter((f) => f.name.endsWith('.pdf'));
    expect(pdfs).toHaveLength(2);
  });

  test('splits odd and even pages into two downloads', async ({ page }) => {
    await openTool(page, 'split-pdf');
    await upload(page, fixture('sample.pdf'));
    await setSelect(page, 'Mode', 'oddeven');
    const outs = await runForDownloads(page, 2);
    const counts = await Promise.all(outs.map(async (f) => (await pdfInfo(f)).pages));
    expect(counts.sort()).toEqual([1, 2]);
  });

  test('splits by target size', async ({ page }) => {
    await openTool(page, 'split-pdf');
    await upload(page, fixture('sample.pdf'));
    await setSelect(page, 'Mode', 'bysize');
    await page.locator('label.field', { hasText: 'MB per file' }).locator('input').fill('5');
    const out = await runForDownload(page, 'bysize.pdf');
    expect((await pdfInfo(out)).pages).toBe(3);
    await expect(page.locator('.result')).toContainText('Already under the target');
  });
});

test.describe('Compress', () => {
  test('medium preset produces a valid rasterized PDF', async ({ page }) => {
    await openTool(page, 'compress-pdf');
    await upload(page, fixture('sample.pdf'));
    await setSelect(page, 'Preset', 'medium');
    const out = await runForDownload(page, 'compressed.pdf');
    expect((await pdfInfo(out)).pages).toBe(3);
    await expect(page.locator('.result')).toContainText('Rasterized');
  });

  test('lossless preset keeps a valid PDF', async ({ page }) => {
    await openTool(page, 'compress-pdf');
    await upload(page, fixture('sample.pdf'));
    await setSelect(page, 'Preset', 'lossless');
    const out = await runForDownload(page, 'lossless.pdf');
    expect((await pdfInfo(out)).pages).toBe(3);
    // Lossless means no rasterization: selectable text must survive.
    expect((await pdfText(out))[0]).toContain('PDF Haven test page 1');
  });

  test('target-size preset hits the requested ceiling', async ({ page }) => {
    await openTool(page, 'compress-pdf');
    await upload(page, fixture('sample.pdf'));
    await setSelect(page, 'Preset', 'target');
    await page.locator('label.field', { hasText: 'Target size in MB' }).locator('input').fill('0.1');
    const out = await runForDownload(page, 'target.pdf');
    const bytes = readFileSync(out);
    expect(bytes.length).toBeLessThanOrEqual(0.1 * 1024 * 1024);
    expect((await pdfInfo(out)).pages).toBe(3);
  });

  test('batches multiple files into one ZIP', async ({ page }) => {
    await openTool(page, 'compress-pdf');
    await upload(page, [fixture('sample.pdf'), fixture('sample2.pdf')]);
    const out = await runForDownload(page, 'batch.zip');
    const zip = await JSZip.loadAsync(readFileSync(out));
    expect(Object.values(zip.files).filter((f) => f.name.endsWith('.pdf'))).toHaveLength(2);
  });
});

test.describe('Raster export', () => {
  test('PDF to JPG exports a multi-page ZIP', async ({ page }) => {
    await openTool(page, 'pdf-to-jpg');
    await upload(page, fixture('sample.pdf'));
    const out = await runForDownload(page, 'images.zip');
    const zip = await JSZip.loadAsync(readFileSync(out));
    const images = Object.values(zip.files).filter((f) => /\.(jpg|jpeg)$/i.test(f.name));
    expect(images).toHaveLength(3);
    const buf = await images[0]!.async('nodebuffer');
    expect(buf.subarray(0, 2).toString('hex')).toBe('ffd8');
  });

  test('single-page PDF to PNG downloads one image', async ({ page }) => {
    await openTool(page, 'pdf-to-jpg');
    await upload(page, fixture('image-only.pdf'));
    await setSelect(page, 'Image format', 'png');
    const out = await runForDownload(page, 'image.png');
    const buf = readFileSync(out);
    expect(buf.subarray(1, 4).toString('latin1')).toBe('PNG');
  });

  test('extract-images pulls embedded PNG and JPEG streams', async ({ page }) => {
    await openTool(page, 'extract-images');
    await upload(page, fixture('sample.pdf'));
    const out = await runForDownload(page, 'embedded.zip');
    const zip = await JSZip.loadAsync(readFileSync(out));
    const names = Object.values(zip.files).map((f) => f.name);
    expect(names.some((n) => n.endsWith('.jpg'))).toBe(true);
    expect(names.some((n) => n.endsWith('.png'))).toBe(true);
  });

  test('images-to-pdf builds one page per image', async ({ page }) => {
    await openTool(page, 'images-to-pdf');
    await upload(page, [fixture('photo.png'), fixture('photo.jpg'), fixture('photo2.png')]);
    const out = await runForDownload(page, 'images.pdf');
    expect((await pdfInfo(out)).pages).toBe(3);
  });

  test('images-to-pdf accepts WebP uploads', async ({ page }) => {
    await openTool(page, 'images-to-pdf');
    const webp = await page.evaluate(async () => {
      const c = document.createElement('canvas');
      c.width = 120;
      c.height = 80;
      const ctx = c.getContext('2d')!;
      ctx.fillStyle = '#0ea5e9';
      ctx.fillRect(0, 0, 120, 80);
      const blob = await new Promise<Blob | null>((r) => c.toBlob(r, 'image/webp'));
      const buf = new Uint8Array(await blob!.arrayBuffer());
      let bin = '';
      for (const b of buf) bin += String.fromCharCode(b);
      return btoa(bin);
    });
    await uploadBuffers(page, [
      { name: 'canvas.webp', mimeType: 'image/webp', buffer: Buffer.from(webp, 'base64') },
    ]);
    const out = await runForDownload(page, 'webp.pdf');
    expect((await pdfInfo(out)).pages).toBe(1);
  });
});
