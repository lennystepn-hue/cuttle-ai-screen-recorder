import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { _electron, type ElectronApplication, type Page } from 'playwright';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { makeFixture } from './fixture';

/**
 * The unpacked app (pnpm app:build) starts from its folder, opens a project, draws its first frame,
 * runs the media worker from inside the asar archive, and starts the recorder host, whose native
 * modules (koffi, uiohook-napi) load from outside it. Runs only with vitest --mode build.
 */
const enabled = process.env.MODE === 'build';
const BUILD = fileURLToPath(new URL(`../build/Cuttle-${process.platform}-${process.arch}/`, import.meta.url));
/** The executable and the resources folder: beside each other on Windows, inside Cuttle.app on macOS. */
const mac = process.platform === 'darwin';
const EXE = mac ? join(BUILD, 'Cuttle.app', 'Contents', 'MacOS', 'Cuttle') : join(BUILD, process.platform === 'win32' ? 'Cuttle.exe' : 'Cuttle');
const RESOURCES = mac ? join(BUILD, 'Cuttle.app', 'Contents', 'Resources') : join(BUILD, 'resources');

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

  it('runs its own copy of the CLI as the cuttle command would: the app as Node, and as Electron for a still', () => {
    const entry = join(RESOURCES, 'app.asar.unpacked', 'cli', 'cuttle.mjs');
    const env = { ...process.env, ELECTRON_RUN_AS_NODE: '1', CUTTLE_ELECTRON: EXE };
    const version = spawnSync(EXE, [entry, '--version'], { env, encoding: 'utf8', windowsHide: true, timeout: 30_000 });
    expect(version.stdout.trim()).toMatch(/^\d+\.\d+\.\d+$/);
    const still = spawnSync(EXE, [entry, '-C', join(root, 'demo'), 'preview', '--at', '1', '-o', join(root, 'stills'), '--json'], { env, encoding: 'utf8', windowsHide: true, timeout: 90_000 });
    expect(still.status, still.stderr).toBe(0);
    const { stills } = JSON.parse(still.stdout) as { stills: { file: string }[] };
    expect(stills).toHaveLength(1);
    expect(existsSync(stills[0]!.file)).toBe(true);
  }, 120_000);

  it("lists this machine's displays and windows in the recorder host (koffi loads)", async () => {
    const pill = app.windows().find((page) => page.url().includes('/pill.html'))!;
    await pill.evaluate(() => (window as unknown as { cuttle: { invoke(channel: string): Promise<unknown> } }).cuttle.invoke('pill:record'));
    let picker: Page | undefined;
    await expect.poll(() => (picker = app.windows().find((page) => page.url().includes('/picker.html'))), { timeout: 30_000 }).toBeDefined();
    await picker!.waitForSelector('[data-testid=picker]', { timeout: 30_000 });
    const setup = await picker!.evaluate(() =>
      (window as unknown as { cuttle: { invoke(channel: string): Promise<{ display: { monitor?: number }; problem?: string } | undefined> } }).cuttle.invoke('picker:setup'),
    );
    // Only the names and bounds are read; nothing is captured.
    expect(setup?.problem).toBeUndefined();
    expect(setup?.display.monitor).toBeTypeOf('number');
    await picker!.evaluate(() => (window as unknown as { cuttle: { invoke(channel: string): Promise<unknown> } }).cuttle.invoke('picker:cancel')).catch(() => {});
  }, 60_000);
});
