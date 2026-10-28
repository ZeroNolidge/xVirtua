import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      // We register manually (src/lib/pwa.ts) so an update never reloads the
      // page in the middle of a conversation.
      injectRegister: null,
      includeAssets: ['icon.svg', 'apple-touch-icon.png'],
      manifest: {
        name: 'PlainSpeak',
        short_name: 'PlainSpeak',
        description: 'Practice explaining medicine in plain, kind language.',
        theme_color: '#187a50',
        background_color: '#f7f5ef',
        display: 'standalone',
        orientation: 'portrait',
        start_url: '/',
        icons: [
          { src: 'icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
          {
            src: 'icon-maskable-512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable',
          },
          { src: 'icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' },
        ],
      },
      workbox: {
        // New deploys take over right away instead of waiting for every tab to close.
        skipWaiting: true,
        clientsClaim: true,
        cleanupOutdatedCaches: true,
        // The page itself is never served from the app's stored copy first,
        // so a normal reload always gets the newest version. The stored copy
        // is only for when there's no connection.
        globPatterns: ['**/*.{js,css,png,svg,ico,webmanifest}'],
        // The video avatar (large) downloads only for programs that use it.
        globIgnores: ['**/avatar-*.js'],
        navigateFallback: null,
        runtimeCaching: [
          {
            // Never API or auth traffic.
            urlPattern: ({ request, url }) =>
              request.mode === 'navigate' && !/^\/(__|api)\//.test(url.pathname),
            handler: 'NetworkFirst',
            options: { cacheName: 'pages', networkTimeoutSeconds: 5 },
          },
        ],
      },
    }),
  ],
  build: {
    rollupOptions: {
      output: {
        // Separate long-lived vendor chunks: they change rarely, so phones keep them cached.
        manualChunks(id: string) {
          if (!id.includes('node_modules')) return undefined;
          // The video avatar loads only when a program turns it on.
          if (id.includes('simli-client') || id.includes('livekit')) return 'avatar';
          if (id.includes('@firebase/firestore') || id.includes('firebase/firestore'))
            return 'firebase-firestore';
          if (id.includes('@firebase/auth') || id.includes('firebase/auth')) return 'firebase-auth';
          if (id.includes('firebase') || id.includes('@grpc') || id.includes('idb'))
            return 'firebase-core';
          if (id.includes('react')) return 'react';
          return 'vendor';
        },
      },
    },
  },
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test-setup.ts'],
  },
});
