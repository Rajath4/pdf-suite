# PDF Haven — Open-Source Enterprise PDF Platform

[![CI](https://github.com/Rajath4/pdf-suite/actions/workflows/ci.yml/badge.svg)](https://github.com/Rajath4/pdf-suite/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://github.com/Rajath4/pdf-suite/blob/main/LICENSE)

**Live demo: [https://pdfhaven.app/](https://pdfhaven.app/)**

37 PDF tools + 16 guides running **100% client-side** — merge, split, compress,
sign, convert, OCR, redact and AES-256-protect documents with no upload, no
watermark, no sign-up, and no per-task limits. Files never leave the device.

Built for teams that can't send documents to third-party servers: every
operation runs in the browser tab, the code is fully auditable, and the static
build drops onto any infrastructure — your cloud, your datacenter, an air-gapped
intranet.

- **Source:** [github.com/Rajath4/pdf-suite](https://github.com/Rajath4/pdf-suite)
- **Bugs & features:** [issues](https://github.com/Rajath4/pdf-suite/issues) (see [CONTRIBUTING.md](CONTRIBUTING.md))
- **Security reports:** [private vulnerability reporting](https://github.com/Rajath4/pdf-suite/security/advisories/new) only — never a public issue (see [SECURITY.md](SECURITY.md))

## Documentation

| Doc | What's inside |
|---|---|
| [docs/FEATURES.md](docs/FEATURES.md) | Complete catalog of all 37 tools, file-size limits, and batch support |
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | Technical deep dive: adaptive engine, streaming, caps model, budgets, SEO |
| [DEPLOY.md](DEPLOY.md) | Docker + nginx, Netlify, S3/CDN, Cloudflare Pages, go-live checklist |
| [SECURITY.md](SECURITY.md) | Threat model, headers, data-handling, disclosure process |
| [CONTRIBUTING.md](CONTRIBUTING.md) | Setup, ground rules, good first issues |

## Why enterprises self-host it

- **Data residency by construction.** No backend to subpoena, breach, or
  misconfigure — documents physically cannot leave the employee's machine.
- **Auditable in an afternoon.** Zero runtime network calls (except pinned OCR
  language packs on first use), no telemetry, no cookies, no accounts.
- **Compliance-friendly.** Real AES-256 protect/unlock with strict password
  verification, permanent redaction, metadata stripping, form flattening —
  all local, nothing retained after the tab closes.
- **Deploy anywhere static files serve.** Docker + hardened nginx included;
  Cloudflare Pages, Netlify, S3/CDN, GitHub Pages, or on-prem. HTTPS is the
  only requirement.
- **Deterministic quality gates.** Every push runs typecheck → 86 tests →
  production build → bundle-budget gate. Every build stamps
  `dist/version.json` (surfaced in the app footer) so support always knows
  the exact commit.

## Features (37 tools, offline after first load)

**Essentials:** Merge · Split · Compress (presets, exact target, auto large-file streaming) ·
PDF → JPG/PNG · Extract Images · Images → PDF
**Edit & Organize:** Sign · Annotate · Organize · Rotate · Crop · Watermark ·
Page numbers · Headers/Footers · Fill forms · Redact · Extract text/Markdown · OCR (14 languages)
**Security & Privacy:** Protect (AES-256) · Unlock · Flatten · Privacy Scanner
**Convert & Export:** PDF ↔ Word · PDF ↔ Excel/CSV · PDF ↔ PowerPoint · PDF → HTML · Recolor
**Create:** Blank PDF · Markdown → PDF · HTML → PDF
**Utilities:** Compare · Repair · Scan to PDF · Large File Split & Join (6 GB chunks, ~1 GB streaming shrink)

Full catalog with per-tool limits: [docs/FEATURES.md](docs/FEATURES.md).
Batch mode (one ZIP for many files): Compress, Protect, Watermark, Page numbers,
Headers, Rotate, Flatten.

## Quick start

```bash
git clone https://github.com/Rajath4/pdf-suite.git
cd pdf-suite
npm install
npm run dev      # http://localhost:5173
npm run build    # typecheck + prerender + budget gate → dist/
npm run preview  # serve dist/ at http://localhost:4173
```

| Command | Purpose |
|---|---|
| `npm run dev` | local dev server |
| `npm run typecheck` | `tsc --noEmit` |
| `npm test` | vitest suite (86 tests) |
| `npm run build` | typecheck + build + prerender + budget gate |
| `npm run budget` | standalone perf check (entry ≤150 KB, JS ≤3.9 MB, dist ≤6.0 MB) |
| `npm run preview` | serve built app |

## Privacy & limits

- Everything runs in-tab via `pdf-lib`, `pdf.js`, `qpdf-wasm`, `Tesseract.js`
  (+ `JSZip`, `mammoth`, `docx`, `xlsx`, `pptxgenjs` for office formats).
- Limits adapt to device RAM and tool: up to **1 GB for Compress**,
  **6 GB for Large File Split & Join** on desktops; raster-heavy tools stay lower.
  Small files take the fast in-memory path; large files stream page-by-page —
  the app picks per file and says so.
- Rasterizing outputs (Heavy compress, Shrink, Recolor) trade text-selectability
  for size/color — always noted in UI.

## Install as an app (PWA, offline-first)

After the first visit the app shell (all tools, pdf.js worker, qpdf engine) is
cached — disconnect and everything keeps working. Chrome/Edge: address-bar
install icon or in-app **⤓ Install**. iOS Safari: Share → Add to Home Screen.

MIT — build something private.
