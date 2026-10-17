import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

// The CLI as self-contained ES modules: dist/cuttle.mjs (Node) and dist/electron.mjs (Electron's main
// process for render, preview and capture-page). Workspace packages ship TypeScript, so they are
// bundled; Electron and the native modules (koffi, uiohook-napi) stay external and load from
// node_modules. The export page goes to dist/export-page/ (root script cli:build), where
// @cuttle/export finds it next to the bundle.
export default defineConfig({
  root: fileURLToPath(new URL('.', import.meta.url)),
  logLevel: 'warn',
  ssr: { noExternal: true, target: 'node' },
  build: {
    ssr: true,
    outDir: 'dist',
    emptyOutDir: true,
    minify: false,
    target: 'node22',
    rollupOptions: {
      input: {
        cuttle: fileURLToPath(new URL('./src/bin.ts', import.meta.url)),
        electron: fileURLToPath(new URL('./src/electron/bootstrap.ts', import.meta.url)),
      },
      external: ['electron', 'koffi', 'uiohook-napi'],
      // Shared chunks stay next to the entries: export finds export-page/ relative to its own file.
      output: { format: 'es', entryFileNames: '[name].mjs', chunkFileNames: '[name]-[hash].mjs' },
    },
  },
});
