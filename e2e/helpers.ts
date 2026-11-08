import { expect, type Download, type Page } from '@playwright/test';
import { readFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PDFDocument } from 'pdf-lib';

const here = path.dirname(fileURLToPath(import.meta.url));
export const FIXTURES = path.join(here, '.fixtures');
export const DOWNLOADS = path.join(here, '.downloads');

export function fixture(name: string): string {
  return path.join(FIXTURES, name);
}

export function downloadPath(name: string): string {
  mkdirSync(DOWNLOADS, { recursive: true });
  return path.join(DOWNLOADS, `${Date.now()}-${Math.random().toString(36).slice(2)}-${name}`);
}

export async function openTool(page: Page, slug: string): Promise<void> {
  await page.goto(`/${slug}/`);
  await expect(page.locator('main h1').first()).toBeVisible();
}

export async function upload(page: Page, files: string | string[]): Promise<void> {
  const list = Array.isArray(files) ? files : [files];
  await page.locator('.drop input[type=file]').setInputFiles(list);
  await expect(page.locator('.filerow').first()).toBeVisible();
}

/** Upload raw in-memory files (canvas captures etc.). */
export async function uploadBuffers(
  page: Page,
  files: { name: string; mimeType: string; buffer: Buffer }[],
): Promise<void> {
  await page.locator('.drop input[type=file]').setInputFiles(files);
  await expect(page.locator('.filerow').first()).toBeVisible();
}

export function runButton(page: Page) {
  return page.getByRole('button', { name: /^Run — / });
}

/**
 * Click Run and return the single automatic download. Fails the test with the
 * visible status message when the tool reports an error instead.
 */
export async function runForDownload(page: Page, targetName = 'output'): Promise<string> {
  const downloadPromise = page.waitForEvent('download', { timeout: 150_000 });
  await runButton(page).click();
  let download: Download;
  try {
    download = await downloadPromise;
  } catch (err) {
    const status = await page.locator('.status').textContent().catch(() => null);
    throw new Error(`No download after Run. Status: ${status ?? 'unknown'}. ${String(err)}`);
  }
  const target = downloadPath(targetName);
  await download.saveAs(target);
  await expect(page.locator('.status')).toHaveAttribute('data-kind', 'ok', { timeout: 60_000 });
  return target;
}

/** Click Run and wait for result cards, then download each card's file. */
export async function runForDownloads(page: Page, expected: number): Promise<string[]> {
  await runButton(page).click();
  await expect(page.locator('.result')).toHaveCount(expected, { timeout: 180_000 });
  await expect(page.locator('.status')).toHaveAttribute('data-kind', 'ok', { timeout: 60_000 });
  const files: string[] = [];
  for (let i = 0; i < expected; i++) {
    const downloadPromise = page.waitForEvent('download', { timeout: 60_000 });
    await page.locator('.result').nth(i).getByRole('button', { name: 'Download' }).click();
    const download = await downloadPromise;
    const target = downloadPath(download.suggestedFilename());
    await download.saveAs(target);
    files.push(target);
  }
  return files;
}

/** Assert a run fails with a helpful message (negative paths). */
export async function runForError(page: Page, pattern: RegExp): Promise<void> {
  await runButton(page).click();
  await expect(page.locator('.status')).toHaveAttribute('data-kind', 'error', { timeout: 120_000 });
  await expect(page.locator('.status')).toHaveText(pattern);
}

export async function pdfInfo(file: string): Promise<{ pages: number; doc: PDFDocument; bytes: Buffer }> {
  const bytes = readFileSync(file);
  const doc = await PDFDocument.load(new Uint8Array(bytes), { ignoreEncryption: true });
  return { pages: doc.getPageCount(), doc, bytes };
}

export function expectPdfMagic(bytes: Buffer): void {
  expect(bytes.subarray(0, 5).toString('latin1')).toBe('%PDF-');
}

/** Extract per-page text with pdf.js in Node — used to verify real output content. */
export async function pdfText(file: string): Promise<string[]> {
  const { getDocument } = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const data = new Uint8Array(readFileSync(file));
  const doc = await getDocument({ data, useSystemFonts: true, isEvalSupported: false } as never).promise;
  const pages: string[] = [];
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i);
    const content = await page.getTextContent();
    pages.push(
      (content.items as { str?: string }[]).map((item) => item.str ?? '').join(' '),
    );
  }
  await doc.destroy();
  return pages;
}

export async function setText(page: Page, label: RegExp | string, value: string): Promise<void> {
  const field = page.locator('label.field', { hasText: label }).locator('input, textarea, select').first();
  if (typeof value === 'string' && (await field.evaluate((el) => el.tagName === 'SELECT'))) {
    await field.selectOption(value);
  } else {
    await field.fill(value);
  }
}

export async function setSelect(page: Page, label: RegExp | string, value: string): Promise<void> {
  await page.locator('label.field', { hasText: label }).locator('select').first().selectOption(value);
}

/** Install a deterministic PNG signature into localStorage before load. */
export async function primeSignature(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const c = document.createElement('canvas');
    c.width = 200;
    c.height = 80;
    const ctx = c.getContext('2d')!;
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, 200, 80);
    ctx.strokeStyle = '#111827';
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.moveTo(20, 50);
    ctx.bezierCurveTo(60, 10, 100, 70, 180, 30);
    ctx.stroke();
    localStorage.setItem('pdfsuite.signature', c.toDataURL('image/png'));
  });
}
