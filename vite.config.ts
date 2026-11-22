import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  base: '/secops-resilience/',
  plugins: [react()],
  build: {
    outDir: 'dist',
    sourcemap: true
  }
});
