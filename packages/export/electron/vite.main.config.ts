import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

// The Electron main-process entries as self-contained ES modules (workspace packages ship TypeScript,
// so they are bundled; only electron stays external). Output: packages/export/dist/<entry>.mjs, next to
// export-page/, which exportProject finds relative to its own bundle.
export default defineConfig({
  root: fileURLToPath(new URL('.', import.meta.url)),
  logLevel: 'warn',
  ssr: { noExternal: true, target: 'node' },
  build: {
    ssr: true,
    outDir: '../dist',
    emptyOutDir: true, // runs before the page build, which then writes export-page/
    minify: false,
    target: 'node22',
    rollupOptions: {
      input: {
        check: fileURLToPath(new URL('./check.ts', import.meta.url)),
      },
      external: ['electron'],
      // Shared chunks stay next to the entries: exportProject finds export-page/ relative to its own file.
      output: { format: 'es', entryFileNames: '[name].mjs', chunkFileNames: '[name]-[hash].mjs' },
    },
  },
});
