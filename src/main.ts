import './styles.css';
import { CATEGORIES, TOOLS, getTool, searchTools, toolSlug, toolIdFromSlug, nextTools } from './tools/registry.js';
import { el, field, textInput, textArea, selectInput, statusBox } from './ui/components.js';
import { downloadBlob, formatBytes, baseName, parseProgress, pushRecent, isPdfName } from './lib/fileUtils.js';
import { UserError } from './types.js';
import type { ToolDef } from './types.js';
import { registerSW } from 'virtual:pwa-register';

const app = document.getElementById('app')!;

// Heavy engines (pdf-lib, pdf.js, office libs) are code-split: the homepage
// shell stays tiny and tools load on demand. Memoized so each chunk loads once.
let actionsPromise: Promise<typeof import('./tools/actions.js')> | null = null;
const loadActions = (): Promise<typeof import('./tools/actions.js')> =>
  (actionsPromise ??= import('./tools/actions.js'));
let renderPromise: Promise<typeof import('./lib/pdfRender.js')> | null = null;
const loadRender = (): Promise<typeof import('./lib/pdfRender.js')> =>
  (renderPromise ??= import('./lib/pdfRender.js'));
// Warm the engine cache when the user shows intent (hover/focus a tool card).
const prefetchEngines = () => {
  loadActions().catch(() => {});
  loadRender().catch(() => {});
};

/** Enterprise guardrail: hard cap per file so a huge PDF can't OOM a tab. */
const MAX_FILE_BYTES = 150 * 1024 * 1024;

// ---------- Cross-route file handoff (file-first flows + tool chaining) ----------
// Files live only in memory and never touch disk/network. Staged by the
// homepage dropzone or a "Continue in …" button, consumed once by the next
// tool page that mounts.

let pendingFiles: File[] | null = null;

function stageFilesForTool(files: File[]): void {
  pendingFiles = files.length > 0 ? [...files] : null;
}

function takeStagedFiles(): File[] {
  const files = pendingFiles ?? [];
  pendingFiles = null;
  return files;
}

// PWA: keep the service worker fresh and surface update/offline state.
const swUpdate = registerSW({
  immediate: true,
  onNeedRefresh() {
    showToast('Update available — reload to get the latest version.', 'Refresh now', () => {
      void swUpdate(true);
    });
  },
  onOfflineReady() {
    showToast('Ready for offline use — you can install this app now.');
  },
});

interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

let deferredInstall: BeforeInstallPromptEvent | null = null;

const INSTALL_DISMISSED_KEY = 'pdfsuite.install-dismissed';
const ENGAGED_KEY = 'pdfsuite.engaged';

/** True when running as an installed app — never promote installation then. */
function isInstalled(): boolean {
  return (
    window.matchMedia('(display-mode: standalone)').matches ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true
  );
}

function installDismissed(): boolean {
  try {
    return localStorage.getItem(INSTALL_DISMISSED_KEY) === '1';
  } catch {
    return false;
  }
}

export function dismissInstall(): void {
  try {
    localStorage.setItem(INSTALL_DISMISSED_KEY, '1');
  } catch {
    /* private mode — banner simply returns next visit */
  }
  document.querySelectorAll<HTMLElement>('.install-banner').forEach((b) => b.remove());
}

/** Repeat-visit behavior: users return to the same 2–3 tools. */
const RECENT_KEY = 'pdfsuite.recent';
const RUNS_KEY = 'pdfsuite.runs';

function getRecentTools(): string[] {
  try {
    const raw = localStorage.getItem(RECENT_KEY);
    const ids = raw ? (JSON.parse(raw) as string[]) : [];
    return ids.filter((id) => getTool(id)).slice(0, 5);
  } catch {
    return [];
  }
}

function recordToolVisit(id: string): void {
  try {
    localStorage.setItem(RECENT_KEY, JSON.stringify(pushRecent(getRecentTools(), id)));
  } catch {
    /* ignore */
  }
}

/** Counts completed runs (post-conversion signal for the install nudge). */
function bumpRuns(): number {
  try {
    const n = Number(localStorage.getItem(RUNS_KEY) ?? 0) + 1;
    localStorage.setItem(RUNS_KEY, String(n));
    return n;
  } catch {
    return 0;
  }
}
/** Engagement signal: only promote installation after value is delivered. */
function markEngaged(): void {
  try {
    localStorage.setItem(ENGAGED_KEY, '1');
  } catch {
    /* ignore */
  }
}

function isEngaged(): boolean {
  try {
    return localStorage.getItem(ENGAGED_KEY) === '1';
  } catch {
    return false;
  }
}

/** Post-conversion nudge (research: ask after value, never on first paint). */
function maybeSuggestInstall(): void {
  if (isInstalled() || installDismissed()) return;
  if (deferredInstall) {
    showToast('Like it? Install PDF Suite for 1-tap offline access.', 'Install', () => {
      void promptInstall();
    });
  } else {
    showToast('Tip: you can install this app — Share → “Add to Home Screen”.');
  }
}

window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  deferredInstall = e as BeforeInstallPromptEvent;
  if (!isInstalled()) {
    document.querySelectorAll<HTMLButtonElement>('.install-btn').forEach((b) => {
      b.hidden = false;
    });
  }
});
window.addEventListener('appinstalled', () => {
  deferredInstall = null;
  document.querySelectorAll<HTMLButtonElement>('.install-btn').forEach((b) => {
    b.hidden = true;
  });
  showToast('Installed — find PDF Suite on your home screen or app list.');
});

async function promptInstall(): Promise<void> {
  if (deferredInstall) {
    await deferredInstall.prompt();
    await deferredInstall.userChoice;
    deferredInstall = null;
    document.querySelectorAll<HTMLButtonElement>('.install-btn').forEach((b) => {
      b.hidden = true;
    });
    return;
  }
  // iOS Safari and other browsers without beforeinstallprompt:
  // guide the user to the manual "Add to Home Screen" flow.
  showToast('To install: open the share menu → “Add to Home Screen” (iOS) or menu → “Install app” (Chrome/Edge).');
}

function showToast(msg: string, actionLabel?: string, onAction?: () => void): void {
  document.querySelector('.toast')?.remove();
  const t = el('div', { class: 'toast', role: 'status' });
  t.append(el('span', {}, msg));
  if (actionLabel && onAction) {
    const btn = el('button', { class: 'btn small primary', type: 'button' }, actionLabel);
    btn.addEventListener('click', () => {
      onAction();
      t.remove();
    });
    t.append(btn);
  }
  const close = el('button', { class: 'btn small', type: 'button', title: 'Dismiss' }, '✕');
  close.addEventListener('click', () => t.remove());
  t.append(close);
  document.body.append(t);
  window.setTimeout(() => t.remove(), 12000);
}

function offlineDot(): HTMLElement {
  // Shown ONLY while offline: when online it added noise and confused the
  // offline story ("it says online — are my files uploading?"). Offline,
  // it becomes live proof the app keeps working.
  const dot = el('span', { class: 'netdot', title: 'You are offline — the app keeps working' });
  const paint = () => {
    const off = !navigator.onLine;
    dot.hidden = !off;
    dot.textContent = '● Offline — app still works';
    dot.dataset['off'] = String(off);
  };
  paint();
  window.addEventListener('online', paint);
  window.addEventListener('offline', paint);
  return dot;
}

// ---------- Theme: system-aware dark mode, user-overridable ----------

type Theme = 'light' | 'dark';
const THEME_KEY = 'pdfsuite.theme';

function systemTheme(): Theme {
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

function currentTheme(): Theme {
  try {
    const stored = localStorage.getItem(THEME_KEY);
    if (stored === 'light' || stored === 'dark') return stored;
  } catch {
    /* ignore */
  }
  return systemTheme();
}

function applyTheme(theme: Theme): void {
  document.documentElement.dataset['theme'] = theme;
  document.querySelectorAll<HTMLButtonElement>('.theme-btn').forEach((b) => {
    b.textContent = theme === 'dark' ? '☀' : '☾';
    b.setAttribute('aria-label', theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode');
    b.title = theme === 'dark' ? 'Light mode' : 'Dark mode';
  });
  try {
    localStorage.setItem(THEME_KEY, theme);
  } catch {
    /* ignore */
  }
}

function toggleTheme(): void {
  applyTheme(currentTheme() === 'dark' ? 'light' : 'dark');
}

applyTheme(currentTheme());
// Follow the OS while the user hasn't chosen explicitly.
try {
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', (e) => {
    try {
      if (!localStorage.getItem(THEME_KEY)) applyTheme(e.matches ? 'dark' : 'light');
    } catch {
      /* ignore */
    }
  });
} catch {
  /* older browsers */
}

// ---------- Command palette: the power-user spine (nouns + verbs, ⌘K) ----------

interface PaletteRow {
  icon: string;
  title: string;
  detail: string;
  kind: string;
  run: () => void;
}

let paletteOpen = false;

/** SPA navigation to a tool (address bar + view stay in sync). */
function goTool(id: string): void {
  history.pushState({}, '', toolHref(id));
  render();
}

function openPalette(): void {
  if (paletteOpen) return;
  paletteOpen = true;
  const overlay = el('div', { class: 'palette-overlay' });
  const box = el('div', { class: 'palette', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Jump to a tool or action' });
  const input = document.createElement('input');
  input.className = 'input palette-input';
  input.placeholder = 'Type a tool or action…  (Esc to close)';
  input.setAttribute('aria-label', 'Search tools and actions');
  input.setAttribute('role', 'combobox');
  input.setAttribute('aria-expanded', 'true');
  input.setAttribute('aria-controls', 'palette-list');
  const list = el('div', { class: 'palette-list', id: 'palette-list', role: 'listbox' });
  const hints = el('div', { class: 'palette-hints' }, '↑↓ navigate · Enter open · Esc close');
  box.append(input, list, hints);
  overlay.append(box);
  document.body.append(overlay);

  const close = () => {
    paletteOpen = false;
    overlay.remove();
  };
  overlay.addEventListener('mousedown', (e) => {
    if (e.target === overlay) close();
  });

  const appActions: PaletteRow[] = [
    { icon: '⌂', title: 'Go to all tools', detail: 'Home', kind: 'Action', run: () => { history.pushState({}, '', '/'); render(); } },
    { icon: '◐', title: 'Toggle dark / light mode', detail: 'Theme', kind: 'Action', run: () => toggleTheme() },
    { icon: '⤓', title: 'Install app', detail: 'PWA', kind: 'Action', run: () => { void promptInstall(); } },
  ];

  let rows: PaletteRow[] = [];
  let active = 0;

  const paintActive = () => {
    [...list.querySelectorAll('.palette-row')].forEach((r, i) => {
      r.classList.toggle('active', i === active);
      r.setAttribute('aria-selected', String(i === active));
    });
  };

  const paint = () => {
    const q = input.value.trim();
    list.innerHTML = '';
    rows = [];
    active = 0;
    const pushRow = (row: PaletteRow) => {
      const idx = rows.length;
      rows.push(row);
      const node = el('button', { class: 'palette-row', role: 'option', type: 'button' });
      node.append(
        el('span', { class: 'palette-icon' }, row.icon),
        el('span', { class: 'palette-title' }, row.title),
        el('span', { class: 'palette-kind' }, `${row.kind} · ${row.detail}`),
      );
      node.addEventListener('click', () => {
        const run = rows[idx].run;
        close();
        run();
      });
      node.addEventListener('mousemove', () => {
        active = idx;
        paintActive();
      });
      list.append(node);
    };

    if (!q) {
      const recent = getRecentTools();
      if (recent.length > 0) {
        list.append(el('div', { class: 'palette-group' }, 'Recent'));
        for (const id of recent) {
          const t = getTool(id);
          if (t) pushRow({ icon: t.icon, title: t.title, detail: t.category, kind: 'Tool', run: () => goTool(t.id) });
        }
      }
      list.append(el('div', { class: 'palette-group' }, 'Actions'));
      appActions.forEach(pushRow);
    } else {
      const tools = searchTools(q, 8);
      const matchedActions = appActions.filter((a) =>
        `${a.title} ${a.detail}`.toLowerCase().includes(q.toLowerCase()),
      );
      if (tools.length > 0) {
        list.append(el('div', { class: 'palette-group' }, 'Tools'));
        for (const t of tools) {
          pushRow({ icon: t.icon, title: t.title, detail: t.category, kind: 'Tool', run: () => goTool(t.id) });
        }
      }
      if (matchedActions.length > 0) {
        list.append(el('div', { class: 'palette-group' }, 'Actions'));
        matchedActions.forEach(pushRow);
      }
      if (rows.length === 0) {
        list.append(el('div', { class: 'palette-empty' }, `No tools match “${q}”. Try “merge”, “sign” or “ppt”.`));
      }
    }
    paintActive();
  };

  input.addEventListener('input', paint);
  input.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      active = Math.min(active + 1, rows.length - 1);
      paintActive();
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      active = Math.max(active - 1, 0);
      paintActive();
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const run = rows[active]?.run;
      if (run) {
        close();
        run();
      }
    } else if (e.key === 'Escape') {
      close();
    }
  });
  paint();
  input.focus();
}

