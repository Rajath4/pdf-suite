// Post-build SEO gate: fails the build if a crawler-facing invariant regresses.
// Covers titles, descriptions, canonicals, robots, social cards, structured
// data, heading structure, internal links, sitemap/feed/llms consistency and
// the 404 page. Run standalone with `npm run seo:audit`.
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DIST = join(ROOT, 'dist');
const SITE = (process.env.SITE_URL || 'https://pdfhaven.app').replace(/\/+$/, '');
const SITE_HOST = new URL(SITE).host;

const errors = [];
const fail = (file, msg) => errors.push(`${file}: ${msg}`);
const one = (file, html, re, label) => {
  const matches = [...html.matchAll(re)];
  if (matches.length !== 1) {
    fail(file, `expected exactly 1 ${label}, found ${matches.length}`);
    return null;
  }
  return matches[0];
};
const meta = (file, html, attr, key) =>
  one(
    file,
    html,
    new RegExp(`<meta\\s+${attr}="${key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}"\\s+content="([^"]*)"[^>]*>`, 'gi'),
    `meta ${attr}=${key}`,
  )?.[1] ?? null;

function walk(dir, out = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, entry.name);
    if (entry.isDirectory()) walk(p, out);
    else out.push(p);
  }
  return out;
}

if (!existsSync(DIST)) {
  console.error('dist/ missing — run npm run build first');
  process.exit(1);
}

const files = walk(DIST);
const htmlFiles = files.filter((f) => f.endsWith('.html'));
const pages = new Map();
for (const file of htmlFiles) {
  const rel = relative(DIST, file).split('\\').join('/');
  if (rel === '404.html') continue;
  const url =
    rel === 'index.html' ? `${SITE}/` : rel.endsWith('/index.html') ? `${SITE}/${rel.slice(0, -'index.html'.length)}` : null;
  if (url) pages.set(url, file);
  else fail(rel, 'unexpected HTML file (not an indexable route)');
}

const pageUrls = [...pages.keys()];

/* ---------- sitemap ---------- */
const sitemapPath = join(DIST, 'sitemap.xml');
if (!existsSync(sitemapPath)) fail('sitemap.xml', 'missing');
const sitemap = existsSync(sitemapPath) ? readFileSync(sitemapPath, 'utf8') : '';
const sitemapLocs = [...sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
const lastmods = [...sitemap.matchAll(/<lastmod>([^<]+)<\/lastmod>/g)].map((m) => m[1]);
if (new Set(sitemapLocs).size !== sitemapLocs.length) fail('sitemap.xml', 'duplicate <loc> entries');
for (const loc of sitemapLocs) {
  if (!loc.startsWith(`${SITE}/`)) fail('sitemap.xml', `non-absolute or off-site loc: ${loc}`);
  if (!pages.has(loc)) fail('sitemap.xml', `loc has no prerendered page: ${loc}`);
}
for (const url of pageUrls) {
  if (!sitemapLocs.includes(url)) fail('sitemap.xml', `missing indexable page: ${url}`);
}
for (const d of lastmods) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) fail('sitemap.xml', `invalid lastmod: ${d}`);
}
if (/<changefreq>|<priority>0\.0<\/priority>/.test(sitemap)) {
  // priority is allowed; changefreq is deprecated and intentionally absent.
}

