# PDF Suite — Free Offline PDF Toolkit

A full end-to-end working clone of the **ihatepdf.cv essentials**, at parity
with the best of iLovePDF/Smallpdf — **36 tools, 100% client-side**. No upload,
no watermark, no sign-up, no per-hour limits. Files never leave the device.

## Features (36 tools, all functional offline after first load)

**Essentials:** Merge PDFs (per-file page ranges) · Split PDF (ranges, chunks, odd/even, by size) ·
Compress PDF (presets or exact target size) · PDF → JPG/PNG/ZIP · Extract Images · Images → PDF
**Edit & Organize:** Sign PDF (draw/type/upload) · Edit & Annotate (text, highlights, image stamps) ·
Organize pages (reorder/rotate/delete) · Rotate · Crop · Watermark (text or logo) · Page numbers ·
Headers/Footers · Fill PDF Forms · Redact · Extract Text / Markdown · OCR (14 languages, on-device)
**Security & Privacy:** Protect (AES password) · Unlock · Flatten · Privacy Scanner (inspect/edit/strip metadata)
**Convert & Export:** PDF → Word · Word → PDF · PDF → Excel/CSV · Excel/CSV → PDF ·
PDF → PowerPoint · PowerPoint → PDF · PDF → HTML · Recolor (dark/gray/sepia)
**Create:** Create PDF · Markdown → PDF · HTML → PDF
**Utilities:** Compare PDFs side-by-side · Repair PDF · Scan to PDF (camera)

**Enterprise differentiators (free, unlimited — gated behind paywalls elsewhere):**
batch Compress / Protect / Watermark / Page numbers / Headers / Rotate / Flatten
→ one ZIP; Docker + hardened nginx; strict CSP; CI; signed build stamps.

## Experience (usability-first, premium)
- **Command palette (`Ctrl/⌘ K`)** — scored search across all 36 tools plus actions
  (home, theme, install); recents-first empty state; full keyboard operation.
- **Dark mode** — follows the OS, one-click override in the header, persisted.
- **Persona entry points** — "What do you need to do?" jobs (sign a contract,
  hit a portal limit, assemble a report…) route to the right tool.
- **Discoverability** — category pills with counts, breadcrumbs, related tools,
  recently-used row, popular jobs.
- **Run feedback** — determinate progress + elapsed time, input→output stats,
  Share/Copy actions, offline/airplane-mode trust copy.

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
| `npm test` | vitest unit suite (37 tests: search scoring, ranges, CSV, engine round-trips, sign/annotate/crop/forms/slides, merge-select, split modes, metadata, markdown, image extraction, progress/recents helpers) |
| `npm run build` | typecheck + production build + bundle-budget gate |
| `npm run budget` | standalone perf-budget check (entry ≤150 KB, JS ≤3.8 MB) |
| `npm run preview` | serve built app |

## Performance & quality

- **Code-split engines:** the homepage shell is ~60 KB; pdf-lib/pdf.js/office
  chunks load lazily on first tool use (prefetched on card hover).
- `npm run build` fails on budget breach (`scripts/check-budget.mjs`).
- CI (`.github/workflows/ci.yml`) runs typecheck → tests → build on every push.
- `dist/version.json` stamps every build (footer shows `v1.1.0 (abc1234)`).

## SEO (built to rank)

- **Real URLs, not hash routes:** every tool lives at `/merge-pdf/` etc.
  (History API + click interception keeps SPA speed; legacy `#/tool/x` redirects).
- **Prerendered at build** (`scripts/prerender.mjs`): unique title/meta/canonical,
  H1 + how-to + FAQ content, and JSON-LD (SoftwareApplication, FAQPage,
  BreadcrumbList, HowTo) on all 37 pages — no JS required to index.
- **`sitemap.xml` + `robots.txt`** generated per build (override domain with
  `SITE_URL=https://yourdomain.com npm run build`).
- **Quality gates in `npm test`:** unique titles/descriptions, SERP lengths,
  minimum substantive bodies — the anti-thin-content guardrail.
- Internal linking: homepage hub → all tools, related + popular links per page,
  full sitemap footer. See [DEPLOY.md](DEPLOY.md) for the Search Console flow.

## Deploy

See [DEPLOY.md](DEPLOY.md) (Docker + nginx, Netlify, S3/CDN, go-live checklist)
and [SECURITY.md](SECURITY.md) (headers, data-handling, disclosure).

MIT — build something private.