window.addEventListener('keydown', (e) => {
  if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
    e.preventDefault();
    openPalette();
  }
});

// ---------- Routing: real URLs (History API) + legacy hash redirect ----------
// SEO bedrock: every tool lives at a crawlable path (/merge-pdf/) with unique
// prerendered HTML. Legacy #/tool/<id> links redirect to the canonical path.

type Route =
  | { kind: 'home' }
  | { kind: 'tool'; id: string }
  | { kind: 'guides' }
  | { kind: 'guide'; slug: string }
  | { kind: 'missing'; slug: string };

function slugFromPath(pathname: string): string {
  return pathname.replace(/^\/+|\/+$/g, '');
}

function resolveRoute(): Route {
  const hash = location.hash || '';
  if (hash.startsWith('#/tool/')) {
    const id = decodeURIComponent(hash.slice('#/tool/'.length));
    const tool = getTool(id);
    const target = tool ? `/${toolSlug(id)}/` : '/';
    if (target !== location.pathname) location.replace(target + location.search);
    return tool ? { kind: 'tool', id } : { kind: 'home' };
  }
  if (hash && hash !== '#/' && hash !== '#main') {
    history.replaceState({}, '', `${location.pathname}${location.search}`);
  }
  const slug = slugFromPath(location.pathname);
  if (!slug || slug === 'index.html') return { kind: 'home' };
  if (slug === 'guides') return { kind: 'guides' };
  if (slug.startsWith('guides/')) {
    const gslug = slug.slice('guides/'.length);
    if (gslug && !gslug.includes('/')) return { kind: 'guide', slug: gslug };
    return { kind: 'missing', slug };
  }
  const id = toolIdFromSlug(slug);
  return id ? { kind: 'tool', id } : { kind: 'missing', slug };
}

/** Per-route cleanup (replaces scattered hashchange-once listeners). */
let routeCleanups: Array<() => void> = [];
function onRouteLeave(fn: () => void): void {
  routeCleanups.push(fn);
}

function toolHref(id: string): string {
  return `/${toolSlug(id)}/`;
}

function render(): void {
  for (const fn of routeCleanups.splice(0)) {
    try {
      fn();
    } catch {
      /* ignore */
    }
  }
  app.innerHTML = '';
  const skip = el('a', { class: 'skip-link', href: '#main' }, 'Skip to content');
  app.append(skip);
  app.append(header());
  const route = resolveRoute();
  if (route.kind === 'tool') app.append(toolPage(route.id));
  else if (route.kind === 'guides') app.append(guidesIndexPage());
  else if (route.kind === 'guide') app.append(guidePage(route.slug));
  else if (route.kind === 'missing') app.append(notFoundPage(route.slug));
  else app.append(homePage());
  app.append(footer());
  void syncRouteMeta(route);
  // SPA a11y: move focus to the new view so screen readers announce it.
  document.getElementById('main')?.focus({ preventScroll: true });
  window.scrollTo({ top: 0 });
}

/** Keeps tab titles + meta description in sync per route (prerendered HTML
 *  already carries the canonical SEO head for crawlers and first paint). */
async function syncRouteMeta(route: Route): Promise<void> {
  try {
    if (route.kind === 'tool' || route.kind === 'home') {
      const { default: SEO } = await import('./seo/content.json');
      const seo = SEO as unknown as { tools: SeoEntry[]; home: SeoEntry };
      const entry = route.kind === 'tool' ? seo.tools.find((t) => t.id === route.id) : seo.home;
      if (!entry) return;
      document.title = entry.title;
      document.querySelector('meta[name="description"]')?.setAttribute('content', entry.description);
    } else if (route.kind === 'guide' || route.kind === 'guides') {
      const { default: GUIDES } = await import('./seo/guides.json');
      const all = (GUIDES as unknown as { guides: GuideEntry[] }).guides;
      const entry =
        route.kind === 'guide'
          ? all.find((g) => g.slug === route.slug)
          : null;
      if (entry) {
        document.title = entry.title;
        document.querySelector('meta[name="description"]')?.setAttribute('content', entry.description);
      } else if (route.kind === 'guides') {
        document.title = 'Free PDF Guides & Tutorials | PDF Suite';
        document.querySelector('meta[name="description"]')?.setAttribute(
          'content',
          'Step-by-step PDF guides: merge, compress, sign, OCR, convert and more. Free, private, no signup.',
        );
      }
    }
  } catch {
    /* content is progressive enhancement — never break the app */
  }
}

interface SeoEntry {
  id?: string;
  slug: string;
  title: string;
  description: string;
  h1: string;
  intro: string;
  steps?: string[];
  faqs?: [string, string][];
}

interface GuideEntry {
  slug: string;
  title: string;
  description: string;
  h1: string;
  category: string;
  updated: string;
  intro: string[];
  sections: { h2: string; body: string[] }[];
  steps: string[];
  tips: string[];
  faqs: [string, string][];
  relatedTools: string[];
  relatedGuides: string[];
}

async function loadGuides(): Promise<GuideEntry[]> {
  const { default: GUIDES } = await import('./seo/guides.json');
  return (GUIDES as unknown as { guides: GuideEntry[] }).guides;
}

function guideCard(g: GuideEntry): HTMLElement {
  const card = el('a', { class: 'card', href: `/guides/${g.slug}/` });
  card.append(
    el('div', { class: 'card-title' }, g.h1.replace(/ —.*$/, '').slice(0, 60)),
    el('div', { class: 'card-desc' }, g.description),
    el('div', { class: 'card-desc' }, `${g.category} · Updated ${g.updated}`),
  );
  return card;
}

function guidesIndexPage(): HTMLElement {
  const root = el('main', { class: 'wrap tool', id: 'main', tabindex: '-1' });
  root.append(el('nav', { class: 'crumbs', 'aria-label': 'Breadcrumb' },
    el('a', { href: '/' }, 'All tools'),
    el('span', { 'aria-hidden': 'true' }, ' / '),
    el('span', { 'aria-current': 'page' }, 'Guides'),
  ));
  root.append(el('h1', {}, 'Free PDF Guides & Tutorials'));
  root.append(el('p', { class: 'lede' }, 'Step-by-step playbooks for compressing, merging, signing, and converting PDFs — written from the features above, tested against the live tools.'));
  const grid = el('div', { class: 'grid' });
  grid.append(el('p', { class: 'muted' }, 'Loading guides…'));
  root.append(grid);
  void (async () => {
    try {
      const guides = await loadGuides();
      grid.innerHTML = '';
      for (const g of guides) grid.append(guideCard(g));
    } catch {
      grid.innerHTML = '';
      grid.append(el('p', { class: 'muted' }, 'Could not load guides. Check your connection and retry.'));
    }
  })();
  root.append(footerNote());
  return root;
}

function footerNote(): HTMLElement {
  return el('p', {}, 'Or start from ', el('a', { href: '/' }, 'all tools'), '.');
}

function guidePage(slug: string): HTMLElement {
  const root = el('main', { class: 'wrap tool', id: 'main', tabindex: '-1' });
  root.append(el('p', { class: 'muted' }, 'Loading guide…'));
  void (async () => {
    try {
      const guides = await loadGuides();
      const g = guides.find((x) => x.slug === slug);
      root.innerHTML = '';
      if (!g) {
        root.append(el('h1', {}, 'Guide not found'));
        root.append(el('p', {}, 'That tutorial does not exist. Browse ', el('a', { href: '/guides/' }, 'all PDF guides'), '.'));
        return;
      }
      root.append(el('nav', { class: 'crumbs', 'aria-label': 'Breadcrumb' },
        el('a', { href: '/' }, 'All tools'),
        el('span', { 'aria-hidden': 'true' }, ' / '),
        el('a', { href: '/guides/' }, 'Guides'),
        el('span', { 'aria-hidden': 'true' }, ' / '),
        el('span', { 'aria-current': 'page' }, g.category),
      ));
      root.append(el('h1', {}, g.h1));
      root.append(el('p', { class: 'muted' }, `${g.category} · Updated ${g.updated} · Free forever`));
      for (const para of g.intro) root.append(el('p', {}, para));
      // Jump links: the tool itself first (intent → action in one screen).
      const cta = el('div', { class: 'row' });
      for (const id of g.relatedTools.slice(0, 2)) {
        const t = getTool(id);
        if (t) {
          const b = el('a', { class: 'btn primary', href: toolHref(id) }, `${t.icon} Open ${t.title}`);
          (b as HTMLAnchorElement).style.textDecoration = 'none';
          cta.append(b);
        }
      }
      root.append(cta);
      const toc = el('div', { class: 'related' });
      toc.append(el('span', { class: 'muted' }, 'On this page: '));
      g.sections.forEach((s, i) => {
        toc.append(el('a', { class: 'chip', href: `#section-${i}` }, s.h2));
      });
      root.append(toc);
      g.sections.forEach((s, i) => {
        const h = el('h2', { id: `section-${i}` }, s.h2);
        root.append(h);
        for (const para of s.body) root.append(el('p', {}, para));
      });
      const how = el('section', { class: 'faq' });
      how.append(el('h2', {}, 'Steps'));
      const ol = el('ol', { class: 'howto' });
      for (const step of g.steps) ol.append(el('li', {}, step));
      how.append(ol);
      if (g.tips.length > 0) {
        how.append(el('h2', {}, 'Pro tips'));
        const ul = el('ul', {});
        for (const tip of g.tips) ul.append(el('li', {}, tip));
        how.append(ul);
      }
      how.append(el('h2', {}, 'Frequently asked questions'));
      for (const [q, a] of g.faqs) {
        const d = el('details', {});
        d.append(el('summary', {}, q), el('p', {}, a));
        how.append(d);
      }
      root.append(how);
      const rel = el('div', { class: 'related' });
      rel.append(el('span', { class: 'muted' }, 'Try it now: '));
      for (const id of g.relatedTools) {
        const t = getTool(id);
        if (t) rel.append(el('a', { class: 'chip', href: toolHref(id) }, `${t.icon} ${t.title}`));
      }
      root.append(rel);
      const more = el('div', { class: 'related' });
      more.append(el('span', { class: 'muted' }, 'Keep reading: '));
      for (const gs of g.relatedGuides) {
        const rg = guides.find((x) => x.slug === gs);
        if (rg) more.append(el('a', { class: 'chip', href: `/guides/${rg.slug}/` }, rg.h1.replace(/ —.*$/, '').slice(0, 42)));
      }
      root.append(more);
      root.append(footerNote());
    } catch {
      root.innerHTML = '';
      root.append(el('p', { class: 'muted' }, 'Could not load this guide. Check your connection and retry.'));
    }
  })();
  return root;
}

function notFoundPage(slug: string): HTMLElement {
  const root = el('main', { class: 'wrap tool', id: 'main', tabindex: '-1' });
  root.append(el('h1', {}, 'Page not found'));
  root.append(el('p', { class: 'lede' }, `There's no tool at “/${slug}/”. Try one of these instead:`));
  const grid = el('div', { class: 'grid' });
  const guesses = searchTools(slug.replace(/-/g, ' '), 6);
  for (const t of (guesses.length > 0 ? guesses : TOOLS.slice(0, 6))) {
    const card = el('a', { class: 'card', href: toolHref(t.id) });
    card.setAttribute('data-cat', t.category);
    card.append(
      el('div', { class: 'card-icon' }, t.icon),
      el('div', { class: 'card-title' }, t.title),
      el('div', { class: 'card-desc' }, t.description),
    );
    grid.append(card);
  }
  root.append(grid);
  root.append(el('p', {}, 'Or start from ', el('a', { href: '/' }, 'all tools'), '.'));
  return root;
}

// Intercept same-origin app links for instant client-side navigation.
// Crawlers and no-JS users still see (and follow) real hrefs — best of both.
document.addEventListener('click', (e) => {
  if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return;
  const anchor = (e.target as HTMLElement | null)?.closest?.('a[href^="/"]') as HTMLAnchorElement | null;
  if (!anchor) return;
  let url: URL;
  try {
    url = new URL(anchor.getAttribute('href')!, location.origin);
  } catch {
    return;
  }
  if (url.origin !== location.origin) return;
  const slug = slugFromPath(url.pathname);
  const known =
    slug === '' ||
    slug === 'index.html' ||
    slug === 'guides' ||
    slug.startsWith('guides/') ||
    !!toolIdFromSlug(slug);
  // Unknown paths (docs, assets) get normal browser navigation.
  if (!known) return;
  e.preventDefault();
  if (url.pathname !== location.pathname) history.pushState({}, '', url.pathname);
  render();
});
window.addEventListener('popstate', render);
render();

// ---------- Header / footer / home ----------

