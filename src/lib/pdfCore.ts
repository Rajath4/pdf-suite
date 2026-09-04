/**
 * Core PDF manipulation built on pdf-lib.
 * Every function is pure: (bytes in) -> (bytes out).
 * UI code lives elsewhere.
 */
import {
  PDFDocument,
  StandardFonts,
  degrees,
  rgb,
  type PDFFont,
  type PDFPage,
} from 'pdf-lib';
import { UserError } from '../types.js';

export async function loadPdf(bytes: ArrayBuffer, password?: string): Promise<PDFDocument> {
  try {
    return await PDFDocument.load(bytes, {
      // pdf-lib v1 ignores unknown options at runtime; keep minimal + safe.
      ...(password ? { password } : {}),
      ignoreEncryption: false,
    } as Parameters<typeof PDFDocument.load>[1]);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (/password|encrypt|decrypt/i.test(msg)) {
      throw new UserError(
        'This PDF is password-protected. Remove the password first (Security → Unlock PDF), or enter it where the tool asks for it.',
      );
    }
    throw new UserError(`Could not read PDF (${msg}). Try Tools → Repair PDF.`);
  }
}

export async function mergePdfs(filesBytes: ArrayBuffer[]): Promise<Uint8Array> {
  if (filesBytes.length < 2) throw new UserError('Select at least 2 PDFs to merge.');
  const out = await PDFDocument.create();
  for (const bytes of filesBytes) {
    const src = await loadPdf(bytes);
    const pages = await out.copyPages(src, src.getPageIndices());
    pages.forEach((p) => out.addPage(p));
  }
  copyFirstMetadata(await loadPdf(filesBytes[0]), out);
  return out.save({ useObjectStreams: true });
}

export function parseRanges(input: string, pageCount: number): number[] {
  // "1-3,5,8-9" -> zero-based indices. Throws UserError on bad input.
  const wanted = new Set<number>();
  const parts = input
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  if (parts.length === 0) throw new UserError('Enter page ranges, e.g. "1-3, 5".');
  for (const part of parts) {
    const m = part.match(/^(\d+)(?:\s*-\s*(\d+))?$/);
    if (!m) throw new UserError(`Invalid range "${part}". Use like 1-3,5.`);
    let a = parseInt(m[1], 10);
    let b = m[2] ? parseInt(m[2], 10) : a;
    if (a > b) [a, b] = [b, a];
    if (a < 1 || b > pageCount) {
      throw new UserError(`Pages must be between 1 and ${pageCount}. Got "${part}".`);
    }
    for (let p = a; p <= b; p++) wanted.add(p - 1);
  }
  return [...wanted].sort((x, y) => x - y);
}

export async function splitPdf(
  bytes: ArrayBuffer,
  mode: 'ranges' | 'each' | 'keep',
  rangesInput: string,
): Promise<{ data: Uint8Array; filenameSuffix: string }[]> {
  const src = await loadPdf(bytes);
  const n = src.getPageCount();

  if (mode === 'each') {
    const out: { data: Uint8Array; filenameSuffix: string }[] = [];
    for (let i = 0; i < n; i++) {
      const single = await PDFDocument.create();
      const [p] = await single.copyPages(src, [i]);
      single.addPage(p);
      out.push({ data: await single.save({ useObjectStreams: true }), filenameSuffix: `page-${i + 1}` });
    }
    return out;
  }

  const indices =
    mode === 'keep' ? parseRanges(rangesInput, n) : parseRanges(rangesInput, n);

  if (mode === 'keep') {
    const kept = await PDFDocument.create();
    const pages = await kept.copyPages(src, indices);
    pages.forEach((p) => kept.addPage(p));
    return [{ data: await kept.save({ useObjectStreams: true }), filenameSuffix: 'extracted' }];
  }

  // ranges mode: split comma groups into separate files is nicer, but keep single-file extract
  // for predictability; "each" covers the multi-file case.
  const doc = await PDFDocument.create();
  const pages = await doc.copyPages(src, indices);
  pages.forEach((p) => doc.addPage(p));
  return [{ data: await doc.save({ useObjectStreams: true }), filenameSuffix: 'split' }];
}

export async function rotatePdf(
  bytes: ArrayBuffer,
  angle: 90 | 180 | 270,
  pagesInput: string, // empty = all
): Promise<Uint8Array> {
  const doc = await loadPdf(bytes);
  const n = doc.getPageCount();
  const targets = pagesInput.trim()
    ? parseRanges(pagesInput, n)
    : Array.from({ length: n }, (_, i) => i);
  for (const i of targets) {
    const page = doc.getPage(i);
    const cur = page.getRotation().angle;
    page.setRotation(degrees((cur + angle) % 360));
  }
  return doc.save({ useObjectStreams: true });
}