/* ---------- robots ---------- */
const robotsPath = join(DIST, 'robots.txt');
if (!existsSync(robotsPath)) fail('robots.txt', 'missing');
else {
  const robots = readFileSync(robotsPath, 'utf8');
  if (!robots.includes(`Sitemap: ${SITE}/sitemap.xml`)) fail('robots.txt', 'sitemap must be absolute');
  if (!robots.includes(`Host: ${SITE_HOST}`)) fail('robots.txt', 'missing Yandex Host directive');
  if (!/User-agent: \*\nAllow: \//.test(robots)) fail('robots.txt', 'must allow all crawlers');
  if (/Disallow:\s*\/\s*$/m.test(robots)) fail('robots.txt', 'must not disallow the whole site');
}

/* ---------- per-page invariants ---------- */
const isTool = (url) =>
  !/\/tools\/$/.test(url) && !/\/tools\/[^/]+\/$/.test(url) && !/\/guides\//.test(url) && !/\/(about|privacy)\/$/.test(url) && url !== `${SITE}/`;
const isCategory = (url) => /\/tools\/[^/]+\/$/.test(url);
const isGuide = (url) => /\/guides\/[^/]+\/$/.test(url);
const isGuideIndex = (url) => url === `${SITE}/guides/`;
const isToolsIndex = (url) => url === `${SITE}/tools/`;

for (const [url, file] of pages) {
  const rel = relative(DIST, file);
  const html = readFileSync(file, 'utf8');

  if (!/<html lang="en">/.test(html)) fail(rel, 'missing html lang="en"');
  const title = one(rel, html, /<title>([^<]+)<\/title>/gi, 'title')?.[1] ?? '';
  if (title.length < 20 || title.length > 70) fail(rel, `title length ${title.length} (expected 20-70)`);
  const desc = meta(rel, html, 'name', 'description');
  if (!desc || desc.length < 80 || desc.length > 185) fail(rel, `description length ${desc?.length ?? 0} (expected 80-185)`);

  const canonical = one(rel, html, /<link\s+rel="canonical"\s+href="([^"]+)"/gi, 'canonical')?.[1];
  if (canonical !== url) fail(rel, `canonical ${canonical} != ${url}`);

  const robots = meta(rel, html, 'name', 'robots');
  if (robots && !robots.includes('index')) fail(rel, 'indexable page must not be noindex');

  for (const [attr, key] of [
    ['property', 'og:title'],
    ['property', 'og:description'],
    ['property', 'og:url'],
    ['property', 'og:image'],
    ['property', 'og:image:width'],
    ['property', 'og:image:height'],
    ['property', 'og:image:alt'],
    ['name', 'twitter:card'],
    ['name', 'twitter:title'],
    ['name', 'twitter:description'],
    ['name', 'twitter:image'],
  ]) {
    const value = meta(rel, html, attr, key);
    if (!value) fail(rel, `missing ${attr}=${key}`);
  }
  if (meta(rel, html, 'property', 'og:url') !== url) fail(rel, 'og:url must match canonical');
  if (!String(meta(rel, html, 'property', 'og:image')).startsWith(`${SITE}/`)) fail(rel, 'og:image must be absolute');
  if (meta(rel, html, 'name', 'twitter:card') !== 'summary_large_image') fail(rel, 'twitter card should be summary_large_image');
  const hreflangs = [...html.matchAll(/<link\s+rel="alternate"\s+hreflang="([^"]+)"/g)].map((m) => m[1]);
  if (!hreflangs.includes('en') || !hreflangs.includes('x-default')) fail(rel, 'missing en/x-default hreflang');
  if (!/application\/rss\+xml/.test(html)) fail(rel, 'missing RSS alternate link');

  const h1s = [...html.matchAll(/<h1[\s>]/g)].length;
  if (h1s !== 1) fail(rel, `expected exactly 1 <h1>, found ${h1s}`);
  if (/REPLACE_WITH|Lorem ipsum/i.test(html)) fail(rel, 'placeholder copy found');

  const jsonLdBlocks = [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)];
  if (jsonLdBlocks.length !== 1) fail(rel, `expected 1 JSON-LD block, found ${jsonLdBlocks.length}`);
  let types = [];
  if (jsonLdBlocks.length === 1) {
    try {
      const data = JSON.parse(jsonLdBlocks[0][1]);
      const graph = data['@graph'] ?? [data];
      types = graph.map((o) => o['@type']);
      for (const required of ['Organization', 'WebSite']) {
        if (!types.includes(required)) fail(rel, `JSON-LD missing ${required}`);
      }
      const pageType = isTool(url)
        ? 'SoftwareApplication'
        : isGuide(url)
          ? 'Article'
          : isCategory(url) || isToolsIndex(url) || isGuideIndex(url)
            ? 'CollectionPage'
            : url === `${SITE}/`
              ? 'WebPage'
              : null;
      if (pageType && !types.includes(pageType)) fail(rel, `JSON-LD missing ${pageType}`);
      if ((isTool(url) || isCategory(url) || isToolsIndex(url) || isGuideIndex(url)) && !types.includes('BreadcrumbList')) {
        fail(rel, 'JSON-LD missing BreadcrumbList');
      }
      if (isTool(url)) {
        const app = graph.find((o) => o['@type'] === 'SoftwareApplication');
        if (!app?.offers || String(app.offers.price) !== '0') fail(rel, 'SoftwareApplication needs a free offer');
        if (app?.url !== url) fail(rel, 'SoftwareApplication url must be canonical');
      }
      if (isGuide(url)) {
        const article = graph.find((o) => o['@type'] === 'Article');
        if (!article?.author || !article?.publisher || !article?.dateModified) fail(rel, 'Article missing author/publisher/date');
      }
      if (!types.includes('FAQPage') && !/\/(about|privacy)\/$/.test(url)) fail(rel, 'JSON-LD missing FAQPage');
    } catch (error) {
      fail(rel, `invalid JSON-LD: ${error.message}`);
    }
  }

  const words = html
    .replace(/<script[\s\S]*?<\/script>/g, ' ')
    .replace(/<style[\s\S]*?<\/style>/g, ' ')
    .replace(/<[^>]+>/g, ' ')
    .split(/\s+/)
    .filter(Boolean).length;
  if (words < 120) fail(rel, `thin page: ${words} words`);

  for (const m of html.matchAll(/<a\b[^>]*href="(\/[^"#?]*)/g)) {
    const target = m[1];
    if (
      target === '/' ||
      pages.has(`${SITE}${target}`) ||
      target === '/404.html' ||
      target === '/sitemap.xml' ||
      target === '/robots.txt' ||
      target === '/feed.xml' ||
      target === '/llms.txt' ||
      target === '/manifest.webmanifest' ||
      target === '/version.json' ||
      target.startsWith('/assets/') ||
      target.startsWith('/icons/') ||
      target === '/og.jpg'
    ) {
      continue;
    }
    fail(rel, `dead internal link: ${target}`);
  }
}

