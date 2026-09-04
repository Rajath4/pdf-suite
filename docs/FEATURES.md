# Feature Catalog — all 37 tools

Live at [https://pdfhaven.app/](https://pdfhaven.app/). Every tool runs 100%
client-side and works offline after first load. Limits adapt to device RAM;
figures below are for a capable desktop (8 GB+ RAM, Chrome/Edge).

## Essentials (6)

- **Merge PDFs** — Combine PDFs, photos & documents into one. Pick pages per file, reorder freely.
- **Split PDF** — Ranges, every-N chunks, odd/even, or split by file size.
- **Compress PDF** — Presets, or shrink to an exact target size (e.g. under 1 MB). Batch supported.
  Files over the fast-path cap switch to streaming mode automatically (~1 GB ceiling).
- **PDF to JPG / PNG** — Export pages as images, or all pages as a ZIP.
- **Extract Images** — Pull embedded photos and graphics out of a PDF.
- **Images to PDF** — Turn JPG / PNG / WebP photos into one PDF.

## Edit & Organize (12)

- **Organize Pages** — Reorder, rotate and delete pages with live thumbnails.
- **Sign PDF** — Draw, type or upload your signature and stamp it anywhere.
- **Edit & Annotate** — Add text, highlights and image stamps on any page.
- **Crop PDF** — Trim margins on all pages or selected pages.
- **Fill PDF Forms** — Fill interactive form fields, then flatten to lock them.
- **Rotate PDF** — Rotate all pages or selected pages 90° / 180° / 270°. Batch supported.
- **Add Watermark** — Text or logo overlay, single or tiled. Batch supported.
- **Add Page Numbers** — Auto-number pages with position and format control. Batch supported.
- **Headers & Footers** — Add header/footer text with `{page}` and `{total}`. Batch supported.
- **Redact PDF** — Cover sensitive areas with permanent black boxes.
- **Extract Text / Markdown** — Copy text out, or export structured Markdown.
- **OCR — Scan to Text** — Recognize text in scans, in 14 languages, on-device.
  (First use downloads the language pack from a pinned CDN; cached for offline after.)

## Security & Privacy (4)

- **Protect PDF** — Real AES-256 password encryption, enforced locally. Batch supported.
- **Unlock PDF** — Strict password verification; wrong passwords are refused, never silently accepted.
- **Flatten PDF** — Bake form fields and annotations so the PDF is static. Batch supported.
- **Privacy Scanner** — Inspect, edit, or strip hidden metadata in one click.

## Convert & Export (8)

- **PDF to Word** — Export extracted text to an editable .docx file.
- **Word to PDF** — Convert .docx to PDF with headings preserved.
- **PDF to Excel / CSV** — Pull text tables out into .csv and .xlsx.
- **PDF to PowerPoint** — Turn each page into an editable .pptx slide.
- **PowerPoint to PDF** — Convert .pptx slides to PDF with text and images.
- **Excel / CSV to PDF** — Render spreadsheets as clean PDF tables.
- **PDF to HTML** — Publish PDF text as a styled standalone webpage.
- **Recolor PDF** — Dark mode, invert, grayscale, or sepia — print-friendly.

## Create from Scratch (3)

- **Create PDF** — Write title + body and export a clean PDF.
- **Markdown to PDF** — Paste Markdown, get a formatted PDF instantly.
- **HTML to PDF** — Paste HTML or upload .html and export PDF.

## View & Utilities (4)

- **Compare PDFs** — View two PDFs side-by-side with synced scrolling.
- **Repair PDF** — Recover readable pages from a damaged PDF.
- **Large File Split & Join** — Split giant files into email-size chunks (5–2000 MB),
  shrink huge PDFs page-by-page (~1 GB ceiling, rasterized output), rejoin
  byte-identical, or inspect a giant file's header/trailer without loading it.
  Streams to 6 GB with constant memory.
- **Scan to PDF** — Use your camera as a scanner and save as PDF.

## File-size limits (desktop reference)

| Tool class | Per-file ceiling | How it works past the fast path |
|---|---|---|
| Page shuffling (merge, split, organize, rotate…) | ~250–500 MB | Refused with guidance to Large Files |
| Raster-heavy (OCR, PDF→JPG, recolor, PPT) | ~200 MB | Refused with guidance |
| Compress (lossy/target) | ~500 MB–1 GB | Auto-switches to streaming mode (rasterized batches) |
| Compress (lossless) | ~200 MB fast cap | Refused — structural re-save cannot stream |
| Large File Split / Join / Inspect | 6 GB | Streams natively (zero-copy slices) |
| Large File Shrink | ~1 GB | Streams natively (one page in RAM) |

Mobile caps are lower (tabs die around 1–2 GB); the UI states the live cap on
every dropzone. See [ARCHITECTURE.md](ARCHITECTURE.md) for why these ceilings exist.
