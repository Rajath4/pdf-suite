/** Office/text format conversions. All client-side. */
import { Document, Packer, Paragraph, TextRun } from 'docx';
import mammoth from 'mammoth';
import * as XLSX from 'xlsx';
import JSZip from 'jszip';
import type { SlideData, TableData } from './pdfCore.js';
import { UserError } from '../types.js';

export function parseCsv(text: string): TableData {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let inQuotes = false;
  const pushCell = () => {
    row.push(cell);
    cell = '';
  };
  const pushRow = () => {
    // Skip blank lines entirely.
    pushCell();
    if (row.some((c) => c.trim() !== '')) rows.push(row);
    row = [];
  };
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          cell += '"';
          i++;
        } else inQuotes = false;
      } else cell += c;
    } else if (c === '"') inQuotes = true;
    else if (c === ',') pushCell();
    else if (c === '\n') pushRow();
    else if (c === '\r') { /* ignore, \n handles it */ }
    else cell += c;
  }
  pushCell();
  if (row.some((c) => c.trim() !== '')) rows.push(row);
  if (rows.length === 0) throw new UserError('No rows found in CSV.');
  const width = Math.max(...rows.map((r) => r.length));
  const norm = rows.map((r) => [...r, ...Array(Math.max(0, width - r.length)).fill('')]);
  return { headers: norm[0], rows: norm.slice(1) };
}

export async function workbookToTable(file: File): Promise<TableData> {
  const buf = await file.arrayBuffer();
  const wb = XLSX.read(buf, { type: 'array' });
  const first = wb.SheetNames[0];
  if (!first) throw new UserError('No worksheets found in workbook.');
  const ws = wb.Sheets[first];
  const aoa = XLSX.utils.sheet_to_json<string[]>(ws, { header: 1, defval: '' });
  const cleaned = (aoa as unknown[][]).map((r) => r.map((c) => String(c ?? '')));
  if (cleaned.length === 0) throw new UserError('Worksheet is empty.');
  return { headers: cleaned[0], rows: cleaned.slice(1) };
}

