# Deploying PDF Suite

Any static host works — the build output is `dist/` (no server code).
HTTPS is **required** in production (service workers and installability only
work on secure origins; `localhost` is exempt for testing).

## Option A — Docker (recommended for enterprise/VPS)

```bash
docker build -t pdf-suite .
docker run -p 8080:80 pdf-suite
# → http://localhost:8080
```

Ships hardened nginx: immutable caching for hashed `/assets/*`, no-cache for
`index.html` / `sw.js` / `manifest.webmanifest`, SPA fallback, and the full
security-header baseline. Uncomment the HSTS line in `deploy/nginx.conf` once
TLS terminates in front of it.

## Option B — Netlify / Cloudflare Pages / Vercel

- Build command: `npm ci && npm run build`
- Publish directory: `dist`
- `netlify.toml` is included (headers + SPA redirect). For Cloudflare Pages /
  Vercel, replicate the headers from `deploy/nginx.conf`.

## Option C — S3 + CloudFront / any CDN

Upload `dist/` with:
`assets/*` → `Cache-Control: public, max-age=31536000, immutable`;
`sw.js` → `no-store`; everything else → `no-cache`. Configure the
distribution's error page / function to serve `index.html` for 404s.

## Go-live checklist

1. `npm run build` passes (typecheck + tests + bundle budgets enforced).
2. Load the site, open DevTools → Application: service worker active,
   manifest has no errors, icons resolve.
3. Lighthouse PWA + Performance + Accessibility + Best Practices ≥ 90.
4. Toggle offline in DevTools → reload → app and a smoke tool (Merge) work.
5. “Install app” flow works on Chrome/Edge; “Add to Home Screen” on iOS.
6. Response headers include the CSP / nosniff / frame-options baseline.
7. Footer shows the expected `version.json` build stamp.