function header(): HTMLElement {
  const h = el('header', { class: 'topbar' });
  const inner = el('div', { class: 'wrap topbar-inner' });
  const logo = el('a', { class: 'logo', href: '/' });
  logo.append(el('span', { class: 'logo-mark' }, 'PDF'), el('span', {}, 'PDF Suite'));
  const nav = el('nav', { class: 'topnav' });
  const paletteBtn = el('button', { class: 'btn small palette-btn', type: 'button', title: 'Jump to any tool (Ctrl/⌘ K)' }, '🔍 Tools');
  const kbd = el('kbd', { class: 'kbd' }, '⌘K');
  paletteBtn.append(kbd);
  paletteBtn.setAttribute('aria-label', 'Open command palette (Control or Command K)');
  paletteBtn.addEventListener('click', openPalette);
  const themeBtn = el('button', { class: 'btn small theme-btn', type: 'button' }, currentTheme() === 'dark' ? '☀' : '☾');
  themeBtn.setAttribute('aria-label', 'Toggle dark mode');
  themeBtn.title = 'Toggle dark mode';
  themeBtn.addEventListener('click', toggleTheme);
  const installBtn = el('button', { class: 'btn small install-btn', type: 'button' }, '⤓ Install');
  installBtn.hidden = !deferredInstall || isInstalled();
  installBtn.addEventListener('click', () => {
    void promptInstall();
  });
  nav.append(
    el('a', { href: '/' }, 'All tools'),
    el('a', { href: toolHref('merge') }, 'Merge'),
    el('a', { href: toolHref('compress') }, 'Compress'),
    el('a', { href: '/guides/' }, 'Guides'),
    paletteBtn,
    themeBtn,
    installBtn,
    offlineDot(),
  );
  inner.append(logo, nav);
  h.append(inner);
  return h;
}

let cachedVersion: string | null = null;
async function appVersion(): Promise<string> {
  if (cachedVersion) return cachedVersion;
  try {
    const res = await fetch('/version.json', { cache: 'no-store' });
    if (!res.ok) throw new Error('no version file');
    const data = (await res.json()) as { version?: string; commit?: string };
    cachedVersion = `v${data.version ?? '?'} (${data.commit ?? 'dev'})`;
  } catch {
    cachedVersion = 'dev build';
  }
  return cachedVersion;
}

function footer(): HTMLElement {
  const f = el('footer', { class: 'footer' });
  const ver = el('span', { class: 'muted' }, '…');
  void appVersion().then((v) => {
    ver.textContent = v;
  });
  const cols = el('div', { class: 'foot-cols' });
  const guidesCol = el('div', { class: 'foot-col' });
  guidesCol.append(el('strong', {}, 'Guides'));
  guidesCol.append(el('a', { href: '/guides/' }, 'All PDF guides'));
  const guideLinks: [string, string][] = [
    ['how-to-merge-pdfs-free', 'Merge PDFs'],
    ['how-to-compress-pdf-under-1mb', 'Compress under 1 MB'],
    ['how-to-sign-pdf-free', 'Sign a PDF'],
    ['free-pdf-tools-compared', 'Tools compared'],
  ];
  for (const [slug, label] of guideLinks) {
    guidesCol.append(el('a', { href: `/guides/${slug}/` }, label));
  }
  cols.append(guidesCol);
  for (const cat of CATEGORIES) {
    const col = el('div', { class: 'foot-col' });
    col.append(el('strong', {}, cat));
    for (const t of TOOLS.filter((x) => x.category === cat)) {
      col.append(el('a', { href: toolHref(t.id) }, t.title));
    }
    cols.append(col);
  }
  f.append(
    el('div', { class: 'wrap' },
      cols,
      el('div', { class: 'foot-bottom' },
        el('p', { class: 'promise' }, 'No accounts. No ads. No uploads. No watermarks. Just tools that work. ', ver),
        el('p', { class: 'muted' }, 'Built with pdf-lib + pdf.js. Install it and use it offline — even in airplane mode.'),
      ),
    ),
  );
  return f;
}

function homePage(): HTMLElement {
  const root = el('main', { class: 'wrap', id: 'main', tabindex: '-1' });

  const hero = el('section', { class: 'hero' });
  const h1 = el('h1', {});
  h1.append('Every PDF tool you need. ', el('span', { class: 'grad' }, 'Private by design.'));
  hero.append(
    el('div', { class: 'hero-eyebrow' }, '✦ 36 free tools · no signup · no watermark'),
    h1,
    el('p', { class: 'lede' }, 'Merge, sign, compress, convert and secure documents — entirely in your browser. Nothing uploads, nothing is tracked, and it installs for offline use.'),
  );
  // One search surface only (header palette) — no duplicate hero search box.
  // The palette shortcut is taught once, right here.
  hero.append(el('p', { class: 'muted' }, 'Tip: press / anywhere to jump to any tool instantly.'));

  // File-first entry (pdfguru pattern, done smarter): drop a file, then pick
  // what to do with it. The staged files ride along to whichever tool wins.
  const stageZone = el('div', {
    class: 'stage',
    tabindex: '0',
    role: 'button',
    'aria-label': 'Drop a PDF or image here to start, then choose a tool',
  });
  const stageInput = document.createElement('input');
  stageInput.type = 'file';
  stageInput.accept = 'application/pdf,.pdf,image/*,.jpg,.jpeg,.png,.webp';
  stageInput.multiple = true;
  stageInput.hidden = true;
  stageZone.append(
    el('span', { class: 'stage-icon', 'aria-hidden': 'true' }, '⤓'),
    el('span', {},
      el('strong', {}, 'Drop a PDF here to start'),
      el('span', { class: 'muted' }, ' — then pick what to do with it. Max 150 MB per file.'),
    ),
  );
  stageZone.append(stageInput);
  const stageCard = el('div', { class: 'stage-card', hidden: '' });
  hero.append(stageZone, stageCard);

  const QUICK_ACTIONS = ['merge', 'compress', 'split', 'sign', 'encrypt', 'pdf-to-word'];
  const offerTools = (files: File[]) => {
    const names = files.map((f) => f.name).join(', ');
    stageCard.innerHTML = '';
    stageCard.removeAttribute('hidden');
    stageCard.append(el('strong', {}, `${files.length} file${files.length > 1 ? 's' : ''} staged: `));
    stageCard.append(el('span', { class: 'muted' }, names.length > 90 ? `${names.slice(0, 90)}…` : names));
    const row = el('div', { class: 'row' });
    row.append(el('span', { class: 'muted' }, 'Do what?'));
    for (const id of QUICK_ACTIONS) {
      const t = getTool(id)!;
      const b = el('button', { class: 'btn small', type: 'button' }, `${t.icon} ${t.title}`);
      b.addEventListener('click', () => {
        stageFilesForTool(files);
        goTool(id);
      });
      row.append(b);
    }
    const all = el('button', { class: 'btn small', type: 'button' }, 'All 36 tools ↓');
    all.addEventListener('click', () => {
      stageFilesForTool(files);
      document.getElementById('tool-grid')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
    row.append(all);
    const clear = el('button', { class: 'btn small danger', type: 'button' }, 'Clear');
    clear.addEventListener('click', () => {
      stageCard.innerHTML = '';
      stageCard.setAttribute('hidden', '');
    });
    row.append(clear);
    stageCard.append(row);
    stageCard.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  };
  const takeStaged = (list: FileList | null | undefined) => {
    if (!list || list.length === 0) return;
    const files = [...list].filter((f) => {
      if (f.size > MAX_FILE_BYTES) {
        showToast(`"${f.name}" exceeds the ${formatBytes(MAX_FILE_BYTES)} limit and was skipped.`);
        return false;
      }
      return true;
    });
    if (files.length > 0) offerTools(files);
  };
  stageZone.addEventListener('click', () => stageInput.click());
  stageZone.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') stageZone.click();
  });
  stageZone.addEventListener('dragover', (e) => {
    e.preventDefault();
    stageZone.classList.add('over');
  });
  stageZone.addEventListener('dragleave', () => stageZone.classList.remove('over'));
  stageZone.addEventListener('drop', (e) => {
    e.preventDefault();
    stageZone.classList.remove('over');
    takeStaged(e.dataTransfer?.files);
  });
  stageInput.addEventListener('change', () => {
    takeStaged(stageInput.files);
    stageInput.value = '';
  });

  // Persona-driven entry points: users think in jobs, not tool names.
  // Rendered AFTER Recently used: returners get their tools first,
  // first-timers get guided discovery. Both stay one scroll away.
  const jobs: { icon: string; job: string; why: string; tool: string }[] = [
    { icon: '📝', job: 'Sign a contract', why: 'Draw or type your signature', tool: 'sign' },
    { icon: '🎓', job: 'Hit a portal file-size limit', why: 'Shrink to an exact MB target', tool: 'compress' },
    { icon: '📚', job: 'Assemble a report', why: 'Cherry-pick pages from many files', tool: 'merge' },
    { icon: '📊', job: 'Mine data from a PDF', why: 'Tables out to Excel in seconds', tool: 'pdf-to-excel' },
    { icon: '🔒', job: 'Share sensitive docs safely', why: 'Password + redact + strip metadata', tool: 'encrypt' },
    { icon: '🖨', job: 'Print without wasting ink', why: 'Grayscale in one click', tool: 'invert' },
  ];
  const jobStrip = el('div', { class: 'jobs' });
  for (const j of jobs) {
    const t = getTool(j.tool)!;
    const card = el('a', { class: 'job', href: toolHref(t.id) });
    card.setAttribute('data-cat', t.category);
    card.addEventListener('pointerenter', prefetchEngines, { once: true });
    card.addEventListener('focus', prefetchEngines, { once: true });
    card.append(
      el('span', { class: 'job-icon' }, j.icon),
      el('span', { class: 'job-text' }, el('strong', {}, j.job), el('small', {}, j.why)),
      el('span', { class: 'job-go' }, '→'),
    );
    jobStrip.append(card);
  }
  // Install banner only after engagement (never on first paint), dismissible,
  // and never inside the installed app. Header button covers the rest.
  if (isEngaged() && !installDismissed() && !isInstalled()) {
    const installBanner = el('div', { class: 'install-banner' });
    installBanner.append(
      el('span', {}, '📲 Install PDF Suite for offline use — works like a native app, no app store needed.'),
    );
    const installCta = el('button', { class: 'btn primary small', type: 'button' }, 'Install app');
    installCta.addEventListener('click', () => {
      void promptInstall();
    });
    const noThanks = el('button', { class: 'btn small', type: 'button' }, 'Not now');
    noThanks.addEventListener('click', dismissInstall);
    installBanner.append(el('div', { class: 'row' }, installCta, noThanks));
    hero.append(installBanner);
  }
  root.append(hero);

  // Returning users first: their own tools above everything else.
  const recent = getRecentTools();
  if (recent.length > 0) {
    const section = el('section', { class: 'cat recent' });
    section.append(el('h2', {}, 'Recently used'));
    const grid = el('div', { class: 'grid' });
    for (const id of recent) {
      const t = getTool(id)!;
      const card = el('a', { class: 'card', href: toolHref(t.id) });
      card.setAttribute('data-cat', t.category);
      card.addEventListener('pointerenter', prefetchEngines, { once: true });
      card.addEventListener('focus', prefetchEngines, { once: true });
      card.append(
        el('div', { class: 'card-icon' }, t.icon),
        el('div', { class: 'card-title' }, t.title),
        el('div', { class: 'card-desc' }, t.description),
      );
      grid.append(card);
    }
    section.append(grid);
    root.append(section);
  }

  // Guided discovery second: jobs route intent → tool for everyone else.
  const jobsSection = el('section', { class: 'cat' });
  jobsSection.append(el('h2', {}, 'What do you need to do?'));
  jobsSection.append(jobStrip);
  root.append(jobsSection);

  const gridRoot = el('div', { id: 'tool-grid' });

  // Category pills: 36 tools need scoping, not just search.
  let activeCat = 'All';
  const pills = el('div', { class: 'pills', role: 'tablist', 'aria-label': 'Filter by category' });
  const paintPills = () => {
    pills.innerHTML = '';
    for (const cat of ['All', ...CATEGORIES]) {
      const count = cat === 'All' ? TOOLS.length : TOOLS.filter((t) => t.category === cat).length;
      const b = el('button', { class: 'pillbtn', type: 'button', role: 'tab' }, `${cat} · ${count}`);
      b.setAttribute('aria-selected', String(cat === activeCat));
      if (cat === activeCat) b.classList.add('on');
      b.addEventListener('click', () => {
        activeCat = cat;
        paintPills();
        renderGrid();
      });
      pills.append(b);
    }
  };
  paintPills();
  root.append(pills);
  root.append(gridRoot);

  const renderGrid = () => {
    gridRoot.innerHTML = '';
    for (const cat of CATEGORIES) {
      if (activeCat !== 'All' && cat !== activeCat) continue;
      const tools = TOOLS.filter((t) => t.category === cat);
      if (tools.length === 0) continue;
      const section = el('section', { class: 'cat' });
      section.append(el('h2', {}, `${cat} · ${tools.length}`));
      const grid = el('div', { class: 'grid' });
      for (const t of tools) {
        const card = el('a', { class: 'card', href: toolHref(t.id) });
        card.setAttribute('data-cat', t.category);
        // Prefetch the engine chunks on intent so the tool page feels instant.
        card.addEventListener('pointerenter', prefetchEngines, { once: true });
        card.addEventListener('focus', prefetchEngines, { once: true });
        card.append(
          el('div', { class: 'card-icon' }, t.icon),
          el('div', { class: 'card-title' }, t.title),
          el('div', { class: 'card-desc' }, t.description),
        );
        grid.append(card);
      }
      section.append(grid);
      gridRoot.append(section);
    }
  };
  renderGrid();

  // Press "/" anywhere to summon the palette (the one search surface).
  const onKey = (e: KeyboardEvent) => {
    const target = e.target as HTMLElement | null;
    const typing = target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable);
    if (e.key === '/' && !typing) {
      e.preventDefault();
      openPalette();
    }
  };
  window.addEventListener('keydown', onKey);
  onRouteLeave(() => window.removeEventListener('keydown', onKey));

  // Proof, not promises: one honest comparison table, same data as the
  // prerendered homepage (single-sourced from content.json).
  const trustMount = el('div', {});
  root.append(trustMount);
  void (async () => {
    try {
      const { default: SEO } = await import('./seo/content.json');
      const points = (SEO as unknown as { home: { points: [string, string, string][] } }).home.points;
      if (!points?.length) return;
      const section = el('section', { class: 'trust' });
      section.append(el('h2', {}, 'Why PDF Suite instead of typical online tools'));
      section.append(el('p', { class: 'muted' }, 'No accounts to leak, no servers to breach, no counters to hit — the difference is architectural, not promotional.'));
      const table = document.createElement('table');
      const thead = document.createElement('thead');
      const headRow = document.createElement('tr');
      for (const h of ['', 'Typical online tools', 'PDF Suite']) {
        const th = document.createElement('th');
        th.textContent = h;
        headRow.append(th);
      }
      thead.append(headRow);
      const tbody = document.createElement('tbody');
      for (const [label, typical, ours] of points) {
        const tr = document.createElement('tr');
        const tdL = document.createElement('td');
        tdL.textContent = label;
        const tdT = document.createElement('td');
        tdT.textContent = typical;
        tdT.className = 'no';
        const tdO = document.createElement('td');
        tdO.textContent = ours;
        tdO.className = 'yes';
        tr.append(tdL, tdT, tdO);
        tbody.append(tr);
      }
      table.append(thead, tbody);
      section.append(table);
      trustMount.append(section);
    } catch {
      /* enhancement only */
    }
  })();

  // Guides strip: content velocity made discoverable (and interlinked).
  const guidesMount = el('div', {});
  root.append(guidesMount);
  void (async () => {
    try {
      const guides = await loadGuides();
      const picks = [
        'how-to-merge-pdfs-free',
        'how-to-compress-pdf-under-1mb',
        'how-to-sign-pdf-free',
        'free-pdf-tools-compared',
        'compress-pdf-for-job-application',
        'how-to-ocr-pdf-free',
      ];
      const section = el('section', { class: 'cat' });
      section.append(el('h2', {}, 'Learn · PDF guides'));
      const grid = el('div', { class: 'grid' });
      for (const slug of picks) {
        const g = guides.find((x) => x.slug === slug);
        if (g) grid.append(guideCard(g));
      }
      section.append(grid);
      const more = el('p', {});
      more.append(el('a', { href: '/guides/' }, 'Browse all PDF guides →'));
      section.append(more);
      guidesMount.append(section);
    } catch {
      /* enhancement only */
    }
  })();

  const faq = el('section', { class: 'faq' });
  faq.append(el('h2', {}, 'How it works'));
  const items: [string, string][] = [
    ['Are my files uploaded anywhere?', 'No. Every tool runs with JavaScript in your tab. Prove it: load any tool, then turn on airplane mode — everything still works.'],
    ['Is there a watermark or limit?', 'No watermark, no account, no daily cap. Practical limit is your device memory (~100–150 MB PDFs on desktop).'],
    ['Which tools are included?', 'Merge, split, compress, images↔PDF, rotate, organize, watermark, page numbers, headers, redact, extract text, OCR, protect/unlock, flatten, privacy scan, PDF↔Word, PDF↔Excel, PDF→HTML, invert, create/Markdown/HTML→PDF, compare, repair, camera scan.'],
    ['Password-protected PDFs?', 'Unlock first with Security → Unlock PDF, then use any other tool, then re-protect if needed.'],
  ];
  for (const [q, a] of items) {
    const d = el('details', {});
    d.append(el('summary', {}, q), el('p', {}, a));
    faq.append(d);
  }
  root.append(faq);
  return root;
}

