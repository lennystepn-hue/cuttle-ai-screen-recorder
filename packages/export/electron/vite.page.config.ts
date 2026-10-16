import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

// The export page: one classic script (library mode inlines the engine's fonts as data: URLs), plus
// index.html and preload.cjs copied from export-page/. Output: packages/export/dist/export-page/.
export default defineConfig({
  root: fileURLToPath(new URL('.', import.meta.url)),
  publicDir: 'export-page',
  logLevel: 'warn',
  define: { 'process.env.NODE_ENV': '"production"' },
  build: {
    outDir: '../dist/export-page',
    emptyOutDir: true,
    minify: false,
    lib: {
      entry: fileURLToPath(new URL('../src/page/index.ts', import.meta.url)),
      formats: ['iife'],
      name: 'CuttleExportPage',
      fileName: () => 'page.js',
    },
  },
});
