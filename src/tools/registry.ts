import type { ToolDef } from '../types.js';

export const TOOLS: ToolDef[] = [
  // Essentials
  { id: 'merge', title: 'Merge PDFs', description: 'Combine multiple PDFs into one. Reorder with drag & drop.', category: 'Essentials', icon: '⧉', accept: 'application/pdf,.pdf', multiple: true },
  { id: 'split', title: 'Split PDF', description: 'Extract page ranges or save every page as its own file.', category: 'Essentials', icon: '✂', accept: 'application/pdf,.pdf', multiple: false },
  { id: 'compress', title: 'Compress PDF', description: 'Shrink file size with Light / Medium / Heavy presets.', category: 'Essentials', icon: '🗜', accept: 'application/pdf,.pdf', multiple: false },
  { id: 'pdf-to-jpg', title: 'PDF to JPG / PNG', description: 'Export pages as images, or all pages as a ZIP.', category: 'Essentials', icon: '🖼', accept: 'application/pdf,.pdf', multiple: false },
  { id: 'images-to-pdf', title: 'Images to PDF', description: 'Turn JPG / PNG / WebP photos into one PDF.', category: 'Essentials', icon: '📷', accept: 'image/*,.jpg,.jpeg,.png,.webp', multiple: true },

  // Edit & Organize
  { id: 'organize', title: 'Organize Pages', description: 'Reorder, rotate and delete pages with live thumbnails.', category: 'Edit & Organize', icon: '🗂', accept: 'application/pdf,.pdf', multiple: false },
  { id: 'rotate', title: 'Rotate PDF', description: 'Rotate all pages or selected pages 90° / 180° / 270°.', category: 'Edit & Organize', icon: '⟳', accept: 'application/pdf,.pdf', multiple: false },
  { id: 'watermark', title: 'Add Watermark', description: 'Overlay custom diagonal or tiled text on every page.', category: 'Edit & Organize', icon: '💧', accept: 'application/pdf,.pdf', multiple: false },
  { id: 'page-numbers', title: 'Add Page Numbers', description: 'Auto-number pages with position and format control.', category: 'Edit & Organize', icon: '🔢', accept: 'application/pdf,.pdf', multiple: false },
  { id: 'header-footer', title: 'Headers & Footers', description: 'Add header/footer text with {page} and {total}.', category: 'Edit & Organize', icon: '📄', accept: 'application/pdf,.pdf', multiple: false },
  { id: 'redact', title: 'Redact PDF', description: 'Cover sensitive areas with permanent black boxes.', category: 'Edit & Organize', icon: '⬛', accept: 'application/pdf,.pdf', multiple: false },
  { id: 'extract-text', title: 'Extract Text', description: 'Copy all text out of a PDF, page by page.', category: 'Edit & Organize', icon: '📋', accept: 'application/pdf,.pdf', multiple: false },
  { id: 'ocr', title: 'OCR — Scan to Text', description: 'Recognize text in scanned pages (English, on-device).', category: 'Edit & Organize', icon: '👁', accept: 'application/pdf,.pdf,image/*', multiple: false },

  // Security
  { id: 'encrypt', title: 'Protect PDF', description: 'Add a password with AES encryption. Stays on device.', category: 'Security & Privacy', icon: '🔒', accept: 'application/pdf,.pdf', multiple: false },
  { id: 'decrypt', title: 'Unlock PDF', description: 'Remove the password from a PDF you own.', category: 'Security & Privacy', icon: '🔓', accept: 'application/pdf,.pdf', multiple: false },
  { id: 'flatten', title: 'Flatten PDF', description: 'Bake form fields and annotations so PDF is static.', category: 'Security & Privacy', icon: '🧱', accept: 'application/pdf,.pdf', multiple: false },
  { id: 'privacy', title: 'Privacy Scanner', description: 'Inspect hidden metadata, then strip it in one click.', category: 'Security & Privacy', icon: '🕵', accept: 'application/pdf,.pdf', multiple: false },

  // Convert
  { id: 'pdf-to-word', title: 'PDF to Word', description: 'Export extracted text to an editable .docx file.', category: 'Convert & Export', icon: '📝', accept: 'application/pdf,.pdf', multiple: false },
  { id: 'word-to-pdf', title: 'Word to PDF', description: 'Convert .docx to PDF with headings preserved.', category: 'Convert & Export', icon: '📘', accept: '.docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document', multiple: false },
  { id: 'pdf-to-excel', title: 'PDF to Excel / CSV', description: 'Pull text tables out into .csv and .xlsx.', category: 'Convert & Export', icon: '📊', accept: 'application/pdf,.pdf', multiple: false },
  { id: 'excel-to-pdf', title: 'Excel / CSV to PDF', description: 'Render spreadsheets as clean PDF tables.', category: 'Convert & Export', icon: '🧾', accept: '.csv,.xlsx,.xls,text/csv', multiple: false },
  { id: 'pdf-to-html', title: 'PDF to HTML', description: 'Publish PDF text as a styled standalone webpage.', category: 'Convert & Export', icon: '🌐', accept: 'application/pdf,.pdf', multiple: false },
  { id: 'invert', title: 'Invert Colors', description: 'Dark-mode PDF: rebuild pages with inverted colors.', category: 'Convert & Export', icon: '🌙', accept: 'application/pdf,.pdf', multiple: false },

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
