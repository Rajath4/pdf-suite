// SSG prerender: one indexable landing page per tool + sitemap + robots.
// Run after `vite build`. Each tool gets a real URL (/merge-pdf/) carrying
// unique title/meta/canonical/schema and crawlable content — the two halves
// of SPA SEO Google explicitly requires (addressability + content).
// Override the canonical domain with SITE_URL (no trailing slash).
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const SITE = (process.env.SITE_URL || 'https://pdfhaven.app').replace(/\/+$/, '');
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DIST = join(ROOT, 'dist');
const SEO = JSON.parse(readFileSync(join(ROOT, 'src', 'seo', 'content.json'), 'utf8'));
const GUIDES = JSON.parse(readFileSync(join(ROOT, 'src', 'seo', 'guides.json'), 'utf8')).guides;

const esc = (s) =>
  String(s)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');

// Tool metadata (category/icon) lives in the TS registry — parse the known shape.
const registrySrc = readFileSync(join(ROOT, 'src', 'tools', 'registry.ts'), 'utf8');
const META = new Map();
for (const m of registrySrc.matchAll(
  /\{\s*id:\s*'([^']+)',\s*title:\s*'([^']+)',\s*description:\s*'([^']+)',\s*category:\s*'([^']+)',\s*icon:\s*'([^']+)'/g,
)) {
  META.set(m[1], { title: m[2], description: m[3], category: m[4], icon: m[5] });
}
if (META.size !== SEO.tools.length) {
  console.error(`registry has ${META.size} tools but content.json has ${SEO.tools.length} — keep them in sync`);
  process.exit(1);
}
for (const t of SEO.tools) {
  if (!META.has(t.id)) {
    console.error(`content.json references unknown tool id "${t.id}"`);
    process.exit(1);
  }
}

// Guides cross-reference integrity: fail the build on dead links.
for (const g of GUIDES) {
  for (const id of g.relatedTools) {
    if (!META.has(id)) {
      console.error(`guides.json: "${g.slug}" references unknown tool "${id}"`);
      process.exit(1);
    }
  }
  for (const gs of g.relatedGuides) {
    if (!GUIDES.some((x) => x.slug === gs)) {
      console.error(`guides.json: "${g.slug}" references unknown guide "${gs}"`);
      process.exit(1);
    }
  }
}

const shell = readFileSync(join(DIST, 'index.html'), 'utf8');
if (!shell.includes('<div id="app"></div>')) {
  console.error('dist/index.html shell not as expected (missing <div id="app"></div>)');
  process.exit(1);
}

const TOP_TOOLS = new Set(['merge', 'compress', 'sign', 'split', 'pdf-to-word', 'images-to-pdf', 'protect-pdf', 'ocr']);

function headTags({ title, description, canonical, faqs, breadcrumbs, howto, article }) {
  const jsonLd = [];
  jsonLd.push({
    '@context': 'https://schema.org',
    '@type': 'SoftwareApplication',
    name: title.split('|')[0].trim(),
    applicationCategory: 'UtilitiesApplication',
    operatingSystem: 'Any (Web)',
    offers: { '@type': 'Offer', price: '0', priceCurrency: 'USD' },
    description,
  });
  if (faqs?.length) {
    jsonLd.push({
      '@context': 'https://schema.org',
      '@type': 'FAQPage',
      mainEntity: faqs.map(([q, a]) => ({
        '@type': 'Question',
        name: q,
        acceptedAnswer: { '@type': 'Answer', text: a },
      })),
    });
  }
  if (breadcrumbs?.length) {
    jsonLd.push({
      '@context': 'https://schema.org',
      '@type': 'BreadcrumbList',
      itemListElement: breadcrumbs.map((b, i) => ({
        '@type': 'ListItem',
        position: i + 1,
        name: b.name,
        item: b.url,
      })),
    });
  }
  if (howto?.steps?.length) {
    jsonLd.push({
      '@context': 'https://schema.org',
      '@type': 'HowTo',
      name: howto.name,
      step: howto.steps.map((s) => ({ '@type': 'HowToStep', text: s })),
    });
  }
  if (article) {
    jsonLd.push({
      '@context': 'https://schema.org',
      '@type': 'Article',
      headline: article.headline,
      description: article.description,
      datePublished: article.updated,
      dateModified: article.updated,
      mainEntityOfPage: article.url,
      author: { '@type': 'Organization', name: 'PDF Haven' },
    });
  }
  return [
    `<link rel="canonical" href="${canonical}" />`,
    `<meta name="robots" content="index, follow" />`,
    `<meta property="og:type" content="website" />`,
    `<meta property="og:site_name" content="PDF Haven" />`,
    `<meta property="og:title" content="${esc(title)}" />`,
    `<meta property="og:description" content="${esc(description)}" />`,
    `<meta property="og:url" content="${canonical}" />`,
    `<meta property="og:image" content="${SITE}/icons/icon-512.png" />`,
    `<meta name="twitter:card" content="summary" />`,
    `<meta name="twitter:title" content="${esc(title)}" />`,
    `<meta name="twitter:description" content="${esc(description)}" />`,
    `<meta name="twitter:image" content="${SITE}/icons/icon-512.png" />`,
    ...jsonLd.map((o) => `<script type="application/ld+json">${JSON.stringify(o)}</script>`),
  ].join('\n    ');
}

