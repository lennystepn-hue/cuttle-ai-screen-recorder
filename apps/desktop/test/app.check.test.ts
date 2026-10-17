import { spawnSync } from 'node:child_process';
import { chmodSync, cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { createServer, type Server, type ServerResponse } from 'node:http';
import { createRequire } from 'node:module';
import { homedir, tmpdir } from 'node:os';
import { basename, delimiter, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PNG } from 'pngjs';
import { whisperCliPath } from '@cuttle/core';
import { _electron, type ElectronApplication, type Page } from 'playwright';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { FIXTURE_OUTPUT, makeFixture, makeMotionFixture, makePrivateFixture, makeRestingFixture, makeSpokenFixture } from './fixture';

/**
 * The app end to end, its windows never shown: open a project, play, scrub, select, compare the
 * output view with the export's frames (`cuttle preview`), play the proxy, export; edit (split,
 * trim, move, speed, zooms and masks drawn in the source view, a caption typed on the video, the
 * command menu), undo and redo, each checked in the file; a write from outside during a drag, a
 * broken file, a save conflict kept as a draft; open a project
 * twice at once, close an editor during its export, close the pill; record through the picker with
 * the recorder's `test` backend, stop from the HUD, and land in the take cut by suggest; record
 * again; pause and restart from the HUD; the settings. Then the first run in an app of its own:
 * ffmpeg found once installed, the cuttle command and the skill installed (into folders of the
 * check's own). Runs only with `pnpm app:check` (vitest --mode app, after app:build:js and cli:build).
 * CUTTLE_CHECK_SHOTS=<folder> keeps screenshots.
 */
const enabled = process.env.MODE === 'app';
const MAIN = fileURLToPath(new URL('../dist/main/index.mjs', import.meta.url));
const CLI = fileURLToPath(new URL('../../cli/dist/cuttle.mjs', import.meta.url));
const SHOTS = process.env.CUTTLE_CHECK_SHOTS;
/** The English text-to-speech take of the core tests, and the true start of each of its words. */
const SPOKEN = fileURLToPath(new URL('../../../packages/core/test/fixtures/speech/en.m4a', import.meta.url));
const SPOKEN_WORDS = fileURLToPath(new URL('../../../packages/core/test/fixtures/speech/en.words.json', import.meta.url));
/**
 * The `base` speech model where one is downloaded (`CUTTLE_TEST_MODELS`, else the user's models
 * folder): the check downloads it from a server of its own, so the model can be checked end to end.
 */
const BASE_MODEL = [
  process.env.CUTTLE_TEST_MODELS,
  process.env.LOCALAPPDATA && join(process.env.LOCALAPPDATA, 'Cuttle', 'models'),
  process.platform === 'darwin' && join(homedir(), 'Library', 'Application Support', 'Cuttle', 'models'),
]
  .filter((dir): dir is string => !!dir)
  .map((dir) => join(dir, 'ggml-base.bin'))
  .find((path) => existsSync(path));
/** Whisper as the app finds it: ffmpeg's filter, else whisper.cpp's whisper-cli (macOS). */
const hasWhisper = /\swhisper\s/.test(spawnSync('ffmpeg', ['-hide_banner', '-filters'], { encoding: 'utf8', windowsHide: true }).stdout ?? '') || whisperCliPath() !== undefined;

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
  playback(): { drawn: number; restarts: number; clicks: number; clock: number };
  pixels(): string;
  useProxy(): Promise<boolean>;
  doc(): { hash: string; saving: boolean; problem?: string; issues?: string[]; toast?: { text: string; undo?: boolean }; draftNote?: string; undo?: string; redo?: string };
  flush(): Promise<void>;
  select(selection: { kind: string; id: string } | undefined): void;
}

