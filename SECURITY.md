# Security Policy

## Architecture: secure by design

PDF Suite is a **static, frontend-only app**. There is no backend, no database,
no telemetry, and no file upload — every byte of every document is processed
in the visitor's own browser tab (pdf-lib, pdf.js, Tesseract.js) and never
leaves the device. The only runtime network requests are:

- Same-origin static assets (JS/CSS/worker/icons).
- Tesseract.js engine files from `https://cdn.jsdelivr.net` on first OCR use
  (cached by the service worker afterwards).

## What's enforced

- Strict Content-Security-Policy, `X-Content-Type-Options: nosniff`,
  `X-Frame-Options: SAMEORIGIN`, `Referrer-Policy: no-referrer`
  (see `deploy/nginx.conf` and `netlify.toml`).
- Password tools use PDF AES encryption locally; passwords live only in memory
  for the duration of the operation.
- Privacy Scanner tool inspects/strips document metadata on-device.
- No secrets, tokens, or API keys exist in this codebase — CI verifies
  `typecheck → tests → build` on every push (`.github/workflows/ci.yml`).

## Reporting a vulnerability

Email the maintainer with a description, affected version (`version.json`
`commit` field, shown in the app footer), and reproduction steps. Please allow
reasonable time for a fix before public disclosure. Do not submit real
personal documents in reports — use synthetic test files.
