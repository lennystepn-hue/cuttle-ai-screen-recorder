import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PNG } from 'pngjs';
import { _electron, type ElectronApplication, type Page } from 'playwright';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { FIXTURE_OUTPUT, makeFixture } from './fixture';

/**
 * The app end to end, its windows never shown: open a project, play, scrub, select, compare the
 * output view with the export's frames (`cuttle preview`), play the proxy, export, open a project
 * twice at once, close an editor during its export, close the pill; record through the picker with
 * the recorder's `test` backend, stop from the HUD, and land in the take cut by suggest; record
 * again. Runs only with `pnpm app:check` (vitest --mode app, after app:build:js and cli:build).
 * CUTTLE_CHECK_SHOTS=<folder> keeps screenshots.
 */
const enabled = process.env.MODE === 'app';
const MAIN = fileURLToPath(new URL('../dist/main/index.mjs', import.meta.url));
const CLI = fileURLToPath(new URL('../../cli/dist/cuttle.mjs', import.meta.url));
const SHOTS = process.env.CUTTLE_CHECK_SHOTS;

interface CheckState {
  t: number;
  playing: boolean;
  source?: number;
  error?: string;
  duration: number;
  proxyInUse: boolean;
  mediaState: { proxy: { state: string }; thumbnails: { state: string }; peaks: { state: string } };
}

interface Check {
  state(): CheckState;
  seek(t: number): Promise<void>;
  playback(): { drawn: number; restarts: number; clock: number };
  pixels(): string;
  useProxy(): Promise<boolean>;
}

const electronPath = (): string => createRequire(import.meta.url)('electron') as unknown as string;

