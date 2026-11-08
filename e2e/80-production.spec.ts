import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { TOOLS, TOOL_SLUGS } from '../src/tools/registry';

const pkg = JSON.parse(
  readFileSync(new URL('../package.json', import.meta.url), 'utf8'),
) as { version: string };
const guideCount = (JSON.parse(
  readFileSync(new URL('../src/seo/guides.json', import.meta.url), 'utf8'),
) as { guides: unknown[] }).guides.length;

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
    // home + guides index + one URL per tool + one per guide
    expect((sitemap.match(/<loc>/g) ?? []).length).toBe(2 + TOOLS.length + guideCount);

    const robots = await (await request.get('/robots.txt')).text();
    expect(robots).toContain('Sitemap: https://pdfhaven.app/sitemap.xml');
    expect(robots).not.toContain('Disallow: /');
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
