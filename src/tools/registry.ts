import type { ToolDef } from '../types.js';

export const TOOLS: ToolDef[] = [
  // Essentials
  { id: 'merge', title: 'Merge PDFs', description: 'Combine multiple PDFs into one. Pick pages per file, reorder freely.', category: 'Essentials', icon: '⧉', accept: 'application/pdf,.pdf', multiple: true },
  { id: 'split', title: 'Split PDF', description: 'Ranges, every-N chunks, odd/even, or split by file size.', category: 'Essentials', icon: '✂', accept: 'application/pdf,.pdf', multiple: false },
  { id: 'compress', title: 'Compress PDF', description: 'Presets, or shrink to an exact target size (e.g. under 1 MB). Batch supported.', category: 'Essentials', icon: '🗜', accept: 'application/pdf,.pdf', multiple: true },
  { id: 'pdf-to-jpg', title: 'PDF to JPG / PNG', description: 'Export pages as images, or all pages as a ZIP.', category: 'Essentials', icon: '📸', accept: 'application/pdf,.pdf', multiple: false },
  { id: 'extract-images', title: 'Extract Images', description: 'Pull embedded photos and graphics out of a PDF.', category: 'Essentials', icon: '🖼', accept: 'application/pdf,.pdf', multiple: false },
  { id: 'images-to-pdf', title: 'Images to PDF', description: 'Turn JPG / PNG / WebP photos into one PDF.', category: 'Essentials', icon: '📷', accept: 'image/*,.jpg,.jpeg,.png,.webp', multiple: true },

  // Edit & Organize
  { id: 'organize', title: 'Organize Pages', description: 'Reorder, rotate and delete pages with live thumbnails.', category: 'Edit & Organize', icon: '🗂', accept: 'application/pdf,.pdf', multiple: false },
  { id: 'sign', title: 'Sign PDF', description: 'Draw, type or upload your signature and stamp it anywhere.', category: 'Edit & Organize', icon: '✒', accept: 'application/pdf,.pdf', multiple: false },
  { id: 'annotate', title: 'Edit & Annotate', description: 'Add text, highlights and image stamps on any page.', category: 'Edit & Organize', icon: '🖊', accept: 'application/pdf,.pdf', multiple: false },
  { id: 'crop', title: 'Crop PDF', description: 'Trim margins on all pages or selected pages.', category: 'Edit & Organize', icon: '◧', accept: 'application/pdf,.pdf', multiple: false },
  { id: 'fill-forms', title: 'Fill PDF Forms', description: 'Fill interactive form fields, then flatten to lock them.', category: 'Edit & Organize', icon: '📑', accept: 'application/pdf,.pdf', multiple: false },
  { id: 'rotate', title: 'Rotate PDF', description: 'Rotate all pages or selected pages 90° / 180° / 270°. Batch supported.', category: 'Edit & Organize', icon: '⟳', accept: 'application/pdf,.pdf', multiple: true },
  { id: 'watermark', title: 'Add Watermark', description: 'Text or logo overlay, single or tiled. Batch supported.', category: 'Edit & Organize', icon: '💧', accept: 'application/pdf,.pdf', multiple: true },
  { id: 'page-numbers', title: 'Add Page Numbers', description: 'Auto-number pages with position and format control. Batch supported.', category: 'Edit & Organize', icon: '🔢', accept: 'application/pdf,.pdf', multiple: true },
  { id: 'header-footer', title: 'Headers & Footers', description: 'Add header/footer text with {page} and {total}. Batch supported.', category: 'Edit & Organize', icon: '📄', accept: 'application/pdf,.pdf', multiple: true },
  { id: 'redact', title: 'Redact PDF', description: 'Cover sensitive areas with permanent black boxes.', category: 'Edit & Organize', icon: '⬛', accept: 'application/pdf,.pdf', multiple: false },
  { id: 'extract-text', title: 'Extract Text / Markdown', description: 'Copy text out, or export structured Markdown.', category: 'Edit & Organize', icon: '📋', accept: 'application/pdf,.pdf', multiple: false },
  { id: 'ocr', title: 'OCR — Scan to Text', description: 'Recognize text in scans, in 14 languages, on-device.', category: 'Edit & Organize', icon: '👁', accept: 'application/pdf,.pdf,image/*', multiple: false },

  // Security
  { id: 'encrypt', title: 'Protect PDF', description: 'Add a password with AES encryption. Stays on device. Batch supported.', category: 'Security & Privacy', icon: '🔒', accept: 'application/pdf,.pdf', multiple: true },
  { id: 'decrypt', title: 'Unlock PDF', description: 'Remove the password from a PDF you own.', category: 'Security & Privacy', icon: '🔓', accept: 'application/pdf,.pdf', multiple: false },
  { id: 'flatten', title: 'Flatten PDF', description: 'Bake form fields and annotations so PDF is static. Batch supported.', category: 'Security & Privacy', icon: '🧱', accept: 'application/pdf,.pdf', multiple: true },
  { id: 'privacy', title: 'Privacy Scanner', description: 'Inspect, edit, or strip hidden metadata in one click.', category: 'Security & Privacy', icon: '🕵', accept: 'application/pdf,.pdf', multiple: false },

  // Convert
  { id: 'pdf-to-word', title: 'PDF to Word', description: 'Export extracted text to an editable .docx file.', category: 'Convert & Export', icon: '📝', accept: 'application/pdf,.pdf', multiple: false },
  { id: 'word-to-pdf', title: 'Word to PDF', description: 'Convert .docx to PDF with headings preserved.', category: 'Convert & Export', icon: '📘', accept: '.docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document', multiple: false },
  { id: 'pdf-to-excel', title: 'PDF to Excel / CSV', description: 'Pull text tables out into .csv and .xlsx.', category: 'Convert & Export', icon: '📊', accept: 'application/pdf,.pdf', multiple: false },
  { id: 'pdf-to-pptx', title: 'PDF to PowerPoint', description: 'Turn each page into an editable .pptx slide.', category: 'Convert & Export', icon: '🖥', accept: 'application/pdf,.pdf', multiple: false },
  { id: 'pptx-to-pdf', title: 'PowerPoint to PDF', description: 'Convert .pptx slides to PDF with text and images.', category: 'Convert & Export', icon: '📽', accept: '.pptx,application/vnd.openxmlformats-officedocument.presentationml.presentation', multiple: false },
  { id: 'excel-to-pdf', title: 'Excel / CSV to PDF', description: 'Render spreadsheets as clean PDF tables.', category: 'Convert & Export', icon: '🧾', accept: '.csv,.xlsx,.xls,text/csv', multiple: false },
  { id: 'pdf-to-html', title: 'PDF to HTML', description: 'Publish PDF text as a styled standalone webpage.', category: 'Convert & Export', icon: '🌐', accept: 'application/pdf,.pdf', multiple: false },
  { id: 'invert', title: 'Recolor PDF', description: 'Dark mode, invert, grayscale, or sepia — print-friendly.', category: 'Convert & Export', icon: '🌙', accept: 'application/pdf,.pdf', multiple: false },

  // Create
  { id: 'create', title: 'Create PDF', description: 'Write title + body and export a clean PDF.', category: 'Create from Scratch', icon: '✍', accept: '', multiple: false },
  { id: 'markdown', title: 'Markdown to PDF', description: 'Paste Markdown, get a formatted PDF instantly.', category: 'Create from Scratch', icon: '⬇', accept: '.md,.markdown,text/markdown', multiple: false },
  { id: 'html-to-pdf', title: 'HTML to PDF', description: 'Paste HTML or upload .html and export PDF.', category: 'Create from Scratch', icon: '💻', accept: '.html,.htm,text/html', multiple: false },

  // Utilities
  { id: 'compare', title: 'Compare PDFs', description: 'View two PDFs side-by-side with synced scrolling.', category: 'View & Utilities', icon: '⚖', accept: 'application/pdf,.pdf', multiple: true },
  { id: 'repair', title: 'Repair PDF', description: 'Recover readable pages from a damaged PDF.', category: 'View & Utilities', icon: '🛠', accept: 'application/pdf,.pdf', multiple: false },
  { id: 'scan', title: 'Scan to PDF', description: 'Use your camera as a scanner and save as PDF.', category: 'View & Utilities', icon: '📡', accept: 'image/*', multiple: true },
];

