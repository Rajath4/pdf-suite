# Architecture

Technical reference for contributors and security reviewers. User-facing
feature list: [FEATURES.md](FEATURES.md). Live deployment:
[https://pdfhaven.app/](https://pdfhaven.app/).

## Stack

- **Runtime:** zero-backend static SPA (Vite + TypeScript, no UI framework),
  shipped as an installable PWA (Workbox service worker).
- **PDF engines (all in-tab):** `pdf-lib` (structure editing), `pdf.js`
  (rendering, text extraction), `qpdf-wasm` (real AES-256 encrypt/decrypt),
  `Tesseract.js` (OCR), `JSZip` (archives), `mammoth`/`docx`/`xlsx`/`pptxgenjs`
  (office formats).
- **No runtime network** except pinned Tesseract CDN assets on first OCR use
  (then cached) — enforced by strict CSP (see `netlify.toml`, `deploy/nginx.conf`).

## Module map

```
src/
  main.ts            # router (real URLs + legacy hash redirects) + homepage + tool shell
  types.ts           # shared domain types + UserError
  styles.css         # framework-free design system
  lib/
    fileUtils.ts     # downloads, formatting + adaptive caps (fileLimitBytes/fastPathCapBytes)
    pdfCore.ts       # pure pdf-lib ops (bytes in → bytes out)
    pdfRender.ts     # pdf.js rendering + openRangedDoc (constant-memory open)
    largeFiles.ts    # streaming engine: chunk/batch plans, dispatch verdicts
    qpdf.ts          # lazy qpdf-wasm loader (encrypt/decrypt)
    convert.ts       # office-format helpers
  tools/
    registry.ts      # single source of truth: 37 tools, slugs, chaining
    actions.ts       # per-tool orchestration (files + opts → Blobs)
  ui/components.ts   # typed DOM helpers
  seo/               # content.json (tool landing copy) + guides.json (16 guides)
scripts/prerender.mjs  # static SEO pages + sitemap/robots per build
```

Rules: UI never touches engines (via `actions.ts`); `pdfCore.ts` stays pure;
long jobs report determinate progress; failures are `UserError` with a fix,
never a stack trace.

## Adaptive engine (fast path + streaming)

Browser tabs cap around 4 GB heap with ~2 GB per `ArrayBuffer`, and `pdf-lib`
expands documents 2–5× — so one method cannot serve both a 200 KB form and a
2 GB scan bundle. Compress (and only Compress, so far) dispatches per file
(`chooseCompressPath` in `largeFiles.ts`):

- **fast** — classic in-memory pipeline for files under the fast cap.
- **stream** — ranged open (`openRangedDoc`: 512 KB upfront, `Blob.slice`
  ranges on demand), one bitmap in RAM at a time, one valid PDF per batch.
- **reject** — lossless over the fast cap (structural re-save cannot stream),
  or anything over the streaming ceiling, with guidance to Large Files.

Large File Split/Join/Inspect never load the file at all (zero-copy slices,
~576 KB head/tail reads) — hence the 6 GB ceiling.

## Caps model (`fileUtils.ts`)

`fileLimitBytes(toolId)` adapts to `navigator.deviceMemory` and operation
cost (rasterizing tools cap lower); `fastPathCapBytes(toolId)` is the
in-memory ceiling before streaming fallbacks. Compress raises to ~1 GB on
capable desktops, stays low on ≤2 GB-RAM phones. The UI prints the live cap
on every dropzone and rejects over-limit files with a pointer to Large Files.

## Passwords

`pdf-lib` cannot write encryption and silently accepts wrong passwords, so
both operations go through `qpdf.ts` (AES-256, strict auth). Verified by
round-trip tests asserting `/Encrypt` presence, wrong-password rejection,
and freely-openable output on success.

## Performance budgets (`scripts/check-budget.mjs`, enforced by build)

Entry ≤150 KB · total JS ≤3.9 MB · dist ≤6.0 MB. Heavy engines are
code-split and lazy (prefetched on card hover); the qpdf `.wasm` precaches
via Workbox for offline use.

## SEO

Every tool and guide prerenders to a real URL with unique title/meta/canonical
plus JSON-LD (SoftwareApplication, FAQPage, BreadcrumbList, HowTo); sitemap +
robots regenerate per build with `SITE_URL` baked in. `npm test` enforces
uniqueness, SERP lengths, and minimum substantive bodies (anti-thin-content gate).

## Quality gates

`npm run typecheck` → `npm test` (86 tests: engines, streaming, crypto
round-trips, search, SEO gates) → `npm run build`, on every push via CI.
Browser user-flows (upload → run → download, byte-verified) are scripted in
CI-external QA harnesses; pixel/render paths cannot run headless in unit tests
(Node has no canvas) and are covered there.
