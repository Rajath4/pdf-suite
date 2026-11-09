// SSG prerender: one indexable landing page per tool, category, guide and
// editorial page + sitemap, RSS, robots, llms.txt and a real 404.
// Run after `vite build`. Every route gets unique title/meta/canonical,
// rich structured data and crawlable content — the two halves of SPA SEO
// Google explicitly requires (addressability + content).
// Override the canonical domain with SITE_URL (no trailing slash).
import { execSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const SITE = (process.env.SITE_URL || 'https://pdfhaven.app').replace(/\/+$/, '');
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DIST = join(ROOT, 'dist');
const PKG = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));
const SEO = JSON.parse(readFileSync(join(ROOT, 'src', 'seo', 'content.json'), 'utf8'));
const GUIDES = JSON.parse(readFileSync(join(ROOT, 'src', 'seo', 'guides.json'), 'utf8')).guides;
const CATEGORIES = SEO.categories;
const TOOLS_INDEX = SEO.toolsIndex;
const GUIDES_INDEX = SEO.guidesIndex;
/** Keep in sync with the SPA homepage “Learn · PDF guides” strip. */
const HOME_GUIDE_SLUGS = [
  'how-to-merge-pdfs-free',
  'how-to-compress-pdf-under-1mb',
  'how-to-convert-pdf-to-jpg-free',
  'how-to-convert-images-to-pdf-free',
  'how-to-sign-pdf-free',
  'how-to-redact-pdf-free',
  'free-pdf-tools-compared',
  'how-to-ocr-pdf-free',
];
const HOME_GUIDES = HOME_GUIDE_SLUGS.map((slug) => GUIDES.find((g) => g.slug === slug)).filter(Boolean);
const PAGES = SEO.pages;
const OG_IMAGE = `${SITE}/og.jpg`;
const BUILD_DATE = new Date().toISOString();

const esc = (s) =>
  String(s)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');

const json = (value) => JSON.stringify(value).replaceAll('<', '\\u003c');

const abs = (path) => `${SITE}${path}`;

/** Real content date from git when available (stable lastmod signal). */
function gitDate(path) {
  try {
    const date = execSync(`git log -1 --format=%cs -- ${JSON.stringify(path)}`, {
      cwd: ROOT,
      stdio: ['ignore', 'pipe', 'ignore'],
    })
      .toString()
      .trim();
    return /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : BUILD_DATE.slice(0, 10);
  } catch {
    return BUILD_DATE.slice(0, 10);
  }
}

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

