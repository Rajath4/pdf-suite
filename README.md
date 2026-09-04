# PDF Suite — Free Offline PDF Toolkit

A full end-to-end working clone of the **ihatepdf.cv essentials**: merge, split, compress,
convert, organize, redact, protect and more — 100% client-side. No upload, no watermark,
no sign-up. Files never leave the device.

## Features (29 tools, all functional offline after first load)

**Essentials:** Merge PDFs · Split PDF · Compress PDF · PDF → JPG/PNG/ZIP · Images → PDF
**Edit & Organize:** Organize pages (reorder/rotate/delete) · Rotate · Watermark · Page numbers ·
Headers/Footers · Redact · Extract text · OCR (on-device Tesseract)
**Security & Privacy:** Protect (AES password) · Unlock · Flatten · Privacy scanner (inspect/strip metadata)
**Convert & Export:** PDF → Word · Word → PDF · PDF → Excel/CSV · Excel/CSV → PDF · PDF → HTML · Invert (dark mode)
**Create:** Create PDF · Markdown → PDF · HTML → PDF
**Utilities:** Compare PDFs side-by-side · Repair PDF · Scan to PDF (camera)

## Quick start

```bash
cd "pdf suite"
npm install
npm run dev      # http://localhost:5173
npm run build    # outputs static dist/
npm run preview  # serve dist/ at http://localhost:4173
```

No backend. Host `dist/` on any static host (GitHub Pages, Netlify, nginx).

## Install as an app (PWA, offline-first)

The build ships a web manifest + Workbox service worker:

- **Offline:** after the first visit, the entire app shell (all tools, pdf.js worker)
  is cached — disconnect and everything keeps working. OCR language data fetched
  from a CDN on first use is cached too.
- **Install:** Chrome/Edge → address-bar install icon or the in-app **⤓ Install**
  button. iOS Safari → Share → “Add to Home Screen”. The app then runs
  standalone, like a native app.
- **Updates:** the service worker uses `autoUpdate` — a toast prompts to refresh
  when a new version is deployed.

> Dev note: the service worker only runs on `npm run preview` / production
> builds, not on `npm run dev`. Icons live in `public/icons/`.

## Architecture (clean code, best practices)

```
src/
  main.ts            # hash router + homepage + generic tool page shell
  types.ts           # shared domain types + UserError
  styles.css         # design system (no framework, responsive + accessible)
  lib/
    fileUtils.ts     # downloads, readers, formatting (no PDF logic)
    pdfCore.ts       # pure pdf-lib ops: merge/split/rotate/watermark/… (bytes in → bytes out)
    pdfRender.ts     # pdf.js rendering: thumbnails, text extract, rasterize
    convert.ts       # office formats: docx/xlsx/csv/html helpers
  tools/
    registry.ts      # single source of truth for all 29 tools
    actions.ts       # per-tool orchestration (files + opts → Blobs)
  ui/
    components.ts    # tiny typed DOM helpers
```

Principles:
- **Separation of concerns:** UI never touches pdf-lib directly; `actions.ts` orchestrates, `pdfCore.ts` stays pure.
- **Privacy by design:** zero network calls at runtime; WASM/workers bundled locally.
- **Fail loudly with help:** `UserError` messages tell users exactly how to fix input (ranges, passwords, scanned PDFs).
- **Progressive enhancement:** every long job reports progress; results auto-download + inline preview.

## Privacy & limits

- Everything runs in the tab via `pdf-lib`, `pdf.js`, `Tesseract.js`, `JSZip`, `mammoth`, `docx`, `xlsx`.
- Practical limit is device RAM (~100–150 MB PDFs on desktop).
- Rasterizing tools (Heavy compress, Invert) trade text-selectability for size/color — noted in UI.
- Password tools use PDF AES encryption; decryption happens locally.

## Scripts

| Command | Purpose |
|---|---|
| `npm run dev` | local dev server |
| `npm run typecheck` | `tsc --noEmit` |
| `npm test` | vitest unit suite (20 tests: ranges, CSV, engine round-trips) |
| `npm run build` | typecheck + production build + bundle-budget gate |
| `npm run budget` | standalone perf-budget check (entry ≤150 KB, JS ≤3.5 MB) |
| `npm run preview` | serve built app |

## Performance & quality

- **Code-split engines:** the homepage shell is ~30 KB; pdf-lib/pdf.js/office
  chunks load lazily on first tool use (prefetched on card hover).
- `npm run build` fails on budget breach (`scripts/check-budget.mjs`).
- CI (`.github/workflows/ci.yml`) runs typecheck → tests → build on every push.
- `dist/version.json` stamps every build (footer shows `v1.1.0 (abc1234)`).

## Deploy

See [DEPLOY.md](DEPLOY.md) (Docker + nginx, Netlify, S3/CDN, go-live checklist)
and [SECURITY.md](SECURITY.md) (headers, data-handling, disclosure).

MIT — build something private.
