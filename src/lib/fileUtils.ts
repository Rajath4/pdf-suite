/** File helpers: download, read, validation. No PDF logic here. */

export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  requestAnimationFrame(() => {
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 4000);
  });
}

export function readAsArrayBuffer(file: File): Promise<ArrayBuffer> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result as ArrayBuffer);
    r.onerror = () => reject(r.error ?? new Error('Failed to read file'));
    r.readAsArrayBuffer(file);
  });
}

export function readAsText(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result ?? ''));
    r.onerror = () => reject(r.error ?? new Error('Failed to read file'));
    r.readAsText(file);
  });
}

export function readAsDataURL(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(r.error ?? new Error('Failed to read file'));
    r.readAsDataURL(file);
  });
}

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return '—';
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB'];
  let v = bytes / 1024;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v.toFixed(v >= 100 ? 0 : 1)} ${units[i]}`;
}

export function assertPdf(file: File): void {
  const ok =
    file.type === 'application/pdf' ||
    file.name.toLowerCase().endsWith('.pdf');
  if (!ok) throw new Error(`"${file.name}" is not a PDF file.`);
}

export function baseName(name: string): string {
  return name.replace(/\.[^.]+$/, '') || 'document';
}

export function withExt(stem: string, ext: string): string {
  return `${baseName(stem)}.${ext}`;
}

/**
 * Behavioral UX: extracts "done/total" from engine progress messages like
 * "Rendering 3/12…" so the UI can show a determinate progress bar
 * (research: users tolerate long waits far better with percent-done feedback).
 */
export function parseProgress(msg: string): { done: number; total: number } | null {
  const m = msg.match(/(\d+)\s*\/\s*(\d+)/);
  if (!m) return null;
  const done = Number(m[1]);
  const total = Number(m[2]);
  if (!Number.isFinite(done) || !Number.isFinite(total) || total <= 0) return null;
  return { done: Math.min(done, total), total };
}

/** Merge input kinds. Smallpdf parity: photos and documents merge alongside PDFs. */
export type MergeKind = 'pdf' | 'image' | 'text' | 'word' | 'sheet' | 'unsupported';

export function classifyMergeFile(name: string, mime: string): MergeKind {
  const lower = name.toLowerCase();
  const ext = lower.includes('.') ? lower.slice(lower.lastIndexOf('.')) : '';
  if (mime === 'application/pdf' || ext === '.pdf') return 'pdf';
  if (mime.startsWith('image/') || ['.jpg', '.jpeg', '.png', '.webp', '.gif', '.bmp'].includes(ext)) return 'image';
  if (mime === 'text/plain' || mime === 'text/markdown' || ['.txt', '.md', '.markdown'].includes(ext)) return 'text';
  if (mime === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' || ext === '.docx') return 'word';
  if (mime.includes('spreadsheet') || mime === 'text/csv' || ['.csv', '.xlsx', '.xls'].includes(ext)) return 'sheet';
  return 'unsupported';
}

export function isPdfName(name: string, mime: string): boolean {
  return classifyMergeFile(name, mime) === 'pdf';
}

/**
 * "Recently used" list for repeat-visit behavior. Pure (storage-agnostic)
 * so it stays unit-testable; the UI layer binds it to localStorage.
 */
export function pushRecent(list: string[], id: string, max = 5): string[] {
  return [id, ...list.filter((x) => x !== id)].slice(0, Math.max(1, max));
}

import { LARGE_FILE_MAX_BYTES, LARGE_SHRINK_MAX_BYTES } from './largeFiles.js';

/**
 * Why any cap exists: a PDF explodes in memory — pdf-lib's object model runs
 * 2–5× file size in JS heap, and one 300-DPI page bitmap is ~35 MB. Mobile
 * browsers kill tabs around 1–2 GB. No guard = frozen tab = lost work.
 *
 * But a flat cap punishes capable desktops, so the limit adapts two ways:
 * device RAM (via navigator.deviceMemory) and operation cost — rasterizing
 * tools hold full-page bitmaps and stay capped low, while page-shuffling
 * tools (merge, split, organize…) can safely take far more.
 */
const MB = 1024 * 1024;

/** Tools that rasterize pages into bitmaps — memory-hungry by nature. */
const HEAVY_TOOLS = new Set(['compress', 'pdf-to-jpg', 'ocr', 'invert', 'pdf-to-pptx']);

export function deviceMemoryGB(): number | null {
  const nav =
    typeof navigator === 'undefined'
      ? undefined
      : (navigator as Navigator & { deviceMemory?: number });
  const dm = nav?.deviceMemory;
  return typeof dm === 'number' && dm > 0 ? dm : null;
}

export function fileLimitBytes(toolId = ''): number {
  // Streaming large-file tools never hold the file (Blob.slice views + tiny
  // head/tail reads), so they scale to disk size instead of tab RAM.
  if (toolId === 'large-files') return LARGE_FILE_MAX_BYTES;
  const fast = fastPathCapBytes(toolId);
  if (toolId === 'compress') {
    // Adaptive Compress: files over the fast cap stream page-by-page instead
    // of loading whole. Low-RAM phones stay on the fast cap (streaming would
    // thrash); unknown devices get a middle ceiling; desktops get ~1 GB.
    const dm = deviceMemoryGB();
    if (dm != null && dm <= 2) return fast;
    if (dm == null) return Math.max(fast, 500 * MB);
    return Math.max(fast, LARGE_SHRINK_MAX_BYTES);
  }
  return fast;
}

/** In-memory fast path ceiling, before any streaming fallback. */
export function fastPathCapBytes(toolId = ''): number {
  const dm = deviceMemoryGB();
  const baseMB = dm == null ? 250 : dm <= 2 ? 100 : dm <= 4 ? 250 : 500;
  if (HEAVY_TOOLS.has(toolId)) return Math.min(baseMB, 200) * MB;
  return baseMB * MB;
}

/**
 * Demand-driven diagnosis (users constantly ask "why is my PDF so big?"):
 * KB per page reveals the culprit — lean text (<200 KB), mixed content,
 * or photo-pages (≥1 MB) where compression works miracles.
 */
export function pageWeight(
  bytes: number,
  pageCount: number,
): { kbPerPage: number; kind: 'lean' | 'mixed' | 'photo' } | null {
  if (!Number.isFinite(bytes) || !Number.isFinite(pageCount) || bytes <= 0 || pageCount <= 0) {
    return null;
  }
  const kbPerPage = bytes / pageCount / 1024;
  return {
    kbPerPage,
    kind: kbPerPage < 200 ? 'lean' : kbPerPage < 1000 ? 'mixed' : 'photo',
  };
}

export function pageWeightHint(kind: 'lean' | 'mixed' | 'photo'): string {
  if (kind === 'photo') {
    return 'Pages are essentially photos — Heavy or target-size will shrink this dramatically.';
  }
  if (kind === 'mixed') {
    return 'Mix of text and images — Medium or Heavy gives the best size/quality trade-off.';
  }
  return 'Already lean text — expect modest savings, not miracles.';
}

/** Editorial read-time estimate (words per minute), minimum 1 minute. */
export function readMinutes(wordCount: number, wpm = 200): number {
  if (!Number.isFinite(wordCount) || wordCount <= 0) return 1;
  return Math.max(1, Math.ceil(wordCount / wpm));
}

/** "2026-09-04" → "Sep 2026". Falls back to the raw string when invalid. */
export function fmtMonth(iso: string): string {
  const m = /^(\d{4})-(\d{2})-\d{2}$/.exec(iso.trim());
  if (!m) return iso;
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const month = months[Number(m[2]) - 1];
  if (!month) return iso;
  return `${month} ${m[1]}`;
}

export async function loadImageElement(src: string): Promise<HTMLImageElement> {
  const img = new Image();
  img.decoding = 'async';
  await new Promise<void>((resolve, reject) => {
    img.onload = () => resolve();
    img.onerror = () => reject(new Error('Could not decode image. Use JPG/PNG/WebP.'));
    img.src = src;
  });
  return img;
}
