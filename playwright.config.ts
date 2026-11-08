import { defineConfig, devices } from '@playwright/test';

const PORT = 4173;

export default defineConfig({
  testDir: './e2e',
  globalSetup: './e2e/global-setup.ts',
  fullyParallel: true,
  forbidOnly: !!process.env['CI'],
  retries: process.env['CI'] ? 2 : 1,
  // The preview server is single-threaded and several tools compile heavy WASM
  // in-page; capping workers keeps navigations fast and the suite deterministic.
  workers: process.env['CI'] ? 2 : 4,
  timeout: 180_000,
  expect: { timeout: 30_000 },
  reporter: process.env['CI'] ? [['line'], ['html', { open: 'never' }]] : [['list']],
  use: {
    baseURL: `http://localhost:${PORT}`,
    navigationTimeout: 60_000,
    actionTimeout: 30_000,
    trace: 'on-first-retry',
    video: 'off',
    screenshot: 'only-on-failure',
    // The production SW is exercised in its own spec. Everywhere else it only
    // adds cross-test cache noise, so tests run against a clean network layer.
    serviceWorkers: 'block',
    acceptDownloads: true,
  },
  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        channel: process.env['PLAYWRIGHT_CHANNEL'] ?? 'chrome',
      },
    },
  ],
  webServer: {
    command: 'npm run preview',
    port: PORT,
    reuseExistingServer: !process.env['CI'],
    timeout: 120_000,
  },
});
