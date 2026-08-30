import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';
import path from 'path';
import fs from 'fs';

// Dev server uses the local self-signed cert so phones get a secure context
// (needed for camera/QR + service worker). Set XDECK_DEV_HTTP=1 to serve plain HTTP.
const httpsConfig = (() => {
  if (process.env.XDECK_DEV_HTTP === '1') return undefined;
  try {
    return {
      key: fs.readFileSync(path.resolve(__dirname, 'key.pem')),
      cert: fs.readFileSync(path.resolve(__dirname, 'cert.pem')),
    };
  } catch {
    return undefined;
  }
})();

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['logo.png'],
      manifest: {
        name: 'XDECK - LAN Stream Deck',
        short_name: 'XDECK',
        description: 'Personal remote control over your local WiFi',
        theme_color: '#6366f1',
        background_color: '#1a1a2e',
        display: 'standalone',
        orientation: 'any',
        start_url: '/',
        icons: [
          {
            src: 'logo.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'any',
          },
          {
            src: 'logo.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable',
          },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,ico,png,svg}'],
      },
    }),
  ],
  resolve: {
    alias: {
      '@shared': path.resolve(__dirname, '../shared'),
    },
  },
  server: {
    host: '0.0.0.0',
    https: httpsConfig,
    port: 5173,
    proxy: {
      '/deck': {
        target: 'ws://127.0.0.1:8787',
        ws: true,
        changeOrigin: true,
      },
      '/pairing': {
        target: 'http://127.0.0.1:8787',
        changeOrigin: true,
      },
      '/pairing/regenerate': {
        target: 'http://127.0.0.1:8787',
        changeOrigin: true,
      },
      '/upload': {
        target: 'http://127.0.0.1:8787',
        changeOrigin: true,
      },
      '/config': {
        target: 'http://127.0.0.1:8787',
        changeOrigin: true,
      },
      '/uploads': {
        target: 'http://127.0.0.1:8787',
        changeOrigin: true,
      },
      '/relay': {
        target: 'ws://127.0.0.1:9000',
        ws: true,
        changeOrigin: true,
      },
    },
  },
});