function toolBody(entry, meta) {
  const url = `${SITE}/${entry.slug}/`;
  const related = [...META.entries()]
    .filter(([id, m]) => m.category === meta.category && id !== entry.id)
    .slice(0, 6);
  // Mirror of the SPA's "Learn more" chips: guides that use this tool.
  const guides = GUIDES.filter((g) => g.relatedTools.includes(entry.id)).slice(0, 4);
  const popular = ['merge', 'compress', 'sign', 'split']
    .filter((id) => id !== entry.id)
    .map((id) => {
      const t = SEO.tools.find((x) => x.id === id);
      const m = META.get(id);
      return `<a href="/${t.slug}/">${esc(m.icon)} ${esc(m.title)}</a>`;
    })
    .join(' · ');
  return [
    `<div class="wrap tool"><nav aria-label="Breadcrumb"><a href="/">All tools</a> / <span>${esc(meta.category)}</span> / <span>${esc(meta.title)}</span></nav>`,
    `<h1>${esc(entry.h1)}</h1>`,
    `<p>${esc(entry.intro)}</p>`,
    `<p><strong>Free forever · No watermark · No signup · Files never leave your device.</strong> Use it right below — the interactive tool loads with this page.</p>`,
    `<div id="tool-mount"></div>`,
    `<h2>How to use ${esc(meta.title)}</h2>`,
    `<ol>${entry.steps.map((s) => `<li>${esc(s)}</li>`).join('')}</ol>`,
    `<h2>Frequently asked questions</h2>`,
    entry.faqs.map(([q, a]) => `<details><summary>${esc(q)}</summary><p>${esc(a)}</p></details>`).join('\n'),
    related.length
      ? `<h2>Related PDF tools</h2><p>${related.map(([id, m]) => `<a href="/${SEO.tools.find((t) => t.id === id).slug}/">${esc(m.icon)} ${esc(m.title)}</a>`).join(' · ')}</p>`
      : '',
    `<h2>Popular PDF tools</h2><p>${popular}</p>`,
    guides.length
      ? `<h2>Learn more</h2><p>${guides.map((g) => `<a href="/guides/${g.slug}/">📖 ${esc(g.h1.split(' — ')[0].slice(0, 44))}</a>`).join(' · ')}</p>`
      : '',
    `<p><a href="/">← All 36 free PDF tools</a> · Canonical: <a href="${url}">${url}</a></p></div>`,
  ].join('\n');
}

const guideWords = (g) =>
  [...g.intro, ...g.sections.flatMap((s) => [s.h2, ...s.body]), ...g.steps, ...g.tips, ...g.faqs.flat()]
    .join(' ')
    .split(/\s+/).length;

const guideMinutes = (g) => Math.max(1, Math.ceil(guideWords(g) / 200));

const fmtMonth = (iso) => {
  const m = /^(\d{4})-(\d{2})-\d{2}$/.exec(String(iso).trim());
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return m && months[Number(m[2]) - 1] ? `${months[Number(m[2]) - 1]} ${m[1]}` : String(iso);
};

