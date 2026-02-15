import path from 'path';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(({ mode }) => {
    return {
      server: {
        port: 3000,
        host: '0.0.0.0',
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
          '@': path.resolve(__dirname, '.'),
        }
      }
    };
});
