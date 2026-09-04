import { describe, expect, it } from 'vitest';
import { PDFDocument, StandardFonts } from 'pdf-lib';
import {
  annotatePdf,
  cropPages,
  fillFormFields,
  listFormFields,
  losslessResave,
  markdownToPdf,
  mergePdfs,
  organizePdf,
  parseRanges,
  placeImages,
  rotatePdf,
  slidesToPdf,
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

  it('stamps images and annotations without changing page count', async () => {
    // 1x1 transparent PNG.
    const png = new Uint8Array([
      137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13, 73, 72, 68, 82, 0, 0, 0, 1, 0, 0, 0, 1, 8, 6, 0, 0, 0,
      31, 21, 196, 137, 0, 0, 0, 13, 73, 68, 65, 84, 120, 156, 99, 96, 96, 96, 96, 0, 0, 0, 5, 0, 1, 165,
      164, 250, 81, 0, 0, 0, 0, 73, 69, 78, 68, 174, 66, 96, 130,
    ]);
    const src = await onePagePdf('stamp me');
    const stamped = await placeImages(src, [{ pageIndex: 0, img: png, xPct: 60, yPct: 10, wPct: 25 }]);
    expect((await PDFDocument.load(stamped)).getPageCount()).toBe(1);
    await expect(placeImages(src, [])).rejects.toThrow(UserError);
    await expect(
      placeImages(src, [{ pageIndex: 5, img: png, xPct: 0, yPct: 0, wPct: 10 }]),
    ).rejects.toThrow(UserError);

    const annotated = await annotatePdf(src, [
      { pageIndex: 0, xPct: 10, yPct: 70, text: 'Hello', size: 14, color: { r: 0, g: 0, b: 0 }, bold: true, highlight: false },
      { pageIndex: 0, xPct: 10, yPct: 50, text: 'marked', size: 14, color: { r: 0, g: 0, b: 0 }, bold: false, highlight: true },
    ]);
    expect((await PDFDocument.load(annotated)).getPageCount()).toBe(1);
    await expect(annotatePdf(src, [])).rejects.toThrow(UserError);
  });

  it('crops margins and rejects absurd margins', async () => {
    const src = await onePagePdf('crop me');
    const out = await cropPages(src, { top: 10, bottom: 10, left: 10, right: 10 }, '');
    expect((await PDFDocument.load(out)).getPageCount()).toBe(1);
    await expect(cropPages(src, { top: 50, bottom: 46, left: 0, right: 0 }, '')).rejects.toThrow(UserError);
    await expect(cropPages(src, { top: -1, bottom: 0, left: 0, right: 0 }, '')).rejects.toThrow(UserError);
  });

  it('lists and fills AcroForm fields', async () => {
    const doc = await PDFDocument.create();
    const page = doc.addPage([595, 842]);
    const form = doc.getForm();
    const name = form.createTextField('fullName');
    name.addToPage(page, { x: 50, y: 700, width: 200, height: 24 });
    const agree = form.createCheckBox('agree');
    agree.addToPage(page, { x: 50, y: 650, width: 15, height: 15 });
    const saved = await doc.save();
    const bytes = saved.buffer.slice(saved.byteOffset, saved.byteOffset + saved.byteLength) as ArrayBuffer;

    const fields = await listFormFields(bytes);
    expect(fields.map((f) => f.name).sort()).toEqual(['agree', 'fullName']);
    expect(fields.find((f) => f.name === 'agree')?.type).toBe('checkbox');

    const filled = await fillFormFields(bytes, { fullName: 'Ada Lovelace', agree: 'yes' }, false);
    const check = await PDFDocument.load(filled);
    expect(check.getForm().getTextField('fullName').getText()).toBe('Ada Lovelace');
    expect(check.getForm().getCheckBox('agree').isChecked()).toBe(true);

    // Flattened output stays a valid one-page PDF (fields baked in).
    const flat = await fillFormFields(bytes, { fullName: 'Ada' }, true);
    expect((await PDFDocument.load(flat)).getPageCount()).toBe(1);

    const plain = await onePagePdf('no form here');
    await expect(listFormFields(plain)).resolves.toEqual([]);
    await expect(fillFormFields(plain, {}, true)).rejects.toThrow(UserError);
  });

  it('renders slides to a landscape PDF', async () => {
    const out = await slidesToPdf(
      [
        { texts: ['Title', 'bullet one'], images: [] },
        { texts: [], images: [] },
      ],
      'Deck',
    );
    const doc = await PDFDocument.load(out);
    expect(doc.getPageCount()).toBe(2);
    expect(doc.getPage(0).getSize().width).toBeGreaterThan(doc.getPage(0).getSize().height);
    await expect(slidesToPdf([], 'empty')).rejects.toThrow(UserError);
  });
});