export interface OrganizePlan {
  /** New order as old zero-based indices. */
  order: number[];
  /** Per old index rotation to apply. */
  rotations: Record<number, 90 | 180 | 270>;
}

export async function organizePdf(bytes: ArrayBuffer, plan: OrganizePlan): Promise<Uint8Array> {
  const src = await loadPdf(bytes);
  if (plan.order.length === 0) throw new UserError('Delete all pages? Keep at least one page.');
  const out = await PDFDocument.create();
  const pages = await out.copyPages(src, plan.order);
  pages.forEach((p, k) => {
    const oldIndex = plan.order[k];
    const rot = plan.rotations[oldIndex];
    if (rot) {
      const cur = p.getRotation().angle;
      p.setRotation(degrees((cur + rot) % 360));
    }
    out.addPage(p);
  });
  return out.save({ useObjectStreams: true });
}

export async function losslessResave(bytes: ArrayBuffer): Promise<Uint8Array> {
  const doc = await loadPdf(bytes);
  return doc.save({ useObjectStreams: true });
}

export async function imagesToPdf(
  images: { dataUrl: string; width: number; height: number }[],
  opts: { pageSize: 'fit' | 'a4'; orientation: 'auto' | 'portrait' | 'landscape'; marginPt: number },
): Promise<Uint8Array> {
  if (images.length === 0) throw new UserError('Add at least one image.');
  const doc = await PDFDocument.create();
  const A4 = { w: 595.28, h: 841.89 };

  for (const img of images) {
    const isPng = img.dataUrl.startsWith('data:image/png');
    const embedded = isPng
      ? await doc.embedPng(img.dataUrl)
      : await doc.embedJpg(img.dataUrl);

    let pageW: number;
    let pageH: number;
    if (opts.pageSize === 'a4') {
      const portrait = opts.orientation !== 'landscape' &&
        (opts.orientation === 'portrait' || img.height >= img.width);
      pageW = portrait ? A4.w : A4.h;
      pageH = portrait ? A4.h : A4.w;
    } else {
      pageW = img.width + opts.marginPt * 2;
      pageH = img.height + opts.marginPt * 2;
    }

    const page = doc.addPage([pageW, pageH]);
    const availW = pageW - opts.marginPt * 2;
    const availH = pageH - opts.marginPt * 2;
    const scale = Math.min(availW / img.width, availH / img.height);
    const w = img.width * scale;
    const h = img.height * scale;
    page.drawImage(embedded, {
      x: (pageW - w) / 2,
      y: (pageH - h) / 2,
      width: w,
      height: h,
    });
  }
  return doc.save({ useObjectStreams: true });
}

export interface WatermarkOpts {
  text: string;
  opacity: number; // 0..1
  fontSize: number;
  rotationDeg: number;
  tile: boolean;
  color: { r: number; g: number; b: number };
}

export async function addTextWatermark(bytes: ArrayBuffer, opts: WatermarkOpts): Promise<Uint8Array> {
  if (!opts.text.trim()) throw new UserError('Enter watermark text.');
  const doc = await loadPdf(bytes);
  const font = await doc.embedFont(StandardFonts.HelveticaBold);
  for (const page of doc.getPages()) {
    const { width, height } = page.getSize();
    if (opts.tile) {
      const stepX = opts.fontSize * 8;
      const stepY = opts.fontSize * 4;
      for (let y = stepY / 2; y < height; y += stepY) {
        for (let x = -width; x < width * 2; x += stepX) {
          page.drawText(opts.text, {
            x,
            y,
            size: opts.fontSize * 0.6,
            font,
            color: rgb(opts.color.r, opts.color.g, opts.color.b),
            opacity: Math.min(0.35, opts.opacity),
            rotate: degrees(opts.rotationDeg),
          });
        }
      }
    } else {
      const tw = font.widthOfTextAtSize(opts.text, opts.fontSize);
      page.drawText(opts.text, {
        x: width / 2 - tw / 2,
        y: height / 2,
        size: opts.fontSize,
        font,
        color: rgb(opts.color.r, opts.color.g, opts.color.b),
        opacity: opts.opacity,
        rotate: degrees(opts.rotationDeg),
      });
    }
  }
  return doc.save({ useObjectStreams: true });
}

