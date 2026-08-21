import path from 'node:path';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const DEV_HOST = (process.env.VITE_DEV_HOST || '127.0.0.1').trim() || '127.0.0.1';

export default defineConfig(({ mode }) => {
    return {
      server: {
        port: 3000,
        host: DEV_HOST,
        proxy: {
          // Keep API keys server-side; frontend calls a local API proxy.
          '/api': 'http://127.0.0.1:8787',
        },
      },
      plugins: [react()],
      test: {
        environment: 'jsdom',
        include: ['__tests__/**/*.test.ts'],
      },
      resolve: {
        alias: {
          '@': path.resolve(import.meta.dirname, '.'),
        }
      }
    };
});
