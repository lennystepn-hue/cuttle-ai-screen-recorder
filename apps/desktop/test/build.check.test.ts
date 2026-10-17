import { mkdirSync, mkdtempSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { _electron, type ElectronApplication, type Page } from 'playwright';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { makeFixture } from './fixture';

/**
 * The unpacked app (pnpm app:build) starts from its folder, opens a project, draws its first frame,
 * and runs the media worker from inside the asar archive. Runs only with vitest --mode build.
 */
const enabled = process.env.MODE === 'build';
const EXE = fileURLToPath(new URL(`../build/Cuttle-${process.platform}-${process.arch}/Cuttle${process.platform === 'win32' ? '.exe' : ''}`, import.meta.url));

describe.runIf(enabled)('the unpacked Cuttle app', () => {
  let root: string;
  let app: ElectronApplication;
  let editor: Page;

  beforeAll(async () => {
    root = mkdtempSync(join(tmpdir(), 'cuttle-build-'));
    const project = join(root, 'demo');
    mkdirSync(project);
    makeFixture(project);
    app = await _electron.launch({
      executablePath: EXE,
      args: ['--cuttle-check', '--open', project],
      env: { ...process.env, CUTTLE_HIDDEN: '1', CUTTLE_CHECK: '1', CUTTLE_USER_DATA: join(root, 'user-data') },
    });
    editor = await new Promise<Page>((resolve) => {
      const found = app.windows().find((page) => page.url().includes('/editor.html'));
      if (found) return resolve(found);
      app.on('window', (page) => void page.waitForURL(/editor\.html/).then(() => resolve(page), () => {}));
    });
    await editor.waitForSelector('.app[data-phase="ready"]', { timeout: 30_000 });
  }, 60_000);

  afterAll(async () => {
    await app?.close();
    await rm(root, { recursive: true, force: true });
  });

  it('opens a project and draws its first frame', async () => {
    expect(await app.evaluate(({ app: electronApp }) => [electronApp.getName(), electronApp.isPackaged])).toEqual(['Cuttle', true]);
    const pixels: string = await editor.evaluate(() => (window as unknown as { __cuttleCheck: { pixels(): string } }).__cuttleCheck.pixels());
    expect(pixels.length).toBeGreaterThan(10_000);
  });

  it('makes the proxy in its media worker', async () => {
    await editor.waitForFunction(
      () => (window as unknown as { __cuttleCheck: { state(): { mediaState: { proxy: { state: string } } } } }).__cuttleCheck.state().mediaState.proxy.state === 'ready',
      undefined,
      { timeout: 60_000 },
    );
  }, 90_000);
});