function guideBody(g, prev, next) {
  const url = `${SITE}/guides/${g.slug}/`;
  const toolLinks = g.relatedTools
    .map((id) => {
      const t = SEO.tools.find((x) => x.id === id);
      const m = META.get(id);
      return `<a href="/${t.slug}/">${esc(m.icon)} ${esc(m.title)}</a>`;
    })
    .join(' · ');
  const guideLinks = g.relatedGuides
    .map((gs) => {
      const r = GUIDES.find((x) => x.slug === gs);
      return `<a href="/guides/${r.slug}/">${esc(r.h1.split(' — ')[0].slice(0, 50))}</a>`;
    })
    .join(' · ');
  return [
    `<div class="wrap tool"><nav aria-label="Breadcrumb"><a href="/">All tools</a> / <a href="/guides/">Guides</a> / <span>${esc(g.category)}</span></nav>`,
    `<h1>${esc(g.h1)}</h1>`,
    `<p class="byline"><span class="byline-cat">${esc(g.category)}</span><span>${guideMinutes(g)} min read</span><span>${esc(fmtMonth(g.updated))}</span></p>`,
    `<article class="article">`,
    ...g.intro.map((p) => `<p>${esc(p)}</p>`),
    `<p><strong>Try it now:</strong> ${toolLinks}</p>`,
    ...g.sections.flatMap((s) => [`<h2>${esc(s.h2)}</h2>`, ...s.body.map((p) => `<p>${esc(p)}</p>`)]),
    `<h2>Steps</h2><ol class="howto">${g.steps.map((s) => `<li>${esc(s)}</li>`).join('')}</ol>`,
    `<h2>Pro tips</h2><ul class="tip-list">${g.tips.map((s) => `<li>${esc(s)}</li>`).join('')}</ul>`,
    `<h2>Frequently asked questions</h2>`,
    g.faqs.map(([q, a]) => `<details><summary>${esc(q)}</summary><p>${esc(a)}</p></details>`).join('\n'),
    `</article>`,
    `<h2>Related guides</h2><p>${guideLinks}</p>`,
    prev || next
      ? `<nav aria-label="More guides"><p>${prev ? `<a href="/guides/${prev.slug}/">← Previous: ${esc(prev.h1.split(' — ')[0].slice(0, 44))}</a>` : ''}${prev && next ? ' · ' : ''}${next ? `<a href="/guides/${next.slug}/">Next: ${esc(next.h1.split(' — ')[0].slice(0, 44))} →</a>` : ''}</p></nav>`
      : '',
    `<p><a href="/guides/">← All PDF guides</a> · Canonical: <a href="${url}">${url}</a></p></div>`,
  ].join('\n');
}

function guidesIndexBody() {
  const cards = GUIDES.map(
    (g) =>
      `<a class="card guide-card" data-gcat="${esc(g.category)}" href="/guides/${g.slug}/"><div class="card-icon">${esc(g.icon || '📖')}</div><div class="card-title">${esc(g.h1.split(' — ')[0].slice(0, 60))}</div><div class="card-desc">${esc(g.description)}</div><div class="guide-meta"><span class="guide-cat">${esc(g.category)}</span><span>${guideMinutes(g)} min read</span><span>${esc(fmtMonth(g.updated))}</span></div></a>`,
  ).join('\n');
  return [
    `<div class="wrap"><h1>Free PDF Guides &amp; Tutorials</h1>`,
    `<p>Step-by-step playbooks for compressing, merging, signing, and converting PDFs — written from the features above and tested against the live tools.</p>`,
    `<div>${cards}</div>`,
    `<p><a href="/">← All 36 free PDF tools</a></p></div>`,
  ].join('\n');
}

function guideHead(g) {
  const canonical = `${SITE}/guides/${g.slug}/`;
  return headTags({
    title: g.title,
    description: g.description,
    canonical,
    faqs: g.faqs,
    breadcrumbs: [
      { name: 'PDF Haven', url: `${SITE}/` },
      { name: 'Guides', url: `${SITE}/guides/` },
      { name: g.h1.split(' — ')[0].slice(0, 60), url: canonical },
    ],
    howto: { name: g.h1.split(' — ')[0].slice(0, 60), steps: g.steps },
    article: { headline: g.h1, updated: g.updated, description: g.description, url: canonical },
  });
}

function homeBody() {
  const cards = SEO.tools
    .map((t) => {
      const m = META.get(t.id);
      return `<a href="/${t.slug}/">${esc(m.icon)} <strong>${esc(m.title)}</strong><br><small>${esc(m.description)}</small></a>`;
    })
    .join('\n');
  const rows = SEO.home.points
    .map(([label, typical, ours]) => `<tr><td>${esc(label)}</td><td>${esc(typical)}</td><td><strong>${esc(ours)}</strong></td></tr>`)
    .join('\n');
  return [
    `<div class="wrap"><h1>${esc(SEO.home.h1)}</h1>`,
    `<p>${esc(SEO.home.intro)}</p>`,
    `<h2>All free PDF tools</h2><div>${cards}</div>`,
    `<h2>Popular PDF guides</h2><p>${GUIDES.slice(0, 6).map((g) => `<a href="/guides/${g.slug}/">${esc(g.h1.split(' — ')[0].slice(0, 44))}</a>`).join(' · ')} · <a href="/guides/">All guides →</a></p>`,
    `<h2>Why PDF Haven instead of typical online tools</h2>`,
    `<table><thead><tr><th></th><th>Typical online tools</th><th>PDF Haven</th></tr></thead><tbody>${rows}</tbody></table>`,
    `<h2>Frequently asked questions</h2>`,
    SEO.home.faqs.map(([q, a]) => `<details><summary>${esc(q)}</summary><p>${esc(a)}</p></details>`).join('\n'),
    `</div>`,
  ].join('\n');
}