const REGISTRY_CATEGORIES = [...new Set([...META.values()].map((m) => m.category))];
const CAT_SLUGS = new Map();
const catMapSrc = /export const CATEGORY_SLUGS[^{]*\{([\s\S]*?)\}/.exec(registrySrc);
for (const m of catMapSrc?.[1]?.matchAll(/(?:'([^']+)'|([A-Za-z_]\w*)):\s*'([^']+)'/g) ?? []) {
  CAT_SLUGS.set(m[1] ?? m[2], m[3]);
}
if (CATEGORIES.length !== REGISTRY_CATEGORIES.length) {
  console.error('content.json categories do not match the registry — keep them in sync');
  process.exit(1);
}
for (const c of CATEGORIES) {
  if (!REGISTRY_CATEGORIES.includes(c.category)) {
    console.error(`content.json category "${c.category}" is not in the registry`);
    process.exit(1);
  }
  if (CAT_SLUGS.get(c.category) !== c.slug) {
    console.error(`category slug mismatch for "${c.category}" (${c.slug} vs ${CAT_SLUGS.get(c.category)})`);
    process.exit(1);
  }
  if (!META.size || !SEO.tools.some((t) => META.get(t.id)?.category === c.category)) {
    console.error(`category "${c.category}" has no tools`);
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

for (const t of SEO.tools) {
  if (!META.has(t.id)) {
    console.error(`content.json references unknown tool id "${t.id}"`);
    process.exit(1);
  }
}

const shell = readFileSync(join(DIST, 'index.html'), 'utf8');
if (!shell.includes('<div id="app"></div>') || !shell.includes('<!--seo:start-->')) {
  console.error('dist/index.html shell not as expected (missing #app or SEO markers)');
  process.exit(1);
}

const TOP_TOOLS = new Set(['merge', 'compress', 'sign', 'split', 'pdf-to-word', 'images-to-pdf', 'protect-pdf', 'ocr']);
const PAGE_LAST_MOD = {
  home: gitDate('src/seo/content.json'),
  tools: gitDate('src/seo/content.json'),
  categories: gitDate('src/seo/content.json'),
  guides: gitDate('src/seo/guides.json'),
  pages: gitDate('src/seo/content.json'),
};

function headTags({
  title,
  description,
  canonical,
  type = 'website',
  faqs,
  breadcrumbs,
  howto,
  article,
  software,
  collection,
}) {
  const graph = [];
  const orgId = `${SITE}/#organization`;
  const siteId = `${SITE}/#website`;
  const webId = `${canonical}#webpage`;
  const imageId = `${SITE}/og.jpg#primaryimage`;

  graph.push({
    '@type': 'Organization',
    '@id': orgId,
    name: 'PDF Haven',
    url: `${SITE}/`,
    logo: { '@type': 'ImageObject', url: `${SITE}/icons/icon-512.png`, width: 512, height: 512 },
    description:
      'Open-source, privacy-first PDF toolkit. 37 free tools that process documents entirely in the browser.',
    sameAs: ['https://github.com/Rajath4/pdf-suite'],
  });
  graph.push({
    '@type': 'WebSite',
    '@id': siteId,
    url: `${SITE}/`,
    name: 'PDF Haven',
    description: 'Free, private PDF tools that run 100% in your browser.',
    publisher: { '@id': orgId },
    inLanguage: 'en',
  });

  const image = {
    '@type': 'ImageObject',
    '@id': imageId,
    url: OG_IMAGE,
    width: 1200,
    height: 630,
    caption: 'PDF Haven — free private PDF tools',
  };
  graph.push(image);

  if (article) {
    graph.push({
      '@type': 'Article',
      '@id': `${canonical}#article`,
      isPartOf: { '@id': siteId },
      mainEntityOfPage: { '@id': webId },
      headline: article.headline,
      description: article.description,
      image: [{ '@id': imageId }],
      datePublished: `${article.updated}T12:00:00+00:00`,
      dateModified: `${article.updated}T12:00:00+00:00`,
      author: { '@type': 'Organization', name: 'PDF Haven Editorial Team', url: `${SITE}/about/` },
      publisher: { '@id': orgId },
      articleSection: article.section,
      wordCount: article.wordCount,
      inLanguage: 'en',
    });
  } else if (collection) {
    graph.push({
      '@type': 'CollectionPage',
      '@id': webId,
      url: canonical,
      name: title,
      description,
      isPartOf: { '@id': siteId },
      primaryImageOfPage: { '@id': imageId },
      breadcrumb: breadcrumbs?.length ? { '@id': `${canonical}#breadcrumb` } : undefined,
      mainEntity: collection,
      inLanguage: 'en',
    });
  } else {
    graph.push({
      '@type': 'WebPage',
      '@id': webId,
      url: canonical,
      name: title,
      description,
      isPartOf: { '@id': siteId },
      primaryImageOfPage: { '@id': imageId },
      breadcrumb: breadcrumbs?.length ? { '@id': `${canonical}#breadcrumb` } : undefined,
      inLanguage: 'en',
    });
  }

  if (software) {
    graph.push({
      '@type': 'SoftwareApplication',
      '@id': `${canonical}#app`,
      name: software.name,
      url: canonical,
      description,
      applicationCategory: 'UtilitiesApplication',
      applicationSubCategory: software.category,
      operatingSystem: 'Any (web browser)',
      browserRequirements: 'Requires JavaScript and a modern browser',
      softwareVersion: PKG.version,
      isAccessibleForFree: true,
      offers: {
        '@type': 'Offer',
        price: '0',
        priceCurrency: 'USD',
        availability: 'https://schema.org/InStock',
      },
      publisher: { '@id': orgId },
      image: { '@id': imageId },
      inLanguage: 'en',
    });
  }

  if (breadcrumbs?.length) {
    graph.push({
      '@type': 'BreadcrumbList',
      '@id': `${canonical}#breadcrumb`,
      itemListElement: breadcrumbs.map((b, i) => ({
        '@type': 'ListItem',
        position: i + 1,
        name: b.name,
        item: b.url,
      })),
    });
  }
  if (faqs?.length) {
    graph.push({
      '@type': 'FAQPage',
      '@id': `${canonical}#faq`,
      isPartOf: { '@id': webId },
      mainEntity: faqs.map(([q, a]) => ({
        '@type': 'Question',
        name: q,
        acceptedAnswer: { '@type': 'Answer', text: a },
      })),
    });
  }
  if (howto?.steps?.length) {
    graph.push({
      '@type': 'HowTo',
      '@id': `${canonical}#howto`,
      name: howto.name,
      description: howto.description,
      step: howto.steps.map((s, i) => ({
        '@type': 'HowToStep',
        position: i + 1,
        name: `Step ${i + 1}`,
        text: s,
      })),
      inLanguage: 'en',
    });
  }

  const verify = [
    ['google-site-verification', process.env.GOOGLE_SITE_VERIFICATION],
    ['msvalidate.01', process.env.BING_SITE_VERIFICATION],
    ['yandex-verification', process.env.YANDEX_VERIFICATION],
    ['baidu-site-verification', process.env.BAIDU_VERIFICATION],
  ].filter(([, v]) => v);

  return [
    `<title>${esc(title)}</title>`,
    `<meta name="description" content="${esc(description)}" />`,
    `<meta name="robots" content="index, follow, max-image-preview:large, max-snippet:-1, max-video-preview:-1" />`,
    `<link rel="canonical" href="${canonical}" />`,
    `<link rel="alternate" hreflang="en" href="${canonical}" />`,
    `<link rel="alternate" hreflang="x-default" href="${canonical}" />`,
    `<link rel="alternate" type="application/rss+xml" title="PDF Haven guides" href="${SITE}/feed.xml" />`,
    `<meta property="og:type" content="${type}" />`,
    `<meta property="og:site_name" content="PDF Haven" />`,
    `<meta property="og:locale" content="en_US" />`,
    `<meta property="og:title" content="${esc(title)}" />`,
    `<meta property="og:description" content="${esc(description)}" />`,
    `<meta property="og:url" content="${canonical}" />`,
    `<meta property="og:image" content="${OG_IMAGE}" />`,
    `<meta property="og:image:width" content="1200" />`,
    `<meta property="og:image:height" content="630" />`,
    `<meta property="og:image:alt" content="PDF Haven — free private PDF tools" />`,
    `<meta name="twitter:card" content="summary_large_image" />`,
    `<meta name="twitter:title" content="${esc(title)}" />`,
    `<meta name="twitter:description" content="${esc(description)}" />`,
    `<meta name="twitter:image" content="${OG_IMAGE}" />`,
    `<meta name="twitter:image:alt" content="PDF Haven — free private PDF tools" />`,
    ...(article
      ? [
          `<meta property="article:published_time" content="${article.updated}T12:00:00+00:00" />`,
          `<meta property="article:modified_time" content="${article.updated}T12:00:00+00:00" />`,
          `<meta property="article:section" content="${esc(article.section)}" />`,
        ]
      : []),
    ...verify.map(([name, content]) => `<meta name="${name}" content="${esc(content)}" />`),
    `<script type="application/ld+json">${json({ '@context': 'https://schema.org', '@graph': graph })}</script>`,
  ].join('\n    ');
}

function toolCard(entry) {
  const meta = META.get(entry.id);
  return `<a class="card" data-cat="${esc(meta.category)}" href="/${entry.slug}/"><span class="card-icon" aria-hidden="true">${esc(meta.icon)}</span><strong class="card-title">${esc(meta.title)}</strong><span class="card-desc">${esc(meta.description)}</span></a>`;
}

function guideLinks(ids, limit = 4) {
  return GUIDES.filter((g) => g.relatedTools.some((id) => ids.includes(id)))
    .slice(0, limit)
    .map((g) => `<a href="/guides/${g.slug}/">${esc(g.h1.replace(/ —.*$/, '').slice(0, 48))}</a>`)
    .join(' · ');
}

function toolBody(entry, meta) {
  const canonical = `${SITE}/${entry.slug}/`;
  const categoryPage = CATEGORIES.find((c) => c.category === meta.category);
  const related = [...META.entries()]
    .filter(([id, m]) => m.category === meta.category && id !== entry.id)
    .slice(0, 6);
  // Mirror of the SPA's "Learn more" chips: guides that use this tool.
  const toolsGuides = guideLinks([entry.id]);
  const popular = ['merge', 'compress', 'sign', 'split']
    .filter((id) => id !== entry.id)
    .map((id) => {
      const t = SEO.tools.find((x) => x.id === id);
      const m = META.get(id);
      return `<a href="/${t.slug}/">${esc(m.icon)} ${esc(m.title)}</a>`;
    })
    .join(' · ');
  return [
    `<div class="wrap tool"><nav aria-label="Breadcrumb"><a href="/">Home</a> / <a href="/tools/">All tools</a> / <a href="${categoryPage ? `/tools/${categoryPage.slug}/` : `/tools/`}">${esc(meta.category)}</a> / <span aria-current="page">${esc(meta.title)}</span></nav>`,
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
    categoryPage ? `<p>More in <a href="/tools/${categoryPage.slug}/">${esc(meta.category)}</a>.</p>` : '',
    `<h2>Popular PDF tools</h2><p>${popular}</p>`,
    toolsGuides ? `<h2>Learn more</h2><p>${toolsGuides}</p>` : '',
    `<p><a href="/tools/">← All ${SEO.tools.length} free PDF tools</a> · Canonical: <a href="${canonical}">${canonical}</a></p></div>`,
  ].join('\n');
}

function categoryBody(entry) {
  const tools = SEO.tools.filter((t) => META.get(t.id)?.category === entry.category);
  const guides = guideLinks(tools.map((t) => t.id));
  const others = CATEGORIES.filter((c) => c !== entry)
    .map((c) => `<a href="/tools/${c.slug}/">${esc(c.category)}</a>`)
    .join(' · ');
  return [
    `<div class="wrap tool"><nav aria-label="Breadcrumb"><a href="/">Home</a> / <a href="/tools/">All tools</a> / <span aria-current="page">${esc(entry.category)}</span></nav>`,
    `<h1>${esc(entry.h1)}</h1>`,
    `<p>${esc(entry.intro)}</p>`,
    `<h2>${esc(entry.category)} tools</h2>`,
    `<div class="grid">${tools.map(toolCard).join('\n')}</div>`,
    `<h2>How to choose</h2><p>${esc(entry.choosing)}</p>`,
    `<h2>Frequently asked questions</h2>`,
    entry.faqs.map(([q, a]) => `<details><summary>${esc(q)}</summary><p>${esc(a)}</p></details>`).join('\n'),
    guides ? `<h2>Guides for these tools</h2><p>${guides}</p>` : '',
    `<h2>Other categories</h2><p>${others}</p>`,
    `<p><a href="/tools/">← All ${SEO.tools.length} free PDF tools</a></p></div>`,
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
  const canonical = `${SITE}/guides/${g.slug}/`;
  const toolLinks = g.relatedTools
    .map((id) => {
      const t = SEO.tools.find((x) => x.id === id);
      const m = META.get(id);
      return `<a href="/${t.slug}/">${esc(m.icon)} ${esc(m.title)}</a>`;
    })
    .join(' · ');
  const guideLinksHtml = g.relatedGuides
    .map((gs) => {
      const r = GUIDES.find((x) => x.slug === gs);
      return `<a href="/guides/${r.slug}/">${esc(r.h1.split(' — ')[0].slice(0, 50))}</a>`;
    })
    .join(' · ');
  return [
    `<div class="wrap tool"><nav aria-label="Breadcrumb"><a href="/">Home</a> / <a href="/guides/">Guides</a> / <span aria-current="page">${esc(g.category)}</span></nav>`,
    `<h1>${esc(g.h1)}</h1>`,
    `<p class="byline"><span class="byline-cat">${esc(g.category)}</span><span>${guideMinutes(g)} min read</span><span>${esc(fmtMonth(g.updated))}</span><span>By the PDF Haven Editorial Team</span></p>`,
    `<article class="article">`,
    ...g.intro.map((p) => `<p>${esc(p)}</p>`),
    `<p><strong>Try it now:</strong> ${toolLinks}</p>`,
    ...g.sections.flatMap((s) => [`<h2>${esc(s.h2)}</h2>`, ...s.body.map((p) => `<p>${esc(p)}</p>`)]),
    `<h2>Steps</h2><ol class="howto">${g.steps.map((s) => `<li>${esc(s)}</li>`).join('')}</ol>`,
    `<h2>Pro tips</h2><ul class="tip-list">${g.tips.map((s) => `<li>${esc(s)}</li>`).join('')}</ul>`,
    `<h2>Frequently asked questions</h2>`,
    g.faqs.map(([q, a]) => `<details><summary>${esc(q)}</summary><p>${esc(a)}</p></details>`).join('\n'),
    `</article>`,
    `<h2>Related guides</h2><p>${guideLinksHtml}</p>`,
    prev || next
      ? `<nav aria-label="More guides"><p>${prev ? `<a href="/guides/${prev.slug}/">← Previous: ${esc(prev.h1.split(' — ')[0].slice(0, 44))}</a>` : ''}${prev && next ? ' · ' : ''}${next ? `<a href="/guides/${next.slug}/">Next: ${esc(next.h1.split(' — ')[0].slice(0, 44))} →</a>` : ''}</p></nav>`
      : '',
    `<p><a href="/guides/">← All PDF guides</a> · Canonical: <a href="${canonical}">${canonical}</a></p></div>`,
  ].join('\n');
}

function guidesIndexBody() {
  const cards = GUIDES.map(
    (g) =>
      `<a class="card guide-card" data-gcat="${esc(g.category)}" href="/guides/${g.slug}/"><div class="card-icon">${esc(g.icon || '📖')}</div><div class="card-title">${esc(g.h1.split(' — ')[0].slice(0, 60))}</div><div class="card-desc">${esc(g.description)}</div><div class="guide-meta"><span class="guide-cat">${esc(g.category)}</span><span>${guideMinutes(g)} min read</span><span>${esc(fmtMonth(g.updated))}</span></div></a>`,
  ).join('\n');
  return [
    `<div class="wrap"><h1>${esc(GUIDES_INDEX.h1)}</h1>`,
    `<p>Step-by-step playbooks for compressing, merging, signing, and converting PDFs — written from the features above and tested against the live tools.</p>`,
    `<div>${cards}</div>`,
    `<h2>Frequently asked questions</h2>`,
    GUIDES_INDEX.faqs.map(([q, a]) => `<details><summary>${esc(q)}</summary><p>${esc(a)}</p></details>`).join('\n'),
    `<p><a href="/">← All ${SEO.tools.length} free PDF tools</a></p></div>`,
  ].join('\n');
}

function toolsIndexBody() {
  const cats = CATEGORIES.map(
    (c) =>
      `<a class="card" href="/tools/${c.slug}/"><div class="card-icon" aria-hidden="true">🗂</div><div class="card-title">${esc(c.category)}</div><div class="card-desc">${SEO.tools.filter((t) => META.get(t.id)?.category === c.category).length} private, free tools — open the category page.</div></a>`,
  ).join('\n');
  const groups = CATEGORIES.map((c) => {
    const tools = SEO.tools.filter((t) => META.get(t.id)?.category === c.category);
    return `<h2><a href="/tools/${c.slug}/">${esc(c.category)}</a></h2><div class="grid">${tools.map(toolCard).join('\n')}</div>`;
  }).join('\n');
  return [
    `<div class="wrap tool"><nav aria-label="Breadcrumb"><a href="/">Home</a> / <span aria-current="page">All tools</span></nav>`,
    `<h1>${esc(TOOLS_INDEX.h1)}</h1>`,
    `<p>${esc(TOOLS_INDEX.intro)}</p>`,
    `<h2>Browse by category</h2><div class="grid">${cats}</div>`,
    groups,
    `<h2>Frequently asked questions</h2>`,
    TOOLS_INDEX.faqs.map(([q, a]) => `<details><summary>${esc(q)}</summary><p>${esc(a)}</p></details>`).join('\n'),
    `<p>Prefer reading? Browse the <a href="/guides/">free PDF guides</a>.</p>`,
    `<p><a href="/">← PDF Haven homepage</a></p></div>`,
  ].join('\n');
}

function pageBody(page) {
  return [
    `<div class="wrap tool"><nav aria-label="Breadcrumb"><a href="/">Home</a> / <span aria-current="page">${esc(page.navLabel)}</span></nav>`,
    `<h1>${esc(page.h1)}</h1>`,
    `<p>${esc(page.intro)}</p>`,
    ...page.sections.flatMap((s) => [`<h2>${esc(s.h2)}</h2>`, ...s.body.map((p) => `<p>${esc(p)}</p>`)]),
    `<p><a href="/">← All ${SEO.tools.length} free PDF tools</a> · <a href="/guides/">PDF guides</a></p></div>`,
  ].join('\n');
}

function homeBody() {
  const cards = SEO.tools.map(toolCard).join('\n');
  const cats = CATEGORIES.map(
    (c) => `<a href="/tools/${c.slug}/">${esc(c.category)} · ${SEO.tools.filter((t) => META.get(t.id)?.category === c.category).length}</a>`,
  ).join(' · ');
  const rows = SEO.home.points
    .map(([label, typical, ours]) => `<tr><th scope="row">${esc(label)}</th><td>${esc(typical)}</td><td><strong>${esc(ours)}</strong></td></tr>`)
    .join('\n');
  return [
    `<div class="wrap"><h1>${esc(SEO.home.h1)}</h1>`,
    `<p>${esc(SEO.home.intro)}</p>`,
    `<h2>Browse by category</h2><p>${cats} · <a href="/tools/">all tools directory</a></p>`,
    `<h2>All free PDF tools</h2><div>${cards}</div>`,
    `<h2>Popular PDF guides</h2><p>${HOME_GUIDES.map((g) => `<a href="/guides/${g.slug}/">${esc(g.h1.split(' — ')[0].slice(0, 44))}</a>`).join(' · ')} · <a href="/guides/">All guides →</a></p>`,
    `<h2>Why PDF Haven instead of typical online tools</h2>`,
    `<table><thead><tr><th scope="col" aria-label="Feature"></th><th scope="col">Typical online tools</th><th scope="col">PDF Haven</th></tr></thead><tbody>${rows}</tbody></table>`,
    `<h2>Frequently asked questions</h2>`,
    SEO.home.faqs.map(([q, a]) => `<details><summary>${esc(q)}</summary><p>${esc(a)}</p></details>`).join('\n'),
    `</div>`,
  ].join('\n');
}

/** Static mirror of the app header, so hydration does not push content down
 *  (CLS) before the router mounts. Buttons become interactive after boot. */
const SHELL_HEADER = [
  '<a class="skip-link" href="#main">Skip to content</a>',
  '<header class="topbar"><div class="wrap topbar-inner">',
  '<a class="logo" href="/"><span class="logo-mark">PDF</span><span>PDF Haven</span></a>',
  '<nav class="topnav"><a href="/">All tools</a><a href="/guides/">Guides</a>',
  '<button class="btn small palette-btn" type="button" aria-label="🔍 Tools⌘K">🔍 Tools<kbd class="kbd">⌘K</kbd></button>',
  '<button class="btn small theme-btn" type="button" aria-label="Toggle dark mode">☾</button>',
  '<button class="btn small install-btn" type="button" hidden>⤓ Install</button>',
  '</nav></div></header>',
].join('');

function buildPage({ title, description, canonical, body, extra }) {
  let html = shell;
  html = html.replace(
    /<!--seo:start-->[\s\S]*?<!--seo:end-->/,
    `<!--seo:start-->\n    ${extra}\n    <!--seo:end-->`,
  );
  html = html.replace('<div id="app"></div>', `<div id="app">${SHELL_HEADER}${body}</div>`);
  return html;
}

function writePage(htmlPath, html, loc, lastmod, priority) {
  const dir = join(DIST, dirname(htmlPath));
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(DIST, htmlPath), html);
  sitemapUrls.push({ loc, lastmod, priority });
  console.log(`prerendered ${loc.replace(SITE, '') || '/'}`);
}

const today = BUILD_DATE.slice(0, 10);
const sitemapUrls = [];

// Home
{
  const canonical = `${SITE}/`;
  const extra = headTags({
    title: SEO.home.title,
    description: SEO.home.description,
    canonical,
    faqs: SEO.home.faqs,
    software: { name: 'PDF Haven', category: 'PDF tools' },
  });
  writePage(
    'index.html',
    buildPage({ title: SEO.home.title, description: SEO.home.description, canonical, body: homeBody(), extra }),
    canonical,
    PAGE_LAST_MOD.home,
    '1.0',
  );
}

// Tools directory + category hubs.
{
  const canonical = `${SITE}/tools/`;
  const extra = headTags({
    title: TOOLS_INDEX.title,
    description: TOOLS_INDEX.description,
    canonical,
    faqs: TOOLS_INDEX.faqs,
    collection: {
      '@type': 'ItemList',
      '@id': `${canonical}#tools`,
      numberOfItems: SEO.tools.length,
      itemListElement: SEO.tools.map((t, i) => ({
        '@type': 'ListItem',
        position: i + 1,
        name: META.get(t.id).title,
        url: abs(`/${t.slug}/`),
      })),
    },
    breadcrumbs: [
      { name: 'Home', url: `${SITE}/` },
      { name: 'All tools', url: canonical },
    ],
  });
  writePage(
    'tools/index.html',
    buildPage({ title: TOOLS_INDEX.title, description: TOOLS_INDEX.description, canonical, body: toolsIndexBody(), extra }),
    canonical,
    PAGE_LAST_MOD.tools,
    '0.9',
  );
}
for (const cat of CATEGORIES) {
  const canonical = `${SITE}/tools/${cat.slug}/`;
  const tools = SEO.tools.filter((t) => META.get(t.id)?.category === cat.category);
  const extra = headTags({
    title: cat.title,
    description: cat.description,
    canonical,
    faqs: cat.faqs,
    collection: {
      '@type': 'ItemList',
      '@id': `${canonical}#tools`,
      numberOfItems: tools.length,
      itemListElement: tools.map((t, i) => ({
        '@type': 'ListItem',
        position: i + 1,
        name: META.get(t.id).title,
        url: abs(`/${t.slug}/`),
      })),
    },
    breadcrumbs: [
      { name: 'Home', url: `${SITE}/` },
      { name: 'All tools', url: `${SITE}/tools/` },
      { name: cat.category, url: canonical },
    ],
  });
  writePage(
    `tools/${cat.slug}/index.html`,
    buildPage({ title: cat.title, description: cat.description, canonical, body: categoryBody(cat), extra }),
    canonical,
    PAGE_LAST_MOD.categories,
    '0.8',
  );
}

// Tool landing pages.
for (const entry of SEO.tools) {
  const meta = META.get(entry.id);
  const cat = CATEGORIES.find((c) => c.category === meta.category);
  const canonical = `${SITE}/${entry.slug}/`;
  const extra = headTags({
    title: entry.title,
    description: entry.description,
    canonical,
    faqs: entry.faqs,
    breadcrumbs: [
      { name: 'Home', url: `${SITE}/` },
      { name: 'All tools', url: `${SITE}/tools/` },
      { name: meta.category, url: abs(`/tools/${cat.slug}/`) },
      { name: meta.title, url: canonical },
    ],
    howto: { name: `How to use ${meta.title}`, description: entry.description, steps: entry.steps },
    software: { name: meta.title, category: meta.category },
  });
  writePage(
    `${entry.slug}/index.html`,
    buildPage({ title: entry.title, description: entry.description, canonical, body: toolBody(entry, meta), extra }),
    canonical,
    gitDate('src/seo/content.json'),
    TOP_TOOLS.has(entry.id) ? '0.9' : '0.8',
  );
}

// Guides hub + articles (content velocity: long-tail demand capture).
{
  const canonical = `${SITE}/guides/`;
  const extra = headTags({
    title: GUIDES_INDEX.title,
    description: GUIDES_INDEX.description,
    canonical,
    faqs: GUIDES_INDEX.faqs,
    collection: {
      '@type': 'ItemList',
      '@id': `${canonical}#guides`,
      numberOfItems: GUIDES.length,
      itemListElement: GUIDES.map((g, i) => ({
        '@type': 'ListItem',
        position: i + 1,
        name: g.h1,
        url: abs(`/guides/${g.slug}/`),
      })),
    },
    breadcrumbs: [
      { name: 'Home', url: `${SITE}/` },
      { name: 'Guides', url: canonical },
    ],
  });
  writePage(
    'guides/index.html',
    buildPage({
      title: GUIDES_INDEX.title,
      description: GUIDES_INDEX.description,
      canonical,
      body: guidesIndexBody(),
      extra,
    }),
    canonical,
    PAGE_LAST_MOD.guides,
    '0.8',
  );
}
for (const [gi, g] of GUIDES.entries()) {
  const canonical = `${SITE}/guides/${g.slug}/`;
  const extra = headTags({
    title: g.title,
    description: g.description,
    canonical,
    type: 'article',
    faqs: g.faqs,
    breadcrumbs: [
      { name: 'Home', url: `${SITE}/` },
      { name: 'Guides', url: `${SITE}/guides/` },
      { name: g.h1.split(' — ')[0].slice(0, 60), url: canonical },
    ],
    howto: { name: g.h1.split(' — ')[0].slice(0, 60), description: g.description, steps: g.steps },
    article: {
      headline: g.h1,
      updated: g.updated,
      description: g.description,
      section: g.category,
      wordCount: guideWords(g),
    },
  });
  writePage(
    `guides/${g.slug}/index.html`,
    buildPage({
      title: g.title,
      description: g.description,
      canonical,
      body: guideBody(g, gi > 0 ? GUIDES[gi - 1] : null, gi < GUIDES.length - 1 ? GUIDES[gi + 1] : null),
      extra,
    }),
    canonical,
    g.updated,
    '0.7',
  );
}

// Editorial trust pages (About, Privacy).
for (const page of PAGES) {
  const canonical = `${SITE}/${page.slug}/`;
  const extra = headTags({
    title: page.title,
    description: page.description,
    canonical,
    breadcrumbs: [
      { name: 'Home', url: `${SITE}/` },
      { name: page.navLabel, url: canonical },
    ],
  });
  writePage(
    `${page.slug}/index.html`,
    buildPage({ title: page.title, description: page.description, canonical, body: pageBody(page), extra }),
    canonical,
    PAGE_LAST_MOD.pages,
    '0.4',
  );
}

// 404: real status page when the host supports it, never indexed.
{
  const title = 'Page not found | PDF Haven';
  const description = 'That page does not exist. Browse all 37 free PDF tools or the PDF guides instead.';
  const pops = ['merge', 'compress', 'split', 'sign']
    .map((id) => {
      const t = SEO.tools.find((x) => x.id === id);
      const m = META.get(id);
      return `<a href="/${t.slug}/">${esc(m.icon)} ${esc(m.title)}</a>`;
    })
    .join(' · ');
  const body = [
    `<div class="wrap tool"><h1>Page not found</h1>`,
    `<p>That URL does not exist. Start with the tools people use most:</p>`,
    `<p>${pops}</p>`,
    `<p>Browse <a href="/tools/">all ${SEO.tools.length} PDF tools</a>, the <a href="/guides/">PDF guides</a>, or the <a href="/">homepage</a>.</p></div>`,
  ].join('\n');
  const extra = [
    `<title>${esc(title)}</title>`,
    `<meta name="robots" content="noindex, follow" />`,
    `<meta name="description" content="${esc(description)}" />`,
  ].join('\n    ');
  writeFileSync(
    join(DIST, '404.html'),
    buildPage({ title, description, canonical: `${SITE}/404.html`, body, extra }),
  );
  console.log('prerendered /404.html');
}

// Sitemap (absolute URLs, real lastmod dates, no deprecated changefreq).
writeFileSync(
  join(DIST, 'sitemap.xml'),
  `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${sitemapUrls
    .map((u) => `  <url><loc>${u.loc}</loc><lastmod>${u.lastmod}</lastmod><priority>${u.priority}</priority></url>`)
    .join('\n')}\n</urlset>\n`,
);

// robots.txt: absolute sitemap + explicit search/AI crawler access.
const HOST = new URL(SITE).host;
const AI_BOTS = ['GPTBot', 'OAI-SearchBot', 'ChatGPT-User', 'PerplexityBot', 'ClaudeBot', 'Google-Extended', 'CCBot', 'Applebot-Extended'];
writeFileSync(
  join(DIST, 'robots.txt'),
  [
    'User-agent: *',
    'Allow: /',
    '',
    ...AI_BOTS.flatMap((bot) => [`User-agent: ${bot}`, 'Allow: /', '']),
    `Sitemap: ${SITE}/sitemap.xml`,
    `Host: ${HOST}`,
    '',
  ].join('\n'),
);

// RSS feed for guides (freshness discovery in readers, Bing and Yandex).
const rssDate = (iso) => new Date(`${iso}T12:00:00Z`).toUTCString();
const rssItems = [...GUIDES]
  .sort((a, b) => b.updated.localeCompare(a.updated))
  .map(
    (g) => `    <item>
      <title>${esc(g.title)}</title>
      <link>${SITE}/guides/${g.slug}/</link>
      <guid isPermaLink="true">${SITE}/guides/${g.slug}/</guid>
      <pubDate>${rssDate(g.updated)}</pubDate>
      <description>${esc(g.description)}</description>
    </item>`,
  )
  .join('\n');
writeFileSync(
  join(DIST, 'feed.xml'),
  `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">
  <channel>
    <title>PDF Haven — Free PDF Guides &amp; Tutorials</title>
    <link>${SITE}/guides/</link>
    <description>Step-by-step PDF guides: merge, compress, sign, OCR, convert and more.</description>
    <language>en</language>
    <lastBuildDate>${rssDate(BUILD_DATE.slice(0, 10))}</lastBuildDate>
    <atom:link href="${SITE}/feed.xml" rel="self" type="application/rss+xml" />
${rssItems}
  </channel>
</rss>
`,
);

// llms.txt: compact, structured site map for AI search and answer engines.
const llms = [
  '# PDF Haven',
  '',
  '> Free, private PDF tools that run 100% in the browser. No uploads, accounts, watermarks or signup. Open source (MIT).',
  '',
  `Site: ${SITE}/`,
  `Tools: ${SITE}/tools/`,
  `Guides: ${SITE}/guides/`,
  `Feed: ${SITE}/feed.xml`,
  '',
  '## Tools',
  ...SEO.tools.map((t) => `- [${META.get(t.id).title}](${SITE}/${t.slug}/): ${t.description}`),
  '',
  '## Categories',
  ...CATEGORIES.map((c) => `- [${c.category}](${SITE}/tools/${c.slug}/): ${c.description}`),
  '',
  '## Guides',
  ...GUIDES.map((g) => `- [${g.h1}](${SITE}/guides/${g.slug}/): ${g.description}`),
  '',
  '## About',
  `- [About PDF Haven](${SITE}/about/): ownership, technology and editorial standards.`,
  `- [Privacy](${SITE}/privacy/): what stays on your device and what the site measures.`,
  '',
].join('\n');
writeFileSync(join(DIST, 'llms.txt'), llms);

// Optional IndexNow key location (Bing, Yandex, Seznam, Naver).
if (process.env.INDEXNOW_KEY) {
  writeFileSync(join(DIST, `${process.env.INDEXNOW_KEY}.txt`), process.env.INDEXNOW_KEY);
  console.log(`IndexNow key file: /${process.env.INDEXNOW_KEY}.txt`);
}

console.log(`sitemap: ${sitemapUrls.length} URLs → ${SITE}/sitemap.xml`);
