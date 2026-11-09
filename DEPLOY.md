# Deploying PDF Haven

Any static host works — the build output is `dist/` (no server code).
HTTPS is **required** in production (service workers and installability only
work on secure origins; `localhost` is exempt for testing).

## Domain + SEO setup (read this for Google traffic)

The build prerenders 71 indexable English pages to real URLs: home, 37 tool
landings (`/merge-pdf/`, `/sign-pdf/`, …), 23 guides (`/guides/…/`), 6 category
hubs (`/tools/essentials/`, …), the `/tools/` and `/guides/` directories, plus
`/about/` and `/privacy/`. Every page has a unique title/description, absolute
canonical, Open Graph/Twitter card, hreflang, and JSON-LD (Organization,
WebSite, WebPage/Article, SoftwareApplication, BreadcrumbList, FAQPage, HowTo).
`/404.html` is `noindex`.

1. **Set your domain for the build:**
   `SITE_URL=https://yourdomain.com VITE_SITE_URL=https://yourdomain.com npm run build`
   (both default to `https://pdfhaven.app`). `SITE_URL` bakes canonical/OG/
   sitemap/feed/robots/llms.txt; `VITE_SITE_URL` keeps canonical tags correct
   during client-side navigation. They must match.
2. **Serve at the domain root.** The build uses absolute paths; subpath hosting
   (e.g. `example.com/app/`) needs a `base` change in `vite.config.ts` + rebuild.
3. **Search engines:** verify and submit the sitemap in
   [Google Search Console](https://search.google.com/search-console) (`/sitemap.xml`),
   Bing Webmaster Tools, and Yandex Webmaster. Verification metas are injected
   when these env vars are set at build time:
   `GOOGLE_SITE_VERIFICATION`, `BING_SITE_VERIFICATION`, `YANDEX_VERIFICATION`,
   `BAIDU_VERIFICATION`. Use URL Inspection on `/`, `/merge-pdf/`, a category
   hub and a guide to confirm crawled HTML has H1/FAQ/canonical without JS.
4. **Instant indexing:** set `INDEXNOW_KEY` (any 8–128 char hex/string) at
   build time; the build writes `dist/<key>.txt`, and
   `npm run seo:indexnow` (or `SITE_URL=… INDEXNOW_KEY=… npm run seo:indexnow`)
   submits changed URLs to Bing/Yandex/Seznam/Naver via IndexNow.
5. **Keep URLs stable:** slugs live in `TOOL_SLUGS` (`src/tools/registry.ts`);
   renaming one without a redirect loses rankings — add server redirects.
6. **Analytics (optional):** set `CF_BEACON_TOKEN` at build time to enable the
   Cloudflare Web Analytics beacon; without it the script is stripped and the
   CSP stays closed.
7. **Quality gates:** `npm test` enforces unique titles/descriptions and
   minimum substantive bodies; `npm run seo:audit` fails the build on missing
   canonicals/JSON-LD, thin pages, dead internal links, or sitemap/feed drift.

## Option A — Docker (recommended for enterprise/VPS)

```bash
docker build -t pdf-haven .
docker run -p 8080:80 pdf-haven
# → http://localhost:8080
```

Ships hardened nginx: immutable caching for hashed `/assets/*`, no-cache for
`index.html` / `sw.js` / `manifest.webmanifest`, crawler-file caching, real
`404.html` responses (no soft-404), and the full security-header baseline. Uncomment the HSTS line in `deploy/nginx.conf` once
TLS terminates in front of it.

## Option B — Netlify / Cloudflare Pages / Vercel

- Build command: `npm ci && npm run build`
- Publish directory: `dist`
- `netlify.toml` is included (headers, crawler caching, real 404). For
  Cloudflare Pages / Vercel, replicate the headers and the 404 behaviour from
  `deploy/nginx.conf`: serve `404.html` with status 404 for unknown paths — do
  not rewrite everything to `/index.html` (soft-404s hurt indexing).

## Option C — S3 + CloudFront / any CDN

Upload `dist/` with:
`assets/*` → `Cache-Control: public, max-age=31536000, immutable`;
`sw.js` → `no-store`; everything else → `no-cache`. Configure the
distribution's 404 response to serve `404.html` with status 404 (never
`index.html`, which creates soft-404s).

## Go-live checklist

1. `npm run build` passes (typecheck + prerender + SEO audit + bundle budgets).
2. Load the site, open DevTools → Application: service worker active,
   manifest has no errors, icons resolve.
3. Lighthouse PWA + Performance + Accessibility + Best Practices ≥ 90.
4. Toggle offline in DevTools → reload → app and a smoke tool (Merge) work.
5. “Install app” flow works on Chrome/Edge; “Add to Home Screen” on iOS.
6. Response headers include the CSP / nosniff / frame-options baseline.
7. Footer shows the expected `version.json` build stamp.
