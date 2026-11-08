import { test, expect } from '@playwright/test';
import JSZip from 'jszip';
import mammoth from 'mammoth';
import * as XLSX from 'xlsx';
import { readFileSync } from 'node:fs';
import {
  fixture, openTool, upload, runForDownload, runForDownloads, runForError, pdfInfo, setSelect,
} from './helpers';

test.describe('Word bridge', () => {
  test('PDF to Word produces a readable DOCX', async ({ page }) => {
    await openTool(page, 'pdf-to-word');
    await upload(page, fixture('sample.pdf'));
    const out = await runForDownload(page, 'out.docx');
    const bytes = readFileSync(out);
    expect(bytes.subarray(0, 2).toString('latin1')).toBe('PK');
    const html = await mammoth.convertToHtml({ buffer: bytes });
    expect(html.value).toContain('PDF Haven test page 1');
    expect(html.value).toContain('PDF Haven test page 3');
  });

  test('Word to PDF converts a DOCX', async ({ page }) => {
    await openTool(page, 'word-to-pdf');
    await upload(page, fixture('sample.docx'));
    const out = await runForDownload(page, 'word.pdf');
    expect((await pdfInfo(out)).pages).toBeGreaterThanOrEqual(1);
    await expect(page.locator('.result')).toContainText('E2E Word Document');
  });
});

test.describe('Spreadsheet bridge', () => {
  test('PDF to Excel downloads CSV and XLSX', async ({ page }) => {
    await openTool(page, 'pdf-to-excel');
    await upload(page, fixture('sample.pdf'));
    const [csvFile, xlsxFile] = await runForDownloads(page, 2);
    const csv = readFileSync(csvFile, 'utf8');
    expect(csv).toContain('PDF Haven test page 1');
    const wb = XLSX.read(readFileSync(xlsxFile), { type: 'buffer' });
    const rows = XLSX.utils.sheet_to_json<string[]>(wb.Sheets[wb.SheetNames[0]!]!, { header: 1 });
    expect(rows.flat().join(' ')).toContain('PDF Haven test page 1');
  });

  test('CSV to PDF renders a table', async ({ page }) => {
    await openTool(page, 'excel-to-pdf');
    await upload(page, fixture('sample.csv'));
    const out = await runForDownload(page, 'csv.pdf');
    expect((await pdfInfo(out)).pages).toBe(1);
  });

  test('XLSX to PDF renders a table', async ({ page }) => {
    await openTool(page, 'excel-to-pdf');
    await upload(page, fixture('sample.xlsx'));
    const out = await runForDownload(page, 'xlsx.pdf');
    expect((await pdfInfo(out)).pages).toBe(1);
  });
});

test.describe('Presentation bridge', () => {
  test('PDF to PowerPoint writes one slide per page', async ({ page }) => {
    await openTool(page, 'pdf-to-pptx');
    await upload(page, fixture('sample.pdf'));
    const out = await runForDownload(page, 'slides.pptx');
    const zip = await JSZip.loadAsync(readFileSync(out));
    const slides = Object.keys(zip.files).filter((n) => /^ppt\/slides\/slide\d+\.xml$/.test(n));
    expect(slides).toHaveLength(3);
  });

  test('PowerPoint to PDF converts slides', async ({ page }) => {
    await openTool(page, 'pptx-to-pdf');
    await upload(page, fixture('sample.pptx'));
    const out = await runForDownload(page, 'deck.pdf');
    expect((await pdfInfo(out)).pages).toBe(2);
    await expect(page.locator('.result')).toContainText('2 slides converted');
  });
});

test.describe('Other exports', () => {
  test('PDF to HTML embeds extracted text', async ({ page }) => {
    await openTool(page, 'pdf-to-html');
    await upload(page, fixture('sample.pdf'));
    const out = await runForDownload(page, 'page.html');
    const html = readFileSync(out, 'utf8');
    expect(html).toContain('<!doctype html>');
    expect(html).toContain('PDF Haven test page 1');
  });

  test('Recolor produces a valid grayscale PDF', async ({ page }) => {
    await openTool(page, 'pdf-dark-mode');
    await upload(page, fixture('sample.pdf'));
    await setSelect(page, 'Style', 'grayscale');
    const out = await runForDownload(page, 'gray.pdf');
    const { pages, bytes } = await pdfInfo(out);
    expect(pages).toBe(3);
    expect(bytes.subarray(0, 5).toString('latin1')).toBe('%PDF-');
  });
});

test.describe('Text extraction', () => {
  test('extract text as .txt', async ({ page }) => {
    await openTool(page, 'extract-text');
    await upload(page, fixture('sample.pdf'));
    const out = await runForDownload(page, 'text.txt');
    const text = readFileSync(out, 'utf8');
    expect(text).toContain('===== Page 1 =====');
    expect(text).toContain('PDF Haven test page 1');
    expect(text).toContain('Row 12: alpha beta gamma delta 1');
  });

  test('extract text as Markdown', async ({ page }) => {
    await openTool(page, 'extract-text');
    await upload(page, fixture('sample.pdf'));
    await setSelect(page, 'Output format', 'md');
    const out = await runForDownload(page, 'text.md');
    const md = readFileSync(out, 'utf8');
    expect(md).toContain('PDF Haven test page 1');
  });

  test('scanned PDF without text gets a helpful OCR hint', async ({ page }) => {
    await openTool(page, 'extract-text');
    await upload(page, fixture('image-only.pdf'));
    await runForError(page, /No embedded text found.*OCR/i);
  });
});

test.describe('Create from scratch', () => {
  test('Create PDF needs no upload', async ({ page }) => {
    await openTool(page, 'create-pdf');
    await page.locator('label.field', { hasText: 'Title' }).locator('input').fill('Generated Report');
    await page.locator('label.field', { hasText: 'Body' }).locator('textarea').fill('First paragraph.\n\nSecond paragraph with more detail.');
    const out = await runForDownload(page, 'created.pdf');
    const { pages, doc } = await pdfInfo(out);
    expect(pages).toBeGreaterThanOrEqual(1);
    expect(doc.getTitle()).toBe('Generated Report');
  });

  test('Markdown to PDF renders headings and lists', async ({ page }) => {
    await openTool(page, 'markdown-to-pdf');
    await page.locator('label.field', { hasText: 'Markdown text' }).locator('textarea').fill(
      '# Big Heading\n\n- first\n- second\n\nSome **bold** body text.',
    );
    const out = await runForDownload(page, 'markdown.pdf');
    expect((await pdfInfo(out)).pages).toBeGreaterThanOrEqual(1);
  });

  test('HTML to PDF renders pasted HTML', async ({ page }) => {
    await openTool(page, 'html-to-pdf');
    await page.locator('label.field', { hasText: 'HTML code' }).locator('textarea').fill(
      '<h1>Hello</h1><p>Paste HTML here.</p>',
    );
    const out = await runForDownload(page, 'html.pdf');
    expect((await pdfInfo(out)).pages).toBeGreaterThanOrEqual(1);
    await expect(page.locator('.result')).toContainText('layout simplified');
  });

  test('Markdown from an uploaded .md file', async ({ page }) => {
    await openTool(page, 'markdown-to-pdf');
    await upload(page, fixture('sample.md'));
    const out = await runForDownload(page, 'md-file.pdf');
    expect((await pdfInfo(out)).pages).toBeGreaterThanOrEqual(1);
  });
});
