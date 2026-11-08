import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { TOOLS, TOOL_SLUGS } from '../src/tools/registry';

const pkg = JSON.parse(
  readFileSync(new URL('../package.json', import.meta.url), 'utf8'),
) as { version: string };
const guideCount = (JSON.parse(
  readFileSync(new URL('../src/seo/guides.json', import.meta.url), 'utf8'),
) as { guides: unknown[] }).guides.length;
const seoContent = JSON.parse(
  readFileSync(new URL('../src/seo/content.json', import.meta.url), 'utf8'),
) as {
  categories: unknown[];
  pages: unknown[];
  tools: { slug: string }[];
};

test.describe('Production build / SEO', () => {
  test('every tool has a prerendered, crawlable landing page', async ({ request }) => {
    test.setTimeout(180_000);
    expect(TOOLS).toHaveLength(37);
    for (const tool of TOOLS) {
      const slug = TOOL_SLUGS[tool.id]!;
      const res = await request.get(`/${slug}/`);
      expect(res.ok(), `${slug} should return 200`).toBe(true);
      const html = await res.text();
      expect(html).toContain('<h1');
      expect(html).toContain(`<link rel="canonical" href="https://pdfhaven.app/${slug}/"`);
      expect(html).toMatch(/<meta name="description" content="[^"]{40,}"/);
      expect(html).toContain('application/ld+json');
      expect(html).not.toContain('<div id="app"></div>');
    }
  });

  test('tool-count copy matches the registry everywhere', async ({ request }) => {
    const home = await (await request.get('/')).text();
    expect(home).toContain(`${TOOLS.length} free PDF tools`);
    expect(home).not.toMatch(/\b36 free/);
    const guides = await (await request.get('/guides/')).text();
    expect(guides).toContain(`All ${TOOLS.length} free PDF tools`);
    expect(guides).not.toMatch(/\b36 free/);
    const guide = await (await request.get('/guides/how-to-merge-pdfs-free/')).text();
    expect(guide).toContain('All PDF guides');
    expect(guide).not.toMatch(/\b36 free/);
  });

  test('sitemap covers every tool and guide, robots points at it', async ({ request }) => {
    const sitemap = await (await request.get('/sitemap.xml')).text();
    expect(sitemap).toContain('https://pdfhaven.app/merge-pdf/');
    expect(sitemap).toContain('https://pdfhaven.app/guides/');
    for (const slug of Object.values(TOOL_SLUGS)) {
      expect(sitemap, `sitemap missing /${slug}/`).toContain(`https://pdfhaven.app/${slug}/`);
    }
    // home + tools hub + guides hub + categories + trust pages + tools + guides
    const hubs = 3;
    expect((sitemap.match(/<loc>/g) ?? []).length).toBe(
      hubs + seoContent.categories.length + seoContent.pages.length + TOOLS.length + guideCount,
    );
    for (const path of ['/tools/', '/tools/essentials/', '/about/', '/privacy/']) {
      expect(sitemap, `sitemap missing ${path}`).toContain(`https://pdfhaven.app${path}`);
    }

    const robots = await (await request.get('/robots.txt')).text();
    expect(robots).toContain('Sitemap: https://pdfhaven.app/sitemap.xml');
    expect(robots).toContain('Host: pdfhaven.app');
    expect(robots).not.toContain('Disallow: /');
    for (const bot of ['GPTBot', 'OAI-SearchBot', 'PerplexityBot', 'ClaudeBot']) {
      expect(robots).toContain(`User-agent: ${bot}`);
    }
  });

  test('tool pages ship complete structured data and social cards', async ({ request }) => {
    const html = await (await request.get('/merge-pdf/')).text();
    const blocks = [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)];
    expect(blocks).toHaveLength(1);
    const graph = (JSON.parse(blocks[0]![1]) as { '@graph': { '@type': string; [key: string]: unknown }[] })['@graph'];
    const types = graph.map((node) => node['@type']);
    for (const type of [
      'Organization',
      'WebSite',
      'SoftwareApplication',
      'BreadcrumbList',
      'FAQPage',
      'HowTo',
    ]) {
      expect(types, `missing ${type}`).toContain(type);
    }
    const app = graph.find((node) => node['@type'] === 'SoftwareApplication')!;
    expect(app.url).toBe('https://pdfhaven.app/merge-pdf/');
    expect((app.offers as { price: string }).price).toBe('0');
    const articleTypes = graph.filter((node) => node['@type'] === 'Article');
    expect(articleTypes).toHaveLength(0);

    expect((html.match(/<h1[\s>]/g) ?? []).length).toBe(1);
    expect(html).toContain('<meta property="og:image" content="https://pdfhaven.app/og.jpg"');
    expect(html).toContain('<meta name="twitter:card" content="summary_large_image"');
    expect(html.match(/property="og:title"/g) ?? []).toHaveLength(1);
    expect(html).toContain('<link rel="alternate" hreflang="x-default"');
    expect(html).toContain('type="application/rss+xml"');
  });

  test('category and trust pages are indexable with their own metadata', async ({ request }) => {
    const expectations: [string, string][] = [
      ['/tools/', 'CollectionPage'],
      ['/tools/essentials/', 'CollectionPage'],
      ['/about/', 'WebPage'],
      ['/privacy/', 'WebPage'],
    ];
    for (const [path, pageType] of expectations) {
      const res = await request.get(path);
      expect(res.ok(), `${path} should return 200`).toBe(true);
      const html = await res.text();
      expect(html).toContain(`<link rel="canonical" href="https://pdfhaven.app${path}"`);
      expect((html.match(/<h1[\s>]/g) ?? []).length).toBe(1);
      expect(html).toContain(`"@type":"${pageType}"`);
      expect(html).not.toMatch(/\b36 free/);
      expect(html).toContain('max-image-preview:large');
    }
  });

  test('guides feed, llms.txt, OG image and 404 are shipped correctly', async ({ request }) => {
    const feed = await (await request.get('/feed.xml')).text();
    expect((feed.match(/<item>/g) ?? []).length).toBe(guideCount);
    expect(feed).toContain('https://pdfhaven.app/guides/how-to-merge-pdfs-free/');

    const llms = await (await request.get('/llms.txt')).text();
    expect(llms).toContain('https://pdfhaven.app/tools/');
    for (const tool of seoContent.tools) {
      expect(llms, `llms.txt missing ${tool.slug}`).toContain(`https://pdfhaven.app/${tool.slug}/`);
    }

    const image = await request.get('/og.jpg');
    expect(image.ok()).toBe(true);
    expect(image.headers()['content-type']).toContain('image/jpeg');

    const notFound = readFileSync(new URL('../dist/404.html', import.meta.url), 'utf8');
    expect(notFound).toContain('noindex');
    expect(notFound).toContain('<h1');
  });

  test('version.json matches the package version and has build metadata', async ({ request }) => {
    const res = await request.get('/version.json');
    expect(res.ok()).toBe(true);
    const version = await res.json();
    expect(version.version).toBe(pkg.version);
    expect(typeof version.commit).toBe('string');
    expect(Number.isNaN(Date.parse(version.builtAt))).toBe(false);
  });

  test('shipped security headers cover CSP and MIME/frame hardening', async () => {
    const headers = readFileSync(new URL('../public/_headers', import.meta.url), 'utf8');
    expect(headers).toContain("default-src 'self'");
    expect(headers).toContain("object-src 'none'");
    expect(headers).toContain("frame-ancestors 'self'");
    expect(headers).toContain('X-Content-Type-Options: nosniff');
    expect(headers).toContain('X-Frame-Options: SAMEORIGIN');
    expect(headers).toContain('Referrer-Policy: no-referrer');
    expect(headers).toContain('Permissions-Policy: camera=(self), microphone=(), geolocation=()');
  });
});
