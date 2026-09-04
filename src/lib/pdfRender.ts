/** pdf.js rendering: thumbnails, text extraction, rasterization for ZIP/compress. */
import * as pdfjsLib from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';

// Vite bundles the worker as a separate asset; this keeps everything local/offline after build.
pdfjsLib.GlobalWorkerOptions.workerSrc = workerUrl;

export interface RenderedPage {
  canvas: HTMLCanvasElement;
  width: number;
  height: number;
}

async function openDoc(bytes: ArrayBuffer, password?: string) {
  const copy = bytes.slice(0);
  return pdfjsLib.getDocument({
    data: copy,
    password: password ?? '',
    isEvalSupported: false,
  }).promise;
}

export async function getPageCount(bytes: ArrayBuffer): Promise<number> {
  const doc = await openDoc(bytes);
  const n = doc.numPages;
  await doc.destroy();
  return n;
}

export async function renderPage(
  bytes: ArrayBuffer,
  pageNumber: number, // 1-based
  scale = 1.2,
  password?: string,
): Promise<RenderedPage> {
  const doc = await openDoc(bytes, password);
  try {
    const page = await doc.getPage(pageNumber);
    const viewport = page.getViewport({ scale });
    const canvas = document.createElement('canvas');
    canvas.width = Math.floor(viewport.width);
    canvas.height = Math.floor(viewport.height);
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Canvas 2D not supported in this browser.');
    await page.render({ canvasContext: ctx, viewport }).promise;
    return { canvas, width: canvas.width, height: canvas.height };
  } finally {
    await doc.destroy();
  }
}

export async function renderAllPages(
  bytes: ArrayBuffer,
  scale: number,
  onProgress?: (done: number, total: number) => void,
  password?: string,
): Promise<HTMLCanvasElement[]> {
  const doc = await openDoc(bytes, password);
  const out: HTMLCanvasElement[] = [];
  try {
    for (let i = 1; i <= doc.numPages; i++) {
      const page = await doc.getPage(i);
      const viewport = page.getViewport({ scale });
      const canvas = document.createElement('canvas');
      canvas.width = Math.floor(viewport.width);
      canvas.height = Math.floor(viewport.height);
      const ctx = canvas.getContext('2d');
      if (!ctx) throw new Error('Canvas 2D not supported.');
      await page.render({ canvasContext: ctx, viewport }).promise;
      out.push(canvas);
      onProgress?.(i, doc.numPages);
    }
    return out;
  } finally {
    await doc.destroy();
  }
}

export async function extractAllText(
  bytes: ArrayBuffer,
  onProgress?: (done: number, total: number) => void,
  password?: string,
): Promise<string[]> {
  const doc = await openDoc(bytes, password);
  const pages: string[] = [];
  try {
    for (let i = 1; i <= doc.numPages; i++) {
      const page = await doc.getPage(i);
      const tc = await page.getTextContent();
      // Group items into lines by Y position for readable output.
      const lines = new Map<number, string[]>();
      for (const item of tc.items as Array<{ str: string; transform: number[] }>) {
        if (!('str' in item)) continue;
        const y = Math.round(item.transform[5]);
        if (!lines.has(y)) lines.set(y, []);
        lines.get(y)!.push(item.str);
      }
      const sorted = [...lines.entries()].sort((a, b) => b[0] - a[0]);
      pages.push(sorted.map(([, parts]) => parts.join(' ')).join('\n'));
      onProgress?.(i, doc.numPages);
    }
    return pages;
  } finally {
    await doc.destroy();
  }
}

export interface StyledLine {
  text: string;
  size: number;
  bold: boolean;
}

/** Like extractAllText, but keeps font size/weight per line for Markdown export. */
export async function extractStyledLines(
  bytes: ArrayBuffer,
  onProgress?: (done: number, total: number) => void,
  password?: string,
): Promise<StyledLine[][]> {
  const doc = await openDoc(bytes, password);
  const pages: StyledLine[][] = [];
  try {
    for (let i = 1; i <= doc.numPages; i++) {
      const page = await doc.getPage(i);
      const tc = await page.getTextContent();
      const lines = new Map<number, { parts: string[]; size: number; bold: boolean }>();
      for (const item of tc.items as Array<{ str: string; transform: number[]; fontName?: string }>) {
        if (!('str' in item) || !item.str) continue;
        const y = Math.round(item.transform[5]);
        const size = Math.abs(item.transform[0]) || 0;
        const bold = /bold|black|heavy|demi/i.test(item.fontName ?? '');
        if (!lines.has(y)) lines.set(y, { parts: [], size: 0, bold: false });
        const line = lines.get(y)!;
        line.parts.push(item.str);
        line.size = Math.max(line.size, size);
        line.bold = line.bold || bold;
      }
      pages.push(
        [...lines.entries()]
          .sort((a, b) => b[0] - a[0])
          .map(([, l]) => ({ text: l.parts.join(' '), size: l.size, bold: l.bold })),
      );
      onProgress?.(i, doc.numPages);
    }
    return pages;
  } finally {
    await doc.destroy();
  }
}

export function canvasToBlob(canvas: HTMLCanvasElement, type: 'image/jpeg' | 'image/png', quality = 0.92): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('Image export failed.'))), type, quality);
  });
}

/** Recolors a rendered page via canvas filters (dark mode, gray, sepia…). */
export function tintCanvas(src: HTMLCanvasElement, filter: string): HTMLCanvasElement {
  const out = document.createElement('canvas');
  out.width = src.width;
  out.height = src.height;
  const ctx = out.getContext('2d');
  if (!ctx) throw new Error('Canvas not supported.');
  ctx.filter = filter;
  ctx.drawImage(src, 0, 0);
  return out;
}

export function invertCanvas(src: HTMLCanvasElement): HTMLCanvasElement {
  return tintCanvas(src, 'invert(1) hue-rotate(180deg)');
}
