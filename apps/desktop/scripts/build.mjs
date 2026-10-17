// Builds the app into apps/desktop/dist: the main process and media worker (dist/main), one
// self-contained CommonJS preload per window kind (dist/preload: a sandboxed preload can require
// only electron), the pages (dist/renderer), the export page (dist/main/export-page) and the motion
// kit the export serves to motion pages (dist/main/motion-kit).
import { execFileSync } from 'node:child_process';
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
// macOS: the screen capture helper next to the recorder's bundle (nothing elsewhere)
execFileSync(process.execPath, [at('../../packages/recorder/native/build-macos.mjs'), at('dist/main')], { stdio: 'inherit' });
execFileSync(process.execPath, [at('../../packages/motion-kit/scripts/copy.mjs'), at('dist/main/motion-kit')], { stdio: 'inherit' });
console.log('built apps/desktop/dist');