export const CATEGORIES: string[] = [...new Set(TOOLS.map((t) => t.category))];

export function getTool(id: string) {
  return TOOLS.find((t) => t.id === id);
}

/**
 * Canonical public slugs — one indexable landing page per tool.
 * Single source of truth for the app router; content.json mirrors it
 * (enforced by seo.test.ts) for the prerender script.
 */
export const TOOL_SLUGS: Record<string, string> = {
  merge: 'merge-pdf',
  split: 'split-pdf',
  compress: 'compress-pdf',
  'pdf-to-jpg': 'pdf-to-jpg',
  'extract-images': 'extract-images',
  'images-to-pdf': 'images-to-pdf',
  organize: 'organize-pages',
  sign: 'sign-pdf',
  annotate: 'edit-pdf',
  crop: 'crop-pdf',
  'fill-forms': 'fill-pdf-forms',
  rotate: 'rotate-pdf',
  watermark: 'add-watermark',
  'page-numbers': 'add-page-numbers',
  'header-footer': 'headers-footers',
  redact: 'redact-pdf',
  'extract-text': 'extract-text',
  ocr: 'ocr-pdf',
  encrypt: 'protect-pdf',
  decrypt: 'unlock-pdf',
  flatten: 'flatten-pdf',
  privacy: 'remove-pdf-metadata',
  'pdf-to-word': 'pdf-to-word',
  'word-to-pdf': 'word-to-pdf',
  'pdf-to-excel': 'pdf-to-excel',
  'excel-to-pdf': 'excel-to-pdf',
  'pdf-to-pptx': 'pdf-to-pptx',
  'pptx-to-pdf': 'pptx-to-pdf',
  'pdf-to-html': 'pdf-to-html',
  invert: 'pdf-dark-mode',
  create: 'create-pdf',
  markdown: 'markdown-to-pdf',
  'html-to-pdf': 'html-to-pdf',
  compare: 'compare-pdfs',
  repair: 'repair-pdf',
  scan: 'scan-to-pdf',
};

