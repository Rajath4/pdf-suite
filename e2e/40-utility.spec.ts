import { test, expect } from '@playwright/test';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fixture, openTool, upload, runForDownload, runForDownloads, runForError, pdfInfo, setSelect } from './helpers';

const sha = (buf: Buffer | string) => createHash('sha256').update(buf).digest('hex');

test.describe('Compare', () => {
  test('renders both PDFs side by side with live canvases', async ({ page }) => {
    await openTool(page, 'compare-pdfs');
    await upload(page, [fixture('sample.pdf'), fixture('sample2.pdf')]);
    await expect(page.locator('.compare-col canvas')).toHaveCount(5, { timeout: 120_000 });
    await expect(page.locator('.status')).toHaveAttribute('data-kind', 'ok');
    await expect(page.locator('.compare-col h3').first()).toContainText('sample.pdf');
    await page.getByRole('button', { name: /^Run — / }).click();
    await expect(page.locator('.status')).toContainText('Compare renders live above');
  });
});

test.describe('Repair', () => {
  test('recovers readable pages from a damaged PDF', async ({ page }) => {
    await openTool(page, 'repair-pdf');
    await upload(page, fixture('damaged.pdf'));
    const out = await runForDownload(page, 'repaired.pdf');
    const { pages, bytes } = await pdfInfo(out);
    expect(pages).toBeGreaterThanOrEqual(1);
    expect(bytes.subarray(0, 5).toString('latin1')).toBe('%PDF-');
  });
});

test.describe('Large file split & join', () => {
  test('splits into chunks and rejoins them byte-identically', async ({ page }) => {
    await openTool(page, 'large-file-split-join');
    await upload(page, fixture('large.pdf'));
    await setSelect(page, 'Mode', 'split');
    await page.locator('label.field', { hasText: 'MB per chunk' }).locator('input').fill('5');
    try {
      const chunks = await runForDownloads(page, 2);
      const chunkBuffers = chunks.map((f) => readFileSync(f));
      expect(chunkBuffers.map((b) => sha(b))).not.toEqual([sha(readFileSync(fixture('large.pdf')))]);

      await openTool(page, 'large-file-split-join');
      await upload(page, chunks);
      await setSelect(page, 'Mode', 'join');
      const joined = await runForDownload(page, 'rejoined.pdf');
      expect(sha(readFileSync(joined))).toBe(sha(readFileSync(fixture('large.pdf'))));
      expect(sha(chunkBuffers[0]!)).not.toBe(sha(chunkBuffers[1]!));
      await expect(page.locator('.result')).toContainText('Rejoined 2 chunks');
    } catch (err) {
      const status = await page.locator('.status').textContent().catch(() => '');
      throw new Error(`Large-file split/join failed — status: ${status}. ${String(err)}`);
    }
  });

  test('inspect reads only head and tail', async ({ page }) => {
    await openTool(page, 'large-file-split-join');
    await upload(page, fixture('large.pdf'));
    await setSelect(page, 'Mode', 'inspect');
    const out = await runForDownload(page, 'report.txt');
    const text = readFileSync(out, 'utf8');
    expect(text).toContain('Looks like PDF: yes');
    expect(text).toContain('startxref found');
    expect(text).toContain('Suggested chunks at 100 MB: 1');
    await expect(page.locator('.result')).toContainText('head + tail');
  });

  test('shrink rasterizes a multi-page PDF', async ({ page }) => {
    await openTool(page, 'large-file-split-join');
    await upload(page, fixture('sample.pdf'));
    await setSelect(page, 'Mode', 'shrink');
    await setSelect(page, 'Quality', 'heavy');
    await page.locator('label.field', { hasText: 'Pages per file' }).locator('input').fill('10');
    const out = await runForDownload(page, 'shrunk.pdf');
    const { pages } = await pdfInfo(out);
    expect(pages).toBe(3);
  });

  test('join needs at least two chunks', async ({ page }) => {
    await openTool(page, 'large-file-split-join');
    await upload(page, fixture('sample.pdf'));
    await setSelect(page, 'Mode', 'join');
    await runForError(page, /Upload at least 2 chunk files/);
  });
});

test.describe('Scan to PDF', () => {
  test('falls back gracefully without a camera, then builds a PDF from photos', async ({ page }) => {
    await openTool(page, 'scan-to-pdf');
    await page.getByRole('button', { name: 'Start camera' }).click();
    await expect(page.locator('.status')).toHaveAttribute('data-kind', 'error', { timeout: 30_000 });
    await expect(page.locator('.status')).toContainText('Camera blocked');
    await upload(page, [fixture('photo.png'), fixture('photo2.png')]);
    const out = await runForDownload(page, 'scan.pdf');
    expect((await pdfInfo(out)).pages).toBe(2);
  });
});
