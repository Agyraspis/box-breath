import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

const DARK = '#0d0f12';

export default defineConfig({
  // Relative URLs, so dist/ works at a domain root or in a subfolder (e.g. GitHub Pages).
  base: './',
  plugins: [
    VitePWA({
      registerType: 'autoUpdate',
      injectRegister: 'script',
      includeManifestIcons: false,
      manifest: {
        name: 'Box Breath',
        short_name: 'Box Breath',
        description: 'Box breathing with a beep at every phase change and a binaural beat underneath. Use headphones.',
        theme_color: DARK,
        background_color: DARK,
        display: 'standalone',
        start_url: './',
        scope: './',
        icons: [
          { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
          { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
          { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'maskable' },
          { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        // Precache the whole app shell so it runs with the network off after the first visit.
        // (the plugin adds manifest.webmanifest itself; icons come from the png glob)
        globPatterns: ['**/*.{html,js,css,png,svg}'],
        cleanupOutdatedCaches: true,
        navigateFallback: 'index.html',
      },
    }),
  ],
});
