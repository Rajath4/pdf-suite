import { test, expect } from '@playwright/test';
import JSZip from 'jszip';
import { readFileSync } from 'node:fs';
import {
  fixture, openTool, upload, runForDownload, runForError, pdfInfo, pdfText, primeSignature, setSelect,
} from './helpers';

test.describe('Organize pages', () => {
  test('delete, rotate and reorder thumbnails, then export', async ({ page }) => {
    await openTool(page, 'organize-pages');
    await upload(page, fixture('sample.pdf'));
    await expect(page.locator('.thumb')).toHaveCount(3, { timeout: 60_000 });
    await page.locator('.thumb').nth(1).getByTitle('Delete page').click();
    await expect(page.locator('.thumb')).toHaveCount(2);
    await page.locator('.thumb').first().getByTitle('Rotate 90°').click();
    await page.locator('.thumb').first().getByTitle('Move right').click();
    const out = await runForDownload(page, 'organized.pdf');
    const { pages, doc } = await pdfInfo(out);
    expect(pages).toBe(2);
    expect(doc.getPage(0).getRotation().angle).toBe(0);
    expect(doc.getPage(1).getRotation().angle).toBe(90);
    // Deleted page 2, then rotated page 1 and moved it after page 3.
    const texts = await pdfText(out);
    expect(texts[0]).toContain('PDF Haven test page 3');
    expect(texts[1]).toContain('PDF Haven test page 1');
  });

  test('refuses to delete every page', async ({ page }) => {
    await openTool(page, 'organize-pages');
    await upload(page, fixture('sample2.pdf'));
    await expect(page.locator('.thumb')).toHaveCount(2, { timeout: 60_000 });
    await page.locator('.thumb').nth(0).getByTitle('Delete page').click();
    await page.locator('.thumb').nth(0).getByTitle('Delete page').click();
    await runForError(page, /Delete all pages/);
  });
});

test.describe('Sign', () => {
  test('stamps a saved signature at a placement', async ({ page }) => {
    await primeSignature(page);
    await openTool(page, 'sign-pdf');
    await upload(page, fixture('sample.pdf'));
    await page.getByRole('button', { name: 'Add placement' }).click();
    await expect(page.locator('.filerow', { hasText: '#1: page 1' })).toBeVisible();
    const out = await runForDownload(page, 'signed.pdf');
    const { pages, bytes } = await pdfInfo(out);
    expect(pages).toBe(3);
    expect(bytes.length).toBeGreaterThan(1000);
  });

  test('requires a signature before running', async ({ page }) => {
    await openTool(page, 'sign-pdf');
    await upload(page, fixture('sample.pdf'));
    await page.getByRole('button', { name: 'Add placement' }).click();
    await runForError(page, /Create your signature first/);
  });
});

test.describe('Annotate', () => {
  test('adds text and highlight annotations', async ({ page }) => {
    await openTool(page, 'edit-pdf');
    await upload(page, fixture('sample.pdf'));
    await expect(page.locator('.redact-form')).toBeVisible();
    await page.locator('.redact-form input[type="text"]').fill('Reviewed by QA');
    await page.getByRole('button', { name: 'Add annotation' }).click();
    await page.locator('.redact-form select').first().selectOption('highlight');
    await page.locator('.redact-form input[type="text"]').fill('Important line');
    await page.getByRole('button', { name: 'Add annotation' }).click();
    await expect(page.locator('.live .filerow')).toHaveCount(2);
    const out = await runForDownload(page, 'annotated.pdf');
    expect((await pdfInfo(out)).pages).toBe(3);
    const pages = await pdfText(out);
    expect(pages.join(' ')).toContain('Reviewed by QA');
  });

  test('rejects an empty annotation list', async ({ page }) => {
    await openTool(page, 'edit-pdf');
    await upload(page, fixture('sample.pdf'));
    await runForError(page, /Add at least one annotation/);
  });
});

