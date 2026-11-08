// Submit the built sitemap to IndexNow (Bing, Yandex, Seznam, Naver and
// other participating engines). Google ignores IndexNow and discovers URLs
// through the sitemap + Search Console.
//
// Usage:
//   INDEXNOW_KEY=<key> npm run seo:indexnow
//
// The key must also be written to dist/<key>.txt. `npm run build` does that
// automatically when INDEXNOW_KEY is set during the build.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SITE = (process.env.SITE_URL || 'https://pdfhaven.app').replace(/\/+$/, '');
const key = process.env.INDEXNOW_KEY;
if (!key) {
  console.error('INDEXNOW_KEY is required (get one at https://www.indexnow.org/documentation).');
  process.exit(1);
}

const sitemap = readFileSync(join(ROOT, 'dist', 'sitemap.xml'), 'utf8');
const urlList = [...sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
if (urlList.length === 0) {
  console.error('No URLs found in dist/sitemap.xml — run npm run build first.');
  process.exit(1);
}

const body = {
  host: new URL(SITE).host,
  key,
  keyLocation: `${SITE}/${key}.txt`,
  urlList,
};
const res = await fetch('https://api.indexnow.org/indexnow', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json; charset=utf-8' },
  body: JSON.stringify(body),
});
console.log(`IndexNow: ${res.status} ${res.statusText} — submitted ${urlList.length} URLs`);
if (res.status >= 300) {
  console.error(await res.text());
  process.exit(1);
}
