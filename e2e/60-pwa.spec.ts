import { test, expect } from '@playwright/test';

test.describe('PWA install & offline', () => {
  test.use({ serviceWorkers: 'allow' });

  test('serves manifest, icons and install metadata', async ({ page, request }) => {
    await page.goto('/');
    const manifestHref = await page.locator('link[rel="manifest"]').getAttribute('href');
    expect(manifestHref).toBeTruthy();
    const res = await request.get(manifestHref!);
    expect(res.ok()).toBe(true);
    const manifest = await res.json();
    expect(manifest.name).toContain('PDF Haven');
    expect(manifest.display).toBe('standalone');
    expect(manifest.icons.length).toBeGreaterThanOrEqual(2);

    const icon = await request.get('/icons/icon-192.png');
    expect(icon.ok()).toBe(true);
    expect(icon.headers()['content-type']).toContain('image/png');

    expect((await request.get('/robots.txt')).ok()).toBe(true);
    expect((await request.get('/sitemap.xml')).ok()).toBe(true);
    expect((await request.get('/version.json')).ok()).toBe(true);
  });

  test('service worker leaves sitemap and crawler files to the network', async ({ page }) => {
    await page.goto('/');
    await page.evaluate(async () => {
      await navigator.serviceWorker.ready;
      if (!navigator.serviceWorker.controller) {
        await new Promise<void>((resolve) => {
          navigator.serviceWorker.addEventListener('controllerchange', () => resolve(), { once: true });
          setTimeout(resolve, 15_000);
        });
      }
    });
    expect(await page.evaluate(() => !!navigator.serviceWorker.controller)).toBe(true);

    const res = await page.goto('/sitemap.xml');
    expect(res?.status()).toBe(200);
    expect(res?.headers()['content-type']).toContain('xml');
    const body = await res!.text();
    expect(body).toContain('<urlset');
    expect(body).toContain('https://pdfhaven.app/');
  });

  test('works fully offline after the service worker precaches the app', async ({ page, context }) => {
    test.setTimeout(180_000);
    await page.goto('/');
    await page.evaluate(async () => {
      await navigator.serviceWorker.ready;
      if (!navigator.serviceWorker.controller) {
        await new Promise<void>((resolve) => {
          navigator.serviceWorker.addEventListener('controllerchange', () => resolve(), { once: true });
          setTimeout(resolve, 15_000);
        });
      }
    });
    await context.setOffline(true);
    await page.reload();
    await expect(page.locator('main h1').first()).toBeVisible();
    await expect(page.locator('.tool-card, .card').first()).toBeVisible();
    await page.goto('/merge-pdf/');
    await expect(page.locator('main h1').first()).toBeVisible();
    await context.setOffline(false);
  });
});