export function tableToCsv(table: TableData): string {
  const esc = (v: string) => (/[",\n]/.test(v) ? `"${v.replaceAll('"', '""')}"` : v);
  return [table.headers, ...table.rows].map((r) => r.map(esc).join(',')).join('\n');
}

export function tableToXlsxBlob(table: TableData): Blob {
  const ws = XLSX.utils.aoa_to_sheet([table.headers, ...table.rows]);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Sheet1');
  const out = XLSX.write(wb, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer;
  return new Blob([out], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });
}

export async function docxToPlainText(file: File): Promise<string> {
  const buf = await file.arrayBuffer();
  const res = await mammoth.convertToHtml({ arrayBuffer: buf });
  // Convert a subset of HTML to readable plain text.
  const div = document.createElement('div');
  div.innerHTML = res.value;
  const lines: string[] = [];
  const walk = (el: Element, prefix = '') => {
    for (const child of el.children) {
      const tag = child.tagName.toLowerCase();
      if (tag.startsWith('h')) lines.push(`\n## ${child.textContent?.trim()}\n`);
      else if (tag === 'p') lines.push(`${prefix}${child.textContent?.trim()}\n`);
      else if (tag === 'li') lines.push(`• ${child.textContent?.trim()}\n`);
      else if (child.children.length > 0) walk(child, prefix);
      else if (child.textContent?.trim()) lines.push(`${child.textContent.trim()}\n`);
    }
  };
  walk(div);
  const text = (lines.length > 0 ? lines.join('\n') : div.textContent ?? '').trim();
  if (!text) throw new UserError('No readable text found in Word file.');
  return text;
}

export async function textToDocxBlob(title: string, pagesText: string[]): Promise<Blob> {
  const children: Paragraph[] = [];
  if (title.trim()) {
    children.push(
      new Paragraph({ children: [new TextRun({ text: title.trim(), bold: true, size: 32 })] }),
    );
  }
  pagesText.forEach((pageText, i) => {
    if (pagesText.length > 1) {
      children.push(
        new Paragraph({ children: [new TextRun({ text: `— Page ${i + 1} —`, italics: true, size: 20 })] }),
      );
    }
    for (const para of pageText.split('\n')) {
      if (!para.trim()) continue;
      children.push(new Paragraph({ children: [new TextRun({ text: para.slice(0, 2000), size: 22 })] }));
    }
  });
  const doc = new Document({ sections: [{ children }] });
  return Packer.toBlob(doc);
}

export function textToHtmlDoc(title: string, pagesText: string[]): string {
  const esc = (s: string) =>
    s.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
  const body = pagesText
    .map(
      (t, i) =>
        `<section class="page"><h2>Page ${i + 1}</h2>${t
          .split('\n')
          .filter((l) => l.trim())
          .map((l) => `<p>${esc(l)}</p>`)
          .join('')}</section>`,
    )
    .join('\n');
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${esc(title)}</title><style>body{font-family:system-ui,sans-serif;max-width:760px;margin:2rem auto;padding:0 1rem;line-height:1.6}.page{border-bottom:1px solid #ddd;padding-bottom:1rem;margin-bottom:1rem}h1{font-size:1.8rem}</style></head><body><h1>${esc(title)}</h1>${body}</body></html>`;
}

/**
 * Parses a .pptx file (it's a ZIP of XML) into slide text + images.
 * Layout fidelity is simplified — text runs and embedded pictures are
 * preserved in reading order — but it runs 100% offline with no engine.
 */
export async function pptxToSlides(file: File): Promise<SlideData[]> {
  const zip = await JSZip.loadAsync(await file.arrayBuffer());
  const slidePaths = Object.keys(zip.files)
    .filter((p) => /^ppt\/slides\/slide\d+\.xml$/.test(p))
    .sort((a, b) => {
      const na = Number(a.match(/slide(\d+)\.xml/)![1]);
      const nb = Number(b.match(/slide(\d+)\.xml/)![1]);
      return na - nb;
    });
  if (slidePaths.length === 0) throw new UserError('No slides found — is this a valid .pptx file?');

  const parser = new DOMParser();
  const parseXml = async (path: string): Promise<XMLDocument> => {
    const f = zip.files[path];
    if (!f) throw new UserError(`Presentation is missing ${path}.`);
    const xml = await f.async('text');
    const doc = parser.parseFromString(xml, 'application/xml');
    if (doc.querySelector('parsererror')) throw new UserError(`Could not parse ${path}.`);
    return doc;
  };

  const slides: SlideData[] = [];
  for (const slidePath of slidePaths) {
    const slideNum = slidePath.match(/slide(\d+)\.xml/)![1];
    const xml = await parseXml(slidePath);

    // Text: group character runs by paragraph (prefix-agnostic).
    const texts: string[] = [];
    for (const p of xml.getElementsByTagName('a:p')) {
      let para = '';
      for (const t of p.getElementsByTagName('a:t')) para += t.textContent ?? '';
      if (para.trim()) texts.push(para.trim());
    }

    // Images: resolve drawing blips through the slide's rels to ppt/media/*.
    const images: SlideData['images'] = [];
    try {
      const rels = await parseXml(`ppt/slides/_rels/slide${slideNum}.xml.rels`);
      const targets = new Map<string, string>();
      for (const r of rels.getElementsByTagName('Relationship')) {
        const type = r.getAttribute('Type') ?? '';
        const id = r.getAttribute('Id') ?? '';
        const target = r.getAttribute('Target') ?? '';
        if (id && target && /\/image$/.test(type)) {
          targets.set(id, target.replace(/^\.\.\//, 'ppt/').replace(/^\//, ''));
        }
      }
      const seen = new Set<string>();
      for (const blip of xml.getElementsByTagName('a:blip')) {
        const embed = blip.getAttribute('r:embed') ?? '';
        const target = targets.get(embed);
        if (!target || seen.has(target)) continue;
        seen.add(target);
        // Target is usually ppt/media/imageN.ext; be lenient about the path.
        const key =
          Object.keys(zip.files).find((p) => p === target) ??
          Object.keys(zip.files).find((p) => p.endsWith(target.split('/').pop()!));
        const media = key ? zip.files[key] : undefined;
        if (!media || media.dir) continue;
        const ext = (key!.split('.').pop() ?? '').toLowerCase();
        if (!['png', 'jpg', 'jpeg'].includes(ext)) continue;
        const data = new Uint8Array(await media.async('uint8array'));
        images.push({ data, isPng: ext === 'png' });
      }
    } catch (err) {
      if (err instanceof UserError) throw err;
      /* slides without resolvable media just carry text */
    }
    slides.push({ texts, images });
  }
  return slides;
}