// ---------- Generic tool page ----------

interface FileState {
  files: File[];
}

function toolPage(id: string): HTMLElement {
  const tool = getTool(id);
  const root = el('main', { class: 'wrap tool', id: 'main', tabindex: '-1' });
  if (!tool) {
    root.append(el('h1', {}, 'Tool not found'), el('p', {}, 'Go back to '), el('a', { href: '/' }, 'all tools.'));
    return root;
  }
  const current: ToolDef = tool;
  recordToolVisit(current.id);
  // Warm the engine chunks as soon as a tool page opens — Run then feels instant.
  void loadActions().catch(() => {});

  root.append(el('nav', { class: 'crumbs', 'aria-label': 'Breadcrumb' },
    el('a', { href: '/' }, 'All tools'),
    el('span', { 'aria-hidden': 'true' }, ' / '),
    el('span', {}, current.category),
    el('span', { 'aria-hidden': 'true' }, ' / '),
    el('span', { 'aria-current': 'page' }, current.title),
  ));
  const head = el('div', { class: 'tool-head' });
  const tile = el('div', { class: 'tool-icon-tile', 'aria-hidden': 'true' }, current.icon);
  tile.setAttribute('data-cat', current.category);
  head.append(tile, el('h1', {}, current.title));
  root.append(head);
  root.append(el('p', { class: 'lede' }, current.description));

  // iLovePDF-style 3-step flow: Upload → Adjust → Download.
  const steps = el('ol', { class: 'steps' });
  const stepEls = [el('li', {}, '1 · Upload'), el('li', {}, '2 · Adjust'), el('li', {}, '3 · Download')];
  steps.append(...stepEls);
  const paintSteps = (stage: 1 | 2 | 3) => {
    stepEls.forEach((s, i) => {
      s.classList.toggle('done', i + 1 < stage);
      s.classList.toggle('now', i + 1 === stage);
    });
  };
  paintSteps(1);
  root.append(steps);

  const state: FileState = { files: [] };
  const { box: status, set: setStatus } = statusBox();

  // Merge: per-file page ranges ("1-3, 5", blank = whole file), kept in sync
  // with the file list order. Surfaced to actions via [data-opt-key].
  const mergeRanges: string[] = [];
  const mergeAnchor = el('div', {});
  mergeAnchor.setAttribute('data-opt-key', 'mergeRanges');
  mergeAnchor.setAttribute('data-opt-value', '[]');
  if (current.id === 'merge') root.append(mergeAnchor);
  const syncMergeRanges = () => {
    while (mergeRanges.length < state.files.length) mergeRanges.push('');
    mergeRanges.length = state.files.length;
    mergeAnchor.setAttribute('data-opt-value', JSON.stringify(mergeRanges));
  };

  // Dropzone
  const drop = el('div', { class: 'drop', tabindex: '0', role: 'button' });
  drop.setAttribute('aria-label', current.accept ? `Upload files for ${current.title}` : `${current.title}: file upload optional`);
  const formats = el('div', { class: 'drop-formats' });
  if (current.accept) {
    for (const part of current.accept.split(',').slice(0, 5)) {
      const clean = part.trim().replace('application/', '').replace('image/*', 'images').replace(/^\./, '').toUpperCase();
      if (clean) formats.append(el('span', {}, clean));
    }
  }
  drop.append(
    el('div', { class: 'drop-icon', 'aria-hidden': 'true' }, '📄'),
    el('div', { class: 'drop-title' }, current.accept ? 'Drop files here or click to browse' : 'No file needed — or optionally drop one'),
    el('div', { class: 'muted' }, current.multiple ? 'You can add several files — batch supported where noted.' : 'One file at a time for this tool.'),
    el('div', { class: 'muted' }, `Max ${formatBytes(MAX_FILE_BYTES)} per file · Files never leave this browser.`),
    formats,
  );
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = current.accept;
  input.multiple = current.multiple;
  input.hidden = true;
  drop.append(input);
  const pick = () => input.click();
  drop.addEventListener('click', pick);
  drop.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') pick();
  });
  for (const ev of ['dragover', 'dragenter']) {
    drop.addEventListener(ev, (e) => {
      e.preventDefault();
      drop.classList.add('over');
    });
  }
  for (const ev of ['dragleave', 'drop']) {
    drop.addEventListener(ev, (e) => {
      e.preventDefault();
      drop.classList.remove('over');
    });
  }
  drop.addEventListener('drop', (e) => {
    const list = (e as DragEvent).dataTransfer?.files;
    if (list) addFiles([...list]);
  });
  input.addEventListener('change', () => {
    addFiles([...input.files!]);
    input.value = '';
  });

  const listBox = el('div', { class: 'filelist' });
  function addFiles(next: File[]) {
    const accepted: File[] = [];
    for (const f of next) {
      if (f.size > MAX_FILE_BYTES) {
        setStatus(
          `"${f.name}" is ${formatBytes(f.size)} — over the ${formatBytes(MAX_FILE_BYTES)} per-file limit. Split it first or use a desktop tool.`,
          'error',
        );
        continue;
      }
      accepted.push(f);
    }
    if (accepted.length === 0) return;
    if (!current.multiple) state.files = [accepted[0]];
    else state.files.push(...accepted);
    paintFiles();
    paintSteps(2);
    onFilesChanged();
  }
  function paintFiles() {
    listBox.innerHTML = '';
    if (state.files.length === 0) {
      const empty = el('div', { class: 'empty-panel' });
      empty.append(
        el('span', { class: 'big', 'aria-hidden': 'true' }, '🗂'),
        el('span', {}, 'No files yet — drop them anywhere on this page, or use the box above.'),
      );
      listBox.append(empty);
      paintRunState();
      return;
    }
    state.files.forEach((f, i) => {
      const row = el('div', { class: 'filerow' });
      const nameSpan = el('span', { class: 'fname' }, `${i + 1}. ${f.name} (${formatBytes(f.size)})`);
      row.append(nameSpan);
      if (current.id === 'merge') {
        const range = document.createElement('input');
        range.type = 'text';
        range.className = 'input range-inline';
        const isPdf = isPdfName(f.name, f.type);
        range.placeholder = isPdf ? 'All pages (e.g. 1-3, 5)' : 'Whole file (ranges need PDF)';
        range.value = mergeRanges[i] ?? '';
        range.disabled = !isPdf;
        if (!isPdf) range.title = 'Page ranges apply to PDFs only — images and documents merge whole.';
        range.setAttribute('aria-label', `Pages to take from ${f.name}`);
        range.addEventListener('input', () => {
          mergeRanges[i] = range.value;
          syncMergeRanges();
        });
        row.append(range);
      }
      const btns = el('span', { class: 'frow-btns' });
      if (current.multiple && state.files.length > 1) {
        const up = el('button', { class: 'btn small', type: 'button' }, '↑');
        up.setAttribute('aria-label', `Move ${f.name} up`);
        up.addEventListener('click', () => {
          if (i === 0) return;
          [state.files[i - 1], state.files[i]] = [state.files[i], state.files[i - 1]];
          [mergeRanges[i - 1], mergeRanges[i]] = [mergeRanges[i], mergeRanges[i - 1]];
          syncMergeRanges();
          paintFiles();
          onFilesChanged();
        });
        const down = el('button', { class: 'btn small', type: 'button' }, '↓');
        down.setAttribute('aria-label', `Move ${f.name} down`);
        down.addEventListener('click', () => {
          if (i === state.files.length - 1) return;
          [state.files[i + 1], state.files[i]] = [state.files[i], state.files[i + 1]];
          [mergeRanges[i + 1], mergeRanges[i]] = [mergeRanges[i], mergeRanges[i + 1]];
          syncMergeRanges();
          paintFiles();
          onFilesChanged();
        });
        btns.append(up, down);
      }
      const rm = el('button', { class: 'btn small danger', type: 'button' }, 'Remove');
      rm.addEventListener('click', () => {
        state.files.splice(i, 1);
        mergeRanges.splice(i, 1);
        syncMergeRanges();
        paintFiles();
        onFilesChanged();
      });
      btns.append(rm);
      row.append(btns);
      listBox.append(row);
    });
    syncMergeRanges();
    paintRunState();
    void annotatePageCounts();
  }

  // Intuitiveness: show "· N pages" on PDF rows so range inputs are guess-free.
  // Best-effort and async — never blocks the UI or fails the flow.
  let countToken = 0;
  async function annotatePageCounts(): Promise<void> {
    if (!current.accept.includes('pdf') || state.files.length === 0) return;
    const token = ++countToken;
    const snapshot = [...state.files];
    let render: typeof import('./lib/pdfRender.js') | null = null;
    try {
      render = await loadRender();
    } catch {
      return;
    }
    if (token !== countToken) return;
    const rows = [...listBox.querySelectorAll('.filerow .fname')];
    for (let i = 0; i < snapshot.length; i++) {
      if (token !== countToken || state.files[i] !== snapshot[i]) return;
      const f = snapshot[i];
      if (!/\.pdf$/i.test(f.name) && f.type !== 'application/pdf') continue;
      try {
        const n = await render.getPageCount(await f.arrayBuffer());
        if (token !== countToken || state.files[i] !== snapshot[i]) return;
        const span = rows[i] as HTMLElement | undefined;
        if (span && !span.dataset['counted']) {
          span.dataset['counted'] = '1';
          span.textContent = `${span.textContent} · ${n} page${n === 1 ? '' : 's'}`;
        }
      } catch {
        /* locked or unreadable here — the tool itself will explain on Run */
      }
    }
  }

  // Options per tool
  const optsBox = el('div', { class: 'opts' });
  const getOpts = buildOptions(current.id, optsBox, state, setStatus);

  // Special live areas
  const live = el('div', { class: 'live' });
  function onFilesChanged(): void {
    live.innerHTML = '';
    if (state.files.length === 0) return;
    if (current.id === 'organize') mountOrganize(live, state, setStatus);
    else if (current.id === 'compare') mountCompare(live, state, setStatus);
    else if (current.id === 'redact') mountRedact(live, state, setStatus);
    else if (current.id === 'sign') mountSign(live, setStatus);
    else if (current.id === 'annotate') mountAnnotate(live, setStatus);
    else if (current.id === 'fill-forms') mountFormFill(live, state, setStatus);
    else if (current.id === 'watermark') mountWatermarkPicker(live, setStatus);
  }

  if (current.id === 'scan') mountScanner(live, state, paintFiles, setStatus);

  const runBtn = el('button', { class: 'btn primary big', type: 'button' }, `Run — ${current.title}`);
  const startOver = el('button', { class: 'btn', type: 'button' }, 'Start over');
  startOver.addEventListener('click', () => render());
  const results = el('div', { class: 'results' });
  const actionBar = el('div', { class: 'row actionbar' }, runBtn, startOver);

  /** Tools that can run from typed/pasted content need no upload. */
  const needsUpload = !['create', 'markdown', 'html-to-pdf'].includes(current.id);
  const paintRunState = () => {
    if (!needsUpload || state.files.length > 0) runBtn.removeAttribute('disabled');
    else runBtn.setAttribute('disabled', 'true');
  };

  const reducedMotion = () =>
    window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const scrollToResults = () => {
    const first = results.querySelector('.result, .result-stats') as HTMLElement | null;
    first?.scrollIntoView({ behavior: reducedMotion() ? 'auto' : 'smooth', block: 'start' });
  };

  // Behavioral UX: determinate progress (percent-done) + elapsed time.
  // Research: dynamic feedback makes waits feel shorter and triples patience.
  const progressWrap = el('div', { class: 'progress', hidden: '' });
  const progressTrack = el('div', { class: 'progress-track' });
  progressTrack.setAttribute('role', 'progressbar');
  progressTrack.setAttribute('aria-label', 'Processing progress');
  progressTrack.setAttribute('aria-valuemin', '0');
  progressTrack.setAttribute('aria-valuemax', '100');
  const progressFill = el('div', { class: 'progress-fill indet' });
  progressTrack.append(progressFill);
  const progressLabel = el('span', { class: 'progress-label' }, '');
  progressWrap.append(progressTrack, progressLabel);
  let runStarted = 0;
  let lastProgressMsg = '';
  let progressTimer: number | null = null;
  const paintElapsed = () => {
    const s = Math.max(0, Math.floor((Date.now() - runStarted) / 1000));
    progressLabel.textContent = s > 1 ? `${lastProgressMsg} · ${s}s` : lastProgressMsg;
  };
  const progressStart = () => {
    runStarted = Date.now();
    lastProgressMsg = 'Starting…';
    progressWrap.hidden = false;
    progressFill.className = 'progress-fill indet';
    progressTrack.setAttribute('aria-valuenow', '0');
    paintElapsed();
    if (progressTimer !== null) window.clearInterval(progressTimer);
    progressTimer = window.setInterval(paintElapsed, 500);
  };
  const progressFeed = (msg: string) => {
    lastProgressMsg = msg;
    const p = parseProgress(msg);
    if (p) {
      const pct = Math.round((p.done / p.total) * 100);
      progressFill.className = 'progress-fill';
      progressFill.style.width = `${pct}%`;
      progressTrack.setAttribute('aria-valuenow', String(pct));
    } else {
      progressFill.className = 'progress-fill indet';
    }
    paintElapsed();
  };
  const progressDone = () => {
    if (progressTimer !== null) {
      window.clearInterval(progressTimer);
      progressTimer = null;
    }
    progressFill.className = 'progress-fill';
    progressFill.style.width = '100%';
    progressTrack.setAttribute('aria-valuenow', '100');
    window.setTimeout(() => {
      progressWrap.hidden = true;
      progressFill.style.width = '0%';
    }, 800);
  };

  /** Batchable tools: same operation applied to every file, delivered as one ZIP. */
  const BATCH_SUFFIX: Record<string, string> = {
    compress: 'compressed',
    encrypt: 'protected',
    watermark: 'watermarked',
    'page-numbers': 'numbered',
    'header-footer': 'header-footer',
    rotate: 'rotated',
    flatten: 'flat',
  };

  const showStats = (inBytes: number, outBytes: number) => {
    if (inBytes > 0 && outBytes > 0) {
      const delta = Math.round((1 - outBytes / inBytes) * 100);
      const verdict = delta > 0 ? `${delta}% smaller` : delta < 0 ? `${-delta}% larger` : 'same size';
      results.append(
        el('p', { class: 'result-stats' }, `${formatBytes(inBytes)} → ${formatBytes(outBytes)} (${verdict})`),
      );
    }
  };

  const showOutputs = (
    outs: { blob: Blob; filename: string; note?: string; previewText?: string }[],
    autoDownload: boolean,
  ) => {
    for (const out of outs) {
      const card = el('div', { class: 'result' });
      const head = el('div', { class: 'result-head' });
      head.append(el('strong', {}, out.filename));
      const dl = el('button', { class: 'btn primary', type: 'button' }, 'Download');
      dl.addEventListener('click', () => downloadBlob(out.blob, out.filename));
      head.append(dl);
      // Behavior: on phones users share more than they download…
      try {
        const file = new File([out.blob], out.filename, { type: out.blob.type || 'application/octet-stream' });
        if (typeof navigator.share === 'function' && navigator.canShare?.({ files: [file] })) {
          const share = el('button', { class: 'btn', type: 'button' }, 'Share');
          share.addEventListener('click', () => {
            void navigator.share({ files: [file], title: out.filename }).catch(() => {
              /* user dismissed — not an error */
            });
          });
          head.append(share);
        }
      } catch {
        /* File constructor / canShare unsupported — download covers it */
      }
      // …and for text outputs they copy more than they save.
      if (out.previewText && navigator.clipboard) {
        const copy = el('button', { class: 'btn', type: 'button' }, 'Copy');
        copy.addEventListener('click', () => {
          void navigator.clipboard
            .writeText(out.previewText!.slice(0, 100000))
            .then(
              () => setStatus('Copied to clipboard.', 'ok'),
              () => setStatus('Copy blocked by the browser — select the text manually.', 'error'),
            );
        });
        head.append(copy);
      }
      card.append(head);
      if (out.note) card.append(el('p', { class: 'muted' }, out.note));
      if (out.previewText) {
        card.append(el('pre', { class: 'preview-text' }, out.previewText.slice(0, 8000)));
      }
      if (out.blob.type === 'application/pdf') {
        const url = URL.createObjectURL(out.blob);
        const frame = document.createElement('iframe');
        frame.src = url;
        frame.className = 'preview-frame';
        frame.title = `Preview of ${out.filename}`;
        card.append(frame);
      }
      if (autoDownload) downloadBlob(out.blob, out.filename);
      results.append(card);
    }
    // Productivity chaining (Smallpdf's "connect tools", but offline with the
    // real file): carry the first PDF output straight into the next tool.
    const firstPdf = outs.find((o) => o.blob.type === 'application/pdf');
    if (firstPdf) {
      const next = el('div', { class: 'related' });
      next.append(el('span', { class: 'muted' }, 'Continue in: '));
      for (const t of nextTools(current.id)) {
        const b = el('button', { class: 'chip', type: 'button' }, `${t.icon} ${t.title}`);
        b.addEventListener('click', () => {
          stageFilesForTool([new File([firstPdf.blob], firstPdf.filename, { type: 'application/pdf' })]);
          goTool(t.id);
        });
        next.append(b);
      }
      results.append(next);
    }
  };

  runBtn.addEventListener('click', async () => {
    results.innerHTML = '';
    if (current.id === 'compare') {
      setStatus('Compare renders live above — no download needed.', 'info');
      return;
    }
    runBtn.setAttribute('disabled', 'true');
    runBtn.textContent = 'Working…';
    progressStart();
    const feed = (m: string) => {
      setStatus(m, 'info');
      progressFeed(m);
    };
    const celebrate = () => {
      // Post-conversion moment: the user got value — count it, then (once
      // ever) suggest installation. Never on first paint, never when installed.
      markEngaged();
      if (bumpRuns() === 1) maybeSuggestInstall();
    };
    try {
      setStatus('Loading engine…', 'info');
      const { runTool } = await loadActions();
      const batchSuffix = BATCH_SUFFIX[current.id];
      if (batchSuffix && state.files.length > 1) {
        // Enterprise batch path: every file processed independently, so one
        // corrupt file can never sink the whole batch. Successes zip up;
        // failures are reported inline, per file.
        const { default: JSZip } = await import('jszip');
        const zip = new JSZip();
        const failed: string[] = [];
        let inBytes = 0;
        let outBytes = 0;
        for (let i = 0; i < state.files.length; i++) {
          const f = state.files[i];
          feed(`Batch ${i + 1}/${state.files.length}: ${f.name}…`);
          try {
            const outs = await runTool(
              current.id,
              { files: [f], opts: getOpts(), onProgress: feed },
            );
            if (!outs[0]) throw new Error('no output produced');
            zip.file(`${baseName(f.name)}-${batchSuffix}.pdf`, outs[0].blob);
            inBytes += f.size;
            outBytes += outs[0].blob.size;
          } catch (err) {
            failed.push(`${f.name}: ${err instanceof Error ? err.message : String(err)}`);
          }
        }
        if (failed.length === state.files.length) {
          throw new UserError(`Every file failed:\n${failed.slice(0, 3).join('\n')}${failed.length > 3 ? `\n…and ${failed.length - 3} more.` : ''}`);
        }
        feed('Zipping results…');
        const blob = await zip.generateAsync({ type: 'blob' });
        const filename = `${current.id}-batch-${state.files.length - failed.length}-files.zip`;
        const okCount = state.files.length - failed.length;
        setStatus(
          failed.length === 0
            ? `Done — ${okCount} files processed.`
            : `Done with issues — ${okCount} ok, ${failed.length} failed.`,
          failed.length === 0 ? 'ok' : 'error',
        );
        progressDone();
        showStats(inBytes, outBytes);
        showOutputs(
          [{
            blob,
            filename,
            note: `Batch ${current.title.toLowerCase()}: ${okCount} files, same settings applied to each.` +
              (failed.length > 0 ? ` Failed: ${failed.slice(0, 3).join(' · ')}${failed.length > 3 ? ` · +${failed.length - 3} more` : ''}` : ''),
          }],
          true,
        );
        paintSteps(3);
        scrollToResults();
        celebrate();
        return;
      }
      feed('Working…');
      const opts = getOpts();
      const outs = await runTool(current.id, {
        files: [...state.files],
        opts,
        onProgress: feed,
      });
      setStatus(`Done — ${outs.length} file${outs.length > 1 ? 's' : ''} ready.`, 'ok');
      progressDone();
      // Best-in-class touch: show input → output size for every run.
      showStats(
        state.files.reduce((a, f) => a + f.size, 0),
        outs.reduce((a, o) => a + o.blob.size, 0),
      );
      // One file → download immediately. Several → buttons only: browsers
      // gate multi-downloads behind scary prompts, so don't fire them blindly.
      const single = outs.length === 1;
      showOutputs(outs, single);
      if (!single) setStatus(`Done — ${outs.length} files ready below. Download or share each one.`, 'ok');
      paintSteps(3);
      scrollToResults();
      celebrate();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setStatus(msg, 'error');
      progressDone();
      status.scrollIntoView({ behavior: reducedMotion() ? 'auto' : 'smooth', block: 'nearest' });
    } finally {
      runBtn.removeAttribute('disabled');
      runBtn.textContent = `Run — ${current.title}`;
    }
  });

  root.append(drop, listBox, optsBox, live, actionBar, progressWrap, status, results);

  // Cross-navigation: users rarely need just one tool.
  const related = TOOLS.filter((t) => t.category === current.category && t.id !== current.id).slice(0, 6);
  if (related.length > 0) {
    const rel = el('div', { class: 'related' });
    rel.append(el('span', { class: 'muted' }, `More ${current.category.toLowerCase()}: `));
    for (const t of related) {
      const a = el('a', { class: 'chip', href: toolHref(t.id) }, `${t.icon} ${t.title}`);
      a.addEventListener('pointerenter', prefetchEngines, { once: true });
      rel.append(a);
    }
    root.append(rel);
  }

  // Behavior guards: Cmd/Ctrl+Enter runs; a stray drop anywhere loads files
  // instead of navigating away and vaporizing state; leaving with loaded
  // files asks first. All torn down when the route changes.
  const onToolKey = (e: KeyboardEvent) => {
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
      e.preventDefault();
      if (!runBtn.hasAttribute('disabled')) runBtn.click();
    }
  };
  const onWinDragOver = (e: DragEvent) => {
    e.preventDefault();
  };
  const onWinDrop = (e: DragEvent) => {
    e.preventDefault();
    const list = e.dataTransfer?.files;
    if (list && list.length > 0) addFiles([...list]);
  };
  const onBeforeUnload = (e: BeforeUnloadEvent) => {
    if (state.files.length > 0) e.preventDefault();
  };
  window.addEventListener('keydown', onToolKey);
  window.addEventListener('dragover', onWinDragOver);
  window.addEventListener('drop', onWinDrop);
  window.addEventListener('beforeunload', onBeforeUnload);
  onRouteLeave(() => {
    window.removeEventListener('keydown', onToolKey);
    window.removeEventListener('dragover', onWinDragOver);
    window.removeEventListener('drop', onWinDrop);
    window.removeEventListener('beforeunload', onBeforeUnload);
  });

  const tips = el('details', { class: 'tips' });
  tips.append(el('summary', {}, 'Tips & limits'), el('p', {},
    'Large PDFs are limited by device memory. Password-protected files must be unlocked first. Rasterizing tools (Heavy compress, Invert, Dark mode) produce smaller or recolored files but text is no longer selectable.'));
  root.append(tips);

  // Same content the prerendered landing page carries: About + How-to + FAQ.
  // Loaded lazily so the interactive shell stays lean.
  const seoMount = el('div', { class: 'seo-section' });
  root.append(seoMount);
  void (async () => {
    try {
      const [{ default: SEO }, { default: GUIDES }] = await Promise.all([
        import('./seo/content.json'),
        import('./seo/guides.json'),
      ]);
      const entry = (SEO as unknown as { tools: SeoEntry[] }).tools.find((t) => t.id === current.id);
      if (!entry) return;
      const about = el('section', { class: 'faq' });
      about.append(el('h2', {}, `About ${current.title}`));
      about.append(el('p', {}, entry.intro));
      if (entry.steps && entry.steps.length > 0) {
        about.append(el('h3', {}, `How to use ${current.title}`));
        const ol = el('ol', { class: 'howto' });
        for (const step of entry.steps) ol.append(el('li', {}, step));
        about.append(ol);
      }
      if (entry.faqs && entry.faqs.length > 0) {
        about.append(el('h3', {}, 'Frequently asked questions'));
        for (const [q, a] of entry.faqs) {
          const d = el('details', {});
          d.append(el('summary', {}, q), el('p', {}, a));
          about.append(d);
        }
      }
      // Blog-style cross-links (Smallpdf pattern): guides that use this tool.
      const guides = (GUIDES as unknown as { guides: GuideEntry[] }).guides.filter((g) =>
        g.relatedTools.includes(current.id),
      );
      if (guides.length > 0) {
        about.append(el('h3', {}, 'Learn more'));
        const rel = el('div', { class: 'related' });
        for (const g of guides.slice(0, 4)) {
          rel.append(el('a', { class: 'chip', href: `/guides/${g.slug}/` }, `📖 ${g.h1.replace(/ —.*$/, '').slice(0, 44)}`));
        }
        about.append(rel);
      }
      seoMount.append(about);
    } catch {
      /* content is enhancement only */
    }
  })();

  paintFiles();
  // File-first arrival: files staged on the homepage (or chained from another
  // tool's output) land here preloaded — adjust and Run.
  const staged = takeStagedFiles();
  if (staged.length > 0) {
    addFiles(staged);
    setStatus(`Loaded ${staged.length} file${staged.length > 1 ? 's' : ''} — adjust settings and Run.`, 'ok');
  }
  return root;
}

