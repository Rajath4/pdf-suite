# Contributing to PDF Suite

Thanks for helping — the most valuable contribution is a **well-written bug report**. Code welcome too.

## 5-line setup

```bash
git clone https://github.com/Rajath4/pdf-suite.git
cd pdf-suite
npm install
npm run dev      # http://localhost:5173
npm test         # must stay green
```

## Ground rules

- **Privacy is the product.** No network calls at runtime (except the pinned Tesseract CDN on first OCR use), no telemetry, no fingerprints. A PR that phones home will be rejected.
- **Keep it lean.** New dependencies need justification — every KB hits the `npm run build` budget gate (entry ≤150 KB, JS ≤3.9 MB). Prefer small, tree-shakeable, offline-capable libs.
- **Separation of concerns:** UI never touches engines directly. Pure ops go in `src/lib/`, orchestration in `src/tools/actions.ts`, DOM in `src/main.ts` / `src/ui/`.
- **Tests with behavior.** Pure logic gets vitest coverage (`*.test.ts` next to the module). UI-only changes get verified in a real browser before merge.
- **Honest limits.** If your change touches file-size ceilings, say so in the tool note and docs — never promise what a browser tab cannot do (see `src/lib/fileUtils.ts`).

## Good first contributions

- Bug reports with **synthetic test files only** — never attach real personal documents.
- Small UI papercuts with before/after screenshots.
- Guide typo/clarity fixes in `src/seo/guides.json` (mind the SEO test gates).
- Look for the [`good first issue`](https://github.com/Rajath4/pdf-suite/issues?q=is%3Aissue+is%3Aopen+label%3A%22good+first+issue%22) label.

## Security issues

**Do not open a public issue.** Use [private vulnerability reporting](https://github.com/Rajath4/pdf-suite/security/advisories/new) so a fix can ship before disclosure. See [SECURITY.md](SECURITY.md).
