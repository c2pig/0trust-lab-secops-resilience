import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  base: '/secops-resilience/',
  plugins: [react()],
  server: {
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:8080',
        changeOrigin: false,
        headers: {
          'x-forwarded-host': 'localhost:5178',
          'x-forwarded-proto': 'http'
        }
      }
    }
  },
  build: {
    outDir: 'dist',
    sourcemap: true
  }
});