// ---------- Per-tool option forms ----------

type OptGetter = () => Record<string, string>;

function buildOptions(
  id: string,
  box: HTMLElement,
  state: FileState,
  setStatus: (m: string, k?: 'info' | 'error' | 'ok') => void,
): OptGetter {
  void state;
  void setStatus;
  const bag: Record<string, HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement> = {};
  const add = (label: string, key: string, node: HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement) => {
    bag[key] = node;
    box.append(field(label, node));
  };

  switch (id) {
    case 'split':
      add('Mode', 'mode', selectInput([
        { value: 'ranges', label: 'Extract range (one PDF)' },
        { value: 'keep', label: 'Keep only these pages (one PDF)' },
        { value: 'each', label: 'Every page as its own PDF (ZIP)' },
        { value: 'chunks', label: 'Every N pages → separate files (ZIP)' },
        { value: 'oddeven', label: 'Odd pages + even pages (2 files)' },
        { value: 'bysize', label: 'Split by file size (email-friendly ZIP)' },
      ], 'ranges'));
      add('Pages (e.g. 1-3, 5)', 'ranges', textInput('1-3, 5'));
      add('Pages per file (chunks mode)', 'size', textInput('5', '', 'number'));
      add('Target MB per file (by-size mode)', 'targetMB', textInput('5', '', 'number'));
      break;
    case 'compress':
      add('Preset', 'preset', selectInput([
        { value: 'light', label: 'Light — best quality' },
        { value: 'medium', label: 'Medium — balanced (recommended)' },
        { value: 'heavy', label: 'Heavy — smallest file' },
        { value: 'target', label: 'Target size — e.g. under 1 MB for portals' },
        { value: 'lossless', label: 'Lossless — re-save only (keeps text sharp)' },
      ], 'medium'));
      add('Target MB (target-size mode)', 'targetMB', textInput('1', '', 'number'));
      break;
    case 'pdf-to-jpg':
      add('Image format', 'format', selectInput([
        { value: 'jpg', label: 'JPG (smaller)' },
        { value: 'png', label: 'PNG (lossless)' },
      ], 'jpg'));
      add('Quality / DPI', 'dpi', selectInput([
        { value: '1', label: 'Standard (~150 DPI)' },
        { value: '2', label: 'High (~300 DPI)' },
        { value: '3', label: 'Ultra (~600 DPI)' },
      ], '2'));
      break;
    case 'images-to-pdf':
      add('Page size', 'pagesize', selectInput([
        { value: 'fit', label: 'Fit to image' },
        { value: 'a4', label: 'A4' },
      ], 'fit'));
      add('Margin (pt)', 'margin', textInput('24', '24', 'number'));
      break;
    case 'rotate':
      add('Angle', 'angle', selectInput([
        { value: '90', label: '90° clockwise' },
        { value: '180', label: '180°' },
        { value: '270', label: '90° counter-clockwise' },
      ], '90'));
      add('Pages (blank = all, e.g. 1-2, 5)', 'pages', textInput('', '1-3, 5'));
      break;
    case 'watermark':
      add('Kind', 'wmmode', selectInput([
        { value: 'text', label: 'Text watermark' },
        { value: 'image', label: 'Logo / image watermark' },
      ], 'text'));
      add('Text', 'text', textInput('CONFIDENTIAL'));
      add('Opacity (0.05–0.6)', 'opacity', textInput('0.25', '', 'number'));
      add('Font size (text mode)', 'size', textInput('48', '', 'number'));
      add('Rotation degrees (text mode)', 'rotation', textInput('-45', '', 'number'));
      add('Logo width % (image mode)', 'wmwidth', textInput('22', '', 'number'));
      add('Tiled pattern?', 'tile', selectInput([{ value: 'no', label: 'Single center' }, { value: 'yes', label: 'Tiled' }], 'no'));
      break;
    case 'page-numbers':
      add('Start number', 'start', textInput('1', '', 'number'));
      add('Format', 'format', selectInput([
        { value: 'page-n-of-N', label: 'Page X of Y' },
        { value: 'page-n', label: 'Page X' },
        { value: 'n-of-N', label: 'X / Y' },
        { value: 'n', label: 'X' },
      ], 'page-n-of-N'));
      add('Position', 'position', selectInput([
        { value: 'bottom-center', label: 'Bottom center' },
        { value: 'bottom-right', label: 'Bottom right' },
        { value: 'bottom-left', label: 'Bottom left' },
        { value: 'top-center', label: 'Top center' },
        { value: 'top-right', label: 'Top right' },
      ], 'bottom-center'));
      add('Font size', 'size', textInput('10', '', 'number'));
      break;
    case 'header-footer':
      add('Header (supports {page}, {total})', 'header', textInput(''));
      add('Footer (supports {page}, {total})', 'footer', textInput('Page {page} of {total}'));
      add('Font size', 'size', textInput('9', '', 'number'));
      break;
    case 'redact': {
      const hidden = document.createElement('input');
      hidden.type = 'hidden';
      hidden.value = '[]';
      bag['boxes'] = hidden;
      box.append(el('p', { class: 'muted' }, 'Add black boxes below (percentages of page). They are baked into the PDF on Run.'));
      break;
    }
    case 'sign':
      box.append(el('p', { class: 'muted' }, 'Create your signature, then add placements below. Your signature is stored only in this browser.'));
      break;
    case 'annotate':
      box.append(el('p', { class: 'muted' }, 'Build annotations below — text, yellow highlights, or image stamps. Positions are % of page size.'));
      break;
    case 'crop':
      add('Top margin %', 'top', textInput('5', '', 'number'));
      add('Bottom margin %', 'bottom', textInput('5', '', 'number'));
      add('Left margin %', 'left', textInput('5', '', 'number'));
      add('Right margin %', 'right', textInput('5', '', 'number'));
      add('Pages (blank = all)', 'pages', textInput('', '1-3, 5'));
      break;
    case 'fill-forms':
      add('Lock fields after filling? (flatten)', 'flatten', selectInput([
        { value: 'yes', label: 'Yes — make static (recommended)' },
        { value: 'no', label: 'No — keep editable' },
      ], 'yes'));
      box.append(el('p', { class: 'muted' }, 'Form fields appear below after upload. Fill them, then Run.'));
      break;
    case 'encrypt':
      add('Password (min 4 chars)', 'password', textInput('', '••••••••', 'password'));
      add('Owner password (optional)', 'owner', textInput('', 'defaults to same', 'password'));
      break;
    case 'decrypt':
      add('Current password', 'password', textInput('', '••••••••', 'password'));
      break;
    case 'privacy':
      add('Action', 'action', selectInput([
        { value: 'inspect', label: 'Inspect metadata only' },
        { value: 'edit', label: 'Edit title/author/subject/keywords' },
        { value: 'strip', label: 'Strip metadata + download clean PDF' },
      ], 'inspect'));
      add('Title (edit mode)', 'title', textInput(''));
      add('Author (edit mode)', 'author', textInput(''));
      add('Subject (edit mode)', 'subject', textInput(''));
      add('Keywords, comma-separated (edit mode)', 'keywords', textInput(''));
      break;
    case 'create':
      add('Title', 'title', textInput('My document'));
      add('Font size', 'size', textInput('12', '', 'number'));
      add('Body', 'body', textArea('Write here…\n\nBlank lines separate paragraphs.', '', 10));
      break;
    case 'markdown':
      add('Markdown', 'body', textArea('# Title\n\n- point one\n- point two\n\nSome **bold** text.', 'Paste Markdown…', 12));
      break;
    case 'html-to-pdf':
      add('Title', 'title', textInput('Webpage'));
      add('HTML', 'body', textArea('<h1>Hello</h1><p>Paste HTML here…</p>', 'Paste HTML…', 12));
      break;
    case 'excel-to-pdf':
      add('PDF title', 'title', textInput('Spreadsheet'));
      break;
    case 'organize':
    case 'compare':
    case 'scan':
    case 'merge':
    case 'flatten':
    case 'repair':
    case 'pdf-to-word':
    case 'word-to-pdf':
    case 'pdf-to-excel':
    case 'pdf-to-html':
    case 'pdf-to-pptx':
    case 'pptx-to-pdf':
      box.append(el('p', { class: 'muted' }, 'No extra settings — upload and Run.'));
      break;
    case 'extract-text':
      add('Output format', 'format', selectInput([
        { value: 'txt', label: 'Plain text (.txt)' },
        { value: 'md', label: 'Markdown (.md) — headings + lists' },
      ], 'txt'));
      break;
    case 'ocr': {
      const langs: [string, string][] = [
        ['eng', 'English'], ['spa', 'Spanish'], ['fra', 'French'], ['deu', 'German'],
        ['ita', 'Italian'], ['por', 'Portuguese'], ['nld', 'Dutch'], ['rus', 'Russian'],
        ['ara', 'Arabic'], ['hin', 'Hindi'], ['chi_sim', 'Chinese (Simplified)'],
        ['jpn', 'Japanese'], ['kor', 'Korean'], ['tur', 'Turkish'],
      ];
      add('Recognition language', 'lang', selectInput(langs.map(([value, label]) => ({ value, label })), 'eng'));
      box.append(el('p', { class: 'muted' }, 'First use downloads the language pack (cached for offline after).'));
      break;
    }
    case 'invert':
      add('Style', 'recolor', selectInput([
        { value: 'dark', label: 'Dark mode (recommended)' },
        { value: 'invert', label: 'Full invert' },
        { value: 'grayscale', label: 'Grayscale (print-friendly)' },
        { value: 'sepia', label: 'Sepia' },
      ], 'dark'));
      break;
    default:
      break;
  }

  return () => {
    const out: Record<string, string> = {};
    for (const [k, node] of Object.entries(bag)) out[k] = (node as HTMLInputElement).value;
    // Organize / redact pull live state from data attributes set by their mounters.
    const org = box.parentElement?.querySelector('[data-plan]');
    if (org) out['plan'] = org.getAttribute('data-plan')!;
    const red = box.parentElement?.querySelector('[data-boxes]');
    if (red) out['boxes'] = red.getAttribute('data-boxes')!;
    const hiddenBoxes = document.querySelector('[data-boxes-live]');
    if (hiddenBoxes && id === 'redact') out['boxes'] = (hiddenBoxes as HTMLElement).dataset['boxesLive'] ?? '[]';
    // Generic channel for rich mounters (sign / annotate / fill-forms):
    // any [data-opt-key] element contributes its [data-opt-value].
    const scope = box.parentElement ?? document;
    scope.querySelectorAll('[data-opt-key]').forEach((elm) => {
      const key = elm.getAttribute('data-opt-key');
      if (key) out[key] = elm.getAttribute('data-opt-value') ?? '';
    });
    return out;
  };
}

