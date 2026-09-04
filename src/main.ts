import './styles.css';
import { CATEGORIES, TOOLS, getTool } from './tools/registry.js';
import { el, field, textInput, textArea, selectInput, statusBox } from './ui/components.js';
import { downloadBlob, formatBytes, baseName } from './lib/fileUtils.js';
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
window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  deferredInstall = e as BeforeInstallPromptEvent;
  document.querySelectorAll<HTMLButtonElement>('.install-btn').forEach((b) => {
    b.hidden = false;
  });
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
  const dot = el('span', { class: 'netdot', title: navigator.onLine ? 'Online' : 'Offline — app still works' });
  const paint = () => {
    dot.textContent = navigator.onLine ? '● online' : '● offline-ready';
    dot.dataset['off'] = String(!navigator.onLine);
  };
  paint();
  window.addEventListener('online', paint);
  window.addEventListener('offline', paint);
  return dot;
}

window.addEventListener('hashchange', render);
render();

function render(): void {
  app.innerHTML = '';
  const skip = el('a', { class: 'skip-link', href: '#main' }, 'Skip to content');
  app.append(skip);
  app.append(header());
  const hash = location.hash || '#/';
  if (hash.startsWith('#/tool/')) {
    const id = decodeURIComponent(hash.slice('#/tool/'.length));
    app.append(toolPage(id));
  } else {
    app.append(homePage());
  }
  app.append(footer());
  // SPA a11y: move focus to the new view so screen readers announce it.
  document.getElementById('main')?.focus({ preventScroll: true });
  window.scrollTo({ top: 0 });
}

// ---------- Header / footer / home ----------

function header(): HTMLElement {
  const h = el('header', { class: 'topbar' });
  const inner = el('div', { class: 'wrap topbar-inner' });
  const logo = el('a', { class: 'logo', href: '#/' }, '📕 PDF Suite');
  const nav = el('nav', { class: 'topnav' });
  const installBtn = el('button', { class: 'btn small install-btn', type: 'button' }, '⤓ Install');
  installBtn.hidden = !deferredInstall;
  installBtn.addEventListener('click', () => {
    void promptInstall();
  });
  nav.append(
    el('a', { href: '#/' }, 'All tools'),
    el('a', { href: '#/tool/merge' }, 'Merge'),
    el('a', { href: '#/tool/split' }, 'Split'),
    el('a', { href: '#/tool/compress' }, 'Compress'),
    installBtn,
    offlineDot(),
    el('span', { class: 'pill' }, '100% on-device'),
  );
  inner.append(logo, nav);
  h.append(inner);
  return h;
}

