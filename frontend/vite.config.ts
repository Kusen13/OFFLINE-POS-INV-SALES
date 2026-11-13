import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { VitePWA } from 'vite-plugin-pwa'
import basicSsl from '@vitejs/plugin-basic-ssl'
import { defineConfig, type Plugin } from 'vite'
import fs from 'node:fs'
import path from 'node:path'

const buildTime = Date.now();

// Custom plugin to write version.json during build for client-side auto-update detection
function versionManifestPlugin(): Plugin {
  return {
    name: 'version-manifest-plugin',
    buildStart() {
      const manifest = JSON.stringify({
        version: buildTime,
        buildTimeISO: new Date(buildTime).toISOString(),
      });
      try {
        const rootDir = import.meta.dirname || process.cwd();
        const publicDir = path.resolve(rootDir, 'public');
        if (!fs.existsSync(publicDir)) {
          fs.mkdirSync(publicDir, { recursive: true });
        }
        fs.writeFileSync(path.join(publicDir, 'version.json'), manifest, 'utf8');
      } catch (_) {}
    },
    generateBundle() {
      this.emitFile({
        type: 'asset',
        fileName: 'version.json',
        source: JSON.stringify({
          version: buildTime,
          buildTimeISO: new Date(buildTime).toISOString(),
        }),
      });
    },
  };
}

// https://vite.dev/config/
export default defineConfig({
  define: {
    __APP_BUILD_TIME__: JSON.stringify(buildTime),
  },
  plugins: [
    basicSsl(),
    react(),
    tailwindcss(),
    versionManifestPlugin(),
    VitePWA({
      registerType: 'autoUpdate',
      injectRegister: 'auto',
      includeAssets: ['icons/*.svg'],
      manifest: {
        name: 'POS - Point of Sale',
        short_name: 'POS',
        description: 'Offline-first Point of Sale & Inventory System',
        theme_color: '#0f172a',
        background_color: '#0f172a',
        display: 'standalone',
        orientation: 'any',
        start_url: '/',
        scope: '/',
        icons: [
          {
            src: '/icons/icon-192.svg',
            sizes: '192x192',
            type: 'image/svg+xml',
          },
          {
            src: '/icons/icon-512.svg',
            sizes: '512x512',
            type: 'image/svg+xml',
          },
          {
            src: '/icons/icon-512.svg',
            sizes: '512x512',
            type: 'image/svg+xml',
            purpose: 'maskable',
          },
        ],
      },
      workbox: {
        skipWaiting: true,
        clientsClaim: true,
        cleanupOutdatedCaches: true,
        globPatterns: ['**/*.{js,css,html,ico,png,svg,woff2}'],
        navigateFallback: '/index.html',
        navigateFallbackDenylist: [/^\/api/, /version\.json$/, /reset\.html$/],
        runtimeCaching: [
          {
            // Version and reset files should NEVER be cached by Service Worker
            urlPattern: ({ url }) => url.pathname.endsWith('version.json') || url.pathname.endsWith('reset.html'),
            handler: 'NetworkOnly',
          },
          {
            // For navigation requests (HTML page): Network-first with 1.5s timeout.
            // If online, device ALWAYS gets the newest updated HTML bundle.
            // If offline, immediately falls back to local cached index.html!
            urlPattern: ({ request }) => request.mode === 'navigate',
            handler: 'NetworkFirst',
            options: {
              cacheName: 'pos-html-cache',
              networkTimeoutSeconds: 1.5,
              cacheableResponse: {
                statuses: [0, 200],
              },
            },
          },
          {
            // Cache same-origin app resources (scripts, styles, HTML, images, icons, modules)
            urlPattern: ({ url, sameOrigin }) => Boolean(sameOrigin && !url.pathname.startsWith('/api') && !url.pathname.endsWith('version.json')),
            handler: 'NetworkFirst',
            options: {
              cacheName: 'pos-app-cache',
              networkTimeoutSeconds: 2,
              expiration: {
                maxEntries: 500,
                maxAgeSeconds: 60 * 60 * 24 * 30, // 30 days
              },
              cacheableResponse: {
                statuses: [0, 200],
              },
            },
          },
          {
            urlPattern: /^https?:\/\/fonts\.googleapis\.com\/.*/i,
            handler: 'CacheFirst',
            options: {
              cacheName: 'google-fonts-cache',
              expiration: { maxEntries: 10, maxAgeSeconds: 60 * 60 * 24 * 365 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
          {
            urlPattern: /^https?:\/\/fonts\.gstatic\.com\/.*/i,
            handler: 'CacheFirst',
            options: {
              cacheName: 'gstatic-fonts-cache',
              expiration: { maxEntries: 10, maxAgeSeconds: 60 * 60 * 24 * 365 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
        ],
      },
      devOptions: {
        enabled: false,
      },
    }),
  ],
  server: {
    host: true,
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:80/OFFLINE-POS-INV-SALES',
        changeOrigin: true,
      },
    },
  },
  preview: {
    host: true,
    port: 4173,
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:80/OFFLINE-POS-INV-SALES',
        changeOrigin: true,
      },
    },
  },
  build: {
    outDir: 'dist',
    sourcemap: false,
    rollupOptions: {
      output: {
        manualChunks(id: string) {
          if (id.includes('node_modules/react') || id.includes('node_modules/react-dom') || id.includes('node_modules/react-router')) {
            return 'vendor';
          }
          if (id.includes('node_modules/recharts')) {
            return 'charts';
          }
          if (id.includes('node_modules/zustand') || id.includes('node_modules/idb')) {
            return 'state';
          }
        },
      },
    },
  },
  base: '/',
})