// ---------- Special UIs ----------

function mountOrganize(
  live: HTMLElement,
  state: FileState,
  setStatus: (m: string, k?: 'info' | 'error' | 'ok') => void,
): void {
  const wrap = el('div', { class: 'organize' });
  wrap.setAttribute('data-plan', JSON.stringify({ order: [], rotations: {} }));
  live.append(wrap);
  const file = state.files[0];
  if (!file) return;

  (async () => {
    try {
      setStatus('Loading viewer…', 'info');
      const { renderPage, getPageCount } = await loadRender();
      setStatus('Loading thumbnails…', 'info');
      const bytes = await file.arrayBuffer();
      const n = await getPageCount(bytes.slice(0));
      const order: number[] = Array.from({ length: n }, (_, i) => i);
      const rotations: Record<number, number> = {};
      const deleted = new Set<number>();

      const sync = () => {
        const visible = order.filter((p) => !deleted.has(p));
        wrap.setAttribute('data-plan', JSON.stringify({ order: visible, rotations }));
      };

      const grid = el('div', { class: ' thumbs' });
      wrap.append(el('p', { class: 'muted' }, `${n} pages. Use ← → to reorder, ⟳ to rotate, ✕ to delete.`));
      // Skeleton shimmer while thumbnails render (perceived speed > spinners).
      const skel = el('div', { class: 'skel-grid', 'aria-hidden': 'true' });
      for (let s = 0; s < Math.min(6, n); s++) skel.append(el('div', { class: 'skel' }));
      wrap.append(skel);
      wrap.append(grid);

      const paint = async () => {
        grid.innerHTML = '';
        sync();
        for (const p of order) {
          if (deleted.has(p)) continue;
          const card = el('div', { class: 'thumb' });
          const { canvas } = await renderPage(bytes.slice(0), p + 1, 0.55);
          skel.remove();
          canvas.className = 'thumb-canvas';
          const rot = rotations[p] ?? 0;
          canvas.style.transform = rot ? `rotate(${rot}deg)` : '';
          card.append(canvas);
          card.append(el('div', { class: 'thumb-label' }, `Page ${p + 1}${rot ? ` • ${rot}°` : ''}`));
          const row = el('div', { class: 'thumb-btns' });
          const mk = (label: string, title: string, fn: () => void) => {
            const b = el('button', { class: 'btn small', type: 'button', title }, label);
            b.addEventListener('click', () => {
              fn();
              void paint();
            });
            return b;
          };
          row.append(
            mk('←', 'Move left', () => {
              const vis = order.filter((x) => !deleted.has(x));
              const i = vis.indexOf(p);
              if (i > 0) {
                const a = order.indexOf(vis[i - 1]);
                const b = order.indexOf(p);
                [order[a], order[b]] = [order[b], order[a]];
              }
            }),
            mk('→', 'Move right', () => {
              const vis = order.filter((x) => !deleted.has(x));
              const i = vis.indexOf(p);
              if (i < vis.length - 1) {
                const a = order.indexOf(vis[i + 1]);
                const b = order.indexOf(p);
                [order[a], order[b]] = [order[b], order[a]];
              }
            }),
            mk('⟳', 'Rotate 90°', () => {
              rotations[p] = (((rotations[p] ?? 0) + 90) % 360) as 90 | 180 | 270;
              if (rotations[p] === 0) delete rotations[p];
            }),
            mk('✕', 'Delete page', () => {
              deleted.add(p);
            }),
          );
          card.append(row);
          grid.append(card);
        }
        const undel = el('button', { class: 'btn small', type: 'button' }, `Restore deleted (${deleted.size})`);
        undel.addEventListener('click', () => {
          deleted.clear();
          void paint();
        });
        if (deleted.size > 0) wrap.append(undel);
      };
      await paint();
      setStatus('Ready — arrange pages, then Run.', 'ok');
    } catch (err) {
      setStatus(err instanceof Error ? err.message : String(err), 'error');
    }
  })();
}