/** cuttle.json as the checks read it back. */
interface Written {
  scenes: { id: string; type: string; from?: number; to?: number; speed?: number }[];
  zooms: { id: string; at: number; duration: number; rect: number[] }[];
  masks: { id: string; from: number; to: number; rect: number[]; style?: string; label?: string }[];
  texts: { id: string; text: string; position?: string }[];
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
/**
 * Picks the option labelled `label` (`prefix`: starting with it) from a select (Select.tsx): a click
 * opens it, a click on the option picks it. A list closed again before the pick (a scroll still due
 * from a panel that changed just before, as in a small window), or before it was seen at all, is
 * opened again; one that never opens is reported with the select's state.
 */
async function chooseIn(page: Page, trigger: string, label: string, prefix = false): Promise<void> {
  for (let attempt = 1; ; attempt++) {
    // a Playwright selector (it may use :has-text): the element's own click, as in a window never shown
    await page.locator(trigger).evaluate((element) => (element as HTMLElement).click());
    const shown = await page.waitForSelector('.select-list [role=option]', { timeout: 5000 }).then(
      () => true,
      () => false,
    );
    if (!shown) {
      if (attempt < 5) continue;
      const state = await page.locator(trigger).evaluate((element) => ({
        disabled: (element as HTMLButtonElement).disabled,
        expanded: element.getAttribute('aria-expanded'),
        focused: document.hasFocus(),
        lists: document.querySelectorAll('.select-list').length,
        status: document.querySelector('[data-testid=project-status]')?.textContent ?? null,
      }));
      throw new Error(`the select ${trigger} did not open: ${JSON.stringify(state)}`);
    }
    const result = await page.evaluate(
      ({ label, prefix }) => {
        const options = [...document.querySelectorAll('.select-list [role=option]')];
        if (options.length === 0) return 'closed';
        const option = options.find((item) => {
          const text = item.querySelector('.option-label')?.textContent ?? '';
          return prefix ? text.startsWith(label) : text === label;
        });
        if (!option) return 'missing';
        (option as HTMLElement).click();
        return 'picked';
      },
      { label, prefix },
    );
    if (result === 'picked') return;
    if (result === 'missing' || attempt === 5) throw new Error(`no option "${label}" in ${trigger} (${result})`);
  }
}

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
  /** Serves the speech models: `base` from BASE_MODEL, `small` broken, `large-v3-turbo-q5_0` never ending. */
  let models: Server;
  const hanging: ServerResponse[] = [];
  let editor: Page;
  const pageErrors: string[] = [];
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
  /** A screenshot of the window whose URL has `part` and whose title is `title` (when given). */
  const shotOf = async (name: string, part: string, title?: string) => {
    if (!SHOTS) return;
    const png = await app.evaluate(
      async ({ BrowserWindow }, { part, title }) => {
        const window = BrowserWindow.getAllWindows().find((candidate) => candidate.webContents.getURL().includes(part) && (title === undefined || candidate.getTitle() === title))!;
        // the first capture of a window never shown can be its first paint: the second is now
        for (let round = 0; round < 2; round++) {
          window.webContents.invalidate();
          await new Promise((resolve) => setTimeout(resolve, 1600));
          await window.webContents.capturePage();
        }
        return (await window.webContents.capturePage()).toPNG().toString('base64');
      },
      { part, title },
    );
    writeFileSync(join(SHOTS, `${name}.png`), Buffer.from(png, 'base64'));
  };
  /** Opens a project folder as a second launch would, and finds its editor (others may be open: the takes recorded before). */
  const openEditor = async (dir: string): Promise<Page> => {
    const name = basename(dir);
    await launchAgain(['--open', dir]);
    await expect.poll(editorTitles, { timeout: 30_000 }).toContain(`${name} · Cuttle`);
    const page = await waitForPage(
      app,
      async (candidate) =>
        candidate.url().includes('/editor.html') &&
        basename((await candidate.evaluate(() => (window as unknown as { cuttle: { invoke(channel: string): Promise<{ dir: string }> } }).cuttle.invoke('project:info'))).dir) === name,
    );
    await page.waitForSelector('.app[data-phase="ready"]', { timeout: 30_000 });
    await page.setViewportSize({ width: 1440, height: 900 });
    return page;
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
    // the real path: macOS's temporary folder is behind a link (/var is /private/var), the app keeps real paths
    // as the app resolves folders (fs/promises' realpath): macOS's /var is /private/var, and Windows'
    // short names (C:\Users\RUNNER~1 on GitHub's runners) are written out
    root = realpathSync.native(mkdtempSync(join(tmpdir(), 'cuttle-app-')));
    project = join(root, 'demo');
    mkdirSync(project);
    makeFixture(project);
    if (SHOTS) mkdirSync(SHOTS, { recursive: true });
    // New recordings go into a folder of the check's own.
    mkdirSync(join(root, 'user-data'));
    // The screen is read after a take's cut only where the check asks for it (it says so in the settings).
    writeFileSync(join(root, 'user-data', 'settings.json'), JSON.stringify({ projectsFolder: join(root, 'projects'), privacy: { read: false } }));
    models = createServer((request, response) => {
      if (request.url === '/ggml-base.bin' && BASE_MODEL) return void response.end(readFileSync(BASE_MODEL));
      if (request.url === '/ggml-small.bin') return void response.end('not a model');
      if (request.url === '/ggml-large-v3-turbo-q5_0.bin') {
        response.write(Buffer.alloc(1_000_000));
        return void hanging.push(response);
      }
      response.statusCode = 404;
      response.end();
    });
    await new Promise<void>((resolve) => models.listen(0, '127.0.0.1', () => resolve()));
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
        // the app reads the screen (the settings above say when)
        CUTTLE_OCR: '',
        // the check's own models folder (empty at first), and the models from the check's server
        CUTTLE_MODELS_DIR: join(root, 'models'),
        CUTTLE_MODELS_URL: `http://127.0.0.1:${(models.address() as { port: number }).port}/`,
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
    // An error in the editor's page is a bug: collected for the last check.
    editor.on('pageerror', (error) => pageErrors.push(error.message));
    await editor.setViewportSize({ width: 1440, height: 900 });
    // A window that is never shown runs no CSS animations: without motion, what opens shows at once in the screenshots.
    await editor.emulateMedia({ reducedMotion: 'reduce' });
    await editor.waitForSelector('.app[data-phase="ready"]', { timeout: 30_000 });
  }, 60_000);

  afterAll(async () => {
    await app?.close().catch(() => {});
    for (const response of hanging) response.destroy();
    models?.closeAllConnections();
    models?.close();
    await rm(root, { recursive: true, force: true });
  });

  it('opens the project: the timeline shows its scenes, overlays and markers', async () => {
    expect(await editor.title()).toBe('demo · Cuttle');
    expect(await editor.locator('.scene').count()).toBe(5);
    expect(await editor.locator('.scene').first().getAttribute('title')).toBe('Prompt · 3 s · drag to move, edges to trim');
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
    // the six keys typed at 2.4 s click a second before the clock gets there
    expect(stats.clicks).toBeGreaterThanOrEqual(4);
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
    // a click selects the 8× clip, puts the playhead there and shows it in the inspector
    await seek(0);
    await press('.scene[data-id=s2]');
    await editor.waitForSelector('.scene.selected');
    await expect.poll(async () => (await state()).t).toBeGreaterThan(3);
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

  // ---- editing: every edit is checked in the file ----------------------------------------------

  const projectFile = () => join(project, 'cuttle.json');
  const onDisk = (): Written => JSON.parse(readFileSync(projectFile(), 'utf8')) as Written;
  /** Waits until cuttle.json passes `ready` (an edit is saved when its gesture ends). */
  const savedWhen = (ready: (file: Written) => boolean) =>
    expect
      .poll(
        () => {
          try {
            return ready(onDisk());
          } catch {
            return false;
          }
        },
        { timeout: 10_000 },
      )
      .toBe(true);
  const doc = () => editor.evaluate(() => (window as unknown as Hooked).__cuttleCheck.doc());
  /** Undoes until there is nothing left to undo (Ctrl+Z), and waits for the last save. */
  const undoAll = async () => {
    while ((await doc()).undo) await editor.keyboard.press('Control+Z');
    await editor.evaluate(() => (window as unknown as Hooked).__cuttleCheck.flush());
  };
  /**
   * A drag on an element (a window that is never shown gets no real mouse): pressed at `from` (a
   * fraction of its box), moved by `by` px in eight steps, released unless `hold`; `release`
   * ends a held one `by` px further on.
   */
  const drag = (selector: string, by: [number, number], options: { from?: [number, number]; hold?: boolean } = {}) =>
    editor.evaluate(
      ({ selector, by, from, hold }) => {
        const element = document.querySelector(selector)!;
        const box = element.getBoundingClientRect();
        const start = { x: box.left + from[0] * box.width, y: box.top + from[1] * box.height };
        const fire = (type: string, x: number, y: number) =>
          element.dispatchEvent(new PointerEvent(type, { bubbles: true, clientX: x, clientY: y, button: 0, buttons: type === 'pointerup' ? 0 : 1, pointerId: 7 }));
        fire('pointerdown', start.x, start.y);
        for (let step = 1; step <= 8; step++) fire('pointermove', start.x + (by[0] * step) / 8, start.y + (by[1] * step) / 8);
        const end = { x: start.x + by[0], y: start.y + by[1] };
        if (hold) Object.assign(window, { __held: end });
        else fire('pointerup', end.x, end.y);
      },
      { selector, by, from: options.from ?? [0.5, 0.5], hold: options.hold ?? false },
    );
  /** Picks the option labelled `label` from a select in the editor. */
  const choose = (trigger: string, label: string) => chooseIn(editor, trigger, label);
  const release = (by: [number, number]) =>
    editor.evaluate((by) => {
      const at = (window as unknown as { __held: { x: number; y: number } }).__held;
      const fire = (type: string, x: number, y: number) => window.dispatchEvent(new PointerEvent(type, { clientX: x, clientY: y, button: 0, buttons: type === 'pointerup' ? 0 : 1, pointerId: 7 }));
      for (let step = 1; step <= 8; step++) fire('pointermove', at.x + (by[0] * step) / 8, at.y + (by[1] * step) / 8);
      fire('pointerup', at.x + by[0], at.y + by[1]);
    }, by);

  it('splits, trims and moves scenes and sets a speed; undo and redo step through it, back to the file as it was, byte for byte', async () => {
    await editor.keyboard.press('Escape');
    const original = readFileSync(projectFile(), 'utf8');
    await seek(1);
    await editor.keyboard.press('s');
    await savedWhen((file) => file.scenes.length === 6);
    const [first, second] = onDisk().scenes;
    // a continuous cut at the playhead's source second
    expect(first!.to).toBeCloseTo(1, 3);
    expect(second!.from).toBe(first!.to);
    expect((await doc()).undo).toBe('Split clip');
    await editor.keyboard.press('Control+Z');
    await savedWhen((file) => file.scenes.length === 5);
    expect((await doc()).redo).toBe('Split clip');
    await editor.keyboard.press('Control+Shift+Z');
    await savedWhen((file) => file.scenes.length === 6);

    // the first clip's end edge, 30 px to the left: shorter at its end
    await drag('.scene[data-id=s1] .edge.end', [-30, 0]);
    await savedWhen((file) => file.scenes[0]!.to! < first!.to! - 0.1);
    expect((await doc()).undo).toBe('Trim clip');

    // the card, dragged before everything; the video shows it there (the renderer has the new order)
    await drag('.scene[data-id=s5]', [-2000, 0]);
    await savedWhen((file) => file.scenes[0]!.id === 's5');
    expect((await doc()).undo).toBe('Move scene');
    await seek(0.5);
    await expect.poll(async () => (await state()).source).toBeUndefined();
    expect((await state()).error).toBeUndefined();
    await shot('07-edited');

    // the 8× clip at 2×, from the timeline bar
    await press('.scene[data-id=s2]');
    await choose('[data-testid=speed]', '2×');
    await savedWhen((file) => file.scenes.find((scene) => scene.id === 's2')!.speed === 2);

    await undoAll();
    expect(readFileSync(projectFile(), 'utf8')).toBe(original);
  }, 30_000);

  it('draws a zoom and a mask in the source view, moves and resizes them there, and sets the mask in the inspector', async () => {
    const original = readFileSync(projectFile(), 'utf8');
    await seek(1);
    await editor.keyboard.press('z');
    await editor.waitForSelector('[data-testid=source-view]');
    // a zoom drawn on the screen keeps its shape (1280×800): what is drawn is what it shows
    await drag('[data-testid=source-view]', [240, 60], { from: [0.3, 0.3] });
    await savedWhen((file) => file.zooms.length === 2);
    const zoom = onDisk().zooms.find((item) => item.id !== 'z1')!;
    expect(zoom.at).toBeCloseTo(1, 1);
    expect(zoom.rect[2]! / zoom.rect[3]!).toBeCloseTo(1280 / 800, 1);
    await editor.waitForSelector('.source-box.zoom.selected');
    await shot('08-source-view');
    // its corner handle makes it larger, its body moves it
    await drag('.source-box.selected .box-handle.se', [60, 0]);
    await savedWhen((file) => file.zooms.find((item) => item.id === zoom.id)!.rect[2]! > zoom.rect[2]! + 20);
    const larger = onDisk().zooms.find((item) => item.id === zoom.id)!;
    expect(larger.rect[2]! / larger.rect[3]!).toBeCloseTo(1280 / 800, 1);
    await drag('.source-box.selected', [-40, -20]);
    await savedWhen((file) => file.zooms.find((item) => item.id === zoom.id)!.rect[0]! < larger.rect[0]! - 20);
    // Esc: back to the video
    await editor.keyboard.press('Escape');
    expect(await editor.locator('[data-testid=source-view]').count()).toBe(0);

    // a mask is free in its shape
    await editor.keyboard.press('m');
    await drag('[data-testid=source-view]', [160, 30], { from: [0.55, 0.6] });
    await savedWhen((file) => file.masks.length === 2);
    const mask = onDisk().masks.find((item) => item.id !== 'm1')!;
    expect(mask.rect[2]! / mask.rect[3]!).toBeGreaterThan(3);
    await choose('.inspector label.field:has-text("Style") .select-trigger', 'Blur');
    await savedWhen((file) => file.masks.find((item) => item.id === mask.id)!.style === 'blur');
    await shot('08-mask');
    // the look: a background swatch (its part of the Look tab opened)
    await click(editor, '#tab-look');
    await click(editor, '[data-testid=look-open-background]');
    await click(editor, '.swatch-button.bg-mesh');
    await savedWhen((file) => (file as unknown as { look: { background: { preset: string } } }).look.background.preset === 'mesh');
    await shot('08-look');
    await click(editor, '#tab-selection');
    await editor.keyboard.press('Escape');
    await undoAll();
    expect(readFileSync(projectFile(), 'utf8')).toBe(original);
  }, 30_000);

  it('types a caption on the video, selects it there with a click, and edits its text in the inspector', async () => {
    const original = readFileSync(projectFile(), 'utf8');
    await seek(1.2);
    await editor.keyboard.press('t');
    await editor.waitForSelector('[data-testid=caption-input]:focus');
    await editor.keyboard.type('Ship it');
    // shown while typed, saved on Enter
    await shot('09-caption-typed');
    expect(onDisk().texts).toHaveLength(1);
    await editor.keyboard.press('Enter');
    // at the top: the fixture's caption is at the bottom there
    await savedWhen((file) => file.texts.some((text) => text.text === 'Ship it' && text.position === 'top'));
    await editor.waitForSelector('.caption-box.selected');
    const box = (await editor.locator('.caption-box.selected').boundingBox())!;
    await shot('09-caption');
    await editor.keyboard.press('Escape');
    expect(await editor.locator('.caption-box.selected').count()).toBe(0);
    // a click on it selects it again
    await editor.evaluate(({ x, y }) => {
      const canvas = document.querySelector('[data-testid=output]')!;
      for (const type of ['pointermove', 'pointerdown', 'pointerup']) canvas.dispatchEvent(new PointerEvent(type, { bubbles: true, clientX: x, clientY: y, button: 0, pointerId: 7 }));
    }, { x: box.x + box.width / 2, y: box.y + box.height / 2 });
    await editor.waitForSelector('.caption-box.selected');
    await editor.fill('[data-testid=caption-text]', 'Ship it today');
    await editor.locator('[data-testid=caption-text]').blur();
    await savedWhen((file) => file.texts.some((text) => text.text === 'Ship it today'));
    await undoAll();
    expect(readFileSync(projectFile(), 'utf8')).toBe(original);
  }, 30_000);

  it('runs a command from the menu (Ctrl+K), by typing part of its name', async () => {
    await seek(1);
    await editor.keyboard.press('Control+K');
    await editor.waitForSelector('[data-testid=command-input]:focus');
    await editor.keyboard.type('split');
    await shot('10-command-menu');
    await editor.keyboard.press('Enter');
    expect(await editor.locator('[data-testid=command-input]').count()).toBe(0);
    await savedWhen((file) => file.scenes.length === 6);
    await undoAll();
  }, 30_000);

  it('draws the cursor and frame styles with the engine, and sets them and the cursor’s movement in the Look tab', async () => {
    const original = readFileSync(projectFile(), 'utf8');
    await click(editor, '#tab-look');
    // the swatches are the engine's own pictures: the window's part, then the cursor's
    await click(editor, '[data-testid=look-open-window]');
    await editor.waitForSelector('[data-testid=frame-mac-light] img', { timeout: 20_000 });
    await shot('14-look-swatches');
    await click(editor, '[data-testid=look-open-cursor]');
    await editor.waitForSelector('[data-testid=cursor-ring] img', { timeout: 20_000 });
    await editor.waitForSelector('[data-testid=cursor-spotlight] img', { timeout: 20_000 });
    await editor.locator('[data-testid=cursor-spotlight]').scrollIntoViewIfNeeded();
    await shot('14b-look-cursors');
    await click(editor, '[data-testid=look-open-window]');
    await click(editor, '[data-testid=frame-mac-light]');
    await savedWhen((file) => (file as unknown as { look: { frame: { style?: string } } }).look.frame.style === 'mac-light');
    await click(editor, '[data-testid=look-open-cursor]');
    await choose('[data-testid=cursor-smoothing]', 'Very smooth');
    await savedWhen((file) => (file as unknown as { look: { cursor?: { smoothing?: number } } }).look.cursor?.smoothing === 1);
    await click(editor, '#tab-selection');
    await undoAll();
    expect(readFileSync(projectFile(), 'utf8')).toBe(original);
  }, 30_000);

  it('shows a ghost of a scene being moved, and zooms on clicks from the menu when there are any', async () => {
    await drag('.scene[data-id="s3"]', [-600, 0], { hold: true });
    expect(await editor.locator('.scene-ghost').count()).toBe(1);
    await shot('15-scene-ghost');
    await release([0, 0]);
    expect(await editor.locator('.scene-ghost').count()).toBe(0);
    await savedWhen((file) => file.scenes[0]?.id === 's3');
    await undoAll();
    // the fixture's clicks are too close to cuts or to the answer zoom for a zoom of their own
    await editor.keyboard.press('Control+K');
    await editor.keyboard.type('zoom on clicks');
    await editor.waitForFunction(() => document.querySelector('.command-menu [aria-selected=true]')?.textContent?.includes('Zoom on clicks'));
    await editor.keyboard.press('Enter');
    await expect.poll(() => doc().then((state) => state.toast?.text ?? ''), { timeout: 5000 }).toContain('No zoom fits the click left');
    expect((await editor.evaluate(() => document.querySelector('.app')?.getAttribute('data-tool'))) ?? 'select').toBe('select');
  }, 30_000);

  it("uses Cuttle's own menus, none of the system's: the keys open, move, pick and close them", async () => {
    expect(await editor.evaluate(() => document.querySelectorAll('select').length)).toBe(0);
    await click(editor, '#tab-look');
    await click(editor, '[data-testid=look-open-video]');
    await editor.focus('[data-testid=output-size]');
    await editor.keyboard.press('ArrowDown');
    await editor.waitForSelector('[data-testid=output-size-list]');
    await shot('16-select-open');
    // Esc closes it and keeps the focus on it (the editor does not back out of anything)
    await editor.keyboard.press('Escape');
    expect(await editor.locator('.select-list').count()).toBe(0);
    expect(await editor.evaluate(() => document.activeElement?.getAttribute('data-testid'))).toBe('output-size');
    // Enter opens it, End goes to the last size (9:16), Enter picks it
    await editor.keyboard.press('Enter');
    await editor.keyboard.press('End');
    await editor.keyboard.press('Enter');
    await savedWhen((file) => (file as unknown as { output: { width: number; height: number } }).output.height === 1920);
    await undoAll();
    await click(editor, '#tab-selection');
  }, 30_000);

  it('shows a cut as a notch the video jumps over, and what Cuttle did on its own in the Auto tab: a switch per kind and per item', async () => {
    const original = readFileSync(projectFile(), 'utf8');
    const before = (await editor.evaluate(() => (window as unknown as Hooked).__cuttleCheck.state())).duration as number;
    // Claude (or Cuttle's cut) writes an automatic cut and an automatic click zoom
    const outside = onDisk() as unknown as Written & { cuts: unknown[] };
    outside.cuts = [{ id: 'c1', label: 'Filler: ähm', from: 1.2, to: 1.7, auto: 'filler' }];
    outside.zooms.push({ id: 'z7', label: 'Clicks', at: 9.4, duration: 1.8, rect: [100, 100, 640, 400], auto: 'click' } as Written['zooms'][number]);
    writeFileSync(projectFile(), `${JSON.stringify(outside, null, 2)}\n`);
    await editor.waitForSelector('[data-testid=cut-notch]');
    await expect.poll(async () => (await editor.evaluate(() => (window as unknown as Hooked).__cuttleCheck.state())).duration as number).toBeCloseTo(before - 0.5, 3);
    // the notch selects the cut; the inspector says Cuttle made it and why
    await click(editor, '[data-testid=cut-notch]');
    await editor.waitForSelector('[data-testid=auto-note]');
    expect(await editor.locator('.inspector .kind-head .name').textContent()).toBe('Filler: ähm');
    await shot('17-cut');
    await click(editor, '[data-testid=cut-enabled]');
    await savedWhen((file) => (file as unknown as { cuts: { enabled?: boolean }[] }).cuts[0]!.enabled === false);
    await editor.waitForSelector('[data-testid=cut-notch].off');
    // the Auto tab: a row per kind; the click zooms switched off as a kind, then one back on
    await click(editor, '#tab-auto');
    await editor.waitForSelector('[data-testid=auto-group-click]');
    expect(await editor.locator('[data-testid=auto-group-fillers] .auto-count').textContent()).toBe('1 off');
    await click(editor, '[data-testid=auto-switch-click]');
    await savedWhen((file) => {
      const written = file as unknown as { autoEdits?: { clickZooms?: boolean }; zooms: { id: string; enabled?: boolean }[] };
      return written.autoEdits?.clickZooms === false && written.zooms.find((zoom) => zoom.id === 'z7')!.enabled === false;
    });
    expect((await doc()).undo).toBe('Zooms on clicks: off');
    await click(editor, '[data-testid=auto-group-click] .auto-toggle');
    await editor.waitForSelector('[data-testid=auto-group-click] .auto-items li.off');
    await shot('18-auto-tab');
    await click(editor, '[data-testid=auto-group-click] .auto-items li .toggle');
    await savedWhen((file) => (file as unknown as { zooms: { id: string; enabled?: boolean }[] }).zooms.find((zoom) => zoom.id === 'z7')!.enabled !== false);
    // a hand edit makes the zoom the person's: its tag goes
    await click(editor, '[data-testid=auto-group-click] .auto-item');
    await editor.waitForSelector('[data-testid=auto-note]');
    await drag('.item.zoom[data-id=z7]', [30, 0]);
    await savedWhen((file) => (file as unknown as { zooms: { id: string; auto?: string }[] }).zooms.find((zoom) => zoom.id === 'z7')!.auto === undefined);
    await click(editor, '#tab-selection');
    await editor.keyboard.press('Escape');
    await undoAll();
    // back to the file as it was (Claude reverting)
    writeFileSync(projectFile(), original);
    await editor.waitForFunction(() => document.querySelectorAll('[data-testid=cut-notch]').length === 0);
  }, 45_000);

  it('shows a zoom that follows typing: its moves on the timeline, its path in the source view; a drag takes the path along, Hold still ends it', async () => {
    const original = readFileSync(projectFile(), 'utf8');
    type Following = { id: string; rect: number[]; moves?: { at: number; rect: number[] }[]; auto?: string };
    const following = (file: Written) => file.zooms.find((zoom) => zoom.id === 'z8') as unknown as Following;
    // suggest's typing zoom in the first clip: from the left, to the middle at 1.2 s, down to the right at 2 s
    const outside = onDisk() as unknown as { zooms: unknown[] };
    outside.zooms.push({ id: 'z8', label: 'Typing', at: 0.3, duration: 2.5, rect: [100, 100, 576, 360], moves: [{ at: 1.2, rect: [400, 100, 576, 360] }, { at: 2, rect: [600, 300, 576, 360] }], auto: 'typing' });
    writeFileSync(projectFile(), `${JSON.stringify(outside, null, 2)}\n`);
    await editor.waitForSelector('.item.zoom[data-id=z8] .move-mark');
    expect(await editor.locator('.item.zoom[data-id=z8] .move-mark').count()).toBe(2);
    // selected (from the Auto tab, which goes to its start), the source view shows its path, and it
    // where it is at the playhead
    await click(editor, '#tab-auto');
    await click(editor, '[data-testid=auto-group-typing] .auto-toggle');
    await click(editor, '[data-testid=auto-group-typing] .auto-item');
    await editor.waitForSelector('[data-testid=zoom-path]');
    expect(await editor.locator('[data-testid=zoom-path] rect').count()).toBe(3);
    const left = async () => {
      const [box, view] = await Promise.all([editor.locator('.source-box.zoom.selected').boundingBox(), editor.locator('[data-testid=source-view]').boundingBox()]);
      return (box!.x - view!.x) / view!.width;
    };
    const start = await left();
    // at 1.6 s it has moved on from x 100 to x 400 (of 1280)
    await seek(1.6);
    await expect.poll(left).toBeGreaterThan(start + 0.1);
    await click(editor, '#tab-selection');
    await editor.waitForSelector('[data-testid=zoom-hold]');
    await shot('32-typing-zoom');
    // a drag at the playhead takes the whole path along: the person's zoom now
    await drag('.source-box.selected', [40, 0]);
    await savedWhen((file) => following(file).rect[0]! > 100);
    const dragged = following(onDisk());
    const by = dragged.rect[0]! - 100;
    expect(dragged.moves!.map((move) => move.rect[0]! - by)).toEqual([400, 600]);
    expect(dragged.auto).toBeUndefined();
    await click(editor, '[data-testid=zoom-hold]');
    await savedWhen((file) => following(file).moves === undefined);
    await editor.waitForSelector('[data-testid=zoom-path]', { state: 'detached' });
    expect((await doc()).undo).toBe('Hold the zoom still');
    await editor.keyboard.press('Escape');
    await undoAll();
    // back to the file as it was (Claude reverting)
    writeFileSync(projectFile(), original);
    await editor.waitForFunction(() => document.querySelectorAll('.item.zoom[data-id=z8]').length === 0);
  }, 45_000);

  it('shows a privacy mask that follows text up the screen: its path in the source view, the Auto tab row, Hold still', async () => {
    const original = readFileSync(projectFile(), 'utf8');
    // suggest's mask over a token that scrolled up between 0.5 and 2.5 s
    const outside = onDisk() as unknown as { masks: unknown[] };
    outside.masks.push({ id: 'm8', label: 'Key', from: 0.2, to: 2.8, rect: [300, 500, 500, 40], moves: [{ at: 1, rect: [300, 500, 500, 40] }, { at: 1.5, rect: [300, 400, 500, 40] }, { at: 2, rect: [300, 300, 500, 40] }], style: 'fill', auto: 'privacy' });
    writeFileSync(projectFile(), `${JSON.stringify(outside, null, 2)}\n`);
    await editor.waitForSelector('.item.mask[data-id=m8] .move-mark');
    await click(editor, '#tab-auto');
    await click(editor, '[data-testid=auto-group-privacy] .auto-toggle');
    await click(editor, '[data-testid=auto-group-privacy] .auto-item');
    await editor.waitForSelector('[data-testid=mask-path]');
    // between two places it covers both: one place is 500 × 40, at 1.25 s it is 500 × 140
    const shape = async () => {
      const box = (await editor.locator('.source-box.mask.selected').boundingBox())!;
      return box.width / box.height;
    };
    await seek(1.25);
    await expect.poll(shape).toBeLessThan(5);
    await click(editor, '#tab-selection');
    await editor.waitForSelector('[data-testid=mask-hold]');
    await shot('33-privacy-mask');
    await click(editor, '[data-testid=mask-hold]');
    await savedWhen((file) => (file.masks.find((mask) => mask.id === 'm8') as unknown as { moves?: unknown }).moves === undefined);
    expect((await doc()).undo).toBe('Hold the mask still');
    await editor.keyboard.press('Escape');
    await undoAll();
    writeFileSync(projectFile(), original);
    await editor.waitForFunction(() => document.querySelectorAll('.item.mask[data-id=m8]').length === 0);
  }, 45_000);

  it('crops a clip in the source view: the window takes the crop’s shape; the crop is switched off in the inspector', async () => {
    const original = readFileSync(projectFile(), 'utf8');
    await press('.scene[data-id=s1]');
    await click(editor, '[data-testid=clip-crop]');
    await editor.waitForSelector('[data-testid=source-view]');
    expect(await editor.evaluate(() => document.querySelector('.app')?.getAttribute('data-tool'))).toBe('crop');
    await drag('[data-testid=source-view]', [300, 120], { from: [0.25, 0.25] });
    await savedWhen((file) => Boolean((file.scenes[0] as { crop?: { rect: number[] } }).crop));
    const crop = (onDisk().scenes[0] as unknown as { crop: { rect: number[] } }).crop.rect;
    // free in its shape (a crop is not held to the screen's)
    expect(crop[2]! / crop[3]!).toBeGreaterThan(2);
    await editor.waitForSelector('.source-box.crop.selected');
    await shot('19-crop-source');
    await editor.keyboard.press('Escape');
    await seek(1);
    await shot('19-crop-video');
    await press('.scene[data-id=s1]');
    await click(editor, '[data-testid=clip-crop]');
    await editor.waitForSelector('[data-testid=crop-enabled]');
    await click(editor, '[data-testid=crop-enabled]');
    await savedWhen((file) => (file.scenes[0] as { crop?: { enabled?: boolean } }).crop?.enabled === false);
    await editor.keyboard.press('Escape');
    await undoAll();
    expect(readFileSync(projectFile(), 'utf8')).toBe(original);
  }, 30_000);

  it('keeps a drag going over a version written outside the app meanwhile: both are in the file, each undone on its own', async () => {
    await press('.item.zoom');
    await drag('.item.zoom', [40, 0], { hold: true });
    // Claude writes cuttle.json during the drag: a mask added
    const outside = onDisk();
    outside.masks.push({ id: 'm9', label: 'From Claude', from: 1, to: 2, rect: [10, 10, 100, 40] });
    writeFileSync(projectFile(), `${JSON.stringify(outside, null, 2)}\n`);
    await editor.waitForFunction(() => (window as unknown as Hooked).__cuttleCheck.doc().toast?.text === 'Changed outside the app: 1 mask added');
    expect(await editor.locator('[data-testid=toast-show]').count()).toBe(1);
    await shot('11-outside-change');
    await release([40, 0]);
    await savedWhen((file) => file.masks.length === 2 && file.zooms[0]!.at > 8.8 + 0.1);
    expect((await doc()).undo).toBe('Move zoom');
    await editor.keyboard.press('Control+Z');
    await savedWhen((file) => file.zooms[0]!.at === 8.8 && file.masks.length === 2);
    expect((await doc()).undo).toBe('the outside change');
    await editor.keyboard.press('Control+Z');
    await savedWhen((file) => file.masks.length === 1);
  }, 30_000);

  it('keeps the last good version while cuttle.json does not parse, and takes the fix', async () => {
    const good = readFileSync(projectFile(), 'utf8');
    writeFileSync(projectFile(), '{ "version": 1, "scenes": [ }');
    await editor.waitForSelector('[data-testid=issues]');
    expect(await editor.locator('[data-testid=save-state]').textContent()).toBe('Editing waits');
    await shot('12-broken-file');
    // an edit waits too: the broken file stays as it is
    await seek(1);
    await editor.keyboard.press('s');
    await editor.waitForTimeout(500);
    expect(readFileSync(projectFile(), 'utf8')).toBe('{ "version": 1, "scenes": [ }');
    writeFileSync(projectFile(), good);
    await editor.waitForSelector('[data-testid=issues]', { state: 'detached' });
    expect((await doc()).issues).toBeUndefined();
  }, 30_000);

  it('keeps an edit a newer version cannot take in cuttle.json.draft, and puts it back on "Use mine"', async () => {
    await press('.item.zoom');
    // Claude deletes the zoom just as it is duplicated here (before the app sees Claude's write)
    const outside = onDisk();
    outside.zooms = [];
    outside.masks.push({ id: 'm9', label: 'From Claude', from: 1, to: 2, rect: [10, 10, 100, 40] });
    writeFileSync(projectFile(), `${JSON.stringify(outside, null, 2)}\n`);
    await editor.keyboard.press('Control+D');
    await editor.waitForFunction(() => (window as unknown as Hooked).__cuttleCheck.doc().draftNote !== undefined);
    expect((await doc()).draftNote).toContain('“Duplicate zoom” no longer fits it');
    // the newer version shows; the person's is kept, with the zoom and its copy and without Claude's mask
    const draft = JSON.parse(readFileSync(join(project, 'cuttle.json.draft'), 'utf8')) as Written;
    expect(draft.zooms).toHaveLength(2);
    expect(draft.masks.map((item) => item.id)).toEqual(['m1']);
    expect(onDisk().masks.map((item) => item.id)).toEqual(['m1', 'm9']);
    await shot('13-draft');
    await click(editor, '[data-testid=draft-use]');
    await savedWhen((file) => file.masks.length === 1 && file.zooms.length === 2);
    expect((await doc()).undo).toBe('Use your version');
    await undoAll();
  }, 30_000);

  it('keeps a change from outside as its own step when an edit meets it: undoing the edit keeps the change', async () => {
    await seek(1);
    const outside = onDisk();
    outside.masks.push({ id: 'm9', label: 'From Claude', from: 1, to: 2, rect: [10, 10, 100, 40] });
    writeFileSync(projectFile(), `${JSON.stringify(outside, null, 2)}\n`);
    // at once: the split meets Claude's write in its save (or comes just after it)
    await editor.keyboard.press('s');
    await savedWhen((file) => file.scenes.length === 6 && file.masks.length === 2);
    expect((await doc()).undo).toBe('Split clip');
    await editor.keyboard.press('Control+Z');
    await savedWhen((file) => file.scenes.length === 5 && file.masks.length === 2);
    expect((await doc()).undo).toBe('the outside change');
    await editor.keyboard.press('Control+Z');
    await savedWhen((file) => file.masks.length === 1);
    await undoAll();
  }, 30_000);

  it('takes a version from outside even when this window wrote it before (Claude reverting)', async () => {
    const original = readFileSync(projectFile(), 'utf8');
    await seek(1);
    await editor.keyboard.press('s');
    await savedWhen((file) => file.scenes.length === 6);
    writeFileSync(projectFile(), original);
    await expect.poll(() => editor.locator('.scene').count(), { timeout: 10_000 }).toBe(5);
    expect((await doc()).undo).toBe('the outside change');
    await undoAll();
    expect(readFileSync(projectFile(), 'utf8')).toBe(original);
  }, 30_000);

  it('opens anew on another take written from outside', async () => {
    const original = readFileSync(projectFile(), 'utf8');
    const reloaded = async (change: () => void) => {
      await editor.evaluate(() => Object.assign(window, { __before: true }));
      change();
      await expect.poll(() => editor.evaluate(() => (window as unknown as { __before?: boolean }).__before === undefined).catch(() => false), { timeout: 15_000 }).toBe(true);
      await editor.waitForSelector('.app[data-phase="ready"]', { timeout: 30_000 });
    };
    // the take without its input track: the editor opens on it (a page cannot reload itself)
    const other = JSON.parse(original) as { sources: Record<string, string> };
    delete other.sources.events;
    await reloaded(() => writeFileSync(projectFile(), `${JSON.stringify(other, null, 2)}\n`));
    expect(await editor.evaluate(() => (window as unknown as Hooked).__cuttleCheck.doc().hash)).not.toBe('');
    // and back, for the checks after this one
    await reloaded(() => writeFileSync(projectFile(), original));
  }, 60_000);

  it('refuses to export edits that are not saved, and saves them on Try again', async () => {
    // a lock (OneDrive, a scanner) or no right to write; a write renames over the file, which POSIX
    // allows for a read-only file in a folder that may be written: the folder is locked there too
    const lockFolder = (mode: number) => process.platform !== 'win32' && chmodSync(project, mode);
    chmodSync(projectFile(), 0o444);
    lockFolder(0o555);
    try {
      await seek(1);
      await editor.keyboard.press('s');
      await editor.waitForFunction(() => document.querySelector('[data-testid=save-state]')?.textContent?.includes('Not saved'), undefined, { timeout: 30_000 });
      await editor.keyboard.press('Control+E');
      // a real click: it waits for the button to be enabled (the sheet chooses a format after it shows)
      await editor.click('[data-testid=export-start]');
      await editor.waitForSelector('.sheet .error-text');
      expect(await editor.locator('.sheet .error-text').textContent()).toContain('your latest edits are not saved');
      await editor.keyboard.press('Escape');
    } finally {
      lockFolder(0o755);
      chmodSync(projectFile(), 0o644);
    }
    await click(editor, '[data-testid=save-state]');
    await savedWhen((file) => file.scenes.length === 6);
    await undoAll();
  }, 60_000);

  it('moves the webcam bubble on the video, resizes it at a corner, and snaps it back into its corner', async () => {
    type Webcam = { corner: string; size?: number; position?: { x: number; y: number } };
    const webcam = () => (onDisk() as unknown as { look: { webcam: Webcam } }).look.webcam;
    await editor.keyboard.press('Escape');
    await editor.keyboard.press('v');
    await editor.waitForSelector('[data-testid=webcam-box]');
    // anywhere on the video: its centre as a share of it
    await drag('[data-testid=webcam-box]', [240, -120]);
    await savedWhen(() => webcam().position !== undefined);
    expect(webcam().position!.x).toBeGreaterThan(0.1);
    expect(webcam().position!.y).toBeLessThan(0.9);
    // a corner's handle makes it larger, around its centre
    const before = webcam().position!;
    await drag('[data-testid=webcam-handle-se]', [30, 30]);
    await savedWhen(() => (webcam().size ?? 0.18) > 0.18);
    expect(webcam().position).toEqual(before);
    // a double click opens the camera's part of the Look tab
    await editor.locator('[data-testid=webcam-box]').evaluate((box) => box.dispatchEvent(new MouseEvent('dblclick', { bubbles: true })));
    await editor.waitForSelector('[data-testid=look-camera] [data-testid=webcam-shape-circle]');
    await shot('20-webcam');
    // dragged back near where it came from: it snaps into its corner, the position goes
    await drag('[data-testid=webcam-box]', [-240, 120]);
    await savedWhen(() => webcam().position === undefined && webcam().corner === 'bottom-left');
    await undoAll();
  }, 30_000);

  it('ends a drawing with Esc: nothing is added', async () => {
    await seek(1);
    await editor.keyboard.press('z');
    await drag('[data-testid=source-view]', [200, 60], { from: [0.3, 0.3], hold: true });
    await editor.keyboard.press('Escape');
    await release([20, 0]);
    await editor.waitForTimeout(300);
    expect(onDisk().zooms).toHaveLength(1);
    expect((await doc()).undo).toBeUndefined();
    await editor.keyboard.press('Escape');
  }, 30_000);

  it('says what to do when no scene is left: the whole take is one click away', async () => {
    const original = readFileSync(projectFile(), 'utf8');
    const emptied = JSON.parse(original) as { scenes: unknown[] };
    emptied.scenes = [];
    writeFileSync(projectFile(), `${JSON.stringify(emptied, null, 2)}\n`);
    await editor.waitForSelector('[data-testid=empty-stage]');
    expect(await editor.locator('.titlebar .primary').isDisabled()).toBe(true);
    await click(editor, '[data-testid=empty-stage] .ghost');
    await savedWhen((file) => file.scenes.length === 1 && file.scenes[0]!.type === 'clip');
    expect(await editor.locator('[data-testid=empty-stage]').count()).toBe(0);
    await undoAll();
    expect(readFileSync(projectFile(), 'utf8')).toBe(original);
  }, 30_000);

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
    // a label typed and not yet left is written as the window closes
    await page.evaluate(() => (window as unknown as Hooked).__cuttleCheck.select({ kind: 'scene', id: 's1' }));
    await page.fill('[data-testid=clip-label]', 'Typed before closing');
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find((window) => window.getTitle() === 'second · Cuttle')?.close());
    await expect.poll(() => existsSync(lock), { timeout: 10_000 }).toBe(false);
    expect((JSON.parse(readFileSync(join(second, 'cuttle.json'), 'utf8')) as { scenes: { label?: string }[] }).scenes[0]!.label).toBe('Typed before closing');
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

  /**
   * Records the first monitor's display with its picker's Record button (with `choices`), stopping
   * from the HUD after about 1.5 s. The pointer is on that display, over nothing: Record takes it whole.
   */
  async function recordThroughPicker(start: () => Promise<unknown>, choices?: Record<string, unknown>, stop = true): Promise<void> {
    await start();
    const { page } = await firstMonitorPicker();
    await page.evaluate(async (choices) => {
      const bridge = (window as unknown as { cuttle: { invoke(channel: string, argument?: unknown): Promise<unknown> } }).cuttle;
      if (choices) await bridge.invoke('picker:choices', choices);
      await bridge.invoke('picker:hover');
    }, choices);
    await page.waitForSelector('[data-testid=picker-record]:not([disabled])', { state: 'attached' });
    // Cuttle's own menus here too (Stop on, the devices): none of the system's
    expect(await page.evaluate(() => document.querySelectorAll('select').length)).toBe(0);
    // the pickers close as the recording begins
    await click(page, '[data-testid=picker-record]').catch(() => {});
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
    // the cut came in as a change of the file: one step to undo
    await expect.poll(() => opened.evaluate(() => (window as unknown as { __cuttleCheck: Check }).__cuttleCheck.doc().undo), { timeout: 10_000 }).toBe("Cuttle's cut");
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

  it('deletes an earlier take from the take menu, never the one in use', async () => {
    const dir = join(root, 'projects', readdirSync(join(root, 'projects'))[0]!);
    const deleteTake = (rel: string) =>
      app.evaluate((_electron, [project, take]) => (globalThis as unknown as { __deleteTake(dir: string, rel: string, label: string, bytes: number): Promise<boolean> }).__deleteTake(project, take, 'Take', 0), [dir, rel] as const);
    expect(await deleteTake('takes/2')).toBe(false);
    expect(existsSync(join(dir, 'takes', '2', 'screen.mp4'))).toBe(true);
    expect(await deleteTake('takes/1')).toBe(true);
    expect(existsSync(join(dir, 'takes', '1'))).toBe(false);
    // the project still plays its take
    expect(JSON.parse(readFileSync(join(dir, 'cuttle.json'), 'utf8')).sources.screen).toBe('takes/2/screen.mp4');
  }, 30_000);

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

  /** The newest project the pill's recording made, once it is there. */
  async function newProject(before: Set<string>): Promise<string> {
    const projects = join(root, 'projects');
    let made: string | undefined;
    await expect.poll(() => (made = readdirSync(projects).find((name) => !before.has(name))), { timeout: 30_000 }).toBeDefined();
    return join(projects, made!);
  }
  const pillRecord = () =>
    app
      .windows()
      .find((page) => page.url().includes('/pill.html'))!
      .evaluate(() => (window as unknown as { cuttle: { invoke(channel: string): Promise<unknown> } }).cuttle.invoke('pill:record'));
  const runningHud = () => waitForPage(app, async (page) => page.url().includes('/hud.html') && (await page.locator('.hud.recording').count()) === 1 && (await page.locator('[data-testid=hud-time]').textContent()) !== '0:00');
  const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

  it('pauses from the HUD: nothing is recorded while paused, and the pieces are joined into the take', async () => {
    const before = new Set(readdirSync(join(root, 'projects')));
    await recordThroughPicker(pillRecord, { stop: 'none', camera: undefined }, false);
    const hud = await runningHud();
    await wait(1000);
    await click(hud, '[data-testid=hud-pause]');
    await hud.waitForSelector('.hud.paused');
    // the clock stands still while paused
    const shown = await hud.locator('[data-testid=hud-time]').textContent();
    await wait(2000);
    expect(await hud.locator('[data-testid=hud-time]').textContent()).toBe(shown);
    await click(hud, '[data-testid=hud-pause]');
    await hud.waitForSelector('.hud.recording');
    await wait(1000);
    await click(hud, '[data-testid=hud-stop]');
    const dir = await newProject(before);
    await projectWhen(dir, (written) => written.scenes[0]?.id !== undefined);
    const { segments, joined } = JSON.parse(readFileSync(join(dir, 'takes', '1', 'segments.json'), 'utf8')) as { segments: { duration: number; screen: { start: number } }[]; joined?: boolean };
    expect(joined).toBe(true);
    expect(segments).toHaveLength(2);
    // the 2 s paused are between the pieces, not in the take
    expect(segments[1]!.screen.start - (segments[0]!.screen.start + segments[0]!.duration)).toBeGreaterThan(1.8);
    const screen = Number(spawnSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', join(dir, 'takes', '1', 'screen.mp4')], { encoding: 'utf8' }).stdout.trim());
    expect(screen).toBeCloseTo(segments[0]!.duration + segments[1]!.duration, 1);
    expect(readdirSync(join(dir, 'takes', '1')).filter((name) => /\.\d+\.(mp4|m4a)$/.test(name))).toEqual([]);
    const opened = await waitForPage(app, async (page) => page.url().includes('/editor.html') && (await page.title()) === `${basename(dir)} · Cuttle`);
    await opened.waitForSelector('.app[data-phase="ready"]', { timeout: 30_000 });
  }, 120_000);

  it('marks a slip from the HUD (the mistake key): it says what to do next, and the cut goes back from there', async () => {
    const before = new Set(existsSync(join(root, 'projects')) ? readdirSync(join(root, 'projects')) : []);
    await recordThroughPicker(pillRecord, { stop: 'none', camera: undefined }, false);
    const hud = await runningHud();
    await wait(2500);
    await click(hud, '[data-testid=hud-retake]');
    await expect.poll(() => hud.locator('[data-testid=hud-note]').textContent(), { timeout: 5_000 }).toBe('Slip marked: do it again');
    // the hint fits the HUD whole
    expect(await hud.evaluate(() => [...document.querySelectorAll('[data-testid=hud-note], [data-testid=hud-note] *')].every((element) => element.scrollWidth <= element.clientWidth + 1))).toBe(true);
    await shotOf('31-hud-retake', '/hud.html');
    // the take goes on past the slip (the cut ends 0.15 s after it, at most at the take's end): a busy
    // runner gets here within that otherwise
    await wait(1000);
    await click(hud, '[data-testid=hud-stop]');
    const dir = await newProject(before);
    const written = (await projectWhen(dir, (file) => file.scenes[0]?.id !== undefined)) as unknown as { cuts?: { to: number; auto?: string; label?: string }[] };
    const { markers } = JSON.parse(readFileSync(join(dir, 'takes', '1', 'markers.json'), 'utf8')) as { markers: { t: number; kind: string }[] };
    const slip = markers.find((marker) => marker.kind === 'retake');
    expect(slip?.t).toBeGreaterThan(2);
    // no speech in this take: the cut goes back 5 s at most (not before the clip) to just past the key
    expect((written.cuts ?? []).filter((cut) => cut.auto === 'retake')).toEqual([expect.objectContaining({ label: 'Retake', to: expect.closeTo(slip!.t + 0.15, 2) })]);
    const opened = await waitForPage(app, async (page) => page.url().includes('/editor.html') && (await page.title()) === `${basename(dir)} · Cuttle`);
    await opened.waitForSelector('.app[data-phase="ready"]', { timeout: 30_000 });
    // once Cuttle's cut is in, the slip is a notch (its pin lies in the cut), and a row in the Auto tab
    await expect.poll(() => opened.evaluate(() => (window as unknown as { __cuttleCheck: Check }).__cuttleCheck.doc().undo), { timeout: 15_000 }).toBe("Cuttle's cut");
    await click(opened, '[data-testid=cut-notch]');
    await opened.waitForSelector('[data-testid=auto-note]');
    expect(await opened.locator('.inspector .kind-head .name').textContent()).toBe('Retake');
    await click(opened, '#tab-auto');
    expect(await opened.locator('[data-testid=auto-group-retakes] .auto-count').textContent()).toBe('1 on');
  }, 120_000);

  it('restarts from the HUD on a held press only: the take is put aside, and Undo restart brings it back', async () => {
    const before = new Set(readdirSync(join(root, 'projects')));
    await recordThroughPicker(pillRecord, { stop: 'none' }, false);
    let hud = await runningHud();
    await wait(800);
    const press = (page: Page, type: string) => page.evaluate((type) => document.querySelector('[data-testid=hud-restart]')!.dispatchEvent(new PointerEvent(type, { bubbles: true, button: 0, pointerId: 3 })), type);
    // let go early: nothing happens
    await press(hud, 'pointerdown');
    await wait(250);
    await press(hud, 'pointerup');
    const dir = await newProject(before);
    await wait(800);
    expect(existsSync(join(dir, 'takes', '.discarded'))).toBe(false);
    // held: the take goes aside and the recording starts again (no countdown in the check)
    await press(hud, 'pointerdown');
    await expect.poll(() => existsSync(join(dir, 'takes', '.discarded', '1')), { timeout: 15_000 }).toBe(true);
    hud = await runningHud();
    await wait(1000);
    await click(hud, '[data-testid=hud-stop]');
    await projectWhen(dir, (written) => written.sources.screen === 'takes/1/screen.mp4' && written.scenes[0]?.id !== undefined);
    const opened = await waitForPage(app, async (page) => page.url().includes('/editor.html') && (await page.title()) === `${basename(dir)} · Cuttle`);
    // the offer outlasts suggest's note about its cut
    await opened.waitForSelector('[data-testid=undo-restart]', { timeout: 30_000 });
    await expect.poll(() => opened.evaluate(() => (window as unknown as { __cuttleCheck: Check }).__cuttleCheck.doc().undo), { timeout: 15_000 }).toBe("Cuttle's cut");
    await click(opened, '[data-testid=undo-restart]');
    // the take from before the restart is the project's again (the new one stays as take 1)
    await projectWhen(dir, (written) => written.sources.screen === 'takes/2/screen.mp4' && written.scenes[0]?.id !== undefined);
    expect(existsSync(join(dir, 'takes', '1', 'screen.mp4'))).toBe(true);
    expect(existsSync(join(dir, 'takes', '.discarded', '1'))).toBe(false);
  }, 120_000);

  it('keeps the take a restart put aside when the next take fails, and offers it back', async () => {
    const before = new Set(existsSync(join(root, 'projects')) ? readdirSync(join(root, 'projects')) : []);
    // the failing test camera stops after a second: the take after the restart fails
    await recordThroughPicker(pillRecord, { stop: 'none', camera: 'Failing Test Camera' }, false);
    // at once: the camera fails a second in
    const hud = await waitForPage(app, async (page) => page.url().includes('/hud.html') && (await page.locator('.hud.recording').count()) === 1);
    await hud.evaluate(() => document.querySelector('[data-testid=hud-restart]')!.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 0, pointerId: 4 })));
    const dir = await newProject(before);
    await expect.poll(() => existsSync(join(dir, 'takes', '.discarded', '1')), { timeout: 15_000 }).toBe(true);
    // the recovered take opens, and the editor offers the one before the restart
    const opened = await waitForPage(app, async (page) => page.url().includes('/editor.html') && (await page.title()) === `${basename(dir)} · Cuttle`);
    await opened.waitForSelector('[data-testid=undo-restart]', { timeout: 60_000 });
  }, 120_000);

  it('opens the settings from a second launch: changes are kept, motion reaches every window, an open project is not renamed', async () => {
    await launchAgain(['--settings']);
    // shown with the settings read (a click before would change nothing)
    const settings = await waitForPage(app, async (page) => page.url().includes('/settings.html') && (await page.locator('[data-testid=countdown] [aria-checked=true]').count()) === 1);
    expect(await settings.evaluate(() => document.querySelectorAll('select').length)).toBe(0);
    const saved = () => JSON.parse(readFileSync(join(root, 'user-data', 'settings.json'), 'utf8')) as { countdown: number; motion: string; launchAtLogin: boolean };
    await click(settings, '[data-testid=countdown] button:nth-child(3)');
    await expect.poll(() => saved().countdown).toBe(5);
    // one page at a time: Recording first, the rest in the sidebar
    expect(await settings.locator('[data-testid=launch-at-login]').count()).toBe(0);
    await shotOf('24-settings', '/settings.html');
    await click(settings, '[data-testid=settings-page-general]');
    await settings.waitForSelector('[data-testid=settings-page-general][aria-current=page]');
    expect(await settings.locator('[data-testid=countdown]').count()).toBe(0);
    // less motion: the editor's transitions are off at once
    await click(settings, '[data-testid=motion] button:nth-child(2)');
    await expect.poll(() => editor.evaluate(() => document.documentElement.dataset.motion)).toBe('reduce');
    expect(parseFloat(await editor.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--fast')))).toBe(0);
    await click(settings, '[data-testid=motion] button:nth-child(1)');
    await expect.poll(() => saved().motion).toBe('system');
    // the login item (the check only notes what it would register)
    await click(settings, '[data-testid=launch-at-login]');
    await expect.poll(() => app.evaluate(() => (globalThis as { __loginItem?: boolean }).__loginItem)).toBe(true);
    // the switch shows it before it is pressed again (a press reads the state it shows)
    await settings.waitForSelector('[data-testid=launch-at-login][aria-checked=true]');
    await click(settings, '[data-testid=launch-at-login]');
    await expect.poll(() => saved().launchAtLogin).toBe(false);
    // demo is open in its editor: Rename is off there, and the main process refuses it too
    await click(settings, '[data-testid=settings-page-projects]');
    await settings.waitForSelector('.recent li');
    const demoRename = await settings.evaluate(() => {
      const row = [...document.querySelectorAll('.recent li')].find((item) => item.querySelector('b')?.textContent === 'demo')!;
      const button = row.querySelector('[data-testid=recent-rename]') as HTMLButtonElement;
      return { disabled: button.disabled, title: button.title };
    });
    expect(demoRename).toEqual({ disabled: true, title: 'Close its editor to rename it' });
    const refused = await settings.evaluate(
      (dir) => (window as unknown as { cuttle: { invoke(channel: string, argument: unknown): Promise<{ problem?: string }> } }).cuttle.invoke('recent:rename', { dir, name: 'demo renamed' }),
      project,
    );
    expect(refused.problem).toContain('open in Cuttle');
    expect(existsSync(project)).toBe(true);
    // the editor asks for a page (its Speech settings button): the open window turns to it
    await editor.evaluate(() => (window as unknown as { cuttle: { invoke(channel: string, argument: unknown): Promise<void> } }).cuttle.invoke('app:settings', 'speech'));
    await settings.waitForSelector('[data-testid=settings-page-speech][aria-current=page]');
    await settings.waitForSelector('[data-testid=speech-line]');
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find((window) => window.webContents.getURL().includes('/settings.html'))?.close());
  }, 60_000);

  it('downloads a speech model in the settings (checked, cancelled, failed), and transcribes a spoken take from the Auto tab: its filler words and pauses cut as one step', async () => {
    await launchAgain(['--settings']);
    const settings = await waitForPage(app, async (page) => page.url().includes('/settings.html') && (await page.locator('[data-testid=settings-page-speech]').count()) === 1);
    await click(settings, '[data-testid=settings-page-speech]');
    await settings.waitForSelector('[data-testid=speech-line]');
    const saved = () => JSON.parse(readFileSync(join(root, 'user-data', 'settings.json'), 'utf8')) as { speech?: { model: string; language: string } };
    const line = () => settings.locator('[data-testid=speech-line] .row-hint').textContent();
    const choose = (label: string) => chooseIn(settings, '[data-testid=speech-model]', label, true);
    // Good (small), the default: not downloaded here; its download breaks off, and says so
    expect(await line()).toBe('German and English, about 5× real time. 488 MB to download, once.');
    await click(settings, '[data-testid=speech-download]');
    await expect.poll(line).toMatch(/^The download failed: the download from .* ended at 11 of 487601967 bytes$/);
    expect(await settings.locator('[data-testid=speech-download]').textContent()).toBe('Try again');
    expect(existsSync(join(root, 'models'))).toBe(true);
    expect(readdirSync(join(root, 'models'))).toEqual([]);
    // Best: its download runs on (progress) until it is cancelled
    await choose('Best');
    await expect.poll(() => saved().speech?.model).toBe('large-v3-turbo-q5_0');
    await expect.poll(line).toBe('The most accurate, about 2.6× real time. 574 MB to download, once.');
    await click(settings, '[data-testid=speech-download]');
    await settings.waitForSelector('[data-testid=speech-line] progress.download');
    expect(await line()).toBe('Downloading… 0 % of 574 MB');
    // another model chosen meanwhile: the line still shows the download, to cancel it
    await choose('Good');
    await expect.poll(line).toBe('The Best model is downloading (0 % of 574 MB): one download at a time.');
    await choose('Best');
    await expect.poll(line).toBe('Downloading… 0 % of 574 MB');
    await settings.locator('[data-testid=speech-line]').evaluate((element) => element.scrollIntoView({ block: 'center' }));
    await shotOf('25-speech-download', '/settings.html');
    await click(settings, '[data-testid=speech-cancel]');
    await settings.waitForSelector('[data-testid=speech-download]');
    expect(await line()).toBe('The most accurate, about 2.6× real time. 574 MB to download, once.');
    expect(readdirSync(join(root, 'models'))).toEqual([]);
    // the language spoken
    await click(settings, '[data-testid=speech-language] button:nth-child(3)');
    await expect.poll(() => saved().speech?.language).toBe('en');
    if (!BASE_MODEL || !hasWhisper) {
      await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find((window) => window.webContents.getURL().includes('/settings.html'))?.close());
      return;
    }
    // Fast (base): downloaded from the check's server, its checksum right
    await choose('Fast');
    await expect.poll(line).toBe('Good for English, weak for German. 148 MB to download, once.');
    await click(settings, '[data-testid=speech-download]');
    await settings.waitForSelector('[data-testid=speech-remove]', { timeout: 60_000 });
    expect(await line()).toBe('Downloaded: good for English, weak for German.');
    expect(readdirSync(join(root, 'models'))).toEqual(['ggml-base.bin']);
    await settings.locator('[data-testid=speech-line]').evaluate((element) => element.scrollIntoView({ block: 'center' }));
    await shotOf('26-speech-ready', '/settings.html');
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find((window) => window.webContents.getURL().includes('/settings.html'))?.close());

    // a spoken take, opened: the Auto tab offers to transcribe it
    const spoken = join(root, 'spoken');
    makeSpokenFixture(spoken, SPOKEN);
    const page = await openEditor(spoken);
    await click(page, '#tab-auto');
    await page.waitForSelector('[data-testid=speech-note]');
    await click(page, '[data-testid=transcribe]');
    // the title bar says how far it is; the cuts arrive as one step, "Cuttle's speech edits"
    const file = () => JSON.parse(readFileSync(join(spoken, 'cuttle.json'), 'utf8')) as { sources: { transcript?: string }; cuts?: { auto?: string; from: number; to: number }[] };
    await expect.poll(() => file().sources.transcript, { timeout: 60_000 }).toBe('takes/1/transcript.json');
    const cuts = file().cuts ?? [];
    const fillers = cuts.filter((cut) => cut.auto === 'filler').length;
    const pauses = cuts.filter((cut) => cut.auto === 'pause').length;
    expect(fillers).toBeGreaterThanOrEqual(1);
    expect(pauses).toBeGreaterThanOrEqual(1);
    // "Uh" at 2.02 s is gone from the video, and "Um, it zooms on clicks. Again." (7.55 to 10.8 s)
    // with it: a slip said again
    expect(cuts.filter((cut) => cut.auto === 'retake')).toEqual([expect.objectContaining({ label: 'Retake: “Again”' })]);
    for (const at of [2.1, 7.7, 9, 10.5]) expect(cuts.some((cut) => cut.from <= at && at < cut.to), `a cut at ${at} s`).toBe(true);
    await page.waitForSelector('[data-testid=auto-group-fillers]');
    await page.waitForSelector('[data-testid=speech-note]', { state: 'detached' });
    expect(await page.locator('[data-testid=auto-group-fillers] .auto-count').textContent()).toBe(`${fillers} on`);
    expect(await page.locator('[data-testid=auto-group-pauses] .auto-count').textContent()).toBe(`${pauses} on`);
    expect(await page.locator('[data-testid=auto-group-retakes] .auto-count').textContent()).toBe('1 on');
    const pageDoc = () => page.evaluate(() => (window as unknown as Hooked).__cuttleCheck.doc());
    expect((await pageDoc()).undo).toBe("Cuttle's speech edits");
    expect((await pageDoc()).toast?.text).toBe(`Cuttle cut 1 retake, and ${fillers} filler word${fillers === 1 ? '' : 's'} and ${pauses} pause${pauses === 1 ? '' : 's'} where the picture rests.`);
    expect(await page.locator('[data-testid=project-status]').count()).toBe(0);
    // the video is shorter by the cuts, in the player and the title bar
    const removed = cuts.reduce((sum, cut) => sum + (cut.to - cut.from), 0);
    await expect.poll(async () => (await page.evaluate(() => (window as unknown as Hooked).__cuttleCheck.state())).duration).toBeCloseTo(19.5 - removed, 1);
    const duration = (await page.evaluate(() => (window as unknown as Hooked).__cuttleCheck.state())).duration;
    expect(await page.locator('.titlebar .project-name span').textContent()).toBe(`19.5 s recorded · ${Math.floor(duration * 10 + 1e-6) / 10} s video`);
    await click(page, '[data-testid=auto-group-fillers] .auto-toggle');
    await shotOf('27-speech-edits', '/editor.html', 'spoken · Cuttle');
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find((window) => window.getTitle() === 'spoken · Cuttle')?.close());
  }, 120_000);

  it('shows the transcript (a click goes to a word, a fix reads in the subtitles, Delete cuts words and Restore brings them back), styles the subtitles, and exports them as .srt', async () => {
    const dir = join(root, 'subtitled');
    makeSpokenFixture(dir, SPOKEN);
    // the transcript the spoken take gets, from its words' true starts: no speech model needed here
    const truth = JSON.parse(readFileSync(SPOKEN_WORDS, 'utf8')) as { t: number; text: string }[];
    const words = truth.map((word, i) => ({ t: word.t, end: Math.min(truth[i + 1]?.t ?? word.t + 0.5, word.t + 0.5), text: word.text }));
    const take = join(dir, 'takes', '1');
    writeFileSync(join(take, 'transcript.json'), JSON.stringify({ version: 1, language: 'en', model: 'small', words }));
    cpSync(join(take, 'mic.m4a'), join(take, 'mic.clean.m4a'));
    const path = join(dir, 'cuttle.json');
    const raw = JSON.parse(readFileSync(path, 'utf8')) as { sources: Record<string, string> };
    writeFileSync(path, JSON.stringify({ ...raw, sources: { ...raw.sources, transcript: 'takes/1/transcript.json', cleanMic: 'takes/1/mic.clean.m4a' } }, null, 2));
    type Saved = { cuts?: { label?: string }[]; captions?: { style?: string; fixes?: { at: number; end: number; text: string }[] }; look?: { audio?: { cleanup?: boolean; typing?: boolean; typingVolume?: number } } };
    const saved = () => JSON.parse(readFileSync(path, 'utf8')) as Saved;
    const page = await openEditor(dir);
    const pageState = () => page.evaluate(() => (window as unknown as Hooked).__cuttleCheck.state());
    const index = (text: string) => words.findIndex((word) => word.text === text);
    const word = (text: string) => `[data-testid=transcript] .word[data-index="${index(text)}"]`;
    // the subtitles over the mic's waveform
    await page.waitForSelector('[data-testid=subtitle-cue]');
    // the Transcript tab: every word; a click goes there
    await click(page, '#tab-transcript');
    await page.waitForSelector('[data-testid=transcript] .word');
    expect(await page.locator('[data-testid=transcript] .word').count()).toBe(words.length);
    await click(page, word('records'));
    await expect.poll(async () => (await pageState()).t).toBeCloseTo(words[index('records')]!.t, 1);
    // a double click fixes a word; the fix is one step in the file
    await page.evaluate((selector) => document.querySelector(selector)!.dispatchEvent(new MouseEvent('dblclick', { bubbles: true })), word('Cuttle'));
    await page.fill('[data-testid=word-field]', 'Cuttle!');
    await page.press('[data-testid=word-field]', 'Enter');
    const cuttle = words[index('Cuttle')]!;
    await expect.poll(() => saved().captions?.fixes).toEqual([{ at: cuttle.t, end: cuttle.end, text: 'Cuttle!' }]);
    // one word for one: it keeps its place in the list
    await page.waitForSelector(`${word('Cuttle')}.fixed`);
    // Delete cuts the selected word out of the video; Restore brings it back
    await click(page, word('every'));
    await page.keyboard.press('Delete');
    await expect.poll(() => saved().cuts?.map((cut) => cut.label)).toEqual(['Words: “every”']);
    await page.waitForSelector(`${word('every')}.cut`);
    await click(page, '[data-testid=transcript-restore]');
    await expect.poll(() => saved().cuts ?? []).toEqual([]);
    // Ctrl+F finds words; Enter goes to the next one after the selected word ("every"), Shift+Enter back
    await page.keyboard.press('Control+F');
    await expect.poll(() => page.evaluate(() => (document.activeElement as HTMLElement | null)?.dataset.testid)).toBe('transcript-find');
    await page.keyboard.type('click');
    expect(await page.locator('.transcript-count').textContent()).toBe('2 found');
    await page.keyboard.press('Enter');
    await page.waitForSelector(`${word('click')}.selected`);
    await page.keyboard.press('Shift+Enter');
    await page.waitForSelector(`${word('clicks')}.selected`);
    await shotOf('28-transcript', '/editor.html', 'subtitled · Cuttle');
    // the Look tab: the subtitles' style, and the clean voice
    await click(page, '#tab-look');
    await click(page, '[data-testid=look-open-subtitles]');
    await page.waitForSelector('[data-testid=captions-enabled][aria-checked=true]');
    await chooseIn(page, '[data-testid=captions-style]', 'Karaoke');
    await expect.poll(() => saved().captions?.style).toBe('karaoke');
    await click(page, '[data-testid=look-open-sound]');
    await click(page, '[data-testid=audio-cleanup]');
    await expect.poll(() => saved().look?.audio?.cleanup).toBe(false);
    // the typing sounds: their volume on a slider (let go at 30 %), and a switch
    await page.locator('[data-testid=audio-typing-volume]').evaluate((element) => {
      const input = element as HTMLInputElement;
      // React sees a value set through the element's own setter
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, '30');
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await expect.poll(() => saved().look?.audio?.typingVolume).toBe(0.3);
    await page.locator('[data-testid=audio-typing]').evaluate((element) => element.scrollIntoView({ block: 'center' }));
    await shotOf('29b-typing-sounds', '/editor.html', 'subtitled · Cuttle');
    await click(page, '[data-testid=audio-typing]');
    await expect.poll(() => saved().look?.audio?.typing).toBe(false);
    await page.waitForSelector('[data-testid=audio-typing-volume]', { state: 'detached' });
    await click(page, '[data-testid=look-open-subtitles]');
    await page.evaluate((t) => (window as unknown as Hooked).__cuttleCheck.seek(t), words[index('zooms')]!.t + 0.1);
    await page.locator('[data-testid=captions-style]').evaluate((element) => element.scrollIntoView({ block: 'center' }));
    await shotOf('29-subtitles-karaoke', '/editor.html', 'subtitled · Cuttle');
    // the export writes the subtitles next to the video
    await page.keyboard.press('Control+E');
    await page.waitForSelector('[data-testid=export-subtitles]');
    await click(page, '[data-testid=export-srt]');
    await page.waitForSelector('[data-testid=export-srt][aria-pressed=true]');
    await shotOf('30-export-subtitles', '/editor.html', 'subtitled · Cuttle');
    await click(page, '[data-testid=export-start]');
    await page.waitForSelector('[data-testid=export-file]', { timeout: 120_000 });
    expect(await page.locator('[data-testid=export-file] small').textContent()).toContain('with .srt');
    const srt = readFileSync(join(dir, 'out', 'export.srt'), 'utf8');
    expect(srt.startsWith('1\n00:00:00,100 --> ')).toBe(true);
    expect(srt).toContain('Cuttle!');
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find((window) => window.getTitle() === 'subtitled · Cuttle')?.close());
  }, 180_000);

  // the system's own OCR: Windows', macOS's Vision
  it('fits a video to a length from the timeline bar: cut where it rests, never near a click, one step, listed in the Auto tab, and back to the full length', async () => {
    // the demo (10.1 s) fits 15 s as it is: nothing changes, and the bar says so
    await chooseIn(editor, '[data-testid=length]', '15 s');
    // (the first fit reads the take's screen: its analysis is kept for the next)
    await expect.poll(async () => (await doc()).toast?.text, { timeout: 30_000 }).toBe('The video is 10.1 s: it fits 15 s.');
    expect(((JSON.parse(readFileSync(projectFile(), 'utf8')) as { cuts?: { auto?: string }[] }).cuts ?? []).some((cut) => cut.auto === 'length')).toBe(false);

    // a take that mostly rests: 20 s of a still screen, clicks at 3 and 15 s
    const dir = join(root, 'resting');
    makeRestingFixture(dir);
    const page = await openEditor(dir);
    const pageDoc = () => page.evaluate(() => (window as unknown as Hooked).__cuttleCheck.doc());
    const pageState = () => page.evaluate(() => (window as unknown as Hooked).__cuttleCheck.state());
    const lengthCuts = () => ((JSON.parse(readFileSync(join(dir, 'cuttle.json'), 'utf8')) as { cuts?: { from: number; to: number; auto?: string; label?: string }[] }).cuts ?? []).filter((cut) => cut.auto === 'length');
    // an other length, typed
    await chooseIn(page, '[data-testid=length]', 'Other length…');
    await page.fill('[data-testid=length-input]', '5');
    await page.press('[data-testid=length-input]', 'Enter');
    await expect.poll(() => lengthCuts().length, { timeout: 30_000 }).toBeGreaterThan(0);
    for (const cut of lengthCuts()) {
      expect(cut.label).toBe('Fit to 5 s');
      for (const t of [3, 15]) expect(cut.to <= t - 0.3 || cut.from >= t + 0.3).toBe(true);
    }
    await expect.poll(async () => (await pageDoc()).undo).toBe("Cuttle's length fit");
    await expect.poll(async () => (await pageState()).duration).toBeLessThan(5.2);
    expect((await pageState()).duration).toBeGreaterThan(4.3);
    expect((await pageDoc()).toast?.text).toMatch(/^Cuttle cut where the video rests to fit 5 s: [\d.]+ s now\.$/);
    await page.waitForSelector('[data-testid=length] .length-fitted');
    // the Auto tab lists the fit's cuts
    await click(page, '#tab-auto');
    await page.waitForSelector('[data-testid=auto-group-length]');
    await click(page, '[data-testid=auto-group-length] .auto-toggle');
    await shotOf('36-length-fit', '/editor.html', 'resting · Cuttle');
    // the full length again, also one step
    await chooseIn(page, '[data-testid=length]', 'Full length');
    await expect.poll(() => lengthCuts().length, { timeout: 30_000 }).toBe(0);
    await expect.poll(async () => (await pageState()).duration).toBeCloseTo(20, 1);
    await expect.poll(async () => (await pageDoc()).toast?.text).toBe('Cuttle took the length fit out: the video is 20 s again.');
    await page.waitForSelector('[data-testid=length] .length-fitted', { state: 'detached' });
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find((window) => window.getTitle() === 'resting · Cuttle')?.close());
  }, 120_000);

  it.runIf(process.platform === 'win32' || process.platform === 'darwin')('reads the screen after a take when the settings say so, and from the Auto tab: what it shows that is private and the notifications masked as one step', async () => {
    // the settings: reading is off in this check; switched on, each new take is read after its cut
    await launchAgain(['--settings']);
    const settings = await waitForPage(app, async (page) => page.url().includes('/settings.html') && (await page.locator('[data-testid=settings-page-privacy]').count()) === 1);
    await click(settings, '[data-testid=settings-page-privacy]');
    await settings.waitForSelector('[data-testid=privacy-read]');
    const saved = () => (JSON.parse(readFileSync(join(root, 'user-data', 'settings.json'), 'utf8')) as { privacy?: { read: boolean; words: string[] } }).privacy;
    await settings.waitForSelector('[data-testid=privacy-read][aria-checked=false]');
    await click(settings, '[data-testid=privacy-read]');
    await expect.poll(() => saved()?.read).toBe(true);
    // words always masked: Enter adds them (commas between), the cross takes one away
    await settings.fill('[data-testid=privacy-word-input]', 'Lena Müller, ACME');
    await settings.press('[data-testid=privacy-word-input]', 'Enter');
    await expect.poll(() => saved()?.words).toEqual(['Lena Müller', 'ACME']);
    await settings.waitForSelector('[data-testid=privacy-words] .word:nth-child(2) button');
    await click(settings, '[data-testid=privacy-words] .word:nth-child(2) button');
    await expect.poll(() => saved()?.words).toEqual(['Lena Müller']);
    await settings.locator('[data-testid=privacy-read]').evaluate((element) => element.scrollIntoView({ block: 'center' }));
    await shotOf('34-privacy-settings', '/settings.html');

    // a new take: read after its cut, linked as one step ("Cuttle's privacy masks")
    const before = new Set(existsSync(join(root, 'projects')) ? readdirSync(join(root, 'projects')) : []);
    await recordThroughPicker(pillRecord, { stop: 'none', camera: undefined }, false);
    const hud = await runningHud();
    await wait(1500);
    await click(hud, '[data-testid=hud-stop]');
    const recorded = await newProject(before);
    await projectWhen(recorded, (written) => (written.sources as { screenText?: string }).screenText === 'takes/1/screen-text.jsonl', 90_000);
    const title = `${basename(recorded)} · Cuttle`;
    const opened = await waitForPage(app, async (page) => page.url().includes('/editor.html') && (await page.title()) === title);
    await expect.poll(() => opened.evaluate(() => (window as unknown as Hooked).__cuttleCheck.doc().undo), { timeout: 15_000 }).toBe("Cuttle's privacy masks");
    await app.evaluate(({ BrowserWindow }, title) => BrowserWindow.getAllWindows().find((window) => window.getTitle() === title)?.close(), title);
    await click(settings, '[data-testid=privacy-read]');
    await expect.poll(() => saved()?.read).toBe(false);
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find((window) => window.webContents.getURL().includes('/settings.html'))?.close());

    // a take whose screen shows an email address, with a notification from 3 to 5 s: the Auto tab offers to read it
    const dir = join(root, 'private');
    makePrivateFixture(dir);
    const page = await openEditor(dir);
    await click(page, '#tab-auto');
    await page.waitForSelector('[data-testid=privacy-note]');
    await click(page, '[data-testid=read-screen]');
    type Saved = { sources: { screenText?: string }; masks?: { label?: string; auto?: string; from: number; to: number; rect: number[] }[]; privacy?: { words: string[] } };
    const file = () => JSON.parse(readFileSync(join(dir, 'cuttle.json'), 'utf8')) as Saved;
    await expect.poll(() => file().sources.screenText, { timeout: 60_000 }).toBe('takes/1/screen-text.jsonl');
    const masks = file().masks ?? [];
    expect(masks.map((mask) => [mask.label, mask.auto])).toEqual([
      ['Email address', 'privacy'],
      ['Notification', 'notification'],
    ]);
    expect(masks[0]!.rect[1]).toBeLessThan(130);
    expect(masks[1]).toMatchObject({ from: 2.7, to: 5.3, rect: [874, 594, 392, 122] });
    // the settings' words go into the project
    expect(file().privacy?.words).toEqual(['Lena Müller']);
    await page.waitForSelector('[data-testid=privacy-note]', { state: 'detached' });
    await page.waitForSelector('[data-testid=auto-group-privacy]');
    expect(await page.locator('[data-testid=auto-group-privacy] .auto-count').textContent()).toBe('2 on');
    const pageDoc = () => page.evaluate(() => (window as unknown as Hooked).__cuttleCheck.doc());
    await expect.poll(async () => (await pageDoc()).undo).toBe("Cuttle's privacy masks");
    expect((await pageDoc()).toast?.text).toBe('Cuttle masked 1 private thing the screen showed and 1 notification: check them in the Auto tab.');
    expect(await page.locator('[data-testid=project-status]').count()).toBe(0);
    await click(page, '[data-testid=auto-group-privacy] .auto-toggle');
    await page.evaluate((t) => (window as unknown as Hooked).__cuttleCheck.seek(t), 4);
    await shotOf('35-privacy-read', '/editor.html', 'private · Cuttle');
    // one step to undo: the masks and the link go together
    await page.keyboard.press('Control+Z');
    await expect.poll(() => file().masks ?? []).toEqual([]);
    expect(file().sources.screenText).toBeUndefined();
    await page.waitForSelector('[data-testid=privacy-note]');
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find((window) => window.getTitle() === 'private · Cuttle')?.close());
  }, 180_000);

  it('opens a project with motion: its scene on the timeline, and the export draws the scene and the overlay', async () => {
    const dir = join(root, 'motion');
    makeMotionFixture(dir);
    const page = await openEditor(dir);
    await page.waitForSelector('.scene.motion');
    expect(await page.locator('.scene.motion').first().textContent()).toContain('intro');
    await shotOf('37-motion', '/editor.html', 'motion · Cuttle');
    await page.keyboard.press('Control+E');
    await page.waitForSelector('[data-testid=export-sheet]');
    await page.click('[data-testid=export-start]');
    await page.waitForSelector('[data-testid=export-file]', { timeout: 120_000 });
    // a pixel of the video (rgb24 from ffmpeg; a crop of 2×2, since 4:2:0 video crops in pairs)
    const pixel = (seconds: number, x: number, y: number) => [
      ...spawnSync('ffmpeg', ['-v', 'error', '-ss', String(seconds), '-i', join(dir, 'out', 'export.mp4'), '-frames:v', '1', '-vf', `crop=2:2:${x}:${y}`, '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'], { windowsHide: true }).stdout.subarray(0, 3),
    ];
    // saturated colours move a little between the video's colour matrix and ffmpeg's
    const near = (actual: number[], expected: number[]) => actual.length === 3 && actual.every((value, i) => Math.abs(value - expected[i]!) <= 40);
    // the scene fills the frame; over the clip (output 2.5 s is source 1.5 s) the overlay's bar shows at the bottom only
    expect(near(pixel(0.5, 320, 180), [255, 0, 255])).toBe(true);
    expect(near(pixel(2.5, 320, 350), [0, 255, 0])).toBe(true);
    expect(near(pixel(2.5, 320, 100), [0, 255, 0])).toBe(false);
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find((window) => window.getTitle() === 'motion · Cuttle')?.close());
  }, 180_000);

  it('had no unhandled rejection in the main process, and no error in the editor', async () => {
    expect(await app.evaluate(() => (globalThis as unknown as { __rejections: string[] }).__rejections)).toEqual([]);
    expect(pageErrors).toEqual([]);
  });

  // Last: the app quits here.
  it('stops a recording when the app quits, and writes the take into its project first (a second quit waits too)', async () => {
    const projects = join(root, 'projects');
    const before = new Set(readdirSync(projects));
    const pill = app.windows().find((page) => page.url().includes('/pill.html'))!;
    // no camera: the one the check before chose fails on purpose
    await recordThroughPicker(() => pill.evaluate(() => (window as unknown as { cuttle: { invoke(channel: string): Promise<unknown> } }).cuttle.invoke('pill:record')), { stop: 'none' }, false);
    await waitForPage(app, async (page) => page.url().includes('/hud.html') && (await page.locator('[data-testid=hud-time]').textContent()) !== '0:00');
    await new Promise((resolve) => setTimeout(resolve, 1000));
    const exited = new Promise((resolve) => app.process().once('exit', resolve));
    await app
      .evaluate(({ app: electronApp }) => {
        electronApp.quit();
        // Quit again while the take is written (from the tray, say): it waits as well.
        setTimeout(() => electronApp.quit(), 200);
      })
      .catch(() => {});
    await exited;
    const made = readdirSync(projects).find((name) => !before.has(name))!;
    expect(JSON.parse(readFileSync(join(projects, made, 'cuttle.json'), 'utf8')).sources.screen).toBe('takes/1/screen.mp4');
  }, 60_000);
});