/* ---------- feed, llms, 404, assets ---------- */
const guidesJson = JSON.parse(readFileSync(join(ROOT, 'src', 'seo', 'guides.json'), 'utf8')).guides;
const feedPath = join(DIST, 'feed.xml');
if (!existsSync(feedPath)) fail('feed.xml', 'missing');
else {
  const feed = readFileSync(feedPath, 'utf8');
  const items = [...feed.matchAll(/<item>/g)].length;
  if (items !== guidesJson.length) fail('feed.xml', `expected ${guidesJson.length} items, found ${items}`);
  for (const g of guidesJson) {
    if (!feed.includes(`${SITE}/guides/${g.slug}/`)) fail('feed.xml', `missing guide ${g.slug}`);
  }
}

const llmsPath = join(DIST, 'llms.txt');
if (!existsSync(llmsPath)) fail('llms.txt', 'missing');
else {
  const llms = readFileSync(llmsPath, 'utf8');
  for (const url of pageUrls) {
    if (!llms.includes(url)) fail('llms.txt', `missing page ${url}`);
  }
}

const notFoundPath = join(DIST, '404.html');
if (!existsSync(notFoundPath)) fail('404.html', 'missing');
else {
  const html = readFileSync(notFoundPath, 'utf8');
  if (!/noindex/.test(html)) fail('404.html', 'must be noindex');
  if (!/<h1[\s>]/.test(html)) fail('404.html', 'missing h1');
  if (sitemapLocs.includes(`${SITE}/404.html`)) fail('404.html', 'must not be in the sitemap');
}

if (!existsSync(join(DIST, 'og.jpg'))) fail('og.jpg', 'missing social image');
if (!existsSync(join(DIST, 'sitemap.xml'))) fail('sitemap.xml', 'missing');
if (!existsSync(join(DIST, 'version.json'))) fail('version.json', 'missing');

/* ---------- report ---------- */
if (errors.length > 0) {
  console.error(`\nSEO AUDIT FAILED — ${errors.length} issue(s):\n`);
  for (const error of errors.slice(0, 60)) console.error(`  - ${error}`);
  if (errors.length > 60) console.error(`  … and ${errors.length - 60} more`);
  process.exit(1);
}
console.log(`SEO audit OK — ${pages.size} indexable pages, ${sitemapLocs.length} sitemap URLs, ${guidesJson.length} feed items.`);
