/** Office/text format conversions. All client-side. */
import { Document, Packer, Paragraph, TextRun } from 'docx';
import mammoth from 'mammoth';
import * as XLSX from 'xlsx';
import type { TableData } from './pdfCore.js';
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
    // Skip fully-empty trailing rows
    if (row.length > 1 || row[0]?.trim() !== '' || cell.trim() !== '') {
      pushCell();
      rows.push(row);
    } else {
      cell = '';
    }
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
  if (row.length > 1 || (row.length === 1 && row[0].trim() !== '')) rows.push(row);
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