describe.runIf(enabled)('the first run', () => {
  let app: ElectronApplication;
  let root: string;
  const pathFile = () => join(root, 'path.txt');

  beforeAll(async () => {
    root = mkdtempSync(join(tmpdir(), 'cuttle-first-run-'));
    // the PATH as the OS has it: ffmpeg is not on it yet
    writeFileSync(pathFile(), join(root, 'nothing-here'));
    app = await _electron.launch({
      executablePath: electronPath(),
      args: [MAIN, '--cuttle-check'],
      env: {
        ...process.env,
        CUTTLE_HIDDEN: '1',
        CUTTLE_CHECK: '1',
        CUTTLE_USER_DATA: join(root, 'user-data'),
        CUTTLE_RECORDER_BACKEND: 'test',
        CUTTLE_CHECK_PATH_FILE: pathFile(),
        // the command and the skill go into folders of the check's own, never the user's
        CUTTLE_BIN_DIR: join(root, 'bin'),
        CLAUDE_CONFIG_DIR: join(root, 'claude'),
      },
    });
  }, 60_000);

  afterAll(async () => {
    await app?.close();
    await rm(root, { recursive: true, force: true });
  });

  it('welcomes on the first start: finds ffmpeg once installed, installs the cuttle command and the skill, then shows the pill', async () => {
    const page = await waitForPage(app, async (candidate) => candidate.url().includes('/settings.html'));
    await page.waitForSelector('[data-testid=tool-ffmpeg][data-state=missing]');
    // installed meanwhile (winget): Check again finds it, without a restart
    const ffmpeg = spawnSync(process.platform === 'win32' ? 'where' : 'which', ['ffmpeg'], { encoding: 'utf8' }).stdout.split(/\r?\n/)[0]!;
    // elsewhere than Windows the app cannot put its command's folder on PATH (it gives the line for the
    // shell profile): here the profile has it, as ~/.local/bin is on most Macs' PATH
    writeFileSync(pathFile(), process.platform === 'win32' ? dirname(ffmpeg) : [dirname(ffmpeg), join(root, 'bin')].join(delimiter));
    await click(page, '[data-testid=check-again]');
    await page.waitForSelector('[data-testid=tool-ffmpeg][data-state=ok]');
    await click(page, '[data-testid=install-tools]');
    await page.waitForSelector('[data-testid=tool-command][data-state=ok]');
    await page.waitForSelector('[data-testid=tool-skill][data-state=ok]');
    if (process.platform === 'win32') expect(await app.evaluate(() => (globalThis as { __pathAdded?: string[] }).__pathAdded)).toEqual([join(root, 'bin')]);
    // the command runs the app's copy of the CLI, with the app as Node
    const version =
      process.platform === 'win32'
        ? spawnSync('cmd', ['/c', join(root, 'bin', 'cuttle.cmd'), '--version'], { encoding: 'utf8', windowsHide: true })
        : spawnSync('sh', [join(root, 'bin', 'cuttle'), '--version'], { encoding: 'utf8' });
    expect(version.stdout.trim()).toMatch(/^\d+\.\d+\.\d+$/);
    const skill = readFileSync(join(root, 'claude', 'skills', 'cuttle', 'SKILL.md'), 'utf8');
    expect(skill).toContain("open Cuttle's settings");
    expect(skill).not.toContain('{{');
    await click(page, '[data-testid=welcome-done]');
    await waitForPage(app, async (candidate) => candidate.url().includes('/pill.html'));
    await expect.poll(() => (JSON.parse(readFileSync(join(root, 'user-data', 'settings.json'), 'utf8')) as { welcomed?: boolean }).welcomed).toBe(true);
    await expect.poll(() => app.windows().some((candidate) => candidate.url().includes('/settings.html'))).toBe(false);
  }, 60_000);
});
