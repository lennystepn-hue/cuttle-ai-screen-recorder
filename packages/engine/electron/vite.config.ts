import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

// Bundles page.ts into one classic script. Library mode inlines the fonts as data: URLs,
// so the page works from file:// without fetching anything.
export default defineConfig({
  root: fileURLToPath(new URL('.', import.meta.url)),
  logLevel: 'warn',
  define: { 'process.env.NODE_ENV': '"production"' },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    minify: false,
    lib: {
      entry: fileURLToPath(new URL('./page.ts', import.meta.url)),
      formats: ['iife'],
      name: 'CuttleEngineCheck',
      fileName: () => 'page.js',
    },
  },
});
