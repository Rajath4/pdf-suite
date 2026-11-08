import { test, expect } from '@playwright/test';
import JSZip from 'jszip';
import { readFileSync } from 'node:fs';
import { fixture, openTool, upload, runForDownload, runForError } from './helpers';

test.describe('Keyboard & drag-drop', () => {
  test('Cmd/Ctrl+Enter runs the current tool', async ({ page }) => {
    await openTool(page, 'rotate-pdf');
    await upload(page, fixture('sample.pdf'));
    const downloadPromise = page.waitForEvent('download', { timeout: 120_000 });
    await page.keyboard.press('ControlOrMeta+Enter');
    const download = await downloadPromise;
    expect(download.suggestedFilename()).toMatch(/rotated\.pdf$/);
    await expect(page.locator('.status')).toHaveAttribute('data-kind', 'ok');
  });

  test('dropping files adds each file exactly once (no window bubble duplicate)', async ({ page }) => {
    await openTool(page, 'merge-pdf');
    const files = [
      { name: 'one.pdf', type: 'application/pdf', b64: readFileSync(fixture('sample.pdf')).toString('base64') },
      { name: 'two.pdf', type: 'application/pdf', b64: readFileSync(fixture('sample2.pdf')).toString('base64') },
    ];
    await page.evaluate((payload) => {
      const dt = new DataTransfer();
      for (const f of payload) {
        const bin = atob(f.b64);
        const arr = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
        dt.items.add(new File([arr], f.name, { type: f.type }));
      }
      document.querySelector('.drop')!.dispatchEvent(
        new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: dt }),
      );
    }, files);
    await expect(page.locator('.filelist .filerow')).toHaveCount(2);
    await expect(page.locator('.filelist')).not.toContainText('one.pdf, one.pdf');
  });
});

test.describe('File-first homepage & chaining', () => {
  test('stage a file, pick a tool, land with it loaded', async ({ page }) => {
    await page.goto('/');
    await page.locator('.stage input[type=file]').setInputFiles(fixture('sample.pdf'));
    const card = page.locator('.stage-card');
    await expect(card).toBeVisible();
    await expect(card).toContainText('1 file staged');
    await card.getByRole('button', { name: /Compress PDF/ }).click();
    await expect(page).toHaveURL(/\/compress-pdf\/$/);
    await expect(page.locator('.filelist .filerow')).toHaveCount(1);
    await expect(page.locator('.status')).toContainText('Loaded 1 file');
  });

  test('Continue-in chip carries the output into the next tool', async ({ page }) => {
    await openTool(page, 'compress-pdf');
    await upload(page, fixture('sample.pdf'));
    await runForDownload(page, 'compressed.pdf');
    await page.locator('.related').getByRole('button', { name: /Merge PDFs/ }).click();
    await expect(page).toHaveURL(/\/merge-pdf\/$/);
    await expect(page.locator('.filelist .filerow')).toHaveCount(1);
    await expect(page.locator('.status')).toContainText('Loaded 1 file');
  });
});

test.describe('SEO navigation', () => {
  test('category hubs link from the homepage and render their tools', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('link', { name: /^Essentials · 6$/ }).click();
    await expect(page).toHaveURL(/\/tools\/essentials\/$/);
    await expect(page.locator('h1')).toContainText('Essential PDF Tools');
    await expect(page.locator('main .card')).toHaveCount(6);
    await expect(page.locator('link[rel="canonical"]')).toHaveAttribute(
      'href',
      'https://pdfhaven.app/tools/essentials/',
    );
  });

  test('tools directory and trust pages are reachable and self-canonical', async ({ page }) => {
    await page.goto('/tools/');
    await expect(page.locator('h1')).toContainText(`All 37 Free PDF Tools`);
    await expect(page.locator('main .card').first()).toBeVisible();
    await page.getByRole('link', { name: 'About PDF Haven' }).first().click();
    await expect(page).toHaveURL(/\/about\/$/);
    await expect(page.locator('h1')).toContainText('About PDF Haven');
    await page.goto('/privacy/');
    await expect(page.locator('h1')).toContainText('Privacy Policy');
    await expect(page.locator('link[rel="canonical"]')).toHaveAttribute(
      'href',
      'https://pdfhaven.app/privacy/',
    );
  });
});

test.describe('Robustness', () => {
  test('batch isolates a corrupt file and still returns successes', async ({ page }) => {
    await openTool(page, 'compress-pdf');
    await upload(page, [fixture('sample.pdf'), fixture('sample.txt')]);
    const downloadPromise = page.waitForEvent('download', { timeout: 150_000 });
    await page.getByRole('button', { name: /^Run — / }).click();
    const download = await downloadPromise;
    const target = test.info().outputPath('batch.zip');
    await download.saveAs(target);
    const status = page.locator('.status');
    await expect(status).toHaveAttribute('data-kind', 'error');
    await expect(status).toContainText('Done with issues — 1 ok, 1 failed');
    await expect(page.locator('.result')).toContainText('sample.txt');
    const zip = await JSZip.loadAsync(readFileSync(target));
    const pdfs = Object.values(zip.files).filter((f) => f.name.endsWith('.pdf'));
    expect(pdfs).toHaveLength(1);
    const bytes = await pdfs[0]!.async('nodebuffer');
    expect(bytes.subarray(0, 5).toString('latin1')).toBe('%PDF-');
  });

  test('a non-PDF upload fails cleanly, not silently', async ({ page }) => {
    await openTool(page, 'compress-pdf');
    await upload(page, fixture('sample.txt'));
    await runForError(page, /PDF header|Failed to parse|Could not read|Invalid PDF structure/i);
  });

  test('recents and recently used populate after a run', async ({ page }) => {
    await openTool(page, 'rotate-pdf');
    await upload(page, fixture('sample.pdf'));
    await runForDownload(page, 'rotated.pdf');
    await page.goto('/');
    const recents = page.locator('section.cat.recent');
    await expect(recents).toBeVisible();
    await expect(recents).toContainText('Rotate PDF');
  });
});
