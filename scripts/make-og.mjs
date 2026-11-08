// Regenerates public/og.jpg (1200x630) used for Open Graph, Twitter and
// schema.org image metadata. Run after changing the brand copy: `npm run og`.
// Uses the locally installed Chrome channel, matching the Playwright config.
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'public', 'og.jpg');

const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<style>
  * { box-sizing: border-box; }
  html, body { margin: 0; width: 1200px; height: 630px; overflow: hidden; }
  body {
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
    color: #fff;
    background:
      radial-gradient(900px 480px at 88% -10%, rgba(244, 63, 94, 0.5), transparent 65%),
      radial-gradient(700px 420px at -10% 110%, rgba(99, 102, 241, 0.42), transparent 65%),
      linear-gradient(135deg, #0b1020 0%, #12172b 55%, #1b1024 100%);
    padding: 64px 72px;
    display: flex;
    flex-direction: column;
    justify-content: space-between;
  }
  .top { display: flex; align-items: center; gap: 18px; }
  .mark {
    width: 64px; height: 64px; border-radius: 16px;
    background: linear-gradient(145deg, #f43f5e, #be123c);
    display: grid; place-items: center;
    font-weight: 800; font-size: 23px; letter-spacing: 0.5px;
    box-shadow: 0 12px 40px rgba(244, 63, 94, 0.45);
  }
  .brand { font-size: 28px; font-weight: 700; letter-spacing: -0.02em; }
  .brand span { color: #fda4af; font-weight: 500; }
  h1 { margin: 0; font-size: 74px; line-height: 1.03; letter-spacing: -0.045em; font-weight: 800; max-width: 980px; }
  h1 em { font-style: normal; background: linear-gradient(92deg, #fda4af, #f43f5e 55%, #fb7185); -webkit-background-clip: text; background-clip: text; color: transparent; }
  .sub { margin: 22px 0 0; font-size: 27px; line-height: 1.35; color: #cbd5e1; font-weight: 450; max-width: 900px; }
  .bottom { display: flex; align-items: center; justify-content: space-between; }
  .pills { display: flex; gap: 12px; }
  .pill {
    font-size: 18px; font-weight: 600; color: #e2e8f0;
    border: 1px solid rgba(255,255,255,0.18); background: rgba(255,255,255,0.06);
    padding: 10px 16px; border-radius: 999px;
  }
  .url { font-size: 22px; font-weight: 600; color: #94a3b8; letter-spacing: 0.01em; }
  .url strong { color: #fff; }
</style>
</head>
<body>
  <div class="top">
    <div class="mark">PDF</div>
    <div class="brand">PDF Haven <span>· pdfhaven.app</span></div>
  </div>
  <div>
    <h1>Every PDF tool you need.<br /><em>Private by design.</em></h1>
    <p class="sub">37 free tools that run 100% in your browser — merge, compress, sign, convert, redact and OCR. No uploads, no signup, no watermark.</p>
  </div>
  <div class="bottom">
    <div class="pills"><span class="pill">No upload</span><span class="pill">No watermark</span><span class="pill">Works offline</span></div>
    <div class="url"><strong>pdfhaven.app</strong></div>
  </div>
</body>
</html>`;

mkdirSync(dirname(OUT), { recursive: true });
const browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL || 'chrome' });
const page = await browser.newPage({ viewport: { width: 1200, height: 630 }, deviceScaleFactor: 1 });
await page.setContent(html, { waitUntil: 'load' });
await page.screenshot({ path: OUT, type: 'jpeg', quality: 88 });
await browser.close();
console.log(`wrote ${OUT}`);
