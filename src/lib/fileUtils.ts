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

/**
 * "Recently used" list for repeat-visit behavior. Pure (storage-agnostic)
 * so it stays unit-testable; the UI layer binds it to localStorage.
 */
export function pushRecent(list: string[], id: string, max = 5): string[] {
  return [id, ...list.filter((x) => x !== id)].slice(0, Math.max(1, max));
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
