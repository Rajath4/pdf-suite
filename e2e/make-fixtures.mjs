// Deterministic E2E fixtures. Runs before Playwright; writes into e2e/.fixtures.
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import zlib from 'node:zlib';
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';

const DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '.fixtures');
mkdirSync(DIR, { recursive: true });

const out = (name, data) => {
  writeFileSync(path.join(DIR, name), data);
  return path.join(DIR, name);
};

// ---------- tiny PNG encoder (deterministic, no native deps) ----------
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function pngChunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

function encodePng(width, height, paint) {
  const raw = Buffer.alloc(height * (width * 4 + 1));
  for (let y = 0; y < height; y++) {
    const off = y * (width * 4 + 1);
    raw[off] = 0;
    for (let x = 0; x < width; x++) {
      const [r, g, b, a] = paint(x, y);
      const p = off + 1 + x * 4;
      raw[p] = r;
      raw[p + 1] = g;
      raw[p + 2] = b;
      raw[p + 3] = a;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}

const photoPng = encodePng(240, 160, (x, y) => [
  Math.round((x / 240) * 255),
  80,
  Math.round((y / 160) * 255),
  255,
]);
out('photo.png', photoPng);
out('photo2.png', encodePng(200, 200, (x, y) => (Math.floor(x / 20) + Math.floor(y / 20)) % 2 ? [225, 29, 72, 255] : [255, 255, 255, 255]));
out('logo.png', encodePng(120, 80, (x, y) => {
  const dx = x - 60;
  const dy = y - 40;
  return dx * dx + dy * dy < 32 * 32 ? [17, 24, 39, 255] : [0, 0, 0, 0];
}));

// A real 1x1 JPEG (DCTDecode pass-through path in image extraction).
const jpg1x1 = Buffer.from(
  '/9j/4AAQSkZJRgABAQAASABIAAD/4QBMRXhpZgAATU0AKgAAAAgAAYdpAAQAAAABAAAAGgAAAAAAA6ABAAMAAAABAAEAAKACAAQAAAABAAAAIKADAAQAAAABAAAAIAAAAAD/7QA4UGhvdG9zaG9wIDMuMAA4QklNBAQAAAAAAAA4QklNBCUAAAAAABDUHYzZjwCyBOmACZjs+EJ+/8AAEQgAIAAgAwEiAAIRAQMRAf/EAB8AAAEFAQEBAQEBAAAAAAAAAAABAgMEBQYHCAkKC//EALUQAAIBAwMCBAMFBQQEAAABfQECAwAEEQUSITFBBhNRYQcicRQygZGhCCNCscEVUtHwJDNicoIJChYXGBkaJSYnKCkqNDU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6g4SFhoeIiYqSk5SVlpeYmZqio6Slpqeoqaqys7S1tre4ubrCw8TFxsfIycrS09TV1tfY2drh4uPk5ebn6Onq8fLz9PX29/j5+v/EAB8BAAMBAQEBAQEBAQEAAAAAAAABAgMEBQYHCAkKC//EALURAAIBAgQEAwQHBQQEAAECdwABAgMRBAUhMQYSQVEHYXETIjKBCBRCkaGxwQkjM1LwFWJy0QoWJDThJfEXGBkaJicoKSo1Njc4OTpDREVGR0hJSlNUVVZXWFlaY2RlZmdoaWpzdHV2d3h5eoKDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uLj5OXm5+jp6vLz9PX29/j5+v/bAEMAAgICAgICAwICAwUDAwMFBgUFBQUGCAYGBgYGCAoICAgICAgKCgoKCgoKCgwMDAwMDA4ODg4ODw8PDw8PDw8PD//bAEMBAgICBAQEBwQEBxALCQsQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEP/dAAQAAv/aAAwDAQACEQMRAD8A/J3SfCnT5K9M0nwp935K9K0nwp0+SvTNJ8Kfd+Sv6IzjjHfU8rw249+H3jzbSfCnT5K9M0nwp935K9K0nwp935K9N0nwp0+SvynOeMN9T/QDw249+H3j/9DidJ8Kfd+SvTdJ8KdPkr0nSfCn3fkr03SfCn3fkr53OeMN9T+FPDbj34fePNdJ8Kfd+SvTdJ8Kfd+SvStJ8KdPkr0zSfCnT5K/Kc44x31P9APDbj34feP/2Q==',
  'base64',
);
out('photo.jpg', jpg1x1);

// ---------- PDFs ----------
async function makeSample(name, pages, { image = false, meta = true } = {}) {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  if (meta) {
    doc.setTitle('Quarterly Report');
    doc.setAuthor('Ada Lovelace');
    doc.setSubject('E2E fixture');
    doc.setKeywords(['pdf', 'haven', 'test']);
    doc.setCreator('fixture-maker');
    doc.setProducer('pdf-lib');
    doc.setCreationDate(new Date('2024-01-02T03:04:05Z'));
    doc.setModificationDate(new Date('2024-01-02T03:04:05Z'));
  }
  for (let i = 0; i < pages; i++) {
    const page = doc.addPage([595.28, 841.89]);
    page.drawText(`PDF Haven test page ${i + 1}`, { x: 56, y: 760, size: 24, font: bold, color: rgb(0.1, 0.1, 0.1) });
    page.drawText(`This is page ${i + 1} of ${pages} for end-to-end testing.`, { x: 56, y: 720, size: 12, font });
    for (let row = 0; row < 12; row++) {
      page.drawText(`Row ${row + 1}: alpha beta gamma delta ${i + 1}`, {
        x: 56,
        y: 680 - row * 18,
        size: 10,
        font,
        color: rgb(0.2, 0.2, 0.2),
      });
    }
    if (image && i === 0) {
      const img = await doc.embedPng(photoPng);
      page.drawImage(img, { x: 56, y: 300, width: 240, height: 160 });
    }
    if (image && i === 1) {
      const jpg = await doc.embedJpg(new Uint8Array(jpg1x1));
      page.drawImage(jpg, { x: 300, y: 300, width: 24, height: 24 });
    }
  }
  return out(name, await doc.save({ useObjectStreams: true }));
}

await makeSample('sample.pdf', 3, { image: true });
await makeSample('sample2.pdf', 2);
await makeSample('scanned.pdf', 1, { image: true, meta: false });

// Image-only PDF: no embedded text, used for OCR and "no text" errors.
{
  const doc = await PDFDocument.create();
  const img = await doc.embedPng(photoPng);
  const page = doc.addPage([595.28, 841.89]);
  page.drawImage(img, { x: 56, y: 400, width: 240, height: 160 });
  out('image-only.pdf', await doc.save({ useObjectStreams: true }));
}

// Big-text PDF for OCR accuracy.
{
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.HelveticaBold);
  const page = doc.addPage([595.28, 841.89]);
  page.drawText('HELLO WORLD', { x: 80, y: 600, size: 72, font, color: rgb(0, 0, 0) });
  page.drawText('PDF OCR TEST 123', { x: 80, y: 500, size: 40, font, color: rgb(0, 0, 0) });
  out('ocr-text.pdf', await doc.save({ useObjectStreams: true }));
}

// AcroForm fixture: text + checkbox + dropdown.
{
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const page = doc.addPage([595.28, 841.89]);
  page.drawText('Application form', { x: 56, y: 780, size: 20, font });
  const form = doc.getForm();
  form.createTextField('full_name').addToPage(page, { x: 56, y: 700, width: 300, height: 24 });
  form.createTextField('email').addToPage(page, { x: 56, y: 650, width: 300, height: 24 });
  form.createCheckBox('agree').addToPage(page, { x: 56, y: 600, width: 18, height: 18 });
  const dropdown = form.createDropdown('country');
  dropdown.addOptions(['India', 'Germany', 'United States']);
  dropdown.addToPage(page, { x: 56, y: 550, width: 200, height: 24 });
  out('form.pdf', await doc.save({ useObjectStreams: true }));
}

// Large PDF (>10 MB): one page with an incompressible random-noise PNG so the
// large-file split/join tool has real multi-chunk work to do.
{
  let seed = 0x2f6e2b1;
  const rand = () => {
    seed ^= seed << 13; seed >>>= 0;
    seed ^= seed >>> 17;
    seed ^= seed << 5; seed >>>= 0;
    return seed & 0xff;
  };
  const noise = encodePng(1700, 1700, () => [rand(), rand(), rand(), 255]);
  const doc = await PDFDocument.create();
  const img = await doc.embedPng(noise);
  const page = doc.addPage([595.28, 841.89]);
  page.drawImage(img, { x: 0, y: 0, width: 595.28, height: 841.89 });
  const font = await doc.embedFont(StandardFonts.Helvetica);
  page.drawText('Large file fixture', { x: 56, y: 800, size: 18, font });
  out('large.pdf', await doc.save({ useObjectStreams: false }));
}

// Damaged: overwrite bytes inside a page content stream so the page data is
// corrupt while the xref/trailer remain intact (the recoverable case a repair
// tool is expected to handle; a file with no trailer at all is unrecoverable).
{
  const { readFileSync } = await import('node:fs');
  const good = Buffer.from(readFileSync(path.join(DIR, 'sample.pdf')));
  const marker = good.indexOf('stream\n');
  const at = marker + 7 + 24;
  good.fill(0x58, at, at + 48);
  out('damaged.pdf', good);
}

// ---------- Office / text fixtures ----------
{
  const { Document, Packer, Paragraph, TextRun, HeadingLevel } = await import('docx');
  const doc = new Document({
    sections: [
      {
        children: [
          new Paragraph({ text: 'E2E Word Document', heading: HeadingLevel.HEADING_1 }),
          new Paragraph({ children: [new TextRun('This DOCX was generated for PDF Haven tests.')] }),
          new Paragraph({ text: 'Second paragraph with more content.' }),
        ],
      },
    ],
  });
  out('sample.docx', await Packer.toBuffer(doc));
}

{
  const XLSX = await import('xlsx');
  const ws = XLSX.utils.aoa_to_sheet([
    ['Name', 'Role', 'Score'],
    ['Ada', 'Engineer', '99'],
    ['Grace', 'Admiral', '98'],
  ]);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'People');
  out('sample.xlsx', XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }));
}

{
  const { default: PptxGenJS } = await import('pptxgenjs');
  const pptx = new PptxGenJS();
  pptx.layout = 'LAYOUT_WIDE';
  const slide = pptx.addSlide();
  slide.addText('PDF Haven E2E Deck', { x: 1, y: 1, w: 8, h: 1, fontSize: 28, bold: true });
  slide.addText('Slide body text for PPTX conversion.', { x: 1, y: 2.2, w: 8, h: 1, fontSize: 16 });
  const slide2 = pptx.addSlide();
  slide2.addText('Second slide', { x: 1, y: 1, w: 8, h: 1, fontSize: 24 });
  out('sample.pptx', await pptx.write({ outputType: 'nodebuffer' }));
}

out('sample.csv', 'Name,Role,Score\nAda,Engineer,99\nGrace,Admiral,98\n');
out('sample.md', '# Markdown Title\n\n- one\n- two\n\nSome **bold** text and a [link](https://example.com).\n');
out('sample.html', '<!doctype html><html><body><h1>HTML Fixture</h1><p>Hello from HTML.</p></body></html>');
out('sample.txt', 'Plain text fixture for merge and convert tests.\nSecond line.\n');

console.log(`fixtures ready: ${DIR}`);