export function toolSlug(id: string): string {
  return TOOL_SLUGS[id] ?? id;
}

export function toolIdFromSlug(slug: string): string | undefined {
  return Object.keys(TOOL_SLUGS).find((id) => TOOL_SLUGS[id] === slug);
}

/**
 * Productivity chaining ("Continue in …"): the natural next tools after each
 * operation, mirroring how Smallpdf connects tools — except our handoff
 * carries the actual output file, offline. Validated by registry.test.ts.
 */
export const NEXT_TOOLS: Record<string, string[]> = {
  merge: ['compress', 'split', 'encrypt'],
  split: ['merge', 'compress', 'organize'],
  compress: ['merge', 'encrypt', 'pdf-to-jpg'],
  'pdf-to-jpg': ['images-to-pdf', 'merge'],
  'extract-images': ['images-to-pdf', 'merge'],
  'images-to-pdf': ['merge', 'compress'],
  organize: ['merge', 'compress', 'rotate'],
  sign: ['encrypt', 'flatten', 'merge'],
  annotate: ['flatten', 'merge', 'compress'],
  crop: ['compress', 'merge'],
  'fill-forms': ['flatten', 'encrypt', 'sign'],
  rotate: ['merge', 'compress'],
  watermark: ['flatten', 'encrypt', 'merge'],
  'page-numbers': ['merge', 'flatten'],
  'header-footer': ['merge', 'flatten'],
  redact: ['flatten', 'encrypt'],
  'extract-text': ['pdf-to-word', 'pdf-to-excel'],
  ocr: ['extract-text', 'pdf-to-word'],
  encrypt: ['merge', 'decrypt'],
  decrypt: ['merge', 'compress', 'encrypt'],
  flatten: ['merge', 'encrypt'],
  privacy: ['encrypt', 'merge'],
  'pdf-to-word': ['word-to-pdf', 'merge'],
  'word-to-pdf': ['merge', 'compress'],
  'pdf-to-excel': ['excel-to-pdf', 'merge'],
  'excel-to-pdf': ['merge', 'compress'],
  'pdf-to-pptx': ['pptx-to-pdf', 'merge'],
  'pptx-to-pdf': ['merge', 'compress'],
  'pdf-to-html': ['merge'],
  invert: ['merge', 'compress'],
  create: ['merge'],
  markdown: ['merge'],
  'html-to-pdf': ['merge', 'compress'],
  compare: ['merge'],
  repair: ['split', 'compress'],
  scan: ['merge', 'ocr', 'compress'],
};

