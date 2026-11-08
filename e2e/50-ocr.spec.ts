import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { fixture, openTool, upload, runForDownloads } from './helpers';

test.describe('OCR', () => {
  test('recognizes text and returns searchable text + PDF', async ({ page }) => {
    test.setTimeout(300_000);
    await openTool(page, 'ocr-pdf');
    await upload(page, fixture('ocr-text.pdf'));
    const [txtFile, pdfFile] = await runForDownloads(page, 2);
    const text = readFileSync(txtFile, 'utf8');
    expect(text).toMatch(/HELLO\s+WORL[Dl]/i);
    expect(text).toMatch(/PDF\s+OCR\s+TEST\s+123/i);
    expect(text).toContain('===== Page 1 =====');
    const pdfBytes = readFileSync(pdfFile);
    expect(pdfBytes.subarray(0, 5).toString('latin1')).toBe('%PDF-');
    expect(pdfBytes.length).toBeGreaterThan(1000);
    await expect(page.locator('.result').first()).toContainText('ocr');
  });
});
