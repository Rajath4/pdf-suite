/**
 * Large-file streaming helpers: constant-memory operations for GB-scale files.
 *
 * Why this exists: pdf-lib loads whole documents into the JS heap (2–5x blowup),
 * and a tab caps around 4 GB — so true 5 GB+ PDF-aware work is impossible in a
 * pure offline PWA. These helpers never hold the file: they work on Blob.slice()
 * views (zero-copy) plus tiny head/tail reads, so split / rejoin / inspect scale
 * to disk size, not RAM size.
 *
 * Honest constraint (surfaced in UI copy): binary chunks are for transport
 * (email portals, upload limits) and must be rejoined — they are NOT valid PDFs
 * alone. No PDF parsing happens here by design.
 */

export const LARGE_FILE_MAX_BYTES = 6 * 1024 * 1024 * 1024; // 6 GB hard ceiling
const HEAD_BYTES = 64 * 1024;
const TAIL_BYTES = 512 * 1024;

export interface Slicable {
  readonly size: number;
  slice(start: number, end: number): Blob;
}

export interface ChunkPlan {
  index: number; // 1-based
  start: number;
  end: number; // exclusive
  total: number;
}

/** Parse + clamp the chunk-size option. Pure and unit-tested. */
export function parseChunkMB(raw: string | undefined, fallbackMB = 100): number {
  const n = Number(raw ?? fallbackMB);
  if (!Number.isFinite(n)) return fallbackMB;
  return Math.min(2000, Math.max(5, Math.floor(n)));
}

/** Pages-per-output-file for Shrink mode: bounds batch RAM (one batch doc). */
export function parsePagesPerFile(raw: string | undefined, fallback = 50): number {
  const n = Number(raw ?? fallback);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(200, Math.max(10, Math.floor(n)));
}

export interface PageBatch {
  index: number; // 1-based
  startPage: number; // 1-based inclusive
  endPage: number; // 1-based inclusive
}

/** Split N pages into valid-PDF batches. Pure math, unit-tested. */
export function planBatches(pageCount: number, perFile: number): PageBatch[] {
  if (!Number.isFinite(pageCount) || pageCount <= 0) return [];
  if (!Number.isFinite(perFile) || perFile <= 0) return [];
  const out: PageBatch[] = [];
  let start = 1;
  let index = 1;
  while (start <= pageCount) {
    const end = Math.min(pageCount, start + perFile - 1);
    out.push({ index, startPage: start, endPage: end });
    start = end + 1;
    index++;
  }
  return out;
}

export type ShrinkPreset = 'light' | 'medium' | 'heavy';

/** Render scale + JPEG quality per preset (mirrors the main Compress tool). */
export function shrinkPresetCfg(preset: string): { scale: number; q: number } {
  if (preset === 'light') return { scale: 2.0, q: 0.85 };
  if (preset === 'heavy') return { scale: 1.0, q: 0.55 };
  return { scale: 1.5, q: 0.72 };
}

/** Byte ranges for N chunks. No I/O — pure math, constant memory. */
export function planChunks(totalBytes: number, chunkBytes: number): ChunkPlan[] {
  if (!Number.isFinite(totalBytes) || totalBytes <= 0) return [];
  if (!Number.isFinite(chunkBytes) || chunkBytes <= 0) return [];
  const out: ChunkPlan[] = [];
  let start = 0;
  let index = 1;
  while (start < totalBytes) {
    const end = Math.min(totalBytes, start + chunkBytes);
    out.push({ index, start, end, total: totalBytes });
    start = end;
    index++;
  }
  return out;
}

/** `%PDF-1.7` version sniff from the first bytes. */
export function sniffHeader(head: string): { isPdf: boolean; version: string | null } {
  const m = /%PDF-(\d\.\d)/.exec(head.slice(0, 1024));
  return { isPdf: m !== null || head.startsWith('%PDF'), version: m ? m[1] : null };
}

/** Trailer sniff from the last bytes: healthy PDFs end with startxref + %%EOF. */
export function sniffTail(tail: string): { hasStartxref: boolean; hasEof: boolean } {
  return {
    hasStartxref: tail.includes('startxref'),
    hasEof: tail.trimEnd().endsWith('%%EOF'),
  };
}

export function stripPartSuffix(name: string): string {
  return name.replace(/\.part\d{3,}(\.[^.]+)?$/, '') || name;
}

export function chunkFileName(base: string, index: number): string {
  return `${base}.part${String(index).padStart(3, '0')}`;
}

export function rejoinFileName(firstName: string): string {
  const stripped = stripPartSuffix(firstName);
  if (/\.pdf$/i.test(stripped)) return stripped.replace(/\.pdf$/i, '-rejoined.pdf');
  return `${stripped}-rejoined`;
}

async function readSliceText(blob: Blob, maxBytes: number): Promise<string> {
  const buf = await blob.arrayBuffer();
  const bytes = new Uint8Array(buf).slice(0, maxBytes);
  // Latin-1 keeps byte offsets 1:1 for marker scanning (no multi-byte decoding).
  let out = '';
  const CHUNK = 8192;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    out += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return out;
}

export interface LargeInspectResult {
  reportText: string;
  note: string;
}

/**
 * Inspect a giant file reading at most ~576 KB (head + tail). Never loads it.
 * Returns a human-readable report for the .txt output + preview.
 */
export async function inspectLargeFile(
  file: Slicable & { name: string },
  chunkMB: number,
): Promise<LargeInspectResult> {
  const headBlob = file.slice(0, Math.min(HEAD_BYTES, file.size));
  const tailStart = Math.max(0, file.size - Math.min(TAIL_BYTES, file.size));
  const tailBlob = file.slice(tailStart, file.size);
  const [head, tail] = await Promise.all([
    readSliceText(headBlob, HEAD_BYTES),
    readSliceText(tailBlob, TAIL_BYTES),
  ]);
  const h = sniffHeader(head);
  const t = sniffTail(tail);
  const chunks = planChunks(file.size, chunkMB * 1024 * 1024).length;
  const lines = [
    `File: ${file.name}`,
    `Size: ${(file.size / 1024 / 1024).toFixed(1)} MB (${file.size} bytes)`,
    `Looks like PDF: ${h.isPdf ? `yes${h.version ? ` (v${h.version})` : ''}` : 'no — header missing %PDF'}`,
    `Trailer: startxref ${t.hasStartxref ? 'found' : 'MISSING'}, %%EOF ${t.hasEof ? 'found' : 'MISSING'}`,
    `Suggested chunks at ${chunkMB} MB: ${chunks} part file(s)`,
    t.hasStartxref && t.hasEof
      ? 'Verdict: structure looks intact — binary-split for transport, then rejoin before opening.'
      : 'Verdict: trailer looks truncated — try Tools → Repair PDF on a desktop copy, or re-export the source.',
  ];
  return {
    reportText: lines.join('\n') + '\n',
    note: 'Inspected head + tail only (~576 KB read) — the full file never entered memory.',
  };
}