function buildPage({ title, description, canonical, body, extra }) {
  let html = shell;
  html = html.replace(/<title>.*?<\/title>/, `<title>${esc(title)}</title>`);
  html = html.replace(
    /<meta\s+name="description"\s+content="[^"]*"\s*\/?>/,
    `<meta name="description" content="${esc(description)}" />`,
  );
  html = html.replace('</head>', `    ${extra}\n  </head>`);
  html = html.replace('<div id="app"></div>', `<div id="app">${body}</div>`);
  return html;
}

const today = new Date().toISOString().slice(0, 10);
const sitemapUrls = [{ loc: `${SITE}/`, priority: '1.0' }];

// Home
{
  const canonical = `${SITE}/`;
  const extra = headTags({
    title: SEO.home.title,
    description: SEO.home.description,
    canonical,
    faqs: SEO.home.faqs,
    breadcrumbs: [{ name: 'PDF Haven', url: canonical }],
  });
  writeFileSync(join(DIST, 'index.html'), buildPage({ title: SEO.home.title, description: SEO.home.description, canonical, body: homeBody(), extra }));
  console.log('prerendered /');
}

// Tools
for (const entry of SEO.tools) {
  const meta = META.get(entry.id);
  const canonical = `${SITE}/${entry.slug}/`;
  const extra = headTags({
    title: entry.title,
    description: entry.description,
    canonical,
    faqs: entry.faqs,
    breadcrumbs: [
      { name: 'PDF Haven', url: `${SITE}/` },
      { name: meta.title, url: canonical },
    ],
    howto: { name: `How to use ${meta.title}`, steps: entry.steps },
  });
  const dir = join(DIST, entry.slug);
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, 'index.html'),
    buildPage({ title: entry.title, description: entry.description, canonical, body: toolBody(entry, meta), extra }),
  );
  sitemapUrls.push({ loc: canonical, priority: TOP_TOOLS.has(entry.id) ? '0.9' : '0.8' });
  console.log(`prerendered /${entry.slug}/`);
}

// Guides hub + articles (content velocity: long-tail demand capture).
{
  const canonical = `${SITE}/guides/`;
  const extra = headTags({
    title: 'Free PDF Guides & Tutorials | PDF Haven',
    description:
      'Step-by-step PDF guides: merge, compress, sign, OCR, convert and more. Free, private, no signup.',
    canonical,
    breadcrumbs: [
      { name: 'PDF Haven', url: `${SITE}/` },
      { name: 'Guides', url: canonical },
    ],
  });
  const dir = join(DIST, 'guides');
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, 'index.html'),
    buildPage({
      title: 'Free PDF Guides & Tutorials | PDF Haven',
      description: 'Step-by-step PDF guides.',
      canonical,
      body: guidesIndexBody(),
      extra,
    }),
  );
  sitemapUrls.push({ loc: canonical, priority: '0.8' });
  console.log('prerendered /guides/');
}
for (const [gi, g] of GUIDES.entries()) {
  const canonical = `${SITE}/guides/${g.slug}/`;
  const extra = guideHead(g);
  const dir = join(DIST, 'guides', g.slug);
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, 'index.html'),
    buildPage({
      title: g.title,
      description: g.description,
      canonical,
      body: guideBody(g, gi > 0 ? GUIDES[gi - 1] : null, gi < GUIDES.length - 1 ? GUIDES[gi + 1] : null),
      extra,
    }),
  );
  sitemapUrls.push({ loc: canonical, priority: '0.7' });
  console.log(`prerendered /guides/${g.slug}/`);
}

// Sitemap + robots (absolute sitemap URL as the spec requires).
writeFileSync(
  join(DIST, 'sitemap.xml'),
  `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${sitemapUrls
    .map((u) => `  <url><loc>${u.loc}</loc><lastmod>${today}</lastmod><changefreq>weekly</changefreq><priority>${u.priority}</priority></url>`)
    .join('\n')}\n</urlset>\n`,
);
writeFileSync(join(DIST, 'robots.txt'), `User-agent: *\nAllow: /\nSitemap: ${SITE}/sitemap.xml\n`);
console.log(`sitemap: ${sitemapUrls.length} URLs → ${SITE}/sitemap.xml`);
