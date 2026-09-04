# PDF Suite — Open-Source Enterprise PDF Platform

[![CI](https://github.com/Rajath4/pdf-suite/actions/workflows/ci.yml/badge.svg)](https://github.com/Rajath4/pdf-suite/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://github.com/Rajath4/pdf-suite/blob/main/LICENSE)

**37 tools + 16 guides, 100% client-side.** Merge, split, compress, sign, convert,
OCR, redact and secure PDFs — with no upload, no watermark, no sign-up, and no
per-task limits. Files never leave the device.

Built for teams that can't send documents to third-party servers: every
operation runs in the browser tab, the code is fully auditable, and the static
build drops onto any infrastructure — your cloud, your datacenter, an air-gapped
intranet.

- **Source:** [github.com/Rajath4/pdf-suite](https://github.com/Rajath4/pdf-suite)
- **Bugs & feature requests:** [issues](https://github.com/Rajath4/pdf-suite/issues) (see [CONTRIBUTING.md](CONTRIBUTING.md))
- **Security reports:** [private vulnerability reporting](https://github.com/Rajath4/pdf-suite/security/advisories/new) only — never a public issue (see [SECURITY.md](SECURITY.md))

## Why enterprises self-host it

- **Data residency by construction.** There is no backend to subpoena, breach, or
  misconfigure — documents physically cannot leave the employee's machine.
- **Auditable in an afternoon.** Zero runtime network calls (except pinned OCR
  language packs on first use), no telemetry, no cookies, no accounts. Hand it
  to your security team with [SECURITY.md](SECURITY.md).
- **Compliance-friendly workflows.** AES-256 protect/unlock, redaction, metadata
  stripping, and flattening all run locally; nothing is retained after the tab closes.
- **Deploy anywhere static files serve.** Docker + hardened nginx included;
  Netlify, S3/CDN, GitHub Pages, or on-prem — HTTPS is the only requirement.
- **Deterministic quality gates.** Every push runs typecheck → 86 tests →
  production build → bundle-budget gate. Every build stamps `dist/version.json`
  (surfaced in the app footer) so support always knows the exact commit.

## Features (37 tools, all functional offline after first load)

**Essentials:** Merge PDFs, photos & documents (per-file page ranges) · Split PDF (ranges, chunks, odd/even, by size) ·
Compress PDF (presets, exact target size, or automatic large-file streaming mode) · PDF → JPG/PNG/ZIP · Extract Images · Images → PDF
**Edit & Organize:** Sign PDF (draw/type/upload) · Edit & Annotate (text, highlights, image stamps) ·
Organize pages (reorder/rotate/delete) · Rotate · Crop · Watermark (text or logo) · Page numbers ·
Headers/Footers · Fill PDF Forms · Redact · Extract Text / Markdown · OCR (14 languages, on-device)
**Security & Privacy:** Protect (real AES-256 password) · Unlock (strict password verification) · Flatten · Privacy Scanner (inspect/edit/strip metadata)
**Convert & Export:** PDF → Word · Word → PDF · PDF → Excel/CSV · Excel/CSV → PDF ·
PDF → PowerPoint · PowerPoint → PDF · PDF → HTML · Recolor (dark/gray/sepia)
**Create:** Create PDF · Markdown → PDF · HTML → PDF
**Utilities:** Compare PDFs side-by-side · Repair PDF · Scan to PDF (camera) ·
Large File Split & Join (transport chunks to 6 GB, streaming shrink to ~1 GB, no-load inspect)

**Enterprise differentiators (free, unlimited — gated behind paywalls elsewhere):**
batch Compress / Protect / Watermark / Page numbers / Headers / Rotate / Flatten
→ one ZIP; adaptive large-file engine (fast path + streaming fallback chosen per file);
Docker + hardened nginx; strict CSP; CI; signed build stamps.

## Experience (usability-first, premium)

- **Command palette (`Ctrl/⌘ K`)** — scored search across all 37 tools plus actions
  (home, theme, install); recents-first empty state; full keyboard operation.
- **Dark mode** — follows the OS, one-click override in the header, persisted.
- **Persona entry points** — "What do you need to do?" jobs (sign a contract,
  hit a portal limit, assemble a report…) route to the right tool.
- **Discoverability** — category pills with counts, breadcrumbs, related tools,
  recently-used row, popular jobs.
- **Run feedback** — determinate progress + elapsed time, input→output stats,
  Share/Copy actions, offline/airplane-mode trust copy.
- **File-first flows** — drop a file on the homepage, pick the tool after;
  outputs chain into the next tool ("Continue in Compress") with the file
  carried along, offline. Limits stated upfront and adapt to the device
  and tool (up to 1 GB for Compress, 6 GB for Large File Split & Join on
  desktops; raster-heavy tools stay lower).
- **Open-source trust signals** — footer links to source, bug tracker, and
  security policy on every page; no third-party scripts, ever.

## Quick start

```bash
git clone https://github.com/Rajath4/pdf-suite.git
cd pdf-suite
npm install
npm run dev      # http://localhost:5173
npm run build    # outputs static dist/
npm run preview  # serve dist/ at http://localhost:4173
```

No backend. Host `dist/` on any static host (GitHub Pages, Netlify, nginx).
See [CONTRIBUTING.md](CONTRIBUTING.md) for the development ground rules.

## Install as an app (PWA, offline-first)

The build ships a web manifest + Workbox service worker:

- **Offline:** after the first visit, the entire app shell (all tools, pdf.js worker,
  qpdf engine) is cached — disconnect and everything keeps working. OCR language
  data fetched from a CDN on first use is cached too.
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
  main.ts            # router + homepage + generic tool page shell
  types.ts           # shared domain types + UserError
  styles.css         # design system (no framework, responsive + accessible)
  lib/
    fileUtils.ts     # downloads, readers, formatting + adaptive size caps (no PDF logic)
    pdfCore.ts       # pure pdf-lib ops: merge/split/rotate/watermark/… (bytes in → bytes out)
    pdfRender.ts     # pdf.js rendering + ranged (constant-memory) opening
    largeFiles.ts    # streaming engine: chunk plans, batching, dispatch verdicts
    qpdf.ts          # AES-256 encrypt/decrypt via lazy-loaded qpdf-wasm
    convert.ts       # office formats: docx/xlsx/csv/html helpers
  tools/
    registry.ts      # single source of truth for all 37 tools
    actions.ts       # per-tool orchestration (files + opts → Blobs)
  ui/
    components.ts    # tiny typed DOM helpers
  seo/
    content.json     # per-tool landing copy (gated by tests)
    guides.json      # long-tail guides library (gated by tests)
```

Principles:

- **Separation of concerns:** UI never touches engines directly; `actions.ts` orchestrates, `pdfCore.ts` stays pure.
- **Privacy by design:** zero network calls at runtime; WASM/workers bundled locally.
- **Adaptive methods:** small files take the fast in-memory path; large files stream (ranged reads, one page in RAM) — the app picks per file and says so.
- **Fail loudly with help:** `UserError` messages tell users exactly how to fix input (ranges, passwords, scanned PDFs).
- **Progressive enhancement:** every long job reports progress; results auto-download + inline preview.

## Privacy & limits

- Everything runs in the tab via `pdf-lib`, `pdf.js`, `qpdf-wasm`, `Tesseract.js`, `JSZip`, `mammoth`, `docx`, `xlsx`, `pptxgenjs`.
- Practical limit adapts to device RAM and operation (up to 1 GB for Compress, 6 GB for Large File Split & Join on desktops).
- Rasterizing tools (Heavy compress, Shrink, Recolor) trade text-selectability for size/color — noted in UI.
- Protect uses real PDF AES-256 encryption; Unlock verifies passwords strictly. All local.

## Scripts

| Command | Purpose |
|---|---|
| `npm run dev` | local dev server |
| `npm run typecheck` | `tsc --noEmit` |
| `npm test` | vitest suite (86 tests: engines, streaming, crypto round-trips, search, SEO gates, ranges, converts) |
| `npm run build` | typecheck + production build + prerender + bundle-budget gate |
| `npm run budget` | standalone perf-budget check (entry ≤150 KB, JS ≤3.9 MB, dist ≤6.0 MB) |
| `npm run preview` | serve built app |

## Performance & quality

- **Code-split engines:** the homepage shell is ~60 KB; pdf-lib/pdf.js/office/qpdf
  chunks load lazily on first tool use (prefetched on card hover).
- `npm run build` fails on budget breach (`scripts/check-budget.mjs`).
- CI (`.github/workflows/ci.yml`) runs typecheck → tests → build on every push.
- `dist/version.json` stamps every build (footer shows `v1.1.0 (abc1234)`).

## SEO (built to rank)

- **Real URLs, not hash routes:** every tool lives at `/merge-pdf/` etc.,
  plus a `/guides/` hub with long-tail tutorials (History API + click
  interception keeps SPA speed; legacy `#/tool/x` redirects).
- **Prerendered at build** (`scripts/prerender.mjs`): unique title/meta/canonical,
  H1 + how-to + FAQ content, and JSON-LD (SoftwareApplication, FAQPage,
  BreadcrumbList, HowTo) on all 55 pages — no JS required to index.
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
