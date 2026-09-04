import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

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
        globPatterns: ['**/*.{js,css,html,png,svg,mjs}'],
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