export interface PaginationOpts {
  start: number;
  format: 'n' | 'n-of-N' | 'page-n' | 'page-n-of-N';
  position: 'bottom-center' | 'bottom-right' | 'bottom-left' | 'top-center' | 'top-right';
  fontSize: number;
  margin: number;
}

export async function addPageNumbers(bytes: ArrayBuffer, opts: PaginationOpts): Promise<Uint8Array> {
  const doc = await loadPdf(bytes);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const total = doc.getPageCount();
  doc.getPages().forEach((page, i) => {
    const num = opts.start + i;
    const label =
      opts.format === 'n' ? `${num}`
      : opts.format === 'n-of-N' ? `${num} / ${opts.start + total - 1}`
      : opts.format === 'page-n' ? `Page ${num}`
      : `Page ${num} of ${opts.start + total - 1}`;
    const { width, height } = page.getSize();
    const tw = font.widthOfTextAtSize(label, opts.fontSize);
    let x = width / 2 - tw / 2;
    let y = opts.margin;
    if (opts.position === 'bottom-right') x = width - tw - opts.margin;
    if (opts.position === 'bottom-left') x = opts.margin;
    if (opts.position === 'top-center') y = height - opts.margin - opts.fontSize;
    if (opts.position === 'top-right') {
      x = width - tw - opts.margin;
      y = height - opts.margin - opts.fontSize;
    }
    page.drawText(label, { x, y, size: opts.fontSize, font, color: rgb(0.25, 0.25, 0.25) });
  });
  return doc.save({ useObjectStreams: true });
}

export async function addHeaderFooter(
  bytes: ArrayBuffer,
  header: string,
  footer: string,
  fontSize: number,
): Promise<Uint8Array> {
  const doc = await loadPdf(bytes);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const total = doc.getPageCount();
  doc.getPages().forEach((page, i) => {
    const { width, height } = page.getSize();
    const render = (tpl: string, y: number) => {
      if (!tpl.trim()) return;
      const text = tpl.replaceAll('{page}', String(i + 1)).replaceAll('{total}', String(total));
      const tw = font.widthOfTextAtSize(text, fontSize);
      page.drawText(text, { x: width / 2 - tw / 2, y, size: fontSize, font, color: rgb(0.3, 0.3, 0.3) });
    };
    render(header, height - 28);
    render(footer, 24);
  });
  return doc.save({ useObjectStreams: true });
}

export interface RedactBox {
  pageIndex: number; // zero-based
  xPct: number; // 0..100 from left
  yPct: number; // 0..100 from bottom
  wPct: number;
  hPct: number;
}

export async function redactPdf(bytes: ArrayBuffer, boxes: RedactBox[]): Promise<Uint8Array> {
  if (boxes.length === 0) throw new UserError('Add at least one redaction box.');
  const doc = await loadPdf(bytes);
  for (const b of boxes) {
    const page = doc.getPage(b.pageIndex);
    const { width, height } = page.getSize();
    page.drawRectangle({
      x: (b.xPct / 100) * width,
      y: (b.yPct / 100) * height,
      width: (b.wPct / 100) * width,
      height: (b.hPct / 100) * height,
      color: rgb(0, 0, 0),
      opacity: 1,
    });
  }
  return doc.save({ useObjectStreams: true });
}

export async function flattenPdf(bytes: ArrayBuffer): Promise<Uint8Array> {
  const doc = await loadPdf(bytes);
  try {
    doc.getForm().flatten();
  } catch {
    // No form — still re-save to bake annotations appearance.
  }
  return doc.save({ useObjectStreams: true });
}

export interface PdfMetadata {
  title?: string;
  author?: string;
  subject?: string;
  keywords?: string[];
  creator?: string;
  producer?: string;
  creationDate?: Date;
  modificationDate?: Date;
  pageCount: number;
}

export async function readMetadata(bytes: ArrayBuffer): Promise<PdfMetadata> {
  const doc = await loadPdf(bytes.slice(0));
  return {
    title: doc.getTitle(),
    author: doc.getAuthor(),
    subject: doc.getSubject(),
    keywords: doc.getKeywords()?.split(/[,;]/).map((s) => s.trim()).filter(Boolean),
    creator: doc.getCreator(),
    producer: doc.getProducer(),
    creationDate: doc.getCreationDate(),
    modificationDate: doc.getModificationDate(),
    pageCount: doc.getPageCount(),
  };
}

