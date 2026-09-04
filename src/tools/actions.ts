/**
 * Tool actions: take Files + option values from the UI, return downloadable Blobs.
 * Keeps DOM access minimal so logic stays testable.
 */
import { PDFDocument } from 'pdf-lib';
import JSZip from 'jszip';
import { UserError } from '../types.js';
import {
  mergePdfs, splitPdf, rotatePdf, organizePdf, losslessResave,
  imagesToPdf, addTextWatermark, addPageNumbers, addHeaderFooter,
  redactPdf, flattenPdf, readMetadata, stripMetadata,
  encryptPdf, decryptPdf, repairPdf, textToPdf, markdownToPdf,
  tableToPdf, placeImages, annotatePdf, cropPages, fillFormFields,
  slidesToPdf, type TableData,
} from '../lib/pdfCore.js';
import {
  renderAllPages, extractAllText, canvasToBlob, invertCanvas,
} from '../lib/pdfRender.js';
import { baseName, loadImageElement, readAsArrayBuffer, readAsText } from '../lib/fileUtils.js';

// Office-format engines (docx / mammoth / xlsx) are heavy and rarely needed —
// load them on demand so the main tool chunk stays lean.
const loadOffice = () => import('../lib/convert.js');
// Presentation engine (pptxgenjs) loads only for PDF → PowerPoint.
const loadPptx = () => import('pptxgenjs');

async function dataUrlToBytes(dataUrl: string): Promise<Uint8Array> {
  const res = await fetch(dataUrl);
  return new Uint8Array(await res.arrayBuffer());
}

export interface Ctx {
  files: File[];
  opts: Record<string, string>;
  onProgress: (msg: string) => void;
}

export interface ActionOut {
  blob: Blob;
  filename: string;
  note?: string;
  previewText?: string;
}

const need = (ctx: Ctx, n: number, what = 'PDF') => {
  if (ctx.files.length < n) throw new UserError(`Upload ${n} ${what} file${n > 1 ? 's' : ''} first.`);
};

async function pdfBytes(f: File): Promise<ArrayBuffer> {
  return readAsArrayBuffer(f);
}