export function nextTools(id: string): ToolDef[] {
  const ids = NEXT_TOOLS[id] ?? ['merge', 'compress', 'split'];
  return ids.filter((x) => x !== id).map((x) => getTool(x)!).filter(Boolean).slice(0, 3);
}

/** Synonyms users type that never appear in tool names ("ppt", "esign"…). */
const SYNONYMS: Record<string, string[]> = {
  ppt: ['powerpoint', 'pptx', 'slides', 'presentation'],
  powerpoint: ['pptx', 'slides'],
  word: ['docx', 'doc'],
  excel: ['xlsx', 'spreadsheet', 'csv'],
  photo: ['image', 'jpg', 'png', 'picture'],
  picture: ['image', 'jpg', 'png'],
  jpg: ['image', 'picture'],
  png: ['image', 'picture'],
  sign: ['signature', 'esign'],
  signature: ['sign'],
  zip: ['archive', 'compress'],
  ocr: ['scan', 'recognition', 'searchable'],
  delete: ['remove', 'organize', 'extract'],
  remove: ['delete', 'organize'],
  password: ['protect', 'encrypt', 'unlock'],
  merge: ['combine', 'join'],
  split: ['extract', 'divide'],
  dark: ['recolor', 'invert', 'night'],
  gray: ['recolor', 'grayscale'],
  grey: ['recolor', 'grayscale'],
  markdown: ['md'],
  sheet: ['excel', 'csv', 'spreadsheet'],
  table: ['excel', 'csv'],
};

/**
 * Instant, typo-tolerant tool search for the command palette and homepage.
 * Scored so the obvious target lands in the first rows (research: ranking
 * quality is what makes or breaks palette UX).
 */
export function searchTools(query: string, limit = 9): ToolDef[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  const words = q.split(/\s+/).filter((w) => w.length >= 2);
  const scored: { tool: ToolDef; score: number }[] = [];
  for (const t of TOOLS) {
    const title = t.title.toLowerCase();
    const hay = `${t.title} ${t.description} ${t.category} ${t.id.replace(/-/g, ' ')}`.toLowerCase();
    let score = 0;
    if (title === q) score += 100;
    else if (title.startsWith(q)) score += 80;
    else if (title.includes(q)) score += 60;
    else if (t.id.replace(/-/g, '') === q.replace(/\s+/g, '')) score += 70;
    for (const w of words) {
      if (title.includes(w)) score += 12;
      else if (hay.includes(w)) score += 5;
    }
    for (const [key, syns] of Object.entries(SYNONYMS)) {
      if (q.includes(key) && syns.some((s) => hay.includes(s))) score += 25;
    }
    if (score > 0) scored.push({ tool: t, score });
  }
  return scored
    .sort((a, b) => b.score - a.score || a.tool.title.localeCompare(b.tool.title))
    .slice(0, Math.max(1, limit))
    .map((s) => s.tool);
}
