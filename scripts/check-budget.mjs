// Performance budget gate: fails `npm run build` if the app gets too heavy.
// Budgets target an installable PWA that loads fast on mid-range mobile:
//   - entry chunk (homepage shell, no PDF engines) <= 150 KB raw
//   - total JS payload                            <= 3.9 MB raw
//   - total dist                                  <= 6.0 MB
// Note: the JS floor (~3.6 MB) is fixed third-party cost — pdf.js worker
// (~1.4 MB) + SheetJS (~0.9 MB) + pdf-lib (~0.5 MB) + pptxgenjs (~0.3 MB).
// They load lazily and precache for offline; what matters for startup is
// the entry chunk. The 3.9 MB ceiling (up from 3.8) pays for the qpdf
// encryption engine wrapper (~45 KB, lazy) that made Protect PDF real.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = dirname(fileURLToPath(import.meta.url));
const DIST = join(ROOT, '..', 'dist');
const KB = 1024;
const MB = 1024 * KB;

const fail = (msg) => {
  console.error(`\nBUDGET FAILED: ${msg}\n`);
  process.exit(1);
};

const bytes = (p) => statSync(p).size;
const dirSize = (dir) => {
  let total = 0;
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    total += e.isDirectory() ? dirSize(p) : bytes(p);
  }
  return total;
};

// 1. Entry chunk: the module script referenced by dist/index.html.
const html = readFileSync(join(DIST, 'index.html'), 'utf8');
const entry = [...html.matchAll(/<script[^>]+src="([^"]+\.js)"/g)].map((m) => m[1])[0];
if (!entry) fail('no entry script found in dist/index.html');
const entryPath = join(DIST, entry.replace(/^\.\//, ''));
const entrySize = bytes(entryPath);
console.log(`entry  ${entry}  ${(entrySize / KB).toFixed(1)} KB (budget 150 KB)`);
if (entrySize > 150 * KB) {
  fail(`entry chunk is ${(entrySize / KB).toFixed(0)} KB — move heavy imports behind dynamic import().`);
}

// 2. Total JS.
let jsTotal = 0;
const walk = (dir) => {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) walk(p);
    else if (e.name.endsWith('.js') || e.name.endsWith('.mjs')) jsTotal += bytes(p);
  }
};
walk(DIST);
console.log(`js     total ${(jsTotal / MB).toFixed(2)} MB (budget 3.9 MB)`);
if (jsTotal > 3.9 * MB) fail('JS payload too large — split vendors or drop a dependency.');

// 3. Total dist.
const total = dirSize(DIST);
console.log(`dist   total ${(total / MB).toFixed(2)} MB (budget 6.0 MB)`);
if (total > 6.0 * MB) fail('dist too large for a fast PWA install.');

console.log('\nBudgets OK.');
