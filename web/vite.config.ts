import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    host: true,
    port: 5317,
    strictPort: true,
    proxy: { '/api': 'http://localhost:4317' },
    fs: { allow: ['..'] },
  },
  preview: { host: true, port: 5317 },
  build: { chunkSizeWarningLimit: 2500 },
});
