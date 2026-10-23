import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

// The main process and the media worker as self-contained ES modules in dist/main/ (workspace
// packages ship TypeScript, so they are bundled; Electron and the native modules stay external).
// The export page goes to dist/main/export-page/, where @cuttle/export finds it next to its chunk.
export default defineConfig({
  root: fileURLToPath(new URL('.', import.meta.url)),
  logLevel: 'warn',
  ssr: { noExternal: true, target: 'node' },
  build: {
    ssr: true,
    outDir: 'dist/main',
    emptyOutDir: true,
    minify: false,
    target: 'node22',
    rollupOptions: {
      input: {
        index: fileURLToPath(new URL('./src/main/entry.ts', import.meta.url)),
        'media-worker': fileURLToPath(new URL('./src/workers/media.ts', import.meta.url)),
        'recorder-host': fileURLToPath(new URL('./src/workers/recorder.ts', import.meta.url)),
      },
      external: ['electron', 'koffi', 'uiohook-napi', 'sherpa-onnx-node'],
      output: { format: 'es', entryFileNames: '[name].mjs', chunkFileNames: '[name]-[hash].mjs' },
    },
  },
});