function mountCompare(
  live: HTMLElement,
  state: FileState,
  setStatus: (m: string, k?: 'info' | 'error' | 'ok') => void,
): void {
  live.append(el('p', { class: 'muted' }, 'Upload exactly 2 PDFs above — they render side by side with synced scrolling.'));
  if (state.files.length < 2) {
    live.append(el('p', { class: 'muted' }, `Waiting for the second file (have ${state.files.length}).`));
    return;
  }
  const [a, b] = state.files;
  const cols = el('div', { class: 'compare' });
  const left = el('div', { class: 'compare-col' });
  const right = el('div', { class: 'compare-col' });
  left.append(el('h3', {}, a.name));
  right.append(el('h3', {}, b.name));
  const skelL = el('div', { class: 'skel wide', 'aria-hidden': 'true' });
  const skelR = el('div', { class: 'skel wide', 'aria-hidden': 'true' });
  left.append(skelL);
  right.append(skelR);
  cols.append(left, right);
  live.append(cols);
  // Sync scroll
  let lock = false;
  const sync = (src: HTMLElement, dst: HTMLElement) => {
    src.addEventListener('scroll', () => {
      if (lock) return;
      lock = true;
      dst.scrollTop = src.scrollTop;
      requestAnimationFrame(() => (lock = false));
    });
  };
  sync(left, right);
  sync(right, left);

  (async () => {
    try {
      setStatus('Loading viewer…', 'info');
      const { renderPage, getPageCount } = await loadRender();
      setStatus('Rendering both PDFs…', 'info');
      const [ba, bb] = await Promise.all([a.arrayBuffer(), b.arrayBuffer()]);
      const [na, nb] = await Promise.all([getPageCount(ba.slice(0)), getPageCount(bb.slice(0))]);
      const pages = Math.max(na, nb);
      skelL.remove();
      skelR.remove();
      for (let i = 1; i <= pages; i++) {
        if (i <= na) {
          const { canvas } = await renderPage(ba.slice(0), i, 1.0);
          left.append(el('p', { class: 'muted' }, `p.${i}`), canvas);
        }
        if (i <= nb) {
          const { canvas } = await renderPage(bb.slice(0), i, 1.0);
          right.append(el('p', { class: 'muted' }, `p.${i}`), canvas);
        }
      }
      setStatus('Ready — scroll to compare.', 'ok');
    } catch (err) {
      setStatus(err instanceof Error ? err.message : String(err), 'error');
      if (err instanceof UserError) return;
    }
  })();
}

function mountRedact(
  live: HTMLElement,
  state: FileState,
  setStatus: (m: string, k?: 'info' | 'error' | 'ok') => void,
): void {
  const store = el('div', {});
  store.setAttribute('data-boxes-live', '');
  (store as HTMLElement).dataset['boxesLive'] = '[]';
  live.append(store);
  // Re-expose for getter
  const anchor = el('div', {});
  anchor.setAttribute('data-boxes', '[]');
  live.append(anchor);

  const boxes: { pageIndex: number; xPct: number; yPct: number; wPct: number; hPct: number }[] = [];
  const sync = () => {
    const s = JSON.stringify(boxes);
    anchor.setAttribute('data-boxes', s);
    (store as HTMLElement).dataset['boxesLive'] = s;
  };

  const pageIn = document.createElement('input');
  pageIn.type = 'number';
  pageIn.min = '1';
  pageIn.value = '1';
  pageIn.className = 'input';
  const mkNum = (v: number) => {
    const i = document.createElement('input');
    i.type = 'number';
    i.value = String(v);
    i.min = '0';
    i.max = '100';
    i.className = 'input';
    return i;
  };
  const x = mkNum(10), y = mkNum(40), w = mkNum(80), h = mkNum(12);
  const form = el('div', { class: 'redact-form' });
  form.append(
    el('label', {}, 'Page ', pageIn),
    el('label', {}, 'X% ', x),
    el('label', {}, 'Y% (from bottom) ', y),
    el('label', {}, 'W% ', w),
    el('label', {}, 'H% ', h),
  );
  const addBtn = el('button', { class: 'btn', type: 'button' }, 'Add black box');
  const list = el('div', { class: 'filelist' });
  addBtn.addEventListener('click', () => {
    boxes.push({
      pageIndex: Math.max(1, Number(pageIn.value) || 1) - 1,
      xPct: Number(x.value) || 0,
      yPct: Number(y.value) || 0,
      wPct: Number(w.value) || 10,
      hPct: Number(h.value) || 10,
    });
    sync();
    paint();
  });
  const paint = () => {
    list.innerHTML = '';
    boxes.forEach((b, i) => {
      const row = el('div', { class: 'filerow' });
      row.append(el('span', {}, `Box ${i + 1}: page ${b.pageIndex + 1}, x ${b.xPct}%, y ${b.yPct}%, ${b.wPct}×${b.hPct}%`));
      const rm = el('button', { class: 'btn small danger', type: 'button' }, 'Remove');
      rm.addEventListener('click', () => {
        boxes.splice(i, 1);
        sync();
        paint();
      });
      row.append(rm);
      list.append(row);
    });
  };
  live.append(form, addBtn, list);
  void setStatus;
  sync();
}

const SIG_KEY = 'pdfsuite.signature';

function sigAnchor(live: HTMLElement): HTMLElement {
  const a = el('div', {});
  a.setAttribute('data-opt-key', 'sig');
  a.setAttribute('data-opt-value', localStorage.getItem(SIG_KEY) ?? '');
  live.append(a);
  return a;
}

function itemsAnchor(live: HTMLElement, key: string): HTMLElement {
  const a = el('div', {});
  a.setAttribute('data-opt-key', key);
  a.setAttribute('data-opt-value', '[]');
  live.append(a);
  return a;
}

function numInput(value: string, min = '0'): HTMLInputElement {
  const i = document.createElement('input');
  i.type = 'number';
  i.value = value;
  i.min = min;
  i.className = 'input';
  return i;
}