export async function runTool(id: string, ctx: Ctx): Promise<ActionOut[]> {
  switch (id) {
    case 'merge': {
      need(ctx, 2);
      ctx.onProgress('Merging…');
      const parts = await Promise.all(ctx.files.map(pdfBytes));
      const data = await mergePdfs(parts);
      return [{ blob: new Blob([data as unknown as BlobPart], { type: 'application/pdf' }), filename: 'merged.pdf' }];
    }
    case 'split': {
      need(ctx, 1);
      const mode = (ctx.opts.mode ?? 'ranges') as 'ranges' | 'each' | 'keep';
      const ranges = ctx.opts.ranges ?? '1-3';
      ctx.onProgress('Splitting…');
      const bytes = await pdfBytes(ctx.files[0]);
      const parts = await splitPdf(bytes, mode, ranges);
      if (mode === 'each' && parts.length > 1) {
        const zip = new JSZip();
        parts.forEach((p) => zip.file(`${baseName(ctx.files[0].name)}-${p.filenameSuffix}.pdf`, p.data));
        const blob = await zip.generateAsync({ type: 'blob' });
        return [{ blob, filename: `${baseName(ctx.files[0].name)}-pages.zip`, note: `${parts.length} pages zipped.` }];
      }
      return parts.map((p) => ({
        blob: new Blob([p.data as unknown as BlobPart], { type: 'application/pdf' }),
        filename: `${baseName(ctx.files[0].name)}-${p.filenameSuffix}.pdf`,
      }));
    }
    case 'compress': {
      need(ctx, 1);
      const preset = ctx.opts.preset ?? 'medium';
      const bytes = await pdfBytes(ctx.files[0]);
      if (preset === 'lossless') {
        ctx.onProgress('Re-saving with object streams…');
        const data = await losslessResave(bytes);
        return [{ blob: new Blob([data as unknown as BlobPart], { type: 'application/pdf' }), filename: `${baseName(ctx.files[0].name)}-compressed.pdf` }];
      }
      // Lossy: rasterize at preset scale/quality then rebuild.
      const cfg = preset === 'light' ? { scale: 2.0, q: 0.85 }
        : preset === 'heavy' ? { scale: 1.0, q: 0.55 }
        : { scale: 1.5, q: 0.72 };
      ctx.onProgress('Rendering pages…');
      const canvases = await renderAllPages(bytes, cfg.scale, (d, t) => ctx.onProgress(`Rendering ${d}/${t}…`));
      ctx.onProgress('Rebuilding PDF…');
      const doc = await PDFDocument.create();
      for (const c of canvases) {
        const blob = await canvasToBlob(c, 'image/jpeg', cfg.q);
        const arr = new Uint8Array(await blob.arrayBuffer());
        const img = await doc.embedJpg(arr);
        const page = doc.addPage([img.width, img.height]);
        page.drawImage(img, { x: 0, y: 0, width: img.width, height: img.height });
      }
      const data = await doc.save({ useObjectStreams: true });
      return [{ blob: new Blob([data as unknown as BlobPart], { type: 'application/pdf' }), filename: `${baseName(ctx.files[0].name)}-compressed.pdf`, note: 'Rasterized compression: smallest size, text is no longer selectable.' }];
    }
    case 'pdf-to-jpg': {
      need(ctx, 1);
      const fmt = (ctx.opts.format ?? 'jpg') as 'jpg' | 'png';
      const dpi = ctx.opts.dpi ?? '2';
      const scale = dpi === '1' ? 1.33 : dpi === '3' ? 4.0 : 2.0;
      ctx.onProgress('Rendering…');
      const bytes = await pdfBytes(ctx.files[0]);
      const canvases = await renderAllPages(bytes, scale, (d, t) => ctx.onProgress(`Page ${d}/${t}…`));
      const mime = fmt === 'png' ? 'image/png' : 'image/jpeg';
      if (canvases.length === 1) {
        const blob = await canvasToBlob(canvases[0], mime, 0.92);
        return [{ blob, filename: `${baseName(ctx.files[0].name)}-p1.${fmt === 'png' ? 'png' : 'jpg'}` }];
      }
      const zip = new JSZip();
      for (let i = 0; i < canvases.length; i++) {
        const blob = await canvasToBlob(canvases[i], mime, 0.92);
        zip.file(`${baseName(ctx.files[0].name)}-p${i + 1}.${fmt === 'png' ? 'png' : 'jpg'}`, blob);
      }
      const blob = await zip.generateAsync({ type: 'blob' });
      return [{ blob, filename: `${baseName(ctx.files[0].name)}-images.zip`, note: `${canvases.length} pages exported.` }];
    }
    case 'images-to-pdf': {
      if (ctx.files.length === 0) throw new UserError('Add at least one image.');
      ctx.onProgress('Embedding images…');
      const imgs = await Promise.all(
        ctx.files.map(async (f) => {
          const url = URL.createObjectURL(f);
          try {
            const el = await loadImageElement(url);
            return { dataUrl: await fileToDataUrl(f), width: el.naturalWidth || 1200, height: el.naturalHeight || 1600 };
          } finally {
            URL.revokeObjectURL(url);
          }
        }),
      );
      const data = await imagesToPdf(imgs, {
        pageSize: (ctx.opts.pagesize ?? 'fit') as 'fit' | 'a4',
        orientation: 'auto',
        marginPt: Number(ctx.opts.margin ?? 24) || 0,
      });
      return [{ blob: new Blob([data as unknown as BlobPart], { type: 'application/pdf' }), filename: 'images.pdf' }];
    }
    case 'organize': {
      need(ctx, 1);
      // order comes as JSON from UI: {order:number[], rotations:Record<number,number>}
      const plan = JSON.parse(ctx.opts.plan || '{"order":[],"rotations":{}}') as {
        order: number[]; rotations: Record<number, 90 | 180 | 270>;
      };
      ctx.onProgress('Rebuilding…');
      const data = await organizePdf(await pdfBytes(ctx.files[0]), plan);
      return [{ blob: new Blob([data as unknown as BlobPart], { type: 'application/pdf' }), filename: `${baseName(ctx.files[0].name)}-organized.pdf` }];
    }
    case 'rotate': {
      need(ctx, 1);
      const angle = Number(ctx.opts.angle ?? 90) as 90 | 180 | 270;
      const data = await rotatePdf(await pdfBytes(ctx.files[0]), angle, ctx.opts.pages ?? '');
      return [{ blob: new Blob([data as unknown as BlobPart], { type: 'application/pdf' }), filename: `${baseName(ctx.files[0].name)}-rotated.pdf` }];
    }
    case 'watermark': {
      need(ctx, 1);
      const data = await addTextWatermark(await pdfBytes(ctx.files[0]), {
        text: ctx.opts.text ?? 'CONFIDENTIAL',
        opacity: Number(ctx.opts.opacity ?? 0.25),
        fontSize: Number(ctx.opts.size ?? 48),
        rotationDeg: Number(ctx.opts.rotation ?? -45),
        tile: (ctx.opts.tile ?? 'no') === 'yes',
        color: { r: 0.7, g: 0.1, b: 0.15 },
      });
      return [{ blob: new Blob([data as unknown as BlobPart], { type: 'application/pdf' }), filename: `${baseName(ctx.files[0].name)}-watermarked.pdf` }];
    }
    case 'page-numbers': {
      need(ctx, 1);
      const data = await addPageNumbers(await pdfBytes(ctx.files[0]), {
        start: Number(ctx.opts.start ?? 1) || 1,
        format: (ctx.opts.format ?? 'page-n-of-N') as 'n' | 'n-of-N' | 'page-n' | 'page-n-of-N',
        position: (ctx.opts.position ?? 'bottom-center') as 'bottom-center' | 'bottom-right' | 'bottom-left' | 'top-center' | 'top-right',
        fontSize: Number(ctx.opts.size ?? 10) || 10,
        margin: 36,
      });
      return [{ blob: new Blob([data as unknown as BlobPart], { type: 'application/pdf' }), filename: `${baseName(ctx.files[0].name)}-numbered.pdf` }];
    }
    case 'header-footer': {
      need(ctx, 1);
      const data = await addHeaderFooter(
        await pdfBytes(ctx.files[0]),
        ctx.opts.header ?? '',
        ctx.opts.footer ?? 'Page {page} of {total}',
        Number(ctx.opts.size ?? 9) || 9,
      );
      return [{ blob: new Blob([data as unknown as BlobPart], { type: 'application/pdf' }), filename: `${baseName(ctx.files[0].name)}-header-footer.pdf` }];
    }
    case 'redact': {
      need(ctx, 1);
      // boxes JSON from UI
      const boxes = JSON.parse(ctx.opts.boxes || '[]') as { pageIndex: number; xPct: number; yPct: number; wPct: number; hPct: number }[];
      const data = await redactPdf(await pdfBytes(ctx.files[0]), boxes);
      return [{ blob: new Blob([data as unknown as BlobPart], { type: 'application/pdf' }), filename: `${baseName(ctx.files[0].name)}-redacted.pdf`, note: 'Flatten the file after redacting before sharing.' }];
    }
    case 'extract-text': {
      need(ctx, 1);
      ctx.onProgress('Extracting text…');
      const pages = await extractAllText(await pdfBytes(ctx.files[0]), (d, t) => ctx.onProgress(`Page ${d}/${t}…`));
      const full = pages.map((t, i) => `===== Page ${i + 1} =====\n${t}`).join('\n\n');
      if (!full.trim()) throw new UserError('No embedded text found. This looks like a scanned PDF — try OCR instead.');
      return [{ blob: new Blob([full], { type: 'text/plain' }), filename: `${baseName(ctx.files[0].name)}.txt`, previewText: full.slice(0, 6000) }];
    }
    case 'ocr': {
      if (ctx.files.length === 0) throw new UserError('Upload a PDF or image.');
      const f = ctx.files[0];
      const { createWorker } = await import('tesseract.js');
      ctx.onProgress('Loading OCR engine…');
      const worker = await createWorker('eng');
      try {
        let images: HTMLCanvasElement[];
        if (f.type.startsWith('image/')) {
          const url = URL.createObjectURL(f);
          try {
            const el = await loadImageElement(url);
            const c = document.createElement('canvas');
            c.width = el.naturalWidth;
            c.height = el.naturalHeight;
            c.getContext('2d')!.drawImage(el, 0, 0);
            images = [c];
          } finally {
            URL.revokeObjectURL(url);
          }
        } else {
          ctx.onProgress('Rendering pages…');
          images = (await renderAllPages(await pdfBytes(f), 2.0)).slice(0, 10);
        }
        let combined = '';
        for (let i = 0; i < images.length; i++) {
          ctx.onProgress(`Recognizing page ${i + 1}/${images.length}…`);
          const { data } = await worker.recognize(images[i]);
          combined += `\n===== Page ${i + 1} =====\n${data.text}`;
        }
        if (images.length === 10) combined += '\n\n[First 10 pages processed — re-run per chunk for longer docs.]';
        const data = await textToPdf({ title: `OCR — ${f.name}`, body: combined, fontSize: 11, lineHeight: 1.5 });
        return [
          { blob: new Blob([combined], { type: 'text/plain' }), filename: `${baseName(f.name)}-ocr.txt`, previewText: combined.slice(0, 6000) },
          { blob: new Blob([data as unknown as BlobPart], { type: 'application/pdf' }), filename: `${baseName(f.name)}-ocr.pdf` },
        ];
      } finally {
        await worker.terminate();
      }
    }
    case 'encrypt': {
      need(ctx, 1);
      const pw = ctx.opts.password ?? '';
      const data = await encryptPdf(await pdfBytes(ctx.files[0]), pw, ctx.opts.owner || undefined);
      return [{ blob: new Blob([data as unknown as BlobPart], { type: 'application/pdf' }), filename: `${baseName(ctx.files[0].name)}-protected.pdf` }];
    }
    case 'decrypt': {
      need(ctx, 1);
      const data = await decryptPdf(await pdfBytes(ctx.files[0]), ctx.opts.password ?? '');
      return [{ blob: new Blob([data as unknown as BlobPart], { type: 'application/pdf' }), filename: `${baseName(ctx.files[0].name)}-unlocked.pdf` }];
    }
    case 'flatten': {
      need(ctx, 1);
      const data = await flattenPdf(await pdfBytes(ctx.files[0]));
      return [{ blob: new Blob([data as unknown as BlobPart], { type: 'application/pdf' }), filename: `${baseName(ctx.files[0].name)}-flat.pdf` }];
    }
    case 'privacy': {
      need(ctx, 1);
      const action = ctx.opts.action ?? 'inspect';
      const bytes = await pdfBytes(ctx.files[0]);
      const meta = await readMetadata(bytes);
      const summary = [
        `Pages: ${meta.pageCount}`,
        `Title: ${meta.title || '—'}`,
        `Author: ${meta.author || '—'}`,
        `Subject: ${meta.subject || '—'}`,
        `Keywords: ${meta.keywords?.join(', ') || '—'}`,
        `Creator: ${meta.creator || '—'}`,
        `Producer: ${meta.producer || '—'}`,
        `Created: ${meta.creationDate?.toLocaleString() || '—'}`,
        `Modified: ${meta.modificationDate?.toLocaleString() || '—'}`,
      ].join('\n');
      if (action === 'inspect') {
        return [{ blob: new Blob([summary], { type: 'text/plain' }), filename: `${baseName(ctx.files[0].name)}-metadata.txt`, previewText: summary, note: 'Choose “Strip metadata” and run again to clean the file.' }];
      }
      const data = await stripMetadata(bytes);
      return [{ blob: new Blob([data as unknown as BlobPart], { type: 'application/pdf' }), filename: `${baseName(ctx.files[0].name)}-clean.pdf`, previewText: summary, note: 'Metadata stripped. Original dates replaced with now.' }];
    }
    case 'pdf-to-word': {
      need(ctx, 1);
      ctx.onProgress('Extracting text…');
      const pages = await extractAllText(await pdfBytes(ctx.files[0]));
      ctx.onProgress('Building Word file…');
      const { textToDocxBlob } = await loadOffice();
      const blob = await textToDocxBlob(baseName(ctx.files[0].name), pages);
      return [{ blob, filename: `${baseName(ctx.files[0].name)}.docx` }];
    }
    case 'word-to-pdf': {
      if (ctx.files.length === 0) throw new UserError('Upload a .docx file.');
      ctx.onProgress('Converting…');
      const { docxToPlainText } = await loadOffice();
      const text = await docxToPlainText(ctx.files[0]);
      const data = await textToPdf({ title: baseName(ctx.files[0].name), body: text, fontSize: 11, lineHeight: 1.5 });
      return [{ blob: new Blob([data as unknown as BlobPart], { type: 'application/pdf' }), filename: `${baseName(ctx.files[0].name)}.pdf`, previewText: text.slice(0, 4000) }];
    }
    case 'pdf-to-excel': {
      need(ctx, 1);
      ctx.onProgress('Extracting…');
      const pages = await extractAllText(await pdfBytes(ctx.files[0]));
      const rows = pages.flatMap((p) => p.split('\n').map((l) => [l]));
      const table: TableData = { headers: ['Text'], rows };
      const { tableToCsv, tableToXlsxBlob } = await loadOffice();
      const csv = tableToCsv(table);
      const xlsxBlob = tableToXlsxBlob(table);
      return [
        { blob: new Blob([csv], { type: 'text/csv' }), filename: `${baseName(ctx.files[0].name)}.csv`, previewText: csv.slice(0, 4000) },
        { blob: xlsxBlob, filename: `${baseName(ctx.files[0].name)}.xlsx` },
      ];
    }
    case 'excel-to-pdf': {
      if (ctx.files.length === 0) throw new UserError('Upload a .csv or .xlsx file.');
      const f = ctx.files[0];
      ctx.onProgress('Parsing spreadsheet…');
      const { parseCsv, workbookToTable } = await loadOffice();
      let table: TableData;
      if (/\.csv$/i.test(f.name) || f.type.includes('csv')) {
        table = parseCsv(await readAsText(f));
      } else {
        table = await workbookToTable(f);
      }
      const data = await tableToPdf(table, ctx.opts.title || baseName(f.name));
      return [{ blob: new Blob([data as unknown as BlobPart], { type: 'application/pdf' }), filename: `${baseName(f.name)}.pdf` }];
    }
    case 'pdf-to-html': {
      need(ctx, 1);
      const pages = await extractAllText(await pdfBytes(ctx.files[0]));
      const { textToHtmlDoc } = await loadOffice();
      const html = textToHtmlDoc(baseName(ctx.files[0].name), pages);
      return [{ blob: new Blob([html], { type: 'text/html' }), filename: `${baseName(ctx.files[0].name)}.html`, previewText: html.slice(0, 6000) }];
    }
    case 'invert': {
      need(ctx, 1);
      ctx.onProgress('Rendering…');
      const canvases = await renderAllPages(await pdfBytes(ctx.files[0]), 1.6, (d, t) => ctx.onProgress(`Page ${d}/${t}…`));
      const doc = await PDFDocument.create();
      for (const c of canvases) {
        const inv = invertCanvas(c);
        const blob = await canvasToBlob(inv, 'image/jpeg', 0.85);
        const img = await doc.embedJpg(new Uint8Array(await blob.arrayBuffer()));
        const page = doc.addPage([img.width, img.height]);
        page.drawImage(img, { x: 0, y: 0, width: img.width, height: img.height });
      }
      const data = await doc.save({ useObjectStreams: true });
      return [{ blob: new Blob([data as unknown as BlobPart], { type: 'application/pdf' }), filename: `${baseName(ctx.files[0].name)}-dark.pdf`, note: 'Rasterized output: colors inverted, text not selectable.' }];
    }
    case 'create': {
      const data = await textToPdf({
        title: ctx.opts.title ?? 'Untitled',
        body: ctx.opts.body ?? '',
        fontSize: Number(ctx.opts.size ?? 12) || 12,
        lineHeight: 1.5,
      });
      return [{ blob: new Blob([data as unknown as BlobPart], { type: 'application/pdf' }), filename: `${(ctx.opts.title || 'document').slice(0, 40) || 'document'}.pdf` }];
    }
    case 'markdown': {
      let md = ctx.opts.body ?? '';
      if (!md && ctx.files.length > 0) md = await readAsText(ctx.files[0]);
      const data = await markdownToPdf(md);
      return [{ blob: new Blob([data as unknown as BlobPart], { type: 'application/pdf' }), filename: 'document.pdf' }];
    }
    case 'html-to-pdf': {
      let html = ctx.opts.body ?? '';
      if (!html && ctx.files.length > 0) html = await readAsText(ctx.files[0]);
      if (!html.trim()) throw new UserError('Paste HTML or upload an .html file.');
      const tmp = document.createElement('div');
      tmp.innerHTML = html;
      const text = (tmp.textContent ?? '').trim() || html;
      const data = await textToPdf({ title: ctx.opts.title || 'Webpage', body: text, fontSize: 11, lineHeight: 1.5 });
      return [{ blob: new Blob([data as unknown as BlobPart], { type: 'application/pdf' }), filename: 'webpage.pdf', note: 'Converted from rendered text content (layout simplified). Use browser Print → Save as PDF for pixel-perfect CSS.' }];
    }
    case 'compare': {
      throw new UserError('Compare runs directly in the viewer below — upload both PDFs there. No file to download.');
    }
    case 'sign': {
      need(ctx, 1);
      const sig = ctx.opts.sig ?? '';
      if (!sig.startsWith('data:image/')) {
        throw new UserError('Create your signature first (draw, type or upload) in the panel below.');
      }
      const items = JSON.parse(ctx.opts.items || '[]') as {
        pageIndex: number; xPct: number; yPct: number; wPct: number;
      }[];
      if (items.length === 0) throw new UserError('Add at least one placement (page + position).');
      ctx.onProgress('Baking signature…');
      const img = await dataUrlToBytes(sig);
      const data = await placeImages(await pdfBytes(ctx.files[0]), items.map((it) => ({ ...it, img })));
      return [{ blob: new Blob([data as unknown as BlobPart], { type: 'application/pdf' }), filename: `${baseName(ctx.files[0].name)}-signed.pdf` }];
    }
    case 'annotate': {
      need(ctx, 1);
      const anns = JSON.parse(ctx.opts.anns || '[]') as {
        kind: 'text' | 'highlight' | 'image';
        pageIndex: number; xPct: number; yPct: number;
        text: string; size: number; color: string; bold: boolean; wPct: number;
      }[];
      if (anns.length === 0) throw new UserError('Add at least one annotation below.');
      ctx.onProgress('Applying annotations…');
      let bytes = await pdfBytes(ctx.files[0]);
      const hex = (h: string): { r: number; g: number; b: number } => {
        const m = h.replace('#', '');
        const v = m.length === 3 ? m.split('').map((c) => c + c).join('') : m;
        const n = parseInt(v || '000000', 16);
        return { r: ((n >> 16) & 255) / 255, g: ((n >> 8) & 255) / 255, b: (n & 255) / 255 };
      };
      const texts = anns
        .filter((a) => a.kind !== 'image')
        .map((a) => ({
          pageIndex: a.pageIndex,
          xPct: a.xPct,
          yPct: a.yPct,
          text: a.kind === 'highlight' && !a.text.trim() ? ' ' : a.text,
          size: Number(a.size) || 14,
          color: hex(a.color || '#111111'),
          bold: !!a.bold,
          highlight: a.kind === 'highlight',
        }));
      if (texts.length > 0) {
        const out = await annotatePdf(bytes, texts);
        bytes = out.buffer.slice(out.byteOffset, out.byteOffset + out.byteLength) as ArrayBuffer;
      }
      const imageAnns = anns.filter((a) => a.kind === 'image');
      if (imageAnns.length > 0) {
        const stamp = ctx.opts.stamp ?? '';
        if (!stamp.startsWith('data:image/')) {
          throw new UserError('Image annotations need a stamp image — upload one in the panel below.');
        }
        const img = await dataUrlToBytes(stamp);
        const out = await placeImages(
          bytes,
          imageAnns.map((a) => ({ pageIndex: a.pageIndex, img, xPct: a.xPct, yPct: a.yPct, wPct: a.wPct || 20 })),
        );
        bytes = out.buffer.slice(out.byteOffset, out.byteOffset + out.byteLength) as ArrayBuffer;
      }
      return [{ blob: new Blob([bytes], { type: 'application/pdf' }), filename: `${baseName(ctx.files[0].name)}-annotated.pdf` }];
    }
    case 'crop': {
      need(ctx, 1);
      const num = (k: string) => Number(ctx.opts[k] ?? 0) || 0;
      const data = await cropPages(
        await pdfBytes(ctx.files[0]),
        { top: num('top'), bottom: num('bottom'), left: num('left'), right: num('right') },
        ctx.opts.pages ?? '',
      );
      return [{ blob: new Blob([data as unknown as BlobPart], { type: 'application/pdf' }), filename: `${baseName(ctx.files[0].name)}-cropped.pdf` }];
    }
    case 'fill-forms': {
      need(ctx, 1);
      const values = JSON.parse(ctx.opts.values || '{}') as Record<string, string>;
      const data = await fillFormFields(
        await pdfBytes(ctx.files[0]),
        values,
        (ctx.opts.flatten ?? 'yes') === 'yes',
      );
      return [{ blob: new Blob([data as unknown as BlobPart], { type: 'application/pdf' }), filename: `${baseName(ctx.files[0].name)}-filled.pdf` }];
    }
    case 'pdf-to-pptx': {
      need(ctx, 1);
      ctx.onProgress('Rendering slides…');
      const canvases = await renderAllPages(
        await pdfBytes(ctx.files[0]), 2.0, (d, t) => ctx.onProgress(`Page ${d}/${t}…`),
      );
      ctx.onProgress('Building presentation…');
      const { default: PptxGenJS } = await loadPptx();
      const pptx = new PptxGenJS();
      pptx.layout = 'LAYOUT_WIDE';
      for (const c of canvases) {
        const blob = await canvasToBlob(c, 'image/jpeg', 0.9);
        const dataUrl = await new Promise<string>((resolve, reject) => {
          const r = new FileReader();
          r.onload = () => resolve(String(r.result));
          r.onerror = () => reject(new Error('Image encoding failed.'));
          r.readAsDataURL(blob);
        });
        const slide = pptx.addSlide();
        slide.background = { color: 'FFFFFF' };
        slide.addImage({ data: dataUrl, x: 0, y: 0, w: '100%', h: '100%', sizing: { type: 'contain', w: '100%', h: '100%' } });
      }
      const out = (await pptx.write({ outputType: 'blob' })) as Blob | string;
      const blob =
        out instanceof Blob
          ? out
          : new Blob([Uint8Array.from(atob(out), (ch) => ch.charCodeAt(0))], {
              type: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
            });
      return [{ blob, filename: `${baseName(ctx.files[0].name)}.pptx`, note: `${canvases.length} slides, one per page.` }];
    }
    case 'pptx-to-pdf': {
      if (ctx.files.length === 0) throw new UserError('Upload a .pptx file.');
      ctx.onProgress('Reading presentation…');
      const { pptxToSlides } = await loadOffice();
      const slides = await pptxToSlides(ctx.files[0]);
      ctx.onProgress('Building PDF…');
      const data = await slidesToPdf(slides, baseName(ctx.files[0].name));
      return [{ blob: new Blob([data as unknown as BlobPart], { type: 'application/pdf' }), filename: `${baseName(ctx.files[0].name)}.pdf`, note: `${slides.length} slides converted (text + images; exact slide layout simplified).` }];
    }
    case 'repair': {
      need(ctx, 1);
      ctx.onProgress('Scanning…');
      const { data, warnings } = await repairPdf(await pdfBytes(ctx.files[0]));
      return [{ blob: new Blob([data as unknown as BlobPart], { type: 'application/pdf' }), filename: `${baseName(ctx.files[0].name)}-repaired.pdf`, note: warnings.join(' ') || 'Rebuilt cleanly — all pages recovered.' }];
    }
    case 'scan': {
      // files are camera captures collected by UI; reuse images-to-pdf
      if (ctx.files.length === 0) throw new UserError('Capture at least one page with the camera.');
      const imgs = await Promise.all(
        ctx.files.map(async (f) => {
          const url = URL.createObjectURL(f);
          try {
            const el = await loadImageElement(url);
            return { dataUrl: await fileToDataUrl(f), width: el.naturalWidth, height: el.naturalHeight };
          } finally {
            URL.revokeObjectURL(url);
          }
        }),
      );
      const data = await imagesToPdf(imgs, { pageSize: 'a4', orientation: 'auto', marginPt: 24 });
      return [{ blob: new Blob([data as unknown as BlobPart], { type: 'application/pdf' }), filename: 'scan.pdf' }];
    }
    default:
      throw new UserError(`Unknown tool "${id}".`);
  }
}

async function fileToDataUrl(f: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(new Error('Could not read image.'));
    r.readAsDataURL(f);
  });
}
