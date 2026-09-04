import { describe, expect, it } from 'vitest';
import { PDFDocument, StandardFonts } from 'pdf-lib';
import {
  losslessResave,
  markdownToPdf,
  mergePdfs,
  organizePdf,
  parseRanges,
  rotatePdf,
  splitPdf,
  tableToPdf,
  textToPdf,
} from './pdfCore.js';
import { UserError } from '../types.js';

async function onePagePdf(text: string): Promise<ArrayBuffer> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  doc.addPage([595, 842]).drawText(text, { x: 50, y: 750, size: 20, font });
  const bytes = await doc.save();
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

function isPdf(data: Uint8Array): boolean {
  return data[0] === 0x25 && data[1] === 0x50 && data[2] === 0x44 && data[3] === 0x46; // %PDF
}

describe('parseRanges', () => {
  it('parses single pages, ranges and lists', () => {
    expect(parseRanges('1-3, 5', 10)).toEqual([0, 1, 2, 4]);
    expect(parseRanges('5', 10)).toEqual([4]);
    expect(parseRanges('3-1', 10)).toEqual([0, 1, 2]); // reversed range normalized
    expect(parseRanges('2,2,3', 10)).toEqual([1, 2]); // deduped
  });

  it('rejects garbage and out-of-bounds pages', () => {
    expect(() => parseRanges('', 10)).toThrow(UserError);
    expect(() => parseRanges('abc', 10)).toThrow(UserError);
    expect(() => parseRanges('0', 10)).toThrow(UserError);
    expect(() => parseRanges('1-99', 10)).toThrow(UserError);
  });
});

describe('pdf engine round-trips', () => {
  it('merges two PDFs into one with both pages', async () => {
    const data = await mergePdfs([await onePagePdf('A'), await onePagePdf('B')]);
    expect(isPdf(data)).toBe(true);
    expect((await PDFDocument.load(data)).getPageCount()).toBe(2);
  });

  it('refuses to merge a single file', async () => {
    await expect(mergePdfs([await onePagePdf('A')])).rejects.toThrow(UserError);
  });

  it('extracts a page range into a new PDF', async () => {
    const three = await mergePdfs([await onePagePdf('1'), await onePagePdf('2'), await onePagePdf('3')]);
    const copy = three.buffer.slice(three.byteOffset, three.byteOffset + three.byteLength) as ArrayBuffer;
    const [part] = await splitPdf(copy, 'keep', '2-3');
    expect((await PDFDocument.load(part.data)).getPageCount()).toBe(2);
  });

  it('rotates without changing page count', async () => {
    const src = await onePagePdf('rot');
    const out = await rotatePdf(src, 90, '');
    expect((await PDFDocument.load(out)).getPageCount()).toBe(1);
  });

  it('reorders pages per plan', async () => {
    const src = await mergePdfs([await onePagePdf('1'), await onePagePdf('2')]);
    const copy = src.buffer.slice(src.byteOffset, src.byteOffset + src.byteLength) as ArrayBuffer;
    const out = await organizePdf(copy, { order: [1, 0], rotations: {} });
    expect((await PDFDocument.load(out)).getPageCount()).toBe(2);
  });

  it('refuses to delete every page', async () => {
    const src = await onePagePdf('x');
    await expect(organizePdf(src, { order: [], rotations: {} })).rejects.toThrow(UserError);
  });

  it('re-saves losslessly', async () => {
    const out = await losslessResave(await onePagePdf('plain'));
    expect(isPdf(out)).toBe(true);
  });

  it('builds documents from text, markdown and tables', async () => {
    expect(isPdf(await textToPdf({ title: 'T', body: 'hello\n\nworld', fontSize: 12, lineHeight: 1.5 }))).toBe(true);
    expect(isPdf(await markdownToPdf('# Hi\n\n- a\n- b\n'))).toBe(true);
    expect(
      isPdf(await tableToPdf({ headers: ['A', 'B'], rows: [['1', '2']] }, 'Sheet')),
    ).toBe(true);
    await expect(markdownToPdf('   ')).rejects.toThrow(UserError);
  });
});
