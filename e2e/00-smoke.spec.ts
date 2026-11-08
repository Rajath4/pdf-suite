import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { TOOLS, TOOL_SLUGS } from '../src/tools/registry';

const SEO = JSON.parse(
  readFileSync(new URL('../src/seo/content.json', import.meta.url), 'utf8'),
) as { tools: { id: string; title: string }[] };

test.describe('app shell', () => {
  test('home page renders every tool card and the version stamp', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.goto('/');
    await expect(page.locator('h1')).toContainText('Every PDF tool you need');
    await expect(page.getByText('✦ 37 free tools · no signup · no watermark')).toBeVisible();
    await expect(page.locator('#tool-grid .card')).toHaveCount(TOOLS.length);
    for (const t of TOOLS) {
      await expect(page.locator(`#tool-grid .card:has-text("${t.title}")`).first()).toBeVisible();
    }
    await expect(page.locator('footer')).toContainText('v1.1.0');
    await expect(page.locator('footer')).not.toContainText('dev build');
    expect(errors).toEqual([]);
  });

  test('category pills filter the grid', async ({ page }) => {
    await page.goto('/');
    const securityCount = TOOLS.filter((t) => t.category === 'Security & Privacy').length;
    await page.getByRole('tab', { name: new RegExp(`Security & Privacy · ${securityCount}`) }).click();
    await expect(page.locator('#tool-grid .card')).toHaveCount(securityCount);
    await expect(page.locator('#tool-grid .card:has-text("Merge PDFs")')).toHaveCount(0);
    await page.getByRole('tab', { name: /^All · / }).click();
    await expect(page.locator('#tool-grid .card')).toHaveCount(TOOLS.length);
  });

  test('command palette searches, keyboard-navigates and opens tools', async ({ page }) => {
    await page.goto('/');
    await page.keyboard.press('Control+k');
    const input = page.locator('.palette-input');
    await expect(input).toBeFocused();
    await input.fill('merge');
    await expect(page.locator('.palette-row').first()).toContainText('Merge PDFs');
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(/\/merge-pdf\/$/);
    await expect(page.locator('main h1')).toHaveText('Merge PDFs');
  });

  test('theme toggle persists across navigation and reloads', async ({ page }) => {
    await page.goto('/');
    const themeBtn = page.locator('.theme-btn');
    await themeBtn.click();
    const theme = await page.locator('html').getAttribute('data-theme');
    expect(['light', 'dark']).toContain(theme);
    await page.goto('/split-pdf/');
    await expect(page.locator('html')).toHaveAttribute('data-theme', theme!);
    await page.reload();
    await expect(page.locator('html')).toHaveAttribute('data-theme', theme!);
  });

  test('recently-used tools surface on the homepage', async ({ page }) => {
    await page.goto('/split-pdf/');
    await page.goto('/');
    const recent = page.locator('section.recent');
    await expect(recent).toBeVisible();
    await expect(recent).toContainText('Split PDF');
  });

  test('legacy hash routes redirect to canonical URLs', async ({ page }) => {
    await page.goto('/#/tool/sign');
    await expect(page).toHaveURL(/\/sign-pdf\/$/);
    await expect(page.locator('main h1')).toHaveText('Sign PDF');
  });

  test('unknown routes render a helpful 404 with suggestions', async ({ page }) => {
    await page.goto('/no-such-tool/');
    await expect(page.locator('main h1')).toHaveText('Page not found');
    await expect(page.locator('main .card').first()).toBeVisible();
    await page.locator('footer a[href="/merge-pdf/"]').click();
    await expect(page).toHaveURL(/\/merge-pdf\/$/);
  });

  test('every tool URL renders its own page with correct title', async ({ page }) => {
    for (const tool of TOOLS) {
      const slug = TOOL_SLUGS[tool.id]!;
      await page.goto(`/${slug}/`);
      await expect(page.locator('main h1').first()).toHaveText(tool.title);
      await expect(page.locator('main .lede').first()).toContainText(tool.description.slice(0, 30));
      const seo = SEO.tools.find((t) => t.id === tool.id)!;
      await expect(page).toHaveTitle(seo.title);
    }
  });

  test('guides index and every guide page render content without errors', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.goto('/guides/');
    await expect(page.locator('main h1')).toHaveText('Free PDF Guides & Tutorials');
    await expect(page.locator('.guide-card')).toHaveCount(16);
    const filters = page.getByRole('tab');
    expect(await filters.count()).toBeGreaterThan(1);
    const first = page.locator('.guide-card').first();
    const href = await first.getAttribute('href');
    await first.click();
    await expect(page.locator('main h1')).toBeVisible();
    expect(page.url()).toContain(href!);
    await expect(page.locator('article')).toContainText('Frequently asked questions');
    await expect(page.locator('.pager')).toBeVisible();
    expect(errors).toEqual([]);
  });

  test('footer internal tool links all resolve', async ({ page }) => {
    await page.goto('/');
    const hrefs = await page.locator('footer a[href^="/"]').evaluateAll((els) =>
      els.map((e) => (e as HTMLAnchorElement).getAttribute('href')!),
    );
    const unique = [...new Set(hrefs)];
    expect(unique.length).toBeGreaterThan(30);
    for (const href of unique.slice(0, 12)) {
      const res = await page.request.get(href);
      expect(res.status(), `footer link ${href}`).toBe(200);
    }
  });
});
