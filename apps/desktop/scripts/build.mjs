// Builds the app into apps/desktop/dist: the main process and media worker (dist/main), one
// self-contained CommonJS preload per window kind (dist/preload: a sandboxed preload can require
// only electron), the pages (dist/renderer) and the export page (dist/main/export-page).
import { rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { build } from 'vite';

const desktop = fileURLToPath(new URL('..', import.meta.url));
const at = (path) => fileURLToPath(new URL(`../${path}`, import.meta.url));

rmSync(at('dist'), { recursive: true, force: true });
await build({ configFile: at('vite.main.config.ts') });
for (const kind of ['editor', 'pill', 'picker', 'hud', 'countdown', 'settings']) {
  await build({
    configFile: false,
    root: desktop,
    logLevel: 'warn',
    build: {
      outDir: at('dist/preload'),
      emptyOutDir: false,
      minify: false,
      target: 'node22',
      lib: { entry: at(`src/preload/${kind}.ts`), formats: ['cjs'], fileName: () => `${kind}.cjs` },
      rollupOptions: { external: ['electron'] },
    },
  });
}
await build({ configFile: at('vite.renderer.config.ts') });
await build({ configFile: at('../../packages/export/electron/vite.page.config.ts'), build: { outDir: at('dist/main/export-page') } });
console.log('built apps/desktop/dist');