/** The first window (page) for which `test` holds, waiting for it. */
async function waitForPage(app: ElectronApplication, test: (page: Page) => Promise<boolean>, timeout = 30_000): Promise<Page> {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    for (const page of app.windows()) {
      if (await test(page).catch(() => false)) return page;
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error('no such window appeared');
}

/** Clicks an element in a page without a real mouse (the window is never shown). */
const click = (page: Page, selector: string) => page.evaluate((target) => (document.querySelector(target) as HTMLElement).click(), selector);

/** cuttle.json of a project, once `ready` holds for it. */
async function projectWhen(dir: string, ready: (project: { sources: { screen: string }; scenes: { id?: string }[] }) => boolean, timeout = 60_000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    try {
      const project = JSON.parse(readFileSync(join(dir, 'cuttle.json'), 'utf8'));
      if (ready(project)) return project;
    } catch {
      // not written yet
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error(`${dir}/cuttle.json never got ready`);
}

function decode(dataUrl: string): PNG {
  return PNG.sync.read(Buffer.from(dataUrl.slice(dataUrl.indexOf(',') + 1), 'base64'));
}

/** Mean and largest per-channel difference of two same-sized RGBA images. */
function difference(a: PNG, b: PNG): { mean: number; max: number } {
  expect([a.width, a.height]).toEqual([b.width, b.height]);
  let sum = 0;
  let max = 0;
  for (let i = 0; i < a.data.length; i += 4) {
    for (let c = 0; c < 3; c++) {
      const d = Math.abs(a.data[i + c]! - b.data[i + c]!);
      sum += d;
      max = Math.max(max, d);
    }
  }
  return { mean: sum / ((a.data.length / 4) * 3), max };
}

describe.runIf(enabled)('the Cuttle app', () => {
  let root: string;
  let project: string;
  let app: ElectronApplication;
  let editor: Page;
  // The page's hook (`__cuttleCheck`); each call is its own function, as the page's CSP allows no eval.
  type Hooked = { __cuttleCheck: Check };
  const state = () => editor.evaluate(() => (window as unknown as Hooked).__cuttleCheck.state());
  const seek = (t: number) => editor.evaluate((time) => (window as unknown as Hooked).__cuttleCheck.seek(time), t);
  const pixels = async () => decode(await editor.evaluate(() => (window as unknown as Hooked).__cuttleCheck.pixels()));
  const useProxy = () => editor.evaluate(() => (window as unknown as Hooked).__cuttleCheck.useProxy());
  /** Plays from `from` for `ms`, then pauses: what the playback counters said while it played. */
  const play = async (from: number, ms: number) => {
    await seek(from);
    await editor.keyboard.press('Space');
    await editor.waitForTimeout(ms);
    const stats = await editor.evaluate(() => (window as unknown as Hooked).__cuttleCheck.playback());
    const playing = await state();
    await editor.keyboard.press('Space');
    return { stats, playing };
  };
  /** Pointer events on an element (a window that is never shown gets no real mouse). */
  const press = (selector: string, moveBy = 0) =>
    editor.evaluate(
      ({ selector, moveBy }) => {
        const element = document.querySelector(selector)!;
        const box = element.getBoundingClientRect();
        const at = (type: string, x: number) => element.dispatchEvent(new PointerEvent(type, { bubbles: true, clientX: x, clientY: box.top + box.height / 2, button: 0, pointerId: 7 }));
        const x = box.left + Math.min(20, box.width / 2);
        at('pointerdown', x);
        if (moveBy) for (let step = 1; step <= 8; step++) at('pointermove', x + (moveBy * step) / 8);
        at('pointerup', x + moveBy);
      },
      { selector, moveBy },
    );
  /** A screenshot of the editor (CUTTLE_CHECK_SHOTS): Electron's capturePage, which works on a window never shown. */
  const shot = async (name: string) => {
    if (!SHOTS) return;
    const png = await app.evaluate(async ({ BrowserWindow }) => {
      const window = BrowserWindow.getAllWindows().find((candidate) => candidate.webContents.getURL().includes('/editor.html'))!;
      // A hidden window paints only when asked, and composites about once a second: repaint, wait, capture.
      window.webContents.invalidate();
      await new Promise((resolve) => setTimeout(resolve, 1600));
      return (await window.webContents.capturePage()).toPNG().toString('base64');
    });
    writeFileSync(join(SHOTS, `${name}.png`), Buffer.from(png, 'base64'));
  };
  /** Asks the running app to open `argv` as a second launch would, `times` times at once. */
  const launchAgain = (argv: string[], times = 1) =>
    app.evaluate(
      ({ app: electronApp }, { args, count }) => {
        for (let i = 0; i < count; i++) electronApp.emit('second-instance', {}, ['Cuttle.exe', ...args], process.cwd(), {});
      },
      { args: argv, count: times },
    );
  const editorTitles = () => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().filter((window) => window.webContents.getURL().includes('/editor.html')).map((window) => window.getTitle()));

  beforeAll(async () => {
    root = mkdtempSync(join(tmpdir(), 'cuttle-app-'));
    project = join(root, 'demo');
    mkdirSync(project);
    makeFixture(project);
    if (SHOTS) mkdirSync(SHOTS, { recursive: true });
    // New recordings go into a folder of the check's own.
    mkdirSync(join(root, 'user-data'));
    writeFileSync(join(root, 'user-data', 'settings.json'), JSON.stringify({ projectsFolder: join(root, 'projects') }));
    app = await _electron.launch({
      executablePath: electronPath(),
      args: [MAIN, '--cuttle-check', '--open', project],
      env: {
        ...process.env,
        CUTTLE_HIDDEN: '1',
        CUTTLE_CHECK: '1',
        CUTTLE_NO_PROXY: '1',
        CUTTLE_USER_DATA: join(root, 'user-data'),
        CUTTLE_RECORDER_BACKEND: 'test',
        CUTTLE_COUNTDOWN: '0',
      },
    });
    // Unhandled rejections in the main process are bugs: collect them for the last test.
    await app.evaluate(() => {
      const seen: string[] = [];
      Object.assign(globalThis, { __rejections: seen });
      process.on('unhandledRejection', (reason) => seen.push(String(reason)));
    });
    editor = await new Promise<Page>((resolve) => {
      const find = () => app.windows().find((page) => page.url().includes('/editor.html'));
      const found = find();
      if (found) return resolve(found);
      app.on('window', (page) => {
        if (page.url().includes('/editor.html')) resolve(page);
        else void page.waitForURL(/editor\.html/).then(() => resolve(page), () => {});
      });
    });
    await editor.setViewportSize({ width: 1440, height: 900 });
    await editor.waitForSelector('.app[data-phase="ready"]', { timeout: 30_000 });
  }, 60_000);

  afterAll(async () => {
    await app?.close().catch(() => {});
    await rm(root, { recursive: true, force: true });
  });

  it('opens the project: the timeline shows its scenes, overlays and markers', async () => {
    expect(await editor.title()).toBe('demo · Cuttle');
    expect(await editor.locator('.scene').count()).toBe(5);
    expect(await editor.locator('.scene').first().getAttribute('title')).toBe('Prompt · 3 s');
    expect(await editor.locator('.item.zoom').count()).toBe(1);
    // the mask (source 0–9) runs across the continuous cut into the 8× clip as one block, then
    // shows again after the jump cut to source 8.5
    expect(await editor.locator('.item.mask').count()).toBe(2);
    // a caption's block shows its label ("Hook"), its text when it has none
    expect(await editor.locator('.item.caption').textContent()).toBe('Hook');
    expect(await editor.locator('.flag').allTextContents()).toEqual(['Prompt', 'Bash ×2', 'Answer']);
    const { duration } = await state();
    expect(duration).toBeCloseTo(3 + 5 / 8 + 3 + 2 + 1.5, 6);
    await shot('01-opened');
  });

  it('shows what the export renders, frame for frame, the webcam lined up', async () => {
    const stills = join(root, 'stills');
    const times = [1, 3.3, 6.8, 9.9];
    const result = spawnSync('node', [CLI, '--json', '-C', project, 'preview', ...times.flatMap((t) => ['--at', String(t)]), '-o', stills], { encoding: 'utf8', timeout: 120_000 });
    expect(result.status, result.stderr).toBe(0);
    const files = (JSON.parse(result.stdout) as { stills: { file: string }[] }).stills.map((still) => still.file);
    for (const [i, t] of times.entries()) {
      await seek(t);
      const view = await pixels();
      expect([view.width, view.height]).toEqual([FIXTURE_OUTPUT.width, FIXTURE_OUTPUT.height]);
      const { mean, max } = difference(view, PNG.sync.read(readFileSync(files[i]!)));
      expect(mean, `t = ${t}: mean difference`).toBeLessThan(0.5);
      expect(max, `t = ${t}: largest difference`).toBeLessThanOrEqual(24);
    }
    await shot('02-zoom');
  }, 120_000);

  it('plays with the mic as the clock, the picture keeping up, and pauses', async () => {
    const { stats, playing } = await play(0, 2000);
    console.log(`playback after 2 s: clock ${stats.clock.toFixed(2)} s, picture ${playing.t.toFixed(2)} s, ${stats.drawn} frames drawn, ${stats.restarts} restarts`);
    expect(playing.playing).toBe(true);
    // the clock (the sound as heard) runs in real time, from 0.12 s after the key
    expect(stats.clock).toBeGreaterThan(1);
    expect(stats.clock).toBeLessThan(2.4);
    // the picture follows it, never more than about half a second behind (then it drops frames)
    expect(stats.clock - playing.t).toBeLessThan(0.7);
    // and plays as a movie, not a slideshow: at least half the frame rate per second of the clock
    expect(stats.drawn / stats.clock).toBeGreaterThan(FIXTURE_OUTPUT.fps / 2);
    const paused = await state();
    expect(paused.playing).toBe(false);
    await editor.waitForTimeout(300);
    expect((await state()).t).toBe(paused.t);
  });

  it('scrubs with the playhead on the ruler and on the blocks; a click selects, Esc clears', async () => {
    const { duration } = await state();
    const width = await editor.evaluate(() => document.querySelector('[data-testid=timeline]')!.getBoundingClientRect().width);
    await press('.ruler', width / 2 - 20);
    await editor.waitForTimeout(300);
    const { t } = await state();
    expect(t).toBeGreaterThan(duration * 0.3);
    expect(t).toBeLessThan(duration * 0.7);
    // dragging across a scene scrubs too, and leaves the selection alone
    await seek(0);
    await press('.scene:nth-child(1)', 60);
    await editor.waitForTimeout(300);
    expect((await state()).t).toBeGreaterThan(0);
    expect(await editor.locator('.scene.selected').count()).toBe(0);
    // a click selects the 8× clip and shows it in the inspector
    await press('.scene:nth-child(2)');
    await editor.waitForSelector('.scene.selected');
    expect(await editor.locator('.inspector .kind-head .name').textContent()).toBe('8× Claude at work');
    await shot('03-selected');
    await editor.keyboard.press('Escape');
    expect(await editor.locator('.scene.selected').count()).toBe(0);
  });

  it('makes the proxy, the thumbnails and the waveform in the background', async () => {
    await editor.waitForFunction(
      () => {
        const media = (window as unknown as { __cuttleCheck: Check }).__cuttleCheck.state().mediaState;
        return media.proxy.state === 'ready' && media.thumbnails.state === 'ready' && media.peaks.state === 'ready';
      },
      undefined,
      { timeout: 60_000 },
    );
    expect(existsSync(join(project, '.cuttle', 'proxy.mp4'))).toBe(true);
    await editor.waitForSelector('.scene .thumbs i');
    await shot('04-thumbnails');
  }, 90_000);

  it('scrubs and plays the proxy: the same frames, and it keeps up through the 8× clip', async () => {
    await seek(1);
    const take = await pixels();
    expect(await useProxy()).toBe(true);
    await seek(1);
    // the proxy is smaller; its frame scaled into the output barely differs (one frame off is ≥ 2.3)
    expect(difference(take, await pixels()).mean).toBeLessThan(1.5);
    const { stats, playing } = await play(2.5, 1500);
    console.log(`proxy playback from 2.5 s: clock ${stats.clock.toFixed(2)} s, picture ${playing.t.toFixed(2)} s, ${stats.drawn} frames, ${stats.restarts} restarts`);
    expect(stats.clock).toBeGreaterThan(3.2);
    expect(stats.drawn / (stats.clock - 2.5)).toBeGreaterThan(FIXTURE_OUTPUT.fps / 2);
    expect((await state()).error).toBeUndefined();
  });

  it('exports the project size into out/, says what it replaces, and where', async () => {
    await editor.keyboard.press('Control+E');
    await editor.waitForSelector('[data-testid=export-sheet]');
    // the project's own size first and chosen; the sheet says which file it writes
    await editor.waitForSelector('[data-testid=export-note]');
    expect(await editor.locator('[data-testid=export-note]').textContent()).toContain('Saves out/export.mp4 from cuttle.json as it is saved now.');
    expect(await editor.locator('.format').first().textContent()).toContain('640×360');
    await shot('05-export-sheet');
    await editor.click('[data-testid=export-start]');
    await editor.waitForSelector('[data-testid=export-file]', { timeout: 120_000 });
    await shot('06-exported');
    const out = join(project, 'out', 'export.mp4');
    const probe = spawnSync('ffprobe', ['-v', 'error', '-show_entries', 'stream=codec_name,width,height', '-of', 'csv=p=0', out], { encoding: 'utf8' }).stdout.trim().split(/\r?\n/);
    expect(probe).toEqual([`h264,${FIXTURE_OUTPUT.width},${FIXTURE_OUTPUT.height}`, 'aac']);
    // again: now it says which export it replaces
    await editor.click('text=Export again');
    await editor.waitForFunction(() => document.querySelector('[data-testid=export-note]')?.textContent?.includes('Replaces out/export.mp4 from'));
    await editor.keyboard.press('Escape');
    expect(await editor.locator('[data-testid=export-sheet]').count()).toBe(0);
  }, 150_000);

  it('opens a project once when asked twice at once, and cancels its export when it closes', async () => {
    const second = join(root, 'second');
    cpSync(project, second, { recursive: true, filter: (path) => !/[\\/](\.cuttle|out)$/.test(path) });
    await launchAgain(['--open', second], 2);
    await expect.poll(editorTitles, { timeout: 30_000 }).toContain('second · Cuttle');
    await editor.waitForTimeout(1500);
    expect((await editorTitles()).filter((title) => title === 'second · Cuttle')).toHaveLength(1);
    const lock = join(second, '.cuttle', 'editor.lock');
    expect(existsSync(lock)).toBe(true);
    // export from it, then close it at its first frames: the export stops and leaves nothing half-written
    const page = app.windows().find((candidate) => candidate.url().includes('/editor.html') && candidate !== editor)!;
    await page.waitForSelector('.app[data-phase="ready"]', { timeout: 30_000 });
    await page.evaluate(
      () =>
        new Promise<void>((resolve) => {
          const bridge = (window as unknown as { cuttle: { invoke(channel: string, argument: unknown): Promise<unknown>; on(channel: string, listener: (progress: { done: number }) => void): () => void } }).cuttle;
          const off = bridge.on('export:progress', (progress) => {
            if (progress.done === 0) return;
            off();
            resolve();
          });
          void bridge.invoke('export:start', { formats: ['project'], encoder: 'software' });
        }),
    );
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find((window) => window.getTitle() === 'second · Cuttle')?.close());
    await expect.poll(() => existsSync(lock), { timeout: 10_000 }).toBe(false);
    // longer than the whole export takes: had it gone on, its file would be there by now
    await editor.waitForTimeout(5000);
    expect(existsSync(join(second, 'out')) ? readdirSync(join(second, 'out')) : []).toEqual([]);
  }, 90_000);

  it('keeps the pill out of recordings, with the projects in its recent list, and brings it back after a close', async () => {
    const pill = app.windows().find((page) => page.url().includes('/pill.html'))!;
    expect(pill).toBeDefined();
    const recent = await pill.evaluate(() => (window as unknown as { cuttle: { invoke(channel: string): Promise<{ name: string }[]> } }).cuttle.invoke('pill:recent'));
    expect(recent.map((entry) => entry.name)).toEqual(['second', 'demo']);
    const editorBridge = await editor.evaluate(() => (window as unknown as { cuttle: { invoke(channel: string): Promise<unknown> } }).cuttle.invoke('pill:recent').then(() => 'reached', (error: Error) => error.message));
    expect(editorBridge).toContain('unknown request');
    // Alt+F4 on the pill hides it; a second launch (or the tray) shows it again
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find((window) => window.webContents.getURL().includes('/pill.html'))?.close());
    await launchAgain([]);
    await editor.waitForTimeout(500);
    expect(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().filter((window) => window.webContents.getURL().includes('/pill.html')).length)).toBe(1);
  });

  /** Records one take through the picker on the display that has the bar, stopping from the HUD after about 2 s. */
  /**
   * The picker of the display the test backend's first monitor (its moving pattern) maps to: the
   * check records the same source wherever the real pointer is.
   */
  async function firstMonitorPicker(): Promise<{ page: Page; display: number }> {
    let found: { page: Page; display: number } | undefined;
    await waitForPage(app, async (page) => {
      if (!page.url().includes('/picker.html')) return false;
      const setup = await page.evaluate(() => (window as unknown as { cuttle: { invoke(channel: string): Promise<{ display: { id: number; monitor?: number } } | undefined> } }).cuttle.invoke('picker:setup'));
      if (setup?.display.monitor !== 0) return false;
      found = { page, display: setup.display.id };
      return true;
    });
    return found!;
  }

  /** Records the first monitor's display from the picker (with `choices`), stopping from the HUD after about 1.5 s. */
  async function recordThroughPicker(start: () => Promise<unknown>, choices?: Record<string, unknown>, stop = true): Promise<void> {
    await start();
    const { page, display } = await firstMonitorPicker();
    await page.evaluate(
      async ({ display, choices }) => {
        const bridge = (window as unknown as { cuttle: { invoke(channel: string, argument?: unknown): Promise<unknown> } }).cuttle;
        if (choices) await bridge.invoke('picker:choices', choices);
        // the pickers close as the recording begins: the answer never comes back to this page
        void bridge.invoke('picker:record', { kind: 'screen', display }).catch(() => {});
      },
      { display, choices },
    ).catch(() => {});
    if (!stop) return;
    const hud = await waitForPage(app, async (page) => page.url().includes('/hud.html') && (await page.locator('[data-testid=hud-time]').textContent()) !== '0:00');
    await new Promise((resolve) => setTimeout(resolve, 1500));
    await click(hud, '[data-testid=hud-stop]');
  }

  it('records through the picker, stops from the HUD, and opens the take cut by suggest', async () => {
    const pill = app.windows().find((page) => page.url().includes('/pill.html'))!;
    await recordThroughPicker(() => pill.evaluate(() => (window as unknown as { cuttle: { invoke(channel: string): Promise<unknown> } }).cuttle.invoke('pill:record')));
    const [made] = await new Promise<string[]>((resolve) => {
      const poll = setInterval(() => {
        const found = existsSync(join(root, 'projects')) ? readdirSync(join(root, 'projects')) : [];
        if (found.length > 0) {
          clearInterval(poll);
          resolve(found);
        }
      }, 100);
    });
    const dir = join(root, 'projects', made!);
    // The editor opens on the take while suggest cuts it; the cut arrives with ids and labels.
    const cut = await projectWhen(dir, (written) => written.scenes[0]?.id === 's1');
    expect(cut.sources.screen).toBe('takes/1/screen.mp4');
    const opened = await waitForPage(app, async (page) => page.url().includes('/editor.html') && (await page.title()) === `${made} · Cuttle`);
    await opened.waitForSelector('.app[data-phase="ready"]', { timeout: 30_000 });
    expect(await opened.locator('[data-testid=project-status]').count()).toBe(0);
    expect(await opened.locator('.scene').count()).toBe(cut.scenes.length);
  }, 120_000);

  it('records again into the same project, keeping the first take restorable', async () => {
    const dir = join(root, 'projects', readdirSync(join(root, 'projects'))[0]!);
    const opened = await waitForPage(app, async (page) => page.url().includes('/editor.html') && (await page.title()) !== 'demo · Cuttle');
    await recordThroughPicker(() => click(opened, '[data-testid=record-again]'));
    const second = await projectWhen(dir, (written) => written.sources.screen === 'takes/2/screen.mp4' && written.scenes[0]?.id !== undefined);
    expect(second.scenes.length).toBeGreaterThan(0);
    // The first take's edit is kept next to it, for "Back to take 1".
    expect(JSON.parse(readFileSync(join(dir, 'takes', '1', 'cuttle.json'), 'utf8')).sources.screen).toBe('takes/1/screen.mp4');
  }, 120_000);

  it('keeps a take whose capture broke off: recover repairs it and the editor opens on it', async () => {
    const projects = join(root, 'projects');
    const before = new Set(readdirSync(projects));
    const pill = app.windows().find((page) => page.url().includes('/pill.html'))!;
    // The test backend's failing camera ends after 1 s, as an unplugged one does: the capture fails.
    await recordThroughPicker(
      () => pill.evaluate(() => (window as unknown as { cuttle: { invoke(channel: string): Promise<unknown> } }).cuttle.invoke('pill:record')),
      { stop: 'none', camera: 'Failing Test Camera' },
      false,
    );
    let made: string | undefined;
    await expect.poll(() => (made = readdirSync(projects).find((name) => !before.has(name))), { timeout: 30_000 }).toBeDefined();
    const recovered = await projectWhen(join(projects, made!), (written) => written.sources.screen === 'takes/1/screen.mp4' && written.scenes[0]?.id !== undefined);
    expect(recovered.scenes.length).toBeGreaterThan(0);
    const opened = await waitForPage(app, async (page) => page.url().includes('/editor.html') && (await page.title()) === `${made} · Cuttle`);
    await opened.waitForSelector('.app[data-phase="ready"]', { timeout: 30_000 });
  }, 120_000);

  it('ends a pick whose picker was closed (Alt+F4), so New recording works again', async () => {
    const pill = app.windows().find((page) => page.url().includes('/pill.html'))!;
    const pick = () => pill.evaluate(() => (window as unknown as { cuttle: { invoke(channel: string): Promise<unknown> } }).cuttle.invoke('pill:record'));
    await pick();
    await firstMonitorPicker();
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find((window) => window.webContents.getURL().includes('/picker.html'))?.close());
    await expect.poll(() => app.windows().filter((page) => page.url().includes('/picker.html')).length, { timeout: 10_000 }).toBe(0);
    await pick();
    const { page } = await firstMonitorPicker();
    await page.evaluate(() => (window as unknown as { cuttle: { invoke(channel: string): Promise<unknown> } }).cuttle.invoke('picker:cancel')).catch(() => {});
  }, 60_000);

  it('had no unhandled rejection in the main process', async () => {
    expect(await app.evaluate(() => (globalThis as unknown as { __rejections: string[] }).__rejections)).toEqual([]);
  });

  // Last: the app quits here.
  it('stops a recording when the app quits, and writes the take into its project first', async () => {
    const projects = join(root, 'projects');
    const before = new Set(readdirSync(projects));
    const pill = app.windows().find((page) => page.url().includes('/pill.html'))!;
    // no camera: the one the check before chose fails on purpose
    await recordThroughPicker(() => pill.evaluate(() => (window as unknown as { cuttle: { invoke(channel: string): Promise<unknown> } }).cuttle.invoke('pill:record')), { stop: 'none' }, false);
    await waitForPage(app, async (page) => page.url().includes('/hud.html') && (await page.locator('[data-testid=hud-time]').textContent()) !== '0:00');
    await new Promise((resolve) => setTimeout(resolve, 1000));
    const exited = new Promise((resolve) => app.process().once('exit', resolve));
    await app.evaluate(({ app: electronApp }) => electronApp.quit()).catch(() => {});
    await exited;
    const made = readdirSync(projects).find((name) => !before.has(name))!;
    expect(JSON.parse(readFileSync(join(projects, made, 'cuttle.json'), 'utf8')).sources.screen).toBe('takes/1/screen.mp4');
  }, 60_000);
});
