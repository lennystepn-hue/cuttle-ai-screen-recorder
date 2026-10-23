import { copyFileSync, mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig, type Plugin } from 'vite';
import { SEGMENTER_DIR, SEGMENTER_FILE_NAMES } from '../src/segmenter-files';

/**
 * The webcam's segmenter beside the page (`segment/`): MediaPipe's loader script and WebAssembly and
 * the model. The page reads them through its host; library mode would inline them as data: URLs.
 */
function segmenterFiles(): Plugin {
  const engine = createRequire(fileURLToPath(new URL('../../engine/package.json', import.meta.url)));
  const from = {
    loader: engine.resolve('@mediapipe/tasks-vision/vision_wasm_internal.js'),
    wasm: engine.resolve('@mediapipe/tasks-vision/vision_wasm_internal.wasm'),
    model: fileURLToPath(new URL('../../engine/assets/selfie_segmenter_landscape.tflite', import.meta.url)),
  };
  return {
    name: 'cuttle-segmenter-files',
    writeBundle(options) {
      const dir = join(options.dir!, SEGMENTER_DIR);
      mkdirSync(dir, { recursive: true });
      for (const key of ['loader', 'wasm', 'model'] as const) copyFileSync(from[key], join(dir, SEGMENTER_FILE_NAMES[key]));
    },
  };
}

// The export page: one classic script (library mode inlines the engine's fonts as data: URLs), plus
// index.html and preload.cjs copied from export-page/, and the segmenter's files. Output:
// packages/export/dist/export-page/.
export default defineConfig({
  root: fileURLToPath(new URL('.', import.meta.url)),
  publicDir: 'export-page',
  logLevel: 'warn',
  define: { 'process.env.NODE_ENV': '"production"' },
  plugins: [segmenterFiles()],
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
