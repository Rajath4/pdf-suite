import { defineConfig, type Plugin } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';
import { execSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';

/** Emits dist/version.json so the UI, support and uptime checks can report the exact build. */
function buildMeta(): Plugin {
  return {
    name: 'build-meta',
    writeBundle() {
      // Never fail the build (e.g. Docker build without .git).
      let commit = 'dev';
      try {
        commit = execSync('git rev-parse --short HEAD', { stdio: ['ignore', 'pipe', 'ignore'] })
          .toString()
          .trim();
      } catch {
        /* ignore */
      }
      writeFileSync(
        new URL('./dist/version.json', import.meta.url),
        JSON.stringify(
          {
            // Keep in sync with package.json on release.
            version: '1.1.0',
            commit,
            builtAt: new Date().toISOString(),
          },
          null,
          2,
        ),
      );
    },
  };
}

export default defineConfig({
  base: './',
  server: {
    port: 5173,
  },
  preview: {
    port: 4173,
  },
  build: {
    target: 'es2020',
    sourcemap: false,
    chunkSizeWarningLimit: 2500,
  },
  worker: {
    format: 'es',
  },
  optimizeDeps: {
    exclude: ['pdfjs-dist'],
  },
  plugins: [
    buildMeta(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['icons/*.png'],
      manifest: {
        name: 'PDF Suite — Free Offline PDF Tools',
        short_name: 'PDF Suite',
        description:
          'Merge, split, compress, convert, edit and secure PDFs entirely on your device. No upload, no watermark.',
        theme_color: '#e11d48',
        background_color: '#fafafa',
        display: 'standalone',
        orientation: 'any',
        scope: './',
        start_url: './',
        categories: ['productivity', 'utilities'],
        // Deep-link shortcuts + "Open with" file handling (progressive
        // enhancement — supported browsers get native-grade integration).
        shortcuts: [
          { name: 'Merge PDFs', url: './#/tool/merge', icons: [{ src: 'icons/icon-192.png', sizes: '192x192' }] },
          { name: 'Split PDF', url: './#/tool/split', icons: [{ src: 'icons/icon-192.png', sizes: '192x192' }] },
          { name: 'Compress PDF', url: './#/tool/compress', icons: [{ src: 'icons/icon-192.png', sizes: '192x192' }] },
        ],
        file_handlers: [
          { action: './', accept: { 'application/pdf': ['.pdf'] } },
        ],
        icons: [
          {
            src: 'icons/icon-192.png',
            sizes: '192x192',
            type: 'image/png',
          },
          {
            src: 'icons/icon-512.png',
            sizes: '512x512',
            type: 'image/png',
          },
          {
            src: 'icons/icon-512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'any',
          },
          {
            src: 'icons/maskable-512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable',
          },
        ],
      },
      workbox: {
        // App shell is a hash-router SPA: serve index.html for navigations.
        navigateFallback: 'index.html',
        // Main bundle + pdf.js worker exceed workbox's 2 MB default.
        maximumFileSizeToCacheInBytes: 8 * 1024 * 1024,
        globPatterns: ['**/*.{js,css,html,json,txt,webmanifest,png,svg,mjs}'],
        runtimeCaching: [
          {
            // Tesseract.js lazily fetches its WASM/core from a CDN on first OCR
            // use — cache it so OCR keeps working offline afterwards.
            urlPattern: /^https:\/\/cdn\.jsdelivr\.net\/.*/i,
            handler: 'CacheFirst',
            options: {
              cacheName: 'tesseract-cdn',
              expiration: { maxEntries: 20, maxAgeSeconds: 60 * 60 * 24 * 30 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
        ],
      },
    }),
  ],
});