test.describe('Crop', () => {
  test('trims 10% from every edge and updates the page boxes', async ({ page }) => {
    await openTool(page, 'crop-pdf');
    await upload(page, fixture('sample.pdf'));
    for (const label of ['Trim from top %', 'Trim from bottom %', 'Trim from left %', 'Trim from right %']) {
      await page.locator('label.field', { hasText: label }).locator('input').fill('10');
    }
    const out = await runForDownload(page, 'cropped.pdf');
    const { pages, doc } = await pdfInfo(out);
    expect(pages).toBe(3);
    const box = doc.getPage(0).getCropBox();
    expect(box.width).toBeCloseTo(595.28 * 0.8, 0);
    expect(box.height).toBeCloseTo(841.89 * 0.8, 0);
  });

  test('rejects impossible margins', async ({ page }) => {
    await openTool(page, 'crop-pdf');
    await upload(page, fixture('sample.pdf'));
    for (const label of ['Trim from top %', 'Trim from bottom %']) {
      await page.locator('label.field', { hasText: label }).locator('input').fill('60');
    }
    await runForError(page, /too large/);
  });
});

test.describe('Fill forms', () => {
  test('fills text, checkbox and dropdown, then flattens', async ({ page }) => {
    await openTool(page, 'fill-pdf-forms');
    await upload(page, fixture('form.pdf'));
    await expect(page.locator('.live .opts label.field')).toHaveCount(4, { timeout: 30_000 });
    await page.locator('label.field', { hasText: 'full_name' }).locator('input').fill('Ada Lovelace');
    await page.locator('label.field', { hasText: 'email' }).locator('input').fill('ada@example.com');
    await page.locator('label.field', { hasText: 'agree' }).locator('select').selectOption('yes');
    await page.locator('label.field', { hasText: 'country' }).locator('select').selectOption('Germany');
    const out = await runForDownload(page, 'filled.pdf');
    const { pages, doc } = await pdfInfo(out);
    expect(pages).toBe(1);
    expect(doc.getForm().getFields()).toHaveLength(0);
    const text = (await pdfText(out)).join(' ');
    expect(text).toContain('Ada Lovelace');
    expect(text).toContain('ada@example.com');
    expect(text).toContain('Germany');
  });

  test('explains when a PDF has no form fields', async ({ page }) => {
    await openTool(page, 'fill-pdf-forms');
    await upload(page, fixture('sample.pdf'));
    await expect(page.locator('.live')).toContainText('No fillable form fields found');
  });
});

test.describe('Rotate', () => {
  test('rotates every page by 90 degrees', async ({ page }) => {
    await openTool(page, 'rotate-pdf');
    await upload(page, fixture('sample.pdf'));
    const out = await runForDownload(page, 'rotated.pdf');
    const { pages, doc } = await pdfInfo(out);
    expect(pages).toBe(3);
    for (let i = 0; i < pages; i++) expect(doc.getPage(i).getRotation().angle).toBe(90);
  });

  test('batch-rotates multiple PDFs into one ZIP', async ({ page }) => {
    await openTool(page, 'rotate-pdf');
    await upload(page, [fixture('sample.pdf'), fixture('sample2.pdf')]);
    await setSelect(page, 'Rotation', '180');
    const out = await runForDownload(page, 'rotated-batch.zip');
    const zip = await JSZip.loadAsync(readFileSync(out));
    const entries = Object.values(zip.files).filter((f) => f.name.endsWith('.pdf'));
    expect(entries).toHaveLength(2);
    for (const entry of entries) {
      const info = await pdfInfo(await writeTemp(entry.name, await entry.async('nodebuffer')));
      for (let i = 0; i < info.pages; i++) expect(info.doc.getPage(i).getRotation().angle).toBe(180);
    }
  });
});

async function writeTemp(name: string, buf: Buffer): Promise<string> {
  const { writeFileSync } = await import('node:fs');
  const path = await import('node:path');
  const target = path.join('/tmp', `pdf-haven-e2e-${Date.now()}-${name.replace(/[^\w.-]/g, '_')}`);
  writeFileSync(target, buf);
  return target;
}