export async function stripMetadata(bytes: ArrayBuffer): Promise<Uint8Array> {
  const doc = await loadPdf(bytes);
  doc.setTitle('');
  doc.setAuthor('');
  doc.setSubject('');
  doc.setKeywords([]);
  doc.setCreator('');
  doc.setProducer('');
  // pdf-lib has no direct "clear dates"; set to now to avoid leaking originals.
  const now = new Date();
  doc.setCreationDate(now);
  doc.setModificationDate(now);
  return doc.save({ useObjectStreams: true });
}

export async function encryptPdf(
  bytes: ArrayBuffer,
  userPassword: string,
  ownerPassword?: string,
): Promise<Uint8Array> {
  if (userPassword.length < 4) throw new UserError('Password must be at least 4 characters.');
  const doc = await loadPdf(bytes);
  return (doc.save as (opts: never) => Promise<Uint8Array>)({
    useObjectStreams: true,
    userPassword,
    ownerPassword: ownerPassword || userPassword,
  } as never);
}

export async function decryptPdf(bytes: ArrayBuffer, password: string): Promise<Uint8Array> {
  if (!password) throw new UserError('Enter the current PDF password.');
  let doc: PDFDocument;
  try {
    doc = await PDFDocument.load(bytes, { password } as never);
  } catch {
    throw new UserError('Wrong password or unreadable file.');
  }
  return doc.save({ useObjectStreams: true });
}

export async function repairPdf(bytes: ArrayBuffer): Promise<{ data: Uint8Array; warnings: string[] }> {
  const warnings: string[] = [];
  let doc: PDFDocument;
  try {
    doc = await PDFDocument.load(bytes, {
      ignoreEncryption: true,
      throwOnInvalidObject: false,
    } as never);
  } catch (err) {
    throw new UserError(
      `Repair failed — file is too damaged to recover: ${err instanceof Error ? err.message : err}`,
    );
  }
  const n = doc.getPageCount();
  if (n === 0) throw new UserError('Repair failed — no readable pages found.');
  // Rebuild page-by-page so one corrupt page doesn't kill the whole doc.
  const out = await PDFDocument.create();
  let kept = 0;
  for (let i = 0; i < n; i++) {
    try {
      const [p] = await out.copyPages(doc, [i]);
      out.addPage(p);
      kept++;
    } catch {
      warnings.push(`Skipped unreadable page ${i + 1}.`);
    }
  }
  if (kept === 0) throw new UserError('Repair failed — no pages could be recovered.');
  if (kept < n) warnings.unshift(`Recovered ${kept} of ${n} pages.`);
  return { data: await out.save({ useObjectStreams: true }), warnings };
}

export async function textToPdf(opts: {
  title: string;
  body: string;
  fontSize: number;
  lineHeight: number;
}): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const titleFont = bold;

  let page = doc.addPage([595.28, 841.89]);
  const margin = 56;
  let y = 841.89 - margin;

  const drawWrapped = (text: string, f: PDFFont, size: number, gap: number) => {
    const maxW = 595.28 - margin * 2;
    const words = text.split(/\s+/);
    let line = '';
    const lines: string[] = [];
    for (const w of words) {
      const trial = line ? `${line} ${w}` : w;
      if (f.widthOfTextAtSize(trial, size) > maxW && line) {
        lines.push(line);
        line = w;
      } else {
        line = trial;
      }
    }
    if (line) lines.push(line);
    for (const ln of lines) {
      if (y < margin + size) {
        page = doc.addPage([595.28, 841.89]);
        y = 841.89 - margin;
      }
      page.drawText(ln, { x: margin, y, size, font: f, color: rgb(0.12, 0.12, 0.12) });
      y -= size * opts.lineHeight + gap;
    }
  };

  if (opts.title.trim()) {
    drawWrapped(opts.title.trim(), titleFont, Math.min(26, opts.fontSize + 8), 6);
    y -= 8;
  }
  for (const para of opts.body.split(/\n{2,}|\n/)) {
    if (!para.trim()) {
      y -= opts.fontSize * 0.7;
      continue;
    }
    drawWrapped(para.trim(), font, opts.fontSize, 2);
    y -= 4;
  }
  doc.setTitle(opts.title || 'Document');
  return doc.save({ useObjectStreams: true });
}

