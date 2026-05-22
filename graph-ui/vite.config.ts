import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { resolve } from 'node:path';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  build: {
    // Output into the path the CLI server statically serves at runtime.
    outDir: resolve(__dirname, '../runtime/graph-ui'),
    emptyOutDir: true,
    target: 'es2022',
    sourcemap: false,
  },
  server: {
    port: 5372,
    proxy: {
      '/api': 'http://127.0.0.1:5371',
    },
  },
  worker: {
    format: 'es',
  },
});