test.describe('Watermark', () => {
  test('stamps a text watermark', async ({ page }) => {
    await openTool(page, 'add-watermark');
    await upload(page, fixture('sample.pdf'));
    await page.locator('label.field', { hasText: 'Text to stamp' }).locator('input').fill('DRAFT ONLY');
    const out = await runForDownload(page, 'watermarked.pdf');
    const { pages } = await pdfInfo(out);
    expect(pages).toBe(3);
    for (const text of await pdfText(out)) expect(text).toContain('DRAFT ONLY');
  });

  test('stamps an uploaded logo in image mode', async ({ page }) => {
    await openTool(page, 'add-watermark');
    await upload(page, fixture('sample.pdf'));
    await setSelect(page, 'Kind', 'image');
    const chooser = page.waitForEvent('filechooser');
    await page.getByRole('button', { name: 'Upload logo image' }).click();
    await (await chooser).setFiles(fixture('logo.png'));
    await expect(page.locator('.live')).toContainText('Logo ready');
    const out = await runForDownload(page, 'logo-watermarked.pdf');
    expect((await pdfInfo(out)).pages).toBe(3);
  });
});

test.describe('Page furniture', () => {
  test('adds page numbers', async ({ page }) => {
    await openTool(page, 'add-page-numbers');
    await upload(page, fixture('sample.pdf'));
    await setSelect(page, 'Format', 'page-n-of-N');
    const out = await runForDownload(page, 'numbered.pdf');
    const { pages } = await pdfInfo(out);
    expect(pages).toBe(3);
    const texts = await pdfText(out);
    expect(texts[0]).toContain('Page 1 of 3');
    expect(texts[2]).toContain('Page 3 of 3');
  });

  test('adds headers and footers', async ({ page }) => {
    await openTool(page, 'headers-footers');
    await upload(page, fixture('sample.pdf'));
    await page.locator('label.field', { hasText: 'Header' }).locator('input').fill('Quarterly {page}');
    const out = await runForDownload(page, 'header-footer.pdf');
    const { pages } = await pdfInfo(out);
    expect(pages).toBe(3);
    const texts = await pdfText(out);
    expect(texts[0]).toContain('Quarterly 1');
    expect(texts[1]).toContain('Quarterly 2');
    expect(texts[2]).toContain('Quarterly 3');
  });
});

test.describe('Redact', () => {
  test('removes covered text from the file, not just visually', async ({ page }) => {
    await openTool(page, 'redact-pdf');
    await upload(page, fixture('sample.pdf'));
    // Cover the 24pt page title: x 5%, 88% up from the bottom, 90% wide.
    await page.locator('label', { hasText: 'From left %' }).locator('input').fill('5');
    await page.locator('label', { hasText: 'From bottom %' }).locator('input').fill('88');
    await page.locator('label', { hasText: 'Width %' }).locator('input').fill('90');
    await page.getByRole('button', { name: 'Add black box' }).click();
    await expect(page.locator('.filerow', { hasText: 'Box 1' })).toBeVisible();
    const out = await runForDownload(page, 'redacted.pdf');
    const { pages } = await pdfInfo(out);
    expect(pages).toBe(3);
    const texts = await pdfText(out);
    // The redacted page is rasterized, so it has no selectable text at all.
    expect(texts[0]!.trim()).toBe('');
    expect(texts[1]).toContain('PDF Haven test page 2');
    expect(texts[2]).toContain('PDF Haven test page 3');
  });

  test('bakes a black box into the page', async ({ page }) => {
    await openTool(page, 'redact-pdf');
    await upload(page, fixture('sample.pdf'));
    await page.getByRole('button', { name: 'Add black box' }).click();
    await expect(page.locator('.filerow', { hasText: 'Box 1' })).toBeVisible();
    const out = await runForDownload(page, 'redacted.pdf');
    expect((await pdfInfo(out)).pages).toBe(3);
  });

  test('rejects a run with no boxes', async ({ page }) => {
    await openTool(page, 'redact-pdf');
    await upload(page, fixture('sample.pdf'));
    await runForError(page, /Add at least one redaction box/);
  });
});