/** Minimal markdown -> PDF blocks (headings, lists, code, quotes, paragraphs). */
export async function markdownToPdf(markdown: string): Promise<Uint8Array> {
  if (!markdown.trim()) throw new UserError('Paste some Markdown first.');
  const doc = await PDFDocument.create();
  const regular = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const mono = await doc.embedFont(StandardFonts.Courier);
  let page: PDFPage = doc.addPage([595.28, 841.89]);
  const margin = 56;
  let y = 785;

  const ensure = (need: number) => {
    if (y - need < margin) {
      page = doc.addPage([595.28, 841.89]);
      y = 785;
    }
  };
  const drawLine = (text: string, f: PDFFont, size: number) => {
    const maxW = 595.28 - margin * 2;
    let line = '';
    const flush = () => {
      if (!line) return;
      ensure(size * 1.6);
      page.drawText(line, { x: margin, y, size, font: f, color: rgb(0.13, 0.13, 0.13) });
      y -= size * 1.45;
      line = '';
    };
    for (const word of text.split(/\s+/)) {
      const trial = line ? `${line} ${word}` : word;
      if (f.widthOfTextAtSize(trial, size) > maxW) {
        flush();
        line = word;
      } else line = trial;
    }
    flush();
  };

  for (const raw of markdown.split('\n')) {
    const line = raw.replace(/\r$/, '');
    if (/^#{1,6}\s/.test(line)) {
      const level = line.match(/^#+/)![0].length;
      const text = line.replace(/^#+\s*/, '');
      y -= 6;
      ensure(30);
      drawLine(text.toUpperCase().slice(0, 120) || text, bold, Math.max(11, 20 - level * 2));
      y -= 4;
    } else if (/^(\s*)[-*+]\s+/.test(line)) {
      drawLine(`•  ${line.replace(/^(\s*)[-*+]\s+/, '')}`, regular, 11);
    } else if (/^\s*\d+[.)]\s+/.test(line)) {
      drawLine(line.trim(), regular, 11);
    } else if (/^>\s?/.test(line)) {
      drawLine(line.replace(/^>\s?/, ''), regular, 11);
      y -= 2;
    } else if (/^```/.test(line)) {
      y -= 4;
    } else if (/^\s*$/.test(line)) {
      y -= 8;
    } else {
      const clean = line
        .replace(/\*\*(.+?)\*\*/g, '$1')
        .replace(/__(.+?)__/g, '$1')
        .replace(/`(.+?)`/g, '$1')
        .replace(/\[(.+?)\]\(.+?\)/g, '$1');
      const isCode = /^\s{4,}\S/.test(raw);
      drawLine(clean, isCode ? mono : regular, isCode ? 10 : 11);
    }
  }
  return doc.save({ useObjectStreams: true });
}

export interface TableData {
  headers: string[];
  rows: string[][];
}

export async function tableToPdf(table: TableData, title: string): Promise<Uint8Array> {
  if (table.headers.length === 0 && table.rows.length === 0) {
    throw new UserError('No table data found.');
  }
  const doc = await PDFDocument.create();
  const regular = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const cols = Math.max(table.headers.length, ...table.rows.map((r) => r.length));
  if (cols === 0) throw new UserError('No columns found.');
  const margin = 36;
  const pageW = 841.89; // landscape A4
  const pageH = 595.28;
  const colW = (pageW - margin * 2) / cols;
  const rowH = 22;

  let page = doc.addPage([pageW, pageH]);
  let y = pageH - margin;
  if (title.trim()) {
    page.drawText(title.trim().slice(0, 100), { x: margin, y: y - 6, size: 16, font: bold });
    y -= 34;
  }
  const all = [table.headers, ...table.rows].filter((r) => r.length > 0);
  all.forEach((row, ri) => {
    if (y - rowH < margin) {
      page = doc.addPage([pageW, pageH]);
      y = pageH - margin;
    }
    for (let c = 0; c < cols; c++) {
      const x = margin + c * colW;
      const cell = (row[c] ?? '').slice(0, 60);
      if (ri === 0) {
        page.drawRectangle({ x, y: y - rowH, width: colW, height: rowH, color: rgb(0.16, 0.25, 0.45) });
        page.drawText(cell, { x: x + 6, y: y - 15, size: 9, font: bold, color: rgb(1, 1, 1) });
      } else {
        if (ri % 2 === 0) {
          page.drawRectangle({ x, y: y - rowH, width: colW, height: rowH, color: rgb(0.95, 0.96, 0.98) });
        }
        page.drawText(cell, { x: x + 6, y: y - 15, size: 9, font: regular });
      }
      page.drawRectangle({ x, y: y - rowH, width: colW, height: rowH, borderColor: rgb(0.8, 0.82, 0.86), borderWidth: 0.7 });
    }
    y -= rowH;
  });
  return doc.save({ useObjectStreams: true });
}

function copyFirstMetadata(src: PDFDocument, dest: PDFDocument): void {
  try {
    const t = src.getTitle();
    if (t) dest.setTitle(t);
  } catch { /* ignore */ }
}
