import { test, expect } from '@playwright/test';
import JSZip from 'jszip';
import { readFileSync } from 'node:fs';
import {
  fixture, openTool, upload, runForDownload, runForError, pdfInfo, pdfText, setSelect,
} from './helpers';

test.describe('Protect / Unlock', () => {
  test('AES-encrypts, rejects wrong passwords, then unlocks with the right one', async ({ page }) => {
    await openTool(page, 'protect-pdf');
    await upload(page, fixture('sample.pdf'));
    await page.locator('label.field', { hasText: 'Password (4+ characters)' }).locator('input').fill('s3cret-pass');
    const protectedFile = await runForDownload(page, 'protected.pdf');
    const protectedBytes = readFileSync(protectedFile);
    expect(protectedBytes.includes(Buffer.from('/Encrypt'))).toBe(true);

    await openTool(page, 'unlock-pdf');
    await upload(page, protectedFile);
    await page.locator('label.field', { hasText: 'Current password' }).locator('input').fill('wrong-password');
    await runForError(page, /invalid password|password/i);

    await page.locator('label.field', { hasText: 'Current password' }).locator('input').fill('s3cret-pass');
    const unlocked = await runForDownload(page, 'unlocked.pdf');
    expect((await pdfInfo(unlocked)).pages).toBe(3);
    expect((await pdfText(unlocked))[0]).toContain('PDF Haven test page 1');
  });

  test('rejects passwords under 4 characters', async ({ page }) => {
    await openTool(page, 'protect-pdf');
    await upload(page, fixture('sample.pdf'));
    await page.locator('label.field', { hasText: 'Password (4+ characters)' }).locator('input').fill('abc');
    await runForError(page, /at least 4/);
  });

  test('batch-protects multiple PDFs into one ZIP', async ({ page }) => {
    await openTool(page, 'protect-pdf');
    await upload(page, [fixture('sample.pdf'), fixture('sample2.pdf')]);
    await page.locator('label.field', { hasText: 'Password (4+ characters)' }).locator('input').fill('batch-pass');
    const out = await runForDownload(page, 'protected-batch.zip');
    const zip = await JSZip.loadAsync(readFileSync(out));
    const entries = Object.values(zip.files).filter((f) => f.name.endsWith('.pdf'));
    expect(entries).toHaveLength(2);
    for (const entry of entries) {
      const bytes = await entry.async('nodebuffer');
      expect(bytes.includes(Buffer.from('/Encrypt'))).toBe(true);
    }
  });

  test('unlock requires a password', async ({ page }) => {
    await openTool(page, 'unlock-pdf');
    await upload(page, fixture('sample.pdf'));
    await runForError(page, /Enter the current PDF password/);
  });
});

test.describe('Flatten', () => {
  test('flattens a fillable form', async ({ page }) => {
    await openTool(page, 'flatten-pdf');
    await upload(page, fixture('form.pdf'));
    const out = await runForDownload(page, 'flat.pdf');
    const { pages, doc } = await pdfInfo(out);
    expect(pages).toBe(1);
    expect(doc.getForm().getFields()).toHaveLength(0);
  });
});

test.describe('Privacy scanner', () => {
  test('inspect reports metadata without modifying the file', async ({ page }) => {
    await openTool(page, 'remove-pdf-metadata');
    await upload(page, fixture('sample.pdf'));
    const out = await runForDownload(page, 'metadata.txt');
    const text = readFileSync(out, 'utf8');
    expect(text).toContain('Title: Quarterly Report');
    expect(text).toContain('Author: Ada Lovelace');
    expect(text).toContain('Pages: 3');
  });

  test('edit rewrites title, author, subject and keywords', async ({ page }) => {
    await openTool(page, 'remove-pdf-metadata');
    await upload(page, fixture('sample.pdf'));
    await setSelect(page, 'Action', 'edit');
    await page.locator('label.field', { hasText: 'Title' }).locator('input').fill('Clean Title');
    await page.locator('label.field', { hasText: 'Author' }).locator('input').fill('QA Team');
    await page.locator('label.field', { hasText: 'Subject' }).locator('input').fill('Redacted subject');
    await page.locator('label.field', { hasText: 'Keywords' }).locator('input').fill('alpha, beta');
    const out = await runForDownload(page, 'tagged.pdf');
    const { doc } = await pdfInfo(out);
    expect(doc.getTitle()).toBe('Clean Title');
    expect(doc.getAuthor()).toBe('QA Team');
    expect(doc.getSubject()).toBe('Redacted subject');
  });

  test('strip removes all identifying metadata', async ({ page }) => {
    await openTool(page, 'remove-pdf-metadata');
    await upload(page, fixture('sample.pdf'));
    await setSelect(page, 'Action', 'strip');
    const out = await runForDownload(page, 'clean.pdf');
    const { pages, bytes, doc } = await pdfInfo(out);
    expect(pages).toBe(3);
    // pdf-lib re-injects its own default Producer when *reading*, so assert on
    // the raw file bytes (and on fields the reader preserves) instead.
    const raw = bytes.toString('latin1');
    for (const secret of ['Quarterly Report', 'Ada Lovelace', 'E2E fixture', 'fixture-maker', 'pdf-lib (https']) {
      expect(raw).not.toContain(secret);
    }
    expect(doc.getTitle() ?? '').toBe('');
    expect(doc.getAuthor() ?? '').toBe('');
    expect(doc.getSubject() ?? '').toBe('');
  });
});