let cachedVersion: string | null = null;
async function appVersion(): Promise<string> {
  if (cachedVersion) return cachedVersion;
  try {
    const res = await fetch('version.json', { cache: 'no-store' });
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
  f.append(
    el('div', { class: 'wrap' },
      el('p', {}, 'PDF Suite — free, private PDF tools. Files never leave your device. No watermark, no sign-up. ', ver),
      el('p', { class: 'muted' }, 'Built with pdf-lib + pdf.js. Works offline after first load. Tip: run `npm run dev` locally or host the `dist/` folder anywhere static.'),
    ),
  );
  return f;
}

function homePage(): HTMLElement {
  const root = el('main', { class: 'wrap', id: 'main', tabindex: '-1' });

  const hero = el('section', { class: 'hero' });
  hero.append(
    el('div', { class: 'badges' }, '✓ No watermark   ✓ No upload   ✓ No sign-up   ✓ Works offline'),
    el('h1', {}, 'Free PDF tools that respect your privacy'),
    el('p', { class: 'lede' }, 'Merge, split, compress, convert, redact and sign — entirely in your browser. Inspired by ihatepdf.cv, rebuilt as a clean offline-first clone.'),
  );
  const search = textInput('', 'Search tools… try “merge”, “word”, “password”…');
  search.setAttribute('type', 'search');
  search.setAttribute('aria-label', 'Search tools');
  hero.append(search);
  const installBanner = el('div', { class: 'install-banner' });
  installBanner.append(
    el('span', {}, '📲 Install PDF Suite for offline use — works like a native app, no app store needed.'),
  );
  const installCta = el('button', { class: 'btn primary small', type: 'button' }, 'Install app');
  installCta.addEventListener('click', () => {
    void promptInstall();
  });
  installBanner.append(installCta);
  hero.append(installBanner);
  root.append(hero);

  const gridRoot = el('div', { id: 'tool-grid' });
  root.append(gridRoot);

  const renderGrid = (q: string) => {
    gridRoot.innerHTML = '';
    const query = q.trim().toLowerCase();
    for (const cat of CATEGORIES) {
      const tools = TOOLS.filter(
        (t) =>
          t.category === cat &&
          (!query || `${t.title} ${t.description}`.toLowerCase().includes(query)),
      );
      if (tools.length === 0) continue;
      const section = el('section', { class: 'cat' });
      section.append(el('h2', {}, cat));
      const grid = el('div', { class: 'grid' });
      for (const t of tools) {
        const card = el('a', { class: 'card', href: `#/tool/${t.id}` });
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
    if (!gridRoot.children.length) {
      gridRoot.append(el('p', { class: 'muted' }, 'No tools match your search.'));
    }
  };
  search.addEventListener('input', () => renderGrid(search.value));
  renderGrid('');

  // Press "/" anywhere on the homepage to jump to search.
  const onKey = (e: KeyboardEvent) => {
    const target = e.target as HTMLElement | null;
    const typing = target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable);
    if (e.key === '/' && !typing) {
      e.preventDefault();
      search.focus();
    }
  };
  window.addEventListener('keydown', onKey);
  window.addEventListener('hashchange', () => window.removeEventListener('keydown', onKey), { once: true });

  const faq = el('section', { class: 'faq' });
  faq.append(el('h2', {}, 'How it works'));
  const items: [string, string][] = [
    ['Are my files uploaded anywhere?', 'No. Every tool runs with JavaScript/WASM in your tab. Disconnect the internet after load and everything still works.'],
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
    root.append(el('h1', {}, 'Tool not found'), el('p', {}, 'Go back to '), el('a', { href: '#/' }, 'all tools.'));
    return root;
  }
  const current: ToolDef = tool;
  // Warm the engine chunks as soon as a tool page opens — Run then feels instant.
  void loadActions().catch(() => {});

  root.append(el('a', { class: 'back', href: '#/' }, '← All tools'));
  root.append(el('h1', {}, `${current.icon} ${current.title}`));
  root.append(el('p', { class: 'lede' }, current.description));
  root.append(el('p', { class: 'pill-line' }, '🔒 Files stay on your device — nothing is uploaded.'));

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

  // Dropzone
  const drop = el('div', { class: 'drop', tabindex: '0', role: 'button' });
  drop.append(
    el('div', { class: 'drop-title' }, current.accept ? 'Drop files here or click to browse' : 'No file needed — or optionally drop one'),
    el('div', { class: 'muted' }, current.accept ? `Accepted: ${current.accept}` : 'This tool can run from text alone.'),
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
      listBox.append(el('p', { class: 'muted' }, 'No files yet.'));
      return;
    }
    state.files.forEach((f, i) => {
      const row = el('div', { class: 'filerow' });
      row.append(el('span', { class: 'fname' }, `${i + 1}. ${f.name} (${formatBytes(f.size)})`));
      const btns = el('span', { class: 'frow-btns' });
      if (current.multiple && state.files.length > 1) {
        const up = el('button', { class: 'btn small', type: 'button' }, '↑');
        up.setAttribute('aria-label', `Move ${f.name} up`);
        up.addEventListener('click', () => {
          if (i === 0) return;
          [state.files[i - 1], state.files[i]] = [state.files[i], state.files[i - 1]];
          paintFiles();
          onFilesChanged();
        });
        const down = el('button', { class: 'btn small', type: 'button' }, '↓');
        down.setAttribute('aria-label', `Move ${f.name} down`);
        down.addEventListener('click', () => {
          if (i === state.files.length - 1) return;
          [state.files[i + 1], state.files[i]] = [state.files[i], state.files[i + 1]];
          paintFiles();
          onFilesChanged();
        });
        btns.append(up, down);
      }
      const rm = el('button', { class: 'btn small danger', type: 'button' }, 'Remove');
      rm.addEventListener('click', () => {
        state.files.splice(i, 1);
        paintFiles();
        onFilesChanged();
      });
      btns.append(rm);
      row.append(btns);
      listBox.append(row);
    });
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
  }

  if (current.id === 'scan') mountScanner(live, state, paintFiles, setStatus);

  const runBtn = el('button', { class: 'btn primary big', type: 'button' }, `Run — ${current.title}`);
  const startOver = el('button', { class: 'btn', type: 'button' }, 'Start over');
  startOver.addEventListener('click', () => render());
  const results = el('div', { class: 'results' });

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
  };

  runBtn.addEventListener('click', async () => {
    results.innerHTML = '';
    if (current.id === 'compare') {
      setStatus('Compare renders live above — no download needed.', 'info');
      return;
    }
    runBtn.setAttribute('disabled', 'true');
    runBtn.textContent = 'Working…';
    try {
      setStatus('Loading engine…', 'info');
      const { runTool } = await loadActions();
      const batchSuffix = BATCH_SUFFIX[current.id];
      if (batchSuffix && state.files.length > 1) {
        // Enterprise batch path: process each file identically, zip the results.
        const { default: JSZip } = await import('jszip');
        const zip = new JSZip();
        let inBytes = 0;
        let outBytes = 0;
        for (let i = 0; i < state.files.length; i++) {
          const f = state.files[i];
          setStatus(`Batch ${i + 1}/${state.files.length}: ${f.name}…`, 'info');
          const outs = await runTool(
            current.id,
            { files: [f], opts: getOpts(), onProgress: () => {} },
          );
          zip.file(`${baseName(f.name)}-${batchSuffix}.pdf`, outs[0].blob);
          inBytes += f.size;
          outBytes += outs[0].blob.size;
        }
        setStatus('Zipping results…', 'info');
        const blob = await zip.generateAsync({ type: 'blob' });
        const filename = `${current.id}-batch-${state.files.length}-files.zip`;
        setStatus(`Done — ${state.files.length} files processed.`, 'ok');
        showStats(inBytes, outBytes);
        showOutputs(
          [{ blob, filename, note: `Batch ${current.title.toLowerCase()}: ${state.files.length} files, same settings applied to each.` }],
          true,
        );
        paintSteps(3);
        return;
      }
      setStatus('Working…', 'info');
      const opts = getOpts();
      const outs = await runTool(current.id, {
        files: [...state.files],
        opts,
        onProgress: (m) => setStatus(m, 'info'),
      });
      setStatus(`Done — ${outs.length} file${outs.length > 1 ? 's' : ''} ready.`, 'ok');
      // Best-in-class touch: show input → output size for every run.
      showStats(
        state.files.reduce((a, f) => a + f.size, 0),
        outs.reduce((a, o) => a + o.blob.size, 0),
      );
      // Auto-download outputs for convenience + keep buttons for re-download.
      showOutputs(outs, true);
      paintSteps(3);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setStatus(msg, 'error');
    } finally {
      runBtn.removeAttribute('disabled');
      runBtn.textContent = `Run — ${current.title}`;
    }
  });

  root.append(drop, listBox, optsBox, live, el('div', { class: 'row' }, runBtn, startOver), status, results);

  const tips = el('details', { class: 'tips' });
  tips.append(el('summary', {}, 'Tips & limits'), el('p', {},
    'Large PDFs are limited by device memory. Password-protected files must be unlocked first. Rasterizing tools (Heavy compress, Invert, Dark mode) produce smaller or recolored files but text is no longer selectable.'));
  root.append(tips);

  paintFiles();
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
      ], 'ranges'));
      add('Pages (e.g. 1-3, 5)', 'ranges', textInput('1-3, 5'));
      break;
    case 'compress':
      add('Preset', 'preset', selectInput([
        { value: 'light', label: 'Light — best quality' },
        { value: 'medium', label: 'Medium — balanced (recommended)' },
        { value: 'heavy', label: 'Heavy — smallest file' },
        { value: 'lossless', label: 'Lossless — re-save only (keeps text sharp)' },
      ], 'medium'));
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
      add('Text', 'text', textInput('CONFIDENTIAL'));
      add('Opacity (0.05–0.6)', 'opacity', textInput('0.25', '', 'number'));
      add('Font size', 'size', textInput('48', '', 'number'));
      add('Rotation degrees', 'rotation', textInput('-45', '', 'number'));
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
        { value: 'strip', label: 'Strip metadata + download clean PDF' },
      ], 'inspect'));
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
    case 'extract-text':
    case 'ocr':
    case 'flatten':
    case 'repair':
    case 'invert':
    case 'pdf-to-word':
    case 'word-to-pdf':
    case 'pdf-to-excel':
    case 'pdf-to-html':
    case 'pdf-to-pptx':
    case 'pptx-to-pdf':
      box.append(el('p', { class: 'muted' }, 'No extra settings — upload and Run.'));
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
      wrap.append(grid);

      const paint = async () => {
        grid.innerHTML = '';
        sync();
        for (const p of order) {
          if (deleted.has(p)) continue;
          const card = el('div', { class: 'thumb' });
          const { canvas } = await renderPage(bytes.slice(0), p + 1, 0.55);
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
  live.append(el('p', { class: 'muted' }, 'Upload exactly 2 PDFs (use the dropzone above), then scroll either side — they stay in sync.'));
  if (state.files.length < 2) {
    live.append(el('p', { class: 'muted' }, `Waiting for 2 files (have ${state.files.length}).`));
    return;
  }
  const [a, b] = state.files;
  const cols = el('div', { class: 'compare' });
  const left = el('div', { class: 'compare-col' });
  const right = el('div', { class: 'compare-col' });
  left.append(el('h3', {}, a.name));
  right.append(el('h3', {}, b.name));
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
  window.addEventListener('hashchange', () => stream?.getTracks().forEach((t) => t.stop()), { once: true });
}
