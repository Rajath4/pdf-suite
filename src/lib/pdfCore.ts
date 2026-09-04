/**
 * Core PDF manipulation built on pdf-lib.
 * Every function is pure: (bytes in) -> (bytes out).
 * UI code lives elsewhere.
 */
import {
  PDFDocument,
  PDFName,
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

// ---------- Signatures & image stamps ----------

export interface ImagePlacement {
  pageIndex: number; // zero-based
  img: Uint8Array; // PNG or JPEG bytes
  xPct: number; // left edge, % of page width
  yPct: number; // bottom edge, % of page height
  wPct: number; // width, % of page width (height follows aspect ratio)
  opacity?: number;
}

async function embedAnyImage(doc: PDFDocument, bytes: Uint8Array) {
  try {
    return await doc.embedPng(bytes);
  } catch {
    return await doc.embedJpg(bytes);
  }
}

/** Bakes image stamps (signatures, logos) onto pages. Powers Sign PDF. */
export async function placeImages(bytes: ArrayBuffer, items: ImagePlacement[]): Promise<Uint8Array> {
  if (items.length === 0) throw new UserError('Add at least one placement.');
  const doc = await loadPdf(bytes);
  for (const it of items) {
    if (it.pageIndex < 0 || it.pageIndex >= doc.getPageCount()) {
      throw new UserError(`Placement targets page ${it.pageIndex + 1}, but the PDF has ${doc.getPageCount()} pages.`);
    }
    const page = doc.getPage(it.pageIndex);
    const { width, height } = page.getSize();
    const img = await embedAnyImage(doc, it.img);
    const w = (Math.min(90, Math.max(2, it.wPct)) / 100) * width;
    const h = (w * img.height) / img.width;
    page.drawImage(img, {
      x: (it.xPct / 100) * width,
      y: (it.yPct / 100) * height,
      width: w,
      height: h,
      opacity: it.opacity ?? 1,
    });
  }
  return doc.save({ useObjectStreams: true });
}

// ---------- Text annotations & highlights ----------

export interface TextAnnotation {
  pageIndex: number;
  xPct: number;
  yPct: number; // baseline of first line, from bottom
  text: string;
  size: number;
  color: { r: number; g: number; b: number };
  bold: boolean;
  /** Yellow marker wash behind the text instead of plain text. */
  highlight: boolean;
}

/** Adds user-placed text and highlights. Powers Edit & Annotate. */
export async function annotatePdf(bytes: ArrayBuffer, anns: TextAnnotation[]): Promise<Uint8Array> {
  if (anns.length === 0) throw new UserError('Add at least one annotation.');
  const doc = await loadPdf(bytes);
  const regular = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  for (const a of anns) {
    if (!a.text.trim()) continue;
    if (a.pageIndex < 0 || a.pageIndex >= doc.getPageCount()) {
      throw new UserError(`Annotation targets page ${a.pageIndex + 1}, but the PDF has ${doc.getPageCount()} pages.`);
    }
    const page = doc.getPage(a.pageIndex);
    const { width } = page.getSize();
    const font = a.bold ? bold : regular;
    const size = Math.min(72, Math.max(6, a.size));
    const x = (a.xPct / 100) * width;
    let y = (a.yPct / 100) * page.getSize().height;
    for (const line of a.text.split('\n').slice(0, 20)) {
      const tw = Math.min(font.widthOfTextAtSize(line, size), width - x - 8);
      if (a.highlight) {
        page.drawRectangle({
          x: x - 2,
          y: y - size * 0.25,
          width: tw + 4,
          height: size * 1.2,
          color: rgb(1, 0.95, 0.4),
          opacity: 0.55,
        });
      }
      page.drawText(line, {
        x,
        y,
        size,
        font,
        color: rgb(a.color.r, a.color.g, a.color.b),
      });
      y -= size * 1.35;
    }
  }
  return doc.save({ useObjectStreams: true });
}

// ---------- Crop ----------

export interface CropMargins {
  top: number;
  bottom: number;
  left: number;
  right: number;
} // all in percent of page dimensions

/** Trims page boxes (margins) on selected pages. Powers Crop PDF. */
export async function cropPages(
  bytes: ArrayBuffer,
  margins: CropMargins,
  pagesInput: string,
): Promise<Uint8Array> {
  for (const [k, v] of Object.entries(margins)) {
    if (!Number.isFinite(v) || v < 0 || v > 90) {
      throw new UserError(`Margin "${k}" must be between 0 and 90%.`);
    }
  }
  if (margins.top + margins.bottom >= 96 || margins.left + margins.right >= 96) {
    throw new UserError('Margins are too large — almost nothing would remain of the page.');
  }
  const doc = await loadPdf(bytes);
  const n = doc.getPageCount();
  const targets = pagesInput.trim() ? parseRanges(pagesInput, n) : Array.from({ length: n }, (_, i) => i);
  for (const i of targets) {
    const page = doc.getPage(i);
    const { width, height } = page.getSize();
    const x0 = (width * margins.left) / 100;
    const x1 = width - (width * margins.right) / 100;
    const y0 = (height * margins.bottom) / 100;
    const y1 = height - (height * margins.top) / 100;
    if (x1 - x0 < 36 || y1 - y0 < 36) {
      throw new UserError('Margins are too large — almost nothing would remain of the page.');
    }
    const box = doc.context.obj([x0, y0, x1, y1]);
    page.node.set(PDFName.of('CropBox'), box);
    page.node.set(PDFName.of('TrimBox'), box);
  }
  return doc.save({ useObjectStreams: true });
}

// ---------- Fillable forms ----------

export interface FormFieldInfo {
  name: string;
  type: 'text' | 'checkbox' | 'dropdown' | 'unsupported';
  value: string;
  options?: string[];
}

export async function listFormFields(bytes: ArrayBuffer): Promise<FormFieldInfo[]> {
  const doc = await loadPdf(bytes.slice(0));
  let form;
  try {
    form = doc.getForm();
  } catch {
    return [];
  }
  const out: FormFieldInfo[] = [];
  for (const f of form.getFields()) {
    const name = f.getName();
    const ctor = f.constructor.name;
    if (ctor === 'PDFTextField') {
      const t = f as import('pdf-lib').PDFTextField;
      out.push({ name, type: 'text', value: t.getText() ?? '' });
    } else if (ctor === 'PDFCheckBox') {
      const c = f as import('pdf-lib').PDFCheckBox;
      out.push({ name, type: 'checkbox', value: c.isChecked() ? 'yes' : 'no' });
    } else if (ctor === 'PDFDropdown') {
      const d = f as import('pdf-lib').PDFDropdown;
      out.push({ name, type: 'dropdown', value: d.getSelected()[0] ?? '', options: d.getOptions() });
    } else {
      out.push({ name, type: 'unsupported', value: '' });
    }
  }
  return out;
}

export async function fillFormFields(
  bytes: ArrayBuffer,
  values: Record<string, string>,
  flatten: boolean,
): Promise<Uint8Array> {
  const doc = await loadPdf(bytes);
  let form;
  try {
    form = doc.getForm();
  } catch {
    throw new UserError('This PDF has no fillable form fields.');
  }
  const fields = form.getFields();
  if (fields.length === 0) throw new UserError('This PDF has no fillable form fields.');
  for (const f of fields) {
    const v = values[f.getName()];
    if (v === undefined) continue;
    const ctor = f.constructor.name;
    try {
      if (ctor === 'PDFTextField') (f as import('pdf-lib').PDFTextField).setText(v);
      else if (ctor === 'PDFCheckBox') {
        const c = f as import('pdf-lib').PDFCheckBox;
        if (v === 'yes') c.check();
        else c.uncheck();
      } else if (ctor === 'PDFDropdown' && v) (f as import('pdf-lib').PDFDropdown).select(v);
    } catch {
      /* leave fields we cannot set untouched */
    }
  }
  if (flatten) {
    try {
      form.flatten();
    } catch { /* ignore */ }
  }
  return doc.save({ useObjectStreams: true });
}

// ---------- Slides (PowerPoint bridge) ----------

export interface SlideData {
  texts: string[];
  images: { data: Uint8Array; isPng: boolean }[];
}

/** Renders parsed slide content (from PPTX) as a landscape PDF. */
export async function slidesToPdf(slides: SlideData[], title: string): Promise<Uint8Array> {
  if (slides.length === 0) throw new UserError('No slides found in the presentation.');
  const doc = await PDFDocument.create();
  const regular = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const W = 960;
  const H = 540;
  const margin = 48;

  for (const slide of slides) {
    const page = doc.addPage([W, H]);
    let y = H - margin;
    const lines = slide.texts.filter((t) => t.trim()).slice(0, 40);
    lines.forEach((raw, idx) => {
      const text = raw.slice(0, 220);
      const f = idx === 0 ? bold : regular;
      const size = idx === 0 ? 20 : 12;
      const maxW = W - margin * 2 - (slide.images.length > 0 ? 220 : 0);
      let line = '';
      const flush = () => {
        if (!line || y < margin + 10) return;
        page.drawText(line, { x: margin, y, size, font: f, color: rgb(0.12, 0.12, 0.12) });
        y -= size * 1.5;
        line = '';
      };
      for (const word of text.split(/\s+/)) {
        const trial = line ? `${line} ${word}` : word;
        if (f.widthOfTextAtSize(trial, size) > maxW && line) {
          flush();
          line = word;
        } else line = trial;
      }
      flush();
      if (idx === 0) y -= 10;
    });
    // Images docked on the right, scaled to fit.
    let iy = H - margin;
    for (const im of slide.images.slice(0, 4)) {
      try {
        const embedded = im.isPng ? await doc.embedPng(im.data) : await doc.embedJpg(im.data);
        const boxW = 200;
        const boxH = 150;
        const scale = Math.min(boxW / embedded.width, boxH / embedded.height);
        const w = embedded.width * scale;
        const h = embedded.height * scale;
        if (iy - h < margin) break;
        page.drawImage(embedded, { x: W - margin - w, y: iy - h, width: w, height: h });
        iy -= h + 12;
      } catch {
        /* skip undecodable media */
      }
    }
  }
  doc.setTitle(title || 'Presentation');
  return doc.save({ useObjectStreams: true });
}