/** Signature studio: draw / type / upload, persisted in this browser only. */
function mountSign(
  live: HTMLElement,
  setStatus: (m: string, k?: 'info' | 'error' | 'ok') => void,
): void {
  const sigStore = sigAnchor(live);
  const itemsStore = itemsAnchor(live, 'items');
  const items: { pageIndex: number; xPct: number; yPct: number; wPct: number }[] = [];
  const syncItems = () => itemsStore.setAttribute('data-opt-value', JSON.stringify(items));

  const wrap = el('div', { class: 'scanner' });
  wrap.append(el('h3', {}, 'Your signature'));
  const pad = document.createElement('canvas');
  pad.width = 520;
  pad.height = 180;
  pad.className = 'sig-pad';
  const ctx = pad.getContext('2d')!;
  const clearPad = () => {
    ctx.clearRect(0, 0, pad.width, pad.height);
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, pad.width, pad.height);
  };
  clearPad();

  // Freehand drawing (mouse + touch via pointer events).
  let drawing = false;
  const pos = (e: PointerEvent) => {
    const r = pad.getBoundingClientRect();
    return { x: ((e.clientX - r.left) / r.width) * pad.width, y: ((e.clientY - r.top) / r.height) * pad.height };
  };
  pad.addEventListener('pointerdown', (e) => {
    drawing = true;
    pad.setPointerCapture(e.pointerId);
    const p = pos(e);
    ctx.beginPath();
    ctx.moveTo(p.x, p.y);
  });
  pad.addEventListener('pointermove', (e) => {
    if (!drawing) return;
    const p = pos(e);
    ctx.lineWidth = 3;
    ctx.lineCap = 'round';
    ctx.strokeStyle = '#111827';
    ctx.lineTo(p.x, p.y);
    ctx.stroke();
  });
  for (const ev of ['pointerup', 'pointercancel', 'pointerleave']) {
    pad.addEventListener(ev, () => {
      drawing = false;
    });
  }

  const preview = el('div', { class: 'muted' }, localStorage.getItem(SIG_KEY) ? 'Saved signature loaded.' : 'Draw, type, or upload — then Save signature.');
  const row1 = el('div', { class: 'row' });
  const clearBtn = el('button', { class: 'btn small', type: 'button' }, 'Clear pad');
  clearBtn.addEventListener('click', clearPad);
  const saveBtn = el('button', { class: 'btn small primary', type: 'button' }, 'Save signature');
  saveBtn.addEventListener('click', () => {
    const url = pad.toDataURL('image/png');
    localStorage.setItem(SIG_KEY, url);
    sigStore.setAttribute('data-opt-value', url);
    preview.textContent = 'Signature saved in this browser.';
    setStatus('Signature saved.', 'ok');
  });
  row1.append(clearBtn, saveBtn);

  const typeInput = textInput('', 'Type your name…');
  const fontSel = selectInput([
    { value: "'Brush Script MT','Segoe Script',cursive", label: 'Handwriting' },
    { value: "Georgia,'Times New Roman',serif", label: 'Elegant serif' },
    { value: "Arial,Helvetica,sans-serif", label: 'Clean sans' },
  ], "'Brush Script MT','Segoe Script',cursive");
  const typeBtn = el('button', { class: 'btn small', type: 'button' }, 'Use typed');
  typeBtn.addEventListener('click', () => {
    if (!typeInput.value.trim()) {
      setStatus('Type your name first.', 'error');
      return;
    }
    clearPad();
    ctx.fillStyle = '#111827';
    ctx.font = `64px ${fontSel.value}`;
    ctx.textBaseline = 'middle';
    ctx.fillText(typeInput.value.trim().slice(0, 32), 24, pad.height / 2, pad.width - 48);
  });

  const upload = document.createElement('input');
  upload.type = 'file';
  upload.accept = 'image/*';
  upload.hidden = true;
  upload.addEventListener('change', () => {
    const f = upload.files?.[0];
    if (!f) return;
    const url = URL.createObjectURL(f);
    const img = new Image();
    img.onload = () => {
      clearPad();
      const scale = Math.min((pad.width - 40) / img.width, (pad.height - 40) / img.height);
      ctx.drawImage(img, (pad.width - img.width * scale) / 2, (pad.height - img.height * scale) / 2, img.width * scale, img.height * scale);
      URL.revokeObjectURL(url);
    };
    img.src = url;
    upload.value = '';
  });
  const uploadBtn = el('button', { class: 'btn small', type: 'button' }, 'Upload image');
  uploadBtn.addEventListener('click', () => upload.click());

  wrap.append(pad, preview, row1, el('div', { class: 'row' }, typeInput, fontSel, typeBtn, uploadBtn), upload);
  live.append(wrap);

  // Placements
  const form = el('div', { class: 'redact-form' });
  const pageIn = numInput('1', '1');
  const x = numInput('60');
  const y = numInput('10');
  const w = numInput('25');
  form.append(
    el('label', {}, 'Page ', pageIn),
    el('label', {}, 'X% (from left) ', x),
    el('label', {}, 'Y% (from bottom) ', y),
    el('label', {}, 'Width% ', w),
  );
  const list = el('div', { class: 'filelist' });
  const paint = () => {
    list.innerHTML = '';
    items.forEach((it, i) => {
      const row = el('div', { class: 'filerow' });
      row.append(el('span', {}, `#${i + 1}: page ${it.pageIndex + 1}, x ${it.xPct}%, y ${it.yPct}%, width ${it.wPct}%`));
      const rm = el('button', { class: 'btn small danger', type: 'button' }, 'Remove');
      rm.addEventListener('click', () => {
        items.splice(i, 1);
        syncItems();
        paint();
      });
      row.append(rm);
      list.append(row);
    });
  };
  const addBtn = el('button', { class: 'btn', type: 'button' }, 'Add placement');
  addBtn.addEventListener('click', () => {
    items.push({
      pageIndex: Math.max(1, Number(pageIn.value) || 1) - 1,
      xPct: Number(x.value) || 0,
      yPct: Number(y.value) || 0,
      wPct: Number(w.value) || 25,
    });
    syncItems();
    paint();
  });
  live.append(form, addBtn, list);
  syncItems();
}

/** Annotation builder: text, highlights and image stamps. */
function mountAnnotate(
  live: HTMLElement,
  setStatus: (m: string, k?: 'info' | 'error' | 'ok') => void,
): void {
  void setStatus;
  const annsStore = itemsAnchor(live, 'anns');
  const stampStore = el('div', {});
  stampStore.setAttribute('data-opt-key', 'stamp');
  stampStore.setAttribute('data-opt-value', '');
  live.append(stampStore);

  const anns: {
    kind: 'text' | 'highlight' | 'image';
    pageIndex: number; xPct: number; yPct: number;
    text: string; size: number; color: string; bold: boolean; wPct: number;
  }[] = [];
  const sync = () => annsStore.setAttribute('data-opt-value', JSON.stringify(anns));

  const kind = selectInput([
    { value: 'text', label: 'Text' },
    { value: 'highlight', label: 'Highlight' },
    { value: 'image', label: 'Image stamp' },
  ], 'text');
  const pageIn = numInput('1', '1');
  const x = numInput('10');
  const y = numInput('70');
  const text = textInput('', 'Annotation text…');
  const size = numInput('14', '6');
  const color = document.createElement('input');
  color.type = 'color';
  color.value = '#111827';
  color.className = 'input';
  const bold = selectInput([{ value: 'no', label: 'Regular' }, { value: 'yes', label: 'Bold' }], 'no');
  const w = numInput('20');

  const stampUpload = document.createElement('input');
  stampUpload.type = 'file';
  stampUpload.accept = 'image/*';
  stampUpload.hidden = true;
  stampUpload.addEventListener('change', () => {
    const f = stampUpload.files?.[0];
    if (!f) return;
    const r = new FileReader();
    r.onload = () => stampStore.setAttribute('data-opt-value', String(r.result));
    r.readAsDataURL(f);
    stampUpload.value = '';
  });
  const stampBtn = el('button', { class: 'btn small', type: 'button' }, 'Upload stamp image');
  stampBtn.addEventListener('click', () => stampUpload.click());

  const form = el('div', { class: 'redact-form' });
  form.append(
    el('label', {}, 'Kind ', kind),
    el('label', {}, 'Page ', pageIn),
    el('label', {}, 'X% ', x),
    el('label', {}, 'Y% (from bottom) ', y),
    el('label', {}, 'Text ', text),
    el('label', {}, 'Size ', size),
    el('label', {}, 'Color ', color),
    el('label', {}, 'Weight ', bold),
    el('label', {}, 'Image width% ', w),
  );
  const list = el('div', { class: 'filelist' });
  const paint = () => {
    list.innerHTML = '';
    anns.forEach((a, i) => {
      const row = el('div', { class: 'filerow' });
      const label =
        a.kind === 'image'
          ? `#${i + 1} image: page ${a.pageIndex + 1}, x ${a.xPct}%, y ${a.yPct}%, w ${a.wPct}%`
          : `#${i + 1} ${a.kind}: page ${a.pageIndex + 1} — “${a.text.slice(0, 40)}”`;
      row.append(el('span', {}, label));
      const rm = el('button', { class: 'btn small danger', type: 'button' }, 'Remove');
      rm.addEventListener('click', () => {
        anns.splice(i, 1);
        sync();
        paint();
      });
      row.append(rm);
      list.append(row);
    });
  };
  const addBtn = el('button', { class: 'btn', type: 'button' }, 'Add annotation');
  addBtn.addEventListener('click', () => {
    anns.push({
      kind: kind.value as 'text' | 'highlight' | 'image',
      pageIndex: Math.max(1, Number(pageIn.value) || 1) - 1,
      xPct: Number(x.value) || 0,
      yPct: Number(y.value) || 0,
      text: text.value,
      size: Number(size.value) || 14,
      color: color.value,
      bold: bold.value === 'yes',
      wPct: Number(w.value) || 20,
    });
    sync();
    paint();
  });
  live.append(form, el('div', { class: 'row' }, addBtn, stampBtn), stampUpload, list);
  sync();
}

/** Form filler: enumerates AcroForm fields and renders matching inputs. */
function mountFormFill(
  live: HTMLElement,
  state: FileState,
  setStatus: (m: string, k?: 'info' | 'error' | 'ok') => void,
): void {
  const valuesStore = itemsAnchor(live, 'values');
  const values: Record<string, string> = {};
  const sync = () => valuesStore.setAttribute('data-opt-value', JSON.stringify(values));
  const file = state.files[0];
  if (!file) return;

  (async () => {
    try {
      setStatus('Reading form fields…', 'info');
      const pdfCore = await import('./lib/pdfCore.js');
      const fields = await pdfCore.listFormFields(await file.arrayBuffer());
      if (fields.length === 0) {
        live.append(el('p', { class: 'muted' }, 'No fillable form fields found in this PDF. It may be a flat scan — try OCR or Annotate instead.'));
        setStatus('No form fields found.', 'error');
        return;
      }
      const box = el('div', { class: 'opts' });
      for (const f of fields) {
        if (f.type === 'unsupported') {
          box.append(el('p', { class: 'muted' }, `“${f.name}” is an unsupported field type — left untouched.`));
          continue;
        }
        let input: HTMLElement;
        if (f.type === 'checkbox') {
          const sel = selectInput(
            [
              { value: 'no', label: 'Unchecked' },
              { value: 'yes', label: 'Checked' },
            ],
            f.value,
          );
          sel.addEventListener('change', () => {
            values[f.name] = sel.value;
            sync();
          });
          values[f.name] = f.value;
          input = sel;
        } else if (f.type === 'dropdown' && f.options) {
          const sel = selectInput(
            [{ value: '', label: '— select —' }, ...f.options.map((o: string) => ({ value: o, label: o }))],
            f.value,
          );
          sel.addEventListener('change', () => {
            values[f.name] = sel.value;
            sync();
          });
          values[f.name] = f.value;
          input = sel;
        } else {
          const inp = textInput(f.value, f.name);
          inp.addEventListener('input', () => {
            values[f.name] = inp.value;
            sync();
          });
          values[f.name] = f.value;
          input = inp;
        }
        box.append(field(f.name, input));
      }
      live.append(box);
      setStatus(`${fields.length} field${fields.length > 1 ? 's' : ''} found — fill and Run.`, 'ok');
      sync();
    } catch (err) {
      setStatus(err instanceof Error ? err.message : String(err), 'error');
    }
  })();
}

/** Logo picker for image watermarks (text mode needs nothing extra). */
function mountWatermarkPicker(
  live: HTMLElement,
  setStatus: (m: string, k?: 'info' | 'error' | 'ok') => void,
): void {
  const store = el('div', {});
  store.setAttribute('data-opt-key', 'wmImage');
  store.setAttribute('data-opt-value', '');
  const label = el('p', { class: 'muted' }, 'Image mode only: upload a logo, then Run.');
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = 'image/*';
  input.hidden = true;
  input.addEventListener('change', () => {
    const f = input.files?.[0];
    if (!f) return;
    const r = new FileReader();
    r.onload = () => {
      store.setAttribute('data-opt-value', String(r.result));
      label.textContent = `Logo ready: ${f.name}.`;
      setStatus('Logo loaded.', 'ok');
    };
    r.readAsDataURL(f);
    input.value = '';
  });
  const btn = el('button', { class: 'btn', type: 'button' }, 'Upload logo image');
  btn.addEventListener('click', () => input.click());
  live.append(label, el('div', { class: 'row' }, btn), input, store);
}

function mountScanner(
  live: HTMLElement,
  state: FileState,
  repaint: () => void,
  setStatus: (m: string, k?: 'info' | 'error' | 'ok') => void,
): void {
  const wrap = el('div', { class: 'scanner' });
  wrap.append(el('h3', {}, 'Camera scanner'));
  wrap.append(el('p', { class: 'muted' }, 'Allow camera access, point at a page, capture as many pages as you need, then Run.'));
  const video = document.createElement('video');
  video.setAttribute('playsinline', 'true');
  video.muted = true;
  video.className = 'scan-video';
  const startBtn = el('button', { class: 'btn', type: 'button' }, 'Start camera');
  const capBtn = el('button', { class: 'btn primary', type: 'button' }, 'Capture page');
  capBtn.setAttribute('disabled', 'true');
  let stream: MediaStream | null = null;

  startBtn.addEventListener('click', async () => {
    try {
      stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' }, audio: false });
      video.srcObject = stream;
      await video.play();
      capBtn.removeAttribute('disabled');
      setStatus('Camera on — capture pages.', 'ok');
    } catch {
      setStatus('Camera blocked. Upload photos with the dropzone instead.', 'error');
    }
  });
  capBtn.addEventListener('click', () => {
    const c = document.createElement('canvas');
    c.width = video.videoWidth || 1280;
    c.height = video.videoHeight || 720;
    c.getContext('2d')!.drawImage(video, 0, 0);
    c.toBlob((blob) => {
      if (!blob) return;
      state.files.push(new File([blob], `scan-${state.files.length + 1}.jpg`, { type: 'image/jpeg' }));
      repaint();
      setStatus(`${state.files.length} page(s) captured.`, 'ok');
    }, 'image/jpeg', 0.92);
  });
  wrap.append(video, el('div', { class: 'row' }, startBtn, capBtn));
  live.append(wrap);
  onRouteLeave(() => stream?.getTracks().forEach((t) => t.stop()));
}
